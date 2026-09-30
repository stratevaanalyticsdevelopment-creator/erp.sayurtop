# Jadwal data contoh tetap segar (migrasi 0022–0023)

## Gejala

Menu **Picking List** dan **Packaging** di aplikasi yang terbit (Vercel +
Supabase) menampilkan lebih sedikit baris daripada versi HTML, dan makin hari
makin sedikit — sampai akhirnya kosong sama sekali.

## Sebabnya bukan kode

Kedua halaman menampilkan Sales Order yang belum selesai dalam rentang
**tanggal kirim** — bawaannya hari ini sampai H+6. Migrasi 0017 menyebar
tanggal kirim order terbuka **satu kali**, relatif terhadap hari migrasi itu
dijalankan. Jadwal itu lalu membeku, sementara tanggal hari ini terus maju.

Pada 28 September 2026 kondisinya:

| | Nilai |
|---|---|
| Order terbuka | 8 |
| Tanggal kirimnya sudah lewat | **4** |
| Tanggal kirim paling akhir | 30 September 2026 |
| Baris Packaging yang tampil | 24 dari 44 |

Artinya mulai **1 Oktober 2026** kedua halaman akan kosong total. Versi HTML
tidak mengalami ini karena menjadwalkan ulang setiap kali data contohnya
dibuat di peramban.

## Isi tiap migrasi

**0022 — `refresh_demo_schedule`**

`refresh_demo_schedule()` menyebar ulang tanggal kirim seluruh Sales Order
yang belum selesai ke rentang hari ini sampai H+3, memakai aturan yang sama
dengan 0017. Boleh dijalankan ulang kapan saja:

```sql
select refresh_demo_schedule();
```

Migrasi ini juga menjalankannya sekali, sehingga jadwalnya langsung segar.

**0023 — `cron_refresh_demo_schedule`**

Memasang `pg_cron` dan menjadwalkan penyegaran **tiap hari pukul 01.00 WIB**
(`0 18 * * *` UTC). Fungsi yang dipanggil penjadwal adalah
`refresh_demo_schedule_cron()` — sama persis, hanya tanpa pemeriksaan hak
akses, karena pg_cron berjalan tanpa sesi pengguna. Fungsi itu dicabut
aksesnya dari `anon` dan `authenticated`, jadi hanya penjadwal yang bisa
memanggilnya.

Mematikan penjadwal:

```sql
select cron.unschedule('segarkan-jadwal-demo');
```

Memeriksa penjadwal dan riwayat jalannya:

```sql
select jobname, schedule, active from cron.job;
select status, start_time, return_message
  from cron.job_run_details order by start_time desc limit 5;
```

## Aman terhadap pembukuan

Yang diubah **hanya** kolom `delivery_date` pada Sales Order berstatus
`APPROVED`, `PROCESSING`, atau `PARTIALLY DELIVERED`. Tanggal dokumen yang
sudah terbit — Surat Jalan, Invoice, jurnal — tidak disentuh, sehingga tidak
ada angka keuangan yang bergeser.

## Verifikasi

Jadwal sengaja dirusak (seluruh order terbuka dimundurkan 5 hari), lalu
penyegar dijalankan seperti yang dilakukan pg_cron. Seluruh blok dibatalkan
dengan `raise exception` sehingga tidak ada yang tersimpan:

```
setelah dirusak     packing = 0 baris
fungsi memperbarui  8 Sales Order
setelah disegarkan  packing = 44 baris, qty 2.655
trial balance       0,00
stok negatif        0
```

Angka `packing = 0` itu persis gejala yang dilaporkan, dan kembali penuh
setelah penyegar berjalan.

Kondisi setelah kedua migrasi diterapkan:

| | Sebelum | Sesudah |
|---|---|---|
| Order terbuka bertanggal lewat | 4 | **0** |
| Baris Packaging tampil | 24 | **44** |
| Produk disiapkan | 23 | **39** |
| Qty | 1.701 | **2.655** |
| Koli | — | 200 |
| Baris Picking List | 88 | 88 |

Kedua berkas SQL identik dengan yang dijalankan pada proyek Supabase:

```
03f59bec06b4eb5628b1348bacaf0b4a  20260928101153_0022_refresh_demo_schedule.sql
9a1c18e13fd5c38252c87d76314928ca  20260928101748_0023_cron_refresh_demo_schedule.sql
```

```bash
printf '%s' "$(cat 20260928101153_0022_refresh_demo_schedule.sql)" | md5sum
```

## Untuk data sungguhan

Kedua migrasi ini khusus menjaga **data contoh** tetap terlihat hidup. Bila
aplikasi sudah dipakai dengan order sungguhan, matikan penjadwalnya — tanggal
kirim order asli tidak boleh digeser oleh siapa pun kecuali penggunanya.
