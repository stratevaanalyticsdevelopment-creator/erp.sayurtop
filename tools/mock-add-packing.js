/* Menambahkan packing_line_view dan kolom kemasan ke snapshot mock, dengan
   logika yang sama seperti migrasi 0016–0017 dan versi HTML. Dijalankan
   ulang bila snapshot diperbarui. */
const fs = require('fs');
const P = __dirname + '/mock-data.json';
const D = JSON.parse(fs.readFileSync(P, 'utf8'));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = iso(new Date());
const OPEN = ['APPROVED', 'PROCESSING', 'PARTIALLY DELIVERED'];

/* ---------- kemasan per kategori dan satuan ---------- */
const R = [
  ['SAY', 'Kg', 'Peti', 10], ['SAY', 'Pack', 'Karton', 24],
  ['CAB', null, 'Karung', 25],
  ['BUA', 'Kg', 'Karton', 12], ['BUA', 'Pack', 'Karton', 20],
  ['REM', null, 'Pack', 5],
  ['TEL', 'Kg', 'Peti', 15], ['TEL', 'Pack', 'Peti', 10],
  ['DRY', 'Pack', 'Karton', 12],
];
D.product.forEach((p) => {
  if (p.unit === 'Pcs') { p.pack_size = 0; p.pack_unit = null; return; }
  const hit = R.find((r) => r[0] === p.category && (r[1] === null || r[1] === p.unit));
  if (hit) { p.pack_unit = hit[2]; p.pack_size = hit[3]; }
  else { p.pack_size = 0; p.pack_unit = null; }
});

/* ---------- jadwal kirim order terbuka disebar ke H+0..H+3 ---------- */
const open = D.sales_order.filter((o) => OPEN.includes(o.status))
  .sort((a, b) => a.order_date.localeCompare(b.order_date));
open.forEach((o, i) => { if (o.delivery_date < TODAY) o.delivery_date = addDays(TODAY, i % 4); });

/* ---------- packing_line_view ---------- */
const prodOf = {}; D.product.forEach((p) => { prodOf[p.id] = p; });
const custOf = {}; D.customer.forEach((c) => { custOf[c.code] = c; });
const delOf = {}; D.delivery.forEach((d) => { delOf[d.no] = d; });

/* qty sudah keluar per produk + SO lewat Surat Jalan yang tidak dibatalkan */
const terkirim = new Map();
(D.delivery_line || []).forEach((l) => {
  const d = delOf[l.delivery_no];
  if (!d || d.status === 'CANCELLED') return;
  const k = l.product_id + '|' + d.order_no;
  terkirim.set(k, (terkirim.get(k) || 0) + (Number(l.qty) || 0));
});

const view = [];
D.sales_order.forEach((o) => {
  if (!OPEN.includes(o.status)) return;
  (D.sales_order_line || []).filter((l) => l.order_no === o.no).forEach((l) => {
    const p = prodOf[l.product_id] || {};
    const c = custOf[o.customer_code] || {};
    const kirim = terkirim.get(l.product_id + '|' + o.no) || 0;
    const sisaKirim = (Number(l.qty) || 0) - kirim;
    if (sisaKirim <= 0) return;
    const ps = Number(p.pack_size) || 0;
    const koli = ps > 0 ? Math.floor(sisaKirim / ps) : 0;
    view.push({
      order_no: o.no, delivery_date: o.delivery_date,
      customer_code: o.customer_code, customer_name: c.name || o.customer_code,
      customer_type: c.type || null, shipping_address: c.shipping_address || null,
      warehouse_code: o.warehouse_code, order_status: o.status,
      product_id: l.product_id, product_name: p.name || l.product_id,
      category: p.category || '', category_name: p.category_name || '',
      unit: p.unit || '', pack_size: ps, pack_unit: p.pack_unit || null,
      stock: Number(p.stock) || 0,
      qty_order: Number(l.qty) || 0, qty_delivered: kirim, qty_outstanding: sisaKirim,
      koli_penuh: koli, qty_sisa: ps > 0 ? sisaKirim - koli * ps : sisaKirim,
    });
  });
});
view.sort((a, b) => a.product_id.localeCompare(b.product_id) ||
  a.customer_code.localeCompare(b.customer_code));
D.packing_line_view = view;

fs.writeFileSync(P, JSON.stringify(D));
console.log('produk_berkemasan=%d baris_packing=%d produk=%d customer=%d qty=%d koli=%d',
  D.product.filter((p) => p.pack_size > 0).length, view.length,
  new Set(view.map((v) => v.product_id)).size,
  new Set(view.map((v) => v.customer_code)).size,
  Math.round(view.reduce((a, b) => a + b.qty_outstanding, 0)),
  view.reduce((a, b) => a + b.koli_penuh, 0));
