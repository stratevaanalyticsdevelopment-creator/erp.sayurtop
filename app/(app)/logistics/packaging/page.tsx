'use client';
/* Packaging — daftar barang yang harus disiapkan gudang, dikelompokkan per
   produk. Satu baris per produk berisi total qty yang perlu ditimbang;
   barisnya dibuka untuk melihat pecahan per customer.

   Koli dihitung PER CUSTOMER, bukan dari total qty. Sepuluh kilo untuk dua
   customer berbeda tetap dua kemasan, karena barangnya tidak boleh tercampur.
   Karena itu total koli satu produk adalah jumlah koli tiap customer. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, Kpi, KpiGrid, Kv, Modal, ModalBody, ModalFoot, ModalHead,
  PageHead, SecT,
} from '@/components/ui';
import { PrintPacking } from '@/components/print-docs';
import { dAdd, dFmt, dFmtL, num, today } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';

type Line = {
  order_no: string; delivery_date: string; customer_code: string; customer_name: string;
  customer_type: string | null; shipping_address: string | null;
  warehouse_code: string | null; order_status: string;
  product_id: string; product_name: string; category: string; category_name: string;
  unit: string; pack_size: number; pack_unit: string | null; stock: number;
  qty_order: number; qty_delivered: number; qty_outstanding: number;
  koli_penuh: number; qty_sisa: number;
};
type Grp = {
  product_id: string; product_name: string; category_name: string; unit: string;
  pack_size: number; pack_unit: string | null; stock: number;
  qty: number; koli: number; sisa: number; nCust: number; lines: Line[];
  earliest: string;
};

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(dAdd(today(), 6));
  const [wh, setWh] = useState('ALL');
  const [cat, setCat] = useState('ALL');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Grp | null>(null);
  const [print, setPrint] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('packing_line_view').select('*')
      .gte('delivery_date', from).lte('delivery_date', to)
      .order('product_id').order('customer_code');
    setRows((data as Line[]) || []);
    setLoading(false);
  }, [supabase, from, to]);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => {
    if (wh !== 'ALL' && r.warehouse_code !== wh) return false;
    if (cat !== 'ALL' && r.category_name !== cat) return false;
    const t = q.toLowerCase();
    return !t || r.product_id.toLowerCase().includes(t) || r.product_name.toLowerCase().includes(t) ||
      r.customer_name.toLowerCase().includes(t) || r.order_no.toLowerCase().includes(t);
  });

  /* Pengelompokan per produk. Koli dan sisa dijumlahkan dari tiap customer. */
  const groups = useMemo<Grp[]>(() => {
    const m = new Map<string, Grp>();
    filtered.forEach((r) => {
      let g = m.get(r.product_id);
      if (!g) {
        g = {
          product_id: r.product_id, product_name: r.product_name,
          category_name: r.category_name, unit: r.unit,
          pack_size: Number(r.pack_size) || 0, pack_unit: r.pack_unit,
          stock: Number(r.stock) || 0,
          qty: 0, koli: 0, sisa: 0, nCust: 0, lines: [], earliest: r.delivery_date,
        };
        m.set(r.product_id, g);
      }
      g.qty += Number(r.qty_outstanding) || 0;
      g.koli += Number(r.koli_penuh) || 0;
      g.sisa += Number(r.qty_sisa) || 0;
      g.lines.push(r);
      if (r.delivery_date < g.earliest) g.earliest = r.delivery_date;
    });
    const out = [...m.values()];
    out.forEach((g) => {
      g.nCust = new Set(g.lines.map((l) => l.customer_code)).size;
      g.lines.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) ||
        a.customer_name.localeCompare(b.customer_name));
    });
    /* Tanggal kirim terdekat lebih dulu, lalu qty terbesar. */
    return out.sort((a, b) => a.earliest.localeCompare(b.earliest) || b.qty - a.qty);
  }, [filtered]);

  const cats = useMemo(() =>
    [...new Set(rows.map((r) => r.category_name).filter(Boolean))].sort(), [rows]);

  const totQty = groups.reduce((a, b) => a + b.qty, 0);
  const totKoli = groups.reduce((a, b) => a + b.koli, 0);
  const nCust = new Set(filtered.map((r) => r.customer_code)).size;
  const nSo = new Set(filtered.map((r) => r.order_no)).size;
  const kurang = groups.filter((g) => g.qty > g.stock).length;

  function exportCsv() {
    downloadCsv('packing',
      ['SKU', 'Produk', 'Kategori', 'Satuan', 'Isi per Kemasan', 'Jenis Kemasan',
       'Customer', 'Tipe', 'No SO', 'Tgl Kirim', 'Gudang', 'Status Order',
       'Qty Order', 'Qty Terkirim', 'Qty Disiapkan', 'Koli Penuh', 'Sisa Tidak Penuh', 'Stok'],
      filtered.map((r) => [r.product_id, r.product_name, r.category_name, r.unit,
        Number(r.pack_size) || 0, r.pack_unit || '',
        r.customer_name, r.customer_type || '', r.order_no, r.delivery_date,
        s.wh(r.warehouse_code).name, r.order_status,
        Number(r.qty_order), Number(r.qty_delivered), Number(r.qty_outstanding),
        Number(r.koli_penuh), Number(r.qty_sisa), Number(r.stock)]));
  }

  const kemasanTxt = (g: { pack_size: number; unit: string; pack_unit: string | null }) =>
    g.pack_size > 0 ? `${num(g.pack_size, 0)} ${g.unit} / ${g.pack_unit}` : 'lepas';

  return (
    <>
      <PageHead title="Packaging"
        desc="Barang yang harus disiapkan gudang, dikelompokkan per produk agar bisa ditimbang sekali lalu dipecah per customer. Klik satu baris untuk melihat pembagiannya."
        actions={<>
          {s.can('print') ? (
            <button className="btn pri" onClick={() => setPrint(true)} disabled={!groups.length}>
              🖨 Cetak Rekap Packing</button>) : null}
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />

      <div className="fbar">
        <input className="grow" placeholder="Cari produk, customer, atau no. SO…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="ALL">Semua Kategori</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={wh} onChange={(e) => setWh(e.target.value)}>
          <option value="ALL">Semua Gudang</option>
          {s.warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
        </select>
        <label className="sm mut">Tgl kirim</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="sm mut">{groups.length} produk</span>
        {loading ? <span className="sm mut">Memuat…</span> : null}
      </div>

      <KpiGrid>
        <Kpi cls="k-blue" lb="Produk Disiapkan" vl={num(groups.length, 0)}
          sb={`${num(nSo, 0)} sales order`} />
        <Kpi cls="k-acc" lb="Total Qty" vl={num(totQty, 0)} sb="Seluruh satuan" />
        <Kpi cls="k-green" lb="Total Koli" vl={num(totKoli, 0)}
          sb="Kemasan penuh, dihitung per customer" />
        <Kpi cls={kurang ? 'k-red' : 'k-amber'} lb="Customer Dilayani" vl={num(nCust, 0)}
          sb={kurang ? `${kurang} produk stok kurang` : 'Stok mencukupi'} />
      </KpiGrid>

      <Card><CardBody flush>
        <DataTable<Grp> rows={groups} rowKey={(g) => g.product_id} onRow={setDetail}
          emptyT="Tidak ada barang untuk disiapkan pada rentang ini"
          emptyD="Ubah rentang tanggal kirim, atau setujui Sales Order lebih dulu di menu Order Approval."
          foot={<tr><td colSpan={5}>TOTAL {groups.length} produk</td>
            <td className="num">{num(totQty, 0)}</td>
            <td className="num">{num(totKoli, 0)}</td>
            <td colSpan={3} /></tr>}
          cols={[
            { t: 'SKU', f: (g) => <span className="doc-no">{g.product_id}</span> },
            { t: 'Produk', f: (g) => g.product_name },
            { t: 'Kategori', f: (g) => <span className="sm mut">{g.category_name}</span> },
            { t: 'Kirim Terdekat', f: (g) => (<>{dFmt(g.earliest)}{g.earliest < today()
              ? <span className="bdg2 b-red" style={{ marginLeft: 6 }}>Telat</span>
              : g.earliest === today()
              ? <span className="bdg2 b-amber" style={{ marginLeft: 6 }}>Hari ini</span>
              : null}</>) },
            { t: 'Kemasan', f: (g) => (g.pack_size > 0
              ? <span className="sm">{kemasanTxt(g)}</span>
              : <span className="sm mut">lepas</span>) },
            { t: 'Total Qty', cls: 'num', f: (g) => <b>{num(g.qty, 0)} {g.unit}</b> },
            { t: 'Koli', cls: 'num', f: (g) => (g.koli
              ? <span className="bdg2 b-green">{num(g.koli, 0)}</span>
              : <span className="mut">—</span>) },
            { t: 'Sisa', cls: 'num', f: (g) => (g.sisa
              ? <span className="bdg2 b-amber" title="Qty yang tidak memenuhi satu kemasan penuh">
                  {num(g.sisa, 0)}</span>
              : <span className="mut">—</span>) },
            { t: 'Customer', cls: 'ctr', f: (g) => g.nCust },
            { t: 'Stok', cls: 'num', f: (g) => (g.qty > g.stock
              ? <span className="bdg2 b-red" title={`Butuh ${num(g.qty, 0)}, stok ${num(g.stock, 0)}`}>
                  {num(g.stock, 0)}</span>
              : <span className="sm mut">{num(g.stock, 0)}</span>) },
          ]} />
      </CardBody></Card>

      <div className="info-box mt14">
        <b>Koli dihitung per customer</b>, bukan dari total qty. Sepuluh kilo untuk dua customer
        berbeda tetap menjadi dua kemasan karena barangnya tidak boleh tercampur — karena itu kolom
        Koli satu produk adalah jumlah koli tiap customer, dan kolom Sisa adalah jumlah qty yang
        tidak memenuhi satu kemasan penuh. Isi per kemasan diatur di <b>Master Produk</b>.
      </div>

      {/* ---------- pecahan per customer ---------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<><span className="doc-no">{detail.product_id}</span> {detail.product_name}</>}
            sub={`${num(detail.qty, 0)} ${detail.unit} untuk ${detail.nCust} customer · ${
              detail.pack_size > 0 ? `${num(detail.koli, 0)} koli ${detail.pack_unit}` : 'ditimbang lepas'}`} />
          <ModalBody>
            <div className="mb12"><Kv rows={[
              ['Kemasan', detail.pack_size > 0
                ? `${num(detail.pack_size, 0)} ${detail.unit} per ${detail.pack_unit}`
                : 'Ditimbang lepas, tanpa kemasan tetap'],
              ['Total Disiapkan', `${num(detail.qty, 0)} ${detail.unit}`],
              ['Koli Penuh', `${num(detail.koli, 0)} ${detail.pack_unit || ''}`],
              ['Sisa Tidak Penuh', `${num(detail.sisa, 0)} ${detail.unit}`],
              ['Stok Tersedia', detail.qty > detail.stock
                ? <span className="bdg2 b-red">{num(detail.stock, 0)} {detail.unit} — kurang {num(detail.qty - detail.stock, 0)}</span>
                : `${num(detail.stock, 0)} ${detail.unit}`],
            ]} /></div>
            <SecT>Pembagian per Customer</SecT>
            <DataTable<Line> rows={detail.lines} rowKey={(l) => l.order_no + l.customer_code}
              foot={<tr><td colSpan={4}>TOTAL</td>
                <td className="num">{num(detail.qty, 0)}</td>
                <td className="num">{num(detail.koli, 0)}</td>
                <td className="num">{num(detail.sisa, 0)}</td></tr>}
              cols={[
                { t: 'Customer', f: (l) => l.customer_name },
                { t: 'Tipe', f: (l) => <span className="sm mut">{l.customer_type || '-'}</span> },
                { t: 'No. SO', f: (l) => <span className="doc-no">{l.order_no}</span> },
                { t: 'Tgl Kirim', f: (l) => dFmt(l.delivery_date) },
                { t: 'Qty', cls: 'num', f: (l) => <b>{num(l.qty_outstanding, 0)}</b> },
                { t: 'Koli', cls: 'num', f: (l) => (Number(l.koli_penuh)
                  ? num(l.koli_penuh, 0) : <span className="mut">—</span>) },
                { t: 'Sisa', cls: 'num', f: (l) => (Number(l.qty_sisa)
                  ? num(l.qty_sisa, 0) : <span className="mut">—</span>) },
              ]} />
            <div className="info-box mt14">Alamat kirim dan status order dapat dilihat pada
              Sales Order masing-masing. Order berstatus{' '}
              <Badge st="PARTIALLY DELIVERED" /> hanya menampilkan sisa yang belum dikirim.</div>
          </ModalBody>
          <ModalFoot><button className="btn" onClick={() => setDetail(null)}>Tutup</button></ModalFoot>
        </>) : null}
      </Modal>

      {print ? (
        <PrintPacking onClose={() => setPrint(false)}
          period={`${dFmtL(from)} — ${dFmtL(to)}`}
          groups={groups.map((g) => ({
            product_id: g.product_id, product_name: g.product_name, unit: g.unit,
            pack_size: g.pack_size, pack_unit: g.pack_unit,
            qty: g.qty, koli: g.koli, sisa: g.sisa,
            lines: g.lines.map((l) => ({
              customer_name: l.customer_name, order_no: l.order_no,
              qty: Number(l.qty_outstanding) || 0,
              koli: Number(l.koli_penuh) || 0, sisa: Number(l.qty_sisa) || 0,
            })),
          }))} />) : null}
    </>
  );
}
