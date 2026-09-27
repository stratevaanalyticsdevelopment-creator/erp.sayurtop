# Packaging (migrasi 0016–0017)

Menu **Logistics → Packaging** membantu gudang menyiapkan barang: daftar produk
yang harus disiapkan, dikelompokkan per produk supaya bisa ditimbang sekali lalu
dipecah per customer.

## Aturan hitung koli — bagian yang paling mudah salah

Koli dihitung **per customer**, bukan dari total qty seluruh customer.

Contoh nyata dari data demo, produk Kailan dengan peti isi 10 Kg:

| | Qty | Koli | Sisa |
|---|---|---|---|
| Bistro Eropa Senopati | 69 Kg | 6 peti | 9 Kg |
| Hotel Santika Bekasi | 34 Kg | 3 peti | 4 Kg |
| **Total produk** | **103 Kg** | **9 peti** | **13 Kg** |

Kalau dihitung dari total (103 ÷ 10) hasilnya 10 peti dan sisa 3 Kg — dan itu
salah, karena barang milik dua customer tidak boleh dicampur dalam satu peti.
Pada seluruh data demo bedanya 219 koli (benar) dibanding 224 koli (cara naif),
artinya cara naif membuat kebutuhan kemasan kurang dihitung.

## Isi tiap migrasi

**0016 — `product_packing`** (wajib)
- `product.pack_size` — isi satu kemasan dalam satuan produk; `0` berarti
  ditimbang lepas
- `product.pack_unit` — nama kemasan: Peti, Karton, Karung, Krat, Pack, Ikat
- `packing_line_view` — satu baris per produk + customer + Sales Order, berisi
  `qty_outstanding`, `koli_penuh`, dan `qty_sisa`
- menu `log.packaging` ditambahkan ke role WHOUSE, SALES, SLSMGR, FINANCE, MGMT
- bagian akhir migrasi mengisi `pack_size` dan `pack_unit` untuk **data contoh**
  (sayur per peti 10 Kg, cabe per karung 25 Kg, buah per karton 12 Kg, rempah
  per pack 5 Kg, telur per peti, dry goods per karton). Untuk produksi, bagian
  itu boleh dihapus dan diisi dari kemasan yang sebenarnya dipakai.

**0017 — `fix_packing_status_and_open_orders`** (perbaikan bug + data demo)

Perbaikan bug: `packing_line_view` pada 0016 memakai status `'PARTIAL'`,
padahal nilai yang dipakai aplikasi adalah `'PARTIALLY DELIVERED'`
(lihat konstanta `ST.PARTIAL`). Akibatnya order yang sudah terkirim sebagian
tidak muncul di halaman Packaging — padahal justru sisa order itulah yang
paling perlu disiapkan. **Migrasi ini wajib dijalankan bersama 0016.**

Bagian data demo: order DRAFT dan SUBMITTED disetujui dan tanggal kirim order
terbuka disebar dari hari ini sampai H+3, karena pada data contoh seluruh order
terbuka bertanggal kirim yang sudah lewat sehingga halaman Packaging tampak
kosong. Aman terhadap laporan keuangan — order berstatus APPROVED belum
menerbitkan Surat Jalan maupun faktur, jadi tidak ada jurnal yang tersentuh.

## Sumber data

Sama dengan Picking List: Sales Order berstatus APPROVED, PROCESSING, atau
PARTIALLY DELIVERED yang masih punya sisa qty, difilter berdasarkan tanggal
kirim (default hari ini sampai H+6).

Total qty pada halaman Packaging harus selalu sama dengan total sisa qty pada
Picking List. Cara mengecek:

```sql
select
  (select round(sum(qty_outstanding)) from packing_line_view) as packing,
  (select round(sum(sl.qty - coalesce(t.q,0)))
     from sales_order o
     join sales_order_line sl on sl.order_no = o.no
     left join (select dl.product_id, d.order_no, sum(dl.qty) q
                  from delivery_line dl
                  join delivery d on d.no = dl.delivery_no and d.status <> 'CANCELLED'
                 group by 1,2) t
       on t.product_id = sl.product_id and t.order_no = o.no
    where o.status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED')
      and sl.qty - coalesce(t.q,0) > 0) as picking;
```

Dan rekonsiliasi tiap baris — hasilnya harus 0:

```sql
select count(*) from packing_line_view
 where abs(case when pack_size > 0 then koli_penuh * pack_size + qty_sisa
                else qty_sisa end - qty_outstanding) > 0.001;
```

## Urutan pemakaian

Produksi: `0016` lalu `0017`, keduanya tanpa blok data demo di bagian akhir.

Demo lengkap: jalankan `0016` dan `0017` apa adanya.

## Verifikasi

Kedua file identik dengan yang dijalankan pada proyek Supabase, dicek dengan
md5 terhadap `supabase_migrations.schema_migrations`:

```
6efd45534cb94600646500291dc8cc2f  20260926235849_0016_product_packing.sql
68ce084168813caa17b780c1aa4a8720  20260927000011_0017_fix_packing_status_and_open_orders.sql
```

Cara mengecek ulang (newline terakhir dibuang agar setara dengan isi yang
tersimpan di database):

```bash
printf '%s' "$(cat 20260926235849_0016_product_packing.sql)" | md5sum
```
