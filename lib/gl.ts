/* =====================================================================
   BUKU BESAR & LAPORAN KEUANGAN
   Logika perhitungan sama persis dengan versi HTML, termasuk penanganan
   akun kontra pada neraca (Akumulasi Penyusutan, Cadangan Kerugian
   Piutang tampil sebagai pengurang aset).
   ===================================================================== */
import type { Coa } from './types';

export type GlRow = {
  date: string; jno: string; ref: string | null; refType: string; memo: string | null;
  acc: string; desc: string | null; d: number; c: number;
};

export type TbRow = {
  code: string; name: string; type: string; group: string; normal: string;
  d: number; c: number; bal: number; raw: number;
};

export function trialBalance(lines: GlRow[], coa: Coa[]): TbRow[] {
  const m = new Map<string, { d: number; c: number }>();
  lines.forEach((l) => {
    const cur = m.get(l.acc) || { d: 0, c: 0 };
    cur.d += Number(l.d); cur.c += Number(l.c);
    m.set(l.acc, cur);
  });
  return coa.map((a) => {
    const x = m.get(a.code) || { d: 0, c: 0 };
    const raw = x.d - x.c;
    return {
      code: a.code, name: a.name, type: a.type, group: a.group_name, normal: a.normal,
      d: x.d, c: x.c, raw, bal: a.normal === 'D' ? raw : -raw,
    };
  }).filter((r) => r.d || r.c);
}

export function plData(tb: TbRow[]) {
  const get = (code: string) => tb.find((x) => x.code === code)?.bal || 0;
  const sales = get('4100'), ret = get('4200'), disc = get('4300');
  const netSales = sales - ret - disc;
  const cogs = get('5100');
  const gross = netSales - cogs;
  const exp = tb.filter((r) => r.type === 'EXPENSE');
  const totExp = exp.reduce((a, b) => a + b.bal, 0);
  return { sales, ret, disc, netSales, cogs, gross, exp, totExp,
    opProfit: gross - totExp, gm: netSales ? (gross / netSales) * 100 : 0 };
}

export function bsData(tb: TbRow[]) {
  /* Arah saldo ditentukan oleh KELOMPOK akun, bukan saldo normal masing-masing
     akun, agar akun kontra menjadi pengurang pada sisinya. */
  const sign = (r: TbRow) => (r.type === 'ASSET' ? r.raw : -r.raw);
  const pick = (t: string) => tb.filter((r) => r.type === t)
    .map((r) => ({ code: r.code, name: r.name, bal: sign(r) }));
  const assets = pick('ASSET'), liab = pick('LIAB'), eq = pick('EQUITY');
  const pl = plData(tb);
  const totA = assets.reduce((a, b) => a + b.bal, 0);
  const totL = liab.reduce((a, b) => a + b.bal, 0);
  const totE = eq.reduce((a, b) => a + b.bal, 0) + pl.opProfit;
  return { assets, liab, eq, totA, totL, totE, profit: pl.opProfit, diff: totA - (totL + totE) };
}

export type CfRow = { acc: string; name: string; amt: number };

export function cashFlowData(lines: GlRow[], accName: (c: string) => string, openBal: number) {
  const CASH = ['1110'];
  const byJournal = new Map<string, GlRow[]>();
  lines.forEach((l) => byJournal.set(l.jno, [...(byJournal.get(l.jno) || []), l]));

  const ops: CfRow[] = [], inv: CfRow[] = [], fin: CfRow[] = [];
  byJournal.forEach((js) => {
    const cashLines = js.filter((l) => CASH.includes(l.acc));
    if (!cashLines.length) return;
    const flow = cashLines.reduce((a, l) => a + Number(l.d) - Number(l.c), 0);
    if (!flow) return;
    const other = js.filter((l) => !CASH.includes(l.acc));
    const key = other.length ? other[0].acc : '9999';
    const cat = key.startsWith('15') ? 'inv' : key.startsWith('3') ? 'fin' : 'ops';
    const bucket = cat === 'inv' ? inv : cat === 'fin' ? fin : ops;
    bucket.push({ acc: key, name: accName(key), amt: flow });
  });
  const agg = (arr: CfRow[]) => {
    const m = new Map<string, CfRow>();
    arr.forEach((r) => {
      const cur = m.get(r.acc) || { acc: r.acc, name: r.name, amt: 0 };
      cur.amt += r.amt; m.set(r.acc, cur);
    });
    return [...m.values()].sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
  };
  const o = agg(ops), i = agg(inv), f = agg(fin);
  const sum = (a: CfRow[]) => a.reduce((x, y) => x + y.amt, 0);
  return { ops: o, inv: i, fin: f, totOps: sum(o), totInv: sum(i), totFin: sum(f),
    open: openBal, close: openBal + sum(o) + sum(i) + sum(f) };
}
