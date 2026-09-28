'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Badge, Card, CardBody, DataTable, Modal, ModalBody, ModalFoot, ModalHead, PageHead, SecT } from '@/components/ui';
import { lineNet } from '@/lib/calc';
import { dFmt, dFmtL, num, rp } from '@/lib/format';
import type { CreditNote, DocLine, JournalLine } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';
import { DateRange, type Range } from '@/components/filters';

function CnPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CreditNote[]>([]);
  const [detail, setDetail] = useState<CreditNote | null>(null);
  const [jl, setJl] = useState<JournalLine[]>([]);
  /* Rentang tanggal kosong secara bawaan: menambahkan filter tidak boleh
     membuat dokumen lama mendadak hilang dari layar. */
  const [range, setRange] = useState<Range>({ from: '', to: '' });
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('credit_note').select('*').order('cn_date', { ascending: false });
      setRows((data as CreditNote[]) || []);
    })();
  }, [supabase]);

  async function open(c: CreditNote) {
    const [ld, j] = await Promise.all([
      supabase.from('credit_note_line').select('*').eq('cn_no', c.no).order('id'),
      c.journal_no ? supabase.from('journal_line').select('*').eq('journal_no', c.journal_no).order('line_no')
        : Promise.resolve({ data: [] }),
    ]);
    setDetail({ ...c, lines: (ld.data as DocLine[]) || [] });
    setJl((j.data as JournalLine[]) || []);
  }

  useEffect(() => {
    const doc = params.get('doc');
    if (doc && rows.length) { const c = rows.find((x) => x.no === doc); if (c) open(c); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, rows.length]);

  const filtered = rows.filter((c) => {
    if (range.from && c.cn_date < range.from) return false;
    if (range.to && c.cn_date > range.to) return false;
    const t = q.toLowerCase();
    return !t || c.no.toLowerCase().includes(t) || (c.invoice_no || '').toLowerCase().includes(t)
      || s.cust(c.customer_code).name.toLowerCase().includes(t)
      || (c.reason || '').toLowerCase().includes(t)
      || (c.journal_no || '').toLowerCase().includes(t);
  });
  const totCn = filtered.reduce((a, b) => a + Number(b.total), 0);

  function exportCsv() {
    downloadCsv('creditnotes',
      ['No CN', 'Tanggal', 'Invoice', 'Customer', 'Alasan', 'DPP', 'PPN', 'Total', 'Jurnal'],
      filtered.map((c) => [c.no, c.cn_date, c.invoice_no, s.cust(c.customer_code).name,
        c.reason || '', Number(c.sub), Number(c.tax), Number(c.total), c.journal_no || '']));
  }

  return (
    <>
      <PageHead title="Credit Note"
        desc="Nota kredit atas retur barang atau koreksi tagihan. Setiap Credit Note mengurangi piutang dan PPN keluaran melalui jurnal otomatis."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />
      <div className="fbar"><DateRange value={range} onChange={setRange} /></div>
      <div className="fbar">
        <input className="grow" placeholder="Cari no. CN, no. invoice, customer, alasan, atau no. jurnal…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sm mut">{filtered.length} credit note · {rp(totCn)}</span>
      </div>
      <Card><CardBody flush>
        <DataTable<CreditNote> rows={filtered} rowKey={(r) => r.no} onRow={open}
          emptyT="Tidak ada Credit Note pada rentang ini"
          emptyD="Credit Note terbit otomatis saat retur barang diproses dari detail Invoice."
          cols={[
          { t: 'No. CN', f: (c) => <span className="doc-no">{c.no}</span> },
          { t: 'Tanggal', f: (c) => dFmt(c.cn_date) },
          { t: 'Invoice', f: (c) => <span className="sm mono">{c.invoice_no}</span> },
          { t: 'Customer', f: (c) => s.cust(c.customer_code).name },
          { t: 'Alasan', f: (c) => <span className="sm">{c.reason || '-'}</span> },
          { t: 'DPP', cls: 'num', f: (c) => rp(c.sub) },
          { t: 'PPN', cls: 'num', f: (c) => rp(c.tax) },
          { t: 'Total', cls: 'num', f: (c) => <b>{rp(c.total)}</b> },
          { t: 'Jurnal', f: (c) => <span className="sm mono">{c.journal_no || '-'}</span> },
          { t: 'Status', f: (c) => <Badge st={c.status} /> },
        ]} />
      </CardBody></Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)} title={<>{detail.no} <Badge st={detail.status} /></>}
            sub={`${s.cust(detail.customer_code).name} · ${dFmtL(detail.cn_date)} · atas Invoice ${detail.invoice_no}`} />
          <ModalBody>
            <div className="info-box mb12"><b>Alasan:</b> {detail.reason || '-'}{detail.note ? <><br />{detail.note}</> : null}</div>
            <DataTable<DocLine> rows={detail.lines || []} cols={[
              { t: 'SKU', f: (l) => <span className="doc-no">{l.product_id}</span> },
              { t: 'Produk', f: (l) => l.name },
              { t: 'Qty Retur', cls: 'num', f: (l) => `${num(l.qty, 0)} ${l.unit}` },
              { t: 'Harga', cls: 'num', f: (l) => rp(l.price) },
              { t: 'Disc', cls: 'num', f: (l) => `${l.disc_pct || 0}%` },
              { t: 'Jumlah', cls: 'num', f: (l) => rp(lineNet(l)) },
            ]} />
            <div className="tot-box mt14">
              <div className="tot-row"><span>DPP Retur</span><span className="v">{rp(detail.sub)}</span></div>
              <div className="tot-row"><span>PPN</span><span className="v">{rp(detail.tax)}</span></div>
              <div className="tot-row grand"><span>Total Credit Note</span><span className="v">{rp(detail.total)}</span></div>
            </div>
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
    </>
  );
}
export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><CnPage /></Suspense>;
}
