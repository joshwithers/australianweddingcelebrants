# Project instructions for coding agents

This repository is both a public directory and a two-part production system. Read
the following before changing it:

1. `README.md` — product, architecture, content model, invariants and commands.
2. `docs/README.md` — documentation map and status.
3. `docs/deployment.md` — exact release, deployment and live-verification runbook.
4. `docs/project-history.md` — why the present architecture exists and which
   regressions must not be reintroduced.
5. `CLAUDE.md` — compact implementation notes and project conventions.
6. `worker/README.md` — Worker routes, data flows, safety boundaries and release
   procedure when `worker/**` changes.

## Documentation is part of every change

Documentation is a release requirement, not optional clean-up. Before declaring
work complete:

- Update `README.md` when a command, dependency, route, service, data model,
  invariant, directory count or operational assumption changes.
- Update `docs/deployment.md` when Cloudflare account/project settings, domains,
  build settings, release commands, secrets, bindings or smoke checks change.
- Add a dated entry to `docs/project-history.md` for material features, fixes,
  migrations, incidents or architecture decisions. Record the problem, the
  implementation, the lasting invariant, validation performed and commit or
  deployment identifiers that are already known.
- Update the nearest component documentation (`worker/README.md`,
  `scripts/README.md`, or a focused file in `docs/`) when its behaviour changes.
- Update `docs/README.md` whenever a documentation file is added, renamed,
  superseded or removed.
- Check examples, counts and claims against source or production. Date any value
  that will drift. Never leave guessed values presented as current facts.
- Include documentation files in the same commit as the work they describe when
  practical. A release is incomplete if the implementation and handover notes
  disagree.

If a change needs no documentation update, state why in the handover. Do not use
that exception for behaviour, architecture, security, privacy, content-policy or
deployment changes.

## Non-negotiable project invariants

- A stored tier is a credential issued and human verified by Australian Wedding
  Celebrants. Optional `tier_evidence_*` fields describe separate public evidence;
  absence of those fields does not invalidate the publisher credential.
- Do not invent endorsements, availability, commercial activity, offers,
  testimonials, identities, contact details or evidence. Do not copy private
  supporting documents or personal addresses into public content.
- Do not add distancing labels such as “profile-listed”, “profile statement” or
  “not independently verified” to ordinary member records. Provenance is the
  responsible publisher, credential issuer/human-verification method and the
  public correction route.
- Agent-relayed email is explicit opt-in only. Only the literal stored value
  `accepts_agent_enquiries: true` may enable it; missing and `false` must block it
  in the generated JSON and Worker.
- Keep the public analytics boundary cookieless: all Consent Mode storage/data/
  personalisation defaults denied, Google signals and ad personalisation off,
  query strings excluded from `page_location`, origin-only referrers, and no
  consent update, browser identifier or analytics storage.
- Every sitemap URL must keep a Markdown companion, canonical/alternate linkage,
  `llms.txt` inventory entry and content-negotiated `text/markdown` response.
- Resolve profile URLs through `src/lib/utils/entrySlug.ts`. Do not construct
  profile URLs from `entry.id` directly.
- Preserve one-DOM responsive masonry, natural image aspect ratios, reduced-motion
  support, central social URL cleaning and `Service.areaServed` schema placement.
- The static Pages site and `awc-listings` Worker are independent release units.
  Deploy only the units changed, but validate their integration whenever a shared
  contract changes.

## Required release evidence

Follow `docs/deployment.md`. At minimum, preserve unrelated work, run the relevant
validation, commit only authorised files, push without force, prove local/remote
SHA parity, identify the active Cloudflare deployment for that SHA, and smoke-test
canonical production behaviour. A successful build, push or upload is not by
itself production proof.
