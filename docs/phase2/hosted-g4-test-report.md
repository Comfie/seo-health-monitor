# Controlled internal G4 test report

Completed 15 October 2026 (Africa/Johannesburg; evidence timestamps use UTC). Approval covers the operator and the two approved Gmail +beta-a/+beta-b accounts only. **No external beta is approved.**

## Result

**229 distinct hosted checks and 25 browser checks passed.** Local validation: **211 tests across 17 files**, type checking and lint passed. There are no unresolved failures in the executed suite. Two baseline application defects were reproduced, fixed and retested. One deliberately failed audit verifies bounded retries and transactional rollback; it is an expected test outcome.

Machine-readable results, deployment metadata and cleanup evidence: [hosted-g4-checks.json](hosted-g4-checks.json). This is an internal acceptance run, not a claim that all Stage 4A or external-launch requirements are complete.

## Source, deployment and isolation

The exact baseline was committed as 0d181a3 after scanning 117 staged text files for credential patterns and known local secrets. The two beta fixes are committed as **d31e13030c4cc76a1229ce6c8b3dea0e0ae3b714**, tree **3a83a3fc5e8ffeb10ab1f57d9fd435aee8fb62df**, following a second staged scan and validation. The services were built from clean Git exports, not the working directory. Later commits record documentation/evidence only. No source was pushed or merged into production.

| Service | Final deployment | Image digest |
| --- | --- | --- |
| Beta web | b83ab02c-7915-4f98-809d-b1ef8dc73c8a | sha256:d274d9beff49eec30e995794f7133b43d4a67556c411cd7f92181beeeeaa87df |
| Beta worker | f7e8de3c-9d93-4ebf-9dac-580dba4306ae | sha256:2cc60ad5c4ddf5679df3469230d1333e0b00de6e190ea2fecb3e4de5ec96d375 |
| Phase 1 | **Unchanged:** b921c2dc-3e09-4386-8605-209ece6febb1 | sha256:46a99985a198bfb86c7c550d576ca6fbb3b4705cb7b1d4d7103f8b63eb02c340 |

The owner-selected single Railway environment is still named production. Isolation is provided by separate beta web/worker services, beta PostgreSQL and a separate beta volume/secrets. Every deployment/configuration action targeted a beta service explicitly; the two database interruptions targeted only beta PostgreSQL. Phase 1 retained its deployment and image, has zero PHASE2_* variables, and its health endpoint returned 200.

G4 is true only on beta web. Registration remains invite-only; the library sign-up endpoint remains blocked. The exact three-address email allowlist and the domain-restricted sending-only Resend key remain in place. No full-access key was restored, no external recipient was invited, and no payments were introduced.

## Executed acceptance checks

| Area | Result and evidence |
| --- | --- |
| Invitations and real email | Only the two approved plus-address invitations were created. Resend accepted both invitation/verification sends. Both real emailed verification links were used; PostgreSQL confirms verified users, consumed invitations and one personal tenant/membership each. No verification flag or token was fabricated through database maintenance. |
| Registration boundaries | Public sign-up 404; invalid/consumed invitation registration 403. Injecting administrator/verified fields during registration did not grant either privilege. Exactly three users/invitations exist, including the original operator; all invitations are consumed. |
| Login, cookies and logout | Both API and real browser logins passed. Cookies have Secure, HttpOnly and SameSite=Lax. Both browser logouts and final API logouts passed; replaying saved old cookies returned 401. A and B finish with zero active sessions. |
| Same-domain isolation | A and B independently added example.com with distinct website/audit rows. Both completed initial and comparison scans. Website lists, histories, dashboards, JSON audit IDs and report access remained scoped to the caller. Real foreign tenant/user IDs in bodies and query strings could not change ownership or scope. |
| Direct unauthorized access | **150 direct probes** cover both customer directions and administrator-to-customer boundaries: website GET/PATCH/DELETE, audit start/status/findings/cancel/PageSpeed/AI, four exports, history, comparison, malformed/overflow/SQL-like IDs, legacy APIs, admin APIs and SSRF input. Foreign and missing resource probes return byte-identical 404 bodies. Anonymous APIs/report URLs are denied. Cross-account session revocation is denied. |
| Browser authorization | Separate isolated browser sessions passed dashboard/results access, foreign-audit and admin not-found pages, and logout for both accounts, with no runtime errors. Streamed not-found pages can return HTTP 200; the checks verify no protected content, not just the status. The owner's browser profile was not inspected or modified. |
| Reports and Fix with AI | PDF, CSV, JSON and Markdown passed through direct APIs and actual browser downloads for both accounts; download headers are private, no-store. Both PDFs parse with the correct audit ID; A's first page was also visually checked. JSON carries the correct owner's audit ID and no tenant/lease fields; CSV/Markdown are nonempty and parseable. Fix with AI pages, generated instructions and Markdown downloads passed for both accounts. |
| Usage and quotas | Website and monthly audit overrides were applied only to A and restored. A's cap did not consume B's allowance or charge a rejected request. A temporary uncrawled example.org website proved B's independent website allowance, then was removed. Per-account concurrency rejected a simultaneous second B scan. The five-page cap was retained; completed example.com scans each crawled one page. |
| Progress and normal worker execution | Real API observations include queued/0, running/68–70, analysing/94 and completed/100. The separate worker completed seven audits, including a fresh B scan after the injected terminal failure. |
| Worker outage and cancellation | With the worker deployment stopped, beta web/readiness stayed 200 and audits queued. Cancelling an unstarted audit refunded its allowance. Cancelling a running audit stopped it and retained the already-used allowance. The worker was restored from the same clean d31e130 export because Railway's CLI cannot redeploy a removed deployment. |
| Suspension | A's implemented tenant status flag was exercised through scoped offline maintenance. It denied A's website/audit/report access and enqueueing while B and the operator remained usable. The worker skipped A's suspended queued job. Restoring active status allowed it to complete. There is no new suspension/admin UI in this change. |
| Expired lease | One synthetic dead-worker lease was injected into B's queued test job while the worker was stopped. The deployed worker recovered it and completed with attempt 2 and a higher fencing counter. This tests actual recovery code against Railway PostgreSQL; it is not an actual hard-kill test. |
| Database interruption | Beta PostgreSQL was restarted. The running worker logged poll failed; retrying at 22:27:12 UTC and alive at 22:27:42 under the same worker ID, without a worker restart. Beta/Phase 1 health returned 200 afterwards. |
| Graceful restart, retries and atomicity | With no other active jobs, a watchdog-bounded lock on the beta checks table induced real result-write failures. The active worker was restarted; its lease was handed back without spending an attempt. The job stopped after exactly three failed attempts, with four total claims, a sanitized error, no partial page/check/issue rows, and export 409. A temporary zero PageSpeed allowance prevented provider calls during retries and was restored. The lock and maintenance connection were released. |

The test harness initially asserted an extra fencing increment on handback. The persisted result was rechecked against the correct invariant: claims increment the fence; handback decrements attempts without incrementing the fence. The final **three attempts/four claims** assertion passed. This was a harness correction, not an application failure.

## Issues found and fixed

1. **Oversized website IDs caused database errors.** Website GET/PATCH/DELETE accepted ten-digit values above PostgreSQL's signed integer maximum. They now return 404 before querying. Regression coverage includes 2147483648 and 9999999999 for all three methods; hosted malformed-ID retests passed.
2. **Disabled AI bypassed the ownership check.** The AI endpoint returned provider-unavailable 503 before validating foreign audit ownership. It now checks ownership first: foreign/missing IDs return the same 404; an owned request still returns 503 without spending quota when the optional provider is disabled.

Both new regression tests failed against the baseline before the fixes. The final local suite and hosted/browser checks pass.

## Final data and cleanup

| Item | Final state |
| --- | --- |
| A | Active; one example.com website; six audit rows including cancellations/fault test; **5/5 monthly audit units**, four PageSpeed units; no admin role or active session/job |
| B | Active; one example.com website; four audit rows; **4/5 monthly audit units**, four PageSpeed units; no admin role or active session/job |
| Audit outcomes | Seven completed, two intentionally cancelled, one intentionally failed; no queued/running jobs |
| Overrides and locks | Website/audit/PageSpeed overrides restored to original NULL defaults; no held test table lock |
| Email and registration | Three approved users/invitations; all consumed; exact allowlist; invite-only registration; G4 enabled only on beta web |
| Provider budget | Eight PageSpeed units across the beta, below the unchanged daily cap of 40 |
| Credentials | Generated test credentials are in ~/secure/seo-beta-internal-test-accounts.json, mode 0600; no passwords, cookies or invitation/verification links are in Git or this report |

## Still unverified or outside this run

- Successful live PageSpeed/Core Web Vitals measurements: Google's anonymous quota returned 429. Reports correctly show unavailable/unmeasured values, not passing measurements.
- Live optional AI consultant generation: no provider key is configured; owned requests safely return 503 with no quota spend. This is separate from the completed Fix with AI instruction tests.
- Actual ungraceful process kill, a simultaneously paused stale worker writing late, and load/global-concurrency tests across multiple worker replicas. Expired-lease recovery used the explicit synthetic lease injection described above.
- The broader hosted auth checklist: password reset/reuse, verification-link reuse, deliberate session expiry, invitation expiry/revocation, trusted client-IP measurement and rate-limit exhaustion.
- Suspension/quota administration screens or privileged administration APIs beyond invitations are not implemented here; existing flags/overrides were tested offline. Search Console, monitoring, retention/privacy and external-launch work remain separate stages.

## Reproduce or restore the tested application

Keep the current beta service variables/secrets, invite-only registration and recipient allowlist. Do not run migrations as part of redeployment. To rebuild exactly the tested application source:

~~~sh
RELEASE_DIR="$(mktemp -d /private/tmp/seo-beta-release.XXXXXX)"
git archive d31e13030c4cc76a1229ce6c8b3dea0e0ae3b714 | tar -x -C "$RELEASE_DIR"
railway up "$RELEASE_DIR" --path-as-root --project 6682ee67-83a0-4251-a282-cabcccb26091 --service seo-beta-web --environment production --detach --message "Restore tested d31e130"
railway up "$RELEASE_DIR" --path-as-root --project 6682ee67-83a0-4251-a282-cabcccb26091 --service seo-beta-worker --environment production --detach --message "Restore tested d31e130"
~~~

This restores application source only. It does not roll back test data, rotate secrets or touch Phase 1. An external beta still requires the owner's separate approval.
