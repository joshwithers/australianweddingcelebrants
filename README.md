# Australian Wedding Celebrants

A professional and free directory of Australia's wedding celebrants, featuring a three-tier recognition system that highlights quality and professionalism in the industry. An anti-awards system.

---

Built by [Josh Withers](https://joshwithers.au) of ["Married by Josh"](https://marriedbyjosh.com.au) with SEO optimisation by [Unpopular](https://unpopular.au) and built by [The Internet](https://theinternetcom.au)

---

**Live site:** [australianweddingcelebrants.com.au](https://australianweddingcelebrants.com.au)

## Tech Stack

- **[Astro](https://astro.build)** v6 — static site generator with file-based routing
- **[React](https://react.dev)** v19 — interactive components (search, filtering)
- **[Tailwind CSS](https://tailwindcss.com)** v4 — CSS-first configuration with `@theme` tokens via `@tailwindcss/vite`
- **[TypeScript](https://www.typescriptlang.org)** — type safety
- **[Fuse.js](https://www.fusejs.io)** v7 — client-side fuzzy search
- **[Sharp](https://sharp.pixelplumbing.com)** — build-time image optimisation
- **[Cloudflare Workers](https://workers.cloudflare.com)** — backend API for listing submissions, admin dashboard, AI-powered bio editing, and bulk email (see `worker/`)
- **[Resend](https://resend.com)** — transactional and bulk email delivery
- **[Anthropic Claude](https://anthropic.com)** — AI content cleanup and interactive bio editing

## Project Structure

```
src/
├── assets/              # Local images processed by Astro
├── components/          # Astro & React components
│   ├── DirectoryItem.astro          # Celebrant card with tier badges
│   ├── DirectoryListingsWrapper.astro  # Data fetching wrapper
│   ├── StaticDirectoryListings.astro   # Listing grid with location filters
│   └── ...
├── config/              # Site configuration (JSON)
│   ├── config.json      # Site metadata, contact info, form endpoints
│   ├── menu.json        # Navigation menus
│   ├── theme.json       # Colours, fonts, design tokens
│   └── social.json      # Social media links
├── content/             # Content collections (Markdown/MDX)
│   ├── directory/       # Celebrant listings (~54 profiles)
│   ├── about/           # About page
│   └── pages/           # Static pages (contact, tiers, 404)
├── content.config.ts    # Collection schemas (Zod validation)
├── layouts/             # Page layouts, header, footer
│   ├── Base.astro       # HTML wrapper with SEO/meta tags
│   ├── partials/        # Header.astro, Footer.astro
│   ├── SearchBar.tsx    # Fuse.js search component
│   └── shortcodes/      # MDX components (Button, Accordion, Tabs, etc.)
├── lib/utils/           # Helpers (slugify, date format, sorting, taxonomy)
├── pages/               # File-based routes
│   ├── index.astro      # Homepage with hero and featured listings
│   ├── directory/       # Directory listing, individual profiles, location pages
│   ├── search.astro     # Search results (Fuse.js fuzzy search)
│   ├── tiers.astro      # Tier system explanation
│   ├── luminaries.astro # Luminary tier celebrants
│   ├── endorsed.astro   # Endorsed tier celebrants
│   ├── registered.astro # Registered tier celebrants
│   ├── australia-wide.astro           # Celebrants who travel nationally
│   ├── destination-wedding-celebrants.astro  # International celebrants
│   ├── terms.astro      # Terms and conditions
│   ├── privacy.astro    # Privacy policy
│   ├── submit.astro     # Redirects to worker login
│   ├── llms.txt.ts      # LLM-friendly site content
│   └── ...
├── scripts/             # Client-side performance scripts
└── styles/              # Global CSS (Tailwind v4, native CSS nesting)
    ├── main.css         # Tailwind import, @theme tokens, @plugin declarations
    ├── base.css         # HTML element defaults, heading scale, link styles
    ├── buttons.css      # Button component variants
    ├── components.css   # Cards, forms, prose, badges, social icons, tabs, accordion
    ├── navigation.css   # Navbar, dropdowns, search modal
    └── utilities.css    # Utility overrides

worker/                  # Cloudflare Worker API (deployed separately)
├── src/index.js         # All worker logic (~2400 lines)
└── wrangler.toml        # Worker config, KV bindings, cron triggers

public/                  # Static assets (favicons, og-image, robots.txt)
```

## Tier System

Celebrants are recognised across three tiers based on documented evidence of experience, qualifications, and community contribution. Tiers are earned, not bought or voted on.

| Tier | Colour | Description |
|------|--------|-------------|
| **Luminary** | Purple `#460479` | 7+ years, 20+ couple reviews, 10+ vendor reviews, industry awards, demonstrated contribution to the profession |
| **Endorsed** | Magenta `#92174d` | 3+ years, Cert IV, insurance, professional development beyond OPD, 5+ reviews, 100+ ceremonies |
| **Registered** | Grey `#6a6a6a` | Commonwealth authorised marriage celebrant with a verified professional profile |

## Worker API

The backend API (`worker/src/index.js`) at `api.australianweddingcelebrants.com.au` handles:

- **Magic-link authentication** — passwordless login for celebrants and admin
- **Listing submission** — form with image/logo upload, tier upgrade evidence
- **AI content cleanup** — automatic bio generation via Claude on submission
- **AI bio editing** — interactive "Make it better/longer/shorter/more helpful" buttons that scrape the celebrant's website for context
- **Admin dashboard** — stats, listing management, submission review
- **Admin listing editor** — direct GitHub editing of any listing with AI bio tools
- **Admin review & approve** — review submissions, set tier, push to GitHub
- **Bulk email** — compose and send to all listed celebrants via Resend with AI cleanup
- **Delayed notifications** — celebrant approval emails sent 15 minutes after approval (cron trigger)
- **GitHub integration** — listings and assets pushed directly to the repo

KV storage for sessions, submissions, images, and AI usage tracking. Cron trigger every 5 minutes for delayed notifications.

## Getting Started

### Prerequisites

- Node.js 22+ (see `.node-version`)
- npm

### Install & Run

```bash
npm install
npm run dev        # Start dev server at localhost:4321
npm run build      # Production build to dist/
npm run preview    # Preview production build
```

### Worker

```bash
cd worker
npm install
npm run dev        # Local worker dev server
npm run deploy     # Deploy to Cloudflare
```

Required secrets (via `wrangler secret put`): `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`

### Other Commands

```bash
npm run format     # Format code with Prettier
```

## Content Management

Celebrant listings live in `src/content/directory/` as Markdown files with YAML frontmatter. Each file represents one celebrant profile.

### Adding a Celebrant

Celebrants self-submit via the worker API at `api.australianweddingcelebrants.com.au/login`. Submissions go through AI cleanup and admin review before being published as Markdown files via the GitHub API.

To add manually, create a new `.md` file in `src/content/directory/`:

```yaml
---
title: "Celebrant Name"
description: "Short bio (max 160 chars)"
image: "../../assets/directory/slug.webp"
logo: "../../assets/directory/slug-logo.webp"
website: "https://..."
email: "hello@example.com"
phone: "0400 000 000"
address: "City, State"
location:
  - "Sydney"
  - "Central Coast"
category:
  - "Celebrant"
  - "MC"
tier: "registered"          # registered | endorsed | luminary
australia_wide: false
international: false
social:
  instagram: "https://instagram.com/..."
  facebook: "https://facebook.com/..."
draft: false
---

Celebrant's full bio in Markdown (target 600+ words for SEO)...
```

## Configuration

| File | Purpose |
|------|---------|
| `astro.config.mjs` | Astro settings, Vite plugins (`@tailwindcss/vite`), integrations, markdown plugins |
| `src/styles/main.css` | Tailwind v4 `@theme` tokens (colours, fonts, shadows, radii, breakpoints) |
| `src/config/config.json` | Site title, URL, contact info, form endpoints |
| `src/config/theme.json` | Design tokens consumed by theme (colours, font scale) |
| `src/config/menu.json` | Header and footer navigation |
| `tsconfig.json` | TypeScript config with `@` path alias |

## Design System

### Colour Palette

| Role | Hex | Usage |
|------|-----|-------|
| Rausch Red | `#ff385c` | Primary brand accent, CTAs, hover states |
| Near Black | `#222222` | Primary text, dark surfaces, buttons |
| Secondary Text | `#6a6a6a` | Descriptions, hints, secondary content |
| Border | `#e0e0e0` | Card borders, dividers, form inputs |
| Light Surface | `#f7f7f7` | Background sections, hover fills |
| Pure White | `#ffffff` | Page background, card surfaces |
| Luminary Purple | `#460479` | Luminary tier badges and accents |
| Endorsed Magenta | `#92174d` | Endorsed tier badges and accents |
| Hero Title | `#86244c` | Homepage hero heading |

### Typography

- **Font**: Inter (loaded via Astro Fonts, `--font-inter` CSS variable)
- **Body**: 14px, weight 400, line-height 1.43
- **Headings**: weight 500–700, letter-spacing -0.18px to -0.44px
- **Scale** (1.25 ratio): h6 1rem, h5 1.25rem, h4 1.56rem, h3 1.95rem, h2 2.44rem, h1 3.05rem

### Elevation & Shadows

| Level | Shadow | Usage |
|-------|--------|-------|
| Card | `rgba(0,0,0,0.02) 0 0 0 1px, rgba(0,0,0,0.04) 0 2px 6px, rgba(0,0,0,0.1) 0 4px 8px` | Listing cards, nav dropdowns |
| Card Hover | `rgba(0,0,0,0.04) 0 0 0 1px, rgba(0,0,0,0.06) 0 4px 12px, rgba(0,0,0,0.14) 0 8px 16px` | Card hover lift |
| Hover | `rgba(0,0,0,0.08) 0 4px 12px` | Button hover |

### Border Radius

8px buttons, 14px badges, 20px cards, 32px large containers, 50% circles

### Interactive Details

- **Endorsed badge**: tick icon crossfades to thumbs-up on hover
- **Luminary badge**: star icon crossfades to thumbs-up on hover, purple laser glow (`box-shadow`) on hover
- **Dark pills**: hover transitions from `#222` to Rausch Red
- **Listing cards**: photography-first with subtle scale-up on image hover

## Deployment

The site builds to static HTML and is deployed via Cloudflare Pages:

- Automatic builds on push to `main`
- Image optimisation at build time via Sharp
- `_redirects` file for URL redirects
- Worker deployed separately via `wrangler deploy`

## Listing Sort Order

Listings are randomised at build time (Fisher-Yates shuffle) within tier priority groups:

1. **Luminary** — always first
2. **Endorsed** — after luminary
3. **Registered** — after endorsed

On location pages, local celebrants appear before Australia-wide travellers within each tier group. Each build produces a different random order for fairness.
