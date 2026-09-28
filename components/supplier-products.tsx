'use client';
/* Daftar produk yang dipasok satu supplier beserta harga berlakunya.
   Harga sayur berubah tiap hari, jadi yang disimpan adalah harga pada
   tanggal tertentu — bukan satu kolom yang ditimpa. Kolom harga dapat
   langsung diketik lalu disimpan sekaligus. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Card, CardBody, DataTable, F, Fg, Modal, ModalBody, ModalFoot, ModalHead, SecT,
} from './ui';
import { dFmt, dFmtL, num, rp, rpShort, today } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import type { SupplierProductRow, SupplierPrice } from '@/lib/types';

export function SupplierProducts({ supplierCode, supplierName, onClose }: {
  supplierCode: string; supplierName: string; onClose: () => void;
}) {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SupplierProductRow[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const [priceDate, setPriceDate] = useState(today());
  const [draft, setDraft] = useState<Record<string, string>>({});
  /* Perubahan syarat pasok: kunci "<pid>|min" dan "<pid>|cap". */
  const [qDraft, setQDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hist, setHist] = useState<{ row: SupplierProductRow; list: SupplierPrice[] } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addPick, setAddPick] = useState<string[]>([]);
  const [addQ, setAddQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('supplier_product_view').select('*')
      .eq('supplier_code', supplierCode).order('product_id');
    setRows((data as SupplierProductRow[]) || []);
    setDraft({}); setQDraft({});
    setLoading(false);
  }, [supabase, supplierCode]);
  useEffect(() => { load(); }, [load]);

  /* Harga yang berlaku pada tanggal yang dipilih, supaya kolom harga
     menampilkan angka yang benar saat pengguna melihat tanggal lampau. */
  const [atDate, setAtDate] = useState<Record<string, number>>({});
  useEffect(() => {
    (async () => {
      if (priceDate === today()) { setAtDate({}); return; }
      const { data } = await supabase.from('supplier_price')
        .select('product_id,price,price_date')
        .eq('supplier_code', supplierCode).lte('price_date', priceDate)
        .order('price_date', { ascending: false });
      const m: Record<string, number> = {};
      ((data as SupplierPrice[]) || []).forEach((r) => {
        if (m[r.product_id] === undefined) m[r.product_id] = Number(r.price);
      });
      setAtDate(m);
    })();
  }, [supabase, supplierCode, priceDate]);

  const cats = useMemo(() =>
    [...new Set(rows.map((r) => r.category_name).filter(Boolean))].sort(), [rows]);

  const shown = rows.filter((r) => {
    if (cat !== 'ALL' && r.category_name !== cat) return false;
    const t = q.toLowerCase();
    return !t || r.product_id.toLowerCase().includes(t) || r.product_name.toLowerCase().includes(t);
  });

  const effPrice = (r: SupplierProductRow) =>
    priceDate === today() ? r.current_price : (atDate[r.product_id] ?? null);

  const dirty = Object.entries(draft).filter(([pid, v]) => {
    const r = rows.find((x) => x.product_id === pid);
    if (!r) return false;
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== Number(effPrice(r) ?? -1);
  });

  const qtyDirty = Object.entries(qDraft).filter(([k, v]) => {
    const [pid, kind] = k.split('|');
    const r = rows.find((x) => x.product_id === pid);
    if (!r) return false;
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n) || n < 0) return false;
    return n !== Number(kind === 'min' ? r.min_order_qty : r.capacity_per_day);
  });

  /* Harga dan syarat pasok disimpan dalam satu tombol supaya pengguna tidak
     perlu mengingat dua aksi yang berbeda. */
  async function saveQtyTerms() {
    const perProduct = new Map<string, { min?: number; cap?: number }>();
    qtyDirty.forEach(([k, v]) => {
      const [pid, kind] = k.split('|');
      const e = perProduct.get(pid) || {};
      if (kind === 'min') e.min = Number(v); else e.cap = Number(v);
      perProduct.set(pid, e);
    });
    let firstErr = '';
    for (const [pid, e] of perProduct) {
      const { error } = await supabase.rpc('set_supplier_product_terms', {
        p_supplier: supplierCode, p_product: pid,
        p_min_qty: e.min ?? null, p_capacity: e.cap ?? null,
        p_lead: null, p_note: null,
      });
      if (error && !firstErr) firstErr = errMsg(error);
    }
    return { n: perProduct.size, err: firstErr };
  }

  async function savePrices() {
    if (!dirty.length && !qtyDirty.length) return;
    if (!s.can('edit')) { s.toast('Tidak memiliki hak akses.', 'err'); return; }
    setBusy(true);
    let ok = 0; let firstErr = '';
    for (const [pid, v] of dirty) {
      const { error } = await supabase.rpc('set_supplier_price', {
        p_supplier: supplierCode, p_product: pid,
        p_date: priceDate, p_price: Number(v), p_source: 'MANUAL', p_note: null,
      });
      if (error) { if (!firstErr) firstErr = errMsg(error); } else ok++;
    }
    const q = await saveQtyTerms();
    if (!firstErr) firstErr = q.err;
    setBusy(false);
    if (firstErr) { s.toast(firstErr, 'err'); return; }
    const pesan = [
      ok ? `${ok} harga (${dFmtL(priceDate)})` : '',
      q.n ? `${q.n} syarat pasok` : '',
    ].filter(Boolean).join(' dan ');
    s.toast(`${pesan} disimpan.`, 'ok');
    await load();
  }

  async function markPreferred(pid: string) {
    if (!s.can('edit')) { s.toast('Tidak memiliki hak akses.', 'err'); return; }
    const { error } = await supabase.rpc('set_preferred_supplier',
      { p_supplier: supplierCode, p_product: pid });
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast('Supplier utama diperbarui. Purchase Order otomatis akan memakai supplier ini.', 'ok');
    await load(); await s.reloadMaster();
  }

  async function removeProduct(pid: string) {
    if (!s.can('delete')) { s.toast('Tidak memiliki hak akses untuk menghapus.', 'err'); return; }
    const { error } = await supabase.rpc('remove_supplier_product',
      { p_supplier: supplierCode, p_product: pid });
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast('Produk dikeluarkan dari daftar supplier.', 'ok');
    await load(); await s.reloadMaster();
  }

  async function openHist(r: SupplierProductRow) {
    const { data } = await supabase.from('supplier_price').select('*')
      .eq('supplier_code', supplierCode).eq('product_id', r.product_id)
      .order('price_date', { ascending: false }).limit(30);
    setHist({ row: r, list: (data as SupplierPrice[]) || [] });
  }

  async function addProducts() {
    if (!addPick.length) { s.toast('Belum ada produk dipilih.', 'err'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('add_supplier_products',
      { p_supplier: supplierCode, p_products: addPick });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`${addPick.length} produk ditambahkan. Isi harganya lalu simpan.`, 'ok');
    setAddOpen(false); setAddPick([]); setAddQ('');
    await load();
  }

  function exportCsv() {
    downloadCsv(`hargasupplier-${supplierCode}`,
      ['Supplier', 'SKU', 'Produk', 'Kategori', 'Satuan', 'Harga Berlaku', 'Tanggal Harga',
       'Harga Sebelumnya', 'Perubahan %', 'Jumlah Riwayat', 'Min Order', 'Kapasitas per Hari',
       'Qty Pesan', 'Qty Terima', 'Nilai Pembelian', 'Jumlah PO', 'PO Terakhir',
       'Terima Terakhir', 'Harga Jual', 'Supplier Utama', 'Lead Time (hari)'],
      shown.map((r) => [supplierName, r.product_id, r.product_name, r.category_name, r.unit,
        Number(r.current_price ?? 0), r.current_price_date || '',
        Number(r.previous_price ?? 0), r.change_pct ?? '', r.price_count,
        Number(r.min_order_qty) || 0, Number(r.capacity_per_day) || 0,
        Number(r.qty_ordered) || 0, Number(r.qty_received) || 0,
        Math.round(Number(r.purchase_value) || 0), r.po_count,
        r.last_po_date || '', r.last_grn_date || '',
        Number(r.sell_price) || 0, r.is_preferred ? 'Ya' : '', r.lead_time_days]));
  }

  const belumAda = s.products.filter((p) => p.active && !rows.some((r) => r.product_id === p.id));
  const addShown = belumAda.filter((p) => {
    const t = addQ.toLowerCase();
    return !t || p.id.toLowerCase().includes(t) || p.name.toLowerCase().includes(t);
  }).slice(0, 80);

  const naik = rows.filter((r) => (r.change_pct ?? 0) > 0).length;
  const turun = rows.filter((r) => (r.change_pct ?? 0) < 0).length;
  const jenis = [...new Set(rows.map((r) => r.category_name).filter(Boolean))].sort();
  const totQtyPesan = rows.reduce((a, b) => a + (Number(b.qty_ordered) || 0), 0);
  const totQtyTerima = rows.reduce((a, b) => a + (Number(b.qty_received) || 0), 0);
  const totNilai = rows.reduce((a, b) => a + (Number(b.purchase_value) || 0), 0);

  return (
    <>
      <Modal open onClose={onClose} size="wide">
        <ModalHead onClose={onClose}
          title={<>Produk &amp; Harga — <span className="doc-no">{supplierCode}</span> {supplierName}</>}
          sub={`${num(rows.length, 0)} produk dipasok · ${jenis.length} jenis: ${jenis.join(', ') || '—'}`
            + ` · realisasi ${num(totQtyTerima, 0)} unit diterima dari ${num(totQtyPesan, 0)} unit dipesan`
            + ` (${rpShort(totNilai)}) · ${naik} harga naik, ${turun} harga turun`} />
        <ModalBody>
          <div className="info-box mb12">
            Harga disimpan <b>per tanggal</b>: harga lama tetap tersimpan sebagai riwayat sehingga
            Purchase Order lama tetap dapat dijelaskan. Kolom <b>Harga</b>, <b>Min Order</b>, dan
            <b> Kapasitas/Hari</b> dapat langsung diketik lalu disimpan sekaligus. Kolom
            <b> Qty Pesan</b> dan <b>Qty Terima</b> dihitung dari Purchase Order dan penerimaan
            barang yang sudah terjadi, jadi tidak dapat diubah manual.
          </div>

          <div className="fbar">
            <input className="grow" placeholder="Cari SKU atau nama produk…"
              value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="ALL">Semua Kategori</option>
              {cats.map((c) => <option key={c}>{c}</option>)}
            </select>
            <label className="sm mut">Tanggal harga</label>
            <input type="date" value={priceDate} max={today()}
              onChange={(e) => setPriceDate(e.target.value)} />
            <span className="sm mut">{shown.length} produk</span>
            {loading ? <span className="sm mut">Memuat…</span> : null}
          </div>

          <Card><CardBody flush>
            <DataTable<SupplierProductRow> rows={shown} rowKey={(r) => r.product_id}
              emptyT="Supplier ini belum punya daftar produk"
              emptyD="Tekan “+ Tambah Produk” untuk memilih produk yang dipasok supplier ini."
              cols={[
                { t: 'SKU', f: (r) => <span className="doc-no">{r.product_id}</span> },
                { t: 'Produk', f: (r) => (<>{r.product_name}
                  {r.is_preferred ? <span className="bdg2 b-green" style={{ marginLeft: 6 }}>Utama</span> : null}</>) },
                { t: 'Kategori', f: (r) => <span className="sm mut">{r.category_name}</span> },
                { t: 'Satuan', f: (r) => <span className="sm mut">{r.unit}</span> },
                { t: 'Harga', cls: 'num', f: (r) => (
                  <input className="num" type="number" min={0} step={100} style={{ width: 118 }}
                    placeholder={effPrice(r) === null ? 'belum ada' : ''}
                    value={draft[r.product_id] ?? (effPrice(r) !== null ? String(effPrice(r)) : '')}
                    onChange={(e) => setDraft({ ...draft, [r.product_id]: e.target.value })} />) },
                { t: 'Tgl Harga', f: (r) => <span className="sm mut">{
                  priceDate === today() ? dFmt(r.current_price_date) : dFmt(priceDate)}</span> },
                { t: 'Perubahan', cls: 'ctr', f: (r) => (r.change_pct === null || r.change_pct === undefined
                  ? <span className="mut">—</span>
                  : <span className={'bdg2 ' + (Number(r.change_pct) > 0 ? 'b-red'
                      : Number(r.change_pct) < 0 ? 'b-green' : 'b-grey')}>
                      {Number(r.change_pct) > 0 ? '▲' : Number(r.change_pct) < 0 ? '▼' : '='}{' '}
                      {Math.abs(Number(r.change_pct)).toFixed(1)}%
                    </span>) },
                { t: 'Min Order', cls: 'num', f: (r) => (
                  <input className="num" type="number" min={0} step={1} style={{ width: 74 }}
                    title="Minimum pembelian yang diminta supplier"
                    value={qDraft[r.product_id + '|min'] ?? String(Number(r.min_order_qty) || 0)}
                    onChange={(e) => setQDraft({ ...qDraft, [r.product_id + '|min']: e.target.value })} />) },
                { t: 'Kapasitas/Hari', cls: 'num', f: (r) => (
                  <input className="num" type="number" min={0} step={10} style={{ width: 88 }}
                    title="Kemampuan pasok supplier per hari"
                    value={qDraft[r.product_id + '|cap'] ?? String(Number(r.capacity_per_day) || 0)}
                    onChange={(e) => setQDraft({ ...qDraft, [r.product_id + '|cap']: e.target.value })} />) },
                { t: 'Qty Pesan', cls: 'num', f: (r) => (Number(r.qty_ordered) > 0
                  ? <span title={`${r.po_count} PO, terakhir ${dFmt(r.last_po_date)}`}>
                      {num(r.qty_ordered, 0)}</span>
                  : <span className="mut">—</span>) },
                { t: 'Qty Terima', cls: 'num', f: (r) => {
                  const o = Number(r.qty_ordered) || 0; const d = Number(r.qty_received) || 0;
                  if (!d) return <span className="mut">—</span>;
                  const penuh = o > 0 && d >= o;
                  return <b style={{ color: penuh ? 'var(--green)' : 'var(--amber)' }}
                    title={`Nilai pembelian ${rp(r.purchase_value)} · terakhir ${dFmt(r.last_grn_date)}`}>
                    {num(d, 0)}</b>;
                } },
                { t: 'Margin', cls: 'ctr', f: (r) => {
                  const h = Number(effPrice(r) ?? 0); const j = Number(r.sell_price) || 0;
                  if (!h || !j) return <span className="mut">—</span>;
                  const m = ((j - h) / j) * 100;
                  return <span className={'bdg2 ' + (m < 10 ? 'b-red' : m < 20 ? 'b-amber' : 'b-green')}>
                    {m.toFixed(1)}%</span>;
                } },
                { t: 'Riwayat', cls: 'ctr', f: (r) => (
                  <button className="btn sm" onClick={() => openHist(r)}>{num(r.price_count, 0)}×</button>) },
                { t: '', cls: 'ctr', f: (r) => (<>
                  {!r.is_preferred && s.can('edit')
                    ? <button className="btn sm" title="Jadikan supplier utama produk ini"
                        onClick={() => markPreferred(r.product_id)}>Jadikan Utama</button> : null}
                  {s.can('delete')
                    ? <button className="del" title="Keluarkan produk dari daftar supplier"
                        onClick={() => removeProduct(r.product_id)}>✕</button> : null}
                </>) },
              ]} />
          </CardBody></Card>
        </ModalBody>
        <ModalFoot left={<>
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
          {s.can('edit') ? <button className="btn" onClick={() => setAddOpen(true)}>+ Tambah Produk</button> : null}
        </>}>
          <button className="btn" onClick={onClose}>Tutup</button>
          {s.can('edit') ? (
            <button className="btn pri" onClick={savePrices}
              disabled={busy || (!dirty.length && !qtyDirty.length)}>
              Simpan Perubahan{dirty.length + qtyDirty.length
                ? ` (${dirty.length + qtyDirty.length})` : ''}
            </button>) : null}
        </ModalFoot>
      </Modal>

      {/* ---------- riwayat harga satu produk ---------- */}
      <Modal open={!!hist} onClose={() => setHist(null)} size="mid">
        {hist ? (<>
          <ModalHead onClose={() => setHist(null)}
            title={<>Riwayat Harga — {hist.row.product_name}</>}
            sub={`${supplierName} · ${hist.list.length} pencatatan terakhir · satuan ${hist.row.unit}`} />
          <ModalBody>
            <DataTable<SupplierPrice & { d?: number }> rows={hist.list} rowKey={(r) => String(r.price_date)}
              emptyT="Belum ada riwayat harga"
              cols={[
                { t: 'Tanggal', f: (r) => dFmtL(r.price_date) },
                { t: 'Harga', cls: 'num', f: (r) => <b>{rp(r.price)}</b> },
                { t: 'Perubahan', cls: 'ctr', f: (r, i) => {
                  const prev = hist.list[(i ?? 0) + 1];
                  if (!prev || !Number(prev.price)) return <span className="mut">—</span>;
                  const d = ((Number(r.price) - Number(prev.price)) / Number(prev.price)) * 100;
                  return <span className={'bdg2 ' + (d > 0 ? 'b-red' : d < 0 ? 'b-green' : 'b-grey')}>
                    {d > 0 ? '▲' : d < 0 ? '▼' : '='} {Math.abs(d).toFixed(1)}%</span>;
                } },
                { t: 'Sumber', f: (r) => <span className="bdg2 b-brand">{r.source}</span> },
                { t: 'Catatan', f: (r) => <span className="sm mut">{r.note || '-'}</span> },
              ]} />
            {hist.list.length > 1 ? (
              <div className="info-box mt14">
                Rentang harga: <b>{rp(Math.min(...hist.list.map((x) => Number(x.price))))}</b> —{' '}
                <b>{rp(Math.max(...hist.list.map((x) => Number(x.price))))}</b>. Rata-rata{' '}
                <b>{rp(hist.list.reduce((a, b) => a + Number(b.price), 0) / hist.list.length)}</b>.
              </div>) : null}
          </ModalBody>
          <ModalFoot><button className="btn" onClick={() => setHist(null)}>Tutup</button></ModalFoot>
        </>) : null}
      </Modal>

      {/* ---------- tambah produk ke daftar supplier ---------- */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} size="mid">
        <ModalHead title="Tambah Produk ke Daftar Supplier" onClose={() => setAddOpen(false)}
          sub={`${supplierName} · ${belumAda.length} produk belum ada di daftar ini`} />
        <ModalBody>
          <Fg>
            <F label="Cari produk" full>
              <input value={addQ} onChange={(e) => setAddQ(e.target.value)}
                placeholder="Ketik SKU atau nama produk…" /></F>
          </Fg>
          <SecT>Pilih produk ({addPick.length} dipilih)</SecT>
          <div className="tbl-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="tbl"><thead><tr><th style={{ width: 40 }} /><th>SKU</th><th>Produk</th>
              <th className="num">Harga Pokok</th></tr></thead>
              <tbody>{addShown.map((p) => (
                <tr key={p.id}>
                  <td className="ctr"><input type="checkbox" style={{ width: 'auto' }}
                    checked={addPick.includes(p.id)}
                    onChange={(e) => setAddPick(e.target.checked
                      ? [...addPick, p.id] : addPick.filter((x) => x !== p.id))} /></td>
                  <td><span className="doc-no">{p.id}</span></td>
                  <td>{p.name}</td>
                  <td className="num">{rp(p.base_price)}</td>
                </tr>))}
                {!addShown.length ? (
                  <tr><td colSpan={4} className="ctr mut">Tidak ada produk yang cocok.</td></tr>) : null}
              </tbody></table>
          </div>
          {belumAda.length > addShown.length ? (
            <div className="sm mut mt8">Menampilkan {addShown.length} dari {belumAda.length} produk —
              persempit dengan pencarian.</div>) : null}
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setAddOpen(false)}>Batal</button>
          <button className="btn pri" onClick={addProducts} disabled={busy || !addPick.length}>
            Tambahkan {addPick.length ? `(${addPick.length})` : ''}</button>
        </ModalFoot>
      </Modal>
    </>
  );
}
