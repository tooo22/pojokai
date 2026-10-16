const WA_ADMIN = '6281234567890';

const CATEGORIES = [
  { id: 'premium', anchor: 'sec-premium', title: 'Aplikasi Premium' },
  { id: 'ai', anchor: 'sec-ai', title: 'AI' },
  { id: 'lainnya', anchor: 'sec-lainnya', title: 'Lainnya' },
];

// rating.real = ulasan pembeli (ditampilkan tebal); tanpa real = rating otomatis
const PRODUCTS = [
  { slug: 'capcut-pro', name: 'CapCut Pro', cat: 'premium', price: 25000, strike: 75000, sold: 2130, hot: true, rating: { v: '5,0', n: 7, real: true } },
  { slug: 'apple-music', name: 'Apple Music', cat: 'premium', price: 10000, sold: 11, rating: { v: '5', n: 7 } },
  { slug: 'meitu', name: 'Meitu', cat: 'premium', price: 10000, sold: 102, stock: 4, rating: { v: '5', n: 74 } },
  { slug: 'alight-motion', name: 'Alight Motion', cat: 'premium', price: 10000, sold: 6, rating: { v: '5', n: 4 } },
  { slug: 'hbo-max', name: 'HBO Max', cat: 'premium', price: 20000, sold: 6, rating: { v: '5', n: 5 } },
  { slug: 'netflix-premium', name: 'Netflix Premium', cat: 'premium', price: 25000, strike: 35000, sold: 142, rating: { v: '5,0', n: 1, real: true } },
  { slug: 'youtube', name: 'YouTube', cat: 'premium', price: 10000, sold: 166, auto: true, hot: true, rating: { v: '5,0', n: 3, real: true } },
  { slug: 'canva', name: 'Canva', cat: 'premium', price: 10000, sold: 126, auto: true, rating: { v: '5', n: 110 } },
  { slug: 'zoom-pro', name: 'Zoom Pro', cat: 'premium', price: 10000, sold: 12, rating: { v: '5', n: 11 } },
  { slug: 'wink', name: 'Wink', cat: 'premium', price: 10000, sold: 23, rating: { v: '5', n: 18 } },
  { slug: 'scribd-pro', name: 'Scribd Pro', cat: 'premium', price: 10000, sold: 1, rating: { v: '5', n: 1 } },
  { slug: 'vidio', name: 'Vidio', cat: 'premium', price: 50000, baru: true, status: 'habis' },
  { slug: 'remini-web', name: 'Remini Web', cat: 'premium', price: 10000, status: 'habis', rating: { v: '5', n: 2 } },
  { slug: 'spotify', name: 'Spotify', cat: 'premium', price: 25000, status: 'habis' },

  { slug: 'leonardo-ai', name: 'Leonardo AI', cat: 'ai', price: 200000, stock: 2 },
  { slug: 'google-gemini', name: 'Google Gemini', cat: 'ai', price: 50000, sold: 164, auto: true, rating: { v: '5,0', n: 2, real: true } },
  { slug: 'perplexity-ai', name: 'Perplexity AI', cat: 'ai', baru: true, patungan: true },
  { slug: 'claude-ai', name: 'Claude AI', cat: 'ai', baru: true, patungan: true },
  { slug: 'chatgpt', name: 'ChatGPT', cat: 'ai', price: 75000, auto: true, baru: true, noWarranty: true, patungan: true, rating: { v: '5', n: 11 } },
  { slug: 'clico-ai', name: 'Clico AI', cat: 'ai', patungan: true },
  { slug: 'creaa-ai', name: 'Creaa AI', cat: 'ai', patungan: true },
  { slug: 'higgsfield-plus', name: 'Higgsfield Plus', cat: 'ai', price: 50000, status: 'habis', rating: { v: '5', n: 4 } },
  { slug: 'grok-ai', name: 'Grok AI', cat: 'ai', patungan: true, rating: { v: '5', n: 292 } },
  { slug: 'venice-ai', name: 'Venice AI', cat: 'ai', patungan: true, rating: { v: '5', n: 26 } },

  { slug: 'google-mail', name: 'Google Mail', cat: 'lainnya', price: 250, sold: 251, baru: true, hot: true, variants: '2 jenis · 5 pilihan' },
  { slug: 'hma-vpn', name: 'HMA VPN', cat: 'lainnya', price: 10000, baru: true, status: 'tersedia' },
  { slug: 'surfshark-vpn', name: 'Surfshark VPN', cat: 'lainnya', price: 10000, sold: 1, stock: 3, baru: true },
];

const HERO_SLIDES = [
  {
    eyebrow: 'Waroengkuy · Toko akun digital', title: 'Belanja aman & terpercaya', line2: 'Akun langsung dikirim ke WhatsApp.',
    sub: 'Bayar QRIS · bergaransi · admin ramah 24 jam', cta: 'Belanja sekarang', href: '#produk',
    items: [['🛡️', 'Akun bergaransi'], ['⚡', 'Dikirim otomatis ke WA'], ['⭐', 'Ribuan pembeli puas']],
  },
  {
    eyebrow: 'Baru · Jasa sosmed', title: 'Naikkan followers & views', line2: 'Otomatis, tanpa password.',
    sub: 'Pilih akun Indonesia atau global · bayar QRIS', cta: 'Lihat jasa sosmed', href: '#sosmed',
    items: [['📸', '+1.000 followers Instagram'], ['🎵', '+5.000 views TikTok'], ['▶️', '+500 subscribers YouTube']],
  },
  {
    eyebrow: 'Akun premium hemat', title: 'ChatGPT, Netflix, Canva & lainnya', line2: 'Aktif instan, harga bersahabat.',
    sub: 'Cek stok & pilih paket sesuai kebutuhanmu', cta: 'Lihat akun premium', href: '#sec-premium',
    items: [['🤖', 'ChatGPT Plus · aktif'], ['🎬', 'Netflix Premium · aktif'], ['🎨', 'Canva Pro · aktif']],
  },
  {
    eyebrow: 'Program reseller', title: 'Jualan akun digital tanpa modal', line2: 'Punya web toko sendiri.',
    sub: 'Harga modal khusus · pesanan otomatis · untung tiap penjualan', cta: 'Daftar reseller', href: '#reseller',
    items: [['🏪', 'Web toko atas namamu'], ['💸', 'Untung tiap penjualan'], ['📦', 'Tanpa stok & tanpa ribet']],
  },
];

const FAQS = [
  ['Berapa lama akun dikirim?', 'Setelah pembayaran QRIS terverifikasi, akun dikirim otomatis ke nomor WhatsApp kamu dalam hitungan detik — tanpa menunggu admin.'],
  ['Apakah akunnya aman?', 'Akun yang dikirim valid dan siap pakai. Detail garansi tertera pada masing-masing produk. Simpan baik-baik data yang kamu terima.'],
  ['Bagaimana kalau akun belum diterima?', 'Cek halaman status pesanan yang muncul setelah membayar — di sana ada detail akun beserta status pengiriman. Jika ada kendala, hubungi admin via WhatsApp.'],
  ['Apakah bisa refund?', 'Jika stok habis saat pembayaran, dana akan diproses kembali sesuai ketentuan toko. Untuk masalah lain, hubungi admin lewat WhatsApp.'],
];

// [nama, jumlah dalam 24 jam (null = pembelian tunggal), waktu]
const TICKER = [
  ['Surfshark VPN', null, '3 menit lalu'], ['YouTube', 5, '5 menit lalu'], ['CapCut Pro', 35, '30 menit lalu'],
  ['Canva', 2, '1 jam lalu'], ['Meitu', 3, '2 jam lalu'], ['Netflix Premium', 9, '6 jam lalu'],
  ['Google Mail', 3, '13 jam lalu'], ['Google Gemini', null, '15 jam lalu'], ['Instagram Followers', 2, '16 jam lalu'],
  ['ChatGPT', 5, '19 jam lalu'], ['TikTok Likes', null, '20 jam lalu'], ['Alight Motion', null, '21 jam lalu'],
];
