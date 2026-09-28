/* =====================================================================
   HANYA UNTUK PENGUJIAN LOKAL — bukan bagian aplikasi.
   Menambahkan tabel modul pembelian ke snapshot mock-data.json dengan
   data yang konsisten terhadap sales order yang sudah ada, sehingga
   halaman Purchasing dapat diverifikasi tanpa akses jaringan.
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'mock-data.json');
const D = JSON.parse(fs.readFileSync(FILE, 'utf8'));

/* Acak yang dapat diulang, supaya snapshot selalu sama. */
let seed = 20260926;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r2 = (n) => Math.round(n * 100) / 100;

D.supplier = [
  { code: 'SUP-UMUM', name: 'Pasar Induk Kramat Jati (Umum)', type: 'Pasar Induk', pic: 'Bpk. Iwan', phone: '0812-9000-0000', address: 'Pasar Induk Kramat Jati, Jakarta Timur', term_code: 'COD', bank_name: '-', bank_account: '-', active: true },
  { code: 'SUP-001', name: 'Kelompok Tani Lembang Sejahtera', type: 'Petani', pic: 'Bpk. Dadang', phone: '0812-9001-1001', address: 'Desa Cikahuripan, Lembang, Bandung Barat', term_code: 'NET7', bank_name: 'BRI', bank_account: '003401009988501', active: true },
  { code: 'SUP-002', name: 'Gapoktan Cianjur Makmur', type: 'Petani', pic: 'Bpk. Asep', phone: '0812-9002-1002', address: 'Kec. Pacet, Cianjur, Jawa Barat', term_code: 'NET7', bank_name: 'BRI', bank_account: '003401007766502', active: true },
  { code: 'SUP-003', name: 'UD Berkah Tani Brebes', type: 'Pengepul', pic: 'Ibu Siti', phone: '0812-9003-1003', address: 'Jl. Raya Pantura KM 12, Brebes, Jawa Tengah', term_code: 'NET14', bank_name: 'BCA', bank_account: '778811223', active: true },
  { code: 'SUP-004', name: 'CV Buah Nusantara Jaya', type: 'Distributor', pic: 'Bpk. Handoko', phone: '0812-9004-1004', address: 'Jl. Gudang Buah No. 7, Jakarta Timur', term_code: 'NET14', bank_name: 'Mandiri', bank_account: '1230077665544', active: true },
  { code: 'SUP-005', name: 'Peternakan Telur Sumber Rejeki', type: 'Peternak', pic: 'Bpk. Slamet', phone: '0812-9005-1005', address: 'Desa Sidorejo, Blitar, Jawa Timur', term_code: 'NET7', bank_name: 'BNI', bank_account: '4455667788', active: true },
  { code: 'SUP-006', name: 'Toko Rempah Sari Bumi', type: 'Distributor', pic: 'Ibu Wati', phone: '0812-9006-1006', address: 'Pasar Senen Blok III, Jakarta Pusat', term_code: 'NET14', bank_name: 'BCA', bank_account: '665544332', active: true },
  { code: 'SUP-007', name: 'PT Sembako Prima Distribusi', type: 'Distributor', pic: 'Bpk. Rudi', phone: '0812-9007-1007', address: 'Kawasan Pergudangan Marunda, Jakarta Utara', term_code: 'NET30', bank_name: 'Mandiri', bank_account: '1230099887766', active: true },
];

const BY_CAT = { SAY: 'SUP-001', BUA: 'SUP-004', CAB: 'SUP-003', REM: 'SUP-006', TEL: 'SUP-005', DRY: 'SUP-007' };
let i = 0;
D.product.forEach((p) => {
  p.default_supplier_code = BY_CAT[p.category] || 'SUP-UMUM';
  if (p.category === 'SAY' && (i++ % 3) === 0) p.default_supplier_code = 'SUP-002';
});

const LANDED_KINDS = ['Transport', 'Bongkar Muat', 'Sortir & Packing', 'Retribusi Pasar'];
const prodOf = (id) => D.product.find((x) => x.id === id);
const pad = (n) => String(n).padStart(6, '0');

D.purchase_order = []; D.purchase_order_line = [];
D.goods_receipt = []; D.goods_receipt_line = []; D.landed_cost = [];
let poSeq = 0, grnSeq = 0, polId = 1, grlId = 1, lcId = 1;

const eligible = D.sales_order
  .filter((o) => ['APPROVED', 'PROCESSING', 'PARTIALLY DELIVERED', 'DELIVERED', 'INVOICED', 'PAID'].includes(o.status))
  .sort((a, b) => a.order_date.localeCompare(b.order_date))
  .slice(-55);

eligible.forEach((o) => {
  const lines = D.sales_order_line.filter((l) => l.order_no === o.no);
  const groups = {};
  lines.forEach((l) => {
    const sup = prodOf(l.product_id)?.default_supplier_code || 'SUP-UMUM';
    (groups[sup] = groups[sup] || []).push(l);
  });

  Object.entries(groups).forEach(([supplier, gl]) => {
    const no = `PO-2026-${pad(++poSeq)}`;
    let gross = 0;
    const polIds = [];
    gl.forEach((l, k) => {
      const base = Number(prodOf(l.product_id)?.base_price || 0);
      gross += r2(l.qty * base);
      D.purchase_order_line.push({
        id: polId, po_no: no, line_no: k + 1, product_id: l.product_id,
        name: l.name, unit: l.unit, qty: l.qty, price: base,
        disc_pct: 0, tax_pct: 0, received_qty: 0, so_line_id: l.id,
      });
      l.po_line_id = polId;
      polIds.push(polId);
      polId += 1;
    });

    const received = rnd() < 0.8;
    D.purchase_order.push({
      no, po_date: o.order_date,
      expected_date: o.delivery_date || o.order_date,
      supplier_code: supplier, warehouse_code: o.warehouse_code,
      order_no: o.no, term_code: D.supplier.find((x) => x.code === supplier)?.term_code || 'COD',
      note: `Dibuat otomatis dari ${o.no}`,
      status: received ? 'RECEIVED' : 'SENT',
      gross: r2(gross), disc: 0, sub: r2(gross), tax: 0, total: r2(gross),
      created_at: o.order_date + 'T02:00:00+00:00',
    });
    if (!received) return;

    /* Penerimaan: harga pasar bergerak −12%..+18% terhadap estimasi. */
    const grn = `GRN-2026-${pad(++grnSeq)}`;
    const factor = 0.88 + rnd() * 0.3;
    const rows = polIds.map((id) => {
      const pol = D.purchase_order_line.find((x) => x.id === id);
      pol.received_qty = pol.qty;
      return { pol, price: r2(pol.price * factor) };
    });

    const landed = [
      { kind: 'Transport', description: 'Angkutan ke gudang', amount: 150000 + Math.floor(rnd() * 250000), alloc_method: 'VALUE' },
      { kind: pick(LANDED_KINDS.slice(1)), description: 'Biaya gudang', amount: 30000 + Math.floor(rnd() * 45000), alloc_method: 'QTY' },
    ];
    const byVal = landed.filter((c) => c.alloc_method === 'VALUE').reduce((a, c) => a + c.amount, 0);
    const byQty = landed.filter((c) => c.alloc_method === 'QTY').reduce((a, c) => a + c.amount, 0);
    const sumVal = rows.reduce((a, x) => a + x.price * x.pol.qty, 0);
    const sumQty = rows.reduce((a, x) => a + Number(x.pol.qty), 0);

    let qtyTot = 0, goodsTot = 0, landedTot = 0;
    rows.forEach((x) => {
      const alloc = r2((sumVal ? (byVal * x.price * x.pol.qty) / sumVal : 0)
        + (sumQty ? (byQty * x.pol.qty) / sumQty : 0));
      const unitCost = r2((x.price * x.pol.qty + alloc) / x.pol.qty);
      D.goods_receipt_line.push({
        id: grlId++, grn_no: grn, po_line_id: x.pol.id, product_id: x.pol.product_id,
        name: x.pol.name, unit: x.pol.unit, qty: x.pol.qty, price: x.price,
        landed_alloc: alloc, unit_cost: unitCost,
      });
      qtyTot += Number(x.pol.qty);
      goodsTot += x.price * x.pol.qty;
      landedTot += alloc;
      const pr = prodOf(x.pol.product_id);
      if (pr) pr.base_price = unitCost;   // harga pokok mengikuti biaya hari itu
    });
    landed.forEach((c) => D.landed_cost.push({ id: lcId++, grn_no: grn, ...c }));

    D.goods_receipt.push({
      no: grn, grn_date: o.order_date, po_no: no, supplier_code: supplier,
      warehouse_code: o.warehouse_code,
      supplier_invoice: `NOTA-${supplier.slice(4)}-${o.order_date.slice(5, 7)}${o.order_date.slice(8, 10)}`,
      note: null, status: 'POSTED', qty_total: qtyTot,
      goods_total: r2(goodsTot), landed_total: r2(landedTot), total: r2(goodsTot + landedTot),
      journal_no: null, created_at: o.order_date + 'T04:00:00+00:00',
    });
  });
});

/* View harga beli harian dihitung di sini karena emulator tidak punya SQL. */
const agg = new Map();
D.goods_receipt_line.forEach((l) => {
  const g = D.goods_receipt.find((x) => x.no === l.grn_no);
  const key = l.product_id + '|' + g.grn_date;
  const c = agg.get(key) || { product_id: l.product_id, price_date: g.grn_date, qty: 0, v: 0, lv: 0, min_price: Infinity, max_price: 0, n_receipt: 0 };
  c.qty += Number(l.qty); c.v += l.price * l.qty; c.lv += l.unit_cost * l.qty;
  c.min_price = Math.min(c.min_price, l.price); c.max_price = Math.max(c.max_price, l.price);
  c.n_receipt += 1;
  agg.set(key, c);
});
D.purchase_price_daily = [...agg.values()].map((c) => ({
  product_id: c.product_id, price_date: c.price_date, qty: c.qty,
  avg_price: r2(c.v / c.qty), avg_landed_cost: r2(c.lv / c.qty),
  min_price: c.min_price, max_price: c.max_price, n_receipt: c.n_receipt,
}));

fs.writeFileSync(FILE, JSON.stringify(D));
console.log('supplier', D.supplier.length, '| PO', D.purchase_order.length,
  '| baris PO', D.purchase_order_line.length, '| GRN', D.goods_receipt.length,
  '| baris GRN', D.goods_receipt_line.length, '| landed', D.landed_cost.length,
  '| harga harian', D.purchase_price_daily.length);
