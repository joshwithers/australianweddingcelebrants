/**
 * MCP (Model Context Protocol) server over Streamable HTTP.
 *
 * Stateless — every POST carries a full JSON-RPC 2.0 request, response is
 * returned inline (no SSE needed). Exposes read-only directory tools backed
 * by the site's own /llms.txt and /directory/<slug>.md endpoints. The Worker
 * isolate caches the parsed celebrant list for 1 minute to keep latency low
 * without pinning stale data.
 *
 * Spec: https://modelcontextprotocol.io/specification
 */

import { loadListings, loadProfile, slugifyLocation, sortByTier, TIER_ORDER } from "./directory.js";
import { WIDGETS, WIDGET_LIST_URI, WIDGET_PROFILE_URI } from "./widgets.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "io.australianweddingcelebrants.directory";
const SERVER_VERSION = "1.0.0";

// ─────────────────────────────────────────────────────────────────────────────
// CORS — MCP is called by arbitrary agents, so open it up.
// ─────────────────────────────────────────────────────────────────────────────

function mcpCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Max-Age": "86400",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions — shape matches MCP `tools/list` response.
//
// Annotations (per MCP + ChatGPT Apps SDK submission guidelines):
//   readOnlyHint     true   — all tools just read the directory, never write
//   destructiveHint  false  — nothing deletes / modifies anything
//   openWorldHint    true   — tools reach outside the conversation to public data
//   idempotentHint   true   — same input → same output (modulo 5-min cache)
// ─────────────────────────────────────────────────────────────────────────────

const SHARED_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const CELEBRANT_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    slug: { type: "string" },
    name: { type: "string" },
    tier: { type: "string", enum: ["luminary", "endorsed", "registered"] },
    locations: { type: "array", items: { type: "string" } },
    description: { type: "string" },
    australia_wide: { type: "boolean" },
    url: { type: "string", format: "uri" },
  },
  required: ["slug", "name", "tier", "locations", "url"],
};

const TOOLS = [
  {
    name: "search_celebrants",
    title: "Search celebrants",
    description:
      "Search the Australian Wedding Celebrants directory by free-text query. Matches against celebrant name, location, and profile description. Returns up to 25 results sorted by tier (Luminary first).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search — name, location, or specialty.",
          minLength: 2,
        },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        count: { type: "integer" },
        celebrants: { type: "array", items: CELEBRANT_SUMMARY_SCHEMA },
      },
      required: ["query", "count", "celebrants"],
    },
    annotations: { ...SHARED_ANNOTATIONS, title: "Search celebrants" },
    _meta: { "openai/outputTemplate": WIDGET_LIST_URI },
  },
  {
    name: "browse_by_location",
    title: "Browse celebrants by location",
    description:
      "List celebrants available for a specific Australian location. Returns both celebrants who list the location as a service area AND celebrants who travel Australia-wide (the second group is marked as 'Travels Australia-wide'). Accepts city, town, or region names like 'Sydney', 'Hobart', 'Byron Bay', 'Sunshine Coast'.",
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "Australian location name.",
        },
        include_travelers: {
          type: "boolean",
          description: "Whether to append celebrants who travel Australia-wide but don't list the location explicitly. Defaults to true.",
          default: true,
        },
      },
      required: ["location"],
    },
    outputSchema: {
      type: "object",
      properties: {
        location: { type: "string" },
        local_count: { type: "integer" },
        traveler_count: { type: "integer" },
        celebrants: {
          type: "array",
          items: {
            allOf: [CELEBRANT_SUMMARY_SCHEMA, { properties: { travels: { type: "boolean" } } }],
          },
        },
      },
      required: ["location", "local_count", "celebrants"],
    },
    annotations: { ...SHARED_ANNOTATIONS, title: "Browse celebrants by location" },
    _meta: { "openai/outputTemplate": WIDGET_LIST_URI },
  },
  {
    name: "browse_by_tier",
    title: "Browse celebrants by recognition tier",
    description:
      "List all celebrants at a given tier. 'luminary' is top (7+ yrs, extensive verified reviews, industry recognition); 'endorsed' is mid (insured, 100+ ceremonies, verified reviews); 'registered' is baseline (Commonwealth-authorised with Cert IV).",
    inputSchema: {
      type: "object",
      properties: {
        tier: {
          type: "string",
          enum: ["luminary", "endorsed", "registered"],
        },
      },
      required: ["tier"],
    },
    outputSchema: {
      type: "object",
      properties: {
        tier: { type: "string" },
        count: { type: "integer" },
        celebrants: { type: "array", items: CELEBRANT_SUMMARY_SCHEMA },
      },
      required: ["tier", "count", "celebrants"],
    },
    annotations: { ...SHARED_ANNOTATIONS, title: "Browse celebrants by recognition tier" },
    _meta: { "openai/outputTemplate": WIDGET_LIST_URI },
  },
  {
    name: "get_celebrant_profile",
    title: "Get a celebrant's full profile",
    description:
      "Return the full markdown profile of a single celebrant — bio, contact details, social links, awards, testimonials — by directory slug. Use the slug from search results.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Directory slug, e.g. 'josh-withers-ybt9'.",
        },
      },
      required: ["slug"],
    },
    outputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        profile_markdown: { type: "string" },
        url: { type: "string", format: "uri" },
      },
      required: ["slug", "profile_markdown", "url"],
    },
    annotations: { ...SHARED_ANNOTATIONS, title: "Get a celebrant's full profile" },
    _meta: { "openai/outputTemplate": WIDGET_PROFILE_URI },
  },
  {
    name: "list_all_celebrants",
    title: "List every celebrant",
    description:
      "Return the full directory — every celebrant with tier, locations, description, and profile URL. Use this for broad context when answering open-ended questions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        count: { type: "integer" },
        celebrants: { type: "array", items: CELEBRANT_SUMMARY_SCHEMA },
      },
      required: ["count", "celebrants"],
    },
    annotations: { ...SHARED_ANNOTATIONS, title: "List every celebrant" },
    _meta: { "openai/outputTemplate": WIDGET_LIST_URI },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution
// ─────────────────────────────────────────────────────────────────────────────

function toSummary(c) {
  return {
    slug: c.slug,
    name: c.name,
    tier: c.tier,
    locations: c.locations,
    description: c.description,
    australia_wide: !!c.australia_wide,
    url: c.url,
  };
}

async function executeTool(name, args, env) {
  switch (name) {
    case "search_celebrants": {
      const q = String(args?.query || "").toLowerCase().trim();
      if (q.length < 2) {
        return toolText("Query must be at least 2 characters.", true);
      }
      const all = await loadListings(env);
      const hits = all
        .filter((c) =>
          c.name.toLowerCase().includes(q) ||
          c.locations.some((l) => l.toLowerCase().includes(q)) ||
          c.description.toLowerCase().includes(q),
        )
        .sort(sortByTier)
        .slice(0, 25);
      return toolResult(
        renderListing(hits, `Search results for "${args.query}"`),
        { query: args.query, count: hits.length, celebrants: hits.map(toSummary) },
        WIDGET_LIST_URI,
      );
    }
    case "browse_by_location": {
      const locSlug = slugifyLocation(args?.location);
      if (!locSlug) return toolText("A location is required.", true);
      const includeTravelers = args?.include_travelers !== false;
      const all = await loadListings(env);

      const localSlugs = new Set();
      const local = [];
      for (const c of all) {
        if (c.locations.some((l) => slugifyLocation(l) === locSlug)) {
          local.push(c);
          localSlugs.add(c.slug);
        }
      }
      local.sort(sortByTier);

      const travelers = includeTravelers
        ? all
            .filter((c) => c.australia_wide && !localSlugs.has(c.slug))
            .sort(sortByTier)
            .map((c) => ({ ...c, _travels: true }))
        : [];

      const hits = [...local, ...travelers];
      const heading =
        travelers.length > 0
          ? `Celebrants for ${args.location} — ${local.length} local + ${travelers.length} travel Australia-wide`
          : `Celebrants serving ${args.location}`;
      return toolResult(
        renderListing(hits, heading),
        {
          location: args.location,
          local_count: local.length,
          traveler_count: travelers.length,
          celebrants: hits.map((c) => ({ ...toSummary(c), travels: !!c._travels })),
        },
        WIDGET_LIST_URI,
      );
    }
    case "browse_by_tier": {
      const tier = String(args?.tier || "").toLowerCase();
      if (!TIER_ORDER.hasOwnProperty(tier)) {
        return toolText("Tier must be one of: luminary, endorsed, registered.", true);
      }
      const all = await loadListings(env);
      const hits = all.filter((c) => c.tier === tier);
      return toolResult(
        renderListing(hits, `${capitalize(tier)} celebrants`),
        { tier, count: hits.length, celebrants: hits.map(toSummary) },
        WIDGET_LIST_URI,
      );
    }
    case "get_celebrant_profile": {
      const slug = String(args?.slug || "").replace(/^\/+|\/+$/g, "");
      if (!slug) return toolText("A celebrant slug is required.", true);
      const md = await loadProfile(env, slug);
      if (!md) return toolText(`No celebrant found with slug "${slug}".`, true);
      const url = `https://australianweddingcelebrants.com.au/directory/${slug}/`;
      return toolResult(md, { slug, profile_markdown: md, url }, WIDGET_PROFILE_URI);
    }
    case "list_all_celebrants": {
      const all = [...(await loadListings(env))].sort(sortByTier);
      return toolResult(
        renderListing(all, "Full directory"),
        { count: all.length, celebrants: all.map(toSummary) },
        WIDGET_LIST_URI,
      );
    }
    default:
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
}

function toolText(text, isError = false) {
  return { isError, content: [{ type: "text", text }] };
}

// Richer return: text (summary) + structuredContent (machine-readable payload)
// matching the tool's outputSchema, plus a _meta pointer to the Apps SDK
// widget URI so ChatGPT renders a card instead of the raw text.
function toolResult(text, structuredContent, widgetUri) {
  const out = {
    isError: false,
    content: [{ type: "text", text }],
    structuredContent,
  };
  if (widgetUri) out._meta = { "openai/outputTemplate": widgetUri };
  return out;
}

function renderListing(celebrants, heading) {
  if (celebrants.length === 0) return `# ${heading}\n\nNo celebrants matched.`;
  const lines = [`# ${heading}`, "", `${celebrants.length} celebrant${celebrants.length === 1 ? "" : "s"}.`];
  for (const c of celebrants) {
    const travelTag = c._travels ? " _(Travels Australia-wide)_" : "";
    lines.push(
      "",
      `## ${c.name} _(${capitalize(c.tier)})_${travelTag}`,
      `Serves: ${c.locations.join(", ")}${c.australia_wide ? " · Australia-wide" : ""}${c.international ? " · International" : ""}`,
    );
    if (c.description) lines.push("", c.description);
    lines.push(`Slug: \`${c.slug}\` · ${c.url}`);
  }
  return lines.join("\n");
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC dispatcher
// ─────────────────────────────────────────────────────────────────────────────

async function handleRpc(message, env) {
  const { id, method, params } = message || {};

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        instructions:
          "Read-only MCP access to the Australian Wedding Celebrants directory. Use search_celebrants or browse_by_location to find celebrants, then get_celebrant_profile for full details. Tool responses reference ChatGPT Apps SDK UI widgets via _meta['openai/outputTemplate'].",
      });

    case "notifications/initialized":
    case "initialized":
      // Notifications have no id and no response.
      return null;

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOLS });

    case "resources/list":
      return rpcResult(id, {
        resources: Object.entries(WIDGETS).map(([uri, w]) => ({
          uri,
          name: w.name,
          title: w.title,
          description: w.description,
          mimeType: "text/html+skybridge",
        })),
      });

    case "resources/read": {
      const uri = params?.uri;
      if (!uri || !WIDGETS[uri]) {
        return rpcError(id, -32602, `Unknown resource: ${uri}`);
      }
      const w = WIDGETS[uri];
      return rpcResult(id, {
        contents: [
          {
            uri,
            mimeType: "text/html+skybridge",
            text: w.html,
          },
        ],
      });
    }

    case "tools/call": {
      const toolName = params?.name;
      const args = params?.arguments || {};
      if (!toolName) return rpcError(id, -32602, "Missing tool name");
      try {
        const result = await executeTool(toolName, args, env);
        return rpcResult(id, result);
      } catch (err) {
        return rpcError(id, -32603, `Tool execution failed: ${err.message}`);
      }
    }

    default:
      if (id == null) return null; // Unknown notification — ignore.
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hello page — humans clicking /mcp in a browser get a friendly explainer
// instead of a raw JSON server card. Inspired by:
// https://www.hybridlogic.co.uk/blog/2026/05/mcp-hello-page
// ─────────────────────────────────────────────────────────────────────────────

function renderHelloPage(request) {
  const url = new URL(request.url);
  const mcpUrl = `${url.protocol}//${url.host}/mcp`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>MCP Server · Australian Wedding Celebrants</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    background: #faf7f5;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 640px; margin: 0 auto; padding: 56px 24px 96px; }
  .eyebrow {
    display: inline-block;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #460479;
    font-weight: 600;
    margin-bottom: 12px;
  }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 16px; font-weight: 700; }
  p { margin: 0 0 16px; }
  .lede { font-size: 18px; color: #333; }
  .url-card {
    background: #fff;
    border: 1px solid #e8e0db;
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 24px 0 32px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 14px;
    word-break: break-all;
  }
  .url-card code { flex: 1; color: #460479; }
  .copy-btn {
    background: #460479;
    color: #fff;
    border: 0;
    border-radius: 6px;
    padding: 8px 14px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .copy-btn:hover { background: #5a0d96; }
  .copy-btn:active { transform: translateY(1px); }
  h2 { font-size: 18px; margin: 32px 0 12px; font-weight: 600; }
  ol, ul { padding-left: 22px; }
  li { margin-bottom: 6px; }
  details {
    border-top: 1px solid #e8e0db;
    padding: 14px 0;
  }
  details:last-of-type { border-bottom: 1px solid #e8e0db; }
  summary {
    cursor: pointer;
    font-weight: 600;
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  summary::after { content: "+"; color: #92174d; font-size: 20px; line-height: 1; }
  details[open] summary::after { content: "−"; }
  details > div { padding-top: 10px; color: #444; }
  a { color: #92174d; }
  .footer {
    margin-top: 48px;
    font-size: 13px;
    color: #666;
    border-top: 1px solid #e8e0db;
    padding-top: 20px;
  }
  kbd {
    background: #f3ede9;
    border: 1px solid #e0d6cf;
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
</head>
<body>
<main class="wrap">
  <span class="eyebrow">Model Context Protocol</span>
  <h1>You've found the Australian Wedding Celebrants MCP server.</h1>
  <p class="lede">This URL isn't meant to be opened in a browser — it's an endpoint for AI assistants like Claude and ChatGPT. Add it to your client and you'll be able to search the directory, browse celebrants by location or tier, and read full profiles, all in chat.</p>

  <div class="url-card">
    <code id="mcp-url">${mcpUrl}</code>
    <button class="copy-btn" type="button" onclick="navigator.clipboard.writeText(document.getElementById('mcp-url').textContent).then(()=>{this.textContent='Copied'; setTimeout(()=>this.textContent='Copy URL',1500)})">Copy URL</button>
  </div>

  <h2>Add it to your client</h2>

  <details>
    <summary>Claude (claude.ai / Claude Desktop)</summary>
    <div>
      <ol>
        <li>Open Settings → Connectors.</li>
        <li>Click <strong>Add custom connector</strong>.</li>
        <li>Paste the URL above and give it a name like "Australian Wedding Celebrants".</li>
      </ol>
    </div>
  </details>

  <details>
    <summary>ChatGPT</summary>
    <div>
      <ol>
        <li>Open Settings → Connectors (Apps SDK / MCP).</li>
        <li>Add a new MCP server and paste the URL above.</li>
        <li>The directory's tools surface alongside any other connectors you've added.</li>
      </ol>
    </div>
  </details>

  <details>
    <summary>Cursor / Windsurf / other editors</summary>
    <div>
      <p>Add this to your MCP config file:</p>
      <pre style="background:#f3ede9;border-radius:6px;padding:12px;overflow:auto;font-size:13px;"><code>{
  "mcpServers": {
    "australian-wedding-celebrants": {
      "url": "${mcpUrl}"
    }
  }
}</code></pre>
    </div>
  </details>

  <details>
    <summary>What can I do with it?</summary>
    <div>
      <ul>
        <li>Search celebrants by name, location, or specialty</li>
        <li>Browse by city, state, or travel-Australia-wide</li>
        <li>Filter by recognition tier (Luminary, Endorsed, Registered)</li>
        <li>Pull a celebrant's full profile — bio, awards, testimonials, contact</li>
      </ul>
      <p>It's read-only. The agent can't change anything on the directory.</p>
    </div>
  </details>

  <p class="footer">
    Looking for the human-friendly site? <a href="https://australianweddingcelebrants.com.au">australianweddingcelebrants.com.au</a><br>
    Built on the <a href="https://modelcontextprotocol.io">Model Context Protocol</a>.
  </p>
</main>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP entrypoint — called from the worker router.
// ─────────────────────────────────────────────────────────────────────────────

export async function handleMcp(request, env) {
  const cors = mcpCors();

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // GET: a real human in a browser gets a friendly hello page; an MCP client
  // probing the endpoint gets the JSON server card.
  // Heuristic: HTML wanted AND neither JSON nor SSE explicitly requested.
  if (request.method === "GET") {
    const accept = request.headers.get("Accept") || "";
    const wantsHtml = accept.includes("text/html");
    const wantsMcp = accept.includes("application/json") || accept.includes("text/event-stream");
    if (wantsHtml && !wantsMcp) {
      return new Response(renderHelloPage(request), {
        headers: { "Content-Type": "text/html; charset=utf-8", ...cors },
      });
    }
    return new Response(
      JSON.stringify({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        protocolVersion: MCP_PROTOCOL_VERSION,
        transport: "streamable-http",
        hint: "POST a JSON-RPC 2.0 message per the MCP spec. See /.well-known/mcp/server-card.json.",
      }, null, 2),
      { headers: { "Content-Type": "application/json", ...cors } },
    );
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
      { status: 400, headers: { "Content-Type": "application/json", ...cors } },
    );
  }

  // Support batched requests (array of messages).
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const msg of messages) {
    const resp = await handleRpc(msg, env);
    if (resp != null) responses.push(resp);
  }

  // If every message was a notification, return 202 with no body per spec.
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: cors });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Mcp-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...cors,
    },
  });
}
