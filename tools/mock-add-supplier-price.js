/* Menambahkan tabel dan view daftar harga supplier ke snapshot mock.
   Logikanya disamakan dengan seedSupplierPrices() pada versi HTML dan
   migrasi 0011–0013, supaya pengujian UI lokal memakai bentuk data yang
   sama dengan Supabase. Dijalankan ulang bila snapshot diperbarui. */
const fs = require('fs');
const P = __dirname + '/mock-data.json';
const D = JSON.parse(fs.readFileSync(P, 'utf8'));

const VOL = { CAB: 0.22, SAY: 0.13, BUA: 0.09, REM: 0.07, TEL: 0.06, DRY: 0.03 };
const FACTOR = { Petani: 0.96, Peternak: 0.97, Pengepul: 0.99, Distributor: 1.01, 'Pasar Induk': 1.06 };
const ALT = {
  SAY: [['SUP-002', 2], ['SUP-003', 2]], CAB: [['SUP-002', 2], ['SUP-001', 2]],
  BUA: [['SUP-006', 3]], REM: [['SUP-003', 2]], DRY: [['SUP-006', 2]], TEL: [['SUP-007', 2]],
};
const hash = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) & 0x7fffffff;
  return h;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const dDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const TODAY = iso(new Date());

const supType = {}; D.supplier.forEach((s) => { supType[s.code] = s.type; });
const prodOf = {}; D.product.forEach((p) => { prodOf[p.id] = p; });

/* ---------- katalog ---------- */
const cat = []; const seenCat = new Set();
const push = (sup, pid, extra) => {
  const k = sup + '|' + pid;
  if (seenCat.has(k)) return;
  seenCat.add(k);
  cat.push(Object.assign({ supplier_code: sup, product_id: pid, is_preferred: false,
    lead_time_days: 1, min_order_qty: 0, note: null }, extra || {}));
};
D.product.forEach((p) => { if (p.default_supplier_code) push(p.default_supplier_code, p.id, { is_preferred: true }); });
D.product.forEach((p) => { if (p.active) push('SUP-UMUM', p.id,
  { note: 'Alternatif pasar induk — harga lebih tinggi, stok hampir selalu ada' }); });
D.product.forEach((p) => {
  if (!p.active) return;
  (ALT[p.category] || []).forEach(([sup, lead]) => {
    if (hash(p.id + sup) % 100 >= 45) return;
    push(sup, p.id, { lead_time_days: lead,
      note: 'Alternatif kedua — dipakai saat supplier utama tidak dapat memasok' });
  });
});

/* ---------- riwayat harga ---------- */
const dates = [];
for (let w = 8; w >= 1; w--) dates.push(addDays(TODAY, -w * 7));
for (let x = 4; x >= 0; x--) dates.push(addDays(TODAY, -x));
const uniqDates = [...new Set(dates)];

const prices = []; let id = 1;
cat.forEach((sp) => {
  const p = prodOf[sp.product_id];
  if (!p || !(Number(p.base_price) > 0)) return;
  const f = FACTOR[supType[sp.supplier_code]] || 1.0;
  const vol = VOL[p.category] !== undefined ? VOL[p.category] : 0.1;
  const phase = hash(sp.product_id) % 21;
  uniqDates.forEach((d) => {
    const age = dDiff(d, TODAY);
    const noise = (hash(sp.product_id + sp.supplier_code + d) % 2000) / 1000 - 1;
    const factor = 1 + vol * 0.55 * Math.sin((2 * Math.PI * (age + phase)) / 21) + vol * 0.45 * noise;
    const price = Math.max(100, Math.round((Number(p.base_price) * f * factor) / 100) * 100);
    prices.push({ id: id++, supplier_code: sp.supplier_code, product_id: sp.product_id,
      price_date: d, price, source: 'MANUAL',
      note: 'Data contoh — harga penawaran harian supplier', created_by: null });
  });
});

/* ---------- agregat realisasi pembelian dari PO dan GRN ---------- */
const poSupOf = {}; D.purchase_order.forEach((p) => { poSupOf[p.no] = p.supplier_code; });
const poDateOf = {}; D.purchase_order.forEach((p) => { poDateOf[p.no] = p.po_date; });
const grnOf = {}; (D.goods_receipt || []).forEach((g) => { grnOf[g.no] = g; });
const agg = new Map();
const cell = (k) => {
  if (!agg.has(k)) agg.set(k, { qtyOrd: 0, qtyRcv: 0, value: 0, poN: 0, lastPo: null, lastGrn: null });
  return agg.get(k);
};
D.purchase_order_line.forEach((l) => {
  const p = D.purchase_order.find((x) => x.no === l.po_no);
  if (!p || p.status === 'CANCELLED') return;
  const c = cell(p.supplier_code + '|' + l.product_id);
  c.qtyOrd += Number(l.qty) || 0; c.poN++;
  if (!c.lastPo || p.po_date > c.lastPo) c.lastPo = p.po_date;
});
(D.goods_receipt_line || []).forEach((l) => {
  const g = grnOf[l.grn_no];
  if (!g || g.status === 'CANCELLED') return;
  const sup = poSupOf[g.po_no]; if (!sup) return;
  const c = cell(sup + '|' + l.product_id);
  c.qtyRcv += Number(l.qty) || 0;
  c.value += (Number(l.unit_cost) || 0) * (Number(l.qty) || 0);
  if (!c.lastGrn || g.grn_date > c.lastGrn) c.lastGrn = g.grn_date;
});
const aggOf = (sup, pid) => agg.get(sup + '|' + pid)
  || { qtyOrd: 0, qtyRcv: 0, value: 0, poN: 0, lastPo: null, lastGrn: null };

/* ---------- kapasitas pasok dan minimum order (data contoh) ---------- */
const FLOOR = { SAY: 150, CAB: 80, BUA: 120, REM: 40, TEL: 200, DRY: 250 };
const MINORD = { REM: 5, CAB: 5, TEL: 30, DRY: 25 };
cat.forEach((sp) => {
  const p = prodOf[sp.product_id]; if (!p) return;
  const a = aggOf(sp.supplier_code, sp.product_id);
  const dasar = a.qtyRcv || a.qtyOrd || 0;
  const lantai = FLOOR[p.category] !== undefined ? FLOOR[p.category] : 100;
  sp.capacity_per_day = Math.max(lantai, Math.ceil(dasar / 8 / 10) * 10);
  sp.min_order_qty = MINORD[p.category] !== undefined ? MINORD[p.category] : 10;
});

/* ---------- view: harga berlaku + perubahan ---------- */
const byPair = new Map();
prices.forEach((r) => {
  const k = r.supplier_code + '|' + r.product_id;
  (byPair.get(k) || byPair.set(k, []).get(k)).push(r);
});
byPair.forEach((list) => list.sort((a, b) => b.price_date.localeCompare(a.price_date)));

const view = cat.map((sp) => {
  const list = byPair.get(sp.supplier_code + '|' + sp.product_id) || [];
  const cur = list[0] || null; const prv = list[1] || null;
  const p = prodOf[sp.product_id] || {};
  const a = aggOf(sp.supplier_code, sp.product_id);
  return {
    supplier_code: sp.supplier_code, product_id: sp.product_id,
    product_name: p.name || sp.product_id, unit: p.unit || '',
    category: p.category || '', category_name: p.category_name || '',
    sell_price: p.sell_price || 0, base_price: p.base_price || 0, stock: p.stock || 0,
    is_preferred: sp.is_preferred, lead_time_days: sp.lead_time_days,
    min_order_qty: sp.min_order_qty, capacity_per_day: sp.capacity_per_day, note: sp.note,
    current_price: cur ? cur.price : null, current_price_date: cur ? cur.price_date : null,
    previous_price: prv ? prv.price : null, previous_price_date: prv ? prv.price_date : null,
    change_pct: cur && prv && prv.price > 0
      ? Math.round(((cur.price - prv.price) / prv.price) * 1000) / 10 : null,
    price_count: list.length,
    qty_ordered: a.qtyOrd, qty_received: a.qtyRcv, purchase_value: a.value,
    po_count: a.poN, last_po_date: a.lastPo, last_grn_date: a.lastGrn,
  };
});

/* ---------- ringkasan per supplier ---------- */
const bySup = new Map();
view.forEach((v) => {
  if (!bySup.has(v.supplier_code)) bySup.set(v.supplier_code, []);
  bySup.get(v.supplier_code).push(v);
});
const summary = [...bySup.entries()].map(([sup, ls]) => {
  const cats = [...new Set(ls.map((x) => x.category_name).filter(Boolean))].sort();
  return {
    supplier_code: sup,
    product_count: ls.length,
    preferred_count: ls.filter((x) => x.is_preferred).length,
    categories: cats.join(', '),
    category_count: cats.length,
    qty_ordered: ls.reduce((a, b) => a + b.qty_ordered, 0),
    qty_received: ls.reduce((a, b) => a + b.qty_received, 0),
    purchase_value: ls.reduce((a, b) => a + b.purchase_value, 0),
    last_grn_date: ls.reduce((a, b) => (b.last_grn_date && (!a || b.last_grn_date > a) ? b.last_grn_date : a), null),
  };
});
D.supplier_summary_view = summary;

/* ---------- kolom baru pada baris PO ---------- */
const poDate = {}; D.purchase_order.forEach((p) => { poDate[p.no] = p.po_date; });
const poSup = {}; D.purchase_order.forEach((p) => { poSup[p.no] = p.supplier_code; });
const lines = D.purchase_order_line.slice().sort((a, b) =>
  (poDate[a.po_no] || '').localeCompare(poDate[b.po_no] || '') || a.po_no.localeCompare(b.po_no));
const lastSeen = new Map();
lines.forEach((l) => {
  const k = poSup[l.po_no] + '|' + l.product_id;
  const prev = lastSeen.get(k);
  l.price_source = 'LIST';
  l.prev_price = prev ? prev.price : null;
  l.prev_po_no = prev ? prev.po_no : null;
  lastSeen.set(k, { price: l.price, po_no: l.po_no });
});

D.supplier_product = cat;
D.supplier_price = prices;
D.supplier_product_view = view;
D.supplier_price_current = [...byPair.values()].map((l) => l[0]).filter(Boolean);

fs.writeFileSync(P, JSON.stringify(D));
console.log('katalog=%d harga=%d view=%d ringkasan=%d po_line_dgn_pembanding=%d qtyRcv=%d nilai=%d',
  cat.length, prices.length, view.length, summary.length,
  lines.filter((l) => l.prev_price).length,
  summary.reduce((a, b) => a + b.qty_received, 0),
  Math.round(summary.reduce((a, b) => a + b.purchase_value, 0)));
