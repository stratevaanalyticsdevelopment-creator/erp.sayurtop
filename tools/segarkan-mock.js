/* Menyegarkan data tiruan agar ikut maju bersama kalender — cerminan dari
   refresh_demo_data() dan refresh_demo_schedule() di basis data (migrasi 0022
   dan 0025).

   Tanpa ini data tiruan membeku, dan halaman-halaman yang menyaring "hari ini"
   atau "bulan ini" tampak rusak padahal kodenya benar:

     - Packaging, Picking List, Kebutuhan Pembelian kosong
     - Dasbor "Top Customer <bulan ini>" dan "Produk Terlaris <bulan ini>" kosong
     - Laporan Penjualan bulan berjalan nol

   Cara kerjanya sama dengan di basis data: SELURUH tanggal dokumen digeser
   sejauh jarak antara invoice terakhir dan hari ini, sehingga jarak antar
   dokumen, umur piutang, dan pembukuan tidak berubah.

       node tools/segarkan-mock.js            # geser secukupnya
       node tools/segarkan-mock.js --hari 7   # geser tepat 7 hari
*/
const fs = require('fs');
const path = require('path');

const berkas = path.join(__dirname, 'mock-data.json');
const d = JSON.parse(fs.readFileSync(berkas, 'utf8'));

const arg = process.argv.slice(2);
const iHari = arg.indexOf('--hari');
const hariPaksa = iHari >= 0 ? parseInt(arg[iHari + 1], 10) : null;

const HARI = 86400000;
/* Tanggal LOKAL, bukan UTC — aplikasi memakai getFullYear/getMonth/getDate
   dari peramban, jadi acuan harinya harus sama. Memakai toISOString() di sini
   akan salah satu hari setiap kali jam UTC belum berganti hari. */
const pad = (n) => String(n).padStart(2, '0');
const iso = (t) => t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
const hariIni = iso(new Date());
/* Tanggal "YYYY-MM-DD" digeser sebagai tanggal murni, bebas zona waktu. */
const geserISO = (s, n) => {
  if (!s) return s;
  const [y, m, h] = s.split('-').map(Number);
  return iso(new Date(y, m - 1, h + n));
};
const geserTS = (s, n) => (s ? new Date(new Date(s).getTime() + n * HARI).toISOString() : s);
const selisihHari = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / HARI);
};

/* Kolom tanggal per tabel — sama dengan daftar di migrasi 0025. */
const TANGGAL = {
  quotation: ['quo_date', 'valid_until'],
  sales_order: ['order_date', 'delivery_date'],
  delivery: ['delivery_date', 'recv_date'],
  invoice: ['invoice_date', 'due_date'],
  sales_return: ['return_date'],
  credit_note: ['cn_date'],
  payment: ['pay_date'],
  collection: ['due_date', 'promise_date'],
  collection_history: ['contact_date'],
  purchase_order: ['po_date', 'expected_date'],
  goods_receipt: ['grn_date'],
  supplier_price: ['price_date'],
  journal: ['journal_date'],
};
const CAP_WAKTU = { sales_order_timeline: ['ts'], audit_log: ['ts'] };

/* View turunan menyimpan salinan tanggalnya sendiri. */
const VIEW_TANGGAL = {
  packing_line_view: ['delivery_date'],
  purchase_demand_line_view: ['order_date', 'delivery_date'],
  invoice_view: ['invoice_date', 'due_date'],
  purchase_price_daily: ['price_date'],
  supplier_price_current: ['price_date'],
};

/* ---------- 1. Berapa hari tertinggal ---------- */
const invTerakhir = (d.invoice || []).map((r) => r.invoice_date).filter(Boolean).sort().slice(-1)[0];
let hari = hariPaksa;
if (hari === null) {
  hari = invTerakhir ? selisihHari(invTerakhir, hariIni) : 0;
  if (hari < 0) hari = 0;
}

if (hari === 0) {
  console.log('Data tiruan sudah sejajar dengan hari ini (' + hariIni + '), tidak ada yang digeser.');
} else {
  let n = 0;
  for (const [tabel, kolom] of Object.entries({ ...TANGGAL, ...VIEW_TANGGAL })) {
    for (const r of d[tabel] || []) {
      for (const k of kolom) if (r[k]) { r[k] = geserISO(r[k], hari); n++; }
    }
  }
  for (const [tabel, kolom] of Object.entries(CAP_WAKTU)) {
    for (const r of d[tabel] || []) {
      for (const k of kolom) if (r[k]) { r[k] = geserTS(r[k], hari); n++; }
    }
  }
  console.log('digeser            :', hari, 'hari');
  console.log('nilai tanggal diubah:', n);
  console.log('invoice terakhir    :', invTerakhir, '->', geserISO(invTerakhir, hari));
}

/* ---------- 2. Jadwal kirim order terbuka disebar hari ini s.d. H+3 ---------- */
const TERBUKA = ['APPROVED', 'PROCESSING', 'PARTIALLY DELIVERED'];
const tambah = (n) => geserISO(hariIni, n);
const buka = (d.sales_order || [])
  .filter((r) => TERBUKA.includes(r.status))
  .sort((a, b) => (a.delivery_date || '').localeCompare(b.delivery_date || '') ||
                  a.no.localeCompare(b.no));
const baru = new Map();
buka.forEach((r, i) => { const t = tambah(i % 4); r.delivery_date = t; baru.set(r.no, t); });

let ikut = 0;
for (const nama of ['packing_line_view', 'purchase_demand_line_view']) {
  for (const r of d[nama] || []) {
    if (baru.has(r.order_no)) { r.delivery_date = baru.get(r.order_no); ikut++; }
  }
}
for (const r of d.purchase_demand_view || []) {
  const t = (d.purchase_demand_line_view || [])
    .filter((l) => l.product_id === r.product_id)
    .map((l) => l.delivery_date).filter(Boolean).sort()[0];
  if (t) { if ('earliest_date' in r) r.earliest_date = t; if ('delivery_date' in r) r.delivery_date = t; }
}

fs.writeFileSync(berkas, JSON.stringify(d, null, 1));
console.log('order terbuka dijadwal ulang:', buka.length, '(baris view ikut:', ikut + ')');
console.log('rentang tanggal kirim       :', tambah(0), 's.d.', tambah(3));
