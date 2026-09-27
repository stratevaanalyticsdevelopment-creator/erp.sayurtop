# Daftar Produk per Supplier dan Riwayat Harga (migrasi 0011–0014)

## Mengapa harga disimpan sebagai riwayat

Harga sayur, cabe, dan bawang berubah hampir tiap hari. Kalau harga supplier
disimpan sebagai satu kolom yang ditimpa setiap kali berubah, Purchase Order
lama tidak bisa lagi dijelaskan — tidak ada cara membuktikan harga Rp 51.000
di PO bulan lalu memang harga yang berlaku saat itu.

Karena itu harga disimpan **per tanggal**: satu baris untuk setiap kombinasi
supplier + produk + tanggal. "Harga berlaku" pada suatu tanggal adalah harga
terakhir yang tanggalnya tidak melewati tanggal tersebut.

## Dua jenis harga yang sengaja dipisah

| Tabel | Isi | Dipakai untuk |
|---|---|---|
| `purchase_price_daily` (view, migrasi 0007) | harga **aktual** hasil penerimaan barang, sudah termasuk landed cost | menghitung **HPP** pada faktur penjualan |
| `supplier_price` (migrasi 0011) | harga **penawaran** supplier per tanggal | mengisi harga baris **Purchase Order** sebelum barang datang |

Keduanya tidak boleh dicampur. `supplier_price` sama sekali tidak dipakai
dalam perhitungan HPP, jadi mengisi atau memperbaiki daftar harga tidak
mengubah angka laporan keuangan mana pun.

## Isi tiap migrasi

**0011 — `supplier_price_list`** (skema, wajib)
- `supplier_product` — katalog produk per supplier (banyak-ke-banyak), dengan
  penanda `is_preferred` untuk supplier utama, `lead_time_days`, `min_order_qty`
- `supplier_price` — riwayat harga per tanggal, `source` = MANUAL / GRN / IMPORT
- `supplier_price_current` — view harga terakhir per supplier + produk
- `supplier_product_view` — view untuk tampilan: harga berlaku, harga
  sebelumnya, dan persentase perubahan
- `supplier_price_at(supplier, produk, tanggal)` — harga berlaku pada tanggal
- `last_po_price(supplier, produk, sebelum)` — harga PO terakhir, untuk
  peringatan perubahan harga
- RPC: `set_supplier_price`, `set_preferred_supplier`, `add_supplier_products`,
  `remove_supplier_product` — semuanya mengecek `rbac('m.supplier', …)` dan
  menulis jejak audit
- RLS aktif pada kedua tabel; menu `buy.supplierprice` ditambahkan ke role
  WHOUSE, FINANCE, MGMT, PURCH
- Katalog awal dibangun dari `product.default_supplier_code` dan dari baris
  penerimaan barang yang sudah ada

**0012 — `seed_supplier_price_demo`** (DATA CONTOH, boleh dilewati)
Supplier alternatif per kategori dan riwayat harga mingguan 8 minggu ditambah
harian 5 hari terakhir, dengan volatilitas per kategori (cabe 22%, sayur 13%,
dry goods 3%) dan selisih harga antar tipe supplier (petani termurah, pasar
induk termahal). **Untuk produksi, lewati migrasi ini** dan isi katalog serta
harga dari daftar harga supplier yang sebenarnya.

**0013 — `po_price_from_supplier_list`** (perilaku, wajib)
Harga baris Purchase Order tidak lagi diambil dari `product.base_price`
melainkan berurutan: daftar harga supplier pada tanggal PO → harga aktual
penerimaan terakhir → harga pokok master. Tiga kolom baru pada
`purchase_order_line` merekam asal harga (`price_source`) dan harga PO
sebelumnya (`prev_price`, `prev_po_no`), yang dipakai untuk peringatan
perubahan harga pada detail PO. Supplier tujuan PO otomatis kini mengikuti
penanda supplier utama di katalog, bukan hanya `product.default_supplier_code`.

**0014 — `fix_po_grn_dates`** (perbaikan data demo)
Memperbaiki bug pada data contoh: seluruh PO dan penerimaan barang tercatat
pada satu tanggal yang sama, padahal Sales Order-nya tersebar beberapa bulan.
PO disesuaikan ke tanggal Sales Order sumbernya, GRN sehari setelahnya, dan
jurnal GRN ikut dipindahkan. Aman terhadap laporan keuangan karena jurnal GRN
hanya menyentuh akun neraca (Persediaan, Kas & Bank, Utang Supplier) — tidak
ada akun laba-rugi, sehingga laba-rugi periode mana pun tidak berubah.
Migrasi ini tidak diperlukan pada instalasi baru yang tidak memakai data demo.

**0015 — `supplier_product_qty`** (kuantitas, wajib)
Melengkapi sisi kuantitas dari daftar produk supplier.
- `supplier_product.capacity_per_day` — kemampuan pasok per hari (kolom baru)
- `min_order_qty` (kolom dari 0011) kini ditampilkan dan bisa diedit
- RPC `set_supplier_product_terms(supplier, produk, min, kapasitas, lead, catatan)` —
  hanya mengubah parameter yang diisi, sisanya dibiarkan apa adanya
- `supplier_product_view` diperluas: `category`, `stock`, `capacity_per_day`,
  `qty_ordered`, `qty_received`, `purchase_value`, `po_count`, `last_po_date`,
  `last_grn_date`
- `supplier_summary_view` — ringkasan per supplier untuk daftar Master Supplier:
  jenis produk yang dipasok, jumlah produk, qty dipesan/diterima, nilai pembelian

Empat angka realisasi (`qty_ordered`, `qty_received`, `purchase_value`,
`po_count`) **dihitung dari dokumen PO dan penerimaan barang**, bukan diinput.
Dengan begitu angkanya tidak bisa berbeda dengan dokumen yang sebenarnya, dan
`sum(purchase_value)` seluruh supplier sama dengan mutasi debit akun
Persediaan Barang Dagang dari penerimaan barang.

Bagian terakhir migrasi ini mengisi `capacity_per_day` dan `min_order_qty`
untuk data contoh. Untuk produksi, bagian itu boleh dihapus dan diisi dari
kesepakatan dengan supplier.

## Urutan pemakaian

Produksi: `0001` … `0011`, lalu `0013`, lalu `0015` (tanpa blok data demo di
bagian akhirnya). Lewati `0012` dan `0014`.

Demo lengkap: jalankan `0001` … `0015` berurutan.

## Verifikasi

Kelima file di atas identik dengan yang benar-benar dijalankan pada proyek
Supabase, dicek dengan md5 terhadap `supabase_migrations.schema_migrations`:

```
b0c3ed3ef93492968f4ccb6198576bb1  20260926163800_0011_supplier_price_list.sql
4308f86b1946c985da8fa3bbc03ebd02  20260926163942_0012_seed_supplier_price_demo.sql
0604bf82408ebb8415f383b573f034ec  20260926164448_0013_po_price_from_supplier_list.sql
23a9c81f11e6c22c366fa2585dd4e13d  20260926164652_0014_fix_po_grn_dates.sql
2fff758a1735814738e57477c004be5b  20260926232126_0015_supplier_product_qty.sql
```

Cara mengecek ulang (newline terakhir file dibuang agar setara dengan isi
yang tersimpan di database):

```bash
printf '%s' "$(cat 20260926163800_0011_supplier_price_list.sql)" | md5sum
```
