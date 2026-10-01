# Migrasi database Supabase

Sembilan berkas di `migrations/` membangun seluruh database dari nol: tabel,
view, fungsi RPC, policy Row Level Security, dan data master (termasuk 238 SKU
produk). Jalankan **berurutan sesuai nama berkas**.

| Urutan | Berkas | Isi |
| --- | --- | --- |
| 1 | `..._0001_schema.sql` | Seluruh tabel dan indeks |
| 2 | `..._0002_rbac_rls_numbering.sql` | Fungsi `rbac()`, `my_profile()`, `next_doc_no()`, `write_audit()`, trigger user baru, policy RLS |
| 3 | `..._0003_rpc_core.sql` | View `invoice_view` & `order_outstanding_view`; RPC jurnal, Sales Order, Surat Jalan |
| 4 | `..._0004_rpc_invoice_return_payment.sql` | RPC Invoice, edit Invoice, Retur → Credit Note, Payment |
| 5 | `..._0005_seed_master.sql` | CoA, termin, pajak, bank, gudang, sales, driver, 12 customer, 9 role, settings |
| 6 | `..._0006_seed_products.sql` | 238 SKU produk |
| 7 | `..._add_quotation_tables.sql` | Tabel `quotation` + `quotation_line` |
| 8 | `..._add_update_sales_order.sql` | RPC `update_sales_order` |
| 9 | `..._add_doc_counter_read_policy.sql` | Izin baca `doc_counter` |
| 10 | `..._0007_purchasing_schema.sql` | Modul pembelian: supplier, PO, penerimaan barang, landed cost |
| 11 | `..._0008_po_from_so_and_hpp_match.sql` | PO otomatis dari SO + Auto-Match HPP |
| 12 | `..._0009_receive_goods_landed_cost.sql` | Penerimaan barang dan pembebanan landed cost |
| 13 | `..._0010_seed_supplier_and_roles.sql` | 8 supplier contoh dan hak akses modul pembelian |

Migrasi 10–13 dijelaskan lebih rinci di `migrations/README-tahap1.md`.

## Cara menerapkan

**Opsi A — SQL Editor (paling sederhana).** Buka dashboard Supabase →
**SQL Editor** → tempel isi tiap berkas satu per satu sesuai urutan di atas,
lalu **Run**. Tunggu sampai satu berkas selesai sebelum lanjut ke berikutnya.

**Opsi B — Supabase CLI.**

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push
```

## Setelah migrasi: membuat akun pertama

Migrasi membuat role, tetapi **tidak** membuat akun login. Buat akun pertama
dari dashboard: **Authentication → Users → Add user**, isi email dan password,
centang *Auto Confirm User*. Trigger `handle_new_auth_user` akan membuat baris
`app_user` otomatis dengan role default `SALES`.

Untuk menjadikannya Administrator, jalankan di SQL Editor:

```sql
update app_user set role_code = 'ADMIN' where email = 'email-anda@contoh.com';
```

Setelah itu akun-akun berikutnya dapat dibuat dari dalam aplikasi lewat menu
**System › User Management** (memerlukan `SUPABASE_SERVICE_ROLE_KEY`, lihat
README utama).

## Data transaksi

Migrasi ini **tidak** memuat data transaksi demo (sales order, surat jalan,
invoice, pembayaran, jurnal). Pada project referensi
`yartnygvfuxazlqhlcrc`, data demo dibuat dengan memanggil RPC produksi
(`create_sales_order`, `create_delivery`, `create_invoice_from_delivery`,
`record_payment`, dan seterusnya) — bukan lewat INSERT langsung — sehingga
RLS, penomoran dokumen, jurnal double-entry, dan audit trail benar-benar
teruji. Project baru akan dimulai dengan database kosong yang siap dipakai.

## Catatan akurasi

Delapan dari sembilan berkas identik byte-per-byte dengan migrasi yang
terpasang di project referensi (diverifikasi dengan checksum MD5 terhadap
`supabase_migrations.schema_migrations`).

Berkas `0006_seed_products.sql` ditulis ulang dalam bentuk `INSERT` dengan
nilai eksplisit agar lebih mudah dibaca dan diubah, sehingga teksnya berbeda
dari migrasi asli yang menghitung harga pokok dan stok lewat ekspresi SQL.
Hasil datanya sudah diverifikasi identik: 238 baris dengan checksum MD5 yang
sama persis dengan isi tabel `product` di project referensi.
