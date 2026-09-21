'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Badge, Card, CardBody, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { PayForm } from '@/components/pay-form';
import { invOutstanding, invStatus } from '@/lib/calc';
import { dDiff, dFmt, num, rp, rpShort, today } from '@/lib/format';
import type { Invoice } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [q, setQ] = useState('');
  const [custF, setCustF] = useState('ALL');
  const [pay, setPay] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('invoice_view').select('*').gt('outstanding', 0).order('due_date');
    setRows((data as Invoice[]) || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const T = today();
  const filtered = rows.filter((i) => {
    if (custF !== 'ALL' && i.customer_code !== custF) return false;
    const t = q.toLowerCase();
    return !t || i.no.toLowerCase().includes(t) || s.cust(i.customer_code).name.toLowerCase().includes(t);
  });
  const tot = filtered.reduce((a, b) => a + invOutstanding(b), 0);
  const byC = new Map<string, number>();
  rows.forEach((i) => byC.set(i.customer_code, (byC.get(i.customer_code) || 0) + invOutstanding(i)));
  const overLimit = s.customers.filter((c) => Number(c.credit_limit) > 0 && (byC.get(c.code) || 0) > Number(c.credit_limit));

  return (
    <>
      <PageHead title="AR Outstanding"
        desc="Seluruh invoice yang belum lunas, sudah memperhitungkan retur (Credit Note) dan pembayaran parsial." />
      <KpiGrid>
        <Kpi cls="k-blue" lb="Total Piutang" vl={rpShort(tot)} sb={`${num(filtered.length, 0)} invoice`} />
        <Kpi cls="k-green" lb="Belum Jatuh Tempo"
          vl={rpShort(filtered.filter((i) => dDiff(i.due_date, T) <= 0).reduce((a, b) => a + invOutstanding(b), 0))} sb="Current" />
        <Kpi cls="k-red" lb="Sudah Jatuh Tempo"
          vl={rpShort(filtered.filter((i) => dDiff(i.due_date, T) > 0).reduce((a, b) => a + invOutstanding(b), 0))}
          sb={`${num(filtered.filter((i) => dDiff(i.due_date, T) > 0).length, 0)} invoice`} />
        <Kpi cls={overLimit.length ? 'k-red' : 'k-green'} lb="Melewati Credit Limit"
          vl={`${num(overLimit.length, 0)} customer`}
          sb={overLimit.slice(0, 2).map((c) => c.name).join(', ') || 'Tidak ada'} />
      </KpiGrid>
      {overLimit.length ? (
        <div className="warn-box mb12"><b>Perhatian credit limit:</b>{' '}
          {overLimit.map((c) => `${c.name} (${rp(byC.get(c.code) || 0)} dari limit ${rp(c.credit_limit)})`).join('; ')}.</div>
      ) : null}
      <div className="fbar">
        <input className="grow" placeholder="Cari invoice atau customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={custF} onChange={(e) => setCustF(e.target.value)}>
          <option value="ALL">Semua Customer</option>
          {s.customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select>
      </div>
      <Card><CardBody flush>
        <DataTable<Invoice> rows={filtered} rowKey={(r) => r.no}
          foot={<tr><td colSpan={7}>Total Outstanding</td><td className="num">{rp(tot)}</td><td colSpan={2} /></tr>}
          cols={[
            { t: 'No. Invoice', f: (i) => <span className="doc-no">{i.no}</span> },
            { t: 'Customer', f: (i) => s.cust(i.customer_code).name },
            { t: 'Tgl Invoice', f: (i) => dFmt(i.invoice_date) },
            { t: 'Jatuh Tempo', f: (i) => dFmt(i.due_date) },
            { t: 'Umur', cls: 'num', f: (i) => {
              const d = dDiff(i.due_date, T);
              return d > 0 ? <b style={{ color: 'var(--red)' }}>{d} hari</b>
                : <span className="mut">{-d} hari lagi</span>;
            } },
            { t: 'Nilai Net', cls: 'num', f: (i) => rp(i.net_total ?? i.total) },
            { t: 'Dibayar', cls: 'num', f: (i) => rp(i.paid) },
            { t: 'Sisa', cls: 'num', f: (i) => <b>{rp(invOutstanding(i))}</b> },
            { t: 'Status', f: (i) => <Badge st={invStatus(i)} /> },
            { t: '', cls: 'ctr', f: (i) => s.can('create')
              ? <button className="btn sm pri" onClick={() => setPay(i)}>Bayar</button> : null },
          ]} />
      </CardBody></Card>
      {pay ? <PayForm invoice={pay} onClose={() => setPay(null)}
        onDone={async () => { setPay(null); await load(); }} /> : null}
    </>
  );
}
