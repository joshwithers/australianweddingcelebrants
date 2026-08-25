// Cloudflare Pages middleware: content-negotiates HTML vs Markdown.
//
// When a request carries `Accept: text/markdown` (and there's a matching .md
// variant built by Astro), serve the markdown instead of the HTML. Browsers
// don't send this header, so default behavior is unchanged for humans.
//
// Markdown variants live alongside the HTML output:
//   /                           → /index.md
//   /about/                     → /about.md
//   /directory/<slug>/         → /directory/<slug>.md

function prefersMarkdown(accept) {
  if (!accept) return false;
  return accept.toLowerCase().includes("text/markdown");
}

function toMarkdownPath(pathname) {
  if (pathname === "/" || pathname === "") return "/index.md";
  const clean = pathname.replace(/\/+$/, "");
  if (!clean || clean.endsWith(".md") || clean.includes(".")) return null;
  return `${clean}.md`;
}

function withVaryAccept(response) {
  const headers = new Headers(response.headers);
  const varyValues = (headers.get("Vary") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (
    !varyValues.some(
      (value) => value === "*" || value.toLowerCase() === "accept",
    )
  ) {
    varyValues.push("Accept");
    headers.set("Vary", varyValues.join(", "));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
    return withVaryAccept(await next());
  }

  const url = new URL(request.url);
  const mdPath = toMarkdownPath(url.pathname);
  if (!mdPath) return withVaryAccept(await next());

  const mdUrl = new URL(mdPath, url);
  const mdResponse = await next(mdUrl);

  if (!mdResponse.ok) return withVaryAccept(await next());

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
