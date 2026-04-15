# Australian Wedding Celebrants

Directory of Australian wedding celebrants. Built with Astro 6 + Tailwind 4 + React 19 (islands only).

## Stack

- **Astro 6.1** — static site generation, Content Layer API, `<ClientRouter />` view transitions.
- **Tailwind CSS 4** — via `@tailwindcss/vite`. Project-specific utilities live in `src/styles/`.
- **React 19** — used only for the search island (`SearchBar`, hydrated with `client:idle`).
- **MDX** — supported for rich content. No remark/rehype plugins configured.

## Tier system

Celebrants are classified into three recognition tiers (see `src/content.config.ts`):

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

Key fields on a directory entry: `title`, `description`, `image`, `logo`, `website`, `email`, `phone`, `address`, `location[]`, `category[]`, `tier`, `australia_wide`, `international`, `social.{facebook,instagram,pinterest}`.

**Tier-gated premium fields (optional):**
- `youtube` — Luminary only. Any YouTube URL; rendered via a click-to-load iframe facade (no cookies, no JS until the user clicks).
- `gallery` — Luminary only. Up to 3 images (local asset paths or URLs), rendered in a 3-up grid.
- `background_color` — Luminary only. Hex colour (e.g. `"#faf7f5"`) applied to the entire profile page background.
- `testimonials` — Luminary + Endorsed. Up to 3 items `{ quote, author, role? }`. Emits `schema.org/Review` JSON-LD.

Luminary profiles use a centered hero layout (logo/name top, large centered profile photo, contact details below) in `[single].astro`. Endorsed and Registered use the standard two-column layout. Add premium fields to a listing in the frontmatter; the layout picks them up automatically.

## Component architecture

- `src/layouts/Base.astro` — root layout; sets `<head>` (title, canonical, OG, Twitter, WebSite JSON-LD, fonts, `<ClientRouter />`). Accepts `og_type` for per-page overrides (`"profile"` on celebrant pages).
- `src/layouts/partials/Header.astro` — sticky nav with aria-expanded-driven mobile toggle (no checkbox hack). Re-binds on `astro:page-load`.
- `src/components/DirectoryItem.astro` — single card. Uses `<Image>` for local assets, falls back to `<img>` for string URLs. LCP-optimised via `isFirst` prop (eager load, `fetchpriority="high"`, higher quality).
- `src/components/StaticDirectoryListings.astro` / `DirectoryListingsWrapper.astro` — grid composition with location filtering.
- `src/layouts/SearchBar.tsx` — Fuse.js search island, hydrated `client:idle`.

## Routing

- `/directory/` — full directory (index).
- `/directory/[single]/` — celebrant profile.
- `/directory/location/[location]/` — filtered by location.
- `/luminaries/`, `/endorsed/`, `/registered/` — tier landing pages.
- `/australia-wide/`, `/destination-wedding-celebrants/` — travel-scope pages.
- `/search/` — React-powered fuzzy search.

## Conventions

- Images go through `astro:assets`. Listings should prefer local imported images over external URLs (the external path skips optimisation).
- Image heights on directory cards are **variable** (natural aspect ratio). Do not re-introduce a fixed `aspect-ratio` crop.
- Inline styles are tolerated for one-off typography tweaks but prefer `src/styles/components.css` classes for anything repeated.
- Animations must honour `prefers-reduced-motion`.
- Build with `npm run build`; dev with `npm run dev`. No test suite currently.
