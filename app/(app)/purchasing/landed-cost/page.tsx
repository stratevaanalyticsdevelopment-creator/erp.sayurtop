'use client';
/* Landed Cost — biaya yang menempel pada barang (transport, bongkar muat,
   sortir) dibebankan ke persediaan, bukan ke beban operasional, sehingga
   HPP mencerminkan biaya barang sampai gudang. */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Card, CardBody, DataTable, F, Fg, Kpi, KpiGrid, Modal, ModalBody, ModalFoot, ModalHead,
  PageHead, SecT,
} from '@/components/ui';
import { DateRange, defaultRange, type Range } from '@/components/filters';
import { LANDED_KINDS } from '@/lib/menu';
import { dFmt, num, rp, rpShort } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import type { GoodsReceipt, GrnLine, LandedCost } from '@/lib/types';

type Row = LandedCost & { grn_no: string };

function LandedPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [grn, setGrn] = useState<GoodsReceipt[]>([]);
  const [costs, setCosts] = useState<Row[]>([]);
  const [range, setRange] = useState<Range>(defaultRange('d30'));
  const [kind, setKind] = useState('ALL');
  const [target, setTarget] = useState<GoodsReceipt | null>(null);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [add, setAdd] = useState<LandedCost[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let q = supabase.from('goods_receipt').select('*')
      .order('grn_date', { ascending: false }).order('no', { ascending: false });
    if (range.from) q = q.gte('grn_date', range.from);
    if (range.to) q = q.lte('grn_date', range.to);
    const { data } = await q;
    const g = (data as GoodsReceipt[]) || [];
    setGrn(g);
    if (g.length) {
      const { data: c } = await supabase.from('landed_cost').select('*')
        .in('grn_no', g.map((x) => x.no)).order('id');
      setCosts((c as Row[]) || []);
    } else setCosts([]);
  }, [supabase, range]);
  useEffect(() => { load(); }, [load]);

  const openAdd = useCallback(async (g: GoodsReceipt) => {
    const { data } = await supabase.from('goods_receipt_line').select('*').eq('grn_no', g.no).order('id');
    setLines((data as GrnLine[]) || []);
    setTarget(g);
    setAdd([{ kind: 'Transport', description: '', amount: 0, alloc_method: 'VALUE' }]);
  }, [supabase]);

  useEffect(() => {
    const g = params.get('grn');
    if (g && grn.length && !target) { const x = grn.find((r) => r.no === g); if (x) openAdd(x); }
  }, [params, grn, target, openAdd]);

  const shown = costs.filter((c) => kind === 'ALL' || c.kind === kind);
  const byKind = new Map<string, number>();
  costs.forEach((c) => byKind.set(c.kind, (byKind.get(c.kind) || 0) + Number(c.amount)));
  const tot = costs.reduce((a, c) => a + Number(c.amount), 0);
  const goods = grn.reduce((a, g) => a + Number(g.goods_total), 0);
  const grnOf = (no: string) => grn.find((g) => g.no === no);

  function exportCsv() {
    downloadCsv('landed',
      ['No GRN', 'Tanggal', 'Supplier', 'Jenis Biaya', 'Keterangan', 'Dasar Alokasi', 'Jumlah',
        'Nilai Barang', 'Rasio %'],
      shown.map((c) => {
        const g = grnOf(c.grn_no);
        const gv = Number(g?.goods_total || 0);
        return [c.grn_no, g?.grn_date || '', s.supp(g?.supplier_code).name, c.kind,
          c.description || '', c.alloc_method === 'QTY' ? 'Per kuantitas' : 'Per nilai barang',
          Number(c.amount), gv, gv ? ((Number(c.amount) / gv) * 100).toFixed(2) : ''];
      }));
  }

  async function save() {
    if (!target) return;
    const valid = add.filter((c) => Number(c.amount) > 0);
    if (!valid.length) { s.toast('Isi jumlah biaya lebih dari 0.', 'err'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('apply_landed_cost', {
      p: { grn_no: target.no, landed: valid },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast('Landed cost dibebankan ulang dan harga pokok diperbarui.', 'ok');
    setTarget(null); await load(); await s.reloadMaster();
  }

  /* Pratinjau pembagian biaya baru ke tiap baris penerimaan. */
  const addVal = add.filter((c) => c.alloc_method === 'VALUE').reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const addQty = add.filter((c) => c.alloc_method === 'QTY').reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const sumVal = lines.reduce((a, l) => a + Number(l.price) * Number(l.qty), 0);
  const sumQty = lines.reduce((a, l) => a + Number(l.qty), 0);
  const preview = (l: GrnLine) =>
    (sumVal > 0 ? (addVal * Number(l.price) * Number(l.qty)) / sumVal : 0)
    + (sumQty > 0 ? (addQty * Number(l.qty)) / sumQty : 0);

  return (
    <>
      <PageHead title="Landed Cost"
        desc="Biaya yang menempel pada barang sampai gudang — transport, bongkar muat, sortir, retribusi. Biaya ini dikapitalisasi ke persediaan dan ikut membentuk HPP, bukan dicatat sebagai beban operasional."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />

      <div className="fbar"><DateRange value={range} onChange={setRange} /></div>
      <div className="fbar">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="ALL">Semua Jenis Biaya</option>
          {LANDED_KINDS.map((k) => <option key={k}>{k}</option>)}
        </select>
        <span className="sm mut">{shown.length} baris biaya pada {grn.length} penerimaan</span>
      </div>

      <KpiGrid>
        <Kpi cls="k-amber" lb="Total Landed Cost" vl={rpShort(tot)} />
        <Kpi cls="k-blue" lb="Nilai Barang" vl={rpShort(goods)} />
        <Kpi cls="k-acc" lb="Rasio terhadap Barang" vl={goods ? num((tot / goods) * 100, 2) + '%' : '-'}
          sb="Semakin tinggi, semakin besar tekanan ke margin" />
        <Kpi cls="k-green" lb="Jenis Biaya Terbesar"
          vl={[...byKind.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—'}
          sb={rpShort([...byKind.entries()].sort((a, b) => b[1] - a[1])[0]?.[1] || 0)} />
      </KpiGrid>

      <Card className="mb12"><CardBody flush>
        <DataTable<Row> rows={shown} rowKey={(r) => String(r.id)}
          emptyT="Belum ada landed cost pada rentang ini"
          emptyD="Biaya dapat diisi saat penerimaan barang, atau ditambahkan menyusul dari halaman ini."
          cols={[
            { t: 'No. GRN', f: (c) => <span className="doc-no">{c.grn_no}</span> },
            { t: 'Tanggal', f: (c) => dFmt(grnOf(c.grn_no)?.grn_date) },
            { t: 'Supplier', f: (c) => s.supp(grnOf(c.grn_no)?.supplier_code).name },
            { t: 'Jenis', f: (c) => <span className="bdg2 b-amber">{c.kind}</span> },
            { t: 'Keterangan', f: (c) => <span className="sm">{c.description || '-'}</span> },
            { t: 'Dasar Alokasi', f: (c) => <span className="sm">
              {c.alloc_method === 'QTY' ? 'Per kuantitas' : 'Per nilai barang'}</span> },
            { t: 'Jumlah', cls: 'num', f: (c) => rp(c.amount) },
          ]}
          foot={<tr><td colSpan={6}>TOTAL</td>
            <td className="num">{rp(shown.reduce((a, c) => a + Number(c.amount), 0))}</td></tr>} />
      </CardBody></Card>

      <Card><CardBody flush>
        <DataTable<GoodsReceipt> rows={grn} rowKey={(g) => g.no}
          onRow={s.can('create') ? openAdd : undefined}
          emptyT="Belum ada penerimaan barang" emptyD="Catat penerimaan lebih dulu di menu Inbound."
          cols={[
            { t: 'Penerimaan', f: (g) => <span className="doc-no">{g.no}</span> },
            { t: 'Tanggal', f: (g) => dFmt(g.grn_date) },
            { t: 'Supplier', f: (g) => s.supp(g.supplier_code).name },
            { t: 'Nilai Barang', cls: 'num', f: (g) => rp(g.goods_total) },
            { t: 'Landed Cost', cls: 'num', f: (g) => (Number(g.landed_total) > 0
              ? rp(g.landed_total) : <span className="mut">belum ada</span>) },
            { t: '%', cls: 'num', f: (g) => (Number(g.goods_total) > 0
              ? num((Number(g.landed_total) / Number(g.goods_total)) * 100, 2) + '%' : '-') },
            { t: '', cls: 'ctr', f: (g) => (s.can('create')
              ? <button className="btn sm" onClick={() => openAdd(g)}>Tambah Biaya</button> : null) },
          ]} />
      </CardBody></Card>

      <Modal open={!!target} onClose={() => setTarget(null)} size="wide">
        {target ? (<>
          <ModalHead title={`Tambah Landed Cost — ${target.no}`} onClose={() => setTarget(null)}
            sub={`${s.supp(target.supplier_code).name} · ${dFmt(target.grn_date)} · landed saat ini ${rp(target.landed_total)}`} />
          <ModalBody>
            {add.map((c, i) => (
              <Fg key={i} c={4}>
                <F label="Jenis">
                  <select value={c.kind} onChange={(e) => setAdd(add.map((x, j) =>
                    (j === i ? { ...x, kind: e.target.value } : x)))}>
                    {LANDED_KINDS.map((k) => <option key={k}>{k}</option>)}
                  </select></F>
                <F label="Keterangan">
                  <input value={c.description || ''} onChange={(e) => setAdd(add.map((x, j) =>
                    (j === i ? { ...x, description: e.target.value } : x)))} /></F>
                <F label="Jumlah">
                  <input type="number" min={0} step={1000} value={c.amount}
                    onChange={(e) => setAdd(add.map((x, j) =>
                      (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} /></F>
                <F label="Dasar Alokasi">
                  <select value={c.alloc_method} onChange={(e) => setAdd(add.map((x, j) =>
                    (j === i ? { ...x, alloc_method: e.target.value as 'VALUE' | 'QTY' } : x)))}>
                    <option value="VALUE">Per nilai barang</option>
                    <option value="QTY">Per kuantitas</option>
                  </select></F>
              </Fg>
            ))}
            <button className="btn sm mt14" onClick={() => setAdd([...add,
              { kind: 'Lain-lain', description: '', amount: 0, alloc_method: 'VALUE' }])}>+ Baris Biaya</button>

            <SecT>Pratinjau Pembebanan</SecT>
            <DataTable<GrnLine> rows={lines} cols={[
              { t: 'Produk', f: (l) => <>{l.product_id} — {l.name}</> },
              { t: 'Qty', cls: 'num', f: (l) => num(l.qty, 0) },
              { t: 'Biaya / Unit Kini', cls: 'num', f: (l) => rp(l.unit_cost, 2) },
              { t: 'Tambahan', cls: 'num', f: (l) => rp(preview(l)) },
              { t: 'Biaya / Unit Baru', cls: 'num', f: (l) => <b>
                {rp(Number(l.unit_cost) + preview(l) / Math.max(Number(l.qty), 1), 2)}</b> },
            ]} />
            <div className="warn-box mt14">Penambahan biaya menghitung ulang seluruh alokasi pada penerimaan ini,
              memperbarui harga pokok master produk, dan memposting jurnal koreksi persediaan.
              Faktur penjualan yang sudah terbit <b>tidak</b> ikut dihitung ulang.</div>
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setTarget(null)}>Batal</button>
            <button className="btn pri" onClick={save} disabled={busy}>Simpan &amp; Posting Jurnal</button>
          </ModalFoot>
        </>) : null}
      </Modal>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><LandedPage /></Suspense>;
}
