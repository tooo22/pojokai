import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const TMP_DB = path.join(ROOT, 'data', `test-sec-${crypto.randomBytes(4).toString('hex')}.json`);
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(process.execPath, ['server.mjs', '--port', String(PORT)], {
  cwd: ROOT, env: { ...process.env, WK_DB: TMP_DB }, stdio: ['ignore', 'pipe', 'pipe'],
});

const waitReady = () => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Server timeout')), 5000);
  srv.stdout.on('data', (d) => { if (String(d).includes('jalan di')) { clearTimeout(t); resolve(); } });
  srv.on('exit', (c) => { clearTimeout(t); reject(new Error('Server exit ' + c)); });
});

await waitReady();
console.log('Testing security hardening...');

async function call(method, p, body = null, headers = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
}

let passed = 0;
function assert(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    console.error(`[FAIL] ${name} ${extra}`);
    process.exitCode = 1;
  }
}

// 1. Initial setup
let r = await call('POST', '/api/setup', { email: 'admin@sec.com', password: 'password123' });
assert('Initial setup succeeds', r.status === 200 && r.json?.token);
const cookie = r.headers.get('set-cookie') || '';
assert('Cookie contains HttpOnly', cookie.toLowerCase().includes('httponly'));

// 2. C-02: Second setup is blocked
r = await call('POST', '/api/setup', { email: 'hacker@evil.com', password: 'password123' });
assert('Subsequent setup is blocked with 403', r.status === 403);

// 3. H-01: Order Price Tampering check
// Product: capcut-pro (first variant is priced at official price)
r = await call('POST', '/api/orders', {
  code: 'POJOK-TESTPR',
  product: { name: 'CapCut Pro', variant: '1 Bulan Sharing', qty: 1, price: 1 },
  total: 1
});
assert('Order created with validated catalog price instead of client Rp1', r.status === 201 && r.json?.order?.total > 1, `Got total: ${r.json?.order?.total}`);

// 4. H-03: Premature Order Cancellation
r = await call('POST', '/api/orders/expire', { code: 'POJOK-TESTPR' });
assert('Premature expire under 5 minutes is rejected with 400', r.status === 400);

// 5. C-03: Webhook Fake Payment Injection
r = await call('POST', '/api/webhook/wistapay', {
  external_id: 'POJOK-TESTPR',
  reference: 'FAKE-REF-999',
  status: 'SUCCESS'
});
assert('Unverified fake webhook rejected', r.status === 400 || r.status === 502);

// Check order status remains unpaid
r = await call('GET', '/api/orders?code=POJOK-TESTPR');
const order = r.json?.orders?.[0];
assert('Order status remains Menunggu Pengiriman (not fake paid)', order?.status === 'Menunggu Pengiriman');

// 6. C-04: OAuth Fake Token / Email-only Bypass rejected
r = await call('POST', '/api/oauth/verify', { email: 'admin@sec.com' });
assert('OAuth request without valid idToken is rejected with 400', r.status === 400);

r = await call('POST', '/api/oauth/verify', { email: 'admin@sec.com', idToken: 'fake.jwt.token' });
assert('OAuth request with forged idToken is rejected with 401', r.status === 401);

// 7. C-05: Password Bypass string "oauth-google" rejected
r = await call('POST', '/api/login', { username: 'admin@sec.com', password: 'oauth-google' });
assert('Login with bypass password "oauth-google" rejected with 401', r.status === 401);

// 8. H-04: Security Bot webhook without secret rejected
r = await call('POST', '/api/webhook/security-bot', { message: { chat: { id: '7787855968' }, text: '/status' } });
assert('Security bot webhook without secret token rejected with 403', r.status === 403);

// 9. M-01: Cron monitor without auth rejected
r = await call('GET', '/api/cron/monitor');
assert('Cron monitor without secret rejected with 401', r.status === 401);

// 10. M-02: Cron monitor with valid secret accepted
r = await call('GET', '/api/cron/monitor', null, { Authorization: 'Bearer pojokai-cron-secret-key-2026' });
assert('Cron monitor with valid secret succeeds with 200', r.status === 200 && r.json?.success);

srv.kill();
rmSync(TMP_DB, { force: true });
console.log(`\nCompleted: ${passed}/12 security checks passed.`);
