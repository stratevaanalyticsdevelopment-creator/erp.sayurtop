'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, DataTable, Kv, PageHead } from '@/components/ui';
import { invOutstanding } from '@/lib/calc';
import { dAdd, dFmt, rp, today } from '@/lib/format';
import type { Invoice } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';
import { PrintReport } from '@/components/print-docs';

type Row = { date: string; no: string; t: string; ref: string; d: number; c: number; bal?: number };

function StatementPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [cust, setCust] = useState(params.get('cust') || s.customers[0]?.code || '');
  const [from, setFrom] = useState(dAdd(today(), -90));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  const [os, setOs] = useState(0);

  useEffect(() => {
    if (!cust) return;
    (async () => {
      const [iv, cn, pa, all] = await Promise.all([
        supabase.from('invoice').select('no,invoice_date,total,order_no').eq('customer_code', cust)
          .neq('status', 'CANCELLED').gte('invoice_date', from).lte('invoice_date', to),
        supabase.from('credit_note').select('no,cn_date,total,invoice_no').eq('customer_code', cust)
          .gte('cn_date', from).lte('cn_date', to),
        supabase.from('payment').select('no,pay_date,amount').eq('customer_code', cust)
          .gte('pay_date', from).lte('pay_date', to),
        supabase.from('invoice_view').select('*').eq('customer_code', cust).gt('outstanding', 0),
      ]);
      const out: Row[] = [];
      ((iv.data as { no: string; invoice_date: string; total: number; order_no: string }[]) || [])
        .forEach((i) => out.push({ date: i.invoice_date, no: i.no, t: 'Invoice', ref: i.order_no || '-', d: Number(i.total), c: 0 }));
      ((cn.data as { no: string; cn_date: string; total: number; invoice_no: string }[]) || [])
        .forEach((x) => out.push({ date: x.cn_date, no: x.no, t: 'Credit Note (Retur)', ref: x.invoice_no, d: 0, c: Number(x.total) }));
      ((pa.data as { no: string; pay_date: string; amount: number }[]) || [])
        .forEach((p) => out.push({ date: p.pay_date, no: p.no, t: 'Pembayaran', ref: '-', d: 0, c: Number(p.amount) }));
      out.sort((a, b) => a.date.localeCompare(b.date));
      let bal = 0;
      out.forEach((r) => { bal += r.d - r.c; r.bal = bal; });
      setRows(out);
      setOs(((all.data as Invoice[]) || []).reduce((a, b) => a + invOutstanding(b), 0));
    })();
  }, [supabase, cust, from, to]);

  const c = s.cust(cust);
  const totD = rows.reduce((a, b) => a + b.d, 0);
  const totC = rows.reduce((a, b) => a + b.c, 0);

  const [print, setPrint] = useState(false);
  const prRows = [
    ...rows.map((r) => ({ label: `${r.date} · ${r.no} — ${r.t}`, value: r.d - r.c })),
    { label: 'Mutasi Periode', value: totD - totC, bold: true, sep: true },
    { label: 'Sisa Tagihan Seluruh Periode', value: os, bold: true },
  ];
  function exportCsv() {
    downloadCsv('statement',
      ['Tanggal', 'Dokumen', 'Jenis', 'Referensi', 'Debit', 'Kredit', 'Saldo'],
      rows.map((r) => [r.date, r.no, r.t, r.ref, r.d, r.c, r.bal ?? '']));
  }

  return (
    <>
      <PageHead title="Customer Statement"
        desc="Rekening koran pelanggan: invoice, retur, dan pembayaran dalam satu urutan waktu."
        actions={<>
          <button className="btn" onClick={() => setPrint(true)}>🖨 Cetak</button>
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />
      <div className="fbar">
        <select value={cust} onChange={(e) => setCust(e.target.value)}>
          {s.customers.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
        </select>
        <label className="sm mut">Periode</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Card className="mb12"><CardBody>
        <div className="grid-3">
          <Kv rows={[['Customer', c.name], ['Tipe', c.type || '-'], ['NPWP', c.npwp || '-']]} />
          <Kv rows={[['Alamat Tagih', c.billing_address || '-'], ['PIC', c.pic || '-'], ['Kontak', c.wa || '-']]} />
          <Kv rows={[['Termin', s.termOf(c.term_code).name], ['Credit Limit', rp(c.credit_limit)],
            ['Total Piutang', <span key="os" style={{ color: os > Number(c.credit_limit) ? 'var(--red)' : 'inherit' }}>{rp(os)}</span>]]} />
        </div>
      </CardBody></Card>
      <Card><CardBody flush>
        <DataTable<Row> rows={rows}
          foot={<tr><td colSpan={4}>Mutasi Periode</td><td className="num">{rp(totD)}</td>
            <td className="num">{rp(totC)}</td><td className="num">{rp(totD - totC)}</td></tr>}
          cols={[
            { t: 'Tanggal', f: (r) => dFmt(r.date) },
            { t: 'Dokumen', f: (r) => <span className="doc-no">{r.no}</span> },
            { t: 'Jenis', f: (r) => r.t },
            { t: 'Referensi', f: (r) => <span className="sm mono">{r.ref}</span> },
            { t: 'Debit', cls: 'num', f: (r) => r.d ? rp(r.d) : <span className="mut">—</span> },
            { t: 'Kredit', cls: 'num', f: (r) => r.c ? rp(r.c) : <span className="mut">—</span> },
            { t: 'Saldo', cls: 'num', f: (r) => <b>{rp(r.bal || 0)}</b> },
          ]} />
      </CardBody></Card>
    </>
  );
}
export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><StatementPage /></Suspense>;
}
