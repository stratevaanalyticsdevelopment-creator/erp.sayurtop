'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, F, Fg, Kpi, KpiGrid, Modal, ModalBody, ModalFoot,
  ModalHead, PageHead, SecT,
} from '@/components/ui';
import { CATEGORIES, UNITS } from '@/lib/menu';
import { dFmt, num, rp, rpShort } from '@/lib/format';
import type { Invoice, Product } from '@/lib/types';

type Stat = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'LOW';
type Sort = 'id' | 'name' | 'price' | 'stock';
type Affected = {
  jenis: string; no: string; customer_code: string; name: string; unit: string;
  qty: number; net: number; base: number; gap: number; loss: number; status: string;
};

function ProductPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const [stat, setStat] = useState<Stat>('ALL');
  const [sort, setSort] = useState<Sort>('id');
  const [detail, setDetail] = useState<Product | null>(null);
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [bulkForm, setBulkForm] = useState({ cat: 'ALL', field: 'sell', pct: 5, round: 100 });
  const [affected, setAffected] = useState<{ rows: Affected[]; headline: string } | null>(null);

  useEffect(() => {
    const doc = params.get('doc');
    if (doc) { const p = s.prod(doc); if (p) setDetail(p); }
  }, [params, s]);

  const rows = useMemo(() => {
    const out = s.products.filter((p) => {
      if (cat !== 'ALL' && p.category !== cat) return false;
      if (stat === 'ACTIVE' && !p.active) return false;
      if (stat === 'INACTIVE' && p.active) return false;
      if (stat === 'LOW' && Number(p.stock) > Number(p.min_stock)) return false;
      const t = q.toLowerCase();
      return !t || p.id.toLowerCase().includes(t) || p.name.toLowerCase().includes(t) ||
        (p.description || '').toLowerCase().includes(t);
    });
    out.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'price' ? b.sell_price - a.sell_price
        : sort === 'stock' ? a.stock - b.stock
        : a.id.localeCompare(b.id));
    return out;
  }, [s.products, q, cat, stat, sort]);

  const invVal = s.products.reduce((a, p) => a + p.stock * p.base_price, 0);
  const lowN = s.products.filter((p) => Number(p.stock) <= Number(p.min_stock)).length;
  const avgMargin = (() => {
    const m = s.products.filter((p) => p.sell_price > 0);
    return m.reduce((a, p) => a + ((p.sell_price - p.base_price) / p.sell_price) * 100, 0) / (m.length || 1);
  })();
  const byCat = new Map<string, number>();
  s.products.forEach((p) => byCat.set(p.category, (byCat.get(p.category) || 0) + 1));

  function openEdit(p: Product | null) {
    if (!s.can(p ? 'edit' : 'create')) { s.toast('Tidak memiliki hak akses.', 'err'); return; }
    setIsNew(!p);
    setEdit(p ? { ...p } : {
      id: '', category: 'SAY', category_name: 'Sayur-Sayuran', name: '', description: '',
      sell_price: 0, base_price: 0, unit: 'Kg', tax_rate: 11, stock: 0, min_stock: 0, active: true,
    });
  }

  /* Setelah harga pokok berubah, periksa dokumen berjalan yang harga jualnya
     menjadi di bawah harga pokok baru. */
  async function checkAffected(ids: string[], headline: string) {
    const [so, iv] = await Promise.all([
      supabase.from('sales_order').select('no,status,customer_code').not('status', 'in', '("CANCELLED","PAID","CLOSED")'),
      supabase.from('invoice_view').select('no,customer_code,calc_status,outstanding').gt('outstanding', 0),
    ]);
    const soNos = ((so.data as { no: string; status: string; customer_code: string }[]) || []);
    const ivNos = ((iv.data as Invoice[]) || []);
    const [sl, il] = await Promise.all([
      supabase.from('sales_order_line').select('order_no,product_id,name,unit,qty,price,disc_pct').in('product_id', ids),
      supabase.from('invoice_line').select('invoice_no,product_id,name,unit,qty,ret_qty,price,disc_pct').in('product_id', ids),
    ]);
    const out: Affected[] = [];
    const push = (jenis: string, no: string, cust: string, st: string, l: {
      product_id: string; name: string; unit: string; qty: number; price: number; disc_pct: number;
    }) => {
      const p = s.prod(l.product_id); if (!p || !p.base_price) return;
      const net = Number(l.price) * (1 - Number(l.disc_pct || 0) / 100);
      if (net >= p.base_price) return;
      const gap = p.base_price - net;
      out.push({ jenis, no, customer_code: cust, name: l.name, unit: l.unit, qty: Number(l.qty),
        net, base: p.base_price, gap, loss: Math.round(gap * Number(l.qty)), status: st });
    };
    ((sl.data as { order_no: string; product_id: string; name: string; unit: string; qty: number; price: number; disc_pct: number }[]) || [])
      .forEach((l) => { const o = soNos.find((x) => x.no === l.order_no); if (o) push('Sales Order', o.no, o.customer_code, o.status, l); });
    ((il.data as { invoice_no: string; product_id: string; name: string; unit: string; qty: number; ret_qty: number; price: number; disc_pct: number }[]) || [])
      .forEach((l) => { const i = ivNos.find((x) => x.no === l.invoice_no); if (i) push('Invoice', i.no, i.customer_code, i.calc_status || i.status, l); });
    out.sort((a, b) => b.loss - a.loss);
    if (!out.length) { s.toast(headline + ' Tidak ada dokumen berjalan yang harga jualnya di bawah harga pokok.', 'ok'); return; }
    setAffected({ rows: out, headline });
  }

  async function saveProduct() {
    if (!edit?.name?.trim()) { s.toast('Nama produk wajib diisi.', 'err'); return; }
    const cat2 = edit.category || 'SAY';
    const catName = CATEGORIES.find((c) => c.code === cat2)?.name || cat2;
    const id = (edit.id || '').trim() || genSKU(cat2);
    const before = s.prod(id);
    const payload = {
      id, category: cat2, category_name: catName, name: edit.name.trim(),
      description: edit.description || null, unit: edit.unit || 'Kg',
      sell_price: Number(edit.sell_price) || 0, base_price: Number(edit.base_price) || 0,
      tax_rate: Number(edit.tax_rate) || 0, stock: Number(edit.stock) || 0,
      min_stock: Number(edit.min_stock) || 0, active: edit.active !== false,
    };
    setBusy(true);
    const { error } = isNew
      ? await supabase.from('product').insert(payload)
      : await supabase.from('product').update(payload).eq('id', id);
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Produk ${id} ${isNew ? 'ditambahkan' : 'diperbarui'}.`, 'ok');
    const baseChanged = !isNew && before && Number(before.base_price) !== payload.base_price;
    setEdit(null);
    await s.reloadMaster();
    if (baseChanged && before) {
      await checkAffected([id],
        `Harga pokok ${payload.name} berubah dari ${rp(before.base_price)} menjadi ${rp(payload.base_price)}.`);
    }
  }

  function genSKU(c: string) {
    let n = s.products.filter((p) => p.category === c).length + 1;
    let id = '';
    do { id = c + '-' + String(n).padStart(4, '0'); n++; } while (s.products.some((p) => p.id === id));
    return id;
  }

  async function applyBulk() {
    const targets = s.products.filter((p) => bulkForm.cat === 'ALL' || p.category === bulkForm.cat);
    const rd = bulkForm.round || 1;
    const changed: string[] = [];
    setBusy(true);
    for (const p of targets) {
      const upd: Record<string, number> = {};
      if (bulkForm.field === 'sell' || bulkForm.field === 'both')
        upd.sell_price = Math.round((p.sell_price * (1 + bulkForm.pct / 100)) / rd) * rd;
      if (bulkForm.field === 'base' || bulkForm.field === 'both') {
        upd.base_price = Math.round((p.base_price * (1 + bulkForm.pct / 100)) / rd) * rd;
        if (upd.base_price !== p.base_price) changed.push(p.id);
      }
      await supabase.from('product').update(upd).eq('id', p.id);
    }
    setBusy(false); setBulk(false);
    s.toast(`${targets.length} produk diperbarui.`, 'ok');
    await s.reloadMaster();
    if (changed.length) await checkAffected(changed, `Harga pokok ${changed.length} produk diubah ${num(bulkForm.pct, 1)}%.`);
  }

  const margin = edit && Number(edit.sell_price)
    ? ((Number(edit.sell_price) - Number(edit.base_price)) / Number(edit.sell_price)) * 100 : null;

  return (
    <>
      <PageHead title="Master Produk"
        desc={`Katalog produk Sayur Top — ${num(s.products.length, 0)} SKU. Harga jual, harga pokok, satuan, pajak, dan stok minimum dapat diubah; perubahan langsung dipakai dokumen baru.`}
        actions={<>
          {s.can('create') ? <button className="btn pri" onClick={() => openEdit(null)}>+ Produk Baru</button> : null}
          {s.can('edit') ? <button className="btn" onClick={() => setBulk(true)}>% Update Harga Massal</button> : null}
        </>} />

      <KpiGrid>
        <Kpi cls="k-blue" lb="Total SKU" vl={num(s.products.length, 0)}
          sb={`${num(s.products.filter((p) => p.active).length, 0)} aktif`} />
        <Kpi cls="k-green" lb="Nilai Persediaan" vl={rpShort(invVal)} sb="Stok × harga pokok" />
        <Kpi cls={lowN ? 'k-red' : 'k-green'} lb="Di Bawah Stok Minimum" vl={`${num(lowN, 0)} SKU`} sb="Perlu pembelian" />
        <Kpi cls="k-acc" lb="Margin Rata-rata" vl={num(avgMargin, 1) + '%'} sb="Harga jual vs harga pokok" />
      </KpiGrid>

      <div className="fbar">
        <input className="grow" placeholder="Cari SKU, nama produk, atau keterangan…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="ALL">Semua Kategori ({s.products.length})</option>
          {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({byCat.get(c.code) || 0})</option>)}
        </select>
        <select value={stat} onChange={(e) => setStat(e.target.value as Stat)}>
          <option value="ALL">Semua Status</option><option value="ACTIVE">Aktif</option>
          <option value="INACTIVE">Nonaktif</option><option value="LOW">Stok Menipis</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="id">Urut SKU</option><option value="name">Urut Nama</option>
          <option value="price">Harga Tertinggi</option><option value="stock">Stok Terendah</option>
        </select>
        <span className="sm mut">{rows.length} produk</span>
      </div>

      <Card><CardBody flush>
        <DataTable<Product> rows={rows} rowKey={(r) => r.id} onRow={(p) => setDetail(p)}
          emptyT="Produk tidak ditemukan" emptyD="Ubah kata kunci atau filter kategori."
          cols={[
            { t: 'SKU', f: (r) => <span className="doc-no">{r.id}</span> },
            { t: 'Nama Produk', f: (r) => <>{r.name}{r.description ? <div className="sm mut">{r.description}</div> : null}</> },
            { t: 'Kategori', f: (r) => <span className="bdg2 b-brand">{r.category_name}</span> },
            { t: 'Satuan', f: (r) => r.unit },
            { t: 'Harga Pokok', cls: 'num', f: (r) => rp(r.base_price) },
            { t: 'Harga Jual', cls: 'num', f: (r) => <b>{rp(r.sell_price)}</b> },
            { t: 'Margin', cls: 'num', f: (r) => r.sell_price ? num(((r.sell_price - r.base_price) / r.sell_price) * 100, 1) + '%' : '-' },
            { t: 'PPN', cls: 'ctr', f: (r) => num(r.tax_rate, 0) + '%' },
            { t: 'Stok', cls: 'num', f: (r) => {
              const low = Number(r.stock) <= Number(r.min_stock);
              return <><span style={{ color: low ? 'var(--red)' : 'inherit', fontWeight: low ? 700 : 400 }}>{num(r.stock, 0)}</span>
                <div className="sm mut">min {num(r.min_stock, 0)}</div></>;
            } },
            { t: 'Status', f: (r) => r.active ? <span className="bdg2 b-green">Aktif</span> : <span className="bdg2 b-grey">Nonaktif</span> },
            { t: '', cls: 'ctr', f: (r) => s.can('edit')
              ? <button className="btn sm" onClick={() => openEdit(r)}>Edit</button> : null },
          ]} />
      </CardBody></Card>

      {/* DETAIL PRODUK */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead title={detail.name} sub={`${detail.id} · ${detail.category_name} · ${detail.unit}`}
            onClose={() => setDetail(null)} />
          <ModalBody>
            <KpiGrid>
              <Kpi cls="k-blue" lb="Harga Jual" vl={rp(detail.sell_price)} sb={`Harga pokok ${rp(detail.base_price)}`} />
              <Kpi cls="k-green" lb="Margin"
                vl={detail.sell_price ? num(((detail.sell_price - detail.base_price) / detail.sell_price) * 100, 1) + '%' : '-'}
                sb={`${rp(detail.sell_price - detail.base_price)} per ${detail.unit}`} />
              <Kpi cls={Number(detail.stock) <= Number(detail.min_stock) ? 'k-red' : 'k-green'}
                lb="Stok Tersedia" vl={`${num(detail.stock, 0)} ${detail.unit}`} sb={`Minimum ${num(detail.min_stock, 0)}`} />
              <Kpi cls="k-acc" lb="PPN" vl={num(detail.tax_rate, 0) + '%'} sb={detail.active ? 'Produk aktif' : 'Nonaktif'} />
            </KpiGrid>
            {detail.description ? <div className="info-box mb12"><b>Keterangan:</b> {detail.description}</div> : null}
          </ModalBody>
          <ModalFoot>
            {s.can('edit') ? <button className="btn pri" onClick={() => { const d = detail; setDetail(null); openEdit(d); }}>✎ Edit Produk</button> : null}
            <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      {/* FORM PRODUK */}
      <Modal open={!!edit} onClose={() => setEdit(null)} size="mid">
        {edit ? (<>
          <ModalHead title={isNew ? 'Produk Baru' : 'Edit Produk'}
            sub={isNew ? 'SKU dibuat otomatis mengikuti kode kategori.'
              : `${edit.id} — perubahan berlaku untuk dokumen baru; dokumen yang sudah terbit tidak berubah.`}
            onClose={() => setEdit(null)} />
          <ModalBody>
            <SecT>Identitas Produk</SecT>
            <Fg>
              <F label="SKU / ID Produk"><input value={edit.id || ''} disabled={!isNew} placeholder="otomatis"
                onChange={(e) => setEdit({ ...edit, id: e.target.value })} /></F>
              <F label="Kategori"><select value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></F>
              <F label="Nama Produk" full><input value={edit.name || ''} placeholder="cth. Brokoli Bersih"
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></F>
              <F label="Keterangan" full><input value={edit.description || ''} placeholder="cth. per pack 200 gr"
                onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></F>
              <F label="Satuan"><select value={edit.unit || 'Kg'} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}</select></F>
              <F label="PPN (%)"><select value={String(edit.tax_rate ?? 11)}
                onChange={(e) => setEdit({ ...edit, tax_rate: Number(e.target.value) })}>
                <option value="11">11% — PPN Keluaran</option><option value="0">0% — Non PPN</option></select></F>
            </Fg>
            <SecT>Harga</SecT>
            <Fg c={3}>
              <F label="Harga Pokok / Base Price"><input type="number" value={edit.base_price ?? 0}
                onChange={(e) => setEdit({ ...edit, base_price: Number(e.target.value) })} /></F>
              <F label="Harga Jual / Selling Price"><input type="number" value={edit.sell_price ?? 0}
                onChange={(e) => setEdit({ ...edit, sell_price: Number(e.target.value) })} /></F>
              <F label="Margin"><input disabled value={margin === null ? '-' :
                `${num(margin, 1)}%  (${rp(Number(edit.sell_price) - Number(edit.base_price))} per unit)`} /></F>
            </Fg>
            {Number(edit.sell_price) > 0 && Number(edit.base_price) > Number(edit.sell_price) ? (
              <div className="warn-box mt14">Harga pokok lebih tinggi dari harga jual — produk ini akan menghasilkan margin negatif.</div>
            ) : null}
            <SecT>Persediaan</SecT>
            <Fg c={3}>
              <F label="Stok Saat Ini"><input type="number" value={edit.stock ?? 0}
                onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value) })} /></F>
              <F label="Stok Minimum"><input type="number" value={edit.min_stock ?? 0}
                onChange={(e) => setEdit({ ...edit, min_stock: Number(e.target.value) })} /></F>
              <F label="Status"><select value={edit.active === false ? '0' : '1'}
                onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}>
                <option value="1">Aktif — dapat dijual</option>
                <option value="0">Nonaktif — tidak muncul di dokumen baru</option></select></F>
            </Fg>
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setEdit(null)}>Batal</button>
            <button className="btn pri" onClick={saveProduct} disabled={busy}>Simpan Produk</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      {/* UPDATE HARGA MASSAL */}
      <Modal open={bulk} onClose={() => setBulk(false)} size="mid">
        <ModalHead title="Update Harga Massal"
          sub="Menaikkan atau menurunkan harga sejumlah persen untuk kategori tertentu."
          onClose={() => setBulk(false)} />
        <ModalBody>
          <Fg>
            <F label="Kategori"><select value={bulkForm.cat} onChange={(e) => setBulkForm({ ...bulkForm, cat: e.target.value })}>
              <option value="ALL">Semua Kategori</option>
              {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></F>
            <F label="Harga yang Diubah"><select value={bulkForm.field} onChange={(e) => setBulkForm({ ...bulkForm, field: e.target.value })}>
              <option value="sell">Harga Jual</option><option value="base">Harga Pokok</option>
              <option value="both">Keduanya</option></select></F>
            <F label="Perubahan (%)"><input type="number" value={bulkForm.pct}
              onChange={(e) => setBulkForm({ ...bulkForm, pct: Number(e.target.value) })} /></F>
            <F label="Pembulatan"><select value={String(bulkForm.round)}
              onChange={(e) => setBulkForm({ ...bulkForm, round: Number(e.target.value) })}>
              <option value="100">Ke Rp 100 terdekat</option><option value="500">Ke Rp 500 terdekat</option>
              <option value="1000">Ke Rp 1.000 terdekat</option><option value="1">Tanpa pembulatan</option></select></F>
          </Fg>
          <div className="info-box mt14">
            <b>{s.products.filter((p) => bulkForm.cat === 'ALL' || p.category === bulkForm.cat).length} produk</b>{' '}
            akan diperbarui sebesar {num(bulkForm.pct, 1)}%. Perubahan tidak memengaruhi dokumen yang sudah terbit.
          </div>
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setBulk(false)}>Batal</button>
          <button className="btn pri" onClick={applyBulk} disabled={busy}>Terapkan</button>
        </ModalFoot>
      </Modal>

      {/* DOKUMEN TERDAMPAK PERUBAHAN HARGA POKOK */}
      <Modal open={!!affected} onClose={() => setAffected(null)} size="wide">
        {affected ? (<>
          <ModalHead title="⚠ Dokumen Terdampak Perubahan Harga Pokok" sub={affected.headline}
            onClose={() => setAffected(null)} />
          <ModalBody>
            <div className="warn-box mb12">
              Harga jual pada dokumen berjalan berikut kini <b>di bawah harga pokok</b>. Total potensi kerugian{' '}
              <b>{rp(affected.rows.reduce((a, b) => a + b.loss, 0))}</b> bila dokumen tetap dijalankan dengan harga sekarang.
            </div>
            <DataTable<Affected> rows={affected.rows} cols={[
              { t: 'Jenis', f: (r) => <span className="bdg2 b-brand">{r.jenis}</span> },
              { t: 'Nomor', f: (r) => <span className="doc-no">{r.no}</span> },
              { t: 'Customer', f: (r) => <span className="sm">{s.cust(r.customer_code).name}</span> },
              { t: 'Produk', f: (r) => r.name },
              { t: 'Qty', cls: 'num', f: (r) => num(r.qty, 0) + ' ' + r.unit },
              { t: 'Harga Jual', cls: 'num', f: (r) => rp(r.net) },
              { t: 'Harga Pokok', cls: 'num', f: (r) => rp(r.base) },
              { t: 'Rugi/Unit', cls: 'num', f: (r) => <span style={{ color: 'var(--red)' }}>{rp(r.gap)}</span> },
              { t: 'Total Rugi', cls: 'num', f: (r) => <b style={{ color: 'var(--red)' }}>{rp(r.loss)}</b> },
              { t: 'Status', f: (r) => <Badge st={r.status} /> },
            ]} />
          </ModalBody>
          <ModalFoot><button className="btn" onClick={() => setAffected(null)}>Tutup</button></ModalFoot>
        </>) : null}
      </Modal>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><ProductPage /></Suspense>;
}
