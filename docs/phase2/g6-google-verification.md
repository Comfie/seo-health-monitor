# Current Google direction

Reuse of the existing Phase 1 Google client and PageSpeed key is explicitly authorized. See [the unified migration plan](unified-migration-plan.md#google-reuse-and-callbacks); separate credentials are no longer required, and one owner's authorized account is sufficient for initial consent testing. Actual live tests remain unverified until performed. The earlier deferred-beta checklist below is retained as historical evidence.

# Google and PageSpeed verification still deferred

G5 implementation is accepted. G6 can proceed without Google credentials. No live OAuth/Search Console success or successful PageSpeed measurement is claimed. Keep Search Console unconfigured, with clear unavailable/not-verified labels; no generated or fabricated Google metrics.

Before enabling Search Console for testers:

1. Create a separate beta Cloud project/client, enable Search Console API, configure testing consent and explicit test users, and register the exact beta callback URI from the G5 report. Store three separate beta secrets privately on web/worker. Do not reuse Phase 1's client or encryption secret.
2. Use A and B with independently authorised Google identities and real properties. Verify consent, PKCE callback, replay, state/session/browser swap, expired/denied/missing-scope responses and Railway proxy behaviour. Check responses, exports and restricted logs for token leakage.
3. Check domain and URL-prefix property coverage; refuse foreign, forged and unverified properties. Prove foreign IDs return the same denial as missing IDs; an administrator gets no implicit access to customer tokens/reports.
4. Retrieve actual analytics and URL Inspection data, including low traffic, anonymised queries, delayed data and unavailable inspections. Compare with the real property. Check reports and indexing recommendations retain source and availability labels.
5. Exercise actual token refresh, revocation, reconnect, Google 429/5xx recovery and fenced refresh jobs. Disconnect A while B remains usable; separately test shared-Google-identity handling. Delete only disposable accounts and check independent grants remain intact.
6. Record evidence as **hosted/live**, separately from mocks. Repeat G4 isolation/cancellation/report regression after the approved deployment.

Before advertising PageSpeed as working, the minimum is a beta-only API-restricted key on the worker (and web where needed), real mobile **and** desktop measurements from the deployed worker for a controlled public URL, plausible non-empty metrics with source/time, and correct unavailable/error handling on a failed request. Verify that the per-account and shared daily caps stop further provider calls. Re-test report/download labels, quota accounting and an A/B ownership denial. The previous anonymous 429 and unavailable measurements do not satisfy this gate. Never manufacture zero scores for absent measurements.

A private beta can run with both optional Google features disabled or explicitly unavailable, once the other G6 blockers are cleared. Retain technical crawl audits, findings and reports. Do not promise Google data, rankings, indexing or live performance measurements until the corresponding gate passes.
