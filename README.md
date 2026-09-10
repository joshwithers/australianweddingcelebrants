# Australian Wedding Celebrants

Australian Wedding Celebrants is a free public directory of Australian marriage
celebrants. It publishes member profiles, publisher-issued and human-verified
credentials, location and travel discovery, an awards yearbook, machine-readable
content for search and AI agents, and an open correction route.

This README is the primary technical and operational handover for humans and
coding agents. It explains what is live, how the repository works, which decisions
must be preserved, and how to release changes safely. Start here, then use the
[documentation index](docs/README.md) and the
[deployment runbook](docs/deployment.md) for operational detail.

**Canonical site:**
[australianweddingcelebrants.com.au](https://australianweddingcelebrants.com.au)

**Public API and agent service:**
[api.australianweddingcelebrants.com.au](https://api.australianweddingcelebrants.com.au/mcp)

**Repository:**
[github.com/joshwithers/australianweddingcelebrants](https://github.com/joshwithers/australianweddingcelebrants)

## Start here

The production system has two independently deployed units:

| Unit              | Source                                              | Runtime                                              | Production target                                                 | Deploy when                                                                     |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Public site       | `src/`, `public/`, `functions/`, root build scripts | Astro static output plus a Cloudflare Pages Function | Pages project `australianweddingcelebrants`                       | Site, content, generated-output, headers, redirects or Pages middleware changes |
| API/agent service | `worker/`                                           | Cloudflare Worker with KV and a cron trigger         | Worker `awc-listings` at `api.australianweddingcelebrants.com.au` | Worker logic, routes, bindings, variables or Worker dependencies change         |

The site is not the Worker and a Worker upload does not publish the site. A push
to `main` normally triggers the Git-integrated Pages project, but release evidence
still requires checking the active deployment and the live custom domain. See
`docs/deployment.md` for the exact sequence and the direct-upload fallback.

### Current repository snapshot

Verified from the repository on 10 September 2026:

- 66 published celebrant profiles: 10 Luminary, 13 Endorsed and 43 Registered.
- 67 directory source files including the draft `-template.md`.
- 58 location blurbs.
- 19 Node regression tests.
- 152 generated HTML files in the most recent local build, with 150
  sitemap-listed HTML/Markdown pairs. Generated counts can change as routes and
  profiles change; rerun `npm run validate` rather than treating these as constants.
- No published profile currently stores `accepts_agent_enquiries: true`; the A2A
  email relay therefore remains blocked for every profile until a celebrant
  explicitly opts in.

## Documentation rule for every future change

Documentation is part of the definition of done. Future contributors and agents
must update the handover in the same work whenever behaviour, architecture,
content policy, dependencies, commands or deployment changes.

- Update this README for repository-wide behaviour and operational assumptions.
- Update `docs/deployment.md` for release commands, Cloudflare settings, domains,
  bindings, secrets or smoke tests.
- Add a dated entry to `docs/project-history.md` for material work. Include the
  problem, implementation, lasting invariant, validation, and any known commit or
  deployment IDs.
- Update `worker/README.md` or `scripts/README.md` when those areas change.
- Update `docs/README.md` when the documentation set changes.
- Verify drift-prone claims such as counts, versions and active deployments before
  writing them. Date snapshots instead of making them sound permanent.

`AGENTS.md` makes this rule explicit for coding agents. `CLAUDE.md` contains the
compact implementation notes used by Claude-based agents. A release is incomplete
when implementation and documentation disagree.

## Technology

Versions below are the installed versions recorded by `package-lock.json` on 10
September 2026. `package.json` remains the authority for accepted version ranges.

| Technology        | Version              | Role                                                                                               |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| Node.js           | `>=22.12.0`          | Build and test runtime; `.node-version` selects major 22                                           |
| Astro             | 7.3.2                | Static generation, routing, Content Layer, assets, fonts and view transitions                      |
| React / React DOM | 19.2.8               | MDX shortcodes that need React; search itself is now an Astro component with a small native script |
| Tailwind CSS      | 4.3.3                | CSS-first design tokens via `@tailwindcss/vite`                                                    |
| TypeScript        | 6.0.3                | Type checking for Astro and TypeScript code                                                        |
| Sharp             | 0.35.4               | Build-time local image optimisation                                                                |
| sanitize-html     | 2.17.7               | Safe generated Markdown/content conversion                                                         |
| Wrangler          | 4.130.0 in `worker/` | Cloudflare Pages and Worker inspection/deployment                                                  |
| Resend            | HTTP API             | Magic links, workflow email, admin mail and A2A relay mail                                         |
| Anthropic         | HTTP API / SDK       | Submission cleanup, bio editing and award-title drafting                                           |

Fuse.js was removed in commit `b128ad8`. Do not reintroduce it based on older
documentation: `src/layouts/SearchBar.astro` performs case- and diacritic-normalised
term matching in the browser and uses delegated events that survive
`<ClientRouter />` navigation.

## Repository map

```text
.
├── AGENTS.md                  # Mandatory agent workflow and project invariants
├── CLAUDE.md                  # Compact implementation context for Claude agents
├── README.md                  # Primary project and operations handover
├── astro.config.mjs           # Astro, integrations, fonts, image and build config
├── functions/
│   └── _middleware.js         # Pages content negotiation: HTML ↔ Markdown
├── public/
│   ├── _headers               # Discovery/content-type headers
│   ├── _redirects             # MCP and legacy URL redirects
│   ├── robots.txt             # Crawl policy and Content-Signal directive
│   └── .well-known/           # API, MCP, A2A and Agent Skills discovery files
├── scripts/                   # Build gates, generators and content/image utilities
├── src/
│   ├── assets/directory/      # Local images processed by astro:assets
│   ├── components/            # Listings, profiles, tiers, gallery, awards, masonry
│   ├── config/                # Site metadata, navigation, theme and social config
│   ├── content/
│   │   ├── directory/         # One Markdown/MDX source per celebrant
│   │   ├── location-blurbs/   # SEO copy for generated location pages
│   │   └── pages/             # Curated static-page content
│   ├── content.config.ts      # Astro Content Layer loaders and Zod schemas
│   ├── layouts/               # Root layout, navigation and MDX shortcodes
│   ├── lib/                   # Provenance, editorial registry and shared utilities
│   ├── pages/                 # Public routes and machine-readable endpoints
│   └── styles/                # Tailwind theme plus project CSS
├── tests/                     # Build-output and utility regression tests
└── worker/
    ├── src/index.js           # Auth, submission, admin, mail and router
    ├── src/mcp.js             # Public read-only MCP server
    ├── src/a2a.js             # A2A search/enquiry service and abuse controls
    ├── src/directory.js       # Shared public-directory data loader
    ├── src/widgets.js         # ChatGPT Apps SDK widget resources
    └── wrangler.toml          # Worker variables, KV binding, observability and cron
```

Build output goes to `dist/` and is deliberately untracked. Astro cache output,
Wrangler local state, environment files and `.dev.vars` are also untracked.
Documentation and Worker source are tracked; `.gitignore` must not hide either.

## Public-site architecture

### Build pipeline

`npm run build` is more than `astro build`. The sequence is load-bearing:

1. `scripts/generate-agent-skills-index.mjs` regenerates the public Agent Skills
   index from the checked-in skill files.
2. Astro builds the static site into `dist/`, including the sitemap and specialised
   homepage/profile Markdown endpoints.
3. `scripts/generate-markdown.mjs` reads the final sitemap and final `<main>` HTML,
   preserves specialised Markdown routes, generates missing companions, carries
   editorial authorship into frontmatter, adds publisher/correction provenance,
   and rebuilds the exact `llms.txt` page inventory.
4. `scripts/check-markdown-output.mjs` fails the build unless sitemap URLs,
   canonicals, Markdown alternates, files, author data, listing links and
   `llms.txt` entries agree.

Do not replace the build command with a bare `astro build`; doing so bypasses the
agent-readable generation and parity gate.

### Pages middleware

`functions/_middleware.js` runs on Cloudflare Pages. For `GET` and `HEAD` requests
whose `Accept` header contains `text/markdown`, it maps the canonical HTML path to
its `.md` companion, returns `text/markdown`, adds `X-Markdown-Tokens`, and varies
the response on `Accept`. Normal browser requests continue to receive HTML.
Direct `.md` URLs also work through the static output and `public/_headers`.

### Rendering and client behaviour

- `src/layouts/Base.astro` owns metadata, canonical and Markdown-alternate links,
  Open Graph/Twitter tags, WebSite/publisher JSON-LD, fonts, `<ClientRouter />` and
  the cookieless GA4 boundary.
- `src/layouts/partials/Header.astro` uses delegated events and
  `astro:page-load`, so the mobile menu survives document swaps.
- `src/components/MasonryGrid.astro` implements one-DOM responsive masonry with
  measured card heights, one-pixel grid rows, `ResizeObserver` and
  `astro:page-load`. Each celebrant must appear only once in the DOM.
- `src/components/DirectoryItem.astro` uses Astro `<Image>` for local assets and a
  normal `<img>` plus cached dimensions for external URLs. The first important
  card may be eager/high priority. Card images retain natural aspect ratios.
- `src/layouts/SearchBar.astro` renders all candidate cards at build time and
  filters them in a small native client script. It requires at least two useful
  characters and updates the query string without navigation.
- Repeated behaviour belongs in shared components or CSS. Animations must honour
  `prefers-reduced-motion`.

## Routes and public surfaces

### Human-facing routes

| Route                                                     | Purpose                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `/`                                                       | Homepage and featured/tiered directory entry point                   |
| `/directory/`                                             | Complete directory                                                   |
| `/directory/<slug>/`                                      | Individual profile                                                   |
| `/directory/location/<slug>/`                             | Location-specific listings and optional regional blurb               |
| `/luminaries/`, `/endorsed/`, `/registered/`              | Credential-tier landing pages                                        |
| `/australia-wide/`                                        | Celebrants who travel nationally                                     |
| `/destination-wedding-celebrants/`                        | Celebrants marked for international work                             |
| `/awards/`                                                | Awards yearbook grouped newest-first                                 |
| `/awards/nominate/`                                       | Public nomination workflow backed by the Worker                      |
| `/search/`                                                | Client-side directory search                                         |
| `/ai/`                                                    | Plain-English explanation of AI/agent access and enquiry consent     |
| `/connect/`                                               | Instructions for connecting compatible agents                        |
| `/tools-for-celebrants/`                                  | Editorial resource page                                              |
| `/about/`, `/tiers/`, `/contact/`, `/privacy/`, `/terms/` | Publisher, standards, correction, privacy and legal information      |
| `/submit/`                                                | Redirect/entry point to the Worker login flow; excluded from sitemap |

Profile slugs must be resolved through `src/lib/utils/entrySlug.ts`. A source file
may set an explicit `slug:` override. Every profile URL generator—static paths,
cards, JSON-LD, Markdown, `llms.txt` and `directory.json`—must use that helper so
routes and inbound links cannot drift.

### Machine-readable surfaces

| Route                                  | Contract                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/directory.json`                      | Public structured directory used by the Worker; tier and agent-enquiry consent are explicit fields |
| `/index.md`, `/<route>.md`             | Direct Markdown companions for every sitemap URL                                                   |
| `/llms.txt`                            | Short site summary plus exact Markdown inventory                                                   |
| `/llms-full.txt`                       | Full directory-oriented text export                                                                |
| `/sitemap-index.xml`                   | Sitemap index generated by Astro                                                                   |
| `/rss.xml`                             | Editorial RSS feed with author parity                                                              |
| `/robots.txt`                          | Open crawling plus `ai-train=no, search=yes, ai-input=yes` Content Signal                          |
| `/.well-known/api-catalog`             | RFC 9727 API catalogue                                                                             |
| `/.well-known/mcp/server-card.json`    | MCP discovery metadata                                                                             |
| `/.well-known/agent-card.json`         | A2A agent card                                                                                     |
| `/.well-known/agent-skills/index.json` | Agent Skills discovery index                                                                       |
| `/auth.md`                             | Explicit anonymous-access contract for public agent interfaces                                     |

`public/_headers` advertises discovery links and sets MIME types/CORS. Keep direct
discovery, MIME types, crawler access, canonical relationships and sitemap parity
working together; a generated file alone is not a complete agent-readiness change.

## Content model

Astro Content Layer collections are defined in `src/content.config.ts` using
explicit `glob()` loaders and Zod 4 from `astro/zod`.

| Collection       | Source                             | Purpose                                                                                                     |
| ---------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `directory`      | `src/content/directory/*.{md,mdx}` | Celebrant profiles and credential data                                                                      |
| `locationBlurbs` | `src/content/location-blurbs/*.md` | Optional regional copy for location routes                                                                  |
| `pages`          | `src/content/pages/*.{md,mdx}`     | Curated static-page content                                                                                 |
| `about`          | `src/content/about/-*.{md,mdx}`    | About-page data; leading hyphen is intentional because underscore-prefixed files are excluded by the loader |

### Directory fields

Core profile fields include:

- Identity/content: `title`, `meta_title`, `description`, Markdown body, optional
  `slug` and `draft`.
- Media/contact: `image`, `logo`, `website`, `email`, `phone`, `address` and
  `social.{facebook,instagram,pinterest}`.
- Discovery: `location[]`, `category[]`, `featured`, `australia_wide` and
  `international`.
- Credential: `tier` plus optional `tier_evidence_source`,
  `tier_evidence_url`, `tier_evidence_last_checked` and `tier_evidence_note`.
- Agent email: optional `accepts_agent_enquiries`; only literal `true` opts in.
- Enhanced profile: `youtube`, up to three `gallery` images,
  `background_color`, up to three `testimonials`, `year_started` and `awards[]`.

Use `src/content/directory/-template.md` as the editing template. Never copy
private evidence into frontmatter. Prefer local assets under `src/assets/directory`
so Astro can optimise them and emit intrinsic dimensions. If an external image is
unavoidable, run the external-image probe described in `scripts/README.md`.

### Adding or updating a celebrant

The normal production flow is through the Worker:

1. The celebrant requests a magic link at the Worker login page.
2. The authenticated form creates or updates a submission.
3. The Worker stores the submission/media in KV, optionally improves copy through
   Anthropic, and notifies the administrator.
4. The administrator reviews the exact content and tier, then approves or rejects.
5. Approval writes the Markdown profile and any assets to `main` through the
   GitHub Contents API.
6. Git integration starts a Pages build; the Worker schedules the celebrant
   notification for roughly 15 minutes later.

For a manual edit, change the existing profile or copy `-template.md`, validate all
URLs and public claims, then run the full release gate. New content can alter route,
sitemap, `llms.txt`, location and structured-data counts.

### Credentials and evidence

`registered`, `endorsed` and `luminary` are credentials issued and human verified
by Australian Wedding Celebrants against its published standards. They are not
paid placement or an external certificate.

| Tier       | Visual            | Summary of current standard                                                                                   |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Registered | Grey              | Commonwealth-authorised celebrant, Certificate IV or equivalent, and complete profile                         |
| Endorsed   | Magenta `#92174d` | 3+ years, insurance, extra professional development, 6+ couple reviews, 3+ vendor reviews and 100+ ceremonies |
| Luminary   | Purple `#460479`  | 7+ years, 18+ couple reviews, 9+ vendor reviews, industry recognition and contribution                        |

The credential remains valid when optional external-evidence fields are absent.
When separate external evidence is published, include a public source and
last-checked date, and keep the summary safe for public display. Structured data
may emit `EducationalOccupationalCredential` under
`ProfilePage.mainEntity.hasCredential`, but must not infer `jobTitle`, an `Offer`,
availability or current commercial activity.

Do not add blanket labels such as “profile statement”, “profile-listed” or “not
independently verified”. Profile provenance instead names the responsible
publisher, Australian Wedding Celebrants as credential issuer/human verifier, and
the no-sign-in correction route at `/contact/#profile-corrections`.

### Awards

Two fields feed the awards system:

- `awards[]` contains free-text recognition with required `title` and `year`, plus
  optional `emoji`, `region` and `note`.
- `year_started` lets `src/lib/utils/awards.ts#deriveAwards` generate the synthetic
  `Class of <year>` award.

`deriveAwards` is the single display source for the profile Trophy Shelf, directory
card marker and `/awards/` yearbook. Explicit awards rank above the synthetic entry
when their years match. Titles intentionally have no enum and do not automatically
create award-category landing pages.

## Structured data, authorship and search integrity

- `src/lib/siteProvenance.ts` is the source of truth for the responsible publisher,
  canonical site and correction URLs.
- `src/lib/tierStandards.ts` and `src/lib/utils/tierCredential.ts` centralise tier
  definitions and credential output.
- Profile `Person` data nests service areas under
  `makesOffer.itemOffered` as `Service.areaServed`. Do not put `areaServed`
  directly on `Person`.
- Original editorial pages are registered in `src/lib/editorial.ts`. An explicit
  author wins; otherwise those editorial pages fall back to Frankie consistently
  across visible byline, meta author, Article JSON-LD, RSS and Markdown.
- Never apply the editorial fallback to directory records, profiles or paid
  listings.
- `src/lib/utils/socialUrl.ts` strips common tracking parameters at the schema
  boundary while preserving functional parameters. Do not clean one profile only
  when the rule belongs in the shared normaliser.
- Legacy redirects in `public/_redirects` use path-only Pages patterns. Cloudflare
  Pages does not match query parameters in redirect source patterns; keep exact
  path rules before wildcards.

## Privacy and analytics boundary

The public `Base.astro` layout loads GA4 measurement ID `G-DCYE3SSJQV` with a
cookieless Consent Mode boundary:

- analytics storage, advertising storage, user data and ad personalisation default
  to denied before `gtag.js` loads;
- Google signals and ad personalisation are disabled;
- query strings are excluded from `page_location`;
- referrers are reduced to origin;
- no consent update, analytics cookie, local-storage identifier or consent banner
  is used.

Private Worker login, account and admin pages do not use `Base.astro` and must not
load the public analytics tag. Tests inspect the built HTML for this exact boundary.

Agent-relayed enquiries are separately consented. Missing or `false`
`accepts_agent_enquiries` values must remain `false` in `/directory.json` and must
be rejected by the Worker before mail is sent.

## Worker architecture

The Worker is documented fully in `worker/README.md`. Its main responsibilities
are:

- passwordless magic-link authentication and 24-hour sessions;
- authenticated listing submission and media/evidence staging in KV;
- Anthropic-assisted copy cleanup and interactive bio editing;
- admin dashboards, review, rejection, direct profile editing and GitHub writes;
- Resend notifications and carefully controlled bulk admin mail;
- public award-nomination drafting and admin delivery;
- public, anonymous, read-only MCP tools backed by the site's `directory.json` and
  Markdown profiles;
- A2A search and optional enquiry relay with explicit celebrant opt-in, per-IP and
  per-celebrant limits, report-spam links and blocking;
- a five-minute cron that processes delayed approval mail and debounces a weekly
  A2A digest.

The Worker uses one KV namespace. Secrets are `RESEND_API_KEY`,
`ANTHROPIC_API_KEY` and `GITHUB_TOKEN`; set them with Wrangler and never place
their values in source, docs, shell history or client bundles.

## Local development

### Prerequisites

- Node.js 22.12.0 or later in the Node 22 line.
- npm.
- Cloudflare authentication only for remote inspection/deployment.
- Anthropic credentials only for scripts or Worker flows that actually call it.

### Install and run the site

```sh
npm ci
npm run dev
```

Astro serves the development site on `http://localhost:4321` by default.

### Commands

| Command                            | What it proves or changes                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev`                      | Starts Astro development server                                                                   |
| `npm run check` / `npm run lint`   | Runs Astro and TypeScript diagnostics                                                             |
| `npm run build`                    | Regenerates agent index, builds Astro, generates Markdown companions and checks their parity      |
| `npm test`                         | Runs a fresh production build, then all `tests/*.test.mjs`                                        |
| `npm run check:agent-files`        | Validates `llms.txt`, Content Signal and anonymous `auth.md` contract in `dist/`                  |
| `npm run check:dns-aid`            | Checks live DNS-AID and DNSSEC through Google DNS-over-HTTPS                                      |
| `npm run check:links`              | Scans built HTML for missing internal files/routes                                                |
| `npm run validate`                 | Full release gate: diagnostics, build/tests, agent files, links and `npm audit --audit-level=low` |
| `npm run preview`                  | Serves the generated site locally                                                                 |
| `npm run format`                   | Mutates files with Prettier; inspect the diff before committing                                   |
| `npm run generate:location-blurbs` | Calls Anthropic for missing regional blurbs unless dry-run flags are used                         |
| `npm run probe:external-images`    | Refreshes dimensions for remote profile images                                                    |
| `npm run offline:external-images`  | Downloads remote images and rewrites profile frontmatter; review carefully                        |

See `scripts/README.md` before running a mutating or paid generator.

### Run the Worker locally

```sh
cd worker
npm ci
npm run dev
```

Use local `.dev.vars` for development secrets and never commit it. Remote KV or
email/GitHub operations can affect real data and people; keep tests and smoke calls
read-only unless the task explicitly authorises those effects.

## Validation and release standard

For a site change, the normal release gate is:

```sh
npm run validate
git diff --check
```

For a Worker change, also run from `worker/`:

```sh
npm ci
npx wrangler deploy --dry-run
```

Then inspect the diff, commit only authorised files, fetch/rebase if necessary,
push, prove local/remote SHA parity, identify the active Cloudflare deployment for
that SHA, and test the immutable deployment plus canonical production routes.

Production verification must cover the surfaces affected by the change. A broad
site release normally checks the homepage, directory, one profile, direct and
negotiated Markdown, `llms.txt`, sitemap, robots, discovery files, privacy/terms,
canonical redirects and absence of `Set-Cookie`. A Worker release checks `/mcp`,
`/a2a`, the OpenAI challenge, `/login`, deployment/version state and any changed
negative authorization or consent path.

The full commands, account/project identifiers, fallback deployment and rollback
procedures are in `docs/deployment.md`.

## Cloudflare deployment summary

### Pages

- Account: `Withers Co Account`
- Account ID: `60ef6bd2c48d5beb6fd6a093cff863cf`
- Project: `australianweddingcelebrants`
- Production branch: `main`
- Build output: `dist`
- Primary Pages domain: `australianweddingcelebrants.pages.dev`
- Canonical custom domain: `australianweddingcelebrants.com.au`
- Git provider: connected; pushes to `main` currently create production builds
- Downloaded production compatibility date on 10 September 2026: `2026-04-01`

The project also has `celebrant.directory`, `celebrant.xyz`,
`celebrants.directory`, `celebrants.net.au`, `celebrants.xyz` and selected `www`
hosts attached. They currently serve the Pages project; canonical metadata points
to `australianweddingcelebrants.com.au`. Do not assume every alias redirects.

### Worker

- Account: the same Withers Co account
- Worker name: `awc-listings`
- Custom domain: `api.australianweddingcelebrants.com.au`
- Config: `worker/wrangler.toml`
- KV binding: `KV`
- Cron: `*/5 * * * *`
- Observability: invocation logs and traces enabled

The site and Worker have independent version histories. Do not report the release
complete until every changed unit is deployed and live-verified.

## Known traps and regression shields

- An active Pages row can appear before the immutable URL or custom domain has
  converged. Check both, allow propagation, and cache-bust representative requests.
- HTML and `.md`/`llms.txt` can propagate at different speeds. Verify each format.
- `_redirects` cannot match source query strings. Use path-only rules.
- A valueless custom data attribute may be omitted from the live DOM; masonry uses
  `data-masonry-grid="true"` deliberately.
- Listing cards use text-less stretched links and may replace visible names with
  logos. The Markdown generator must preserve their `aria-label` as link text.
- Location and tier pages use shared masonry. Fix shared behaviour rather than one
  page, and keep each profile link unique in the DOM.
- External image URLs skip Astro optimisation. Prefer local assets; otherwise keep
  the dimension cache current to avoid layout shifts.
- Build and validation regenerate `dist/`, which is ignored. Inspect source diffs,
  not generated-output noise.
- The Worker writes approved profiles directly to `main`. A concurrent remote
  commit can make a local push stale; fetch/rebase, never force-push over it.
- Counts in old submission documents drift. Derive current counts from source or
  `list_all_celebrants` immediately before publishing them.

## Project history and decision record

The detailed chronology is in `docs/project-history.md`. The most important recent
milestones are:

- Astro 7 migration, post-upgrade audit and native search rewrite (`9d76ac9`,
  `6e645ef`, `b128ad8`).
- DNS-AID and public agent-discovery hardening (`bb0222b`).
- One-DOM masonry restoration, correct Service schema placement and central social
  tracking cleanup (`7dac46e`, `0ad0593`, `c123a2a`).
- Markdown companions and `llms.txt` parity for every sitemap page, legacy redirect
  repair, and listing-link preservation (`9cbd3a1`, `3052e8f`, `0bc3bb7`).
- Editorial authorship, responsible-publisher provenance, cookieless analytics,
  credential modelling and direct profile language (`9e4b4d6`, `8c02511`,
  `e924d6a`, `3df38b5`).
- Homepage render prioritisation and fully inlined site styles (`48e2823`,
  `e57f882`).

## Documentation map

- `docs/README.md` — status and ownership of every documentation artefact.
- `docs/deployment.md` — complete Pages and Worker release runbook.
- `docs/project-history.md` — implemented work, decisions, regressions and evidence.
- `worker/README.md` — Worker behaviour, routes, storage and operational safety.
- `scripts/README.md` — generators, build gates and one-off utilities.
- `docs/chatgpt-app-listing.md` — time-sensitive ChatGPT app submission material.
- `docs/celebrant-email-ai-update.md` — draft celebrant communication; verify the
  opt-in state and product behaviour before any send.
- `worker/claude.md` — proposed autonomous maintenance/outreach system; it is a
  future-work design, not a description of deployed functionality.

## Credits and licence

Built by [Josh Withers](https://joshwithers.au) of
[Married by Josh](https://marriedbyjosh.com.au), with SEO work by
[Unpopular](https://unpopular.au) and development by
[The Internet](https://theinternetcom.au).

The root package declares the MIT licence. Confirm asset and profile-content rights
separately; the code licence does not grant permission to reuse celebrant photos,
bios or personal information.
