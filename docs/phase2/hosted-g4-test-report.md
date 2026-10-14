# Controlled internal G4 test report

Owner approval: 15 October 2026, controlled internal testing only. No external beta approval.

## Scope and controls

- Only the beta Railway services (`seo-beta-web`, `seo-beta-worker`) and beta PostgreSQL data may change. The shared Railway environment is named `production`; Phase 1 is a separate service and must retain deployment `b921c2dc-3e09-4386-8605-209ece6febb1`.
- Invitations are exclusively for the previously approved owner Gmail `+beta-a` and `+beta-b` addresses. Registration remains invite-only, with the library sign-up endpoint blocked.
- Email stays on the domain-restricted send-only Resend key, with the exact three-address allowlist.
- Synthetic account names and `https://example.com` are used. Audits are capped at five pages; daily PageSpeed usage remains bounded at 40. Additional failure/queue tests must use only these accounts and controlled workloads.
- No production merge, Phase 1 deploy, payments, external invitations or public registration.

## Source and deployment evidence

The baseline source is preserved on `phase2-multiuser` after a staged secret scan. Exact commit, beta deployment IDs, test results, fixes and remaining limitations will be recorded below as testing proceeds. Credentials, cookies and invitation/verification links belong only in private local files, never in this report or Git.

## Planned acceptance checks

1. Real invitations, registration, verification, login and logout for both approved accounts.
2. Independent websites, audit results, usage and histories for the same public domain.
3. Cross-account website/audit operations, malformed IDs, comparison, export and administrator boundaries.
4. Worker progress, quota admission, cancellation and recovery from controlled failures.
5. PDF, CSV, JSON, Markdown and Fix with AI for both accounts.
6. Suspension enforcement where implemented, with temporary test overrides restored afterwards.

## Results

Source baseline `0d181a3` passed 209 local tests, type checking and lint. Its clean Git export was deployed to beta web `4c49f3db-58cc-45f9-b519-9bfc93b4e870` and worker `f81d0ce7-8c2f-4a65-a42f-a5bc05bf3eb7`.

G4 was enabled only on the beta web service. The two approved invitations were accepted by Resend, both synthetic registrations returned 200, public sign-up returned 404, and attempted role/verification field injection left both accounts unverified and without administrator roles. Real email verification is pending the owner's clicks; no account is verified through a database override.

Two additional regression checks exposed baseline defects before the hosted isolation matrix:

- Website IDs above PostgreSQL's signed integer maximum reached the database and caused errors. All three website methods now reject these IDs with 404 before querying.
- With the optional AI provider disabled, foreign AI-report IDs returned 503 before ownership was checked. Ownership is now checked first, preserving the uniform 404 boundary while owned requests still report the unavailable provider without spending quota.

Both checks failed against the baseline before the fixes. Retest and hosted results will be added below. Unexecuted checks remain unverified.

Revision `d31e13030c4cc76a1229ce6c8b3dea0e0ae3b714` passed **211 tests**, type checking and lint, and a second staged secret scan. Clean exports were deployed as web `b83ab02c-7915-4f98-809d-b1ef8dc73c8a` (image `sha256:d274d9beff49eec30e995794f7133b43d4a67556c411cd7f92181beeeeaa87df`) and worker `86f20b68-1a42-4a4d-93c3-482b4c044e25` (image `sha256:1e473a1c51dd5f70d2a42e74c4b56046e4b144d3dd8b5dd3ad31d61daf4e7f02`). No working-tree upload or Phase 1 deployment was used.

Controlled database interruption: restarted only the beta PostgreSQL service. The final worker revision logged `poll failed; retrying` at `2026-10-14T22:27:12Z`, then `alive, running=0` at `22:27:42Z` under the **same worker ID**, with no worker restart. Beta and Phase 1 health checks returned 200 afterwards. This verifies idle database-outage recovery; mid-audit interruption and job recovery remain pending.

A fresh isolated headless Chrome session rendered the beta login form successfully. It uses a temporary profile and does not inspect or change the owner's browser profile. Account browser journeys remain pending verification.

**Checkpoint:** 21 distinct hosted registration/guard checks passed; the two real-email verification checks are pending, not application failures. [Sanitized check evidence](hosted-g4-checks.json) contains statuses only, with no passwords, cookies or links. The owner has been asked to click the two real verification emails; no verification flag or token was fabricated through the operator database connection.

The A/B website/audit/export/usage-isolation matrix, authenticated malformed-ID retests, account suspension, per-account quota enforcement, mid-audit worker restart, cancellation, retry/lease recovery and both account browser journeys remain **unverified** until this dependency is resolved. The synthetic accounts exist but are not yet provisioned with tenants; no website or audit job has been created for either account at this checkpoint.
