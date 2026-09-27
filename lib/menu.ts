/* Struktur menu, rute, dan konstanta status — identik dengan versi HTML. */

export type MenuItem = { k: string; ic: string; t: string; href: string; badge?: 'approval' };
export type MenuGroup = { grp: string | null; items: MenuItem[] };

export const MENU: MenuGroup[] = [
  { grp: null, items: [{ k: 'dashboard', ic: '▦', t: 'Dashboard', href: '/' }] },
  { grp: 'Sales', items: [
    { k: 'sales.quotation', ic: '▤', t: 'Quotation', href: '/sales/quotation' },
    { k: 'sales.order', ic: '▦', t: 'Sales Order', href: '/sales/order' },
    { k: 'sales.approval', ic: '✓', t: 'Order Approval', href: '/sales/approval', badge: 'approval' },
    { k: 'sales.return', ic: '↩', t: 'Sales Return', href: '/sales/return' },
  ] },
  { grp: 'Purchasing', items: [
    { k: 'buy.po', ic: '🧾', t: 'Purchase Order', href: '/purchasing/po' },
    { k: 'buy.inbound', ic: '⇩', t: 'Inbound / Receiving', href: '/purchasing/inbound' },
    { k: 'buy.landed', ic: '⊕', t: 'Landed Cost', href: '/purchasing/landed-cost' },
    { k: 'buy.price', ic: '📈', t: 'Harga Beli Harian', href: '/purchasing/price' },
    { k: 'buy.supplierprice', ic: '⚖', t: 'Perbandingan Harga Supplier', href: '/purchasing/supplier-price' },
  ] },
  { grp: 'Logistics', items: [
    { k: 'log.picking', ic: '☑', t: 'Picking List', href: '/logistics/picking' },
    { k: 'log.packaging', ic: '📦', t: 'Packaging', href: '/logistics/packaging' },
    { k: 'log.sj', ic: '🚚', t: 'Surat Jalan', href: '/logistics/surat-jalan' },
    { k: 'log.delivery', ic: '◉', t: 'Delivery Tracking', href: '/logistics/delivery' },
    { k: 'log.receipt', ic: '⇩', t: 'Goods Receipt', href: '/logistics/goods-receipt' },
  ] },
  { grp: 'Account Receivable', items: [
    { k: 'ar.invoice', ic: '▣', t: 'Invoice', href: '/ar/invoice' },
    { k: 'ar.creditnote', ic: '▽', t: 'Credit Note', href: '/ar/credit-note' },
    { k: 'ar.outstanding', ic: '≡', t: 'AR Outstanding', href: '/ar/outstanding' },
    { k: 'ar.aging', ic: '▥', t: 'AR Aging', href: '/ar/aging' },
    { k: 'ar.collection', ic: '☎', t: 'Collection', href: '/ar/collection' },
    { k: 'ar.payment', ic: '💰', t: 'Payment', href: '/ar/payment' },
    { k: 'ar.statement', ic: '▧', t: 'Customer Statement', href: '/ar/statement' },
  ] },
  { grp: 'Accounting', items: [
    { k: 'acc.journal', ic: '✎', t: 'General Journal', href: '/accounting/journal' },
    { k: 'acc.gl', ic: '▤', t: 'General Ledger', href: '/accounting/general-ledger' },
    { k: 'acc.coa', ic: '⌸', t: 'Chart of Accounts', href: '/accounting/coa' },
  ] },
  { grp: 'Financial Report', items: [
    { k: 'rep.pl', ic: '▲', t: 'Profit & Loss', href: '/report/profit-loss' },
    { k: 'rep.bs', ic: '⚖', t: 'Balance Sheet', href: '/report/balance-sheet' },
    { k: 'rep.cf', ic: '≈', t: 'Cash Flow', href: '/report/cash-flow' },
    { k: 'rep.tb', ic: '▦', t: 'Trial Balance', href: '/report/trial-balance' },
    { k: 'rep.sales', ic: '◫', t: 'Sales Report', href: '/report/sales' },
    { k: 'rep.aging', ic: '▥', t: 'AR Aging Report', href: '/report/ar-aging' },
    { k: 'rep.delivery', ic: '🚚', t: 'Delivery Report', href: '/report/delivery' },
  ] },
  { grp: 'Master Data', items: [
    { k: 'm.customer', ic: '☰', t: 'Customer', href: '/master/customer' },
    { k: 'm.supplier', ic: '🚜', t: 'Supplier', href: '/master/supplier' },
    { k: 'm.product', ic: '🥬', t: 'Product', href: '/master/product' },
    { k: 'm.warehouse', ic: '▢', t: 'Warehouse', href: '/master/warehouse' },
    { k: 'm.sales', ic: '♟', t: 'Sales Person', href: '/master/salesperson' },
    { k: 'm.driver', ic: '⛟', t: 'Driver & Vehicle', href: '/master/driver' },
    { k: 'm.tax', ic: '%', t: 'Tax', href: '/master/tax' },
    { k: 'm.term', ic: '◷', t: 'Payment Term', href: '/master/payment-term' },
    { k: 'm.bank', ic: '🏦', t: 'Bank Account', href: '/master/bank' },
  ] },
  { grp: 'System', items: [
    { k: 'sys.user', ic: '👤', t: 'User Management', href: '/system/user' },
    { k: 'sys.role', ic: '🔑', t: 'Role & Permission', href: '/system/role' },
    { k: 'sys.numbering', ic: '#', t: 'Document Numbering', href: '/system/numbering' },
    { k: 'sys.audit', ic: '⧉', t: 'Audit Log', href: '/system/audit' },
    { k: 'sys.settings', ic: '⚙', t: 'System Settings', href: '/system/settings' },
  ] },
];

export const PAGE_TITLE: Record<string, { t: string; g: string }> = {};
MENU.forEach((g) => g.items.forEach((i) => { PAGE_TITLE[i.k] = { t: i.t, g: g.grp || 'Beranda' }; }));

export const HREF_KEY: Record<string, string> = {};
MENU.forEach((g) => g.items.forEach((i) => { HREF_KEY[i.href] = i.k; }));

/* Urutan role pada matriks akses — disamakan dengan versi HTML. */
export const ROLE_ORDER = ['ADMIN', 'SALES', 'SLSMGR', 'WHOUSE', 'FINANCE', 'COLLECT',
  'CASHIER', 'MGMT', 'PURCH', 'AUDITOR'];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'post', 'print', 'export', 'cancel'];

export const ST = {
  DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED',
  PROCESSING: 'PROCESSING', PARTIAL: 'PARTIALLY DELIVERED', DELIVERED: 'DELIVERED',
  INVOICED: 'INVOICED', PAID: 'PAID', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED',
  POSTED: 'POSTED', OPEN: 'OPEN', OVERDUE: 'OVERDUE', PART_PAID: 'PARTIALLY PAID',
  IN_TRANSIT: 'IN TRANSIT', RECEIVED: 'RECEIVED', RETURNED: 'RETURNED',
};

export const ST_CLASS: Record<string, string> = {
  DRAFT: 'b-grey', SUBMITTED: 'b-blue', APPROVED: 'b-green', REJECTED: 'b-red',
  PROCESSING: 'b-blue', 'PARTIALLY DELIVERED': 'b-amber', DELIVERED: 'b-lime',
  INVOICED: 'b-brand', PAID: 'b-green', CLOSED: 'b-grey', CANCELLED: 'b-red',
  POSTED: 'b-green', OPEN: 'b-blue', OVERDUE: 'b-red', 'PARTIALLY PAID': 'b-amber',
  SENT: 'b-blue', 'PARTIALLY RECEIVED': 'b-amber',
  'IN TRANSIT': 'b-amber', RECEIVED: 'b-green', RETURNED: 'b-red', CONVERTED: 'b-brand',
};

export const SUPPLIER_TYPES = ['Petani', 'Pengepul', 'Peternak', 'Distributor', 'Pasar Induk'];

export const LANDED_KINDS = [
  'Transport', 'Bongkar Muat', 'Sortir & Packing', 'Retribusi Pasar', 'Susut Perjalanan', 'Lain-lain',
];

export const CATEGORIES = [
  { code: 'SAY', name: 'Sayur-Sayuran' },
  { code: 'BUA', name: 'Buah-Buahan' },
  { code: 'CAB', name: 'Cabe & Bawang' },
  { code: 'REM', name: 'Rempah-Rempah' },
  { code: 'TEL', name: 'Telur' },
  { code: 'DRY', name: 'Dry Goods' },
];
export const UNITS = ['Kg', 'Gram', 'Pack', 'Pcs', 'Ikat', 'Dus', 'Tray', 'Karung'];

/* Jenis kemasan untuk halaman Packaging. */
export const PACK_UNITS = ['Peti', 'Karton', 'Karung', 'Krat', 'Pack', 'Ikat', 'Dus', 'Tray'];

export const RETURN_REASONS = [
  'Barang layu / tidak fresh saat diterima',
  'Kelebihan kirim dari PO customer',
  'Kemasan rusak saat transit',
  'Ukuran tidak sesuai spesifikasi order',
  'Salah varian produk',
  'Barang tidak sesuai standar mutu customer',
  'Lainnya',
];
