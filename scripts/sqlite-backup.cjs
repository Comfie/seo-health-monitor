/* eslint-disable @typescript-eslint/no-require-imports -- standalone Node CJS maintenance tool */
// Online SQLite snapshot; never copy a live database without its WAL.
// Restores/imports always create a NEW destination; switching paths is explicit.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

async function snapshot(source, target) {
  if (!source || !target) throw new Error('Source and destination paths are required');
  source = path.resolve(source);
  target = path.resolve(target);
  if (source === target) throw new Error('Destination must differ from source');
  const db = new Database(source, { readonly: true, fileMustExist: true });
  let reserved = false;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    // Reserve exclusively: SQLite backup otherwise overwrites an existing file.
    fs.closeSync(fs.openSync(target, 'wx', 0o600));
    reserved = true;
    await db.backup(target);
    const check = new Database(target, { readonly: true, fileMustExist: true });
    try {
      if (check.pragma('integrity_check', { simple: true }) !== 'ok' || check.pragma('foreign_key_check').length) {
        throw new Error('Backup failed integrity checks');
      }
    } finally { check.close(); }
    fs.chmodSync(target, 0o600);
  } catch (err) {
    if (reserved) fs.unlinkSync(target);
    throw err;
  } finally { db.close(); }
}

module.exports = { snapshot };
if (require.main === module) {
  const [mode, sourceArg, targetArg] = process.argv.slice(2);
  const source = mode === 'backup' ? (process.env.DATABASE_PATH || './data/seo-health.db') : sourceArg;
  const target = mode === 'backup' ? sourceArg : targetArg;
  if (!['backup', 'restore'].includes(mode)) {
    console.error('Usage: sqlite-backup.cjs backup NEW_FILE | restore BACKUP NEW_FILE');
    process.exitCode = 1;
  } else {
    snapshot(source, target).then(() => console.log('Verified SQLite snapshot created (contains private application data)')).catch(() => {
      console.error('Snapshot failed. Check source, integrity, permissions and that destination does not exist.');
      process.exitCode = 1;
    });
  }
}
