// Test API + static server. Jalankan: node docs/test-api.mjs
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP_DB = path.join(ROOT, 'data', `test-${crypto.randomBytes(4).toString('hex')}.json`);
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(process.execPath, ['server.mjs', '--port', String(PORT)], {
  cwd: ROOT, env: { ...process.env, WK_DB: TMP_DB }, stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
srv.stderr.on('data', (d) => { stderr += d; });

const waitReady = () => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server tidak naik dalam 5s\n' + stderr)), 5000);
  srv.stdout.on('data', (d) => { if (String(d).includes('jalan di')) { clearTimeout(t); resolve(); } });
  srv.on('exit', (c) => { clearTimeout(t); reject(new Error('server exit ' + c + '\n' + stderr)); });
});

let pass = 0;
const fail = [];
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail.push(`${name}${detail ? ' → ' + detail : ''}`); console.log(`  GAGAL ${name}${detail ? ' → ' + detail : ''}`); }
}

async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html/kosong */ }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
}

const OWNER = { email: 'owner@waroengkuy.com', password: 'rahasia123' };

await waitReady();
console.log('API');

let r = await call('GET', '/api/catalog');
check('catalog publik = 27 produk', r.json?.products?.length === 27, r.json?.products?.length);
check('catalog publik tanpa hak edit', r.json?.editable === false && r.json?.owner === null);

check('session awal butuh setup', (await call('GET', '/api/session')).json?.needsSetup === true);
check('setup password pendek ditolak', (await call('POST', '/api/setup', { body: { email: OWNER.email, password: 'abc' } })).status === 400);
check('setup email invalid ditolak', (await call('POST', '/api/setup', { body: { email: 'bukan-email', password: 'rahasia123' } })).status === 400);

r = await call('POST', '/api/setup', { body: OWNER });
const tok = r.json?.token || '';
check('setup membuat owner + token', r.status === 200 && (/^[a-f0-9]{64}$/.test(tok) || (typeof tok === 'string' && tok.includes('.'))), r.text.slice(0, 80));
check('setup kedua ditolak', (await call('POST', '/api/setup', { body: { email: 'lain@x.com', password: 'rahasia123' } })).status === 403);
check('login password salah = 401', (await call('POST', '/api/login', { body: { email: OWNER.email, password: 'salah12345' } })).status === 401);

let lock = 0;
for (let i = 0; i < 6; i += 1) lock = (await call('POST', '/api/login', { body: { email: 'nobody@x.com', password: 'coba123456' } })).status;
check('5x gagal login lalu keylock 429', lock === 429, lock);

r = await call('POST', '/api/login', { body: OWNER });
check('login benar mengembalikan token', r.status === 200 && (/^[a-f0-9]{64}$/.test(r.json.token || '') || (typeof r.json.token === 'string' && r.json.token.includes('.'))));
const tok2 = r.json.token;
check('session mengenali token', (await call('GET', '/api/session', { token: tok })).json?.owner?.email === OWNER.email);

r = await call('PATCH', '/api/products/netflix-premium', { body: { hidden: true } });
check('PATCH tanpa token = 401', r.status === 401);
r = await call('PATCH', '/api/products/netflix-premium', { token: tok, body: { hidden: true } });
check('owner bisa menyembunyikan produk', r.json?.product?.hidden === true);
check('produk tersembunyi hilang dari publik', (await call('GET', '/api/catalog')).json.products.length === 26);
r = await call('GET', '/api/catalog', { token: tok });
check('owner tetap melihat 27 produk', r.json.products.length === 27 && r.json.editable === true);

r = await call('PATCH', '/api/products/netflix-premium', { token: tok, body: { vi: 0, price: 29000, stock: 12 } });
check('edit harga satu paket', r.json?.product?.variants?.[0]?.price === 29000 && r.json?.product?.variants?.[0]?.stock === 12);
r = await call('PATCH', '/api/products/netflix-premium', { token: tok, body: { vi: 0, price: -5 } });
check('harga negatif ditolak', r.status === 400 && r.json?.error);
r = await call('GET', '/api/catalog', { token: tok });
check('gagal edit tidak mengubah data', r.json.products.find((p) => p.slug === 'netflix-premium').variants[0].price === 29000);
r = await call('PATCH', '/api/products/netflix-premium', { token: tok, body: { vi: 9, price: 1000 } });
check('index paket di luar jangkauan ditolak', r.status === 400);

r = await call('POST', '/api/products', { token: tok, body: { name: 'Uji Coba Toko', cat: 'lainnya', variants: [{ label: '1 Bulan', price: 15000, stock: 3, ful: 'auto' }] } });
check('tambah produk', r.status === 201 && r.json?.product?.slug === 'uji-coba-toko');
check('produk baru langsung tampil', (await call('GET', '/api/catalog')).json.products.some((p) => p.slug === 'uji-coba-toko'));
r = await call('POST', '/api/products', { body: { name: 'Tanpa Auth' } });
check('tambah produk tanpa token = 401', r.status === 401);
r = await call('POST', '/api/products', { token: tok, body: { name: 'Uji Coba Toko' } });
check('slug duplikat dibuat unik', r.json?.product?.slug === 'uji-coba-toko-2');
r = await call('POST', '/api/products', { token: tok, body: { name: 'Sakit', cat: 'kategori-ngawur' } });
check('kategori tak dikenal ditolak', r.status === 400);
r = await call('POST', '/api/products', { token: tok, body: { name: 'Kosong', variants: [{ label: '' }] } });
check('paket tanpa nama/harga ditolak', r.status === 400);
r = await call('DELETE', '/api/products/uji-coba-toko-2', { token: tok });
check('hapus produk', r.status === 200 && r.json?.ok === true);
check('produk hilang setelah dihapus', !(await call('GET', '/api/catalog')).json.products.some((p) => p.slug === 'uji-coba-toko-2'));
check('hapus produk tidak ada = 404', (await call('DELETE', '/api/products/tiada-sekali-x', { token: tok })).status === 404);

r = await call('PATCH', '/api/products/netflix-premium', { token: tok, body: { hidden: false, vi: 0, price: 25000 } });
check('batch: scalar + vi bersama', r.status === 200 && r.json.product.hidden === false);
check('endpoint tak dikenal = 404', (await call('GET', '/api/ngawur')).status === 404);
check('body bukan JSON = 400', (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{rusak' })).status === 400);

console.log('Static');
r = await fetch(BASE + '/');
check('/ = index.html', r.status === 200 && (await r.text()).includes('<!DOCTYPE html>'));
r = await fetch(BASE + '/beli/pesanan');
check('SPA fallback /beli/pesanan', r.status === 200 && (await r.text()).includes('<!DOCTYPE html>'));
r = await fetch(BASE + '/assets/style.css');
check('assets diizinkan', r.status === 200 && r.headers.get('content-type').includes('text/css'));

console.log('Keselamatan file internal');
for (const p of ['/server.mjs', '/data/' + path.basename(TMP_DB), '/docs/test-api.mjs', '/../server.mjs']) {
  r = await fetch(BASE + p, { redirect: 'manual' });
  check(`${p} tertutup`, r.status === 404, r.status);
}
r = await fetch(BASE + '/assets/tidak-ada.css');
check('asset hilang = 404 (bukan index)', r.status === 404);

console.log('Sesi');
check('logout mengakhiri sesi', (await call('POST', '/api/logout', { token: tok })).status === 200
  && (await call('GET', '/api/session', { token: tok })).json.owner === null);
check('token lain masih hidup setelah logout', (await call('GET', '/api/session', { token: tok2 })).json.owner?.email === OWNER.email);
check('PATCH dengan token sudah logout = 401', (await call('PATCH', '/api/products/canva', { token: tok, body: { hidden: true } })).status === 401);

console.log('Ganti password');
r = await call('POST', '/api/password', { token: tok2, body: { current: 'salah12345', next: 'passwordbaru1' } });
check('password lama salah ditolak', r.status === 400 && /lama/.test(r.json?.error || ''));
check('password baru pendek ditolak', (await call('POST', '/api/password', { token: tok2, body: { current: OWNER.password, next: 'pendek' } })).status === 400);
check('ganti password tanpa sesi = 401', (await call('POST', '/api/password', { body: { current: OWNER.password, next: 'passwordbaru1' } })).status === 401);
r = await call('POST', '/api/password', { token: tok2, body: { current: OWNER.password, next: 'passwordbaru1' } });
check('ganti password berhasil + sesi baru issued', r.status === 200 && (/^[a-f0-9]{64}$/.test(r.json?.token || '') || (typeof r.json?.token === 'string' && r.json?.token.includes('.'))));
check('sesi lama hangus setelah ganti password', (await call('GET', '/api/session', { token: tok2 })).json?.owner === null);
check('password lama tidak bisa login', (await call('POST', '/api/login', { body: { email: OWNER.email, password: OWNER.password } })).status === 401);
check('password baru bisa login', (await call('POST', '/api/login', { body: { email: OWNER.email, password: 'passwordbaru1' } })).status === 200);

srv.kill();
rmSync(TMP_DB, { force: true });
console.log(`\n${pass} lulus, ${fail.length} gagal`);
if (fail.length) { fail.forEach((f) => console.log(' - ' + f)); process.exit(1); }
process.exit(0);
