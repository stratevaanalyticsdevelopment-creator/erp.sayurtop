/* =====================================================================
   HANYA UNTUK PENGUJIAN LOKAL — bukan bagian aplikasi.
   Membentuk snapshot data berbentuk tabel Supabase dari generator versi
   HTML, supaya tampilan dapat diverifikasi tanpa akses jaringan ke
   Supabase. Bentuk kolomnya mengikuti skema project sayurtop-o2c.
   ===================================================================== */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML = process.argv[2] || '/home/claude/Strateva_O2C_ERP_SayurTop.html';
const OUT = path.join(__dirname, 'mock-data.json');

const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), { runScripts: 'dangerously', url: 'https://local.test/' });
const w = dom.window;

setTimeout(() => {
  const d = w.document;
  d.querySelector('#luser').value = 'admin';
  d.querySelector('#lpass').value = 'admin123';
  d.querySelector('#btnLogin').click();
  const DB = w.DB;
  const T = w.today();

  const line = (l, i) => ({
    id: i + 1, line_no: i + 1, product_id: l.pid, name: l.name, unit: l.unit,
    qty: +l.qty, price: +l.price, disc_pct: +(l.disc || 0), tax_pct: +(l.tax || 0),
  });

  const out = {};

  out.product = DB.products.map((p) => ({
    id: p.id, category: p.cat, category_name: p.catName, name: p.name,
    description: p.desc || null, unit: p.unit, sell_price: +p.sell, base_price: +p.base,
    tax_rate: +p.tax, stock: +p.stock, min_stock: +(p.minStock || 0), active: p.active !== false,
  }));
  out.customer = DB.customers.map((c) => ({
    code: c.code, name: c.name, type: c.type, npwp: c.npwp, credit_limit: +c.limit,
    term_code: c.term, salesperson_code: c.sales, wa: c.wa, email: c.email, pic: c.pic,
    billing_address: c.billing, shipping_address: c.shipping, active: true,
  }));
  out.salesperson = DB.salespersons.map((s) => ({ code: s.code, name: s.name, area: s.area, target: +s.target, phone: s.phone }));
  out.warehouse = DB.warehouses.map((x) => ({ code: x.code, name: x.name, addr: x.addr, pic: x.pic }));
  out.driver = DB.drivers.map((x) => ({ code: x.code, name: x.name, sim: x.sim, phone: x.phone, vehicle_code: x.vehicle }));
  out.vehicle = DB.vehicles.map((x) => ({ code: x.code, type: x.type, capacity: x.cap }));
  out.payment_term = DB.terms.map((x) => ({ code: x.code, name: x.name, days: +x.days }));
  out.tax = DB.taxes.map((x) => ({ code: x.code, name: x.name, rate: +x.rate, account_code: x.acc }));
  out.bank_account = DB.banks.map((x) => ({ code: x.code, name: x.name, account_no: x.acc, holder: x.holder, coa_code: x.coa }));
  out.coa = DB.coa.map((x) => ({ code: x.code, name: x.name, type: x.type, group_name: x.group, normal: x.normal }));
  out.app_role = DB.roles.map((r) => ({ code: r.code, name: r.name, description: r.desc, menus: r.menus, acts: r.acts }));
  out.app_user = DB.users.map((u, i) => ({
    id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
    username: u.user, name: u.name, email: u.email, role_code: u.role,
    salesperson_code: u.sales || null, active: u.active, created_at: new Date().toISOString(),
  }));
  out.settings = [{
    id: 1, company: DB.meta.company, vat_rate: 11, default_term: DB.settings.defaultTerm,
    default_warehouse: DB.settings.defaultWh, approval_order_limit: DB.settings.approvalOrderLimit,
    approval_disc_limit: DB.settings.approvalDiscLimit, currency: 'IDR',
  }];

  out.sales_order = []; out.sales_order_line = []; out.sales_order_timeline = [];
  let tlId = 1, solId = 1;
  DB.orders.forEach((o) => {
    out.sales_order.push({
      no: o.no, order_date: o.date, delivery_date: o.delDate, customer_code: o.cust,
      salesperson_code: o.sales, warehouse_code: o.wh, po_no: o.poNo, term_code: o.term,
      note: o.note || null, status: o.status, gross: +o.gross, disc: +o.disc, sub: +o.sub,
      tax: +o.tax, total: +o.total,
      below_cost: (o.belowCost && o.belowCost.length)
        ? o.belowCost.map((b) => ({ product_id: b.pid, name: b.name, unit: b.unit,
            price: +b.price, disc_pct: +(b.disc || 0), net: +b.net, base: +b.base, gap: +b.gap }))
        : null,
      quotation_no: o.quoNo || null, created_at: (o.createdAt || o.date) + '',
      approved_at: o.approvedAt || null,
    });
    o.lines.forEach((l, i) => out.sales_order_line.push({ ...line(l, i), id: solId++, order_no: o.no }));
    (o.timeline || []).forEach((t) => out.sales_order_timeline.push({
      id: tlId++, order_no: o.no, ts: t.ts, text: t.t, by_user: t.by }));
  });

  out.delivery = []; out.delivery_line = []; let dlId = 1;
  DB.deliveries.forEach((x) => {
    out.delivery.push({
      no: x.no, delivery_date: x.date, order_no: x.soNo, customer_code: x.cust,
      warehouse_code: x.wh, driver_code: x.driver, vehicle_code: x.vehicle, note: x.note || null,
      status: x.status, qty_total: +x.qtyTotal, recv_date: x.recvDate || null,
      recv_by: x.recvBy || null, created_at: x.createdAt || x.date,
    });
    x.lines.forEach((l, i) => out.delivery_line.push({
      ...line(l, i), id: dlId++, delivery_no: x.no, ordered_qty: +(l.ordered || l.qty) }));
  });

  out.invoice = []; out.invoice_line = []; out.invoice_delivery = []; let ilId = 1;
  DB.invoices.forEach((iv) => {
    out.invoice.push({
      no: iv.no, invoice_date: iv.date, due_date: iv.due, customer_code: iv.cust,
      order_no: iv.soNo, po_no: iv.poNo, term_code: iv.term, salesperson_code: iv.sales,
      note: iv.note || null, gross: +iv.gross, disc: +iv.disc, sub: +iv.sub, tax: +iv.tax,
      total: +iv.total, return_total: +(iv.returnTotal || 0), paid: +(iv.paid || 0),
      status: iv.status, posted: !!iv.posted, journal_no: iv.journalNo || null,
      created_at: iv.postedAt || iv.date,
    });
    iv.lines.forEach((l, i) => out.invoice_line.push({
      ...line(l, i), id: ilId++, invoice_no: iv.no,
      ret_qty: +(l.retQty || 0), ret_reason: l.retReason || null }));
    (iv.sjNos || []).forEach((sj) => out.invoice_delivery.push({ invoice_no: iv.no, delivery_no: sj }));
  });
  out.invoice_view = out.invoice.map((iv) => {
    const net = Math.round(iv.total - iv.return_total);
    const os = Math.round(net - iv.paid);
    const days = Math.round((new Date(T) - new Date(iv.due_date)) / 86400000);
    return { ...iv, net_total: net, outstanding: os,
      calc_status: iv.status === 'CANCELLED' ? 'CANCELLED'
        : os <= 0 ? 'PAID' : iv.paid > 0 ? 'PARTIALLY PAID' : days > 0 ? 'OVERDUE' : 'OPEN',
      days_overdue: Math.max(0, days) };
  });

  out.sales_return = []; out.sales_return_line = []; let rlId = 1;
  DB.returns.forEach((r) => {
    out.sales_return.push({
      no: r.no, return_date: r.date, invoice_no: r.invNo, order_no: r.soNo,
      customer_code: r.cust, warehouse_code: r.wh || null, reason: r.reason, note: r.note || null,
      sub: +r.sub, tax: +r.tax, total: +r.total, status: r.status, cn_no: r.cnNo || null,
    });
    r.lines.forEach((l, i) => out.sales_return_line.push({
      ...line(l, i), id: rlId++, return_no: r.no, reason: l.reason }));
  });
  out.credit_note = []; out.credit_note_line = []; let clId = 1;
  DB.creditnotes.forEach((c) => {
    out.credit_note.push({
      no: c.no, cn_date: c.date, invoice_no: c.invNo, return_no: c.retNo || null,
      customer_code: c.cust, reason: c.reason, note: c.note || null, sub: +c.sub,
      tax: +c.tax, total: +c.total, status: c.status, posted: true, journal_no: c.journalNo || null,
    });
    c.lines.forEach((l, i) => out.credit_note_line.push({
      ...line(l, i), id: clId++, cn_no: c.no, reason: l.reason }));
  });

  out.payment = []; out.payment_alloc = []; let paId = 1;
  DB.payments.forEach((p) => {
    out.payment.push({
      no: p.no, pay_date: p.date, customer_code: p.cust, amount: +p.amount, method: p.method,
      bank_code: p.bank, ref: p.ref, advance: +(p.advance || 0), status: p.status,
      journal_no: p.journalNo || null,
    });
    (p.alloc || []).forEach((a) => out.payment_alloc.push({
      id: paId++, payment_no: p.no, invoice_no: a.invNo, amount: +a.amount }));
  });

  out.collection = []; out.collection_history = []; let chId = 1;
  DB.collections.forEach((c) => {
    out.collection.push({
      no: c.no, invoice_no: c.invNo, customer_code: c.cust, amount: +c.amount,
      due_date: c.due, status: c.status, promise_date: c.promise || null,
    });
    (c.history || []).forEach((h) => out.collection_history.push({
      id: chId++, collection_no: c.no, contact_date: h.date, channel: h.ch, note: h.note, by_user: h.by }));
  });

  out.journal = []; out.journal_line = []; let jlId = 1;
  DB.journals.forEach((j) => {
    out.journal.push({
      no: j.no, journal_date: j.date, ref_type: j.refType, ref: j.ref === '-' ? null : j.ref,
      memo: j.memo, debit: +j.debit, credit: +j.credit, posted: true,
    });
    j.lines.forEach((l, i) => out.journal_line.push({
      id: jlId++, journal_no: j.no, line_no: i + 1, account_code: l.acc,
      description: l.desc, debit: +l.d, credit: +l.c }));
  });

  out.audit_log = DB.audit.map((a, i) => ({
    id: DB.audit.length - i, ts: a.ts, username: a.user, user_name: a.name, action: a.action,
    doc: a.doc, field: a.field, before_val: String(a.before), after_val: String(a.after),
  }));

  out.quotation = []; out.quotation_line = []; let qlId = 1;
  DB.quotations.forEach((q) => {
    out.quotation.push({
      no: q.no, quo_date: q.date, valid_until: q.valid, customer_code: q.cust,
      salesperson_code: q.sales, status: q.status, gross: +q.gross, disc: +q.disc,
      sub: +q.sub, tax: +q.tax, total: +q.total, order_no: q.soNo || null,
    });
    q.lines.forEach((l, i) => out.quotation_line.push({ ...line(l, i), id: qlId++, quo_no: q.no }));
  });

  out.doc_counter = Object.keys(DB.counters).map((k) => {
    const p = k.split('-');
    return { prefix: p[0], year: +p[1], seq: DB.counters[k] };
  });

  // order_outstanding_view
  out.order_outstanding_view = [];
  DB.orders.forEach((o) => {
    o.lines.forEach((l) => {
      const del = out.delivery.filter((x) => x.order_no === o.no && x.status !== 'CANCELLED')
        .reduce((a, x) => a + out.delivery_line.filter((dl) => dl.delivery_no === x.no && dl.product_id === l.pid)
          .reduce((b, dl) => b + dl.qty, 0), 0);
      out.order_outstanding_view.push({
        order_no: o.no, product_id: l.pid, name: l.name, unit: l.unit,
        ordered_qty: +l.qty, delivered_qty: del, outstanding_qty: Math.max(0, +l.qty - del),
      });
    });
  });

  fs.writeFileSync(OUT, JSON.stringify(out));
  const sizes = Object.keys(out).map((k) => `${k}=${out[k].length}`).join(' ');
  console.log('snapshot ditulis:', OUT);
  console.log(sizes);
  process.exit(0);
}, 500);
