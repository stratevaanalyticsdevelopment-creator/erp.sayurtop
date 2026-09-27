create extension if not exists "pgcrypto";

create table payment_term (
  code text primary key, name text not null, days int not null default 0 check (days >= 0));

create table tax (
  code text primary key, name text not null,
  rate numeric(6,3) not null default 0 check (rate >= 0 and rate <= 100), account_code text);

create table coa (
  code text primary key, name text not null,
  type text not null check (type in ('ASSET','LIAB','EQUITY','REVENUE','COGS','EXPENSE')),
  group_name text not null, normal char(1) not null check (normal in ('D','C')));

create table bank_account (
  code text primary key, name text not null, account_no text, holder text,
  coa_code text references coa(code));

create table warehouse (code text primary key, name text not null, addr text, pic text);

create table salesperson (code text primary key, name text not null, area text,
  target numeric(16,2) not null default 0, phone text);

create table vehicle (code text primary key, type text, capacity text);

create table driver (code text primary key, name text not null, sim text, phone text,
  vehicle_code text references vehicle(code));

create table customer (
  code text primary key, name text not null, type text, npwp text default '-',
  credit_limit numeric(16,2) not null default 0 check (credit_limit >= 0),
  term_code text references payment_term(code),
  salesperson_code text references salesperson(code),
  wa text, email text, pic text, billing_address text, shipping_address text,
  active boolean not null default true, created_at timestamptz not null default now());

create table product (
  id text primary key, category text not null, category_name text not null,
  name text not null, description text default '', unit text not null default 'Kg',
  sell_price numeric(16,2) not null default 0 check (sell_price >= 0),
  base_price numeric(16,2) not null default 0 check (base_price >= 0),
  tax_rate numeric(6,3) not null default 11,
  stock numeric(16,3) not null default 0, min_stock numeric(16,3) not null default 0,
  active boolean not null default true, created_at timestamptz not null default now());
create index product_category_idx on product(category);
create index product_name_idx on product(lower(name));

create table app_role (
  code text primary key, name text not null, description text,
  menus jsonb not null default '[]'::jsonb, acts jsonb not null default '[]'::jsonb);

create table app_user (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null, name text not null, email text unique not null,
  role_code text not null references app_role(code),
  salesperson_code text references salesperson(code),
  active boolean not null default true, created_at timestamptz not null default now());

create table doc_counter (prefix text not null, year int not null,
  seq int not null default 0, primary key (prefix, year));

create table sales_order (
  no text primary key, order_date date not null, delivery_date date,
  customer_code text not null references customer(code),
  salesperson_code text references salesperson(code),
  warehouse_code text references warehouse(code),
  po_no text, term_code text references payment_term(code), note text,
  status text not null default 'DRAFT',
  gross numeric(16,2) not null default 0, disc numeric(16,2) not null default 0,
  sub numeric(16,2) not null default 0, tax numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0, below_cost jsonb, quotation_no text,
  created_by uuid references app_user(id), created_at timestamptz not null default now(),
  approved_by uuid references app_user(id), approved_at timestamptz);
create index sales_order_customer_idx on sales_order(customer_code);
create index sales_order_status_idx on sales_order(status);
create index sales_order_date_idx on sales_order(order_date desc);

create table sales_order_line (
  id bigserial primary key, order_no text not null references sales_order(no) on delete cascade,
  line_no int not null, product_id text not null references product(id),
  name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0),
  price numeric(16,2) not null check (price >= 0),
  disc_pct numeric(6,3) not null default 0, tax_pct numeric(6,3) not null default 0,
  unique (order_no, line_no));
create index sales_order_line_order_idx on sales_order_line(order_no);

create table sales_order_timeline (
  id bigserial primary key, order_no text not null references sales_order(no) on delete cascade,
  ts timestamptz not null default now(), text text not null, by_user text);
create index sales_order_timeline_order_idx on sales_order_timeline(order_no, ts);

create table delivery (
  no text primary key, delivery_date date not null,
  order_no text not null references sales_order(no),
  customer_code text not null references customer(code),
  warehouse_code text references warehouse(code),
  driver_code text references driver(code), vehicle_code text, note text,
  status text not null default 'IN TRANSIT',
  qty_total numeric(16,3) not null default 0, recv_date date, recv_by text,
  created_by uuid references app_user(id), created_at timestamptz not null default now());
create index delivery_order_idx on delivery(order_no);
create index delivery_status_idx on delivery(status);

create table delivery_line (
  id bigserial primary key, delivery_no text not null references delivery(no) on delete cascade,
  product_id text not null references product(id), name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0), ordered_qty numeric(16,3) not null default 0,
  price numeric(16,2) not null default 0, disc_pct numeric(6,3) not null default 0,
  tax_pct numeric(6,3) not null default 0);
create index delivery_line_delivery_idx on delivery_line(delivery_no);

create table invoice (
  no text primary key, invoice_date date not null, due_date date not null,
  customer_code text not null references customer(code),
  order_no text references sales_order(no), po_no text,
  term_code text references payment_term(code),
  salesperson_code text references salesperson(code), note text,
  gross numeric(16,2) not null default 0, disc numeric(16,2) not null default 0,
  sub numeric(16,2) not null default 0, tax numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0, return_total numeric(16,2) not null default 0,
  paid numeric(16,2) not null default 0, status text not null default 'OPEN',
  posted boolean not null default true, journal_no text,
  created_by uuid references app_user(id), created_at timestamptz not null default now());
create index invoice_customer_idx on invoice(customer_code);
create index invoice_due_idx on invoice(due_date);
create index invoice_order_idx on invoice(order_no);

create table invoice_delivery (
  invoice_no text not null references invoice(no) on delete cascade,
  delivery_no text not null references delivery(no),
  primary key (invoice_no, delivery_no));

create table invoice_line (
  id bigserial primary key, invoice_no text not null references invoice(no) on delete cascade,
  line_no int not null, product_id text not null references product(id),
  name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0), price numeric(16,2) not null,
  disc_pct numeric(6,3) not null default 0, tax_pct numeric(6,3) not null default 0,
  ret_qty numeric(16,3) not null default 0 check (ret_qty >= 0), ret_reason text,
  unique (invoice_no, line_no), check (ret_qty <= qty));
create index invoice_line_invoice_idx on invoice_line(invoice_no);

create table sales_return (
  no text primary key, return_date date not null,
  invoice_no text not null references invoice(no),
  order_no text references sales_order(no),
  customer_code text not null references customer(code),
  warehouse_code text references warehouse(code), reason text, note text,
  sub numeric(16,2) not null default 0, tax numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0, status text not null default 'APPROVED',
  cn_no text, created_by uuid references app_user(id),
  created_at timestamptz not null default now());

create table sales_return_line (
  id bigserial primary key, return_no text not null references sales_return(no) on delete cascade,
  product_id text not null references product(id), name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0), price numeric(16,2) not null,
  disc_pct numeric(6,3) not null default 0, tax_pct numeric(6,3) not null default 0, reason text);

create table credit_note (
  no text primary key, cn_date date not null,
  invoice_no text not null references invoice(no),
  return_no text references sales_return(no),
  customer_code text not null references customer(code), reason text, note text,
  sub numeric(16,2) not null default 0, tax numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0, status text not null default 'POSTED',
  posted boolean not null default true, journal_no text,
  created_by uuid references app_user(id), created_at timestamptz not null default now());
create index credit_note_invoice_idx on credit_note(invoice_no);

create table credit_note_line (
  id bigserial primary key, cn_no text not null references credit_note(no) on delete cascade,
  product_id text not null references product(id), name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0), price numeric(16,2) not null,
  disc_pct numeric(6,3) not null default 0, tax_pct numeric(6,3) not null default 0, reason text);

create table payment (
  no text primary key, pay_date date not null,
  customer_code text not null references customer(code),
  amount numeric(16,2) not null check (amount > 0),
  method text not null default 'Transfer', bank_code text references bank_account(code),
  ref text, advance numeric(16,2) not null default 0, status text not null default 'POSTED',
  journal_no text, created_by uuid references app_user(id),
  created_at timestamptz not null default now());
create index payment_customer_idx on payment(customer_code);

create table payment_alloc (
  id bigserial primary key, payment_no text not null references payment(no) on delete cascade,
  invoice_no text not null references invoice(no), amount numeric(16,2) not null check (amount > 0));
create index payment_alloc_invoice_idx on payment_alloc(invoice_no);

create table collection (
  no text primary key, invoice_no text not null references invoice(no),
  customer_code text not null references customer(code),
  amount numeric(16,2) not null default 0, due_date date, status text, promise_date date,
  created_at timestamptz not null default now());

create table collection_history (
  id bigserial primary key, collection_no text not null references collection(no) on delete cascade,
  contact_date date not null, channel text not null, note text, by_user text,
  created_at timestamptz not null default now());

create table journal (
  no text primary key, journal_date date not null, ref_type text not null, ref text, memo text,
  debit numeric(16,2) not null default 0, credit numeric(16,2) not null default 0,
  posted boolean not null default true, created_by uuid references app_user(id),
  created_at timestamptz not null default now(), check (debit = credit));
create index journal_date_idx on journal(journal_date);
create index journal_ref_idx on journal(ref);

create table journal_line (
  id bigserial primary key, journal_no text not null references journal(no) on delete cascade,
  line_no int not null, account_code text not null references coa(code), description text,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0));
create index journal_line_journal_idx on journal_line(journal_no);
create index journal_line_account_idx on journal_line(account_code);

create table audit_log (
  id bigserial primary key, ts timestamptz not null default now(), user_id uuid,
  username text, user_name text, action text not null, doc text, field text,
  before_val text, after_val text);
create index audit_log_ts_idx on audit_log(ts desc);
create index audit_log_doc_idx on audit_log(doc);

create table settings (
  id int primary key default 1 check (id = 1),
  company jsonb not null default '{}'::jsonb,
  vat_rate numeric(6,3) not null default 11,
  default_term text default 'NET30', default_warehouse text default 'WH-JKT',
  approval_order_limit numeric(16,2) not null default 100000000,
  approval_disc_limit numeric(6,3) not null default 10,
  currency text not null default 'IDR');
