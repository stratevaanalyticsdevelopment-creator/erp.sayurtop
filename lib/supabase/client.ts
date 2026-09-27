'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Klien Supabase untuk komponen client. Sesi disimpan di cookie agar
 *  middleware dan route handler ikut mengenalinya.
 *
 *  Catatan: variabel NEXT_PUBLIC_* ditanam saat build, bukan dibaca saat
 *  aplikasi berjalan. Bila di-deploy ke Vercel, isi keduanya di
 *  Project Settings → Environment Variables SEBELUM build, lalu redeploy. */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Konfigurasi Supabase belum lengkap: NEXT_PUBLIC_SUPABASE_URL dan '
      + 'NEXT_PUBLIC_SUPABASE_ANON_KEY harus diisi saat build.'
    );
  }
  return createBrowserClient(url, key);
}
