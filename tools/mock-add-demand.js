/* Menambahkan purchase_demand_line_view, purchase_order_source_view,
   po_allocation_view dan opsi supplier ke snapshot mock, dengan logika yang
   sama seperti migrasi 0020–0021 dan versi HTML. Dijalankan ulang bila
   snapshot diperbarui. */
const fs = require('fs');
const P = __dirname + '/mock-data.json';
const D = JSON.parse(fs.readFileSync(P, 'utf8'));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(new Date());
const OPEN = ['APPROVED', 'PROCESSING', 'PARTIALLY DELIVERED'];

const prodOf = new Map(D.product.map((p) => [p.id, p]));
const custOf = new Map(D.customer.map((c) => [c.code, c]));
const suppOf = new Map(D.supplier.map((x) => [x.code, x]));
const poOf = new Map(D.purchase_order.map((p) => [p.no, p]));

/* ---------- alokasi baris PO → baris SO (backfill migrasi 0020) ---------- */
D.po_line_allocation = (D.purchase_order_line || [])
  .filter((l) => l.so_line_id !== null && l.so_line_id !== undefined)
  .map((l) => ({ po_line_id: l.id, so_line_id: l.so_line_id, qty: Number(l.qty) || 0 }));

/* ---------- qty terkirim per (produk, no. SO) ---------- */
const delCancel = new Set((D.delivery || [])
  .filter((d) => d.status === 'CANCELLED').map((d) => d.no));
const orderOfDelivery = new Map((D.delivery || []).map((d) => [d.no, d.order_no]));
const kirim = new Map();
(D.delivery_line || []).forEach((l) => {
  if (delCancel.has(l.delivery_no)) return;
  const so = orderOfDelivery.get(l.delivery_no);
  if (!so) return;
  const k = l.product_id + '|' + so;
  kirim.set(k, (kirim.get(k) || 0) + (Number(l.qty) || 0));
});

/* ---------- qty sudah dipesan per baris SO ---------- */
const poCancel = new Set((D.purchase_order || [])
  .filter((p) => p.status === 'CANCELLED').map((p) => p.no));
const poLineById = new Map((D.purchase_order_line || []).map((l) => [l.id, l]));
const dipesan = new Map();
D.po_line_allocation.forEach((a) => {
  const pl = poLineById.get(a.po_line_id);
  if (!pl || poCancel.has(pl.po_no)) return;
  dipesan.set(a.so_line_id, (dipesan.get(a.so_line_id) || 0) + (Number(a.qty) || 0));
});

/* ---------- purchase_demand_line_view ---------- */
const dem = [];
(D.sales_order || []).forEach((o) => {
  if (!OPEN.includes(o.status)) return;
  const c = custOf.get(o.customer_code) || {};
  (D.sales_order_line || []).filter((l) => l.order_no === o.no).forEach((l) => {
    const p = prodOf.get(l.product_id) || {};
    const qty = Number(l.qty) || 0;
    const sudahKirim = kirim.get(l.product_id + '|' + o.no) || 0;
    const sudahPesan = dipesan.get(l.id) || 0;
    const perlu = Math.max(0, qty - sudahKirim - sudahPesan);
    if (perlu <= 0) return;
    dem.push({
      so_line_id: l.id, order_no: o.no, order_date: o.order_date,
      delivery_date: o.delivery_date, order_status: o.status,
      customer_code: o.customer_code, customer_name: c.name || o.customer_code,
      warehouse_code: o.warehouse_code,
      product_id: l.product_id, product_name: p.name || l.product_id,
      category: p.category || '', category_name: p.category_name || '',
      unit: p.unit || '', stock: Number(p.stock) || 0,
      default_supplier_code: p.default_supplier_code || null,
      qty_order: qty, qty_delivered: sudahKirim, qty_ordered: sudahPesan, qty_needed: perlu,
    });
  });
});
dem.sort((a, b) => a.product_id.localeCompare(b.product_id) || a.order_no.localeCompare(b.order_no));
D.purchase_demand_line_view = dem;

/* ---------- purchase_demand_view (rollup per produk) ---------- */
const gm = new Map();
dem.forEach((r) => {
  let g = gm.get(r.product_id);
  if (!g) {
    g = { product_id: r.product_id, product_name: r.product_name, category: r.category,
      category_name: r.category_name, unit: r.unit, stock: r.stock,
      default_supplier_code: r.default_supplier_code, qty_needed: 0,
      delivery_first: r.delivery_date, delivery_last: r.delivery_date,
      _so: new Set(), _cust: new Set() };
    gm.set(r.product_id, g);
  }
  g.qty_needed += r.qty_needed;
  if (r.delivery_date < g.delivery_first) g.delivery_first = r.delivery_date;
  if (r.delivery_date > g.delivery_last) g.delivery_last = r.delivery_date;
  g._so.add(r.order_no); g._cust.add(r.customer_code);
});
D.purchase_demand_view = [...gm.values()].map((g) => ({
  product_id: g.product_id, product_name: g.product_name, category: g.category,
  category_name: g.category_name, unit: g.unit, stock: g.stock,
  default_supplier_code: g.default_supplier_code,
  qty_needed: g.qty_needed, qty_buy: Math.max(0, g.qty_needed - g.stock),
  delivery_first: g.delivery_first, delivery_last: g.delivery_last,
  order_count: g._so.size, customer_count: g._cust.size,
  supplier_count: (D.supplier_product || []).filter((sp) => sp.product_id === g.product_id).length,
}));

/* ---------- opsi supplier untuk produk yang dibutuhkan (RPC 0021) ---------- */
/* Jenjang harga sama dengan po_price_for: daftar harga supplier pada tanggal
   tersebut, lalu harga penerimaan terakhir, lalu harga pokok master. */
function hargaUntuk(sup, pid) {
  const list = (D.supplier_price || [])
    .filter((r) => r.supplier_code === sup && r.product_id === pid && r.price_date <= TODAY)
    .sort((a, b) => b.price_date.localeCompare(a.price_date))[0];
  if (list && Number(list.price) > 0) return { price: Number(list.price), source: 'LIST', date: list.price_date };
  const grn = (D.purchase_price_daily || [])
    .filter((r) => r.product_id === pid && r.price_date <= TODAY)
    .sort((a, b) => b.price_date.localeCompare(a.price_date))[0];
  if (grn && Number(grn.avg_landed_cost) > 0)
    return { price: Math.round(Number(grn.avg_landed_cost) * 100) / 100, source: 'GRN', date: null };
  const p = prodOf.get(pid) || {};
  return { price: Number(p.base_price) || 0, source: 'BASE', date: null };
}
const butuh = new Set(dem.map((r) => r.product_id));
const opts = [];
(D.supplier_product || []).filter((sp) => butuh.has(sp.product_id)).forEach((sp) => {
  const s = suppOf.get(sp.supplier_code) || {};
  const h = hargaUntuk(sp.supplier_code, sp.product_id);
  opts.push({
    product_id: sp.product_id, supplier_code: sp.supplier_code,
    supplier_name: s.name || sp.supplier_code, supplier_type: s.type || '',
    price: h.price, price_source: h.source, price_date: h.date,
    is_preferred: !!sp.is_preferred, lead_time_days: Number(sp.lead_time_days) || 1,
    min_order_qty: Number(sp.min_order_qty) || 0,
    capacity_per_day: Number(sp.capacity_per_day) || 0, term_code: s.term_code || 'COD',
  });
});
opts.sort((a, b) => a.product_id.localeCompare(b.product_id)
  || (b.is_preferred ? 1 : 0) - (a.is_preferred ? 1 : 0)
  || a.price - b.price || a.supplier_name.localeCompare(b.supplier_name));
D.demand_supplier_options = opts;

/* ---------- purchase_order_source_view & po_allocation_view ---------- */
const src = new Map();
const alok = [];
const soLineById = new Map((D.sales_order_line || []).map((l) => [l.id, l]));
const soByNo = new Map((D.sales_order || []).map((o) => [o.no, o]));
D.po_line_allocation.forEach((a) => {
  const pl = poLineById.get(a.po_line_id); if (!pl) return;
  const sl = soLineById.get(a.so_line_id); if (!sl) return;
  const o = soByNo.get(sl.order_no); if (!o) return;
  const c = custOf.get(o.customer_code) || {};
  if (!src.has(pl.po_no)) src.set(pl.po_no, { so: new Set(), cust: new Set() });
  src.get(pl.po_no).so.add(sl.order_no);
  src.get(pl.po_no).cust.add(o.customer_code);
  alok.push({
    po_no: pl.po_no, po_line_id: pl.id, line_no: pl.line_no, product_id: pl.product_id,
    product_name: pl.name, unit: pl.unit, qty_po: Number(pl.qty) || 0,
    qty_alokasi: Number(a.qty) || 0, order_no: sl.order_no,
    customer_code: o.customer_code, customer_name: c.name || o.customer_code,
    delivery_date: o.delivery_date,
  });
});
D.purchase_order_source_view = [...src.entries()].map(([no, v]) => ({
  po_no: no, order_nos: [...v.so].sort(), order_count: v.so.size, customer_count: v.cust.size }));
D.po_allocation_view = alok;

fs.writeFileSync(P, JSON.stringify(D));
const nBeli = D.purchase_demand_view.filter((g) => g.qty_buy > 0).length;
console.log('alokasi=%d baris_kebutuhan=%d produk=%d perlu_beli=%d qty_kebutuhan=%d qty_perlu=%d opsi_supplier=%d po_bersumber=%d',
  D.po_line_allocation.length, dem.length, D.purchase_demand_view.length, nBeli,
  Math.round(dem.reduce((a, b) => a + b.qty_needed, 0)),
  Math.round(D.purchase_demand_view.reduce((a, b) => a + b.qty_buy, 0)),
  opts.length, D.purchase_order_source_view.length);
