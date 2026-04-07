# Australian Wedding Celebrants

A professional and free directory of Australia's wedding celebrants, featuring a three-tier recognition system that highlights quality and professionalism in the industry. An anti-awards system.

---

Built by [Josh Withers](https://joshwithers.au) of ["Married by Josh"](https://marriedbyjosh.com.au) with SEO optimisation by [Unpopular](https://unpopular.au) and built by [The Internet](https://theinternetcom.au)

---

**Live site:** [australianweddingcelebrants.com.au](https://australianweddingcelebrants.com.au)

## Tech Stack

- **[Astro](https://astro.build)** v6 — static site generator with file-based routing
- **[React](https://react.dev)** v19 — interactive components (search, filtering)
- **[Tailwind CSS](https://tailwindcss.com)** v3 — styling with custom design tokens
- **[TypeScript](https://www.typescriptlang.org)** — type safety
- **[Fuse.js](https://www.fusejs.io)** — client-side fuzzy search
- **[Sharp](https://sharp.pixelplumbing.com)** — build-time image optimisation
- **[Cloudflare Workers](https://workers.cloudflare.com)** — backend API for celebrant submissions (separate deployment, see `worker/`)

## Project Structure

```
src/
├── assets/              # Local images processed by Astro
├── components/          # Astro & React components
├── config/              # Site configuration (JSON)
│   ├── config.json      # Site metadata, contact info, form endpoints
│   ├── menu.json        # Navigation menus
│   ├── theme.json       # Colours, fonts, design tokens
│   └── social.json      # Social media links
├── content/             # Content collections (Markdown/MDX)
│   ├── directory/       # Celebrant listings (~50 profiles)
│   ├── about/           # About page
│   └── pages/           # Static pages (contact, tiers, 404)
├── content.config.ts    # Collection schemas (Zod validation)
├── layouts/             # Page layouts, header, footer
│   ├── Base.astro       # HTML wrapper with SEO/meta tags
│   ├── partials/        # Header.astro, Footer.astro
│   ├── SearchBar.tsx    # Fuse.js search component
│   ├── DirectoryFilter.tsx  # Location filter with URL sync
│   └── shortcodes/      # MDX components (Button, Accordion, Tabs, etc.)
├── lib/utils/           # Helpers (slugify, date format, sorting, taxonomy)
├── pages/               # File-based routes
│   ├── index.astro      # Homepage
│   ├── directory/       # Directory listing & individual profiles
│   ├── search.astro     # Search results
│   ├── tiers.astro      # Tier system explanation
│   ├── llms.txt.ts      # LLM-friendly site content
│   └── ...
├── scripts/             # Client-side performance scripts
└── styles/              # Global SCSS (base, buttons, components, navigation)

worker/                  # Cloudflare Worker API (gitignored, deployed separately)
public/                  # Static assets (favicons, og-image, robots.txt)
```

## Tier System

Celebrants are recognised across three tiers based on experience, qualifications, and community contribution:

| Tier | Description |
|------|-------------|
| **Luminary** | Highest recognition — exceptional experience, qualifications, and industry contribution |
| **Endorsed** | Verified professionals meeting elevated standards |
| **Registered** | Listed celebrants meeting baseline requirements |

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

### Other Commands

```bash
npm run format     # Format code with Prettier
```

## Content Management

Celebrant listings live in `src/content/directory/` as Markdown files with YAML frontmatter. Each file represents one celebrant profile.

### Adding a Celebrant

Create a new `.md` file in `src/content/directory/` using the template at `-template.md`. Key frontmatter fields:

```yaml
---
title: "Celebrant Name"
description: "Short bio"
image: "https://..."        # Profile photo URL or local asset
logo: "https://..."         # Optional business logo
website: "https://..."
email: "hello@example.com"
phone: "0400 000 000"
location:
  - "Sydney"
  - "New South Wales"
tier: "registered"          # registered | endorsed | luminary
australia_wide: false
international: false
social:
  instagram: "https://instagram.com/..."
  facebook: "https://facebook.com/..."
draft: false
---

Celebrant's full bio and description in Markdown...
```

### Automated Submissions

Celebrants can self-submit via the Cloudflare Worker API at `api.australianweddingcelebrants.com.au`. Submissions go through an admin review process before being published as Markdown files via the GitHub API.

## Worker API

The backend API (`worker/`) handles:

- Magic-link authentication for celebrants
- Listing submission with AI-powered content cleanup
- Admin review and approval workflow
- Automated email notifications via [Resend](https://resend.com)
- GitHub integration for publishing approved listings

The worker is deployed separately to Cloudflare and is not included in the static site build. See `worker/README.md` for API documentation and setup.

## Configuration

| File | Purpose |
|------|---------|
| `astro.config.mjs` | Astro settings, integrations, markdown plugins |
| `tailwind.config.js` | Custom theme, colours, typography, grid system |
| `src/config/config.json` | Site title, URL, contact info, form endpoints |
| `src/config/theme.json` | Design tokens (colours, fonts, border radius) |
| `src/config/menu.json` | Header and footer navigation |
| `tsconfig.json` | TypeScript config with `@` path alias |

## Deployment

The site builds to static HTML and can be deployed to any static hosting. Currently deployed via Netlify with:

- `_redirects` file for URL redirects
- Automatic builds on push to `main`
- Image optimisation at build time via Sharp