-- =====================================================================
-- MODUL PEMBELIAN — supplier, Purchase Order, Inbound (Goods Receipt),
-- landed cost, dan penautan PO↔SO sebagai dasar Auto-Match HPP.
-- =====================================================================

create table supplier (
  code text primary key,
  name text not null,
  type text,                              -- Petani / Pengepul / Distributor / Pasar Induk
  pic text, phone text, address text,
  term_code text references payment_term(code),
  bank_name text, bank_account text,
  active boolean not null default true,
  created_at timestamptz not null default now());

-- Supplier default per produk: dipakai saat PO dibuat otomatis dari SO.
alter table product add column default_supplier_code text references supplier(code);

create table purchase_order (
  no text primary key,
  po_date date not null,
  expected_date date,
  supplier_code text not null references supplier(code),
  warehouse_code text references warehouse(code),
  order_no text references sales_order(no),   -- SO yang memicu PO ini
  term_code text references payment_term(code),
  note text,
  status text not null default 'DRAFT',       -- DRAFT/SENT/PARTIALLY RECEIVED/RECEIVED/CANCELLED
  gross numeric(16,2) not null default 0,
  disc  numeric(16,2) not null default 0,
  sub   numeric(16,2) not null default 0,
  tax   numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now());
create index purchase_order_supplier_idx on purchase_order(supplier_code);
create index purchase_order_date_idx on purchase_order(po_date desc);
create index purchase_order_so_idx on purchase_order(order_no);
create index purchase_order_status_idx on purchase_order(status);

create table purchase_order_line (
  id bigserial primary key,
  po_no text not null references purchase_order(no) on delete cascade,
  line_no int not null,
  product_id text not null references product(id),
  name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0),
  price numeric(16,2) not null default 0 check (price >= 0),
  disc_pct numeric(6,3) not null default 0,
  tax_pct  numeric(6,3) not null default 0,
  received_qty numeric(16,3) not null default 0,
  so_line_id bigint references sales_order_line(id),   -- tautan ke baris SO
  unique (po_no, line_no));
create index purchase_order_line_po_idx on purchase_order_line(po_no);
create index purchase_order_line_so_idx on purchase_order_line(so_line_id);

-- Tautan balik pada baris SO: dipakai Auto-Match HPP.
alter table sales_order_line add column po_line_id bigint references purchase_order_line(id);
create index sales_order_line_po_idx on sales_order_line(po_line_id);

create table goods_receipt (
  no text primary key,
  grn_date date not null,
  po_no text references purchase_order(no),
  supplier_code text not null references supplier(code),
  warehouse_code text references warehouse(code),
  supplier_invoice text,                    -- nomor nota/faktur dari supplier
  note text,
  status text not null default 'POSTED',
  qty_total numeric(16,3) not null default 0,
  goods_total   numeric(16,2) not null default 0,   -- nilai barang sebelum landed cost
  landed_total  numeric(16,2) not null default 0,   -- total biaya tambahan
  total numeric(16,2) not null default 0,           -- nilai persediaan yang dikapitalisasi
  journal_no text,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now());
create index goods_receipt_po_idx on goods_receipt(po_no);
create index goods_receipt_date_idx on goods_receipt(grn_date desc);
create index goods_receipt_supplier_idx on goods_receipt(supplier_code);

create table goods_receipt_line (
  id bigserial primary key,
  grn_no text not null references goods_receipt(no) on delete cascade,
  po_line_id bigint references purchase_order_line(id),
  product_id text not null references product(id),
  name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0),        -- qty yang benar-benar diterima
  price numeric(16,2) not null check (price >= 0),   -- harga beli aktual hari itu
  landed_alloc numeric(16,2) not null default 0,     -- porsi landed cost baris ini
  unit_cost numeric(16,4) not null default 0);       -- (price*qty + landed_alloc) / qty
create index goods_receipt_line_grn_idx on goods_receipt_line(grn_no);
create index goods_receipt_line_pol_idx on goods_receipt_line(po_line_id);
create index goods_receipt_line_prod_idx on goods_receipt_line(product_id);

create table landed_cost (
  id bigserial primary key,
  grn_no text not null references goods_receipt(no) on delete cascade,
  kind text not null,                        -- Transport / Bongkar Muat / Sortir & Packing / Retribusi / Lain-lain
  description text,
  amount numeric(16,2) not null check (amount >= 0),
  alloc_method text not null default 'VALUE' check (alloc_method in ('VALUE','QTY')),
  created_at timestamptz not null default now());
create index landed_cost_grn_idx on landed_cost(grn_no);

-- Harga beli aktual per produk per hari (rata-rata tertimbang dari penerimaan).
create view purchase_price_daily with (security_invoker = on) as
  select l.product_id, g.grn_date as price_date,
         sum(l.qty) as qty,
         round(sum(l.price * l.qty) / nullif(sum(l.qty),0), 2)     as avg_price,
         round(sum(l.unit_cost * l.qty) / nullif(sum(l.qty),0), 2) as avg_landed_cost,
         min(l.price) as min_price, max(l.price) as max_price,
         count(*) as n_receipt
  from goods_receipt_line l
  join goods_receipt g on g.no = l.grn_no
  where g.status <> 'CANCELLED'
  group by l.product_id, g.grn_date;

-- CoA tambahan untuk pembelian.
insert into coa(code,name,type,group_name,normal) values
  ('1310','Persediaan Dalam Perjalanan','ASSET','Aset Lancar','D'),
  ('2150','Utang Supplier','LIAB','Kewajiban Lancar','C'),
  ('5200','Biaya Angkut Pembelian','COGS','HPP','D')
on conflict (code) do nothing;

-- Penomoran dokumen baru.
insert into doc_counter(prefix, year, seq)
select p, extract(year from (now() at time zone 'Asia/Jakarta'))::int, 0
from unnest(array['PO','GRN']) p
on conflict (prefix, year) do nothing;

-- ---------- RLS ----------
do $mig$
declare t record;
begin
  for t in select * from (values
    ('supplier','m.supplier'),
    ('purchase_order','buy.po'), ('purchase_order_line','buy.po'),
    ('goods_receipt','buy.inbound'), ('goods_receipt_line','buy.inbound'),
    ('landed_cost','buy.landed')
  ) as x(tbl, menu) loop
    execute format('alter table %I enable row level security', t.tbl);
    execute format('create policy %I on %I for select to authenticated using (public.rbac(%L,''view''))',
      t.tbl||'_sel', t.tbl, t.menu);
    execute format('create policy %I on %I for insert to authenticated with check (public.rbac(%L,''create''))',
      t.tbl||'_ins', t.tbl, t.menu);
    execute format('create policy %I on %I for update to authenticated using (public.rbac(%L,''edit'')) with check (public.rbac(%L,''edit''))',
      t.tbl||'_upd', t.tbl, t.menu, t.menu);
    execute format('create policy %I on %I for delete to authenticated using (public.rbac(%L,''delete''))',
      t.tbl||'_del', t.tbl, t.menu);
  end loop;
end $mig$;

-- Supplier dibaca juga oleh halaman PO dan Inbound.
create policy supplier_read on supplier for select to authenticated using (true);
