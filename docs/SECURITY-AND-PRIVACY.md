# Security and privacy

The security model as built, and the privacy position for the beta. This is a code-level description backed by the automated test suite (268 tests). It is not a penetration-test certificate or legal advice.

## Security model

| Area | How it is protected |
| --- | --- |
| **Sign-up** | Invite-only. An invitation is single-use, bound to one email address and expires after 72 hours; only its SHA-256 hash is stored. Email verification is required before sign-in. Roles or verification flags submitted with the form are ignored. |
| **Passwords and sessions** | Better Auth with scrypt hashing. Sessions are HTTP-only, Secure, SameSite cookies stored in the database. They last 7 days and are revalidated on every request. A password reset or change revokes the other sessions. Repeated failed sign-ins are throttled (HTTP 429 with `Retry-After`). Resetting a password gives the same response whether or not the email exists. |
| **CSRF** | Every state-changing request must carry the canonical `Origin`. Forwarded host headers can't widen it. |
| **Account isolation** | Every table has a non-null account key, and composite foreign keys stop rows from different accounts being linked. Every repository call re-checks membership and suspension. Another account's IDs return the same 404 as a missing ID. |
| **Administrators** | Admin rights are a separate grant that sign-up can't set. Admin screens show aggregates and account metadata, not customers' audit content. |
| **Crawler (SSRF)** | URLs and every redirect are checked against private, loopback, link-local and reserved addresses, including at DNS-resolution time. Only standard ports are allowed. Responses are size- and time-limited. The crawler honours robots.txt. |
| **Untrusted website content** | Titles, headings and text from crawled sites are treated as data. In Fix with AI and AI prompts they are fenced off and labelled, so they can't inject instructions. |
| **Google** | Read-only Search Console scope. OAuth uses PKCE and a short-lived, single-use state bound to the user, account, session and browser. Refresh tokens are encrypted with AES-256-GCM and never appear in API responses, exports, logs or admin views. |
| **Secrets** | Kept only in Railway variables or the operator's private `~/secure` folder. Startup refuses reused or short secrets. PageSpeed and Resend keys are sent as headers, never put in URLs or logs. |
| **Database access** | The app uses a restricted login (`seo_app`) that can read and write rows but can't change the schema or reach other databases. The operator login is used only for migrations and backups. |
| **Abuse and cost** | Per-account limits (websites, audits, pages, PageSpeed, AI) and global limits (running jobs, queue size, daily PageSpeed and AI budgets) are enforced atomically in PostgreSQL. |
| **Transport** | HTTPS only: HSTS, a strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, and a strict referrer policy. |
| **Logging** | Operational events use fixed codes. They never record passwords, cookies, tokens, full invitation links, provider error bodies or crawled content. |

**Tests:** `npm test` runs 268 tests. They cover crawler safety, checks, scoring, the queue (leases, fencing, crash recovery), account isolation (two customers and an administrator on every route), invitations, authentication, CSRF, limits, exports, account deletion and Search Console state handling.

**Known gaps:**
- There has been no independent penetration test.
- `npm audit` reports advisories in development-only tool chains.
- There is no external alerting yet (see [OPERATIONS.md](OPERATIONS.md#monitoring)).

## Privacy

**What is stored per account:**
- name and email, and a password hash;
- sessions and activity records;
- websites added, and audit results (crawled public page data, findings, PageSpeed results);
- optional Search Console data and encrypted Google tokens;
- usage counts.

**Who processes it:**
- Railway hosts the app and database in EU West (Netherlands).
- Google receives tested URLs for PageSpeed and handles Search Console requests.
- Resend delivers account email.
- Anthropic receives an audit's results (page URLs, titles, findings, public contact details found on the site, and Search Console figures if connected) only when a user requests an AI consultant report.

Each provider may process data outside South Africa.

**User rights, built in:**
- **Export:** Account → Export. Requires the current password; downloads all of the account's data as JSON. Google credentials and auth secrets are excluded.
- **Delete:** Account → Delete, then type `DELETE MY ACCOUNT`. This removes the account and all its data immediately, including queued jobs and Google tokens. Only an anonymous receipt and anonymous daily usage totals are kept. To revoke the Google grant itself, the user removes the app in their Google account settings.

**Retention:** suggested retention periods are configured, but automatic deletion is **off** until the owner approves a policy:

| Data | Kept for |
| --- | --- |
| Audits | 180 days |
| Logs and finished jobs | 30 days |
| Auth events, invitations and Search Console snapshots | 90 days |

**POPIA (South Africa):** before a wider launch the owner still needs to:
- confirm the information officer (currently the operator, Comfort Nyatsine, contact comfynyatsine@gmail.com) and register them with the Information Regulator if required;
- have the `/beta/privacy`, `/beta/terms` and `/beta/data-use` pages reviewed by a lawyer. They were rewritten as plain-language policies on 15 October 2026 but haven't been legally reviewed;
- confirm the lawful basis, retention periods and cross-border transfer safeguards for each provider (Act sections 13–14, 18–25 and 72).

For a security compromise, follow the [Information Regulator's current process](https://inforegulator.org.za/popia/).
