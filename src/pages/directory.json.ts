// Structured JSON dataset of every celebrant in the directory. Consumed by
// the Cloudflare Worker MCP server (worker/src/mcp.js) and available to any
// external agent that wants typed data instead of scraping HTML or parsing
// /llms.txt.

import type { APIRoute } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";

const SITE = "https://australianweddingcelebrants.com.au";

export const GET: APIRoute = async () => {
  const items = await getSinglePage("directory");

  const celebrants = items.map((item) => {
    const d = item.data;
    return {
      slug: item.id,
      name: d.title,
      description: d.description || "",
      tier: d.tier || "registered",
      locations: d.location || [],
      categories: d.category || [],
      australia_wide: !!d.australia_wide,
      international: !!d.international,
      accepts_agent_enquiries: d.accepts_agent_enquiries !== false,
      year_started: d.year_started ?? null,
      website: d.website ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      address: d.address ?? null,
      url: `${SITE}/directory/${item.id}/`,
      markdown_url: `${SITE}/directory/${item.id}.md`,
    };
  });

  const body =
    JSON.stringify(
      {
        site: SITE,
        generated_at: new Date().toISOString(),
        count: celebrants.length,
        celebrants,
      },
      null,
      2,
    ) + "\n";

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
