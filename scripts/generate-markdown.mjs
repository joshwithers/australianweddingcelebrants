import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeType, parse } from "node-html-parser";

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

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

function escapeLabel(text) {
  return text.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function inline(node, sourceUrl) {
  if (node.nodeType === NodeType.TEXT_NODE) return node.text.replace(/\s+/g, " ");
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";

  const tag = node.rawTagName?.toLowerCase();
  // Two adjacent element children with no text between them are layout
  // siblings (flex chips, a badge next to an image) that read as separate
  // items — give them a space. Text nodes already carry the author's spacing,
  // so pairs involving one are joined verbatim.
  let content = "";
  let previousWasElement = false;
  for (const child of node.childNodes) {
    const part = inline(child, sourceUrl);
    const isElement = child.nodeType === NodeType.ELEMENT_NODE;
    if (
      part &&
      content &&
      isElement &&
      previousWasElement &&
      /\S$/.test(content) &&
      /^\S/.test(part)
    ) {
      content += " ";
    }
    if (part) previousWasElement = isElement;
    content += part;
  }
  if (tag === "a") {
    // Stretched links (the whole-card click target on directory listings) carry
    // no text — their accessible name lives in aria-label. Without this fallback
    // every celebrant link on /directory/, /luminaries/ etc. is dropped.
    const label =
      squash(content) ||
      squash(node.getAttribute("aria-label") || node.getAttribute("title") || "");
    const href = node.getAttribute("href");
    if (!href || !label) return label;
    try {
      return `[${escapeLabel(label)}](<${new URL(href, sourceUrl).toString()}>)`;
    } catch {
      return label;
    }
  }
  if (tag === "img") {
    const src = node.getAttribute("src");
    if (!src) return "";
    const alt = escapeLabel(node.getAttribute("alt") || "");
    try {
      return `![${alt}](<${new URL(src, sourceUrl).toString()}>)`;
    } catch {
      return `![${alt}](<${src}>)`;
    }
  }
  if (tag === "strong" || tag === "b") return `**${squash(content)}**`;
  if (tag === "em" || tag === "i") return `*${squash(content)}*`;
  if (tag === "code") return `\`${squash(content).replaceAll("`", "\\`")}\``;
  if (tag === "br") return "  \n";
  if (["script", "style", "svg", "path", "button", "noscript"].includes(tag)) return "";
  return content;
}

function list(node, sourceUrl, ordered, depth = 0) {
  const items = node.childNodes.filter((child) => child.rawTagName?.toLowerCase() === "li");
  return items
    .map((item, index) => {
      const direct = item.childNodes.filter(
        (child) => !["ul", "ol"].includes(child.rawTagName?.toLowerCase()),
      );
      const firstLine = squash(direct.map((child) => inline(child, sourceUrl)).join(""));
      const nested = item.childNodes
        .filter((child) => ["ul", "ol"].includes(child.rawTagName?.toLowerCase()))
        .map((child) => list(child, sourceUrl, child.rawTagName.toLowerCase() === "ol", depth + 1))
        .join("\n");
      const prefix = ordered ? `${index + 1}.` : "-";
      return `${"  ".repeat(depth)}${prefix} ${firstLine}${nested ? `\n${nested}` : ""}`.trimEnd();
    })
    .join("\n");
}

// Elements that start a new block. Anything else (a, img, span, strong…) is
// inline and must be rendered by `inline()` so links keep their href and a
// sentence isn't split across paragraphs.
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "dialog",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main",
  "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul",
]);

function hasBlockChild(node) {
  return node.childNodes.some(
    (child) =>
      child.nodeType === NodeType.ELEMENT_NODE &&
      BLOCK_TAGS.has(child.rawTagName?.toLowerCase()),
  );
}

function blocks(node, sourceUrl) {
  if (node.nodeType === NodeType.TEXT_NODE) return squash(node.text);
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  if (node.getAttribute("aria-hidden") === "true") return "";

  const tag = node.rawTagName?.toLowerCase();
  if (["script", "style", "svg", "path", "button", "noscript"].includes(tag)) return "";
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${squash(inline(node, sourceUrl))}`;
  if (tag === "p") return squash(inline(node, sourceUrl));
  if (tag === "blockquote") {
    return squash(inline(node, sourceUrl))
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (tag === "pre") return `\`\`\`\n${node.textContent.trim()}\n\`\`\``;
  if (tag === "ul" || tag === "ol") return list(node, sourceUrl, tag === "ol");
  if (tag === "hr") return "---";
  // A container with no block-level children is a single run of inline content
  // (a <dd> holding a sentence with a link, a logo <div> wrapping an <img>, the
  // stretched <a> on a listing card). Recursing per-child here would split it
  // into separate paragraphs and strip every href.
  if (!hasBlockChild(node)) return squash(inline(node, sourceUrl));
  return node.childNodes
    .map((child) => blocks(child, sourceUrl))
    .filter(Boolean)
    .join("\n\n");
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

const sitemap = await readFile(path.join(DIST, "sitemap-0.xml"), "utf8");
const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
const entries = [];
let generated = 0;
let preserved = 0;

for (const sourceUrl of pages) {
  const html = await readFile(htmlFileFor(sourceUrl.pathname), "utf8");
  const document = parse(html);
  const title = squash(document.querySelector("title")?.textContent || sourceUrl.pathname);
  const description = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const markdownUrl = new URL(markdownPathname(sourceUrl.pathname), SITE).toString();
  const destination = markdownFileFor(sourceUrl.pathname);

  if (await exists(destination)) {
    preserved += 1;
  } else {
    document.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
    const main = document.querySelector("main") || document.querySelector("body");
    if (!main) throw new Error(`No main content found for ${sourceUrl.pathname}`);
    let body = blocks(main, sourceUrl).replace(/\n{3,}/g, "\n\n").trim();
    if (!/^#\s/m.test(body)) body = `# ${title}\n\n${body}`;
    const markdown = [
      "---",
      `title: ${JSON.stringify(title)}`,
      `description: ${JSON.stringify(description)}`,
      `source: ${JSON.stringify(sourceUrl.toString())}`,
      `markdown: ${JSON.stringify(markdownUrl)}`,
      "---",
      "",
      `[View this page as HTML](<${sourceUrl.toString()}>)`,
      "",
      body,
      "",
    ].join("\n");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, markdown, "utf8");
    generated += 1;
  }

  entries.push({ title, sourceUrl: sourceUrl.toString(), markdownUrl });
}

const llmsPath = path.join(DIST, "llms.txt");
const existingLlms = await readFile(llmsPath, "utf8");
const baseLlms = existingLlms.split(/\n## Markdown page index\n/)[0].trimEnd();
const inventory = [
  baseLlms,
  "",
  "## Markdown page index",
  "Every sitemap-listed HTML page has a direct Markdown companion.",
  "",
  ...entries.map(
    (entry) =>
      `- [${escapeLabel(entry.title)}](<${entry.markdownUrl}>) — HTML: [${entry.sourceUrl}](<${entry.sourceUrl}>)`,
  ),
  "",
].join("\n");
await writeFile(llmsPath, inventory, "utf8");

console.log(
  `Indexed ${entries.length} Markdown companions (${generated} generated, ${preserved} specialised companions preserved).`,
);
