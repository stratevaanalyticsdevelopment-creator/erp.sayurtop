'use client';
/* Halaman login — tata letak, warna, dan teks identik dengan versi HTML. */
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/* Nama pengguna dipetakan ke email akun. Hampir semuanya mengikuti pola
   <nama>@sayurtop.co.id; hanya dua akun ini yang tidak, jadi hanya keduanya
   yang perlu dicatat.

   Daftar akun demo beserta kata sandinya sudah dihapus dari halaman ini.
   Menyembunyikan tombolnya saja tidak cukup: seluruh isi berkas ini ikut
   terkirim sebagai JavaScript ke setiap pengunjung, sehingga kata sandi yang
   hanya disembunyikan dari layar tetap terbaca dari kode sumber halaman. */
const EMAIL_ALIAS: Record<string, string> = {
  tagihan: 'dedi@sayurtop.co.id',
  kasir: 'sari@sayurtop.co.id',
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.getElementById('luser')?.focus(); }, []);

  async function submit() {
    setErr('');
    const u = user.trim().toLowerCase();
    if (!u || !pass) { setErr('Nama pengguna dan kata sandi wajib diisi.'); return; }
    setBusy(true);
    // Pengguna boleh mengetik username atau email; username dipetakan ke email akun.
    const email = u.includes('@') ? u : (EMAIL_ALIAS[u] ?? `${u}@sayurtop.co.id`);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    setBusy(false);
    if (error) {
      setErr(error.message === 'Invalid login credentials'
        ? 'Nama pengguna atau kata sandi salah.'
        : error.message);
      return;
    }
    router.replace(params.get('next') || '/');
    router.refresh();
  }

  return (
    <div id="loginScreen">
      <div className="login-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="hero-logo" src="/img/logo-lg-accent.png" alt="Sayur Top — Fresh Supply, Trusted Partner" />
        <div className="hero-pills">
          <div className="hero-pill">Sales Order</div>
          <div className="hero-pill">Surat Jalan</div>
          <div className="hero-pill">Invoice &amp; Retur</div>
          <div className="hero-pill">AR &amp; Payment</div>
          <div className="hero-pill">Laporan Keuangan</div>
        </div>
        <div className="hero-tag">Sistem Order-to-Cash terintegrasi<br />untuk distribusi sayur, buah, dan bahan segar</div>
        <div className="hero-foot">© 2026 Strateva E2C ERP</div>
      </div>

      <div className="login-panel">
        <div className="login-box">
          <h2>Welcome back</h2>
          <div className="sub">Sign in to continue to Strateva O2C ERP</div>

          <div className="fld">
            <label htmlFor="luser">Nama pengguna</label>
            <input id="luser" type="text" placeholder="cth. nama.pengguna" autoComplete="username"
              value={user} onChange={(e) => setUser(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('lpass')?.focus(); }} />
          </div>
          <div className="fld">
            <label htmlFor="lpass">Kata sandi</label>
            <input id="lpass" type="password" placeholder="••••••••" autoComplete="current-password"
              value={pass} onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
            <div className="hint">Akun dibuat melalui System › User Management.</div>
          </div>

          <div className="login-err" style={{ display: err ? 'block' : 'none' }}>{err}</div>
          <button className="btn-login" onClick={submit} disabled={busy}>
            {busy ? 'Memproses…' : 'Masuk'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* useSearchParams wajib berada di dalam Suspense agar halaman dapat di-prerender. */
export default function LoginPage() {
  return (
    <Suspense fallback={<div id="loginScreen" />}>
      <LoginForm />
    </Suspense>
  );
}
