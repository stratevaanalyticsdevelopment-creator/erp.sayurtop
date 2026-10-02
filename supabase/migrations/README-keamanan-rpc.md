# Akses RPC tanpa login ditutup (migrasi 0027)

## Temuan

Supabase Security Advisor melaporkan 40 fungsi `SECURITY DEFINER` yang dapat
dipanggil oleh peran `anon` — yaitu **tanpa login sama sekali** — lewat
`POST /rest/v1/rpc/<nama>`.

Itu bukan peringatan teoretis. Kunci anon bersifat publik: ia tertanam di
bundel JavaScript aplikasi yang terbit, sehingga siapa pun yang membuka
`erp-sayurtop.vercel.app` memilikinya.

Sebagian besar fungsi sebenarnya terlindungi oleh penjaganya sendiri —
`rbac(menu, aksi)` menolak bila `auth.uid()` tidak cocok dengan pengguna aktif,
dan `auth.uid()` bernilai null untuk anon. Tetapi **empat fungsi yang menulis
tidak memiliki penjaga itu**:

| Fungsi | Yang bisa dilakukan tanpa login |
|---|---|
| `post_journal(...)` | menyisipkan jurnal ke dalam pembukuan |
| `void_journals_for(ref)` | membatalkan jurnal |
| `refresh_base_price(grn)` | mengubah harga pokok produk |
| `refresh_invoice_status(no)` | mengubah status invoice |

Ditambah dua yang bisa dipakai merusak jejak dan penomoran: `write_audit()`
(memalsukan baris audit) dan `next_doc_no()` (menghabiskan nomor dokumen).

## Perbaikan

Aplikasi tidak memanggil satu pun RPC sebelum login — proses masuk memakai
Supabase Auth (`auth.signInWithPassword`), bukan RPC di skema `public`. Satu
route API yang memanggil RPC (`/api/admin/user`) melakukannya setelah sesi
diverifikasi, dan memakai `service_role` untuk operasi admin.

Karena itu hak `EXECUTE` **PUBLIC** dicabut dari seluruh fungsi di skema
`public`, lalu hak `authenticated` dan `service_role` ditegaskan kembali secara
eksplisit — sehingga akses pengguna yang sudah login tidak berubah sedikit pun.

### Satu jebakan yang perlu dicatat

`revoke execute ... from anon` **tidak cukup**, dan sempat membuat perbaikan ini
tampak berhasil padahal tidak:

```
sebelum revoke from anon : 78 fungsi terbuka untuk anon
sesudah revoke from anon : 78 fungsi terbuka untuk anon   <-- tidak berubah
```

Postgres memberikan `EXECUTE` kepada `PUBLIC` pada setiap fungsi baru, dan
`anon` mewarisi hak itu sebagai anggota `PUBLIC` — bukan lewat pemberian
langsung. Yang harus dicabut adalah hak `PUBLIC`-nya.

Migrasi ini juga mengubah **default privileges** skema, supaya fungsi yang
dibuat kemudian tidak otomatis terbuka untuk anon lagi.

### Pengecualian

`handle_new_auth_user()` dibiarkan terbuka. Ia fungsi trigger pada
`auth.users` yang dijalankan oleh peran internal Supabase saat pengguna dibuat;
mencabut hak PUBLIC darinya berisiko menggagalkan pembuatan pengguna.
Memanggilnya lewat RPC tidak berguna bagi penyerang — ia mengembalikan tipe
trigger dan langsung gagal di luar konteks trigger.

### `today_jkt()` diberi search_path tetap

Peringatan kedua dari advisor. Pada fungsi `SECURITY DEFINER`, `search_path`
yang dapat diubah pemanggil adalah jalur serangan klasik: objek bernama sama di
skema lain bisa dipakai mendahului objek yang dimaksud.

## Verifikasi

Pada proyek Supabase, setelah migrasi:

```
masih terbuka untuk anon    : 1  (hanya handle_new_auth_user)
boleh untuk pengguna login  : 44 (seluruh fungsi)
total fungsi                : 44
```

Seluruh RPC dan view diuji dengan `set role authenticated` dan klaim JWT
pengguna `admin`:

| Pemeriksaan | Hasil |
|---|---|
| `demand_supplier_options()` | 89 baris |
| `my_profile()` | admin / Administrator |
| `packing_line_view` | 44 baris |
| `purchase_demand_line_view` | 34 baris |
| `purchase_demand_view` | 33 baris |
| `order_outstanding_view` | 593 baris |
| `supplier_product_view` | 616 baris |
| `rbac('buy.po','create')` | true |
| `peek_cust_po('CUST-0001')` | PO-0001-9333 |

Tidak ada satu pun galat hak akses. Migrasi ini juga diuji dijalankan dua kali
berturut-turut tanpa galat.

## Yang masih terbuka, dan perlu keputusan Anda

`post_journal`, `next_doc_no`, dan `write_audit` **dipanggil langsung oleh
aplikasi** sebagai pengguna yang sudah login, dan ketiganya tidak memiliki
penjaga `rbac()`. Jadi pengguna mana pun yang sudah masuk — termasuk peran
Sales — secara teknis masih dapat memanggilnya langsung dan menyisipkan jurnal.

Menambahkan `rbac('acc.journal','create')` pada `post_journal` akan menutup itu,
tetapi juga menolak alur yang sah: saat seorang Sales membuat invoice,
`post_journal` ikut terpanggil sementara ia tidak punya hak akuntansi.

Perbaikan yang benar adalah **memindahkan pembuatan jurnal ke dalam fungsi
pemanggilnya** (`create_invoice_from_delivery`, `process_return`,
`record_payment`, `receive_goods`), sehingga `post_journal` tidak lagi perlu
dipanggil dari klien dan hak EXECUTE-nya bisa dicabut dari `authenticated`
juga. Itu menyentuh alur pembukuan, jadi saya tidak melakukannya tanpa
persetujuan Anda.

Dampaknya saat ini terbatas: penyerang harus memiliki kredensial pengguna yang
sah lebih dulu. Lubang yang serius — tanpa kredensial apa pun — sudah tertutup.

## Peringatan lain yang sengaja dibiarkan

**`security_definer_view` (9 view, level ERROR).** Seluruh view memakai
`security_invoker = off`, artinya dibaca atas nama pemiliknya sehingga RLS tiap
tabel di dalamnya tidak berlaku. Itu **disengaja** dan dijelaskan di migrasi
0024: dengan `on`, Picking List memberi angka berbeda-beda tergantung peran yang
login — 593 baris untuk direktur, 0 untuk lina, padahal yang benar 88. Hak akses
ditegakkan di lapisan menu (`rbac`), bukan di view. Mengubahnya kembali ke `on`
akan mengulangi cacat 0024.

**`auth_leaked_password_protection` (level WARN).** Supabase dapat memeriksa
sandi baru terhadap HaveIBeenPwned. Belum dinyalakan. Untuk data contoh ini
tidak mendesak, tetapi **nyalakan sebelum dipakai dengan pengguna sungguhan**:
Supabase → Authentication → Policies → Leaked password protection.
