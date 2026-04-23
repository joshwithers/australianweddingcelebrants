# ChatGPT App Listing — Submission Cheat Sheet

Everything you'll need to paste into the OpenAI developer portal when submitting the Australian Wedding Celebrants directory as a ChatGPT app. Values are ready-to-copy.

## Identity

| Field | Value |
|---|---|
| **App name** | Australian Wedding Celebrants |
| **Short tagline** (≤ 40 chars) | Find a marriage celebrant in Australia |
| **Category / primary use** | Lifestyle · Search & directory |
| **Developer / publisher** | Withers XYZ Pty Ltd as trustee for the Snow Withers Trust (ABN 37 709 073 991) |
| **Country** | Australia |
| **Support contact** | hello@australianweddingcelebrants.com.au |
| **Website** | https://australianweddingcelebrants.com.au |
| **Privacy policy** | https://australianweddingcelebrants.com.au/privacy/ |
| **Terms of service** | https://australianweddingcelebrants.com.au/terms/ |
| **"How we work with AI" explainer** | https://australianweddingcelebrants.com.au/ai/ |

## MCP server

| Field | Value |
|---|---|
| **Endpoint URL** | https://api.australianweddingcelebrants.com.au/mcp |
| **Transport** | Streamable HTTP |
| **Protocol version** | 2025-06-18 |
| **Authentication** | None (read-only public data) |
| **Server card** | https://australianweddingcelebrants.com.au/.well-known/mcp/server-card.json |
| **Rate limiting** | None on `/mcp` itself; Cloudflare edge caches responses for 5 min |

## Short description (≤ 120 chars)

> Search the Australian Wedding Celebrants directory by name, location, or recognition tier — and read full celebrant profiles.

## Long description

> Australian Wedding Celebrants is a quality-rated directory of Commonwealth-authorised marriage celebrants across Australia, organised into three verified recognition tiers: Luminary, Endorsed, and Registered.
>
> This ChatGPT app lets you search the directory, filter by city or region, browse by tier, and fetch the full public profile of any celebrant — including their bio, contact details, social links, awards, and testimonials. Every celebrant listed is a Commonwealth-authorised marriage celebrant; the tier reflects verified professional track record, not paid placement.
>
> The directory itself is free for celebrants to be listed in and free for couples to use. This app is a pass-through to public profile data — ChatGPT doesn't handle any booking, payment, or reply on your behalf. When you find a celebrant you like, the app gives you their profile URL and contact details so you can reach out to them directly.

## Example prompts (supply 5–10 to the reviewer)

1. *"Find me a wedding celebrant in Byron Bay who handles elopements."*
2. *"Who are the top Luminary-tier celebrants in Melbourne?"*
3. *"Show me celebrants who'll travel to Tasmania."*
4. *"Compare Endorsed-tier celebrants in Sydney — I want a laid-back officiant for a beach wedding."*
5. *"What does it mean for a celebrant to be 'Luminary' tier?"* (triggers `list_all_celebrants` or `browse_by_tier`)
6. *"Give me the full profile for Josh Withers celebrant."*
7. *"I'm planning a small wedding in the Hunter Valley in March 2027 — who should I contact?"*
8. *"Are there any marriage celebrants who speak Mandarin in the directory?"* (free-text search)

## Tool list (for reviewer reference)

| Name | readOnlyHint | destructiveHint | openWorldHint | What it does |
|---|:-:|:-:|:-:|---|
| `search_celebrants` | ✓ | ✗ | ✓ | Free-text search across name/location/description |
| `browse_by_location` | ✓ | ✗ | ✓ | List celebrants for a location (incl. Australia-wide travelers) |
| `browse_by_tier` | ✓ | ✗ | ✓ | List celebrants at a given tier (luminary/endorsed/registered) |
| `get_celebrant_profile` | ✓ | ✗ | ✓ | Fetch a celebrant's full markdown profile by slug |
| `list_all_celebrants` | ✓ | ✗ | ✓ | Return the full directory (for broad context) |

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
- `https://australianweddingcelebrants.com.au/.well-known/agent-card.json` (A2A protocol 0.2.0)
- `https://australianweddingcelebrants.com.au/llms.txt` and `/llms-full.txt`
- `Accept: text/markdown` content negotiation on every HTML page

## Changelog notes for future submissions

- **v1.0.0** — Initial submission. Five read-only tools, no auth, structured content + text fallback.
