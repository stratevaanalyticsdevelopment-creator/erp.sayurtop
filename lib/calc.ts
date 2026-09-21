/* =====================================================================
   PERHITUNGAN DOKUMEN — port dari versi HTML agar angka di layar identik.
   Catatan: nilai final setiap dokumen tetap dihitung ulang oleh fungsi
   database (create_sales_order, create_invoice_from_delivery, dst.);
   modul ini dipakai untuk tampilan dan validasi di sisi klien.
   ===================================================================== */
import type { DocLine, Product, Invoice, BelowCost } from './types';
import { dDiff, today } from './format';

export function lineNet(l: DocLine): number {
  const g = (Number(l.qty) || 0) * (Number(l.price) || 0);
  return g - (g * (Number(l.disc_pct) || 0)) / 100;
}
export function lineTax(l: DocLine): number {
  return (lineNet(l) * (Number(l.tax_pct) || 0)) / 100;
}
export function calcDoc(lines: DocLine[]) {
  let gross = 0, disc = 0, tax = 0;
  (lines || []).forEach((l) => {
    const g = (Number(l.qty) || 0) * (Number(l.price) || 0);
    gross += g;
    disc += (g * (Number(l.disc_pct) || 0)) / 100;
    tax += lineTax(l);
  });
  const sub = gross - disc;
  return {
    gross: Math.round(gross), disc: Math.round(disc), sub: Math.round(sub),
    tax: Math.round(tax), total: Math.round(sub + tax),
  };
}

export function invNet(iv: Invoice): number {
  return Math.round((Number(iv.total) || 0) - (Number(iv.return_total) || 0));
}
export function invOutstanding(iv: Invoice): number {
  if (iv.outstanding !== undefined && iv.outstanding !== null) return Math.round(Number(iv.outstanding));
  return Math.round(invNet(iv) - (Number(iv.paid) || 0));
}
export function invStatus(iv: Invoice): string {
  if (iv.calc_status) return iv.calc_status;
  if (iv.status === 'CANCELLED' || iv.status === 'DRAFT') return iv.status;
  const os = invOutstanding(iv);
  if (os <= 0) return 'PAID';
  if ((Number(iv.paid) || 0) > 0) return 'PARTIALLY PAID';
  if (dDiff(iv.due_date, today()) > 0) return 'OVERDUE';
  return 'OPEN';
}
export type AgingBucket = 'current' | 'b1' | 'b2' | 'b3' | 'b4';
export function agingBucket(iv: Invoice): AgingBucket {
  const d = dDiff(iv.due_date, today());
  if (d <= 0) return 'current';
  if (d <= 30) return 'b1';
  if (d <= 60) return 'b2';
  if (d <= 90) return 'b3';
  return 'b4';
}

/* ---------- KONTROL MARGIN: harga jual vs harga pokok ---------- */
export function lineUnitNet(l: DocLine): number {
  return (Number(l.price) || 0) * (1 - (Number(l.disc_pct) || 0) / 100);
}
export function lineBelowCost(l: DocLine, products: Map<string, Product>) {
  if (!l || !l.product_id) return null;
  const p = products.get(l.product_id);
  const base = p ? Number(p.base_price) || 0 : 0;
  if (!base) return null;
  const net = lineUnitNet(l);
  if (net >= base) return null;
  return { base, net, gap: base - net, pct: base ? ((base - net) / base) * 100 : 0 };
}
export function docBelowCost(lines: DocLine[], products: Map<string, Product>) {
  return (lines || [])
    .map((l, i) => {
      const w = lineBelowCost(l, products);
      return w ? { i, l, w } : null;
    })
    .filter(Boolean) as { i: number; l: DocLine; w: { base: number; net: number; gap: number; pct: number } }[];
}
export function docMargin(lines: DocLine[], products: Map<string, Product>) {
  let rev = 0, cost = 0;
  (lines || []).forEach((l) => {
    rev += lineNet(l);
    const p = products.get(l.product_id);
    cost += (p ? Number(p.base_price) || 0 : 0) * (Number(l.qty) || 0);
  });
  rev = Math.round(rev);
  cost = Math.round(cost);
  return { rev, cost, margin: rev - cost, pct: rev ? ((rev - cost) / rev) * 100 : 0 };
}
export function belowCostFromDb(v: BelowCost[] | null): BelowCost[] {
  return Array.isArray(v) ? v : [];
}
