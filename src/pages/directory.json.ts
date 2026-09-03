// Structured JSON dataset of every celebrant in the directory. Consumed by
// the Cloudflare Worker MCP server (worker/src/mcp.js) and available to any
// external agent that wants typed data instead of scraping HTML or parsing
// /llms.txt.

import type { APIRoute } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { entrySlug } from "@/lib/utils/entrySlug";
import { getTierCredential } from "@/lib/utils/tierCredential";
import { CORRECTIONS_URL, PUBLISHER } from "@/lib/siteProvenance";
import { TIER_CREDENTIAL_PROVENANCE } from "@/lib/tierStandards";

const SITE = "https://australianweddingcelebrants.com.au";

export const GET: APIRoute = async () => {
  const items = await getSinglePage("directory");

  const celebrants = items.map((item) => {
    const d = item.data;
    const slug = entrySlug(item);
    const credential = getTierCredential(d);
    return {
      slug,
      name: d.title,
      description: d.description || "",
      description_provenance: {
        publisher: PUBLISHER.name,
        publisher_url: PUBLISHER.url,
        corrections_url: CORRECTIONS_URL,
      },
      tier: d.tier || "registered",
      tier_credential: {
        status: credential.status,
        issuer: credential.issuer,
        issuer_url: credential.issuerUrl,
        verification: credential.verificationMethod,
      },
      supporting_external_evidence: credential.supportingEvidence
        ? {
            status: credential.supportingEvidence.status,
            source: credential.supportingEvidence.source,
            source_url: credential.supportingEvidence.sourceUrl || null,
            last_checked: credential.supportingEvidence.lastChecked || null,
            note: credential.supportingEvidence.note || null,
          }
        : null,
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
        credential_provenance: TIER_CREDENTIAL_PROVENANCE,
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
