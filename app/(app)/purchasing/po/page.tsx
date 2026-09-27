'use client';
/* Purchase Order — dua tab.

   Kebutuhan Pembelian: Sales Order yang sudah disetujui tapi barangnya belum
   dipesan ke supplier, dikelompokkan per produk. Pembeli memilih supplier dan
   qty, lalu menerbitkan PO — satu PO per supplier, boleh menggabungkan
   kebutuhan beberapa Sales Order.

   Daftar PO: PO yang sudah terbit, beserta alokasi tiap barisnya ke Sales
   Order yang memicunya. */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, F, Fg, Kpi, KpiGrid, Kv, Modal, ModalBody, ModalFoot,
  ModalHead, PageHead, SecT, Tabs,
} from '@/components/ui';
import { DateRange, defaultRange, type Range } from '@/components/filters';
import { CATEGORIES } from '@/lib/menu';
import { dFmt, dFmtL, num, rp, rpShort } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import { PrintPO } from '@/components/print-docs';
import type { PoLine, PurchaseOrder } from '@/lib/types';

/* ---------- BENTUK DATA ---------- */
type DemandLine = {
  so_line_id: number; order_no: string; order_date: string; delivery_date: string;
  order_status: string; customer_code: string; customer_name: string; warehouse_code: string;
  product_id: string; product_name: string; category: string; category_name: string;
  unit: string; stock: number; default_supplier_code: string | null;
  qty_order: number; qty_delivered: number; qty_ordered: number; qty_needed: number;
};
type SupOption = {
  product_id: string; supplier_code: string; supplier_name: string; supplier_type: string;
  price: number; price_source: string; price_date: string | null;
  is_preferred: boolean; lead_time_days: number; min_order_qty: number;
  capacity_per_day: number; term_code: string;
  murah?: boolean;
};
type Grp = {
  pid: string; name: string; cat: string; catName: string; unit: string; stock: number;
  qty: number; beli: number; earliest: string; latest: string;
  nCust: number; nSO: number; lines: DemandLine[]; sups: SupOption[];
};
type Alloc = {
  po_no: string; po_line_id: number; line_no: number; product_id: string;
  product_name: string; unit: string; qty_po: number; qty_alokasi: number;
  order_no: string; customer_code: string; customer_name: string; delivery_date: string;
};

/* Kelompok per produk. Stok dikurangkan di tingkat produk, bukan per baris
   order: stok satu produk melayani order mana saja, jadi menguranginya per
   baris akan menghitung stok yang sama berulang kali. */
function groupDemand(lines: DemandLine[], opts: Map<string, SupOption[]>): Grp[] {
  const m = new Map<string, Grp>();
  lines.forEach((r) => {
    let g = m.get(r.product_id);
    if (!g) {
      g = { pid: r.product_id, name: r.product_name, cat: r.category, catName: r.category_name,
        unit: r.unit, stock: Number(r.stock) || 0, qty: 0, beli: 0,
        earliest: r.delivery_date, latest: r.delivery_date,
        nCust: 0, nSO: 0, lines: [], sups: [] };
      m.set(r.product_id, g);
    }
    g.qty += Number(r.qty_needed) || 0;
    g.lines.push(r);
    if (r.delivery_date < g.earliest) g.earliest = r.delivery_date;
    if (r.delivery_date > g.latest) g.latest = r.delivery_date;
  });
  const out = [...m.values()];
  out.forEach((g) => {
    g.beli = Math.max(0, g.qty - g.stock);
    g.nCust = new Set(g.lines.map((l) => l.customer_code)).size;
    g.nSO = new Set(g.lines.map((l) => l.order_no)).size;
    const sups = (opts.get(g.pid) || []).map((x) => ({ ...x, price: Number(x.price) }));
    const murah = sups.reduce<number | null>((a, x) => (a === null || x.price < a ? x.price : a), null);
    sups.forEach((x) => { x.murah = x.price === murah; });
    g.sups = sups;
    g.lines.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date)
      || a.customer_name.localeCompare(b.customer_name));
  });
  return out.sort((a, b) => a.earliest.localeCompare(b.earliest) || b.beli - a.beli
    || a.name.localeCompare(b.name));
}

function todayJkt() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}
function dAdd(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function PoPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<'need' | 'list' | null>(null);

  /* ---------- KEBUTUHAN PEMBELIAN ---------- */
  const [demLines, setDemLines] = useState<DemandLine[]>([]);
  const [demOpts, setDemOpts] = useState<Map<string, SupOption[]>>(new Map());
  const [demLoaded, setDemLoaded] = useState(false);
  const [dFrom, setDFrom] = useState(todayJkt());
  const [dTo, setDTo] = useState(dAdd(todayJkt(), 6));
  const [dCat, setDCat] = useState('ALL');
  const [dOnly, setDOnly] = useState<'BELI' | 'ALL'>('BELI');
  const [dQ, setDQ] = useState('');
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [qtySel, setQtySel] = useState<Record<string, number>>({});
  const [supSel, setSupSel] = useState<Record<string, string>>({});
  const [priceSel, setPriceSel] = useState<Record<string, number>>({});
  const [demDetail, setDemDetail] = useState<Grp | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pcDate, setPcDate] = useState(todayJkt());
  const [pcExp, setPcExp] = useState(dAdd(todayJkt(), 1));
  const [pcWh, setPcWh] = useState('');
  const [pcNote, setPcNote] = useState('');

  /* ---------- DAFTAR PO ---------- */
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [lineIdx, setLineIdx] = useState<Map<string, PoLine[]>>(new Map());
  const [srcIdx, setSrcIdx] = useState<Map<string, string[]>>(new Map());
  const [range, setRange] = useState<Range>(defaultRange('d30'));
  const [sup, setSup] = useState('ALL');
  const [cat, setCat] = useState('ALL');
  const [prod, setProd] = useState('ALL');
  const [st, setSt] = useState('ALL');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);
  const [alloc, setAlloc] = useState<Alloc[]>([]);
  const [print, setPrint] = useState<PurchaseOrder | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDemand = useCallback(async () => {
    const [ld, lo] = await Promise.all([
      supabase.from('purchase_demand_line_view').select('*'),
      supabase.rpc('demand_supplier_options', { p_date: todayJkt() }),
    ]);
    setDemLines((ld.data as DemandLine[]) || []);
    const m = new Map<string, SupOption[]>();
    ((lo.data as SupOption[]) || []).forEach((o) => {
      m.set(o.product_id, [...(m.get(o.product_id) || []), o]);
    });
    setDemOpts(m);
    setDemLoaded(true);
  }, [supabase]);

  const load = useCallback(async () => {
    let query = supabase.from('purchase_order').select('*')
      .order('po_date', { ascending: false }).order('no', { ascending: false });
    if (range.from) query = query.gte('po_date', range.from);
    if (range.to) query = query.lte('po_date', range.to);
    const { data } = await query;
    const po = (data as PurchaseOrder[]) || [];
    setRows(po);
    if (po.length) {
      const nos = po.map((x) => x.no);
      const [ld, sv] = await Promise.all([
        supabase.from('purchase_order_line').select('*').in('po_no', nos),
        supabase.from('purchase_order_source_view').select('po_no, order_nos').in('po_no', nos),
      ]);
      const m = new Map<string, PoLine[]>();
      ((ld.data as (PoLine & { po_no: string })[]) || []).forEach((l) => {
        m.set(l.po_no, [...(m.get(l.po_no) || []), l]);
      });
      setLineIdx(m);
      const sm = new Map<string, string[]>();
      ((sv.data as { po_no: string; order_nos: string[] }[]) || []).forEach((r) => {
        sm.set(r.po_no, r.order_nos || []);
      });
      setSrcIdx(sm);
    } else { setLineIdx(new Map()); setSrcIdx(new Map()); }
  }, [supabase, range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDemand(); }, [loadDemand]);
  useEffect(() => { if (!pcWh && s.warehouses.length) setPcWh(s.warehouses[0].code); }, [s.warehouses, pcWh]);

  const openDetail = useCallback(async (po: PurchaseOrder) => {
    const [ld, la] = await Promise.all([
      supabase.from('purchase_order_line').select('*').eq('po_no', po.no).order('line_no'),
      supabase.from('po_allocation_view').select('*').eq('po_no', po.no),
    ]);
    setAlloc((la.data as Alloc[]) || []);
    setDetail({ ...po, lines: (ld.data as PoLine[]) || [] });
  }, [supabase]);

  useEffect(() => {
    const doc = params.get('doc');
    if (doc && rows.length) { const p = rows.find((x) => x.no === doc); if (p) { setTab('list'); openDetail(p); } }
  }, [params, rows, openDetail]);

  /* ---------- TURUNAN: KEBUTUHAN ---------- */
  const inRange = demLines.filter((r) => r.delivery_date >= dFrom && r.delivery_date <= dTo);
  const demFiltered = inRange.filter((r) => {
    if (dCat !== 'ALL' && r.category_name !== dCat) return false;
    const t = dQ.toLowerCase();
    return !t || r.product_id.toLowerCase().includes(t) || r.product_name.toLowerCase().includes(t)
      || r.customer_name.toLowerCase().includes(t) || r.order_no.toLowerCase().includes(t);
  });
  const allGroups = groupDemand(demFiltered, demOpts);
  const groups = dOnly === 'BELI' ? allGroups.filter((g) => g.beli > 0) : allGroups;
  const nPerlu = groupDemand(inRange, demOpts).filter((g) => g.beli > 0).length;
  const demCats = [...new Set(inRange.map((r) => r.category_name))].filter(Boolean).sort();

  /* Tab awal ditentukan setelah data kebutuhan selesai dimuat. Kalau
     diputuskan lebih awal, nPerlu masih nol dan tab selalu jatuh ke Daftar PO
     meski ada barang yang menunggu dipesan. */
  useEffect(() => { if (tab === null && demLoaded) setTab(nPerlu ? 'need' : 'list'); },
    [tab, nPerlu, demLoaded]);

  const supOf = (g: Grp) => (supSel[g.pid] && g.sups.some((x) => x.supplier_code === supSel[g.pid])
    ? supSel[g.pid] : (g.sups.length ? g.sups[0].supplier_code : ''));
  const supRow = (g: Grp) => g.sups.find((x) => x.supplier_code === supOf(g)) || null;
  const qtyOfG = (g: Grp) => (qtySel[g.pid] !== undefined ? qtySel[g.pid] : g.beli);
  const priceOfG = (g: Grp) => {
    if (priceSel[g.pid] !== undefined) return priceSel[g.pid];
    const x = supRow(g); return x ? Number(x.price) : 0;
  };

  /* Keterangan singkat supplier terpilih: batas minimum pesan dan kapasitas
     harian, dua hal yang paling sering membuat PO ditolak supplier. */
  const supInfo = (g: Grp) => {
    const x = supRow(g);
    if (!x) return null;
    const qv = qtyOfG(g);
    const bits: string[] = [];
    if (x.is_preferred) bits.push('supplier utama');
    if (Number(x.min_order_qty) > 0) bits.push(`min ${num(x.min_order_qty, 0)} ${g.unit}`);
    if (Number(x.capacity_per_day) > 0) bits.push(`kapasitas ${num(x.capacity_per_day, 0)}/hari`);
    bits.push(`lead ${x.lead_time_days} hari`);
    return (<>
      {bits.join(' · ')}
      {Number(x.min_order_qty) > 0 && qv > 0 && qv < Number(x.min_order_qty)
        ? <span className="bdg2 b-amber" style={{ marginLeft: 6 }}>di bawah minimum</span> : null}
      {Number(x.capacity_per_day) > 0 && qv > Number(x.capacity_per_day)
        ? <span className="bdg2 b-red" style={{ marginLeft: 6 }}>melebihi kapasitas</span> : null}
    </>);
  };

  const selGroups = allGroups.filter((g) => sel[g.pid] && qtyOfG(g) > 0 && g.sups.length);
  const bySup = new Map<string, Grp[]>();
  selGroups.forEach((g) => {
    const c = supOf(g); bySup.set(c, [...(bySup.get(c) || []), g]);
  });
  const supKeys = [...bySup.keys()].sort((a, b) => s.supp(a).name.localeCompare(s.supp(b).name));
  const selTotal = selGroups.reduce((a, g) => a + Math.round(qtyOfG(g) * priceOfG(g)), 0);
  const selQty = selGroups.reduce((a, g) => a + qtyOfG(g), 0);

  const tKeb = groups.reduce((a, g) => a + g.qty, 0);
  const tBeli = groups.reduce((a, g) => a + g.beli, 0);
  const tStok = groups.reduce((a, g) => a + Math.min(g.stock, g.qty), 0);
  const nBeliTampil = groups.filter((g) => g.beli > 0).length;
  const tanpaSup = groups.filter((g) => !g.sups.length).length;
  const nSOdem = new Set(demFiltered.map((r) => r.order_no)).size;
  const nCustDem = new Set(demFiltered.map((r) => r.customer_code)).size;

  function openCreate() {
    if (!selGroups.length) { s.toast('Belum ada produk yang dipilih untuk dipesan.', 'err'); return; }
    let lead = 1;
    selGroups.forEach((g) => { const x = supRow(g); if (x && x.lead_time_days > lead) lead = x.lead_time_days; });
    setPcDate(todayJkt()); setPcExp(dAdd(todayJkt(), lead)); setPcNote('');
    setCreateOpen(true);
  }

  async function terbitkan() {
    setBusy(true);
    const made: string[] = []; const gagal: string[] = [];
    for (const c of supKeys) {
      const payload = {
        supplier_code: c, po_date: pcDate, expected_date: pcExp,
        warehouse_code: pcWh, note: pcNote.trim() || null,
        lines: (bySup.get(c) || []).map((g) => ({
          product_id: g.pid, qty: qtyOfG(g), price: priceOfG(g) })),
      };
      const { data, error } = await supabase.rpc('create_purchase_order', { p: payload });
      if (error) gagal.push(`${s.supp(c).name}: ${errMsg(error)}`);
      else made.push(data as string);
    }
    setBusy(false);
    if (made.length) {
      /* Baris yang sudah dipesan dilepas dari pilihan agar tidak terbit dua kali. */
      setSel({}); setQtySel({}); setPriceSel({});
      setCreateOpen(false);
      s.toast(`${made.length} Purchase Order diterbitkan: ${made.join(', ')}`, 'ok');
      await Promise.all([load(), loadDemand()]);
      setTab('list');
    }
    if (gagal.length) s.toast('Gagal: ' + gagal.join(' · '), 'err');
  }

  function exportDemand() {
    const out: (string | number)[][] = [];
    groups.forEach((g) => {
      const x = supRow(g);
      g.lines.forEach((r) => {
        out.push([g.pid, g.name, g.catName, g.unit, r.order_no, r.customer_name, r.delivery_date,
          r.order_status, Number(r.qty_order), Number(r.qty_delivered), Number(r.qty_ordered),
          Number(r.qty_needed), g.qty, g.stock, g.beli,
          x ? x.supplier_name : '', x ? priceOfG(g) : '', x ? x.price_source : '',
          x ? Number(x.min_order_qty) : '', x ? Number(x.capacity_per_day) : '', g.sups.length]);
      });
    });
    downloadCsv('kebutuhan-pembelian', ['SKU', 'Produk', 'Kategori', 'Satuan', 'No SO', 'Customer',
      'Tgl Kirim', 'Status Order', 'Qty Order', 'Sudah Kirim', 'Sudah Dipesan', 'Perlu Dibeli Baris',
      'Kebutuhan Produk', 'Stok', 'Perlu Beli Produk', 'Supplier Terpilih', 'Harga', 'Sumber Harga',
      'Min Pesan', 'Kapasitas/hari', 'Jumlah Supplier'], out);
  }

  /* ---------- TURUNAN: DAFTAR PO ---------- */
  const poOrders = (po: PurchaseOrder) => {
    const a = srcIdx.get(po.no);
    if (a && a.length) return a;
    return po.order_no ? [po.order_no] : [];
  };
  const filtered = rows.filter((po) => {
    if (sup !== 'ALL' && po.supplier_code !== sup) return false;
    if (st !== 'ALL' && po.status !== st) return false;
    const lines = lineIdx.get(po.no) || [];
    if (cat !== 'ALL' && !lines.some((l) => s.prod(l.product_id)?.category === cat)) return false;
    if (prod !== 'ALL' && !lines.some((l) => l.product_id === prod)) return false;
    const t = q.toLowerCase();
    if (!t) return true;
    return po.no.toLowerCase().includes(t)
      || poOrders(po).some((x) => x.toLowerCase().includes(t))
      || s.supp(po.supplier_code).name.toLowerCase().includes(t)
      || lines.some((l) => l.name.toLowerCase().includes(t));
  });
  const prodOptions = s.products
    .filter((p) => cat === 'ALL' || p.category === cat)
    .filter((p) => rows.some((po) => (lineIdx.get(po.no) || []).some((l) => l.product_id === p.id)));
  const tot = filtered.reduce((a, b) => a + Number(b.total), 0);
  const open = filtered.filter((p) => p.status === 'SENT' || p.status === 'PARTIALLY RECEIVED');
  const qtyOf = (po: PurchaseOrder) =>
    (lineIdx.get(po.no) || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const recvOf = (po: PurchaseOrder) =>
    (lineIdx.get(po.no) || []).reduce((a, l) => a + (Number(l.received_qty) || 0), 0);
  const tItem = filtered.reduce((a, p) => a + (lineIdx.get(p.no) || []).length, 0);
  const tQty = filtered.reduce((a, p) => a + qtyOf(p), 0);
  const tRecv = filtered.reduce((a, p) => a + recvOf(p), 0);

  function exportCsv() {
    const out: (string | number)[][] = [];
    filtered.forEach((po) => (lineIdx.get(po.no) || []).forEach((l) => {
      out.push([po.no, po.po_date, po.expected_date || '', s.supp(po.supplier_code).name,
        s.supp(po.supplier_code).type || '', poOrders(po).join(' | '), s.wh(po.warehouse_code).name,
        s.termOf(po.term_code).name, po.status, l.product_id, l.name, l.unit,
        Number(l.qty), Number(l.received_qty || 0), Number(l.price),
        Math.round(Number(l.qty) * Number(l.price))]);
    }));
    downloadCsv('po', ['No PO', 'Tanggal', 'Perkiraan Tiba', 'Supplier', 'Tipe Supplier', 'Untuk SO',
      'Gudang', 'Termin', 'Status', 'SKU', 'Produk', 'Satuan', 'Qty Pesan', 'Qty Diterima',
      'Harga Estimasi', 'Subtotal'], out);
  }

  const totAlok = alloc.reduce((a, r) => a + Number(r.qty_alokasi), 0);
  const totPoQty = (detail?.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);

  return (
    <>
      <PageHead title="Purchase Order"
        desc="Sales Order yang disetujui masuk ke daftar kebutuhan pembelian. Pembeli memilih supplier dan qty, lalu menerbitkan PO — satu PO per supplier, boleh menggabungkan kebutuhan beberapa Sales Order."
        actions={tab === 'need'
          ? <button className="btn" onClick={exportDemand}>⇩ Export CSV</button>
          : <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />

      <Tabs value={tab || 'list'} onChange={(v) => setTab(v)} options={[
        { v: 'need', t: 'Kebutuhan Pembelian' + (nPerlu ? ` (${nPerlu})` : '') },
        { v: 'list', t: 'Daftar PO' },
      ]} />

      {tab === 'need' ? (<>
        <div className="fbar">
          <input className="grow" placeholder="Cari produk, customer, atau no. SO…"
            value={dQ} onChange={(e) => setDQ(e.target.value)} />
          <select value={dCat} onChange={(e) => setDCat(e.target.value)}>
            <option value="ALL">Semua Kategori</option>
            {demCats.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={dOnly} onChange={(e) => setDOnly(e.target.value as 'BELI' | 'ALL')}>
            <option value="BELI">Hanya yang perlu dibeli</option>
            <option value="ALL">Semua kebutuhan</option>
          </select>
          <label className="sm mut">Tgl kirim</label>
          <input type="date" value={dFrom} onChange={(e) => setDFrom(e.target.value)} />
          <span className="sm mut">s/d</span>
          <input type="date" value={dTo} onChange={(e) => setDTo(e.target.value)} />
          <span className="sm mut">{groups.length} produk</span>
        </div>

        <KpiGrid>
          <Kpi cls="k-blue" lb="Produk Perlu Dibeli" vl={num(nBeliTampil, 0)}
            sb={`dari ${num(groups.length, 0)} produk dibutuhkan`} />
          <Kpi cls="k-acc" lb="Qty Perlu Dibeli" vl={num(tBeli, 0)}
            sb={`kebutuhan ${num(tKeb, 0)}, tertutup stok ${num(tStok, 0)}`} />
          <Kpi cls="k-amber" lb="Sales Order Menunggu" vl={num(nSOdem, 0)}
            sb={`${num(nCustDem, 0)} customer`} />
          <Kpi cls={tanpaSup ? 'k-red' : 'k-green'} lb="Estimasi PO Terpilih" vl={rpShort(selTotal)}
            sb={tanpaSup ? `${tanpaSup} produk tanpa supplier` : 'harga supplier terpilih'} />
        </KpiGrid>

        <Card><CardBody flush>
          <DataTable<Grp> rows={groups} rowKey={(g) => g.pid} onRow={setDemDetail}
            emptyT={dOnly === 'BELI' ? 'Tidak ada produk yang perlu dibeli pada rentang ini'
              : 'Tidak ada kebutuhan pembelian pada rentang ini'}
            emptyD={dOnly === 'BELI'
              ? 'Stok menutup seluruh kebutuhan. Pilih "Semua kebutuhan" untuk melihat rinciannya, atau ubah rentang tanggal kirim.'
              : 'Setujui Sales Order lebih dulu di menu Order Approval, atau ubah rentang tanggal kirim.'}
            cols={[
              { t: '', cls: 'ctr', w: '34px', f: (g) => (
                <input type="checkbox" checked={!!sel[g.pid]} disabled={!g.sups.length}
                  title={g.sups.length ? undefined : 'Produk ini belum punya supplier'}
                  onChange={(e) => setSel((x) => {
                    const y = { ...x }; if (e.target.checked) y[g.pid] = true; else delete y[g.pid];
                    return y; })} />) },
              { t: 'SKU', f: (g) => <span className="doc-no">{g.pid}</span> },
              { t: 'Produk', f: (g) => <>{g.name}<div className="sm mut">{g.catName}</div></> },
              { t: 'Kirim', f: (g) => (<>
                {dFmt(g.earliest)}
                {g.earliest < todayJkt() ? <span className="bdg2 b-red" style={{ marginLeft: 6 }}>Telat</span>
                  : g.earliest === todayJkt() ? <span className="bdg2 b-amber" style={{ marginLeft: 6 }}>Hari ini</span> : null}
                {g.latest !== g.earliest ? <div className="sm mut">s/d {dFmt(g.latest)}</div> : null}
              </>) },
              { t: 'Order', cls: 'ctr', f: (g) => (<>
                <span className="sm">{g.nSO} SO</span>
                <div className="sm mut">{g.nCust} customer</div></>) },
              { t: 'Kebutuhan', cls: 'num', f: (g) => <>{num(g.qty, 0)} {g.unit}</> },
              { t: 'Stok', cls: 'num', f: (g) => (g.stock >= g.qty
                ? <span className="bdg2 b-green" title="Stok menutup seluruh kebutuhan">{num(g.stock, 0)}</span>
                : <span className="sm mut">{num(g.stock, 0)}</span>) },
              { t: 'Perlu Beli', cls: 'num', f: (g) => (g.beli > 0
                ? <b>{num(g.beli, 0)}</b> : <span className="mut">—</span>) },
              { t: 'Qty Pesan', cls: 'num', w: '92px', f: (g) => (
                <input className="num" type="number" min={0} step={1} style={{ width: 84 }}
                  disabled={!g.sups.length} value={qtyOfG(g)}
                  onChange={(e) => setQtySel((x) => ({ ...x,
                    [g.pid]: e.target.value === '' ? 0 : Number(e.target.value) }))} />) },
              { t: 'Supplier', w: '250px', f: (g) => (!g.sups.length ? (<>
                <span className="bdg2 b-red">belum ada supplier</span>
                <div className="sm mut">Tambahkan di Master Supplier</div></>) : (<>
                <select value={supOf(g)} onChange={(e) => {
                  setSupSel((x) => ({ ...x, [g.pid]: e.target.value }));
                  /* Harga mengikuti supplier baru, kecuali pembeli sudah mengisi sendiri. */
                  setPriceSel((x) => { const y = { ...x }; delete y[g.pid]; return y; });
                }}>
                  {g.sups.map((x) => (
                    <option key={x.supplier_code} value={x.supplier_code}>
                      {x.supplier_name} — {rp(x.price)}{x.is_preferred ? ' ★' : ''}
                      {x.murah && !x.is_preferred ? ' ↓' : ''}
                    </option>))}
                </select>
                <div className="sm mut">{supInfo(g)}</div></>)) },
              { t: 'Harga', cls: 'num', w: '110px', f: (g) => (!g.sups.length
                ? <span className="mut">—</span> : (<>
                  <input className="num" type="number" min={0} step={50} style={{ width: 104 }}
                    value={priceOfG(g)}
                    onChange={(e) => setPriceSel((x) => ({ ...x,
                      [g.pid]: e.target.value === '' ? 0 : Number(e.target.value) }))} />
                  <div className="sm mut">{priceSel[g.pid] !== undefined ? 'MANUAL'
                    : (supRow(g)?.price_source || '')}</div></>)) },
              { t: 'Estimasi', cls: 'num', f: (g) => (sel[g.pid]
                ? rp(Math.round(qtyOfG(g) * priceOfG(g))) : <span className="mut">—</span>) },
            ]} />
        </CardBody></Card>

        {groups.length ? (
          <Card><CardBody>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="sm" style={{ flex: 1, minWidth: 240 }}>
                {!selGroups.length ? (
                  <span className="mut">Belum ada produk dipilih. Centang baris yang akan dipesan,
                    atau tekan “Pilih semua yang perlu dibeli”.</span>
                ) : (<>
                  Terpilih <b>{num(selGroups.length, 0)} produk</b> · {num(selQty, 0)} unit ·{' '}
                  <b>{num(supKeys.length, 0)} Purchase Order</b> ke{' '}
                  {supKeys.map((c) => s.supp(c).name).join(', ')} · nilai <b>{rp(selTotal)}</b>
                </>)}
              </div>
              <button className="btn" onClick={() => setSel(() => {
                const y: Record<string, boolean> = {};
                allGroups.forEach((g) => { if (g.beli > 0 && g.sups.length) y[g.pid] = true; });
                return y; })}>Pilih semua yang perlu dibeli</button>
              <button className="btn" onClick={() => setSel({})}>Kosongkan pilihan</button>
              {s.can('create') ? (
                <button className="btn pri" onClick={openCreate}>Terbitkan Purchase Order</button>) : null}
            </div>
          </CardBody></Card>
        ) : null}

        <div className="info-box mt14"><b>Perlu beli = kebutuhan − stok</b>, dihitung per produk:
          stok satu produk melayani order mana saja, jadi menguranginya per baris order akan
          menghitung stok yang sama berulang kali. Qty dan harga boleh diubah sebelum PO
          diterbitkan. Satu PO memuat satu supplier dan menggabungkan kebutuhan beberapa Sales
          Order; qty tiap baris dialokasikan ke order dengan tanggal kirim paling awal lebih dulu.
          Tanda ★ menandai supplier utama, ↓ menandai harga termurah.</div>
      </>) : null}

      {tab === 'list' ? (<>
        <div className="fbar">
          <DateRange value={range} onChange={setRange} />
        </div>
        <div className="fbar">
          <input className="grow" placeholder="Cari no. PO, no. SO, supplier, atau produk…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={sup} onChange={(e) => setSup(e.target.value)}>
            <option value="ALL">Semua Supplier</option>
            {s.suppliers.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </select>
          <select value={cat} onChange={(e) => { setCat(e.target.value); setProd('ALL'); }}>
            <option value="ALL">Semua Kategori</option>
            {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <select value={prod} onChange={(e) => setProd(e.target.value)}>
            <option value="ALL">Semua Produk</option>
            {prodOptions.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.name}</option>)}
          </select>
          <select value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="ALL">Semua Status</option>
            {['DRAFT', 'SENT', 'PARTIALLY RECEIVED', 'RECEIVED', 'CANCELLED'].map((x) => <option key={x}>{x}</option>)}
          </select>
          <span className="sm mut">{filtered.length} PO</span>
        </div>

        <KpiGrid>
          <Kpi cls="k-blue" lb="Jumlah PO" vl={num(filtered.length, 0)} sb={`${range.from || 'awal'} — ${range.to || 'kini'}`} />
          <Kpi cls="k-acc" lb="Nilai Pembelian" vl={rpShort(tot)} />
          <Kpi cls="k-amber" lb="Belum Diterima Penuh" vl={num(open.length, 0) + ' PO'}
            sb={rpShort(open.reduce((a, b) => a + Number(b.total), 0))} />
          <Kpi cls="k-green" lb="Total Qty Dipesan" vl={num(tQty, 0) + ' unit'}
            sb={`${num(new Set(filtered.map((p) => p.supplier_code)).size, 0)} supplier terlibat`} />
        </KpiGrid>

        <Card><CardBody flush>
          <DataTable<PurchaseOrder> rows={filtered} rowKey={(r) => r.no} onRow={openDetail}
            emptyT="Tidak ada Purchase Order pada rentang ini"
            emptyD="Terbitkan PO dari tab Kebutuhan Pembelian."
            cols={[
              { t: 'No. PO', f: (p) => <span className="doc-no">{p.no}</span> },
              { t: 'Tanggal', f: (p) => dFmt(p.po_date) },
              { t: 'Supplier', f: (p) => <>{s.supp(p.supplier_code).name}
                <div className="sm mut">{s.supp(p.supplier_code).type || '-'}</div></> },
              { t: 'Untuk SO', f: (p) => {
                const os = poOrders(p);
                if (!os.length) return <span className="mut">stok</span>;
                return (<>
                  <span className="sm mono">{os[0]}</span>
                  {os.length > 1 ? <div className="sm mut" title={os.join(', ')}>
                    +{os.length - 1} order lain</div> : null}
                </>);
              } },
              { t: 'Item', cls: 'ctr', f: (p) => (lineIdx.get(p.no) || []).length },
              { t: 'Qty Pesan', cls: 'num', f: (p) => num(qtyOf(p), 0) },
              { t: 'Qty Terima', cls: 'num', f: (p) => {
                const r = recvOf(p); const qv = qtyOf(p);
                if (r <= 0) return <span className="mut">—</span>;
                return <b style={{ color: r >= qv ? 'var(--green)' : 'var(--amber)' }}>{num(r, 0)}</b>;
              } },
              { t: 'Tiba', f: (p) => <span className="sm">{dFmt(p.expected_date)}</span> },
              { t: 'Jumlah', cls: 'num', f: (p) => rp(p.total) },
              { t: 'Status', f: (p) => <Badge st={p.status} /> },
            ]}
            foot={<tr><td colSpan={4}>TOTAL {num(filtered.length, 0)} PO</td>
              <td className="ctr">{num(tItem, 0)}</td>
              <td className="num">{num(tQty, 0)}</td>
              <td className="num">{num(tRecv, 0)}</td><td />
              <td className="num">{rp(tot)}</td><td /></tr>} />
        </CardBody></Card>
      </>) : null}

      {/* ---------- RINCIAN: KEBUTUHAN PER CUSTOMER ---------- */}
      <Modal open={!!demDetail} onClose={() => setDemDetail(null)} size="mid">
        {demDetail ? (() => {
          const g = demDetail; const x = supRow(g);
          return (<>
            <ModalHead onClose={() => setDemDetail(null)} title={g.name}
              sub={`${g.pid} · ${g.catName} · kebutuhan ${num(g.qty, 0)} ${g.unit}`} />
            <ModalBody>
              <div className="grid-2">
                <Kv rows={[
                  ['Kebutuhan', `${num(g.qty, 0)} ${g.unit}`],
                  ['Stok Gudang', `${num(g.stock, 0)} ${g.unit}`],
                  ['Perlu Dibeli', <b key="b">{num(g.beli, 0)} {g.unit}</b>],
                  ['Kirim Terdekat', dFmtL(g.earliest)],
                ]} />
                <Kv rows={[
                  ['Supplier Terpilih', x ? x.supplier_name : <span key="n" className="mut">belum ada</span>],
                  ['Harga', x ? rp(priceOfG(g)) : '-'],
                  ['Sales Order', `${num(g.nSO, 0)} order · ${num(g.nCust, 0)} customer`],
                  ['Pilihan Supplier', `${num(g.sups.length, 0)} supplier menjual produk ini`],
                ]} />
              </div>

              <SecT>Kebutuhan per Customer</SecT>
              <DataTable<DemandLine> rows={g.lines} rowKey={(r) => String(r.so_line_id)} cols={[
                { t: 'No. SO', f: (r) => <span className="doc-no">{r.order_no}</span> },
                { t: 'Customer', f: (r) => r.customer_name },
                { t: 'Tgl Kirim', f: (r) => (<>{dFmt(r.delivery_date)}
                  {r.delivery_date < todayJkt()
                    ? <span className="bdg2 b-red" style={{ marginLeft: 6 }}>Telat</span> : null}</>) },
                { t: 'Status', f: (r) => <Badge st={r.order_status} /> },
                { t: 'Qty Order', cls: 'num', f: (r) => num(r.qty_order, 0) },
                { t: 'Sudah Kirim', cls: 'num', f: (r) => (Number(r.qty_delivered)
                  ? num(r.qty_delivered, 0) : <span className="mut">—</span>) },
                { t: 'Sudah Dipesan', cls: 'num', f: (r) => (Number(r.qty_ordered)
                  ? num(r.qty_ordered, 0) : <span className="mut">—</span>) },
                { t: 'Perlu Dibeli', cls: 'num', f: (r) => <b>{num(r.qty_needed, 0)}</b> },
              ]} foot={<tr><td colSpan={7}>TOTAL {g.lines.length} baris order</td>
                <td className="num">{num(g.qty, 0)}</td></tr>} />

              {g.sups.length ? (<>
                <SecT>Perbandingan Supplier</SecT>
                <DataTable<SupOption> rows={g.sups} rowKey={(r) => r.supplier_code} cols={[
                  { t: 'Supplier', f: (r) => (<>{r.supplier_name}
                    {r.is_preferred ? <span className="bdg2 b-blue" style={{ marginLeft: 6 }}>utama</span> : null}</>) },
                  { t: 'Tipe', f: (r) => <span className="sm mut">{r.supplier_type || '-'}</span> },
                  { t: 'Harga', cls: 'num', f: (r) => (<>{rp(r.price)}
                    {r.murah ? <span className="bdg2 b-green" style={{ marginLeft: 6 }}>termurah</span> : null}</>) },
                  { t: 'Sumber', cls: 'ctr', f: (r) => <span className="bdg2 b-grey">{r.price_source}</span> },
                  { t: 'Min Pesan', cls: 'num', f: (r) => (Number(r.min_order_qty) > 0
                    ? `${num(r.min_order_qty, 0)} ${g.unit}` : <span className="mut">—</span>) },
                  { t: 'Kapasitas/hari', cls: 'num', f: (r) => (Number(r.capacity_per_day) > 0
                    ? `${num(r.capacity_per_day, 0)} ${g.unit}` : <span className="mut">—</span>) },
                  { t: 'Lead Time', cls: 'ctr', f: (r) => `${r.lead_time_days} hari` },
                  { t: 'Termin', cls: 'ctr', f: (r) => <span className="sm">{s.termOf(r.term_code).name}</span> },
                ]} />
              </>) : null}

              <div className="info-box mt14">Qty pada kolom <b>Perlu Dibeli</b> di halaman utama sudah
                dikurangi stok gudang, sedangkan tabel di atas menampilkan kebutuhan apa adanya per
                order. Itulah sebabnya jumlah keduanya bisa berbeda.</div>
            </ModalBody>
            <ModalFoot>
              <button className="btn" onClick={() => setDemDetail(null)}>Tutup</button>
            </ModalFoot>
          </>);
        })() : null}
      </Modal>

      {/* ---------- PENERBITAN: KONFIRMASI PENGELOMPOKAN PER SUPPLIER ---------- */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} size="mid">
        {createOpen ? (() => {
          const peringatan: string[] = [];
          supKeys.forEach((c) => (bySup.get(c) || []).forEach((g) => {
            const x = supRow(g); const qv = qtyOfG(g);
            if (x && Number(x.min_order_qty) > 0 && qv < Number(x.min_order_qty))
              peringatan.push(`${g.name} di bawah minimum pesan ${s.supp(c).name}`);
            if (x && Number(x.capacity_per_day) > 0 && qv > Number(x.capacity_per_day))
              peringatan.push(`${g.name} melebihi kapasitas harian ${s.supp(c).name}`);
          }));
          const uniqPeringatan = [...new Set(peringatan)];
          return (<>
            <ModalHead onClose={() => setCreateOpen(false)}
              title={`Terbitkan ${supKeys.length} Purchase Order`}
              sub={`${num(selGroups.length, 0)} produk · nilai ${rp(selTotal)}`} />
            <ModalBody>
              <Fg c={3}>
                <F label="Tanggal PO">
                  <input type="date" value={pcDate} onChange={(e) => setPcDate(e.target.value)} />
                </F>
                <F label="Perkiraan Tiba">
                  <input type="date" value={pcExp} onChange={(e) => setPcExp(e.target.value)} />
                </F>
                <F label="Gudang Tujuan">
                  <select value={pcWh} onChange={(e) => setPcWh(e.target.value)}>
                    {s.warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
                  </select>
                </F>
                <F label="Catatan (opsional, dipakai pada seluruh PO)" full>
                  <input value={pcNote} onChange={(e) => setPcNote(e.target.value)}
                    placeholder="mis. kirim pagi sebelum jam 6" />
                </F>
              </Fg>

              {supKeys.map((c) => {
                const rws = bySup.get(c) || [];
                const nilai = rws.reduce((a, g) => a + Math.round(qtyOfG(g) * priceOfG(g)), 0);
                const orders = [...new Set(rws.flatMap((g) => g.lines.map((l) => l.order_no)))].sort();
                return (<div key={c}>
                  <SecT>{s.supp(c).name} · {num(rws.length, 0)} produk · {rp(nilai)}</SecT>
                  <div className="sm mut" style={{ margin: '-6px 0 8px' }}>
                    Termin {s.termOf(s.supp(c).term_code).name} · memenuhi {num(orders.length, 0)}{' '}
                    Sales Order: {orders.map((x, i) => (<span key={x}>
                      {i ? ', ' : ''}<span className="mono">{x}</span></span>))}
                  </div>
                  <DataTable<Grp> rows={rws} rowKey={(g) => g.pid} cols={[
                    { t: 'SKU', f: (g) => <span className="doc-no">{g.pid}</span> },
                    { t: 'Produk', f: (g) => g.name },
                    { t: 'Qty', cls: 'num', f: (g) => <>{num(qtyOfG(g), 0)} {g.unit}</> },
                    { t: 'Harga', cls: 'num', f: (g) => rp(priceOfG(g)) },
                    { t: 'Subtotal', cls: 'num', f: (g) => rp(Math.round(qtyOfG(g) * priceOfG(g))) },
                    { t: 'Catatan', f: (g) => {
                      const x = supRow(g); const qv = qtyOfG(g); const w: React.ReactNode[] = [];
                      if (x && Number(x.min_order_qty) > 0 && qv < Number(x.min_order_qty))
                        w.push(<span key="m" className="bdg2 b-amber">di bawah minimum {num(x.min_order_qty, 0)}</span>);
                      if (x && Number(x.capacity_per_day) > 0 && qv > Number(x.capacity_per_day))
                        w.push(<span key="c" className="bdg2 b-red">melebihi kapasitas {num(x.capacity_per_day, 0)}/hari</span>);
                      if (qv > g.beli)
                        w.push(<span key="s" className="bdg2 b-grey"
                          title="Kelebihan di atas kebutuhan masuk stok">{num(qv - g.beli, 0)} ke stok</span>);
                      return w.length ? <>{w.map((e, i) => <span key={i}>{i ? ' ' : ''}{e}</span>)}</>
                        : <span className="mut">—</span>;
                    } },
                  ]} foot={<tr><td colSpan={4}>TOTAL</td>
                    <td className="num">{rp(nilai)}</td><td /></tr>} />
                </div>);
              })}

              {uniqPeringatan.length ? (
                <div className="warn-box mt14"><b>{uniqPeringatan.length} hal perlu diperiksa:</b><br />
                  {uniqPeringatan.map((t) => <span key={t}>{t}<br /></span>)}
                  PO tetap dapat diterbitkan — peringatan ini agar dikonfirmasi lebih dulu ke supplier.
                </div>) : null}

              <div className="info-box mt14">Qty tiap baris dialokasikan ke Sales Order dengan tanggal
                kirim paling awal lebih dulu. Alokasi inilah yang nantinya menautkan harga beli
                sebenarnya ke HPP faktur penjualan yang bersangkutan, jadi jangan dibuat manual di
                luar halaman ini.</div>
            </ModalBody>
            <ModalFoot>
              <button className="btn" onClick={() => setCreateOpen(false)}>Batal</button>
              <button className="btn pri" disabled={busy} onClick={terbitkan}>
                Terbitkan {supKeys.length} Purchase Order</button>
            </ModalFoot>
          </>);
        })() : null}
      </Modal>

      {/* ---------- RINCIAN PO ---------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<>{detail.no} <Badge st={detail.status} /></>}
            sub={`${s.supp(detail.supplier_code).name} · ${dFmtL(detail.po_date)}`} />
          <ModalBody>
            <div className="grid-2">
              <Kv rows={[
                ['Supplier', s.supp(detail.supplier_code).name],
                ['Tipe', s.supp(detail.supplier_code).type || '-'],
                ['PIC / Telepon', `${s.supp(detail.supplier_code).pic || '-'} · ${s.supp(detail.supplier_code).phone || '-'}`],
                ['Alamat', s.supp(detail.supplier_code).address || '-'],
              ]} />
              <Kv rows={[
                ['Gudang Tujuan', s.wh(detail.warehouse_code).name],
                ['Perkiraan Tiba', dFmtL(detail.expected_date)],
                ['Termin', s.termOf(detail.term_code).name],
                ['Sales Order', (() => {
                  const os = poOrders(detail);
                  if (!os.length) return <span key="n" className="mut">pembelian stok</span>;
                  return <span key="o">{os.map((x, i) => (<span key={x}>
                    {i ? ', ' : ''}<span className="mono">{x}</span></span>))}</span>;
                })()],
              ]} />
            </div>
            {detail.note ? <div className="info-box mt14">{detail.note}</div> : null}

            <SecT>Barang Dipesan</SecT>
            <DataTable<PoLine> rows={detail.lines || []} cols={[
              { t: 'SKU', f: (l) => <span className="doc-no">{l.product_id}</span> },
              { t: 'Produk', f: (l) => l.name },
              { t: 'Qty Pesan', cls: 'num', f: (l) => <>{num(l.qty, 0)} {l.unit}</> },
              { t: 'Diterima', cls: 'num', f: (l) => (Number(l.received_qty) > 0
                ? <b style={{ color: 'var(--green)' }}>{num(l.received_qty || 0, 0)}</b>
                : <span className="mut">—</span>) },
              { t: 'Sisa', cls: 'num', f: (l) => num(Math.max(0, Number(l.qty) - Number(l.received_qty || 0)), 0) },
              { t: 'Harga Pesan', cls: 'num', f: (l) => (<>
                {rp(l.price)}
                {l.price_source ? <span className="bdg2 b-grey" style={{ marginLeft: 6 }}
                  title={l.price_source === 'LIST' ? 'Dari daftar harga supplier pada tanggal PO'
                    : l.price_source === 'GRN' ? 'Dari harga aktual penerimaan barang terakhir'
                    : l.price_source === 'MANUAL' ? 'Diisi sendiri oleh pembeli'
                    : 'Dari harga pokok master produk'}>{l.price_source}</span> : null}
              </>) },
              { t: 'vs PO Lalu', cls: 'ctr', f: (l) => {
                const pv = Number(l.prev_price || 0);
                if (!pv) return <span className="mut">baru</span>;
                const d = ((Number(l.price) - pv) / pv) * 100;
                if (Math.abs(d) < 0.05) return <span className="bdg2 b-grey" title={l.prev_po_no || ''}>tetap</span>;
                return <span className={'bdg2 ' + (d > 0 ? 'b-red' : 'b-green')}
                  title={`${l.prev_po_no}: ${rp(pv)}`}>
                  {d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}%</span>;
              } },
              { t: 'Subtotal', cls: 'num', f: (l) => rp(Number(l.qty) * Number(l.price)) },
            ]} foot={<tr><td colSpan={7}>TOTAL</td><td className="num">{rp(detail.total)}</td></tr>} />

            {(() => {
              const ls = detail.lines || [];
              const naik = ls.filter((l) => Number(l.prev_price) > 0 && Number(l.price) > Number(l.prev_price));
              const turun = ls.filter((l) => Number(l.prev_price) > 0 && Number(l.price) < Number(l.prev_price));
              const tajam = naik.filter((l) =>
                (Number(l.price) - Number(l.prev_price!)) / Number(l.prev_price!) > 0.15);
              if (!naik.length && !turun.length) return null;
              return (
                <div className={tajam.length ? 'warn-box mt14' : 'info-box mt14'}>
                  Dibanding Purchase Order sebelumnya ke supplier yang sama:{' '}
                  <b>{naik.length} harga naik</b>, <b>{turun.length} harga turun</b>.
                  {tajam.length ? (<> Perhatian: {tajam.length} produk naik lebih dari 15% —{' '}
                    {tajam.map((l) => l.name).join(', ')}. Bandingkan dengan supplier lain di menu{' '}
                    <b>Perbandingan Harga Supplier</b> sebelum barang diterima.</>) : null}
                </div>);
            })()}

            {/* Pembagian tiap baris PO ke order yang memicunya — dipakai gudang saat
                barang datang, dan inilah tautan yang membawa harga beli ke HPP faktur. */}
            {alloc.length ? (<>
              <SecT>Alokasi ke Sales Order</SecT>
              <DataTable<Alloc> rows={alloc}
                rowKey={(r) => `${r.po_line_id}-${r.order_no}`} cols={[
                  { t: 'Produk', f: (r) => <>{r.product_name}
                    <div className="sm mut">{r.product_id}</div></> },
                  { t: 'No. SO', f: (r) => <span className="doc-no">{r.order_no}</span> },
                  { t: 'Customer', f: (r) => r.customer_name },
                  { t: 'Tgl Kirim', f: (r) => (r.delivery_date
                    ? dFmt(r.delivery_date) : <span className="mut">—</span>) },
                  { t: 'Qty PO', cls: 'num', f: (r) => <>{num(r.qty_po, 0)} {r.unit}</> },
                  { t: 'Untuk Order Ini', cls: 'num', f: (r) => <b>{num(r.qty_alokasi, 0)}</b> },
                ]} foot={<tr><td colSpan={5}>TOTAL DIALOKASIKAN</td>
                  <td className="num">{num(totAlok, 0)}</td></tr>} />
              {totPoQty - totAlok > 0.001 ? (
                <div className="sm mut mt14">{num(totPoQty - totAlok, 0)} unit dipesan di atas
                  kebutuhan order dan akan masuk sebagai stok gudang.</div>) : null}
            </>) : null}

            <div className="info-box mt14">Harga di atas diambil dari <b>daftar harga supplier</b> yang
              berlaku pada tanggal PO. Harga beli sebenarnya dicatat saat barang diterima di menu{' '}
              <b>Inbound / Receiving</b>, dan harga itulah yang dipakai sebagai HPP faktur penjualan
              yang bersangkutan.</div>
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
            {s.can('print') ? (
              <button className="btn" onClick={() => setPrint(detail)}>🖨 Cetak PO</button>) : null}
            {detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' && s.can('create') ? (
              <a className="btn pri" href={`/purchasing/inbound?po=${detail.no}`}>⇩ Terima Barang</a>
            ) : null}
          </ModalFoot>
        </>) : null}
      </Modal>

      {print ? <PrintPO po={print} onClose={() => setPrint(null)} /> : null}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><PoPage /></Suspense>;
}
