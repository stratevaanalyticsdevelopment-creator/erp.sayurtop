# tools/ — HANYA UNTUK PENGUJIAN LOKAL

Direktori ini **bukan bagian dari aplikasi** dan boleh dihapus seluruhnya
tanpa memengaruhi Strateva O2C ERP.

| Berkas | Kegunaan |
| --- | --- |
| `mock-supabase.js` | Emulator ringkas PostgREST + Auth Supabase di atas snapshot JSON |
| `mock-data.json` | Snapshot data dari project Supabase, dipakai emulator |
| `make-mock-data.js` | Pembuat snapshot tersebut |

Dipakai untuk memverifikasi seluruh halaman secara visual dari lingkungan
tanpa akses jaringan ke `*.supabase.co`. Aplikasi tetap memakai
`@supabase/supabase-js` apa adanya — hanya `NEXT_PUBLIC_SUPABASE_URL` yang
diarahkan ke emulator (lihat `.env.test`).

```bash
node tools/mock-supabase.js 54321      # jalankan emulator
cp .env.test .env.local && npm run dev # arahkan aplikasi ke emulator
```

Emulator tidak menyimulasikan fungsi RPC transaksional, sehingga pengujian
alur tulis (buat order, terbitkan invoice, catat pembayaran) harus dilakukan
terhadap Supabase sungguhan.
