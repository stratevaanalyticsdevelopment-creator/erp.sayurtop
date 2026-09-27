'use client';
/* =====================================================================
   FILTER YANG DIPAKAI ULANG DI SEMUA MODUL
   Rentang tanggal dengan pintasan periode, agar Sales Order, Surat Jalan,
   Invoice, PO, dan laporan memakai perilaku yang sama persis.
   ===================================================================== */
import { useMemo } from 'react';
import { dAdd, dISO, today, ymISO } from '@/lib/format';

export type Range = { from: string; to: string };

/** Awal bulan berjalan, dihitung dari komponen tanggal lokal (bukan UTC). */
function monthStart(iso: string) { return ymISO(iso) + '-01'; }

export const PRESETS: { v: string; t: string; calc: () => Range }[] = [
  { v: 'today', t: 'Hari Ini', calc: () => ({ from: today(), to: today() }) },
  { v: 'week', t: '7 Hari', calc: () => ({ from: dAdd(today(), -6), to: today() }) },
  { v: 'month', t: 'Bulan Ini', calc: () => ({ from: monthStart(today()), to: today() }) },
  { v: 'd30', t: '30 Hari', calc: () => ({ from: dAdd(today(), -29), to: today() }) },
  { v: 'd90', t: '90 Hari', calc: () => ({ from: dAdd(today(), -89), to: today() }) },
  {
    v: 'year',
    t: 'Tahun Ini',
    calc: () => ({ from: dISO(new Date(new Date().getFullYear(), 0, 1)), to: today() }),
  },
];

export function defaultRange(preset = 'd30'): Range {
  return (PRESETS.find((p) => p.v === preset) || PRESETS[3]).calc();
}

/** Rentang tanggal + pintasan periode. Nilai kosong berarti "semua tanggal". */
export function DateRange({ value, onChange, label = 'Periode', allowAll = true }: {
  value: Range; onChange: (r: Range) => void; label?: string; allowAll?: boolean;
}) {
  const active = useMemo(
    () => PRESETS.find((p) => { const r = p.calc(); return r.from === value.from && r.to === value.to; })?.v,
    [value]
  );
  return (
    <>
      <label className="sm mut">{label}</label>
      <input type="date" value={value.from} max={value.to || undefined}
        onChange={(e) => onChange({ ...value, from: e.target.value })} />
      <span className="sm mut">s/d</span>
      <input type="date" value={value.to} min={value.from || undefined}
        onChange={(e) => onChange({ ...value, to: e.target.value })} />
      <div className="seg">
        {PRESETS.map((p) => (
          <button key={p.v} className={active === p.v ? 'on' : undefined}
            onClick={() => onChange(p.calc())}>{p.t}</button>
        ))}
        {allowAll ? (
          <button className={!value.from && !value.to ? 'on' : undefined}
            onClick={() => onChange({ from: '', to: '' })}>Semua</button>
        ) : null}
      </div>
    </>
  );
}

/** Menerapkan rentang pada sebuah kolom tanggal; rentang kosong meloloskan semua baris. */
export function inRange(d: string | null | undefined, r: Range) {
  if (!d) return !r.from && !r.to;
  if (r.from && d < r.from) return false;
  if (r.to && d > r.to) return false;
  return true;
}

/** Menerapkan rentang pada kueri Supabase. */
export function applyRange<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
  q: T, col: string, r: Range
): T {
  let out = q;
  if (r.from) out = out.gte(col, r.from);
  if (r.to) out = out.lte(col, r.to);
  return out;
}
