# Kebutuhan pembelian dan PO manual (migrasi 0020–0021)

## Yang berubah

Sebelumnya Purchase Order terbit **otomatis** begitu Sales Order disetujui,
memakai `product.default_supplier_code` dan tanpa bisa dipilih. Tiga akibatnya:

1. Pembeli tidak pernah melihat kebutuhan pembelian secara utuh, sehingga tidak
   bisa menggabungkan pesanan atau menawar.
2. Supplier tidak dapat dibandingkan — padahal pada data yang ada, satu produk
   rata-rata dijual **2,59 supplier**, dan selisih harganya nyata (contoh Apel
   Malang: Rp 29.750 vs Rp 31.100 pada tanggal yang sama).
3. Produk yang supplier default-nya tidak terdaftar dilewati tanpa pesan apa
   pun, jadi barisnya tidak pernah dipesankan. Pada data yang ada hanya **171
   dari 593 baris Sales Order** yang tercakup PO.

Sekarang Sales Order yang disetujui masuk ke daftar **Kebutuhan Pembelian** di
menu Purchase Order. Pembeli memilih supplier dan qty per produk, lalu
menerbitkan PO. Satu PO memuat satu supplier dan boleh menggabungkan kebutuhan
beberapa Sales Order.

## Tiga keputusan yang membentuk perhitungannya

**Satu PO per supplier, menggabungkan beberapa Sales Order.** Karena itu
`purchase_order.order_no` tidak lagi cukup: kolom itu kini hanya terisi bila PO
memang berasal dari satu order saja, dan daftar lengkapnya dibaca dari
`purchase_order_source_view`.

**Qty usulan = sisa order − stok, dihitung per produk.** Stok satu produk
melayani order mana saja, jadi menguranginya per baris order akan menghitung
stok yang sama berulang kali. Pada data yang ada: kebutuhan 2.331 unit, stok
menutup 1.993, sisa yang benar-benar perlu dibeli 338 unit pada 9 produk dari
33 produk yang dibutuhkan.

**Alokasi dicatat per baris PO.** Satu baris PO kini bisa memenuhi beberapa
baris Sales Order, sehingga tautan satu-ke-satu lama tidak memadai lagi.

## Isi tiap migrasi

**0020 — `purchase_demand_and_manual_po`** (wajib)

| Objek | Fungsi |
|---|---|
| `po_line_allocation` | tabel baru: baris PO → baris SO + qty |
| `purchase_demand_line_view` | kebutuhan per baris Sales Order |
| `purchase_demand_view` | rollup per produk, termasuk `qty_buy` |
| `supplier_options_for(produk, tanggal)` | supplier yang menjual produk itu + harganya |
| `create_purchase_order(jsonb)` | menerbitkan satu PO untuk satu supplier |
| `purchase_order_source_view` | daftar Sales Order sumber tiap PO |
| `po_allocation_view` | alokasi tiap baris PO, untuk rincian PO dan gudang |
| `approve_sales_order` | **tidak lagi** memanggil PO otomatis |
| `create_po_from_order` | **dihapus** |

Migrasi ini juga memindahkan 171 tautan lama `purchase_order_line.so_line_id`
ke `po_line_allocation`, supaya perhitungan kebutuhan hanya punya satu jalur
baca dan order lama tidak dianggap belum pernah dipesan.

**0021 — `demand_supplier_options_bulk`** (wajib untuk versi Next.js)

`demand_supplier_options(tanggal)` mengembalikan pilihan supplier untuk seluruh
produk yang sedang dibutuhkan dalam satu permintaan. Tanpa ini halaman harus
memanggil `supplier_options_for` puluhan kali untuk satu layar.

## HPP tetap tertelusur

`hpp_unit` membaca `sales_order_line.po_line_id` → `goods_receipt_line` →
`unit_cost`. Karena beberapa baris Sales Order kini boleh menunjuk **satu**
baris PO yang sama, dan biaya per unit memang milik baris PO itu, fungsi HPP
tidak perlu diubah sama sekali dan hasilnya tetap tepat.

## Alokasi FIFO menurut tanggal kirim

Qty tiap baris PO dialokasikan ke baris Sales Order dengan tanggal kirim paling
awal lebih dulu. Kelebihan qty di atas kebutuhan dibiarkan tanpa alokasi dan
masuk sebagai stok gudang — rincian PO menyebutkan jumlahnya.

Di dalam `create_purchase_order`, kebutuhan **disalin lebih dulu ke `jsonb`**
sebelum dialokasikan. `purchase_demand_line_view` berubah begitu alokasi
pertama tercatat, sehingga membacanya sambil menulisinya lewat kursor akan
melewati atau menghitung ganda baris berikutnya.

## Verifikasi

Uji `create_purchase_order` dijalankan langsung terhadap Supabase di bawah RLS
lalu dibatalkan dengan `raise exception`:

```
PO=PO-2026-000113 supplier=SUP-UMUM | baris=3 | total=6017700
alokasi=201 | SO=3 customer=3 | header.order_no=NULL(gabungan)
kebutuhan 2331 -> 2130 (turun 201)
```

Total alokasi (201) sama persis dengan penurunan kebutuhan (201), dan satu PO
memang menggabungkan 3 Sales Order dari 3 customer. Setelah rollback: PO
hilang, alokasi kembali 171, kebutuhan kembali 2.331, trial balance Rp 0, 0
jurnal tidak balance, 0 stok negatif.

Cara memeriksa ulang konsistensi alokasi — keduanya harus 0:

```sql
-- alokasi tidak boleh melebihi qty baris PO-nya
select count(*) from (
  select pl.id, pl.qty, sum(a.qty) alok
    from purchase_order_line pl
    join po_line_allocation a on a.po_line_id = pl.id
   group by pl.id, pl.qty) z
 where alok > qty + 0.001;

-- kebutuhan tidak boleh negatif
select count(*) from purchase_demand_line_view where qty_needed <= 0;
```

Dan rekonsiliasi terhadap Picking List — kebutuhan + sudah dipesan harus sama
dengan sisa order:

```sql
select round(sum(qty_needed + qty_ordered)) as kebutuhan_plus_dipesan,
       round(sum(qty_order - qty_delivered)) as sisa_order
  from purchase_demand_line_view;
```

Kedua file SQL identik dengan yang dijalankan pada proyek Supabase:

```
67719854c46da2444e4c10ad34433f5d  20260927071152_0020_purchase_demand_and_manual_po.sql
0662306630b684dbd8727f6797148aa9  20260927072548_0021_demand_supplier_options_bulk.sql
```

```bash
printf '%s' "$(cat 20260927071152_0020_purchase_demand_and_manual_po.sql)" | md5sum
```

## Catatan untuk produksi

Daftar kebutuhan hanya berisi order berstatus `APPROVED`, `PROCESSING`, dan
`PARTIALLY DELIVERED`. Order yang sudah `DELIVERED` ke atas tidak muncul —
membeli untuk order yang sudah terkirim tidak ada gunanya. Pada data yang ada
masih terdapat 375 baris order terkirim/terfaktur yang tidak pernah tercakup
PO; HPP-nya memakai jenjang estimasi (`purchase_price_daily`, lalu harga pokok
master), yang memang disiapkan untuk kasus tersebut.

Hasil ketiga pemeriksaan di atas pada data saat ini: alokasi melebihi qty = 0,
kebutuhan nol/negatif = 0, dan kebutuhan + sudah dipesan = sisa order = **2.331
unit** — rekonsiliasi dengan basis Picking List tepat.
