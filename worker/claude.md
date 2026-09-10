# Proposed AWC autonomous directory agents

> **Status: future-work design, not deployed.** The production Worker is
> documented in `README.md`. Nothing in this proposal authorises outreach,
> profile writes, tier changes or email sends.

This proposes two autonomous agents that could help run the Australian Wedding Celebrants directory
(australianweddingcelebrants.com.au) on a schedule, with daily email digests
back to Josh. Built on the Claude Agent SDK.

## Proposed outcome

- **Agent A — Maintenance & enrichment.** Crawls existing celebrant sites,
  diffs against the directory, applies safe changes, flags risky ones. Encourages celebrants to update their listing and move up their tier if they meet the community standards of increasing their tier level.
- **Agent B — Outreach.** Finds new celebrants not yet listed, evaluates fit,
  drafts and sends personalised invites, tracks responses, onboards yeses.

Build A first to boring stability. Only then turn on B.

## Stack

- Runtime: Cloudflare Containers, triggered by Cron Triggers
- Data: existing AWC Worker KV plus any explicitly approved future D1 database,
  accessed through an expanded AWC MCP server
- Audit: proposed D1 table with every agent action logged
- Sending: Resend, via a dedicated `directory.australianweddingcelebrants.com.au`
  subdomain (separate sender reputation from Josh's other domains)
- Templates: Maizzle
- Language: TypeScript (matches the rest of the AWC stack — Astro 7, React 19,
  Workers/Pages/KV)

## Autonomy tiers — bake these into the MCP write tools

**Auto, report in daily digest:**

- Add new celebrant at "Registered" tier (after passing checks)
- Update phone, address, locations served, services, social links
- Refresh "last verified" timestamp
- Send first-touch outreach email
- Record reply / unsubscribe

**Auto, notify Josh immediately (out-of-band email):**

- Site dead (4xx/5xx for 7+ consecutive days)
- Authorisation lapsed on AGD registry
- Outreach reply that isn't a clean "yes"

**Flag, do nothing until Josh approves:**

- Tier promotion (Registered → Endorsed → Luminary). Editorial judgement
  is the product; agent never makes this call.
- Delisting
- Anyone on the sensitive-names list (see below)
- Second outreach attempts (default: don't allow at all)

These should be enforced at the **MCP tool layer**, not just in prompts. If
the agent literally can't call `promote_tier`, it can't do it. The tool
either doesn't exist or returns a "requires human approval" response that
adds it to the digest.

## MCP write tools to build

Extend the existing AWC MCP server with:

- `propose_change(celebrant_id, field, old, new, evidence)` — for review queue
- `apply_change(celebrant_id, field, value, evidence)` — for auto-tier changes
- `add_celebrant(profile, tier='registered', evidence)`
- `flag_for_review(celebrant_id, reason, severity, evidence)`
- `record_outreach(celebrant_id, status, content)` — append-only
- `check_suppression(email)` — must be called before any send
- `add_to_suppression(email, reason)`

Every write tool takes an `evidence` field (URL, screenshot path, snippet) so
the audit log answers "why did the agent do this" forever.

## Outreach rules — non-negotiable

- Spam Act 2003: identify sender, functional unsubscribe in every email,
  honour within 5 business days. Inferred consent applies (B2B, publicly
  listed contact, directly relevant) but unsubscribe is mandatory.
- Throttle: 20–30 sends/day max during warm-up, then up to 50/day. Never blast.
- Personalisation gate: the agent must find something specific about the
  celebrant in their site copy before drafting. If it can't, skip them.
  Generic-sounding drafts get rejected by a self-review pass before send.
- Suppression list is append-only and checked before every send.
- Tone: see `skills/awc-voice/SKILL.md`. Plain English, ceremony-first,
  anti-template. No "we'd love to have you on our platform" energy.

## Sensitive-names list

If this system is implemented, it needs a private list of people who must never be
contacted or listed without Josh's explicit approval. Do not commit the names,
reasons or relationship history to this public repository. Store them in a private
configuration system and expose only the minimum policy decision needed by the
agent. No such production configuration is implemented here today.

## Phased plan

**Phase 1 — Foundations**

- Extend AWC MCP with write tools and policy gates
- D1 audit table + migrations
- We can used Resend, do you have a way of sending AND receiving emails through Resend otherwise we can make you a Fastmail account or a Gmail account?
- Maizzle template for daily digest
- Container + Cron skeleton; agent does nothing but log "alive"

**Phase 2 — Maintenance agent**

- Crawl + diff against existing celebrants
- Dry-run mode for one week: agent decides, emails what it _would_ do, no writes
- Turn on writes when dry-run reports look right

**Phase 3 — Outreach agent**

- Discovery source
- Fit evaluation against AWC standards
- Approval-first mode for first 50 drafts so Josh calibrates tone
- Flip to send-on-schedule once trust is established

**Phase 4 — Digest, observability, iterate**

- Daily 7am email to josh@withers.co: what happened, what's queued, what needs Josh's call
- Weekly metrics
- Hooks for logging every tool call

## Open questions for Josh

1. **Discovery source for new celebrants** — AGD public registry scrape from https://marriage.ag.gov.au/commonwealthcelebrants/all. Look at celebrant association lists. Scanning competitor directories.
2. **Sending identity** — "Australian Wedding Celebrants" as a brand? Identify yourself as the AI agent running the directory. Make it clear that you're an AI agent running a wedding celebrant directory aimed without charging for it because you want celebrants to be found by the right people.
3. **Volume target by end of 2026** — we want to list all of the full-time, professional, known wedding celebrants in Australia by the end of 2026.
4. **Private do-not-contact configuration** — Josh must supply and maintain it
   through a non-public channel if the proposal is implemented.
5. **Repo layout** — fold into existing AWC repo

## Working preferences (Josh)

- UK English / Australian spelling
- Plain English, short sentences, active voice
- Concrete examples over abstract advice
- No AI filler, no corporate gloss, no throat-clearing
- Systems-first: portable, cheap, repeatable
- Anti-template, anti-brittle
- Ceremony-first and celebrant-first values carry over to how the directory talks about its own purpose — recognition of practitioners, not a marketing funnel

## Bias toward simplicity

- One container, one cron, one digest. Don't over-architect early.
- Every action goes through the MCP and lands in the audit log. No DB side-channels.
- If a feature requires more than ~200 lines of policy code, the policy
  is wrong, not the code.
