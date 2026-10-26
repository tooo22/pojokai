# Panduan Bot Watchdog & Bug Monitor (Real-Time 5 Menit)

Bot ini bertugas sebagai **pengawas independen (watchdog)** yang memantau performa, bug, dan downtime pada **Website PojokAI** serta **Bot Telegram User (@pojokkai_bot)** secara otomatis setiap 5 menit.

---

## 1. Komponen yang Dipantau Setiap 5 Menit

1. **Web Frontend (`https://pojokai.my.id`)**:
   - Status HTTP (200 OK)
   - Kecepatan respons / latensi (ms)
   - Verifikasi konten halaman toko tampil normal

2. **Katalog API (`/api/catalog`)**:
   - Status HTTP & integritas respon JSON
   - Jumlah produk dan kategori aktif
   - Deteksi katalog kosong / gagal muat

3. **Database Lokal (`data/db.json`)**:
   - Validasi struktur JSON (anti korup)
   - Deteksi pesanan yang macet / "stuck" di status *Menunggu Pembayaran* lebih dari 30 menit

4. **Bot Telegram User (`@pojokkai_bot`)**:
   - Status endpoint webhook server (`/api/webhook/telegram`)
   - Pemeriksaan antrean update macet (`pending_update_count`)
   - Deteksi pesan error pengiriman webhook terakhir dari Telegram

5. **Gateway Pembayaran QRIS (Wistapay)**:
   - Konektivitas server Wistapay real-time
   - Validitas API Key utama & latensi pengecekan status

---

## 2. Cara Mengaktifkan Bot Monitor

### Langkah 1: Buat Bot Baru di Telegram
1. Buka Telegram dan cari **`@BotFather`**.
2. Kirim perintah: `/newbot`.
3. Masukkan nama bot, misalnya: `PojokAI Watchdog` atau `PojokAI Monitor Bot`.
4. Masukkan username bot (harus berakhiran `bot`), misalnya: `pojokai_watchdog_bot`.
5. Salin (**copy**) HTTP API token yang diberikan oleh BotFather (format: `123456789:ABCdefGhIJK...`).

### Langkah 2: Masukkan Token ke Konfigurasi
Buka file **`monitor-config.json`** di folder project ini:
```json
{
  "monitorBotToken": "PASTE_TOKEN_BOT_BARU_DI_SINI",
  "userBotToken": "",
  "ownerChatId": "7787855968",
  "intervalMinutes": 5,
  "webUrl": "https://pojokai.my.id",
  "wistapayApiKey": "YOUR_WISTAPAY_API_KEY_HERE"
}
```
> *Catatan:* `ownerChatId` sudah otomatis diset ke ID Telegram Anda (`7787855968`).

### Langkah 3: Buka Chat dengan Bot Monitor Anda
Buka bot baru Anda di Telegram, lalu klik tombol **START** (atau ketik `/start`) agar bot diizinkan mengirim pesan ke Anda.

---

## 3. Cara Menjalankan Bot Monitor

### Opsi A (Paling Mudah - 1 Klik di Windows):
Cukup klik ganda (double-click) file:
👉 **`start-monitor.bat`**

### Opsi B (Lewat Terminal / CMD):
```bash
npm run monitor
```
Atau:
```bash
node monitor-bot.mjs
```

### Opsi C (Dengan Argumen Langsung):
```bash
node monitor-bot.mjs --token 123456:ABC-DEF --chat 7787855968 --interval 5
```

---

## 4. Fitur & Cara Kerja

### Laporan Berkala Real-Time Setiap 5 Menit
Setiap 5 menit, bot akan mengirimkan ringkasan status seperti ini:
```
🛡️ [POJOKAI SYSTEM WATCHDOG]
⏱️ Status Berkala (Real-Time 5 Menit)
🕒 17 Okt 2026, 11:45:00 WIB
📊 Pemeriksaan ke-#12 | Uptime: 1j 0m 0d
━━━━━━━━━━━━━━━━━━━━━━━━━
KONDISI SISTEM: 🟢 SEMUA SISTEM NORMAL

🌐 Web Frontend: 🟢 120ms (Online & Responsif)
📦 Katalog API: 🟢 135ms (3 produk, 3 kategori aktif)
💾 Database: 🟢 (Valid (2 produk, 16 pesanan))
🤖 User Bot (pojokkai_bot): 🟢 (Normal (0 antrean macet))
💳 Wistapay QRIS: 🟢 410ms (Reachable (410ms))
━━━━━━━━━━━━━━━━━━━━━━━━━
✨ Bug & Error: Nihil (0 issue aktif)
✅ Web & Bot Telegram PojokAI siap melayani pembeli.
━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 Pembaruan otomatis berikutnya dalam 5 menit.
```

### Alert Darurat Instan (Jika Ada Bug/Down)
Jika sewaktu-waktu server web down, database korup, atau antrean webhook bot macet, bot **tidak akan menunggu 5 menit**, melainkan langsung mengirimkan peringatan darurat seketika:
```
🚨 [POJOKAI ALERT DARURAT]
⚠️ GANGGUAN / BUG TERDETEKSI SECARA INSTAN!
━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Komponen: WEB
❌ Detail Masalah: HTTP Error 502 / Server Offline
🕒 Waktu: 17 Okt 2026, 11:48:12 WIB
━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Sistem Watchdog mendeteksi penurunan performa atau downtime. Mohon segera dicek.
```
Dan saat komponen tersebut normal kembali, bot akan otomatis mengirimkan notifikasi **RECOVERY**.

---

## 5. Perintah Interaktif via Chat Telegram
Anda bisa chat langsung dengan bot monitor:
- **`/status`** atau **`/cek`** : Memaksa bot melakukan audit lengkap saat itu juga dan mengirimkan hasilnya.
- **`/ping`** : Cek latensi dan respons bot monitor.
- **`/report`** : Menampilkan total uptime, jumlah pengecekan, dan riwayat insiden.
- **`/help`** : Panduan perintah.
