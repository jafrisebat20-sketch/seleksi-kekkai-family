# Seleksi Kekkai Family

Portal verifikasi + panel kontrol untuk komunitas Kekkai Family.

## Fitur
- Wizard 4 langkah: Kode → CN → VT → Grup
- Kode seleksi berstatus: fresh / pending / used / expired
- Kode 1x pakai. Keluar dari link sebelum selesai → kode basi (auto-sweep).
- Panel Owner: kontrol penuh sistem, seleksi, notifikasi, admin
- Panel Admin: akses terbatas (dashboard, kode, log)
- Hashtag wajib: `#kekkaifamily`
- Notifikasi banner dari owner ke portal user

## Kredensial default
- **Owner**: `RyuuSensei` / `Ryuu123`

Ganti password owner langsung di `data/owner.json` (regenerate hash) atau ekspos endpoint ganti password sendiri.

## Cara jalanin lokal
```bash
npm install
npm start
# Portal: http://localhost:3000
# Panel : http://localhost:3000/panel