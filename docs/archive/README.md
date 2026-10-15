# Archive (historical, not maintained)

Everything here describes earlier stages of the project and is kept only as history and test evidence. **Don't use it for current behaviour, setup or operations.** The current sources of truth are:

- [`../STATUS.md`](../STATUS.md): what is live, decisions and open work
- [`../HOW-IT-WORKS.md`](../HOW-IT-WORKS.md): product features and the audit engine
- [`../OPERATIONS.md`](../OPERATIONS.md): deployment, configuration, database, backups, monitoring
- [`../SECURITY-AND-PRIVACY.md`](../SECURITY-AND-PRIVACY.md): security model, privacy and data handling

| Folder | Contents |
| --- | --- |
| `phase1/` | The original single-owner app (SQLite on a Railway volume, shared password), its Railway/Vercel/Cloudflare deployment notes and its Search Console setup. Retired on 15 October 2026. |
| `phase2/` | The multi-user build: stage reports G1–G6, beta staging set-up, security reviews, the unified migration plan, and the `evidence/` test outputs. The unified migration plan was executed with changes; see the cutover record in `STATUS.md`. |
