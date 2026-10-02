# Data contoh ikut maju bersama kalender (migrasi 0025–0026)

## Gejala yang dilaporkan

Di aplikasi yang terbit (Vercel + Supabase), beberapa menu "tidak berjalan
seperti versi HTML":

- **Purchase Order › Kebutuhan Pembelian** kosong, tidak terhubung ke Sales Order
- **Picking List** kosong
- **Packaging** kosong
- **Dasbor**: "Top Customer <bulan ini>" dan "Produk Terlaris <bulan ini>" kosong
- **Laporan Penjualan** dan **Laba Rugi** bulan berjalan menunjukkan nol

## Sebabnya satu, bukan lima

Tidak satu pun dari itu cacat kode. Pembandingan halaman per halaman antara
kedua versi memberi **46 dari 47 halaman identik** begitu tanggal datanya
disegarkan — satu-satunya yang berbeda adalah halaman Diagnostik Koneksi, yang
memang berbeda sifatnya (satu memeriksa localStorage, satu memeriksa objek
Postgres).

Penyebabnya adalah **data contoh yang membeku**:

| | Versi HTML | Versi Supabase |
|---|---|---|
| Data contoh dibuat | di peramban | sekali oleh migrasi |
| Tanggalnya relatif terhadap | hari data itu dibuat | hari migrasi dijalankan |
| Saat hari ini maju | tanggal ikut tertinggal | tanggal ikut tertinggal |

Halaman-halaman di atas menyaring tanggal:

- Packaging dan Picking List memakai rentang **tanggal kirim** hari ini s.d. H+6
- Kebutuhan Pembelian berasal dari Sales Order terbuka, yang tanggal kirimnya
  ikut tersaring
- Dasbor dan laporan memakai **bulan berjalan**

Begitu data contoh tertinggal lebih dari seminggu, seluruh saringan itu tidak
menemukan apa pun. Keadaan di proyek Supabase pada 1 Oktober 2026:

```
hari ini              2026-10-01
invoice terakhir      2026-09-20
tertinggal            11 hari
invoice bulan ini     0        <- dasbor "bulan ini" kosong karena ini
```

Migrasi 0022 sudah menangani sebagian — ia menyegarkan tanggal kirim order
terbuka — tetapi tidak menyentuh riwayat transaksi, sehingga dasbor dan
laporan bulan berjalan tetap kosong.

## Yang diperbaiki

### `refresh_demo_data()`

Menggeser **seluruh** tanggal dokumen dengan jumlah hari yang sama, sebesar
jarak antara invoice terakhir dan hari ini. Karena pergeserannya seragam:

- jarak antar dokumen tidak berubah (order → kirim → invoice → bayar)
- umur piutang tetap konsisten terhadap tanggal jatuh tempo
- tanggal jurnal bergeser bersama dokumennya, sehingga trial balance, neraca,
  dan laba rugi tetap seimbang

```sql
select demo_shift_days();   -- berapa hari tertinggal, tanpa mengubah apa pun
select refresh_demo_data(); -- geser secukupnya
select refresh_demo_data(p_days => 7);  -- geser tepat 7 hari
```

Tabel yang disentuh: `quotation`, `sales_order`, `delivery`, `invoice`,
`sales_return`, `credit_note`, `payment`, `collection`, `collection_history`,
`purchase_order`, `goods_receipt`, `supplier_price`, `journal`,
`sales_order_timeline`, `audit_log`.

**Nomor dokumen tidak digeser.** Nomor adalah identitas; mengubahnya akan
memutus rujukan antar tabel. Karena nomor memuat tahun, pergeseran yang akan
melewati 31 Desember **ditolak** — pada titik itu data contoh sebaiknya dibuat
ulang, bukan digeser lagi.

### Penjaga terhadap data sungguhan

Fungsi ini menggeser tanggal seluruh dokumen tanpa membedakan mana yang contoh
dan mana yang sungguhan, sehingga ia **menolak berjalan** bila menemukan tanda
bahwa aplikasi sudah dipakai sungguhan (`demo_data_only()`): ada customer di
luar pola `CUST-0000`, atau jumlah Sales Order / Invoice melebihi 400.

Penjaganya bisa dilewati dengan sengaja — `select refresh_demo_data(p_force => true)`
— tetapi **jangan pernah** dilewati pada basis data produksi.

### Penjadwal harian ikut menggeser data

`refresh_demo_schedule_cron()` sekarang memanggil `refresh_demo_data()` lebih
dulu, lalu menyebar ulang tanggal kirim order terbuka. Kegagalan pada langkah
pertama — misalnya karena batas tahun atau karena penjaga data sungguhan
menolak — tidak menghalangi langkah kedua.

Penjadwalnya tetap yang dipasang migrasi 0023: tiap hari pukul 01.00 WIB.

```sql
select jobname, schedule, active from cron.job;
select cron.unschedule('segarkan-jadwal-demo');   -- mematikan
```

### Versi HTML diperbaiki dengan cara yang sama

Versi HTML menyimpan datanya di `localStorage` dan hanya menyemai bila kosong,
jadi **ia mengalami pembekuan yang sama** — file yang dibuka seminggu kemudian
menampilkan Packaging yang kosong. Fungsi `segarkanDataDemo()` di
`build/p4_core.js` melakukan pergeseran yang sama saat aplikasi dimuat,
dengan penjaga dan batas tahun yang sama, sehingga kedua versi tetap identik.

## Migrasi 0026 mengoreksi 0025

Migrasi 0025 sudah dijalankan sebelum dua cacat ini ditemukan oleh uji.
Riwayat migrasi dibiarkan apa adanya dan koreksinya berdiri sebagai migrasi
tersendiri, supaya pemutaran ulang riwayat pada proyek mana pun menghasilkan
fungsi yang benar.

**Cacat 1 — kunci unik `supplier_price`**

```
ERROR: 23505 duplicate key value violates unique constraint
       "supplier_price_supplier_code_product_id_price_date_key"
DETAIL: Key (supplier_code, product_id, price_date)=(SUP-003, SAY-0060, 2026-09-23)
        already exists.
```

Tabel itu punya kunci unik `(supplier_code, product_id, price_date)`.
Menggeser seluruh baris dalam satu perintah ditolak karena Postgres memeriksa
keunikan per baris: baris yang sudah digeser bertabrakan dengan baris yang
belum. Diperbaiki dengan dua langkah lewat offset 100.000 hari, lebih panjang
daripada rentang riwayat harga mana pun, sehingga himpunan tanggal lama dan
baru tidak pernah bersinggungan.

**Cacat 2 — nama kolom jejak waktu**

```
ERROR: 42703 column "at" does not exist
```

Kolom waktu pada `sales_order_timeline` dan `audit_log` bernama `ts`.

## Verifikasi

Dijalankan sungguhan pada proyek Supabase, diukur sebelum dan sesudah:

| | Sebelum | Sesudah |
|---|---|---|
| Trial balance | 0,00 | **0,00** |
| Jurnal tidak seimbang | 0 | **0** |
| Jumlah invoice | 94 | **94** |
| Total piutang | Rp 552.273.487,18 | **Rp 552.273.487,18** |
| Baris harga supplier | 8.004 | **8.004** |
| Stok negatif | 0 | **0** |
| Invoice terakhir | 2026-09-20 | **2026-10-01** |
| Invoice bulan berjalan | 0 | **1** |

Pergeseran: **11 hari**, 94 invoice dihitung ulang statusnya.

Status invoice ikut berubah — dan menjadi **benar**. Sebelum pergeseran, data
semaian memuat label yang tidak sesuai dengan pembayarannya; sesudah dihitung
ulang, seluruhnya konsisten:

| Status | Jumlah | Terbayar penuh | Sebagian | Belum bayar | Lewat jatuh tempo |
|---|---|---|---|---|---|
| OPEN | 14 | 0 | 0 | 14 | 0 |
| OVERDUE | 13 | 0 | 0 | 13 | 13 |
| PAID | 56 | 56 | 0 | 0 | 48 |
| PARTIALLY PAID | 11 | 0 | 11 | 0 | 10 |

Total piutang tidak bergerak sepeser pun, jadi yang berubah hanya labelnya.

Pada versi HTML, pemulihan diuji dengan sengaja memundurkan seluruh tanggal
20 hari lalu memuat ulang berkasnya:

```
1. segar          invoice terakhir 2026-10-01  tertinggal 0   kirim lewat 0   invoice bulan ini 2
2. dibuat basi    invoice terakhir 2026-09-11  tertinggal 20  kirim lewat 11  invoice bulan ini 0
3. setelah dimuat invoice terakhir 2026-10-01  tertinggal 0   kirim lewat 0   invoice bulan ini 2
```

Keadaan 3 identik dengan keadaan 1, termasuk sebaran status invoice, total
piutang (Rp 321.444.981), dan trial balance 0.

## Untuk data sungguhan

Kedua migrasi ini khusus menjaga **data contoh** tetap terlihat hidup. Begitu
aplikasi dipakai dengan order sungguhan, matikan penjadwalnya:

```sql
select cron.unschedule('segarkan-jadwal-demo');
```

`demo_data_only()` sudah menjadi penjaga otomatis, tetapi mematikan penjadwal
lebih pasti daripada bergantung pada penjaga.
