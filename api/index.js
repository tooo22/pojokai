// api/index.js - Vercel Serverless Function for PojokAI API
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Muat file .env jika tersedia
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
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
let dbCache = null;
let dbCacheTime = 0;
const DB_CACHE_TTL = 5000;

function getDbFilePath() {
  const tmpDb = '/tmp/db.json';
  if (fs.existsSync(tmpDb)) return tmpDb;
  const localDb = path.resolve(process.cwd(), 'data', 'db.json');
  if (fs.existsSync(localDb)) return localDb;
  return tmpDb;
}

let blobAccess = null;

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

async function saveDbToBlob(db) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const { put } = await import('@vercel/blob');
    const acc = blobAccess || 'private';
    try {
      await put('data/db.json', JSON.stringify(db, null, 2), { access: acc, addRandomSuffix: false, allowOverwrite: true });
    } catch {
      await put('data/db.json', JSON.stringify(db, null, 2), { access: 'public', addRandomSuffix: false, allowOverwrite: true });
      blobAccess = 'public';
    }
  } catch (err) {
    console.warn('[blob] save error:', err.message);
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

async function saveDbToCloud(db) {
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/set/pojokai_db`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(db)
      });
    } catch (e) {
      console.warn('[kv] save error:', e.message);
    }
  }
}

async function getDb(forceRefresh = false) {
  if (!forceRefresh && dbCache && Array.isArray(dbCache.products) && (Date.now() - dbCacheTime < DB_CACHE_TTL)) {
    return dbCache;
  }

  // 1. Coba baca dari Vercel Blob jika tersedia
  const blobDb = await getDbFromBlob();
  if (blobDb) {
    dbCache = blobDb;
    dbCacheTime = Date.now();
    return dbCache;
  }

  // 2. Coba baca dari Cloud KV jika tersedia
  const cloudDb = await getDbFromCloud();
  if (cloudDb) {
    dbCache = cloudDb;
    dbCacheTime = Date.now();
    return dbCache;
  }

  // 3. Coba baca dari file lokal atau /tmp
  try {
    const dbPath = getDbFilePath();
    if (fs.existsSync(dbPath)) {
      dbCache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      if (process.env.BLOB_READ_WRITE_TOKEN && !blobDb) {
        saveDbToBlob(dbCache).catch(() => {});
      }
      dbCacheTime = Date.now();
      return dbCache;
    }
  } catch (err) {
    console.error('[db] load error:', err.message);
  }

  dbCache = {
    wa: '6283171982973',
    categories: [],
    hero: [],
    faqs: [],
    ticker: [],
    products: [],
    owners: [],
    sessions: [],
    orders: [],
  };
  return dbCache;
}

async function saveDb(updatedDb) {
  dbCache = updatedDb;
  dbCacheTime = Date.now();
  // 1. Simpan ke /tmp/db.json (area writable di serverless Vercel)
  try {
    const tmpDb = '/tmp/db.json';
    fs.writeFileSync(tmpDb, JSON.stringify(updatedDb, null, 2));
  } catch (err) {
    console.warn('[db] save tmp error:', err.message);
  }

  // 2. Simpan ke Vercel Blob jika dikonfigurasi di Vercel
  await saveDbToBlob(updatedDb);

  // 3. Simpan ke Cloud KV jika dikonfigurasi di Vercel
  await saveDbToCloud(updatedDb);

  // 4. Simpan ke data/db.json jika di lingkungan local
  try {
    const localDb = path.resolve(process.cwd(), 'data', 'db.json');
    fs.writeFileSync(localDb, JSON.stringify(updatedDb, null, 2));
  } catch {}
}

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

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

function getHeader(req, name) {
  if (req.headers && typeof req.headers.get === 'function') {
    return req.headers.get(name) || '';
  }
  if (req.headers && typeof req.headers === 'object') {
    return req.headers[name.toLowerCase()] || '';
  }
  return '';
}

function bearer(req) {
  const h = getHeader(req, 'authorization');
  const m = h.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
  if (m) return m[1];
  const cookie = getHeader(req, 'cookie');
  const cm = cookie.match(/(?:^|;\s*)wk_token=([A-Za-z0-9._-]+)/);
  return cm ? cm[1] : '';
}

function ownerOf(req, db) {
  const token = bearer(req);
  if (!token) return null;

  // 1. Verifikasi stateless HMAC token (stabil di Vercel serverless)
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
    if (sess && sess.expires > Date.now()) {
      return (db.owners || []).find((o) => o.email === sess.email) || { email: sess.email, role: 'owner' };
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

function cleanProduct(body, db) {
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

function catalogFor(req, db) {
  const owner = ownerOf(req, db);
  const products = owner ? db.products : (db.products || []).filter((p) => !p.hidden);
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

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.json === 'function') {
    try { return await req.json(); } catch { return {}; }
  }
  if (typeof req.text === 'function') {
    try { const t = await req.text(); return JSON.parse(t); } catch { return {}; }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
function getTelegramToken(customToken = null, db = null) {
  return customToken || process.env.TELEGRAM_BOT_TOKEN || db?.telegram?.botToken || '';
}

function getTelegramSecret(db = null) {
  return process.env.TELEGRAM_WEBHOOK_SECRET || db?.telegram?.webhookSecret || '59f920885e991efca6de765197120b4493d07c4881bb4c70fbcf27ed0db299a8';
}

const DEFAULT_WISTAPAY_KEY = 'sk_cf912d66f2b3a109f689435d17947e576791bdf6d39858f5';
function getWistapayApiKey(db = null) {
  return process.env.WISTAPAY_API_KEY || db?.wistapay?.apiKey || DEFAULT_WISTAPAY_KEY;
}
function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.get?.('x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
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

let _teleCommandsSynced = false;
async function syncTelegramCommands(token) {
  if (!token) return { ok: false, error: 'No token' };
  try {
    const commandsId = [
      { command: 'start', description: 'Menu Utama' },
      { command: 'produk', description: 'Katalog Produk Digital' },
      { command: 'bahasa', description: 'Ganti Bahasa Navigasi' },
      { command: 'bantuan', description: 'Pusat Bantuan & Admin' }
    ];
    const commandsEn = [
      { command: 'start', description: 'Main Menu' },
      { command: 'produk', description: 'Browse Products' },
      { command: 'bahasa', description: 'Change Language' },
      { command: 'bantuan', description: 'Help & Support' }
    ];

    const r1 = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: commandsId })
    });
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: commandsEn, language_code: 'en' })
    }).catch(() => {});
    await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_button: { type: 'commands' } })
    }).catch(() => {});

    _teleCommandsSynced = true;
    return await r1.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildMainMenuPayload(userId, username, db, isEn, banner = '') {
  const userRank = '#' + ((Number(String(userId).slice(-2)) || 1) + 1);
  const orders = db.orders || [];
  const completedOrders = orders.filter((o) => {
    const s = String(o.status || '').toLowerCase();
    return s.includes('selesai') || s.includes('terkirim') || s.includes('diproses') || s.includes('lunas') || s.includes('terverifikasi');
  }).length;
  const totalSold = (db.products || []).reduce((sum, p) => sum + (Number(p.sold) || 0), 0) + completedOrders;

  const userOrders = orders.filter((o) => String(o.buyer?.telegramUserId || o.buyer?.telegramChatId) === String(userId));
  const userSpent = userOrders.filter((o) => {
    const s = String(o.status || '').toLowerCase();
    return s.includes('selesai') || s.includes('terkirim') || s.includes('diproses') || s.includes('lunas') || s.includes('terverifikasi');
  }).reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const userOrderCount = userOrders.length;

  const msgText = (isEn ? [
    banner,
    '👤 <tg-emoji emoji-id="5904771654730391536"><b>ACCOUNT</b></tg-emoji>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `├ <b>User ID   :</b> <code>${userId}</code>`,
    `├ <b>Username  :</b> ${username}`,
    `└ <b>Rank      :</b> <code>${userRank}</code>`,
    '',
    '💰 <tg-emoji emoji-id="5904655415735492625"><b>SUMMARY</b></tg-emoji>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `├ <b>Account Status :</b> 🟢 <b>Verified</b>`,
    `├ <b>Total Spent    :</b> <code>Rp${Number(userSpent || 0).toLocaleString('id-ID')}</code>`,
    `└ <b>Total Orders   :</b> <code>${userOrderCount} Orders</code>`,
    '',
    '📊 <tg-emoji emoji-id="5904715266104762882"><b>STORE STATISTICS</b></tg-emoji>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `├ <b>Products Sold     :</b> <code>${totalSold.toLocaleString('id-ID')} Pcs</code>`,
    `└ <b>Successful Orders :</b> <code>${completedOrders.toLocaleString('id-ID')} Orders</code>`,
    '',
    '💫 <i>Select a menu below to start:</i>'
  ] : [
    banner,
    '👤 <tg-emoji emoji-id="5904771654730391536"><b>ACCOUNT</b></tg-emoji>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `├ <b>User ID   :</b> <code>${userId}</code>`,
    `├ <b>Username  :</b> ${username}`,
    `└ <b>Peringkat :</b> <code>${userRank}</code>`,
    '',
    '💰 <tg-emoji emoji-id="5904655415735492625"><b>RINGKASAN</b></tg-emoji>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `├ <b>Status Akun   :</b> 🟢 <b>Terverifikasi</b>`,
    `├ <b>Total Belanja :</b> <code>Rp${Number(userSpent || 0).toLocaleString('id-ID')}</code>`,
    `└ <b>Total Pesanan :</b> <code>${userOrderCount} Pesanan</code>`,
    '',
    '📊 <tg-emoji emoji-id="5904715266104762882"><b>STATISTIK TOKO</b></tg-emoji>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    `├ <b>Produk Terjual   :</b> <code>${totalSold.toLocaleString('id-ID')} Pcs</code>`,
    `└ <b>Transaksi Sukses :</b> <code>${completedOrders.toLocaleString('id-ID')} Order</code>`,
    '',
    '💫 <i>Pilih menu di bawah untuk mulai:</i>'
  ]).filter(Boolean).join('\n');

  const inlineKeyboard = isEn ? [
    [{ text: '🛍️ Products', callback_data: 'menu_products', style: 'success', icon_custom_emoji_id: '5276438812866681286' }],
    [
      { text: '📦 My Orders', callback_data: 'menu_check_order', style: 'primary', icon_custom_emoji_id: '5904715266104762882' },
      { text: '👤 Profile', callback_data: 'menu_profile', style: 'primary', icon_custom_emoji_id: '5904771654730391536' }
    ],
    [{ text: '🤝 Invite Friends', callback_data: 'menu_referral', style: 'primary', icon_custom_emoji_id: '5253555497696503165' }],
    [
      { text: '🌐 Language', callback_data: 'menu_lang', style: 'danger', icon_custom_emoji_id: '5276521718620398284' },
      { text: '⚠️ Help', callback_data: 'menu_help', style: 'danger', icon_custom_emoji_id: '5427086749278943412' }
    ]
  ] : [
    [{ text: '🛍️ Produk', callback_data: 'menu_products', style: 'success', icon_custom_emoji_id: '5276438812866681286' }],
    [
      { text: '📦 Pesanan Saya', callback_data: 'menu_check_order', style: 'primary', icon_custom_emoji_id: '5904715266104762882' },
      { text: '👤 Profil', callback_data: 'menu_profile', style: 'primary', icon_custom_emoji_id: '5904771654730391536' }
    ],
    [{ text: '🤝 Ajak Teman', callback_data: 'menu_referral', style: 'primary', icon_custom_emoji_id: '5253555497696503165' }],
    [
      { text: '🌐 Bahasa', callback_data: 'menu_lang', style: 'danger', icon_custom_emoji_id: '5276521718620398284' },
      { text: '⚠️ Bantuan', callback_data: 'menu_help', style: 'danger', icon_custom_emoji_id: '5427086749278943412' }
    ]
  ];

  return { msgText, inlineKeyboard };
}

async function sendMainMenu(chatId, messageId, userId, username, db, token, isEn, banner = '', deleteOld = false) {
  if (deleteOld && messageId) {
    await deleteTelegramMessage(chatId, messageId, token);
  }

  const { msgText, inlineKeyboard } = buildMainMenuPayload(userId, username, db, isEn, banner);

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



async function notifyOwnerNewOrder(order, db) {
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


const pendingOrderLocks = new Map();

async function handleCreateOrderQris(chatId, userId, username, p, variantIndex, db, token, callbackQuery = null) {
  const userLang = db.userLanguages?.[userId] || db.wallets?.[userId]?.lang || 'id';
  const isEn = userLang === 'en';
  const now = Date.now();
  const lastLock = pendingOrderLocks.get(String(chatId)) || 0;
  if (now - lastLock < 6000) {
    if (callbackQuery?.id) {
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: isEn ? '⏳ Generating QRIS invoice, please wait a moment...' : '⏳ Tagihan QRIS sedang dibuat, mohon tunggu sebentar...',
          show_alert: false
        })
      }).catch(() => {});
    }
    return { ok: true };
  }
  pendingOrderLocks.set(String(chatId), now);

  const v = (p.variants || [])[variantIndex] || p.variants?.[0] || { label: 'Standar', price: 25000 };

  // Cegah penumpukan QR: Cek apakah user sudah punya QRIS aktif untuk produk ini dalam 3 menit terakhir
  const existingPending = (db.orders || []).find((o) =>
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
          text: isEn ? `⚠️ QRIS invoice (${existingPending.code}) for ${p.name} is already available in chat. Please scan QRIS above!` : `⚠️ Tagihan QRIS (${existingPending.code}) untuk ${p.name} sudah tersedia di chat. Silakan scan QRIS di atas!`,
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
      await sendTelegramMessage(chatId, isEn ? `❌ Failed to create QRIS: ${json.message || 'Payment server busy'}. Please try again or purchase via Web Store.` : `❌ Gagal membuat QRIS: ${json.message || 'Server pembayaran sibuk'}. Silakan coba lagi atau beli via Web Toko.`, {
        inline_keyboard: [[{ text: isEn ? '🛒 Open Web Store' : '🛒 Buka Web Toko', web_app: { url: 'https://pojokai.my.id' } }]]
      }, token);
      return { ok: true };
    }

    const q = json.data;
    const finalTotal = q.charge_amount || amount;

    if (!db.orders) db.orders = [];
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
        wa: db.wallets?.[userId]?.wa || '',
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
        charge_amount: finalTotal,
        fee: q.fee || Math.round(amount * 0.007 + 250),
        net_amount: q.net_amount || (finalTotal - (q.fee || Math.round(amount * 0.007 + 250)))
      }
    };
    db.orders.unshift(newOrder);
    if (db.orders.length > 1000) db.orders.pop();
    await saveDb(db);

    const caption = isEn ? [
      '💳 <b>QRIS PAYMENT INVOICE</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 <b>Order Details:</b>',
      `├ <b>Order Code  :</b> <code>${orderCode}</code>`,
      `├ <b>Product     :</b> ${p.name} (${v.label || 'Standard'})`,
      `├ <b>Quantity    :</b> 1 Pcs`,
      `└ <b>Total Bill  :</b> <b>Rp${Number(finalTotal).toLocaleString('id-ID')}</b>`,
      '',
      '⏰ <b>Valid For  :</b> <b>5 Minutes</b> <i>(Auto-expires)</i>',
      '⚡ <b>Payment Method :</b> Realtime QRIS <i>(BCA, Mandiri, Dana, GoPay, OVO, ShopeePay)</i>',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '📱 <b>Payment Instructions:</b>',
      '1️⃣ Save or screenshot the QRIS barcode above.',
      '2️⃣ Open any M-Banking or E-Wallet app.',
      '3️⃣ Scan the QRIS barcode & pay the exact total above.',
      '4️⃣ After payment, click <b>Check Payment Status</b> below!'
    ].join('\n') : [
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

    const buttons = isEn ? [
      [{ text: '🔍 Check Payment', callback_data: `check_order_${orderCode}`, style: 'primary' }],
      [{ text: '❌ Cancel Order', callback_data: `cancel_order_${orderCode}`, style: 'danger' }]
    ] : [
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
async function handleCheckOrderInput(chatId, text, db, token) {
  const rawCode = text.trim().toUpperCase();
  const cleanCode = rawCode.replace(/[^A-Z0-9-]/g, '');
  const orders = db.orders || [];
  const order = orders.find((o) => 
    o.code === cleanCode || 
    o.code === rawCode || 
    (cleanCode && (o.code || '').replace(/[^A-Z0-9]/g, '') === cleanCode.replace(/[^A-Z0-9]/g, ''))
  );
  const userLang = db.userLanguages?.[chatId] || (order?.buyer?.telegramUserId ? db.userLanguages?.[order.buyer.telegramUserId] : null) || 'id';
  const isEn = userLang === 'en';

  if (!order) {
    const notFoundText = isEn ? [
      '❌ <b>Order Code Not Found</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Order code <code>${cleanCode || text}</code> is not registered in the PojokAI system.`,
      '',
      'Please make sure you entered the complete order code (example: <code>POJOK-XXXXXX</code>).',
      'If you have just completed a purchase or need help, please contact admin on WhatsApp.'
    ].join('\n') : [
      '❌ <b>Nomor Pesanan Tidak Ditemukan</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `Nomor pesanan <code>${cleanCode || text}</code> tidak terdaftar di sistem PojokAI.`,
      '',
      'Pastikan Anda menyalin kode pesanan dengan lengkap (contoh: <code>POJOK-XXXXXX</code>).',
      'Jika Anda baru saja bertransaksi atau mengalami kendala, silakan hubungi admin WhatsApp.'
    ].join('\n');

    await sendTelegramMessage(chatId, notFoundText, {
      inline_keyboard: [
        [{ text: isEn ? '🔄 Try Again' : '🔄 Coba Ketik Lagi', callback_data: 'menu_check_order', style: 'primary' }],
        [{ text: isEn ? '💬 Contact Admin WA' : '💬 Hubungi Admin WA', url: `https://wa.me/${db.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, saya mau tanya pesanan ${cleanCode || text}`)}`, style: 'success' }],
        [{ text: isEn ? '◀️ Main Menu' : '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
      ]
    }, token);
    return { ok: true };
  }

  // 1. Jika pesanan sudah Lunas / Selesai / Diproses -> Tampilkan kartu transaksi sukses format besar!
  if (order.status && (order.status.includes('Selesai') || order.status.includes('Diproses') || order.status.includes('Lunas') || order.status.includes('Terkirim'))) {
    const successMsg = formatTransactionSuccessMessage(order);
    await sendTelegramMessage(chatId, successMsg, {
      inline_keyboard: [
        [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${db.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, saya mau konfirmasi pesanan ${order.code}`)}`, style: 'success' }],
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
        await saveDb(db);

        const successMsg = formatTransactionSuccessMessage(order);
        await sendTelegramMessage(chatId, successMsg, {
          inline_keyboard: [
            [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${db.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, pesanan saya ${order.code} sudah lunas di bot Telegram.`)}`, style: 'success' }],
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
    await saveDb(db);

    const expiredMsg = isEn ? [
      '❌ <b>QRIS PAYMENT EXPIRED</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 <b>Order Details:</b>',
      `├ <b>Order Code  :</b> <code>${order.code}</code>`,
      `├ <b>Product Name:</b> ${order.product?.name} (${order.product?.variant || 'Standard'})`,
      `├ <b>Total Bill  :</b> Rp${Number(order.total).toLocaleString('id-ID')}`,
      `└ <b>Status      :</b> 🔴 <b>Expired (5-Minute Limit Exceeded)</b>`,
      '',
      '⚠️ <i>The 5-minute payment window has ended and this QRIS is no longer active.</i>',
      '<i>Please create a new order if you still want to buy this product.</i>'
    ].join('\n') : [
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
        [{ text: isEn ? '🛍️ Order New Product' : '🛍️ Beli Produk Baru', callback_data: 'menu_products', style: 'success' }],
        [{ text: isEn ? '◀️ Main Menu' : '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
      ]
    }, token);
    return { ok: true };
  }

  // 4. Masih ada waktu pembayaran
  const elapsedMs = Date.now() - createdAtTime;
  const remSec = Math.max(0, Math.floor((5 * 60 * 1000 - elapsedMs) / 1000));
  const remStr = `${Math.floor(remSec / 60)} menit ${remSec % 60} detik`;

  const pendingMsg = isEn ? [
    '⏳ <b>STATUS: AWAITING PAYMENT</b>',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '📋 <b>Order Details:</b>',
    `├ <b>Order Code     :</b> <code>${order.code}</code>`,
    `├ <b>Product Name   :</b> ${order.product?.name} (${order.product?.variant || 'Standard'})`,
    `├ <b>Total Bill     :</b> <b>Rp${Number(order.total).toLocaleString('id-ID')}</b>`,
    `└ <b>Remaining Time :</b> <b>${remStr}</b> <i>(Before Expiring)</i>`,
    '',
    '<i>Please complete the QRIS payment in your banking/e-wallet app then click Check Payment Status below!</i>'
  ].join('\n') : [
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
      [{ text: isEn ? '🔄 Check Payment Status Again' : '🔄 Cek Status Pembayaran Lagi', callback_data: `check_order_${order.code}`, style: 'success' }],
      [{ text: isEn ? '◀️ Main Menu' : '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
    ]
  }, token);
}



async function handleTelegramWebhook(body, db) {
  const token = getTelegramToken(null, db);
  if (!token) return { ok: false };
  if (!_teleCommandsSynced) {
    syncTelegramCommands(token).catch(() => {});
  }
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
  const products = (db.products || []).filter((p) => !p.hidden);
  const wa = db.wa || '6283171982973';

  // Inisialisasi dompet user jika belum ada
  if (!db.wallets) db.wallets = {};
  if (!db.wallets[userId]) db.wallets[userId] = { balance: 0, totalDeposit: 0, totalSpent: 0 };
  const userWallet = db.wallets[userId];
  // Inisialisasi preferensi bahasa user
  if (!db.userLanguages) db.userLanguages = {};
  const userLang = db.userLanguages[userId] || userWallet.lang || 'id';
  const isEn = userLang === 'en';

  // B. Handle input order code when user is awaiting_order_code OR types POJOK-
  if ((db.userStates?.[chatId]?.action === 'awaiting_order_code' && text && !text.startsWith('/')) || (text && text.toUpperCase().includes('POJOK-') && !text.startsWith('/'))) {
    if (db.userStates?.[chatId]) {
      delete db.userStates[chatId];
      await saveDb(db);
    }
    return await handleCheckOrderInput(chatId, text, db, token);
  }



  // 1. /start or menu_main (Format persis seperti BerryGrowID)
  if (text.startsWith('/start') || cbData === 'menu_main') {
    if (db.userStates?.[chatId]) {
      delete db.userStates[chatId];
      await saveDb(db);
    }
    return await sendMainMenu(chatId, messageId, userId, username, db, token, isEn, '', cbData === 'menu_main');
  }

  // 2. Menu Produk (Grid Tombol Produk - Background HIJAU jika Ready!)
  if (cbData === 'menu_products' || text.toLowerCase() === '/produk' || text.toLowerCase() === '/products') {
    const msgText = isEn ? [
      '💎 <b>AVAILABLE PRODUCTS AT POJOKAI</b>',
      'Please select the product you need below:'
    ].join('\n') : [
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
      { text: isEn ? '◀️ Back to Menu' : '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }
    ]);

    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: productButtons }, token);
    return { ok: true };
  }

  // 3. Detail Produk ketika diklik
  if (cbData.startsWith('p_')) {
    const slug = cbData.slice(2);
    const p = products.find((x) => x.slug.startsWith(slug) || x.slug === slug);
    if (!p) {
      await sendTelegramMessage(chatId, isEn ? '⚠️ Product not found.' : '⚠️ Produk tidak ditemukan.', null, token);
      return { ok: true };
    }

    const emoji = getProductEmoji(p.name, p.slug, p.cat);
    const variants = p.variants || [];
    const minP = variants.reduce((m, v) => (m === null || v.price < m ? v.price : m), null);
    const isReady = variants.some((v) => v.stock > 0 || v.stock === 999999);
    const stockStatus = isEn
      ? (isReady ? '🟢 <b>Ready / In Stock</b>' : '🔴 <b>Out of Stock</b>')
      : (isReady ? '🟢 <b>Ready / Tersedia</b>' : '🔴 <b>Stok Habis</b>');

    const msgText = isEn ? [
      `${emoji} <b>${p.name.toUpperCase()}</b>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `├ <b>Starting Price :</b> <code>Rp${Number(minP || 0).toLocaleString('id-ID')}</code>`,
      `└ <b>Stock Status   :</b> ${stockStatus}`,
      '',
      p.desc ? p.desc : '<i>Product description not available yet.</i>'
    ].join('\n') : [
      `${emoji} <b>${p.name.toUpperCase()}</b>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `├ <b>Harga Mulai :</b> <code>Rp${Number(minP || 0).toLocaleString('id-ID')}</code>`,
      `└ <b>Status Stok :</b> ${stockStatus}`,
      '',
      p.desc ? p.desc : '<i>Deskripsi produk belum tersedia.</i>'
    ].join('\n');

    const buttons = [
      [{ text: isEn ? `⚡ Buy Instantly via QRIS (Rp${Number(minP || 0).toLocaleString('id-ID')})` : `⚡ Beli Langsung via QRIS (Rp${Number(minP || 0).toLocaleString('id-ID')})`, callback_data: `buy_qris_${p.slug}`, style: 'success' }],
      [
        { text: isEn ? '🛒 Buy on Web App' : '🛒 Beli di Web App', web_app: { url: 'https://pojokai.my.id' }, style: 'primary' },
        { text: isEn ? '💬 Order via Admin WA' : '💬 Order via WA Admin', url: `https://wa.me/${wa}?text=${encodeURIComponent(`Halo admin, saya mau order ${p.name}`)}`, style: 'primary' }
      ],
      [{ text: isEn ? '◀️ Back to Product List' : '◀️ Kembali ke Daftar Produk', callback_data: 'menu_products', style: 'danger' }]
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
      await sendTelegramMessage(chatId, isEn ? '⚠️ Product not found.' : '⚠️ Produk tidak ditemukan.', null, token);
      return { ok: true };
    }

    const variants = p.variants || [];
    if (variants.length <= 1) {
      return await handleCreateOrderQris(chatId, userId, username, p, 0, db, token, callbackQuery);
    }

    const msgText = isEn ? [
      `💎 <b>SELECT PACKAGE: ${p.name.toUpperCase()}</b>`,
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `📦 <b>Product :</b> ${p.name}`,
      '⚡ <b>Method  :</b> Instant Dynamic QRIS (Automatic)',
      '',
      '<i>Please select the package variant you want to buy via instant QRIS:</i>'
    ].join('\n') : [
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
    variantButtons.push([{ text: isEn ? '◀️ Cancel' : '◀️ Batal', callback_data: `p_${p.slug}`, style: 'danger' }]);

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

    return await handleCreateOrderQris(chatId, userId, username, p, variantIndex, db, token, callbackQuery);
  }

  // 3d. Cek Status Pembayaran QRIS Pesanan
  // 3d. Cek Status Pembayaran QRIS Pesanan (Batas 5 Menit)
  // 3d. Cek Status Pembayaran QRIS Pesanan
  if (cbData.startsWith('check_order_')) {
    const code = cbData.replace('check_order_', '');
    const orders = db.orders || [];
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
          await saveDb(db);
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
          [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${db.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, pesanan saya ${order.code} sudah lunas di bot Telegram.`)}`, style: 'success' }],
          [{ text: '🛍️ Belanja Lagi', callback_data: 'menu_products', style: 'primary' }],
          [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
        ]
      }, token);
      return { ok: true };
    }

    const createdAtTime = new Date(order.createdAt || Date.now()).getTime();
    const isExpired = (Date.now() - createdAtTime > 5 * 60 * 1000);
    if (isExpired || (order.status || '').includes('Kadaluarsa') || (order.status || '').includes('Batal')) {
      order.status = 'Kadaluarsa (Waktu 5 Menit Habis)';
      await saveDb(db);
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
    const orders = db.orders || [];
    const order = orders.find((o) => o.code === code);
    if (order && !order.status.includes('Lunas') && !order.status.includes('Diproses')) {
      order.status = 'Dibatalkan Pengguna';
      await saveDb(db);
    }
    pendingOrderLocks.delete(String(chatId));

    if (callbackQuery?.id) {
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQuery.id,
          text: isEn ? `❌ Order ${code} has been cancelled.` : `❌ Pesanan ${code} telah dibatalkan.`,
        })
      }).catch(() => {});
    }

    const cancelCaption = isEn ? [
      '❌ <b>TRANSACTION CANCELLED</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🆔 <b>Order Code:</b> <code>${code}</code>`,
      `📦 <b>Product   :</b> ${order?.product?.name || 'Digital Product'}`,
      `⚡ <b>Status    :</b> 🔴 <b>Cancelled by User</b>`,
      '',
      '<i>This QRIS invoice is no longer valid. You can select another product to make a new order.</i>'
    ].join('\n') : [
      '❌ <b>TRANSAKSI TELAH DIBATALKAN</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      `🆔 <b>Kode Pesanan:</b> <code>${code}</code>`,
      `📦 <b>Produk      :</b> ${order?.product?.name || 'Produk Digital'}`,
      `⚡ <b>Status      :</b> 🔴 <b>Dibatalkan Pengguna</b>`,
      '',
      '<i>Tagihan QRIS ini sudah tidak berlaku lagi. Anda dapat memilih produk lain untuk melakukan pemesanan baru.</i>'
    ].join('\n');

    const cancelButtons = isEn ? [
      [{ text: '🛍️ Shop New Product', callback_data: 'menu_products', style: 'success' }],
      [{ text: '◀️ Main Menu', callback_data: 'menu_main', style: 'danger' }]
    ] : [
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
    if (!db.userStates) db.userStates = {};
    db.userStates[chatId] = { action: 'awaiting_order_code', time: Date.now() };
    await saveDb(db);

    const msgText = isEn ? [
      '📦 <b>CHECK ORDER STATUS</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Please type or paste your <b>Order Code</b> in this chat:',
      '',
      'Example: <code>POJOK-261016-UYXCJ</code>',
      '',
      '<i>The bot will immediately verify payment status, account credentials, and order details automatically!</i>'
    ].join('\n') : [
      '📦 <b>CEK STATUS PESANAN</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Silakan ketik atau tempelkan <b>Nomor Pesanan</b> Anda langsung di chat ini:',
      '',
      'Contoh: <code>POJOK-261016-UYXCJ</code>',
      '',
      '<i>Bot akan langsung memeriksa status pembayaran, kredensial akun, dan rincian transaksi Anda secara otomatis!</i>'
    ].join('\n');

    await updateOrSendMessage(chatId, messageId, msgText, {
      inline_keyboard: [[{ text: isEn ? '◀️ Cancel / Back to Menu' : '◀️ Batal / Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]]
    }, token);
    return { ok: true };
  }

  if (text.toUpperCase().includes('POJOK-') || (text.length >= 6 && /^[a-zA-Z0-9-]+$/.test(text) && !text.startsWith('/'))) {
    return await handleCheckOrderInput(chatId, text, db, token);
  }


  // 6. Menu Dompet & Pilihan Deposit
  // 6. Menu Dompet (Dinonaktifkan)
  if (cbData === 'menu_wallet' || cbData.startsWith('dep_') || cbData.startsWith('check_dep_')) {
    if (callbackQuery?.id) {
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id, text: isEn ? 'ℹ️ Wallet feature has been removed. All purchases are instant via QRIS.' : 'ℹ️ Fitur dompet dinonaktifkan. Pembelian diproses langsung via QRIS instan.' })
      }).catch(() => {});
    }
    return { ok: true };
  }

  // 7. Menu Profil
  if (cbData === 'menu_profile') {
    const msgText = isEn ? [
      '👤 <b>USER PROFILE</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 <b>Account Information:</b>',
      `├ <b>Full Name       :</b> ${from.first_name || '-'} ${from.last_name || ''}`,
      `├ <b>User ID         :</b> <code>${userId}</code>`,
      `├ <b>Username        :</b> ${username}`,
      `├ <b>Account Status  :</b> 🟢 <b>Verified</b>`,
      `└ <b>Official Store  :</b> PojokAI Official Store`
    ].join('\n') : [
      '👤 <b>PROFIL PENGGUNA</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 <b>Informasi Akun:</b>',
      `├ <b>Nama Lengkap :</b> ${from.first_name || '-'} ${from.last_name || ''}`,
      `├ <b>User ID      :</b> <code>${userId}</code>`,
      `├ <b>Username     :</b> ${username}`,
      `├ <b>Status Akun   :</b> 🟢 <b>Terverifikasi</b>`,
      `└ <b>Toko Resmi    :</b> PojokAI Official Store`
    ].join('\n');

    const buttons = [
      [{ text: isEn ? '🛍️ Start Shopping' : '🛍️ Mulai Belanja', callback_data: 'menu_products', style: 'success' }],
      [{ text: isEn ? '◀️ Back to Menu' : '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 8. Menu Ajak Teman (Referral)
  if (cbData === 'menu_referral') {
    const botUser = db.telegram?.botUsername || 'pojokkai_bot';
    const refLink = `https://t.me/${botUser}?start=ref_${userId}`;
    const msgText = isEn ? [
      '🤝 <b>REFERRAL PROGRAM</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Share your referral link with friends to get special promotions & bonuses at PojokAI!',
      '',
      `🔗 <b>Your Referral Link:</b>\n<code>${refLink}</code>`,
      '',
      '<i>Every friend who makes a purchase using your link will be recorded in the store system.</i>'
    ].join('\n') : [
      '🤝 <b>PROGRAM AJAK TEMAN (REFERRAL)</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Bagikan link referral Anda ke teman-teman untuk mendapatkan promo & bonus spesial di PojokAI!',
      '',
      `🔗 <b>Link Referral Anda:</b>\n<code>${refLink}</code>`,
      '',
      '<i>Setiap teman yang bertransaksi menggunakan link Anda akan tercatat di sistem toko.</i>'
    ].join('\n');

    const buttons = [
      [{ text: isEn ? '📢 Share to Another Chat' : '📢 Bagikan ke Chat Lain', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(isEn ? 'Buy cheap & official digital accounts at PojokAI!' : 'Beli akun premium legal & murah di PojokAI!')}`, style: 'primary' }],
      [{ text: isEn ? '◀️ Back to Menu' : '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 9. Menu Bahasa
  if (cbData === 'set_lang_id' || cbData === 'set_lang_en') {
    const nextLang = cbData === 'set_lang_en' ? 'en' : 'id';
    if (!db.userLanguages) db.userLanguages = {};
    db.userLanguages[userId] = nextLang;
    if (chatId) db.userLanguages[String(chatId)] = nextLang;
    if (userWallet) userWallet.lang = nextLang;
    await saveDb(db);

    if (callbackQuery?.id) {
      const toastText = nextLang === 'en'
        ? '✅ Language set to English!'
        : '✅ Bahasa berhasil diubah ke Bahasa Indonesia!';
      fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id, text: toastText, show_alert: true })
      }).catch(() => {});
    }

    if (messageId) {
      await deleteTelegramMessage(chatId, messageId, token);
    }

    const isEn = nextLang === 'en';
    const userRank = '#' + ((Number(String(userId).slice(-2)) || 1) + 1);
    const orders = db.orders || [];
    const completedOrders = orders.filter((o) => {
      const s = String(o.status || '').toLowerCase();
      return s.includes('selesai') || s.includes('terkirim') || s.includes('diproses') || s.includes('lunas') || s.includes('terverifikasi');
    }).length;
    const totalSold = (db.products || []).reduce((sum, p) => sum + (Number(p.sold) || 0), 0) + completedOrders;

    const noticeBanner = isEn
      ? '✨ <b>Language successfully switched to 🇬🇧 English!</b>\n'
      : '✨ <b>Bahasa berhasil diubah ke 🇮🇩 Bahasa Indonesia!</b>\n';

    return await sendMainMenu(chatId, messageId, userId, username, db, token, isEn, noticeBanner, true);
  }

  if (cbData === 'menu_lang' || text.toLowerCase() === '/bahasa' || text.toLowerCase() === '/lang' || text.toLowerCase() === '/language') {
    const isLangEn = userLang === 'en';
    const msgText = [
      '🌐 <b>PILIH BAHASA / SELECT LANGUAGE</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      isLangEn
        ? 'Select the language you want to use for bot navigation:'
        : 'Pilih bahasa yang ingin Anda gunakan untuk navigasi bot:',
      '',
      isLangEn
        ? 'Current language: 🇬🇧 <b>English</b>'
        : 'Bahasa saat ini: 🇮🇩 <b>Bahasa Indonesia</b>',
      '',
      isLangEn
        ? '<i>Tap button below to switch:</i>'
        : '<i>Pilih opsi di bawah untuk mengganti:</i>'
    ].join('\n');

    const buttons = [
      [{
        text: isLangEn ? '🇮🇩 Switch to Bahasa Indonesia' : '🇮🇩 Bahasa Indonesia (Aktif)',
        callback_data: 'set_lang_id',
        style: isLangEn ? 'primary' : 'success'
      }],
      [{
        text: isLangEn ? '🇬🇧 English (Active)' : '🇬🇧 Switch to English',
        callback_data: 'set_lang_en',
        style: isLangEn ? 'success' : 'primary'
      }],
      [{
        text: isLangEn ? '◀️ Back to Menu' : '◀️ Kembali ke Menu',
        callback_data: 'menu_main',
        style: 'danger'
      }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  // 10. Menu Bantuan
  if (cbData === 'menu_help') {
    const msgText = isEn ? [
      '⚠️ <b>HELP CENTER &amp; CUSTOMER SUPPORT</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Need assistance with your account, warranty, or QRIS payment?',
      '',
      '📞 <b>Official Contacts:</b>',
      `├ <b>Admin WhatsApp  :</b> https://wa.me/${wa}`,
      '├ <b>Operating Hours :</b> 🟢 <b>24 Hours Daily</b>',
      '└ <b>Official Website :</b> https://pojokai.my.id',
      '',
      '💡 <b>Quick Commands:</b>',
      '├ /start - Open Main Menu',
      '├ /produk - Browse Products',
      '└ /bahasa - Change Language',
      '',
      '<i>Our customer care team is ready to assist you right away.</i>'
    ].join('\n') : [
      '⚠️ <b>PUSAT BANTUAN &amp; LAYANAN PELANGGAN</b>',
      '━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Butuh bantuan terkait akun, garansi, atau pembayaran QRIS?',
      '',
      '📞 <b>Kontak Layanan Resmi:</b>',
      `├ <b>WhatsApp Admin :</b> https://wa.me/${wa}`,
      '├ <b>Jam Operasional:</b> 🟢 <b>24 Jam Setiap Hari</b>',
      '└ <b>Website Resmi   :</b> https://pojokai.my.id',
      '',
      '💡 <b>Perintah Cepat:</b>',
      '├ /start - Buka Menu Utama',
      '├ /produk - Lihat Katalog Produk',
      '└ /bahasa - Ganti bahasa navigasi',
      '',
      '<i>Admin kami siap membantu menyelesaikan kendala Anda secepatnya.</i>'
    ].join('\n');

    const buttons = [
      [{ text: isEn ? '💬 Chat Admin WhatsApp (24 Hours)' : '💬 Chat WhatsApp Admin (24 Jam)', url: `https://wa.me/${wa}`, style: 'success' }],
      [{ text: isEn ? '🌐 Visit Website' : '🌐 Buka Website', web_app: { url: 'https://pojokai.my.id' }, style: 'primary' }],
      [{ text: isEn ? '◀️ Back to Menu' : '◀️ Kembali ke Menu', callback_data: 'menu_main', style: 'danger' }]
    ];
    await updateOrSendMessage(chatId, messageId, msgText, { inline_keyboard: buttons }, token);
    return { ok: true };
  }

  return { ok: true };
}


export default async function handler(req, res) {
  const isNodeRes = Boolean(res && typeof res.status === 'function');

  function send(status, data, headers = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
      'X-PojokAI-Backend': 'dynamic-serverless',
      ...headers,
    };

    if (isNodeRes) {
      res.status(status);
      for (const [k, v] of Object.entries(defaultHeaders)) {
        res.setHeader(k, v);
      }
      return res.json(data);
    }

    if (res && typeof res.writeHead === 'function') {
      res.writeHead(status, defaultHeaders);
      return res.end(JSON.stringify(data));
    }

    return new Response(JSON.stringify(data), {
      status,
      headers: defaultHeaders,
    });
  }

  const rawUrl = req.url || '/api';
  const urlObj = new URL(rawUrl, 'https://pojokai.my.id');
  const pathname = urlObj.pathname.replace(/^\/api\/index(\.js)?/, '/api');
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    if (isNodeRes) {
      res.status(204);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
      return res.end();
    }
    if (res && typeof res.writeHead === 'function') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
      });
      return res.end();
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
      },
    });
  }

  try {
    const db = await getDb();

    // 1. Catalog
    if (method === 'GET' && (pathname === '/api/catalog' || pathname === '/api/catalog.json' || pathname === '/api')) {
      return send(200, catalogFor(req, db));
    }

    // 2. Bundle
    if (method === 'GET' && (pathname === '/api/bundle' || pathname === '/api/bundle.json')) {
      return send(200, { bundle: db.bundle || null });
    }

    // 3. Session
    if (method === 'GET' && (pathname === '/api/session' || pathname === '/api/session.json')) {
      const owner = ownerOf(req, db);
      return send(200, {
        owner: owner ? { email: owner.email, role: owner.role } : null,
        needsSetup: (db.owners || []).length === 0,
      });
    }
    // 4. OAuth config
    if (method === 'GET' && pathname === '/api/oauth/config') {
      return send(200, {
        googleClientId: process.env.GOOGLE_CLIENT_ID || '882960778924-qnagvcduvc341a89bh7v8af2h3dbhhtg.apps.googleusercontent.com',
        githubClientId: process.env.GITHUB_CLIENT_ID || '',
      });
    }

    // 5. OAuth verify
    if (method === 'POST' && pathname === '/api/oauth/verify') {
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
        const owner = { email: '3t.ardiansyah@gmail.com', username: 'tittoganteng', role: 'owner' };
        const token = createSessionToken(owner.email);
        return send(200, {
          token,
          owner: { email: owner.email, role: owner.role },
          provider: 'google',
        }, {
          'Set-Cookie': `wk_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; HttpOnly; Secure`,
        });
      }

      const owner = (db.owners || []).find((o) => o.email.toLowerCase() === email);
      if (!owner) {
        return send(403, { error: 'Akses ditolak: Email Google ini bukan akun owner terdaftar.' });
      }

      const token = createSessionToken(owner.email);
      if (!db.sessions) db.sessions = [];
      db.sessions = db.sessions.filter((s) => s.expires > Date.now());
      db.sessions.push({ tokenHash: hashToken(token), email: owner.email, expires: Date.now() + SESSION_TTL });
      await saveDb(db);

      return send(200, {
        token,
        owner: { email: owner.email, role: owner.role },
        provider,
      }, {
        'Set-Cookie': `wk_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; HttpOnly; Secure`,
      });
    }

    // 6. Setup owner
    if (method === 'POST' && pathname === '/api/setup') {
      if (db.owners && db.owners.length > 0) {
        return send(403, { error: 'Akun owner sudah ada. Setup ditutup.' });
      }
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !email.includes('@')) return send(400, { error: 'Email tidak valid' });
      if (password.length < 8) return send(400, { error: 'Password minimal 8 karakter' });

      if (!db.owners) db.owners = [];
      const owner = { email, role: 'owner', passhash: hashPassword(password) };
      db.owners.push(owner);
      const token = createSessionToken(owner.email);
      if (!db.sessions) db.sessions = [];
      db.sessions.push({ tokenHash: hashToken(token), email: owner.email, expires: Date.now() + SESSION_TTL });
      await saveDb(db);

      return send(200, { token, owner: { email: owner.email, role: owner.role } }, {
        'Set-Cookie': `wk_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; HttpOnly; Secure`,
      });
    }

    // 7. Login
    if (method === 'POST' && pathname === '/api/login') {
      const body = await readBody(req);
      const identifier = String(body.username || body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!identifier || !password) {
        return send(400, { error: 'Username/email dan password wajib diisi' });
      }

      const owner = (db.owners || []).find((o) => o.email === identifier || o.username === identifier) || (identifier === 'tittoganteng' || identifier === '3t.ardiansyah@gmail.com' ? { email: '3t.ardiansyah@gmail.com', username: 'tittoganteng', role: 'owner' } : null);
      if (!owner) {
        return send(401, { error: 'Username/email atau password salah' });
      }

      const passMatch = owner?.passhash ? verifyPassword(password, owner.passhash) : false;
      if (!passMatch) {
        return send(401, { error: 'Username/email atau password salah' });
      }
      const token = createSessionToken(owner.email);
      if (!db.sessions) db.sessions = [];
      db.sessions = db.sessions.filter((s) => s.expires > Date.now());
      db.sessions.push({ tokenHash: hashToken(token), email: owner.email, expires: Date.now() + SESSION_TTL });
      await saveDb(db);

      return send(200, {
        token,
        owner: { email: owner.email, role: owner.role },
      }, {
        'Set-Cookie': `wk_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax; HttpOnly; Secure`,
      });
    }

    // 8. Logout
    if (method === 'POST' && pathname === '/api/logout') {
      const token = bearer(req);
      if (token && db.sessions) {
        db.sessions = db.sessions.filter((s) => s.tokenHash !== hashToken(token));
        await saveDb(db);
      }
      return send(200, { ok: true }, {
        'Set-Cookie': 'wk_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure',
      });
    }

    // 9. Patch Bundle
    if (method === 'PATCH' && pathname === '/api/bundle') {
      if (!ownerOf(req, db)) return send(401, { error: 'Harus login owner' });
      const body = await readBody(req);
      const patch = cleanBundle(body);
      db.bundle = { ...(db.bundle || {}), ...patch };
      await saveDb(db);
      return send(200, { bundle: db.bundle });
    }

    // 10. Settings (WhatsApp)
    if (method === 'PATCH' && pathname === '/api/settings') {
      if (!ownerOf(req, db)) return send(401, { error: 'Harus login owner' });
      const body = await readBody(req);
      if (body.wa !== undefined) {
        const cleanWa = String(body.wa).replace(/\D/g, '');
        if (cleanWa.length < 9) return send(400, { error: 'Nomor WhatsApp tidak valid (minimal 9 digit)' });
        db.wa = cleanWa;
        await saveDb(db);
      }
      return send(200, { wa: db.wa });
    }

    // 11. Password
    if (method === 'POST' && pathname === '/api/password') {
      const owner = ownerOf(req, db);
      if (!owner) return send(401, { error: 'Harus login owner' });
      const body = await readBody(req);
      if (!verifyPassword(String(body.current || ''), owner.passhash)) return send(400, { error: 'Password lama salah' });
      if (String(body.next || '').length < 8) return send(400, { error: 'Password baru minimal 8 karakter' });
      owner.passhash = hashPassword(String(body.next));
      if (db.sessions) db.sessions = db.sessions.filter((s) => s.email !== owner.email);
      const token = createSessionToken(owner.email);
      if (!db.sessions) db.sessions = [];
      db.sessions.push({ tokenHash: hashToken(token), email: owner.email, expires: Date.now() + SESSION_TTL });
      await saveDb(db);
      return send(200, { token, owner: { email: owner.email, role: owner.role } });
    }

    // 12. Create Product
    if (method === 'POST' && pathname === '/api/products') {
      if (!ownerOf(req, db)) return send(401, { error: 'Harus login owner' });
      const body = await readBody(req);
      const { patch, error } = cleanProduct(body, db);
      if (error) return send(400, { error });
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
      await saveDb(db);
      return send(201, { product });
    }

    // 13. Single Product operations (/api/products/:slug)
    const productMatch = pathname.match(/^\/api\/products\/([a-z0-9-]{2,60})$/);
    if (productMatch) {
      if (!ownerOf(req, db)) return send(401, { error: 'Harus login owner' });
      const targetSlug = productMatch[1];
      const idx = (db.products || []).findIndex((x) => x.slug === targetSlug);
      if (idx < 0) return send(404, { error: 'Produk tidak ditemukan' });

      if (method === 'PATCH') {
        const body = await readBody(req);
        const single = Number.isInteger(body.vi) && !Array.isArray(body.variants);
        const { patch, error } = cleanProduct(body, db);
        if (error) return send(400, { error });
        if (!Object.keys(patch).length && !single) return send(400, { error: 'Tidak ada perubahan' });
        const next = { ...db.products[idx], ...patch };
        if (single) {
          const edit = applyVariantEdit(next, body);
          if (edit.error) return send(400, { error: edit.error });
          next.variants = edit.patch.variants;
        }
        db.products[idx] = next;
        await saveDb(db);
        return send(200, { product: next });
      }

      if (method === 'DELETE') {
        const [removed] = db.products.splice(idx, 1);
        await saveDb(db);
        return send(200, { ok: true, slug: removed.slug });
      }
    }

    // 14. Orders (Create)
    if (method === 'POST' && pathname === '/api/orders') {
      const body = await readBody(req);
      if (!body.code || !body.product) {
        return send(400, { error: 'Data pesanan tidak lengkap' });
      }

      let verifiedPrice = Number(body.product?.price) || 0;
      const qty = Math.max(1, Math.min(100, Number(body.product?.qty) || 1));
      const prodName = String(body.product?.name || '').trim().toLowerCase();
      const varName = String(body.product?.variant || '').trim().toLowerCase();

      const matchedProduct = (db.products || []).find((p) => p.name.trim().toLowerCase() === prodName || p.slug === prodName);
      const isBundle = db.bundle && db.bundle.enabled && db.bundle.title && db.bundle.title.trim().toLowerCase() === prodName;

      if (!matchedProduct && !isBundle) {
        return send(400, { error: 'Produk tidak valid atau tidak terdaftar di katalog' });
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
      await saveDb(db);

      return send(201, { order });
    }

    // 14b. Orders (Update Status)
    if (method === 'PATCH' && pathname === '/api/orders') {
      if (!ownerOf(req, db)) return send(401, { error: 'Hanya admin yang berhak memperbarui status pesanan' });
      const body = await readBody(req);
      const code = String(body.code || '').trim().toUpperCase();
      const status = String(body.status || '').trim();
      if (!code || !status) return send(400, { error: 'Kode dan status pesanan wajib diisi' });
      if (!db.orders) db.orders = [];
      const cleanCode = code.replace(/[^A-Z0-9]/g, '');
      const order = db.orders.find((o) => o.code === code || (cleanCode && o.code.replace(/[^A-Z0-9]/g, '') === cleanCode));
      if (!order) return send(404, { error: 'Pesanan tidak ditemukan' });
      order.status = status;
      order.updatedAt = new Date().toISOString();
      await saveDb(db);
      return send(200, { order });
    }
    // 14c. Orders (Delete Order)
    if (method === 'DELETE' && pathname === '/api/orders') {
      if (!ownerOf(req, db)) return send(401, { error: 'Hanya admin yang berhak menghapus pesanan' });
      const body = await readBody(req).catch(() => ({}));
      const code = String(body.code || urlObj.searchParams.get('code') || '').trim().toUpperCase();
      const allCancelled = urlObj.searchParams.get('type') === 'cancelled' || body.type === 'cancelled';
      const allOrders = urlObj.searchParams.get('type') === 'all' || body.type === 'all';

      if (!db.orders) db.orders = [];

      if (allOrders) {
        const count = db.orders.length;
        db.orders = [];
        await saveDb(db);
        return send(200, { ok: true, deleted: count });
      }

      if (allCancelled) {
        const isCancelled = (s) => (s || '').includes('Batal') || (s || '').includes('Kadaluarsa') || (s || '').includes('Expired');
        const before = db.orders.length;
        db.orders = db.orders.filter((o) => !isCancelled(o.status));
        const deleted = before - db.orders.length;
        await saveDb(db);
        return send(200, { ok: true, deleted });
      }

      if (!code) return send(400, { error: 'Kode pesanan wajib disertakan' });
      const cleanCode = code.replace(/[^A-Z0-9]/g, '');
      const idx = db.orders.findIndex((o) => o.code === code || (cleanCode && o.code.replace(/[^A-Z0-9]/g, '') === cleanCode));
      if (idx === -1) return send(404, { error: 'Pesanan tidak ditemukan' });
      const [removed] = db.orders.splice(idx, 1);
      await saveDb(db);
      return send(200, { ok: true, order: removed });
    }


    // 15. Orders (Get / Search)
    if (method === 'GET' && pathname === '/api/orders') {
      const q = (urlObj.searchParams.get('q') || '').trim();
      const code = (urlObj.searchParams.get('code') || q).trim().toUpperCase();
      const wa = (urlObj.searchParams.get('wa') || q).replace(/\D/g, '');
      const email = (urlObj.searchParams.get('email') || (q.includes('@') ? q : '')).trim().toLowerCase();
      const orders = db.orders || [];

      const sanitizeForBuyer = (o) => ({
        ...o,
        buyer: {
          name: o.buyer?.name,
          wa: o.buyer?.wa ? String(o.buyer.wa).slice(0, 4) + '****' + String(o.buyer.wa).slice(-4) : '',
          email: o.buyer?.email ? String(o.buyer.email).replace(/(.{2})(.*)(?=@)/, '$1****') : '',
        }
      });

      if (ownerOf(req, db)) {
        return send(200, { orders: orders.slice(0, 100) });
      }

      if (code) {
        const cleanCode = code.replace(/[^A-Z0-9]/g, '');
        const found = orders.find((o) => o.code === code || (cleanCode && o.code.replace(/[^A-Z0-9]/g, '') === cleanCode));
        if (found) return send(200, { orders: [sanitizeForBuyer(found)] });
      }

      if (wa && wa.length >= 8) {
        const found = orders.filter((o) => {
          const oWa = String(o.buyer?.wa || '').replace(/\D/g, '');
          return oWa === wa || (wa.length >= 9 && oWa.endsWith(wa.slice(-9)));
        });
        if (found.length) return send(200, { orders: found.slice(0, 20).map(sanitizeForBuyer) });
      }

      if (email && email.includes('@')) {
        const found = orders.filter((o) => String(o.buyer?.email || '').toLowerCase() === email);
        if (found.length) return send(200, { orders: found.slice(0, 20).map(sanitizeForBuyer) });
      }

      return send(200, { orders: [] });
    }

    // 15b. Orders (Expire / Cancel after 5 minutes)
    if (method === 'POST' && pathname === '/api/orders/expire') {
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
            await saveDb(db);
          } else {
            return send(400, { error: 'Batas waktu 5 menit belum terlampaui' });
          }
        }
      }
      return send(200, { ok: true });
    }

    // 16. WistaPay Dynamic QRIS (Create)
    if (method === 'POST' && pathname === '/api/qris/create') {
      const body = await readBody(req);
      const orderCode = String(body.order_id || body.code || '').trim().toUpperCase();
      const order = (db.orders || []).find((o) => o.code === orderCode);
      const amount = order && order.total > 0 ? order.total : (Number(body.amount || body.total) || 0);
      const description = String(body.description || `Pesanan ${orderCode}`).slice(0, 150);

      if (!orderCode || amount < 1000) {
        return send(400, { error: 'Kode pesanan dan nominal (min Rp1.000) wajib diisi' });
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
            await saveDb(db);
          }
          return send(200, { success: true, data: json.data });
        }
        return send(400, { error: json.message || 'Gagal membuat QRIS WistaPay', fallback: true });
      } catch (err) {
        return send(502, { error: 'Koneksi gateway WistaPay terganggu', fallback: true });
      }
    }

    // 17. WistaPay Check Status
    if (method === 'GET' && pathname === '/api/qris/status') {
      const ref = (urlObj.searchParams.get('reference') || '').trim();
      const orderCode = (urlObj.searchParams.get('order_id') || urlObj.searchParams.get('code') || '').trim().toUpperCase();

      if (!ref && !orderCode) {
        return send(400, { error: 'Parameter reference atau order_id wajib' });
      }

      const order = (db.orders || []).find((o) => o.code === orderCode || o.wistapay?.reference === ref);
      if (order && (order.status.includes('Lunas') || order.status.includes('Diproses') || order.status.includes('Selesai'))) {
        return send(200, { success: true, status: 'PAID', orderStatus: order.status });
      }

      const lookupRef = ref || order?.wistapay?.reference;
      if (!lookupRef) {
        return send(200, { success: true, status: 'PENDING' });
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
              await saveDb(db);
            }
            return send(200, { success: true, status: 'PAID', data: json.data });
          }
          return send(200, { success: true, status: wStatus, data: json.data });
        }
        return send(200, { success: true, status: 'PENDING' });
      } catch (err) {
        return send(200, { success: true, status: 'PENDING', error: err.message });
      }
    }

    // 18. WistaPay Webhook
    if (method === 'POST' && pathname === '/api/webhook/wistapay') {
      const body = await readBody(req);
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
                return send(400, { error: 'Verifikasi status pembayaran gateway gagal' });
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
              dep.paidAt = body.timestamp || new Date().toISOString();
              const uid = dep.userId;
              if (!db.wallets) db.wallets = {};
              if (!db.wallets[uid]) db.wallets[uid] = { balance: 0, totalDeposit: 0, totalSpent: 0 };
              db.wallets[uid].balance = (db.wallets[uid].balance || 0) + dep.amount;
              db.wallets[uid].totalDeposit = (db.wallets[uid].totalDeposit || 0) + dep.amount;
              await saveDb(db);

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
            await saveDb(db);

            if (order.buyer?.telegramChatId) {
              const notifMsg = formatTransactionSuccessMessage(order);
              sendTelegramMessage(order.buyer.telegramChatId, notifMsg, {
                inline_keyboard: [
                  [{ text: '💬 Hubungi Admin WA', url: `https://wa.me/${db.wa || '6283171982973'}?text=${encodeURIComponent(`Halo admin, pesanan saya ${order.code} sudah lunas di bot Telegram.`)}`, style: 'success' }],
                  [{ text: '◀️ Menu Utama', callback_data: 'menu_main', style: 'danger' }]
                ]
              }).catch(() => {});
            }
          } else if (status === 'EXPIRED' || event === 'payment.expired') {
            order.status = 'Kadaluarsa';
            await saveDb(db);
          }
        }
      }
      return send(200, { success: true });
    }

    // 19. Telegram Bot Webhook (Dilengkapi Validasi Secret Token & Rate Limiting)
    if (method === 'POST' && pathname === '/api/webhook/telegram') {
      const secretToken = req.headers['x-telegram-bot-api-secret-token'] || req.headers?.get?.('x-telegram-bot-api-secret-token') || '';
      const expectedSecret = getTelegramSecret(db);
      if (expectedSecret && secretToken !== expectedSecret) {
        console.warn('[telegram webhook] Ditolak: Secret token tidak valid');
        return send(403, { error: 'Akses ditolak: Secret token bot tidak valid' });
      }

      const ip = getClientIp(req);
      if (isTeleRateLimited(`tele_ip:${ip}`, 30, 60000)) {
        return send(429, { error: 'Terlalu banyak permintaan webhook Telegram' });
      }

      const body = await readBody(req);
      const chatId = body?.message?.chat?.id || body?.callback_query?.message?.chat?.id;
      if (chatId && isTeleRateLimited(`tele_chat:${chatId}`, 20, 60000)) {
        await sendTelegramMessage(chatId, '⚠️ Anda terlalu cepat mengirim perintah. Silakan tunggu beberapa detik.', null, getTelegramToken(null, db));
        return send(200, { ok: true });
      }

      await handleTelegramWebhook(body, db);
      return send(200, { ok: true });
    }
    if ((method === 'GET' || method === 'POST') && pathname === '/api/telegram/sync-commands') {
      const secretToken = req.headers['x-telegram-bot-api-secret-token'] || req.headers?.get?.('x-telegram-bot-api-secret-token') || '';
      const expectedSecret = getTelegramSecret(db);
      if (expectedSecret && secretToken !== expectedSecret) {
        return send(403, { error: 'Akses ditolak: Secret token bot tidak valid' });
      }
      const token = getTelegramToken(null, db);
      const resSync = await syncTelegramCommands(token);
      return send(200, { success: true, result: resSync });
    }
    return send(404, { error: 'Endpoint tidak ditemukan: ' + pathname });
  } catch (err) {
    console.error('[api error]', err);
    return send(500, { error: 'Terjadi kesalahan di server: ' + err.message });
  }
}
