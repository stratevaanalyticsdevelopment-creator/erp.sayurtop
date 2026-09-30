# Strateva O2C ERP — Sayur Top (Next.js + Supabase)

Versi Next.js dari aplikasi **Strateva O2C ERP** untuk Sayur Top. Tampilan
antarmuka dipertahankan sama persis dengan versi HTML single-file — berkas
`app/globals.css` disalin apa adanya dari blok `<style>` versi HTML, dan seluruh
komponen menghasilkan class yang sama.

Perbedaan mendasar ada di lapisan data: versi HTML menyimpan seluruh data di
`localStorage` peramban, sedangkan versi ini memakai **Postgres di Supabase**
dengan Row Level Security, sehingga data bersifat multi-pengguna dan aturan
hak akses ditegakkan di database, bukan di antarmuka.

---

## 1. Ringkasan teknis

| Komponen | Versi / keterangan |
| --- | --- |
| Framework | Next.js 14.2.15 (App Router) |
| UI | React 18.3.1, TypeScript 5.5.4 |
| Database | Supabase (Postgres 17) |
| Autentikasi | Supabase Auth, sesi berbasis cookie (`@supabase/ssr`) |
| Otorisasi | RLS policy + fungsi `rbac(menu, aksi)` di database |
| Halaman | 39 halaman aplikasi + halaman login |
| Dependensi eksternal | Tidak ada CDN; seluruh aset dimuat lokal |

Alur dokumen yang didukung: **Quotation → Sales Order → Approval → Picking →
Surat Jalan → Goods Receipt → Invoice → Retur/Credit Note → Collection →
Payment → Jurnal → Buku Besar → Laporan Keuangan.**

---

## 2. Menjalankan aplikasi

### 2.1 Prasyarat

- Node.js 18.18 atau lebih baru
- Project Supabase yang sudah dimigrasikan (lihat bagian 3), **atau** pakai
  project demo yang sudah siap: `cp .env.demo .env.local`

> **Tidak ada berkas aplikasi yang di-upload ke Supabase.** Supabase adalah
> databasenya; aplikasi Next.js ini dijalankan lokal atau di-deploy ke hosting
> seperti Vercel. Yang diterapkan ke Supabase hanyalah berkas SQL di
> `supabase/migrations/`, dan itu pun hanya bila Anda membuat project baru.

### 2.2 Langkah

```bash
npm install
cp .env.example .env.local     # lalu isi nilainya
npm run dev                    # pengembangan, http://localhost:3000
```

Untuk produksi:

```bash
npm run build
npm run start
```

### 2.3 Variabel lingkungan

Isi `.env.local` dari **Project Settings → API** di dashboard Supabase:

```
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=            # opsional, lihat catatan di bawah
```

`SUPABASE_SERVICE_ROLE_KEY` **hanya** dibutuhkan bila Anda ingin membuat akun
dan mengganti password langsung dari menu *System › User Management*. Kunci ini
sengaja tidak diawali `NEXT_PUBLIC_` agar tidak pernah terkirim ke peramban;
kunci hanya dipakai di route handler `app/api/admin/user/route.ts`, yang
memverifikasi sesi pemanggil dan memeriksa hak akses lewat fungsi `rbac()` di
database sebelum memakai Auth Admin API.

Bila dikosongkan, seluruh aplikasi tetap berjalan penuh — pembuatan akun
dilakukan dari dashboard Supabase (*Authentication → Users*), dan baris pada
tabel `app_user` terbentuk otomatis oleh trigger `handle_new_auth_user`.

> **Catatan connection string.** Supabase menyediakan dua alamat koneksi
> Postgres: *direct connection* (port 5432, IPv6) dan *connection pooler*
> (port 6543, IPv4). Aplikasi ini tidak memakai keduanya — seluruh akses
> berjalan lewat PostgREST/Auth pada `NEXT_PUBLIC_SUPABASE_URL`. Kedua
> connection string hanya diperlukan bila Anda menjalankan migrasi atau
> `psql` dari luar dashboard.

### 2.4 Deploy ke Vercel

1. **Isi Environment Variables lebih dulu**, di Project Settings → Environment
   Variables, untuk environment *Production* dan *Preview*:

   | Nama | Nilai |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://PROJECT_REF.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key dari dashboard Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | opsional, lihat 2.3 |

2. Baru jalankan Deploy (atau **Redeploy** bila sudah terlanjur di-deploy).

Variabel berawalan `NEXT_PUBLIC_` **ditanam ke dalam bundle saat build**, bukan
dibaca saat aplikasi berjalan. Menambahkannya setelah build tidak berpengaruh
sampai ada build ulang — karena itu urutannya penting, dan mengubah nilainya
selalu perlu Redeploy.

Tidak ada pengaturan lain yang perlu diubah: Framework Preset terdeteksi
otomatis sebagai Next.js, build command `next build`, tanpa `vercel.json`.

---

## 3. Skema dan data di Supabase

Seluruh migrasi tersedia sebagai berkas SQL di **`supabase/migrations/`** —
lihat `supabase/README.md` untuk cara menerapkannya ke project Supabase baru
dan cara membuat akun login pertama.

Project referensi yang sudah siap pakai: `yartnygvfuxazlqhlcrc`. Migrasi yang
sudah diterapkan di sana:

| Migrasi | Isi |
| --- | --- |
| `0001_schema` | Seluruh tabel dan view (`invoice_view`, `order_outstanding_view`, dll.) |
| `0002_rbac_rls_numbering` | Fungsi `rbac()`, policy RLS tiap tabel, penomoran `next_doc_no()` |
| `0003_rpc_core` | `create_sales_order`, `approve_sales_order`, `create_delivery`, `confirm_delivery` |
| `0004_rpc_invoice_return_payment` | `create_invoice_from_delivery`, `process_return`, `record_payment`, `post_journal` |
| `0005_seed_master` | Master data: customer, sales, gudang, driver, termin, pajak, bank, CoA, role |
| `0006_seed_products` | 238 SKU produk Sayur Top |
| `add_quotation_tables` | Tabel `quotation` + `quotation_line` beserta policy-nya |
| `add_update_sales_order` | RPC `update_sales_order` untuk edit order berstatus DRAFT/SUBMITTED |
| `add_doc_counter_read_policy` | Izin baca `doc_counter` untuk halaman Document Numbering |

### 3.1 Prinsip perancangan

**Logika transaksi berada di database, bukan di klien.** Pembuatan Sales Order,
Surat Jalan, Invoice, Retur, dan Payment seluruhnya lewat fungsi RPC
`SECURITY DEFINER`. Konsekuensinya:

- Penomoran dokumen aman dari race condition (penguncian baris di `doc_counter`).
- Over-delivery ditolak database, bukan sekadar disembunyikan tombolnya.
- Jurnal double-entry diposting dalam transaksi yang sama dengan dokumennya,
  sehingga neraca tidak bisa timpang karena kegagalan di tengah jalan.
- Jejak audit ditulis fungsi `write_audit()`, tetap terekam walau perubahan
  dilakukan dari luar aplikasi ini.

**Hak akses ditegakkan RLS.** Setiap policy memanggil `rbac(menu, aksi)` yang
membaca role pengguna dari `app_user` (dipetakan ke `auth.uid()`). Menyembunyikan
tombol di antarmuka hanyalah kenyamanan; permintaan langsung ke API tetap
ditolak database bila hak akses tidak memadai.

---

## 4. Akun demo

Password disamakan dengan versi HTML. Login menerima **username** maupun
alamat email.

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | Administrator |
| `budi` | `sales123` | Sales |
| `rina` | `sales123` | Sales |
| `hartono` | `mgr123` | Sales Manager |
| `sukir` | `wh123` | Warehouse |
| `lina` | `fin123` | Finance |
| `tagihan` | `col123` | Collector |
| `kasir` | `cas123` | Cashier |

Password di atas lemah dan hanya untuk demonstrasi. **Ganti seluruhnya sebelum
dipakai dengan data sebenarnya.**

---

## 5. Struktur berkas

```
app/
  login/page.tsx              Halaman masuk
  (app)/layout.tsx            Kerangka aplikasi (sidebar, topbar, pencarian)
  (app)/page.tsx              Dashboard
  (app)/sales/                Quotation, Sales Order, Approval, Sales Return
  (app)/logistics/            Picking, Surat Jalan, Delivery Tracking, Goods Receipt
  (app)/ar/                   Invoice, Credit Note, Outstanding, Aging, Collection,
                              Payment, Customer Statement
  (app)/accounting/           General Journal, General Ledger, Chart of Accounts
  (app)/report/               P&L, Neraca, Cash Flow, Trial Balance,
                              Sales Report, AR Aging Report, Delivery Report
  (app)/master/               Customer, Product, Warehouse, Sales, Driver, Tax,
                              Payment Term, Bank
  (app)/system/               User, Role, Numbering, Audit Log, Settings
  api/admin/user/route.ts     Pembuatan akun & reset password (service role)
  globals.css                 Salinan verbatim style versi HTML

components/
  shell.tsx                   Sidebar, topbar, pencarian global, notifikasi
  ui.tsx                      Card, DataTable, Modal, Badge, KPI, Timeline, dll.
  charts.tsx                  BarChart & LineChart (SVG inline)
  line-editor.tsx             Editor baris dokumen (auto-isi harga/satuan, cek margin)
  sj-form.tsx, pay-form.tsx   Form Surat Jalan dan Pembayaran
  print-docs.tsx              Tampilan cetak SO, Surat Jalan, Invoice, Statement
  crud.tsx                    Kerangka CRUD master data sederhana

supabase/
  migrations/                 9 berkas SQL: skema, RLS, RPC, dan data master
  README.md                   Cara menerapkan migrasi ke project Supabase baru

lib/
  supabase/client.ts          Klien Supabase untuk komponen klien
  supabase/server.ts          Klien Supabase untuk server component / route handler
  store.tsx                   Profil pengguna + master data, hak akses, toast
  calc.ts                     Perhitungan dokumen, status invoice, aging, margin
  gl.ts                       Trial balance, P&L, Neraca, Cash Flow
  use-gl.ts                   Hook pengambil baris buku besar
  format.ts                   Rupiah, angka, tanggal (zona waktu lokal), terbilang
  menu.ts                     Struktur menu, konstanta status, kategori, satuan
  types.ts                    Tipe baris database

middleware.ts                 Penyegaran sesi + penjaga rute
```

---

## 6. Catatan implementasi

**Tanggal ditangani dalam zona waktu lokal.** Seluruh konversi tanggal memakai
komponen tanggal lokal (`getFullYear`, `getMonth`, `getDate`), bukan
`toISOString()`. Di WIB (UTC+7), `toISOString()` menggeser tanggal mundur satu
hari untuk waktu sebelum pukul 07.00, sehingga termin NET 30 akan terhitung 29
hari dan label bulan meleset satu bulan.

**Akun kontra pada neraca.** Arah saldo pada neraca ditentukan oleh *kelompok*
akun, bukan saldo normal masing-masing akun. Tanpa ini, Akumulasi Penyusutan
(saldo normal kredit, tetapi berkelompok ASSET) akan menambah total aset alih-alih
menguranginya.

**Logo tersedia dalam dua varian.** `logo-*-accent.png` dipakai pada halaman
login dan brand sidebar: ikon keranjang dan tagline berwarna putih, hanya
wordmark "SAYUR TOP" yang berwarna aksen #FF5E00. `logo-*.png` (putih penuh)
tetap dipakai pada kepala dokumen cetak, karena di sana logo berada di dalam
kotak berlatar biru `--brand` sehingga warna aksen akan sulit terbaca saat
dicetak.

**Middleware sengaja dibuat sesederhana mungkin.** Middleware berjalan di Edge
runtime dan mengawal setiap permintaan, sehingga satu galat di sana membuat
seluruh rute mengembalikan 500 (`MIDDLEWARE_INVOCATION_FAILED` di Vercel) —
termasuk halaman login, sehingga aplikasi tidak bisa dipulihkan dari dalam.
Karena itu `middleware.ts` tidak mengimpor pustaka Supabase, tidak melakukan
panggilan jaringan, dan seluruh isinya dibungkus `try/catch`: ia hanya membaca
ada tidaknya cookie sesi lalu mengalihkan halaman. Penyegaran sesi ditangani
klien Supabase di peramban, dan keabsahan sesi diperiksa saat aplikasi memuat
profil pengguna.

Ini bukan pelonggaran keamanan: otorisasi sejak awal ditegakkan Row Level
Security di database, bukan oleh middleware.

**Kontrol margin.** Saat harga jual setelah diskon lebih rendah dari *base price*,
baris ditandai di editor dan peringatan muncul sebelum order disimpan. Daftar
baris yang di bawah harga pokok juga disimpan di kolom `sales_order.below_cost`
sehingga dapat ditinjau kembali pada tahap approval.

---

## 7. Yang belum terverifikasi

Beberapa hal perlu Anda periksa sendiri saat aplikasi dijalankan pertama kali,
karena tidak dapat diuji dari lingkungan tempat aplikasi ini dibangun:

1. **Verifikasi langsung terhadap Supabase produksi.** Lingkungan build tidak
   memiliki akses jaringan ke `*.supabase.co`. Seluruh halaman diverifikasi
   terhadap emulator PostgREST/Auth lokal (`tools/`) yang membaca snapshot data
   dari project yang sama; pustaka `@supabase/supabase-js` dipakai apa adanya dan
   hanya URL-nya yang dialihkan. Skema, RPC, policy, dan data seed diterapkan dan
   diperiksa langsung di Supabase lewat SQL. Yang belum pernah dijalankan
   end-to-end adalah gabungan keduanya: peramban → Supabase produksi.
2. **Route handler `api/admin/user`** belum diuji dengan service role key
   sungguhan, karena kunci tersebut tidak diisi di lingkungan build.
3. **Isi teks hak cipta** pada halaman login tertulis `© 2026 Strateva E2C ERP`
   sesuai permintaan. Bila yang dimaksud adalah **O2C** (Order-to-Cash), teksnya
   perlu diperbaiki di `app/login/page.tsx` dan `components/shell.tsx`.

Isi direktori `tools/` **bukan bagian aplikasi** — berkas tersebut hanya dipakai
untuk pengujian lokal dan dapat dihapus tanpa memengaruhi aplikasi.

---

## 8. Selisih angka yang diketahui pada Sales Report

Pada halaman *Sales Report*, KPI **Margin Kotor** dihitung sebagai
`total invoice.sub − HPP`, sementara kolom **Margin** pada tabel dihitung per
baris setelah mengurangi kuantitas retur. Akibatnya KPI lebih tinggi daripada
total kolom tabel sebesar nilai penjualan barang yang diretur.

Perilaku ini sengaja dipertahankan agar sama persis dengan versi HTML. Bila
diinginkan konsisten, ganti perhitungan KPI menjadi `tVal − tCogs` (keduanya
sudah tersedia di `app/(app)/report/sales/page.tsx`) — dan lakukan perubahan
yang setara pada versi HTML agar kedua aplikasi tetap menampilkan angka sama.
