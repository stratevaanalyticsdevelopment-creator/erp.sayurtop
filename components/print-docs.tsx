'use client';
/* Pratinjau cetak — tata letak dokumen sama dengan versi HTML. */
import { useStore } from '@/lib/store';
import { Modal, ModalBody, ModalFoot, ModalHead, PrintDoc } from './ui';
import { lineNet } from '@/lib/calc';
import { dFmtL, num, rp, terbilang } from '@/lib/format';
import type { Delivery, DocLine, Invoice, PurchaseOrder, SalesOrder } from '@/lib/types';

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
    <Modal open onClose={onClose} size="paper">
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

/* Cetak Purchase Order — dokumen yang dikirim ke supplier. */
export function PrintPO({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const s = useStore();
  const sp = s.supp(po.supplier_code);
  const lines = po.lines || [];
  const gross = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  return (
    <Wrap title={po.no} onClose={onClose}>
      <Head title="PURCHASE ORDER" no={po.no} extra={dFmtL(po.po_date)} />
      <div className="pd-grid">
        <div className="bx"><div className="lb">Kepada Supplier</div><b>{sp.name}</b><br />
          {sp.address || '-'}<br />PIC {sp.pic || '-'} &middot; {sp.phone || '-'}<br />
          Termin: {s.termOf(po.term_code).name}</div>
        <div className="bx"><div className="lb">Informasi Pesanan</div>
          Tanggal PO: {dFmtL(po.po_date)}<br />
          Diharapkan Tiba: {dFmtL(po.expected_date || po.po_date)}<br />
          Kirim ke Gudang: {s.wh(po.warehouse_code).name}<br />
          Referensi SO: {po.order_no || '-'}<br />Status: {po.status}</div>
      </div>
      <table className="pd-tbl">
        <thead><tr><th style={{ width: 26 }}>#</th><th>SKU</th><th>Produk</th><th className="num">Qty</th>
          <th>Satuan</th><th className="num">Harga</th><th className="num">Jumlah</th></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td>{i + 1}</td><td>{l.product_id}</td><td>{l.name}</td>
            <td className="num">{num(l.qty, 0)}</td><td>{l.unit}</td>
            <td className="num">{num(l.price, 0)}</td>
            <td className="num">{num((Number(l.qty) || 0) * (Number(l.price) || 0), 0)}</td></tr>
        ))}</tbody>
      </table>
      <div style={{ display: 'flex' }}>
        <div style={{ marginLeft: 'auto', width: 320, fontSize: 11.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0',
            borderTop: '1.5px solid #000', fontWeight: 700, fontSize: 13 }}>
            <span>TOTAL PESANAN</span><span>{rp(gross)}</span>
          </div>
        </div>
      </div>
      {po.note ? <div style={{ fontSize: 11, marginTop: 10 }}><b>Catatan:</b> {po.note}</div> : null}
      <div style={{ fontSize: 10.5, marginTop: 12, color: '#444' }}>
        Harga di atas mengikuti daftar harga supplier yang berlaku pada tanggal PO. Selisih harga
        saat barang diterima dicatat pada dokumen penerimaan barang.
      </div>
      <div className="pd-sign">
        <div>Dibuat oleh<div className="line">Purchasing</div></div>
        <div>Disetujui<div className="line">&nbsp;</div></div>
        <div>Supplier<div className="line">{sp.pic || '-'}</div></div>
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
  /* Faktur dicetak dalam nilai bersih: qty, jumlah, dan seluruh rekap sudah
     dikurangi retur, sehingga pelanggan bisa menghitung ulang tiap barisnya
     sendiri. Konsekuensinya baris "Retur / Credit Note" tidak lagi muncul di
     rekap — kalau ikut ditampilkan, returnya terpotong dua kali. Sisa tagihan
     tetap sama persis dengan perhitungan bruto dikurangi Credit Note. */
  const netLines: DocLine[] = (iv.lines || []).map((l: DocLine) => ({
    ...l, qty: (Number(l.qty) || 0) - (Number(l.ret_qty) || 0) }));
  let nGross = 0; let nDisc = 0; let nTax = 0;
  netLines.forEach((l) => {
    const g = (Number(l.qty) || 0) * (Number(l.price) || 0);
    nGross += g; nDisc += (g * (Number(l.disc_pct) || 0)) / 100;
    nTax += lineNet(l) * ((Number(l.tax_pct) || 0) / 100);
  });
  nGross = Math.round(nGross); nDisc = Math.round(nDisc); nTax = Math.round(nTax);
  const nSub = nGross - nDisc;
  /* Nilai faktur dan nilai retur masing-masing dibulatkan sendiri, sehingga
     menghitung ulang dari baris bersih bisa meleset satu-dua rupiah dari angka
     yang dipakai pembukuan. Sisa tagihan adalah angka pembukuan, jadi
     selisihnya ditampilkan terbuka sebagai baris Pembulatan — bukan diam-diam
     dibenamkan ke PPN. */
  const netAuth = Math.round(Number(iv.total) - Number(iv.return_total));
  const bulat = netAuth - Math.round(nSub + nTax);
  const netDoc = { gross: nGross, disc: nDisc, sub: nSub, tax: nTax, total: netAuth };
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
        <tbody>{netLines.map((l: DocLine, i: number) => (
          <tr key={i}><td>{i + 1}</td><td>{l.product_id}</td>
            <td>{l.name}{l.ret_qty ? <><br /><i style={{ fontSize: 10 }}>Dikirim {num((iv.lines || [])[i].qty, 0)} {l.unit}, retur {num(l.ret_qty, 0)} {l.unit} — {l.ret_reason || ''}</i></> : null}</td>
            <td className="num">{num(l.qty, 0)}</td><td>{l.unit}</td>
            <td className="num">{num(l.price, 0)}</td><td className="num">{l.disc_pct || 0}%</td>
            <td className="num">{l.tax_pct || 0}%</td><td className="num">{num(lineNet(l), 0)}</td></tr>
        ))}</tbody>
      </table>
      <Totals d={netDoc} extra={bulat
        ? row('Pembulatan', bulat < 0 ? '(' + num(-bulat, 0) + ')' : num(bulat, 0)) : null} />
      <div style={{ display: 'flex' }}>
        <div style={{ marginLeft: 'auto', width: 320, fontSize: 11.5 }}>
          {Number(iv.paid) ? row('Telah Dibayar', '(' + num(iv.paid, 0) + ')') : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0',
            borderTop: '1px solid #000', fontWeight: 700, fontSize: 13 }}>
            <span>SISA TAGIHAN</span><span>{rp(os)}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, marginTop: 12, lineHeight: 1.7 }}>
        <b>Terbilang:</b> <i>{terbilang(os > 0 ? os : Number(iv.total) - Number(iv.return_total))}</i><br />
        {/* Tanpa keterangan ini, nilai faktur cetak tampak berbeda dari nilai
            faktur di pembukuan, yang tetap dicatat bruto dengan Credit Note
            sebagai pembaliknya. */}
        {Number(iv.return_total) ? (<><b>Catatan retur:</b> Nilai pada faktur ini sudah bersih
          dari retur sebesar {rp(iv.return_total)} (Credit Note terlampir). Qty yang tercantum
          adalah qty setelah retur.<br /></>) : null}
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

/* ---------- CETAK LAPORAN KEUANGAN ----------
   Laporan dicetak dari baris yang sedang tampil, memakai kop yang sama
   dengan dokumen transaksi. */
export function PrintReport({ title, period, rows, onClose }: {
  title: string; period: string;
  rows: { label: string; value?: number | string; bold?: boolean; indent?: boolean; sep?: boolean }[];
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} size="paper">
      <ModalHead title={'Cetak — ' + title} onClose={onClose} />
      <ModalBody>
        <PrintDoc>
          <Head title={title} no={period} />
          <table className="pd-tbl" style={{ marginTop: 14 }}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={r.sep ? { borderTop: '1.5px solid #000' } : undefined}>
                  <td style={{ paddingLeft: r.indent ? 22 : 0, fontWeight: r.bold ? 700 : 400 }}>{r.label}</td>
                  <td className="num" style={{ fontWeight: r.bold ? 700 : 400 }}>
                    {typeof r.value === 'number' ? rp(r.value) : (r.value ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 26, fontSize: 10.5, color: '#555' }}>
            Dicetak dari Strateva O2C ERP · {dFmtL(new Date().toISOString().slice(0, 10))}
          </div>
        </PrintDoc>
      </ModalBody>
      <ModalFoot>
        <button className="btn" onClick={onClose}>Tutup</button>
        <button className="btn pri" onClick={() => window.print()}>🖨 Cetak</button>
      </ModalFoot>
    </Modal>
  );
}

/* Rekap Packing — satu lembar untuk tim gudang: per produk total qty dan
   jumlah koli, disusul pecahan per customer supaya barang tidak tertukar. */
export function PrintPacking({ period, groups, onClose }: {
  period: string;
  groups: {
    product_id: string; product_name: string; unit: string;
    pack_size: number; pack_unit: string | null;
    qty: number; koli: number; sisa: number;
    lines: { customer_name: string; order_no: string; qty: number; koli: number; sisa: number }[];
  }[];
  onClose: () => void;
}) {
  const totQty = groups.reduce((a, b) => a + b.qty, 0);
  const totKoli = groups.reduce((a, b) => a + b.koli, 0);
  return (
    <Modal open onClose={onClose} size="paper">
      <ModalHead title="Cetak — Rekap Packing" onClose={onClose}
        sub="Koli dihitung per customer, karena barang milik customer berbeda tidak boleh dicampur dalam satu kemasan." />
      <ModalBody>
        <PrintDoc>
          <Head title="REKAP PACKING" no={period} />
          <table className="pd-tbl" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th style={{ width: 88 }}>SKU</th>
                <th>Produk / Customer</th>
                <th className="num" style={{ width: 78 }}>Qty</th>
                <th className="num" style={{ width: 62 }}>Koli</th>
                <th className="num" style={{ width: 70 }}>Sisa</th>
                <th style={{ width: 58 }}>✓</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                <tr key={g.product_id} style={{ borderTop: '1.5px solid #000' }}>
                  <td style={{ fontWeight: 700 }}>{g.product_id}</td>
                  <td style={{ fontWeight: 700 }}>{g.product_name}
                    <span style={{ fontWeight: 400, color: '#555' }}>
                      {g.pack_size > 0 ? ` · ${num(g.pack_size, 0)} ${g.unit}/${g.pack_unit}` : ' · lepas'}
                    </span>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{num(g.qty, 0)} {g.unit}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{g.koli || ''}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{g.sisa ? num(g.sisa, 0) : ''}</td>
                  <td />
                </tr>,
                ...g.lines.map((l, i) => (
                  <tr key={g.product_id + ':' + i}>
                    <td />
                    <td style={{ paddingLeft: 18, color: '#333' }}>
                      {l.customer_name} <span style={{ color: '#777' }}>({l.order_no})</span></td>
                    <td className="num">{num(l.qty, 0)}</td>
                    <td className="num">{l.koli || ''}</td>
                    <td className="num">{l.sisa ? num(l.sisa, 0) : ''}</td>
                    <td style={{ borderBottom: '1px solid #999' }} />
                  </tr>
                )),
              ])}
              <tr style={{ borderTop: '1.5px solid #000' }}>
                <td />
                <td style={{ fontWeight: 700 }}>TOTAL {groups.length} produk</td>
                <td className="num" style={{ fontWeight: 700 }}>{num(totQty, 0)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{num(totKoli, 0)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 26, display: 'flex', gap: 40, fontSize: 10.5 }}>
            <div style={{ flex: 1 }}>Disiapkan oleh<div style={{ marginTop: 34, borderTop: '1px solid #000' }} /></div>
            <div style={{ flex: 1 }}>Diperiksa oleh<div style={{ marginTop: 34, borderTop: '1px solid #000' }} /></div>
          </div>
          <div style={{ marginTop: 16, fontSize: 10.5, color: '#555' }}>
            Dicetak dari Strateva O2C ERP · {dFmtL(new Date().toISOString().slice(0, 10))}
          </div>
        </PrintDoc>
      </ModalBody>
      <ModalFoot>
        <button className="btn" onClick={onClose}>Tutup</button>
        <button className="btn pri" onClick={() => window.print()}>🖨 Cetak</button>
      </ModalFoot>
    </Modal>
  );
}
