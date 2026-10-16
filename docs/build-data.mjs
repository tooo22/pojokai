// Membangun ulang assets/data.js dari docs/raw_catalog.json (hasil unduhan
// POST /api/toko?action=store_catalog waroengkuy.com).
// Jalankan: node docs/build-data.mjs
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(new URL('./raw_catalog.json', import.meta.url)));
const cur = fs.readFileSync(new URL('../assets/data.js', import.meta.url), 'utf8');

const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const bySlug = new Map(raw.products.map((p) => [slugify(p.title), p]));

const CAT = { 'Aplikasi Premium': 'premium', AI: 'ai', Lainnya: 'lainnya' };

// Badge yang tidak diekspos API katalog; angkanya sudah dicocokkan dengan chip
// count di waroengkuy.com (Terlaris 3, Baru 7, Hemat 2, Rating 4).
const FLAGS = {
  'capcut-pro': { hot: 1 },
  youtube: { hot: 1, auto: 1 },
  'google-mail': { hot: 1, baru: 1 },
  canva: { auto: 1 },
  'google-gemini': { auto: 1 },
  chatgpt: { auto: 1, baru: 1, noWarranty: 1, patungan: 1 },
  vidio: { baru: 1 },
  'hma-vpn': { baru: 1 },
  'surfshark-vpn': { baru: 1 },
  'perplexity-ai': { baru: 1 },
  'claude-ai': { baru: 1 },
};

// Urutan kartu pada sort default "Rekomendasi" di waroengkuy.com (bukan urutan API).
const ORDER = [
  'capcut-pro', 'apple-music', 'alight-motion', 'hbo-max', 'netflix-premium', 'youtube',
  'canva', 'zoom-pro', 'wink', 'scribd-pro', 'vidio', 'remini-web', 'meitu', 'spotify',
  'leonardo-ai', 'google-gemini', 'perplexity-ai', 'claude-ai', 'chatgpt', 'clico-ai',
  'creaa-ai', 'higgsfield-plus', 'grok-ai', 'venice-ai',
  'google-mail', 'hma-vpn', 'surfshark-vpn',
];

const line = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

// Baris pertama deskripsi varian yang isinya benar-benar keterangan (bukan label "**Yang didapat:**").
const shortDesc = (text) => {
  const l = text
    .split('\n')
    .map((s) => s.replace(/[*`]/g, '').replace(/^[-•]\s*/, '').trim())
    .find((s) => s.length > 6 && !s.endsWith(':'));
  return JSON.stringify(l || '');
};

const rows = [];
for (const slug of ORDER) {
  const p = bySlug.get(slug);
  if (!p) throw new Error('tidak ada di API: ' + slug);
  const f = FLAGS[slug] || {};
  const variants = p.variants.map((v) =>
    line({
      label: JSON.stringify(v.label),
      price: v.price,
      ...(v.original ? { strike: v.original } : {}),
      stock: v.available,
      ful: JSON.stringify(v.fulfillment),
      ...(v.description ? { d: shortDesc(v.description) } : {}),
    })
  );
  const groups = [...new Set(p.variants.map((v) => v.group).filter(Boolean))];
  const rating = p.rating
    ? `rating: { v: ${JSON.stringify(p.rating.avg.toLocaleString('id-ID', { minimumFractionDigits: 1 }))}, n: ${p.rating.n}, real: true }`
    : p.autoRated
      ? `rating: { v: '5', n: ${p.autoRated} }`
      : null;
  rows.push(
    '  { ' +
      line({
        slug: JSON.stringify(slug),
        name: JSON.stringify(p.title),
        cat: JSON.stringify(CAT[p.category]),
        ...(p.sold ? { sold: p.sold } : {}),
        ...(f.auto ? { auto: 'true' } : {}),
        ...(f.hot ? { hot: 'true' } : {}),
        ...(f.baru ? { baru: 'true' } : {}),
        ...(f.noWarranty ? { noWarranty: 'true' } : {}),
        ...(f.patungan || !p.variants.length ? { patungan: 'true' } : {}),
        ...(groups.length > 1 ? { grp: groups.length } : {}),
        ...(p.autoRated && p.rating ? { ar: p.autoRated } : {}),
        ...(p.manualFields?.length ? { mf: JSON.stringify(p.manualFields) } : {}),
      }) +
      (rating ? ', ' + rating : '') +
      (p.brief?.length ? `, brief: ${JSON.stringify(p.brief)}` : '') +
      (p.description ? `, desc: ${JSON.stringify(p.description)}` : '') +
      (variants.length ? `, variants: [${variants.map((v) => '{ ' + v + ' }').join(', ')}]` : '') +
      ' },'
  );
}

const head = cur
  .slice(0, cur.indexOf('const PRODUCTS'))
  .split('\n')
  .filter((l) => !/^\/\/ (rating\.real|variants\.stock|grp:)/.test(l))
  .join('\n');
const tailStart = cur.indexOf('const HERO_SLIDES');
const tail = cur.slice(tailStart);

const out =
  head +
  '// rating.real = ulasan pembeli; tanpa real = rating otomatis (n = jumlah penilaian)\n' +
  '// variants.stock 999999 = stok tak terbatas; patungan = ikut iuran akun bareng\n' +
  '// grp = jumlah kelompok varian ("2 jenis"), mf = field manual saat order, ar = jumlah penilaian otomatis\n' +
  '// variants.d = keterangan singkat varian\n' +
  'const PRODUCTS = [\n' +
  rows.join('\n') +
  '\n];\n\n' +
  tail;

fs.writeFileSync(new URL('../assets/data.js', import.meta.url), out);
console.log('PRODUCTS ditulis:', rows.length);
