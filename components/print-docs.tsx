'use client';
/* Pratinjau cetak — tata letak dokumen sama dengan versi HTML. */
import { useStore } from '@/lib/store';
import { Modal, ModalBody, ModalFoot, ModalHead, PrintDoc } from './ui';
import { lineNet } from '@/lib/calc';
import { dFmtL, num, rp, terbilang } from '@/lib/format';
import type { Delivery, DocLine, Invoice, SalesOrder } from '@/lib/types';

function Head({ title, no, extra }: { title: string; no: string; extra?: React.ReactNode }) {
  const s = useStore();
  const c = s.settings?.company;
  return (
    <div className="pd-head">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="pd-logo"><img src="/img/logo-sm.png" alt="" /></div>
      <div className="pd-co">
        <b style={{ fontSize: 13 }}>{c?.legal}</b><br />{c?.addr}<br />
        Telp {c?.phone} · {c?.email}<br />NPWP {c?.npwp}
      </div>
      <div className="pd-ttl">
        <h2>{title}</h2>
        <div className="no">{no}</div>
        {extra ? <div style={{ fontSize: 10.5, marginTop: 4 }}>{extra}</div> : null}
      </div>
    </div>
  );
}

function Totals({ d, extra }: { d: { gross: number; disc: number; sub: number; tax: number; total: number }; extra?: React.ReactNode }) {
  const row = (l: string, v: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>{l}</span><span>{v}</span></div>
  );
  return (
    <div style={{ display: 'flex' }}>
      <div style={{ marginLeft: 'auto', width: 320, fontSize: 11.5 }}>
        {row('Subtotal Bruto', num(d.gross, 0))}
        {row('Diskon', '(' + num(d.disc, 0) + ')')}
        {row('DPP', num(d.sub, 0))}
        {row('PPN', num(d.tax, 0))}
        {extra}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0',
          borderTop: '1.5px solid #000', fontWeight: 700, fontSize: 13 }}>
          <span>GRAND TOTAL</span><span>{rp(d.total)}</span>
        </div>
      </div>
    </div>
  );
}

function Wrap({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal open onClose={onClose} size="wide">
      <div className="no-print"><ModalHead title={`Pratinjau Cetak — ${title}`} onClose={onClose} /></div>
      <ModalBody><PrintDoc>{children}</PrintDoc></ModalBody>
      <div className="no-print">
        <ModalFoot>
          <button className="btn" onClick={onClose}>Tutup</button>
          <button className="btn pri" onClick={() => window.print()}>🖨 Cetak / Simpan PDF</button>
        </ModalFoot>
      </div>
    </Modal>
  );
}

export function PrintSO({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const s = useStore();
  const c = s.cust(order.customer_code);
  return (
    <Wrap title={order.no} onClose={onClose}>
      <Head title="SALES ORDER" no={order.no} extra={dFmtL(order.order_date)} />
      <div className="pd-grid">
        <div className="bx"><div className="lb">Customer</div><b>{c.name}</b><br />{c.billing_address || '-'}<br />
          NPWP {c.npwp || '-'}<br />PIC {c.pic || '-'}</div>
        <div className="bx"><div className="lb">Informasi Order</div>
          Tanggal Order: {dFmtL(order.order_date)}<br />Target Kirim: {dFmtL(order.delivery_date)}<br />
          PO Customer: {order.po_no || '-'}<br />Termin: {s.termOf(order.term_code).name}<br />
          Sales: {s.sp(order.salesperson_code).name}</div>
      </div>
      <table className="pd-tbl">
        <thead><tr><th style={{ width: 26 }}>#</th><th>SKU</th><th>Produk</th><th className="num">Qty</th>
          <th>Satuan</th><th className="num">Harga</th><th className="num">Disc</th><th className="num">Jumlah</th></tr></thead>
        <tbody>{(order.lines || []).map((l, i) => (
          <tr key={i}><td>{i + 1}</td><td>{l.product_id}</td><td>{l.name}</td>
            <td className="num">{num(l.qty, 0)}</td><td>{l.unit}</td>
            <td className="num">{num(l.price, 0)}</td><td className="num">{l.disc_pct || 0}%</td>
            <td className="num">{num(lineNet(l), 0)}</td></tr>
        ))}</tbody>
      </table>
      <Totals d={order} />
      {order.note ? <div style={{ fontSize: 11, marginTop: 10 }}><b>Catatan:</b> {order.note}</div> : null}
      <div className="pd-sign">
        <div>Dibuat oleh<div className="line">Sales</div></div>
        <div>Disetujui<div className="line">Sales Manager</div></div>
        <div>Customer<div className="line">{c.pic || '-'}</div></div>
      </div>
    </Wrap>
  );
}

export function PrintSJ({ sj, order, onClose }: { sj: Delivery; order?: SalesOrder | null; onClose: () => void }) {
  const s = useStore();
  const c = s.cust(sj.customer_code);
  const dr = s.drivers.find((x) => x.code === sj.driver_code);
  return (
    <Wrap title={sj.no} onClose={onClose}>
      <Head title="SURAT JALAN" no={sj.no} extra={dFmtL(sj.delivery_date)} />
      <div className="pd-grid">
        <div className="bx"><div className="lb">Kirim Kepada</div><b>{c.name}</b><br />{c.shipping_address || '-'}<br />
          PIC {c.pic || '-'} · {c.wa || '-'}</div>
        <div className="bx"><div className="lb">Informasi Pengiriman</div>
          No. SO: {sj.order_no}<br />PO Customer: {order?.po_no || '-'}<br />
          Gudang: {s.wh(sj.warehouse_code).name}<br />Driver: {dr?.name || '-'}<br />
          Kendaraan: {sj.vehicle_code || '-'}</div>
      </div>
      <table className="pd-tbl">
        <thead><tr><th style={{ width: 26 }}>#</th><th>SKU</th><th>Nama Barang</th>
          <th className="num">Qty Order</th><th className="num">Qty Kirim</th><th>Satuan</th><th>Keterangan</th></tr></thead>
        <tbody>
          {(sj.lines || []).map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td>{l.product_id}</td><td>{l.name}</td>
              <td className="num">{num(l.ordered_qty || 0, 0)}</td>
              <td className="num"><b>{num(l.qty, 0)}</b></td><td>{l.unit}</td><td /></tr>
          ))}
          <tr><td colSpan={4} style={{ textAlign: 'right' }}><b>Total Qty</b></td>
            <td className="num"><b>{num(sj.qty_total, 0)}</b></td><td colSpan={2} /></tr>
        </tbody>
      </table>
      <div style={{ fontSize: 10.5, lineHeight: 1.7, marginTop: 8 }}>
        {sj.note ? <><b>Catatan:</b> {sj.note}<br /></> : null}
        Barang telah diperiksa dan diterima dalam keadaan baik. Keluhan mutu wajib disampaikan pada hari yang
        sama dengan penerimaan.
      </div>
      <div className="pd-sign">
        <div>Gudang<div className="line">{s.wh(sj.warehouse_code).pic || '-'}</div></div>
        <div>Driver<div className="line">{dr?.name || '-'}</div></div>
        <div>Penerima<div className="line">{sj.recv_by || c.pic || '-'}</div></div>
      </div>
    </Wrap>
  );
}

export function PrintInvoice({ iv, sjNos, onClose }: { iv: Invoice; sjNos: string[]; onClose: () => void }) {
  const s = useStore();
  const c = s.cust(iv.customer_code);
  const co = s.settings?.company;
  const os = Math.round(Number(iv.total) - Number(iv.return_total) - Number(iv.paid));
  const row = (l: string, v: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span>{l}</span><span>{v}</span></div>
  );
  return (
    <Wrap title={iv.no} onClose={onClose}>
      <Head title="INVOICE" no={iv.no}
        extra={<>Tanggal: {dFmtL(iv.invoice_date)}<br />Jatuh Tempo: {dFmtL(iv.due_date)}</>} />
      <div className="pd-grid">
        <div className="bx"><div className="lb">Tagihan Kepada</div><b>{c.name}</b><br />{c.billing_address || '-'}<br />
          NPWP {c.npwp || '-'}<br />UP: {c.pic || '-'}</div>
        <div className="bx"><div className="lb">Referensi</div>
          Sales Order: {iv.order_no || '-'}<br />Surat Jalan: {sjNos.join(', ') || '-'}<br />
          PO Customer: {iv.po_no || '-'}<br />Termin: {s.termOf(iv.term_code).name}</div>
      </div>
      <table className="pd-tbl">
        <thead><tr><th style={{ width: 26 }}>#</th><th>SKU</th><th>Deskripsi</th><th className="num">Qty</th>
          <th>Sat</th><th className="num">Harga</th><th className="num">Disc</th><th className="num">PPN</th>
          <th className="num">Jumlah</th></tr></thead>
        <tbody>{(iv.lines || []).map((l: DocLine, i: number) => (
          <tr key={i}><td>{i + 1}</td><td>{l.product_id}</td>
            <td>{l.name}{l.ret_qty ? <><br /><i style={{ fontSize: 10 }}>Retur {num(l.ret_qty, 0)} {l.unit} — {l.ret_reason || ''}</i></> : null}</td>
            <td className="num">{num(l.qty, 0)}</td><td>{l.unit}</td>
            <td className="num">{num(l.price, 0)}</td><td className="num">{l.disc_pct || 0}%</td>
            <td className="num">{l.tax_pct || 0}%</td><td className="num">{num(lineNet(l), 0)}</td></tr>
        ))}</tbody>
      </table>
      <Totals d={iv} />
      <div style={{ display: 'flex' }}>
        <div style={{ marginLeft: 'auto', width: 320, fontSize: 11.5 }}>
          {Number(iv.return_total) ? row('Retur / Credit Note', '(' + num(iv.return_total, 0) + ')') : null}
          {Number(iv.paid) ? row('Telah Dibayar', '(' + num(iv.paid, 0) + ')') : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0',
            borderTop: '1px solid #000', fontWeight: 700, fontSize: 13 }}>
            <span>SISA TAGIHAN</span><span>{rp(os)}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, marginTop: 12, lineHeight: 1.7 }}>
        <b>Terbilang:</b> <i>{terbilang(os > 0 ? os : Number(iv.total) - Number(iv.return_total))}</i><br />
        <b>Pembayaran ditransfer ke:</b> {co?.bank}<br />
        Mohon cantumkan nomor invoice pada berita transfer. Konfirmasi pembayaran ke {co?.email}.
      </div>
      <div className="pd-sign">
        <div>Hormat kami<div className="line">{co?.legal}</div></div>
        <div>Diperiksa<div className="line">Finance</div></div>
        <div>Diterima<div className="line">{c.pic || '-'}</div></div>
      </div>
    </Wrap>
  );
}
