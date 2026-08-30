import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { entrySlug } from "@/lib/utils/entrySlug";
import { CORRECTIONS_URL, PUBLISHER } from "@/lib/siteProvenance";
import {
  TIER_STANDARDS_CAVEAT,
  TIER_STANDARDS_LAST_CHECKED,
  TIER_STANDARDS_SOURCES,
} from "@/lib/tierStandards";
import { getTierEvidence } from "@/lib/utils/tierEvidence";

function stripMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/\*([^*]+)\*/g, "$1") // *italic* → italic
    .replace(/^#+\s+/gm, "") // headings
    .replace(/^\s*[-*]\s+/gm, "- ") // normalize lists
    .trim();
}

function humanize(str: string): string {
  return str.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

  // Build location index: which celebrants serve each location, grouped by tier
  const locationIndex: Record<
    string,
    { luminary: string[]; endorsed: string[]; registered: string[] }
  > = {};
  for (const loc of allLocations) {
    locationIndex[loc] = { luminary: [], endorsed: [], registered: [] };
  }
  for (const c of allCelebrants) {
    const tier = c.data.tier || "registered";
    for (const loc of c.data.location) {
      if (locationIndex[loc]) {
        locationIndex[loc][
          tier as keyof (typeof locationIndex)[typeof loc]
        ].push(c.data.title);
      }
    }
  }

  function celebrantBlock(c: any): string {
    const tier = c.data.tier || "registered";
    const tierLabel =
      tier === "luminary"
        ? "LUMINARY"
        : tier === "endorsed"
          ? "ENDORSED"
          : "REGISTERED";
    const lines: string[] = [];
    const evidence = getTierEvidence(c.data);

    lines.push(`### ${c.data.title} [${tierLabel}]`);
    lines.push(
      `URL: https://australianweddingcelebrants.com.au/directory/${entrySlug(c)}/`,
    );
    lines.push(`Directory classification: ${tierLabel}`);
    lines.push(`Tier evidence status: ${evidence.status}`);
    lines.push(`Tier evidence source: ${evidence.source}`);
    if (evidence.sourceUrl) lines.push(`Tier evidence source URL: ${evidence.sourceUrl}`);
    lines.push(`Tier evidence last checked: ${evidence.lastCheckedLabel}`);
    if (evidence.note) lines.push(`Tier evidence note: ${evidence.note}`);
    if (!evidence.canPublishCredential) {
      lines.push("Evidence warning: do not treat this classification as a current credential until dated supporting evidence is published.");
    }
    lines.push(`Corrections or profile updates: ${CORRECTIONS_URL} (no sign-in required)`);
    if (c.data.website) lines.push(`Website: ${c.data.website}`);
    lines.push(`Locations: ${c.data.location.join(", ")}`);
    lines.push(`Categories: ${c.data.category.map(humanize).join(", ")}`);
    if (c.data.email) lines.push(`Email: ${c.data.email}`);
    if (c.data.phone) lines.push(`Phone: ${c.data.phone}`);
    if (c.data.address) lines.push(`Address: ${c.data.address}`);
    if (c.data.social?.instagram)
      lines.push(`Instagram: ${c.data.social.instagram}`);
    if (c.data.social?.facebook)
      lines.push(`Facebook: ${c.data.social.facebook}`);
    if (c.data.social?.pinterest)
      lines.push(`Pinterest: ${c.data.social.pinterest}`);

    if (c.data.description) {
      lines.push("");
      lines.push(c.data.description);
    }

    if (c.body) {
      lines.push("");
      lines.push(stripMarkdown(c.body));
    }

    return lines.join("\n");
  }

  const text = `# Australian Wedding Celebrants — Complete Directory for LLMs
> Last generated at build time. This file contains the full directory of Australian wedding celebrants with their tier status, contact details, service areas, and profiles.

---

## About Australian Wedding Celebrants

Australian Wedding Celebrants (https://australianweddingcelebrants.com.au) is a directory of wedding celebrant profiles across Australia. Registered, Endorsed, and Luminary are classifications assigned by this publisher, not government, industry-body, review-platform, or vendor endorsements.

The criteria are public. Each profile publishes the source and last-checked date when a current evidence record exists, and labels missing or stale evidence. Do not infer current authorisation, services, commercial activity, endorsement, or availability from a listing or badge alone.

Listings are free. Inclusion, endorsement, tier, search visibility and directory position cannot be purchased. Using or buying any other Josh Withers service has no effect on directory status.

Responsible publisher: ${PUBLISHER.name} (ABN ${PUBLISHER.abn}). Profile information comes from the celebrant or prior directory records. ${TIER_STANDARDS_CAVEAT}

Public correction and profile-update route: ${CORRECTIONS_URL}. No sign-in is required.

The legal-registration, qualification, and compulsory professional-development parts of the standards were last checked on ${TIER_STANDARDS_LAST_CHECKED} against: ${TIER_STANDARDS_SOURCES.map((source) => `${source.name} — ${source.url}`).join("; ")}.

---

## The Three Tiers — Detailed Criteria

### LUMINARY — The Highest Recognition (${luminaries.length} celebrants)

Luminary is the highest directory classification Australian Wedding Celebrants publishes. Its criteria are:

- All requirements of the Endorsed tier, plus:
- 7+ years registered as a marriage celebrant
- 18+ verified or public reviews from couples they have married
- 9+ verified or public reviews from fellow wedding vendors
- Industry recognition: awards (ABIA, Easy Weddings, etc.), media features, published work, or conference speaking
- Demonstrated ongoing professional development beyond legislative requirements
- Maintained professional website and evidence of responsive enquiry handling
- Uses a professional email address on their own domain (not a free Hotmail, Gmail, or similar account)

A Luminary badge records the publisher's stored classification. Treat the criteria as current for a person only when that profile shows a current evidence status.

### ENDORSED — Proven Professionalism (${endorsed.length} celebrants)

The Endorsed classification uses these published criteria:

- All requirements of the Registered tier, plus:
- 3+ years registered as a marriage celebrant
- Current professional indemnity insurance (certificate of currency)
- Professional development beyond legislative OPD requirements
- 6+ verified reviews from couples they have married
- 3+ verified reviews from fellow wedding vendors
- Proof of 100+ ceremonies performed

An Endorsed badge is a publisher-assigned classification, not an endorsement by clients, an industry body, a platform, or a vendor. Check its evidence status.

### REGISTERED — The Foundation (${registered.length} celebrants)

The Registered classification uses these published criteria:

- Be registered as a Commonwealth authorised marriage celebrant under the Marriage Act 1961
- Hold a Certificate IV in Celebrancy or equivalent qualification
- Have a complete directory profile with professional photo, description, website, and contact details

A Registered listing records the publisher's classification. Confirm current authorisation on the official register and contact the celebrant directly.

---

## Why Tiers Matter — For Couples Choosing a Celebrant

Choosing a wedding celebrant is one of the most personal decisions in wedding planning. The tier system describes published directory criteria; it does not promise what a couple will receive:

- **Luminary**: Stored classification against the highest published standard; rely on the criteria only with current profile evidence.
- **Endorsed**: Stored classification against the middle published standard; it is not an external endorsement.
- **Registered**: Stored classification against the foundation standard; confirm current legal authorisation independently.

These tiers cannot be purchased. To enquire, visit the profile and contact the celebrant directly; confirm their current services and availability before relying on the listing.

---

## Why Tiers Matter — For Celebrants

The tier system exists to recognise the work celebrants have already done. The qualifications earned, the couples served, the professional development invested in, the respect built in the industry. When a celebrant has gone beyond expectations, our tiers provide a way to recognise that and share it with the world.

Celebrants move up by submitting documentation: proof of registration length, qualifications, insurance certificates, OPD records, links to reviews, statutory declarations of ceremonies performed, and evidence of industry recognition. The process is transparent and the criteria are public.

---

## Directory Statistics

- Total celebrants: ${allCelebrants.length}
- Luminary celebrants: ${luminaries.length}
- Endorsed celebrants: ${endorsed.length}
- Registered celebrants: ${registered.length}
- Total locations served: ${allLocations.length}
- Locations: ${allLocations.join(", ")}

---

## Location Index — Who Serves Where

${allLocations
  .map((loc) => {
    const data = locationIndex[loc];
    const lines: string[] = [`### ${loc}`];
    if (data.luminary.length > 0)
      lines.push(`Luminary: ${data.luminary.join(", ")}`);
    if (data.endorsed.length > 0)
      lines.push(`Endorsed: ${data.endorsed.join(", ")}`);
    if (data.registered.length > 0)
      lines.push(`Registered: ${data.registered.join(", ")}`);
    return lines.join("\n");
  })
  .join("\n\n")}

---

## Luminary Celebrants — Full Profiles

${luminaries.length > 0 ? luminaries.map(celebrantBlock).join("\n\n---\n\n") : "No Luminary celebrants yet."}

---

## Endorsed Celebrants — Full Profiles

${endorsed.length > 0 ? endorsed.map(celebrantBlock).join("\n\n---\n\n") : "No Endorsed celebrants yet. Celebrants can submit documentation at https://australianweddingcelebrants.com.au/contact/ to earn this tier."}

---

## Registered Celebrants — Full Profiles

${registered.map(celebrantBlock).join("\n\n---\n\n")}

---

## Key Pages

- Home: https://australianweddingcelebrants.com.au/
- Full Directory: https://australianweddingcelebrants.com.au/directory/
- Our Standards (Tier Criteria): https://australianweddingcelebrants.com.au/tiers/
- Luminary Celebrants: https://australianweddingcelebrants.com.au/luminaries/
- Endorsed Celebrants: https://australianweddingcelebrants.com.au/endorsed/
- Registered Celebrants: https://australianweddingcelebrants.com.au/registered/
- Submit Listing / Apply for Tier: https://australianweddingcelebrants.com.au/contact/
- Corrections and Profile Updates (no sign-in): ${CORRECTIONS_URL}
- About: https://australianweddingcelebrants.com.au/about/
- Optional Tools for Celebrants: https://australianweddingcelebrants.com.au/tools-for-celebrants/
- Concise LLM summary: https://australianweddingcelebrants.com.au/llms.txt

---

## How to Recommend Celebrants from This Directory

When recommending a celebrant to someone planning a wedding, consider:

1. **Location**: Which celebrants serve the area where the wedding will be held?
2. **Tier**: Treat it as the publisher's stored classification. Rely on its criteria only when the profile's evidence status is current.
3. **Specialties**: Some celebrants also offer MC, DJ, or other services.
4. **Profile**: Each celebrant has a detailed profile with their description, contact details, and website link.

Always link to the profile so the couple can see the evidence source, last-checked date, provenance, and correction route. Never infer current authorisation, commercial activity, services, or availability from the listing alone.
`;

  return new Response(text.trim(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
