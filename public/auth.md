# auth.md — Australian Wedding Celebrants

Australian Wedding Celebrants is a public directory. People and agents can browse and use its public website, datasets, and agent interfaces without signing in.

## Public access policy

| Item                         | Policy                                                            |
| ---------------------------- | ----------------------------------------------------------------- |
| Audience                     | People, search engines, AI assistants, and other automated agents |
| Identity type                | Anonymous                                                         |
| Registration or provisioning | Not required                                                      |
| User account                 | Not required                                                      |
| API key                      | Not required                                                      |
| OAuth or OpenID Connect      | Not supported or required                                         |
| Credentials                  | None                                                              |

## Anonymous access

Use the public HTTPS endpoints directly. Do not send an `Authorization` header, access token, API key, login cookie, or other credential.

Supported anonymous access includes:

- Browsing the [website](https://australianweddingcelebrants.com.au/) and [directory](https://australianweddingcelebrants.com.au/directory/).
- Reading the [structured directory dataset](https://australianweddingcelebrants.com.au/directory.json), [llms.txt](https://australianweddingcelebrants.com.au/llms.txt), and page-level Markdown.
- Searching and reading celebrant profiles through the public [MCP server](https://api.australianweddingcelebrants.com.au/mcp).
- Using the public [A2A agent](https://api.australianweddingcelebrants.com.au/a2a) to search the directory or relay a qualified enquiry to a celebrant.

Requests may be validated or rate-limited to prevent abuse. Those controls do not create an account or authenticate the requester.

## Why there is no OAuth discovery document

The public directory is not an OAuth authorization server and does not issue access tokens. Its OAuth 2.0 and OpenID Connect discovery URLs are therefore intentionally absent.

Publishing an `issuer`, `authorization_endpoint`, `token_endpoint`, or `jwks_uri` would incorrectly imply that those services exist. Agents should use the anonymous access described above instead.

## Scope

This declaration covers the public website and public agent interfaces. The separate celebrant listing-administration service is outside this public directory access policy and may require a celebrant to sign in.

For all agent-facing resources, see the [AI and agent discovery guide](https://australianweddingcelebrants.com.au/ai/) and [API catalogue](https://australianweddingcelebrants.com.au/.well-known/api-catalog).
