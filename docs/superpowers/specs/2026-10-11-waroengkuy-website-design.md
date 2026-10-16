# Spesifikasi: Klon Waroengkuy + Backend & Akun Owner

Lokasi: `C:\experiment bro\waroengkuy2` · Sumber acuan: `waroengkuy.com` (survei langsung, dump di `docs/raw_catalog.json`)

## 1. Ringkasan
Klon tampilan waroengkuy.com (persis, termasuk aturan radius 12px global dan geometri dialog) **plus** sistem fungsionalnya: katalog hidup, keranjang, checkout QRIS simulasi berlabel DEMO, cek pesanan, dan akun owner untuk mengelola produk.

## 2. Arsitektur
```
browser ── GET /api/catalog ──► server.mjs (Node, tanpa dependency)
  index.html ─┬─ storefront  (assets/app.js,  ES module)
              └─ panel owner (assets/admin.js, ES module) — satu halaman yang sama
                                data/db.json  ← seed awal dari assets/data.js
```
- `assets/data.js` bukan lagi sumber runtime; hanya seed yang dibaca server saat `data/db.json` belum ada (via `vm.runInNewContext`).
- Panel owner menempel di `index.html` (`<section id="admin">`), dibuka dari tombol "Masuk" di header. `body.admin-on` menyembunyikan elemen `.store-only` (navbar toko, main, ticker, footer) sehingga panel memakai header/footer yang sama. Sinkron live: `app.js` mengekspos `window.wk.refresh()` → `admin.js` memanggilnya setiap kali PATCH/POST/DELETE berhasil, jadi harga/produk berubah di beranda tanpa muat ulang (dialog produk yang sedang terbuka ikut di-re-point).
- Router memakai History API dengan prefix cadangan (`/beli/...`, `/admin`) — server jatuh ke `index.html` untuk path tanpa ekstensi. `/admin` hanya deep link: `index.html` yang tampil, panel otomatis terbuka kalau ada sesi.
- Static hanya mengizinkan `index.html` dan `assets/**`. `server.mjs`, `data/`, `docs/` tertutup (404).

## 3. Menjalankan
```
node server.mjs            # http://127.0.0.1:8080  (panel owner: tombol "Masuk" / deep link /admin)
node server.mjs --port N --host 0.0.0.0
node docs/test-api.mjs     # 49 assertion API + static
node docs/build-data.mjs   # regenerasi seed dari raw_catalog.json
```

## 4. Akun owner
- **Setup sekali:** selama tabel `owners` kosong, tombol "Masuk" (atau deep link `/admin`) menampilkan form "Buat akun owner"; setelah itu endpoint `/api/setup` menolak 403 dan yang muncul adalah form login.
- Password di-hash `scrypt` (salt acak 16 byte), verifikasi pakai `timingSafeEqual`. Sesi = token `randomBytes(32)` dikirim sebagai `Authorization: Bearer`; yang disimpan hanya SHA-256 token, kedaluwarsa 12 jam. Tanpa cookie → tanpa CSRF.
- 5x login gagal per email → kunci 60 detik.
- Ganti password dari panel → semua sesi lama hangus.
- Token disimpan di `localStorage` (`wk:owner:token`) — laptop/HP pribadi; bukan untuk multi-user.

## 5. API
| Method | Path | Akses |
|---|---|---|
| GET | `/api/catalog` | publik (produk `hidden` disaring); dengan token owner menampilkan semua + `editable:true` |
| GET | `/api/session` | publik → `{owner, needsSetup}` |
| POST | `/api/setup` \| `/api/login` \| `/api/logout` \| `/api/password` | setup sekali; logout/password butuh token |
| POST | `/api/products` | owner |
| PATCH | `/api/products/:slug` | owner — scalar (`name,cat,hidden,brief,desc,mf,sold`) atau satu paket via `{vi, price/strike/stock/label/ful/d}` atau ganti seluruh `variants[]` |
| DELETE | `/api/products/:slug` | owner, permanen |

Validasi di server: slug `[a-z0-9-]`, harga ≥ 1, stok ≥ 0, kategori harus ada, body JSON ≤ 64 KB.

**Sembunyikan vs hapus:** hidden = masih di DB, hilang dari beranda/pencarian publik, URL lama tetap ada; delete = hilang permanen.

## 6. Panel owner (Fase 3 — selesai, verifikasi browser)
Satu halaman dengan toko: dibuka dari tombol "Masuk" di header (label berubah jadi "Panel" selama sesi owner aktif), ditutup dengan "Lihat toko" (`#aExit`) atau "Keluar" (`#aLogout`).
Satu produk = satu baris ringkas (thumbnail/inisial, nama, badge Sembunyi & Habis, "kategori · N paket · stok · N terjual", harga terendah dalam `Rp`, dan tiga tombol ikon: sembunyikan, Detail, hapus). Baris bisa dibuka-tutup; isinya tabel per paket (nama + hapus paket, harga, coret, stok dengan kotak "tak terbatas" = 999999 tampil `∞`, kirim Auto/Manual) yang menyimpan on-change. Header panel: tiga chip statistik yang sekaligus jadi penyaring (produk / tersembunyi / stok habis), pencarian, kategori, "Buka semua"/"Tutup semua", Produk baru, dan ikon Ganti password. Hapus memakai strip merah "Ya, hapus" + "Batal". Simpan field tidak menggambar ulang daftar (hanya baris ringkas yang disinkronkan) sehingga fokus ketik tidak hilang; baris yang tersimpan berkedip hijau. Produk tanpa gambar memakai inisial nama.

Grid desktop paket: `minmax(0,1fr) 104px 92px 116px 104px`; di bawah `sm` menuju 2 kolom dengan keterangan kecil (PAKET/HARGA/CORET/STOK/KIRIM) di atas tiap input.

## 7. Cara pakai (user-facing)
1. `node server.mjs` → buka `http://127.0.0.1:8080`.
2. Klik **Masuk** di kanan atas → karena belum ada akun, muncul form **Buat akun owner**; isi email + password (minimal 8 karakter) → **Buat akun**.
3. Panel terbuka dan toko otomatis ditutup. Semua produk tampil tertutup rapi — klik barisnya (atau "Buka semua") untuk melihat paketnya. Edit harga/stok/nama paket → tersimpan begitu field keluar fokus, baris berkedip hijau, dan beranda langsung ikut berubah (toast "Harga tersimpan.").
4. Centang kotak di samping stok = stok tak terbatas (`∞`, pembeli bisa order berulang). Chip "tersembunyi" / "stok habis" di header menyaring daftar; angka pada chip ikut berubah saat menyimpan. **Ikon mata** melepas/mengembalikan produk dari beranda.
5. **Ikon pensil** = Detail (nama/kategori/poin/field manual/deskripsi); **Produk baru** membuat slug otomatis dari nama; **ikon tempat sampah** memunculkan strip merah lalu **Ya, hapus** untuk menghapus permanen (atau **Batal**).
6. Gambar produk dibaca dari `assets/products/<slug>.webp`; produk baru tanpa berkas gambar menampilkan kotak inisial. Letakkan file `.webp` dengan nama slug-nya untuk mengganti.
7. **Lihat toko** kembali ke beranda; **Keluar** menutup sesi (label header kembali "Masuk"). Deep link `http://127.0.0.1:8080/admin` membuka panel langsung bila sesi masih hidup.

## 8. Status
- Selesai: klon visual 1:1, backend + API + auth, panel owner menyatu di `index.html` (halaman `/admin` berdiri sendiri dihapus), storefront membaca API + sinkron live, checkout WhatsApp ke format live.
- Belum (fase berikutnya): keranjang (`wk:cart:pusat`), pembuatan pesanan (`WEBWRG`+12 digit, nominal + kode unik 100–999, kedaluwarsa 30 menit), halaman bayar `/beli/<token>` dengan QR berlabel DEMO, `/beli/pesanan`, halaman produk & kategori, lalu cangkang `/sosmed`, `/blog`, `/reseller`.
- Catatan: `/privasi` dan `/ketentuan` aslinya 404 — ikut dibuat 404.
