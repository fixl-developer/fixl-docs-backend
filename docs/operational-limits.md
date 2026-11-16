# Operational limits and follow-up

## Preservation

HTML is independent of the originating chat after it is successfully saved. Database, storage, authentication, and application availability still matter. External assets/API requests are not bundled. Configure backups for both metadata and storage and verify that a restored document points to a restored immutable object.

An object is uploaded before its metadata transaction. A failed/ambiguous RPC may leave an unreferenced private object. Do not immediately delete it: the database may have committed before the response was lost. Use a delayed cleanup job that checks all version references. Document/project deletion currently removes database records, not a verified storage-retention policy.

Document creation and its first-version save are not one transaction across object storage and PostgreSQL. A failure can leave an incomplete document; the UI labels missing versions and allows a new upload. Review the library before retrying creation. Existing versions cannot be overwritten by a concurrent save; a stale expected-version ID is rejected.

## Existing features needing further work

- There is no tenant identifier or organization isolation in the current role model. Do not describe this release as multi-tenant SaaS.
- Invitation sending uses the existing Supabase mechanism. Verify acceptance, profile creation, redirect configuration, and password setup end to end.
- Session refresh / HttpOnly session management is not part of this change.
- The old anonymous `/api/upload` snippet endpoint and Browserless `/api/artifact/render` endpoint remain for existing clients. They are not used by the new UI. Their legacy limiter can fail open when Redis is absent; restrict or retire those routes before exposing this as a public service. `/api/fetch-url` is retired entirely because its former URL validation did not prevent DNS/redirect-based internal requests.
- Project last-owner checks and creation rollback remain separate operations; concurrent membership administration needs a transactional database function for strict guarantees.
- Model-account access, spend caps, per-workspace quotas, audit retention, alerting, and data-retention policies need operational configuration. No live provider calls or production credentials were used in this implementation.
- The base Supabase schema and policies are not versioned in this repository snapshot. The added migration requires the existing schema; bring the authoritative baseline under migration control before treating this as a reproducible deployment.

## Staging acceptance checks

1. Creator uploads a standalone HTML file; manager/founder can open it; unrelated employee cannot read its HTML or change public visibility.
2. Viewer can read assigned project artifacts but cannot save; editor can save but cannot delete another creator's artifact.
3. Open the same current version twice; save twice with the same `base_version_id`; the second attempt must return 409 without changing the first result.
4. Remove/disable Claude configuration and reopen an existing artifact. Saved HTML should load; generating a new draft should show an error.
5. Generate and cancel/close a draft; no new document version should exist. Generate again and accept; exactly one new saved version should become current.
6. Enable a public link, load it unsigned, disable it, then request both metadata and HTML again; both must return 404. Content already downloaded cannot be revoked.
7. Test invitations and session expiry with actual account settings, and repeat desktop/mobile/keyboard review in a normal browser. The managed preview available during implementation could not start Next.js because it passed unsupported command-line flags.
