#!/usr/bin/env node
/**
 * The one-command local demo (docs/brief.md "Local demo", docs/design.md §12,
 * docs/milestones.md M10): `corepack enable && pnpm install && pnpm demo`.
 *
 * Steps: check docker/pnpm are available → ensure `.env` exists (copied from
 * `.env.example` on a fresh clone — never committed, so a truly fresh checkout has no
 * `.env` at all) → `docker compose up` the local Postgres → migrate → seed demo data
 * (idempotent — safe to re-run) → start the API (Node entry, mock telephony provider,
 * dev routes on) and the web app (Vite, simulator page compiled in) → wait for both to
 * answer → request and retrieve a one-click sign-in link for the demo user → print the
 * walkthrough.
 *
 * No cloud accounts, no credentials, no Twilio — everything here is local/containerised
 * or in-process (brief: "no manual steps in between").
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TOTAL_STEPS = 6;

const API_URL = 'http://localhost:3001';
const WEB_URL = 'http://localhost:5173';
const DEMO_EMAIL = 'demo@telocc.example';

function step(n, msg) {
  console.log(`\n[${n}/${TOTAL_STEPS}] ${msg}`);
}

function commandOk(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'ignore', cwd: root });
  return !res.error && res.status === 0;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (res.error || res.status !== 0) {
    console.error(`\n✗ Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}

async function waitForUrl(url, { timeoutMs = 120_000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not listening yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

console.log('== Telocc local demo ==');

// --- 0. Preflight: docker + pnpm present, docker daemon reachable -----------------
if (!commandOk('docker', ['--version'])) {
  console.error(
    '\nDocker is required for the local demo (a containerised Postgres). Install Docker ' +
      '(or Docker Desktop) and try again.',
  );
  process.exit(1);
}
if (!commandOk('docker', ['info'])) {
  console.error(
    '\nDocker is installed but the daemon is not reachable. Start Docker and try again.',
  );
  process.exit(1);
}
if (!commandOk('docker', ['compose', 'version'])) {
  console.error('\n`docker compose` is not available. Update Docker to a version with Compose v2.');
  process.exit(1);
}
if (!commandOk('pnpm', ['--version'])) {
  console.error('\npnpm is required. Run `corepack enable` first, then try again.');
  process.exit(1);
}

// --- 1. .env -----------------------------------------------------------------------
step(1, 'Checking environment configuration...');
const envPath = path.join(root, '.env');
const envExamplePath = path.join(root, '.env.example');
if (!existsSync(envPath)) {
  copyFileSync(envExamplePath, envPath);
  console.log('Created .env from .env.example (dev-only secrets — fine for the local demo).');
} else {
  console.log('.env already exists — leaving it untouched.');
}

// --- 2. Postgres ---------------------------------------------------------------------
step(2, 'Starting Postgres (docker compose)...');
run('docker', ['compose', 'up', '-d', '--wait', 'db']);

// --- 3. Migrate ----------------------------------------------------------------------
step(3, 'Applying database migrations...');
run('pnpm', ['--filter', '@telocc/db', 'run', 'migrate']);

// --- 4. Seed (idempotent) -------------------------------------------------------------
step(4, 'Seeding demo data (idempotent — safe to re-run)...');
run('pnpm', ['--filter', '@telocc/db', 'run', 'seed:demo']);

// --- 5. Start API + web ----------------------------------------------------------------
step(5, 'Starting the API (mock telephony provider) and the web app...');

const apiEnv = { ...process.env, TELEPHONY_PROVIDER: 'mock', ENABLE_DEV_ROUTES: '1' };
const webEnv = { ...process.env, VITE_ENABLE_SIM: '1' };

const children = [];
function spawnChild(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env });
  children.push(child);
  return child;
}

spawnChild('pnpm', ['--filter', 'api', 'run', 'start'], apiEnv);
spawnChild('pnpm', ['--filter', 'web', 'exec', 'vite', '--port', '5173', '--strictPort'], webEnv);

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exitCode = code;
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\nA demo process exited unexpectedly (code ${code}).`);
      shutdown(code ?? 1);
    }
  });
}

const apiUp = await waitForUrl(`${API_URL}/health`);
if (!apiUp) {
  console.error('\nThe API did not become healthy in time — see its output above.');
  shutdown(1);
}
const webUp = shuttingDown ? false : await waitForUrl(WEB_URL);
if (!shuttingDown && !webUp) {
  console.error('\nThe web app did not become ready in time — see its output above.');
  shutdown(1);
}

// --- 6. One-click sign-in ---------------------------------------------------------------
let loginLine = `Open ${WEB_URL}/login, sign in as ${DEMO_EMAIL}, then open ${WEB_URL}/dev/mailbox for the link.`;
if (!shuttingDown) {
  step(6, 'Preparing an instant sign-in link for the demo user...');
  try {
    await fetch(`${API_URL}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL }),
    });
    const mailboxRes = await fetch(`${API_URL}/dev/mailbox`);
    const mailbox = await mailboxRes.json();
    const messages = (mailbox.messages ?? []).filter((m) => m.to === DEMO_EMAIL);
    const last = messages.at(-1);
    const match = last ? /https?:\/\/\S+/.exec(last.text) : null;
    if (match) {
      loginLine = `Sign in instantly — open this link, then go to ${WEB_URL}/:\n  ${match[0]}`;
    }
  } catch {
    // Rate-limited, or the mailbox wasn't reachable yet — fall back to manual login.
  }
}

if (!shuttingDown) {
  console.log(`
== Telocc demo is ready ==

App:        ${WEB_URL}
Demo user:  ${DEMO_EMAIL} (org "Demo s.r.o.", fully set up already — verified number,
            active Prague business number, Mon-Fri 09:00-17:00 office hours)

${loginLine}

What to try next (README.md has the full walkthrough):
  1. Log in, then open ${WEB_URL}/dev/simulator
  2. "Call now" under Inbound customer call     -> forwards, then Answer / Don't pick up
  3. "Simulate an out-of-hours call"             -> declined busy, no voicemail
  4. "Dial in from ..." under Appless outbound   -> keypad a CZ number -> bridges
     (try "Fill 112 (emergency)" to see the refusal tone + a logged emergency_refused row)
  5. Watch each row land in the call log panel, or on the app's own Calls page

Press Ctrl+C to stop the demo.
`);
}

await Promise.race(children.map((child) => new Promise((resolve) => child.on('exit', resolve))));
process.exit(process.exitCode ?? 0);
