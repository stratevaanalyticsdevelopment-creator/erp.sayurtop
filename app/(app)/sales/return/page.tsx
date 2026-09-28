'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { dFmt, num, rp, rpShort, ymOf, ymLabel, today } from '@/lib/format';
import type { SalesReturn } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';
import { DateRange, type Range } from '@/components/filters';

type RetLine = { return_no: string; reason: string; qty: number; price: number; disc_pct: number };

export default function Page() {
  const s = useStore();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SalesReturn[]>([]);
  const [lines, setLines] = useState<RetLine[]>([]);
  const [salesTot, setSalesTot] = useState(0);
  /* Rentang tanggal kosong secara bawaan: menambahkan filter tidak boleh
     membuat dokumen lama mendadak hilang dari layar. */
  const [range, setRange] = useState<Range>({ from: '', to: '' });
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const [r, rl, iv] = await Promise.all([
        supabase.from('sales_return').select('*').order('return_date', { ascending: false }),
        supabase.from('sales_return_line').select('return_no,reason,qty,price,disc_pct'),
        supabase.from('invoice').select('sub').neq('status', 'CANCELLED'),
      ]);
      setRows((r.data as SalesReturn[]) || []);
      setLines((rl.data as RetLine[]) || []);
      setSalesTot(((iv.data as { sub: number }[]) || []).reduce((a, b) => a + Number(b.sub), 0));
    })();
  }, [supabase]);

  const filtered = rows.filter((r) => {
    if (range.from && r.return_date < range.from) return false;
    if (range.to && r.return_date > range.to) return false;
    const t = q.toLowerCase();
    return !t || r.no.toLowerCase().includes(t) || (r.invoice_no || '').toLowerCase().includes(t)
      || (r.cn_no || '').toLowerCase().includes(t)
      || s.cust(r.customer_code).name.toLowerCase().includes(t)
      || (r.reason || '').toLowerCase().includes(t);
  });

  /* Penyebab retur dihitung dari dokumen yang lolos filter, bukan dari
     seluruh data — kalau tidak, panel penyebab bercerita tentang periode yang
     berbeda dari daftar di sebelahnya. */
  const noSet = new Set(filtered.map((r) => r.no));
  const reasons = (() => {
    const m = new Map<string, number>();
    lines.filter((l) => noSet.has(l.return_no)).forEach((l) => {
      const v = Number(l.qty) * Number(l.price) * (1 - Number(l.disc_pct || 0) / 100);
      m.set(l.reason || '-', (m.get(l.reason || '-') || 0) + v);
    });
    return [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  })();

  const tot = filtered.reduce((a, b) => a + Number(b.total), 0);
  const ym = ymOf(today());
  const month = filtered.filter((r) => ymOf(r.return_date) === ym).reduce((a, b) => a + Number(b.total), 0);
  const subTot = filtered.reduce((a, b) => a + Number(b.sub), 0);

  function exportCsv() {
    downloadCsv('returns',
      ['No Retur', 'Tanggal', 'Invoice', 'Customer', 'Alasan', 'DPP', 'PPN', 'Total', 'Credit Note'],
      filtered.map((r) => [r.no, r.return_date, r.invoice_no, s.cust(r.customer_code).name,
        r.reason || '', Number(r.sub), Number(r.tax), Number(r.total), r.cn_no || '']));
  }

  return (
    <>
      <PageHead title="Sales Return"
        desc="Seluruh pengembalian barang dari pelanggan. Retur dibuat dari detail Invoice sehingga nilai, pajak, stok, dan jurnal terkoreksi bersamaan."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />
      <div className="fbar"><DateRange value={range} onChange={setRange} /></div>
      <div className="fbar">
        <input className="grow" placeholder="Cari no. retur, no. invoice, no. CN, customer, atau alasan…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sm mut">{filtered.length} retur</span>
      </div>
      <KpiGrid>
        <Kpi cls="k-acc" lb="Total Retur" vl={rpShort(tot)} sb={`${num(filtered.length, 0)} dokumen`} />
        <Kpi cls="k-amber" lb="Retur Bulan Ini" vl={rpShort(month)} sb={ymLabel(ym)} />
        <Kpi cls="k-blue" lb="Rasio Retur" vl={salesTot ? num((subTot / salesTot) * 100, 2) + '%' : '0%'}
          sb="Nilai retur terhadap penjualan" />
        <Kpi cls="k-blue" lb="Customer Terdampak" vl={num(new Set(filtered.map((r) => r.customer_code)).size, 0)}
          sb="pelanggan pernah retur" />
      </KpiGrid>
      <div className="grid-2-1">
        <Card>
          <CardHead title="Daftar Retur" />
          <CardBody flush>
            <DataTable<SalesReturn> rows={filtered} rowKey={(r) => r.no}
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
