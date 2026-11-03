#!/usr/bin/env node
/**
 * Bootstrap the session encryption key in a linked Vercel project.
 *
 * Requires Vercel CLI (authenticated and linked using `vercel link`).
 * Never rotates an existing key; doing so would invalidate all active cookies.
 * Key material is generated via node:crypto and passed only through child stdin.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const target = process.argv[2] ?? 'preview';
const allowed = new Set(['preview', 'production', 'development']);
if (!allowed.has(target) || process.argv.length > 3) {
  console.error('Usage: npm run setup:vercel-key -- [preview|production|development]');
  process.exit(2);
}

const command = process.env.VERCEL_CLI_BINARY || 'vercel';
const executable = command === 'vercel' || command === 'vc' ? command : null;
if (!executable) {
  console.error('Use the installed Vercel CLI (vercel or vc).');
  process.exit(2);
}

function run(args, input) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    input,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    // Do not print child stdout/stderr: they may contain secret values.
    throw new Error(`Vercel CLI failed (${args[0]} ${args[1] || ''}). Verify login and project link.`);
  }
  return result.stdout;
}

function listKeys() {
  const raw = run(['env', 'ls', target, '--format', 'json']);
  let response;
  try { response = JSON.parse(raw); }
  catch { throw new Error('Unexpected Vercel CLI JSON output; refusing to create a key.'); }
  const envs = Array.isArray(response) ? response
    : Array.isArray(response?.envs) ? response.envs
    : Array.isArray(response?.variables) ? response.variables
    : Array.isArray(response?.result?.envs) ? response.result.envs
    : null;
  if (!envs || envs.some(item => !item || typeof item.key !== 'string')) {
    throw new Error('Could not inspect existing variables reliably; refusing to create a key.');
  }
  return new Set(envs.map(item => item.key));
}

try {
  if (listKeys().has('SCM_SESSION_KEY')) {
    console.log(`SCM_SESSION_KEY already exists in ${target}; left unchanged.`);
    process.exit(0);
  }

  const key = randomBytes(32).toString('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Invalid generated key');
  // The CLI receives the secret over stdin, never argv, stdout, a file or Git.
  run(['env', 'add', 'SCM_SESSION_KEY', target, '--sensitive', '--yes'], key + '\n');
  if (!listKeys().has('SCM_SESSION_KEY')) {
    throw new Error('Vercel did not report the new variable; inspect the project in Settings.');
  }
  console.log(`SCM_SESSION_KEY created as a protected secret for ${target}.`);
  console.log('Redeploy this environment for the new secret to take effect.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Setup failed');
  process.exit(1);
}
