# Source workspace operations

## Persistence and concurrency

A workspace belongs to one document and one editor, uniquely. API handlers check current document editing permission before looking up that user's workspace. Private source IDs are scoped to that workspace; neither workspace roles nor a source ID allow reading another editor's context. Database tables enable RLS and revoke direct anon/authenticated grants. Only service-role routes access them.

A source snapshot contains selected text plus repository/branch/commit metadata when applicable. Source writes hold the workspace row lock and enforce six-source capacity atomically. The snapshot fingerprint hashes sorted paths and contents. Replacing a folder snapshot removes absent files from future retrieval.

Generation claims the conversation revision with a compare-and-set update and a three-minute lease. Overlapping requests are rejected. Finished HTML is validated and persisted as a private draft before the SSE success event. Failure/cancellation releases the lease without replacing an earlier draft; abandoned leases expire. Recent messages and the draft survive page reloads.

Applying uploads an immutable object, then calls `apply_artifact_workspace_draft`. The SQL function locks the workspace, checks draft identity and active generation, and invokes the existing atomic-version function with the draft's expected version ID. It clears the accepted draft and appends the apply notification in the same transaction. Repeated/stale requests cannot create a second version. Failed uploads/RPCs may leave private orphan objects, as documented in the existing storage cleanup notes.

## Limits

- Six snapshots per personal artifact workspace; 100 files / 1 MB content per snapshot; 96 KB per file.
- A maximum 2.4 MB request body, parsed incrementally. Text control characters, unsupported binaries, generated trees, common credential paths and token patterns are rejected. Secret detection is heuristic.
- Conversation history retains the latest 40 messages, with one extra apply notification possible. Generation receives the last 12 messages, capped at 4,000 characters each.
- Source retrieval ranks filename/content keyword matches, adds README preference, and includes up to 60,000 characters, with at most 12,000 per file. References mark truncated excerpts. This is not semantic indexing or exhaustive codebase analysis.
- Claude's existing prompt/input/output/rate/timeout caps still apply. A large artifact can be viewed/downloaded even when it is too large for AI refinement.
- Each GitHub request has a timeout; blob fetching uses five requests at a time and a bounded overall loop. No repository code is executed. Imports fail on incomplete trees or changed commits during selection instead of silently mixing revisions.
- Local folders are explicit uploads. No server or model can access arbitrary paths on the user's computer. Continuous local sync, repository writes, PDF/Word conversion, and automated publish are outside this release.

## GitHub lifecycle

The App needs read-only Contents access. User tokens restrict access to the intersection of App and user repository access. OAuth uses random state, SHA-256 state storage, PKCE, a ten-minute expiry, and authenticated completion bound to the same Fixl account. State is consumed before the exchange. Tokens and PKCE verifiers use an authenticated encryption key stored only in deployment secrets.

The deployment must retain and back up the encryption key securely. Rotating it without migration invalidates existing encrypted credentials. Expiring user tokens require reconnecting. Disconnect deletes the credential from Fixl; it does not delete snapshots or revoke already downloaded content. Users can revoke the App's GitHub authorization separately.

Configure the exact frontend callback URL and confirm private repository installation / organizational approval in staging. No live GitHub App registration, authorization, Anthropic request, or database migration was performed during development.

## Verification

The expanded backend suite has 15 tests covering real permission/route code, source validation and retrieval, exact-commit blob reads, incomplete trees/branch changes, authenticated OAuth state binding, workspace isolation, draft-persistence failure, immutable keys, and both SQL migrations. SQL is executed in PGlite with a fixture schema, not the deployed Supabase database. Production build passes with placeholder environment values.

Frontend: seven regression tests, successful production build, and clean lint for changed files. Full lint has inherited failures in unrelated merged UI files. Browser review remains unverified because the managed preview launcher passes unsupported options to Next.js.

Run real staging checks for App install/authorization and expiry, private branches, local snapshot replace/remove, SSE cancellation, conflicting editors, source isolation across accounts, draft reopening, and same-link publication before production deployment. The code-doc connection opener creates a metadata-only artifact before its first draft; abandoned empty records can be removed through the normal document workflow.
