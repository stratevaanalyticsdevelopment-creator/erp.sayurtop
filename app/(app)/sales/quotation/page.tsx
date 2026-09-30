'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, F, Fg, Modal, ModalBody, ModalFoot, ModalHead, PageHead, SecT,
} from '@/components/ui';
import { EditLine, LineEditor, Totals, newLine, unresolvedLines } from '@/components/line-editor';
import { calcDoc, lineNet } from '@/lib/calc';
import { dAdd, dFmt, dFmtL, num, rp, today } from '@/lib/format';
import type { DocLine, Quotation } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';
import { errMsg } from '@/lib/store';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Quotation[]>([]);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Quotation | null>(null);

  const [lineCount, setLineCount] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('quotation').select('*').order('quo_date', { ascending: false });
      const qs = (data as Quotation[]) || [];
      setRows(qs);
      if (qs.length) {
        const { data: ld } = await supabase.from('quotation_line').select('quo_no')
          .in('quo_no', qs.map((x) => x.no));
        const m = new Map<string, number>();
        ((ld as { quo_no: string }[]) || []).forEach((l) => m.set(l.quo_no, (m.get(l.quo_no) || 0) + 1));
        setLineCount(m);
      }
    })();
  }, [supabase]);

  const filtered = rows.filter((x) => !q || x.no.toLowerCase().includes(q.toLowerCase()) ||
    s.cust(x.customer_code).name.toLowerCase().includes(q.toLowerCase()));

  async function open(x: Quotation) {
    const { data } = await supabase.from('quotation_line').select('*').eq('quo_no', x.no).order('line_no');
    setDetail({ ...x, lines: (data as DocLine[]) || [] });
  }

  /* ---------- Quotation baru ---------- */
  const [form, setForm] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [head, setHead] = useState({ quo_date: today(), valid_until: dAdd(today(), 14),
    customer_code: '', salesperson_code: '', note: '' });
  const [busy, setBusy] = useState(false);

  const defTax = head.customer_code && s.cust(head.customer_code).npwp !== '-' ? 11 : 0;
  const tot = calcDoc(lines);

  function openForm() {
    if (!s.can('create')) { s.toast('Tidak memiliki hak akses.', 'err'); return; }
    const c = s.customers[0];
    setHead({ quo_date: today(), valid_until: dAdd(today(), 14), customer_code: c?.code || '',
      salesperson_code: c?.salesperson_code || '', note: '' });
    setLines([newLine(c && c.npwp !== '-' ? 11 : 0)]);
    setForm(true);
  }

  async function saveQuo() {
    const bad = unresolvedLines(lines);
    if (bad.length) { s.toast(`Produk belum dikenali: ${bad.join(', ')}`, 'err'); return; }
    const ls = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!ls.length) { s.toast('Isi minimal satu baris produk.', 'err'); return; }
    if (!head.customer_code) { s.toast('Customer wajib dipilih.', 'err'); return; }

    setBusy(true);
    const { data: no, error: eNo } = await supabase.rpc('next_doc_no', { p_prefix: 'QUO' });
    if (eNo) { setBusy(false); s.toast(errMsg(eNo), 'err'); return; }
    const t = calcDoc(ls);
    const { error } = await supabase.from('quotation').insert({
      no, quo_date: head.quo_date, valid_until: head.valid_until || null,
      customer_code: head.customer_code,
      salesperson_code: head.salesperson_code || null,
      note: head.note || null, status: 'DRAFT',
      gross: t.gross, disc: t.disc, sub: t.sub, tax: t.tax, total: t.total,
    });
    if (error) { setBusy(false); s.toast(errMsg(error), 'err'); return; }
    const { error: eL } = await supabase.from('quotation_line').insert(ls.map((l, i) => ({
      quo_no: no, line_no: i + 1, product_id: l.product_id, name: l.name, unit: l.unit,
      qty: Number(l.qty), price: Number(l.price),
      disc_pct: Number(l.disc_pct) || 0, tax_pct: Number(l.tax_pct) || 0,
    })));
    setBusy(false);
    if (eL) { s.toast(errMsg(eL), 'err'); return; }
    s.toast(`Quotation ${String(no)} tersimpan.`, 'ok');
    setForm(false);
    const { data } = await supabase.from('quotation').select('*').order('quo_date', { ascending: false });
    setRows((data as Quotation[]) || []);
  }

  function exportCsv() {
    downloadCsv('quotations',
      ['No Quotation', 'Tanggal', 'Berlaku s/d', 'Customer', 'Subtotal', 'PPN', 'Total', 'Status', 'No SO'],
      filtered.map((x) => [x.no, x.quo_date, x.valid_until || '', s.cust(x.customer_code).name,
        Number(x.sub), Number(x.tax), Number(x.total), x.status, x.order_no || '']));
  }

  return (
    <>
      <PageHead title="Quotation / Penawaran"
        desc="Penawaran harga ke calon pelanggan. Quotation yang disetujui dapat dikonversi menjadi Sales Order tanpa input ulang."
        actions={<>
          {s.can('create') ? <button className="btn pri" onClick={openForm}>+ Quotation Baru</button> : null}
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />
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
          { t: 'Item', cls: 'ctr', f: (x) => lineCount.get(x.no) ?? '-' },
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
      <Modal open={form} onClose={() => setForm(false)} size="wide">
        <ModalHead title="Quotation Baru" onClose={() => setForm(false)}
          sub="Harga dan satuan terisi otomatis dari master produk saat produk dipilih." />
        <ModalBody>
          <Fg>
            <F label="Customer">
              <select value={head.customer_code} onChange={(e) => {
                const c = s.cust(e.target.value);
                setHead({ ...head, customer_code: e.target.value, salesperson_code: c.salesperson_code || '' });
              }}>
                {s.customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
              </select></F>
            <F label="Tanggal"><input type="date" value={head.quo_date}
              onChange={(e) => setHead({ ...head, quo_date: e.target.value })} /></F>
            <F label="Berlaku s/d"><input type="date" value={head.valid_until}
              onChange={(e) => setHead({ ...head, valid_until: e.target.value })} /></F>
            <F label="Sales Person">
              <select value={head.salesperson_code}
                onChange={(e) => setHead({ ...head, salesperson_code: e.target.value })}>
                <option value="">— tidak ada —</option>
                {s.salespersons.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </select></F>
            <F label="Catatan" full><input value={head.note}
              onChange={(e) => setHead({ ...head, note: e.target.value })} /></F>
          </Fg>
          <SecT>Barang Ditawarkan</SecT>
          <LineEditor lines={lines} setLines={setLines} defTax={defTax} />
          <button className="btn sm mt14" onClick={() => setLines([...lines, newLine(defTax)])}>+ Baris</button>
          <Totals t={tot} />
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setForm(false)}>Batal</button>
          <button className="btn pri" onClick={saveQuo} disabled={busy}>Simpan Quotation</button>
        </ModalFoot>
      </Modal>
    </>
  );
}
