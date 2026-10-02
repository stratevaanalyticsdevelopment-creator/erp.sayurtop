'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Klien Supabase untuk komponen client. Sesi disimpan di cookie agar
 *  middleware dan route handler ikut mengenalinya.
 *
 *  Catatan: variabel NEXT_PUBLIC_* ditanam saat build, bukan dibaca saat
 *  aplikasi berjalan. Bila di-deploy ke Vercel, isi keduanya di
 *  Project Settings → Environment Variables SEBELUM build, lalu redeploy. */
export const SUPABASE_BELUM_DIISI =
  'Konfigurasi Supabase belum lengkap. Isi NEXT_PUBLIC_SUPABASE_URL dan '
  + 'NEXT_PUBLIC_SUPABASE_ANON_KEY di Environment Variables, lalu jalankan '
  + 'Redeploy — nilai NEXT_PUBLIC_* ditanam saat build, bukan dibaca saat '
  + 'aplikasi berjalan.';

/** Benar bila kedua variabel wajib sudah terisi saat build. */
export function supabaseSiap() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  /* Env yang kosong TIDAK boleh menggagalkan build. Next merender halaman
     client di server saat build, dan melempar galat di sini membuat seluruh
     deploy merah padahal yang kurang cuma satu pengaturan. Dengan alamat
     pengganti, build selesai dan aplikasi terbit; pesan yang jelas muncul di
     layar saat dibuka, sehingga pengguna tahu persis apa yang harus diisi. */
  if (!url || !key) {
    return createBrowserClient('https://belum-dikonfigurasi.supabase.co', 'belum-dikonfigurasi');
  }
  return createBrowserClient(url, key);
}
