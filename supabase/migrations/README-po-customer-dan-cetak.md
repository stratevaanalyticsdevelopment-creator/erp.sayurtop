# Nomor PO Customer otomatis (migrasi 0018–0019) dan perbaikan cetak

## Nomor PO Customer

Banyak pelanggan Sayur Top tidak menerbitkan Purchase Order sendiri, sehingga
kolom **PO Customer** pada Sales Order selalu kosong dan dokumen turunannya
(Surat Jalan, Invoice) kehilangan referensi silang.

Sistem kini membuat **nomor referensi internal** per customer:

```
PO-<kode customer tanpa awalan CUST->-<urut 4 digit>
contoh: PO-0008-0009
```

Perilakunya:

| Kejadian | Yang terjadi |
|---|---|
| Form Sales Order baru dibuka | Kolom terisi nomor usulan (`peek_cust_po`) tanpa memakai nomornya |
| Customer diganti | Nomor usulan ikut berubah, **selama** pengguna belum mengetik sendiri |
| Pengguna mengetik nomor PO asli customer | Nomor itu dipakai apa adanya dan tidak ditimpa |
| Sales Order disimpan | Penghitung baru naik di sini (`next_cust_po`) |

Membuka lalu membatalkan form tidak membuang nomor, karena penghitung hanya
naik saat dokumen benar-benar disimpan.

**0018 — `customer_po_reference`**
- `next_cust_po(customer)` — ambil nomor berikutnya dan naikkan penghitung
- `peek_cust_po(customer)` — lihat nomor berikutnya tanpa menaikkan penghitung
- `create_sales_order` mengisi sendiri bila `po_no` dikirim kosong
- Order lama yang kolom PO-nya kosong diisi berurut menurut tanggal order

Penomoran memakai tabel `doc_counter` yang sama dengan nomor dokumen lain,
jadi aman dipakai beberapa pengguna sekaligus.

**0019 — `cust_po_counter_above_max`**

Perbaikan atas 0018. Migrasi 0018 menyetel penghitung ke *jumlah* order tiap
customer, padahal data demo memakai akhiran acak 4 digit (mis. `PO-0008-8426`).
Setelah cukup banyak order baru, penghitung bisa mencapai angka yang sudah
terpakai dan menerbitkan **nomor kembar**. Migrasi ini menyetel penghitung ke
akhiran numerik tertinggi yang sudah ada per customer.

Cara mengecek tidak ada nomor kembar:

```sql
select count(*) - count(distinct po_no) as kembar,
       count(*) filter (where po_no is null or po_no = '') as kosong
  from sales_order;
```

## Perbaikan cetak (tanpa migrasi, hanya CSS dan komponen)

**Logo tidak ikut tercetak.** Kotak logo memakai `background: var(--brand)`
dengan logo berwarna putih di atasnya. Browser membuang warna latar saat
mencetak, sehingga logo putih jatuh di atas kertas putih dan tidak terlihat.
Perbaikannya `print-color-adjust: exact` pada kotak logo, kepala tabel, dan
garis judul — warna merek tetap keluar meski opsi "Background graphics" di
dialog cetak tidak dicentang.

**Lebar pratinjau berbeda dengan hasil cetak.** Sebelumnya `@media print`
tidak mengatur ukuran kertas maupun lebar dokumen, jadi dokumen melar mengikuti
lebar kertas dan pemenggalan kolomnya berubah. Sekarang:

- `@page { size: A4 portrait; margin: 12mm }`
- `.print-doc { width: 186mm }` (210mm − 2×12mm) di layar maupun cetak
- skala tampilan aplikasi (85%) dibatalkan pada modal pratinjau, sehingga yang
  terlihat di layar 1:1 dengan kertas, dan dikembalikan ke 1 saat mencetak
- kepala tabel diulang tiap halaman, baris tidak terpotong di tengah

**Margin kiri dan kanan tidak rata, plus halaman kosong.** Perbaikan pertama
memakai lebar tetap `186mm` dan `position:absolute`. Dua akibatnya:

1. Kalau pengguna memilih margin lain di dialog cetak (mis. "None"), lebar area
   cetak tidak lagi 186mm, sehingga sisa ruang menumpuk di satu sisi dan margin
   kiri-kanan menjadi tidak sama.
2. Isolasi cetak memakai `visibility: hidden`, yang tetap memakan ruang. Tinggi
   halaman aplikasi di belakangnya menghasilkan **3 halaman kosong** di setiap
   dokumen yang dicetak.

Perbaikannya:

- lebar dokumen saat mencetak `width: auto` — dokumen mengisi penuh area cetak,
  sehingga margin kiri dan kanan selalu persis sama dengan margin `@page`,
  berapa pun ukuran kertas dan pengaturan margin yang dipilih
- pratinjau cetak dipasang sebagai anak langsung `<body>` di kedua versi (di
  versi Next.js lewat `createPortal`), sehingga saat mencetak isi aplikasi bisa
  dilepas seluruhnya dengan `display: none` tanpa ikut menghilangkan dokumennya
- overlay dikembalikan ke alur blok biasa saat mencetak; tanpa ini `.ov.show`
  tetap `display: flex` dengan penengahan dan dokumen tergeser ke tengah

Hasil pengukuran pada PDF A4 yang benar-benar dihasilkan (raster 150 dpi, kotak
tinta diukur per halaman), untuk sembilan jenis dokumen cetak di kedua versi:
margin kiri = margin kanan = **12,0 mm**, selisih **0,0 mm** pada dokumen satu
halaman dan **0,2 mm** (dua piksel pembulatan) pada Rekap Packing lima halaman.
Tidak ada halaman kosong.

**Dokumen yang bisa dicetak.** Purchase Order sebelumnya tidak punya cetak sama
sekali di kedua versi, dan Sales Order tidak punya tombol cetak di versi
Next.js (komponennya ada tapi tidak pernah dipakai). Keduanya sudah dipasang,
sehingga Sales Order, Purchase Order, Invoice, dan Surat Jalan semuanya dapat
dicetak dari kedua versi.

## Verifikasi

Kedua file SQL identik dengan yang dijalankan pada proyek Supabase:

```
49fb8058636219b5a4b905cee7dd5f64  20260927051429_0018_customer_po_reference.sql
e20950aee9190aa0a2b2e3e2fc7b0155  20260927051452_0019_cust_po_counter_above_max.sql
```

```bash
printf '%s' "$(cat 20260927051429_0018_customer_po_reference.sql)" | md5sum
```
