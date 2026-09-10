# Australian Wedding Celebrants documentation index

This directory contains the long-lived handover material that does not fit
comfortably in the root README. Read `../README.md` first: it is the project-level
source of truth and points here for detail.

## Active documentation

| Document               | Status                   | Use it for                                                                        | Update it when                                                                      |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `../README.md`         | Current, primary         | Product, architecture, content model, invariants, commands and deployment summary | Repository-wide behaviour, versions, routes, counts, commands or assumptions change |
| `../AGENTS.md`         | Current, normative       | Rules every coding agent must follow                                              | Release requirements or non-negotiable invariants change                            |
| `../CLAUDE.md`         | Current, normative       | Compact implementation context for Claude-based agents                            | Architecture, content fields, routing or project conventions change                 |
| `deployment.md`        | Current, operational     | Exact Pages/Worker validation, release, verification and rollback                 | Cloudflare settings, domains, bindings, commands, secrets or smoke tests change     |
| `project-history.md`   | Current, append-oriented | Major implemented work, architecture decisions, regressions and release evidence  | A material feature, fix, incident, migration or policy decision lands               |
| `../worker/README.md`  | Current, operational     | Worker routes, KV records, integrations, safety and deployment                    | Anything under `worker/` changes behaviour or configuration                         |
| `../scripts/README.md` | Current, operational     | Build gates, generators and one-off utilities                                     | A script is added, removed, renamed or changes side effects                         |

## Time-sensitive or purpose-specific documents

| Document                       | Status                                                 | Important boundary                                                                                                                         |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `chatgpt-app-listing.md`       | Submission aid; verify before use                      | Counts, protocol versions, tool behaviour and portal requirements can drift. Re-run its test calls immediately before submission.          |
| `celebrant-email-ai-update.md` | Draft communication; do not send from repository alone | The A2A relay is explicit opt-in only. Verify the recipient's stored consent and all live behaviour before adapting or sending the draft.  |
| `../worker/claude.md`          | Proposed future system, not deployed                   | Describes a possible autonomous maintenance/outreach agent. It must not be treated as present architecture or authority to contact anyone. |

## Documentation maintenance contract

Every material change must leave enough evidence for a new agent with no memory of
the project to understand:

1. What changed and why.
2. Which source files and external services own the behaviour.
3. Which constraints must remain true.
4. How the change was validated.
5. Which commit and deployment became production, once those identifiers exist.
6. How to detect and recover from failure.

Put stable, repository-wide truth in `README.md`; detailed release mechanics in
`deployment.md`; chronological decisions and evidence in `project-history.md`; and
component-specific behaviour beside the component. Do not create isolated notes
that contradict these sources.

Counts, dependency versions, domains, provider settings and deployment IDs are
drift-prone. Date those facts and provide a command that re-derives them. Never copy
secret values, private evidence, session tokens, personal addresses or OAuth
credentials into documentation.

## Adding a document

When a new document is justified:

- give it a specific, searchable name;
- state whether it describes deployed behaviour, a runbook, a draft or future work;
- link it from this index and, when repository-wide, from `../README.md`;
- remove or mark superseded material so two files do not present different truths;
- include its update trigger in the table above if it is long-lived.

The `docs/` directory is intentionally tracked. If a new file does not appear in
`git status`, treat that as a repository configuration bug rather than force-adding
it silently.
