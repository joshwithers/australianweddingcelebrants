// Markdown counterpart to src/pages/index.astro. Served at /index.md and
// swapped in by functions/_middleware.js when Accept: text/markdown is sent.
// Intentionally concise — agents wanting the full dataset should follow the
// link to /llms-full.txt.

import type { APIRoute } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";

const SITE = "https://australianweddingcelebrants.com.au";

export const GET: APIRoute = async () => {
  const all = await getSinglePage("directory");

  const tierOrder = { luminary: 0, endorsed: 1, registered: 2 };
  const sorted = [...all].sort((a, b) => {
    const ta = tierOrder[a.data.tier || "registered"] ?? 2;
    const tb = tierOrder[b.data.tier || "registered"] ?? 2;
    if (ta !== tb) return ta - tb;
    return a.data.title.localeCompare(b.data.title);
  });

  const luminary = sorted.filter((c) => c.data.tier === "luminary");
  const endorsed = sorted.filter((c) => c.data.tier === "endorsed");
  const registered = sorted.filter((c) => (c.data.tier || "registered") === "registered");
  const locations = [...new Set(all.flatMap((c) => c.data.location))].sort();

  const linkList = (items: typeof all) =>
    items
      .map((c) => `- [${c.data.title}](${SITE}/directory/${c.id}/) — ${c.data.location.join(", ")}`)
      .join("\n");

  const body =
`# Australian Wedding Celebrants

> Australia's quality-rated directory of professional wedding celebrants.

Every celebrant listed here is a Commonwealth authorised marriage celebrant on the Attorney-General's register. We recognise professional excellence through three tiers — Registered, Endorsed, and Luminary — based entirely on verified credentials, not payment.

## Directory at a glance

- Total celebrants: ${all.length}
- Luminary: ${luminary.length}
- Endorsed: ${endorsed.length}
- Registered: ${registered.length}
- Locations: ${locations.join(", ")}

## Key pages

- [Full directory](${SITE}/directory/)
- [Luminary celebrants](${SITE}/luminaries/)
- [Endorsed celebrants](${SITE}/endorsed/)
- [Registered celebrants](${SITE}/registered/)
- [Australia-wide celebrants](${SITE}/australia-wide/)
- [Destination wedding celebrants](${SITE}/destination-wedding-celebrants/)
- [Our standards](${SITE}/tiers/)
- [About](${SITE}/about/)
- [Awards yearbook](${SITE}/awards/)
- [Search](${SITE}/search/)

## Luminary celebrants

${luminary.length ? linkList(luminary) : "_None yet._"}

## Endorsed celebrants

${endorsed.length ? linkList(endorsed) : "_None yet._"}

## For agents

- Machine-readable description: ${SITE}/llms.txt
- Full dataset (all celebrants, all body copy): ${SITE}/llms-full.txt
- Sitemap: ${SITE}/sitemap-index.xml

Every HTML page on this site has a markdown counterpart; request any page with \`Accept: text/markdown\` to receive it.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Markdown-Tokens": String(Math.ceil(body.length / 4)),
    },
  });
};
