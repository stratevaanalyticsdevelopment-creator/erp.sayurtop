'use client';
/* Inbound / Receiving — penerimaan barang di gudang.
   Di sinilah harga beli sebenarnya hari itu dicatat: nilai ini menggantikan
   harga pokok master produk dan menjadi HPP faktur penjualan yang tertaut. */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, F, Fg, Kpi, KpiGrid, Kv, Modal, ModalBody, ModalFoot,
  ModalHead, PageHead, SecT,
} from '@/components/ui';
import { DateRange, defaultRange, type Range } from '@/components/filters';
import { LANDED_KINDS } from '@/lib/menu';
import { dFmt, dFmtL, num, rp, rpShort, today } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import type { GoodsReceipt, GrnLine, LandedCost, PoLine, PurchaseOrder } from '@/lib/types';

type Draft = { po_line_id: number; product_id: string; name: string; unit: string;
  ordered: number; sisa: number; qty: string; price: string };

/* Satu baris per produk yang diterima. Harga beli dan biaya per unit adalah
   angka per produk — merata-ratakannya lintas produk dalam satu GRN (sayur per
   kilo dan telur per kilo) tidak punya arti. */
type GrnRow = {
  key: string; grn: GoodsReceipt; no: string; date: string; supplier: string;
  poNo: string | null; supInv: string; wh: string | null;
  pid: string; name: string; catName: string; unit: string;
  qty: number; price: number; nilai: number; landed: number; unitCost: number;
};

function InboundPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<GoodsReceipt[]>([]);
  const [range, setRange] = useState<Range>(defaultRange('d30'));
  const [sup, setSup] = useState('ALL');
  const [cat, setCat] = useState('ALL');
  const [q, setQ] = useState('');
  const [allLines, setAllLines] = useState<GrnRow[]>([]);
  const [detail, setDetail] = useState<GoodsReceipt | null>(null);

  /* ---------- form penerimaan ---------- */
  const [openPo, setOpenPo] = useState<PurchaseOrder[]>([]);
  const [form, setForm] = useState(false);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [grnDate, setGrnDate] = useState(today());
  const [supInv, setSupInv] = useState('');
  const [note, setNote] = useState('');
  const [landed, setLanded] = useState<LandedCost[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let query = supabase.from('goods_receipt').select('*')
      .order('grn_date', { ascending: false }).order('no', { ascending: false });
    if (range.from) query = query.gte('grn_date', range.from);
    if (range.to) query = query.lte('grn_date', range.to);
    const [g, p] = await Promise.all([
      query,
      supabase.from('purchase_order').select('*').in('status', ['SENT', 'PARTIALLY RECEIVED']).order('po_date'),
    ]);
    const grns = (g.data as GoodsReceipt[]) || [];
    setRows(grns);
    setOpenPo((p.data as PurchaseOrder[]) || []);
    /* Tabel menampilkan satu baris per produk diterima, jadi barisnya diambil
       sekalian di sini — bukan hanya saat rincian dibuka. */
    if (grns.length) {
      const { data: ld } = await supabase.from('goods_receipt_line').select('*')
        .in('grn_no', grns.map((x) => x.no));
      const byNo = new Map(grns.map((x) => [x.no, x]));
      setAllLines(((ld as (GrnLine & { grn_no: string })[]) || []).map((l, i) => {
        const g2 = byNo.get(l.grn_no)!;
        const qty = Number(l.qty) || 0;
        const price = Number(l.price) || 0;
        return {
          key: `${l.grn_no}-${l.id ?? i}`, grn: g2, no: l.grn_no, date: g2.grn_date,
          supplier: g2.supplier_code, poNo: g2.po_no || null, supInv: g2.supplier_invoice || '',
          wh: g2.warehouse_code, pid: l.product_id, name: l.name,
          catName: s.prod(l.product_id)?.category_name || '',
          unit: l.unit, qty, price, nilai: Math.round(qty * price),
          landed: Number(l.landed_alloc) || 0, unitCost: Number(l.unit_cost) || 0,
        };
      }));
    } else setAllLines([]);
  }, [supabase, range, s]);
  useEffect(() => { load(); }, [load]);

  const pickPo = useCallback(async (no: string) => {
    const head = openPo.find((x) => x.no === no) || null;
    setPo(head);
    if (!head) { setDraft([]); return; }
    const { data } = await supabase.from('purchase_order_line').select('*').eq('po_no', no).order('line_no');
    setDraft(((data as PoLine[]) || []).map((l) => {
      const sisa = Math.max(0, Number(l.qty) - Number(l.received_qty || 0));
      return {
        po_line_id: l.id as number, product_id: l.product_id, name: l.name, unit: l.unit,
        ordered: Number(l.qty), sisa,
        qty: sisa ? String(sisa) : '0',
        price: String(l.price),
      };
    }));
  }, [supabase, openPo]);

  useEffect(() => {
    const p = params.get('po');
    if (p && openPo.length && !form) { setForm(true); pickPo(p); }
  }, [params, openPo, form, pickPo]);

  const openDetail = useCallback(async (g: GoodsReceipt) => {
    const [l, c] = await Promise.all([
      supabase.from('goods_receipt_line').select('*').eq('grn_no', g.no).order('id'),
      supabase.from('landed_cost').select('*').eq('grn_no', g.no).order('id'),
    ]);
    setDetail({ ...g, lines: (l.data as GrnLine[]) || [], landed: (c.data as LandedCost[]) || [] });
  }, [supabase]);

  const filtered = allLines.filter((r) => {
    if (sup !== 'ALL' && r.supplier !== sup) return false;
    if (cat !== 'ALL' && r.catName !== cat) return false;
    const t = q.toLowerCase();
    return !t || r.no.toLowerCase().includes(t) || (r.poNo || '').toLowerCase().includes(t)
      || (r.supInv || '').toLowerCase().includes(t)
      || r.pid.toLowerCase().includes(t) || r.name.toLowerCase().includes(t)
      || s.supp(r.supplier).name.toLowerCase().includes(t);
  });

  const cats = [...new Set(allLines.map((r) => r.catName))].filter(Boolean).sort();
  const nGrn = new Set(filtered.map((r) => r.no)).size;
  const qtyTot = filtered.reduce((a, r) => a + r.qty, 0);
  const goodsTot = filtered.reduce((a, r) => a + r.nilai, 0);
  const landedTot = filtered.reduce((a, r) => a + r.landed, 0);

  const dLines = draft.filter((d) => Number(d.qty) > 0);
  const dGoods = dLines.reduce((a, d) => a + Number(d.qty) * Number(d.price), 0);
  const dLanded = landed.reduce((a, c) => a + (Number(c.amount) || 0), 0);

  /* Mengikuti baris yang sedang tampil di layar, bukan seluruh data — supaya
     hasil export cocok dengan filter yang sedang dipakai. */
  function exportCsv() {
    const out: (string | number)[][] = filtered.map((r) => [
      r.no, r.date, s.supp(r.supplier).name, r.poNo || '', r.supInv || '', s.wh(r.wh).name,
      r.pid, r.name, r.catName, r.unit, r.qty, r.price, r.nilai, r.landed, r.unitCost,
      r.grn.journal_no || '']);
    downloadCsv('inbound', ['No GRN', 'Tanggal', 'Supplier', 'No PO', 'Nota Supplier', 'Gudang',
      'SKU', 'Produk', 'Kategori', 'Satuan', 'Qty Diterima', 'Harga Beli', 'Nilai Barang',
      'Landed Cost', 'Biaya per Unit', 'Jurnal'], out);
  }

  function reset() {
    setForm(false); setPo(null); setDraft([]); setLanded([]);
    setSupInv(''); setNote(''); setGrnDate(today());
  }

  async function save() {
    if (!po) { s.toast('Pilih Purchase Order lebih dulu.', 'err'); return; }
    if (!dLines.length) { s.toast('Isi qty diterima minimal satu baris.', 'err'); return; }
    const over = dLines.find((d) => Number(d.qty) > d.sisa);
    if (over) { s.toast(`Qty ${over.name} melebihi sisa pesanan (${num(over.sisa, 0)}).`, 'err'); return; }
    const noPrice = dLines.find((d) => !(Number(d.price) > 0));
    if (noPrice) { s.toast(`Harga beli ${noPrice.name} belum diisi.`, 'err'); return; }

    setBusy(true);
    const { data, error } = await supabase.rpc('receive_goods', {
      p: {
        po_no: po.no, grn_date: grnDate, warehouse_code: po.warehouse_code,
        supplier_invoice: supInv || null, note: note || null,
        lines: dLines.map((d) => ({
          po_line_id: d.po_line_id, product_id: d.product_id,
          qty: Number(d.qty), price: Number(d.price),
        })),
        landed: landed.filter((c) => Number(c.amount) > 0),
      },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Penerimaan ${data} tercatat, harga pokok produk diperbarui.`, 'ok');
    reset(); await load(); await s.reloadMaster();
  }

  function patch(i: number, v: Partial<Draft>) {
    setDraft(draft.map((d, j) => (j === i ? { ...d, ...v } : d)));
  }

  return (
    <>
      <PageHead title="Inbound / Receiving"
        desc="Pencatatan barang sampai gudang, satu baris per produk yang diterima. Harga beli yang diisi di sini adalah harga sebenarnya hari itu — nilai ini memperbarui harga pokok master produk dan menjadi HPP faktur penjualan yang tertaut."
        actions={<>
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
          {s.can('create')
            ? <button className="btn pri" onClick={() => setForm(true)}>+ Terima Barang</button>
            : null}
        </>} />

      <div className="fbar"><DateRange value={range} onChange={setRange} /></div>
      <div className="fbar">
        <input className="grow" placeholder="Cari produk, no. GRN, no. PO, atau nota supplier…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sup} onChange={(e) => setSup(e.target.value)}>
          <option value="ALL">Semua Supplier</option>
          {s.suppliers.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="ALL">Semua Kategori</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="sm mut">{filtered.length} baris · {nGrn} penerimaan</span>
      </div>

      <KpiGrid>
        <Kpi cls="k-blue" lb="Penerimaan" vl={num(nGrn, 0)} sb={`${num(filtered.length, 0)} baris produk`} />
        <Kpi cls="k-acc" lb="Nilai Barang" vl={rpShort(goodsTot)} sb={`${num(qtyTot, 0)} unit diterima`} />
        <Kpi cls="k-amber" lb="Landed Cost" vl={rpShort(landedTot)}
          sb={goodsTot ? num((landedTot / goodsTot) * 100, 2) + '% dari nilai barang' : '-'} />
        <Kpi cls="k-green" lb="Nilai Persediaan Masuk" vl={rpShort(goodsTot + landedTot)} />
      </KpiGrid>

      <Card><CardBody flush>
        <DataTable<GrnRow> rows={filtered} rowKey={(r) => r.key} onRow={(r) => openDetail(r.grn)}
          emptyT="Belum ada penerimaan barang pada rentang ini"
          emptyD="Gunakan tombol Terima Barang untuk mencatat kedatangan dari supplier."
          cols={[
            { t: 'No. GRN', f: (r) => <>{<span className="doc-no">{r.no}</span>}
              <div className="sm mut mono">{r.supInv || '-'}</div></> },
            { t: 'Tanggal', f: (r) => dFmt(r.date) },
            { t: 'Supplier', f: (r) => s.supp(r.supplier).name },
            { t: 'No. PO', f: (r) => (r.poNo
              ? <span className="sm mono">{r.poNo}</span> : <span className="mut">tanpa PO</span>) },
            { t: 'SKU', f: (r) => <span className="doc-no">{r.pid}</span> },
            { t: 'Produk', f: (r) => <>{r.name}<div className="sm mut">{r.catName}</div></> },
            { t: 'Qty', cls: 'num', f: (r) => <>{num(r.qty, 0)} {r.unit}</> },
            { t: 'Harga Beli', cls: 'num', f: (r) => rp(r.price) },
            { t: 'Nilai Barang', cls: 'num', f: (r) => rp(r.nilai) },
            { t: 'Landed', cls: 'num', f: (r) => (r.landed > 0
              ? rp(r.landed) : <span className="mut">—</span>) },
            { t: 'Biaya/unit', cls: 'num', f: (r) => (<>
              <b>{rp(r.unitCost)}</b>
              {r.price > 0 && r.unitCost > r.price
                ? <div className="sm mut">+{num(((r.unitCost - r.price) / r.price) * 100, 1)}%</div>
                : null}</>) },
          ]}
          foot={<tr><td colSpan={6}>TOTAL {num(filtered.length, 0)} baris dari {num(nGrn, 0)} penerimaan</td>
            <td className="num">{num(qtyTot, 0)}</td><td />
            <td className="num">{rp(goodsTot)}</td>
            <td className="num">{rp(landedTot)}</td>
            <td className="num">{rp(goodsTot + landedTot)}</td></tr>} />
      </CardBody></Card>

      <div className="info-box mt14"><b>Biaya/unit</b> adalah harga beli ditambah bagian landed cost
        baris itu, dibagi qty — inilah nilai yang masuk persediaan dan menjadi HPP ketika barangnya
        terjual. Kolom <b>Harga Beli</b> dan <b>Biaya/unit</b> berlaku per produk; angka pada baris
        TOTAL adalah jumlah nilai, bukan rata-rata harga. Klik satu baris untuk melihat seluruh
        dokumen penerimaannya.</div>

      {/* ---------- DETAIL ---------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<>{detail.no} <Badge st={detail.status} /></>}
            sub={`${s.supp(detail.supplier_code).name} · ${dFmtL(detail.grn_date)}`} />
          <ModalBody>
            <div className="grid-2">
              <Kv rows={[
                ['Supplier', s.supp(detail.supplier_code).name],
                ['Nota Supplier', detail.supplier_invoice || '-'],
                ['Purchase Order', detail.po_no || <span className="mut">tanpa PO</span>],
                ['Gudang', s.wh(detail.warehouse_code).name],
              ]} />
              <Kv rows={[
                ['Nilai Barang', rp(detail.goods_total)],
                ['Landed Cost', rp(detail.landed_total)],
                ['Masuk Persediaan', <b key="t">{rp(detail.total)}</b>],
                ['Jurnal', detail.journal_no || '-'],
              ]} />
            </div>
            {detail.note ? <div className="info-box mt14">{detail.note}</div> : null}

            <SecT>Barang Diterima</SecT>
            <DataTable<GrnLine> rows={detail.lines || []} cols={[
              { t: 'SKU', f: (l) => <span className="doc-no">{l.product_id}</span> },
              { t: 'Produk', f: (l) => l.name },
              { t: 'Qty', cls: 'num', f: (l) => <>{num(l.qty, 0)} {l.unit}</> },
              { t: 'Harga Beli', cls: 'num', f: (l) => rp(l.price) },
              { t: 'Landed', cls: 'num', f: (l) => (Number(l.landed_alloc) > 0
                ? rp(l.landed_alloc) : <span className="mut">—</span>) },
              { t: 'Biaya / Unit', cls: 'num', f: (l) => <b>{rp(l.unit_cost, 2)}</b> },
            ]} foot={<tr><td colSpan={2}>TOTAL</td>
              <td className="num">{num(detail.qty_total, 0)}</td>
              <td className="num">{rp(detail.goods_total)}</td>
              <td className="num">{rp(detail.landed_total)}</td>
              <td className="num">{rp(detail.total)}</td></tr>} />

            {(detail.landed || []).length ? (<>
              <SecT>Rincian Landed Cost</SecT>
              <DataTable<LandedCost> rows={detail.landed || []} cols={[
                { t: 'Jenis', f: (c) => <span className="bdg2 b-amber">{c.kind}</span> },
                { t: 'Keterangan', f: (c) => c.description || '-' },
                { t: 'Dasar Alokasi', f: (c) => (c.alloc_method === 'QTY' ? 'Per kuantitas' : 'Per nilai barang') },
                { t: 'Jumlah', cls: 'num', f: (c) => rp(c.amount) },
              ]} />
            </>) : null}
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
            {s.can('create')
              ? <a className="btn" href={`/purchasing/landed-cost?grn=${detail.no}`}>⊕ Tambah Landed Cost</a> : null}
          </ModalFoot>
        </>) : null}
      </Modal>

      {/* ---------- FORM PENERIMAAN ---------- */}
      <Modal open={form} onClose={reset} size="wide">
        <ModalHead title="Terima Barang" onClose={reset}
          sub="Isi qty yang benar-benar diterima dan harga beli hari ini. Sistem menolak penerimaan melebihi sisa pesanan." />
        <ModalBody>
          <Fg>
            <F label="Purchase Order">
              <select value={po?.no || ''} onChange={(e) => pickPo(e.target.value)}>
                <option value="">— pilih PO —</option>
                {openPo.map((p) => (
                  <option key={p.no} value={p.no}>
                    {p.no} · {s.supp(p.supplier_code).name} · {dFmt(p.po_date)}
                  </option>
                ))}
              </select>
            </F>
            <F label="Tanggal Terima">
              <input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} /></F>
            <F label="No. Nota / Faktur Supplier">
              <input value={supInv} placeholder="cth. NOTA-LEMBANG-0912"
                onChange={(e) => setSupInv(e.target.value)} /></F>
            <F label="Catatan" full>
              <input value={note} onChange={(e) => setNote(e.target.value)} /></F>
          </Fg>

          {po ? (<>
            <SecT>Barang &amp; Harga Beli Hari Ini</SecT>
            <table className="lines">
              <thead><tr>
                <th>Produk</th><th className="num">Dipesan</th><th className="num">Sisa</th>
                <th className="num">Qty Terima</th><th className="num">Harga Beli</th>
                <th className="num">Estimasi PO</th><th className="num">Subtotal</th>
              </tr></thead>
              <tbody>
                {draft.map((d, i) => {
                  const est = Number(s.prod(d.product_id)?.base_price || 0);
                  const nowP = Number(d.price) || 0;
                  const naik = est > 0 && nowP > est;
                  return (
                    <tr key={d.po_line_id}>
                      <td><span className="doc-no">{d.product_id}</span> {d.name}</td>
                      <td className="num">{num(d.ordered, 0)}</td>
                      <td className="num">{num(d.sisa, 0)}</td>
                      <td style={{ width: 110 }}>
                        <input className="num" type="number" min={0} max={d.sisa} step={1}
                          value={d.qty} onChange={(e) => patch(i, { qty: e.target.value })} /></td>
                      <td style={{ width: 140 }}>
                        <input className="num" type="number" min={0} step={100}
                          value={d.price} onChange={(e) => patch(i, { price: e.target.value })} /></td>
                      <td className="num sm mut">{rp(est)}
                        {naik ? <div style={{ color: 'var(--red)' }}>
                          +{num(((nowP - est) / est) * 100, 1)}%</div> : null}</td>
                      <td className="num">{rp(Number(d.qty) * nowP)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <SecT>Landed Cost (opsional)</SecT>
            {landed.map((c, i) => (
              <Fg key={i} c={4}>
                <F label="Jenis">
                  <select value={c.kind} onChange={(e) => setLanded(landed.map((x, j) =>
                    (j === i ? { ...x, kind: e.target.value } : x)))}>
                    {LANDED_KINDS.map((k) => <option key={k}>{k}</option>)}
                  </select></F>
                <F label="Keterangan">
                  <input value={c.description || ''} onChange={(e) => setLanded(landed.map((x, j) =>
                    (j === i ? { ...x, description: e.target.value } : x)))} /></F>
                <F label="Jumlah">
                  <input type="number" min={0} step={1000} value={c.amount}
                    onChange={(e) => setLanded(landed.map((x, j) =>
                      (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} /></F>
                <F label="Dasar Alokasi">
                  <select value={c.alloc_method} onChange={(e) => setLanded(landed.map((x, j) =>
                    (j === i ? { ...x, alloc_method: e.target.value as 'VALUE' | 'QTY' } : x)))}>
                    <option value="VALUE">Per nilai barang</option>
                    <option value="QTY">Per kuantitas</option>
                  </select></F>
              </Fg>
            ))}
            <button className="btn sm mt14" onClick={() => setLanded([...landed,
              { kind: 'Transport', description: '', amount: 0, alloc_method: 'VALUE' }])}>
              + Baris Biaya</button>
            {landed.length ? <button className="btn sm mt14" style={{ marginLeft: 8 }}
              onClick={() => setLanded(landed.slice(0, -1))}>− Hapus Baris Terakhir</button> : null}

            <div className="tot-box mt14">
              <div className="tot-row"><span>Nilai Barang</span><span className="v">{rp(dGoods)}</span></div>
              <div className="tot-row"><span>Landed Cost</span><span className="v">{rp(dLanded)}</span></div>
              <div className="tot-row grand"><span>Masuk Persediaan</span>
                <span className="v">{rp(dGoods + dLanded)}</span></div>
            </div>
            <div className="info-box mt14">Setelah disimpan, harga pokok master produk diperbarui menjadi
              biaya rata-rata hari ini (harga beli + landed cost), dan jurnal persediaan diposting otomatis.</div>
          </>) : (
            <div className="info-box mt14">Pilih Purchase Order untuk menampilkan barang yang dipesan.
              Hanya PO berstatus SENT atau PARTIALLY RECEIVED yang tampil di sini.</div>
          )}
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={reset}>Batal</button>
          <button className="btn pri" onClick={save} disabled={busy || !po || !dLines.length}>
            Simpan &amp; Posting Jurnal</button>
        </ModalFoot>
      </Modal>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><InboundPage /></Suspense>;
}
