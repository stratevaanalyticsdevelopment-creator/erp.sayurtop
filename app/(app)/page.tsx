'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead, Badge } from '@/components/ui';
import { BarChart, LineChart } from '@/components/charts';
import { dDiff, dFmt, dFmtL, MON, num, rp, rpShort, today, ymLabel, ymOf, ymISO } from '@/lib/format';
import { agingBucket, invOutstanding } from '@/lib/calc';
import type { Invoice } from '@/lib/types';

type SoRow = { no: string; status: string; total: number; order_date: string; customer_code: string };
type SjRow = { no: string; delivery_date: string; customer_code: string; status: string };
type LineRow = { invoice_no: string; product_id: string; name: string; qty: number; price: number; disc_pct: number; ret_qty: number };

export default function DashboardPage() {
  const s = useStore();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [inv, setInv] = useState<Invoice[]>([]);
  const [so, setSo] = useState<SoRow[]>([]);
  const [sj, setSj] = useState<SjRow[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [payToday, setPayToday] = useState<{ n: number; v: number }>({ n: 0, v: 0 });
  const [cnMonth, setCnMonth] = useState<{ n: number; v: number }>({ n: 0, v: 0 });
  const [loading, setLoading] = useState(true);

  const T = today();
  const ym = ymOf(T);

  useEffect(() => {
    (async () => {
      const from6 = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5); return ymISO(d) + '-01'; })();
      const [iv, o, d, pay, cn] = await Promise.all([
        supabase.from('invoice_view').select('*').neq('status', 'CANCELLED').gte('invoice_date', from6),
        supabase.from('sales_order').select('no,status,total,order_date,customer_code'),
        supabase.from('delivery').select('no,delivery_date,customer_code,status').order('delivery_date', { ascending: false }).limit(60),
        supabase.from('payment').select('no,amount').eq('pay_date', T),
        supabase.from('credit_note').select('no,total').gte('cn_date', ym + '-01'),
      ]);
      const ivs = (iv.data as Invoice[]) || [];
      setInv(ivs);
      setSo((o.data as SoRow[]) || []);
      setSj((d.data as SjRow[]) || []);
      const monthIv = ivs.filter((x) => ymOf(x.invoice_date) === ym).map((x) => x.no);
      if (monthIv.length) {
        const { data: ld } = await supabase.from('invoice_line')
          .select('invoice_no,product_id,name,qty,price,disc_pct,ret_qty').in('invoice_no', monthIv);
        setLines((ld as LineRow[]) || []);
      }
      const p = (pay.data as { amount: number }[]) || [];
      setPayToday({ n: p.length, v: p.reduce((a, b) => a + Number(b.amount), 0) });
      const c = (cn.data as { total: number }[]) || [];
      setCnMonth({ n: c.length, v: c.reduce((a, b) => a + Number(b.total), 0) });
      setLoading(false);
    })();
  }, [supabase, T, ym]);

  const d = useMemo(() => {
    const invM = inv.filter((i) => ymOf(i.invoice_date) === ym);
    const salesM = invM.reduce((a, b) => a + Number(b.sub), 0);
    const dayNo = +T.slice(8, 10);
    const pd = new Date(T + 'T00:00:00'); pd.setDate(1); pd.setMonth(pd.getMonth() - 1);
    const prevYm = ymISO(pd);
    const salesP = inv.filter((i) => ymOf(i.invoice_date) === prevYm && +i.invoice_date.slice(8, 10) <= dayNo)
      .reduce((a, b) => a + Number(b.sub), 0);
    const growth = salesP ? ((salesM - salesP) / salesP) * 100 : 0;

    const openOrders = so.filter((o) => ['APPROVED', 'PROCESSING', 'PARTIALLY DELIVERED'].includes(o.status));
    const pending = so.filter((o) => o.status === 'SUBMITTED');
    const todaySJ = sj.filter((x) => x.delivery_date === T);
    const inTransit = sj.filter((x) => x.status === 'IN TRANSIT');
    const arOpen = inv.filter((i) => invOutstanding(i) > 0);
    const arTotal = arOpen.reduce((a, b) => a + invOutstanding(b), 0);
    const overdue = arOpen.filter((i) => dDiff(i.due_date, T) > 0);
    const overdueTot = overdue.reduce((a, b) => a + invOutstanding(b), 0);
    const dueToday = arOpen.filter((i) => i.due_date === T);

    const months: { l: string; v: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - i);
      const m = ymISO(x);
      months.push({ l: MON[x.getMonth()], v: inv.filter((z) => ymOf(z.invoice_date) === m).reduce((a, b) => a + Number(b.sub), 0) });
    }
    const ag = { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 };
    arOpen.forEach((i) => { ag[agingBucket(i)] += invOutstanding(i); });

    const byCust = new Map<string, number>();
    invM.forEach((i) => byCust.set(i.customer_code, (byCust.get(i.customer_code) || 0) + Number(i.sub)));
    const topC = [...byCust.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 6);

    const byProd = new Map<string, { name: string; v: number }>();
    lines.forEach((l) => {
      const g = (Number(l.qty) - Number(l.ret_qty || 0)) * Number(l.price);
      const v = g - (g * Number(l.disc_pct || 0)) / 100;
      const cur = byProd.get(l.product_id) || { name: l.name, v: 0 };
      cur.v += v; byProd.set(l.product_id, cur);
    });
    const topP = [...byProd.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.v - a.v).slice(0, 8);

    return { salesM, growth, prevYm, dayNo, openOrders, pending, todaySJ, inTransit,
      arTotal, arOpen, overdue, overdueTot, dueToday, months, ag, topC, topP };
  }, [inv, so, sj, lines, T, ym]);

  const lowStock = s.products.filter((p) => Number(p.stock) <= Number(p.min_stock));
  const overLimit = s.customers.filter((c) => {
    const os = d.arOpen.filter((i) => i.customer_code === c.code).reduce((a, b) => a + invOutstanding(b), 0);
    return Number(c.credit_limit) > 0 && os > Number(c.credit_limit);
  });
  const belowCostOrders = so.filter((o) => ['DRAFT', 'SUBMITTED', 'APPROVED', 'PROCESSING', 'PARTIALLY DELIVERED'].includes(o.status));

  const acts: { c: string; t: React.ReactNode; href: string }[] = [];
  if (d.pending.length) acts.push({ c: 'var(--red)', t: <><b>{d.pending.length} Sales Order</b> menunggu approval Sales Manager</>, href: '/sales/approval' });
  if (d.dueToday.length) acts.push({ c: 'var(--red)', t: <><b>{d.dueToday.length} Invoice</b> jatuh tempo hari ini — {rp(d.dueToday.reduce((a, b) => a + invOutstanding(b), 0))}</>, href: '/ar/collection' });
  if (d.overdue.length) acts.push({ c: 'var(--red)', t: <><b>{d.overdue.length} Invoice</b> sudah lewat jatuh tempo — {rpShort(d.overdueTot)}</>, href: '/ar/aging' });
  if (d.inTransit.length) acts.push({ c: 'var(--acc)', t: <><b>{d.inTransit.length} Surat Jalan</b> belum dikonfirmasi penerimaan customer</>, href: '/logistics/delivery' });
  if (overLimit.length) acts.push({ c: 'var(--acc)', t: <><b>{overLimit.length} Customer</b> melewati credit limit</>, href: '/ar/outstanding' });
  if (lowStock.length) acts.push({ c: 'var(--amber)', t: <><b>{lowStock.length} Produk</b> berada di bawah stok minimum</>, href: '/master/product' });
  if (!acts.length) acts.push({ c: 'var(--green)', t: 'Tidak ada item yang memerlukan tindakan segera.', href: '/' });

  if (loading) return <div className="mut" style={{ padding: 20 }}>Memuat dashboard…</div>;

  return (
    <>
      <PageHead title="Dashboard Order-to-Cash"
        desc={`Ringkasan operasional dan keuangan Sayur Top per ${dFmtL(T)}. Angka penjualan menggunakan nilai invoice sebelum PPN.`} />

      <KpiGrid>
        <Kpi cls="k-blue" lb={`Penjualan ${ymLabel(ym)} (s/d tgl ${d.dayNo})`} vl={rp(d.salesM)}
          sb={<>{d.growth >= 0 ? <span className="up">▲ {num(Math.abs(d.growth), 1)}%</span>
            : <span className="dn">▼ {num(Math.abs(d.growth), 1)}%</span>} vs periode sama {ymLabel(d.prevYm)}</>} />
        <Kpi cls="k-acc" lb="Order Outstanding" vl={`${d.openOrders.length} order`}
          sb={`${rp(d.openOrders.reduce((a, b) => a + Number(b.total), 0))} nilai kontrak`} />
        <Kpi cls={d.pending.length ? 'k-red' : 'k-green'} lb="Menunggu Approval" vl={`${d.pending.length} order`}
          sb={rp(d.pending.reduce((a, b) => a + Number(b.total), 0))} />
        <Kpi cls="k-blue" lb="Pengiriman Hari Ini" vl={`${d.todaySJ.length} surat jalan`}
          sb={`${d.inTransit.length} masih in transit`} />
        <Kpi cls="k-amber" lb="AR Outstanding" vl={rpShort(d.arTotal)}
          sb={`${d.arOpen.length} invoice belum lunas`} />
        <Kpi cls={d.overdueTot ? 'k-red' : 'k-green'} lb="Piutang Jatuh Tempo" vl={rpShort(d.overdueTot)}
          sb={`${d.overdue.length} invoice overdue`} />
        <Kpi cls="k-green" lb="Pembayaran Hari Ini" vl={rp(payToday.v)} sb={`${payToday.n} transaksi`} />
        <Kpi cls={cnMonth.v ? 'k-amber' : 'k-green'} lb={`Retur ${ymLabel(ym)}`} vl={rp(cnMonth.v)}
          sb={`${cnMonth.n} credit note`} />
      </KpiGrid>

      <div className="grid-2-1">
        <Card>
          <CardHead title="Tren Penjualan 6 Bulan" right={<div className="sm mut">Nilai invoice sebelum PPN</div>} />
          <CardBody><LineChart data={d.months} /></CardBody>
        </Card>
        <Card>
          <CardHead title="Action Required" />
          <CardBody flush>
            <div className="act-list">
              {acts.map((a, i) => (
                <div key={i} className="act" onClick={() => router.push(a.href)}>
                  <span className="dot" style={{ background: a.c }} />
                  <span className="tx">{a.t}</span>
                  <span className="go">›</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid-2 mt14">
        <Card>
          <CardHead title="AR Aging" right={<div className="sm mut">Total {rp(d.arTotal)}</div>} />
          <CardBody>
            <BarChart h={200} data={[
              { l: 'Current', v: d.ag.current, c: '#1E7A45' },
              { l: '1–30', v: d.ag.b1, c: '#0046B0' },
              { l: '31–60', v: d.ag.b2, c: '#B8770B' },
              { l: '61–90', v: d.ag.b3, c: '#FF5E00' },
              { l: '>90', v: d.ag.b4, c: '#C0392B' },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHead title={`Top Customer ${ymLabel(ym)}`} />
          <CardBody flush>
            <DataTable rows={d.topC} emptyT="Belum ada penjualan bulan ini" cols={[
              { t: 'Customer', f: (r) => s.cust(r.k).name },
              { t: 'Tipe', f: (r) => <span className="sm mut">{s.cust(r.k).type || '-'}</span> },
              { t: 'Nilai', cls: 'num', f: (r) => rp(r.v) },
            ]} />
          </CardBody>
        </Card>
      </div>

      <div className="grid-2 mt14">
        <Card>
          <CardHead title={`Produk Terlaris ${ymLabel(ym)}`} />
          <CardBody flush>
            <DataTable rows={d.topP} emptyT="Belum ada data" cols={[
              { t: 'SKU', f: (r) => <span className="doc-no">{r.k}</span> },
              { t: 'Produk', f: (r) => r.name },
              { t: 'Kategori', f: (r) => <span className="sm mut">{s.prod(r.k)?.category_name || '-'}</span> },
              { t: 'Nilai', cls: 'num', f: (r) => rp(r.v) },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Surat Jalan Terakhir"
            right={<button className="btn sm" onClick={() => router.push('/logistics/surat-jalan')}>Lihat Semua</button>} />
          <CardBody flush>
            <DataTable rows={sj.slice(0, 7)} cols={[
              { t: 'No. SJ', f: (r) => <span className="doc-no">{r.no}</span> },
              { t: 'Tanggal', f: (r) => dFmt(r.delivery_date) },
              { t: 'Customer', f: (r) => s.cust(r.customer_code).name },
              { t: 'Status', f: (r) => <Badge st={r.status} /> },
            ]} />
          </CardBody>
        </Card>
      </div>

      {belowCostOrders.length ? null : null}
    </>
  );
}
