#!/usr/bin/env node
/**
 * Creates the first super_admin user in the D1 database.
 *
 * Usage (local dev):
 *   node scripts/seed-admin.mjs --email admin@example.com --password changeme
 *
 * Usage (production — targets your deployed Worker's D1 via wrangler):
 *   node scripts/seed-admin.mjs --email admin@example.com --password changeme --remote
 *
 * The --remote flag passes --remote to the underlying `wrangler d1 execute` call.
 * Passwords are hashed with PBKDF2-SHA256 (100k iterations) inside the Worker's
 * Web Crypto environment by calling the auth service directly here with the same
 * algorithm.
 */

import { execSync } from 'child_process';
import { parseArgs } from 'util';

const { values } = parseArgs({
  options: {
    email:    { type: 'string'  },
    password: { type: 'string'  },
    remote:   { type: 'boolean', default: false },
    role:     { type: 'string',  default: 'super_admin' },
  },
  strict: true,
});

if (!values.email || !values.password) {
  console.error('Usage: node scripts/seed-admin.mjs --email <email> --password <password> [--remote] [--role admin|super_admin]');
  process.exit(1);
}

const { email, password, remote, role } = values;

// ── PBKDF2-SHA256 (same algorithm as services/auth.ts) ────────────────────────
// Node 22+ has globalThis.crypto via the Web Crypto standard.

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

function toB64(buf) {
  return Buffer.from(buf).toString('base64');
}

async function hashPassword(pwd) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pwd),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  return `pbkdf2:${ITERATIONS}:${toB64(salt)}:${toB64(new Uint8Array(hash))}`;
}

const passwordHash = await hashPassword(password);

// Escape single quotes for SQL
const safeEmail = email.replace(/'/g, "''");
const safeHash  = passwordHash.replace(/'/g, "''");
const safeRole  = (role === 'super_admin' || role === 'admin' ? role : 'admin').replace(/'/g, "''");

const sql = `INSERT INTO admin_users (email, password_hash, role) VALUES ('${safeEmail}', '${safeHash}', '${safeRole}') ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, updated_at = datetime('now');`;

const dbName = 'paramountcare-db-dev';
const remoteFlag = remote ? '--remote' : '--local';

const workerDir = new URL('../worker', import.meta.url).pathname;
const cmd = `npx wrangler d1 execute ${dbName} ${remoteFlag} --command="${sql.replace(/"/g, '\\"')}"`;
console.log(`Seeding admin user: ${email} (${safeRole})`);

try {
  execSync(cmd, { stdio: 'inherit', cwd: workerDir });
  console.log('Done.');
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
}
