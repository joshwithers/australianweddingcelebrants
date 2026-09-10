# Production deployment and verification runbook

This runbook is the operational source of truth for releasing Australian Wedding
Celebrants. It covers the public Cloudflare Pages site and the independently
deployed `awc-listings` Worker.

The governing rule is simple: a successful build, commit, push or upload is not
proof that production is serving the intended release. A release is complete only
when the exact Git SHA is associated with the active deployment and representative
behaviour works on the immutable deployment URL and canonical production domains.

Last configuration audit: 10 September 2026.

## Deployment inventory

### Cloudflare account

- Account name: `Withers Co Account`
- Account ID: `60ef6bd2c48d5beb6fd6a093cff863cf`
- Wrangler authentication: local OAuth profile; confirm with `npx wrangler whoami`
- The account ID is not a secret. OAuth tokens and API tokens are secrets and must
  never appear in source, documentation or command output captured for publication.

Always set `CLOUDFLARE_ACCOUNT_ID` explicitly for remote commands. The Wrangler
profile can access several accounts, so relying on implicit selection risks
inspecting or deploying the wrong project.

### Public site: Cloudflare Pages

| Setting                                  | Current value                             |
| ---------------------------------------- | ----------------------------------------- |
| Project                                  | `australianweddingcelebrants`             |
| Git provider                             | Connected                                 |
| Repository                               | `joshwithers/australianweddingcelebrants` |
| Production branch                        | `main`                                    |
| Required build command                   | `npm run build`                           |
| Build output                             | `dist`                                    |
| Pages domain                             | `australianweddingcelebrants.pages.dev`   |
| Canonical domain                         | `australianweddingcelebrants.com.au`      |
| Downloaded default compatibility date    | `2025-03-20`                              |
| Downloaded production compatibility date | `2026-04-01`                              |

The compatibility dates were read with the experimental `wrangler pages download
config` command on 10 September 2026. Re-download into a temporary directory to
check current remote values; do not let the command overwrite repository files.

Attached custom domains observed on 10 September 2026:

- `australianweddingcelebrants.com.au`
- `www.australianweddingcelebrants.com.au`
- `celebrant.directory`
- `www.celebrant.directory`
- `celebrant.xyz`
- `celebrants.directory`
- `www.celebrants.directory`
- `celebrants.net.au`
- `celebrants.xyz`

The alias domains currently serve the Pages project; not all redirect to the
canonical host. Canonical metadata points to `australianweddingcelebrants.com.au`.
Treat an alias/canonicalisation change as an SEO-sensitive release and verify each
host explicitly.

### API and agent service: Cloudflare Worker

| Setting          | Current value                                         |
| ---------------- | ----------------------------------------------------- |
| Worker           | `awc-listings`                                        |
| Source/config    | `worker/src/`, `worker/wrangler.toml`                 |
| Custom domain    | `api.australianweddingcelebrants.com.au`              |
| KV binding       | `KV`                                                  |
| KV namespace ID  | `4a441307ae4d4dd1bf700f2729b0adad`                    |
| Preview KV ID    | `22a7f48f3dfe4ec7a899c1c215590de4`                    |
| Cron             | `*/5 * * * *`                                         |
| Compatibility    | `2026-09-10` with `nodejs_compat`                     |
| Observability    | Invocation logs and traces enabled                    |
| Required secrets | `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` |

Public variables in `worker/wrangler.toml` define the admin/from addresses, site
and Worker URLs, GitHub repository/branch, and content path. `ENQUIRIES_FROM_EMAIL`
is optional in code; the A2A relay falls back to `FROM_EMAIL` when it is absent.

Never deploy the Worker merely to publish a site change. Never assume a Pages
deployment updated the Worker.

## Decide which units to release

| Changed files or contract                                                       |                  Pages                  |                  Worker                   | Integration checks                                                   |
| ------------------------------------------------------------------------------- | :-------------------------------------: | :---------------------------------------: | -------------------------------------------------------------------- |
| `README.md`, `docs/**`, `AGENTS.md`, `CLAUDE.md` only                           |  Yes, because `main` is Git-integrated  |                    No                     | Basic Pages deployment/SHA and canonical-site smoke                  |
| `src/**`, `public/**`, `functions/**`, root build/config/dependencies           |                   Yes                   |   Only if Worker contract also changed    | Full generated output, HTML/Markdown parity and relevant live routes |
| `worker/**` implementation/config/dependencies                                  | Only if site contract/docs also changed |                    Yes                    | Worker routes plus site data/discovery contract                      |
| `/directory.json`, Markdown/profile shape, MCP/A2A discovery or enquiry consent |                   Yes                   | Yes when Worker consumer/producer changed | End-to-end positive read and negative consent/authorization paths    |
| DNS, custom domains, redirects or headers                                       | Usually Pages and/or Cloudflare config  |               As applicable               | Every affected hostname, redirect, MIME type and canonical           |

Documentation-only commits still create a Pages build because of Git integration.
That build must be observed and smoke-tested, even though generated site bytes may
be unchanged.

## Pre-release preparation

Run from the repository root unless a step says otherwise.

### 1. Confirm location and preserve unrelated work

```sh
pwd
git status --short --branch
git diff --name-status
git diff --cached --name-status
```

Expected repository path is normally
`/Users/joshuawithers/Websites/australianweddingcelebrants`. Do not delete,
overwrite, format or stage unrelated user changes. If another process or the
Worker has written to `main`, reconcile before publication.

### 2. Refresh remote state

```sh
git fetch origin
git status --short --branch
git log --oneline --decorate --max-count=12 --all
```

If `origin/main` advanced, rebase or otherwise reconcile without force-pushing.
After any rebase, rerun validation because the build input changed.

### 3. Confirm tools and account

```sh
node --version
npm --version
cd worker
npx wrangler --version
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf npx wrangler whoami
cd ..
```

Node must satisfy `package.json` (`>=22.12.0`). Wrangler must be version 4 or
later. Review `whoami` output for the Withers Co account before a remote write.

## Validate the public site

### Full release gate

```sh
npm ci
npm run validate
git diff --check
```

`npm run validate` performs:

1. Astro/TypeScript diagnostics.
2. A fresh production build.
3. Markdown companion generation and sitemap/alternate/inventory parity checks.
4. Node regression tests over profile integrity, structured data, provenance,
   authorship, analytics/privacy, enquiry opt-in and social URL cleaning.
5. `llms.txt`, robots Content Signal and anonymous `auth.md` checks.
6. Built internal-link and asset checks.
7. `npm audit --audit-level=low`.

The DNS-AID test is live and intentionally separate. Run it for a broad release or
when DNS/discovery changes:

```sh
npm run check:dns-aid
```

### Inspect generated evidence

At minimum, record the counts printed by the build and tests. For a broad release,
also inspect:

```sh
find dist -type f -name '*.html' | wc -l
find dist -type f -name '*.md' | wc -l
rg -n 'rel="canonical"|rel="alternate"' dist/index.html
rg -n 'accepts_agent_enquiries' dist/directory.json
```

Do not commit `dist/`; it is build evidence and deployment input, not source.

## Validate the Worker

Run these when Worker source, configuration or dependencies changed:

```sh
cd worker
npm ci
npm test
npx wrangler deploy --dry-run
cd ..
git diff --check
```

The Worker tests cover invalid-form retry locks, YAML profile preservation,
notification/digest retry semantics, A2A validation and JSON-RPC notifications.
Keep dry-run bundling, source review and read-only/negative live smoke tests as
separate gates. Never use a production smoke test that sends mail, creates a
session, mutates KV, writes to GitHub, approves a submission or relays an enquiry
unless the task explicitly authorises that external effect.

For a contract shared with the site, inspect the generated `/directory.json`,
Markdown profile shape, discovery file, or consent field before deploying either
side.

## Commit and push

### 1. Review the final diff

```sh
git status --short
git diff --stat
git diff --check
git diff
```

Stage explicit authorised paths rather than `git add .` in a dirty worktree.

```sh
git add README.md AGENTS.md docs/deployment.md docs/project-history.md
git diff --cached --stat
git diff --cached
```

The file list above is illustrative; include the actual files for the change and
do not omit companion documentation.

### 2. Commit and prove the local SHA

```sh
git commit -m "docs: document project operations and deployment"
git rev-parse HEAD
git status --short --branch
```

### 3. Recheck remote immediately before push

```sh
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

If the remote changed, rebase and revalidate. Never force-push over production
content written by a person, automation or the Worker.

### 4. Push and prove parity

```sh
git push origin main
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git ls-remote origin refs/heads/main
```

The full local `HEAD`, `origin/main`, and remote `refs/heads/main` SHAs must match.

## Publish and verify Cloudflare Pages

### Preferred path: Git-integrated deployment

Pushing `main` should create a production Pages deployment. Poll deliberately,
not continuously:

```sh
cd worker
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf \
  npx wrangler pages deployment list \
  --project-name australianweddingcelebrants \
  --environment production
cd ..
```

The newest production row must show:

- branch `main`;
- source matching the pushed SHA (Wrangler displays an abbreviated SHA);
- a new immutable URL such as
  `https://<deployment>.australianweddingcelebrants.pages.dev`.

GitHub should also report the `Cloudflare Pages` check as completed successfully:

```sh
gh api repos/joshwithers/australianweddingcelebrants/commits/$(git rev-parse HEAD)/check-runs \
  --jq '.check_runs[] | {name,status,conclusion,details_url}'
```

Do not treat a dashboard status alone as live proof. Test the immutable URL and
canonical domain in the next section.

### Fallback: direct upload of the validated build

Use direct upload only when the Git-connected deployment is absent, failed, or
active in the control plane while its immutable URL remains unavailable. Confirm
that `dist/` comes from the current clean checkout and current full validation.

```sh
RELEASE_SHA=$(git rev-parse HEAD)
RELEASE_MESSAGE=$(git log -1 --pretty=%s)
cd worker
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf \
  npx wrangler pages deploy ../dist \
  --project-name australianweddingcelebrants \
  --branch main \
  --commit-hash "$RELEASE_SHA" \
  --commit-message "$RELEASE_MESSAGE" \
  --commit-dirty=false
cd ..
```

Capture the returned deployment ID/URL, list deployments again, and perform the
same verification. Do not upload an old `dist/` or attach a SHA that was not its
build input.

## Pages live-verification checklist

Use a cache-busting query based on the short SHA for checks where a query is safe:

```sh
RELEASE_SHORT_SHA=$(git rev-parse --short=12 HEAD)
```

### Immutable deployment

Replace `<deployment>` with the ID prefix Wrangler returned:

```sh
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  "https://<deployment>.australianweddingcelebrants.pages.dev/?release=$RELEASE_SHORT_SHA"
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  "https://<deployment>.australianweddingcelebrants.pages.dev/llms.txt?release=$RELEASE_SHORT_SHA"
```

Both must be successful. If the immutable URL is `404` while the deployment is
labelled active, wait for propagation and recheck. A previous incident required a
direct upload fallback.

### Canonical routes and formats

```sh
for url_path in \
  / \
  /directory/ \
  /directory/josh-withers-ybt9/ \
  /directory/josh-withers-ybt9.md \
  /llms.txt \
  /llms-full.txt \
  /sitemap-index.xml \
  /robots.txt \
  /.well-known/api-catalog \
  /.well-known/mcp/server-card.json \
  /.well-known/agent-card.json \
  /.well-known/agent-skills/index.json \
  /privacy/ \
  /terms/
do
  curl -sS -o /dev/null \
    -w '%{http_code} %{content_type} %{size_download} %{url_effective}\n' \
    "https://australianweddingcelebrants.com.au${url_path}"
done
```

Expected status is `200`. Expected types include HTML, `text/markdown` for direct
`.md`, text for `llms.txt`/robots, XML for the sitemap, linkset JSON for the API
catalogue, and JSON for cards/indexes.

### Markdown negotiation

```sh
curl -sS -D - -o /dev/null \
  -H 'Accept: text/markdown' \
  https://australianweddingcelebrants.com.au/about/
```

Require `200`, `Content-Type: text/markdown; charset=utf-8`, `Vary: Accept`, and an
`X-Markdown-Tokens` header. Inspect a response body when Markdown content changed.

### Canonical redirects and cookies

```sh
curl -sS -I 'http://australianweddingcelebrants.com.au/directory/?release=test'
curl -sS -I 'https://www.australianweddingcelebrants.com.au/directory/?release=test'
curl -sS -I 'https://australianweddingcelebrants.com.au/josh-withers/?release=test'
curl -sS -D - -o /dev/null 'https://australianweddingcelebrants.com.au/' \
  | rg -i '^set-cookie:'
```

HTTP and the canonical `www` host should redirect to canonical HTTPS while
preserving path/query. The legacy Josh alias should resolve to the canonical
profile. The final command should print nothing; a `Set-Cookie` header violates the
public analytics boundary and requires investigation.

When analytics/privacy code changes, also inspect a real browser: verify the GA4
measurement ID, denied defaults before `gtag.js`, empty `document.cookie`, and no
analytics IDs in local/session storage. HTTP headers alone cannot prove those.

### Alias domains

When domain or canonical behaviour changes, check each attached host. Record
whether it serves or redirects; do not assume uniform behaviour.

```sh
for host_name in \
  celebrant.directory \
  www.celebrant.directory \
  celebrant.xyz \
  celebrants.directory \
  www.celebrants.directory \
  celebrants.net.au \
  celebrants.xyz
do
  curl -sS -I --max-time 15 "https://${host_name}/"
done
```

## Deploy and verify the Worker

Only do this when the Worker unit changed or the user explicitly requests a Worker
redeploy.

### Deploy the current checkout

```sh
RELEASE_SHA=$(git rev-parse HEAD)
cd worker
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf \
  npx wrangler deploy --keep-vars \
  --message "Git ${RELEASE_SHA}: <short reason>"
cd ..
```

Wrangler uploads the Worker source/config from the current checkout. Record the
returned version ID. Then confirm it is receiving 100% of traffic:

```sh
cd worker
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf \
  npx wrangler deployments list
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf \
  npx wrangler versions list
cd ..
```

The newest deployment should carry the Git-SHA message and route 100% to its
version.

### Read-only Worker smoke tests

```sh
for url_path in /mcp /a2a /.well-known/openai-apps-challenge /login
do
  curl -sS -o /dev/null \
    -w '%{http_code} %{content_type} %{size_download} %{url_effective}\n' \
    "https://api.australianweddingcelebrants.com.au${url_path}"
done
```

Expected status is `200`. `/mcp` and `/a2a` return public metadata on `GET`; the
challenge is text and `/login` is HTML.

Test JSON-RPC only with read-only methods unless a send is explicitly authorised.
For MCP, `initialize`, `tools/list`, and read-only directory tool calls are safe.
For A2A, `ping`, card retrieval and `search_celebrants` are safe. Do not call
`enquire_celebrant` during an ordinary smoke test because it can send email and
write rate-limit/log records.

When consent logic changes, prove the negative path using a profile without
`accepts_agent_enquiries: true`; the Worker must reject before calling Resend.

## Rollback and recovery

### Pages

Prefer fixing forward when the problem is understood and small. For urgent
rollback, use the Cloudflare Pages dashboard to select a known-good deployment for
the production project, or revert the offending Git commit and let `main` rebuild.
After either action, verify the immutable target, canonical domain, Markdown and
discovery surfaces again.

Do not call a rollback complete merely because the dashboard changed. DNS/cache
propagation can leave custom domains on a different version briefly.

### Worker

List known versions first:

```sh
cd worker
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf \
  npx wrangler versions list
```

Use Wrangler's current rollback command only after resolving the exact target from
the list and reviewing current CLI help. Then repeat deployment and endpoint smoke
checks. If the problem concerns secrets or variables, rolling back code may not
restore the previous external configuration.

### Common failure modes

| Symptom                                            | Likely cause                                                               | Response                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pages row is active but immutable URL is `404`     | Control-plane/data-plane propagation lag or failed Git artifact            | Wait and recheck; if necessary direct-upload the validated `dist` with exact SHA metadata       |
| HTML updated but `.md` or `llms.txt` is stale      | Format-specific propagation/cache lag or build command bypassed generators | Check immutable and canonical URLs separately; confirm `npm run build` ran; cache-bust and wait |
| Push rejected                                      | `main` advanced, often through another contributor or Worker GitHub write  | Fetch/rebase, preserve remote content, rerun validation, push normally                          |
| Legacy redirect with query does not match          | Pages source patterns ignore query parameters                              | Use a path-only source rule and keep canonical metadata clean                                   |
| Wrong Cloudflare project/account appears           | Implicit multi-account selection                                           | Set the documented `CLOUDFLARE_ACCOUNT_ID` explicitly and rerun read-only checks                |
| Worker deployment succeeds but site is unchanged   | Independent release units                                                  | Deploy Pages separately when the site changed                                                   |
| Site deploy succeeds but MCP/A2A uses old contract | Worker consumer was not released                                           | Deploy and verify the Worker after shared-contract changes                                      |

## Release handover record

The final handover for every release should record:

- validation commands and exact results/counts;
- committed file scope and commit SHA;
- local, tracking and remote SHA parity;
- Pages deployment ID, immutable URL, branch and source SHA when Pages changed;
- Worker version ID and 100% traffic deployment when Worker changed;
- canonical live routes tested, status/MIME results and redirects;
- negative consent/authorization tests when relevant;
- any propagation delay, fallback, unresolved risk or intentionally undeployed
  unit;
- documentation files updated.

Append material implementation decisions and durable evidence to
`project-history.md`. Avoid turning that file into a list of routine profile edits;
Git remains the record for ordinary content churn.
