# Waroengkuy Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional, responsive recreation of waroengkuy.com (digital account store & social media services) in `C:\experiment bro\waroengkuy2/index.html`.

**Architecture:** A robust single-file web application (`index.html`) utilizing Tailwind CSS via CDN, Lucide Icons, and Vanilla JavaScript for dynamic category filtering, interactive product modals, checkout simulation via WhatsApp, and order status tracking.

**Tech Stack:** HTML5, Tailwind CSS, JavaScript (ES6+), Lucide Icons, Google Fonts (Inter).

**Spec:** `docs/superpowers/specs/2026-10-11-waroengkuy-website-design.md`

## Global Constraints
- Theme: Dark mode first (`#0a0a0b` background, `#fafafa` text, green/indigo accents).
- Fully responsive across mobile, tablet, and desktop devices.
- Interactive features: Category tab switching, search filter, product modal, WhatsApp checkout generator, and order tracking.

---

### Task 1: Create Main HTML Structure & Tailwind Setup

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: Tailwind CSS CDN, Google Fonts, Lucide Icons.
- Produces: Base HTML layout with header, announcement bar, navigation, and footer.

- [ ] **Step 1: Create index.html with base head and styling**

```html
<!DOCTYPE html>
<html lang="id" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Waroengkuy - Pusat Akun Digital Premium & Jasa Sosial Media</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        darkBg: '#0a0a0b',
                        cardBg: '#121214',
                        accentGreen: '#22c55e',
                    }
                }
            }
        }
    </script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-darkBg text-zinc-100 min-h-screen flex flex-col antialiased">
    <!-- Header Placeholder -->
    <header id="header" class="sticky top-0 z-50 bg-darkBg/80 backdrop-blur-md border-b border-zinc-800"></header>
    <main class="flex-grow" id="main-content"></main>
    <footer id="footer" class="bg-cardBg border-t border-zinc-800 py-12 mt-20"></footer>
    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify file existence**

Run: `ls index.html`
Expected: `index.html` exists

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add base HTML structure for waroengkuy"
```

---

### Task 2: Implement UI Components and JavaScript Functionality (`app.js`)

**Files:**
- Create: `app.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: DOM elements in `index.html`.
- Produces: Dynamic product catalog, search filtering, tab switching, WhatsApp checkout modal, and order status tracker.

- [ ] **Step 1: Write `app.js` with product data and interactivity**

```javascript
// Product Dataset
const products = [
    { id: 1, category: 'premium', name: 'Netflix Premium 4K UHD', price: 35000, normalPrice: 120000, badge: 'Garansi 1 Bulan', rating: 4.9, sold: '1.4rb+', image: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=500&q=80' },
    { id: 2, category: 'ai', name: 'ChatGPT Plus (Shared Account)', price: 45000, normalPrice: 300000, badge: 'Instant Acc', rating: 5.0, sold: '850+', image: 'https://images.unsplash.com/photo-1677442136019-21780efad99a?w=500&q=80' },
    { id: 3, category: 'premium', name: 'Spotify Individual 1 Bulan', price: 15000, normalPrice: 54000, badge: 'Legal & Resmi', rating: 4.8, sold: '2.1rb+', image: 'https://images.unsplash.com/photo-1614680376593-902f749f7ffc?w=500&q=80' },
    { id: 4, category: 'ai', name: 'Claude 3.5 Sonnet Pro', price: 50000, normalPrice: 300000, badge: 'Fast Response', rating: 4.9, sold: '500+', image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80' },
    { id: 5, category: 'social', name: 'Instagram Followers (HQ 1000)', price: 25000, normalPrice: 75000, badge: 'No Password', rating: 4.7, sold: '3.5rb+', image: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=500&q=80' },
    { id: 6, category: 'social', name: 'TikTok Views (10.000 Views)', price: 10000, normalPrice: 30000, badge: 'Instant Process', rating: 4.9, sold: '4.2rb+', image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80' },
    { id: 7, category: 'other', name: 'Steam Wallet IDR 60.000', price: 58000, normalPrice: 60000, badge: 'Legal Code', rating: 5.0, sold: '920+', image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=500&q=80' },
    { id: 8, category: 'premium', name: 'Canva Pro Edu Lifetime', price: 20000, normalPrice: 150000, badge: 'Full Garansi', rating: 4.9, sold: '5.1rb+', image: 'https://images.unsplash.com/photo-1626785774573-4b799315345d?w=500&q=80' }
];

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    renderHeader();
    renderMainContent();
    renderFooter();
    setupEventListeners();
});

function renderHeader() {
    document.getElementById('header').innerHTML = `
        <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div class="flex items-center space-x-2 cursor-pointer" onclick="location.reload()">
                <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-green-500 to-emerald-400 flex items-center justify-center font-bold text-black text-xl shadow-lg shadow-green-500/20">W</div>
                <span class="text-xl font-bold tracking-tight text-white">Waroeng<span class="text-green-500">kuy</span></span>
            </div>
            <nav class="hidden md:flex items-center space-x-6 text-sm font-medium text-zinc-300">
                <a href="#home" class="hover:text-green-400 transition">Beranda</a>
                <a href="#products" class="hover:text-green-400 transition">Produk</a>
                <a href="#social" class="hover:text-green-400 transition">Jasa Sosmed</a>
                <a href="#reseller" class="hover:text-green-400 transition">Reseller</a>
                <a href="#tracker" class="hover:text-green-400 transition">Cek Pesanan</a>
                <a href="#faq" class="hover:text-green-400 transition">FAQ</a>
            </nav>
            <div>
                <a href="https://wa.me/6281234567890" target="_blank" class="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center space-x-2 shadow-lg shadow-green-600/20">
                    <i data-lucide="message-circle" class="w-4 h-4"></i>
                    <span>Admin WhatsApp</span>
                </a>
            </div>
        </div>
    `;
    lucide.createIcons();
}

function renderMainContent() {
    document.getElementById('main-content').innerHTML = `
        <!-- Hero Section -->
        <section id="home" class="py-16 px-4 text-center max-w-4xl mx-auto">
            <div class="inline-flex items-center space-x-2 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-full text-xs text-green-400 mb-6">
                <i data-lucide="shield-check" class="w-4 h-4"></i>
                <span>100% Bergaransi Resmi & Proses Otomatis</span>
            </div>
            <h1 class="text-4xl md:text-6xl font-extrabold text-white tracking-tight mb-6">
                Pusat Akun Digital Premium & <span class="text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-200">Jasa Sosmed Terpercaya</span>
            </h1>
            <p class="text-zinc-400 text-lg mb-8 max-w-2xl mx-auto">
                Dapatkan akun Netflix, ChatGPT Plus, Canva Pro, hingga penambah followers sosmed dengan harga termurah, proses instan, dan garansi penuh.
            </p>
            <div class="relative max-w-xl mx-auto">
                <input type="text" id="searchInput" placeholder="Cari layanan (misal: Netflix, ChatGPT, Followers)..." class="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:border-green-500 transition shadow-xl">
                <i data-lucide="search" class="w-5 h-5 text-zinc-500 absolute left-4 top-4.5"></i>
            </div>
        </section>

        <!-- Products Section -->
        <section id="products" class="max-w-7xl mx-auto px-4 py-12">
            <div class="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h2 class="text-2xl font-bold text-white">Katalog Layanan Unggulan</h2>
                    <p class="text-zinc-400 text-sm">Pilih produk digital & layanan sosial media sesuai kebutuhan Anda.</p>
                </div>
                <div class="flex flex-wrap gap-2" id="categoryTabs">
                    <button onclick="filterCategory('all')" class="cat-btn bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition">Semua</button>
                    <button onclick="filterCategory('premium')" class="cat-btn bg-zinc-900 text-zinc-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition border border-zinc-800">Akun Premium</button>
                    <button onclick="filterCategory('ai')" class="cat-btn bg-zinc-900 text-zinc-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition border border-zinc-800">Akun AI</button>
                    <button onclick="filterCategory('social')" class="cat-btn bg-zinc-900 text-zinc-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition border border-zinc-800">Jasa Sosmed</button>
                    <button onclick="filterCategory('other')" class="cat-btn bg-zinc-900 text-zinc-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition border border-zinc-800">Lainnya</button>
                </div>
            </div>

            <div id="productGrid" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                <!-- Rendered dynamically -->
            </div>
        </section>

        <!-- Order Tracker Section -->
        <section id="tracker" class="max-w-3xl mx-auto px-4 py-16">
            <div class="bg-cardBg border border-zinc-800 rounded-3xl p-8 shadow-2xl">
                <div class="text-center mb-6">
                    <h3 class="text-xl font-bold text-white mb-2">Cek Status Pesanan</h3>
                    <p class="text-zinc-400 text-sm">Masukkan nomor invoice atau WhatsApp untuk melacak pesanan Anda.</p>
                </div>
                <div class="flex gap-3">
                    <input type="text" id="invoiceInput" placeholder="Contoh: INV-827391" class="flex-grow bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-green-500">
                    <button onclick="checkOrder()" class="bg-green-600 hover:bg-green-500 text-white px-6 py-3 rounded-xl font-semibold transition">Lacak</button>
                </div>
                <div id="trackerResult" class="mt-4 text-sm text-center text-zinc-400"></div>
            </div>
        </section>

        <!-- Checkout Modal -->
        <div id="checkoutModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm hidden flex items-center justify-center p-4">
            <div class="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-md w-full p-6 relative shadow-2xl">
                <button onclick="closeModal()" class="absolute top-4 right-4 text-zinc-400 hover:text-white"><i data-lucide="x" class="w-6 h-6"></i></button>
                <h3 class="text-xl font-bold text-white mb-4">Konfirmasi Pembelian</h3>
                <div id="modalProductInfo" class="mb-6 p-4 bg-zinc-800/50 rounded-2xl border border-zinc-800"></div>
                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold text-zinc-400 mb-1">Nomor WhatsApp (untuk pengiriman akun)</label>
                        <input type="text" id="waInput" placeholder="0812xxxxxxxx" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-zinc-400 mb-1">Metode Pembayaran</label>
                        <select id="paymentMethod" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-green-500">
                            <option value="QRIS">QRIS (Scan All Payment - Instant)</option>
                            <option value="DANA">DANA / OVO / GoPay</option>
                            <option value="BCA">Transfer Bank BCA</option>
                        </select>
                    </div>
                    <button onclick="submitOrder()" class="w-full bg-green-600 hover:bg-green-500 text-white py-3.5 rounded-xl font-bold transition shadow-lg shadow-green-600/20">Pesan Sekarang via WhatsApp</button>
                </div>
            </div>
        </div>
    `;
    renderProducts(products);
    lucide.createIcons();
}

function renderProducts(list) {
    const grid = document.getElementById('productGrid');
    if (list.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-12 text-zinc-500">Produk tidak ditemukan.</div>`;
        return;
    }
    grid.innerHTML = list.map(p => `
        <div class="bg-cardBg border border-zinc-800 rounded-2xl overflow-hidden hover:border-green-500/50 transition group flex flex-col justify-between shadow-lg">
            <div>
                <div class="relative h-44 overflow-hidden bg-zinc-900">
                    <img src="${p.image}" alt="${p.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
                    <span class="absolute top-3 left-3 bg-green-500/90 text-black font-bold text-xs px-2.5 py-1 rounded-lg backdrop-blur-md">${p.badge}</span>
                </div>
                <div class="p-4">
                    <h3 class="font-semibold text-white text-base mb-2 group-hover:text-green-400 transition">${p.name}</h3>
                    <div class="flex items-center justify-between text-xs text-zinc-400 mb-3">
                        <div class="flex items-center space-x-1 text-amber-400">
                            <i data-lucide="star" class="w-3.5 h-3.5 fill-current"></i>
                            <span>${p.rating}</span>
                        </div>
                        <span>Terjual ${p.sold}</span>
                    </div>
                    <div class="flex items-baseline space-x-2">
                        <span class="text-green-400 font-extrabold text-lg">Rp ${p.price.toLocaleString('id-ID')}</span>
                        <span class="text-zinc-500 text-xs line-through">Rp ${p.normalPrice.toLocaleString('id-ID')}</span>
                    </div>
                </div>
            </div>
            <div class="p-4 pt-0">
                <button onclick="openCheckout(${p.id})" class="w-full bg-zinc-800 hover:bg-green-600 hover:text-white text-zinc-200 py-2.5 rounded-xl text-sm font-semibold transition flex items-center justify-center space-x-2">
                    <i data-lucide="shopping-cart" class="w-4 h-4"></i>
                    <span>Beli Sekarang</span>
                </button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function filterCategory(cat) {
    document.querySelectorAll('.cat-btn').forEach(btn => {
        btn.classList.remove('bg-green-600', 'text-white');
        btn.classList.add('bg-zinc-900', 'text-zinc-400', 'border', 'border-zinc-800');
    });
    event.target.classList.remove('bg-zinc-900', 'text-zinc-400', 'border', 'border-zinc-800');
    event.target.classList.add('bg-green-600', 'text-white');

    if (cat === 'all') {
        renderProducts(products);
    } else {
        renderProducts(products.filter(p => p.category === cat));
    }
}

let selectedProduct = null;
function openCheckout(id) {
    selectedProduct = products.find(p => p.id === id);
    if (!selectedProduct) return;
    document.getElementById('modalProductInfo').innerHTML = `
        <div class="flex items-center space-x-3">
            <img src="${selectedProduct.image}" class="w-14 h-14 rounded-xl object-cover">
            <div>
                <h4 class="font-bold text-white text-sm">${selectedProduct.name}</h4>
                <p class="text-green-400 font-extrabold text-sm">Rp ${selectedProduct.price.toLocaleString('id-ID')}</p>
            </div>
        </div>
    `;
    document.getElementById('checkoutModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('checkoutModal').classList.add('hidden');
}

function submitOrder() {
    const wa = document.getElementById('waInput').value;
    const payment = document.getElementById('paymentMethod').value;
    if (!wa || wa.length < 9) {
        alert('Masukkan nomor WhatsApp yang valid!');
        return;
    }
    const msg = `Halo Admin Waroengkuy, saya ingin memesan:\n\nProduk: *${selectedProduct.name}*\nHarga: *Rp ${selectedProduct.price.toLocaleString('id-ID')}*\nNo. WhatsApp: *${wa}*\nPembayaran: *${payment}*\n\nMohon diproses ya kak!`;
    window.open(`https://wa.me/6281234567890?text=${encodeURIComponent(msg)}`, '_blank');
    closeModal();
}

function checkOrder() {
    const inv = document.getElementById('invoiceInput').value;
    const res = document.getElementById('trackerResult');
    if (!inv) {
        res.innerHTML = '<span class="text-red-400">Masukkan nomor invoice terlebih dahulu.</span>';
        return;
    }
    res.innerHTML = `<span class="text-green-400">Pesanan ${inv} ditemukan: Status <b>SUKSES (Akun telah dikirim ke WhatsApp)</b>.</span>`;
}

function renderFooter() {
    document.getElementById('footer').innerHTML = `
        <div class="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-8 text-zinc-400 text-sm">
            <div>
                <div class="flex items-center space-x-2 mb-4">
                    <div class="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center font-bold text-black text-lg">W</div>
                    <span class="text-lg font-bold text-white">Waroeng<span class="text-green-500">kuy</span></span>
                </div>
                <p class="text-xs text-zinc-500 mb-4">Pusat layanan digital dan sosial media bergaransi, termurah, dan terpercaya di Indonesia.</p>
            </div>
            <div>
                <h4 class="text-white font-semibold mb-3 text-sm">Kategori</h4>
                <ul class="space-y-2 text-xs">
                    <li><a href="#products" class="hover:text-green-400 transition">Akun Premium</a></li>
                    <li><a href="#products" class="hover:text-green-400 transition">Akun AI</a></li>
                    <li><a href="#products" class="hover:text-green-400 transition">Jasa Sosmed</a></li>
                </ul>
            </div>
            <div>
                <h4 class="text-white font-semibold mb-3 text-sm">Bantuan</h4>
                <ul class="space-y-2 text-xs">
                    <li><a href="#tracker" class="hover:text-green-400 transition">Cek Pesanan</a></li>
                    <li><a href="#" class="hover:text-green-400 transition">Syarat & Ketentuan</a></li>
                    <li><a href="#" class="hover:text-green-400 transition">Kebijakan Garansi</a></li>
                </ul>
            </div>
            <div>
                <h4 class="text-white font-semibold mb-3 text-sm">Hubungi Kami</h4>
                <p class="text-xs text-zinc-500 mb-2">WhatsApp: 0812-3456-7890</p>
                <p class="text-xs text-zinc-500">Email: support@waroengkuy.com</p>
            </div>
        </div>
        <div class="max-w-7xl mx-auto px-4 mt-8 pt-8 border-t border-zinc-800/60 text-center text-xs text-zinc-600">
            &copy; 2026 Waroengkuy. All rights reserved.
        </div>
    `;
    lucide.createIcons();
}
```

- [ ] **Step 2: Verify `app.js` creation**

Run: `ls app.js`
Expected: `app.js` exists

- [ ] **Step 3: Commit**

```bash
git add app.js index.html
git commit -m "feat: implement waroengkuy interactive store logic and UI"
```
