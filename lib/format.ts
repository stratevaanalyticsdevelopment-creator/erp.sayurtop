/* =====================================================================
   FORMAT & TANGGAL — port dari versi HTML.
   Seluruh tanggal diperlakukan sebagai string 'YYYY-MM-DD' (sesuai keluaran
   PostgREST) dan dihitung dari komponen waktu LOKAL, tidak lewat toISOString(),
   karena konversi UTC menggeser tanggal mundur satu hari di zona WIB.
   ===================================================================== */

export function pad(n: number | string, w: number): string {
  let s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}

export function rp(n: number | null | undefined, dec = 0): string {
  const v = Number(n) || 0;
  return 'Rp ' + v.toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function num(n: number | null | undefined, dec?: number): string {
  const v = Number(n) || 0;
  return v.toLocaleString('id-ID', {
    minimumFractionDigits: dec === undefined ? 0 : dec,
    maximumFractionDigits: dec === undefined ? 2 : dec,
  });
}

export function rpShort(n: number | null | undefined): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e12) return s + 'Rp ' + (a / 1e12).toFixed(2).replace('.', ',') + ' T';
  if (a >= 1e9) return s + 'Rp ' + (a / 1e9).toFixed(2).replace('.', ',') + ' M';
  if (a >= 1e6) return s + 'Rp ' + (a / 1e6).toFixed(1).replace('.', ',') + ' jt';
  if (a >= 1e3) return s + 'Rp ' + (a / 1e3).toFixed(0) + ' rb';
  return rp(v);
}

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const MONL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus',
  'September', 'Oktober', 'November', 'Desember'];

export function dISO(d: Date | string): string {
  const x = new Date(d);
  return x.getFullYear() + '-' + pad(x.getMonth() + 1, 2) + '-' + pad(x.getDate(), 2);
}
export function ymISO(d: Date | string): string {
  const x = new Date(d);
  return x.getFullYear() + '-' + pad(x.getMonth() + 1, 2);
}
export function today(): string {
  return dISO(new Date());
}
export function dAdd(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dISO(d);
}
export function dDiff(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000
  );
}
export function dFmt(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  return pad(d.getDate(), 2) + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
}
export function dFmtL(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  return d.getDate() + ' ' + MONL[d.getMonth()] + ' ' + d.getFullYear();
}
export function ymOf(iso: string): string {
  return iso.slice(0, 7);
}
export function ymLabel(ym: string): string {
  const p = ym.split('-');
  return MON[+p[1] - 1] + ' ' + p[0];
}
export function tsFmt(ts?: string | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return dISO(d) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
}

export function terbilang(n: number): string {
  const v = Math.floor(Math.abs(Number(n) || 0));
  const sat = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function f(x: number): string {
    if (x < 12) return sat[x];
    if (x < 20) return f(x - 10) + ' belas';
    if (x < 100) return f(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + f(x % 10) : '');
    if (x < 200) return 'seratus' + (x % 100 ? ' ' + f(x % 100) : '');
    if (x < 1000) return f(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + f(x % 100) : '');
    if (x < 2000) return 'seribu' + (x % 1000 ? ' ' + f(x % 1000) : '');
    if (x < 1e6) return f(Math.floor(x / 1000)) + ' ribu' + (x % 1000 ? ' ' + f(x % 1000) : '');
    if (x < 1e9) return f(Math.floor(x / 1e6)) + ' juta' + (x % 1e6 ? ' ' + f(x % 1e6) : '');
    return f(Math.floor(x / 1e9)) + ' miliar' + (x % 1e9 ? ' ' + f(x % 1e9) : '');
  }
  const s = v === 0 ? 'nol' : f(v);
  return s.replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) + ' Rupiah';
}
