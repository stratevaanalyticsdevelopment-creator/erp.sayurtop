'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { agingBucket, invOutstanding } from '@/lib/calc';
import { num, rp, rpShort } from '@/lib/format';
import type { Invoice } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';

type Row = { k: string; current: number; b1: number; b2: number; b3: number; b4: number; tot: number; n: number };

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Invoice[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('invoice_view').select('*').gt('outstanding', 0);
      setRows((data as Invoice[]) || []);
    })();
  }, [supabase]);

  const byC = new Map<string, Row>();
  rows.forEach((i) => {
    const c = byC.get(i.customer_code) || { k: i.customer_code, current: 0, b1: 0, b2: 0, b3: 0, b4: 0, tot: 0, n: 0 };
    const v = invOutstanding(i);
    c[agingBucket(i)] += v; c.tot += v; c.n++;
    byC.set(i.customer_code, c);
  });
  const arr = [...byC.values()].sort((a, b) => b.tot - a.tot);
  const T = arr.reduce((acc, r) => ({
    current: acc.current + r.current, b1: acc.b1 + r.b1, b2: acc.b2 + r.b2,
    b3: acc.b3 + r.b3, b4: acc.b4 + r.b4, tot: acc.tot + r.tot,
  }), { current: 0, b1: 0, b2: 0, b3: 0, b4: 0, tot: 0 });
  const pc = (v: number) => (T.tot ? num((v / T.tot) * 100, 1) + '%' : '-');

  function exportCsv() {
    downloadCsv('aging',
      ['Customer', 'Jumlah Invoice', 'Current', '1-30', '31-60', '61-90', '>90', 'Total'],
      arr.map((r) => [s.cust(r.k).name, r.n, r.current, r.b1, r.b2, r.b3, r.b4, r.tot]));
  }

  return (
    <>
      <PageHead title="AR Aging"
        desc="Umur piutang dihitung dari tanggal jatuh tempo masing-masing invoice. Kolom Current berarti belum jatuh tempo."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />
      <KpiGrid>
        <Kpi cls="k-green" lb="Current" vl={rpShort(T.current)} sb={pc(T.current) + ' dari total'} />
        <Kpi cls="k-blue" lb="1–30 Hari" vl={rpShort(T.b1)} sb={pc(T.b1)} />
        <Kpi cls="k-amber" lb="31–60 Hari" vl={rpShort(T.b2)} sb={pc(T.b2)} />
        <Kpi cls="k-acc" lb="61–90 Hari" vl={rpShort(T.b3)} sb={pc(T.b3)} />
        <Kpi cls="k-red" lb="> 90 Hari" vl={rpShort(T.b4)} sb={pc(T.b4)} />
      </KpiGrid>
      <Card className="mb12">
        <CardHead title="Distribusi Umur Piutang" right={<div className="sm mut">Total {rp(T.tot)}</div>} />
        <CardBody>
          <BarChart h={210} data={[
            { l: 'Current', v: T.current, c: '#1E7A45' }, { l: '1–30', v: T.b1, c: '#0046B0' },
            { l: '31–60', v: T.b2, c: '#B8770B' }, { l: '61–90', v: T.b3, c: '#FF5E00' },
            { l: '>90', v: T.b4, c: '#C0392B' },
          ]} />
        </CardBody>
      </Card>
      <Card>
        <CardHead title="Aging per Customer" />
        <CardBody flush>
          <DataTable<Row> rows={arr} rowKey={(r) => r.k}
            foot={<tr><td colSpan={2}>TOTAL</td><td className="num">{rp(T.current)}</td>
              <td className="num">{rp(T.b1)}</td><td className="num">{rp(T.b2)}</td>
              <td className="num">{rp(T.b3)}</td><td className="num">{rp(T.b4)}</td>
              <td className="num">{rp(T.tot)}</td></tr>}
            cols={[
              { t: 'Customer', f: (r) => s.cust(r.k).name },
              { t: 'Inv', cls: 'ctr', f: (r) => r.n },
              { t: 'Current', cls: 'num', f: (r) => r.current ? rp(r.current) : <span className="mut">—</span> },
              { t: '1–30', cls: 'num', f: (r) => r.b1 ? rp(r.b1) : <span className="mut">—</span> },
              { t: '31–60', cls: 'num', f: (r) => r.b2 ? rp(r.b2) : <span className="mut">—</span> },
              { t: '61–90', cls: 'num', f: (r) => r.b3 ? rp(r.b3) : <span className="mut">—</span> },
              { t: '>90', cls: 'num', f: (r) => r.b4 ? <b style={{ color: 'var(--red)' }}>{rp(r.b4)}</b> : <span className="mut">—</span> },
              { t: 'Total', cls: 'num', f: (r) => <b>{rp(r.tot)}</b> },
            ]} />
        </CardBody>
      </Card>
    </>
  );
}
