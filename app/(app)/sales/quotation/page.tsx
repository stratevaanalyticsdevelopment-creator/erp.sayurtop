'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Badge, Card, CardBody, DataTable, Modal, ModalBody, ModalFoot, ModalHead, PageHead } from '@/components/ui';
import { Totals } from '@/components/line-editor';
import { lineNet } from '@/lib/calc';
import { dFmt, dFmtL, num, rp } from '@/lib/format';
import type { DocLine, Quotation } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Quotation[]>([]);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Quotation | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('quotation').select('*').order('quo_date', { ascending: false });
      setRows((data as Quotation[]) || []);
    })();
  }, [supabase]);

  const filtered = rows.filter((x) => !q || x.no.toLowerCase().includes(q.toLowerCase()) ||
    s.cust(x.customer_code).name.toLowerCase().includes(q.toLowerCase()));

  async function open(x: Quotation) {
    const { data } = await supabase.from('quotation_line').select('*').eq('quo_no', x.no).order('line_no');
    setDetail({ ...x, lines: (data as DocLine[]) || [] });
  }

  return (
    <>
      <PageHead title="Quotation / Penawaran"
        desc="Penawaran harga ke calon pelanggan. Quotation yang disetujui dapat dikonversi menjadi Sales Order tanpa input ulang." />
      <div className="fbar">
        <input className="grow" placeholder="Cari nomor atau customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sm mut">{filtered.length} dokumen</span>
      </div>
      <Card><CardBody flush>
        <DataTable<Quotation> rows={filtered} rowKey={(r) => r.no} onRow={open} cols={[
          { t: 'No. Quotation', f: (x) => <span className="doc-no">{x.no}</span> },
          { t: 'Tanggal', f: (x) => dFmt(x.quo_date) },
          { t: 'Berlaku s/d', f: (x) => dFmt(x.valid_until) },
          { t: 'Customer', f: (x) => s.cust(x.customer_code).name },
          { t: 'Total', cls: 'num', f: (x) => rp(x.total) },
          { t: 'Status', f: (x) => <Badge st={x.status} /> },
        ]} />
      </CardBody></Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<>{detail.no} <Badge st={detail.status} /></>}
            sub={`${s.cust(detail.customer_code).name} · ${dFmtL(detail.quo_date)} · berlaku s/d ${dFmtL(detail.valid_until)}`} />
          <ModalBody>
            <DataTable<DocLine> rows={detail.lines || []} cols={[
              { t: 'SKU', f: (l) => <span className="doc-no">{l.product_id}</span> },
              { t: 'Produk', f: (l) => l.name },
              { t: 'Qty', cls: 'num', f: (l) => `${num(l.qty, 0)} ${l.unit}` },
              { t: 'Harga', cls: 'num', f: (l) => rp(l.price) },
              { t: 'Disc', cls: 'num', f: (l) => `${l.disc_pct || 0}%` },
              { t: 'Jumlah', cls: 'num', f: (l) => rp(lineNet(l)) },
            ]} />
            <Totals t={{ gross: detail.gross, disc: detail.disc, sub: detail.sub, tax: detail.tax, total: detail.total }} />
          </ModalBody>
          <ModalFoot><button className="btn" onClick={() => setDetail(null)}>Tutup</button></ModalFoot>
        </>) : null}
      </Modal>
    </>
  );
}
