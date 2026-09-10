// A2A (Agent-to-Agent) server. JSON-RPC 2.0 at POST /a2a. Report-spam link
// handler at GET /a2a/report. Stateless — each enquiry is a one-shot task.
//
// Skills:
//   - search_celebrants   → read-only directory search (wraps the MCP shape)
//   - enquire_celebrant   → validate + rate-limit + email the celebrant via Resend
//
// See docs/a2a-spec.md (inline with the convo) for the positioning copy and
// open-question defaults.

import { loadListings, slugifyLocation, sortByTier } from "./directory.js";

const AGENT_NAME = "Australian Wedding Celebrants Directory";
const AGENT_VERSION = "1.0.0";
// Matches the A2A proto on main (a2aproject/A2A) — supportedInterfaces is
// required, protocolVersion "0.3" is the current published minor.
const PROTOCOL_VERSION = "0.3";

const DISCLAIMER =
  "Australian Wedding Celebrants operates this enquiry relay as a free service to celebrants in its directory. " +
  "There is no booking, no commission, and no contract — the enquiry is passed through and the celebrant replies directly to the couple. " +
  "The directory is not a party to any agreement or conversation that follows.";

// Rate limit windows, in seconds.
const WINDOW_SEC = 24 * 60 * 60;
const LIMIT_PER_IP = 10;
const LIMIT_PER_IP_PER_CELEBRANT = 1;
const LIMIT_PER_CELEBRANT_GLOBAL = 30;

// Spam-report thresholds.
const IP_BAN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const AGENT_BLOCK_THRESHOLD = 3;

// Enquiry log TTL — 30 days so the report-spam link keeps resolving that long.
const ENQUIRY_LOG_TTL_SEC = 30 * 24 * 60 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// CORS — A2A is open to any agent.
// ─────────────────────────────────────────────────────────────────────────────

function a2aCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent card — served inline from here (and also as a static file on the
// main site at /.well-known/agent-card.json). This is the authoritative one.
// ─────────────────────────────────────────────────────────────────────────────

function agentCard(workerUrl) {
  return {
    name: AGENT_NAME,
    version: AGENT_VERSION,
    description:
      "Australian Wedding Celebrants is a directory of Commonwealth-authorised marriage celebrants across Australia. " +
      "This agent exposes two capabilities: search_celebrants (read-only directory search) and enquire_celebrant " +
      "(relay a qualified wedding enquiry to a specific celebrant's own email address). The celebrant replies directly " +
      "to the couple; the directory is not a party to any conversation, booking, or commercial arrangement that follows. " +
      "This relay exists as a free service to celebrants in the directory — no commission, no contract, pass-through only.",
    supportedInterfaces: [
      {
        url: `${workerUrl}/a2a`,
        protocolBinding: "JSONRPC",
        protocolVersion: PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: "Australian Wedding Celebrants",
      url: "https://australianweddingcelebrants.com.au",
    },
    documentationUrl: "https://australianweddingcelebrants.com.au/ai/",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "search_celebrants",
        name: "Search celebrants",
        description:
          "Free-text search over the directory by celebrant name, location, or profile description. Returns up to 25 matches sorted Luminary → Endorsed → Registered.",
        tags: ["wedding", "celebrant", "search", "directory"],
        examples: ["Find celebrants in Hobart", "Who celebrates LGBTQIA+ weddings in Melbourne?"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "enquire_celebrant",
        name: "Enquire about a celebrant",
        description:
          "Send a qualified wedding enquiry to a specific celebrant by directory slug. The celebrant receives an email with the couple's details and replies directly to them. Minimum info required: couple names + email, wedding date, location, and at least a short description of the ceremony.",
        tags: ["wedding", "celebrant", "enquiry", "email"],
        examples: [
          "Enquire about josh-withers-ybt9 for 2027-05-14 in Hobart, 40 guests, humanist",
        ],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP entrypoint — dispatched from worker/src/index.js.
// ─────────────────────────────────────────────────────────────────────────────

export async function handleA2A(request, env) {
  const cors = a2aCors();

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const url = new URL(request.url);
  const workerUrl = env.WORKER_URL || `${url.protocol}//${url.host}`;

  if (request.method === "GET") {
    // Mirror the static agent-card.json, so either URL works.
    return new Response(JSON.stringify(agentCard(workerUrl), null, 2) + "\n", {
      headers: { "Content-Type": "application/json", ...cors },
    });
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
  } catch {
    return rpcHttp(parseError(null), 400, cors);
  }

  const response = await dispatch(body, request, env, workerUrl);
  if (!response) {
    // Notification — 202 no body per JSON-RPC convention.
    return new Response(null, { status: 202, headers: cors });
  }
  return rpcHttp(response, 200, cors);
}

function rpcHttp(payload, status, cors) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id, error: err };
}
function parseError(id) {
  return rpcError(id, -32700, "Parse error");
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function dispatch(message, request, env, workerUrl) {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  ) {
    return rpcError(null, -32600, "Invalid Request");
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const { id, method, params } = message;
  let response;

  switch (method) {
    case "agent/getAuthenticatedExtendedCard":
      response = rpcResult(id, agentCard(workerUrl));
      break;

    case "message/send":
      response = rpcResult(id, await runMessageSend(params, request, env, workerUrl));
      break;

    case "tasks/get":
      response = rpcResult(id, await getTask(params, env));
      break;

    case "ping":
      response = rpcResult(id, {});
      break;

    default:
      response = rpcError(id, -32601, `Method not found: ${method}`);
      break;
  }

  return hasId ? response : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// message/send
//
// A2A spec: params.message.parts carries user input. For our skills we accept
// two alternative shapes:
//   1. { skillId, parameters }                — direct / most convenient
//   2. { message: { parts: [{ kind:"data", data: { skillId, parameters } }] } }
//      — A2A-canonical structured-content shape
// ─────────────────────────────────────────────────────────────────────────────

async function runMessageSend(params, request, env, workerUrl) {
  const invocation = extractInvocation(params);
  if (!invocation) {
    return completedTask(null, "rejected", "Invalid request: missing skillId or parameters.");
  }

  const { skillId, parameters } = invocation;

  if (skillId === "search_celebrants") {
    return await runSearch(parameters, env);
  }
  if (skillId === "enquire_celebrant") {
    return await runEnquire(parameters, request, env, workerUrl);
  }

  return completedTask(null, "rejected", `Unknown skillId: ${skillId}`);
}

function extractInvocation(params) {
  if (!params || typeof params !== "object") return null;
  // Shape 1 — direct
  if (params.skillId && params.parameters) {
    return { skillId: params.skillId, parameters: params.parameters };
  }
  // Shape 2 — inside message.parts[].data
  const parts = params?.message?.parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (p?.kind === "data" && p.data?.skillId) {
        return { skillId: p.data.skillId, parameters: p.data.parameters || {} };
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill: search_celebrants
// ─────────────────────────────────────────────────────────────────────────────

async function runSearch(parameters, env) {
  const q = String(parameters?.query || "").toLowerCase().trim();
  if (q.length < 2) {
    return completedTask(null, "rejected", "Query must be at least 2 characters.");
  }
  const all = await loadListings(env);
  const hits = all
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.locations.some((l) => l.toLowerCase().includes(q)) ||
        c.description.toLowerCase().includes(q),
    )
    .sort(sortByTier)
    .slice(0, 25)
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      tier: c.tier,
      locations: c.locations,
      australia_wide: c.australia_wide,
      description: c.description,
      url: c.url,
    }));

  return completedTask(
    { artifactKind: "data", data: { query: parameters.query, matches: hits } },
    "completed",
    `${hits.length} celebrant${hits.length === 1 ? "" : "s"} matched "${parameters.query}".`,
    { resultCount: hits.length },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill: enquire_celebrant
// ─────────────────────────────────────────────────────────────────────────────

async function runEnquire(parameters, request, env, workerUrl) {
  // Honeypot — silently "succeed" without actually sending.
  if (parameters?._hp) {
    return completedTask(null, "completed", "Enquiry accepted.", { honeypot: true });
  }

  // Validation
  const err = validateEnquiry(parameters);
  if (err) return completedTask(null, "rejected", err);

  const ip = getClientIp(request);
  const agentName = String(parameters.agent.name).trim();

  // Check IP ban
  const banned = await env.KV.get(`a2a:banned_ip:${ip}`);
  if (banned) {
    return completedTask(null, "rejected", "This client IP is temporarily blocked due to a prior spam report.");
  }

  // Check agent block
  const blocked = await env.KV.get(`a2a:blocked_agent:${agentNameKey(agentName)}`);
  if (blocked) {
    return completedTask(null, "rejected", "This agent has been blocked from using the enquiry relay.");
  }

  // Load celebrant
  const all = await loadListings(env);
  const celebrant = all.find((c) => c.slug === parameters.celebrant_slug);
  if (!celebrant) {
    return completedTask(null, "rejected", `No celebrant with slug "${parameters.celebrant_slug}".`);
  }
  if (!celebrant.email) {
    return completedTask(null, "rejected", "That celebrant does not publish an email address; enquire via their website.");
  }
  if (celebrant.accepts_agent_enquiries !== true) {
    return completedTask(null, "rejected", "That celebrant does not accept agent-relayed enquiries.");
  }

  // Rate limits
  const rl = await checkRateLimits(env, ip, celebrant.slug);
  if (!rl.ok) {
    return completedTask(null, "rejected", rl.reason, { retry_after_seconds: WINDOW_SEC });
  }

  // Send email
  const taskId = `enq_${crypto.randomUUID()}`;
  const reportToken = crypto.randomUUID();
  const reportUrl = `${workerUrl}/a2a/report?t=${taskId}&k=${reportToken}`;

  try {
    await sendEnquiryEmail(env, {
      taskId,
      celebrant,
      parameters,
      agentName,
      reportUrl,
    });
  } catch (e) {
    console.error("Enquiry email failed:", e);
    return completedTask(null, "failed", "Email delivery failed — please retry later.");
  }

  // Log for report-spam resolution + weekly digest
  await env.KV.put(
    `a2a:enquiry:${taskId}`,
    JSON.stringify({
      task_id: taskId,
      celebrant_slug: celebrant.slug,
      celebrant_name: celebrant.name,
      ip,
      agent_name: agentName,
      couple_email: parameters.couple.email,
      wedding_date: parameters.wedding.date,
      wedding_location: parameters.wedding.location,
      report_token: reportToken,
      sent_at: new Date().toISOString(),
    }),
    { expirationTtl: ENQUIRY_LOG_TTL_SEC },
  );

  // Increment rate-limit counters
  await incrementCounters(env, ip, celebrant.slug);

  return completedTask(
    {
      artifactKind: "data",
      data: {
        relayedTo: { slug: celebrant.slug, name: celebrant.name, url: celebrant.url },
      },
    },
    "completed",
    `Enquiry relayed to ${celebrant.name}. They'll reply directly to ${parameters.couple.email}.`,
    { taskId, relayedTo: celebrant.slug },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Enquiry validation
// ─────────────────────────────────────────────────────────────────────────────

export function validateEnquiry(p) {
  if (!p || typeof p !== "object") return "Missing parameters.";
  if (!p.celebrant_slug || typeof p.celebrant_slug !== "string") return "celebrant_slug is required.";
  if (p.celebrant_slug.length > 120) return "celebrant_slug must be 120 characters or fewer.";
  if (!p.couple || typeof p.couple !== "object") return "couple object is required.";
  if (!p.couple.names || String(p.couple.names).trim().length < 3) {
    return "couple.names must be at least 3 characters.";
  }
  if (String(p.couple.names).length > 200) return "couple.names must be 200 characters or fewer.";
  if (!p.couple.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.couple.email)) {
    return "couple.email must be a valid email address.";
  }
  if (String(p.couple.email).length > 254) return "couple.email must be 254 characters or fewer.";
  if (!p.wedding || typeof p.wedding !== "object") return "wedding object is required.";
  if (!isRealIsoDate(p.wedding.date)) {
    return "wedding.date must be ISO-8601 (YYYY-MM-DD).";
  }
  if (!p.wedding.location || String(p.wedding.location).trim().length < 2) {
    return "wedding.location is required.";
  }
  if (String(p.wedding.location).length > 200) return "wedding.location must be 200 characters or fewer.";
  if (p.wedding.style && String(p.wedding.style).length > 200) {
    return "wedding.style must be 200 characters or fewer.";
  }
  const notes = String(p.wedding.notes || "").trim();
  if (notes.length < 30) {
    return "wedding.notes must be at least 30 characters — tell the celebrant about the couple, ceremony style, and any specifics.";
  }
  if (notes.length > 5000) return "wedding.notes must be 5000 characters or fewer.";
  if (!p.agent || typeof p.agent !== "object") return "agent object is required.";
  if (!p.agent.name || String(p.agent.name).trim().length < 2) {
    return "agent.name is required (identify yourself, e.g. 'Acme Wedding Planner v1.2').";
  }
  if (String(p.agent.name).length > 120) return "agent.name must be 120 characters or fewer.";
  if (p.agent.contact_url) {
    const contactUrl = String(p.agent.contact_url);
    if (contactUrl.length > 2048 || !isHttpUrl(contactUrl)) {
      return "agent.contact_url must be a valid HTTP or HTTPS URL.";
    }
  }
  return null;
}

function isRealIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limits (KV counters, 24h TTL)
// ─────────────────────────────────────────────────────────────────────────────

async function checkRateLimits(env, ip, slug) {
  const [ipCount, pairCount, celebrantCount] = await Promise.all([
    kvCount(env, `a2a:rl:ip:${ip}`),
    kvCount(env, `a2a:rl:ip_celebrant:${ip}:${slug}`),
    kvCount(env, `a2a:rl:celebrant:${slug}`),
  ]);

  if (pairCount >= LIMIT_PER_IP_PER_CELEBRANT) {
    return { ok: false, reason: "You've already enquired about this celebrant in the last 24 hours." };
  }
  if (ipCount >= LIMIT_PER_IP) {
    return { ok: false, reason: `Rate limit: ${LIMIT_PER_IP} enquiries per day per client.` };
  }
  if (celebrantCount >= LIMIT_PER_CELEBRANT_GLOBAL) {
    return { ok: false, reason: "This celebrant has received the maximum enquiries for today — try again tomorrow." };
  }
  return { ok: true };
}

async function incrementCounters(env, ip, slug) {
  await Promise.all([
    kvIncrement(env, `a2a:rl:ip:${ip}`, WINDOW_SEC),
    kvIncrement(env, `a2a:rl:ip_celebrant:${ip}:${slug}`, WINDOW_SEC),
    kvIncrement(env, `a2a:rl:celebrant:${slug}`, WINDOW_SEC),
  ]);
}

async function kvCount(env, key) {
  const raw = await env.KV.get(key);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

async function kvIncrement(env, key, ttl) {
  const current = await kvCount(env, key);
  await env.KV.put(key, String(current + 1), { expirationTtl: ttl });
}

// ─────────────────────────────────────────────────────────────────────────────
// Email template
// ─────────────────────────────────────────────────────────────────────────────

async function sendEnquiryEmail(env, { taskId, celebrant, parameters, agentName, reportUrl }) {
  const fromEmail = env.ENQUIRIES_FROM_EMAIL || env.FROM_EMAIL;
  const subject = `Wedding enquiry from ${parameters.couple.names} — ${parameters.wedding.date}, ${parameters.wedding.location} (relayed by ${agentName})`;
  const html = renderEnquiryEmail({ celebrant, parameters, agentName, reportUrl, taskId });

  await postResend(env, {
    from: `Australian Wedding Celebrants <${fromEmail}>`,
    to: [celebrant.email],
    reply_to: [parameters.couple.email],
    subject,
    html,
    tags: [
      { name: "source", value: "a2a-enquiry" },
      { name: "task_id", value: taskId.replace(/[^a-zA-Z0-9_]/g, "") },
    ],
  });
}

async function postResend(env, payload) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = (await response.text()).slice(0, 1000);
    throw new Error(`Resend ${response.status}: ${errorBody}`);
  }
}

function renderEnquiryEmail({ celebrant, parameters, agentName, reportUrl }) {
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const firstName = celebrant.name.split(/\s+/)[0];

  return `<!doctype html>
<html>
<body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.55; color: #222; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p>Hi ${esc(firstName)},</p>

  <p>A couple planning their wedding asked their AI assistant to get in touch with you. They found your profile through your listing on <strong>Australian Wedding Celebrants</strong> and asked the assistant to reach out on their behalf.</p>

  <h3 style="margin: 28px 0 10px; font-size: 16px;">About this enquiry</h3>
  <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
    <tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">Couple</td><td style="padding: 4px 0;">${esc(parameters.couple.names)}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">Reply to</td><td style="padding: 4px 0;"><a href="mailto:${esc(parameters.couple.email)}">${esc(parameters.couple.email)}</a></td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">Wedding date</td><td style="padding: 4px 0;">${esc(parameters.wedding.date)}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">Location</td><td style="padding: 4px 0;">${esc(parameters.wedding.location)}</td></tr>
    ${parameters.wedding.style ? `<tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">Style</td><td style="padding: 4px 0;">${esc(parameters.wedding.style)}</td></tr>` : ""}
    <tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">Notes</td><td style="padding: 4px 0; white-space: pre-wrap;">${esc(parameters.wedding.notes)}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">Relayed by</td><td style="padding: 4px 0;">${esc(agentName)}${parameters.agent.contact_url ? ` · <a href="${esc(parameters.agent.contact_url)}">${esc(parameters.agent.contact_url)}</a>` : ""}</td></tr>
  </table>

  <p style="margin-top: 28px;"><strong>Reply straight to this email</strong> — it goes directly to ${esc(parameters.couple.email)}. You're now in a normal conversation with the couple; we're not in the loop.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />

  <h3 style="margin: 0 0 10px; font-size: 15px; color: #333;">About this service</h3>
  <p style="color: #555; font-size: 14px;">We (Australian Wedding Celebrants) run this enquiry relay as a free benefit for celebrants in our directory. There's no booking platform, no commission, no contract — we just pass qualified enquiries along so your public profile continues to earn its keep. You can stop receiving agent-relayed enquiries any time via your listing's edit page.</p>

  <p style="color: #555; font-size: 14px;">— Josh, Australian Wedding Celebrants</p>

  <p style="margin-top: 32px; font-size: 13px; color: #888;">
    ⚠️ <a href="${esc(reportUrl)}" style="color: #999;">Report this as spam</a> — flags the agent and temporarily blocks the sender.
  </p>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// tasks/get — look up a past enquiry/task in KV
// ─────────────────────────────────────────────────────────────────────────────

async function getTask(params, env) {
  const taskId = params?.id || params?.taskId;
  if (!taskId) return completedTask(null, "rejected", "id is required.");
  const raw = await env.KV.get(`a2a:enquiry:${taskId}`);
  if (!raw) return completedTask(null, "rejected", `No task found for ${taskId}.`);
  const log = JSON.parse(raw);
  return completedTask(
    { artifactKind: "data", data: { task_id: log.task_id, celebrant_slug: log.celebrant_slug } },
    "completed",
    `Task ${taskId} was completed at ${log.sent_at}.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task constructor — A2A-flavoured Task object
// ─────────────────────────────────────────────────────────────────────────────

function completedTask(artifact, state, statusMessage, metadata) {
  const timestamp = new Date().toISOString();
  const task = {
    id: metadata?.taskId || `tsk_${crypto.randomUUID()}`,
    contextId: `ctx_${crypto.randomUUID()}`,
    kind: "task",
    status: { state, timestamp },
    artifacts: [],
    metadata: {
      disclaimer: DISCLAIMER,
      ...(metadata || {}),
    },
  };
  if (statusMessage) task.status.message = statusMessage;
  if (artifact) {
    task.artifacts.push({
      artifactId: `art_${crypto.randomUUID()}`,
      parts: [
        artifact.artifactKind === "data"
          ? { kind: "data", data: artifact.data }
          : { kind: "text", text: artifact.text || "" },
      ],
    });
  }
  return task;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

function agentNameKey(name) {
  return encodeURIComponent(String(name).toLowerCase().trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// Report-spam endpoint (GET /a2a/report?t=<taskId>&k=<token>)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleA2AReport(request, env) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get("t") || "";
  const token = url.searchParams.get("k") || "";

  if (!taskId || !token) return htmlPage("Invalid report link", "This report link is malformed or incomplete.");

  const raw = await env.KV.get(`a2a:enquiry:${taskId}`);
  if (!raw) {
    return htmlPage(
      "Link expired",
      "This enquiry log has expired (we keep them for 30 days). If you're still seeing spam, email the admin directly.",
    );
  }

  const log = JSON.parse(raw);
  if (log.report_token !== token) {
    return htmlPage("Invalid token", "This report token doesn't match. Ignore this page if you didn't trigger it.");
  }
  if (log.reported_at) {
    return htmlPage("Already reported", "This enquiry has already been flagged. Thanks — we've logged it.");
  }

  // Ban the IP for 30 days
  await env.KV.put(`a2a:banned_ip:${log.ip}`, "1", { expirationTtl: IP_BAN_TTL_SEC });

  // Increment per-agent report counter; block permanently if over threshold
  const agentKey = `a2a:agent_reports:${agentNameKey(log.agent_name)}`;
  const current = await kvCount(env, agentKey);
  const next = current + 1;
  await env.KV.put(agentKey, String(next), { expirationTtl: 90 * 24 * 60 * 60 });
  let blocked = false;
  if (next >= AGENT_BLOCK_THRESHOLD) {
    await env.KV.put(`a2a:blocked_agent:${agentNameKey(log.agent_name)}`, "1"); // permanent
    blocked = true;
  }

  // Mark this enquiry as reported so the same link can't double-count
  log.reported_at = new Date().toISOString();
  await env.KV.put(`a2a:enquiry:${taskId}`, JSON.stringify(log), { expirationTtl: ENQUIRY_LOG_TTL_SEC });

  // Notify admin
  try {
    await sendAdminReport(env, { log, blocked, reportCount: next });
  } catch (e) {
    console.error("Admin notify on spam report failed:", e);
  }

  return htmlPage(
    "Thanks — reported",
    `<p>We've blocked the sender's IP for 30 days and logged this against <strong>${escHtml(log.agent_name)}</strong> (report ${next} of ${AGENT_BLOCK_THRESHOLD}).${blocked ? ` This agent has now been blocked from the enquiry relay permanently.` : ""}</p><p>Thanks for keeping the directory clean.</p>`,
  );
}

async function sendAdminReport(env, { log, blocked, reportCount }) {
  const subject = blocked
    ? `[A2A] Agent blocked: ${log.agent_name}`
    : `[A2A] Spam report received (${reportCount}/${AGENT_BLOCK_THRESHOLD})`;
  const html = `
    <p>A celebrant clicked "Report spam" on an A2A enquiry.</p>
    <ul>
      <li><strong>Celebrant:</strong> ${escHtml(log.celebrant_name)} (${escHtml(log.celebrant_slug)})</li>
      <li><strong>Couple email:</strong> ${escHtml(log.couple_email)}</li>
      <li><strong>Agent:</strong> ${escHtml(log.agent_name)} — now ${reportCount}/${AGENT_BLOCK_THRESHOLD} reports</li>
      <li><strong>IP:</strong> ${escHtml(log.ip)} — banned 30 days</li>
      <li><strong>Task:</strong> ${escHtml(log.task_id)}</li>
      <li><strong>Sent:</strong> ${escHtml(log.sent_at)}</li>
    </ul>
    ${blocked ? `<p><strong>Agent has exceeded the block threshold and is now permanently denied.</strong></p>` : ""}
  `;
  await postResend(env, {
    from: `Australian Wedding Celebrants <${env.FROM_EMAIL}>`,
    to: [env.ADMIN_EMAIL],
    subject,
    html,
  });
}

function htmlPage(title, bodyHtml) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:48px 20px;line-height:1.55;color:#222}
h1{font-size:22px;margin:0 0 16px}
a{color:#460479}
</style></head><body>
<h1>${escHtml(title)}</h1>
${bodyHtml.startsWith("<") ? bodyHtml : `<p>${escHtml(bodyHtml)}</p>`}
<p style="margin-top:32px"><a href="https://australianweddingcelebrants.com.au">Australian Wedding Celebrants</a></p>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly digest — called from the scheduled handler in index.js
// ─────────────────────────────────────────────────────────────────────────────

export async function sendWeeklyEnquiryDigest(env) {
  // Scan KV for enquiry logs from the last 7 days.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const list = await env.KV.list({ prefix: "a2a:enquiry:" });
  const recent = [];
  for (const key of list.keys) {
    const raw = await env.KV.get(key.name);
    if (!raw) continue;
    const log = JSON.parse(raw);
    if (new Date(log.sent_at).getTime() >= sevenDaysAgo) recent.push(log);
  }

  if (recent.length === 0) return; // nothing to report

  const byCelebrant = new Map();
  const byAgent = new Map();
  let reports = 0;
  for (const log of recent) {
    byCelebrant.set(log.celebrant_slug, (byCelebrant.get(log.celebrant_slug) || 0) + 1);
    byAgent.set(log.agent_name, (byAgent.get(log.agent_name) || 0) + 1);
    if (log.reported_at) reports += 1;
  }

  const celebrantRows = [...byCelebrant.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, n]) => `<li>${escHtml(slug)} — ${n}</li>`)
    .join("");
  const agentRows = [...byAgent.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `<li>${escHtml(name)} — ${n}</li>`)
    .join("");

  const html = `
    <h2>A2A enquiry digest — ${recent.length} relayed this week</h2>
    ${reports > 0 ? `<p><strong>${reports} spam report${reports === 1 ? "" : "s"}</strong> received.</p>` : ""}
    <h3>By celebrant</h3>
    <ul>${celebrantRows}</ul>
    <h3>By relaying agent</h3>
    <ul>${agentRows}</ul>
  `;

  await postResend(env, {
    from: `Australian Wedding Celebrants <${env.FROM_EMAIL}>`,
    to: [env.ADMIN_EMAIL],
    subject: `[A2A] Weekly enquiry digest — ${recent.length} relayed`,
    html,
  });
}
