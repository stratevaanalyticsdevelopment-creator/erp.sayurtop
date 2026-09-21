'use client';
/* Delivery Report — kinerja pengiriman per periode dan per pelanggan.
   On-time dihitung terhadap tanggal kirim yang dijanjikan pada Sales Order. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { ST } from '@/lib/menu';
import { dAdd, num, today } from '@/lib/format';

type Sj = { no: string; delivery_date: string; order_no: string; customer_code: string; qty_total: number; status: string };
type Row = { k: string; sj: number; qty: number };

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [from, setFrom] = useState(dAdd(today(), -30));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Sj[]>([]);
  const [promised, setPromised] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('delivery')
      .select('no,delivery_date,order_no,customer_code,qty_total,status')
      .gte('delivery_date', from).lte('delivery_date', to).order('delivery_date');
    const sj = (data as Sj[]) || [];
    setRows(sj);
    if (sj.length) {
      const { data: od } = await supabase.from('sales_order').select('no,delivery_date')
        .in('no', [...new Set(sj.map((x) => x.order_no))]);
      setPromised(new Map(((od as { no: string; delivery_date: string | null }[]) || [])
        .map((o) => [o.no, o.delivery_date])));
    } else setPromised(new Map());
    setLoading(false);
  }, [supabase, from, to]);
  useEffect(() => { load(); }, [load]);

  const byCust = new Map<string, Row>();
  rows.forEach((d) => {
    const r = byCust.get(d.customer_code) || { k: d.customer_code, sj: 0, qty: 0 };
    r.sj++; r.qty += Number(d.qty_total) || 0;
    byCust.set(d.customer_code, r);
  });
  const arr = [...byCust.values()].sort((a, b) => b.qty - a.qty);
  const onTime = rows.filter((d) => {
    const p = promised.get(d.order_no);
    return p ? d.delivery_date <= p : false;
  }).length;
  const totQty = rows.reduce((a, b) => a + (Number(b.qty_total) || 0), 0);
  const inTransit = rows.filter((d) => d.status === ST.IN_TRANSIT).length;

  return (
    <>
      <PageHead title="Delivery Report" desc="Kinerja pengiriman per periode dan per pelanggan." />
      <div className="fbar">
        <label className="sm mut">Periode</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {loading ? <span className="sm mut">Memuat…</span> : null}
      </div>

      <KpiGrid>
        <Kpi cls="k-blue" lb="Total Surat Jalan" vl={num(rows.length, 0)} sb={`${from} — ${to}`} />
        <Kpi cls="k-acc" lb="Total Qty Dikirim" vl={num(totQty, 0) + ' unit'} />
        <Kpi cls="k-green" lb="On-Time Delivery"
          vl={(rows.length ? num((onTime / rows.length) * 100, 1) : '0') + '%'}
          sb={`${onTime} dari ${rows.length} SJ`} />
        <Kpi cls="k-amber" lb="Belum Dikonfirmasi" vl={num(inTransit, 0) + ' SJ'} />
      </KpiGrid>

      <Card>
        <CardHead title="Pengiriman per Customer" />
        <CardBody flush>
          <DataTable<Row> rows={arr} rowKey={(r) => r.k}
            emptyT="Tidak ada pengiriman pada periode ini"
            emptyD="Ubah rentang tanggal untuk melihat data lain."
            foot={<tr><td colSpan={2}>TOTAL</td><td className="num">{num(rows.length, 0)}</td>
              <td className="num">{num(totQty, 0)}</td></tr>}
            cols={[
              { t: 'Customer', f: (r) => s.cust(r.k).name },
              { t: 'Tipe', f: (r) => <span className="sm mut">{s.cust(r.k).type || '-'}</span> },
              { t: 'Jumlah SJ', cls: 'num', f: (r) => num(r.sj, 0) },
              { t: 'Total Qty', cls: 'num', f: (r) => num(r.qty, 0) },
            ]} />
        </CardBody>
      </Card>
    </>
  );
}
