# AWC Listings Worker

`awc-listings` is the independently deployed Cloudflare Worker behind
`api.australianweddingcelebrants.com.au`. It combines the celebrant submission and
admin workflow with public MCP/A2A agent interfaces.

This document describes deployed code. The separate `claude.md` is a future-work
proposal for autonomous maintenance/outreach agents and must not be mistaken for
current functionality.

Read the root `README.md` for site/content architecture and
`../docs/deployment.md` for the complete release and production-verification
runbook.

## Production inventory

Verified on 10 September 2026:

| Item                                    | Value                                                     |
| --------------------------------------- | --------------------------------------------------------- |
| Cloudflare account                      | `Withers Co Account` (`60ef6bd2c48d5beb6fd6a093cff863cf`) |
| Worker name                             | `awc-listings`                                            |
| Custom domain                           | `api.australianweddingcelebrants.com.au`                  |
| Entrypoint                              | `src/index.js`                                            |
| Wrangler config                         | `wrangler.toml`                                           |
| Compatibility date                      | `2024-12-01`                                              |
| KV binding                              | `KV`                                                      |
| Cron                                    | Every five minutes (`*/5 * * * *`)                        |
| Wrangler                                | 4.130.0 installed from `package-lock.json`                |
| Last version before documentation audit | `a78cce29-82e5-4abf-b6fe-2b37ef52c75e`                    |

The last-version value is a dated snapshot. Re-run `wrangler deployments list`
and `wrangler versions list` before treating any ID as current.

## System responsibilities

### Celebrant workflow

1. A celebrant opens `/login`, optionally with a profile slug.
2. `POST /login` rate-limits the email address, checks whether an edit request
   matches a listing, creates a 15-minute single-use magic token in KV, and sends
   the link through Resend.
3. `/auth` consumes the token and creates an `awc_session` cookie. The cookie is
   `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to `/`, and lasts 24 hours.
4. `/form` renders the create/edit form. The authenticated user submits to
   `/submit`; duplicate requests are briefly locked and submission/media/evidence
   data is staged in KV for 90 days.
5. The Worker can call Anthropic to clean up submitted text. The admin receives a
   review link.
6. Admin review can edit, reject, or approve. Approval writes Markdown and assets
   to the configured GitHub repository/branch through the Contents API, records the
   email-to-slug mapping, and creates a delayed notification job.
7. The five-minute cron sends due approval notifications, normally about 15
   minutes after approval.

The GitHub write publishes source to `main`; Cloudflare Pages Git integration then
builds the public site. Worker approval and Pages production activation are
separate events. A successful GitHub response is not proof that the profile is
live.

### Admin workflow

The administrator is identified by exact comparison with `ADMIN_EMAIL`. Admin
sessions use the same secure cookie mechanism and are required for dashboards,
submission review, profile editing, image access, AI cleanup and email composition.

Bulk email is an externally consequential action. Do not use its POST route for a
smoke test, and do not infer authority to send from access to the repository or
Worker. Review recipients, content and stored send record for any specifically
authorised operation.

### Award nominations

The public nomination flow is two-stage:

1. `POST /award-nomination` validates the request, checks a honeypot and per-email
   hourly rate limit, and asks Anthropic for title/emoji/justification suggestions.
2. `POST /award-nomination/send` accepts the wording the nominator confirmed and
   emails the administrator for human review.

The route does not directly add an award to a profile. Approved awards remain a
human-controlled source edit.

### MCP

`src/mcp.js` implements stateless Streamable HTTP JSON-RPC 2.0 at `/mcp`, protocol
version `2025-06-18`. `GET` returns service metadata for people/clients; `POST`
handles the protocol; `OPTIONS` supports open CORS.

The service is public, anonymous and read-only. It exposes:

| Tool                    | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `search_celebrants`     | Free-text name/location/description search, up to 25 results |
| `browse_by_location`    | Local matches plus optional Australia-wide travellers        |
| `browse_by_tier`        | Listings for `luminary`, `endorsed` or `registered`          |
| `get_celebrant_profile` | Full public Markdown profile by canonical slug               |
| `list_all_celebrants`   | Full structured directory for broad questions/counts         |

Tool definitions declare read-only, non-destructive, idempotent and open-world
annotations. They also reference ChatGPT Apps SDK widget resources from
`src/widgets.js`.

MCP data comes from the public site's `/directory.json` and profile `.md` routes
through `src/directory.js`. The Worker keeps an in-isolate listing cache for one
minute and asks Cloudflare to cache the site fetch for one minute. A Pages release
can therefore take time to appear in Worker results; test again after cache expiry.

### A2A

`src/a2a.js` implements JSON-RPC 2.0 at `/a2a` with A2A protocol version `0.3`.
`GET` returns the agent card. The service supports public directory search and an
optional enquiry relay.

The relay is not enabled by the existence of a public email address. It requires
the literal generated field `accepts_agent_enquiries: true`. Missing and `false`
must be rejected before Resend is called. At the documentation audit, no published
profile had opted in.

For an authorised relay, the caller supplies a directory slug, agent identity,
couple contact details, wedding date/location and a meaningful ceremony message.
The Worker applies:

- 10 enquiries per source IP per 24 hours;
- one enquiry per source IP/profile pair per 24 hours;
- 30 enquiries per profile across all senders per 24 hours;
- a 30-day IP ban after a profile reports an enquiry as spam;
- an agent-name report counter, with permanent blocking after three reports;
- 30-day enquiry-log retention so report links continue to resolve.

`GET /a2a/report` processes the public report-spam link and notifies the admin.
The five-minute cron also sends a weekly A2A digest at Monday 09:00 UTC, guarded by
a seven-day KV key so it runs once.

Never call the enquiry action as an ordinary health check: it sends email and
writes production KV.

## Route reference

Routes not listed fall through to the Worker 404 page. Except for the dedicated
MCP/A2A CORS handlers and challenge, ordinary cross-origin access is restricted by
the Worker CORS helper.

| Method                   | Path                                 | Access                        | Side effects / purpose                             |
| ------------------------ | ------------------------------------ | ----------------------------- | -------------------------------------------------- |
| `GET`                    | `/login`                             | Public                        | Render join/edit login form                        |
| `POST`                   | `/login`                             | Public, rate-limited          | Create magic token and send email                  |
| any                      | `/auth`                              | Single-use magic token        | Consume token, create user session, redirect       |
| any                      | `/form`                              | User or admin session         | Render create/edit listing form                    |
| `POST`                   | `/submit`                            | User or admin session         | Stage submission and media; notify admin           |
| `POST`                   | `/ai-edit`                           | User or admin session         | Anthropic-assisted profile editing                 |
| `POST`                   | `/award-nomination`                  | Public, honeypot/rate-limited | Draft award wording with Anthropic                 |
| `POST`                   | `/award-nomination/send`             | Public, validated             | Send confirmed nomination to admin                 |
| `GET`                    | `/asset`                             | Any valid session             | Proxy an authenticated repository asset            |
| any                      | `/admin/auth`                        | Admin magic token             | Consume token and create admin session             |
| `GET`                    | `/admin`                             | Admin session                 | Dashboard                                          |
| any                      | `/admin/review`                      | Admin session                 | Review a submission                                |
| `POST`                   | `/admin/approve`                     | Admin session                 | Publish to GitHub and schedule notification        |
| `POST`                   | `/admin/reject`                      | Admin session                 | Mark submission rejected                           |
| any                      | `/admin/listings`                    | Admin session                 | Browse published listings                          |
| any                      | `/admin/submissions`                 | Admin session                 | Browse stored submissions                          |
| `GET`, `POST`            | `/admin/edit`                        | Admin session                 | Render or save direct profile edits through GitHub |
| `GET`                    | `/admin/image`                       | Admin session                 | Read staged submission image/logo/evidence         |
| `GET`, `POST`            | `/admin/email`                       | Admin session                 | Compose or send bulk admin email                   |
| `POST`                   | `/admin/ai-cleanup`                  | Admin session                 | Anthropic-assisted admin copy cleanup              |
| `GET`, `POST`, `OPTIONS` | `/mcp`                               | Public anonymous              | MCP metadata or read-only JSON-RPC                 |
| `GET`, `POST`, `OPTIONS` | `/a2a`                               | Public anonymous              | A2A card, search, task lookup or enquiry relay     |
| `GET`                    | `/a2a/report`                        | Public task link              | Record spam report, apply blocks and notify admin  |
| `GET`, `HEAD`            | `/.well-known/openai-apps-challenge` | Public                        | OpenAI domain-verification text                    |

“Any” above reflects current router behaviour, not an invitation to use an
unexpected method. Preserve current method restrictions or make them stricter when
touching route code.

## KV data model

| Key prefix                     | Meaning                                        | Normal lifetime |
| ------------------------------ | ---------------------------------------------- | --------------- |
| `magic:`                       | Single-use login/admin token                   | 15 minutes      |
| `session:`                     | Email, role, optional slug and creation time   | 24 hours        |
| `ratelimit:login:`             | Login attempts by email                        | 15 minutes      |
| `submission:`                  | Full proposed profile submission               | 90 days         |
| `image:`, `logo:`, `evidence:` | Staged base64 upload data                      | 90 days         |
| `email:`                       | Email-to-profile slug lookup                   | Persistent      |
| `notify:`                      | Delayed approval notification job              | 1 hour          |
| `ai_usage:`                    | Anthropic cost/call usage per session email    | 90 days         |
| `cache:listings`               | GitHub directory listing cache for admin flows | 5 minutes       |
| `email_blast:`                 | Bulk email send record                         | 90 days         |
| `ratelimit:nominate:`          | Nomination drafts by email                     | 1 hour          |
| `a2a:rl:*`                     | A2A rate counters                              | 24 hours        |
| `a2a:enquiry:`                 | Relay record and report target                 | 30 days         |
| `a2a:banned_ip:`               | Spam-reported source IP ban                    | 30 days         |
| `a2a:agent_reports:`           | Report count by normalised agent name          | 90 days         |
| `a2a:blocked_agent:`           | Agent-name block after threshold               | Persistent      |
| `a2a:digest_sent:`             | Weekly digest debounce marker                  | 7 days          |

KV is eventually consistent. Do not use it as evidence of a transaction without
checking the relevant external system: a GitHub write, Resend API acceptance and a
Pages live profile are separate facts.

## Configuration

### Public variables

Defined in `wrangler.toml`:

| Variable        | Purpose                                                           |
| --------------- | ----------------------------------------------------------------- |
| `ADMIN_EMAIL`   | Admin identity and notification recipient                         |
| `SITE_URL`      | Canonical public site used for links and public directory fetches |
| `WORKER_URL`    | Canonical Worker base URL used in links/cards                     |
| `FROM_EMAIL`    | Verified Resend sender for normal Worker mail                     |
| `GITHUB_REPO`   | `owner/repository` written through the GitHub API                 |
| `GITHUB_BRANCH` | Publication branch, currently `main`                              |
| `CONTENT_PATH`  | Directory profile source path                                     |

Optional code-level variable:

| Variable               | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `ENQUIRIES_FROM_EMAIL` | Dedicated A2A relay sender; falls back to `FROM_EMAIL` |

### Secrets

| Secret              | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `RESEND_API_KEY`    | Transactional, admin and A2A email                     |
| `ANTHROPIC_API_KEY` | Bio cleanup/editing and award drafting                 |
| `GITHUB_TOKEN`      | Read/write access to the configured repository content |

Set secrets interactively from this directory:

```sh
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GITHUB_TOKEN
```

Do not put secret values in command arguments, `.dev.vars` committed to Git,
documentation, issue text, logs or frontend bundles.

## Local development

```sh
cd worker
npm ci
npm run dev
```

Wrangler local development uses local state by default. Create an untracked
`.dev.vars` only when a flow needs local secrets. Avoid connecting a local smoke
test to production email, GitHub or KV unless the task explicitly requires that
external effect.

Useful read-only checks:

```sh
npx wrangler --version
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf npx wrangler whoami
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf npx wrangler deployments list
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf npx wrangler versions list
```

`npm run admin-login` is not read-only. It writes a 15-minute single-use magic
token directly to the remote production KV namespace and prints the admin login
URL. Use it only for explicitly authorised admin recovery, confirm the Cloudflare
account first, and do not capture or share its output because the URL is a live
credential until consumed or expired.

## Validation and deployment

There is currently no Worker unit-test suite. Before deployment:

```sh
cd worker
npm ci
npx wrangler deploy --dry-run
cd ..
git diff --check
```

Commit and push the Worker change with its updated documentation, then deploy the
exact checkout with a Git-SHA message:

```sh
RELEASE_SHA=$(git rev-parse HEAD)
cd worker
CLOUDFLARE_ACCOUNT_ID=60ef6bd2c48d5beb6fd6a093cff863cf \
  npx wrangler deploy --keep-vars \
  --message "Git ${RELEASE_SHA}: <short reason>"
cd ..
```

Record the returned version ID, then require it at 100% traffic in
`wrangler deployments list`.

Read-only live smoke:

```sh
for url_path in /mcp /a2a /.well-known/openai-apps-challenge /login
do
  curl -sS -o /dev/null \
    -w '%{http_code} %{content_type} %{size_download} %{url_effective}\n' \
    "https://api.australianweddingcelebrants.com.au${url_path}"
done
```

The full cross-unit verification, negative consent test, rollback guidance and
Pages release procedure are in `../docs/deployment.md`.

## Documentation requirement

Update this file whenever a Worker route, KV key, time-to-live, binding, variable,
secret, provider, limit, auth rule, cron task or deployment command changes. Add a
dated material entry to `../docs/project-history.md`, update the root README if the
system contract changed, and keep `../docs/README.md` current.
