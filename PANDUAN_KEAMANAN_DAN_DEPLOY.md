# PANDUAN DEPLOYMENT & HARDENING POJOKAI

Dokumen ini berisi panduan teknis langkah demi langkah untuk menerapkan seluruh perbaikan keamanan dan mempublikasikan website PojokAI ke hosting DirectAdmin (`pojok.my.id`) atau cloud Vercel (`pojokai.my.id`).

---

## 1. File yang Telah Dikonfigurasi di Folder Ini

1. **`.htaccess`**
   * **Security Headers**: HSTS, Anti-Clickjacking (`X-Frame-Options: SAMEORIGIN`), Anti-Sniffing (`nosniff`), Referrer-Policy, Permissions-Policy.
   * **Proteksi Data**: Memblokir total akses HTTP publik ke file sensitif (`data/db.json`, `.env`, `.mjs`, `.bat`, `.git`, dll.).
   * **URL Rewriting**: Menghubungkan routing `/admin` -> `index.html` dan `/api/*` -> file katalog JSON.
   * **HTTPS Enforce**: Mengalihkan otomatis port 80 ke HTTPS.
   * **Compression**: Gzip/Deflate aktif untuk kecepatan loading maksimal.

2. **`vercel.json`**
   * Dikonfigurasi dengan HTTP Security Headers lengkap (HSTS 2 tahun, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) dan routing API/Admin untuk Vercel.

3. **`pojokai-directadmin-ready.zip`**
   * Arsip siap upload ke DirectAdmin yang berisi: `index.html`, `.htaccess` (terkunci), folder `assets/`, `api/`, dan `data/`.

4. **`deploy-vercel.bat`**
   * Skrip 1-klik untuk otomatis build katalog dan deploy langsung ke Vercel production:
     ```cmd
     call node build.mjs
     call npx vercel --prod --yes
     ```

5. **`deploy-directadmin.bat`**
   * Skrip 1-klik untuk otomatis build ulang API katalog dan re-pack file ZIP jika Anda melakukan perubahan produk di `data/db.json` untuk hosting DirectAdmin.

---

## 2. Cara Deploy ke Vercel

Cukup jalankan file:
👉 **`deploy-vercel.bat`**
Skrip ini akan otomatis melakukan build katalog statis dan mempublikasikannya ke Vercel production.

---

## 3. Cara Pasang ke Hosting DirectAdmin (`pojok.my.id`)

1. Login ke panel **DirectAdmin** hosting Anda.
2. Buka menu **System Info & Files** -> **File Manager**.
3. Navigasi ke folder: `domains/pojok.my.id/public_html/`.
4. Jika masih ada file bawaan `index.html` default DirectAdmin, hapus file tersebut.
5. Upload file **`pojokai-directadmin-ready.zip`** ke dalam folder `public_html/`.
6. Klik kanan file ZIP tersebut -> pilih **Extract** (Ekstrak ke direktori `public_html`).
7. Selesai! Website Anda langsung aktif di `https://pojok.my.id` dengan proteksi keamanan penuh.

---

## 4. Cara Mengatasi Kebocoran IP Asli di Cloudflare (WAF Bypass)

1. Buka dashboard **Cloudflare** -> pilih domain Anda.
2. Buka menu **DNS** -> **Records**.
3. Cari record **`mail`** (`mail.pojok.my.id`):
   * Jika email Anda memakai Google Workspace (Gmail), hapus record `mail` ini dan arahkan record `MX` langsung ke server Google (`aspmx.l.google.com`).
   * Jika email memakai webmail hosting, jangan gunakan subdomain `mail` yang terbuka secara publik tanpa filter firewall.
4. Buka menu **SSL/TLS** -> **Edge Certificates**:
   * Aktifkan **Always Use HTTPS** (`ON`).
   * Aktifkan **HTTP Strict Transport Security (HSTS)** (`ON`).
   * Pastikan **Minimum TLS Version** diset ke `TLS 1.2` atau `TLS 1.3`.
