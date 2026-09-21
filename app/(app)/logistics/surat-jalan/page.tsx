'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, F, Kv, Modal, ModalBody, ModalFoot, ModalHead, PageHead, SecT,
} from '@/components/ui';
import { PrintSJ } from '@/components/print-docs';
import { ST } from '@/lib/menu';
import { dFmt, dFmtL, num, today } from '@/lib/format';
import type { Delivery, DocLine, SalesOrder } from '@/lib/types';

function SjPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [invMap, setInvMap] = useState<Map<string, string>>(new Map());
  const [q, setQ] = useState('');
  const [st, setSt] = useState('ALL');
  const [detail, setDetail] = useState<Delivery | null>(null);
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [printing, setPrinting] = useState(false);
  const [recvBy, setRecvBy] = useState('');
  const [askRecv, setAskRecv] = useState(false);
  const [invDate, setInvDate] = useState(today());
  const [askInv, setAskInv] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, idl] = await Promise.all([
      supabase.from('delivery').select('*').order('delivery_date', { ascending: false }).order('no', { ascending: false }),
      supabase.from('invoice_delivery').select('invoice_no,delivery_no'),
    ]);
    setRows((d.data as Delivery[]) || []);
    const m = new Map<string, string>();
    ((idl.data as { invoice_no: string; delivery_no: string }[]) || []).forEach((x) => m.set(x.delivery_no, x.invoice_no));
    setInvMap(m);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (d: Delivery) => {
    const [ld, o] = await Promise.all([
      supabase.from('delivery_line').select('*').eq('delivery_no', d.no).order('id'),
      supabase.from('sales_order').select('*').eq('no', d.order_no).maybeSingle(),
    ]);
    setDetail({ ...d, lines: (ld.data as DocLine[]) || [] });
    setOrder((o.data as SalesOrder) || null);
    setRecvBy(s.cust(d.customer_code).pic || '');
  }, [supabase, s]);

  useEffect(() => {
    const doc = params.get('doc');
    if (doc && rows.length) { const d = rows.find((x) => x.no === doc); if (d) openDetail(d); }
  }, [params, rows, openDetail]);

  const filtered = rows.filter((d) => {
    if (st !== 'ALL' && d.status !== st) return false;
    const t = q.toLowerCase();
    return !t || d.no.toLowerCase().includes(t) || d.order_no.toLowerCase().includes(t) ||
      s.cust(d.customer_code).name.toLowerCase().includes(t);
  });

  async function doConfirm() {
    if (!detail) return;
    setBusy(true);
    const { error } = await supabase.rpc('confirm_delivery', { p_no: detail.no, p_recv_by: recvBy || 'Penerima' });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Surat Jalan ${detail.no} dikonfirmasi diterima.`, 'ok');
    setAskRecv(false); setDetail(null); await load();
  }
  async function doInvoice() {
    if (!detail) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('create_invoice_from_delivery', {
      p: { delivery_no: detail.no, invoice_date: invDate },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Invoice ${data} diterbitkan dan jurnal diposting.`, 'ok');
    setAskInv(false); setDetail(null); await load();
  }

  return (
    <>
      <PageHead title="Surat Jalan"
        desc="Surat Jalan dibuat dari Sales Order — sistem otomatis menarik customer, alamat kirim, dan sisa qty. Over-delivery ditolak langsung oleh database." />
      <div className="fbar">
        <input className="grow" placeholder="Cari no. SJ, no. SO, atau customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="ALL">Semua Status</option>
          {[ST.IN_TRANSIT, ST.RECEIVED, ST.CANCELLED].map((x) => <option key={x}>{x}</option>)}
        </select>
        <span className="sm mut">{filtered.length} surat jalan</span>
      </div>

      <Card><CardBody flush>
        <DataTable<Delivery> rows={filtered} rowKey={(r) => r.no} onRow={openDetail} cols={[
          { t: 'No. SJ', f: (d) => <span className="doc-no">{d.no}</span> },
          { t: 'Tanggal', f: (d) => dFmt(d.delivery_date) },
          { t: 'No. SO', f: (d) => <span className="sm mono">{d.order_no}</span> },
          { t: 'Customer', f: (d) => s.cust(d.customer_code).name },
          { t: 'Driver / Kendaraan', f: (d) => <span className="sm">
            {s.drivers.find((x) => x.code === d.driver_code)?.name || '-'} · {d.vehicle_code || '-'}</span> },
          { t: 'Qty', cls: 'num', f: (d) => num(d.qty_total, 0) },
          { t: 'Invoice', f: (d) => invMap.get(d.no)
            ? <span className="sm mono">{invMap.get(d.no)}</span>
            : <span className="bdg2 b-amber">Belum</span> },
          { t: 'Status', f: (d) => <Badge st={d.status} /> },
        ]} />
      </CardBody></Card>

      <Modal open={!!detail && !printing} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<>{detail.no} <Badge st={detail.status} /></>}
            sub={`${s.cust(detail.customer_code).name} · ${dFmtL(detail.delivery_date)} · dari ${detail.order_no}`} />
          <ModalBody>
            <div className="grid-2">
              <Kv rows={[
                ['Customer', s.cust(detail.customer_code).name],
                ['Alamat Kirim', s.cust(detail.customer_code).shipping_address || '-'],
                ['Gudang Asal', s.wh(detail.warehouse_code).name],
                ['Referensi SO', `${detail.order_no}${order?.po_no ? ' · PO ' + order.po_no : ''}`],
              ]} />
              <Kv rows={[
                ['Driver', s.drivers.find((x) => x.code === detail.driver_code)?.name || '-'],
                ['Kendaraan', detail.vehicle_code || '-'],
                ['Diterima', detail.recv_date
                  ? `${dFmtL(detail.recv_date)} oleh ${detail.recv_by || '-'}`
                  : <span className="mut">Belum dikonfirmasi</span>],
                ['Invoice', invMap.get(detail.no) || <span className="mut">Belum dibuat</span>],
              ]} />
            </div>
            {detail.note ? <div className="info-box mt14">{detail.note}</div> : null}
            <SecT>Barang Dikirim</SecT>
            <DataTable<DocLine> rows={detail.lines || []} cols={[
              { t: 'SKU', f: (l) => <span className="doc-no">{l.product_id}</span> },
              { t: 'Produk', f: (l) => l.name },
              { t: 'Qty Order', cls: 'num', f: (l) => num(l.ordered_qty || 0, 0) },
              { t: 'Qty Kirim', cls: 'num', f: (l) => <><b>{num(l.qty, 0)}</b> {l.unit}</> },
            ]} foot={<tr><td colSpan={3}>Total Qty Dikirim</td><td className="num">{num(detail.qty_total, 0)}</td></tr>} />
          </ModalBody>
          <ModalFoot left={detail.status === ST.IN_TRANSIT && s.can('edit')
            ? <button className="btn blue" onClick={() => setAskRecv(true)}>✓ Konfirmasi Diterima</button> : undefined}>
            <button className="btn" onClick={() => setPrinting(true)}>🖨 Cetak Surat Jalan</button>
            {detail.status === ST.RECEIVED && !invMap.get(detail.no) && s.can('create')
              ? <button className="btn pri" onClick={() => setAskInv(true)}>▣ Buat Invoice</button> : null}
            <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      <Modal open={askRecv} onClose={() => setAskRecv(false)} size="narrow">
        <ModalHead title="Konfirmasi Penerimaan" onClose={() => setAskRecv(false)} />
        <ModalBody><F label="Nama penerima di lokasi customer">
          <input value={recvBy} onChange={(e) => setRecvBy(e.target.value)} /></F></ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setAskRecv(false)}>Batal</button>
          <button className="btn pri" onClick={doConfirm} disabled={busy}>Simpan</button>
        </ModalFoot>
      </Modal>

      <Modal open={askInv} onClose={() => setAskInv(false)} size="narrow">
        <ModalHead title="Terbitkan Invoice" sub="Jatuh tempo dihitung otomatis dari termin order." onClose={() => setAskInv(false)} />
        <ModalBody><F label="Tanggal Invoice">
          <input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></F></ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setAskInv(false)}>Batal</button>
          <button className="btn pri" onClick={doInvoice} disabled={busy}>Terbitkan &amp; Posting Jurnal</button>
        </ModalFoot>
      </Modal>

      {printing && detail ? <PrintSJ sj={detail} order={order} onClose={() => setPrinting(false)} /> : null}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><SjPage /></Suspense>;
}
