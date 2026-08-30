# Australian Wedding Celebrants

Directory of Australian wedding celebrants. Built with Astro 7 + Tailwind 4 + React 19 (islands only).

## Stack

- **Astro 7.1** — static site generation, Content Layer API, `<ClientRouter />` view transitions.
- **Tailwind CSS 4** — via `@tailwindcss/vite`. Project-specific utilities live in `src/styles/`.
- **React 19** — used only for the search island (`SearchBar`, hydrated with `client:idle`).
- **MDX** — supported for rich content. No remark/rehype plugins configured.

## Tier system

Celebrants are classified into three publisher-assigned directory tiers (see `src/content.config.ts`). Do not describe a tier as a current credential unless the profile has a public source and a last-checked date no more than 366 days old:

| Tier | Colour | Requirements (summary) |
|---|---|---|
| `registered` | Light grey | Commonwealth authorised celebrant with Cert IV (or equivalent) and complete profile. |
| `endorsed` | `#92174d` magenta | 3+ yrs, insured, 6+ couple reviews and 3+ vendor reviews, 100+ ceremonies. |
| `luminary` | `#460479` purple | 7+ yrs, 18+ couple reviews, 9+ vendor reviews, industry recognition. |

Tier visuals:
- `src/components/TierBadge.astro` — pill overlayed on a listing card image.
- `src/components/TierIcon.astro` — crossfading SVG icon pair (primary → thumbs-up on hover).
- Shared hover CSS in `src/styles/components.css` (`.pill-luminary`, `.pill-endorsed`, `.tier-badge--*`).

Full tier copy for [single].astro lives inline in `tierInfo` / `tierCredentials` maps (`src/pages/directory/[single].astro`).

## Content schema

Zod schemas defined in `src/content.config.ts`. Three collections:

- `directory` — celebrant listings under `src/content/directory/*.{md,mdx}`. Images resolved via Astro's `image()` helper or external URL.
- `pages` — static content (about, contact, tiers, 404, directory overview).
- `about` — single-entry about-page data (note the loader glob `**/-*.{md,mdx}` — underscore-prefixed files are excluded by `glob()`, a leading `-` is the actual prefix).

Key fields on a directory entry: `title`, `description`, `image`, `logo`, `website`, `email`, `phone`, `address`, `location[]`, `category[]`, `tier`, `tier_evidence_source`, `tier_evidence_url`, `tier_evidence_last_checked`, `tier_evidence_note`, `australia_wide`, `international`, `social.{facebook,instagram,pinterest}`. Evidence fields are public summaries; never publish private supporting documents or personal addresses.

**Premium profile fields (optional):**
- `youtube` — Available to all tiers. Any YouTube URL; rendered via a click-to-load iframe facade (no cookies, no JS until the user clicks).
- `gallery` — Available to all tiers. Up to 3 images (local asset paths or URLs), rendered in a 3-up grid.
- `background_color` — Luminary only. Hex colour (e.g. `"#faf7f5"`) applied to the entire profile page background.
- `testimonials` — Luminary + Endorsed. Up to 3 items `{ quote, author, role? }`. Emits `schema.org/Review` JSON-LD.
- `awards` — Available to all tiers. Free-text recognitions (regional, fun, or industry). Each item `{ title, year, emoji?, region?, note? }`. The most recent award surfaces as an emoji corner marker on the directory card (`DirectoryItem.astro`); the full list renders as a "Trophy Shelf" via `ProfileAwards.astro` on the profile page, sorted newest-first, with playful tilt and a `schema.org/Thing` + `additionalType: Award` JSON-LD fragment per item. Titles are free-form ("Celebrant of the Year", "Most Likely to Make the Groom Cry") — there's intentionally no enum, so SEO landing pages per award category aren't auto-generated.
- `year_started` — Year the celebrant began working. Automatically generates a synthetic `Class of {year}` 🎓 award via `src/lib/utils/awards.ts#deriveAwards`, so every celebrant has at least one Trophy Shelf entry. `deriveAwards` is the single source of truth for awards display (used by `DirectoryItem.astro`, `[single].astro`, and `/awards/`); explicit awards rank above the synthetic Class entry when years tie.

Luminary profiles use a centered hero layout (logo/name top, large centered profile photo, contact details below) in `[single].astro`. Endorsed and Registered use the standard two-column layout. Add premium fields to a listing in the frontmatter; the layout picks them up automatically.

## Component architecture

- `src/layouts/Base.astro` — root public layout; sets `<head>` (title, canonical, OG, Twitter, WebSite JSON-LD, fonts, `<ClientRouter />`) and the cookieless GA4 configuration. Consent defaults must remain before `gtag.js`; all four storage/data/personalisation settings remain denied, Google signals and ad personalisation remain off, queries are excluded from `page_location`, and referrers are origin-only. Do not add analytics cookies, local-storage IDs, a consent update, or a banner. Private Worker pages do not use this layout.
- `src/layouts/partials/Header.astro` — sticky nav with aria-expanded-driven mobile toggle (no checkbox hack). Uses delegated events across ClientRouter page swaps.
- `src/components/DirectoryItem.astro` — single card. Uses `<Image>` for local assets, falls back to `<img>` for string URLs. LCP-optimised via `isFirst` prop (eager load, `fetchpriority="high"`, higher quality).
- `src/components/StaticDirectoryListings.astro` / `DirectoryListingsWrapper.astro` — grid composition with location filtering.
- `src/layouts/SearchBar.tsx` — Fuse.js search island, hydrated `client:idle`.

## Routing

- `/directory/` — full directory (index).
- `/directory/[single]/` — celebrant profile.
- `/directory/location/[location]/` — filtered by location.
- `/luminaries/`, `/endorsed/`, `/registered/` — tier landing pages.
- `/australia-wide/`, `/destination-wedding-celebrants/` — travel-scope pages.
- `/awards/` — yearbook of all awards across all listings, grouped by year (newest first). Reads the `awards` field from every directory entry.
- `/search/` — React-powered fuzzy search.

**Profile slugs** come from `src/lib/utils/entrySlug.ts`, never from `entry.id`
directly. It defaults to the filename-derived collection id and lets a listing
override it with a `slug:` frontmatter field. Every place that builds a
`/directory/<slug>/` URL — `getStaticPaths`, `DirectoryItem`, JSON-LD, the `.md`
companions, `llms.txt`, `directory.json` — must go through it, or the generated
routes and the links pointing at them drift apart.

## Agent-readable pages

- Every canonical URL in `sitemap-0.xml` has a direct Markdown companion: `/` maps to
  `/index.md`, while `/about/` maps to `/about.md`.
- `scripts/generate-markdown.mjs` runs after Astro builds, preserves the curated
  homepage and celebrant-profile endpoints, generates every missing companion from
  final `<main>` HTML, carries meta authors into Markdown frontmatter, appends the
  global publisher/correction disclosure, and appends the exact inventory to
  `llms.txt`.
- `scripts/check-markdown-output.mjs` is a load-bearing build gate: sitemap, HTML
  canonical/alternate links, Markdown files, and the `llms.txt` inventory must match.
  It also asserts that a generated companion keeps every `/directory/<slug>/` link
  its HTML page shows. Listing cards put the click target in a text-less stretched
  `<a aria-label>` and swap the name for a logo on premium tiers, so a careless
  HTML→Markdown pass drops both name and URL — `/luminaries.md` once listed ten
  celebrants without naming or linking one.
- Original editorial articles are registered in `src/lib/editorial.ts`. The
  resolver preserves an explicit author and otherwise falls back to Frankie for
  the visible byline, meta author, Article JSON-LD, RSS creator, and Markdown.
  Never apply that fallback to profiles, directory records, or paid listings.
- `functions/_middleware.js` serves the same companions for `Accept: text/markdown`.
  Keep direct `.md` access working too; agents should not need content negotiation.

## Conventions

- Images go through `astro:assets`. Listings should prefer local imported images over external URLs (the external path skips optimisation).
- Image heights on directory cards are **variable** (natural aspect ratio). Do not re-introduce a fixed `aspect-ratio` crop.
- Inline styles are tolerated for one-off typography tweaks but prefer `src/styles/components.css` classes for anything repeated.
- Animations must honour `prefers-reduced-motion`.
- Build with `npm run build`; dev with `npm run dev`. `npm test` builds then runs
  `tests/*.test.mjs`; `npm run validate` adds type-check, link and agent-file checks.
