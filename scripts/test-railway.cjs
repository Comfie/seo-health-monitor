/* eslint-disable @typescript-eslint/no-require-imports -- Node production smoke test */
// Run after npm run build. All files/credentials are disposable; no Google requests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
const { snapshot } = require('./sqlite-backup.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-railway-smoke-'));
  const app = path.join(root, 'app');
  const volume = path.join(root, 'volume');
  fs.cpSync('.next/standalone', app, { recursive: true, filter: source => !path.basename(source).startsWith('.env') });
  fs.cpSync('public', path.join(app, 'public'), { recursive: true });
  fs.cpSync('.next/static', path.join(app, '.next/static'), { recursive: true });
  fs.mkdirSync(volume);
  const file = path.join(volume, 'seo.db');
  const db = new Database(file);
  migrate(drizzle(db), { migrationsFolder: path.resolve('drizzle') });
  db.prepare("insert into sites (id, host, display_url) values (1, 'example.com', 'https://example.com/')").run();
  const insert = db.prepare('insert into audits (id, site_id, input_url, start_url, status, attempts, heartbeat_at, completed_at) values (?, 1, ?, ?, ?, ?, ?, ?)');
  insert.run(1, 'https://example.com/', 'https://example.com/', 'completed', 1, null, Date.now());
  // An active future heartbeat must not be stolen; duplicate submission returns this ID.
  insert.run(2, 'https://example.com/', 'https://example.com/', 'running', 1, Date.now() + 300000, null);
  db.close();
  const probe = net.createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  const password = crypto.randomBytes(24).toString('hex');
  const env = { ...process.env, NODE_ENV: 'production', DATABASE_PATH: file, APP_URL: base, APP_SECRET: crypto.randomBytes(32).toString('hex'), AUTH_PASSWORD: password, AUTH_DISABLED: 'false', HOSTNAME: '127.0.0.1', PORT: String(port), AUDIT_CONCURRENCY: '1', PAGESPEED_MAX_PAGES: '0' };
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PAGESPEED_API_KEY', 'ANTHROPIC_API_KEY', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_VOLUME_MOUNT_PATH', 'NEXT_MANUAL_SIG_HANDLE']) delete env[key];
  let child;
  let cookie;
  async function boot() {
    child = spawn(process.execPath, ['server.js'], { cwd: app, env, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Standalone server exited before readiness');
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* starting */ }
      await sleep(100);
    }
    throw new Error('Readiness timed out');
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(r => child.once('exit', r));
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(5000)]);
    if (child.exitCode === null) { child.kill('SIGKILL'); await exited; throw new Error('Graceful shutdown timed out'); }
  }
  const request = (route, options = {}) => fetch(`${base}${route}`, { ...options, headers: { cookie, ...options.headers } });
  try {
    await boot();
    assert.equal((await fetch(`${base}/api/audits`)).status, 401);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })).status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ password }) });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /Secure/i); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
    cookie = setCookie.split(';')[0];
    assert.equal((await request('/api/audits')).status, 200);
    const duplicate = await request('/api/audits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/' }) });
    assert.equal(duplicate.status, 202); assert.equal((await duplicate.json()).id, 2);
    const unsafe = await request('/api/audits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1/' }) });
    assert.equal(unsafe.status, 400);
    assert.equal((await request('/api/audits', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    for (const format of ['json', 'csv', 'md', 'pdf']) {
      const response = await request(`/api/audits/1/export?format=${format}`);
      assert.equal(response.status, 200, `Export ${format}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length > 20);
      if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    }
    const fix = await request('/api/audits/1/fix');
    assert.equal(fix.status, 200); assert.ok((await fix.text()).length > 100);
    await stop();
    const seed = new Database(file);
    seed.prepare('update audits set heartbeat_at = ? where id = 2').run(Date.now() - 100000);
    // No outbound request: SSRF engine fails both queued/recovered jobs safely.
    seed.prepare("update audits set start_url = 'http://127.0.0.1/' where id = 2").run();
    seed.prepare("insert into audits (id, site_id, input_url, start_url, status) values (3, 1, 'http://127.0.0.1/', 'http://127.0.0.1/', 'queued')").run();
    seed.close();
    await snapshot(file, path.join(root, 'backup.db'));
    await snapshot(path.join(root, 'backup.db'), path.join(root, 'restore.db'));
    await boot();
    const check = new Database(file, { readonly: true });
    try {
      for (let i = 0; i < 100; i++) {
        if (check.prepare("select count(*) n from audits where id in (2,3) and status = 'failed'").get().n === 2) break;
        await sleep(100);
      }
      assert.equal(check.prepare('select attempts from audits where id = 2').get().attempts, 2);
      assert.equal(check.prepare('select status from audits where id = 3').get().status, 'failed');
      assert.equal(check.prepare('select status from audits where id = 1').get().status, 'completed');
    } finally { check.close(); }
    assert.equal((await request('/api/audits/1/export?format=pdf')).status, 200);
    await stop();
    console.log('PASS standalone: readiness, login/cookie, unauthorized access, CSRF, SSRF, duplicate job, PDF/CSV/JSON/Markdown, Fix instructions, SIGTERM/restart persistence, queued + interrupted recovery, backup/restore');
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await new Promise(r => child.once('exit', r)); }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(() => { console.error('FAIL standalone smoke test (no credentials logged)'); process.exitCode = 1; });
