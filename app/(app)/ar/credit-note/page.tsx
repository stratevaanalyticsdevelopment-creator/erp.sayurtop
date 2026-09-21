'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Badge, Card, CardBody, DataTable, Modal, ModalBody, ModalFoot, ModalHead, PageHead, SecT } from '@/components/ui';
import { lineNet } from '@/lib/calc';
import { dFmt, dFmtL, num, rp } from '@/lib/format';
import type { CreditNote, DocLine, JournalLine } from '@/lib/types';

function CnPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CreditNote[]>([]);
  const [detail, setDetail] = useState<CreditNote | null>(null);
  const [jl, setJl] = useState<JournalLine[]>([]);

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

  return (
    <>
      <PageHead title="Credit Note"
        desc="Nota kredit atas retur barang atau koreksi tagihan. Setiap Credit Note mengurangi piutang dan PPN keluaran melalui jurnal otomatis." />
      <Card><CardBody flush>
        <DataTable<CreditNote> rows={rows} rowKey={(r) => r.no} onRow={open} cols={[
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
