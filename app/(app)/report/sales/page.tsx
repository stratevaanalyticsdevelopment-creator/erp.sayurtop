'use client';
/* Sales Report — penjualan bersih (setelah retur) dan margin kotor per
   dimensi. HPP memakai base_price pada master produk, sama dengan versi HTML. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead, Seg } from '@/components/ui';
import { LineChart } from '@/components/charts';
import { dAdd, num, rp, rpShort, today } from '@/lib/format';

type Dim = 'cust' | 'sales' | 'cat' | 'prod';
type Inv = { no: string; invoice_date: string; customer_code: string; salesperson_code: string | null; sub: number; return_total: number };
type Line = { invoice_no: string; product_id: string; name: string; qty: number; ret_qty: number | null; price: number; disc_pct: number };
type Agg = { k: string; l: string; qty: number; val: number; cogs: number; n: number; margin: number; mpc: number };

const DIM_LABEL: Record<Dim, string> = { cust: 'Customer', sales: 'Sales Person', cat: 'Kategori', prod: 'Produk' };
const COL_LABEL: Record<Dim, string> = { cust: 'Customer', sales: 'Sales', cat: 'Kategori', prod: 'Produk' };

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [from, setFrom] = useState(dAdd(today(), -90));
  const [to, setTo] = useState(today());
  const [dim, setDim] = useState<Dim>('cust');
  const [inv, setInv] = useState<Inv[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('invoice')
      .select('no,invoice_date,customer_code,salesperson_code,sub,return_total')
      .neq('status', 'CANCELLED').gte('invoice_date', from).lte('invoice_date', to)
      .order('invoice_date');
    const ivs = (data as Inv[]) || [];
    setInv(ivs);
    if (ivs.length) {
      const { data: ld } = await supabase.from('invoice_line')
        .select('invoice_no,product_id,name,qty,ret_qty,price,disc_pct')
        .in('invoice_no', ivs.map((x) => x.no));
      setLines((ld as Line[]) || []);
    } else setLines([]);
    setLoading(false);
  }, [supabase, from, to]);
  useEffect(() => { load(); }, [load]);

  const d = useMemo(() => {
    const ivMap = new Map(inv.map((i) => [i.no, i]));
    const totSub = inv.reduce((a, b) => a + Number(b.sub), 0);
    const totRet = inv.reduce((a, b) => a + Number(b.return_total || 0), 0);
    let cogs = 0;
    const agg = new Map<string, Agg>();

    lines.forEach((l) => {
      const iv = ivMap.get(l.invoice_no);
      if (!iv) return;
      const qty = (Number(l.qty) || 0) - (Number(l.ret_qty) || 0);
      const p = s.prod(l.product_id);
      const base = p ? Number(p.base_price) || 0 : Number(l.price) * 0.85;
      cogs += base * qty;

      const g = qty * Number(l.price);
      const net = g - (g * (Number(l.disc_pct) || 0)) / 100;
      const key = dim === 'cust' ? iv.customer_code
        : dim === 'sales' ? (iv.salesperson_code || '-')
          : dim === 'cat' ? (p ? p.category : '-') : l.product_id;
      const label = dim === 'cust' ? s.cust(iv.customer_code).name
        : dim === 'sales' ? s.sp(iv.salesperson_code).name
          : dim === 'cat' ? (p ? p.category_name : '-') : (p ? p.name : l.name);
      const a = agg.get(key) || { k: key, l: label, qty: 0, val: 0, cogs: 0, n: 0, margin: 0, mpc: 0 };
      a.qty += qty; a.val += net; a.cogs += base * qty; a.n++;
      agg.set(key, a);
    });

    const arr = [...agg.values()].map((a) => ({
      ...a, margin: a.val - a.cogs, mpc: a.val ? ((a.val - a.cogs) / a.val) * 100 : 0,
    })).sort((a, b) => b.val - a.val);

    const byDay = new Map<string, number>();
    inv.forEach((i) => byDay.set(i.invoice_date, (byDay.get(i.invoice_date) || 0) + Number(i.sub)));
    const days = [...byDay.keys()].sort().map((k) => ({ l: k.slice(8) + '/' + k.slice(5, 7), v: byDay.get(k) || 0 }));

    const tQty = arr.reduce((a, r) => a + r.qty, 0);
    const tVal = arr.reduce((a, r) => a + r.val, 0);
    const tCogs = arr.reduce((a, r) => a + r.cogs, 0);
    return { totSub, totRet, cogs, arr, days, tQty, tVal, tCogs, tMargin: tVal - tCogs };
  }, [inv, lines, dim, s]);

  return (
    <>
      <PageHead title="Sales Report"
        desc="Analisis penjualan bersih (setelah retur) beserta margin kotor per dimensi. HPP menggunakan Base Price pada master produk." />
      <div className="fbar">
        <label className="sm mut">Periode</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Seg<Dim> value={dim} onChange={setDim} options={[
          { v: 'cust', t: 'Customer' }, { v: 'sales', t: 'Sales' },
          { v: 'cat', t: 'Kategori' }, { v: 'prod', t: 'Produk' },
        ]} />
        {loading ? <span className="sm mut">Memuat…</span> : null}
      </div>

      <KpiGrid>
        <Kpi cls="k-blue" lb="Penjualan Kotor" vl={rpShort(d.totSub)} sb={`${num(inv.length, 0)} invoice`} />
        <Kpi cls="k-acc" lb="Retur" vl={rpShort(d.totRet)}
          sb={d.totSub ? num((d.totRet / d.totSub) * 100, 2) + '% dari penjualan' : '-'} />
        <Kpi cls="k-amber" lb="HPP" vl={rpShort(d.cogs)} sb="Berdasarkan base price" />
        <Kpi cls="k-green" lb="Margin Kotor" vl={rpShort(d.totSub - d.cogs)}
          sb={d.totSub ? num(((d.totSub - d.cogs) / d.totSub) * 100, 1) + '%' : '-'} />
      </KpiGrid>

      {d.days.length > 1 ? (
        <Card className="mb12">
          <CardHead title="Penjualan Harian" />
          <CardBody><LineChart data={d.days.slice(-30)} /></CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHead title={'Penjualan per ' + DIM_LABEL[dim]} />
        <CardBody flush>
          <DataTable<Agg> rows={d.arr} rowKey={(r) => r.k}
            emptyT="Tidak ada penjualan pada periode ini"
            emptyD="Ubah rentang tanggal untuk melihat data lain."
            foot={<tr><td>TOTAL</td><td className="num">{num(d.tQty, 0)}</td>
              <td className="num">{rp(d.tVal)}</td><td className="num">{rp(d.tCogs)}</td>
              <td className="num">{rp(d.tMargin)}</td><td colSpan={2} /></tr>}
            cols={[
              { t: COL_LABEL[dim], f: (r) => r.l },
              { t: 'Qty Net', cls: 'num', f: (r) => num(r.qty, 0) },
              { t: 'Penjualan', cls: 'num', f: (r) => rp(r.val) },
              { t: 'HPP', cls: 'num', f: (r) => rp(r.cogs) },
              { t: 'Margin', cls: 'num', f: (r) => (r.margin < 0
                ? <b style={{ color: 'var(--red)' }}>{rp(r.margin)}</b> : rp(r.margin)) },
              { t: 'Margin %', cls: 'num', f: (r) => num(r.mpc, 1) + '%' },
              { t: 'Kontribusi', cls: 'num', f: (r) => (d.tVal ? num((r.val / d.tVal) * 100, 1) + '%' : '-') },
            ]} />
        </CardBody>
      </Card>
    </>
  );
}
