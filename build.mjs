// build.mjs - Generate static API data for static hosts like Netlify
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const API_DIR = path.join(ROOT, 'api');
const isStaticTarget = process.argv.includes('--static') || process.argv.includes('--directadmin');

if (isStaticTarget) {
  if (!fs.existsSync(API_DIR)) {
    fs.mkdirSync(API_DIR, { recursive: true });
  }

  let db = { products: [], categories: [], hero: [], faqs: [], ticker: [] };
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }

  const catalog = {
    wa: db.wa || '6281234567890',
    categories: db.categories || [],
    hero: db.hero || [],
    faqs: db.faqs || [],
    ticker: db.ticker || [],
    products: (db.products || []).filter((p) => !p.hidden),
    bundle: db.bundle || null,
    editable: false,
    owner: null,
  };

  fs.writeFileSync(path.join(API_DIR, 'catalog.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(API_DIR, 'bundle.json'), JSON.stringify({ bundle: db.bundle || null }, null, 2));
  fs.writeFileSync(path.join(API_DIR, 'session.json'), JSON.stringify({ owner: null, needsSetup: (db.owners || []).length === 0 }, null, 2));

  console.log('[build:static] Static API files generated for DirectAdmin.');
} else {
  // On Vercel, remove static files in api/ so api/index.js handles dynamic requests!
  const toClean = ['catalog.json', 'session.json', 'bundle.json'];
  for (const f of toClean) {
    const target = path.join(API_DIR, f);
    if (fs.existsSync(target)) {
      try { fs.unlinkSync(target); } catch {}
    }
  }
  console.log('[build] Vercel serverless build ready. Dynamic API routing active.');
}
