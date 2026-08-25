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
}

for (const url of inventoryUrls) {
  if (!expectedUrls.has(url)) failures.push(`llms.txt has a non-sitemap companion: ${url}`);
}
if (inventoryUrls.size !== expectedUrls.size) {
  failures.push(`Sitemap has ${expectedUrls.size} pages but llms.txt has ${inventoryUrls.size} companions`);
}

if (failures.length > 0) throw new Error(failures.slice(0, 80).join("\n"));
console.log(`Validated ${pages.length} sitemap pages, Markdown companions, alternates, and llms.txt entries.`);
