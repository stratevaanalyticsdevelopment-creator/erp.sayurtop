'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { dFmt, num, rp, rpShort, ymOf, ymLabel, today } from '@/lib/format';
import type { SalesReturn } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';

export default function Page() {
  const s = useStore();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SalesReturn[]>([]);
  const [reasons, setReasons] = useState<{ k: string; v: number }[]>([]);
  const [salesTot, setSalesTot] = useState(0);

  useEffect(() => {
    (async () => {
      const [r, rl, iv] = await Promise.all([
        supabase.from('sales_return').select('*').order('return_date', { ascending: false }),
        supabase.from('sales_return_line').select('reason,qty,price,disc_pct'),
        supabase.from('invoice').select('sub').neq('status', 'CANCELLED'),
      ]);
      setRows((r.data as SalesReturn[]) || []);
      const m = new Map<string, number>();
      ((rl.data as { reason: string; qty: number; price: number; disc_pct: number }[]) || []).forEach((l) => {
        const v = Number(l.qty) * Number(l.price) * (1 - Number(l.disc_pct || 0) / 100);
        m.set(l.reason || '-', (m.get(l.reason || '-') || 0) + v);
      });
      setReasons([...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v));
      setSalesTot(((iv.data as { sub: number }[]) || []).reduce((a, b) => a + Number(b.sub), 0));
    })();
  }, [supabase]);

  const tot = rows.reduce((a, b) => a + Number(b.total), 0);
  const ym = ymOf(today());
  const month = rows.filter((r) => ymOf(r.return_date) === ym).reduce((a, b) => a + Number(b.total), 0);
  const subTot = rows.reduce((a, b) => a + Number(b.sub), 0);

  function exportCsv() {
    downloadCsv('returns',
      ['No Retur', 'Tanggal', 'Invoice', 'Customer', 'Alasan', 'DPP', 'PPN', 'Total', 'Credit Note'],
      rows.map((r) => [r.no, r.return_date, r.invoice_no, s.cust(r.customer_code).name,
        r.reason || '', Number(r.sub), Number(r.tax), Number(r.total), r.cn_no || '']));
  }

  return (
    <>
      <PageHead title="Sales Return"
        desc="Seluruh pengembalian barang dari pelanggan. Retur dibuat dari detail Invoice sehingga nilai, pajak, stok, dan jurnal terkoreksi bersamaan."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />
      <KpiGrid>
        <Kpi cls="k-acc" lb="Total Retur" vl={rpShort(tot)} sb={`${num(rows.length, 0)} dokumen`} />
        <Kpi cls="k-amber" lb="Retur Bulan Ini" vl={rpShort(month)} sb={ymLabel(ym)} />
        <Kpi cls="k-blue" lb="Rasio Retur" vl={salesTot ? num((subTot / salesTot) * 100, 2) + '%' : '0%'}
          sb="Nilai retur terhadap penjualan" />
        <Kpi cls="k-blue" lb="Customer Terdampak" vl={num(new Set(rows.map((r) => r.customer_code)).size, 0)}
          sb="pelanggan pernah retur" />
      </KpiGrid>
      <div className="grid-2-1">
        <Card>
          <CardHead title="Daftar Retur" />
          <CardBody flush>
            <DataTable<SalesReturn> rows={rows} rowKey={(r) => r.no}
              onRow={(r) => router.push(`/ar/invoice?doc=${r.invoice_no}`)}
              cols={[
                { t: 'No. Retur', f: (r) => <span className="doc-no">{r.no}</span> },
                { t: 'Tanggal', f: (r) => dFmt(r.return_date) },
                { t: 'Invoice', f: (r) => <span className="sm mono">{r.invoice_no}</span> },
                { t: 'Customer', f: (r) => s.cust(r.customer_code).name },
                { t: 'Alasan', f: (r) => <span className="sm">{r.reason || '-'}</span> },
                { t: 'Nilai', cls: 'num', f: (r) => rp(r.total) },
                { t: 'Credit Note', f: (r) => <span className="sm mono">{r.cn_no || '-'}</span> },
              ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Penyebab Retur" />
          <CardBody flush>
            <DataTable rows={reasons} emptyT="Belum ada retur" cols={[
              { t: 'Alasan', f: (r) => <span className="sm">{r.k}</span> },
              { t: 'Nilai', cls: 'num', f: (r) => rp(r.v) },
            ]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
