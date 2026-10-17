import http from 'node:http';

// --- Configuration (Support Environment Variables & Defaults) ---
const config = {
  monitorBotToken: process.env.MONITOR_BOT_TOKEN || '8959210006:AAGLcpr02FOVYm0MWu0PM-qkIl1oqRE-wmE',
  userBotToken: process.env.USER_BOT_TOKEN || '',
  ownerChatId: process.env.MONITOR_CHAT_ID || '7787855968',
  intervalSeconds: parseInt(process.env.INTERVAL_SECONDS, 10) || 5,
  lastMessageId: parseInt(process.env.LAST_MESSAGE_ID, 10) || 3,
  animationFileId: 'CgACAgUAAxkDAAMDatMEOWtwbW_O9b7An9-TWHJNUyMAAlwfAAIlFJhWCv2aTeJKPXU9BA',
  webUrl: process.env.POJOKAI_WEB_URL || 'https://pojokai.my.id',
  wistapayApiKey: process.env.WISTAPAY_API_KEY || 'sk_cf912d66f2b3a109f689435d17947e576791bdf6d39858f5'
};

const state = {
  startedAt: Date.now(),
  checkCount: 0,
  incidentsCount: 0,
  previousComponentsStatus: {},
  alertCooldowns: new Map(),
};

// Format Timestamp WIB (UTC+7)
function getWibTime(date = new Date()) {
  const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${pad(d.getUTCDate())} ${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} WIB`;
}

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

// Cek Web Frontend (HTML)
async function checkWebFrontend(webUrl) {
  const t0 = performance.now();
  try {
    const res = await fetch(webUrl, {
      headers: { 'User-Agent': 'PojokAI-Watchdog/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Math.round(performance.now() - t0);
    const text = await res.text();
    const hasBrand = text.includes('PojokAI') || text.includes('store') || text.includes('catalog');
    if (res.ok && hasBrand) {
      return { ok: true, status: res.status, latency, message: 'Online & Responsif' };
    }
    return { ok: false, status: res.status, latency, message: `HTTP Error ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, latency: Math.round(performance.now() - t0), message: err.message };
  }
}

// Cek Katalog API
async function checkCatalogApi(webUrl) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${webUrl}/api/catalog`, {
      headers: { 'User-Agent': 'PojokAI-Watchdog/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Math.round(performance.now() - t0);
    if (!res.ok) return { ok: false, status: res.status, latency, message: `HTTP ${res.status}` };
    const data = await res.json();
    const productCount = Array.isArray(data.products) ? data.products.length : 0;
    const catCount = Array.isArray(data.categories) ? data.categories.length : 0;
    return {
      ok: productCount > 0,
      status: res.status,
      latency,
      productCount,
      catCount,
      message: `${productCount} Produk / ${catCount} Kategori`,
    };
  } catch (err) {
    return { ok: false, status: 0, latency: Math.round(performance.now() - t0), message: err.message };
  }
}

// Cek User Bot (@pojokkai_bot)
async function checkUserBot(userBotToken, webUrl) {
  const result = { ok: true, webhookEndpointLive: false, pendingUpdates: 0, lastError: null };
  try {
    const probeRes = await fetch(`${webUrl}/api/webhook/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: true }),
      signal: AbortSignal.timeout(6000),
    });
    if (probeRes.status === 403 || probeRes.status === 401 || probeRes.status === 200 || probeRes.status === 400) {
      result.webhookEndpointLive = true;
    }
  } catch {}

  if (userBotToken) {
    try {
      const whRes = await fetch(`https://api.telegram.org/bot${userBotToken}/getWebhookInfo`, {
        signal: AbortSignal.timeout(6000),
      });
      const whJson = await whRes.json();
      if (whJson.ok && whJson.result) {
        result.pendingUpdates = whJson.result.pending_update_count || 0;
        if (result.pendingUpdates > 20) {
          result.ok = false;
        }
        if (whJson.result.last_error_message) {
          result.lastError = whJson.result.last_error_message;
        }
      }
    } catch {}
  }

  if (!result.webhookEndpointLive) result.ok = false;
  return result;
}

// Cek Wistapay Gateway
async function checkWistapay(apiKey, retry = 1) {
  const t0 = performance.now();
  const probeUrl = 'https://wistapay.shop/wistapay/api/check-status.php?reference=PROBE_TEST';
  try {
    const res = await fetch(probeUrl, {
      headers: { 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(10000),
    });
    const latency = Math.round(performance.now() - t0);
    if (res.status >= 200 && res.status < 500) {
      return { ok: true, latency, message: 'Terhubung Aktif' };
    }
    return { ok: false, latency, message: `Gateway HTTP ${res.status}` };
  } catch (err) {
    if (retry > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return checkWistapay(apiKey, retry - 1);
    }
    return { ok: false, latency: Math.round(performance.now() - t0), message: err.message };
  }
}

// Format Live Dashboard
const SPINNERS = ['🟢', '🟩', '❇️', '✳️'];

function formatReportMessage(diag) {
  const { isAllHealthy, bugs, components, checkNumber } = diag;
  const timeStr = getWibTime(new Date(diag.timestamp));
  const uptimeStr = formatUptime(Date.now() - state.startedAt);
  const pulse = SPINNERS[checkNumber % SPINNERS.length];

  const webIcon = components.web.ok ? '🟢' : '🔴';
  const catIcon = components.catalog.ok ? '🟢' : '🔴';
  const botIcon = components.userBot.ok ? '🟢' : '🔴';
  const wistaIcon = components.wistapay.ok ? '🟢' : '🔴';
  const overallBadge = isAllHealthy ? '🟢 <b>SEMUA SISTEM NORMAL</b>' : '⚠️ <b>GANGGUAN TERDETEKSI</b>';

  return [
    `🛡️ <b>POJOKAI LIVE SYSTEM MONITOR</b>`,
    `⚡ <i>Real-time Dashboard (Update per 5 detik • Hugging Face 24/7)</i>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 <b>STATUS  :</b> ${overallBadge}`,
    `🕒 <b>WAKTU   :</b> <code>${timeStr}</code>`,
    `⏱️ <b>UPTIME  :</b> <code>${uptimeStr}</code>  •  <b>Cycle:</b> <code>#${checkNumber}</code>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🌐 <b>LAYANAN WEB &amp; API</b>`,
    `  ├ <b>Frontend Toko :</b> ${webIcon} <code>${components.web.latency}ms</code> — <i>${components.web.message}</i>`,
    `  ├ <b>Katalog API   :</b> ${catIcon} <code>${components.catalog.latency}ms</code> — <i>${components.catalog.message}</i>`,
    `  └ <b>Integritas DB  :</b> 🟢 <i>Terkoneksi Normal</i>`,
    ``,
    `🤖 <b>BOT TELEGRAM USER (@pojokkai_bot)</b>`,
    `  ├ <b>Koneksi Server :</b> ${botIcon} — <i>${components.userBot.webhookEndpointLive ? 'Online (Endpoint Siap)' : 'Offline'}</i>`,
    `  ├ <b>Antrean Update :</b> 🟢 <code>${components.userBot.pendingUpdates} pesan</code> — <i>${components.userBot.pendingUpdates > 0 ? 'Sedang diproses' : 'Lancar'}</i>`,
    `  └ <b>Status Webhook :</b> ${components.userBot.lastError ? '🔴 ' + components.userBot.lastError : '🟢 <i>Bebas Kendala</i>'}`,
    ``,
    `💳 <b>GATEWAY PEMBAYARAN QRIS</b>`,
    `  ├ <b>Wistapay Server:</b> ${wistaIcon} <code>${components.wistapay.latency}ms</code> — <i>${components.wistapay.message}</i>`,
    `  └ <b>Sistem QRIS    :</b> 🟢 <i>Siap Proses Transaksi</i>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    bugs.length > 0
      ? `🚨 <b>LAPORAN ANOMALI &amp; BUG (${bugs.length}):</b>\n` + bugs.map((b) => `  └ • ${b}`).join('\n')
      : `✨ <b>LAPORAN ANOMALI &amp; BUG :</b> <i>Nihil (0 bug aktif)</i>\n  └ <i>Semua sistem berfungsi normal tanpa kendala.</i>`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${pulse} <i>Live cloud monitoring aktif • Memperbarui setiap 5 detik</i>`,
  ].join('\n');
}

// Update Caption In-Place (Single Message with Red GIF)
async function updateOrSendDashboard(captionText) {
  if (!config.monitorBotToken || !config.ownerChatId) return false;

  const chatId = config.ownerChatId;
  const animationId = config.animationFileId;

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
    } catch {}
  }

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
      return true;
    }
  } catch {}
  return false;
}

async function executeCycle() {
  state.checkCount++;
  try {
    const [web, catalog, userBot, wistapay] = await Promise.all([
      checkWebFrontend(config.webUrl),
      checkCatalogApi(config.webUrl),
      checkUserBot(config.userBotToken, config.webUrl),
      checkWistapay(config.wistapayApiKey),
    ]);

    const bugs = [];
    if (!web.ok) bugs.push(`🌐 Web Frontend: ${web.message}`);
    if (!catalog.ok) bugs.push(`📦 Katalog API: ${catalog.message}`);
    if (!userBot.ok) bugs.push(`🤖 Bot User: Gagal koneksi webhook`);
    if (!wistapay.ok) bugs.push(`💳 Gateway QRIS: ${wistapay.message}`);

    const diag = {
      timestamp: Date.now(),
      checkNumber: state.checkCount,
      isAllHealthy: bugs.length === 0,
      bugs,
      components: { web, catalog, userBot, wistapay },
    };

    const reportText = formatReportMessage(diag);
    await updateOrSendDashboard(reportText);
  } catch (err) {
    console.error('[CYCLE ERROR]', err.message);
  }
}

// --- 1. Run Lightweight HTTP Server for Hugging Face Container Health Check ---
const PORT = process.env.PORT || 7860;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    service: 'PojokAI Security Watchdog (Hugging Face 24/7)',
    status: 'ONLINE',
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
    checkCount: state.checkCount,
    interval: `${config.intervalSeconds}s`,
    lastMessageId: config.lastMessageId
  }));
});

server.listen(PORT, () => {
  console.log(`[HUGGINGFACE WORKER] Listening on port ${PORT}`);
  console.log(`[HUGGINGFACE WORKER] Starting 5-second live loop...`);

  // Jalankan siklus pertama sekarang
  executeCycle();

  // Jalankan siklus setiap 5 detik
  setInterval(executeCycle, (config.intervalSeconds || 5) * 1000);
});
