# Panduan Menjalankan Bot Monitor 5 Detik 24/7 di Hugging Face (100% Gratis)

Dengan cara ini, bot **@PojokSecurity_bot** akan memperbarui pesan Telegram Anda setiap **5 detik** secara terus-menerus di cloud Hugging Face, **tanpa laptop Anda harus menyala**, dan **100% gratis selamanya tanpa kartu kredit**.

---

### Langkah 1: Buat Space Baru di Hugging Face

1. Buka situs **[huggingface.co](https://huggingface.co)** (daftar/login akun gratis).
2. Di pojok kanan atas, klik foto profil Anda -> pilih **New Space** (atau buka [huggingface.co/new-space](https://huggingface.co/new-space)).
3. Isi formulir pembuatan Space:
   * **Space name**: `pojokai-watchdog` (atau nama lain bebas)
   * **License**: `mit` (atau `apache-2.0`)
   * **Select the Space SDK**: Pilih **Docker** -> lalu pilih **Blank**
   * **Space hardware**: Pilih **CPU basic (Free • 2 vCPU • 16 GB)**
   * **Visibility**: Pilih **Private** (sangat disarankan agar bot Anda aman)
4. Klik tombol **Create Space**.

---

### Langkah 2: Upload File Worker ke Space

Setelah Space dibuat, Anda akan melihat halaman repository Space Anda:

1. Klik tab **Files** di bagian atas repository Space Anda.
2. Klik tombol **Add file** -> pilih **Upload files**.
3. Tarik (drag & drop) atau pilih **4 file** yang ada di folder `hf-security-worker/` ini:
   * 📄 `Dockerfile`
   * 📄 `README.md`
   * 📄 `package.json`
   * 📄 `worker.mjs`
4. Di bagian bawah, klik tombol **Commit changes to main**.

---

### Langkah 3: Selesai! Bot Langsung Aktif 24/7

* Hugging Face akan otomatis mem-build container Docker Anda dalam waktu sekitar 30 detik.
* Setelah status berubah menjadi **🟢 Running**:
  * Server Hugging Face langsung menjalankan pemantauan real-time **setiap 5 detik**.
  * Pesan di chat Telegram **@PojokSecurity_bot** Anda akan langsung berkedip dan ter-update live setiap 5 detik dengan animasi GIF profil merah di atasnya.
* **Laptop Anda sekarang bebas dimatikan kapan saja**, bot akan tetap berjalan non-stop 24 jam sehari!
