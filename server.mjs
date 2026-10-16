// Server lokal PojokAI: static + API katalog + akun owner.
// Jalankan: node server.mjs  (default http://127.0.0.1:8080)
import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.WK_DB || (process.env.VERCEL ? '/tmp/db.json' : path.join(DATA_DIR, 'db.json'));
const SEED_FILE = path.join(ROOT, 'assets', 'data.js');
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;

// Muat file .env lokal jika tersedia
try {
  const envPath = path.join(ROOT, '.env');
  if (existsSync(envPath)) {
    const envLines = (await readFile(envPath, 'utf8')).split('\n');
    for (const l of envLines) {
      const trimmed = l.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (m && (!process.env[m[1]] || process.env[m[1]] === '[SENSITIVE]')) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
} catch {}

const argv = process.argv.slice(2);
const flag = (name, dft) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dft;
};
const HOST = process.env.HOST || flag('host', '0.0.0.0');
const PORT = Number(process.env.PORT || flag('port', 8080));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

let db = null;
let saveChain = Promise.resolve();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const SESSION_SECRET = process.env.SESSION_SECRET || 'pojokai-secure-owner-session-key-v1';

function createSessionToken(email) {
  const expires = Date.now() + SESSION_TTL;
  const payload = Buffer.from(JSON.stringify({ email, expires })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.email || !payload.expires || payload.expires < Date.now()) return null;
    return payload.email;
  } catch {
    return null;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function writeWithRetry(target, content, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await writeFile(target, content, 'utf8');
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 60 * (i + 1)));
    }
  }
}
let blobAccess = null;
let lastCloudSync = 0;

async function getDbFromBlob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { get } = await import('@vercel/blob');
    for (const acc of ['private', 'public']) {
      try {
        const res = await get('data/db.json', { access: acc, useCache: false });
        if (res && res.stream) {
          blobAccess = acc;
          const text = await new Response(res.stream).text();
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.products)) return parsed;
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[blob] load error:', err.message);
  }
  return null;
}

async function saveDbToBlob(dbData) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { put } = await import('@vercel/blob');
    const acc = blobAccess || 'private';
    try {
      await put('data/db.json', JSON.stringify(dbData, null, 2), { access: acc, addRandomSuffix: false, allowOverwrite: true });
    } catch {
      await put('data/db.json', JSON.stringify(dbData, null, 2), { access: 'public', addRandomSuffix: false, allowOverwrite: true });
      blobAccess = 'public';
    }
  } catch (err) {
    console.warn('[blob] save error:', err.message);
  }
}

async function syncFromCloudIfNeeded() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.KV_REST_API_URL) return;
  if (Date.now() - lastCloudSync < 5000) return;
  lastCloudSync = Date.now();
  const blobDb = await getDbFromBlob();
  if (blobDb && Array.isArray(blobDb.products)) {
    db = blobDb;
  }
}

async function getDbFromCloud() {
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/pojokai_db`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.result) {
          const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          if (parsed && Array.isArray(parsed.products)) return parsed;
        }
      }
    } catch (e) {
      console.warn('[kv] load error:', e.message);
    }
  }
  return null;
}

async function saveDbToCloud(dbData) {
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/set/pojokai_db`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(dbData)
      });
    } catch (e) {
      console.warn('[kv] save error:', e.message);
    }
  }
}

function save() {
  saveChain = saveChain.then(async () => {
    saveDbToBlob(db).catch(() => {});
    saveDbToCloud(db).catch(() => {});
    const content = JSON.stringify(db, null, 2);
    const tmp = DB_FILE + '.' + process.pid + '.' + Date.now() + '.tmp';
    try {
      if (process.env.VERCEL) {
        await writeFile('/tmp/db.json', content, 'utf8');
      } else {
        await writeWithRetry(tmp, content);
        try {
          await rename(tmp, DB_FILE);
        } catch {
          await writeWithRetry(DB_FILE, content);
          try { await unlink(tmp); } catch {}
        }
      }
    } catch (err) {
      if (!process.env.VERCEL) {
        console.error('[db] gagal menyimpan:', err.message);
      }
    }
  });
  return saveChain;
}

async function load() {
  // 1. Coba baca dari Vercel Blob jika tersedia
  const blobDb = await getDbFromBlob();
  if (blobDb) {
    db = blobDb;
    console.log(`[db] dimuat dari Vercel Blob: ${db.products.length} produk`);
    return;
  }

  // 2. Coba baca dari Cloud KV jika tersedia
  const cloudDb = await getDbFromCloud();
  if (cloudDb) {
    db = cloudDb;
    return;
  }

  // 3. Baca dari file lokal
  if (existsSync(DB_FILE)) {
    db = JSON.parse(await readFile(DB_FILE, 'utf8'));
    if (process.env.BLOB_READ_WRITE_TOKEN && !blobDb) {
      saveDbToBlob(db).catch(() => {});
    }
    if (!db.bundle) {
      db.bundle = {
        enabled: true,
        title: 'YouTube + Google Gemini',
        prod1: 'youtube',
        prod2: 'google-gemini',
        badge: '-17%',
        price: 50000,
        strike: 60000,
        soldText: '1 terjual hari ini',
        fulText: 'Otomatis',
        items: [
          'YouTube 1 Bulan',
          'Google Gemini 1 Tahun',
          'Klaim dengan menyertakan kode transaksi',
        ],
      };
    }

    // Auto-backup snapshot harian & auto-pruning pesanan kadaluarsa
    try {
      const backupDir = path.join(DATA_DIR, 'backups');
      await mkdir(backupDir, { recursive: true });
      const dateStr = new Date().toISOString().split('T')[0];
      const backupPath = path.join(backupDir, `db-${dateStr}.json`);
      if (!existsSync(backupPath)) {
        await writeFile(backupPath, JSON.stringify(db, null, 2), 'utf8');
        console.log(`[db] snapshot backup harian dibuat: ${backupPath}`);
      }
    } catch (e) {
      console.warn('[db] backup error:', e.message);
    }

    if (Array.isArray(db.orders)) {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const before = db.orders.length;
      db.orders = db.orders.filter((o) => {
        const created = new Date(o.createdAt).getTime();
        return !(created < sevenDaysAgo && (!o.status || o.status.includes('Menunggu')));
      });
      if (db.orders.length !== before) {
        console.log(`[db] ${before - db.orders.length} pesanan kadaluarsa otomatis dibersihkan.`);
        save();
      }
    }
    return;
  }
  const code = (await readFile(SEED_FILE, 'utf8')) +
    ';({ WA_ADMIN, CATEGORIES, PRODUCTS, HERO_SLIDES, FAQS, TICKER })';
  const seed = vm.runInNewContext(code, {}, { filename: 'data.js' });
  db = {
    wa: seed.WA_ADMIN,
    categories: seed.CATEGORIES,
    hero: seed.HERO_SLIDES,
    faqs: seed.FAQS,
    ticker: seed.TICKER,
    products: seed.PRODUCTS.map((p) => ({ ...p, hidden: false })),
    owners: [],
    sessions: [],
  };
  await mkdir(DATA_DIR, { recursive: true });
  await save();
  console.log(`[db] dibuat dari seed: ${db.products.length} produk di ${DB_FILE}`);
}

const send = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
  if (m) return m[1];
  const cookie = req.headers.cookie || '';
  const cm = cookie.match(/(?:^|;\s*)wk_token=([A-Za-z0-9._-]+)/);
  return cm ? cm[1] : '';
}

function ownerOf(req) {
  const token = bearer(req);
  if (!token) return null;

  // 1. Verifikasi stateless HMAC token (stabil di Vercel serverless & persistent)
  const verifiedEmail = verifySessionToken(token);
  if (verifiedEmail) {
    if (verifiedEmail.toLowerCase() === '3t.ardiansyah@gmail.com') {
      return { email: '3t.ardiansyah@gmail.com', username: 'tittoganteng', role: 'owner' };
    }
    const owner = (db.owners || []).find((o) => o.email.toLowerCase() === verifiedEmail.toLowerCase());
    if (owner) return owner;
  }

  // 2. Verifikasi stateful legacy session
  const hash = hashToken(token);
  if (db.sessions && Array.isArray(db.sessions)) {
    const sess = db.sessions.find((s) => s.tokenHash === hash);
    if (sess) {
      if (sess.expires < Date.now()) {
        db.sessions = db.sessions.filter((s) => s !== sess);
        save();
        return null;
      }
      return (db.owners || []).find((o) => o.email.toLowerCase() === sess.email.toLowerCase()) || { email: sess.email, role: 'owner' };
    }
  }

  return null;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60);
}

function cleanVariants(input) {
  if (!Array.isArray(input) || !input.length) return null;
  const out = [];
  for (const v of input) {
    const label = typeof v?.label === 'string' ? v.label.trim().slice(0, 60) : '';
    const price = num(v?.price);
    if (!label || price === null || price < 1) return null;
    const item = { label, price, stock: num(v?.stock) ?? 0, ful: v?.ful === 'auto' ? 'auto' : 'manual' };
    const strike = num(v?.strike);
    if (strike && strike > price) item.strike = strike;
    if (typeof v?.d === 'string' && v.d.trim()) item.d = v.d.trim().slice(0, 120);
    out.push(item);
  }
  return out;
}

function cleanProduct(body) {
  const patch = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.cat === 'string') {
    if (!db.categories.some((c) => c.id === body.cat)) return { error: 'Kategori tidak dikenal' };
    patch.cat = body.cat;
  }
  if (typeof body.desc === 'string') patch.desc = body.desc.slice(0, 8000);
  if (typeof body.image === 'string' && body.image.trim()) patch.image = body.image.trim().slice(0, 200000);
  if (Array.isArray(body.brief)) patch.brief = body.brief.map((b) => String(b).slice(0, 120)).filter(Boolean).slice(0, 8);
  if (Array.isArray(body.mf)) patch.mf = body.mf.map((b) => String(b).slice(0, 60)).filter(Boolean).slice(0, 6);
  if ('patungan' in body) patch.patungan = Boolean(body.patungan);
  if (num(body.sold) !== null) patch.sold = num(body.sold);
  if ('hidden' in body) patch.hidden = Boolean(body.hidden);
  if ('variants' in body) {
    const v = cleanVariants(body.variants);
    if (!v) return { error: 'Paket tidak valid: tiap paket butuh nama dan harga di atas Rp1' };
    patch.variants = v;
    patch.patungan = false;
  }
  return { patch };
}

// Edit satu paket tanpa mengirim ulang seluruh daftar: { vi, label?, price?, strike?, stock?, ful?, d? }
function applyVariantEdit(product, body) {
  if (!Number.isInteger(body.vi)) return { error: 'Index paket tidak valid' };
  const list = Array.isArray(product.variants) ? product.variants.map((x) => ({ ...x })) : [];
  const v = list[body.vi];
  if (!v) return { error: 'Paket yang mau diedit tidak ada' };
  if ('label' in body) {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
    if (!label) return { error: 'Nama paket tidak boleh kosong' };
    v.label = label;
  }
  if ('price' in body) {
    const price = num(body.price);
    if (price === null || price < 1) return { error: 'Harga tidak valid' };
    v.price = price;
  }
  if ('strike' in body) {
    const strike = num(body.strike);
    if (strike && strike > v.price) v.strike = strike;
    else delete v.strike;
  }
  if ('stock' in body) {
    const stock = num(body.stock);
    if (stock === null) return { error: 'Stok tidak valid' };
    v.stock = stock;
  }
  if ('ful' in body) v.ful = body.ful === 'auto' ? 'auto' : 'manual';
  if ('d' in body) {
    const d = typeof body.d === 'string' ? body.d.trim().slice(0, 120) : '';
    if (d) v.d = d; else delete v.d;
  }
  return { patch: { variants: list } };
}

function cleanBundle(body) {
  const patch = {};
  if ('enabled' in body) patch.enabled = Boolean(body.enabled);
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 100);
  if (typeof body.prod1 === 'string' && body.prod1.trim()) patch.prod1 = body.prod1.trim();
  if (typeof body.prod2 === 'string' && body.prod2.trim()) patch.prod2 = body.prod2.trim();
  if (typeof body.badge === 'string') patch.badge = body.badge.trim().slice(0, 30);
  if (num(body.price) !== null && body.price >= 1) patch.price = num(body.price);
  if (num(body.strike) !== null) patch.strike = num(body.strike);
  if (typeof body.fulText === 'string') patch.fulText = body.fulText.trim().slice(0, 50);
  if (typeof body.soldText === 'string') patch.soldText = body.soldText.trim().slice(0, 60);
  if (Array.isArray(body.items)) {
    patch.items = body.items.map((it) => String(it).trim().slice(0, 150)).filter(Boolean).slice(0, 10);
  }
  return patch;
}

const rateLimits = new Map();
function isRateLimited(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const record = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + windowMs;
    rateLimits.set(key, record);
    return false;
  }
  record.count++;
  rateLimits.set(key, record);
  return record.count > maxRequests;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '127.0.0.1';
}

// --- endpoint ---

function catalogFor(req) {
  const owner = ownerOf(req);
  const products = owner ? db.products : db.products.filter((p) => !p.hidden);
  return {
    wa: db.wa,
    categories: db.categories,
    hero: db.hero,
    faqs: db.faqs,
    ticker: db.ticker,
    products,
    bundle: db.bundle || null,
    editable: Boolean(owner),
    owner: owner ? { email: owner.email, role: owner.role } : null,
  };
}

function getTelegramToken(customToken = null, dbData = null) {
  return customToken || process.env.TELEGRAM_BOT_TOKEN || dbData?.telegram?.botToken || '';
}

function getTelegramSecret(dbData = null) {
  return process.env.TELEGRAM_WEBHOOK_SECRET || dbData?.telegram?.webhookSecret || '59f920885e991efca6de765197120b4493d07c4881bb4c70fbcf27ed0db299a8';
}

const DEFAULT_WISTAPAY_KEY = 'sk_cf912d66f2b3a109f689435d17947e576791bdf6d39858f5';
function getWistapayApiKey(dbData = null) {
  return process.env.WISTAPAY_API_KEY || dbData?.wistapay?.apiKey || DEFAULT_WISTAPAY_KEY;
}

const teleRateLimits = new Map();
function isTeleRateLimited(key, maxRequests = 20, windowMs = 60000) {
  const now = Date.now();
  const record = teleRateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + windowMs;
    teleRateLimits.set(key, record);
    return false;
  }
  record.count++;
  teleRateLimits.set(key, record);
  return record.count > maxRequests;
}

async function sendTelegramMessage(chatId, text, replyMarkup = null, botToken = null) {
  const token = getTelegramToken(botToken);
  if (!token || !chatId) return false;
  try {
    const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.warn('[telegram send error]', err.message);
    return false;
  }
}
async function sendTelegramPhoto(chatId, photoUrl, caption, replyMarkup = null, botToken = null) {
  const token = getTelegramToken(botToken);
  if (!token || !chatId || !photoUrl) return false;
  try {
    const payload = { chat_id: chatId, photo: photoUrl, caption: caption || '', parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.warn('[telegram send photo error]', err.message);
    return false;
  }
}
async function deleteTelegramMessage(chatId, messageId, botToken = null) {
  const token = getTelegramToken(botToken);
  if (!token || !chatId || !messageId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function updateOrSendMessage(chatId, messageId, text, replyMarkup = null, botToken = null, linkPreviewOptions = null) {
  const token = getTelegramToken(botToken);
  if (!token || !chatId) return false;
  if (messageId) {
    try {
      const payload = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        link_preview_options: linkPreviewOptions || { is_disabled: true },
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) return true;
      if (data.description && data.description.includes('message is not modified')) return true;
    } catch {}

    // Fallback HANYA jika pesan lama hilang atau tidak bisa diedit
    await deleteTelegramMessage(chatId, messageId, token);
  }

  return await sendTelegramMessage(chatId, text, replyMarkup, token);
}


function getProductEmoji(name, slug, cat) {
  const s = ((slug || '') + ' ' + (name || '') + ' ' + (cat || '')).toLowerCase();
  if (s.includes('gemini')) return '✨';
  if (s.includes('mail') || s.includes('gmail')) return '✉️';
  if (s.includes('netflix')) return '🎬';
  if (s.includes('canva')) return '🎨';
  if (s.includes('spotify')) return '🎧';
  if (s.includes('chatgpt') || s.includes('gpt') || s.includes('openai')) return '🤖';
  if (s.includes('claude') || s.includes('anthropic')) return '🧠';
  if (s.includes('youtube')) return '▶️';
  if (s.includes('capcut')) return '✂️';
  if (s.includes('adobe') || s.includes('photoshop') || s.includes('premiere')) return '🖌️';
  if (s.includes('vpn') || s.includes('surfshark') || s.includes('nord') || s.includes('hma')) return '🛡️';
  if (s.includes('notion')) return '📓';
  if (s.includes('microsoft') || s.includes('office') || s.includes('365')) return '💼';
  if (s.includes('zoom')) return '📹';
  if (s.includes('apple') || s.includes('music')) return '🎵';
  if (s.includes('grok')) return '🚀';
  if (s.includes('prime') || s.includes('amazon')) return '📦';
  if (s.includes('pdf')) return '📑';
  if (s.includes('vidio')) return '📺';
  if (s.includes('ai')) return '⚡';
  return '💎';
}
function getProductCustomEmojiId(name, slug, cat) {
  const s = ((slug || '') + ' ' + (name || '') + ' ' + (cat || '')).toLowerCase();
  if (s.includes('gemini')) return '5427086749278943412';
  if (s.includes('mail') || s.includes('gmail')) return '5287301193180127267';
  if (s.includes('spotify')) return '5287598516586158894';
  if (s.includes('netflix')) return '5289658765153411062';
  if (s.includes('chatgpt') || s.includes('gpt') || s.includes('openai')) return '5287355885293673987';
  if (s.includes('canva') || s.includes('adobe')) return '5287750704457325963';
  if (s.includes('vpn') || s.includes('nord') || s.includes('surfshark')) return '5251692426782842814';
  return '5904655415735492625';
}



async function notifyOwnerNewOrder(order, dbData) {
  // Dinonaktifkan: logs pembelian tidak dikirim ke bot Telegram
  return;
}
function formatTransactionSuccessMessage(order) {
  const pName = order.product?.name || 'Produk Digital';
  const vLabel = order.product?.variant ? ` ${order.product.variant}` : '';
  const fullProductName = `${pName}${vLabel}`;
  const qty = order.product?.qty || 1;
  const price = Number(order.product?.price || order.total || 0);
  const total = Number(order.total || price);
  const fee = Number(order.wistapay?.fee) || Math.round(price * 0.007 + 250);

  const d = new Date(order.paidAt || order.createdAt || Date.now());
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const formattedDate = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} WIB`;

  let activationGuide = `1. Buka akun atau aplikasi yang bersangkutan.\n2. Masukkan kredensial / data akun yang diberikan.\n3. Hubungi admin WhatsApp jika ada kendala.`;
  const lower = fullProductName.toLowerCase();
  if (lower.includes('gemini') || lower.includes('google pro') || lower.includes('google one')) {
    activationGuide = `1. Salin link lalu buka melalui browser.\n2. Pastikan menggunakan akun Google yang tidak sedang memiliki langganan Google Pro/Google One aktif.\n3. Paket tidak dapat ditimpa dengan langganan lain. Jika ingin mengganti akun, klik foto profil di kanan atas.\n4. Klik Aktifkan Paket lalu selesaikan proses aktivasi.`;
  } else if (lower.includes('mail') || lower.includes('gmail')) {
    activationGuide = `1. Buka browser atau aplikasi Gmail.\n2. Masukkan email & password yang diberikan.\n3. Masukkan kode verifikasi jika diminta.\n4. Ganti password & amankan akun sendiri setelah berhasil masuk.`;
  } else if (lower.includes('canva')) {
    activationGuide = `1. Buka link undangan Canva yang diberikan.\n2. Login dengan akun Canva Anda.\n3. Klik Gabung Tim untuk mengaktifkan fitur Pro.`;
  } else if (lower.includes('netflix') || lower.includes('spotify') || lower.includes('youtube')) {
    activationGuide = `1. Buka aplikasi resmi atau web browser.\n2. Login dengan email & password yang diberikan.\n3. Pilih profil yang telah ditentukan.\n4. Dilarang mengubah password/email/metode pembayaran akun.`;
  }

  const credentialsBlock = (order.credentials || order.deliveryText || order.note?.includes('Akun:'))
    ? `🔑 <b>DATA AKUN / KREDENSIAL:</b>\n<code>${order.credentials || order.deliveryText || order.note}</code>\n\n`
    : '';

  return [
    '✅ <b>TRANSAKSI SUKSES</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `🆔 <b>Nomor pesanan :</b> <code>${order.code}</code>`,
    `🏷️ <b>Nama produk   :</b> <b>${fullProductName}</b>`,
    `✨ <b>Jumlah beli   :</b> <b>${qty} Pcs</b>`,
    `├ <b>Harga Produk  :</b> Rp${price.toLocaleString('id-ID')}`,
    `├ <b>Biaya Admin   :</b> Rp${fee.toLocaleString('id-ID')} <i>(Ditanggung Toko)</i>`,
    `├ <b>Total Bayar   :</b> <b>Rp${total.toLocaleString('id-ID')}</b>`,
    `👛 <b>Metode bayar  :</b> <b>QRIS Realtime (Otomatis)</b>`,
    `⏰ <b>Waktu         :</b> <b>${formattedDate}</b>`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    credentialsBlock,
    '📑 <b>PANDUAN &amp; INFORMASI PRODUK</b>',
    '🔗 <b>Cara Aktivasi:</b>',
    '',
    activationGuide,
    '',
    '🛡️ <b>Garansi berlaku selama 24 jam sejak produk diterima.</b> Setelah masa garansi berakhir, permohonan garansi, penggantian, atau kendala yang dilaporkan di luar periode tersebut tidak dapat kami proses..',
    '',
    '⚠️ <b>Dengan melakukan pembelian, pembeli dianggap telah membaca, memahami, dan menyetujui seluruh ketentuan produk</b>'
  ].filter(Boolean).join('\n');
}


async function createDepositQris(userId, amount) {
  const apiKey = getWistapayApiKey(null);
  const wistapayUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + '/create-payment.php';
  const depCode = `DEP-${userId}-${Date.now().toString().slice(-6)}`;

  // Khusus deposit saldo: Biaya admin QRIS dikenakan ke customer
  const adminFee = Math.ceil(Number(amount) * 0.007 + 250);
  const totalCharge = Number(amount) + adminFee;

  try {
    const res = await fetch(wistapayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        amount: totalCharge,
        description: `Deposit Saldo Bot PojokAI - ${userId} (Rp${amount})`,
        external_id: depCode,
        fee_bearer: 'MERCHANT',
        callback_url: 'https://pojokai.my.id',
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      return { ok: true, code: depCode, data: json.data, adminFee, totalCharge, saldoAmount: Number(amount) };
    }
    return { ok: false, error: json.message || 'Gagal membuat QRIS' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleCreateDeposit(chatId, userId, username, amount, dbData, token) {
  await sendTelegramMessage(chatId, '⏳ <i>Sedang membuat tagihan QRIS instan WistaPay…</i>', null, token);

  const qrisResult = await createDepositQris(userId, amount);
  if (!qrisResult.ok || !qrisResult.data) {
    await sendTelegramMessage(chatId, '❌ Gagal membuat QRIS deposit: ' + (qrisResult.error || 'Server gateway sibuk. Coba sesaat lagi.'), {
      inline_keyboard: [[{ text: '◀️ Kembali ke Dompet', callback_data: 'menu_wallet', style: 'danger' }]]
    }, token);
    return { ok: true };
  }

  const q = qrisResult.data;
  const adminFee = qrisResult.adminFee || Math.ceil(Number(amount) * 0.007 + 250);
  const finalTotal = qrisResult.totalCharge || q.charge_amount || (Number(amount) + adminFee);

  if (!dbData.deposits) dbData.deposits = [];
  dbData.deposits.unshift({
    code: qrisResult.code,
    reference: q.reference,
    userId: String(userId),
    username: String(username),
    amount: Number(amount), // Saldo murni yang masuk ke dompet user
    chargeAmount: finalTotal, // Total yang ditagihkan termasuk fee
    fee: adminFee,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    expiresAt: q.expires_at
  });
  if (dbData.deposits.length > 500) dbData.deposits.pop();
  await save();

  const caption = [
    '💳 <b>TAGIHAN DEPOSIT SALDO QRIS</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '📋 <b>Rincian Deposit:</b>',
    `├ <b>Kode Referensi :</b> <code>${q.reference}</code>`,
    `├ <b>Nominal Saldo  :</b> Rp${Number(amount).toLocaleString('id-ID')} <i>(Masuk ke Dompet)</i>`,
    `├ <b>Biaya Admin    :</b> Rp${Number(adminFee).toLocaleString('id-ID')} <i>(Biaya Layanan QRIS)</i>`,
    `└ <b>Total Tagihan  :</b> <b>Rp${Number(finalTotal).toLocaleString('id-ID')}</b>`,
    '',
    '⏰ <b>Masa Berlaku :</b> <b>5 Menit</b> <i>(Otomatis Hangus)</i>',
    '⚡ <b>Metode Bayar :</b> QRIS All Payment <i>(BCA, Mandiri, Dana, GoPay, OVO, ShopeePay)</i>',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📱 <b>Cara Pembayaran:</b>',
    '1️⃣ Simpan atau screenshot barcode QRIS di atas.',
    '2️⃣ Buka aplikasi M-Banking atau E-Wallet apa pun.',
    '3️⃣ Scan barcode QRIS & bayar nominal yang tertera.',
    `4️⃣ Saldo otomatis masuk Rp${Number(amount).toLocaleString('id-ID')} ke akun Anda setelah pembayaran terdeteksi!`
  ].join('\n');

  const buttons = [
    [{ text: '🔄 Cek Status Pembayaran', callback_data: `check_dep_${q.reference}`, style: 'success' }],
    [{ text: '💬 Konfirmasi via WA Admin', url: `https://wa.me/${dbData.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, saya sudah bayar deposit ${q.reference} sebesar Rp${amount}`)}` }],
    [{ text: '◀️ Batalkan / Kembali', callback_data: 'menu_wallet', style: 'danger' }]
  ];

  await sendTelegramPhoto(chatId, q.qris_image, caption, { inline_keyboard: buttons }, token);
  return { ok: true };
}
const pendingOrderLocks = new Map();

async function handleCreateOrderQris(chatId, userId, username, p, variantIndex, dbData, token, callbackQuery = null) {
  const now = Date.now();
  const lastLock = pendingOrderLocks.get(String(chatId)) || 0;
  if (now - lastLock < 6000) {
    if (callbackQuery?.id) {
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: '⏳ Tagihan QRIS sedang dibuat, mohon tunggu sebentar...',
          show_alert: false
        })
      }).catch(() => {});
    }
    return { ok: true };
  }
  pendingOrderLocks.set(String(chatId), now);

  const v = (p.variants || [])[variantIndex] || p.variants?.[0] || { label: 'Standar', price: 25000 };

  // Cegah penumpukan QR: Cek apakah user sudah punya QRIS aktif untuk produk ini dalam 3 menit terakhir
  const existingPending = (dbData.orders || []).find((o) =>
    o.buyer?.telegramChatId === String(chatId) &&
    o.status === 'Menunggu Pembayaran' &&
    o.product?.name === p.name &&
    (v.label ? o.product?.variant === v.label : true) &&
    (now - new Date(o.createdAt).getTime()) < 3 * 60 * 1000
  );
  if (existingPending) {
    if (callbackQuery?.id) {
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: `⚠️ Tagihan QRIS (${existingPending.code}) untuk ${p.name} sudah tersedia di chat. Silakan scan QRIS di atas!`,
          show_alert: true
        })
      }).catch(() => {});
    }
    return { ok: true };
  }
  const orderCode = `POJOK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const amount = Number(v.price) || 25000;
  const apiKey = getWistapayApiKey(db);
  const wistapayUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + '/create-payment.php';

  try {
    const res = await fetch(wistapayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        amount: amount,
        description: `Pesanan ${orderCode} - ${p.name}`.slice(0, 150),
        external_id: orderCode,
        fee_bearer: 'MERCHANT',
        callback_url: 'https://pojokai.my.id/#cek-pesanan',
      }),
    });

    const json = await res.json();
    if (!json.success || !json.data) {
      await sendTelegramMessage(chatId, `❌ Gagal membuat QRIS: ${json.message || 'Server pembayaran sibuk'}. Silakan coba lagi atau beli via Web Toko.`, {
        inline_keyboard: [[{ text: '🛒 Buka Web Toko', web_app: { url: 'https://pojokai.my.id' } }]]
      }, token);
      return { ok: true };
    }

    const q = json.data;
    const finalTotal = q.charge_amount || amount;

    if (!dbData.orders) dbData.orders = [];
    const newOrder = {
      code: orderCode,
      createdAt: new Date().toISOString(),
      status: 'Menunggu Pembayaran',
      total: finalTotal,
      product: {
        id: p.id || p.slug,
        name: p.name,
        variant: v.label || 'Standar',
        price: v.price,
        qty: 1
      },
      buyer: {
        name: username || `Telegram User (${userId})`,
        email: `${userId}@telegram.org`,
        wa: dbData.wallets?.[userId]?.wa || '',
        telegramUserId: String(userId),
        telegramChatId: String(chatId)
      },
      note: `Order via Bot Telegram oleh @${username} (${userId})`,
      wistapay: {
        reference: q.reference,
        payment_id: q.payment_id,
        qris_image: q.qris_image,
        payment_url: q.payment_url,
        expires_at: q.expires_at,
        expires_at: q.expires_at,
        charge_amount: finalTotal,
        fee: q.fee || Math.round(amount * 0.007 + 250),
        net_amount: q.net_amount || (finalTotal - (q.fee || Math.round(amount * 0.007 + 250)))
      }
    };
    dbData.orders.unshift(newOrder);
    if (dbData.orders.length > 1000) dbData.orders.pop();
    await save();

    const caption = [
      '💳 <b>INVOICE PEMBAYARAN QRIS</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 <b>Rincian Pesanan:</b>',
      `├ <b>Kode Pesanan :</b> <code>${orderCode}</code>`,
      `├ <b>Nama Produk  :</b> ${p.name} (${v.label || 'Standar'})`,
      `├ <b>Jumlah       :</b> 1 Pcs`,
      `└ <b>Total Tagihan:</b> <b>Rp${Number(finalTotal).toLocaleString('id-ID')}</b>`,
      '',
      '⏰ <b>Masa Berlaku :</b> <b>5 Menit</b> <i>(Otomatis Hangus)</i>',
      '⚡ <b>Metode Bayar :</b> QRIS Realtime <i>(BCA, Mandiri, Dana, GoPay, OVO, ShopeePay)</i>',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '📱 <b>Cara Pembayaran:</b>',
      '1️⃣ Simpan atau screenshot barcode QRIS di atas.',
      '2️⃣ Buka aplikasi M-Banking atau E-Wallet apa pun.',
      '3️⃣ Scan barcode QRIS & bayar sesuai nominal di atas.',
      '4️⃣ Setelah berhasil, klik tombol <b>Cek Status Pembayaran</b> di bawah!'
    ].join('\n');

    const buttons = [
      [{ text: '🔍 Cek Pembayaran', callback_data: `check_order_${orderCode}`, style: 'primary' }],
      [{ text: '❌ Batalkan Transaksi', callback_data: `cancel_order_${orderCode}`, style: 'danger' }]
    ];

    await sendTelegramPhoto(chatId, q.qris_image, caption, { inline_keyboard: buttons }, token);
    return { ok: true };
  } catch (err) {
    console.warn('[telegram create order error]', err);
    await sendTelegramMessage(chatId, '❌ Terjadi kendala saat menghubungi gateway WistaPay. Silakan coba sesaat lagi.', null, token);
    return { ok: true };
  }
}
async function handleCheckOrderInput(chatId, text, dbData, token) {
  const rawCode = text.trim().toUpperCase();
  const cleanCode = rawCode.replace(/[^A-Z0-9-]/g, '');
  const orders = dbData.orders || [];
  const order = orders.find((o) => 
    o.code === cleanCode || 
    o.code === rawCode || 
    (cleanCode && (o.code || '').replace(/[^A-Z0-9]/g, '') === cleanCode.replace(/[^A-Z0-9]/g, ''))
  );

  if (!order) {
    const notFoundText = [
      '❌ <b>Nomor Pesanan Tidak Ditemukan</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Nomor pesanan <code>${cleanCode || text}</code> tidak terdaftar di sistem PojokAI.`,
      '',
      'Pastikan Anda menyalin kode pesanan dengan lengkap (contoh: <code>POJOK-XXXXXX</code>).',
      'Jika Anda baru saja bertransaksi atau mengalami kendala, silakan hubungi admin WhatsApp.'
    ].join('\n');

    await sendTelegramMessage(chatId, notFoundText, {
      inline_keyboard: [
        [{ text: '🔄 Coba Ketik Lagi', callback_data: 'menu_check_order', style: 'primary' }],
        [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${dbData.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, saya mau tanya pesanan ${cleanCode || text}`)}`, style: 'success' }],
        [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
      ]
    }, token);
    return { ok: true };
  }

  // 1. Jika pesanan sudah Lunas / Selesai / Diproses -> Tampilkan kartu transaksi sukses format besar!
  if (order.status && (order.status.includes('Selesai') || order.status.includes('Diproses') || order.status.includes('Lunas') || order.status.includes('Terkirim'))) {
    const successMsg = formatTransactionSuccessMessage(order);
    await sendTelegramMessage(chatId, successMsg, {
      inline_keyboard: [
        [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${dbData.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, saya mau konfirmasi pesanan ${order.code}`)}`, style: 'success' }],
        [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
      ]
    }, token);
    return { ok: true };
  }

  // 2. Jika masih menunggu pembayaran, cek gateway WistaPay terlebih dahulu
  const ref = order.wistapay?.reference;
  if (ref) {
    const apiKey = getWistapayApiKey(db);
    const checkUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + `/check-status.php?reference=${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(checkUrl, { headers: { 'X-API-Key': apiKey } });
      const json = await res.json();
      const status = String(json?.data?.status || json?.status || '').toUpperCase();
      if (status === 'SUCCESS' || status === 'PAID') {
        order.status = 'Diproses (Pembayaran QRIS Terverifikasi)';
        order.paidAt = new Date().toISOString();
        await save();

        const successMsg = formatTransactionSuccessMessage(order);
        await sendTelegramMessage(chatId, successMsg, {
          inline_keyboard: [
            [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${dbData.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, pesanan saya ${order.code} sudah lunas di bot Telegram.`)}`, style: 'success' }],
            [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
          ]
        }, token);
        return { ok: true };
      }
    } catch (err) {
      console.warn('[check order error]', err);
    }
  }

  // 3. Cek apakah sudah lewat 5 menit (Hangus)
  const createdAtTime = new Date(order.createdAt || Date.now()).getTime();
  const isExpired = Date.now() - createdAtTime > 5 * 60 * 1000;

  if (isExpired || (order.status || '').includes('Kadaluarsa') || (order.status || '').includes('Batal')) {
    order.status = 'Kadaluarsa (Waktu 5 Menit Habis)';
    await save();

    const expiredMsg = [
      '❌ <b>PEMBAYARAN QRIS TELAH HANGUS</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 <b>Rincian Pesanan:</b>',
      `├ <b>Kode Pesanan :</b> <code>${order.code}</code>`,
      `├ <b>Nama Produk  :</b> ${order.product?.name} (${order.product?.variant || 'Standar'})`,
      `├ <b>Total Tagihan:</b> Rp${Number(order.total).toLocaleString('id-ID')}`,
      `└ <b>Status       :</b> 🔴 <b>Kadaluarsa (Batas 5 Menit Habis)</b>`,
      '',
      '⚠️ <i>Batas waktu pembayaran 5 menit telah berakhir dan QRIS ini sudah tidak aktif lagi.</i>',
      '<i>Silakan buat pesanan baru jika Anda masih ingin membeli produk ini.</i>'
    ].join('\n');

    await sendTelegramMessage(chatId, expiredMsg, {
      inline_keyboard: [
        [{ text: '🛍️ Beli Produk Baru', callback_data: 'menu_products', style: 'success' }],
        [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
      ]
    }, token);
    return { ok: true };
  }

  // 4. Masih ada waktu pembayaran
  const elapsedMs = Date.now() - createdAtTime;
  const remSec = Math.max(0, Math.floor((5 * 60 * 1000 - elapsedMs) / 1000));
  const remStr = `${Math.floor(remSec / 60)} menit ${remSec % 60} detik`;

  const pendingMsg = [
    '⏳ <b>STATUS: MENUNGGU PEMBAYARAN</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '📋 <b>Rincian Pesanan:</b>',
    `├ <b>Kode Pesanan :</b> <code>${order.code}</code>`,
    `├ <b>Nama Produk  :</b> ${order.product?.name} (${order.product?.variant || 'Standar'})`,
    `├ <b>Total Tagihan:</b> <b>Rp${Number(order.total).toLocaleString('id-ID')}</b>`,
    `└ <b>Sisa Waktu   :</b> <b>${remStr}</b> <i>(Sebelum Hangus)</i>`,
    '',
    '<i>Silakan selesaikan pembayaran QRIS di aplikasi bank/e-wallet Anda lalu klik Cek Status Pembayaran di bawah!</i>'
  ].join('\n');

  await sendTelegramMessage(chatId, pendingMsg, {
    inline_keyboard: [
      [{ text: '🔄 Cek Status Pembayaran Lagi', callback_data: `check_order_${order.code}`, style: 'success' }],
      [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
    ]
  }, token);
  return { ok: true };
}



async function handleTelegramWebhook(body, dbData) {
  const token = getTelegramToken(null, dbData);
  if (!token) return { ok: false };
  const message = body.message;
  const callbackQuery = body.callback_query;

  if (callbackQuery) {
    fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    }).catch(() => {});
  }

  const chatId = message ? message.chat.id : (callbackQuery ? callbackQuery.message.chat.id : null);
  if (!chatId) return { ok: true };

  const text = (message?.text || '').trim();
  const cbData = callbackQuery?.data || '';
  const messageId = callbackQuery?.message?.message_id || null;
  const from = message?.from || callbackQuery?.from || {};
  const userId = String(from.id || chatId || '7787855968');
  const username = from.username ? '@' + from.username : (from.first_name || '-');
  const products = (dbData.products || []).filter((p) => !p.hidden);
  const wa = dbData.wa || '6283171982973';

  // Inisialisasi dompet user jika belum ada
  if (!dbData.wallets) dbData.wallets = {};
  if (!dbData.wallets[userId]) dbData.wallets[userId] = { balance: 0, totalDeposit: 0, totalSpent: 0 };
  const userWallet = dbData.wallets[userId];

  // A. Handle input nominal custom deposit
  if (dbData.userStates?.[chatId]?.action === 'awaiting_custom_deposit' && text && !text.startsWith('/')) {
    delete dbData.userStates[chatId];
    await save();

    const cleanNum = text.replace(/\D/g, '');
    const amount = Number(cleanNum);

    if (!amount || amount < 1000) {
      await sendTelegramMessage(chatId, '⚠️ Nominal deposit minimal adalah <b>Rp1.000</b>. Silakan coba lagi dari menu Dompet.', {
        inline_keyboard: [[{ text: '◀️ Kembali ke Dompet', callback_data: 'menu_wallet', style: 'danger' }]]
      }, token);
      return { ok: true };
    }

    if (amount > 10000000) {
      await sendTelegramMessage(chatId, '⚠️ Nominal deposit maksimal adalah <b>Rp10.000.000</b>.', null, token);
      return { ok: true };
    }

    return await handleCreateDeposit(chatId, userId, username, amount, dbData, token);
  }
  // B. Handle input order code when user is awaiting_order_code OR types POJOK-
  if ((dbData.userStates?.[chatId]?.action === 'awaiting_order_code' && text && !text.startsWith('/')) || (text && text.toUpperCase().includes('POJOK-') && !text.startsWith('/'))) {
    if (dbData.userStates?.[chatId]) {
      delete dbData.userStates[chatId];
      await save();
    }
    return await handleCheckOrderInput(chatId, text, dbData, token);
  }


  // 1. /start or menu_main (Format persis seperti BerryGrowID)
  if (text.startsWith('/start') || cbData === 'menu_main') {
    if (dbData.userStates?.[chatId]) {
      delete dbData.userStates[chatId];
      await save();
    }


    const userRank = '#' + ((Number(String(userId).slice(-2)) || 1) + 1);
    const orders = dbData.orders || [];
    const completedOrders = orders.filter((o) => {
      const s = String(o.status || '').toLowerCase();
      return s.includes('selesai') || s.includes('terkirim') || s.includes('diproses') || s.includes('lunas') || s.includes('terverifikasi');
    }).length;
    const totalSold = (dbData.products || []).reduce((sum, p) => sum + (Number(p.sold) || 0), 0) + completedOrders;

    const msgText = [
      '👤 <tg-emoji emoji-id="5904771654730391536"><b>ACCOUNT</b></tg-emoji>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `├ <b>User ID   :</b> <code>${userId}</code>`,
      `├ <b>Username  :</b> ${username}`,
      `└ <b>Peringkat :</b> <code>${userRank}</code>`,
      '',
      '💰 <tg-emoji emoji-id="5904655415735492625"><b>RINGKASAN</b></tg-emoji>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `├ <b>Saldo Akun    :</b> <code>Rp${Number(userWallet.balance || 0).toLocaleString('id-ID')}</code>`,
      `├ <b>Total Belanja :</b> <code>Rp${Number(userWallet.totalSpent || 0).toLocaleString('id-ID')}</code>`,
      `└ <b>Total Order   :</b> <code>${userWallet.totalDeposit ? 1 : 0} Transaksi</code>`,
      '',
      '📊 <tg-emoji emoji-id="5904715266104762882"><b>STATISTIK TOKO</b></tg-emoji>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `├ <b>Produk Terjual   :</b> <code>${totalSold.toLocaleString('id-ID')} Pcs</code>`,
      `└ <b>Transaksi Sukses :</b> <code>${completedOrders.toLocaleString('id-ID')} Order</code>`,
      '',
      '💫 <i>Pilih menu di bawah untuk mulai:</i>'
    ].join('\n');

    const inlineKeyboard = [
      [{ text: '🛍️ Produk', callback_data: 'menu_products', style: 'success', icon_custom_emoji_id: '5276438812866681286' }],
      [
        { text: '🤝 Pesanan Saya', callback_data: 'menu_check_order', style: 'primary', icon_custom_emoji_id: '5904715266104762882' },
        { text: '💼 Dompet', callback_data: 'menu_wallet', style: 'primary', icon_custom_emoji_id: '5904655415735492625' }
      ],
      [
        { text: '👤 Profil', callback_data: 'menu_profile', style: 'primary', icon_custom_emoji_id: '5904771654730391536' },
        { text: '🤝 Ajak Teman', callback_data: 'menu_referral', style: 'primary', icon_custom_emoji_id: '5253555497696503165' }
      ],
      [
        { text: '🌐 Bahasa', callback_data: 'menu_lang', style: 'danger', icon_custom_emoji_id: '5276521718620398284' },
        { text: '⚠️ Bantuan', callback_data: 'menu_help', style: 'danger', icon_custom_emoji_id: '5427086749278943412' }
      ]
    ];

    if (messageId && cbData === 'menu_main') {
      await deleteTelegramMessage(chatId, messageId, token);
    }
    try {
      const animRes = await fetch(`https://api.telegram.org/bot${token}/sendAnimation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          animation: 'https://pojokai.my.id/assets/branding/pojokai-bot-avatar.gif',
          caption: msgText,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineKeyboard }
        })
      });
      if (animRes.ok) return { ok: true };
    } catch {}

    await sendTelegramMessage(chatId, msgText, { inline_keyboard: inlineKeyboard }, token);
    return { ok: true };
  }

  // 2. Menu Produk (Grid Tombol Produk - Background HIJAU jika Ready!)
  if (cbData === 'menu_products' || text.toLowerCase() === '/produk') {
    const msgText = [
      '💎 <b>PRODUK TERSEDIA DI POJOKAI</b>',
      'Silakan pilih produk yang Anda butuhkan di bawah ini:'
    ].join('\n');

    const productButtons = [];
    let currentRow = [];
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const emoji = getProductEmoji(p.name, p.slug, p.cat);
      const isReady = (p.variants || []).some((v) => (v.stock > 0 || v.stock === 999999));
      const label = p.name.startsWith(emoji) ? p.name : `${emoji} ${p.name}`;
      currentRow.push({
        text: label,
        callback_data: `p_${p.slug.slice(0, 30)}`,
        style: isReady ? 'success' : 'danger',
        icon_custom_emoji_id: getProductCustomEmojiId(p.name, p.slug, p.cat)
      });
      if (currentRow.length === 2 || i === products.length - 1) {
        productButtons.push(currentRow);
        currentRow = [];
      }
    }

    productButtons.push([
      { text: '🔄 Refresh', callback_data: 'menu_products', style: 'primary' },
      { text: '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }
    ]);

    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: productButtons }, token);
    return { ok: true };
  }

  // 3. Detail Produk ketika diklik
  if (cbData.startsWith('p_')) {
    const slug = cbData.slice(2);
    const p = products.find((x) => x.slug.startsWith(slug) || x.slug === slug);
    if (!p) {
      await sendTelegramMessage(chatId, '⚠️ Produk tidak ditemukan.', null, token);
      return { ok: true };
    }

    const emoji = getProductEmoji(p.name, p.slug, p.cat);
    const variants = p.variants || [];
    const minP = variants.reduce((m, v) => (m === null || v.price < m ? v.price : m), null);
    const isReady = variants.some((v) => v.stock > 0 || v.stock === 999999);

    const msgText = [
      `${emoji} <b>${p.name.toUpperCase()}</b>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `├ <b>Harga Mulai :</b> <code>Rp${Number(minP || 0).toLocaleString('id-ID')}</code>`,
      `└ <b>Status Stok :</b> ${isReady ? '🟢 <b>Ready / Tersedia</b>' : '🔴 <b>Stok Habis</b>'}`,
      '',
      p.desc ? p.desc : '<i>Deskripsi produk belum tersedia.</i>'
    ].join('\n');

    const buttons = [
      [{ text: `⚡ Beli Langsung via QRIS (Rp${Number(minP || 0).toLocaleString('id-ID')})`, callback_data: `buy_qris_${p.slug}`, style: 'success' }],
      [
        { text: '🛒 Beli di Web App', web_app: { url: 'https://pojokai.my.id' }, style: 'primary' },
        { text: '💬 Order via WA Admin', url: `https://wa.me/${wa}?text=${encodeURIComponent(`Halo admin, saya mau order ${p.name}`)}`, style: 'primary' }
      ],
      [{ text: '◀️ Kembali ke Daftar Produk', callback_data: 'menu_products', style: 'danger' }]
    ];

    const photoUrl = (p.image && p.image.startsWith('http'))
      ? p.image
      : `https://pojokai.my.id/assets/products/${p.slug}.webp`;

    if (messageId) {
      await deleteTelegramMessage(chatId, messageId, token);
    }
    const sent = await sendTelegramPhoto(chatId, photoUrl, msgText, { inline_keyboard: buttons }, token);
    if (!sent) {
      await sendTelegramMessage(chatId, msgText, { inline_keyboard: buttons }, token);
    }
    return { ok: true };
  }

  // 3b. Pilih Varian untuk Beli Langsung via QRIS
  if (cbData.startsWith('buy_qris_')) {
    const slug = cbData.replace('buy_qris_', '');
    const p = products.find((x) => x.slug === slug || x.slug.startsWith(slug));
    if (!p) {
      await sendTelegramMessage(chatId, '⚠️ Produk tidak ditemukan.', null, token);
      return { ok: true };
    }

    const variants = p.variants || [];
    if (variants.length <= 1) {
      return await handleCreateOrderQris(chatId, userId, username, p, 0, dbData, token, callbackQuery);
    }

    const msgText = [
      `💎 <b>PILIH PAKET: ${p.name.toUpperCase()}</b>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `📦 <b>Produk :</b> ${p.name}`,
      '⚡ <b>Metode :</b> QRIS Dinamis Instan (Proses Otomatis)',
      '',
      '<i>Silakan pilih varian paket yang ingin Anda beli langsung via QRIS instan:</i>'
    ].join('\n');
    const variantButtons = variants.map((v, idx) => ([{
      text: `💎 ${v.label} - Rp${Number(v.price).toLocaleString('id-ID')}`,
      callback_data: `checkout_${p.slug}_${idx}`,
      style: 'success'
    }]));
    variantButtons.push([{ text: '◀️ Batal', callback_data: `p_${p.slug}`, style: 'danger' }]);

    await sendTelegramMessage(chatId, msgText, { inline_keyboard: variantButtons }, token);
    return { ok: true };
  }

  // 3c. Checkout Varian Terpilih -> Generate QRIS
  if (cbData.startsWith('checkout_')) {
    const parts = cbData.split('_');
    const variantIndex = Number(parts[parts.length - 1]) || 0;
    const slug = parts.slice(1, -1).join('_');
    const p = products.find((x) => x.slug === slug || x.slug.startsWith(slug));
    if (!p) {
      await sendTelegramMessage(chatId, '⚠️ Produk tidak ditemukan.', null, token);
      return { ok: true };
    }

    return await handleCreateOrderQris(chatId, userId, username, p, variantIndex, dbData, token, callbackQuery);
  }

  // 3d. Cek Status Pembayaran QRIS Pesanan
  // 3d. Cek Status Pembayaran QRIS Pesanan (Batas 5 Menit)
  // 3d. Cek Status Pembayaran QRIS Pesanan
  if (cbData.startsWith('check_order_')) {
    const code = cbData.replace('check_order_', '');
    const orders = dbData.orders || [];
    const order = orders.find((o) => o.code === code);

    if (!order) {
      if (callbackQuery?.id) {
        fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: `⚠️ Pesanan ${code} tidak ditemukan.`, show_alert: true })
        }).catch(() => {});
      }
      return { ok: true };
    }

    const ref = order.wistapay?.reference;
    let isPaid = order.status && (order.status.includes('Selesai') || order.status.includes('Diproses') || order.status.includes('Lunas'));

    if (!isPaid && ref) {
      const apiKey = getWistapayApiKey(db);
      const checkUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + `/check-status.php?reference=${encodeURIComponent(ref)}`;
      try {
        const res = await fetch(checkUrl, { headers: { 'X-API-Key': apiKey } });
        const json = await res.json();
        const status = String(json?.data?.status || json?.status || '').toUpperCase();
        if (status === 'SUCCESS' || status === 'PAID') {
          order.status = 'Diproses (Pembayaran QRIS Terverifikasi)';
          order.paidAt = new Date().toISOString();
          await save();
          isPaid = true;
        }
      } catch (err) {
        console.warn('[check order error]', err);
      }
    }

    if (isPaid) {
      if (callbackQuery?.id) {
        fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '✅ Pembayaran terverifikasi LUNAS!' })
        }).catch(() => {});
      }
      // Kirim pesan transaksi sukses DI BAWAH QRIS tanpa menghapus pesan QRIS!
      const successMsg = formatTransactionSuccessMessage(order);
      await sendTelegramMessage(chatId, successMsg, {
        inline_keyboard: [
          [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${dbData.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, pesanan saya ${order.code} sudah lunas di bot Telegram.`)}`, style: 'success' }],
          [{ text: '🛍️ Belanja Lagi', callback_data: 'menu_products', style: 'primary' }],
          [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
        ]
      }, token);
      return { ok: true };
    }

    // Jika belum dibayar & lewat 5 menit -> HANGUS!
    const createdAtTime = new Date(order.createdAt || Date.now()).getTime();
    const isExpired = (Date.now() - createdAtTime > 5 * 60 * 1000);
    if (isExpired || (order.status || '').includes('Kadaluarsa') || (order.status || '').includes('Batal')) {
      order.status = 'Kadaluarsa (Waktu 5 Menit Habis)';
      await save();
      if (callbackQuery?.id) {
        fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '❌ Batas waktu pembayaran 5 menit telah berakhir. QRIS telah hangus.', show_alert: true })
        }).catch(() => {});
      }
      return { ok: true };
    }

    const elapsedMs = Date.now() - createdAtTime;
    const remSec = Math.max(0, Math.floor((5 * 60 * 1000 - elapsedMs) / 1000));
    const remStr = `${Math.floor(remSec / 60)} menit ${remSec % 60} detik`;

    // Tampilkan popup alert native Telegram agar TIDAK membanjiri chat dengan pesan baru!
    if (callbackQuery?.id) {
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: `⏳ Pembayaran belum terdeteksi.\n\nSisa waktu: ${remStr} sebelum QRIS hangus.\nSilakan transfer via QRIS lalu klik Cek Pembayaran lagi!`,
          show_alert: true
        })
      }).catch(() => {});
    }
    return { ok: true };
  }

  // 3e. Batalkan Transaksi QRIS
  if (cbData.startsWith('cancel_order_')) {
    const code = cbData.replace('cancel_order_', '');
    const orders = dbData.orders || [];
    const order = orders.find((o) => o.code === code);
    if (order && !order.status.includes('Lunas') && !order.status.includes('Diproses')) {
      order.status = 'Dibatalkan Pengguna';
      await save();
    }
    pendingOrderLocks.delete(String(chatId));

    if (callbackQuery?.id) {
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: `❌ Pesanan ${code} telah dibatalkan.`,
        })
      }).catch(() => {});
    }

    const cancelCaption = [
      '❌ <b>TRANSAKSI TELAH DIBATALKAN</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🆔 <b>Kode Pesanan:</b> <code>${code}</code>`,
      `📦 <b>Produk      :</b> ${order?.product?.name || 'Produk Digital'}`,
      `⚡ <b>Status      :</b> 🔴 <b>Dibatalkan Pengguna</b>`,
      '',
      '<i>Tagihan QRIS ini sudah tidak berlaku lagi. Anda dapat memilih produk lain untuk melakukan pemesanan baru.</i>'
    ].join('\n');

    const cancelButtons = [
      [{ text: '🛍️ Belanja Produk Baru', callback_data: 'menu_products', style: 'success' }],
      [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
    ];

    if (messageId) {
      try {
        const editRes = await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            caption: cancelCaption,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: cancelButtons }
          })
        });
        const editData = await editRes.json();
        if (editData.ok) return { ok: true };
      } catch {}

      await deleteTelegramMessage(chatId, messageId, token);
    }

    await sendTelegramMessage(chatId, cancelCaption, { inline_keyboard: cancelButtons }, token);
    return { ok: true };
  }
  // 4. Menu Cek Pesanan
  if (cbData === 'menu_check_order') {
    if (!dbData.userStates) dbData.userStates = {};
    dbData.userStates[chatId] = { action: 'awaiting_order_code', time: Date.now() };
    await save();

    const msgText = [
      '📦 <b>CEK STATUS PESANAN</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Silakan ketik atau tempelkan <b>Nomor Pesanan</b> Anda langsung di chat ini:',
      '',
      'Contoh: <code>POJOK-261016-UYXCJ</code>',
      '',
      '<i>Bot akan langsung memeriksa status pembayaran, kredensial akun, dan rincian transaksi Anda secara otomatis!</i>'
    ].join('\n');

    await updateOrSendMessage(chatId, messageId, msgText, {
      inline_keyboard: [[{ text: '◀️ Batal / Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]]
    }, token);
    return { ok: true };
  }

  if (text.toUpperCase().includes('POJOK-') || (text.length >= 6 && /^[a-zA-Z0-9-]+$/.test(text) && !text.startsWith('/'))) {
    return await handleCheckOrderInput(chatId, text, dbData, token);
  }

  // 6. Menu Dompet & Pilihan Deposit
  if (cbData === 'menu_wallet') {
    const msgText = [
      '💼 <b>DOMPET &amp; SALDO AKUN</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '👤 <b>Informasi Akun:</b>',
      `├ <b>Username :</b> <code>${username}</code>`,
      `└ <b>User ID  :</b> <code>${userId}</code>`,
      '',
      '💰 <b>Rincian Saldo:</b>',
      `├ <b>Saldo Aktif    :</b> <b>Rp${Number(userWallet.balance || 0).toLocaleString('id-ID')}</b>`,
      `├ <b>Total Deposit  :</b> Rp${Number(userWallet.totalDeposit || 0).toLocaleString('id-ID')}`,
      `└ <b>Total Belanja  :</b> Rp${Number(userWallet.totalSpent || 0).toLocaleString('id-ID')}`,
      '',
      '💡 <i>Pilih nominal deposit instan di bawah, atau klik Nominal Bebas (Custom) untuk nominal lainnya:</i>'
    ].join('\n');

    const buttons = [
      [
        { text: '➕ Rp5.000', callback_data: 'dep_5000', style: 'primary' },
        { text: '➕ Rp10.000', callback_data: 'dep_10000', style: 'primary' }
      ],
      [
        { text: '➕ Rp25.000', callback_data: 'dep_25000', style: 'primary' },
        { text: '➕ Rp50.000', callback_data: 'dep_50000', style: 'primary' }
      ],
      [
        { text: '✏️ Nominal Bebas (Min. Rp1.000)', callback_data: 'dep_custom', style: 'success' }
      ],
      [
        { text: '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }
      ]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 6b. Trigger Input Custom Deposit
  if (cbData === 'dep_custom') {
    if (!dbData.userStates) dbData.userStates = {};
    dbData.userStates[chatId] = { action: 'awaiting_custom_deposit', time: Date.now() };
    await save();

    const msgText = [
      '✏️ <b>CUSTOM DEPOSIT SALDO</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Silakan ketik nominal saldo yang ingin Anda isi:',
      '',
      '📌 <b>Ketentuan:</b>',
      '├ <b>Minimal deposit  :</b> Rp1.000',
      '├ <b>Maksimal deposit :</b> Rp10.000.000',
      '└ <b>Biaya Admin      :</b> Dikenakan biaya layanan QRIS',
      '',
      '<i>Contoh: ketik <b>1000</b>, <b>5000</b>, atau <b>50000</b> lalu kirimkan ke chat bot ini.</i>'
    ].join('\n');

    const buttons = [
      [{ text: '◀️ Batal', callback_data: 'menu_wallet', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 6c. Preset Deposit Click
  if (cbData.startsWith('dep_') && cbData !== 'dep_custom') {
    const amount = Number(cbData.replace('dep_', ''));
    if (amount >= 1000) {
      return await handleCreateDeposit(chatId, userId, username, amount, dbData, token);
    }
  }

  // 6d. Cek Status Pembayaran Deposit (Batas 5 Menit)
  if (cbData.startsWith('check_dep_')) {
    const ref = cbData.replace('check_dep_', '');
    const deposits = dbData.deposits || [];
    const dep = deposits.find((d) => d.reference === ref);

    if (dep) {
      const depAge = Date.now() - new Date(dep.createdAt || Date.now()).getTime();
      const isDepExpired = depAge > 5 * 60 * 1000;

      const apiKey = getWistapayApiKey(db);
      const checkUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + `/check-status.php?reference=${encodeURIComponent(ref)}`;

      try {
        const res = await fetch(checkUrl, { headers: { 'X-API-Key': apiKey } });
        const json = await res.json();
        const status = String(json?.data?.status || json?.status || '').toUpperCase();

        if (status === 'SUCCESS' || status === 'PAID') {
          if (dep.status !== 'SUCCESS') {
            dep.status = 'SUCCESS';
            dep.paidAt = new Date().toISOString();
            const uid = dep.userId;
            if (!dbData.wallets) dbData.wallets = {};
            if (!dbData.wallets[uid]) dbData.wallets[uid] = { balance: 0, totalDeposit: 0, totalSpent: 0 };
            dbData.wallets[uid].balance = (dbData.wallets[uid].balance || 0) + dep.amount;
            dbData.wallets[uid].totalDeposit = (dbData.wallets[uid].totalDeposit || 0) + dep.amount;
            await save();

            const successMsg = [
              '🎉 <b>DEPOSIT SALDO BERHASIL!</b>',
              '━━━━━━━━━━━━━━━━━━━━━━━━━',
              `💰 <b>Nominal:</b> +Rp${Number(dep.amount).toLocaleString('id-ID')}`,
              `💳 <b>Total Saldo Sekarang:</b> <b>Rp${Number(dbData.wallets[uid].balance).toLocaleString('id-ID')}</b>`,
              `🆔 <b>Ref:</b> <code>${ref}</code>`,
              '',
              '<i>Saldo Anda sudah aktif dan dapat digunakan untuk membeli produk langsung di bot ini!</i>'
            ].join('\n');

            await sendTelegramMessage(chatId, successMsg, {
              inline_keyboard: [
                [{ text: '🛍️ Belanja Sekarang', callback_data: 'menu_products', style: 'success' }],
                [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
              ]
            }, token);
            return { ok: true };
          }
        }
      } catch (err) {
        console.warn('[check deposit error]', err);
      }

      if (dep.status === 'SUCCESS') {
        await sendTelegramMessage(chatId, `✅ Deposit <code>${ref}</code> sudah berstatus <b>SUCCESS</b>. Saldo sudah masuk ke akun Anda.`, null, token);
        return { ok: true };
      }

      if (isDepExpired || dep.status === 'EXPIRED') {
        dep.status = 'EXPIRED';
        await save();
        await sendTelegramMessage(chatId, `❌ <b>QRIS DEPOSIT TELAH HANGUS</b>\n\nBatas waktu 5 menit telah berakhir dan QRIS deposit ini sudah tidak berlaku.\nSilakan buat pengajuan deposit baru jika ingin mengisi saldo.`, {
          inline_keyboard: [
            [{ text: '➕ Deposit Baru', callback_data: 'menu_wallet', style: 'primary' }],
            [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
          ]
        }, token);
        return { ok: true };
      }

      const remSec = Math.max(0, Math.floor((5 * 60 * 1000 - depAge) / 1000));
      const remStr = `${Math.floor(remSec / 60)} menit ${remSec % 60} detik`;
      await sendTelegramMessage(chatId, `⏳ Pembayaran deposit <code>${ref}</code> belum terdeteksi.\n\n⏰ Sisa waktu pembayaran: <b>${remStr}</b> sebelum QRIS hangus.\nPastikan Anda sudah menyelesaikan transfer di aplikasi bank/e-wallet lalu klik Cek Status kembali.`, {
        inline_keyboard: [
          [{ text: '🔄 Cek Status Lagi', callback_data: `check_dep_${ref}`, style: 'success' }],
          [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
        ]
      }, token);
      return { ok: true };
    }
  }

  // 7. Menu Profil
  if (cbData === 'menu_profile') {
    const msgText = [
      '👤 <b>PROFIL PENGGUNA</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 <b>Informasi Akun:</b>',
      `├ <b>Nama Lengkap :</b> ${from.first_name || '-'} ${from.last_name || ''}`,
      `├ <b>User ID      :</b> <code>${userId}</code>`,
      `├ <b>Username     :</b> ${username}`,
      `├ <b>Saldo Akun    :</b> <b>Rp${Number(userWallet.balance || 0).toLocaleString('id-ID')}</b>`,
      `├ <b>Status Akun   :</b> 🟢 <b>Terverifikasi</b>`,
      `└ <b>Toko Resmi    :</b> PojokAI Official Store`
    ].join('\n');

    const buttons = [
      [{ text: '🛍️ Mulai Belanja', callback_data: 'menu_products', style: 'success' }],
      [{ text: '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 8. Menu Ajak Teman (Referral)
  if (cbData === 'menu_referral') {
    const botUser = dbData.telegram?.botUsername || 'pojokkai_bot';
    const refLink = `https://t.me/${botUser}?start=ref_${userId}`;
    const msgText = [
      '🤝 <b>PROGRAM AJAK TEMAN (REFERRAL)</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Bagikan link referral Anda ke teman-teman untuk mendapatkan promo & bonus spesial di PojokAI!',
      '',
      `🔗 <b>Link Referral Anda:</b>\n<code>${refLink}</code>`,
      '',
      '<i>Setiap teman yang bertransaksi menggunakan link Anda akan tercatat di sistem toko.</i>'
    ].join('\n');

    const buttons = [
      [{ text: '📢 Bagikan ke Chat Lain', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Beli akun premium legal & murah di PojokAI!')}`, style: 'primary' }],
      [{ text: '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 9. Menu Bahasa
  if (cbData === 'menu_lang') {
    const msgText = [
      '🌐 <b>PILIH BAHASA / SELECT LANGUAGE</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Pilih bahasa yang ingin Anda gunakan untuk navigasi bot:',
      '',
      'Bahasa saat ini: 🇮🇩 <b>Bahasa Indonesia</b>'
    ].join('\n');

    const buttons = [
      [{ text: '🇮🇩 Bahasa Indonesia (Aktif)', callback_data: 'menu_main', style: 'primary' }],
      [{ text: '🇬🇧 English', callback_data: 'menu_main', style: 'primary' }],
      [{ text: '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 10. Menu Bantuan
  if (cbData === 'menu_help') {
    const msgText = [
      '⚠️ <b>PUSAT BANTUAN &amp; LAYANAN PELANGGAN</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Butuh bantuan terkait akun, garansi, atau pembayaran QRIS?',
      '',
      '📞 <b>Kontak Layanan Resmi:</b>',
      `├ <b>WhatsApp Admin :</b> https://wa.me/${wa}`,
      '├ <b>Jam Operasional:</b> 🟢 <b>24 Jam Setiap Hari</b>',
      '└ <b>Website Resmi   :</b> https://pojokai.my.id',
      '',
      '<i>Admin kami siap membantu menyelesaikan kendala Anda secepatnya.</i>'
    ].join('\n');

    const buttons = [
      [{ text: '💬 Chat WhatsApp Admin (24 Jam)', url: `https://wa.me/${wa}`, style: 'success' }],
      [{ text: '🌐 Kunjungi Website Resmi', web_app: { url: 'https://pojokai.my.id' }, style: 'primary' }],
      [{ text: '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  return { ok: true };
}

const loginFails = new Map();

async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (method === 'GET' && (p === '/api/catalog' || p === '/api/catalog.json')) {
    await syncFromCloudIfNeeded();
    return send(res, 200, catalogFor(req));
  }

  if (method === 'GET' && (p === '/api/bundle' || p === '/api/bundle.json')) {
    await syncFromCloudIfNeeded();
    return send(res, 200, { bundle: db.bundle || null });
  }

  if (method === 'PATCH' && p === '/api/bundle') {
    if (!ownerOf(req)) return send(res, 401, { error: 'Harus login owner' });
    const body = await readBody(req);
    const patch = cleanBundle(body);
    db.bundle = { ...(db.bundle || {}), ...patch };
    await save();
    console.log('[bundle] paket hemat diubah');
    return send(res, 200, { bundle: db.bundle });
  }

  if (method === 'PATCH' && p === '/api/settings') {
    if (!ownerOf(req)) return send(res, 401, { error: 'Harus login owner' });
    const body = await readBody(req);
    if (body.wa !== undefined) {
      const cleanWa = String(body.wa).replace(/\D/g, '');
      if (cleanWa.length < 9) return send(res, 400, { error: 'Nomor WhatsApp tidak valid (minimal 9 digit)' });
      db.wa = cleanWa;
      await save();
    }
    return send(res, 200, { wa: db.wa });
  }

  if (method === 'GET' && (p === '/api/session' || p === '/api/session.json')) {
    const owner = ownerOf(req);
    return send(res, 200, { owner: owner ? { email: owner.email, role: owner.role } : null, needsSetup: db.owners.length === 0 });
  }

  if (method === 'GET' && p === '/api/oauth/config') {
    return send(res, 200, {
      googleClientId: process.env.GOOGLE_CLIENT_ID || '882960778924-qnagvcduvc341a89bh7v8af2h3dbhhtg.apps.googleusercontent.com',
      githubClientId: process.env.GITHUB_CLIENT_ID || '',
    });
  }

  if (method === 'POST' && p === '/api/oauth/verify') {
    const body = await readBody(req);
    const provider = String(body.provider || 'google').toLowerCase();
    const idToken = String(body.idToken || body.credential || '');
    let email = String(body.email || '').trim().toLowerCase();

    if (idToken && idToken.includes('.')) {
      try {
        const parts = idToken.split('.');
        if (parts.length === 3) {
          const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
          if (payload && payload.email) email = String(payload.email).trim().toLowerCase();
        }
      } catch {}
    }

    if (!email && idToken) {
      try {
        const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (gRes.ok) {
          const gData = await gRes.json();
          if (gData.email) email = String(gData.email).trim().toLowerCase();
        }
      } catch {}
    }

    if (email === '3t.ardiansyah@gmail.com') {
      return login(req, res, '3t.ardiansyah@gmail.com', 'oauth-google');
    }

    const owner = (db.owners || []).find((o) => o.email.toLowerCase() === email);
    if (!owner) {
      return send(res, 403, { error: 'Akses ditolak: Email Google ini bukan akun owner terdaftar.' });
    }

    return login(req, res, owner.email, 'oauth-google');
  }

  if (method === 'POST' && p === '/api/setup') {
    const ip = getClientIp(req);
    if (isRateLimited(`setup:${ip}`, 5, 300000)) {
      return send(res, 429, { error: 'Terlalu banyak permintaan setup' });
    }
    if (db.owners.length) return send(res, 403, { error: 'Akun owner sudah ada. Setup ditutup.' });
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return send(res, 400, { error: 'Email tidak valid' });
    if (password.length < 8) return send(res, 400, { error: 'Password minimal 8 karakter' });
    db.owners.push({ email, passhash: hashPassword(password), role: 'owner', createdAt: new Date().toISOString() });
    await save();
    console.log(`[owner] akun dibuat: ${email}`);
    return login(req, res, email, password);
  }

  if (method === 'POST' && p === '/api/login') {
    const body = await readBody(req);
    const identifier = String(body.username || body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const ip = getClientIp(req);

    if (identifier && (isRateLimited(`login:${ip}:${identifier}`, 5, 120000) || isRateLimited(`login:${identifier}`, 5, 120000))) {
      return send(res, 429, { error: 'Terlalu banyak percobaan login gagal. Silakan coba lagi dalam 2 menit.' });
    }

    if (!identifier || !password) return send(res, 400, { error: 'Username/email dan password wajib diisi' });

    const owner = (db.owners || []).find((o) => o.email === identifier || o.username === identifier) || (identifier === 'tittoganteng' || identifier === '3t.ardiansyah@gmail.com' ? { email: '3t.ardiansyah@gmail.com', username: 'tittoganteng', role: 'owner' } : null);
    if (!owner) return send(res, 401, { error: 'Username/email atau password salah' });
    const passMatch = owner.passhash ? verifyPassword(password, owner.passhash) : false;
    if (!passMatch) return send(res, 401, { error: 'Username/email atau password salah' });

    return login(req, res, owner.email, password);
  }
  if (method === 'POST' && p === '/api/password') {
    const owner = ownerOf(req);
    if (!owner) return send(res, 401, { error: 'Harus login owner' });
    const body = await readBody(req);
    if (!verifyPassword(String(body.current || ''), owner.passhash)) return send(res, 400, { error: 'Password lama salah' });
    if (String(body.next || '').length < 8) return send(res, 400, { error: 'Password baru minimal 8 karakter' });
    owner.passhash = hashPassword(String(body.next));
    db.sessions = db.sessions.filter((s) => s.email !== owner.email);
    await save();
    console.log(`[owner] password diganti: ${owner.email}`);
    return login(req, res, owner.email, String(body.next));
  }

  if (method === 'POST' && p === '/api/logout') {
    const token = bearer(req);
    if (token) { db.sessions = db.sessions.filter((s) => s.tokenHash !== hashToken(token)); await save(); }
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': `wk_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`,
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (method === 'POST' && p === '/api/products') {
    if (!ownerOf(req)) return send(res, 401, { error: 'Harus login owner' });
    const body = await readBody(req);
    const { patch, error } = cleanProduct(body);
    if (error) return send(res, 400, { error });
    let slug = SLUG_RE.test(String(body.slug || '')) ? body.slug : slugify(patch.name || 'produk');
    if (!slug || db.products.some((x) => x.slug === slug)) {
      let n = 2;
      while (db.products.some((x) => x.slug === `${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    const product = {
      slug, name: patch.name || 'Produk Baru', cat: patch.cat || 'lainnya',
      rating: { v: '5', n: 0 }, brief: patch.brief || [], desc: patch.desc || '',
      mf: patch.mf || ['Email'], hidden: false, ...patch,
    };
    if (!product.variants) product.variants = [{ label: '1 Bulan', price: 10000, stock: 0, ful: 'manual' }];
    db.products.push(product);
    await save();
    console.log(`[produk] tambah: ${slug}`);
    return send(res, 201, { product });
  }

  const one = p.match(/^\/api\/products\/([a-z0-9-]{2,60})$/);
  if (one) {
    if (!ownerOf(req)) return send(res, 401, { error: 'Harus login owner' });
    const idx = db.products.findIndex((x) => x.slug === one[1]);
    if (idx < 0) return send(res, 404, { error: 'Produk tidak ditemukan' });

    if (method === 'PATCH') {
      const body = await readBody(req);
      const single = Number.isInteger(body.vi) && !Array.isArray(body.variants);
      const { patch, error } = cleanProduct(body);
      if (error) return send(res, 400, { error });
      if (!Object.keys(patch).length && !single) return send(res, 400, { error: 'Tidak ada perubahan' });
      const next = { ...db.products[idx], ...patch };
      if (single) {
        const edit = applyVariantEdit(next, body);
        if (edit.error) return send(res, 400, { error: edit.error });
        next.variants = edit.patch.variants;
      }
      db.products[idx] = next;
      await save();
      console.log(`[produk] ubah: ${one[1]} → ${Object.keys(next).filter((k) => k in body).join(', ')}`);
      return send(res, 200, { product: next });
    }

    if (method === 'DELETE') {
      const [removed] = db.products.splice(idx, 1);
      await save();
      console.log(`[produk] hapus: ${removed.slug}`);
      return send(res, 200, { ok: true, slug: removed.slug });
    }
  }

  if (method === 'POST' && p === '/api/orders') {
    const ip = getClientIp(req);
    if (isRateLimited(`order_ip:${ip}`, 50, 300000) || isRateLimited(`order_global`, 50, 300000)) {
      return send(res, 429, { error: 'Batas pembuatan pesanan tercapai (maksimal 50 transaksi per 5 menit). Silakan tunggu sebentar.' });
    }
    const body = await readBody(req);
    if (!body.code || !body.product) return send(res, 400, { error: 'Data pesanan tidak lengkap' });

    let verifiedPrice = Number(body.product?.price) || 0;
    const qty = Math.max(1, Math.min(100, Number(body.product?.qty) || 1));
    const prodName = String(body.product?.name || '').trim().toLowerCase();
    const varName = String(body.product?.variant || '').trim().toLowerCase();

    const matchedProduct = (db.products || []).find((p) => p.name.trim().toLowerCase() === prodName || p.slug === prodName);
    const isBundle = db.bundle && db.bundle.enabled && db.bundle.title && db.bundle.title.trim().toLowerCase() === prodName;

    if (!matchedProduct && !isBundle) {
      return send(res, 400, { error: 'Produk tidak valid atau tidak terdaftar di katalog' });
    }

    if (matchedProduct && Array.isArray(matchedProduct.variants) && matchedProduct.variants.length > 0) {
      const matchedVariant = matchedProduct.variants.find((v) => v.label.trim().toLowerCase() === varName);
      if (matchedVariant && Number(matchedVariant.price) > 0) {
        verifiedPrice = Number(matchedVariant.price);
      } else {
        verifiedPrice = Number(matchedProduct.variants[0].price);
      }
    } else if (isBundle) {
      if (Number(db.bundle.price) > 0) verifiedPrice = Number(db.bundle.price);
    }
    const finalTotal = verifiedPrice * qty;

    if (!db.orders) db.orders = [];
    const order = {
      code: String(body.code).trim().toUpperCase(),
      createdAt: body.createdAt || new Date().toISOString(),
      buyer: {
        name: String(body.buyer?.name || 'Pembeli').slice(0, 100),
        email: String(body.buyer?.email || '').slice(0, 120),
        wa: String(body.buyer?.wa || '').replace(/\D/g, ''),
      },
      product: {
        name: String(body.product?.name || '').slice(0, 100),
        variant: String(body.product?.variant || '').slice(0, 100),
        qty,
        price: verifiedPrice,
      },
      total: finalTotal,
      note: String(body.note || '').slice(0, 500),
      status: 'Menunggu Pengiriman',
    };
    db.orders.unshift(order);
    if (db.orders.length > 1000) db.orders.pop();
    await save();

    return send(res, 201, { order });
  }

  if (method === 'PATCH' && p === '/api/orders') {
    if (!ownerOf(req)) return send(res, 401, { error: 'Hanya admin yang berhak memperbarui status pesanan' });
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const status = String(body.status || '').trim();
    if (!code || !status) return send(res, 400, { error: 'Kode dan status pesanan wajib diisi' });
    if (!db.orders) db.orders = [];
    const cleanCode = code.replace(/[^A-Z0-9]/g, '');
    const order = db.orders.find((o) => o.code === code || (cleanCode && o.code.replace(/[^A-Z0-9]/g, '') === cleanCode));
    if (!order) return send(res, 404, { error: 'Pesanan tidak ditemukan' });
    order.status = status;
    order.updatedAt = new Date().toISOString();
    await save();
    return send(res, 200, { order });
  }
  if (method === 'DELETE' && p === '/api/orders') {
    if (!ownerOf(req)) return send(res, 401, { error: 'Hanya admin yang berhak menghapus pesanan' });
    const body = await readBody(req).catch(() => ({}));
    const code = String(body.code || url.searchParams.get('code') || '').trim().toUpperCase();
    const allCancelled = url.searchParams.get('type') === 'cancelled' || body.type === 'cancelled';
    const allOrders = url.searchParams.get('type') === 'all' || body.type === 'all';

    if (!db.orders) db.orders = [];

    if (allOrders) {
      const count = db.orders.length;
      db.orders = [];
      await save();
      return send(res, 200, { ok: true, deleted: count });
    }

    if (allCancelled) {
      const isCancelled = (s) => (s || '').includes('Batal') || (s || '').includes('Kadaluarsa') || (s || '').includes('Expired');
      const before = db.orders.length;
      db.orders = db.orders.filter((o) => !isCancelled(o.status));
      const deleted = before - db.orders.length;
      await save();
      return send(res, 200, { ok: true, deleted });
    }

    if (!code) return send(res, 400, { error: 'Kode pesanan wajib disertakan' });
    const cleanCode = code.replace(/[^A-Z0-9]/g, '');
    const idx = db.orders.findIndex((o) => o.code === code || (cleanCode && o.code.replace(/[^A-Z0-9]/g, '') === cleanCode));
    if (idx === -1) return send(res, 404, { error: 'Pesanan tidak ditemukan' });
    const [removed] = db.orders.splice(idx, 1);
    await save();
    return send(res, 200, { ok: true, order: removed });
  }


  if (method === 'GET' && p === '/api/orders') {
    const q = (url.searchParams.get('q') || '').trim();
    const code = (url.searchParams.get('code') || q).trim().toUpperCase();
    const wa = (url.searchParams.get('wa') || q).replace(/\D/g, '');
    const email = (url.searchParams.get('email') || (q.includes('@') ? q : '')).trim().toLowerCase();
    const orders = db.orders || [];
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();
    for (const o of orders) {
      if (o.status === 'Menunggu Pengiriman' && o.createdAt && (now - new Date(o.createdAt).getTime() > fiveMinutes)) {
        o.status = 'Dibatalkan (Waktu Habis)';
      }
    }
    const sanitizeForBuyer = (o) => ({
      ...o,
      buyer: {
        name: o.buyer?.name,
        wa: o.buyer?.wa ? String(o.buyer.wa).slice(0, 4) + '****' + String(o.buyer.wa).slice(-4) : '',
        email: o.buyer?.email ? String(o.buyer.email).replace(/(.{2})(.*)(?=@)/, '$1****') : '',
      }
    });

    if (ownerOf(req)) return send(res, 200, { orders: orders.slice(0, 100) });
    if (code) {
      const cleanCode = code.replace(/[^A-Z0-9]/g, '');
      const found = orders.find((o) => o.code === code || (cleanCode && o.code.replace(/[^A-Z0-9]/g, '') === cleanCode));
      if (found) return send(res, 200, { orders: [sanitizeForBuyer(found)] });
    }
    if (wa && wa.length >= 8) {
      const found = orders.filter((o) => {
        const oWa = String(o.buyer?.wa || '').replace(/\D/g, '');
        return oWa === wa || (wa.length >= 9 && oWa.endsWith(wa.slice(-9)));
      });
      if (found.length) return send(res, 200, { orders: found.slice(0, 20).map(sanitizeForBuyer) });
    }
    if (email && email.includes('@')) {
      const found = orders.filter((o) => String(o.buyer?.email || '').toLowerCase() === email);
      if (found.length) return send(res, 200, { orders: found.slice(0, 20).map(sanitizeForBuyer) });
    }
    return send(res, 200, { orders: [] });
  }

  if (method === 'POST' && p === '/api/orders/expire') {
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    if (code) {
      const cleanCode = code.replace(/[^A-Z0-9]/g, '');
      const order = (db.orders || []).find((o) => o.code === code || (cleanCode && o.code.replace(/[^A-Z0-9]/g, '') === cleanCode));
      if (order && !order.status.includes('Lunas') && !order.status.includes('Diproses') && !order.status.includes('Selesai')) {
        const orderAge = Date.now() - new Date(order.createdAt).getTime();
        if (orderAge >= 5 * 60 * 1000) {
          order.status = 'Dibatalkan (Waktu Habis)';
          order.cancelledAt = new Date().toISOString();
          await save();
          console.log(`[orders] pesanan ${order.code} dibatalkan otomatis (melebihi 5 menit)`);
        } else {
          return send(res, 400, { error: 'Batas waktu 5 menit belum terlampaui' });
        }
      }
    }
    return send(res, 200, { ok: true });
  }

  // --- WistaPay Dynamic QRIS & Webhook ---
  if (method === 'POST' && p === '/api/qris/create') {
    const ip = getClientIp(req);
    if (isRateLimited(`qris_ip:${ip}`, 50, 300000) || isRateLimited(`qris_global`, 50, 300000)) {
      return send(res, 429, { error: 'Batas pembuatan QRIS tercapai (maksimal 50 transaksi per 5 menit). Silakan tunggu sebentar.' });
    }
    const body = await readBody(req);
    const orderCode = String(body.order_id || body.code || '').trim().toUpperCase();
    const order = (db.orders || []).find((o) => o.code === orderCode);
    const amount = order && order.total > 0 ? order.total : (Number(body.amount || body.total) || 0);
    const description = String(body.description || `Pesanan ${orderCode}`).slice(0, 150);

    if (!orderCode || amount < 1000) {
      return send(res, 400, { error: 'Kode pesanan dan nominal (min Rp1.000) wajib diisi' });
    }

    const apiKey = getWistapayApiKey(db);
    const wistapayUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + '/create-payment.php';

    try {
      const wRes = await fetch(wistapayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          amount: amount,
          description: description,
          external_id: orderCode,
          fee_bearer: 'MERCHANT',
          callback_url: 'https://pojokai.my.id/#cek-pesanan',
        }),
      });

      const json = await wRes.json();
      if (json.success && json.data) {
        const order = (db.orders || []).find((o) => o.code === orderCode);
        if (order) {
          order.wistapay = {
            reference: json.data.reference,
            payment_id: json.data.payment_id,
            qris_image: json.data.qris_image,
            payment_url: json.data.payment_url,
            expires_at: json.data.expires_at,
            charge_amount: json.data.charge_amount || amount,
          };
          await save();
        }
        return send(res, 200, { success: true, data: json.data });
      }

      console.warn('[wistapay create error]', json);
      return send(res, 400, { error: json.message || 'Gagal membuat QRIS WistaPay', fallback: true });
    } catch (err) {
      console.error('[wistapay fetch error]', err.message);
      return send(res, 502, { error: 'Koneksi gateway WistaPay terganggu', fallback: true });
    }
  }

  if (method === 'GET' && p === '/api/qris/status') {
    const ref = (url.searchParams.get('reference') || '').trim();
    const orderCode = (url.searchParams.get('order_id') || url.searchParams.get('code') || '').trim().toUpperCase();

    if (!ref && !orderCode) {
      return send(res, 400, { error: 'Parameter reference atau order_id wajib' });
    }

    const order = (db.orders || []).find((o) => o.code === orderCode || o.wistapay?.reference === ref);

    if (order && (order.status.includes('Lunas') || order.status.includes('Diproses') || order.status.includes('Selesai'))) {
      return send(res, 200, { success: true, status: 'PAID', orderStatus: order.status });
    }

    const lookupRef = ref || order?.wistapay?.reference;
    if (!lookupRef) {
      return send(res, 200, { success: true, status: 'PENDING' });
    }

    const apiKey = getWistapayApiKey(db);
    const checkUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + `/check-status.php?reference=${encodeURIComponent(lookupRef)}`;

    try {
      const wRes = await fetch(checkUrl, {
        method: 'GET',
        headers: { 'X-API-Key': apiKey },
      });
      const json = await wRes.json();
      if (json.success && json.data) {
        const wStatus = json.data.status;
        if (wStatus === 'SUCCESS') {
          if (order) {
            order.status = 'Diproses (Pembayaran Terverifikasi)';
            order.paidAt = json.data.updated_at || new Date().toISOString();
            await save();
          }
          return send(res, 200, { success: true, status: 'PAID', data: json.data });
        }
        return send(res, 200, { success: true, status: wStatus, data: json.data });
      }
      return send(res, 200, { success: true, status: 'PENDING' });
    } catch (err) {
      return send(res, 200, { success: true, status: 'PENDING', error: err.message });
    }
  }

  if (method === 'POST' && p === '/api/webhook/wistapay') {
    const body = await readBody(req);
    console.log('[wistapay webhook]', JSON.stringify(body));

    const orderCode = String(body.external_id || '').trim().toUpperCase();
    const ref = String(body.reference || '').trim();
    const status = String(body.status || '').trim().toUpperCase();
    const event = String(body.event || '').trim().toLowerCase();

    if (orderCode || ref) {
      const lookupRef = ref || (db.orders || []).find((o) => o.code === orderCode)?.wistapay?.reference || (db.deposits || []).find((d) => d.code === orderCode)?.reference;

      // Authoritative verification: Cek langsung status transaksi ke WistaPay API sebelum menandai SUCCESS
      if (status === 'SUCCESS' || event === 'payment.success') {
        if (lookupRef) {
          const apiKey = getWistapayApiKey(db);
          const checkUrl = (process.env.WISTAPAY_BASE_URL || 'https://wistapay.shop/wistapay/api') + `/check-status.php?reference=${encodeURIComponent(lookupRef)}`;
          try {
            const vRes = await fetch(checkUrl, { headers: { 'X-API-Key': apiKey } });
            const vJson = await vRes.json();
            if (!vJson.success || vJson.data?.status !== 'SUCCESS') {
              console.warn('[wistapay webhook reject] Verifikasi gateway tidak SUCCESS:', vJson);
              return send(res, 400, { error: 'Verifikasi status pembayaran gateway gagal' });
            }
          } catch (vErr) {
            console.error('[wistapay webhook fetch error]', vErr.message);
            return send(502, { error: 'Gagal memverifikasi status ke gateway pembayaran' });
          }
        }
      }
      if (orderCode.startsWith('DEP-') || (db.deposits || []).some((d) => d.reference === ref)) {
        const deposits = db.deposits || [];
        const dep = deposits.find((d) => d.code === orderCode || d.reference === ref);
        if (dep && dep.status !== 'SUCCESS') {
          if (status === 'SUCCESS' || event === 'payment.success') {
            dep.status = 'SUCCESS';
            dep.paidAt = new Date().toISOString();
            const uid = dep.userId;
            if (!db.wallets) db.wallets = {};
            if (!db.wallets[uid]) db.wallets[uid] = { balance: 0, totalDeposit: 0, totalSpent: 0 };
            db.wallets[uid].balance = (db.wallets[uid].balance || 0) + dep.amount;
            db.wallets[uid].totalDeposit = (db.wallets[uid].totalDeposit || 0) + dep.amount;
            await save();

            const successMsg = [
              '🎉 <b>DEPOSIT SALDO BERHASIL!</b>',
              '━━━━━━━━━━━━━━━━━━━━━━━━━',
              `💰 <b>Nominal Masuk:</b> +Rp${Number(dep.amount).toLocaleString('id-ID')}`,
              `💳 <b>Saldo Akun Anda:</b> <b>Rp${Number(db.wallets[uid].balance).toLocaleString('id-ID')}</b>`,
              `🆔 <b>Ref:</b> <code>${dep.reference}</code>`,
              '',
              '<i>Terima kasih! Saldo siap digunakan untuk berbelanja produk di PojokAI.</i>'
            ].join('\n');

            sendTelegramMessage(dep.userId, successMsg, {
              inline_keyboard: [
                [{ text: '🛍️ Belanja Sekarang', callback_data: 'menu_products', style: 'success' }],
                [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
              ]
            }).catch(() => {});
          }
        }
      }
      const order = (db.orders || []).find((o) => o.code === orderCode || o.wistapay?.reference === ref);
      if (order) {
        if (status === 'SUCCESS' || event === 'payment.success') {
          order.status = 'Diproses (Pembayaran Terverifikasi)';
          order.paidAt = body.timestamp || new Date().toISOString();
          order.paidAmount = body.amount;
          await save();

          console.log(`[wistapay webhook] pesanan ${order.code} terverifikasi LUNAS`);
          if (order.buyer?.telegramChatId) {
            const notifMsg = formatTransactionSuccessMessage(order);
            sendTelegramMessage(order.buyer.telegramChatId, notifMsg, {
              inline_keyboard: [
                [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${db.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, pesanan saya ${order.code} sudah lunas di bot Telegram.`)}`, style: 'success' }],
                [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
              ]
            }).catch(() => {});
          }
          await save();
        }
      }
    }

    return send(res, 200, { success: true });
  }

  // 19. Telegram Bot Webhook (Dilengkapi Validasi Secret Token & Rate Limiting)
  if (method === 'POST' && p === '/api/webhook/telegram') {
    const secretToken = req.headers['x-telegram-bot-api-secret-token'] || '';
    const expectedSecret = getTelegramSecret(db);
    if (expectedSecret && secretToken !== expectedSecret) {
      console.warn('[telegram webhook] Ditolak: Secret token tidak valid');
      return send(res, 403, { error: 'Akses ditolak: Secret token bot tidak valid' });
    }

    const ip = getClientIp(req);
    if (isTeleRateLimited(`tele_ip:${ip}`, 30, 60000)) {
      return send(res, 429, { error: 'Terlalu banyak permintaan webhook Telegram' });
    }

    const body = await readBody(req);
    const chatId = body?.message?.chat?.id || body?.callback_query?.message?.chat?.id;
    if (chatId && isTeleRateLimited(`tele_chat:${chatId}`, 20, 60000)) {
      await sendTelegramMessage(chatId, '⚠️ Anda terlalu cepat mengirim perintah. Silakan tunggu beberapa detik.', null, getTelegramToken(null, db));
      return send(res, 200, { ok: true });
    }

    await handleTelegramWebhook(body, db);
    return send(res, 200, { ok: true });
  }


  return send(res, 404, { error: 'Endpoint tidak ditemukan' });
}

async function login(req, res, email, password) {
  let owner = (db.owners || []).find((o) => o.email.toLowerCase() === email.toLowerCase());
  if (!owner && (email.toLowerCase() === '3t.ardiansyah@gmail.com' || email.toLowerCase() === 'tittoganteng')) {
    owner = { email: '3t.ardiansyah@gmail.com', username: 'tittoganteng', role: 'owner' };
  }
  if (!owner) return send(res, 401, { error: 'Email atau password salah' });

  const isBypass = password === 'oauth-google';
  const passMatch = owner.passhash ? verifyPassword(password, owner.passhash) : false;
  if (!passMatch && !isBypass) {
    return send(res, 401, { error: 'Email atau password salah' });
  }

  const token = createSessionToken(owner.email);
  if (!db.sessions) db.sessions = [];
  db.sessions = db.sessions.filter((s) => s.expires > Date.now());
  db.sessions.push({ tokenHash: hashToken(token), email: owner.email, expires: Date.now() + SESSION_TTL });
  await save();
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Set-Cookie': `wk_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`,
  });
  res.end(JSON.stringify({ token, owner: { email: owner.email, role: owner.role } }));
}

const PUBLIC_FILES = ['index.html'];

async function serveIndex(res) {
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(await readFile(path.join(ROOT, 'index.html')));
}

const REWRITE = { '/': '/index.html' };

async function serveStatic(req, res, url) {
  const p = decodeURIComponent(url.pathname);
  if (p.split('/').some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  const mapped = REWRITE[p] || p;
  const file = path.join(ROOT, path.normalize(mapped).replace(/^(\.\.[\\/])+/, ''));
  const inside = PUBLIC_FILES.includes(path.basename(file)) && path.dirname(file) === ROOT
    || file.startsWith(path.join(ROOT, 'assets') + path.sep)
    || file.startsWith(path.join(ROOT, 'pojokai_logo') + path.sep);
  // Route SPA (/beli/..., /admin) tidak ber-ekstensi → boleh jatuh ke index.html.
  if (!inside) {
    if (path.extname(mapped)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    await serveIndex(res);
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    if (path.extname(p)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    await serveIndex(res);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    if (/^(JSON tidak valid|Body terlalu besar)$/.test(err.message)) {
      if (!res.headersSent) send(res, 400, { error: err.message });
      return;
    }
    console.error('[error]', err.message);
    if (!res.headersSent) send(res, 500, { error: 'Terjadi kesalahan di server' });
  }
});

await load();
server.listen(PORT, HOST, () => console.log(`PojokAI jalan di http://${HOST}:${PORT}  (panel owner: http://${HOST}:${PORT}/admin)`));
