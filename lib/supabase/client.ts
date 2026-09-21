'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Klien Supabase untuk komponen client. Sesi disimpan di cookie agar
 *  middleware dan server component ikut mengenalinya. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
