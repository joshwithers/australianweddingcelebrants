import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { entrySlug } from "@/lib/utils/entrySlug";
import { CORRECTIONS_URL, PUBLISHER } from "@/lib/siteProvenance";
import {
  TIER_CREDENTIAL_PROVENANCE,
  TIER_CREDENTIAL_ISSUER,
  TIER_STANDARDS_LAST_CHECKED,
  TIER_STANDARDS_SOURCES,
} from "@/lib/tierStandards";

const SITE = "https://australianweddingcelebrants.com.au";

function markdownLink(label: string, url: string): string {
  const safeLabel = label.replace(/([\\[\]])/g, "\\$1");
  return `[${safeLabel}](${url})`;
}

export const GET: APIRoute = async () => {
  const allCelebrants = await getCollection(
    "directory",
    // Mirrors getSinglePage(): drafts out, and `-`-prefixed scaffolding files
    // (e.g. -template.md) are never real listings.
    (entry) => !entry.data.draft && !entry.id.startsWith("-"),
  );

  const tierOrder = { luminary: 0, endorsed: 1, registered: 2 };
  const sorted = [...allCelebrants].sort((a, b) => {
    const ta = tierOrder[a.data.tier || "registered"] ?? 2;
    const tb = tierOrder[b.data.tier || "registered"] ?? 2;
    if (ta !== tb) return ta - tb;
    return a.data.title.localeCompare(b.data.title);
  });

  const luminaries = sorted.filter((c) => c.data.tier === "luminary");
  const endorsed = sorted.filter((c) => c.data.tier === "endorsed");
  const registered = sorted.filter(
    (c) => (c.data.tier || "registered") === "registered",
  );

  const allLocations = [
    ...new Set(allCelebrants.flatMap((c) => c.data.location)),
  ].sort();

  const text = `# Australian Wedding Celebrants
> Australia's quality-rated directory of professional wedding celebrants

## About
Australian Wedding Celebrants is a directory of wedding celebrant profiles across Australia. ${TIER_CREDENTIAL_PROVENANCE}

Listings are free. Inclusion, endorsement, tier, search visibility and directory position cannot be purchased. Using or buying any other Josh Withers service has no effect on directory status.

## Publisher, provenance and corrections
Responsible publisher: ${PUBLISHER.name} (ABN ${PUBLISHER.abn}). Australian Wedding Celebrants publishes the member profiles and issues the displayed credentials.

Anyone can ${markdownLink("request a correction or profile update", CORRECTIONS_URL)} without signing in.

Credential issuer and source: ${markdownLink(TIER_CREDENTIAL_ISSUER.name, TIER_CREDENTIAL_ISSUER.url)}. When a separate claim depends on published external evidence, its source and last-checked date are shown with that claim.

The legal-registration, qualification, and compulsory professional-development parts of the standards were last checked on ${TIER_STANDARDS_LAST_CHECKED}: ${TIER_STANDARDS_SOURCES.map((source) => markdownLink(source.name, source.url)).join("; ")}.

## The Three Tiers

### Luminary (${luminaries.length} celebrants)
The highest directory credential. It is issued after human verification against a published standard that includes 7+ years registered or practising, reviews from couples and wedding vendors, industry recognition, ongoing professional development, and a maintained professional digital presence.

### Endorsed (${endorsed.length} celebrants)
The middle directory credential. It is issued after human verification against a published standard that includes 3+ years registered, professional indemnity insurance, additional professional development, reviews from couples and wedding vendors, and evidence of 100+ ceremonies.

### Registered (${registered.length} celebrants)
The foundation directory credential. It is issued after human verification against a standard requiring Commonwealth authorisation, a Certificate IV in Celebrancy or equivalent qualification, and a complete directory profile.

## Why Tiers Matter for Couples
A tier badge records a credential issued and human verified by Australian Wedding Celebrants against its published standard.

## Directory Summary
- Total celebrants: ${allCelebrants.length}
- Luminary: ${luminaries.length}
- Endorsed: ${endorsed.length}
- Registered: ${registered.length}
- Locations served: ${allLocations.join(", ")}

## Key Pages
- ${markdownLink("Directory", `${SITE}/directory/`)}
- ${markdownLink("Our Standards", `${SITE}/tiers/`)}
- ${markdownLink("Luminary Celebrants", `${SITE}/luminaries/`)}
- ${markdownLink("Endorsed Celebrants", `${SITE}/endorsed/`)}
- ${markdownLink("Registered Celebrants", `${SITE}/registered/`)}
- ${markdownLink("Submit Listing", `${SITE}/contact/`)}
- ${markdownLink("About", `${SITE}/about/`)}
- ${markdownLink("Corrections and profile updates", CORRECTIONS_URL)}
- ${markdownLink("Optional tools for celebrants", `${SITE}/tools-for-celebrants/`)}
- ${markdownLink("Authentication and anonymous access", `${SITE}/auth.md`)}
- ${markdownLink("Full LLM context", `${SITE}/llms-full.txt`)}

## Luminary Celebrants
${luminaries.map((c) => `- ${markdownLink(c.data.title, `${SITE}/directory/${entrySlug(c)}/`)}: regions ${c.data.location.join(", ")} — ${c.data.description || ""}`).join("\n")}

## Endorsed Celebrants
${endorsed.length > 0 ? endorsed.map((c) => `- ${markdownLink(c.data.title, `${SITE}/directory/${entrySlug(c)}/`)}: regions ${c.data.location.join(", ")} — ${c.data.description || ""}`).join("\n") : "None yet — celebrants can submit documentation to earn this tier."}

## Registered Celebrants
${registered.map((c) => `- ${markdownLink(c.data.title, `${SITE}/directory/${entrySlug(c)}/`)}: regions ${c.data.location.join(", ")}`).join("\n")}
`;

  return new Response(text.trim(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
