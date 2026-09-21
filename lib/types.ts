/* Tipe baris database — mengikuti skema Supabase project sayurtop-o2c. */

export type Profile = {
  id: string; username: string; name: string; email: string;
  role_code: string; role_name: string;
  menus: string[] | '*'; acts: string[] | '*';
  salesperson_code: string | null;
};

export type Product = {
  id: string; category: string; category_name: string; name: string;
  description: string | null; unit: string;
  sell_price: number; base_price: number; tax_rate: number;
  stock: number; min_stock: number; active: boolean;
};

export type Customer = {
  code: string; name: string; type: string | null; npwp: string | null;
  credit_limit: number; term_code: string | null; salesperson_code: string | null;
  wa: string | null; email: string | null; pic: string | null;
  billing_address: string | null; shipping_address: string | null; active: boolean;
};

export type Salesperson = { code: string; name: string; area: string | null; target: number; phone: string | null };
export type Warehouse = { code: string; name: string; addr: string | null; pic: string | null };
export type Driver = { code: string; name: string; sim: string | null; phone: string | null; vehicle_code: string | null };
export type Vehicle = { code: string; type: string | null; capacity: string | null };
export type PaymentTerm = { code: string; name: string; days: number };
export type Tax = { code: string; name: string; rate: number; account_code: string | null };
export type BankAccount = { code: string; name: string; account_no: string | null; holder: string | null; coa_code: string | null };
export type Coa = { code: string; name: string; type: string; group_name: string; normal: string };

export type DocLine = {
  id?: number; line_no?: number; product_id: string; name: string; unit: string;
  qty: number; price: number; disc_pct: number; tax_pct: number;
  ret_qty?: number; ret_reason?: string | null; ordered_qty?: number; reason?: string | null;
};

export type SalesOrder = {
  no: string; order_date: string; delivery_date: string | null; customer_code: string;
  salesperson_code: string | null; warehouse_code: string | null; po_no: string | null;
  term_code: string | null; note: string | null; status: string;
  gross: number; disc: number; sub: number; tax: number; total: number;
  below_cost: BelowCost[] | null; quotation_no: string | null;
  created_at: string; approved_at: string | null;
  lines?: DocLine[];
};

export type BelowCost = {
  product_id: string; name: string; unit: string;
  price: number; disc_pct: number; net: number; base: number; gap: number;
};

export type Delivery = {
  no: string; delivery_date: string; order_no: string; customer_code: string;
  warehouse_code: string | null; driver_code: string | null; vehicle_code: string | null;
  note: string | null; status: string; qty_total: number;
  recv_date: string | null; recv_by: string | null; created_at: string;
  lines?: DocLine[];
};

export type Invoice = {
  no: string; invoice_date: string; due_date: string; customer_code: string;
  order_no: string | null; po_no: string | null; term_code: string | null;
  salesperson_code: string | null; note: string | null;
  gross: number; disc: number; sub: number; tax: number; total: number;
  return_total: number; paid: number; status: string; posted: boolean;
  journal_no: string | null; created_at: string;
  net_total?: number; outstanding?: number; calc_status?: string; days_overdue?: number;
  lines?: DocLine[];
};

export type CreditNote = {
  no: string; cn_date: string; invoice_no: string; return_no: string | null;
  customer_code: string; reason: string | null; note: string | null;
  sub: number; tax: number; total: number; status: string; journal_no: string | null;
  lines?: DocLine[];
};

export type SalesReturn = {
  no: string; return_date: string; invoice_no: string; order_no: string | null;
  customer_code: string; warehouse_code: string | null; reason: string | null; note: string | null;
  sub: number; tax: number; total: number; status: string; cn_no: string | null;
  lines?: DocLine[];
};

export type Payment = {
  no: string; pay_date: string; customer_code: string; amount: number;
  method: string; bank_code: string | null; ref: string | null; advance: number;
  status: string; journal_no: string | null;
  alloc?: { invoice_no: string; amount: number }[];
};

export type Collection = {
  no: string; invoice_no: string; customer_code: string; amount: number;
  due_date: string | null; status: string | null; promise_date: string | null;
  history?: { contact_date: string; channel: string; note: string | null; by_user: string | null }[];
};

export type JournalLine = { line_no: number; account_code: string; description: string | null; debit: number; credit: number };
export type Journal = {
  no: string; journal_date: string; ref_type: string; ref: string | null; memo: string | null;
  debit: number; credit: number; posted: boolean;
  lines?: JournalLine[];
};

export type AuditRow = {
  id: number; ts: string; username: string | null; user_name: string | null;
  action: string; doc: string | null; field: string | null;
  before_val: string | null; after_val: string | null;
};

export type Quotation = {
  no: string; quo_date: string; valid_until: string | null; customer_code: string;
  salesperson_code: string | null; status: string;
  gross: number; disc: number; sub: number; tax: number; total: number; order_no: string | null;
  lines?: DocLine[];
};

export type Settings = {
  id: number; company: Company; vat_rate: number; default_term: string | null;
  default_warehouse: string | null; approval_order_limit: number;
  approval_disc_limit: number; currency: string;
};

export type Company = {
  name: string; legal: string; tagline?: string; addr: string;
  phone: string; email: string; npwp: string; bank: string;
};

export type OrderOutstanding = {
  order_no: string; product_id: string; name: string; unit: string;
  ordered_qty: number; delivered_qty: number; outstanding_qty: number;
};
