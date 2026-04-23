// Cloudflare Pages middleware: content-negotiates HTML vs Markdown.
//
// When a request carries `Accept: text/markdown` (and there's a matching .md
// variant built by Astro), serve the markdown instead of the HTML. Browsers
// don't send this header, so default behavior is unchanged for humans.
//
// Markdown variants live alongside the HTML output:
//   /                           → /index.md
//   /directory/<slug>/          → /directory/<slug>.md
//
// Other paths fall through to HTML — extend the mapping below as more
// endpoints grow .md counterparts.

function prefersMarkdown(accept) {
  if (!accept) return false;
  return accept.toLowerCase().includes("text/markdown");
}

function toMarkdownPath(pathname) {
  if (pathname === "/" || pathname === "") return "/index.md";
  const m = pathname.match(/^\/directory\/([^/]+)\/?$/);
  if (m) return `/directory/${m[1]}.md`;
  return null;
}

export const onRequest = async (context) => {
  const { request, next } = context;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return next();
  }

  const accept = request.headers.get("accept");
  if (!prefersMarkdown(accept)) {
    // Still hint downstream caches that the response varies on Accept so a
    // cached HTML response doesn't accidentally get served to a markdown
    // client (or vice versa).
    const res = await next();
    const headers = new Headers(res.headers);
    const existingVary = headers.get("Vary");
    if (!existingVary || !existingVary.toLowerCase().includes("accept")) {
      headers.set("Vary", existingVary ? `${existingVary}, Accept` : "Accept");
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  const url = new URL(request.url);
  const mdPath = toMarkdownPath(url.pathname);
  if (!mdPath) return next();

  const mdUrl = new URL(mdPath, url);
  const mdResponse = await next(mdUrl);

  if (!mdResponse.ok) return next();

  const body = await mdResponse.text();
  const tokens = Math.ceil(body.length / 4);

  const headers = new Headers();
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  headers.set("X-Markdown-Tokens", String(tokens));
  headers.set("Vary", "Accept");
  const cc = mdResponse.headers.get("cache-control");
  if (cc) headers.set("Cache-Control", cc);

  return new Response(body, {
    status: 200,
    headers,
  });
};
