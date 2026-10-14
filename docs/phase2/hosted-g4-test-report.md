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
