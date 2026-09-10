# ChatGPT App Listing — Submission Cheat Sheet

Everything you'll need to paste into the OpenAI developer portal when submitting the Australian Wedding Celebrants directory as a ChatGPT app. Values are ready-to-copy.

> **Time-sensitive submission aid.** Recheck current OpenAI portal requirements,
> protocol behaviour, production endpoints and directory counts before use. The
> count snapshot in this file was verified from source on 10 September 2026.

## Identity

| Field                               | Value                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| **App name**                        | Australian Wedding Celebrants                                                  |
| **Short tagline** (≤ 40 chars)      | Find a marriage celebrant in Australia                                         |
| **Category / primary use**          | Lifestyle · Search & directory                                                 |
| **Developer / publisher**           | Withers XYZ Pty Ltd as trustee for the Snow Withers Trust (ABN 37 709 073 991) |
| **Country**                         | Australia                                                                      |
| **Support contact**                 | hello@australianweddingcelebrants.com.au                                       |
| **Website**                         | https://australianweddingcelebrants.com.au                                     |
| **Privacy policy**                  | https://australianweddingcelebrants.com.au/privacy/                            |
| **Terms of service**                | https://australianweddingcelebrants.com.au/terms/                              |
| **"How we work with AI" explainer** | https://australianweddingcelebrants.com.au/ai/                                 |

## MCP server

| Field                | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Endpoint URL**     | https://api.australianweddingcelebrants.com.au/mcp                                      |
| **Transport**        | Streamable HTTP                                                                         |
| **Protocol version** | 2025-06-18                                                                              |
| **Authentication**   | None (read-only public data)                                                            |
| **Server card**      | https://australianweddingcelebrants.com.au/.well-known/mcp/server-card.json             |
| **Rate limiting**    | None on `/mcp` itself; the Worker caches its public directory source for about 1 minute |

## Short description (≤ 120 chars)

> Search the Australian Wedding Celebrants directory by name, location, or recognition tier — and read full celebrant profiles.

## Long description

> Australian Wedding Celebrants is a quality-rated directory of Commonwealth-authorised marriage celebrants across Australia, organised into three verified recognition tiers: Luminary, Endorsed, and Registered.
>
> This ChatGPT app lets you search the directory, filter by city or region, browse by tier, and fetch the full public profile of any celebrant — including their bio, contact details, social links, awards, and testimonials. Every celebrant listed is a Commonwealth-authorised marriage celebrant; the tier reflects verified professional track record, not paid placement.
>
> The directory itself is free for celebrants to be listed in and free for couples to use. This app is a pass-through to public profile data — ChatGPT doesn't handle any booking, payment, or reply on your behalf. When you find a celebrant you like, the app gives you their profile URL and contact details so you can reach out to them directly.

## Example prompts (supply 5–10 to the reviewer)

1. _"Find me a wedding celebrant in Byron Bay who handles elopements."_
2. _"Who are the top Luminary-tier celebrants in Melbourne?"_
3. _"Show me celebrants who'll travel to Tasmania."_
4. _"Compare Endorsed-tier celebrants in Sydney — I want a laid-back officiant for a beach wedding."_
5. _"What does it mean for a celebrant to be 'Luminary' tier?"_ (triggers `list_all_celebrants` or `browse_by_tier`)
6. _"Give me the full profile for Josh Withers celebrant."_
7. _"I'm planning a small wedding in the Hunter Valley in March 2027 — who should I contact?"_
8. _"Are there any marriage celebrants who speak Mandarin in the directory?"_ (free-text search)

## Test cases for portal submission

### Positive test cases (5)

#### Test 1 — Free-text search by specialty

- **Scenario:** Couple looking for a celebrant in a specific location who handles a specific style of ceremony.
- **User prompt:** _"Find me a wedding celebrant on the Gold Coast who specialises in elopements."_
- **Tool triggered:** `search_celebrants` with `{ "query": "gold coast elopement" }` (or similar phrasing).
- **Expected output:** A shortlist of 1–10 celebrants whose name, location list, or description contains "gold coast" and/or "elopement". Each result shows the celebrant's name, recognition tier (Luminary/Endorsed/Registered), service area, a short description, and the profile URL (`https://australianweddingcelebrants.com.au/directory/<slug>/`). ChatGPT should surface tier as a quality signal, not a popularity ranking.

#### Test 2 — Browse by location with travellers included

- **Scenario:** Couple wants every celebrant available for a specific city, including those who travel.
- **User prompt:** _"Show me all the wedding celebrants available for a wedding in Hobart."_
- **Tool triggered:** `browse_by_location` with `{ "location": "Hobart" }`.
- **Expected output:** Results split visually or textually into two groups: locals (celebrants who list Hobart as a service area) and travellers (celebrants who travel Australia-wide and would come to Hobart). Each traveller entry is clearly tagged "Travels Australia-wide". Ordered Luminary → Endorsed → Registered within each group. Do not hard-code counts in the submission; capture the current tool result immediately before review.

#### Test 3 — Browse by tier

- **Scenario:** Couple wants to see the top-tier celebrants first.
- **User prompt:** _"Show me every Luminary-tier celebrant on the directory."_
- **Tool triggered:** `browse_by_tier` with `{ "tier": "luminary" }`.
- **Expected output:** Every current Luminary-tier celebrant with name, service area, description, and profile URL. ChatGPT should briefly explain what Luminary means (7+ years, 18+ verified couple reviews, 9+ vendor reviews, industry recognition) so the couple understands the tier isn't a popularity contest. The source snapshot on 10 September 2026 contains 10 Luminaries; re-query before submission.

#### Test 4 — Fetch full profile

- **Scenario:** Couple has narrowed to one candidate and wants full context before contacting them.
- **User prompt:** _"Give me the full profile for the celebrant Josh Withers."_
- **Tool triggered:** First `search_celebrants` with `{ "query": "Josh Withers" }` to resolve the slug, then `get_celebrant_profile` with `{ "slug": "josh-withers-ybt9" }`.
- **Expected output:** Full markdown profile including the celebrant's title, description, tier, service areas, specialties, years working, contact details (website, email, phone, address), social links, awards list, testimonials, and complete bio. Profile URL (`/directory/josh-withers-ybt9/`) linked at the bottom as canonical.

#### Test 5 — Broad directory question

- **Scenario:** Couple is in early research and wants an overview of the directory itself.
- **User prompt:** _"How many celebrants are on this directory, and how many are in each tier?"_
- **Tool triggered:** `list_all_celebrants` (returns structured `count` + `celebrants[]` with per-entry tier).
- **Expected output:** A short structured answer with the current total and split by tier, and optionally a few sample names from each tier. The source snapshot on 10 September 2026 is 66 published profiles: 10 Luminary, 13 Endorsed and 43 Registered. Re-run `list_all_celebrants` immediately before submission rather than copying this dated value. ChatGPT should follow up with an offer to help narrow down based on location or style.

### Negative test cases (3)

#### Negative 1 — Query too short

- **Scenario:** User (or an ambitious model) sends a single-character query.
- **User prompt:** _"Search the celebrants directory for 'a'."_
- **Tool triggered:** `search_celebrants` with `{ "query": "a" }`.
- **Expected output:** The tool returns an error result (`isError: true`) with the message **"Query must be at least 2 characters."** ChatGPT should relay this gracefully and ask the user for a more specific query (location, name, specialty) rather than fabricating celebrant names.

#### Negative 2 — Out-of-scope location (wedding outside Australia)

- **Scenario:** Couple asks about a wedding in a country this directory doesn't cover. The app should not fabricate celebrants.
- **User prompt:** _"We're getting married in Bali in October 2027 — find me a celebrant."_
- **Tool triggered:** A well-behaved model should NOT call a location tool at all (Bali isn't in the directory). An over-eager model may call `browse_by_location` with `{ "location": "Bali" }` — which will return an empty `celebrants` array and the rendered text _"No celebrants matched."_
- **Expected output:** ChatGPT explains that the directory is limited to Commonwealth-authorised Australian marriage celebrants, and that the couple should check either (a) celebrants who travel internationally (`search_celebrants` with `{ "query": "international" }` or call out the "international" flag) or (b) a dedicated destination-wedding directory. ChatGPT must NOT invent celebrant names or locations.

#### Negative 3 — Nonexistent slug

- **Scenario:** Model hallucinates a slug or the user asks about a celebrant not in the directory.
- **User prompt:** _"Get the full profile for the celebrant with slug 'this-celebrant-does-not-exist'."_
- **Tool triggered:** `get_celebrant_profile` with `{ "slug": "this-celebrant-does-not-exist" }`.
- **Expected output:** The tool returns an error result with the message **`No celebrant found with slug "this-celebrant-does-not-exist".`** ChatGPT should report this honestly to the user, offer to search by name or location instead, and NOT invent profile content. The `isError: true` flag in the response makes this unambiguous for the model.

## Tool list (for reviewer reference)

| Name                    | readOnlyHint | destructiveHint | openWorldHint | What it does                                                    |
| ----------------------- | :----------: | :-------------: | :-----------: | --------------------------------------------------------------- |
| `search_celebrants`     |      ✓       |        ✗        |       ✓       | Free-text search across name/location/description               |
| `browse_by_location`    |      ✓       |        ✗        |       ✓       | List celebrants for a location (incl. Australia-wide travelers) |
| `browse_by_tier`        |      ✓       |        ✗        |       ✓       | List celebrants at a given tier (luminary/endorsed/registered)  |
| `get_celebrant_profile` |      ✓       |        ✗        |       ✓       | Fetch a celebrant's full markdown profile by slug               |
| `list_all_celebrants`   |      ✓       |        ✗        |       ✓       | Return the full directory (for broad context)                   |

Each tool declares an `outputSchema` and returns `structuredContent` alongside a human-readable text summary.

## Review-account credentials

**Not required.** The MCP server is public and unauthenticated. Reviewers can POST a JSON-RPC 2.0 request to `https://api.australianweddingcelebrants.com.au/mcp` without any header or token.

Sample call for the reviewer:

```bash
curl -X POST https://api.australianweddingcelebrants.com.au/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_celebrants","arguments":{"query":"byron bay"}}}'
```

## Safety / content policy compliance

- **Adult content, gambling, drugs, weapons, malware, counterfeit goods** — none. Directory is wedding celebrants only.
- **Digital goods / subscriptions** — none. No commerce of any kind through the app.
- **Advertising** — none. The app never serves ads.
- **Ages** — suitable for 13+. Wedding content is general-audience.
- **Payment card / health / ID / credentials** — never collected. See privacy policy, sections 2, 6, and 6b.
- **Disparagement of competitors** — none.

## Icon / assets (to upload separately)

- **App icon** — 1024×1024 PNG. Use `/public/logo.svg` rendered at 1024×1024 with the site's Luminary-purple `#460479` background, or commission a fresh square mark.
- **Suggested icon concept** — a simple white stylised ring or celebrant-stand silhouette on the purple background, matching the Luminary tier pill treatment the site already uses.
- **Screenshots** — 3–5 screenshots of ChatGPT using the app. Suggested scenarios:
  1. User asks "find celebrants in Byron Bay" — ChatGPT returns a shortlist with names, tiers, and profile links.
  2. User asks to compare two celebrants — ChatGPT calls `get_celebrant_profile` for each and summarises.
  3. User asks "what's a Luminary tier?" — ChatGPT explains using directory data.

## Discovery surfaces already live (for context / reviewer curiosity)

All of these are already published:

- `https://australianweddingcelebrants.com.au/.well-known/api-catalog` (RFC 9727)
- `https://australianweddingcelebrants.com.au/.well-known/mcp/server-card.json` (SEP-1649)
- `https://australianweddingcelebrants.com.au/.well-known/agent-skills/index.json` (v0.2.0)
- `https://australianweddingcelebrants.com.au/.well-known/agent-card.json` (A2A protocol 0.3)
- `https://australianweddingcelebrants.com.au/llms.txt` and `/llms-full.txt`
- `Accept: text/markdown` content negotiation on every HTML page

## Changelog notes for future submissions

- **v1.0.0** — Initial submission. Five read-only tools, no auth, structured content + text fallback.
