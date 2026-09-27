import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Klien Supabase untuk server component / route handler.
 *  Tidak dipakai di middleware — lihat catatan pada middleware.ts. */
export function createClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Konfigurasi Supabase belum lengkap: NEXT_PUBLIC_SUPABASE_URL dan '
      + 'NEXT_PUBLIC_SUPABASE_ANON_KEY harus diisi saat build.'
    );
  }
  return createServerClient(
    url,
    key,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try { cookieStore.set({ name, value, ...options }); } catch { /* dipanggil dari server component */ }
        },
        remove(name: string, options: CookieOptions) {
          try { cookieStore.set({ name, value: '', ...options }); } catch { /* idem */ }
        },
      },
    }
  );
}
