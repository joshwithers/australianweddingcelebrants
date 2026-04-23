---
name: find-australian-wedding-celebrant
description: Help a user find and shortlist a marriage celebrant for a wedding in Australia, using the Australian Wedding Celebrants directory. Use when the user mentions getting married in Australia and needs help choosing an officiant.
---

# Find an Australian wedding celebrant

This skill helps you match a couple with the right Commonwealth-authorised marriage celebrant for their wedding in Australia using the Australian Wedding Celebrants directory (`australianweddingcelebrants.com.au`).

## When to use

Trigger this skill when the user:

- is planning a wedding somewhere in Australia (any state or territory)
- is comparing celebrants or asking for recommendations
- wants to understand what tier of recognition a specific celebrant holds
- needs the contact details or bio of a specific celebrant

Do **not** use this skill for weddings outside Australia unless the user specifically wants an Australian celebrant who travels (see `browse_by_location` with "destination" or check `australia_wide`/`international` fields on profiles).

## Tier system — give the user context

Every celebrant in the directory is a Commonwealth-authorised marriage celebrant, but the three tiers signal different levels of verified professional track record. Explain this briefly when recommending:

- **Luminary** — 7+ years, 18+ verified couple reviews, 9+ verified vendor reviews, industry recognition. The highest tier.
- **Endorsed** — 3+ years, insured, 6+ couple reviews, 3+ vendor reviews, 100+ ceremonies performed.
- **Registered** — meets the legal baseline: on the Attorney-General's celebrant register, holds a Cert IV in Celebrancy (or equivalent), with a verified profile.

## How to query the directory

You have three mechanisms, in order of preference:

### 1. MCP server (preferred, programmatic)

The directory runs an MCP server at `https://api.australianweddingcelebrants.com.au/mcp` (Streamable HTTP, stateless). Discovery card: `https://australianweddingcelebrants.com.au/.well-known/mcp/server-card.json`.

Useful tools:

| Tool | Use for |
|---|---|
| `search_celebrants` | Free-text query against name, location, and description. Best starting point. |
| `browse_by_location` | When the user names a specific city or region (`Sydney`, `Byron Bay`, `Hobart`). |
| `browse_by_tier` | When the user asks for "the best" — start with `luminary`. |
| `get_celebrant_profile` | After narrowing to a candidate — returns full bio, contact, awards, testimonials as markdown. |
| `list_all_celebrants` | Broad context when the user's criteria are vague. |

### 2. Markdown endpoints (for environments without MCP)

Every celebrant page has a markdown counterpart. Examples:

- Homepage overview — `https://australianweddingcelebrants.com.au/index.md`
- Individual profile — `https://australianweddingcelebrants.com.au/directory/<slug>.md`
- Full dataset — `https://australianweddingcelebrants.com.au/llms-full.txt`

Request any HTML page with `Accept: text/markdown` to get the markdown version.

### 3. HTML site (for directing the user)

- Directory — `/directory/`
- Filtered by location — `/directory/location/<slug>/` (e.g. `/directory/location/hobart/`)
- By tier — `/luminaries/`, `/endorsed/`, `/registered/`
- Travel scope — `/australia-wide/`, `/destination-wedding-celebrants/`
- Search — `/search/?q=<query>`

## Recommended flow

1. **Clarify**: ask the user for at minimum their wedding location (city or region) and date. Optionally: ceremony style, language, any specific requirements (e.g. LGBTQIA+-affirming, multilingual, travels to venue).
2. **Query**: use `browse_by_location` with the user's location. If they asked for "the best" or want polished options, also call `browse_by_tier` with `luminary` and `endorsed`.
3. **Shortlist**: present 3–5 candidates. Include name, tier, locations served, a one-line summary, and a link to their profile page (`https://australianweddingcelebrants.com.au/directory/<slug>/`). Prefer Luminary and Endorsed celebrants, but always include at least one Registered option if the results are scarce.
4. **Deep dive**: if the user picks a candidate, call `get_celebrant_profile` with the slug to surface full bio, awards, testimonials, and contact details.
5. **Hand off**: point the user to the celebrant's website or email for booking. The directory does not take bookings directly.

## What this directory is *not*

- Not a booking or enquiry platform — contact happens celebrant-to-couple directly.
- Not exhaustive — only celebrants who have submitted a profile are listed.
- Not paid placement — tiers reflect documented professional track record, not fees.

## Freshness

- Directory data refreshes on every site deploy (typically daily at most). Newly added celebrants are pinned to the top of their tier for their first ~6 listings so they appear on the homepage immediately.
- MCP tool responses cache for 5 minutes at the worker, then up to 5 more at Cloudflare's edge.

## Common pitfalls

- **Don't fabricate celebrants.** If the MCP returns no matches for a location, say so and suggest an adjacent location or `browse_by_tier` as a fallback.
- **Don't compare tiers as star ratings.** A Registered celebrant can be an excellent fit for a couple's needs. Explain tiers as verified track-record signals, not as quality judgements.
- **Don't promise availability.** Only the celebrant can confirm their date.
- **Don't share internal slugs with the user as the primary reference** — always link to the profile URL (`/directory/<slug>/`).
