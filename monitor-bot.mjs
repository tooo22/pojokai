#!/usr/bin/env node
// ==============================================================================
// PojokAI Watchdog & Bug Monitor Bot
// ==============================================================================
// Memantau kesehatan Web Frontend, API, Database, Wistapay, dan Bot Telegram User
// Mengirimkan status berkala real-time setiap 5 menit & alert instan saat ada bug.
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const CONFIG_FILE = path.join(ROOT_DIR, 'monitor-config.json');
const DB_FILE = path.join(ROOT_DIR, 'data', 'db.json');

// --- Load Configuration ---
function loadConfig() {
  let cfg = {
    monitorBotToken: process.env.MONITOR_BOT_TOKEN || '',
    userBotToken: process.env.USER_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
    ownerChatId: process.env.MONITOR_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID || '7787855968',
    intervalSeconds: 5,
    lastMessageId: 3,
    animationFileId: 'CgACAgUAAxkDAAMDatMEOWtwbW_O9b7An9-TWHJNUyMAAlwfAAIlFJhWCv2aTeJKPXU9BA',
    webUrl: process.env.POJOKAI_WEB_URL || 'https://pojokai.my.id',
    wistapayApiKey: process.env.WISTAPAY_API_KEY || '',
  };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg = { ...cfg, ...fileData };
    } catch (e) {
      console.warn('[CONFIG] Gagal membaca monitor-config.json:', e.message);
    }
  }

  // Fallback data dari data/db.json jika belum terisi
  if (fs.existsSync(DB_FILE)) {
    try {
      const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!cfg.userBotToken && dbData.telegram?.botToken) {
        cfg.userBotToken = dbData.telegram.botToken;
      }
      if (!cfg.ownerChatId && dbData.telegram?.ownerChatId) {
        cfg.ownerChatId = dbData.telegram.ownerChatId;
      }
      if (!cfg.wistapayApiKey && dbData.wistapay?.apiKey) {
        cfg.wistapayApiKey = dbData.wistapay.apiKey;
      }
      if (!cfg.lastMessageId && dbData.securityBot?.lastMessageId) {
        cfg.lastMessageId = dbData.securityBot.lastMessageId;
      }
      if (!cfg.animationFileId && dbData.securityBot?.animationFileId) {
        cfg.animationFileId = dbData.securityBot.animationFileId;
      }
    } catch {}
  }

  // Parse command line arguments: --token <token> --chat <id> --interval <sec>
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i + 1]) cfg.monitorBotToken = args[++i];
    if (args[i] === '--chat' && args[i + 1]) cfg.ownerChatId = args[++i];
    if (args[i] === '--interval' && args[i + 1]) cfg.intervalSeconds = Math.max(1, parseInt(args[++i], 10) || 5);
    if (args[i] === '--url' && args[i + 1]) cfg.webUrl = args[++i];
    if (args[i] === '--once') cfg.once = true;
  }
  return cfg;
}

const config = loadConfig();

// --- State Tracker ---
const state = {
  startedAt: Date.now(),
  checkCount: 0,
  incidentsCount: 0,
  lastCheckResult: null,
  previousComponentsStatus: {},
  alertCooldowns: new Map(), // key -> timestamp
  pollingOffset: 0,
};

// Format Timestamp WIB (UTC+7)
function getWibTime(date = new Date()) {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getUTCFullYear();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const month = monthNames[d.getUTCMonth()];
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());
  return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} WIB`;
}

// Format Duration
function formatUptime(ms) {
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const parts = [];
  if (days > 0) parts.push(`${days}h`);
  if (hours > 0) parts.push(`${hours}j`);
  if (min > 0) parts.push(`${min}m`);
  parts.push(`${sec}d`);
  return parts.join(' ');
}

async function sendTelegramAlert(text) {
  if (!config.monitorBotToken || !config.ownerChatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.monitorBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.ownerChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    return json.ok;
  } catch {
    return false;
  }
}

async function updateOrSendDashboard(captionText) {
  if (!config.monitorBotToken || !config.ownerChatId) return false;

  const chatId = config.ownerChatId;
  const animationId = config.animationFileId || 'CgACAgUAAxkDAAMDatMEOWtwbW_O9b7An9-TWHJNUyMAAlwfAAIlFJhWCv2aTeJKPXU9BA';

  // 1. Coba update caption pada 1 pesan yang ada (tidak menumpuk pesan!)
  if (config.lastMessageId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${config.monitorBotToken}/editMessageCaption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: config.lastMessageId,
          caption: captionText,
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(8000),
      });
      const json = await res.json();
      if (json.ok) return true;
      if (json.description && json.description.includes('message is not modified')) return true;
      console.log(`[DASHBOARD RE-ATTACH] Pesan id:${config.lastMessageId} tidak bisa diedit (${json.description}). Mengirim dashboard baru.`);
    } catch (e) {}
  }

  // 2. Jika belum ada pesan atau pesan lama terhapus -> kirim sendAnimation baru dengan GIF profile merah di atasnya
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.monitorBotToken}/sendAnimation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        animation: animationId,
        caption: captionText,
        parse_mode: 'HTML',
      }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    if (json.ok && json.result?.message_id) {
      config.lastMessageId = json.result.message_id;
      try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      } catch {}
      return true;
    }
    console.warn('[DASHBOARD SEND ERROR]', json.description);
  } catch (err) {
    console.error('[DASHBOARD FETCH ERROR]', err.message);
  }
  return false;
}

// ==============================================================================
// 1. Health Checks Implementation
// ==============================================================================

// Cek Web Frontend (HTML)
async function checkWebFrontend(webUrl) {
  const t0 = performance.now();
  try {
    const res = await fetch(webUrl, {
      headers: { 'User-Agent': 'PojokAI-Watchdog/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    const latency = Math.round(performance.now() - t0);
    const text = await res.text();
    const hasBrand = text.includes('PojokAI') || text.includes('store') || text.includes('catalog');
    
    if (res.ok && hasBrand) {
      return { ok: true, status: res.status, latency, message: 'Online & Responsif' };
    }
    return {
      ok: false,
      status: res.status,
      latency,
      message: res.ok ? 'Halaman tidak memuat elemen PojokAI' : `HTTP Error ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latency: Math.round(performance.now() - t0),
      message: err.name === 'TimeoutError' ? 'Koneksi Timeout (>12s)' : err.message,
    };
  }
}

// Cek Katalog API
async function checkCatalogApi(webUrl) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${webUrl}/api/catalog`, {
      headers: { 'User-Agent': 'PojokAI-Watchdog/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    const latency = Math.round(performance.now() - t0);
    if (!res.ok) {
      return { ok: false, status: res.status, latency, message: `HTTP Error ${res.status}` };
    }
    const data = await res.json();
    const productCount = Array.isArray(data.products) ? data.products.length : 0;
    const catCount = Array.isArray(data.categories) ? data.categories.length : 0;

    if (productCount > 0) {
      return {
        ok: true,
        status: res.status,
        latency,
        productCount,
        catCount,
        message: `${productCount} produk, ${catCount} kategori aktif`,
      };
    }
    return {
      ok: false,
      status: res.status,
      latency,
      productCount: 0,
      message: 'Katalog kosong atau format tidak sesuai',
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latency: Math.round(performance.now() - t0),
      message: err.message,
    };
  }
}

// Cek Integritas Database Lokal & Deteksi Order Nyangkut
async function checkDatabase() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { ok: false, message: 'File db.json tidak ditemukan' };
    }
    const content = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(content);

    const products = Array.isArray(data.products) ? data.products : [];
    const orders = Array.isArray(data.orders) ? data.orders : [];

    // Deteksi anomali: pesanan "Menunggu Pembayaran" yang nyangkut lebih dari 30 menit tanpa expired
    const now = Date.now();
    const stuckOrders = orders.filter((o) => {
      if (!o.status || !o.status.includes('Menunggu Pembayaran')) return false;
      const created = new Date(o.createdAt || 0).getTime();
      return created > 0 && now - created > 30 * 60 * 1000;
    });

    const isHealthy = products.length > 0;
    return {
      ok: isHealthy,
      productsCount: products.length,
      ordersCount: orders.length,
      stuckOrdersCount: stuckOrders.length,
      stuckOrders: stuckOrders.map((o) => o.code).slice(0, 5),
      message: isHealthy ? `Valid (${products.length} produk, ${orders.length} pesanan)` : 'Data produk kosong',
    };
  } catch (err) {
    return {
      ok: false,
      message: `Database Korup / JSON Parse Error: ${err.message}`,
    };
  }
}

// Cek Bot Telegram User (@pojokkai_bot)
async function checkUserBot(userBotToken, webUrl) {
  const result = {
    ok: true,
    hasToken: Boolean(userBotToken),
    botName: 'pojokkai_bot',
    webhookUrl: null,
    pendingUpdates: 0,
    lastError: null,
    webhookEndpointLive: false,
    message: '',
  };

  // 1. Cek Webhook Endpoint API Server
  try {
    const probeRes = await fetch(`${webUrl}/api/webhook/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: true }),
      signal: AbortSignal.timeout(8000),
    });
    // Jika endpoint mengembalikan 401/403 (karena secret token belum valid), berarti endpoint aktif & terlindungi
    if (probeRes.status === 403 || probeRes.status === 401 || probeRes.status === 200 || probeRes.status === 400) {
      result.webhookEndpointLive = true;
    }
  } catch (err) {
    result.webhookEndpointLive = false;
  }

  // 2. Cek API Telegram getMe & getWebhookInfo jika token tersedia
  if (userBotToken) {
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${userBotToken}/getMe`, {
        signal: AbortSignal.timeout(8000),
      });
      const meJson = await meRes.json();
      if (meJson.ok && meJson.result) {
        result.botName = `@${meJson.result.username || 'pojokkai_bot'}`;
      } else {
        result.ok = false;
        result.message = `Token bot user tidak valid: ${meJson.description || 'Unknown error'}`;
        return result;
      }

      const whRes = await fetch(`https://api.telegram.org/bot${userBotToken}/getWebhookInfo`, {
        signal: AbortSignal.timeout(8000),
      });
      const whJson = await whRes.json();
      if (whJson.ok && whJson.result) {
        const info = whJson.result;
        result.webhookUrl = info.url || 'Belum diatur';
        result.pendingUpdates = info.pending_update_count || 0;

        if (info.last_error_message) {
          result.lastError = `${info.last_error_message} (${info.last_error_date ? new Date(info.last_error_date * 1000).toLocaleTimeString() : ''})`;
        }

        // Anomali: jika antrean pending updates > 20, ada indikasi bot macet / webhook gagal terima
        if (result.pendingUpdates > 20) {
          result.ok = false;
          result.message = `Peringatan: Antrean webhook menumpuk (${result.pendingUpdates} pending updates)`;
          return result;
        }

        if (result.lastError) {
          result.ok = false;
          result.message = `Webhook Error Telegram: ${result.lastError}`;
          return result;
        }
      }
    } catch (err) {
      result.ok = false;
      result.message = `Koneksi ke Telegram API gagal: ${err.message}`;
      return result;
    }
  }

  if (!result.webhookEndpointLive) {
    result.ok = false;
    result.message = 'Endpoint webhook /api/webhook/telegram tidak dapat diakses';
    return result;
  }

  result.message = `${result.botName} Normal (0 antrean macet)`;
  return result;
}

// Cek Gateway Pembayaran Wistapay (dengan retry & timeout 15s)
async function checkWistapay(apiKey, retry = 1) {
  const t0 = performance.now();
  const probeUrl = 'https://wistapay.shop/wistapay/api/check-status.php?reference=PROBE_HEALTH_TEST';
  try {
    const res = await fetch(probeUrl, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    const latency = Math.round(performance.now() - t0);
    if (res.status >= 200 && res.status < 500) {
      return { ok: true, status: res.status, latency, message: `Reachable (${latency}ms)` };
    }
    return { ok: false, status: res.status, latency, message: `Gateway Error HTTP ${res.status}` };
  } catch (err) {
    if (retry > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return checkWistapay(apiKey, retry - 1);
    }
    return {
      ok: false,
      status: 0,
      latency: Math.round(performance.now() - t0),
      message: `Koneksi gateway terganggu: ${err.message}`,
    };
  }
}

// ==============================================================================
// 2. Diagnostic Runner & Reporter
// ==============================================================================

async function runDiagnostic() {
  state.checkCount++;

  const [web, catalog, db, userBot, wistapay] = await Promise.all([
    checkWebFrontend(config.webUrl),
    checkCatalogApi(config.webUrl),
    checkDatabase(),
    checkUserBot(config.userBotToken, config.webUrl),
    checkWistapay(config.wistapayApiKey),
  ]);

  const bugs = [];
  if (!web.ok) bugs.push(`🌐 Web Frontend: ${web.message}`);
  if (!catalog.ok) bugs.push(`📦 Katalog API: ${catalog.message}`);
  if (!db.ok) bugs.push(`💾 Database: ${db.message}`);
  if (db.stuckOrdersCount > 0) bugs.push(`⏳ ${db.stuckOrdersCount} pesanan nyangkut > 30m (${db.stuckOrders.join(', ')})`);
  if (!userBot.ok) bugs.push(`🤖 Bot User: ${userBot.message}`);
  if (!wistapay.ok) bugs.push(`💳 Gateway QRIS: ${wistapay.message}`);

  // Deteksi latensi tinggi (>3500ms)
  if (web.ok && web.latency > 3500) {
    bugs.push(`⚡ Peringatan: Latensi web lambat (${web.latency}ms)`);
  }

  const isAllHealthy = bugs.length === 0;
  if (!isAllHealthy) {
    state.incidentsCount++;
  }

  const result = {
    timestamp: Date.now(),
    checkNumber: state.checkCount,
    isAllHealthy,
    bugs,
    components: {
      web,
      catalog,
      db,
      userBot,
      wistapay,
    },
  };

  state.lastCheckResult = result;
  return result;
}

const SPINNERS = ['🟢', '🟩', '❇️', '✳️'];

// Format Pesan Dashboard Real-Time (Neat & Structured Layout)
function formatReportMessage(diag) {
  const { isAllHealthy, bugs, components, checkNumber } = diag;
  const timeStr = getWibTime(new Date(diag.timestamp));
  const uptimeStr = formatUptime(Date.now() - state.startedAt);
  const pulse = SPINNERS[checkNumber % SPINNERS.length];

  const webIcon = components.web.ok ? '🟢' : '🔴';
  const catIcon = components.catalog.ok ? '🟢' : '🔴';
  const dbIcon = components.db.ok ? '🟢' : '🔴';
  const botIcon = components.userBot.ok ? '🟢' : '🔴';
  const wistaIcon = components.wistapay.ok ? '🟢' : '🔴';
  const overallBadge = isAllHealthy ? '🟢 <b>SEMUA SISTEM NORMAL</b>' : '⚠️ <b>GANGGUAN TERDETEKSI</b>';

  const lines = [
    `🛡️ <b>POJOKAI LIVE SYSTEM MONITOR</b>`,
    `⚡ <i>Real-time Dashboard (Update per 5 detik)</i>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 <b>STATUS  :</b> ${overallBadge}`,
    `🕒 <b>WAKTU   :</b> <code>${timeStr}</code>`,
    `⏱️ <b>UPTIME  :</b> <code>${uptimeStr}</code>  •  <b>Cycle:</b> <code>#${checkNumber}</code>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🌐 <b>LAYANAN WEB &amp; API</b>`,
    `  ├ <b>Frontend Toko :</b> ${webIcon} <code>${components.web.latency}ms</code> — <i>${components.web.message}</i>`,
    `  ├ <b>Katalog API   :</b> ${catIcon} <code>${components.catalog.latency}ms</code> — <i>${components.catalog.message}</i>`,
    `  └ <b>Integritas DB  :</b> ${dbIcon} — <i>${components.db.message}</i>`,
    ``,
    `🤖 <b>BOT TELEGRAM USER (@pojokkai_bot)</b>`,
    `  ├ <b>Koneksi Server :</b> ${botIcon} — <i>${components.userBot.webhookEndpointLive ? 'Online (Endpoint Siap)' : 'Offline'}</i>`,
    `  ├ <b>Antrean Update :</b> 🟢 <code>${components.userBot.pendingUpdates} pesan</code> — <i>${components.userBot.pendingUpdates > 0 ? 'Sedang diproses' : 'Lancar'}</i>`,
    `  └ <b>Status Webhook :</b> ${components.userBot.lastError ? '🔴 ' + components.userBot.lastError : '🟢 <i>Bebas Kendala</i>'}`,
    ``,
    `💳 <b>GATEWAY PEMBAYARAN QRIS</b>`,
    `  ├ <b>Wistapay Server:</b> ${wistaIcon} <code>${components.wistapay.latency}ms</code> — <i>${components.wistapay.ok ? 'Terhubung Aktif' : 'Gangguan'}</i>`,
    `  └ <b>Sistem QRIS    :</b> 🟢 <i>Siap Proses Transaksi</i>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    bugs.length > 0
      ? `🚨 <b>LAPORAN ANOMALI &amp; BUG (${bugs.length}):</b>\n` + bugs.map((b) => `  └ • ${b}`).join('\n')
      : `✨ <b>LAPORAN ANOMALI &amp; BUG :</b> <i>Nihil (0 bug aktif)</i>\n  └ <i>Semua sistem berfungsi normal tanpa kendala.</i>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${pulse} <i>Live monitoring aktif • Memperbarui setiap 5 detik</i>`,
  ];

  return lines.join('\n');
}


// Format Pesan Alert Instan Darurat
function formatAlertMessage(componentName, issueMessage) {
  const timeStr = getWibTime();
  return [
    `🚨 <b>[POJOKAI ALERT DARURAT]</b>`,
    `⚠️ <b>GANGGUAN / BUG TERDETEKSI SECARA INSTAN!</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📍 <b>Komponen:</b> <code>${componentName}</code>`,
    `❌ <b>Detail Masalah:</b> ${issueMessage}`,
    `🕒 <b>Waktu:</b> ${timeStr}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💡 <i>Sistem Watchdog mendeteksi penurunan performa atau downtime. Mohon segera dicek.</i>`,
  ].join('\n');
}

// Format Pesan Recovery
function formatRecoveryMessage(componentName) {
  const timeStr = getWibTime();
  return [
    `✅ <b>[POJOKAI RECOVERY]</b>`,
    `🎉 <b>SISTEM KEMBALI NORMAL & OPERASIONAL</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📍 <b>Komponen:</b> <code>${componentName}</code>`,
    `🟢 <b>Status:</b> Telah pulih sepenuhnya`,
    `🕒 <b>Waktu:</b> ${timeStr}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join('\n');
}

// Kirim Alert Instan jika status berubah
async function evaluateInstantAlerts(diag) {
  const prev = state.previousComponentsStatus;
  const current = {
    web: diag.components.web.ok,
    catalog: diag.components.catalog.ok,
    db: diag.components.db.ok,
    userBot: diag.components.userBot.ok,
    wistapay: diag.components.wistapay.ok,
  };

  const now = Date.now();
  const alertCooldownMs = 15 * 60 * 1000; // Cooldown 15 menit agar tidak spam jika gangguan terus-menerus

  for (const [key, isOk] of Object.entries(current)) {
    const wasOk = prev[key];

    // Jika komponen sebelumnya normal lalu sekarang mati -> Kirim Alert
    if (wasOk === true && isOk === false) {
      const lastAlert = state.alertCooldowns.get(key) || 0;
      if (now - lastAlert > alertCooldownMs) {
        state.alertCooldowns.set(key, now);
        const compDetail = diag.components[key]?.message || 'Down / Error';
        const alertText = formatAlertMessage(key.toUpperCase(), compDetail);
        await sendTelegramAlert(alertText);

      }
    }

    // Jika komponen sebelumnya mati lalu sekarang sembuh -> Kirim Notif Recovery
    if (wasOk === false && isOk === true) {
      const recText = formatRecoveryMessage(key.toUpperCase());
      await sendTelegramAlert(recText);

    }
  }

  state.previousComponentsStatus = current;
}

// ==============================================================================
// 3. Telegram Long Polling untuk Command Interaktif
// ==============================================================================

async function pollTelegramUpdates() {
  if (!config.monitorBotToken) return;

  while (true) {
    try {
      const url = `https://api.telegram.org/bot${config.monitorBotToken}/getUpdates?offset=${state.pollingOffset}&timeout=25`;
      const res = await fetch(url, { signal: AbortSignal.timeout(35000) });
      const json = await res.json();

      if (json.ok && Array.isArray(json.result)) {
        for (const update of json.result) {
          state.pollingOffset = update.update_id + 1;
          await handleTelegramCommand(update);
        }
      }
    } catch (err) {
      // Tunggu 3 detik sebelum polling ulang jika ada gangguan jaringan
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function handleTelegramCommand(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  // Hanya layani owner atau jika belum dibatasi
  // Simpan ownerChatId otomatis jika belum terdaftar
  if (!config.ownerChatId) {
    config.ownerChatId = chatId;
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      console.log(`[CONFIG] ownerChatId otomatis disimpan: ${chatId}`);
    } catch {}
  } else if (chatId !== String(config.ownerChatId)) {
    await sendTelegramTo(chatId, '⛔ Akses ditolak. Bot watchdog ini khusus untuk pemilik sistem.');
    return;
  }

  const cmd = text.split(' ')[0].toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    const helpMsg = [
      `🛡️ <b>PojokAI Security Watchdog Aktif!</b>`,
      `Bot ini terhubung dan memantau Web PojokAI (https://pojokai.my.id) serta @pojokkai_bot secara berkala setiap ${config.intervalMinutes} menit.`,
      ``,
      `<b>Daftar Perintah:</b>`,
      `• <code>/status</code> atau <code>/cek</code> — Audit & periksa status seluruh sistem sekarang`,
      `• <code>/ping</code> — Cek latensi dan kecepatan respons bot`,
      `• <code>/report</code> — Ringkasan uptime & rekap insiden`,
      `• <code>/help</code> — Buka panduan ini`,
      ``,
      `⏳ <i>Menjalankan audit pertama sekarang...</i>`,
    ].join('\n');
    await sendTelegramTo(chatId, helpMsg);
    const diag = await runDiagnostic();
    const report = formatReportMessage(diag);
    await sendTelegramTo(chatId, report);
    return;
  }

  if (cmd === '/status' || cmd === '/cek') {
    await sendTelegramTo(chatId, '🔍 <i>Sedang menjalankan pemeriksaan diagnostik lengkap...</i>');
    const diag = await runDiagnostic();
    const report = formatReportMessage(diag);
    await sendTelegramTo(chatId, report);
    return;
  }

  if (cmd === '/ping') {
    const t0 = performance.now();
    await sendTelegramTo(chatId, `🏓 Pong! Latensi bot monitor: <code>${Math.round(performance.now() - t0)}ms</code>`);
    return;
  }

  if (cmd === '/report') {
    const uptimeStr = formatUptime(Date.now() - state.startedAt);
    const repMsg = [
      `📊 <b>RINGKASAN MONITORING WATCHDOG</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `• Uptime Bot: <code>${uptimeStr}</code>`,
      `• Total Pengecekan: <code>${state.checkCount} kali</code>`,
      `• Total Insiden/Bug Tertangkap: <code>${state.incidentsCount} kali</code>`,
      `• Interval Laporan Rutin: <code>${config.intervalMinutes} menit</code>`,
      `• Target Web: <code>${config.webUrl}</code>`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ].join('\n');
    await sendTelegramTo(chatId, repMsg);
    return;
  }
}

async function sendTelegramTo(chatId, text) {
  if (!config.monitorBotToken) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.monitorBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ==============================================================================
// 4. Main Scheduler Execution Loop
// ==============================================================================

async function executeCycle() {
  console.log(`\n[${getWibTime()}] Menjalankan pengecekan kesehatan berkala...`);
  try {
    const diag = await runDiagnostic();
    const reportText = formatReportMessage(diag);

    // Cetak ke terminal
    console.log('--- HASIL PENGECEKAN ---');
    console.log(`Status Keseluruhan: ${diag.isAllHealthy ? 'NORMAL' : 'ADA MASALAH'}`);
    console.log(`Web Frontend: ${diag.components.web.ok ? 'OK' : 'ERROR'} (${diag.components.web.latency}ms)`);
    console.log(`Katalog API: ${diag.components.catalog.ok ? 'OK' : 'ERROR'} (${diag.components.catalog.message})`);
    console.log(`Database: ${diag.components.db.ok ? 'OK' : 'ERROR'} (${diag.components.db.message})`);
    console.log(`User Bot: ${diag.components.userBot.ok ? 'OK' : 'ERROR'} (${diag.components.userBot.message})`);
    console.log(`Wistapay: ${diag.components.wistapay.ok ? 'OK' : 'ERROR'} (${diag.components.wistapay.message})`);
    if (diag.bugs.length > 0) {
      console.log('Detail Isu:', diag.bugs);
    }

    // Kirim notifikasi instan jika ada perubahan status
    await evaluateInstantAlerts(diag);

    // Update dashboard secara real-time pada 1 pesan (GIF merah di atas + caption di bawah)
    if (config.monitorBotToken) {
      const sent = await updateOrSendDashboard(reportText);
      if (sent) {
        console.log(`[DASHBOARD] Live update sukses (Pesan ID: ${config.lastMessageId})`);
      }
    } else {
      console.log(`[INFO] monitorBotToken belum diisi di monitor-config.json. Laporan hanya tampil di terminal.`);
    }
  } catch (err) {
    console.error('[ERROR CRITICAL]', err);
  }
}

async function main() {
  console.log('================================================================');
  console.log('       PojokAI Watchdog & Bug Monitor Bot (Live 5 Detik)        ');
  console.log('================================================================');
  console.log(`Web Target       : ${config.webUrl}`);
  console.log(`Interval Laporan : ${config.intervalSeconds || 5} detik`);
  console.log(`Owner Chat ID    : ${config.ownerChatId || '(Belum diset)'}`);
  console.log(`Dashboard Msg ID : ${config.lastMessageId || '(Baru)'}`);
  console.log(`Monitor Bot Token: ${config.monitorBotToken ? 'TERPASANG (Aktif)' : 'BELUM DIISI'}`);
  console.log('================================================================\n');

  if (!config.monitorBotToken) {
    console.log('👉 CARA AKTIFKAN PENGIRIMAN TELEGRAM OTOMATIS:');
    console.log('1. Buka @BotFather di Telegram');
    console.log('2. Ketik /newbot dan beri nama (contoh: PojokAI Monitor Bot)');
    console.log('3. Copy token bot yang diberikan');
    console.log('4. Buka file monitor-config.json dan paste token pada "monitorBotToken"');
    console.log('   (Atau jalankan: node monitor-bot.mjs --token <TOKEN_BOT_ANDA>)\n');
  }

  // 1. Jalankan pengecekan pertama kali sekarang
  await executeCycle();

  if (config.once) {
    console.log('\n[--once] Pengecekan diagnostik selesai. Keluar.');
    return;
  }
  const intervalMs = (config.intervalSeconds || 5) * 1000;
  setInterval(executeCycle, intervalMs);

  // 3. Jalankan listener command interaktif (Long Polling)
  if (config.monitorBotToken) {
    pollTelegramUpdates().catch((err) => {
      console.error('[POLLING FATAL]', err.message);
    });
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
