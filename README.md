# Fixl Docs backend

Next.js API routes for the Fixl artifact workspace. Supabase provides auth, metadata, and private HTML object storage. Claude generates unsaved drafts; ordinary artifact reads use storage without contacting Anthropic.

## Setup

Use Node.js 24 and the existing Fixl Supabase database.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Never place `SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` in frontend variables. `FRONTEND_URL` must be the exact allowed frontend origin. The existing base database schema is not recreated by this patch.

## Required migration and paired release

1. Back up the database and inspect the existing `documents` / `document_versions` schema. It must include the columns used in `supabase/migrations/202611140001_atomic_artifact_versions.sql`.
2. Apply that SQL migration through your normal Supabase migration process **before deploying this backend**. It adds a service-role-only function and does not rewrite existing HTML objects.
3. Deploy this backend and the paired [frontend](https://github.com/fixl-developer/fixl-docs) redesign together in staging. Old `claude-update` clients expect autosave, while this release returns drafts. Use a coordinated maintenance window or a feature flag if rolling clients remain active.
4. Verify real role access, HTML reads, public-link revocation, conflicting saves, and Claude failure/acceptance behavior before production rollout.

The migration has not been applied to a live database. The repository snapshot contains no authoritative base-schema migration, so test it against a staging copy first.

## API behavior

| Endpoint                                            | Behavior                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /api/documents`                               | Validate standalone source, check project editing access, upload immutable HTML, save first version             |
| `POST /api/documents/:id/versions`                  | Require edit access; accept `base_version_id`; save version and pointer atomically; return 409 for stale writes |
| `GET /api/documents/:id/versions/:versionId?html=1` | Authorized plaintext HTML, rendered in a sandbox by the frontend                                                |
| `POST /api/generate`                                | Authenticated SSE draft generation, no database writes                                                          |
| `POST /api/documents/:id/draft`                     | Authorized refinement from the actual current storage key, or `mode: regenerate`                                |
| `POST /api/documents/:id/claude-update`             | Compatibility route to draft generation; no longer autosaves                                                    |
| `GET /api/public/artifacts/:slug`                   | Public document metadata, or legacy public snippet fallback                                                     |
| `GET /api/public/artifacts/:slug?html=1`            | Public plaintext HTML with no-store; private/revoked documents return 404                                       |
| `POST /api/fetch-url`                               | Retired with 410; import standalone HTML instead; no outbound requests                                          |

SSE sends `{chunk}`, then `{done:true,draft:true,html,meta}` only for a complete result. Any provider truncation, incomplete HTML, or generation error must leave the saved artifact unchanged. Save the accepted draft through the document/version endpoint.

## Access rules

Managers/founders can view and edit workspace documents. Creators can view, edit, and delete their own documents. Project owners/editors can edit project artifacts; project viewers can read. `can_view_all_docs` grants read access, not editing. Only owners/leads manage project membership. Public reads require explicit `is_public` and an existing saved version.

## Claude configuration

Set `ANTHROPIC_API_KEY` on the backend. `ANTHROPIC_MODEL` is configurable; the current default is `claude-sonnet-5-5`, verified against [Anthropic's model documentation](https://platform.claude.com/docs/en/models/overview) on 15 November 2026. Confirm model access in your API account before enabling generation.

Generation is limited to 20 requests per hour per user, a 12,000-character prompt, 500 KB of existing source, 16,384 output tokens, and a 120-second timeout. Production generation fails closed if the Redis limiter cannot be configured or checked. The per-process development limiter is not a production quota system. Configure hosting to support the streaming route's 180-second maximum duration. This is a backend API integration; it does not use a user's Claude browser session.

## Validation

```sh
npm test
npm run build
```

Fifteen Node tests cover role decisions, protected routes, public revocation, retired URL fetching, incomplete Claude output, draft persistence, source filtering and isolation, GitHub commit consistency and OAuth account binding, immutable object keys, and both SQL migrations. SQL runs in PGlite with a minimal fixture schema; service boundaries are mocked in route tests. These checks do not replace a real Supabase/Anthropic/GitHub staging smoke test.

See [operational limits](docs/operational-limits.md) before rollout.

## Source-informed workspace

The new `/api/documents/:id/workspace` endpoints persist private per-editor sources and conversations. `/workspace/generate` retrieves relevant source excerpts and saves an unapplied draft; `/workspace/apply` writes an accepted version and clears the draft in one database transaction. `GET /workspace` never returns raw source file content.

Apply `supabase/migrations/202611160001_artifact_context_workspace.sql` **after** the existing atomic-version migration. It creates private workspace/source tables, GitHub connection and one-time OAuth state tables, and service-role-only source/apply functions. No live migration is performed by this change.

Configure `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a stable 64-hex-character `GITHUB_TOKEN_ENCRYPTION_KEY` on the backend. Register a GitHub App with Contents read-only, install it on selected repositories, and set its callback to `FRONTEND_URL/integrations/github/callback`. User authorization is bound to the signed-in Fixl account with one-time state and PKCE. Tokens are encrypted with AES-256-GCM and never returned to the browser. Expired tokens require reconnecting; this release does not store refresh tokens.

Source mutations and GitHub browsing are limited to 40 requests per ten minutes per user using Redis; production fails closed if unavailable. GitHub files are read from blob SHAs in one resolved commit, and truncated trees, moved branches during selection, symlinks, unsupported/oversized files, and common credential patterns are rejected. Local snapshots use the same content policy. GitHub attachments can take longer than a normal API request; allow the workspace route's 180-second runtime.

The legacy connected-project sync endpoint now opens an artifact workspace and returns JSON `{documentId}`. It rejects the old streaming file-upload body. The paired frontend uses the new source picker and explicit draft acceptance. Deploy this release pair together. The legacy `claude-update` endpoint again has draft semantics; no code-sync path automatically publishes AI output.

See [source workspace operations](docs/source-workspace.md) for limits and validation.
