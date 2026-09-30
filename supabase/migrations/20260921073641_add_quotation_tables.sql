create table if not exists public.quotation (
  no                text primary key,
  quo_date          date not null default today_jkt(),
  valid_until       date,
  customer_code     text not null references public.customer(code),
  salesperson_code  text references public.salesperson(code),
  note              text,
  status            text not null default 'DRAFT',
  gross             numeric(16,2) not null default 0,
  disc              numeric(16,2) not null default 0,
  sub               numeric(16,2) not null default 0,
  tax               numeric(16,2) not null default 0,
  total             numeric(16,2) not null default 0,
  order_no          text references public.sales_order(no),
  created_by        uuid references public.app_user(id),
  created_at        timestamptz not null default now()
);

create table if not exists public.quotation_line (
  id          bigint generated always as identity primary key,
  quo_no      text not null references public.quotation(no) on delete cascade,
  line_no     integer not null,
  product_id  text not null references public.product(id),
  name        text not null,
  unit        text not null,
  qty         numeric(16,2) not null,
  price       numeric(16,2) not null,
  disc_pct    numeric(6,2)  not null default 0,
  tax_pct     numeric(6,2)  not null default 0
);
create index if not exists quotation_line_quo_idx on public.quotation_line(quo_no);
create index if not exists quotation_cust_idx on public.quotation(customer_code);

alter table public.quotation enable row level security;
alter table public.quotation_line enable row level security;

create policy quotation_sel on public.quotation for select to authenticated
  using (rbac('sales.quotation','view'));
create policy quotation_ins on public.quotation for insert to authenticated
  with check (rbac('sales.quotation','create'));
create policy quotation_upd on public.quotation for update to authenticated
  using (rbac('sales.quotation','edit')) with check (rbac('sales.quotation','edit'));
create policy quotation_del on public.quotation for delete to authenticated
  using (rbac('sales.quotation','delete'));

create policy quotation_line_sel on public.quotation_line for select to authenticated
  using (rbac('sales.quotation','view'));
create policy quotation_line_ins on public.quotation_line for insert to authenticated
  with check (rbac('sales.quotation','create'));
create policy quotation_line_upd on public.quotation_line for update to authenticated
  using (rbac('sales.quotation','edit')) with check (rbac('sales.quotation','edit'));
create policy quotation_line_del on public.quotation_line for delete to authenticated
  using (rbac('sales.quotation','delete'));
