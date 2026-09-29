import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { hashPassword } from './auth.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const username=(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const password=process.env.ADMIN_PASSWORD || '';
if(!/^[a-z0-9._-]{3,64}$/.test(username) || password.length<12 || password.length>256) {
  console.error('Set ADMIN_USERNAME (3–64 letters, digits, dots, underscores or hyphens) and ADMIN_PASSWORD (12–256 characters) in .env, then run npm run admin.');
  process.exit(1);
}
const store=openDatabase(process.env.DATABASE_PATH || path.join(root,'data','hub.sqlite'),path.join(root,'data','db.json'));
const existing=store.db.prepare('SELECT id FROM administrators WHERE username=?').get(username);
const id=existing?.id || crypto.randomUUID();
store.db.exec('BEGIN IMMEDIATE');
try {
  store.db.prepare('INSERT INTO administrators VALUES (?,?,?) ON CONFLICT(username) DO UPDATE SET passwordHash=excluded.passwordHash').run(id,username,hashPassword(password));
  store.db.prepare('DELETE FROM sessions WHERE adminId=?').run(id);
  store.db.exec('COMMIT');
  console.log(`Administrator ${username} is ready. Students can browse without signing in.`);
} catch(err) { store.db.exec('ROLLBACK'); throw err; }
finally { store.close(); }
