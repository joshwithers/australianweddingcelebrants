import type { APIRoute } from "astro";
import {
  EDITORIAL_ARTICLES,
  resolveEditorialAuthor,
  type EditorialArticle,
} from "@/lib/editorial";
import { SITE_URL } from "@/lib/siteProvenance";

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const GET: APIRoute = () => {
  const items = Object.values(EDITORIAL_ARTICLES)
    .sort((a, b) => b.datePublished.localeCompare(a.datePublished))
    .map((article) => {
      const author = resolveEditorialAuthor((article as EditorialArticle).author);
      const link = `${SITE_URL}${article.path}`;
      return `    <item>
      <title>${xml(article.title)}</title>
      <description>${xml(article.description)}</description>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <pubDate>${new Date(`${article.datePublished}T00:00:00+10:00`).toUTCString()}</pubDate>
      <dc:creator>${xml(author.name)}</dc:creator>
    </item>`;
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Australian Wedding Celebrants editorial</title>
    <link>${SITE_URL}/</link>
    <description>Original guides and editorial resources from Australian Wedding Celebrants.</description>
    <language>en-au</language>
${items}
  </channel>
</rss>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
