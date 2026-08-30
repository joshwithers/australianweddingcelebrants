import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "node-html-parser";

const DIST = path.resolve(process.cwd(), process.env.BUILD_OUT_DIR || "dist");
const SITE = (process.env.PUBLIC_SITE_URL || "https://australianweddingcelebrants.com.au").replace(/\/+$/, "");

function cleanPathname(pathname) {
  return pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
}

function markdownPathname(pathname) {
  const clean = cleanPathname(pathname);
  return clean === "/" ? "/index.md" : `${clean}.md`;
}

function htmlFileFor(pathname) {
  const clean = cleanPathname(pathname);
  return clean === "/"
    ? path.join(DIST, "index.html")
    : path.join(DIST, clean.slice(1), "index.html");
}

function markdownFileFor(pathname) {
  return path.join(DIST, markdownPathname(pathname).slice(1));
}

const sitemap = await readFile(path.join(DIST, "sitemap-0.xml"), "utf8");
const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
const llms = await readFile(path.join(DIST, "llms.txt"), "utf8");
const inventory = llms.split(/\n## Markdown page index\n/)[1] || "";
const inventoryUrls = new Set(
  [...inventory.matchAll(/https:\/\/[^\s<>)]+\.md/g)].map((match) => match[0]),
);
const expectedUrls = new Set(pages.map((url) => new URL(markdownPathname(url.pathname), SITE).toString()));
const failures = [];

for (const sourceUrl of pages) {
  const markdownPath = markdownFileFor(sourceUrl.pathname);
  try {
    await access(markdownPath);
  } catch {
    failures.push(`Missing Markdown companion: ${markdownPath}`);
    continue;
  }

  const [html, markdown] = await Promise.all([
    readFile(htmlFileFor(sourceUrl.pathname), "utf8"),
    readFile(markdownPath, "utf8"),
  ]);
  const document = parse(html);
  const htmlAuthor = document.querySelector('meta[name="author"]')?.getAttribute("content")?.trim() || "";
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const alternate = document
    .querySelector('link[rel="alternate"][type="text/markdown"]')
    ?.getAttribute("href");
  const expectedMarkdownUrl = new URL(markdownPathname(sourceUrl.pathname), SITE).toString();
  if (canonical !== sourceUrl.toString()) {
    failures.push(`Incorrect canonical for ${sourceUrl.pathname}: ${canonical}`);
  }
  if (alternate !== expectedMarkdownUrl) {
    failures.push(`Incorrect Markdown alternate for ${sourceUrl.pathname}: ${alternate}`);
  }
  if (!inventoryUrls.has(expectedMarkdownUrl)) {
    failures.push(`llms.txt does not reference ${expectedMarkdownUrl}`);
  }
  if (markdown.trim().length < 100) {
    failures.push(`Markdown companion is unexpectedly short: ${markdownPath}`);
  }

  if (markdown.includes("[View this page as HTML](<")) {
    const markdownAuthor = markdown.match(/^author:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim() || "";
    if (markdownAuthor !== htmlAuthor) {
      failures.push(
        `Author mismatch for ${sourceUrl.pathname}: HTML=${JSON.stringify(htmlAuthor)}, Markdown=${JSON.stringify(markdownAuthor)}`,
      );
    }
    if (htmlAuthor && !markdown.includes(`By [${htmlAuthor}]`)) {
      failures.push(`Markdown companion omits visible byline for ${sourceUrl.pathname}`);
    }
  }

  // Companions generated from HTML must carry every celebrant link the page
  // shows. Listing cards use a stretched <a> with no text and swap the name for
  // a logo on premium tiers, so a naive HTML→Markdown pass silently drops both
  // the name and the URL — /luminaries.md once listed ten celebrants without
  // naming or linking one. The curated companions (index.md.ts,
  // [single].md.ts) are hand-written summaries and are exempt; only generated
  // files carry the "View this page as HTML" preamble.
  if (markdown.includes("[View this page as HTML](<")) {
    const document = parse(html);
    document.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
    const main = document.querySelector("main");
    const profileLinks = new Set(
      (main?.querySelectorAll("a") ?? [])
        .map((anchor) => anchor.getAttribute("href"))
        .filter((href) => href?.startsWith("/directory/") && href !== "/directory/"),
    );
    const dropped = [...profileLinks].filter(
      (href) => !markdown.includes(`${new URL(href, SITE).toString()}>`),
    );
    if (dropped.length > 0) {
      failures.push(
        `${markdownPath} drops ${dropped.length}/${profileLinks.size} celebrant links (e.g. ${dropped[0]})`,
      );
    }
  }
}

for (const url of inventoryUrls) {
  if (!expectedUrls.has(url)) failures.push(`llms.txt has a non-sitemap companion: ${url}`);
}
if (inventoryUrls.size !== expectedUrls.size) {
  failures.push(`Sitemap has ${expectedUrls.size} pages but llms.txt has ${inventoryUrls.size} companions`);
}

if (failures.length > 0) throw new Error(failures.slice(0, 80).join("\n"));
console.log(`Validated ${pages.length} sitemap pages, Markdown companions, alternates, and llms.txt entries.`);
