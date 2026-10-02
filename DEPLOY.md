# Deploy ke Vercel

## Ringkas

1. Unggah **seluruh isi folder `sayurtop-next`** ke repositori GitHub
   (isinya langsung di akar repo, bukan di dalam subfolder).
2. Di Vercel: **Add New → Project → Import** repositori itu.
3. Isi **Environment Variables** lebih dulu, baru **Deploy**.
4. Setiap kali nilai env diubah, jalankan **Redeploy** — nilainya ditanam saat
   build, bukan dibaca saat aplikasi berjalan.

## Environment Variables

> **Proyek Supabase yang benar untuk aplikasi ini: `yartnygvfuxazlqhlcrc`**
> (nama di dashboard: **sayurtop-o2c**), URL
> `https://yartnygvfuxazlqhlcrc.supabase.co`.
>
> Seluruh migrasi 0001–0024 diterapkan di proyek itu. Bila Vercel diarahkan ke
> proyek Supabase lain, aplikasi tetap terbit dan login tetap jalan, tetapi
> menu **Purchase Order → Kebutuhan Pembelian**, **Picking List**, dan
> **Packaging** akan kosong — view dan fungsi yang dipakai ketiganya tidak ada
> di sana. Ini pernah terjadi dan sulit disadari karena tidak ada pesan galat.
> Sejak versi ini, ketiga halaman itu menampilkan pesan galat Supabase apa
> adanya, bukan tabel kosong.

| Nama | Wajib | Isi |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ya | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ya | anon key dari Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | tidak | hanya bila menu System › User Management dipakai untuk membuat akun |

`SUPABASE_SERVICE_ROLE_KEY` menembus seluruh Row Level Security. Isikan
**hanya** di Environment Variables Vercel, jangan pernah di dalam berkas yang
ikut ke repositori.

Bila kedua variabel wajib belum diisi, build **tetap berhasil** dan aplikasi
tetap terbit — layarnya menampilkan pesan bahwa konfigurasi belum lengkap.
Ini disengaja: satu pengaturan yang terlewat tidak seharusnya membuat seluruh
deploy gagal.

## Dua penyebab build gagal yang sudah pernah terjadi

**1. `Module not found: Can't resolve '@/components/ui'`**

Berkasnya tidak ada di repositori, bukan salah kode. Alias `@/` menunjuk ke
akar proyek lewat `paths` di `tsconfig.json`, jadi galat ini berarti salah satu
dari dua hal:

- **Sebagian berkas tidak ikut terunggah.** Fitur *Add files via upload* di
  web GitHub membatasi jumlah berkas per unggahan (100 berkas), sementara
  proyek ini berisi sekitar 124 berkas. Sisanya dibuang tanpa peringatan,
  dan repositori tampak wajar padahal tidak lengkap.
- **Berkas lama tertinggal.** Unggahan lewat web hanya menambah dan menimpa,
  tidak pernah menghapus. Berkas dari struktur versi lama akan tetap ada dan
  ikut dibangun. Bila ragu, hapus isi repositori lebih dulu lalu unggah ulang.

### Cara memastikan, bukan menebak

Paket ini memuat `MANIFEST.txt` — daftar seluruh berkas yang harus ada — dan
sebuah pemeriksa. Jalankan dari dalam folder hasil *clone* repositori:

```bash
bash tools/cek-repo.sh
```

Hasilnya menyebut nama berkas yang hilang satu per satu, misalnya:

```
BERKAS HILANG (3):
  components/ui.tsx
  lib/gl.ts
  lib/use-gl.ts
```

Tiga nama itu persis yang dikeluhkan Vercel pada galat di atas. Unggah
berkas tersebut, lalu jalankan pemeriksaan ulang sampai tertulis LENGKAP.

### Menghindari batas 100 berkas sejak awal

Proyek lengkap berisi sekitar 124 berkas, jadi tidak muat dalam satu unggahan
web. Ada dua jalan keluar:

**Pakai Git — tidak ada batas berkas, dan cara ini juga menghapus berkas
lama yang sudah tidak dipakai:**

```bash
cd sayurtop-next
git init && git add . && git commit -m "Strateva O2C ERP"
git branch -M main
git remote add origin https://github.com/<akun>/<repo>.git
git push -u origin main --force
```

**Atau pakai paket ramping.** Berkas di folder `supabase/` (migrasi SQL) dan
`tools/` tidak dipakai saat build. Tanpa keduanya proyek tinggal **86 berkas**
— muat dalam satu kali unggah web. Paket `..._vercel-only.zip` berisi persis
itu dan sudah diuji build-nya. Migrasi SQL tetap disimpan di paket lengkap;
keduanya tidak perlu ada di repositori agar aplikasi berjalan.

**2. `Konfigurasi Supabase belum lengkap … harus diisi saat build`**

Sudah diperbaiki: env yang kosong tidak lagi menggagalkan build.

## Memeriksa paket sebelum diunggah

Jalankan di komputer sendiri, dari folder hasil ekstrak, **tanpa** berkas
`.env` apa pun — persis seperti yang Vercel lakukan:

```bash
npm ci
npm run build
```

Bila perintah itu selesai tanpa galat, paketnya utuh dan siap di-deploy.
Bila gagal, galatnya akan sama dengan yang muncul di Vercel.

## Berkas env

Hanya `.env.example` yang ikut ke repositori, dan isinya placeholder.
`.gitignore` sudah menolak seluruh pola `.env*` selain contoh itu.

Untuk menjalankan di komputer sendiri:

```bash
cp .env.example .env.local     # lalu isi nilainya
npm install
npm run dev
```
