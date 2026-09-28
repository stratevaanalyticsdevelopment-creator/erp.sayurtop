/* =====================================================================
   ROUTE HANDLER — pembuatan akun & reset password.
   Membuat login di Supabase Auth memerlukan service role key, yang tidak
   boleh dikirim ke browser. Endpoint ini berjalan di server:
     1. memverifikasi sesi pemanggil, lalu
     2. memeriksa hak akses lewat fungsi rbac() di database (bukan di sini),
     3. baru memakai service role untuk memanggil Auth Admin API.
   Bila SUPABASE_SERVICE_ROLE_KEY tidak diisi, endpoint menolak dengan pesan
   yang jelas dan pembuatan akun dilakukan dari dashboard Supabase.
   ===================================================================== */
import { NextResponse } from 'next/server';
import { createClient as createServer } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

function admin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function guard(act: 'create' | 'edit') {
  const supabase = createServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { err: 'Sesi tidak ditemukan. Silakan masuk kembali.', code: 401 };
  const { data, error } = await supabase.rpc('rbac', { p_menu: 'sys.user', p_act: act });
  if (error) return { err: error.message, code: 400 };
  if (data !== true) return { err: 'Anda tidak memiliki hak akses untuk tindakan ini.', code: 403 };
  return { err: null, code: 200 };
}

const NO_KEY = 'SUPABASE_SERVICE_ROLE_KEY belum diisi pada server. '
  + 'Tambahkan pada .env.local (jangan diawali NEXT_PUBLIC_) atau buat akun langsung dari dashboard Supabase.';

export async function POST(req: Request) {
  const g = await guard('create');
  if (g.err) return NextResponse.json({ error: g.err }, { status: g.code });
  const sb = admin();
  if (!sb) return NextResponse.json({ error: NO_KEY }, { status: 501 });

  const b = await req.json();
  if (!b.username || !b.name || !b.password || !b.email) {
    return NextResponse.json({ error: 'Username, nama, email, dan password wajib diisi.' }, { status: 400 });
  }
  const { error } = await sb.auth.admin.createUser({
    email: String(b.email).trim().toLowerCase(),
    password: String(b.password),
    email_confirm: true,
    user_metadata: {
      username: String(b.username).trim().toLowerCase(),
      name: String(b.name).trim(),
      role_code: b.role_code || 'SALES',
      salesperson_code: b.salesperson_code || '',
    },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const g = await guard('edit');
  if (g.err) return NextResponse.json({ error: g.err }, { status: g.code });
  const sb = admin();
  if (!sb) return NextResponse.json({ error: NO_KEY }, { status: 501 });

  const b = await req.json();
  if (!b.id || !b.password) {
    return NextResponse.json({ error: 'ID pengguna dan password baru wajib diisi.' }, { status: 400 });
  }
  const { error } = await sb.auth.admin.updateUserById(String(b.id), { password: String(b.password) });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
