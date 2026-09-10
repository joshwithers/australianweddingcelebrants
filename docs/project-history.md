# Project history and architecture decisions

This is the durable handover record for material work on Australian Wedding
Celebrants. It explains why the current code looks the way it does, what each major
change protected, and which release evidence exists. Git is still the complete
record of ordinary profile and asset updates.

Entries are chronological by implementation period. Deployment evidence is
included only where it was recorded and verified; an absent deployment ID must not
be read as proof that a change was or was not deployed.

## April 2026 — directory foundation and visual system

### Initial Astro directory and public/legal pages

The repository began at `bcfa355` on 7 April 2026 as a static Astro wedding
celebrant directory. Early work established the public footer/repository link,
terms and privacy pages, individual profile content and asset-backed listing cards.

The styling moved from Sass to Tailwind CSS 4 and project CSS modules at `993af44`.
The lasting rule is that Tailwind is integrated through `@tailwindcss/vite` and
CSS-first theme tokens; older Tailwind JavaScript configuration should not be
reintroduced.

### Natural images, premium profiles and reusable masonry

Performance and layout work at `1534d65` and `04b0546` removed forced card-image
heights in favour of natural aspect ratios. The Astro 6 modernisation at `0937e87`
was followed by tier-aware premium profile layouts at `c1fe1fb`, larger Luminary
hero media, shared travel/tier badges, optional cross-promotion, and custom profile
background colours (`3e5256c`).

`f7630fd` centralised listing layout in a reusable masonry component. Gallery and
YouTube features were extended across tiers at `e70f623`.

Lasting invariants:

- profile/card images are photography-first and retain their natural ratio;
- repeated listing layout belongs in the shared masonry component;
- enhanced fields are optional and the profile layout must degrade cleanly;
- visual tier differences must not change the underlying credential meaning.

### Location discovery and image stability

`e35f67d` introduced generated location blurbs and `3dd6066` documented their
generator. `a576184` added directory structured data and location maps. External
image probing and local offlining followed at `a8a86c7` and `8cf7e4d`.

The architecture prefers local images so Astro can optimise them and emit
intrinsic dimensions. External images remain supported but must use
`src/data/external-image-dimensions.json` to reduce layout shifts. Location blurbs
are durable source content: the generator skips existing files unless explicitly
forced, so human edits survive normal runs.

### Awards and yearbook

`65478df` added free-text awards, profile presentation and structured data.
`1d4a629` added `year_started` and synthetic `Class of <year>` recognitions.
`60934f2` connected the public nomination form to a two-step Anthropic-assisted
Worker workflow; later commits refined the copy and awards page.

`src/lib/utils/awards.ts#deriveAwards` is the single source of truth for profile,
card and yearbook display. Award titles intentionally remain open text rather than
an enum, and explicit awards rank above synthetic class entries when years tie.

## April–May 2026 — agent discovery and Worker services

### Public machine-readable and agent surfaces

The first agent-readable Markdown/API support landed at `080e923`. Follow-up work
added WebMCP (`afd7f1e`), an RFC 9727 API catalogue (`5e4b6ee`), MCP discovery
metadata (`21a96b8`), generated Agent Skills discovery (`59c67e6`), an AI/agent
explainer and A2A card (`ecfa99d`), and A2A protocol corrections (`58875c6`).

The `/connect/` page and MCP entry point were added at `38b4cd8` in May.

The public agent interfaces are intentionally anonymous and read-only unless the
separate A2A enquiry capability is used. July hardening commits `714c5f8`,
`4c3432a` and `fd03183` made the no-registration/no-credentials contract explicit.

Lasting invariants:

- public search/profile tools do not require OAuth, registration or an
  `Authorization` header;
- discovery metadata, direct endpoints, MIME types and human documentation must
  describe the same contract;
- an agent search capability never implies authority to contact a celebrant;
- enquiry delivery is a separate write/external-effect path with explicit stored
  celebrant consent and abuse controls.

### Worker submission, admin and communication flow

The Worker evolved into a combined passwordless submission/admin service and
agent gateway. It stores short-lived magic links, sessions, submissions, staged
media/evidence, usage counters, notification jobs, listing caches and email records
in KV. It calls Resend for email, Anthropic for copy assistance, and GitHub's
Contents API to publish reviewed profile source/assets to `main`.

The cron runs every five minutes. It processes delayed post-approval notifications
and, at Monday 09:00 UTC, uses a KV guard to send a weekly A2A enquiry digest once.

The A2A enquiry path applies per-IP, per-IP/per-celebrant and global per-celebrant
limits, supports report-spam links, temporary IP bans and permanent agent-name
blocking after repeated reports. It must reject a missing or false
`accepts_agent_enquiries` value before mail is sent.

The last Worker deployment visible before this documentation audit was version
`a78cce29-82e5-4abf-b6fe-2b37ef52c75e`, created 30 August 2026. Re-query Wrangler
before treating that as current.

## July 2026 — Astro 7 migration and regression hardening

### Astro 7 and dependency cleanup

`9d76ac9` upgraded the site to Astro 7. `6e645ef` fixed issues found in the
post-upgrade audit. `b128ad8` removed Fuse.js, rewrote search in Astro/native
JavaScript, and improved image handling.

The repository now uses current Content Layer loaders, `astro/zod`, Astro Fonts,
`<ClientRouter />`, and Tailwind 4. Do not restore older Astro collection or
hydration patterns from historical examples.

### DNS-AID

`bb0222b` published DNS for AI Discovery. The release gate now includes an
on-demand `npm run check:dns-aid`, which verifies the HTTPS ServiceMode record and
DNSSEC chain through Google Public DNS's DNS-over-HTTPS endpoint. DNS-AID is live
infrastructure and is intentionally not part of every offline build.

### Privacy and directory independence

`3f2aa0b` removed duplicate rendered profile/link structures to protect profile
privacy and directory independence. A normal row-based grid introduced during
that work accidentally removed the intended masonry effect.

`7dac46e` restored masonry without restoring duplicate DOM. The implementation
uses measured heights, one-pixel auto rows, 1/2/3-column responsive layout,
`ResizeObserver`, resize handling and `astro:page-load`. A valueless
`data-masonry-grid` marker disappeared in the live Astro DOM; the explicit
`data-masonry-grid="true"` value is required.

Validation recorded at the time: 151 pages, zero Astro diagnostics, responsive
desktop/tablet/mobile browser checks, no console errors or horizontal overflow.
Commit `7dac46ea6d43deaafd0b7c82e02321b526cf03f5` was pushed with local/remote SHA
parity.

### Schema service areas

`0ad0593` moved `areaServed` from `Person` to the nested `Service` under
`Person.makesOffer.itemOffered` in both profile and directory structured data.
Regression tests require no `Person.areaServed` and service-area data on the
Service.

Validation recorded at the time: 151-page build, zero diagnostics, seven tests,
and 65 directory Person nodes checked. Commit
`0ad0593de12913ec787f16b22c8ec171d3f03261` was pushed with SHA parity.

### Central social URL cleaning

`c123a2a` added `src/lib/utils/socialUrl.ts` and applies it at the content-schema
boundary for Facebook, Instagram, Pinterest and YouTube. It strips Instagram share
IDs, `utm_*`, `fbclid`, `mibextid`, YouTube `si`/`feature`, TikTok share values and
other common tracking IDs while preserving functional parameters such as YouTube
`v`/`list` and Facebook `id`.

This fixed several source profiles, including Renee Paxton. The durable decision is
to correct reusable data hygiene at ingestion/schema boundaries rather than
hand-clean a single rendered link.

Validation recorded at the time: ten tests, zero Astro diagnostics, 151 pages, and
no target tracking parameters in source or generated output. The final relevant
commit was `c123a2a849317858ccc695e9c11eff9730b56cfd`.

## August 2026 — complete Markdown coverage and production provenance

### One Markdown companion per sitemap page

`9cbd3a1` made Markdown generation a required part of `npm run build`. Every
sitemap-listed canonical HTML URL receives a route-matched Markdown companion,
direct `.md` access, canonical/alternate discovery and an exact `llms.txt`
inventory. `functions/_middleware.js` added `Accept: text/markdown` negotiation.

`3052e8f` repaired legacy Pages redirects. The important discovery was that Pages
does not match query parameters in redirect source patterns; legacy PHP routes use
path-only rules, with exact rules before wildcards.

`0bc3bb7` corrected ten follow-up defects, including a serious Markdown conversion
failure: text-less stretched card links and logo-only premium card headings caused
names and profile URLs to disappear from generated tier/directory companions. The
generator now falls back to an anchor's accessible name and the build gate requires
all rendered celebrant links to remain in generated Markdown.

Recorded release evidence:

- 150 sitemap pages and 150 Markdown companions validated locally and live;
- 152 generated HTML pages in the release build;
- internal links/assets, crawler access, MIME types, canonical relationships,
  `llms.txt` and four named crawler user agents checked;
- final direct Pages deployment for redirect fixes:
  `912fdaa4-0a51-40ac-b445-7e83b17a1209`, source `3052e8f`;
- response p50/p95 observed around 345/432 ms. These were HTTP timings, not Core
  Web Vitals and must not be described as LCP, INP or CLS.

During that release, a Git-connected Pages deployment appeared active while its
immutable URL returned `404`; a direct upload was required. This is why the current
runbook verifies control-plane status, immutable URL and custom domain separately.

### Editorial authorship

`9e4b4d6` attributed original editorial content to Frankie and added a
machine-readable author node. The author resolver in `src/lib/editorial.ts`
preserves explicit authors and applies the fallback only to registered original
editorial pages. Visible byline, meta author, Article JSON-LD, RSS and Markdown must
stay in parity. Directory records and profiles are not editorial articles and must
never receive this fallback.

### Publisher provenance and cookieless measurement

`8c02511` added responsible-publisher and public-correction provenance across human
and machine-readable surfaces, together with GA4 measurement that keeps all
Consent Mode storage/data/personalisation defaults denied. Google signals and ad
personalisation are off, query strings are removed from page locations, referrers
are origin-only, and the site creates no analytics identifier or consent update.

The responsible publisher is Withers XYZ Pty Ltd as trustee for the Snow Withers
Trust (ABN 37 709 073 991). Public correction/profile-update access is available at
`/contact/#profile-corrections` without sign-in.

### Credential and evidence language

`519687f` tightened the treatment of claims that depend on external evidence.
`e924d6a` clarified the more important distinction: every stored tier is itself a
credential issued and human verified by Australian Wedding Celebrants. Optional
`tier_evidence_*` fields document separate evidence and are not prerequisites for
the publisher credential.

`3df38b5` removed blanket distancing phrases such as “profile statement”,
“profile-listed” and “not independently verified” from profile, travel, tier,
JSON, Markdown and LLM surfaces while preserving publisher/credential provenance
and conservative omissions of unsupported Offer, availability, job-title and
current-commercial-activity claims.

Recorded validation and deployment evidence for the final wording release:

- full `npm run validate` passed;
- 152 pages built, 150 Markdown companions checked, 19 tests passed;
- agent/internal-link checks passed and npm audit reported zero vulnerabilities;
- commit `3df38b5f9c700dc87837f93c39c78973f5083c3f`;
- Pages deployment `9de7ffff-de43-4658-a0ef-07a5f22d019e` became active from that
  exact commit;
- immutable and canonical HTML, representative Markdown/LLM, sitemap, robots,
  redirects, no `Set-Cookie`, GA4 denied defaults, empty cookies/storage and direct
  profile language were verified.

That release also showed split propagation: HTML updated before `.md` and
`llms.txt`. The runbook therefore treats each format as a separate live check.

### Homepage performance

`48e2823` prioritised homepage rendering. `e57f882` configured Astro to inline the
complete public stylesheet (about 13 KB at the time), removing the remaining
render-blocking stylesheet request. Do not undo this by adding a new external
critical stylesheet without measuring the effect and documenting the decision.

## September 2026 — durable documentation handover

On 10 September 2026 the existing README and component notes were audited against
source, package locks, generated output, Git history, Cloudflare Pages/Worker state
and live endpoints.

The audit found and corrected material documentation drift:

- the README still described Fuse.js and React search after the native Astro search
  rewrite;
- package versions, profile/tier counts and Worker route coverage were stale;
- deployment documentation omitted the Cloudflare account/project identifiers,
  independent release units, exact-SHA verification, immutable URL checks, direct
  Pages fallback and Worker version verification;
- `docs/celebrant-email-ai-update.md` described agent enquiries as default-on even
  though source, generated JSON, tests and Worker enforce explicit opt-in—and no
  published profile was opted in at audit time;
- most `docs/` files and the entire production `worker/` tree existed locally but
  were hidden by `.gitignore` and absent from the current Git index; only the
  ChatGPT submission aid was already tracked;
- Worker and scripts documentation did not cover the full current surface.

The result is a primary README, project-wide `AGENTS.md`, documentation index,
deployment runbook, this history, expanded Worker/scripts references, corrected
opt-in language, the production Worker source/config added to version control, and
an explicit rule that future material work updates its handover documentation
before release.

The first complete validation run also caught security advisories published for
the installed Astro, Sharp, `js-yaml` and SVGO versions. The release upgraded
Astro to 7.3.2 and Sharp to 0.35.4, refreshed patched transitive dependencies, and
upgraded the Worker toolchain to Wrangler 4.130.0. Wrangler's then-current
Miniflare dependency pinned the vulnerable Sharp patch, so `worker/package.json`
uses an npm override for Sharp 0.35.4. Both package trees must continue to pass
`npm audit --audit-level=low`; revisit and remove that override when Miniflare
adopts the fixed Sharp release directly.

Release validation, commit, Pages deployment and Worker deployment evidence for
this documentation release is reported in the task handover and can be recovered
from the first Git commit dated 10 September 2026 whose subject describes the
project handover documentation. The document does not embed its own SHA because a
commit cannot stably contain its final hash.

## How to maintain this history

Add a dated entry for material work, not every ordinary profile edit. Each entry
should answer:

1. What problem or request caused the change?
2. Which source/components/services changed?
3. What invariant or design decision should a future agent preserve?
4. What validation actually ran, including counts or negative paths where useful?
5. What Git SHA and Cloudflare deployment/version became active, once known?
6. What failed or surprised the release, and how should the next person respond?

Do not backfill guessed deployment IDs or rewrite a partial outcome as success.
Use `docs/deployment.md` to re-derive current production state.
