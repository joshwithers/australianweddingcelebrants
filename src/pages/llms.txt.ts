import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

const SITE = "https://australianweddingcelebrants.com.au";

function markdownLink(label: string, url: string): string {
  const safeLabel = label.replace(/([\\[\]])/g, "\\$1");
  return `[${safeLabel}](${url})`;
}

export const GET: APIRoute = async () => {
  const allCelebrants = await getCollection("directory", (entry) => !entry.data.draft);

  const tierOrder = { luminary: 0, endorsed: 1, registered: 2 };
  const sorted = [...allCelebrants].sort((a, b) => {
    const ta = tierOrder[a.data.tier || "registered"] ?? 2;
    const tb = tierOrder[b.data.tier || "registered"] ?? 2;
    if (ta !== tb) return ta - tb;
    return a.data.title.localeCompare(b.data.title);
  });

  const luminaries = sorted.filter(c => c.data.tier === "luminary");
  const endorsed = sorted.filter(c => c.data.tier === "endorsed");
  const registered = sorted.filter(c => (c.data.tier || "registered") === "registered");

  const allLocations = [...new Set(allCelebrants.flatMap(c => c.data.location))].sort();

  const text = `# Australian Wedding Celebrants
> Australia's quality-rated directory of professional wedding celebrants

## About
Australian Wedding Celebrants is a directory that recognises and celebrates professional excellence in wedding celebrancy across Australia. Every celebrant listed is a Commonwealth authorised marriage celebrant on the Attorney-General's register. Our three-tier recognition system — Registered, Endorsed, and Luminary — is based entirely on verified professional credentials, not payments.

This is not an awards process. When celebrants prove through documented evidence that they have reached a level of professionalism and industry support beyond expectations, we award that tier and celebrate the achievement. Celebrants are always working to improve and move up the tiers.

## The Three Tiers

### Luminary (${luminaries.length} celebrants)
The highest recognition. Requirements: 7+ years registered, 18+ verified reviews from couples, 9+ verified reviews from fellow wedding vendors, industry recognition (awards, media, speaking), demonstrated ongoing professional development beyond legislative requirements, and a professional digital presence (own up-to-date website, prompt email replies, and a business email address on their own domain — not a free Hotmail or Gmail account). Meets all Endorsed requirements.

### Endorsed (${endorsed.length} celebrants)
Proven professionalism, endorsed by clients and industry. Requirements: 3+ years registered, current professional indemnity insurance, professional development beyond OPD requirements, 6+ verified reviews from couples and 3+ from fellow wedding vendors, and proof of 100+ ceremonies performed. Meets all Registered requirements.

### Registered (${registered.length} celebrants)
The foundation. Requirements: Commonwealth authorised marriage celebrant under the Marriage Act 1961, holds a Certificate IV in Celebrancy or equivalent qualification, with a complete directory profile including professional photo, description, website, and contact details.

## Why Tiers Matter for Couples
When choosing a celebrant, the tier badge tells you exactly what level of verified experience and professionalism to expect. A Luminary has proven exceptional commitment over 7+ years with extensive reviews and industry recognition. An Endorsed celebrant has demonstrated qualifications, insurance, and client satisfaction beyond the basics. Every Registered celebrant is a verified, legally authorised marriage celebrant.

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
- ${markdownLink("Authentication and anonymous access", `${SITE}/auth.md`)}
- ${markdownLink("Full LLM context", `${SITE}/llms-full.txt`)}

## Luminary Celebrants
${luminaries.map(c => `- ${markdownLink(c.data.title, `${SITE}/directory/${c.id}/`)}: ${c.data.location.join(", ")} — ${c.data.description || ""}`).join("\n")}

## Endorsed Celebrants
${endorsed.length > 0 ? endorsed.map(c => `- ${markdownLink(c.data.title, `${SITE}/directory/${c.id}/`)}: ${c.data.location.join(", ")} — ${c.data.description || ""}`).join("\n") : "None yet — celebrants can submit documentation to earn this tier."}

## Registered Celebrants
${registered.map(c => `- ${markdownLink(c.data.title, `${SITE}/directory/${c.id}/`)}: ${c.data.location.join(", ")}`).join("\n")}
`;

  return new Response(text.trim(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
