'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, Kpi, KpiGrid, Kv, Modal, ModalBody, ModalFoot, ModalHead, PageHead, SecT,
} from '@/components/ui';
import { PayForm } from '@/components/pay-form';
import { dFmt, dFmtL, num, rp, rpShort, today, ymLabel, ymOf } from '@/lib/format';
import type { JournalLine, Payment } from '@/lib/types';

type Alloc = { payment_no: string; invoice_no: string; amount: number };

function PaymentPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Payment[]>([]);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Payment | null>(null);
  const [jl, setJl] = useState<JournalLine[]>([]);
  const [newPay, setNewPay] = useState(false);

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('payment').select('*').order('pay_date', { ascending: false }).order('no', { ascending: false }),
      supabase.from('payment_alloc').select('*'),
    ]);
    setRows((p.data as Payment[]) || []);
    setAllocs((a.data as Alloc[]) || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (p: Payment) => {
    const { data } = p.journal_no
      ? await supabase.from('journal_line').select('*').eq('journal_no', p.journal_no).order('line_no')
      : { data: [] };
    setJl((data as JournalLine[]) || []);
    setDetail(p);
  }, [supabase]);

  useEffect(() => {
    const doc = params.get('doc');
    if (doc && rows.length) { const p = rows.find((x) => x.no === doc); if (p) openDetail(p); }
  }, [params, rows, openDetail]);

  const T = today(); const ym = ymOf(T);
  const filtered = rows.filter((p) => {
    const t = q.toLowerCase();
    return !t || p.no.toLowerCase().includes(t) || s.cust(p.customer_code).name.toLowerCase().includes(t) ||
      allocs.some((a) => a.payment_no === p.no && a.invoice_no.toLowerCase().includes(t));
  });
  const month = rows.filter((p) => ymOf(p.pay_date) === ym);

  return (
    <>
      <PageHead title="Payment"
        desc="Penerimaan pembayaran pelanggan. Satu pembayaran dapat dialokasikan ke beberapa invoice sekaligus untuk menghindari selisih rekonsiliasi."
        actions={s.can('create') ? <button className="btn pri" onClick={() => setNewPay(true)}>+ Catat Pembayaran</button> : undefined} />
      <KpiGrid>
        <Kpi cls="k-green" lb={`Penerimaan ${ymLabel(ym)}`} vl={rpShort(month.reduce((a, b) => a + Number(b.amount), 0))}
          sb={`${num(month.length, 0)} transaksi`} />
        <Kpi cls="k-blue" lb="Penerimaan Hari Ini"
          vl={rp(rows.filter((p) => p.pay_date === T).reduce((a, b) => a + Number(b.amount), 0))} sb="" />
        <Kpi cls="k-blue" lb="Total Tercatat" vl={rpShort(rows.reduce((a, b) => a + Number(b.amount), 0))}
          sb={`${num(rows.length, 0)} pembayaran`} />
        <Kpi cls="k-amber" lb="Uang Muka" vl={rpShort(rows.reduce((a, b) => a + Number(b.advance || 0), 0))}
          sb="Belum dialokasikan" />
      </KpiGrid>
      <div className="fbar">
        <input className="grow" placeholder="Cari no. payment, invoice, atau customer…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card><CardBody flush>
        <DataTable<Payment> rows={filtered} rowKey={(r) => r.no} onRow={openDetail} cols={[
          { t: 'No. Payment', f: (p) => <span className="doc-no">{p.no}</span> },
          { t: 'Tanggal', f: (p) => dFmt(p.pay_date) },
          { t: 'Customer', f: (p) => s.cust(p.customer_code).name },
          { t: 'Metode', f: (p) => p.method },
          { t: 'Bank', f: (p) => s.banks.find((b) => b.code === p.bank_code)?.name || '-' },
          { t: 'Referensi', f: (p) => <span className="sm mono">{p.ref || '-'}</span> },
          { t: 'Alokasi', f: (p) => <span className="sm mono">
            {allocs.filter((a) => a.payment_no === p.no).map((a) => a.invoice_no).join(', ') || '-'}</span> },
          { t: 'Jumlah', cls: 'num', f: (p) => <b>{rp(p.amount)}</b> },
        ]} />
      </CardBody></Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)} title={<>{detail.no} <Badge st={detail.status} /></>}
            sub={`${s.cust(detail.customer_code).name} · ${dFmtL(detail.pay_date)} · ${rp(detail.amount)}`} />
          <ModalBody>
            <div className="mb12"><Kv rows={[
              ['Metode', detail.method],
              ['Bank', `${s.banks.find((b) => b.code === detail.bank_code)?.name || '-'} — ${s.banks.find((b) => b.code === detail.bank_code)?.account_no || '-'}`],
              ['Referensi', detail.ref || '-'],
              ['Jurnal', detail.journal_no || '-'],
            ]} /></div>
            <SecT>Alokasi Pembayaran</SecT>
            <DataTable<Alloc> rows={allocs.filter((a) => a.payment_no === detail.no)}
              foot={<tr><td colSpan={1}>Total Dialokasikan</td><td className="num">
                {rp(allocs.filter((a) => a.payment_no === detail.no).reduce((x, y) => x + Number(y.amount), 0))}</td></tr>}
              cols={[
                { t: 'Invoice', f: (a) => <span className="doc-no">{a.invoice_no}</span> },
                { t: 'Dialokasikan', cls: 'num', f: (a) => rp(a.amount) },
              ]} />
            {Number(detail.advance) > 0 ? (
              <div className="info-box mt14">Kelebihan bayar {rp(detail.advance)} tercatat sebagai Uang Muka Pelanggan (akun 2400).</div>
            ) : null}
            {jl.length ? (<>
              <SecT>Jurnal {detail.journal_no}</SecT>
              <DataTable<JournalLine> rows={jl} cols={[
                { t: 'Akun', f: (l) => <><span className="mono sm">{l.account_code}</span> {s.accName(l.account_code)}</> },
                { t: 'Keterangan', f: (l) => <span className="sm mut">{l.description}</span> },
                { t: 'Debit', cls: 'num', f: (l) => l.debit ? rp(l.debit) : <span className="mut">—</span> },
                { t: 'Kredit', cls: 'num', f: (l) => l.credit ? rp(l.credit) : <span className="mut">—</span> },
              ]} />
            </>) : null}
          </ModalBody>
          <ModalFoot><button className="btn" onClick={() => setDetail(null)}>Tutup</button></ModalFoot>
        </>) : null}
      </Modal>

      {newPay ? <PayForm onClose={() => setNewPay(false)}
        onDone={async () => { setNewPay(false); await load(); }} /> : null}
    </>
  );
}
export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><PaymentPage /></Suspense>;
}
