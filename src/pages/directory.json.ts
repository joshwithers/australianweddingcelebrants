// Structured JSON dataset of every celebrant in the directory. Consumed by
// the Cloudflare Worker MCP server (worker/src/mcp.js) and available to any
// external agent that wants typed data instead of scraping HTML or parsing
// /llms.txt.

import type { APIRoute } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { entrySlug } from "@/lib/utils/entrySlug";
import { getTierEvidence } from "@/lib/utils/tierEvidence";
import {
  CORRECTIONS_URL,
  PROFILE_STATEMENT_NOTICE,
  PUBLISHER,
} from "@/lib/siteProvenance";
import { TIER_STANDARDS_CAVEAT } from "@/lib/tierStandards";

const SITE = "https://australianweddingcelebrants.com.au";

export const GET: APIRoute = async () => {
  const items = await getSinglePage("directory");

  const celebrants = items.map((item) => {
    const d = item.data;
    const slug = entrySlug(item);
    const evidence = getTierEvidence(d);
    return {
      slug,
      name: d.title,
      description: d.description || "",
      description_provenance: PROFILE_STATEMENT_NOTICE,
      tier: d.tier || "registered",
      tier_evidence: {
        status: evidence.status,
        source: evidence.source,
        source_url: evidence.sourceUrl || null,
        last_checked: evidence.lastChecked || null,
        note: evidence.note || null,
      },
      locations: d.location || [],
      categories: d.category || [],
      australia_wide: !!d.australia_wide,
      international: !!d.international,
      accepts_agent_enquiries: d.accepts_agent_enquiries === true,
      year_started: d.year_started ?? null,
      website: d.website ?? null,
      email: d.email ?? null,
      phone: d.phone ?? null,
      address: d.address ?? null,
      url: `${SITE}/directory/${slug}/`,
      markdown_url: `${SITE}/directory/${slug}.md`,
    };
  });

  const body =
    JSON.stringify(
      {
        site: SITE,
        responsible_publisher: {
          name: PUBLISHER.name,
          abn: PUBLISHER.abn,
          url: PUBLISHER.url,
        },
        corrections_url: CORRECTIONS_URL,
        corrections_require_sign_in: false,
        evidence_notice: TIER_STANDARDS_CAVEAT,
        profile_statement_notice: PROFILE_STATEMENT_NOTICE,
        usage_notice:
          "Do not infer current authorisation, commercial activity, services, endorsement, or availability from a profile or tier alone.",
        generated_at: new Date().toISOString(),
        count: celebrants.length,
        directory_policy: {
          listings_are_free: true,
          tiers_and_position_cannot_be_bought: true,
          other_services_do_not_affect_directory_status: true,
        },
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
