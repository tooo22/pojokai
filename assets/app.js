const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp' + n.toLocaleString('id-ID');
const waLink = (text) => `https://wa.me/${WA_ADMIN}?text=${encodeURIComponent(text)}`;
const icons = () => lucide.createIcons();
const UNLIM = 999999;

/* ---------- Pembeli & State Auth ---------- */
const BUYER_KEY = 'wk_buyer';
const BUYER_ORDERS_KEY = 'wk_buyer_orders';

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl shadow-xl text-xs font-bold transition-all ' +
    (kind === 'err' ? 'bg-danger text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function getStoredBuyer() {
  try {
    const raw = localStorage.getItem(BUYER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredBuyer(b) {
  if (b) {
    localStorage.setItem(BUYER_KEY, JSON.stringify(b));
  } else {
    localStorage.removeItem(BUYER_KEY);
  }
  updateBuyerNav();
}

function getStoredOrders() {
  try {
    const raw = localStorage.getItem(BUYER_ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveOrderLocal(order) {
  const list = getStoredOrders();
  const idx = list.findIndex((o) => o.code === order.code);
  if (idx >= 0) list[idx] = order;
  else list.unshift(order);
  localStorage.setItem(BUYER_ORDERS_KEY, JSON.stringify(list.slice(0, 100)));
}

function generateOrderCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `POJOK-${rand}`;
}

function updateBuyerNav() {
  const label = $('#masukLabel');
  if (!label) return;
  const navLogout = $('#navLogoutBtn');
  if (window.isOwnerActive?.()) {
    label.textContent = 'Panel';
    if (navLogout) {
      navLogout.classList.remove('hidden');
      navLogout.classList.add('inline-flex');
    }
    return;
  }
  const buyer = getStoredBuyer();
  if (buyer && buyer.name) {
    const firstName = buyer.name.trim().split(/\s+/)[0] || 'Akun';
    label.textContent = firstName.length > 10 ? firstName.slice(0, 10) + '…' : firstName;
    $('#masukBtn')?.setAttribute('aria-label', `Akun: ${buyer.name}`);
    if (navLogout) {
      navLogout.classList.remove('hidden');
      navLogout.classList.add('inline-flex');
      navLogout.title = `Keluar (${buyer.name})`;
    }
  } else {
    label.textContent = 'Masuk';
    $('#masukBtn')?.setAttribute('aria-label', 'Masuk sebagai pembeli atau owner');
    if (navLogout && !window.isOwnerActive?.()) {
      navLogout.classList.add('hidden');
      navLogout.classList.remove('inline-flex');
    }
  }
}
window.getStoredBuyer = getStoredBuyer;
window.updateBuyerNav = updateBuyerNav;

let currentModalView = null; // 'product' | 'bundle' | 'auth' | 'account' | 'payment' | 'orders'
let authPendingAction = null;
let activePaymentOrder = null;
let authDraft = { name: '', wa: '', email: '', err: '' };

/* Katalog diambil dari server (server.mjs) supaya perubahan owner langsung terlihat.
   assets/data.js hanya jadi seed awal di sisi server. */
let WA_ADMIN, CATEGORIES, PRODUCTS, HERO_SLIDES, FAQS, TICKER, BUNDLE;

async function loadCatalog() {
  let res;
  const tok = localStorage.getItem('wk:owner:token') || localStorage.getItem('wk_token');
  const headers = tok ? { Authorization: 'Bearer ' + tok } : {};
  try {
    res = await fetch('/api/catalog', { cache: 'no-store', headers });
  } catch (e) {
    // network or host error, will try static fallback below
  }
  if (!res || !res.ok) {
    res = await fetch('/api/catalog.json', { cache: 'no-store', headers });
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const c = await res.json();
  try {
    const raw = localStorage.getItem('wk:custom_products');
    if (raw) {
      const serverSlugs = new Set((c.products || []).map((x) => x.slug));
      const savedProducts = JSON.parse(raw);
      if (Array.isArray(savedProducts) && serverSlugs.size > 0) {
        const cleaned = savedProducts.filter((p) => serverSlugs.has(p.slug));
        localStorage.setItem('wk:custom_products', JSON.stringify(cleaned));
      }
    }
  } catch {}
  WA_ADMIN = c.wa; CATEGORIES = c.categories; PRODUCTS = c.products;
  HERO_SLIDES = c.hero; FAQS = c.faqs; TICKER = c.ticker;
  BUNDLE = c.bundle;
}

try {
  await loadCatalog();
} catch (err) {
  const bar = document.createElement('div');
  bar.className = 'border-b border-danger/40 bg-danger/10 px-4 py-3 text-center text-[13px] font-semibold text-danger';
  bar.textContent = `Katalog tidak bisa dimuat (${err.message}). Jalankan "node server.mjs" lalu muat ulang halaman.`;
  document.body.prepend(bar);
  throw err;
}

/* Produk baru dari panel owner belum punya berkas gambar. */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.fb) return;
  const box = document.createElement('span');
  box.className = img.className + ' grid place-items-center bg-surface-2 text-[11px] font-bold uppercase text-subtle';
  box.textContent = img.dataset.fb;
  img.replaceWith(box);
}, true);

const state = { q: '', sort: 'rekomendasi', chip: null, view: localStorage.getItem('view') || 'grid' };

/* Varian yang dijual: stok > 0 termurah, kalau habis semua pakai varian pertama. */
const pick = (p) => {
  if (!p.variants) return null;
  const ok = p.variants.filter((v) => v.stock > 0);
  return ok.length ? ok.reduce((a, b) => (b.price < a.price ? b : a)) : p.variants[0];
};

const CHIPS = [
  { id: 'hot', label: 'Terlaris', icon: 'flame', test: (p) => p.hot },
  { id: 'baru', label: 'Baru', icon: 'sparkles', test: (p) => p.baru },
  { id: 'hemat', label: 'Hemat', icon: 'ticket-percent', test: (p) => !!pick(p)?.strike },
  { id: 'rating', label: 'Rating ≥4,5', icon: 'star', test: (p) => p.rating?.real },
];

/* ---------- Produk ---------- */
function stockInfo(p) {
  if (p.patungan) return ['Ikut patungan', 'font-medium text-primary'];
  const v = pick(p);
  if (!v) return ['', ''];
  if (!v.stock) return ['Stok habis', 'font-medium text-danger'];
  if (v.stock !== UNLIM && v.stock <= 5) {
    return [`Sisa ${v.stock}${p.sold ? ` · ${p.sold.toLocaleString('id-ID')} terjual` : ''}`, 'font-medium text-warning'];
  }
  if (p.sold) return [`${p.sold.toLocaleString('id-ID')} terjual`, 'tabular-nums text-muted'];
  return ['Tersedia', 'font-medium text-success'];
}

function ratingHTML(r) {
  if (!r) return '';
  return r.real
    ? `<span class="inline-flex shrink-0 items-center gap-0.5 tabular-nums text-muted"><i data-lucide="star" class="size-3 fill-warning text-warning"></i><b class="font-semibold text-main">${r.v}</b> (${r.n})</span>`
    : `<span title="Penilaian otomatis — pembeli tidak mengulas" class="inline-flex shrink-0 flex-wrap items-center gap-x-1 text-[11px] text-subtle"><span class="inline-flex items-center gap-0.5"><i data-lucide="star" class="size-3 fill-subtle/40 text-subtle"></i>${r.v}</span><span>(${r.n}) otomatis</span></span>`;
}

function variantLine(v) {
  if (v.d) return [v.d, 'text-subtle'];
  if (!v.stock) return ['Habis', 'text-danger'];
  if (v.ful === 'manual') return ['Manual', 'text-subtle'];
  return [v.stock === UNLIM ? 'Tersedia' : `Tersedia ${v.stock}`, 'text-subtle'];
}

function tagsHTML(p) {
  const t = [];
  const v = pick(p);
  const tag = 'inline-flex items-center gap-0.5 rounded-[12px] px-1.5 py-0.5 text-[10px] font-semibold leading-none';
  if (v?.strike) t.push(`<span class="${tag} bg-primary/10 text-primary">Hemat ${Math.round((1 - v.price / v.strike) * 100)}%</span>`);
  if (p.baru) t.push(`<span class="${tag} bg-success/10 text-success"><i data-lucide="sparkles" class="size-3"></i> Baru</span>`);
  if (p.noWarranty) t.push(`<span class="inline-flex shrink-0 items-center gap-0.5 rounded-[12px] bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted" title="Produk ini tidak bergaransi"><i data-lucide="shield-off" class="size-3"></i> Tanpa garansi</span>`);
  if (p.grp > 1) t.push(`<span class="${tag} bg-surface-2 text-muted">${p.grp} jenis · ${p.variants.length} pilihan</span>`);
  return t.length ? `<span class="mt-1 flex min-w-0 flex-wrap items-center gap-1">${t.join('')}</span>` : '';
}

function priceHTML(p) {
  const v = pick(p);
  const strike = v?.strike ? `<span class="text-[10px] tabular-nums text-subtle line-through sm:text-[11px]">${rp(v.strike)}</span>` : '';
  return `<span class="text-[15px] font-bold tabular-nums text-primary sm:text-lg">${v ? rp(v.price) : 'Patungan'}</span>${strike}`;
}

function badgesHTML(p) {
  const pill = 'absolute top-1.5 inline-flex items-center gap-0.5 rounded-full bg-surface/90 text-[10px] font-semibold leading-none ring-1 ring-line-soft backdrop-blur-sm';
  return (p.auto ? `<span class="${pill} left-1.5 px-1.5 py-1 text-success"><i data-lucide="zap" class="size-3"></i>Otomatis</span>` : '')
    + (p.hot ? `<span class="${pill} right-1.5 p-1 text-warning" title="Terlaris"><i data-lucide="flame" class="size-3"></i></span>` : '');
}

function cardImg(p, cls) {
  const src = p.image || `assets/products/${p.slug}.webp`;
  return `<img src="${esc(src)}" alt="Akun ${esc(p.name)}" data-fb="${esc(p.name.trim().slice(0, 2))}" loading="lazy" class="${cls}">`;
}

function gridCard(p) {
  const [stock, cls] = stockInfo(p);
  const habis = !p.patungan && !pick(p)?.stock;
  return `<button data-buy="${p.slug}" aria-label="Beli ${esc(p.name)}" class="card border-line-soft group flex h-full w-full min-w-0 flex-col gap-2 overflow-hidden p-2 text-left transition-colors duration-200 hover:border-primary/50 sm:p-2.5 ${habis ? 'opacity-55' : ''}">
    <div class="relative aspect-square w-full overflow-hidden rounded-[10px] bg-surface-2">
      ${cardImg(p, 'absolute inset-0 size-full object-cover')}
      ${badgesHTML(p)}
    </div>
    <div class="flex flex-1 flex-col px-0.5">
      <p class="line-clamp-2 text-sm font-medium leading-snug">${esc(p.name)}</p>
      ${tagsHTML(p)}
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 pt-1">${priceHTML(p)}</div>
      <div class="mt-auto flex min-w-0 items-center justify-between gap-2 border-t border-line-soft pt-1.5 text-[11px]">
        <span class="truncate ${cls}">${stock}</span>${ratingHTML(p.rating)}
      </div>
    </div>
  </button>`;
}

function listRow(p) {
  const [stock, cls] = stockInfo(p);
  const habis = !p.patungan && !pick(p)?.stock;
  return `<button data-buy="${p.slug}" class="card border-line-soft flex w-full items-center gap-3 p-2 text-left transition-colors hover:border-primary/50 ${habis ? 'opacity-55' : ''}">
    <span class="relative size-14 shrink-0 overflow-hidden rounded-[10px] bg-surface-2">${cardImg(p, 'size-full object-cover')}</span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium">${esc(p.name)}</span>
      ${tagsHTML(p)}
      <span class="mt-1 flex items-center gap-2 text-[11px]"><span class="${cls}">${stock}</span>${ratingHTML(p.rating)}</span>
    </span>
    <span class="flex shrink-0 flex-col items-end">${priceHTML(p)}</span>
  </button>`;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  const chip = CHIPS.find((c) => c.id === state.chip);
  let list = PRODUCTS.filter((p) => !p.hidden && (!q || p.name.toLowerCase().includes(q)) && (!chip || chip.test(p)));
  const lo = (p) => (p.variants ? Math.min(...p.variants.map((v) => v.price)) : Infinity);
  const hi = (p) => (p.variants ? Math.max(...p.variants.map((v) => v.price)) : -1);
  if (state.sort === 'termurah') list = [...list].sort((a, b) => lo(a) - lo(b));
  if (state.sort === 'termahal') list = [...list].sort((a, b) => hi(b) - hi(a));
  if (state.sort === 'terlaris') list = [...list].sort((a, b) => (b.sold || 0) - (a.sold || 0));
  return list;
}

function renderCatalog() {
  const list = filtered();
  const grid = state.view === 'grid';
  const html = CATEGORIES.map((c) => {
    const items = list.filter((p) => p.cat === c.id);
    if (!items.length) return '';
    return `<div id="${c.anchor}" class="scroll-mt-24 space-y-3">
      <div class="flex items-center gap-2">
        <h2 class="text-xl font-bold tracking-tight">${c.title}</h2>
        <span class="rounded-full bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-muted">${items.length}</span>
      </div>
      <div class="${grid ? 'grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6' : 'grid gap-2 sm:grid-cols-2'}">${items.map(grid ? gridCard : listRow).join('')}</div>
    </div>`;
  }).filter(Boolean).join('<div class="h-px bg-line-soft"></div>');
  $('#catalog').innerHTML = html || `<div class="card p-10 text-center text-sm text-muted">Produk tidak ditemukan. Coba kata kunci lain.</div>`;
  document.querySelectorAll('.view-btn').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === state.view));
  icons();
}

function renderChips() {
  $('#chips').innerHTML = CHIPS.map((c) => `<button data-chip="${c.id}" aria-pressed="${state.chip === c.id}" class="chip">
    <i data-lucide="${c.icon}" class="size-3.5"></i>${c.label}<span class="chip-count tabular-nums text-muted">${PRODUCTS.filter((p) => !p.hidden && c.test(p)).length}</span></button>`).join('');
}

/* ---------- Hero ---------- */
let heroTimer;

function renderHero() {
  const note = ([emoji, label], j) => `<span class="hero-note" style="animation-delay:${j * 2}s">
      <span class="flex items-center gap-2">
        <span class="grid size-6 shrink-0 place-items-center rounded-[12px] bg-white/10 text-xs sm:size-8 sm:text-base">${emoji}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[9px] font-semibold sm:text-sm">${label}</span>
          <span class="mt-1 block h-1 w-full rounded-full bg-white/15"><span class="hero-fill" style="animation-delay:${j * 2}s"></span></span>
        </span>
        <span class="text-[10px] font-bold text-white/80 sm:text-xs">✓</span>
      </span>
    </span>`;

  $('#heroTrack').innerHTML = HERO_SLIDES.map((s, i) => `<div class="block w-full shrink-0 snap-center" role="group" aria-roledescription="slide" aria-label="${i + 1} dari ${HERO_SLIDES.length}">
    <span class="relative flex aspect-[1200/375] w-full select-none items-center overflow-hidden bg-zinc-950 text-white">
      <span class="hero-blob b1"></span><span class="hero-blob b2"></span><span class="hero-blob b3"></span>
      <span class="pointer-events-none absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1px)] [background-size:16px_16px]"></span>
      <span class="pointer-events-none absolute inset-0 bg-gradient-to-r from-zinc-950/85 via-zinc-950/40 to-transparent"></span>
      <span class="relative z-[1] flex w-full items-center justify-between gap-3 px-[5%]">
        <span class="min-w-0 max-w-[58%]">
          <span class="inline-block max-w-full truncate rounded-[12px] bg-white px-1.5 py-0.5 text-[8px] font-bold uppercase text-zinc-950 sm:text-[11px] sm:tracking-wider dark:bg-primary dark:text-primary-fg">${s.eyebrow}</span>
          <span class="mt-1 block text-[clamp(14px,3.4vw,36px)] font-bold leading-[1.05] tracking-tight">${s.title}<br><span class="text-white/65 dark:text-primary">${s.line2}</span></span>
          <span class="mt-1.5 hidden text-[clamp(10px,1.3vw,14px)] text-white/60 sm:block">${s.sub}</span>
          <span class="mt-2 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
            <a href="${s.href}" draggable="false" class="inline-flex items-center gap-1 rounded-[12px] bg-white px-2 py-1 text-[9px] font-bold text-zinc-950 transition-colors hover:bg-white/85 sm:px-3.5 sm:py-2 sm:text-xs dark:bg-primary dark:text-primary-fg dark:hover:bg-primary/85">${s.cta} →</a>
            <a href="#" data-wa="Halo admin PojokAI, saya mau tanya." draggable="false" class="hidden items-center gap-1 rounded-[12px] border border-white/35 px-2 py-1 text-[9px] font-semibold text-white transition-colors hover:bg-white/10 sm:inline-flex sm:px-3.5 sm:py-2 sm:text-xs dark:border-primary/60 dark:text-primary dark:hover:bg-primary/10">💬 Chat WhatsApp</a>
          </span>
        </span>
        <span class="relative h-[62%] w-[36%] min-w-[118px] shrink-0">${s.items.map(note).join('')}</span>
      </span>
    </span>
  </div>`).join('');

  $('#heroDots').innerHTML = HERO_SLIDES.map((_, i) => `<button type="button" data-dot="${i}" aria-label="Banner ${i + 1}" class="hero-dot flex h-5 items-center px-1"><span></span></button>`).join('');
}

function showHero(i) {
  const track = $('#heroTrack');
  track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  syncDots(i);
}

function syncDots(i) {
  document.querySelectorAll('.hero-dot').forEach((d, j) => (j === i ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
}

function heroSnap() {
  const track = $('#heroTrack');
  const i = Math.round(track.scrollLeft / track.clientWidth);
  if (Math.abs(track.scrollLeft - i * track.clientWidth) > 2) {
    track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  }
  syncDots(i);
}

function startHero() {
  clearInterval(heroTimer);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  heroTimer = setInterval(() => {
    const track = $('#heroTrack');
    showHero((Math.round(track.scrollLeft / track.clientWidth) + 1) % HERO_SLIDES.length);
  }, 6000);
}

/* ---------- Paket Hemat (Bundle) ---------- */
let bm = null;

function renderBundle() {
  const sec = $('#sec-paket-hemat');
  const card = $('#paketHematCard');
  if (!sec || !card) return;
  if (!BUNDLE || BUNDLE.enabled === false) {
    sec.classList.add('hidden');
    return;
  }
  sec.classList.remove('hidden');
  const p1 = PRODUCTS.find((p) => p.slug === BUNDLE.prod1) || { name: 'Produk 1', slug: BUNDLE.prod1 };
  const p2 = PRODUCTS.find((p) => p.slug === BUNDLE.prod2) || { name: 'Produk 2', slug: BUNDLE.prod2 };

  const price = BUNDLE.price || 0;
  const strike = BUNDLE.strike || 0;
  const hemat = strike > price ? strike - price : 0;
  const badge = BUNDLE.badge || (hemat && strike ? `-${Math.round((hemat / strike) * 100)}%` : '');
  const items = Array.isArray(BUNDLE.items) ? BUNDLE.items : [];

  card.innerHTML = `
    <article class="card space-y-2 rounded-[12px] p-3">
      <div class="flex min-w-0 items-center gap-2">
        <div class="flex shrink-0 items-center gap-1">
          <img src="assets/products/${esc(p1.slug)}.webp" data-fb="${esc(p1.name.slice(0, 2))}" alt="${esc(p1.name)}" class="size-9 rounded-[10px] bg-surface-2 object-cover">
          <i data-lucide="plus" class="size-3 text-subtle"></i>
          <img src="assets/products/${esc(p2.slug)}.webp" data-fb="${esc(p2.name.slice(0, 2))}" alt="${esc(p2.name)}" class="size-9 rounded-[10px] bg-surface-2 object-cover">
        </div>
        <p class="min-w-0 flex-1 text-sm font-bold leading-snug">${esc(BUNDLE.title || `${p1.name} + ${p2.name}`)}</p>
        ${badge ? `<span class="pill shrink-0 rounded-full bg-danger px-1.5 py-px text-[10px] font-bold text-white">${esc(badge)}</span>` : ''}
      </div>
      ${items.length ? `<ul class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        ${items.map((it) => `<li class="flex items-start gap-1"><i data-lucide="check" class="mt-0.5 size-3 shrink-0 text-success"></i>${esc(it)}</li>`).join('')}
      </ul>` : ''}
      <div class="flex items-end justify-between gap-2">
        <div class="min-w-0">
          <p class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span class="text-lg font-bold tabular-nums text-danger">${rp(price)}</span>
            ${strike > price ? `<span class="text-[11px] tabular-nums text-subtle line-through">${rp(strike)}</span>` : ''}
            ${hemat > 0 ? `<span class="text-[11px] font-semibold tabular-nums text-success">Hemat ${rp(hemat)}</span>` : ''}
          </p>
          <p class="text-[11px] tabular-nums text-subtle"><span class="font-semibold text-success"><i data-lucide="zap" class="inline size-3 -translate-y-px"></i>${esc(BUNDLE.fulText || 'Otomatis')}</span> · ${esc(BUNDLE.soldText || '1 terjual hari ini')}</p>
        </div>
        <button type="button" data-bundle class="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-primary px-4 text-sm font-semibold text-primary-fg transition hover:opacity-90 cursor-pointer">
          <i data-lucide="shopping-bag" class="size-4"></i>Beli paket
        </button>
      </div>
    </article>
  `;
  icons();
}

function bundleDialogHTML() {
  if (!bm) return '';
  const b = bm.bundle;
  const p1 = bm.p1;
  const p2 = bm.p2;
  const price = b.price || 0;
  const strike = b.strike || 0;
  const hemat = strike > price ? strike - price : 0;
  const items = Array.isArray(b.items) ? b.items : [];

  const head = `<div class="shrink-0 border-b border-line-soft px-4 py-3 sm:px-5">
    <div class="flex items-center justify-between pb-2 mb-2 border-b border-line-soft">
      <button type="button" data-close aria-label="Kembali" class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-main py-1 px-2.5 -ml-2 rounded-lg transition hover:bg-surface-2 cursor-pointer">
        <i data-lucide="arrow-left" class="size-4"></i><span>Kembali</span>
      </button>
      <button type="button" data-close class="grid size-8 place-items-center rounded-[10px] text-subtle hover:bg-surface-2 hover:text-main cursor-pointer" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>
    <div class="flex min-w-0 items-center gap-3">
      <div class="flex shrink-0 items-center gap-1">
        <img src="assets/products/${esc(p1.slug)}.webp" data-fb="${esc(p1.name.slice(0, 2))}" alt="${esc(p1.name)}" class="size-10 rounded-[10px] bg-surface-2 object-cover">
        <i data-lucide="plus" class="size-3 text-subtle"></i>
        <img src="assets/products/${esc(p2.slug)}.webp" data-fb="${esc(p2.name.slice(0, 2))}" alt="${esc(p2.name)}" class="size-10 rounded-[10px] bg-surface-2 object-cover">
      </div>
      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <h2 class="truncate font-display text-base font-bold sm:text-lg">${esc(b.title)}</h2>
          ${b.badge ? `<span class="pill shrink-0 rounded-full bg-danger px-1.5 py-px text-[10px] font-bold text-white">${esc(b.badge)}</span>` : ''}
        </div>
        <p class="text-xs text-muted truncate">Paket Hemat: ${esc(p1.name)} + ${esc(p2.name)}</p>
      </div>
    </div>
  </div>`;

  const body = `<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-3 sm:px-5 space-y-3">
    <div class="rounded-xl border border-line bg-surface-2/40 p-3">
      <p class="text-xs font-bold uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5">
        <i data-lucide="sparkles" class="size-3.5 text-warning"></i>Keunggulan Paket Hemat
      </p>
      <ul class="space-y-1.5 text-xs text-main">
        ${items.map((it) => `<li class="flex items-start gap-2"><i data-lucide="check-circle-2" class="size-4 shrink-0 text-success mt-0.5"></i><span>${esc(it)}</span></li>`).join('')}
      </ul>
    </div>

    <!-- Peringatan Kontak & Kode Pesanan -->
    <div id="bmContactNotice" class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1">
      <div class="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
        <i data-lucide="alert-triangle" class="size-4 shrink-0"></i>
        <span>PENTING: Tuliskan Email & WhatsApp dengan Benar!</span>
      </div>
      <p class="text-[11px] leading-relaxed text-muted dark:text-zinc-300">
        Pastikan nomor WhatsApp dan email aktif. Data ini akan dimasukkan ke dalam <b>Kode Pesanan</b> untuk pengiriman akun serta pengecekan &amp; pelacakan status transaksi Anda.
      </p>
    </div>

    <div id="bmContactSection" class="space-y-3">
      <div>
        <label for="bmWa" class="block text-xs font-bold uppercase tracking-wider text-muted">Nomor WhatsApp <span class="text-danger">*</span></label>
        <div class="relative mt-1">
          <i data-lucide="phone" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"></i>
          <input id="bmWa" type="tel" inputmode="numeric" placeholder="Contoh: 081234567890" value="${esc(bm.wa)}" class="input h-11 w-full pl-9 text-sm font-semibold rounded-xl">
        </div>
        <p class="mt-1 text-[11px] text-subtle">Detail akun &amp; link aktivasi akan langsung dikirim ke WhatsApp ini.</p>
      </div>

      <div>
        <label for="bmEmail" class="block text-xs font-bold uppercase tracking-wider text-muted">Alamat Email <span class="text-danger">*</span></label>
        <div class="relative mt-1">
          <i data-lucide="mail" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"></i>
          <input id="bmEmail" type="email" placeholder="nama@email.com" value="${esc(bm.email)}" class="input h-11 w-full pl-9 text-sm rounded-xl">
        </div>
        <p class="mt-1 text-[11px] text-subtle">Terikat pada kode pesanan &amp; cadangan pengiriman akun.</p>
      </div>

      <div>
        <label for="bmNote" class="block text-xs font-bold uppercase tracking-wider text-muted">Catatan Tambahan (Opsional)</label>
        <input id="bmNote" type="text" placeholder="Catatan tambahan untuk pesanan ini" value="${esc(bm.note)}" class="input mt-1 h-11 w-full text-sm rounded-xl">
      </div>

      ${bm.err ? `<div id="bmErrBox" class="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger flex items-center gap-1.5"><i data-lucide="alert-circle" class="size-4 shrink-0"></i><span>${esc(bm.err)}</span></div>` : ''}
    </div>
  </div>`;

  const summary = `<div class="rounded-[10px] bg-surface-2/50 px-3 py-2.5">
    ${strike > price ? `<div class="flex items-center justify-between text-sm text-muted">
      <span>Harga Normal 2 Produk</span><span class="line-through tabular-nums">${rp(strike)}</span>
    </div>
    <div class="mt-1 flex items-center justify-between text-sm text-success font-semibold">
      <span>Hemat Spesial Bundle</span><span class="tabular-nums">−${rp(hemat)}</span>
    </div>` : ''}
    <div class="mt-1.5 flex items-center justify-between border-t border-line-soft pt-1.5">
      <span class="text-sm font-bold">Total Pembayaran</span>
      <span class="text-xl font-bold tabular-nums text-danger">${rp(price)}</span>
    </div>
  </div>`;

  const foot = `<div class="shrink-0 border-t border-line-soft bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
    ${summary}
    <button type="button" data-bundle-checkout class="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-bold uppercase tracking-wide text-primary-fg transition-colors hover:bg-primary-hover cursor-pointer">
      <i data-lucide="shopping-bag" class="size-4"></i>Beli Paket Sekarang
    </button>
    <p class="mt-2 text-center text-[11px] text-subtle">Pembayaran QRIS aman · akun terkirim otomatis</p>
  </div>`;

  return head + body + foot;
}

function renderBundleDialog() {
  const box = $('#dialog');
  if (!box || !bm) return;
  box.innerHTML = bundleDialogHTML();
  icons();
}

function openBundleModal() {
  if (!BUNDLE) return;
  const p1 = PRODUCTS.find((p) => p.slug === BUNDLE.prod1) || { name: BUNDLE.prod1, slug: BUNDLE.prod1 };
  const p2 = PRODUCTS.find((p) => p.slug === BUNDLE.prod2) || { name: BUNDLE.prod2, slug: BUNDLE.prod2 };
  m = null;
  const buyer = getStoredBuyer();
  bm = { bundle: BUNDLE, p1, p2, wa: buyer?.wa || '', email: buyer?.email || '', note: '', err: '' };
  currentModalView = 'bundle';
  renderBundleDialog();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('#dialog')?.focus({ preventScroll: true }), 60);
}

function bundleCheckout() {
  if (!bm) return;
  const buyer = getStoredBuyer() || {};

  const wa = ($('#bmWa')?.value || bm.wa || buyer.wa || '').replace(/\D/g, '');
  const email = ($('#bmEmail')?.value || bm.email || buyer.email || '').trim();

  // Validasi Nomor WhatsApp
  if (!wa || wa.length < 9 || wa.length > 15) {
    bm.err = 'Nomor WhatsApp wajib diisi dengan benar (9–15 digit) untuk menerima pesanan.';
    renderBundleDialog();
    setTimeout(() => {
      const section = $('#bmContactSection') || $('#bmWa');
      const input = $('#bmWa');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (input) {
        input.focus();
        input.classList.remove('border-line');
        input.classList.add('border-danger', 'ring-2', 'ring-danger/30');
      }
    }, 60);
    return;
  }

  // Validasi Email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    bm.err = 'Alamat Email wajib diisi dengan benar (contoh: nama@email.com) untuk terikat ke Kode Pesanan.';
    renderBundleDialog();
    setTimeout(() => {
      const section = $('#bmContactSection') || $('#bmEmail');
      const input = $('#bmEmail');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (input) {
        input.focus();
        input.classList.remove('border-line');
        input.classList.add('border-danger', 'ring-2', 'ring-danger/30');
      }
    }, 60);
    return;
  }

  bm.wa = wa;
  bm.email = email;
  bm.err = '';

  buyer.wa = wa;
  buyer.email = email;
  setStoredBuyer(buyer);

  const note = $('#bmNote')?.value.trim() || bm.note || '';
  const b = bm.bundle;
  const p1 = bm.p1;
  const p2 = bm.p2;
  const orderCode = generateOrderCode();
  const total = b.price || 0;

  const order = {
    code: orderCode,
    createdAt: new Date().toISOString(),
    total: total,
    buyer: {
      name: buyer.name || 'Pembeli',
      email: email,
      wa: wa,
    },
    product: {
      name: `Paket Hemat: ${b.title || `${p1.name} + ${p2.name}`}`,
      variant: `${p1.name} + ${p2.name}`,
      qty: 1,
      price: b.price || 0,
    },
    note: [note, `Email: ${email}`, `WA: ${wa}`].filter(Boolean).join(' | '),
    status: 'Menunggu Pengiriman',
  };

  saveOrderLocal(order);
  fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  }).catch(() => {});

  openPaymentModal(order);
}

/* ---------- FAQ & ticker ---------- */
function renderFaq() {
  $('#faq').innerHTML = FAQS.map(([q, a]) => `<details class="card group transition-colors">
    <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 font-medium">${esc(q)}
      <span class="faq-icon grid size-7 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted transition"><i data-lucide="plus" class="size-3.5"></i></span>
    </summary>
    <p class="px-4 pb-4 text-sm text-muted">${esc(a)}</p>
  </details>`).join('');
}

function renderTicker() {
  const link = (name) => `<a href="#produk" class="font-semibold text-main hover:text-primary hover:underline">${esc(name)}</a>`;
  const item = ([name, n, t]) => `<span class="inline-flex shrink-0 items-center gap-1.5 px-4 text-xs text-muted"><i data-lucide="shopping-bag" class="size-3.5 text-primary"></i>${n
    ? `${link(name)}<span>dibeli ${esc(n)}× dalam 24 jam</span><span class="text-subtle">· terakhir ${esc(t)}</span>`
    : `Seseorang membeli ${link(name)}<span class="text-subtle">· ${esc(t)}</span>`}</span><span class="shrink-0 text-subtle">•</span>`;
  const row = TICKER.map(item).join('');
  $('#ticker').innerHTML = row + row;
}

/* ---------- Dialog beli ---------- */
let m = null;

const neg = (s) => /^(jangan|hanya|tidak|tanpa|hindari)/i.test(s.trim());
const maxQty = (v) => (!v || v.stock === UNLIM ? 10 : Math.max(1, v.stock));

function dialogHTML() {
  const p = m.p;
  const v = p.variants?.[m.vi];
  const manual = v?.ful === 'manual';
  const auto = v?.ful === 'auto';
  const qty = m.qty;
  const cap = maxQty(v);
  const maxed = qty >= cap;

  const head = `<div class="shrink-0 px-4 pt-3 sm:px-5 sm:pt-4">
    <div class="drag-handle mx-auto mb-2 h-1 w-9 rounded-full bg-line sm:hidden"></div>
    <div class="flex items-center justify-between pb-2 mb-2.5 border-b border-line-soft">
      <button type="button" data-close aria-label="Kembali" class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-main py-1 px-2.5 -ml-2 rounded-lg transition hover:bg-surface-2 cursor-pointer">
        <i data-lucide="arrow-left" class="size-4"></i><span>Kembali</span>
      </button>
      <div class="flex items-center gap-1.5">
        <button type="button" data-share-product="${esc(p.slug)}" aria-label="Bagikan Produk" class="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-main py-1 px-2.5 rounded-lg border border-line bg-surface hover:bg-surface-2 transition cursor-pointer" title="Salin Link Produk">
          <i data-lucide="share-2" class="size-3.5 text-primary"></i><span>Bagikan</span>
        </button>
        <button type="button" data-close aria-label="Tutup" class="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-subtle hover:bg-surface-2 hover:text-main focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer"><i data-lucide="x" class="size-4"></i></button>
      </div>
    </div>
    <div class="flex min-w-0 items-start gap-2.5 sm:gap-3">
      <span class="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-surface-2 text-primary sm:size-12">${cardImg(p, 'size-full object-cover')}</span>
      <div class="min-w-0 flex-1 overflow-hidden">
        <p id="mName" class="text-sm font-semibold leading-snug text-main [overflow-wrap:anywhere] sm:text-base">${esc(p.name)}</p>
        <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          ${p.hot ? '<span class="inline-flex items-center gap-0.5 font-semibold text-warning"><i data-lucide="flame" class="size-3"></i>Terlaris</span>'
            : p.auto ? '<span class="inline-flex items-center gap-0.5 font-semibold text-success"><i data-lucide="zap" class="size-3"></i>Kirim otomatis ±1–2 menit</span>' : ''}
          ${p.sold ? `<span class="tabular-nums">${p.sold.toLocaleString('id-ID')} terjual</span>` : ''}
          ${p.rating?.real ? `<span class="inline-flex items-center gap-0.5 tabular-nums"><i data-lucide="star" class="size-3 fill-warning text-warning"></i><b class="font-semibold text-main">${p.rating.v}</b> (${p.rating.n})</span>` : ''}
        </p>
      </div>
    </div>
  </div>`;

  const variants = !p.variants ? '' : `<div class="mt-3">
    <p class="mb-1.5 block text-xs font-medium text-muted">Pilih varian</p>
    <div class="grid max-h-[min(40dvh,280px)] gap-2 overflow-y-auto overscroll-contain sm:max-h-none sm:overflow-visible">
      ${p.variants.map((x, i) => {
        const [line, lcls] = variantLine(x);
        const on = i === m.vi;
        return `<button type="button" data-v="${i}" aria-pressed="${on}" class="flex min-w-0 items-start gap-2 rounded-[10px] border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${on ? 'border-primary bg-primary/5' : 'border-line hover:border-primary/40'}">
          <div class="min-w-0 flex-1 overflow-hidden">
            <p class="text-sm font-medium leading-snug text-main [overflow-wrap:anywhere]">${esc(x.label)}</p>
            <p class="mt-0.5 text-[11px] ${lcls}">${esc(line)}</p>
          </div>
          <span class="flex shrink-0 flex-col items-end leading-tight">
            <span class="font-display text-sm font-bold tabular-nums text-primary whitespace-nowrap sm:text-[15px]">${rp(x.price)}</span>
            ${x.strike ? `<span class="text-[10px] tabular-nums text-subtle line-through whitespace-nowrap">${rp(x.strike)}</span>` : ''}
            ${on ? '<i data-lucide="check" class="mt-1 size-3.5 text-primary"></i>' : ''}
          </span>
        </button>`;
      }).join('')}
    </div>
  </div>`;

  const brief = !p.brief ? '' : `<div class="rounded-[12px] border border-line-soft bg-surface-2/30 px-3 py-2">
      <ul class="space-y-1">${p.brief.map((b) => `<li class="flex items-start gap-1.5 text-xs leading-snug text-main [overflow-wrap:anywhere]">${
        neg(b) ? '<i data-lucide="x" class="mt-px size-3.5 shrink-0 text-warning"></i><span class="text-muted">'
              : '<i data-lucide="check" class="mt-px size-3.5 shrink-0 text-success"></i><span>'}${esc(b)}</span></li>`).join('')}</ul>
      <a href="#${p.slug ? 'produk' : ''}" data-more class="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary hover:underline">Detail lengkap<i data-lucide="chevron-right" class="size-3"></i></a>
    </div>`;

function renderProductDescription(desc) {
  if (!desc || !desc.trim()) return '';

  const rawBlocks = desc.trim().split(/\n\s*\n/);
  let globalDelay = 0;

  // Ekstrak cuplikan ringkas & menarik untuk header saat tertutup
  const featureHighlights = [];
  for (const block of rawBlocks) {
    for (const l of block.split('\n')) {
      const clean = l.replace(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}✅✔⛔❌⚠️🚨⌛⏰⏳🪅💡🚀⭐💈💵📝•+\-]|\[[xX ]\])\s*/u, '').trim();
      if (clean && clean.length <= 35 && !/garansi|refund|batal|wajib|lapor|kadaluarsa|lewat/i.test(clean)) {
        featureHighlights.push(clean);
        if (featureHighlights.length >= 3) break;
      }
    }
    if (featureHighlights.length >= 3) break;
  }
  const previewSnippet = featureHighlights.length
    ? featureHighlights.join(' • ')
    : 'Fitur lengkap, masa aktif, garansi & cara aktivasi';

  const htmlBlocks = rawBlocks.map((block) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return '';

    const isList = lines.some(l => /^([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}✅✔⛔❌⚠️🚨⌛⏰⏳🪅💡🚀⭐💈💵📝•+\-]|\[[xX ]\])/u.test(l)) || lines.length > 1;

    if (isList) {
      const items = lines.map((line) => {
        globalDelay += 25;
        const delayMs = Math.min(globalDelay, 500);

        let iconHtml = '';
        let badgeClass = 'border-line-soft bg-surface text-main';
        let text = line;

        const emojiMatch = line.match(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}✅✔⛔❌⚠️🚨⌛⏰⏳🪅💡🚀⭐💈💵📝•+\-])\s*/u);
        const iconChar = emojiMatch ? emojiMatch[1] : '';
        if (emojiMatch) {
          text = line.slice(emojiMatch[0].length);
        }

        if (/^[✅✔]/.test(iconChar)) {
          iconHtml = '<span class="grid size-4 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-500 dark:text-emerald-400"><i data-lucide="check" class="size-2.5 stroke-[2.5]"></i></span>';
          badgeClass = 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40 text-main';
        } else if (/^[⛔❌]/.test(iconChar)) {
          iconHtml = '<span class="grid size-4 shrink-0 place-items-center rounded-full bg-rose-500/20 text-rose-500 dark:text-rose-400"><i data-lucide="x" class="size-2.5 stroke-[2.5]"></i></span>';
          badgeClass = 'border-rose-500/20 bg-rose-500/5 hover:border-rose-500/40 text-rose-600 dark:text-rose-300 font-semibold';
        } else if (/^[⚠️🚨]/.test(iconChar)) {
          iconHtml = '<span class="grid size-4 shrink-0 place-items-center rounded-full bg-amber-500/20 text-amber-500 dark:text-amber-400"><i data-lucide="alert-triangle" class="size-2.5 stroke-[2.5]"></i></span>';
          badgeClass = 'border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40 text-amber-700 dark:text-amber-300 font-medium';
        } else if (/^[⌛⏰⏳]/.test(iconChar)) {
          iconHtml = '<span class="grid size-4 shrink-0 place-items-center rounded-full bg-amber-500/20 text-amber-500 dark:text-amber-400"><i data-lucide="clock" class="size-2.5 stroke-[2.5]"></i></span>';
          badgeClass = 'border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40 text-main';
        } else if (/^[🪅💡🚀⭐]/.test(iconChar)) {
          iconHtml = `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-primary/20 text-primary text-[10px]">${iconChar}</span>`;
          badgeClass = 'border-primary/20 bg-primary/5 hover:border-primary/40 text-main';
        } else if (/^[💈💵📝]/.test(iconChar)) {
          iconHtml = `<span class="grid size-4 shrink-0 place-items-center rounded-full bg-surface-3 text-muted text-[10px]">${iconChar}</span>`;
          badgeClass = 'border-line bg-surface-2/30 hover:border-line-soft text-muted';
        } else if (iconChar) {
          iconHtml = `<span class="text-xs shrink-0">${iconChar}</span>`;
        }

        return `
        <li class="desc-item-animate flex items-start gap-2 rounded-lg border p-2 text-[11px] sm:text-xs leading-relaxed transition-all duration-150 hover:scale-[1.005] shadow-2xs ${badgeClass}" style="animation-delay: ${delayMs}ms">
          ${iconHtml}
          <span class="flex-1 min-w-0">${esc(text)}</span>
        </li>`;
      }).join('');

      return `<ul class="space-y-1">${items}</ul>`;
    }

    globalDelay += 30;
    return `<div class="desc-item-animate text-[11px] sm:text-xs leading-relaxed text-muted bg-surface border border-line-soft p-2.5 rounded-lg" style="animation-delay: ${globalDelay}ms"><p>${esc(block)}</p></div>`;
  }).join('');

  return `
  <details id="mDescSection" class="group rounded-xl border border-line bg-surface-2/30 transition-all duration-200 hover:border-primary/40">
    <summary class="flex cursor-pointer list-none items-center justify-between p-2.5 sm:p-3 text-xs font-semibold text-main select-none [&::-webkit-details-marker]:hidden">
      <div class="flex items-center gap-2 min-w-0 pr-2">
        <span class="grid size-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <i data-lucide="sparkles" class="size-3.5"></i>
        </span>
        <div class="flex flex-col min-w-0">
          <span class="font-bold text-main flex items-center gap-1.5 text-xs">
            <span>Detail &amp; Informasi Produk</span>
            <span class="rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider">Lengkap</span>
          </span>
          <span class="text-[11px] font-normal text-muted truncate mt-0.5">
            ${esc(previewSnippet)}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0 text-muted group-hover:text-main text-[11px] font-semibold transition-colors">
        <span class="group-open:hidden">Buka</span>
        <span class="hidden group-open:inline">Tutup</span>
        <i data-lucide="chevron-down" class="size-3.5 transition-transform duration-200 group-open:rotate-180"></i>
      </div>
    </summary>
    <div class="px-2.5 pb-2.5 pt-1.5 border-t border-line-soft/60 space-y-2">
      ${htmlBlocks}
    </div>
  </details>`;
}

  const ulasan = !p.rating?.real ? '' : `<div class="mt-3">
    <details class="group rounded-[10px] border border-line px-3 py-2">
      <summary class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-main [&::-webkit-details-marker]:hidden">
        <span class="inline-flex items-center gap-px">${'<i data-lucide="star" class="size-3 fill-warning text-warning"></i>'.repeat(5)}</span>
        <span>${p.rating.v}</span><span class="font-normal text-muted">· ${p.rating.n} ulasan pembeli</span>
        <i data-lucide="chevron-right" class="ml-auto size-3.5 text-subtle transition-transform group-open:rotate-90"></i>
      </summary>
      <p class="px-1 py-3 text-xs leading-relaxed text-muted">Rata-rata ${p.rating.v} dari ${p.rating.n} pembeli yang sudah menulis ulasan.</p>
    </details>
  </div>`;

  const autoNote = !p.rating ? '' : `<span class="mt-${p.rating.real ? '1.5' : '3'} inline-flex flex-wrap items-center gap-x-1 text-[11px] text-subtle">
      <span class="inline-flex items-center gap-0.5"><i data-lucide="star" class="size-3 fill-subtle/40 text-subtle"></i>${p.ar ? '5' : p.rating.v}</span>
      <span>· ${(p.ar ?? p.rating.n).toLocaleString('id-ID')} penilaian otomatis — pembeli tidak mengulas</span>
    </span>`;

  const jumlah = `<p class="mt-4 block text-xs font-medium text-muted">Jumlah</p>` + (auto
    ? `<div class="mt-1 flex min-w-0 items-center gap-2 sm:gap-3">
        <button type="button" data-step="-1" ${qty <= 1 ? 'disabled' : ''} aria-label="Kurangi" class="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-line text-main focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40"><i data-lucide="minus" class="size-4"></i></button>
        <input id="mQty" type="number" min="1" max="${cap}" value="${qty}" aria-label="Jumlah" class="h-10 w-20 min-w-0 rounded-[10px] border border-line bg-surface text-center font-display text-lg font-bold tabular-nums text-main outline-none [appearance:textfield] focus:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none">
        <button type="button" data-step="1" ${maxed ? 'disabled' : ''} aria-label="Tambah" class="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-line text-main focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40"><i data-lucide="plus" class="size-4"></i></button>
        <span class="ml-auto truncate text-xs text-subtle">maks ${cap}</span>
      </div>`
    : `<p class="mt-1 text-sm text-main"><b class="font-display tabular-nums">${qty}</b><span class="text-xs text-subtle"> · ${v ? 'produk undangan hanya 1 per pesanan' : 'satu pesanan untuk satu kursi patungan'}</span></p>`);

  const contactNotice = `
    <div id="contactNotice" class="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1">
      <div class="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
        <i data-lucide="alert-triangle" class="size-4 shrink-0"></i>
        <span>PENTING: Tuliskan Email & WhatsApp dengan Benar!</span>
      </div>
      <p class="text-[11px] leading-relaxed text-muted dark:text-zinc-300">
        Pastikan nomor WhatsApp dan email aktif. Data ini akan dimasukkan ke dalam <b>Kode Pesanan</b> untuk pengiriman akun serta pengecekan &amp; pelacakan status transaksi Anda.
      </p>
    </div>
  `;

  const contactFields = `
    <div id="buyerContactSection" class="mt-3 space-y-3">
      <div>
        <label for="mWa" class="block text-xs font-semibold text-main">
          Nomor WhatsApp <span class="text-danger">*</span>
          <span class="text-subtle font-normal"> · pengiriman &amp; notifikasi pesanan</span>
        </label>
        <div class="relative mt-1">
          <i data-lucide="phone" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"></i>
          <input id="mWa" type="tel" inputmode="numeric" placeholder="Contoh: 0812xxxxxxxx" value="${esc(m.wa)}" class="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all">
        </div>
        <p class="mt-1 text-[11px] text-subtle">Format: 0812xxxxxxxx (9–15 digit)</p>
      </div>

      <div>
        <label for="mEmail" class="block text-xs font-semibold text-main">
          Alamat Email <span class="text-danger">*</span>
          <span class="text-subtle font-normal"> · terikat ke kode pesanan &amp; cadangan pengiriman</span>
        </label>
        <div class="relative mt-1">
          <i data-lucide="mail" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"></i>
          <input id="mEmail" type="email" placeholder="nama@email.com" value="${esc(m.email)}" class="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all">
        </div>
        <p class="mt-1 text-[11px] text-subtle">Pastikan email aktif &amp; bisa menerima pesan.</p>
      </div>

      ${m.err ? `<div id="mErrBox" class="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger flex items-center gap-1.5"><i data-lucide="alert-circle" class="size-4 shrink-0"></i><span>${esc(m.err)}</span></div>` : ''}
    </div>
  `;

  const kupon = `<div class="mt-4">
    <button type="button" data-coupon class="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><i data-lucide="ticket" class="size-4"></i>Punya kode kupon?</button>
    ${m.kupon ? `<input id="mKupon" placeholder="Kode kupon" aria-label="Kode kupon" value="${esc(m.kode)}" class="mt-1.5 w-full rounded-[10px] border border-line bg-surface px-3 py-2.5 text-base text-main outline-none focus:border-primary/50 sm:text-sm">` : ''}
  </div>`;

  const customMf = (p.mf || []).filter((f) => !/^(email|e-mail|mail)$/i.test(f.trim()));
  const manualFields = !manual ? '' : customMf.map((f, i) => `<label class="mt-3 block text-xs font-medium text-muted">${esc(f)}<span class="text-danger"> · wajib</span></label>
    <input data-mf="${i}" placeholder="Isi ${f.toLowerCase()}" value="${esc(m.fields[i] || '')}" class="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2.5 text-base text-main outline-none focus:border-primary/50 sm:text-sm">`).join('');

  const manualNote = !manual ? '' : `<p class="mt-1.5 flex items-start gap-1 text-[11px] text-subtle"><i data-lucide="sparkles" class="mt-px size-3 shrink-0 text-primary"></i><span>Produk ini <b class="font-semibold text-main">diproses admin</b> setelah pembayaran terverifikasi — status &amp; cara menerimanya tampil di halaman pesanan.</span></p>`;

  const descSection = renderProductDescription(p.desc);
  const infoSection = descSection
    ? `<div class="mt-3">${descSection}</div>`
    : (brief ? `<div class="mt-3">${brief}</div>` : '');

  const body = `<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-1 sm:px-5">
    ${variants}
    ${infoSection}
    ${ulasan}${autoNote}
    ${jumlah}
    ${contactNotice}
    ${contactFields}
    ${kupon}
    ${manualFields}${manualNote}
  </div>`;

  const total = (v?.price ?? 0) * qty;
  const normal = (v?.strike ?? 0) * qty;
  const summary = `<div class="rounded-[10px] bg-surface-2/50 px-3 py-2.5">
      ${normal > total ? `<div class="flex min-w-0 items-center justify-between gap-2 text-sm text-muted">
          <span class="min-w-0 truncate">Harga normal (${qty} akun)</span><span class="shrink-0 tabular-nums line-through">${rp(normal)}</span>
        </div>
        <div class="mt-1 flex items-center justify-between text-sm text-success"><span>Hemat</span><span class="tabular-nums">−${rp(normal - total)}</span></div>`
        : `<div class="flex min-w-0 items-center justify-between gap-2 text-sm text-muted">
          <span class="min-w-0 truncate">Subtotal (${qty} akun)</span><span class="shrink-0 tabular-nums">${v ? rp(total) : 'Menyesuaikan stok'}</span>
        </div>`}
      <div class="mt-1.5 flex min-w-0 items-center justify-between gap-2 border-t border-line-soft pt-1.5">
        <span class="text-sm text-muted">Total</span>
        <span class="font-display text-lg font-bold tabular-nums text-primary sm:text-xl">${v ? rp(total) : 'Belum ditentukan'}</span>
      </div>
      <p class="mt-1 text-[11px] text-subtle">(kode unik kecil ditambahkan saat pembayaran)</p>
    </div>`;

  const label = !v ? 'Ikut patungan' : manual ? 'Lanjut ke pembayaran' : 'Beli sekarang';
  const note = !v ? 'Pembayaran QRIS aman · harga patungan dikonfirmasi admin'
    : manual ? (p.mf || []).join(' ').toLowerCase().includes('email') ? 'Pembayaran QRIS aman · undangan terkirim otomatis' : 'Pembayaran QRIS aman · diproses admin setelah bayar'
    : 'Pembayaran QRIS aman · akun terkirim otomatis';

  const foot = `<div class="shrink-0 border-t border-line-soft bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
    ${summary}
    <div class="mt-2.5 flex gap-2">
      ${auto ? `<button type="button" data-cart class="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border-2 border-primary px-3 text-sm font-bold text-main transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4"><i data-lucide="shopping-cart" class="size-4"></i><span>+ Keranjang</span></button>` : ''}
      <button type="button" data-checkout ${!v || (!v.stock && !p.patungan) ? 'disabled' : ''} class="inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-bold uppercase tracking-wide text-primary-fg transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 cursor-pointer">${v && !v.stock ? '<span class="truncate">Stok habis</span>' : `<i data-lucide="shopping-bag" class="size-4 shrink-0"></i><span class="truncate">${label}</span>`}</button>
    </div>
    <p class="mt-2 text-center text-[11px] text-subtle">${note}</p>
  </div>`;

  return head + body + foot;
}

function renderDialog() {
  const box = $('#dialog');
  const keep = document.activeElement?.id;
  const sel = '.flex-1.overflow-y-auto';
  const top = box.querySelector(sel)?.scrollTop ?? 0;
  box.innerHTML = dialogHTML();
  const sc = box.querySelector(sel);
  if (sc) sc.scrollTop = top;
  if (keep) box.querySelector('#' + keep)?.focus();
  icons();
}

function openModal(p, vi) {
  const v = vi == null ? pick(p) : p.variants[vi];
  const buyer = getStoredBuyer();
  m = { p, vi: p.variants ? p.variants.indexOf(v) : 0, qty: 1, email: buyer?.email || '', kupon: false, wa: buyer?.wa || '', kode: '', fields: [], err: '' };
  currentModalView = 'product';
  renderDialog();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('#dialog')?.focus({ preventScroll: true }), 60);

  try {
    history.replaceState(null, '', '#produk/' + p.slug);
    document.title = `${p.name} — Beli Legal & Murah di PojokAI`;
  } catch {}
}

function closeModal() {
  clearInterval(paymentTimerInterval);
  paymentTimerInterval = null;
  clearInterval(paymentPollInterval);
  paymentPollInterval = null;
  paymentSuccessHandled = false;
  isPaymentPollingBusy = false;
  const modal = $('#modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  document.documentElement.style.overflow = '';
  m = null;
  bm = null;
  currentModalView = null;
  activePaymentOrder = null;
  try {
    if (location.hash.startsWith('#produk/')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    document.title = 'PojokAI — Toko Akun Digital & Nokos OTP via WhatsApp';
  } catch {}
}

function checkout() {
  if (!m) return;
  const p = m.p;
  const v = p.variants?.[m.vi];
  const buyer = getStoredBuyer() || {};

  const wa = ($('#mWa')?.value || m.wa || buyer.wa || '').replace(/\D/g, '');
  const waRegex = /^(\+?62|08)[0-9]{7,13}$/;
  if (!wa || !waRegex.test(wa)) {
    m.err = 'Nomor WhatsApp wajib diisi dengan benar (9–15 digit) untuk menerima pesanan.';
    renderDialog();
    setTimeout(() => {
      const section = $('#buyerContactSection') || $('#mWa');
      const input = $('#mWa');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (input) {
        input.focus();
        input.classList.remove('border-line');
        input.classList.add('border-danger', 'ring-2', 'ring-danger/30');
      }
    }, 60);
    return;
  }

  const email = ($('#mEmail')?.value || m.email || buyer.email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    m.err = 'Alamat Email wajib diisi dengan benar (contoh: nama@email.com) untuk terikat ke Kode Pesanan.';
    renderDialog();
    setTimeout(() => {
      const section = $('#buyerContactSection') || $('#mEmail');
      const input = $('#mEmail');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (input) {
        input.focus();
        input.classList.remove('border-line');
        input.classList.add('border-danger', 'ring-2', 'ring-danger/30');
      }
    }, 60);
    return;
  }

  m.wa = wa;
  m.email = email;
  m.err = '';

  buyer.wa = wa;
  buyer.email = email;
  setStoredBuyer(buyer);

  const orderCode = generateOrderCode();
  const subtotal = (v?.price ?? 0) * m.qty;
  const total = subtotal;
  const noteItems = [
    m.kode?.trim() ? `Kupon: ${m.kode.trim()}` : '',
    ...(m.p.mf || []).filter((f) => !/^(email|e-mail|mail)$/i.test(f.trim())).map((f, i) => (m.fields[i] ? `${f}: ${m.fields[i]}` : '')).filter(Boolean),
    `Email: ${email}`,
    `WA: ${wa}`
  ].filter(Boolean);

  const order = {
    code: orderCode,
    createdAt: new Date().toISOString(),
    total: total,
    buyer: {
      name: buyer.name || 'Pembeli',
      email: email,
      wa: wa,
    },
    product: {
      name: p.name,
      variant: v ? v.label : 'Ikut patungan',
      qty: m.qty,
      price: v ? v.price : 0,
    },
    note: noteItems.join(' | '),
    status: 'Menunggu Pengiriman',
  };

  saveOrderLocal(order);
  fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  }).catch(() => {});

  openPaymentModal(order);
}


/* ---------- Modal Autentikasi Pembeli ---------- */
function buyerAuthDialogHTML() {
  return `
  <form id="buyerAuthForm" class="p-5 space-y-4">
    <div class="flex items-center justify-between pb-3 border-b border-line-soft">
      <div class="flex items-center gap-2.5">
        <button type="button" class="a-ico size-8 rounded-xl cursor-pointer" data-auth-back title="Kembali" aria-label="Kembali"><i data-lucide="arrow-left" class="size-4"></i></button>
        <div class="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <i data-lucide="shield-check" class="size-5"></i>
        </div>
        <div>
          <h2 class="text-base font-bold">Masuk ke Akun</h2>
          <p class="text-[12px] text-subtle">Kelola riwayat belanja &amp; pesanan kamu.</p>
        </div>
      </div>
      <button type="button" class="a-ico size-8 rounded-xl cursor-pointer" data-close title="Tutup" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>

    <!-- OAuth Options -->
    <div class="space-y-2 pt-1">
      <p class="text-[11px] font-semibold text-subtle uppercase tracking-wider">Login Cepat dengan Akun</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" id="buyerOAuthGoogle" class="group inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-main transition hover:bg-surface-2 hover:border-primary/50 shadow-2xs cursor-pointer">
          <svg class="size-4 shrink-0" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.1-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.1c0 2.8.7 5.4 1.9 7.8l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.2 7.5 23.5 12 23.5z"/></svg>
          <span>Google</span>
        </button>
        <button type="button" id="buyerOAuthGithub" class="group inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold text-main transition hover:bg-surface-2 hover:border-primary/50 shadow-2xs cursor-pointer">
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
      <label class="block text-[13px] font-semibold text-main">Email
        <input id="bEmailInput" class="input mt-1 h-10 w-full rounded-xl" type="email" required autocomplete="username" placeholder="nama@email.com" value="${esc(authDraft.email)}">
      </label>
      <label class="block text-[13px] font-semibold text-main">Password
        <input id="bPassInput" class="input mt-1 h-10 w-full rounded-xl" type="password" autocomplete="current-password" placeholder="Minimal 8 karakter">
      </label>
    </div>

    ${authDraft.err ? `<p id="bErr" class="text-xs text-danger font-medium">${esc(authDraft.err)}</p>` : ''}

    <div class="flex items-center justify-end gap-2.5 pt-3 border-t border-line-soft">
      <button type="button" class="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 text-[13px] font-semibold text-main transition hover:bg-surface-2 cursor-pointer" data-close>Batal</button>
      <button type="submit" class="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-[13px] font-bold text-primary-fg shadow-sm transition hover:opacity-90 cursor-pointer">Masuk</button>
    </div>

    <div class="pt-2 border-t border-line-soft/60 text-center">
      <button type="button" id="buyerGoOwnerAuth" class="text-xs text-subtle hover:text-main underline decoration-dotted transition cursor-pointer">
        Pemilik Toko? Masuk ke Panel Owner / Admin &rarr;
      </button>
    </div>
  </form>
  `;
}

function renderBuyerAuthDialog() {
  const box = $('#dialog');
  if (!box) return;
  box.innerHTML = buyerAuthDialogHTML();
  icons();
}

function openBuyerAuthModal(opts = {}) {
  authPendingAction = opts.onSuccess || null;
  const buyer = getStoredBuyer();
  authDraft = {
    name: buyer?.name || '',
    wa: buyer?.wa || (m?.wa || bm?.wa || ''),
    email: buyer?.email || '',
    err: '',
  };
  currentModalView = 'auth';
  renderBuyerAuthDialog();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('#dialog')?.focus({ preventScroll: true }), 60);
}

async function handleBuyerAuthSubmit(e) {
  e.preventDefault();
  const email = ($('#bEmailInput')?.value || '').trim().toLowerCase();
  const pass = ($('#bPassInput')?.value || '');
  if (!email || !email.includes('@') || !email.includes('.')) {
    authDraft.err = 'Masukkan alamat email yang valid.';
    return renderBuyerAuthDialog();
  }
  if (!pass || pass.length < 8) {
    authDraft.err = 'Password wajib diisi (minimal 8 karakter).';
    return renderBuyerAuthDialog();
  }

  // 1. Coba login password owner
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token && data.owner) {
        localStorage.setItem('wk_token', data.token);
        localStorage.setItem('wk:owner:token', data.token);
        localStorage.setItem('wk:admin_active', '1');
        closeModal();
        toast('Berhasil masuk sebagai Owner: ' + data.owner.email);
        if (typeof window.openOwnerPanel === 'function') window.openOwnerPanel();
        else location.href = '/admin';
        return;
      }
    } else if (email === '3t.ardiansyah@gmail.com') {
      authDraft.err = 'Password salah untuk akun Owner.';
      return renderBuyerAuthDialog();
    }
  } catch {}

  // 2. Simpan sebagai akun pembeli lokal
  const rawName = email.split('@')[0].replace(/[._-]/g, ' ');
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const buyer = {
    name,
    email,
    wa: authDraft.wa || '',
    loginType: 'password',
  };
  setStoredBuyer(buyer);
  toast(`Selamat datang, ${name}!`);

  const cb = authPendingAction;
  authPendingAction = null;
  if (cb) {
    cb();
  } else {
    closeModal();
  }
}

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



async function handleBuyerGoogleLogin() {
  const GOOGLE_CLIENT_ID = '882960778924-qnagvcduvc341a89bh7v8af2h3dbhhtg.apps.googleusercontent.com';

  if (window.google?.accounts?.oauth2) {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'email profile openid',
      callback: async (resp) => {
        if (resp?.error || !resp?.access_token) return;
        try {
          // 1. Coba verifikasi apakah akun ini adalah owner terdaftar
          const vRes = await fetch('/api/oauth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'google', accessToken: resp.access_token }),
          });
          if (vRes.ok) {
            const data = await vRes.json();
            if (data.token && data.owner) {
              localStorage.setItem('wk:owner:token', data.token);
              localStorage.setItem('wk_token', data.token);
              localStorage.setItem('wk:admin_active', '1');
              document.cookie = `wk_token=${data.token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`;
              closeModal();
              toast('Berhasil masuk sebagai Owner: ' + data.owner.email);
              if (typeof window.openOwnerPanel === 'function') window.openOwnerPanel();
              else location.href = '/admin';
              return;
            }
          }

          // 2. Jika bukan akun owner, ambil profil Google sebagai akun pembeli
          const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${resp.access_token}` },
          });
          if (uRes.ok) {
            const uData = await uRes.json();
            const email = (uData.email || '').toLowerCase();
            const name = uData.name || uData.given_name || email.split('@')[0];
            const buyer = { name, email, wa: authDraft.wa || '', oauth: 'google', picture: uData.picture };
            setStoredBuyer(buyer);
            toast(`Berhasil masuk Google: ${name}`);
            closeModal();
          }
        } catch (err) {
          console.warn('[google oauth error]', err);
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
          const payload = decodeGoogleJwt(resp.credential);
          if (!payload || !payload.email) return promptBuyerGoogle();

          const email = payload.email.toLowerCase();
          const name = payload.name || payload.given_name || email.split('@')[0];

          try {
            const vRes = await fetch('/api/oauth/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider: 'google', idToken: resp.credential }),
            });
            if (vRes.ok) {
              const data = await vRes.json();
              if (data.token && data.owner) {
                localStorage.setItem('wk:owner:token', data.token);
                localStorage.setItem('wk_token', data.token);
                localStorage.setItem('wk:admin_active', '1');
                document.cookie = `wk_token=${data.token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; SameSite=Lax`;
                closeModal();
                toast('Berhasil masuk sebagai Owner: ' + data.owner.email);
                if (typeof window.openOwnerPanel === 'function') window.openOwnerPanel();
                else location.href = '/admin';
                return;
              }
            }
          } catch {}

          const buyer = { name, email, wa: authDraft.wa || '', oauth: 'google', picture: payload.picture };
          setStoredBuyer(buyer);
          toast(`Berhasil masuk Google: ${name}`);
          closeModal();
        } catch {
          promptBuyerGoogle();
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.prompt();
    return;
  }
  promptBuyerGoogle();
}

async function promptBuyerGoogle() {
  const email = prompt('Masukkan Email Google Anda (OAuth):', authDraft.email || '');
  if (!email || !email.includes('@')) return;
  const cleanEmail = email.trim().toLowerCase();
  const defName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ');
  const name = prompt('Nama Google Anda:', authDraft.name || defName) || defName;
  const buyer = {
    name: name.trim(),
    email: cleanEmail,
    wa: authDraft.wa || '',
    oauth: 'google',
  };
  setStoredBuyer(buyer);
  toast(`Berhasil masuk Google (${buyer.name})!`);

  const cb = authPendingAction;
  authPendingAction = null;
  if (cb) cb();
  else closeModal();
}

function handleBuyerGithubLogin() {
  const user = prompt('Masukkan Username GitHub Anda:', 'github-user');
  if (!user || !user.trim()) return;
  const clean = user.trim().replace(/^@/, '');
  const buyer = {
    name: clean,
    email: `${clean}@users.noreply.github.com`,
    wa: authDraft.wa || '',
    oauth: 'github',
  };
  setStoredBuyer(buyer);
  toast(`Berhasil masuk GitHub (${buyer.name})!`);

  const cb = authPendingAction;
  authPendingAction = null;
  if (cb) cb();
  else closeModal();
}

/* ---------- Modal Profil Akun Pembeli ---------- */
function buyerAccountDialogHTML() {
  const buyer = getStoredBuyer() || { name: 'Pembeli', wa: '', email: '' };
  const orders = getStoredOrders();
  return `
  <div class="shrink-0 border-b border-line-soft px-4 py-3 sm:px-5">
    <div class="flex items-center justify-between pb-2 mb-2 border-b border-line-soft">
      <button type="button" data-close aria-label="Kembali" class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-main py-1 px-2.5 -ml-2 rounded-lg transition hover:bg-surface-2 cursor-pointer">
        <i data-lucide="arrow-left" class="size-4"></i><span>Kembali</span>
      </button>
      <button type="button" data-close class="grid size-8 place-items-center rounded-[10px] text-subtle hover:bg-surface-2 hover:text-main cursor-pointer" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>
    <div class="flex items-center gap-3">
      <div class="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary font-bold text-base">
        ${esc(buyer.name.trim().slice(0, 2).toUpperCase())}
      </div>
      <div class="min-w-0">
        <h2 class="font-display text-base font-bold sm:text-lg truncate">${esc(buyer.name)}</h2>
        <p class="text-xs text-muted truncate">${esc(buyer.wa)} ${buyer.email ? `· ${esc(buyer.email)}` : ''}</p>
      </div>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 space-y-3">
    <div class="rounded-xl border border-line bg-surface-2/40 p-3 flex items-center justify-between">
      <div>
        <p class="text-xs text-muted">Total Riwayat Pesanan</p>
        <p class="text-lg font-bold font-display text-main">${orders.length} Transaksi</p>
      </div>
      <button type="button" id="buyerGoOrdersBtn" class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-fg hover:opacity-90 transition cursor-pointer">
        <i data-lucide="receipt" class="size-4"></i><span>Lihat Pesanan</span>
      </button>
    </div>

    <div class="pt-2">
      <button type="button" id="buyerLogoutBtn" class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger/5 text-xs font-bold text-danger hover:bg-danger/10 transition cursor-pointer">
        <i data-lucide="log-out" class="size-4"></i><span>Keluar dari Akun Pembeli</span>
      </button>
    </div>
  </div>

  <div class="shrink-0 border-t border-line-soft bg-surface-2/40 px-4 py-3 sm:px-5 text-center">
    <button type="button" id="buyerGoOwnerAuth2" class="text-xs text-subtle hover:text-main underline decoration-dotted transition cursor-pointer">
      Pemilik Toko? Masuk ke Panel Owner / Admin &rarr;
    </button>
  </div>
  `;
}

function openBuyerAccountModal() {
  const buyer = getStoredBuyer();
  if (!buyer) return openBuyerAuthModal();
  currentModalView = 'account';
  const box = $('#dialog');
  if (!box) return;
  box.innerHTML = buyerAccountDialogHTML();
  icons();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('#dialog')?.focus({ preventScroll: true }), 60);
}

/* ---------- Modal Pembayaran QRIS Dinamis WistaPay ---------- */
function paymentDialogHTML(order) {
  const pName = esc(order.product?.name || 'Produk');
  const pVar = esc(order.product?.variant || '');
  const qty = order.product?.qty || 1;
  const total = order.total || 0;
  const buyerWa = esc(order.buyer?.wa || '');

  return `
  <div class="shrink-0 border-b border-line-soft px-4 py-3 sm:px-5">
    <div class="flex items-center justify-between pb-2 mb-2 border-b border-line-soft">
      <button type="button" data-close aria-label="Kembali" class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-main py-1 px-2.5 -ml-2 rounded-lg transition hover:bg-surface-2 cursor-pointer">
        <i data-lucide="arrow-left" class="size-4"></i><span>Kembali</span>
      </button>
      <button type="button" data-close class="grid size-8 place-items-center rounded-[10px] text-subtle hover:bg-surface-2 hover:text-main cursor-pointer" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>
    <div class="flex items-center justify-between">
      <div>
        <h2 class="font-display text-base font-bold sm:text-lg">Pembayaran QRIS Dinamis</h2>
        <p class="text-xs text-muted">Scan QRIS &amp; pembayaran terverifikasi otomatis</p>
      </div>
      <span class="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
        <i data-lucide="zap" class="size-3.5"></i>WistaPay Dynamic
      </span>
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3.5 sm:px-5 space-y-3">
    <!-- Kode Pesanan -->
    <div class="rounded-xl border border-line bg-surface-2/60 p-3 flex items-center justify-between">
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wider text-muted">Kode Pesanan</p>
        <p class="font-mono text-base font-bold text-primary tracking-wide">${esc(order.code)}</p>
      </div>
      <button type="button" data-copy="${esc(order.code)}" class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-main hover:bg-surface-2 transition cursor-pointer">
        <i data-lucide="copy" class="size-3.5"></i><span>Salin</span>
      </button>
    </div>

    <!-- 5-Minute Countdown Banner -->
    <div id="qrisTimerBanner" class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-center justify-between text-amber-700 dark:text-amber-400">
      <div class="flex items-center gap-2">
        <i data-lucide="timer" class="size-4 animate-pulse text-amber-600 dark:text-amber-400"></i>
        <span class="text-xs font-semibold">Sisa Waktu Pembayaran:</span>
      </div>
      <div id="qrisTimer" class="font-mono text-sm font-extrabold tracking-wider tabular-nums bg-surface px-2.5 py-0.5 rounded-lg border border-amber-500/35 text-amber-600 dark:text-amber-400 shadow-2xs">
        05:00
      </div>
    </div>

    <!-- Dynamic QRIS Card -->
    <div class="rounded-2xl border border-line bg-white p-3.5 text-center shadow-sm text-zinc-900">
      <!-- QRIS National Header Branding -->
      <div class="flex items-center justify-between pb-2 mb-2 border-b border-zinc-100">
        <div class="flex items-center gap-1.5">
          <span class="font-black text-rose-600 tracking-tighter text-sm font-sans">QRIS</span>
          <span class="text-[9.5px] font-medium text-zinc-500 leading-tight text-left">QR Code Standar<br>Pembayaran Nasional</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="rounded px-1.5 py-0.5 bg-rose-600 text-white font-black text-[10px] tracking-wider">GPN</span>
        </div>
      </div>

      <div id="qrisContainer" class="relative mx-auto w-full max-w-[270px] sm:max-w-[290px] overflow-hidden rounded-xl bg-white flex flex-col items-center justify-center min-h-[260px]">
        <!-- Loading State -->
        <div id="qrisLoading" class="${order.wistapay?.qris_image ? 'hidden' : 'flex'} flex-col items-center justify-center py-12 space-y-3 text-zinc-500">
          <i data-lucide="loader-2" class="size-9 animate-spin text-primary"></i>
          <div>
            <p class="text-xs font-bold text-zinc-800">Menghubungkan ke WistaPay Gateway...</p>
            <p class="text-[11px] text-zinc-400 mt-0.5">Membuat QRIS Dinamis Otomatis</p>
          </div>
        </div>

        <!-- Error State -->
        <div id="qrisError" class="hidden flex-col items-center justify-center py-8 px-4 text-center space-y-3">
          <div class="grid size-12 place-items-center rounded-full bg-rose-100 text-rose-600">
            <i data-lucide="alert-circle" class="size-6"></i>
          </div>
          <div>
            <p class="text-xs font-bold text-zinc-800" id="qrisErrorMsg">Gagal memuat QRIS WistaPay</p>
            <p class="text-[11px] text-zinc-500 mt-0.5">Pastikan nominal &gt;= Rp1.000 dan jaringan lancar.</p>
          </div>
          <button type="button" id="btnRetryQris" class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-fg hover:opacity-90 transition cursor-pointer">
            <i data-lucide="refresh-cw" class="size-3.5"></i><span>Coba Buat QRIS Lagi</span>
          </button>
        </div>

        <!-- QR Image -->
        <img id="qrisImg" src="${order.wistapay?.qris_image || ''}" alt="QRIS Dinamis WistaPay" class="${order.wistapay?.qris_image ? '' : 'hidden'} mx-auto block size-60 rounded-xl object-contain p-1 border border-zinc-100 bg-white shadow-2xs">
      </div>

      <div class="mt-2.5 border-t border-zinc-100 pt-2 text-zinc-800 space-y-1">
        <p id="qrisStatusText" class="text-xs font-bold text-emerald-600 flex items-center justify-center gap-1.5">
          <span class="inline-block size-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Menunggu Pembayaran (Otomatis Terverifikasi)</span>
        </p>
        <p id="qrisRefDisplay" class="text-[10px] text-zinc-400 font-mono">
          ${order.wistapay?.reference ? `Ref: ${esc(order.wistapay.reference)} · QRIS Dinamis WistaPay` : 'QRIS Dinamis Otomatis · WistaPay Gateway'}
        </p>
      </div>
    </div>

    <!-- Total Nominal -->
    <div class="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-center justify-between">
      <div>
        <p class="text-[11px] font-semibold text-muted">Total Pembayaran Pas</p>
        <p id="qrisTotalDisplay" class="text-xl font-bold font-display text-primary tabular-nums">${rp(total)}</p>
        <p class="text-[10px] text-muted mt-0.5">Bebas Biaya Admin · Biaya Transaksi Ditanggung Toko</p>
      </div>
      <button type="button" data-copy="${total}" class="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-fg hover:opacity-90 transition cursor-pointer">
        <i data-lucide="copy" class="size-3.5"></i><span>Salin Nominal</span>
      </button>
    </div>

    <!-- Ringkasan Produk -->
    <div class="rounded-xl border border-line bg-surface-2/30 p-2.5 text-xs space-y-1">
      <div class="flex justify-between text-muted">
        <span>Produk:</span><b class="text-main font-semibold">${pName}</b>
      </div>
      <div class="flex justify-between text-muted">
        <span>Paket:</span><span class="text-main">${pVar} (${qty}x)</span>
      </div>
      <div class="flex justify-between text-muted">
        <span>No. WhatsApp:</span><span class="text-main font-mono">${buyerWa}</span>
      </div>
      ${order.buyer?.email ? `<div class="flex justify-between text-muted"><span>Email:</span><span class="text-main">${esc(order.buyer.email)}</span></div>` : ''}
    </div>

    <!-- Petunjuk Singkat QRIS Dinamis -->
    <div class="text-[11px] text-subtle leading-relaxed bg-surface-2/20 rounded-xl p-3 border border-line-soft space-y-1.5">
      <p class="font-bold text-main flex items-center gap-1.5"><i data-lucide="sparkles" class="size-3.5 text-primary"></i>Panduan Pembayaran QRIS Dinamis:</p>
      <ol class="list-decimal list-inside space-y-1 text-muted">
        <li>Buka aplikasi m-Banking (BCA, Mandiri, BRI, BNI) atau e-Wallet (GoPay, OVO, DANA, ShopeePay).</li>
        <li>Scan QRIS Dinamis di atas. Nominal <b>${rp(total)}</b> otomatis terkunci (tidak perlu ketik nominal manual).</li>
        <li>Konfirmasi pembayaran &amp; masukkan PIN Anda.</li>
        <li>Selesai! Sistem WistaPay langsung memverifikasi transaksi Anda dalam hitungan detik tanpa perlu kirim bukti transfer.</li>
      </ol>
    </div>
  </div>

  <!-- Footer Actions -->
  <div class="shrink-0 border-t border-line-soft bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 space-y-2">
    <button type="button" id="btnManualCheckStatus" class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-primary-fg text-[14px] font-bold shadow-md hover:bg-primary-hover active:scale-[0.99] transition cursor-pointer">
      <i data-lucide="refresh-cw" class="size-4 shrink-0"></i>
      <span>Cek Status Pembayaran Sekarang</span>
    </button>
    <div class="flex items-center justify-between px-1 text-[11px] text-muted">
      <span>Butuh bantuan?</span>
      <a href="https://wa.me/${WA_ADMIN}?text=${encodeURIComponent(`Halo admin, saya butuh bantuan untuk pesanan ${order.code}`)}" target="_blank" rel="noopener" class="font-semibold text-primary hover:underline inline-flex items-center gap-1">
        <i data-lucide="message-circle" class="size-3.5"></i><span>Chat WhatsApp Admin</span>
      </a>
    </div>
  </div>
  `;
}

let paymentPollInterval = null;
let paymentTimerInterval = null;
let isPaymentPollingBusy = false;
let paymentSuccessHandled = false;

function startPaymentTimer(order) {
  clearInterval(paymentTimerInterval);
  
  const createdTime = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
  const expireTime = createdTime + 5 * 60 * 1000;

  const tick = () => {
    const now = Date.now();
    const diff = Math.max(0, Math.floor((expireTime - now) / 1000));
    
    const timerEl = $('#qrisTimer');
    if (timerEl) {
      const m = String(Math.floor(diff / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
      
      if (diff < 60) {
        timerEl.className = 'font-mono text-sm font-extrabold tracking-wider tabular-nums bg-rose-500/15 px-2.5 py-0.5 rounded-lg border border-rose-500/40 text-rose-600 dark:text-rose-400 animate-pulse';
      }
    }
    
    if (diff <= 0) {
      clearInterval(paymentTimerInterval);
      paymentTimerInterval = null;
      clearInterval(paymentPollInterval);
      paymentPollInterval = null;
      onPaymentExpired(order);
    }
  };

  tick();
  paymentTimerInterval = setInterval(tick, 1000);
}

function onPaymentExpired(order) {
  order.status = 'Dibatalkan (Waktu Habis)';
  saveOrderLocal(order);
  
  fetch('/api/orders/expire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: order.code })
  }).catch(() => {});

  const container = $('#qrisContainer');
  if (container) {
    let overlay = $('#qrisExpiredOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'qrisExpiredOverlay';
      overlay.className = 'absolute inset-0 bg-black/80 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 text-center rounded-xl text-white z-10';
      overlay.innerHTML = `
        <span class="grid size-11 place-items-center rounded-full bg-rose-500 text-white mb-2 shadow-lg">
          <i data-lucide="x-circle" class="size-6"></i>
        </span>
        <p class="text-sm font-bold">Waktu Pembayaran Habis</p>
        <p class="text-[11px] text-white/70 mt-1 max-w-[200px]">Batas 5 menit terlewati. Transaksi ini dibatalkan otomatis.</p>
      `;
      container.appendChild(overlay);
      icons();
    }
  }

  const statusText = $('#qrisStatusText');
  if (statusText) {
    statusText.className = 'text-xs font-bold text-rose-600 flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-rose-50 dark:bg-rose-950/40';
    statusText.innerHTML = '<i data-lucide="alert-octagon" class="size-4 text-rose-600"></i><span>Pesanan Dibatalkan (Waktu Habis)</span>';
    icons();
  }

  const ctaBtn = document.querySelector('[data-confirm-transfer]');
  if (ctaBtn) {
    ctaBtn.className = 'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-surface-2 border border-line text-main text-[14px] font-bold shadow hover:bg-surface-3 transition cursor-pointer';
    ctaBtn.innerHTML = '<i data-lucide="rotate-ccw" class="size-4.5 text-muted"></i><span>Waktu Habis · Buat Pesanan Baru</span>';
    ctaBtn.removeAttribute('data-confirm-transfer');
    ctaBtn.setAttribute('data-close', 'true');
    icons();
  }
}
async function requestDynamicQris(order) {
  const qImg = $('#qrisImg');
  const qLoad = $('#qrisLoading');
  const qErr = $('#qrisError');
  const qErrMsg = $('#qrisErrorMsg');

  // Reset to loading state
  if (qLoad) { qLoad.classList.remove('hidden'); qLoad.classList.add('flex'); }
  if (qImg) { qImg.classList.add('hidden'); }
  if (qErr) { qErr.classList.add('hidden'); qErr.classList.remove('flex'); }

  try {
    const res = await fetch('/api/qris/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.code,
        amount: order.total,
        description: `Beli ${order.product?.name || 'Produk'} - ${order.code}`
      })
    });
    const json = await res.json();
    if (json.success && json.data) {
      order.wistapay = json.data;
      saveOrderLocal(order);
      const totalDisp = $('#qrisTotalDisplay');
      if (totalDisp && json.data.charge_amount) {
        totalDisp.textContent = rp(json.data.charge_amount);
      }
      const refDisp = $('#qrisRefDisplay');
      if (refDisp && json.data.reference) {
        refDisp.textContent = `Ref: ${json.data.reference} · QRIS Dinamis WistaPay`;
      }
      if (qImg && qLoad) {
        qImg.src = json.data.qris_image || json.data.payment_url;
        qImg.classList.remove('hidden');
        qLoad.classList.remove('flex');
        qLoad.classList.add('hidden');
      }
      startPaymentPolling(order, json.data.reference);
      return;
    }
    throw new Error(json.error || json.message || 'Gagal membuat QRIS WistaPay');
  } catch (err) {
    console.error('[qris dynamic error]', err);
    if (qLoad) { qLoad.classList.remove('flex'); qLoad.classList.add('hidden'); }
    if (qImg) { qImg.classList.add('hidden'); }
    if (qErr) {
      qErr.classList.remove('hidden');
      qErr.classList.add('flex');
      if (qErrMsg) qErrMsg.textContent = err.message || 'Gagal memuat QRIS Dinamis WistaPay';
      icons();
    }
  }
}

function startPaymentPolling(order, reference) {
  clearInterval(paymentPollInterval);
  isPaymentPollingBusy = false;
  
  const checkStatusNow = async () => {
    if (paymentSuccessHandled) {
      clearInterval(paymentPollInterval);
      paymentPollInterval = null;
      return;
    }
    if (currentModalView !== 'payment' || !activePaymentOrder || activePaymentOrder.code !== order.code) {
      clearInterval(paymentPollInterval);
      paymentPollInterval = null;
      return;
    }
    if (isPaymentPollingBusy) return;
    isPaymentPollingBusy = true;
    
    try {
      const res = await fetch(`/api/qris/status?order_id=${encodeURIComponent(order.code)}&reference=${encodeURIComponent(reference || '')}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.status === 'PAID' || json.status === 'SUCCESS' || (json.orderStatus && json.orderStatus.includes('Diproses'))) {
        clearInterval(paymentPollInterval);
        paymentPollInterval = null;
        onPaymentSuccess(order);
      }
    } catch {}
    finally {
      isPaymentPollingBusy = false;
    }
  };

  // Check immediately after 800ms, then poll every 1500ms
  setTimeout(checkStatusNow, 800);
  paymentPollInterval = setInterval(checkStatusNow, 1500);
}

function playSuccessChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // Suara notifikasi pembayaran 1x jernih ("ting" lonceng manis tanpa nada ganda berulang)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.50, now); // C6 bell tone

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.55);

    setTimeout(() => {
      try { ctx.close(); } catch {}
    }, 600);
  } catch {}
}

function launchSuccessConfetti() {
  try {
    const canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    canvas.className = 'fixed inset-0 pointer-events-none z-[100]';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const colors = ['#10B981', '#3B82F6', '#F59E0B', '#EC4899', '#8B5CF6', '#84cc16'];
    const pieces = [];
    for (let i = 0; i < 90; i++) {
      pieces.push({
        x: window.innerWidth * (0.3 + Math.random() * 0.4),
        y: window.innerHeight * 0.35,
        r: Math.random() * 6 + 4,
        d: Math.random() * 90,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleInc: (Math.random() * 0.07) + 0.05,
        tiltAngle: 0,
        vx: (Math.random() - 0.5) * 14,
        vy: (Math.random() - 0.7) * 16 - 4,
        gravity: 0.35,
        opacity: 1
      });
    }

    let animationId;
    const start = Date.now();
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const elapsed = Date.now() - start;
      if (elapsed > 3500) {
        cancelAnimationFrame(animationId);
        canvas.remove();
        return;
      }
      pieces.forEach(p => {
        p.tiltAngle += p.tiltAngleInc;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.98;
        p.opacity = Math.max(0, 1 - elapsed / 3500);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.beginPath();
        ctx.lineWidth = p.r / 2;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
        ctx.stroke();
        ctx.restore();
      });
      animationId = requestAnimationFrame(draw);
    }
    animationId = requestAnimationFrame(draw);
  } catch {}
}

function onPaymentSuccess(order) {
  if (paymentSuccessHandled) return;
  paymentSuccessHandled = true;

  clearInterval(paymentTimerInterval);
  paymentTimerInterval = null;
  clearInterval(paymentPollInterval);
  paymentPollInterval = null;

  order.status = 'Diproses (Pembayaran Terverifikasi)';
  saveOrderLocal(order);

  playSuccessChime();
  launchSuccessConfetti();

  // Langsung tampilkan popup transaksi berhasil tanpa delay/kedip
  openPaymentSuccessModal(order);
}

function openPaymentSuccessModal(order) {
  clearInterval(paymentTimerInterval);
  paymentTimerInterval = null;
  clearInterval(paymentPollInterval);
  paymentPollInterval = null;

  order.status = 'Diproses (Pembayaran Terverifikasi)';
  saveOrderLocal(order);

  const box = $('#dialog');
  if (!box) return;

  box.style.transition = '';
  box.style.transform = '';
  box.style.opacity = '';
  currentModalView = 'success';

  const buyerName = esc(order.buyer?.name || 'Kak');
  const pName = esc(order.product?.name || 'Produk');
  const pVar = esc(order.product?.variant || '');
  const total = rp(order.total || 0);
  const waMsg = `Halo admin PojokAI, pembayaran saya sudah LUNAS terverifikasi!\n\n• Kode Pesanan: ${order.code}\n• Produk: ${order.product?.name || ''} (${order.product?.variant || ''})\n• Total: ${total}\n• Nama: ${order.buyer?.name || ''}\n\nMohon diproses untuk pengiriman akun/produknya ya min. Terima kasih!`;
  const waUrl = `https://wa.me/${WA_ADMIN}?text=${encodeURIComponent(waMsg)}`;

  box.innerHTML = `
    <div class="relative overflow-hidden p-5 sm:p-6 text-center space-y-4">
      <!-- Confetti Particles -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <span class="absolute top-2 left-6 size-2 rounded-full bg-emerald-400 animate-ping"></span>
        <span class="absolute top-4 right-8 size-2.5 rounded-full bg-amber-400 animate-bounce"></span>
        <span class="absolute top-12 left-1/4 size-1.5 rounded-full bg-blue-400 animate-pulse"></span>
        <span class="absolute top-16 right-1/4 size-2 rounded-full bg-pink-400 animate-ping"></span>
      </div>

      <!-- Animated PojokAI Logo Avatar with Verified Badge -->
      <div class="relative mx-auto" style="width: 80px; height: 80px;">
        <div class="rounded-2xl overflow-hidden ring-4 ring-primary/30 shadow-xl shadow-primary/20 bg-surface-2 flex items-center justify-center" style="width: 80px; height: 80px;">
          <img src="/assets/branding/pojokai-bot-avatar.gif" alt="PojokAI Verified" style="width: 80px; height: 80px; object-fit: cover; display: block;">
        </div>
        <span class="absolute -bottom-1.5 -right-1.5 grid place-items-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 ring-white dark:ring-zinc-900 animate-bounce" style="width: 28px; height: 28px;">
          <i data-lucide="check" class="size-4 stroke-[3]"></i>
        </span>
      </div>
      <div>
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
          <i data-lucide="shield-check" class="size-3.5"></i>Pembayaran Terverifikasi
        </span>
        <h2 class="text-xl font-extrabold text-main mt-2 font-display">Transaksi Berhasil!</h2>
        <p class="text-xs text-muted mt-1 max-w-[320px] mx-auto">Terima kasih <b class="text-main">${buyerName}</b>! Pembayaran Anda sebesar <b class="text-primary font-bold">${total}</b> telah terverifikasi otomatis via QRIS WistaPay.</p>
      </div>

      <!-- Order Details Card -->
      <div class="rounded-2xl border border-line bg-surface-2/50 p-3.5 text-left text-xs space-y-2 shadow-2xs">
        <div class="flex items-center justify-between pb-2 border-b border-line-soft">
          <span class="text-subtle font-medium">Kode Pesanan</span>
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-sm font-extrabold text-primary">${esc(order.code)}</span>
            <button type="button" class="a-ico size-6 rounded-md cursor-pointer" data-copy="${esc(order.code)}" title="Salin Kode">
              <i data-lucide="copy" class="size-3 text-muted"></i>
            </button>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-subtle font-medium">Produk</span>
          <span class="font-bold text-main">${pName} <span class="font-normal text-muted">(${pVar})</span></span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-subtle font-medium">Status</span>
          <span class="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
            <span class="size-1.5 rounded-full bg-emerald-500"></span>Diproses Otomatis
          </span>
        </div>
      </div>

      <!-- Action WA Admin untuk Pengiriman Produk -->
      <div class="space-y-2 pt-1">
        <a href="${waUrl}" target="_blank" rel="noopener" class="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-[#25D366] text-white text-[15px] font-bold shadow-md hover:bg-[#20ba59] active:scale-[0.99] transition cursor-pointer">
          <i data-lucide="message-circle" class="size-5 shrink-0"></i>
          <span>Chat WA Admin untuk Terima Akun</span>
        </a>
        <button type="button" data-close class="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-xs font-semibold text-main hover:bg-surface-2 transition cursor-pointer">
          <span>Selesai · Kembali ke Toko</span>
        </button>
      </div>
    </div>
  `;

  icons();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  toast('Transaksi Berhasil! Pembayaran Lunas.', 'ok');
}



function openPaymentModal(order) {
  paymentSuccessHandled = false;
  isPaymentPollingBusy = false;
  currentModalView = 'payment';
  activePaymentOrder = order;
  const box = $('#dialog');
  if (!box) return;
  box.style.transition = '';
  box.style.transform = '';
  box.style.opacity = '';
  box.innerHTML = paymentDialogHTML(order);
  icons();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('#dialog')?.focus({ preventScroll: true }), 60);
  
  // Start 5-Minute Timer & Request Dynamic QRIS
  startPaymentTimer(order);
  requestDynamicQris(order);
}
window.openPaymentSuccessModal = openPaymentSuccessModal;
window.openPaymentModal = openPaymentModal;

/* ---------- Status & Tracking Helpers ---------- */
function getOrderStatusMeta(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('batal') || s.includes('kadaluarsa') || s.includes('expired') || s.includes('habis')) {
    return {
      step: 0,
      label: 'Dibatalkan (Waktu Habis)',
      badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30',
      icon: 'x-circle',
      desc: 'Batas waktu pembayaran 5 menit telah terlewati. Pesanan ini otomatis dibatalkan.'
    };
  }
  if (s.includes('selesai') || s.includes('sukses') || s.includes('complete') || s.includes('success')) {
    return {
      step: 3,
      label: 'Selesai (Akun Terkirim)',
      badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
      icon: 'check-circle-2',
      desc: 'Pesanan & akun telah berhasil dikirimkan ke kontak WhatsApp / Email tujuan Anda.'
    };
  }
  if (s.includes('proses') || s.includes('diproses') || s.includes('process')) {
    return {
      step: 2,
      label: 'Sedang Diproses Admin',
      badgeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30',
      icon: 'refresh-cw',
      desc: 'Pembayaran terverifikasi! Akun sedang disiapkan dan segera dikirimkan ke kontak Anda.'
    };
  }
  // Default: Menunggu Pengiriman / Menunggu Pembayaran
  return {
    step: 1,
    label: 'Menunggu Pengiriman / Pembayaran',
    badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30',
    icon: 'hourglass',
    desc: 'Pesanan telah dibuat. Silakan selesaikan pembayaran QRIS & kirim bukti untuk mempercepat pengiriman.'
  };
}

function orderTrackingResultCardHTML(o) {
  const meta = getOrderStatusMeta(o.status);
  const pName = esc(o.product?.name || 'Produk');
  const pVar = esc(o.product?.variant || '');
  const qty = o.product?.qty || 1;
  const buyerWa = esc(o.buyer?.wa || '-');
  const buyerEmail = esc(o.buyer?.email || '-');
  const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

  return `
  <div class="card p-4 border border-line bg-surface text-main text-xs space-y-3 rounded-2xl shadow-sm">
    <!-- Header Kode & Tanggal -->
    <div class="flex items-start justify-between gap-2 border-b border-line-soft pb-2.5">
      <div>
        <span class="text-[10px] uppercase font-bold text-subtle tracking-wider block">Kode Pesanan</span>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="font-mono text-base font-extrabold text-primary tracking-wide">${esc(o.code)}</span>
          <button type="button" data-copy="${esc(o.code)}" class="grid size-6 place-items-center rounded-md border border-line hover:bg-surface-2 transition cursor-pointer" title="Salin Kode Pesanan">
            <i data-lucide="copy" class="size-3 text-muted"></i>
          </button>
        </div>
        <span class="text-[10px] text-subtle">${dateStr}</span>
      </div>
      <div class="text-right">
        <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.badgeClass}">
          <i data-lucide="${meta.icon}" class="size-3"></i><span>${meta.label}</span>
        </span>
      </div>
    </div>

    <!-- Timeline Status Pelacakan -->
    <div class="rounded-xl bg-surface-2/40 p-2.5 border border-line-soft">
      <div class="grid grid-cols-3 gap-1 text-center">
        <div class="flex flex-col items-center">
          <div class="grid size-6 place-items-center rounded-full text-xs font-bold ${meta.step >= 1 ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-subtle'}">1</div>
          <span class="text-[10px] font-semibold mt-1 ${meta.step >= 1 ? 'text-primary' : 'text-subtle'}">Dibuat</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="grid size-6 place-items-center rounded-full text-xs font-bold ${meta.step >= 2 ? 'bg-primary text-primary-fg' : meta.step === 1 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'bg-surface-3 text-subtle'}">2</div>
          <span class="text-[10px] font-semibold mt-1 ${meta.step >= 2 ? 'text-primary' : meta.step === 1 ? 'text-amber-600 dark:text-amber-400' : 'text-subtle'}">Diproses</span>
        </div>
        <div class="flex flex-col items-center">
          <div class="grid size-6 place-items-center rounded-full text-xs font-bold ${meta.step >= 3 ? 'bg-emerald-500 text-white' : 'bg-surface-3 text-subtle'}">3</div>
          <span class="text-[10px] font-semibold mt-1 ${meta.step >= 3 ? 'text-emerald-600 dark:text-emerald-400' : 'text-subtle'}">Selesai</span>
        </div>
      </div>
      <p class="mt-2 text-[11px] text-muted text-center leading-relaxed">${meta.desc}</p>
    </div>

    <!-- Data Kontak Tujuan Pembeli (Email & WhatsApp) -->
    <div class="rounded-xl border border-line bg-surface-2/60 p-3 space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <i data-lucide="send" class="size-3.5 text-primary"></i>Kontak Tujuan Pembeli
        </span>
        <span class="text-[10px] text-subtle font-medium">Terikat di Kode Pesanan</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div class="flex items-center gap-2 rounded-lg bg-surface p-2 border border-line-soft">
          <div class="grid size-7 shrink-0 place-items-center rounded-md bg-[#25D366]/15 text-[#128C7E]">
            <i data-lucide="phone" class="size-3.5"></i>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[10px] text-subtle">No. WhatsApp Tujuan</p>
            <p class="font-mono font-bold text-main truncate">${buyerWa}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 rounded-lg bg-surface p-2 border border-line-soft">
          <div class="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <i data-lucide="mail" class="size-3.5"></i>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[10px] text-subtle">Email Tujuan Pengiriman</p>
            <p class="font-medium text-main truncate" title="${buyerEmail}">${buyerEmail}</p>
          </div>
        </div>
      </div>
      <p class="text-[10px] text-subtle">* Akun & link akses otomatis dikirimkan ke nomor WhatsApp dan email di atas.</p>
    </div>

    <!-- Rincian Produk & Total -->
    <div class="rounded-xl border border-line-soft bg-surface-2/30 p-2.5 text-xs space-y-1">
      <div class="flex justify-between text-muted">
        <span>Produk:</span><b class="text-main font-semibold truncate ml-2">${pName}</b>
      </div>
      <div class="flex justify-between text-muted">
        <span>Varian / Paket:</span><span class="text-main truncate ml-2">${pVar} (${qty}x)</span>
      </div>
      <div class="flex justify-between text-muted pt-1 border-t border-line-soft font-semibold">
        <span>Total Tagihan:</span><span class="text-primary font-display text-sm font-bold tabular-nums">${rp(o.total)}</span>
      </div>
    </div>

    <!-- Tombol Aksi -->
    <div class="flex gap-2 pt-1">
      <button type="button" data-reopen-qris="${esc(o.code)}" class="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary text-primary-fg font-bold text-xs hover:opacity-90 transition cursor-pointer">
        <i data-lucide="qr-code" class="size-3.5"></i><span>Buka QRIS</span>
      </button>
      <button type="button" data-order-wa="${esc(o.code)}" class="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#25D366] text-white font-bold text-xs hover:opacity-90 transition cursor-pointer">
        <i data-lucide="message-circle" class="size-3.5"></i><span>Chat Admin WA</span>
      </button>
    </div>
  </div>
  `;
}

/* ---------- Modal Riwayat Pesanan Pembeli ---------- */
function buyerOrdersDialogHTML(orders = []) {
  return `
  <div class="shrink-0 border-b border-line-soft px-4 py-3 sm:px-5">
    <div class="flex items-center justify-between pb-2 mb-2 border-b border-line-soft">
      <button type="button" data-close aria-label="Kembali" class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-main py-1 px-2.5 -ml-2 rounded-lg transition hover:bg-surface-2 cursor-pointer">
        <i data-lucide="arrow-left" class="size-4"></i><span>Kembali</span>
      </button>
      <button type="button" data-close class="grid size-8 place-items-center rounded-[10px] text-subtle hover:bg-surface-2 hover:text-main cursor-pointer" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>
    <div class="flex items-center justify-between">
      <div>
        <h2 class="font-display text-base font-bold sm:text-lg">Riwayat &amp; Status Pesanan</h2>
        <p class="text-xs text-muted">Pelacakan transaksi, nomor tujuan &amp; email akun Anda</p>
      </div>
      <span class="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs tabular-nums text-muted font-semibold">${orders.length}</span>
    </div>
  </div>

  <!-- Form pencarian kode pesanan di dalam modal -->
  <div class="p-3 bg-surface-2/40 border-b border-line-soft px-4 sm:px-5">
    <form id="modalTrackForm" class="flex gap-2">
      <div class="relative flex-1">
        <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"></i>
        <input id="modalTrackInput" type="text" placeholder="Cari Kode Pesanan (POJOK-...) atau No. WA" class="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-xs text-main outline-none focus:border-primary">
      </div>
      <button type="submit" class="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-fg hover:opacity-90 cursor-pointer">
        <span>Lacak</span>
      </button>
    </form>
    <div id="modalTrackResult" class="mt-2 hidden"></div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 space-y-3">
    ${orders.length === 0 ? `
      <div class="py-12 text-center">
        <div class="mx-auto grid size-12 place-items-center rounded-2xl bg-surface-2 text-subtle mb-3">
          <i data-lucide="receipt" class="size-6"></i>
        </div>
        <p class="text-sm font-semibold text-main">Belum Ada Riwayat Pesanan</p>
        <p class="text-xs text-muted mt-1">Pesanan Anda akan tercatat di sini setelah melakukan pembelian atau masukkan kode pesanan di atas.</p>
        <button type="button" data-close class="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-fg hover:opacity-90 transition cursor-pointer">
          Mulai Belanja Sekarang
        </button>
      </div>
    ` : orders.map((o) => {
      const meta = getOrderStatusMeta(o.status);
      return `
      <div class="card p-3.5 space-y-2.5 rounded-xl border border-line">
        <div class="flex items-center justify-between border-b border-line-soft pb-2">
          <div>
            <span class="font-mono text-xs font-bold text-primary tracking-wide">${esc(o.code)}</span>
            <span class="block text-[10px] text-subtle">${new Date(o.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          <span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.badgeClass} flex items-center gap-1">
            <i data-lucide="${meta.icon}" class="size-3"></i><span>${meta.label}</span>
          </span>
        </div>

        <div class="flex items-center justify-between pt-0.5">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-main truncate">${esc(o.product.name)}</p>
            <p class="text-xs text-muted truncate">${esc(o.product.variant)} (${o.product.qty}x)</p>
          </div>
          <p class="text-sm font-bold tabular-nums text-primary shrink-0">${rp(o.total)}</p>
        </div>

        <!-- Data Kontak Tujuan Pembeli (Email & WhatsApp) -->
        <div class="grid grid-cols-2 gap-2 bg-surface-2/40 p-2 rounded-lg text-[11px] border border-line-soft">
          <div class="min-w-0">
            <span class="text-subtle text-[10px] block flex items-center gap-1">
              <i data-lucide="phone" class="size-3 text-[#128C7E]"></i>No. WhatsApp:
            </span>
            <span class="font-mono font-bold text-main truncate block mt-0.5">${esc(o.buyer?.wa || '-')}</span>
          </div>
          <div class="min-w-0">
            <span class="text-subtle text-[10px] block flex items-center gap-1">
              <i data-lucide="mail" class="size-3 text-primary"></i>Email Tujuan:
            </span>
            <span class="font-medium text-main truncate block mt-0.5" title="${esc(o.buyer?.email || '-')}">${esc(o.buyer?.email || '-')}</span>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-1 border-t border-line-soft">
          <button type="button" data-reopen-qris="${esc(o.code)}" class="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-primary/10 text-xs font-semibold text-primary hover:bg-primary/20 transition cursor-pointer">
            <i data-lucide="qr-code" class="size-3.5"></i><span>Buka QRIS</span>
          </button>
          <button type="button" data-order-wa="${esc(o.code)}" class="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-[#25D366]/10 text-xs font-semibold text-[#128C7E] hover:bg-[#25D366]/20 transition cursor-pointer">
            <i data-lucide="message-circle" class="size-3.5"></i><span>Chat Admin</span>
          </button>
          <button type="button" data-copy="${esc(o.code)}" class="grid size-8 shrink-0 place-items-center rounded-lg border border-line hover:bg-surface-2 transition cursor-pointer" title="Salin Kode Pesanan">
            <i data-lucide="copy" class="size-3.5 text-muted"></i>
          </button>
        </div>
      </div>
    `;
    }).join('')}
  </div>
  `;
}

async function openBuyerOrdersModal() {
  const buyer = getStoredBuyer();
  currentModalView = 'orders';
  const box = $('#dialog');
  if (!box) return;

  let orders = getStoredOrders();
  if (buyer?.wa) {
    try {
      const res = await fetch(`/api/orders?wa=${encodeURIComponent(buyer.wa)}&email=${encodeURIComponent(buyer.email || '')}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.orders)) {
          for (const remoteOrder of data.orders) {
            saveOrderLocal(remoteOrder);
          }
          orders = getStoredOrders();
        }
      }
    } catch {}
  }

  box.innerHTML = buyerOrdersDialogHTML(orders);
  icons();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('#dialog')?.focus({ preventScroll: true }), 60);
}

/* ---------- Policy & Legal Modals (Trust Signals) ---------- */
function openPolicyModal(type) {
  const box = $('#dialog');
  if (!box) return;

  const policies = {
    privacy: {
      title: 'Kebijakan Privasi',
      icon: 'shield-check',
      content: `
        <div class="space-y-3.5 text-xs leading-relaxed text-muted">
          <p><b class="text-main font-semibold">1. Pengumpulan Data:</b> Nomor WhatsApp dan alamat email yang Anda masukkan hanya dipakai untuk pengiriman pesanan, instruksi login, serta pelacakan transaksi pribadi Anda.</p>
          <p><b class="text-main font-semibold">2. Kerahasiaan Data:</b> Kami tidak pernah menjual, menyewakan, atau membagikan data pelanggan ke pihak ketiga mana pun.</p>
          <p><b class="text-main font-semibold">3. Transaksi Aman:</b> Pembayaran diproses melalui QRIS Resmi Standar Nasional. Kami tidak pernah meminta password perbankan, OTP finansial, atau data kartu debit/kredit Anda.</p>
          <p><b class="text-main font-semibold">4. Penghapusan Data:</b> Pembeli dapat meminta penghapusan riwayat nomor kontak dari database toko kami sewaktu-waktu dengan menghubungi admin WhatsApp.</p>
        </div>`
    },
    terms: {
      title: 'Syarat & Ketentuan',
      icon: 'file-text',
      content: `
        <div class="space-y-3.5 text-xs leading-relaxed text-muted">
          <p><b class="text-main font-semibold">1. Ketentuan Akun:</b> Akun yang disediakan sesuai dengan paket pesanan (Private Email atau Akun Profil Bersama). Untuk akun shared, dilarang mengubah password utama atau mengutak-atik profil pengguna lain.</p>
          <p><b class="text-main font-semibold">2. Proses Pengiriman:</b> Akun dikirimkan secara instan (1–5 menit) ke kontak Anda setelah transfer QRIS diverifikasi.</p>
          <p><b class="text-main font-semibold">3. Masa Aktif:</b> Durasi langganan dihitung sejak kredensial pertama kali dikirimkan kepada Anda.</p>
          <p><b class="text-main font-semibold">4. Kepatuhan Penggunaan:</b> Pembeli wajib mematuhi aturan penggunaan wajar masing-masing platform digital (OpenAI, Canva, Netflix, Google, dsb).</p>
        </div>`
    },
    warranty: {
      title: 'Garansi & Klaim Penggantian',
      icon: 'award',
      content: `
        <div class="space-y-3.5 text-xs leading-relaxed text-muted">
          <p><b class="text-main font-semibold">1. Garansi Penuh (Full Warranty):</b> Setiap produk bergaransi di PojokAI mendapatkan jaminan penggantian akun baru secara gratis (*replacement*) jika akun bermasalah sebelum masa aktif berakhir.</p>
          <p><b class="text-main font-semibold">2. Cara Klaim Mudah:</b> Cukup kirimkan tangkapan layar kendala serta <b class="text-main font-semibold">Kode Pesanan (POJOK-...)</b> Anda ke WhatsApp Admin.</p>
          <p><b class="text-main font-semibold">3. Waktu Proses Klaim:</b> Penggantian akun diproses secepatnya (rata-rata 10–30 menit) selama jam operasional toko (08:00 – 23:00 WIB).</p>
          <p><b class="text-main font-semibold">4. Batasan Garansi:</b> Garansi tidak berlaku jika pembeli terbukti sengaja mengubah password akun bersama atau melanggar ketentuan resmi aplikasi pihak ketiga.</p>
        </div>`
    }
  };

  const p = policies[type] || policies.terms;
  currentModalView = 'policy';

  box.innerHTML = `
    <div class="flex items-center justify-between border-b border-line-soft px-4 py-3.5 sm:px-5">
      <div class="flex items-center gap-2.5">
        <span class="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
          <i data-lucide="${p.icon}" class="size-4.5"></i>
        </span>
        <h2 class="text-base font-bold font-display text-main">${p.title}</h2>
      </div>
      <button type="button" data-close class="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-subtle hover:bg-surface-2 hover:text-main focus-visible:outline-2 focus-visible:outline-primary cursor-pointer" aria-label="Tutup"><i data-lucide="x" class="size-4"></i></button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
      ${p.content}
    </div>
    <div class="border-t border-line-soft bg-surface-2/40 px-4 py-3 sm:px-5 flex items-center justify-between text-xs">
      <span class="text-subtle font-medium">Ada pertanyaan lain?</span>
      <a href="${waLink('Halo admin PojokAI, saya mau tanya seputar ' + p.title)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 font-bold text-[#25D366] hover:underline">
        <i data-lucide="message-circle" class="size-3.5"></i><span>Chat WhatsApp</span>
      </a>
    </div>
  `;

  icons();
  $('#modal').classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
}

/* ---------- Events ---------- */
document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn || e.target.id === 'modal') {
    e.preventDefault();
    return closeModal();
  }
  if (e.target.closest('#btnManualCheckStatus')) {
    if (paymentSuccessHandled) return;
    const btn = e.target.closest('#btnManualCheckStatus');
    const icon = btn.querySelector('i');
    if (icon) icon.classList.add('animate-spin');
    if (activePaymentOrder) {
      fetch(`/api/qris/status?order_id=${encodeURIComponent(activePaymentOrder.code)}&reference=${encodeURIComponent(activePaymentOrder.wistapay?.reference || '')}`)
        .then(r => r.json())
        .then(json => {
          if (json.status === 'PAID' || json.status === 'SUCCESS' || (json.orderStatus && json.orderStatus.includes('Diproses'))) {
            onPaymentSuccess(activePaymentOrder);
          } else {
            toast('Pembayaran belum terdeteksi. Silakan selesaikan scan di m-Banking/e-Wallet.');
          }
        })
        .finally(() => {
          setTimeout(() => icon?.classList.remove('animate-spin'), 800);
        });
    }
    return;
  }
  if (e.target.closest('#btnRetryQris')) {
    if (activePaymentOrder) {
      requestDynamicQris(activePaymentOrder);
    }
    return;
  }

  const pesananNav = e.target.closest('#pesananNavBtn');
  if (pesananNav) {
    return openBuyerOrdersModal();
  }

  const masukNav = e.target.closest('#masukBtn');
  if (masukNav) {
    // Jika owner sudah aktif, admin.js sudah stopImmediatePropagation
    const buyer = getStoredBuyer();
    if (buyer) return openBuyerAccountModal();
    return openBuyerAuthModal();
  }

  const buy = e.target.closest('[data-buy]');
  if (buy) {
    const p = PRODUCTS.find((x) => x.slug === buy.dataset.buy && !x.hidden);
    if (p) return openModal(p);
  }

  if (e.target.closest('[data-bundle]')) {
    return openBundleModal();
  }

  const chip = e.target.closest('[data-chip]');
  if (chip) {
    state.chip = state.chip === chip.dataset.chip ? null : chip.dataset.chip;
    renderChips(); return renderCatalog();
  }

  const view = e.target.closest('[data-view]');
  if (view) {
    state.view = view.dataset.view;
    localStorage.setItem('view', state.view);
    return renderCatalog();
  }

  const dot = e.target.closest('[data-dot]');
  if (dot) { showHero(+dot.dataset.dot); return startHero(); }
  const arrow = e.target.closest('[data-hero]');
  if (arrow) {
    const track = $('#heroTrack');
    const n = Math.round(track.scrollLeft / track.clientWidth) + +arrow.dataset.hero;
    showHero((n + HERO_SLIDES.length) % HERO_SLIDES.length);
    return startHero();
  }

  /* Navigasi & aksi modal auth pembeli */
  if (e.target.closest('[data-auth-back]')) {
    if (m) { currentModalView = 'product'; return renderDialog(); }
    if (bm) { currentModalView = 'bundle'; return renderBundleDialog(); }
    return closeModal();
  }

  if (e.target.closest('#buyerOAuthGoogle') || e.target.closest('#buyerGoogleLoginBtn')) {
    return handleBuyerGoogleLogin();
  }

  if (e.target.closest('#buyerOAuthGithub')) {
    return handleBuyerGithubLogin();
  }

  if (e.target.closest('#buyerGoOwnerAuth') || e.target.closest('#buyerGoOwnerAuth2')) {
    closeModal();
    return window.openOwnerAuth?.();
  }

  if (e.target.closest('#buyerGoOrdersBtn')) {
    return openBuyerOrdersModal();
  }

  const navLogout = e.target.closest('#navLogoutBtn');
  if (navLogout) {
    if (window.isOwnerActive?.() && typeof window.ownerLogout === 'function') {
      return window.ownerLogout();
    }
    const buyer = getStoredBuyer();
    if (buyer) {
      setStoredBuyer(null);
      updateBuyerNav();
      toast('Berhasil keluar dari akun pembeli.');
      return;
    }
    return;
  }

  if (e.target.closest('#buyerLogoutBtn')) {
    setStoredBuyer(null);
    updateBuyerNav();
    toast('Berhasil keluar dari akun pembeli.');
    return closeModal();
  }

  /* Aksi modal pembayaran QRIS */
  if (e.target.closest('[data-confirm-transfer]')) {
    const ord = activePaymentOrder;
    if (!ord) return;
    const noteLines = [];
    if (ord.buyer.email) noteLines.push(`Email: *${ord.buyer.email}*`);
    if (ord.note) noteLines.push(`Catatan: *${ord.note}*`);

    const pesanAdmin = [
      'Halo admin PojokAI, saya sudah transfer via QRIS untuk pesanan berikut:',
      '',
      `Kode Pesanan: *${ord.code}*`,
      `Produk: *${ord.product.name}*`,
      `Paket: *${ord.product.variant}*`,
      `Jumlah: *${ord.product.qty} akun*`,
      `Total Transfer: *${rp(ord.total)}*`,
      `Nama Pembeli: *${ord.buyer.name}*`,
      `No. WhatsApp: *${ord.buyer.wa}*`,
      ...noteLines,
      'Metode Bayar: *QRIS Dinamis (WistaPay)*',
      '',
      'Bukti transfer sudah siap. Mohon segera dicek dan kirimkan akunnya ya min. Terima kasih!'
    ].join('\n');

    ord.status = 'Menunggu Konfirmasi Admin';
    saveOrderLocal(ord);
    toast('Membuka WhatsApp Admin PojokAI…');
    window.open(waLink(pesanAdmin), '_blank', 'noopener');
    return;
  }

  if (e.target.closest('[data-send-buyer-wa]')) {
    const ord = activePaymentOrder;
    if (!ord) return;
    const pesanBuyer = [
      '*RINCIAN PESANAN POJOKAI*',
      '',
      `Kode Pesanan: *${ord.code}*`,
      `Waktu Transaksi: *${new Date(ord.createdAt).toLocaleString('id-ID')}*`,
      `Produk: *${ord.product.name}*`,
      `Paket: *${ord.product.variant}* (${ord.product.qty} akun)`,
      `Total Bayar: *${rp(ord.total)}*`,
      `Status: *${ord.status || 'Menunggu Pengiriman'}*`,
      `Pembayaran: *QRIS Dinamis (WistaPay${ord.wistapay?.reference ? ' - ' + ord.wistapay.reference : ''})*`,
      '',
      'Simpan pesan ini sebagai bukti pesanan Anda. Untuk bantuan hubungi admin: https://wa.me/' + WA_ADMIN
    ].join('\n');

    const target = ord.buyer.wa.replace(/^0/, '62');
    toast('Membuka WhatsApp rincian pesanan…');
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(pesanBuyer)}`, '_blank', 'noopener');
    return;
  }

  if (e.target.closest('[data-copy-summary]')) {
    const ord = activePaymentOrder;
    if (!ord) return;
    const ringkasan = [
      'RINCIAN PESANAN POJOKAI',
      `Kode Pesanan: ${ord.code}`,
      `Produk: ${ord.product.name} - ${ord.product.variant} (${ord.product.qty}x)`,
      `Total: ${rp(ord.total)}`,
      `Penerima: ${ord.buyer.name} (${ord.buyer.wa})`,
      `Metode Bayar: QRIS Dinamis (WistaPay${ord.wistapay?.reference ? ' - ' + ord.wistapay.reference : ''})`,
      `Waktu: ${new Date(ord.createdAt).toLocaleString('id-ID')}`
    ].join('\n');
    navigator.clipboard?.writeText(ringkasan);
    toast('Rincian pesanan berhasil disalin!');
    return;
  }

  const shareBtn = e.target.closest('[data-share-product]');
  if (shareBtn) {
    const slug = shareBtn.dataset.shareProduct;
    const url = `${window.location.origin}${window.location.pathname}#produk/${slug}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      toast('Link produk berhasil disalin!');
    }
    return;
  }
  const policyBtn = e.target.closest('[data-open-policy]');
  if (policyBtn) {
    return openPolicyModal(policyBtn.dataset.openPolicy);
  }
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const val = copyBtn.dataset.copy;
    navigator.clipboard?.writeText(val);
    toast(`Tersalin: ${val}`);
    return;
  }

  const reopenBtn = e.target.closest('[data-reopen-qris]');
  if (reopenBtn) {
    const code = reopenBtn.dataset.reopenQris;
    const ord = getStoredOrders().find((o) => o.code === code);
    if (ord) return openPaymentModal(ord);
  }

  const orderWaBtn = e.target.closest('[data-order-wa]');
  if (orderWaBtn) {
    const code = orderWaBtn.dataset.orderWa;
    return window.open(waLink(`Halo admin PojokAI, saya mau cek/konfirmasi pesanan: ${code}`), '_blank', 'noopener');
  }

  /* Modal produk aktif */
  if (m && currentModalView === 'product') {
    const va = e.target.closest('[data-v]');
    if (va) {
      m.vi = +va.dataset.v;
      const v = m.p.variants[m.vi];
      m.qty = Math.min(m.qty, maxQty(v));
      return renderDialog();
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const v = m.p.variants[m.vi];
      m.qty = Math.min(Math.max(1, m.qty + +step.dataset.step), maxQty(v));
      return renderDialog();
    }
    if (e.target.closest('[data-switch]')) { m.email = !m.email; return renderDialog(); }
    if (e.target.closest('[data-coupon]')) { m.kupon = !m.kupon; return renderDialog(); }
    const more = e.target.closest('[data-more]');
    if (more) {
      e.preventDefault();
      const target = $('#mDescSection') || $('#dialog details');
      if (target) {
        if (target.tagName === 'DETAILS') target.open = true;
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      return;
    }
    if (e.target.closest('[data-checkout]')) return checkout();
    if (e.target.closest('[data-cart]')) {
      const span = e.target.closest('[data-cart]').querySelector('span');
      span.textContent = '✓ Masuk keranjang';
      setTimeout(() => span && (span.textContent = '+ Keranjang'), 1500);
      return;
    }
  }

  /* Modal paket hemat aktif */
  if (bm && currentModalView === 'bundle' && e.target.closest('[data-bundle-checkout]')) {
    return bundleCheckout();
  }

  const wa = e.target.closest('[data-wa]');
  if (wa) { e.preventDefault(); return window.open(waLink(wa.dataset.wa), '_blank', 'noopener'); }

  if (e.target.closest('[data-close]') || e.target.id === 'modal') closeModal();
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'buyerAuthForm') {
    handleBuyerAuthSubmit(e);
  }
});

document.addEventListener('input', (e) => {
  if (bm && currentModalView === 'bundle') {
    if (e.target.id === 'bmWa') {
      bm.wa = e.target.value;
      e.target.classList.remove('border-danger', 'ring-2', 'ring-danger/30');
    } else if (e.target.id === 'bmEmail') {
      bm.email = e.target.value;
      e.target.classList.remove('border-danger', 'ring-2', 'ring-danger/30');
    } else if (e.target.id === 'bmNote') {
      bm.note = e.target.value;
    }
    return;
  }
  if (currentModalView === 'auth') {
    if (e.target.id === 'bNameInput') authDraft.name = e.target.value;
    else if (e.target.id === 'bWaInput') authDraft.wa = e.target.value;
    else if (e.target.id === 'bEmailInput') authDraft.email = e.target.value;
    return;
  }
  if (!m || currentModalView !== 'product') return;
  const t = e.target;
  if (t.id === 'mQty') {
    m.qty = Math.min(Math.max(1, +t.value || 1), maxQty(m.p.variants?.[m.vi]));
  } else if (t.id === 'mWa') {
    m.wa = t.value;
    t.setCustomValidity('');
    t.classList.remove('border-danger', 'ring-2', 'ring-danger/30');
  } else if (t.id === 'mEmail') {
    m.email = t.value;
    t.classList.remove('border-danger', 'ring-2', 'ring-danger/30');
  } else if (t.id === 'mKupon') {
    m.kode = t.value;
  } else if (t.dataset.mf != null) {
    m.fields[+t.dataset.mf] = t.value;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (m || bm || currentModalView)) closeModal();
});

function toggleThemeWithAnimation(e) {
  const currentDark = document.documentElement.classList.contains('dark');
  const next = currentDark ? 'light' : 'dark';
  const apply = () => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.classList.toggle('light', next === 'light');
    document.documentElement.style.colorScheme = next;
    localStorage.setItem('theme', next);
  };

  const btn = e?.currentTarget || $('#themeToggle');
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !btn) {
    return apply();
  }

  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  document.startViewTransition(apply).ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`
        ]
      },
      {
        duration: 520,
        easing: 'cubic-bezier(.4, 0, .2, 1)',
        pseudoElement: '::view-transition-new(root)'
      }
    );
  }).catch(() => {});
}

$('#themeToggle').addEventListener('click', toggleThemeWithAnimation);

/* ---------- Site Clock (Header Center ala Snipbot) ---------- */
const CLOCK_TIMEZONES = [
  { id: 'Asia/Jakarta', label: 'WIB' },
  { id: 'Asia/Makassar', label: 'WITA' },
  { id: 'Asia/Jayapura', label: 'WIT' },
  { id: 'UTC', label: 'UTC' }
];

let activeTimezone = localStorage.getItem('wk_timezone') || 'Asia/Jakarta';

function updateClock() {
  const timeEl = $('#clockTime');
  const dateEl = $('#clockDate');
  const zoneEl = $('#clockZoneLabel');
  if (!timeEl || !dateEl) return;

  const now = new Date();

  try {
    const timeFormatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: activeTimezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    timeEl.textContent = timeFormatter.format(now).replace(/\./g, ':');

    const dateFormatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: activeTimezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    dateEl.textContent = dateFormatter.format(now);
  } catch (err) {
    timeEl.textContent = now.toTimeString().split(' ')[0];
    dateEl.textContent = now.toDateString();
  }

  const currentTz = CLOCK_TIMEZONES.find((t) => t.id === activeTimezone) || { label: 'WIB' };
  if (zoneEl) zoneEl.textContent = currentTz.label;

  document.querySelectorAll('.site-clock-menu-option').forEach((opt) => {
    const isSelected = opt.dataset.tz === activeTimezone;
    opt.classList.toggle('is-selected', isSelected);
    const check = opt.querySelector('.check-icon');
    if (check) check.classList.toggle('hidden', !isSelected);
  });
}

function initSiteClock() {
  updateClock();
  setInterval(updateClock, 1000);

  const clock = $('#siteClock');
  const menu = $('#clockMenu');
  if (!clock || !menu) return;

  const toggleMenu = (e) => {
    e.stopPropagation();
    const isHidden = menu.classList.toggle('hidden');
    clock.setAttribute('aria-expanded', !isHidden);
    icons();
  };

  clock.addEventListener('click', toggleMenu);
  clock.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleMenu(e);
    } else if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
      clock.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !e.target.closest('#siteClockWrap')) {
      menu.classList.add('hidden');
      clock.setAttribute('aria-expanded', 'false');
    }
  });

  menu.querySelectorAll('.site-clock-menu-option').forEach((opt) => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      activeTimezone = opt.dataset.tz;
      localStorage.setItem('wk_timezone', activeTimezone);
      updateClock();
      menu.classList.add('hidden');
      clock.setAttribute('aria-expanded', 'false');
    });
  });
}

$('#searchInput').addEventListener('input', (e) => { state.q = e.target.value; renderCatalog(); });

$('#sortSelect').addEventListener('change', (e) => {
  state.sort = e.target.value;
  $('#sortLabel').textContent = e.target.selectedOptions[0].text;
  renderCatalog();
});

$('#trackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#trackInput').value.trim();
  const out = $('#trackResult');
  out.classList.remove('hidden');
  if (!v) {
    out.className = 'mt-2 text-xs text-danger font-medium';
    out.textContent = 'Masukkan kode pesanan (POJOK-...) atau nomor WhatsApp dulu.';
    return;
  }

  out.className = 'mt-2 text-xs text-muted flex items-center gap-1.5';
  out.innerHTML = '<i data-lucide="loader-2" class="size-3.5 animate-spin text-primary"></i><span>Mencari data transaksi…</span>';
  icons();

  const localOrders = getStoredOrders();
  const cleanQ = v.toUpperCase();
  const cleanWa = v.replace(/\D/g, '');
  let found = localOrders.find((o) =>
    o.code === cleanQ ||
    (cleanWa.length >= 8 && o.buyer?.wa === cleanWa) ||
    (v.includes('@') && o.buyer?.email?.toLowerCase() === v.toLowerCase())
  );

  if (!found) {
    try {
      const res = await fetch(`/api/orders?q=${encodeURIComponent(v)}&code=${encodeURIComponent(cleanQ)}&wa=${encodeURIComponent(cleanWa)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.orders && data.orders.length) {
          found = data.orders[0];
          saveOrderLocal(found);
        }
      }
    } catch {}
  }

  if (found) {
    out.className = 'mt-3 block';
    out.innerHTML = orderTrackingResultCardHTML(found);
    icons();
  } else {
    out.className = 'mt-3 card p-3.5 border border-line bg-surface text-xs text-muted space-y-2 rounded-xl';
    out.innerHTML = `
      <div class="flex items-center gap-2 text-danger font-semibold">
        <i data-lucide="alert-circle" class="size-4 shrink-0"></i>
        <span>Pesanan tidak ditemukan dengan kata kunci: <b>${esc(v)}</b></span>
      </div>
      <p class="text-[11px] text-subtle">
        Pastikan format kode pesanan sudah sesuai (mis. <b>POJOK-ABC123</b>) atau masukkan nomor WhatsApp yang Anda daftarkan saat memesan.
      </p>
      <div class="pt-1.5 border-t border-line-soft flex items-center justify-between">
        <span class="text-[11px]">Butuh bantuan pelacakan pesanan?</span>
        <a href="${waLink('Halo admin PojokAI, saya mau cek status transaksi: ' + v)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 font-semibold text-[#128C7E] hover:underline">
          <i data-lucide="message-circle" class="size-3.5"></i>Chat Admin WA &rarr;
        </a>
      </div>
    `;
    icons();
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'modalTrackForm') {
    e.preventDefault();
    const input = $('#modalTrackInput');
    const val = (input?.value || '').trim();
    const out = $('#modalTrackResult');
    if (!out) return;
    out.classList.remove('hidden');
    if (!val) {
      out.className = 'mt-2 text-xs text-danger font-semibold';
      out.textContent = 'Ketik kode pesanan (POJOK-...) atau nomor WhatsApp.';
      return;
    }
    out.className = 'mt-2 text-xs text-muted flex items-center gap-1.5';
    out.innerHTML = '<i data-lucide="loader-2" class="size-3.5 animate-spin text-primary"></i><span>Mencari pesanan…</span>';
    icons();

    const localOrders = getStoredOrders();
    const cleanQ = val.toUpperCase();
    const cleanWa = val.replace(/\D/g, '');
    let found = localOrders.find((o) => o.code === cleanQ || (cleanWa.length >= 8 && o.buyer?.wa === cleanWa) || (val.includes('@') && o.buyer?.email?.toLowerCase() === val.toLowerCase()));

    if (!found) {
      try {
        const res = await fetch(`/api/orders?q=${encodeURIComponent(val)}&code=${encodeURIComponent(cleanQ)}&wa=${encodeURIComponent(cleanWa)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.orders && data.orders.length) {
            found = data.orders[0];
            saveOrderLocal(found);
          }
        }
      } catch {}
    }

    if (found) {
      out.className = 'mt-2 block';
      out.innerHTML = orderTrackingResultCardHTML(found);
      icons();
    } else {
      out.className = 'mt-2 text-xs text-danger font-medium';
      out.innerHTML = `Pesanan dengan kode/kontak <b>${esc(val)}</b> tidak ditemukan. <a href="${waLink('Halo admin PojokAI, saya mau cek pesanan: ' + val)}" target="_blank" rel="noopener" class="underline font-semibold ml-1 text-[#128C7E]">Chat Admin WA</a>`;
    }
  }
});

/* ---------- Init ---------- */
updateBuyerNav();
renderHero();
renderBundle();
renderChips();
renderCatalog();
renderFaq();
renderTicker();
syncDots(0);
$('#heroTrack').addEventListener('scroll', () => {
  clearTimeout(heroSnap.t);
  heroSnap.t = setTimeout(heroSnap, 120);
});
startHero();
icons();
icons();

/* Jembatan panel owner: perubahan harga/produk tampil langsung tanpa muat ulang. */
window.wk = {
  refresh: async () => {
    await loadCatalog();
    if (m) {
      const cur = PRODUCTS.find((p) => p.slug === m.p.slug);
      if (!cur) closeModal();
      else {
        m.p = cur;
        if (!cur.variants?.[m.vi]) m.vi = Math.max(0, (cur.variants || []).indexOf(pick(cur)));
        m.qty = Math.min(m.qty, maxQty(cur.variants?.[m.vi]));
        renderDialog();
      }
    }
    if (bm) {
      if (!BUNDLE || BUNDLE.enabled === false) closeModal();
      else {
        bm.bundle = BUNDLE;
        bm.p1 = PRODUCTS.find((p) => p.slug === BUNDLE.prod1) || { name: BUNDLE.prod1, slug: BUNDLE.prod1 };
        bm.p2 = PRODUCTS.find((p) => p.slug === BUNDLE.prod2) || { name: BUNDLE.prod2, slug: BUNDLE.prod2 };
        renderBundleDialog();
      }
    }
    renderChips();
    renderCatalog();
    renderBundle();
  }
};
initSiteClock();

function checkUrlDeepLink() {
  const hash = location.hash;
  if (hash === '#test-sukses' || hash === '#demo-sukses') {
    const demoOrder = {
      code: 'POJOK-DEMO77',
      createdAt: new Date().toISOString(),
      total: 10000,
      buyer: { name: 'Sobat PojokAI', email: 'demo@pojokai.my.id', wa: '081234567890' },
      product: { name: 'ChatGPT Plus', variant: '1 Bulan Private', qty: 1, price: 10000 },
      status: 'Diproses (Pembayaran Terverifikasi)',
      wistapay: { reference: 'API2026DEMO77', payment_id: 'demo-77' }
    };
    setTimeout(() => {
      onPaymentSuccess(demoOrder);
    }, 200);
    return;
  }
  const match = hash.match(/^#\/?produk\/([a-z0-9\-]+)/i);
  const param = new URLSearchParams(location.search).get('p');
  const slug = match ? match[1] : param;
  if (slug) {
    const prod = PRODUCTS.find((p) => p.slug === slug && !p.hidden);
    if (prod) {
      setTimeout(() => openModal(prod), 150);
    }
  }
}

window.addEventListener('hashchange', checkUrlDeepLink);
checkUrlDeepLink();

/* ---------- Interactive Chatbox Assistant ---------- */
function initChatbox() {
  const root = $('#chatboxRoot');
  const toggleBtn = $('#chatboxToggleBtn');
  const windowEl = $('#chatboxWindow');
  const tooltip = $('#chatboxTooltip');
  const tooltipClose = $('#chatboxTooltipClose');
  const closeBtn = $('#chatboxCloseBtn');
  const resetBtn = $('#chatboxResetBtn');
  const messagesEl = $('#chatboxMessages');
  const form = $('#chatboxForm');
  const input = $('#chatboxInput');
  const iconOpen = $('#chatboxIconOpen');
  const iconClose = $('#chatboxIconClose');

  if (!root || !toggleBtn || !windowEl) return;

  const CHAT_STORAGE_KEY = 'pojokai:chat_history';
  const TOOLTIP_DISMISSED_KEY = 'pojokai:chat_tooltip_closed';

  if (localStorage.getItem(TOOLTIP_DISMISSED_KEY) === '1') {
    tooltip?.classList.add('hidden');
  }

  tooltipClose?.addEventListener('click', (e) => {
    e.stopPropagation();
    tooltip?.classList.add('hidden');
    localStorage.setItem(TOOLTIP_DISMISSED_KEY, '1');
  });

  let isOpen = false;

  const toggleChatbox = (open = null) => {
    isOpen = open !== null ? open : !isOpen;
    if (isOpen) {
      windowEl.classList.remove('hidden');
      windowEl.classList.add('flex');
      iconOpen?.classList.add('hidden');
      iconClose?.classList.remove('hidden');
      iconClose?.classList.add('flex');
      tooltip?.classList.add('hidden');
      localStorage.setItem(TOOLTIP_DISMISSED_KEY, '1');
      setTimeout(() => {
        input?.focus();
        scrollToBottom();
      }, 60);
      icons();
    } else {
      windowEl.classList.add('hidden');
      windowEl.classList.remove('flex');
      iconOpen?.classList.remove('hidden');
      iconClose?.classList.add('hidden');
      iconClose?.classList.remove('flex');
    }
  };

  toggleBtn.addEventListener('click', () => toggleChatbox());
  closeBtn?.addEventListener('click', () => toggleChatbox(false));

  const scrollToBottom = () => {
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  };

  const getStoredMessages = () => {
    try {
      const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].html || parsed[0].text)) {
          return parsed;
        }
      }
    } catch {}
    return null;
  };

  const saveMessages = (msgs) => {
    try {
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs.slice(-50)));
    } catch {}
  };

  const initialGreeting = () => [
    {
      sender: 'bot',
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      text: '',
      html: `
        <div class="flex items-center gap-2.5 p-2 rounded-xl bg-surface/80 border border-line-soft shadow-2xs mb-2">
          <div class="relative size-10 shrink-0 rounded-xl p-0.5 bot-aura-bg shadow-sm">
            <div class="size-full rounded-[10px] overflow-hidden bg-surface relative bot-avatar-float">
              <img src="/assets/branding/pojokai-bot-avatar.gif" alt="PojokAI" class="size-full object-cover">
            </div>
            <span class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-surface"></span>
          </div>
          <div>
            <div class="flex items-center gap-1.5 font-bold text-main text-[12px]">
              <span>Halo kak! 👋</span>
              <span class="px-1.5 py-0.2 rounded bg-primary/15 text-primary text-[9px] font-bold">Bot PojokAI</span>
            </div>
            <p class="text-[10.5px] text-muted leading-tight mt-0.5">Asisten virtual siap bantu cari akun &amp; cek pesanan 24/7!</p>
          </div>
        </div>
        Mau cek status pesanan? Tekan tombol <b>📦 Cek Pesanan</b> di bawah, lalu kirim <b>Kode Pembelian</b> kamu ya!
      `
    }
  ];

  let messages = getStoredMessages() || initialGreeting();

  const renderMessages = () => {
    if (!messagesEl) return;
    messagesEl.innerHTML = messages.map((m) => {
      const isBot = m.sender === 'bot';
      return `
        <div class="flex items-start gap-2 ${isBot ? '' : 'flex-row-reverse'} animate-in fade-in duration-200">
          ${isBot ? `
            <div class="size-7 rounded-full overflow-hidden shrink-0 ring-1 ring-primary/40 bg-surface-2 mt-0.5 bot-avatar-breathe shadow-2xs">
              <img src="/assets/branding/pojokai-bot-avatar.gif" alt="Bot" class="size-full object-cover">
            </div>
          ` : ''}
          <div class="max-w-[82%] space-y-1">
            <div class="p-2.5 rounded-2xl text-[12px] leading-relaxed shadow-2xs ${
              isBot 
                ? 'bg-surface-2 border border-line text-main rounded-tl-xs' 
                : 'bg-primary text-primary-fg rounded-tr-xs'
            }">
              ${m.html || esc(m.text).replace(/\n/g, '<br>')}
            </div>
            <p class="text-[9.5px] text-muted ${isBot ? 'text-left pl-1' : 'text-right pr-1'} font-mono">${m.time}</p>
          </div>
        </div>
      `;
    }).join('');
    icons();
    scrollToBottom();
  };

  renderMessages();

  resetBtn?.addEventListener('click', () => {
    messages = initialGreeting();
    saveMessages(messages);
    renderMessages();
    toast('Percakapan dibersihkan');
  });

  const appendBotMessage = (content, html = null) => {
    messages.push({
      sender: 'bot',
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      text: typeof content === 'string' ? content : '',
      html: html || (typeof content === 'string' ? content : null)
    });
    saveMessages(messages);
    renderMessages();
  };

  const appendUserMessage = (text) => {
    messages.push({
      sender: 'user',
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      text: text
    });
    saveMessages(messages);
    renderMessages();
  };

  const showTypingIndicator = () => {
    const id = 'typingIndicator';
    let el = $('#' + id);
    if (!el && messagesEl) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'flex items-center gap-2 animate-in fade-in duration-150';
      el.innerHTML = `
        <div class="size-7 rounded-full overflow-hidden shrink-0 ring-1 ring-primary/40 bg-surface-2 mt-0.5 bot-typing-nod shadow-2xs">
          <img src="/assets/branding/pojokai-bot-avatar.gif" alt="Bot" class="size-full object-cover">
        </div>
        <div class="p-2.5 rounded-2xl rounded-tl-xs bg-surface-2 border border-line flex items-center gap-1 shadow-2xs">
          <span class="size-1.5 rounded-full bg-primary animate-bounce"></span>
          <span class="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0.15s]"></span>
          <span class="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0.3s]"></span>
        </div>
      `;
      messagesEl.appendChild(el);
      scrollToBottom();
    }
  };

  const hideTypingIndicator = () => {
    $('#typingIndicator')?.remove();
  };

  const handleUserQuery = async (rawQuery) => {
    const q = rawQuery.trim();
    if (!q) return;

    appendUserMessage(q);
    showTypingIndicator();

    const lower = q.toLowerCase();

    // 1. Order Code Tracking Detection (e.g. POJOK-XXXXXX or phone number)
    const codeMatch = q.match(/POJOK-[A-Z0-9]{4,10}/i);
    const waMatch = q.match(/(\+?62|08)[0-9]{8,13}/);

    await new Promise(r => setTimeout(r, 450));
    hideTypingIndicator();

    if (codeMatch || (waMatch && (lower.includes('cek') || lower.includes('pesanan') || lower.includes('order')))) {
      const searchKey = codeMatch ? codeMatch[0].toUpperCase() : waMatch[0].replace(/\D/g, '');
      try {
        const res = await fetch(`/api/orders?q=${encodeURIComponent(searchKey)}`);
        const data = await res.json();
        const orders = data.orders || [];
        if (orders.length > 0) {
          const ord = orders[0];
          const isPaid = ord.status && (ord.status.includes('Lunas') || ord.status.includes('Diproses') || ord.status.includes('Selesai'));
          const html = `
            <div class="space-y-2">
              <p class="font-bold text-main">📦 Ditemukan Pesanan <b>${esc(ord.code)}</b></p>
              <div class="rounded-xl border border-line bg-surface p-2.5 space-y-1 text-[11px]">
                <div class="flex justify-between"><span>Produk:</span><b>${esc(ord.product?.name)} (${esc(ord.product?.variant)})</b></div>
                <div class="flex justify-between"><span>Total:</span><b class="text-primary">${rp(ord.total)}</b></div>
                <div class="flex justify-between"><span>Status:</span><b class="${isPaid ? 'text-emerald-500' : 'text-amber-500'}">${esc(ord.status)}</b></div>
              </div>
              <div class="flex gap-1.5 pt-1">
                ${!isPaid ? `
                  <button type="button" data-chat-pay="${esc(ord.code)}" class="flex-1 py-1.5 px-2.5 rounded-lg bg-primary text-primary-fg font-bold text-center text-[10.5px] hover:opacity-90 cursor-pointer">
                    Bayar QRIS
                  </button>
                ` : ''}
                <a href="https://wa.me/${WA_ADMIN}?text=${encodeURIComponent(`Halo admin, saya mau tanya pesanan ${ord.code}`)}" target="_blank" class="flex-1 py-1.5 px-2.5 rounded-lg border border-line bg-surface hover:bg-surface-2 font-bold text-center text-[10.5px] text-main">
                  Chat Admin
                </a>
              </div>
            </div>
          `;
          return appendBotMessage('', html);
        }
      } catch {}
      return appendBotMessage(`Pesanan <b>${esc(searchKey)}</b> belum ditemukan di database. Pastikan kode pesanan Anda sudah benar (contoh: <code>POJOK-8L7HVW</code>) atau hubungi WhatsApp Admin.`);
    }

    // 2. Cek Pesanan Prompt (Jika user tanya cek pesanan tanpa kode)
    if (lower === 'pesanan' || lower === 'cek pesanan' || lower.includes('cek pesanan') || lower.includes('cek status') || lower.includes('lacak') || lower.includes('tracking') || lower.includes('status pesanan') || lower.includes('pesanan saya') || lower.includes('mau cek')) {
      const stored = (getStoredOrders() || []).slice(0, 3);
      const recentHtml = stored.length > 0 
        ? `
          <div class="pt-1.5 border-t border-line-soft">
            <p class="text-[10.5px] text-muted mb-1.5 font-semibold">Atau pilih langsung kode pesanan kamu:</p>
            <div class="flex flex-wrap gap-1.5">
              ${stored.map(o => `
                <button type="button" data-chat-select-code="${esc(o.code)}" class="px-2.5 py-1 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary font-mono text-[11px] font-bold transition cursor-pointer">
                  ${esc(o.code)}
                </button>
              `).join('')}
            </div>
          </div>
        ` 
        : '';

      if (input) {
        input.placeholder = 'Ketik kode pesanan (misal: POJOK-8L7HVW)...';
        input.focus();
      }

      return appendBotMessage('', `
        <div class="space-y-2">
          <p class="font-bold text-main flex items-center gap-1.5">
            <i data-lucide="package-search" class="size-4 text-primary"></i>
            <span>Cek Status Pesanan</span>
          </p>
          <p class="text-[11.5px] text-muted leading-relaxed">
            Silakan kirimkan <b>Kode Pembelian</b> Anda di kolom pesan bawah ya kak (contoh: <code class="font-mono text-primary bg-primary/10 px-1 py-0.5 rounded font-bold">POJOK-8L7HVW</code>).
          </p>
          <p class="text-[10.5px] text-subtle leading-tight">
            Kode pesanan dapat Anda lihat di invoice WhatsApp transaksi atau layar setelah checkout. Begitu dikirim, saya langsung lacak statusnya secara realtime! ⚡
          </p>
          ${recentHtml}
        </div>
      `);
    }

    // 3. Quick Topic: Produk Populer (Hanya produk aktif, sembunyikan yang p.hidden)
    if (lower === 'produk' || lower.includes('rekomendasi') || lower.includes('katalog') || lower.includes('daftar produk') || lower.includes('populer')) {
      const visibleProducts = (PRODUCTS || []).filter(p => !p.hidden);
      const popular = visibleProducts.slice(0, 4);
      const itemsHtml = popular.map(p => `
        <div class="flex items-center justify-between p-2 rounded-xl bg-surface border border-line">
          <div class="flex items-center gap-2">
            ${cardImg(p, 'size-8 rounded-lg object-cover bg-surface-2')}
            <div>
              <p class="font-bold text-main text-[11.5px]">${esc(p.name)}</p>
              <p class="text-[10px] text-primary font-bold">Mulai ${rp(p.price || p.variants?.[0]?.price || 0)}</p>
            </div>
          </div>
          <button type="button" data-chat-buy="${esc(p.slug)}" class="py-1 px-2.5 rounded-lg bg-primary text-primary-fg text-[10.5px] font-bold hover:opacity-90 cursor-pointer">
            Beli
          </button>
        </div>
      `).join('');
      return appendBotMessage('', `
        <div class="space-y-2">
          <p class="font-bold text-main">🔥 Produk Terpopuler Hari Ini:</p>
          <div class="space-y-1.5">${itemsHtml}</div>
          <p class="text-[10.5px] text-muted">Klik <b>Beli</b> pada produk di atas atau ketik nama aplikasi yang kamu cari.</p>
        </div>
      `);
    }
    // 3. QRIS / Cara Bayar
    if (lower.includes('qris') || lower.includes('bayar') || lower.includes('transfer') || lower.includes('wistapay') || lower.includes('metode')) {
      return appendBotMessage('', `
        <div class="space-y-1.5">
          <p class="font-bold text-main">💳 Cara Pembayaran QRIS Dinamis:</p>
          <ol class="list-decimal list-inside space-y-1 text-muted text-[11px]">
            <li>Pilih paket produk lalu klik <b>Beli Sekarang</b>.</li>
            <li>Scan QRIS Dinamis yang muncul menggunakan aplikasi m-Banking (BCA, Mandiri, BRI, BNI) atau e-Wallet (GoPay, OVO, DANA, ShopeePay).</li>
            <li>Nominal otomatis terkunci pas (bebas biaya admin).</li>
            <li>Sistem WistaPay memverifikasi transaksi secara <b>otomatis dalam hitungan detik</b> tanpa perlu kirim bukti transfer!</li>
          </ol>
        </div>
      `);
    }

    // 4. Garansi
    if (lower.includes('garansi') || lower.includes('klaim') || lower.includes('rusak') || lower.includes('replace') || lower.includes('masalah')) {
      return appendBotMessage('', `
        <div class="space-y-1.5">
          <p class="font-bold text-main">🛡️ Jaminan Garansi 100% PojokAI:</p>
          <p class="text-[11px] text-muted">Seluruh produk akun bergaransi penuh sesuai durasi paket yang kamu beli. Jika akun mengalami kendala atau back free, admin langsung ganti akun baru (replace) atau dibantu perbaikan secepatnya.</p>
          <a href="https://wa.me/${WA_ADMIN}?text=${encodeURIComponent('Halo admin, saya ingin klaim garansi pesanan saya.')}" target="_blank" class="inline-flex items-center gap-1.5 font-bold text-primary hover:underline text-[11px] pt-1">
            <i data-lucide="message-circle" class="size-3.5"></i> Hubungi Admin untuk Klaim Garansi
          </a>
        </div>
      `);
    }

    // 5. Product Search in PRODUCTS Catalog
    const matchedProducts = (PRODUCTS || []).filter(p => {
      if (p.hidden) return false;
      const name = p.name.toLowerCase();
      const slug = p.slug.toLowerCase();
      const cat = (p.cat || '').toLowerCase();
      return name.includes(lower) || lower.includes(name) || slug.includes(lower) || lower.includes(slug) || cat.includes(lower);
    }).slice(0, 3);

    if (matchedProducts.length > 0) {
      const cards = matchedProducts.map(p => `
        <div class="flex items-center justify-between p-2 rounded-xl bg-surface border border-line">
          <div class="flex items-center gap-2">
            <img src="${esc(p.image || `assets/products/${p.slug}.webp`)}" alt="${esc(p.name)}" class="size-8 rounded-lg object-cover bg-surface-2">
            <div>
              <p class="font-bold text-main text-[11.5px]">${esc(p.name)}</p>
              <p class="text-[10px] text-primary font-bold">Mulai ${rp(p.price || p.variants?.[0]?.price || 0)}</p>
            </div>
          </div>
          <button type="button" data-chat-buy="${esc(p.slug)}" class="py-1 px-2.5 rounded-lg bg-primary text-primary-fg text-[10.5px] font-bold hover:opacity-90 cursor-pointer">
            Lihat
          </button>
        </div>
      `).join('');
      return appendBotMessage('', `
        <div class="space-y-2">
          <p class="font-bold text-main">Ditemukan produk untuk "<b>${esc(q)}</b>":</p>
          <div class="space-y-1.5">${cards}</div>
        </div>
      `);
    }

    // 6. Admin / Human
    if (lower.includes('admin') || lower.includes('wa') || lower.includes('whatsapp') || lower.includes('kontak') || lower.includes('cs') || lower.includes('orang') || lower.includes('manusia')) {
      return appendBotMessage('', `
        <div class="space-y-1.5">
          <p class="font-bold text-main">💬 Hubungi Admin WhatsApp:</p>
          <p class="text-[11px] text-muted">Ingin bicara langsung dengan admin manusia? Silakan klik tombol di bawah untuk terhubung ke WhatsApp PojokAI.</p>
          <a href="https://wa.me/${WA_ADMIN}?text=${encodeURIComponent(`Halo admin PojokAI, saya butuh bantuan: ${q}`)}" target="_blank" class="inline-flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-[#25D366] text-white font-bold text-[11.5px] shadow-sm hover:bg-[#20ba59] transition">
            <i data-lucide="message-circle" class="size-4"></i> Buka WhatsApp Admin
          </a>
        </div>
      `);
    }

    // 7. Greeting
    if (/^(halo|hai|hey|hei|pagi|siang|sore|malam|assalamualaikum|tes|test|p)\b/i.test(lower)) {
      return appendBotMessage(`Halo kak! 😊 Ada yang bisa saya bantu hari ini? Kamu bisa tanya ketersediaan akun aplikasi premium (ChatGPT, Netflix, Canva, dll), cek status pesanan, atau cara bayar via QRIS.`);
    }

    // 8. Thank you
    if (/^(makasih|terima kasih|thanks|ok|oke|sip|mantap|siap)\b/i.test(lower)) {
      return appendBotMessage(`Sama-sama kak! Senang bisa membantu. Jika butuh bantuan lainnya jangan ragu untuk chat lagi ya! 🙏✨`);
    }

    // 9. Default Fallback
    appendBotMessage('', `
      <div class="space-y-2">
        <p class="text-main">Terima kasih atas pertanyaannya kak! Untuk pertanyaan lebih lanjut mengenai "<b>${esc(q)}</b>", admin kami siap membantu langsung via WhatsApp.</p>
        <a href="https://wa.me/${WA_ADMIN}?text=${encodeURIComponent(`Halo admin PojokAI, saya mau tanya: ${q}`)}" target="_blank" class="inline-flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-[#25D366] text-white font-bold text-[11.5px] shadow-sm hover:bg-[#20ba59] transition">
          <i data-lucide="message-circle" class="size-4"></i> Chat WhatsApp Admin
        </a>
      </div>
    `);
  };

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = input?.value || '';
    if (val.trim()) {
      input.value = '';
      handleUserQuery(val);
    }
  });

  // Handle Quick Chips & Chat Action Buttons
  document.addEventListener('click', (e) => {
    const quickBtn = e.target.closest('[data-chat-quick]');
    if (quickBtn) {
      const topic = quickBtn.dataset.chatQuick;
      if (topic === 'produk') handleUserQuery('produk');
      else if (topic === 'pesanan') handleUserQuery('cek pesanan');
      else if (topic === 'qris') handleUserQuery('cara bayar qris');
      else if (topic === 'garansi') handleUserQuery('garansi akun');
      else if (topic === 'admin') handleUserQuery('hubungi admin');
      return;
    }

    const buyBtn = e.target.closest('[data-chat-buy]');
    if (buyBtn) {
      const slug = buyBtn.dataset.chatBuy;
      const prod = (PRODUCTS || []).find(p => p.slug === slug);
      if (prod) {
        openModal(prod);
        toggleChatbox(false);
      }
      return;
    }

    const payBtn = e.target.closest('[data-chat-pay]');
    if (payBtn) {
      const code = payBtn.dataset.chatPay;
      const ord = (getStoredOrders() || []).find(o => o.code === code);
      if (ord) {
        openPaymentModal(ord);
        toggleChatbox(false);
      } else {
        fetch(`/api/orders?code=${encodeURIComponent(code)}`)
          .then(r => r.json())
          .then(data => {
            if (data.orders?.[0]) {
              openPaymentModal(data.orders[0]);
              toggleChatbox(false);
            }
          });
      }
      return;
    }
    const selectCodeBtn = e.target.closest('[data-chat-select-code]');
    if (selectCodeBtn) {
      const code = selectCodeBtn.dataset.chatSelectCode;
      if (code) handleUserQuery(code);
      return;
    }
  });
}

initChatbox();

/* ==============================================================================
   Pemberitahuan Website Sedang Dalam Pembangunan (Under Construction Pop-up)
   ============================================================================== */

function shouldShowConstructionModal() {
  // Jangan tampilkan jika sedang berada di halaman owner/admin
  if (location.pathname === '/admin' || location.hash === '#admin') return false;

  // URL query parameter untuk pengujian manual: ?popup=1 atau ?preview=construction
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('popup') === '1' || params.get('preview') === 'construction') return true;
  } catch {}

  // Jangan tampilkan jika user mencentang "Jangan tampilkan lagi hari ini"
  try {
    const hideUntil = localStorage.getItem('wk_construction_hide_until');
    if (hideUntil && Number(hideUntil) > Date.now()) return false;
  } catch {}

  // Jangan tampilkan jika sudah pernah ditutup dalam sesi browser ini
  try {
    if (sessionStorage.getItem('wk_construction_dismissed')) return false;
  } catch {}

  return true;
}

function openConstructionModal() {
  const modal = $('#constructionModal');
  const dialog = $('#constructionDialog');
  if (!modal) return;

  // Pastikan tautan WhatsApp terpasang dengan nomor admin resmi & pesan otomatis
  const waBtn = $('#constructionWaBtn');
  if (waBtn) {
    const waNum = WA_ADMIN || '6283171982973';
    const msg = 'Halo Admin PojokAI, saya melihat website sedang dalam tahap pengembangan. Mau tanya stok & info pemesanan akun premium ya kak...';
    waBtn.href = `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
  }

  modal.classList.replace('hidden', 'flex');
  document.documentElement.style.overflow = 'hidden';
  icons();
  setTimeout(() => {
    dialog?.focus({ preventScroll: true });
  }, 60);
}

function closeConstructionModal() {
  const modal = $('#constructionModal');
  if (!modal) return;

  // Simpan preferensi jika dicentang "Jangan tampilkan lagi hari ini" (24 jam)
  const dontShowCheck = $('#constructionDontShowToday');
  if (dontShowCheck && dontShowCheck.checked) {
    try {
      localStorage.setItem('wk_construction_hide_until', String(Date.now() + 24 * 60 * 60 * 1000));
    } catch {}
  }

  // Simpan flag sesi browser agar tidak mengganggu navigasi selama tab terbuka
  try {
    sessionStorage.setItem('wk_construction_dismissed', '1');
  } catch {}

  modal.classList.add('hidden');
  modal.classList.remove('flex');

  // Kembalikan scroll body jika tidak ada modal lain yang aktif
  const mainModal = $('#modal');
  const adminModal = $('#aModal');
  const hasOtherModal = (mainModal && !mainModal.classList.contains('hidden')) ||
                        (adminModal && !adminModal.classList.contains('hidden'));
  if (!hasOtherModal) {
    document.documentElement.style.overflow = '';
  }
}

function initConstructionNotice() {
  $('#constructionCloseBtn')?.addEventListener('click', closeConstructionModal);
  $('#constructionDismissBtn')?.addEventListener('click', closeConstructionModal);
  $('#constructionBannerBtn')?.addEventListener('click', openConstructionModal);

  // Klik area backdrop untuk menutup modal
  $('#constructionModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'constructionModal') {
      closeConstructionModal();
    }
  });

  // Tombol Escape menutup modal jika terbuka
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('#constructionModal');
      if (modal && !modal.classList.contains('hidden')) {
        closeConstructionModal();
      }
    }
  });

  // Tampilkan otomatis untuk pengunjung yang baru masuk
  if (shouldShowConstructionModal()) {
    setTimeout(() => {
      openConstructionModal();
    }, 400);
  }
}

window.openConstructionModal = openConstructionModal;
window.closeConstructionModal = closeConstructionModal;

initConstructionNotice();

/* ---------- Portal Nokos OTP (5sim Integration) ---------- */
const NOKOS_APPS = [
  { id: 'whatsapp', name: 'WhatsApp', price: 'Rp3.500', icon: 'message-circle' },
  { id: 'telegram', name: 'Telegram', price: 'Rp2.500', icon: 'send' },
  { id: 'tiktok', name: 'TikTok', price: 'Rp2.000', icon: 'music' },
  { id: 'google', name: 'Google / Gmail', price: 'Rp1.500', icon: 'mail' },
  { id: 'openai', name: 'OpenAI / ChatGPT', price: 'Rp3.000', icon: 'bot' },
  { id: 'twitter', name: 'Twitter / X', price: 'Rp1.500', icon: 'hash' },
  { id: 'instagram', name: 'Instagram', price: 'Rp2.000', icon: 'camera' },
  { id: 'discord', name: 'Discord', price: 'Rp2.000', icon: 'gamepad-2' },
  { id: 'facebook', name: 'Facebook', price: 'Rp2.000', icon: 'users' },
  { id: 'shopee', name: 'Shopee', price: 'Rp2.500', icon: 'shopping-cart' },
  { id: 'gojek', name: 'Gojek', price: 'Rp3.000', icon: 'bike' },
  { id: 'other', name: 'Aplikasi Lainnya', price: 'Rp1.500', icon: 'layers' },
];

let activeNokosOrder = null;
let nokosPollInterval = null;
let selectedNokosApp = 'whatsapp';

function getStoredNokosOrder() {
  try {
    const raw = localStorage.getItem('pojokai:active_nokos_order');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredNokosOrder(order) {
  activeNokosOrder = order;
  try {
    if (order) {
      localStorage.setItem('pojokai:active_nokos_order', JSON.stringify(order));
    } else {
      localStorage.removeItem('pojokai:active_nokos_order');
    }
  } catch {}
}

function renderNokosAppGrid() {
  const grid = $('#nokosAppGrid');
  if (!grid) return;
  grid.innerHTML = NOKOS_APPS.map((app) => {
    const isSelected = app.id === selectedNokosApp;
    return `
      <button type="button" data-app-id="${app.id}" class="nokos-app-card flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition cursor-pointer ${
        isSelected
          ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
          : 'border-line bg-surface hover:bg-surface-2 text-main'
      }">
        <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-main">
          <i data-lucide="${app.icon}" class="size-4"></i>
        </span>
        <div class="min-w-0 flex-1">
          <span class="block truncate text-xs font-bold leading-tight">${esc(app.name)}</span>
          <span class="block text-[10px] text-muted">${esc(app.price)}</span>
        </div>
      </button>
    `;
  }).join('');
  icons();
}

function updateNokosPriceEstimate() {
  const app = NOKOS_APPS.find((a) => a.id === selectedNokosApp) || NOKOS_APPS[0];
  const el = $('#nokosPriceEstimate');
  if (el) el.textContent = app.price;
}

function switchNokosTab(tab) {
  const tabs = ['buy', 'otp', 'settings'];
  tabs.forEach((t) => {
    const btn = $(`#nokosTabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const view = $(`#nokosView${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (t === tab) {
      btn?.classList.add('bg-primary', 'text-primary-fg', 'shadow-sm');
      btn?.classList.remove('text-muted');
      view?.classList.remove('hidden');
    } else {
      btn?.classList.remove('bg-primary', 'text-primary-fg', 'shadow-sm');
      btn?.classList.add('text-muted');
      view?.classList.add('hidden');
    }
  });

  if (tab === 'buy') {
    renderNokosAppGrid();
    checkFivesimConfig();
  } else if (tab === 'otp') {
    if (activeNokosOrder) {
      $('#nokosActiveBox')?.classList.remove('hidden');
      $('#nokosNoOrderState')?.classList.add('hidden');
      renderNokosOrderData(activeNokosOrder);
      if (activeNokosOrder.status === 'PENDING') {
        startNokosPolling(activeNokosOrder.id);
      }
    } else {
      $('#nokosActiveBox')?.classList.add('hidden');
      $('#nokosNoOrderState')?.classList.remove('hidden');
    }
  } else if (tab === 'settings') {
    loadFivesimSettings();
  }
}

async function checkFivesimConfig() {
  try {
    const res = await fetch('/api/fivesim/config');
    const data = await res.json();
    const alert = $('#nokosKeyAlert');
    if (alert) {
      if (!data.hasKey) {
        alert.classList.remove('hidden');
        alert.classList.add('flex');
      } else {
        alert.classList.add('hidden');
        alert.classList.remove('flex');
      }
    }
    return data;
  } catch {
    return { hasKey: false };
  }
}

async function loadFivesimSettings() {
  const config = await checkFivesimConfig();
  if (config.hasKey) {
    try {
      const pRes = await fetch('/api/fivesim/profile');
      const pData = await pRes.json();
      if (pData.ok && pData.profile) {
        $('#nokosProfileCard')?.classList.remove('hidden');
        if ($('#nokosBalanceDisplay')) $('#nokosBalanceDisplay').textContent = `${pData.profile.balance} RUB`;
        if ($('#nokosEmailDisplay')) $('#nokosEmailDisplay').textContent = pData.profile.email || '-';
      }
    } catch {}
  }
}

function openNokosModal(initialApp = 'whatsapp') {
  if (initialApp && NOKOS_APPS.some((a) => a.id === initialApp)) {
    selectedNokosApp = initialApp;
  }
  const modal = $('#nokosModal');
  if (!modal) return;

  activeNokosOrder = getStoredNokosOrder();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.documentElement.style.overflow = 'hidden';

  renderNokosAppGrid();
  updateNokosPriceEstimate();
  switchNokosTab('buy');
  checkFivesimConfig();
  icons();

  setTimeout(() => $('#nokosDialog')?.focus({ preventScroll: true }), 50);
}

function closeNokosModal() {
  stopNokosPolling();
  const modal = $('#nokosModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  const hasOther = ['#modal', '#aModal', '#constructionModal'].some((s) => {
    const el = $(s);
    return el && !el.classList.contains('hidden');
  });
  if (!hasOther) {
    document.documentElement.style.overflow = '';
  }
}

function renderNokosOrderData(order) {
  if (!order) return;
  const phone = order.phone ? (String(order.phone).startsWith('+') ? order.phone : '+' + order.phone) : '-';
  if ($('#nokosDisplayPhone')) $('#nokosDisplayPhone').textContent = phone;
  if ($('#nokosDisplayAppBadge')) $('#nokosDisplayAppBadge').textContent = (order.product || selectedNokosApp || 'Nokos').toUpperCase();
  if ($('#nokosDisplayCountryBadge')) $('#nokosDisplayCountryBadge').textContent = (order.country || 'Indonesia').toUpperCase();

  const smsList = order.sms || [];
  const hasSms = smsList.length > 0;

  if (hasSms) {
    const lastSms = smsList[smsList.length - 1];
    const code = lastSms.code || (lastSms.text ? lastSms.text.match(/\b\d{4,8}\b/)?.[0] : '') || '-';
    $('#nokosOtpEmptyState')?.classList.add('hidden');
    $('#nokosOtpSuccessState')?.classList.remove('hidden');
    if ($('#nokosOtpCodeDisplay')) $('#nokosOtpCodeDisplay').textContent = code;
    if ($('#nokosSmsTextDisplay')) $('#nokosSmsTextDisplay').textContent = lastSms.text || '(SMS Masuk)';
    if ($('#nokosStatusText')) $('#nokosStatusText').textContent = 'Kode OTP Berhasil Masuk!';
    $('#nokosStatusDot')?.classList.add('text-emerald-500');
    stopNokosPolling();
  } else {
    $('#nokosOtpEmptyState')?.classList.remove('hidden');
    $('#nokosOtpSuccessState')?.classList.add('hidden');
    if ($('#nokosStatusText')) $('#nokosStatusText').textContent = order.status === 'PENDING' ? 'Menunggu SMS OTP masuk...' : `Status: ${order.status}`;
  }
}

function startNokosPolling(orderId) {
  stopNokosPolling();
  if (!orderId) return;

  const poll = async () => {
    try {
      const res = await fetch(`/api/fivesim/check?orderId=${encodeURIComponent(orderId)}`);
      const data = await res.json();
      if (data.ok && data.order) {
        setStoredNokosOrder(data.order);
        renderNokosOrderData(data.order);
        if (data.order.status !== 'PENDING' && (data.order.sms?.length || 0) > 0) {
          stopNokosPolling();
        }
      }
    } catch {}
  };

  poll();
  nokosPollInterval = setInterval(poll, 4000);
}

function stopNokosPolling() {
  if (nokosPollInterval) {
    clearInterval(nokosPollInterval);
    nokosPollInterval = null;
  }
}

async function buyNokosOrder() {
  const btn = $('#nokosSubmitBuyBtn');
  const origHtml = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="size-4 animate-spin"></i><span>Menghubungi 5sim...</span>';
    icons();
  }

  const country = $('#nokosCountrySelect')?.value || 'indonesia';
  const operator = $('#nokosOperatorSelect')?.value || 'any';

  try {
    const res = await fetch('/api/fivesim/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: selectedNokosApp, country, operator }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Gagal membeli nomor dari 5sim');
    }

    setStoredNokosOrder(data.order);
    toast('Nomor berhasil didapatkan! Menunggu OTP...', 'ok');
    switchNokosTab('otp');
  } catch (err) {
    toast(err.message, 'err');
    const cfg = await checkFivesimConfig();
    if (!cfg.hasKey) {
      switchNokosTab('settings');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
      icons();
    }
  }
}

async function performNokosAction(action) {
  if (!activeNokosOrder?.id) return;
  const orderId = activeNokosOrder.id;

  try {
    const res = await fetch('/api/fivesim/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, action }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `Gagal menjalankan aksi ${action}`);

    if (action === 'finish') {
      toast('Order selesai dan nomor berhasil digunakan!', 'ok');
      setStoredNokosOrder(null);
      switchNokosTab('otp');
    } else if (action === 'cancel') {
      toast('Order dibatalkan. Saldo 5sim dikembalikan.', 'ok');
      setStoredNokosOrder(null);
      switchNokosTab('otp');
    } else if (action === 'ban') {
      toast('Nomor dilaporkan banned.', 'err');
      setStoredNokosOrder(null);
      switchNokosTab('otp');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

function initNokosPortal() {
  $('#nokosModalClose')?.addEventListener('click', closeNokosModal);
  $('#nokosTabBtnBuy')?.addEventListener('click', () => switchNokosTab('buy'));
  $('#nokosTabBtnOtp')?.addEventListener('click', () => switchNokosTab('otp'));
  $('#nokosTabBtnSettings')?.addEventListener('click', () => switchNokosTab('settings'));
  $('#nokosGoSettingsBtn')?.addEventListener('click', () => switchNokosTab('settings'));
  $('#nokosGoBuyBtn')?.addEventListener('click', () => switchNokosTab('buy'));

  $('#nokosAppGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-app-id]');
    if (!card) return;
    selectedNokosApp = card.dataset.appId;
    renderNokosAppGrid();
    updateNokosPriceEstimate();
  });

  $('#nokosSubmitBuyBtn')?.addEventListener('click', buyNokosOrder);

  $('#nokosCopyPhoneBtn')?.addEventListener('click', () => {
    const phone = $('#nokosDisplayPhone')?.textContent?.trim();
    if (phone && phone !== '-') {
      navigator.clipboard?.writeText(phone);
      toast('Nomor HP disalin ke clipboard!', 'ok');
    }
  });

  $('#nokosCopyOtpBtn')?.addEventListener('click', () => {
    const code = $('#nokosOtpCodeDisplay')?.textContent?.trim();
    if (code && code !== '------') {
      navigator.clipboard?.writeText(code);
      toast('Kode OTP disalin!', 'ok');
    }
  });

  $('#nokosBtnFinish')?.addEventListener('click', () => performNokosAction('finish'));
  $('#nokosBtnCancel')?.addEventListener('click', () => performNokosAction('cancel'));
  $('#nokosBtnBan')?.addEventListener('click', () => performNokosAction('ban'));

  $('#nokosFetchOrderBtn')?.addEventListener('click', async () => {
    const val = $('#nokosTrackOrderIdInput')?.value?.trim();
    if (!val) return toast('Masukkan ID Order 5sim terlebih dahulu.', 'err');
    try {
      const res = await fetch(`/api/fivesim/check?orderId=${encodeURIComponent(val)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Order tidak ditemukan');
      setStoredNokosOrder(data.order);
      renderNokosOrderData(data.order);
      $('#nokosActiveBox')?.classList.remove('hidden');
      $('#nokosNoOrderState')?.classList.add('hidden');
      if (data.order.status === 'PENDING') startNokosPolling(data.order.id);
      toast('Data order berhasil dimuat!', 'ok');
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('#nokosToggleKeyVisibility')?.addEventListener('click', () => {
    const input = $('#nokosApiKeyInput');
    if (input) {
      input.type = input.type === 'password' ? 'text' : 'password';
    }
  });

  $('#nokosTestKeyBtn')?.addEventListener('click', async () => {
    const btn = $('#nokosTestKeyBtn');
    const orig = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="size-3.5 animate-spin"></i><span>Mengecek...</span>';
      icons();
    }
    try {
      const res = await fetch('/api/fivesim/profile');
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Koneksi gagal');
      $('#nokosProfileCard')?.classList.remove('hidden');
      if ($('#nokosBalanceDisplay')) $('#nokosBalanceDisplay').textContent = `${data.profile.balance} RUB`;
      if ($('#nokosEmailDisplay')) $('#nokosEmailDisplay').textContent = data.profile.email || '-';
      toast(`Koneksi 5sim Berhasil! Saldo: ${data.profile.balance} RUB`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = orig;
        icons();
      }
    }
  });

  $('#nokosSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const apiKey = ($('#nokosApiKeyInput')?.value || '').trim();
    if (!apiKey) return toast('API Key tidak boleh kosong', 'err');
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fivesim: { apiKey } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan API Key');
      toast('API Key 5sim berhasil disimpan!', 'ok');
      loadFivesimSettings();
      checkFivesimConfig();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('#nokosModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'nokosModal') closeNokosModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = $('#nokosModal');
      if (m && !m.classList.contains('hidden')) closeNokosModal();
    }
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-nokos]');
    if (btn) {
      e.preventDefault();
      const app = btn.dataset.openNokos;
      openNokosModal(app === 'all' || !app ? 'whatsapp' : app);
    }
  });
}

window.openNokosModal = openNokosModal;
window.closeNokosModal = closeNokosModal;

initNokosPortal();
