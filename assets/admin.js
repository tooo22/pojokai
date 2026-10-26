/* Panel owner — menempel di index.html, bicara ke server.mjs lewat /api. */
const $ = (s, r = document) => r.querySelector(s);
const icons = () => window.lucide?.createIcons();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN_KEY = 'wk:owner:token';

function getStoredToken() {
  const local = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('wk_token');
  if (local) return local;
  const cookieMatch = document.cookie.match(/(?:^|;\s*)wk_token=([A-Za-z0-9._-]+)/);
  return cookieMatch ? cookieMatch[1] : '';
}

let token = getStoredToken();
let owner = null;
let needsSetup = false;
let catalog = null;
let adminView = localStorage.getItem('wk:owner:view') || 'grid';
let chip = 'all';

const open = new Set();
const armed = new Set();

const UNLIM = 999999;
const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const isOos = (p) => (p.variants || []).length > 0 && p.variants.every((v) => v.stock <= 0);
const minPrice = (p) => (p.variants || []).reduce((m, v) => (m === null || v.price < m ? v.price : m), null);
const stockText = (p) => {
  const vs = p.variants || [];
  if (!vs.length) return 'tanpa paket';
  if (vs.some((v) => v.stock === UNLIM)) return 'stok tak terbatas';
  const t = vs.reduce((s, v) => s + Math.max(0, v.stock || 0), 0);
  return t ? `stok ${t}` : 'stok habis';
};

async function api(method, path, body) {
  token = getStoredToken();
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* respons kosong */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/session' && path !== '/api/login' && path !== '/api/oauth/verify') {
      forgetSession();
      openAuth();
    }
    throw Object.assign(new Error(data.error || 'Gagal terhubung ke server'), { status: res.status });
  }
  return data;
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'card pointer-events-auto px-3.5 py-2 text-[13px] font-semibold rounded-xl shadow-md ' +
    (kind === 'err' ? 'text-danger border-danger/30' : 'text-success border-success/30');
  el.textContent = msg;
  $('#aToast').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------- buka/tutup panel ---------- */

function setLabel() {
  $('#masukLabel').textContent = owner ? 'Panel' : 'Masuk';
  $('#masukBtn').setAttribute('aria-label', owner ? 'Buka panel owner' : 'Masuk sebagai owner');
  const navLogout = $('#navLogoutBtn');
  if (navLogout) {
    if (owner) {
      navLogout.classList.remove('hidden');
      navLogout.classList.add('inline-flex');
      navLogout.title = `Keluar (${owner.email || 'Owner'})`;
    } else {
      const buyer = typeof window.getStoredBuyer === 'function' ? window.getStoredBuyer() : null;
      if (!buyer) {
        navLogout.classList.add('hidden');
        navLogout.classList.remove('inline-flex');
      }
    }
  }
  if (!owner && typeof window.updateBuyerNav === 'function') window.updateBuyerNav();
}

function setPanel(on) {
  document.body.classList.toggle('admin-on', on);
  document.documentElement.classList.toggle('preload-admin', on);
  $('#admin').classList.toggle('hidden', !on);
  const navBack = $('#navBackBtn');
  if (navBack) {
    navBack.classList.toggle('hidden', !on);
    navBack.classList.toggle('inline-flex', on);
  }
  if (on) {
    localStorage.setItem('wk:admin_active', '1');
    if (location.pathname !== '/admin') history.replaceState(null, '', '/admin');
  } else {
    localStorage.setItem('wk:admin_active', '0');
    if (location.pathname === '/admin') history.replaceState(null, '', '/');
  }
  window.scrollTo({ top: 0 });
  icons();
}

async function openPanel() {
  token = getStoredToken();
  localStorage.setItem('wk:admin_active', '1');
  closeADialog();
  const modal = $('#modal');
  if (modal) {
    modal.classList.replace('flex', 'hidden');
    document.documentElement.style.overflow = '';
  }
  setPanel(true);
  await reload();
}
window.openOwnerAuth = openAuth;
window.openOwnerPanel = openPanel;
$('#masukBtn').addEventListener('click', (e) => {
  if (owner) {
    e.stopImmediatePropagation();
    openPanel();
  }
});
$('#aExit').addEventListener('click', () => setPanel(false));
$('#aDownloadDb')?.addEventListener('click', async () => {
  try {
    toast('Menyiapkan berkas data db.json…');
    const fullCatalog = await api('GET', '/api/catalog');
    const currentOrders = [];
    try { const oRes = await api('GET', '/api/orders'); if (oRes.orders) currentOrders.push(...oRes.orders); } catch {}

    const exportData = {
      wa: fullCatalog.wa || '6283171982973',
      categories: fullCatalog.categories || [],
      hero: fullCatalog.hero || [],
      faqs: fullCatalog.faqs || [],
      ticker: fullCatalog.ticker || [],
      bundle: fullCatalog.bundle || null,
      products: catalog?.products || fullCatalog.products || [],
      owners: [{ email: owner?.email || '3t.ardiansyah@gmail.com', role: 'owner' }],
      sessions: [],
      orders: currentOrders
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'db.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    toast('Berhasil mengunduh db.json!');
  } catch (err) {
    toast('Gagal mengunduh: ' + err.message, 'err');
  }
});
$('#navBackBtn')?.addEventListener('click', () => setPanel(false));
$('#aBackBtn')?.addEventListener('click', () => setPanel(false));
async function doOwnerLogout() {
  try { await api('POST', '/api/logout', {}); } catch { /* sesi sudah hilang */ }
  forgetSession();
  setPanel(false);
  await window.wk?.refresh();
  toast('Sesi owner ditutup.');
}
$('#aLogout')?.addEventListener('click', doOwnerLogout);
$('#aTopLogoutBtn')?.addEventListener('click', doOwnerLogout);
window.ownerLogout = doOwnerLogout;
window.isOwnerActive = () => Boolean(owner);

function forgetSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem('wk_token');
  localStorage.removeItem('wk:admin_active');
  document.documentElement.classList.remove('preload-admin');
  document.cookie = 'wk_token=; Path=/; Max-Age=0; SameSite=Lax';
  token = ''; owner = null; catalog = null;
  setLabel();
}

/* ---------- login / setup (modal) ---------- */

function decodeGoogleJwt(token) {
  try {
    const part = token.split('.')[1];
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const jsonStr = decodeURIComponent(atob(b64).replace(/(.)/g, (_, c) => {
      let h = c.charCodeAt(0).toString(16).toUpperCase();
      if (h.length < 2) h = '0' + h;
      return '%' + h;
    }));
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

const GOOGLE_CLIENT_ID = '882960778924-qnagvcduvc341a89bh7v8af2h3dbhhtg.apps.googleusercontent.com';

function openAuth() {
  const setup = needsSetup;
  openADialog(`<form id="aAuth" class="p-5 space-y-4">
    <div class="flex items-center justify-between pb-3 border-b border-line-soft">
      <div class="flex items-center gap-2.5">
        <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Kembali" aria-label="Kembali"><i data-lucide="arrow-left" class="size-4"></i></button>
        <div class="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <i data-lucide="${setup ? 'user-plus' : 'shield-check'}" class="size-5"></i>
        </div>
        <div>
          <h2 class="text-base font-bold">${setup ? 'Buat Akun Owner' : 'Masuk Panel Owner'}</h2>
          <p class="text-[12px] text-subtle">${setup ? 'Buat akun awal untuk mengendalikan katalog toko.' : 'Kelola katalog, harga & varian produk.'}</p>
        </div>
      </div>
      <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Tutup" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>

    <!-- OAuth Login Options -->
    <div class="space-y-2 pt-1">
      <p class="text-[11px] font-semibold text-subtle uppercase tracking-wider">Login Cepat dengan OAuth</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" id="aOAuthGoogle" class="group inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-main transition hover:bg-surface-2 hover:border-primary/50 shadow-2xs cursor-pointer">
          <svg class="size-4 shrink-0" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.1-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.1c0 2.8.7 5.4 1.9 7.8l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.2 7.5 23.5 12 23.5z"/></svg>
          <span>Google</span>
        </button>
        <button type="button" id="aOAuthGithub" class="group inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-main transition hover:bg-surface-2 hover:border-primary/50 shadow-2xs cursor-pointer">
          <svg class="size-4 shrink-0 fill-current" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          <span>GitHub</span>
        </button>
      </div>
    </div>

    <div class="relative flex items-center justify-center">
      <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-line-soft"></div></div>
      <div class="relative bg-surface px-2 text-[11px] font-medium uppercase tracking-wider text-subtle">atau dengan email & password</div>
    </div>

    <div class="space-y-3">
      <label class="block text-[13px] font-semibold">Username atau Email
        <input id="aEmail" class="input mt-1 h-10 w-full rounded-xl" type="text" required autocomplete="username" placeholder="tittoganteng atau 3t.ardiansyah@gmail.com" value="tittoganteng"></label>
      <label class="block text-[13px] font-semibold">Password
        <input id="aPass" class="input mt-1 h-10 w-full rounded-xl" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}" placeholder="••••••••"></label>
      ${setup ? `<label class="block text-[13px] font-semibold">Ulangi password
        <input id="aPass2" class="input mt-1 h-10 w-full rounded-xl" type="password" required autocomplete="new-password"></label>` : ''}
    </div>
    <p id="aErr" class="hidden text-xs text-danger font-medium"></p>
    <div class="flex items-center justify-end gap-2 pt-3 border-t border-line-soft">
      <button type="button" class="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold text-main transition hover:bg-surface-2 cursor-pointer" data-aclose>Batal</button>
      <button type="submit" class="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-[13px] font-bold text-primary-fg shadow-sm transition hover:opacity-90 cursor-pointer">${setup ? 'Buat Akun' : 'Masuk'}</button>
    </div>
  </form>`);

  function finishAuth(data) {
    token = data.token;
    owner = data.owner;
    needsSetup = false;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem('wk_token', token);
    document.cookie = `wk_token=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`;
    setLabel();
    closeADialog();
    openPanel();
    toast('Berhasil masuk via ' + (data.provider ? data.provider + ' OAuth' : 'akun owner') + ': ' + owner.email);
  }

  // Initialize Google GIS OAuth
  if (window.google?.accounts?.id) {
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          try {
            if (!resp || !resp.credential) return;
            const data = await api('POST', '/api/oauth/verify', {
              provider: 'google',
              idToken: resp.credential,
            });
            finishAuth(data);
          } catch (err) {
            authError(err.message);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.prompt();
    } catch (e) {
      console.warn('[GSI] init error:', e);
    }
  }

  // OAuth Google Handler
  $('#aOAuthGoogle').addEventListener('click', async () => {
    try {
      if (window.google?.accounts?.oauth2) {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'email profile openid',
          callback: async (resp) => {
            if (resp?.error) {
              authError('Login Google dibatalkan atau gagal: ' + resp.error);
              return;
            }
            if (!resp || !resp.access_token) return;
            try {
              const data = await api('POST', '/api/oauth/verify', {
                provider: 'google',
                accessToken: resp.access_token,
              });
              finishAuth(data);
            } catch (err) {
              authError(err.message);
            }
          },
        });
        tokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      }

      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (resp) => {
            try {
              if (!resp || !resp.credential) return;
              const data = await api('POST', '/api/oauth/verify', {
                provider: 'google',
                idToken: resp.credential,
              });
              finishAuth(data);
            } catch (err) {
              authError(err.message);
            }
          },
        });
        window.google.accounts.id.prompt();
        return;
      }

      authError('Google Sign-In tidak dapat dimuat di browser ini. Silakan masuk menggunakan Email & Password.');
    } catch (err) {
      authError(err.message);
    }
  });

  // OAuth GitHub Handler
  $('#aOAuthGithub').addEventListener('click', async () => {
    try {
      let cfg = { githubClientId: '' };
      try { cfg = await api('GET', '/api/oauth/config'); } catch {}

      if (cfg.githubClientId) {
        const redirectUri = encodeURIComponent(window.location.origin + '/admin');
        window.location.href = `https://github.com/login/oauth/authorize?client_id=${cfg.githubClientId}&scope=user:email&redirect_uri=${redirectUri}`;
        return;
      }
      authError('GitHub OAuth belum dikonfigurasi. Silakan masuk menggunakan Email & Password.');
    } catch (err) {
      authError(err.message);
    }
  });

  $('#aAuth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#aEmail').value.trim();
    const pass = $('#aPass').value;
    if (setup && pass !== $('#aPass2').value) return authError('Password ulangnya beda.');
    try {
      const data = await api('POST', setup ? '/api/setup' : '/api/login', { username: email, email, password: pass });
      finishAuth(data);
    } catch (e2) {
      authError(e2.message || 'Username/email atau password salah');
    }
  });
}

function authError(msg) {
  const el = $('#aErr');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ---------- modal ---------- */

function openADialog(html) {
  $('#aDialog').innerHTML = html;
  const am = $('#aModal');
  if (am) {
    am.classList.remove('hidden');
    am.classList.add('flex');
  }
  document.documentElement.style.overflow = 'hidden';
  icons();
  setTimeout(() => {
    const first = $('#aDialog input:not([type=hidden]):not([disabled]), #aDialog select, #aDialog textarea');
    if (first) first.focus({ preventScroll: true });
    else $('#aDialog').focus({ preventScroll: true });
  }, 40);
}
function closeADialog() {
  const am = $('#aModal');
  if (am) {
    am.classList.add('hidden');
    am.classList.remove('flex');
  }
  $('#aDialog').innerHTML = '';
  document.documentElement.style.overflow = '';
}

let isBackdropClick = false;
$('#aModal').addEventListener('mousedown', (e) => {
  isBackdropClick = (e.target.id === 'aModal');
});
$('#aModal').addEventListener('mouseup', (e) => {
  if (isBackdropClick && e.target.id === 'aModal') {
    // Jangan tutup modal edit produk saat klik backdrop tidak sengaja agar data tidak hilang
    if ($('#aMeta')) {
      isBackdropClick = false;
      return;
    }
    closeADialog();
  }
  isBackdropClick = false;
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-aclose]')) closeADialog(); });

/* ---------- katalog ---------- */

async function reload() {
  catalog = await api('GET', '/api/catalog');
  if (token && owner && catalog?.products) {
    try {
      localStorage.setItem('wk:custom_products', JSON.stringify(catalog.products));
    } catch {}
  }

  $('#aOwner').textContent = catalog.owner?.email || owner?.email || 'Owner';
  if ($('#aWaDisplay')) $('#aWaDisplay').textContent = catalog.wa ? 'WA: ' + catalog.wa : 'WhatsApp';
  const sel = $('#aCat');
  if (sel && (!sel.options.length || sel.options.length === 1)) {
    sel.innerHTML = '<option value="">Semua kategori</option>' +
      catalog.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('');
  }
  render();
  await reloadOrders();
}

const visible = () => {
  const q = ($('#aQ')?.value || '').trim().toLowerCase();
  const cat = $('#aCat')?.value || '';
  return catalog.products.filter((p) =>
    (!cat || p.cat === cat) &&
    (!q || p.name.toLowerCase().includes(q) || p.slug.includes(q)) &&
    (chip === 'all' || (chip === 'hidden' ? p.hidden : chip === 'oos' ? isOos(p) : chip === 'active' ? (!p.hidden && !isOos(p)) : true)));
};

const bySlug = (slug) => catalog.products.find((p) => p.slug === slug);

const CELL = 'flex min-w-0 flex-col gap-1';
const CAP = 'text-[10px] font-semibold uppercase tracking-wide text-subtle sm:hidden';

/* Baris varian untuk Grid View */
function variantGridRow(v, vi) {
  const unlim = v.stock === UNLIM;
  return `<div class="a-row rounded-xl bg-surface border border-line-soft p-2.5 space-y-2 shadow-xs" data-row="${vi}">
    <div class="flex items-center justify-between gap-1.5">
      <input class="input h-8 min-w-0 flex-1 text-[13px] font-medium rounded-lg" data-k="label" value="${esc(v.label)}" placeholder="Nama paket" aria-label="Nama paket">
      <button class="a-ico size-8 rounded-lg text-danger hover:bg-danger/10" data-act="drop-variant" title="Hapus paket" aria-label="Hapus paket"><i data-lucide="x" class="size-3.5"></i></button>
    </div>
    <div class="grid grid-cols-2 gap-1.5">
      <div>
        <span class="text-[10px] font-semibold text-subtle block mb-0.5">Harga</span>
        <input class="input h-8 w-full text-right text-[12px] font-bold rounded-lg" data-k="price" type="number" min="1" step="1" value="${v.price}">
      </div>
      <div>
        <span class="text-[10px] font-semibold text-subtle block mb-0.5">Coret</span>
        <input class="input h-8 w-full text-right text-[12px] text-muted rounded-lg" data-k="strike" type="number" min="0" step="1" value="${v.strike || ''}" placeholder="—">
      </div>
    </div>
    <div class="grid grid-cols-2 gap-1.5 items-end">
      <div>
        <div class="flex items-center justify-between mb-0.5">
          <span class="text-[10px] font-semibold text-subtle">Stok</span>
          <label class="inline-flex items-center gap-1 text-[10px] text-muted cursor-pointer" title="Stok tak terbatas">
            <input type="checkbox" class="size-3 rounded" data-k="unlim"${unlim ? ' checked' : ''}>
            <span>∞</span>
          </label>
        </div>
        <input class="input h-8 w-full text-right text-[12px] rounded-lg" data-k="stock" type="number" min="0" step="1" value="${unlim ? '' : v.stock}" placeholder="∞"${unlim ? ' disabled' : ''}>
      </div>
      <div>
        <span class="text-[10px] font-semibold text-subtle block mb-0.5">Kirim</span>
        <select class="input h-8 w-full text-[12px] rounded-lg" data-k="ful">
          <option value="auto"${v.ful === 'auto' ? ' selected' : ''}>Otomatis</option>
          <option value="manual"${v.ful !== 'auto' ? ' selected' : ''}>Manual</option>
        </select>
      </div>
    </div>
  </div>`;
}

/* Baris varian untuk List View */
const LIST_ROW_GRID = 'a-row grid grid-cols-2 items-end gap-2 rounded-xl bg-surface border border-line-soft p-2.5 sm:grid-cols-[minmax(0,1fr)_110px_96px_120px_110px] sm:items-center sm:gap-2';

function variantListRow(v, vi) {
  const unlim = v.stock === UNLIM;
  return `<div class="${LIST_ROW_GRID}" data-row="${vi}">
    <div class="${CELL} col-span-2 sm:col-span-1">
      <span class="${CAP}">Paket</span>
      <div class="flex items-center gap-1.5">
        <input class="input h-8 min-w-0 flex-1 text-[13px] rounded-lg" data-k="label" value="${esc(v.label)}" aria-label="Nama paket">
        <button class="a-ico size-8 rounded-lg text-danger hover:bg-danger/10" data-act="drop-variant" title="Hapus paket" aria-label="Hapus paket"><i data-lucide="x" class="size-3.5"></i></button>
      </div>
    </div>
    <label class="${CELL}">
      <span class="${CAP}">Harga</span>
      <input class="input h-8 text-right text-[13px] font-semibold rounded-lg" data-k="price" type="number" min="1" step="1" value="${v.price}" aria-label="Harga">
    </label>
    <label class="${CELL}">
      <span class="${CAP}">Coret</span>
      <input class="input h-8 text-right text-[13px] text-muted rounded-lg" data-k="strike" type="number" min="0" step="1" value="${v.strike || ''}" placeholder="—" aria-label="Harga coret">
    </label>
    <label class="${CELL}">
      <span class="${CAP}">Stok</span>
      <div class="flex items-center gap-1.5">
        <input class="input h-8 min-w-0 flex-1 text-right text-[13px] rounded-lg" data-k="stock" type="number" min="0" step="1" value="${unlim ? '' : v.stock}" placeholder="∞" aria-label="Stok"${unlim ? ' disabled' : ''}>
        <input class="size-3.5 shrink-0 rounded" data-k="unlim" type="checkbox"${unlim ? ' checked' : ''} title="Stok tak terbatas" aria-label="Stok tak terbatas">
      </div>
    </label>
    <label class="${CELL}">
      <span class="${CAP}">Kirim</span>
      <select class="input h-8 text-[12px] rounded-lg" data-k="ful" aria-label="Pengiriman">
        <option value="auto"${v.ful === 'auto' ? ' selected' : ''}>Otomatis</option>
        <option value="manual"${v.ful !== 'auto' ? ' selected' : ''}>Manual</option>
      </select>
    </label>
  </div>`;
}

const rowHead = () => `<div class="${LIST_ROW_GRID} hidden sm:grid">${[['Paket', ''], ['Harga', 'text-right'], ['Coret', 'text-right'], ['Stok', 'text-right sm:mr-2'], ['Kirim', '']]
  .map(([t, x]) => `<span class="text-[10px] font-semibold uppercase tracking-wide text-subtle${x ? ' ' + x : ''}">${t}</span>`).join('')}</div>`;

function headInner(p) {
  const list = p.variants || [];
  const isOpen = open.has(p.slug);
  const isArmed = armed.has(p.slug);
  const lowest = minPrice(p);
  const oos = isOos(p);
  return `<button class="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer" data-act="toggle-open" aria-expanded="${isOpen}">
    <span class="relative size-12 shrink-0 rounded-2xl overflow-hidden bg-surface-2 border border-line-soft grid place-items-center shadow-xs">
      <span class="text-sm font-bold text-muted">${esc(p.name.slice(0, 1))}</span>
      <img src="${esc(p.image || `assets/products/${p.slug}.webp`)}" alt="" class="absolute inset-0 size-full object-cover" loading="lazy" onerror="this.remove()">
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5 flex-wrap">
        <span class="truncate text-[14px] font-bold text-main">${esc(p.name)}</span>
        <span class="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-subtle border border-line-soft">${esc(p.cat)}</span>
        ${p.hidden ? '<span class="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning border border-warning/20">Sembunyi</span>' : ''}
        ${oos ? '<span class="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger border border-danger/20">Habis</span>' : '<span class="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success border border-success/20">Aktif</span>'}
      </span>
      <span class="block truncate text-[11px] text-subtle mt-0.5">${list.length} paket varian · ${stockText(p)} · ${p.sold ?? 0} terjual</span>
    </span>
    <i data-lucide="chevron-down" class="size-4 shrink-0 text-muted transition-transform duration-200 mr-2${isOpen ? ' rotate-180' : ''}"></i>
  </button>
  ${lowest === null ? '' : `<div class="hidden sm:block w-32 shrink-0 text-right pr-2">
    <span class="block text-[13px] font-extrabold tabular-nums text-main">${rp(lowest)}</span>
    <span class="block text-[10px] uppercase tracking-wide text-subtle">mulai dari</span>
  </div>`}
  <div class="flex shrink-0 items-center gap-1">
    <button class="a-ico size-8 rounded-xl" data-act="toggle-hide" title="${p.hidden ? 'Tampilkan di toko' : 'Sembunyikan dari toko'}" aria-label="${p.hidden ? 'Tampilkan di toko' : 'Sembunyikan dari toko'}"><i data-lucide="${p.hidden ? 'eye' : 'eye-off'}" class="size-4"></i></button>
    <button class="a-ico size-8 rounded-xl" data-act="edit-meta" title="Edit detail produk" aria-label="Edit detail produk"><i data-lucide="pencil" class="size-4"></i></button>
    ${isArmed
      ? `<button class="h-8 shrink-0 rounded-xl bg-danger px-2.5 text-[11px] font-bold text-white transition hover:bg-danger/85" data-act="delete-confirm">Hapus!</button>
         <button class="a-ico size-8 rounded-xl" data-act="delete-cancel" title="Batal hapus" aria-label="Batal hapus"><i data-lucide="x" class="size-4"></i></button>`
      : '<button class="a-ico size-8 rounded-xl text-danger hover:bg-danger/10" data-act="delete" title="Hapus produk" aria-label="Hapus produk"><i data-lucide="trash-2" class="size-4"></i></button>'}
  </div>`;
}

/* Card view produk (Grid View) */
function gridProductCard(p) {
  const list = p.variants || [];
  const isOpen = open.has(p.slug);
  const isArmed = armed.has(p.slug);
  const lowest = minPrice(p);
  const oos = isOos(p);

  return `<article class="card a-card relative flex flex-col rounded-[20px] border border-line bg-surface overflow-hidden shadow-xs" data-slug="${esc(p.slug)}">
    ${isArmed ? '<div class="bg-danger/15 border-b border-danger/20 px-3.5 py-2 text-[12px] font-semibold text-danger flex items-center gap-1.5"><i data-lucide="alert-octagon" class="size-4 shrink-0"></i>Hapus permanen produk ini dan seluruh variannya?</div>' : ''}
    
    <!-- Top Header -->
    <div class="p-4 pb-3 flex items-start gap-3">
      <div class="relative size-12 shrink-0 rounded-2xl overflow-hidden bg-surface-2 border border-line-soft grid place-items-center shadow-xs">
        <span class="text-sm font-bold text-muted">${esc(p.name.slice(0, 1))}</span>
        <img src="${esc(p.image || `assets/products/${p.slug}.webp`)}" alt="" class="absolute inset-0 size-full object-cover" loading="lazy" onerror="this.remove()">
      </div>
      <div class="min-w-0 flex-1">
        <div class="a-status-badges flex items-center gap-1.5 flex-wrap">
          <span class="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-subtle border border-line-soft">${esc(p.cat)}</span>
          ${p.hidden ? '<span class="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning border border-warning/20">Sembunyi</span>' : ''}
          ${oos ? '<span class="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger border border-danger/20">Habis</span>' : '<span class="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success border border-success/20">Aktif</span>'}
        </div>
        <h3 class="mt-1 text-[14px] font-bold tracking-tight text-main truncate" title="${esc(p.name)}">${esc(p.name)}</h3>
        <p class="text-[11px] text-subtle truncate">${esc((p.brief && p.brief[0]) || p.desc || p.slug)}</p>
      </div>
    </div>

    <!-- Ringkasan Harga & Stok -->
    <div class="mx-4 mb-3 rounded-xl bg-surface-2/60 border border-line-soft px-3 py-2 flex items-center justify-between text-xs">
      <div>
        <span class="text-[10px] uppercase font-semibold text-subtle block">Harga Mulai</span>
        <span class="a-price-val font-extrabold tabular-nums text-[13px] text-main">${lowest === null ? '—' : rp(lowest)}</span>
      </div>
      <div class="text-right">
        <span class="text-[10px] uppercase font-semibold text-subtle block">Stok & Terjual</span>
        <span class="a-stock-val text-[11px] text-muted font-medium">${stockText(p)} · <b class="text-main font-semibold">${p.sold ?? 0}</b> terjual</span>
      </div>
    </div>

    <!-- Varian Preview & Accordion Button -->
    <div class="px-4 pb-3 flex-1 flex flex-col justify-between">
      <div class="flex items-center justify-between text-xs mb-1.5">
        <span class="text-[11px] font-semibold text-muted flex items-center gap-1">
          <i data-lucide="layers" class="size-3.5"></i>${list.length} Varian Paket
        </span>
        <button type="button" class="text-[11px] font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer" data-act="toggle-open">
          <span>${isOpen ? 'Tutup Paket' : 'Kelola Paket'}</span>
          <i data-lucide="chevron-down" class="size-3.5 transition-transform duration-200${isOpen ? ' rotate-180' : ''}"></i>
        </button>
      </div>
      <div class="flex flex-wrap gap-1">
        ${list.slice(0, 3).map(v => `<span class="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-main border border-line-soft">
          <span class="truncate max-w-[85px]">${esc(v.label)}</span>
          <span class="font-bold text-primary tabular-nums">${rp(v.price)}</span>
        </span>`).join('')}
        ${list.length > 3 ? `<span class="inline-flex items-center rounded-lg bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-subtle">+${list.length - 3}</span>` : ''}
      </div>
    </div>

    <!-- Variant Editor Section -->
    ${isOpen ? `<div class="a-body border-t border-line bg-surface-2/30 p-3 space-y-2">
      ${list.length ? list.map(variantGridRow).join('') : '<p class="rounded-xl bg-surface-2 p-2 text-center text-[12px] text-muted">Belum ada paket.</p>'}
      <button class="w-full inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-surface px-2 text-[12px] font-semibold text-primary transition hover:bg-surface-2 cursor-pointer" data-act="add-variant">
        <i data-lucide="plus" class="size-3.5"></i>Tambah paket baru
      </button>
    </div>` : ''}

    <!-- Footer Action Buttons -->
    <div class="mt-auto border-t border-line-soft px-3.5 py-2.5 bg-surface-2/30 flex items-center justify-between gap-1.5">
      <div class="flex items-center gap-1">
        <button class="a-ico size-8 rounded-xl" data-act="toggle-hide" title="${p.hidden ? 'Tampilkan di toko' : 'Sembunyikan dari toko'}" aria-label="${p.hidden ? 'Tampilkan di toko' : 'Sembunyikan dari toko'}">
          <i data-lucide="${p.hidden ? 'eye' : 'eye-off'}" class="size-4"></i>
        </button>
        <button class="a-ico size-8 rounded-xl" data-act="edit-meta" title="Edit detail produk" aria-label="Edit detail produk">
          <i data-lucide="pencil" class="size-4"></i>
        </button>
      </div>
      <div>
        ${isArmed
          ? `<div class="flex items-center gap-1">
              <button class="h-8 rounded-xl bg-danger px-2.5 text-[11px] font-bold text-white transition hover:bg-danger/85 cursor-pointer" data-act="delete-confirm">Hapus!</button>
              <button class="a-ico size-8 rounded-xl" data-act="delete-cancel" title="Batal" aria-label="Batal"><i data-lucide="x" class="size-4"></i></button>
            </div>`
          : `<button class="a-ico size-8 rounded-xl text-danger hover:bg-danger/10" data-act="delete" title="Hapus produk" aria-label="Hapus produk">
              <i data-lucide="trash-2" class="size-4"></i>
            </button>`}
      </div>
    </div>
  </article>`;
}

/* Row view produk (List View) */
function listProductCard(p) {
  const list = p.variants || [];
  const isOpen = open.has(p.slug);
  const isArmed = armed.has(p.slug);

  return `<article class="card a-card rounded-[18px] border border-line bg-surface overflow-hidden shadow-xs" data-slug="${esc(p.slug)}">
    ${isArmed ? '<div class="bg-danger/15 border-b border-danger/20 px-3.5 py-2 text-[12px] font-semibold text-danger flex items-center gap-1.5"><i data-lucide="alert-octagon" class="size-4 shrink-0"></i>Hapus permanen produk ini dan seluruh variannya?</div>' : ''}
    <div class="a-head flex items-center gap-3 p-3 sm:p-3.5">${headInner(p)}</div>
    ${isOpen ? `<div class="a-body space-y-2 border-t border-line bg-surface-2/20 p-3 sm:p-3.5">
      ${list.length ? rowHead() + list.map(variantListRow).join('') : '<p class="rounded-xl bg-surface-2 p-2.5 text-[12px] text-muted text-center">Belum ada paket varian.</p>'}
      <button class="inline-flex h-8 items-center gap-1 rounded-xl border border-dashed border-line bg-surface px-3 text-[12px] font-semibold text-primary transition hover:bg-surface-2 cursor-pointer" data-act="add-variant">
        <i data-lucide="plus" class="size-3.5"></i>Tambah paket
      </button>
    </div>` : ''}
  </article>`;
}

const statChip = (id, label, n, tone) =>
  `<button data-statchip="${id}" aria-pressed="${chip === id}" class="chip h-8 gap-1.5 px-3 text-[12px] rounded-lg cursor-pointer">
    <span class="chip-count font-bold tabular-nums${tone ? ' text-' + tone : ''}">${n}</span>${label}
  </button>`;

const syncChips = () => {
  const total = catalog.products.length;
  const hidden = catalog.products.filter((p) => p.hidden).length;
  const oos = catalog.products.filter(isOos).length;
  const active = catalog.products.filter((p) => !p.hidden && !isOos(p)).length;
  const totalSold = catalog.products.reduce((acc, p) => acc + (p.sold || 0), 0);

  // Update KPI metric widgets
  if ($('#kpiTotalVal')) $('#kpiTotalVal').textContent = total;
  if ($('#kpiSoldVal')) $('#kpiSoldVal').textContent = totalSold;
  if ($('#kpiOosVal')) $('#kpiOosVal').textContent = oos;
  if ($('#kpiHiddenVal')) $('#kpiHiddenVal').textContent = hidden;

  if ($('#kpiTotal')) $('#kpiTotal').setAttribute('aria-pressed', chip === 'all' ? 'true' : 'false');
  if ($('#kpiOos')) $('#kpiOos').setAttribute('aria-pressed', chip === 'oos' ? 'true' : 'false');
  if ($('#kpiHidden')) $('#kpiHidden').setAttribute('aria-pressed', chip === 'hidden' ? 'true' : 'false');

  // Filter chips in toolbar
  $('#aCount').innerHTML = statChip('all', 'Semua', total) +
    statChip('active', 'Aktif', active, 'success') +
    (oos ? statChip('oos', 'Stok Habis', oos, 'danger') : '') +
    (hidden ? statChip('hidden', 'Tersembunyi', hidden, 'warning') : '');
};

function render() {
  const list = visible();
  syncChips();

  // Update view mode toggle buttons
  const isGrid = adminView === 'grid';
  if ($('#aViewGrid')) {
    $('#aViewGrid').setAttribute('aria-pressed', isGrid ? 'true' : 'false');
    $('#aViewGrid').classList.toggle('bg-primary', isGrid);
    $('#aViewGrid').classList.toggle('text-primary-fg', isGrid);
    $('#aViewGrid').classList.toggle('text-muted', !isGrid);
  }
  if ($('#aViewList')) {
    $('#aViewList').setAttribute('aria-pressed', !isGrid ? 'true' : 'false');
    $('#aViewList').classList.toggle('bg-primary', !isGrid);
    $('#aViewList').classList.toggle('text-primary-fg', !isGrid);
    $('#aViewList').classList.toggle('text-muted', isGrid);
  }

  // Update search clear button
  const qVal = ($('#aQ')?.value || '').trim();
  if ($('#aQClear')) $('#aQClear').classList.toggle('hidden', !qVal);

  if (isGrid) {
    $('#aProducts').className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
    $('#aProducts').innerHTML = list.length
      ? list.map(gridProductCard).join('')
      : '<div class="col-span-full card p-8 text-center text-[13px] text-muted rounded-[20px]"><i data-lucide="search-x" class="size-8 mx-auto mb-2 text-subtle"></i>Tidak ada produk yang cocok dengan kata kunci atau filter.</div>';
  } else {
    $('#aProducts').className = 'space-y-3';
    $('#aProducts').innerHTML = list.length
      ? list.map(listProductCard).join('')
      : '<div class="card p-8 text-center text-[13px] text-muted rounded-[20px]"><i data-lucide="search-x" class="size-8 mx-auto mb-2 text-subtle"></i>Tidak ada produk yang cocok dengan kata kunci atau filter.</div>';
  }

  const allOpen = list.length > 0 && list.every((p) => open.has(p.slug));
  $('#aExpand').innerHTML = `<i data-lucide="${allOpen ? 'chevrons-down-up' : 'chevrons-up-down'}" class="size-4"></i><span class="hidden sm:inline">${allOpen ? 'Tutup semua' : 'Buka semua'}</span>`;
  $('#aExpand').dataset.all = allOpen ? '1' : '';
  icons();
}

function repaint(slug) {
  const p = bySlug(slug);
  const el = document.querySelector(`#aProducts [data-slug="${CSS.escape(slug)}"]`);
  syncChips();
  if (!p || !el) return render();
  el.outerHTML = adminView === 'grid' ? gridProductCard(p) : listProductCard(p);
  icons();
}

function syncHead(p) {
  const el = document.querySelector(`#aProducts [data-slug="${CSS.escape(p.slug)}"]`);
  syncChips();
  if (!p || !el) return;
  if (adminView === 'grid') {
    const lowest = minPrice(p);
    const oos = isOos(p);
    const priceEl = el.querySelector('.a-price-val');
    if (priceEl) priceEl.textContent = lowest === null ? '—' : rp(lowest);
    const stockEl = el.querySelector('.a-stock-val');
    if (stockEl) stockEl.innerHTML = `${stockText(p)} · <b class="text-main font-semibold">${p.sold ?? 0}</b> terjual`;
    const badgesEl = el.querySelector('.a-status-badges');
    if (badgesEl) {
      badgesEl.innerHTML = `
        <span class="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-subtle border border-line-soft">${esc(p.cat)}</span>
        ${p.hidden ? '<span class="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning border border-warning/20">Sembunyi</span>' : ''}
        ${oos ? '<span class="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger border border-danger/20">Habis</span>' : '<span class="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success border border-success/20">Aktif</span>'}
      `;
    }
  } else {
    const headEl = el.querySelector('.a-head');
    if (headEl) headEl.innerHTML = headInner(p);
  }
  icons();
}

const flash = (row) => {
  row.classList.add('a-flash');
  setTimeout(() => row.classList.remove('a-flash'), 1200);
};

async function patch(slug, body, okMsg, done) {
  try {
    const { product } = await api('PATCH', '/api/products/' + slug, body);
    const p = bySlug(slug);
    if (p) Object.assign(p, product);
    if (catalog?.products) {
      localStorage.setItem('wk:custom_products', JSON.stringify(catalog.products));
    }
    if (done) done();
    await window.wk?.refresh();
    toast(okMsg || 'Tersimpan.');
  } catch (e) {
    if (e.status === 404 || e.message?.toLowerCase().includes('tidak ditemukan')) {
      catalog.products = (catalog.products || []).filter((x) => x.slug !== slug);
      localStorage.setItem('wk:custom_products', JSON.stringify(catalog.products));
      await window.wk?.refresh();
      render();
      return toast('Produk sudah tidak ada di server, dihapus dari daftar.', 'err');
    }
    toast(e.message, 'err');
    await reload();
  }
}

const inputDebounceTimers = new Map();

function saveFieldInput(input) {
  if (!input) return;
  const row = input.closest('[data-row]');
  const card = input.closest('[data-slug]');
  if (!row || !card) return;
  const slug = card.dataset.slug;
  const vi = Number(row.dataset.row);
  const k = input.dataset.k;
  if (!k) return;

  if (k === 'unlim') {
    return patch(slug, { vi, stock: input.checked ? UNLIM : 0 },
      input.checked ? 'Stok jadi tak terbatas.' : 'Stok tak terbatas dimatikan.', () => repaint(slug));
  }

  const value = k === 'label' || k === 'ful' ? input.value : Number(input.value);
  if (k !== 'label' && k !== 'ful' && (!Number.isFinite(value) || value < 0)) return toast('Angka tidak valid.', 'err');

  // Skip jika nilai belum berubah dari catalog
  const p = bySlug(slug);
  const v = p?.variants?.[vi];
  if (v && v[k] === value) return;

  const nama = { price: 'Harga', stock: 'Stok', strike: 'Harga coret', label: 'Nama paket', ful: 'Pengiriman' }[k] || 'Perubahan';
  patch(slug, { vi, [k]: value }, `${nama} tersimpan.`, () => {
    flash(row);
    syncHead(bySlug(slug));
  });
}

function handleFieldInputDebounced(input, delay = 500) {
  if (!input) return;
  const k = input.dataset.k;
  if (k === 'unlim' || k === 'ful') {
    return saveFieldInput(input);
  }
  if (inputDebounceTimers.has(input)) {
    clearTimeout(inputDebounceTimers.get(input));
  }
  const timer = setTimeout(() => {
    inputDebounceTimers.delete(input);
    saveFieldInput(input);
  }, delay);
  inputDebounceTimers.set(input, timer);
}

$('#aProducts').addEventListener('input', (e) => {
  const input = e.target.closest('[data-k]');
  if (!input) return;
  handleFieldInputDebounced(input, 500);
});

$('#aProducts').addEventListener('change', (e) => {
  const input = e.target.closest('[data-k]');
  if (!input) return;
  if (inputDebounceTimers.has(input)) {
    clearTimeout(inputDebounceTimers.get(input));
    inputDebounceTimers.delete(input);
  }
  saveFieldInput(input);
});

$('#aProducts').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const input = e.target.closest('[data-k]');
    if (input) {
      e.preventDefault();
      if (inputDebounceTimers.has(input)) {
        clearTimeout(inputDebounceTimers.get(input));
        inputDebounceTimers.delete(input);
      }
      saveFieldInput(input);
      input.blur();
    }
  }
});

$('#aProducts').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const p = bySlug(btn.closest('[data-slug]').dataset.slug);
  const a = btn.dataset.act;

  if (a === 'toggle-open') {
    open.has(p.slug) ? open.delete(p.slug) : open.add(p.slug);
    return repaint(p.slug);
  }

  if (a === 'toggle-hide') {
    return patch(p.slug, { hidden: !p.hidden },
      p.hidden ? 'Muncul lagi di toko.' : 'Disembunyikan dari toko.', () => repaint(p.slug));
  }

  if (a === 'edit-meta') return openMeta(p);

  if (a === 'delete') {
    armed.clear();
    armed.add(p.slug);
    return repaint(p.slug);
  }

  if (a === 'delete-cancel') {
    armed.delete(p.slug);
    return repaint(p.slug);
  }

  if (a === 'delete-confirm') {
    try {
      await api('DELETE', '/api/products/' + p.slug, {});
    } catch (err) {
      if (err.status !== 404 && !err.message?.toLowerCase().includes('tidak ditemukan')) {
        return toast(err.message, 'err');
      }
    }
    catalog.products = catalog.products.filter((x) => x.slug !== p.slug);
    localStorage.setItem('wk:custom_products', JSON.stringify(catalog.products));
    armed.delete(p.slug);
    open.delete(p.slug);
    await window.wk?.refresh();
    render();
    return toast(`"${p.name}" dihapus.`);
  }

  if (a === 'add-variant') {
    open.add(p.slug);
    return patch(p.slug, { variants: [...(p.variants || []), { label: 'Paket baru', price: 10000, stock: 0, ful: 'manual' }] },
      'Paket ditambahkan.', () => repaint(p.slug));
  }

  if (a === 'drop-variant') {
    const vi = Number(btn.closest('[data-row]').dataset.row);
    if ((p.variants || []).length <= 1) return toast('Minimal satu paket per produk.', 'err');
    await patch(p.slug, { variants: p.variants.filter((_, i) => i !== vi) }, 'Paket dihapus.', () => repaint(p.slug));
  }
});

/* ---------- form produk & password ---------- */

function modalVariantRow(v, vi) {
  const unlim = v.stock === UNLIM;
  return `<div class="a-modal-variant rounded-xl border border-line-soft bg-surface-2/60 p-3 space-y-2.5 shadow-xs" data-mvi="${vi}">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div>
        <label class="text-[11px] font-semibold text-subtle block mb-1">Nama Paket / Varian *</label>
        <input name="v_label" class="input h-9 w-full text-[13px] font-medium rounded-lg" value="${esc(v.label)}" placeholder="mis. 18 Bulan Link" required>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="flex-1 min-w-0">
          <label class="text-[11px] font-semibold text-subtle block mb-1">Keterangan / Subtitle Paket</label>
          <input name="v_d" class="input h-9 w-full text-[13px] font-medium rounded-lg" value="${esc(v.d || '')}" placeholder="mis. Via link redeem / Via undang email">
        </div>
        <button type="button" class="a-ico size-9 rounded-lg text-danger hover:bg-danger/10 self-end mb-0.5 shrink-0" data-mact="drop-v" title="Hapus paket" aria-label="Hapus paket">
          <i data-lucide="trash-2" class="size-4"></i>
        </button>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
      <div>
        <label class="text-[11px] font-semibold text-subtle block mb-1">Harga (Rp) *</label>
        <input name="v_price" class="input h-9 w-full text-right text-[13px] font-bold rounded-lg" type="number" min="1" step="1" value="${v.price || ''}" required placeholder="10000">
      </div>
      <div>
        <label class="text-[11px] font-semibold text-subtle block mb-1">Harga Coret (Rp)</label>
        <input name="v_strike" class="input h-9 w-full text-right text-[13px] text-muted rounded-lg" type="number" min="0" step="1" value="${v.strike || ''}" placeholder="—">
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-[11px] font-semibold text-subtle">Stok</label>
          <label class="inline-flex items-center gap-1 text-[11px] text-muted cursor-pointer" title="Stok tak terbatas">
            <input type="checkbox" name="v_unlim" class="size-3.5 rounded" data-munlim${unlim ? ' checked' : ''}>
            <span>∞ Bebas</span>
          </label>
        </div>
        <input name="v_stock" class="input h-9 w-full text-right text-[13px] rounded-lg" type="number" min="0" step="1" value="${unlim ? '' : v.stock}" placeholder="∞"${unlim ? ' disabled' : ''}>
      </div>
      <div>
        <label class="text-[11px] font-semibold text-subtle block mb-1">Pengiriman</label>
        <select name="v_ful" class="input h-9 w-full text-[12px] rounded-lg">
          <option value="auto"${v.ful === 'auto' ? ' selected' : ''}>Otomatis</option>
          <option value="manual"${v.ful !== 'auto' ? ' selected' : ''}>Manual</option>
        </select>
      </div>
    </div>
  </div>`;
}

function metaForm(p) {
  const variants = p?.variants?.length ? p.variants : [{ label: '1 Bulan', price: 10000, stock: 10, ful: 'auto' }];

  return `<form id="aMeta" class="flex flex-col h-full max-h-[92dvh]">
    <div class="flex items-center justify-between p-5 pb-4 border-b border-line-soft shrink-0 bg-surface">
      <div class="flex items-center gap-2.5">
        <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Kembali" aria-label="Kembali"><i data-lucide="arrow-left" class="size-4"></i></button>
        <div>
          <h2 class="text-base font-bold">${p ? 'Edit Detail & Harga Produk' : 'Tambah Produk Baru'}</h2>
          <p class="text-[12px] text-subtle">${p ? 'Ubah informasi umum, daftar harga varian & stok' : 'Isi identitas produk baru beserta daftar paket harganya'}</p>
        </div>
      </div>
      <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Tutup" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>

    <!-- Scrollable content -->
    <div class="flex-1 overflow-y-auto p-5 space-y-4">
      <!-- Info Dasar -->
      <div class="space-y-3">
        <h3 class="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <i data-lucide="info" class="size-3.5"></i>Informasi Umum
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block text-[13px] font-semibold">Nama Produk *
            <input name="name" class="input mt-1 h-10 w-full rounded-xl" required value="${esc(p?.name || '')}" placeholder="mis. Adobe Premiere"></label>
          <label class="block text-[13px] font-semibold">Kategori *
            <select name="cat" class="input mt-1 h-10 w-full rounded-xl">${catalog.categories.map((c) =>
              `<option value="${esc(c.id)}"${p?.cat === c.id ? ' selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
        </div>
      </div>

      <!-- Logo / Gambar Produk -->
      <div class="space-y-1.5 pt-1 border-t border-line-soft">
        <label class="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <i data-lucide="image" class="size-3.5"></i>Logo / Gambar Produk
        </label>
        <div id="aLogoDropZone" class="group relative flex items-center gap-3.5 rounded-xl border border-dashed border-line bg-surface p-3 transition-colors hover:border-primary/60 hover:bg-surface-2/40 cursor-pointer">
          <div class="relative size-12 shrink-0 overflow-hidden rounded-xl bg-surface-2 border border-line-soft flex items-center justify-center">
            <img id="aLogoPreview" src="${esc(p?.image || (p?.slug ? `assets/products/${p.slug}.webp` : ''))}" class="size-full object-cover ${p?.image || p?.slug ? '' : 'hidden'}" onerror="this.classList.add('hidden'); document.getElementById('aLogoIcon')?.classList.remove('hidden');">
            <i id="aLogoIcon" data-lucide="image-plus" class="size-5 text-muted group-hover:text-primary transition-colors ${p?.image || p?.slug ? 'hidden' : ''}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-main flex items-center gap-1.5">
              <span>Tarik &amp; lepas logo produk di sini</span>
              <span class="text-subtle font-normal">atau klik untuk pilih berkas</span>
            </p>
            <p class="text-[11px] text-muted truncate mt-0.5">Mendukung PNG, WEBP, JPG, SVG (Otomatis dioptimalkan)</p>
          </div>
          <input type="file" id="aLogoInput" accept="image/*" class="hidden">
          <input type="hidden" id="aLogoData" name="image" value="${esc(p?.image || '')}">
        </div>
      </div>
      <!-- Bagian Edit Paket & Harga -->
      <div class="space-y-2.5 pt-1 border-t border-line-soft">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
            <i data-lucide="tag" class="size-3.5"></i>Daftar Paket & Harga Produk *
          </h3>
          <span class="text-[11px] text-subtle">Minimal 1 paket</span>
        </div>
        
        <div id="aModalVariants" class="space-y-2">
          ${variants.map(modalVariantRow).join('')}
        </div>

        <button type="button" id="aModalAddVariant" class="w-full inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-surface px-4 text-[12px] font-bold text-primary transition hover:bg-surface-2 cursor-pointer shadow-2xs">
          <i data-lucide="plus" class="size-4"></i>Tambah Paket Varian Baru
        </button>
      </div>

      <!-- Keterangan Tambahan -->
      <div class="space-y-3 pt-1 border-t border-line-soft">
        <h3 class="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <i data-lucide="file-text" class="size-3.5"></i>Keterangan Tambahan
        </h3>
        <label class="block text-[13px] font-semibold">Poin Singkat (1 baris = 1 poin)
          <textarea name="brief" class="input mt-1 w-full py-2.5 rounded-xl text-[13px]" rows="3" placeholder="Bisa di HP & PC&#10;Garansi 30 hari">${esc((p?.brief || []).join('\n'))}</textarea></label>
        <label class="block text-[13px] font-semibold">Field Tambahan saat Order (pisahkan koma)
          <input name="mf" class="input mt-1 h-10 w-full rounded-xl text-[13px]" value="${esc((p?.mf || []).join(', '))}" placeholder="Email Akun, Nomor WhatsApp"></label>
        <label class="block text-[13px] font-semibold">Deskripsi Lengkap
          <textarea name="desc" class="input mt-1 w-full py-2.5 rounded-xl text-[13px]" rows="4">${esc(p?.desc || '')}</textarea></label>
      </div>
    </div>

    <!-- Fixed Footer Actions -->
    <div class="flex items-center justify-end gap-2.5 p-4 px-5 border-t border-line-soft shrink-0 bg-surface">
      <button type="button" class="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold text-main transition hover:bg-surface-2 cursor-pointer" data-aclose>Batal</button>
      <button type="submit" class="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-[13px] font-bold text-primary-fg shadow-sm transition hover:opacity-90 cursor-pointer">${p ? 'Simpan Perubahan' : 'Tambah Produk'}</button>
    </div>
  </form>`;
}

const readFormProduct = (form) => {
  const f = new FormData(form);
  const rows = form.querySelectorAll('.a-modal-variant');
  const variants = [];

  rows.forEach((row) => {
    const label = (row.querySelector('[name="v_label"]')?.value || '').trim();
    const d = (row.querySelector('[name="v_d"]')?.value || '').trim();
    const price = Number(row.querySelector('[name="v_price"]')?.value || 0);
    const strikeVal = row.querySelector('[name="v_strike"]')?.value;
    const strike = strikeVal ? Number(strikeVal) : undefined;
    const isUnlim = row.querySelector('[name="v_unlim"]')?.checked;
    const stockVal = Number(row.querySelector('[name="v_stock"]')?.value || 0);
    const stock = isUnlim ? UNLIM : (Number.isFinite(stockVal) && stockVal >= 0 ? stockVal : 0);
    const ful = row.querySelector('[name="v_ful"]')?.value === 'manual' ? 'manual' : 'auto';

    if (label && Number.isFinite(price) && price > 0) {
      const v = { label, price, stock, ful };
      if (d) v.d = d;
      if (strike && strike > price) v.strike = strike;
      variants.push(v);
    }
  });

  return {
    name: f.get('name'),
    cat: f.get('cat'),
    desc: f.get('desc'),
    image: f.get('image') || undefined,
    brief: String(f.get('brief') || '').split('\n').map((s) => s.trim()).filter(Boolean),
    mf: String(f.get('mf') || '').split(',').map((s) => s.trim()).filter(Boolean),
    variants: variants.length ? variants : undefined,
  };
};

function bindMetaEvents(p) {
  const container = $('#aModalVariants');
  const dropZone = $('#aLogoDropZone');
  const fileInput = $('#aLogoInput');

  function handleLogoFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      return toast('Harap pilih berkas gambar (PNG, WEBP, atau JPG).', 'err');
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 256;
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > max) { h = Math.round((h * max) / w); w = max; }
        } else {
          if (h > max) { w = Math.round((w * max) / h); h = max; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/webp', 0.88);

        const preview = $('#aLogoPreview');
        const icon = $('#aLogoIcon');
        const hiddenData = $('#aLogoData');
        if (preview) {
          preview.src = dataUrl;
          preview.classList.remove('hidden');
        }
        if (icon) icon.classList.add('hidden');
        if (hiddenData) hiddenData.value = dataUrl;
        toast('Logo produk berhasil dimuat!');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  dropZone?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (ev) => {
    if (ev.target.files && ev.target.files[0]) handleLogoFile(ev.target.files[0]);
  });

  dropZone?.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    dropZone.classList.add('border-primary', 'bg-primary/10');
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-primary', 'bg-primary/10');
  });
  dropZone?.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dropZone.classList.remove('border-primary', 'bg-primary/10');
    if (ev.dataTransfer?.files && ev.dataTransfer.files[0]) {
      handleLogoFile(ev.dataTransfer.files[0]);
    }
  });

  // Cegah tombol Enter pada input teks biasa agar tidak sengaja submit & menutup modal
  $('#aMeta').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
    }
  });

  // Toggle unlimited stock
  $('#aMeta').addEventListener('change', (e) => {
    if (e.target.dataset.munlim !== undefined) {
      const row = e.target.closest('.a-modal-variant');
      const stockInput = row.querySelector('[name="v_stock"]');
      if (e.target.checked) {
        stockInput.disabled = true;
        stockInput.value = '';
      } else {
        stockInput.disabled = false;
        stockInput.value = '10';
      }
    }
  });

  // Hapus paket di modal
  $('#aMeta').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mact="drop-v"]');
    if (!btn) return;
    const rows = container.querySelectorAll('.a-modal-variant');
    if (rows.length <= 1) {
      return toast('Minimal harus ada 1 paket varian.', 'err');
    }
    btn.closest('.a-modal-variant').remove();
  });

  // Tambah paket di modal
  $('#aModalAddVariant').addEventListener('click', () => {
    const rows = container.querySelectorAll('.a-modal-variant');
    const newVi = rows.length;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = modalVariantRow({ label: 'Paket ' + (newVi + 1), price: 15000, strike: '', stock: 10, ful: 'auto' }, newVi);
    container.appendChild(tempDiv.firstElementChild);
    icons();
  });

  // Submit form
  $('#aMeta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readFormProduct(e.target);
    if (!data.variants || !data.variants.length) {
      return toast('Minimal harus ada 1 paket dengan nama dan harga valid di atas Rp0.', 'err');
    }
    try {
      if (p) {
        const { product } = await api('PATCH', '/api/products/' + p.slug, data);
        Object.assign(p, product);
        localStorage.setItem('wk:custom_products', JSON.stringify(catalog.products));
        closeADialog();
        render();
        await window.wk?.refresh();
        toast('Detail produk & harga berhasil disimpan!');
      } else {
        const { product } = await api('POST', '/api/products', data);
        catalog.products.push(product);
        localStorage.setItem('wk:custom_products', JSON.stringify(catalog.products));
        closeADialog();
        render();
        await window.wk?.refresh();
        toast('Produk & paket harga baru berhasil ditambahkan!');
      }
    } catch (e2) {
      toast(e2.message, 'err');
    }
  });
}

function openMeta(p) {
  openADialog(metaForm(p));
  bindMetaEvents(p);
}

function getAutoBundleItems(p1, p2) {
  const items = [];
  const formatProd = (p) => {
    if (!p) return '';
    const name = p.name || '';
    let vLabel = '';
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      const v = p.variants.find((item) => item.label && item.stock !== 0) || p.variants[0];
      if (v && v.label) {
        vLabel = v.label.replace(/Â·/g, '·').trim();
      }
    }
    if (vLabel) {
      if (vLabel.toLowerCase().includes(name.toLowerCase())) {
        return vLabel;
      }
      return `${name} ${vLabel}`;
    }
    return name;
  };

  if (p1) {
    const s = formatProd(p1);
    if (s) items.push(s);
  }
  if (p2) {
    const s = formatProd(p2);
    if (s) items.push(s);
  }
  items.push('Klaim dengan menyertakan kode transaksi');
  return items;
}

function bundleModalHTML(b) {
  const cur = b || catalog?.bundle || {
    enabled: true,
    title: 'YouTube + Google Gemini',
    prod1: 'youtube',
    prod2: 'google-gemini',
    badge: '-17%',
    price: 50000,
    strike: 60000,
    fulText: 'Otomatis',
    soldText: '1 terjual hari ini',
    items: [
      'YouTube 1 Bulan',
      'Google Gemini 1 Tahun',
      'Klaim dengan menyertakan kode transaksi',
    ],
  };

  const prods = (catalog?.products || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  if (cur.items && cur.items.some((it) => it.includes('16 bulan') || it.includes('Google AI Pro'))) {
    const p1 = prods.find((p) => p.slug === cur.prod1);
    const p2 = prods.find((p) => p.slug === cur.prod2);
    cur.items = getAutoBundleItems(p1, p2);
  }

  return `<form id="aBundleForm" class="flex flex-col h-full max-h-[92dvh]">
    <!-- Header Modal -->
    <div class="flex items-center justify-between p-5 pb-4 border-b border-line-soft shrink-0 bg-surface">
      <div class="flex items-center gap-2.5">
        <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Kembali" aria-label="Kembali"><i data-lucide="arrow-left" class="size-4"></i></button>
        <div class="grid size-10 place-items-center rounded-xl bg-warning/15 text-warning">
          <i data-lucide="zap" class="size-5"></i>
        </div>
        <div>
          <h2 class="text-base font-bold">Kelola Paket Hemat (Bundle 2 Produk)</h2>
          <p class="text-[12px] text-subtle">Satukan 2 produk katalog menjadi paket hemat promo berdiskon</p>
        </div>
      </div>
      <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Tutup" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>

    <!-- Scrollable content -->
    <div class="flex-1 overflow-y-auto p-5 space-y-4">

    <!-- Toggle Status Tampil -->
    <div class="flex items-center justify-between rounded-xl bg-surface-2/60 p-3 border border-line-soft">
      <div>
        <span class="text-[13px] font-bold block">Tampilkan di Toko</span>
        <span class="text-[11px] text-subtle">Aktifkan agar paket hemat muncul di beranda pembeli</span>
      </div>
      <label class="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" id="bEnabled" name="enabled" class="sr-only peer" ${cur.enabled ? 'checked' : ''}>
        <div class="w-11 h-6 bg-surface-3 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>
      </label>
    </div>

    <!-- Pilihan 2 Produk -->
    <div class="space-y-2.5">
      <h3 class="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
        <i data-lucide="package" class="size-3.5"></i>Pilih 2 Produk yang Disatukan
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- Produk 1 -->
        <div class="rounded-xl border border-line p-3 space-y-2 bg-surface">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold uppercase tracking-wider text-primary">Produk 1</span>
            <div id="bThumb1Wrap" class="size-8 rounded-lg bg-surface-2 overflow-hidden flex items-center justify-center border border-line-soft">
              <img id="bThumb1" src="assets/products/${esc(cur.prod1)}.webp" class="size-full object-cover">
            </div>
          </div>
          <select id="bProd1" name="prod1" class="input h-10 w-full text-[13px] rounded-xl font-medium">
            ${prods.map((p) => `<option value="${esc(p.slug)}"${p.slug === cur.prod1 ? ' selected' : ''}>${esc(p.name)} (${rp(minPrice(p))})</option>`).join('')}
          </select>
        </div>

        <!-- Produk 2 -->
        <div class="rounded-xl border border-line p-3 space-y-2 bg-surface">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold uppercase tracking-wider text-primary">Produk 2</span>
            <div id="bThumb2Wrap" class="size-8 rounded-lg bg-surface-2 overflow-hidden flex items-center justify-center border border-line-soft">
              <img id="bThumb2" src="assets/products/${esc(cur.prod2)}.webp" class="size-full object-cover">
            </div>
          </div>
          <select id="bProd2" name="prod2" class="input h-10 w-full text-[13px] rounded-xl font-medium">
            ${prods.map((p) => `<option value="${esc(p.slug)}"${p.slug === cur.prod2 ? ' selected' : ''}>${esc(p.name)} (${rp(minPrice(p))})</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <!-- Judul & Badge -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="sm:col-span-2">
        <div class="flex items-center justify-between">
          <label for="bTitle" class="block text-[13px] font-semibold">Judul Paket Hemat *</label>
          <button type="button" id="bAutoTitle" class="text-[11px] text-primary hover:underline font-semibold cursor-pointer">Bikin Judul Otomatis</button>
        </div>
        <input id="bTitle" name="title" class="input mt-1 h-10 w-full rounded-xl text-[13px]" required value="${esc(cur.title)}" placeholder="mis. YouTube + Canva">
      </div>
      <div>
        <label for="bBadge" class="block text-[13px] font-semibold">Badge Promo
          <input id="bBadge" name="badge" class="input mt-1 h-10 w-full rounded-xl text-[13px]" value="${esc(cur.badge || '')}" placeholder="mis. -17% atau HEMAT"></label>
      </div>
    </div>

    <!-- Penetapan Harga Paket -->
    <div class="rounded-xl border border-line p-3 bg-surface-2/30 space-y-2.5">
      <h3 class="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
        <i data-lucide="tag" class="size-3.5"></i>Harga Paket &amp; Diskon
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label for="bPrice" class="block text-[13px] font-semibold">Harga Paket Hemat (Rp) *
            <input id="bPrice" name="price" type="number" min="1" step="1" required class="input mt-1 h-10 w-full rounded-xl text-[13px] font-bold text-danger" value="${cur.price || 50000}"></label>
        </div>
        <div>
          <label for="bStrike" class="block text-[13px] font-semibold">Harga Normal / Coret (Rp)
            <input id="bStrike" name="strike" type="number" min="0" step="1" class="input mt-1 h-10 w-full rounded-xl text-[13px]" value="${cur.strike || 60000}"></label>
        </div>
      </div>
      <div id="bCalcInfo" class="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-surface border border-line-soft">
        <span class="text-muted">Perhitungan Diskon:</span>
        <span id="bHematVal" class="font-bold text-success">Hemat Rp10.000 (-17%)</span>
      </div>
    </div>

    <!-- Poin Keunggulan -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <label for="bItems" class="block text-[13px] font-semibold">Poin Keunggulan / Detail Paket (1 baris = 1 poin)</label>
        <button type="button" id="bAutoItems" class="text-[11px] text-primary hover:underline font-semibold cursor-pointer">Bikin Poin Otomatis</button>
      </div>
      <textarea id="bItems" name="items" rows="3" class="input mt-1 w-full py-2 rounded-xl text-[13px]" placeholder="YouTube 1 Bulan&#10;Google Gemini 1 Tahun&#10;Klaim dengan menyertakan kode transaksi">${esc((cur.items || []).join('\n'))}</textarea>
      <p class="text-[11px] text-subtle">Setiap baris akan ditampilkan dengan ikon centang hijau di bawah judul paket. Otomatis terisi saat memilih produk, atau klik &quot;Bikin Poin Otomatis&quot;.</p>
    </div>

    <!-- Info Pengiriman & Penjualan -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label for="bFulText" class="block text-[13px] font-semibold">Tipe Pengiriman
          <input id="bFulText" name="fulText" class="input mt-1 h-10 w-full rounded-xl text-[13px]" value="${esc(cur.fulText || 'Otomatis')}" placeholder="mis. Otomatis atau Manual"></label>
      </div>
      <div>
        <label for="bSoldText" class="block text-[13px] font-semibold">Teks Penjualan
          <input id="bSoldText" name="soldText" class="input mt-1 h-10 w-full rounded-xl text-[13px]" value="${esc(cur.soldText || '1 terjual hari ini')}" placeholder="mis. 1 terjual hari ini"></label>
      </div>
    </div>

    <!-- Live Preview Card -->
    <div class="space-y-1.5 pt-1 border-t border-line-soft">
      <span class="text-xs font-bold uppercase tracking-wider text-muted block">Live Preview Tampilan Toko</span>
      <div id="bPreviewCard" class="card rounded-xl p-3 border border-line space-y-2 bg-surface"></div>
    </div>

    </div>

    <!-- Fixed Footer Actions -->
    <div class="flex items-center justify-end gap-2.5 p-4 px-5 border-t border-line-soft shrink-0 bg-surface">
      <button type="button" class="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold text-main transition hover:bg-surface-2 cursor-pointer" data-aclose>Batal</button>
      <button type="submit" id="bSubmitBtn" class="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-5 text-[13px] font-bold text-primary-fg shadow-sm transition hover:opacity-90 cursor-pointer">
        <i data-lucide="check" class="size-4"></i>Simpan Paket Hemat
      </button>
    </div>
  </form>`;
}

function bindBundleEvents() {
  const form = $('#aBundleForm');
  if (!form) return;

  const updatePreview = () => {
    const s1 = $('#bProd1')?.value;
    const s2 = $('#bProd2')?.value;
    const p1 = (catalog?.products || []).find((p) => p.slug === s1) || { name: s1, slug: s1 };
    const p2 = (catalog?.products || []).find((p) => p.slug === s2) || { name: s2, slug: s2 };

    if ($('#bThumb1')) $('#bThumb1').src = `assets/products/${esc(p1.slug)}.webp`;
    if ($('#bThumb2')) $('#bThumb2').src = `assets/products/${esc(p2.slug)}.webp`;

    const price = Number($('#bPrice')?.value) || 0;
    const strike = Number($('#bStrike')?.value) || 0;
    const hemat = strike > price ? strike - price : 0;
    const pct = strike > 0 && hemat > 0 ? Math.round((hemat / strike) * 100) : 0;

    const calcInfo = $('#bHematVal');
    if (calcInfo) {
      if (hemat > 0) {
        calcInfo.className = 'font-bold text-success';
        calcInfo.textContent = `Hemat ${rp(hemat)} (-${pct}%)`;
      } else {
        calcInfo.className = 'font-semibold text-subtle';
        calcInfo.textContent = 'Tanpa potongan diskon';
      }
    }

    const title = $('#bTitle')?.value.trim() || `${p1.name} + ${p2.name}`;
    const badge = $('#bBadge')?.value.trim() || (pct ? `-${pct}%` : '');
    const items = ($('#bItems')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const ful = $('#bFulText')?.value.trim() || 'Otomatis';
    const sold = $('#bSoldText')?.value.trim() || '1 terjual hari ini';

    const prev = $('#bPreviewCard');
    if (prev) {
      prev.innerHTML = `
        <div class="flex min-w-0 items-center gap-2">
          <div class="flex shrink-0 items-center gap-1">
            <img src="assets/products/${esc(p1.slug)}.webp" alt="${esc(p1.name)}" class="size-8 rounded-lg bg-surface-2 object-cover" onerror="this.style.display='none'">
            <i data-lucide="plus" class="size-3 text-subtle"></i>
            <img src="assets/products/${esc(p2.slug)}.webp" alt="${esc(p2.name)}" class="size-8 rounded-lg bg-surface-2 object-cover" onerror="this.style.display='none'">
          </div>
          <p class="min-w-0 flex-1 text-sm font-bold leading-snug">${esc(title)}</p>
          ${badge ? `<span class="pill shrink-0 rounded-full bg-danger px-1.5 py-px text-[10px] font-bold text-white">${esc(badge)}</span>` : ''}
        </div>
        ${items.length ? `<ul class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          ${items.map((it) => `<li class="flex items-start gap-1"><i data-lucide="check" class="mt-0.5 size-3 shrink-0 text-success"></i>${esc(it)}</li>`).join('')}
        </ul>` : ''}
        <div class="flex items-end justify-between gap-2 pt-1 border-t border-line-soft">
          <div class="min-w-0">
            <p class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span class="text-base font-bold tabular-nums text-danger">${rp(price)}</span>
              ${strike > price ? `<span class="text-[11px] tabular-nums text-subtle line-through">${rp(strike)}</span>` : ''}
              ${hemat > 0 ? `<span class="text-[11px] font-semibold tabular-nums text-success">Hemat ${rp(hemat)}</span>` : ''}
            </p>
            <p class="text-[11px] tabular-nums text-subtle"><span class="font-semibold text-success"><i data-lucide="zap" class="inline size-3 -translate-y-px"></i>${esc(ful)}</span> · ${esc(sold)}</p>
          </div>
          <span class="inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] bg-primary px-3 text-xs font-semibold text-primary-fg opacity-85 pointer-events-none">
            <i data-lucide="shopping-bag" class="size-3.5"></i>Beli paket
          </span>
        </div>
      `;
      icons();
    }
  };

  const handleProductChange = () => {
    const s1 = $('#bProd1')?.value;
    const s2 = $('#bProd2')?.value;
    const p1 = (catalog?.products || []).find((p) => p.slug === s1) || { name: s1, slug: s1 };
    const p2 = (catalog?.products || []).find((p) => p.slug === s2) || { name: s2, slug: s2 };

    if ($('#bItems')) {
      $('#bItems').value = getAutoBundleItems(p1, p2).join('\n');
    }

    if ($('#bTitle')) {
      $('#bTitle').value = `${p1.name} + ${p2.name}`;
    }

    const p1Min = minPrice(p1) || 0;
    const p2Min = minPrice(p2) || 0;
    const comboPrice = p1Min + p2Min;
    if (comboPrice > 0 && $('#bStrike')) {
      $('#bStrike').value = comboPrice;
    }

    updatePreview();
  };

  $('#bProd1')?.addEventListener('change', handleProductChange);
  $('#bProd2')?.addEventListener('change', handleProductChange);
  $('#bPrice')?.addEventListener('input', updatePreview);
  $('#bStrike')?.addEventListener('input', updatePreview);
  $('#bTitle')?.addEventListener('input', updatePreview);
  $('#bBadge')?.addEventListener('input', updatePreview);
  $('#bItems')?.addEventListener('input', updatePreview);
  $('#bFulText')?.addEventListener('input', updatePreview);
  $('#bSoldText')?.addEventListener('input', updatePreview);

  $('#bAutoItems')?.addEventListener('click', () => {
    const s1 = $('#bProd1')?.value;
    const s2 = $('#bProd2')?.value;
    const p1 = (catalog?.products || []).find((p) => p.slug === s1) || { name: s1, slug: s1 };
    const p2 = (catalog?.products || []).find((p) => p.slug === s2) || { name: s2, slug: s2 };
    if ($('#bItems')) {
      $('#bItems').value = getAutoBundleItems(p1, p2).join('\n');
      updatePreview();
      toast('Poin keunggulan berhasil dibuat otomatis!');
    }
  });

  $('#bAutoTitle')?.addEventListener('click', () => {
    const s1 = $('#bProd1')?.value;
    const s2 = $('#bProd2')?.value;
    const p1 = (catalog?.products || []).find((p) => p.slug === s1);
    const p2 = (catalog?.products || []).find((p) => p.slug === s2);
    if (p1 && p2) {
      $('#bTitle').value = `${p1.name} + ${p2.name}`;
      updatePreview();
      toast('Judul paket berhasil dibuat otomatis!');
    }
  });

  updatePreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#bSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = `<span class="size-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span> Menyimpan…`;

    try {
      const items = ($('#bItems')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = {
        enabled: $('#bEnabled').checked,
        prod1: $('#bProd1').value,
        prod2: $('#bProd2').value,
        title: $('#bTitle').value.trim(),
        badge: $('#bBadge').value.trim(),
        price: Number($('#bPrice').value),
        strike: Number($('#bStrike').value) || 0,
        fulText: $('#bFulText').value.trim() || 'Otomatis',
        soldText: $('#bSoldText').value.trim() || '1 terjual hari ini',
        items,
      };

      const res = await api('PATCH', '/api/bundle', payload);
      catalog.bundle = res.bundle;
      closeADialog();
      toast('Paket hemat berhasil disimpan!');
      if (window.wk?.refresh) await window.wk.refresh();
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check" class="size-4"></i>Simpan Paket Hemat`;
      icons();
    }
  });
}

async function openBundleModal() {
  try {
    let b = catalog?.bundle;
    if (!b) {
      const res = await api('GET', '/api/bundle');
      b = res.bundle;
      if (catalog) catalog.bundle = b;
    }
    openADialog(bundleModalHTML(b));
    bindBundleEvents();
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#aBundleBtn')?.addEventListener('click', openBundleModal);

$('#aAdd').addEventListener('click', () => {
  openADialog(metaForm(null));
  bindMetaEvents(null);
});

$('#aPw').addEventListener('click', () => {
  openADialog(`<form id="aPwForm" class="p-5 space-y-4">
    <div class="flex items-center justify-between pb-3 border-b border-line-soft">
      <div class="flex items-center gap-2.5">
        <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Kembali" aria-label="Kembali"><i data-lucide="arrow-left" class="size-4"></i></button>
        <div class="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <i data-lucide="key-round" class="size-5"></i>
        </div>
        <div>
          <h2 class="text-base font-bold">Ganti Password Owner</h2>
          <p class="text-[12px] text-subtle">Sesi owner di perangkat lain akan berakhir setelah password diganti.</p>
        </div>
      </div>
      <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Tutup" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>
    <div class="space-y-3 pt-1">
      <label class="block text-[13px] font-semibold">Password lama
        <input name="current" type="password" class="input mt-1 h-10 w-full rounded-xl" required autocomplete="current-password"></label>
      <label class="block text-[13px] font-semibold">Password baru
        <input name="next" type="password" class="input mt-1 h-10 w-full rounded-xl" required minlength="8" autocomplete="new-password"></label>
    </div>
    <div class="flex items-center justify-end gap-2.5 pt-3 border-t border-line-soft">
      <button type="button" class="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold text-main transition hover:bg-surface-2 cursor-pointer" data-aclose>Batal</button>
      <button type="submit" class="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-[13px] font-bold text-primary-fg shadow-sm transition hover:opacity-90 cursor-pointer">Ganti Password</button>
    </div>
  </form>`);
  $('#aPwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const data = await api('POST', '/api/password', { current: f.get('current'), next: f.get('next') });
      token = data.token; localStorage.setItem(TOKEN_KEY, token);
      closeADialog(); toast('Password diganti.');
    } catch (e2) { toast(e2.message, 'err'); }
  });
});

function openWaDialog() {
  openADialog(`<form id="aWaForm" class="p-5 space-y-4">
    <div class="flex items-center justify-between pb-3 border-b border-line-soft">
      <div class="flex items-center gap-2.5">
        <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Kembali" aria-label="Kembali"><i data-lucide="arrow-left" class="size-4"></i></button>
        <div class="grid size-10 place-items-center rounded-xl bg-success/15 text-success">
          <i data-lucide="phone" class="size-5"></i>
        </div>
        <div>
          <h2 class="text-base font-bold">Nomor WhatsApp Toko</h2>
          <p class="text-[12px] text-subtle">Tujuan penerimaan order saat pembeli klik "Beli Sekarang".</p>
        </div>
      </div>
      <button type="button" class="a-ico size-8 rounded-xl" data-aclose title="Tutup" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>
    <div class="space-y-3 pt-1">
      <label class="block text-[13px] font-semibold">Nomor WhatsApp Admin (awali 62 atau 08)
        <input id="aWaInput" name="wa" type="tel" class="input mt-1 h-10 w-full rounded-xl text-[14px] font-bold" required value="${esc(catalog?.wa || '6281234567890')}" placeholder="mis. 6281234567890"></label>
      <p class="text-[12px] text-muted leading-relaxed">
        Format nomor internasional tanpa tanda + atau spasi (contoh: <b class="text-main font-semibold">6281234567890</b>). Setiap kali pembeli klik tombol beli di toko, mereka akan langsung diarahkan ke chat WhatsApp nomor ini dengan rincian pesanannya.
      </p>
    </div>
    <div class="flex items-center justify-end gap-2.5 pt-3 border-t border-line-soft">
      <button type="button" class="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold text-main transition hover:bg-surface-2 cursor-pointer" data-aclose>Batal</button>
      <button type="submit" class="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-[13px] font-bold text-primary-fg shadow-sm transition hover:opacity-90 cursor-pointer">Simpan Nomor WA</button>
    </div>
  </form>`);

  $('#aWaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = ($('#aWaInput').value || '').trim().replace(/\D/g, '');
    let cleanWa = raw;
    if (cleanWa.startsWith('0')) cleanWa = '62' + cleanWa.slice(1);
    if (cleanWa.length < 9) return toast('Nomor WhatsApp tidak valid (minimal 9 digit).', 'err');

    try {
      const data = await api('PATCH', '/api/settings', { wa: cleanWa });
      if (catalog) catalog.wa = data.wa;
      if ($('#aWaDisplay')) $('#aWaDisplay').textContent = 'WA: ' + data.wa;
      closeADialog();
      if (window.wk?.refresh) await window.wk.refresh();
      toast('Nomor WhatsApp admin toko berhasil diperbarui: ' + data.wa);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

$('#aWaSettingBtn')?.addEventListener('click', openWaDialog);
$('#aQ').addEventListener('input', () => {
  if ($('#aQ').value.trim()) visible().forEach((p) => open.add(p.slug));
  render();
});
$('#aQClear')?.addEventListener('click', () => {
  if ($('#aQ')) $('#aQ').value = '';
  render();
});
$('#aCat').addEventListener('change', render);

$('#aCount').addEventListener('click', (e) => {
  const c = e.target.closest('[data-statchip]');
  if (!c || c.dataset.statchip === chip) return;
  chip = c.dataset.statchip;
  render();
});

document.querySelectorAll('[data-kpi]').forEach((el) => {
  el.addEventListener('click', () => {
    chip = el.dataset.kpi;
    render();
  });
});

$('#aViewGrid')?.addEventListener('click', () => {
  adminView = 'grid';
  localStorage.setItem('wk:owner:view', 'grid');
  render();
});

$('#aViewList')?.addEventListener('click', () => {
  adminView = 'list';
  localStorage.setItem('wk:owner:view', 'list');
  render();
});

$('#aExpand').addEventListener('click', () => {
  const close = $('#aExpand').dataset.all === '1';
  visible().forEach((p) => (close ? open.delete(p.slug) : open.add(p.slug)));
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#aModal').classList.contains('hidden')) closeADialog();
});

/* ==============================================================================
   Kelola Semua Pesanan Admin (Belum Dikirim & Sudah Dikirim)
   ============================================================================== */
let allAdminOrders = [];
let adminOrderFilter = 'all';
let activeAdminTab = 'products';

function switchAdminTab(tab) {
  activeAdminTab = tab;
  const prodSec = $('#aProductsSection');
  const ordSec = $('#aOrdersSection');
  const prodBtn = $('#aTabProductsBtn');
  const ordBtn = $('#aTabOrdersBtn');

  if (tab === 'orders') {
    prodSec?.classList.add('hidden');
    ordSec?.classList.remove('hidden');
    
    prodBtn?.classList.remove('bg-primary', 'text-primary-fg', 'shadow-xs');
    prodBtn?.classList.add('border', 'border-line', 'bg-surface', 'text-main');

    ordBtn?.classList.add('bg-primary', 'text-primary-fg', 'shadow-xs');
    ordBtn?.classList.remove('border', 'border-line', 'bg-surface', 'text-main');

    renderAdminOrders();
  } else {
    prodSec?.classList.remove('hidden');
    ordSec?.classList.add('hidden');

    prodBtn?.classList.add('bg-primary', 'text-primary-fg', 'shadow-xs');
    prodBtn?.classList.remove('border', 'border-line', 'bg-surface', 'text-main');

    ordBtn?.classList.remove('bg-primary', 'text-primary-fg', 'shadow-xs');
    ordBtn?.classList.add('border', 'border-line', 'bg-surface', 'text-main');
  }
  icons();
}

const isCompleted = (status) => {
  const s = String(status || '').toLowerCase();
  return s.includes('selesai') || s.includes('terkirim') || s.includes('sukses');
};

const isCancelled = (status) => {
  const s = String(status || '').toLowerCase();
  return s.includes('batal') || s.includes('kadaluarsa') || s.includes('expired');
};

const isProcessing = (status) => {
  const s = String(status || '').toLowerCase();
  if (isCompleted(status) || isCancelled(status)) return false;
  return (
    s.includes('proses') ||
    s.includes('diproses') ||
    s.includes('lunas') ||
    s.includes('verifikasi') ||
    s === 'paid' ||
    s === 'success'
  );
};

const isUnpaid = (status) => {
  const s = String(status || '').toLowerCase();
  if (isCompleted(status) || isCancelled(status) || isProcessing(status)) return false;
  return s.includes('menunggu') || s.includes('pending') || s.includes('belum bayar') || !s;
};

function updateOrderCounters() {
  const unpaid = allAdminOrders.filter(o => isUnpaid(o.status));
  const processing = allAdminOrders.filter(o => isProcessing(o.status));
  const completed = allAdminOrders.filter(o => isCompleted(o.status));
  const cancelled = allAdminOrders.filter(o => isCancelled(o.status));

  if ($('#countOrderAll')) $('#countOrderAll').textContent = allAdminOrders.length;
  if ($('#countOrderUnpaid')) $('#countOrderUnpaid').textContent = unpaid.length;
  if ($('#countOrderProcessing')) $('#countOrderProcessing').textContent = processing.length;
  if ($('#countOrderCompleted')) $('#countOrderCompleted').textContent = completed.length;
  if ($('#countOrderCancelled')) $('#countOrderCancelled').textContent = cancelled.length;
  
  if ($('#kpiPendingVal')) $('#kpiPendingVal').textContent = processing.length;
  
  const badge = $('#aPendingOrdersBadge');
  if (badge) {
    badge.textContent = processing.length;
    badge.classList.toggle('hidden', processing.length === 0);
  }
}

async function reloadOrders() {
  try {
    const res = await api('GET', '/api/orders');
    allAdminOrders = res.orders || [];
    updateOrderCounters();
    renderAdminOrders();
  } catch (err) {
    console.warn('[orders reload error]', err.message);
  }
}

function getAdminOrderStatusBadge(status) {
  const s = String(status || '').toLowerCase();
  if (isCompleted(s)) {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
      <i data-lucide="check-circle-2" class="size-3.5"></i>Pesanan Sukses
    </span>`;
  }
  if (isProcessing(s)) {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
      <i data-lucide="truck" class="size-3.5"></i>Proses Mengirim
    </span>`;
  }
  if (isCancelled(s)) {
    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
      <i data-lucide="x-circle" class="size-3.5"></i>Batal / Kadaluarsa
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
    <i data-lucide="clock" class="size-3.5"></i>Belum Bayar
  </span>`;
}

function renderAdminOrders() {
  const container = $('#aOrdersList');
  if (!container) return;

  const q = ($('#aOrderQ')?.value || '').trim().toLowerCase();

  let list = allAdminOrders.filter((o) => {
    const s = o.status || '';
    if (adminOrderFilter === 'unpaid' && !isUnpaid(s)) return false;
    if (adminOrderFilter === 'processing' && !isProcessing(s)) return false;
    if (adminOrderFilter === 'completed' && !isCompleted(s)) return false;
    if (adminOrderFilter === 'cancelled' && !isCancelled(s)) return false;

    if (q) {
      const matchCode = (o.code || '').toLowerCase().includes(q);
      const matchBuyer = (o.buyer?.name || '').toLowerCase().includes(q) || (o.buyer?.wa || '').includes(q) || (o.buyer?.email || '').toLowerCase().includes(q);
      const matchProd = (o.product?.name || '').toLowerCase().includes(q) || (o.product?.variant || '').toLowerCase().includes(q);
      return matchCode || matchBuyer || matchProd;
    }
    return true;
  });

  if (!list.length) {
    container.innerHTML = `<div class="card p-10 text-center text-sm text-muted rounded-2xl border border-line bg-surface">
      <i data-lucide="receipt" class="size-8 mx-auto mb-2 text-muted/50"></i>
      <p class="font-semibold text-main">Tidak ada data pesanan.</p>
      <p class="text-xs text-subtle mt-1">Belum ada pesanan yang sesuai dengan filter atau kata kunci saat ini.</p>
    </div>`;
    icons();
    return;
  }

  container.innerHTML = list.map((o) => {
    const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
    const buyerWa = o.buyer?.wa ? String(o.buyer.wa).replace(/\D/g, '') : '';
    const cleanWa = buyerWa.startsWith('0') ? '62' + buyerWa.slice(1) : buyerWa;
    const isDone = o.status && (o.status.includes('Selesai') || o.status.includes('Terkirim'));
    const isCancelledState = o.status && (o.status.includes('Batal') || o.status.includes('Kadaluarsa'));

    const waPesan = `Halo kak ${o.buyer?.name || 'Customer'},\nTerima kasih sudah memesan di PojokAI!\n\nBerikut akun pesanan kakak (${o.code}):\n• Produk: ${o.product?.name || ''} (${o.product?.variant || ''})\n• Email / Akun: [ISI KREDENSIAL DI SINI]\n• Password: [ISI PASSWORD]\n\nSilakan dicoba login ya kak. Simpan pesan ini sebagai bukti garansi. Ada kendala? Langsung kabari kami!`;

    return `
    <div class="card p-4 sm:p-5 rounded-2xl border border-line bg-surface space-y-3.5 shadow-xs transition hover:border-primary/40" data-order-card="${esc(o.code)}">
      <!-- Top: Kode, Tanggal & Status -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line-soft pb-3">
        <div class="flex items-center gap-2">
          <span class="font-mono text-base font-extrabold text-primary">${esc(o.code)}</span>
          <button type="button" class="a-ico size-7 rounded-lg cursor-pointer" data-copy="${esc(o.code)}" title="Salin Kode Pesanan">
            <i data-lucide="copy" class="size-3.5"></i>
          </button>
          <span class="text-xs text-subtle">• ${dateStr}</span>
        </div>
        <div>
          ${getAdminOrderStatusBadge(o.status)}
        </div>
      </div>

      <!-- Grid Data: Produk & Pembeli -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="space-y-1 rounded-xl bg-surface-2/40 p-3 border border-line-soft">
          <p class="text-[10px] uppercase font-bold text-subtle">Rincian Produk</p>
          <p class="text-sm font-bold text-main">${esc(o.product?.name || 'Produk')}</p>
          <p class="text-muted">Paket: <b class="text-main font-semibold">${esc(o.product?.variant || '-')}</b> (${o.product?.qty || 1}x)</p>
          <p class="text-muted">Total Tagihan: <span class="font-bold text-primary tabular-nums text-sm">${rp(o.total || 0)}</span></p>
          ${o.wistapay?.reference ? `<p class="text-[10px] text-muted font-mono">WistaPay: ${esc(o.wistapay.reference)}</p>` : ''}
          ${o.note ? `<p class="text-[11px] text-subtle italic mt-1 border-t border-line-soft/60 pt-1">Catatan: ${esc(o.note)}</p>` : ''}
        </div>

        <div class="space-y-1 rounded-xl bg-surface-2/40 p-3 border border-line-soft">
          <p class="text-[10px] uppercase font-bold text-subtle">Data Pembeli</p>
          <p class="text-sm font-bold text-main flex items-center gap-1.5">
            <i data-lucide="user" class="size-3.5 text-muted"></i>
            <span>${esc(o.buyer?.name || 'Pembeli')}</span>
          </p>
          <p class="text-muted flex items-center gap-1.5 font-mono">
            <i data-lucide="phone" class="size-3.5 text-success"></i>
            <span>${esc(o.buyer?.wa || '-')}</span>
          </p>
          <p class="text-muted flex items-center gap-1.5">
            <i data-lucide="mail" class="size-3.5 text-muted"></i>
            <span class="truncate">${esc(o.buyer?.email || '-')}</span>
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line-soft">
        <div class="flex items-center gap-2">
          ${cleanWa ? `
          <a href="https://wa.me/${cleanWa}?text=${encodeURIComponent(waPesan)}" target="_blank" rel="noopener" class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#25D366] px-3.5 text-xs font-bold text-white shadow-xs hover:bg-[#20ba59] transition cursor-pointer" title="Buka WhatsApp untuk kirim akun">
            <i data-lucide="message-circle" class="size-4"></i><span>Kirim Akun via WA</span>
          </a>` : ''}
        </div>
        <div class="flex items-center gap-2">
          ${isProcessing(o.status) ? `
          <button type="button" data-admin-order-status="${esc(o.code)}" data-new-status="Pesanan Sukses (Terkirim)" class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-bold text-primary-fg shadow-xs hover:opacity-90 transition cursor-pointer" title="Produk sudah berhasil dikirim">
            <i data-lucide="check" class="size-4"></i><span>Sudah Dikirim</span>
          </button>` : ''}
          ${isUnpaid(o.status) ? `
          <button type="button" data-admin-order-status="${esc(o.code)}" data-new-status="Diproses (Pembayaran Terverifikasi)" class="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 text-xs font-bold text-primary hover:bg-primary hover:text-primary-fg transition cursor-pointer" title="Tandai sudah lunas / masuk proses mengirim">
            <i data-lucide="badge-check" class="size-3.5"></i><span>Tandai Lunas</span>
          </button>` : ''}
          ${isCompleted(o.status) ? `
          <button type="button" data-admin-order-status="${esc(o.code)}" data-new-status="Diproses (Pembayaran Terverifikasi)" class="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-muted hover:text-main transition cursor-pointer" title="Kembalikan status ke Proses Mengirim">
            <i data-lucide="undo-2" class="size-3"></i><span>Buka Kembali</span>
          </button>` : ''}
          ${!isCancelled(o.status) ? `
          <button type="button" data-admin-order-status="${esc(o.code)}" data-new-status="Dibatalkan" class="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-semibold text-danger hover:bg-danger/10 transition cursor-pointer" title="Batalkan pesanan ini">
            <i data-lucide="ban" class="size-3"></i><span>Batal</span>
          </button>` : ''}
          <button type="button" data-admin-delete-order="${esc(o.code)}" class="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white transition cursor-pointer" title="Hapus kode pesanan ${esc(o.code)} secara permanen">
            <i data-lucide="x" class="size-3.5"></i><span>Hapus</span>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  icons();
}

$('#aTabProductsBtn')?.addEventListener('click', () => switchAdminTab('products'));
$('#aTabOrdersBtn')?.addEventListener('click', () => switchAdminTab('orders'));
$('#kpiPendingOrders')?.addEventListener('click', () => {
  adminOrderFilter = 'processing';
  document.querySelectorAll('#aOrderFilters button').forEach(b => b.setAttribute('aria-pressed', b.dataset.orderFilter === 'processing'));
  switchAdminTab('orders');
});

$('#aReloadOrdersBtn')?.addEventListener('click', () => reloadOrders());
$('#aClearCancelledOrdersBtn')?.addEventListener('click', async () => {
  const isCancelled = (s) => (s || '').includes('Batal') || (s || '').includes('Kadaluarsa') || (s || '').includes('Expired');
  const count = allAdminOrders.filter(o => isCancelled(o.status)).length;
  if (!count) return toast('Tidak ada pesanan berstatus batal/kadaluarsa.', 'err');
  if (confirm(`Hapus ${count} pesanan yang dibatalkan / kadaluarsa secara permanen?`)) {
    allAdminOrders = allAdminOrders.filter(o => !isCancelled(o.status));
    updateOrderCounters();
    renderAdminOrders();
    toast(`${count} pesanan berhasil dihapus!`);
    try {
      await api('DELETE', '/api/orders?type=cancelled');
      await reloadOrders();
    } catch (err) {
      console.warn('[clear cancelled error]', err);
    }
  }
});

$('#aOrderQ')?.addEventListener('input', () => renderAdminOrders());
$('#aOrderQClear')?.addEventListener('click', () => {
  $('#aOrderQ').value = '';
  $('#aOrderQClear').classList.add('hidden');
  renderAdminOrders();
});

document.querySelectorAll('#aOrderFilters button').forEach((btn) => {
  btn.addEventListener('click', () => {
    adminOrderFilter = btn.dataset.orderFilter;
    document.querySelectorAll('#aOrderFilters button').forEach(b => b.setAttribute('aria-pressed', b === btn));
    renderAdminOrders();
  });
});

document.addEventListener('click', async (e) => {
  const statusBtn = e.target.closest('[data-admin-order-status]');
  if (statusBtn) {
    const code = statusBtn.dataset.adminOrderStatus;
    const newStatus = statusBtn.dataset.newStatus;
    const found = allAdminOrders.find(o => o.code === code);
    if (found) {
      found.status = newStatus;
      updateOrderCounters();
      renderAdminOrders();
    }
    try {
      await api('PATCH', '/api/orders', { code, status: newStatus });
      toast(`Status pesanan ${code} diubah menjadi: ${newStatus}`);
      await reloadOrders();
    } catch (err) {
      toast('Gagal mengubah status: ' + err.message, 'err');
    }
    return;
  }

  const deleteBtn = e.target.closest('[data-admin-delete-order]');
  if (deleteBtn) {
    const code = deleteBtn.dataset.adminDeleteOrder;
    if (confirm(`Hapus pesanan ${code} secara permanen dari daftar?`)) {
      allAdminOrders = allAdminOrders.filter(o => o.code !== code);
      updateOrderCounters();
      renderAdminOrders();
      toast(`Pesanan ${code} berhasil dihapus permanen!`);
      try {
        await api('DELETE', '/api/orders?code=' + encodeURIComponent(code));
        await reloadOrders();
      } catch (err) {
        console.warn('[delete order error]', err);
      }
    }
    return;
  }
});

/* ---------- boot ---------- */

(async function boot() {
  const shouldOpen = (location.pathname === '/admin' || location.hash === '#admin');
  // Jika sebelumnya sedang di panel admin dan ada token, aktifkan tampilan panel langsung
  if (token && shouldOpen) {
    document.body.classList.add('admin-on');
    $('#admin').classList.remove('hidden');
  }

  try {
    const s = await api('GET', '/api/session');
    needsSetup = s.needsSetup;
    if (s.owner) {
      owner = s.owner;
      if (!token && s.owner) {
        const cm = document.cookie.match(/(?:^|;\s*)wk_token=([A-Za-z0-9._-]+)/);
        if (cm) {
          token = cm[1];
          localStorage.setItem(TOKEN_KEY, token);
        }
      }
      setLabel();
      if (shouldOpen) {
        await openPanel();
      }
    } else if (token && s.owner === null) {
      // Sesi benar-benar invalid / kedaluwarsa di server
      forgetSession();
      if (shouldOpen) openAuth();
    } else if (!token && shouldOpen) {
      openAuth();
    }
  } catch (err) {
    console.warn('[session] server lambat atau offline:', err.message);
    // Jangan hapus token jika server hanya sedang restart atau lambat merespons!
    if (token) {
      setLabel();
      if (shouldOpen) {
        setPanel(true);
        setTimeout(() => reload().catch(() => {}), 1500);
      }
    }
  }
})();
