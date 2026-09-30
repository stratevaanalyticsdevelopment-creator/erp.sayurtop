/* 0011 — Daftar produk per supplier dan riwayat harga beli */

create table if not exists supplier_product (
  supplier_code  text not null references supplier(code) on delete cascade,
  product_id     text not null references product(id) on delete cascade,
  is_preferred   boolean not null default false,
  lead_time_days int not null default 1,
  min_order_qty  numeric(14,2) not null default 0,
  note           text,
  created_at     timestamptz not null default now(),
  primary key (supplier_code, product_id));

create index if not exists supplier_product_product_idx on supplier_product(product_id);

create table if not exists supplier_price (
  id            bigserial primary key,
  supplier_code text not null references supplier(code) on delete cascade,
  product_id    text not null references product(id) on delete cascade,
  price_date    date not null,
  price         numeric(14,2) not null check (price >= 0),
  source        text not null default 'MANUAL'
                check (source in ('MANUAL','GRN','IMPORT')),
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (supplier_code, product_id, price_date));

create index if not exists supplier_price_lookup_idx
  on supplier_price(supplier_code, product_id, price_date desc);
create index if not exists supplier_price_date_idx on supplier_price(price_date);

create or replace view supplier_price_current as
select distinct on (supplier_code, product_id)
       supplier_code, product_id, price_date, price, source
  from supplier_price
 order by supplier_code, product_id, price_date desc;

create or replace function public.supplier_price_at(
  p_supplier text, p_product text, p_date date)
returns numeric language sql stable security definer set search_path = public as $fn$
  select price from supplier_price
   where supplier_code = p_supplier and product_id = p_product
     and price_date <= p_date
   order by price_date desc limit 1;
$fn$;

create or replace function public.last_po_price(
  p_supplier text, p_product text, p_before date)
returns table (price numeric, po_no text, po_date date)
language sql stable security definer set search_path = public as $fn$
  select l.price, p.no, p.po_date
    from purchase_order_line l
    join purchase_order p on p.no = l.po_no
   where p.supplier_code = p_supplier
     and l.product_id = p_product
     and p.status <> 'CANCELLED'
     and p.po_date < p_before
   order by p.po_date desc, p.no desc
   limit 1;
$fn$;

create or replace view supplier_product_view as
with ranked as (
  select supplier_code, product_id, price_date, price,
         row_number() over (partition by supplier_code, product_id
                            order by price_date desc) as rn
    from supplier_price)
select sp.supplier_code,
       sp.product_id,
       pr.name           as product_name,
       pr.unit,
       pr.category_name,
       pr.sell_price,
       pr.base_price,
       sp.is_preferred,
       sp.lead_time_days,
       sp.min_order_qty,
       sp.note,
       cur.price         as current_price,
       cur.price_date    as current_price_date,
       prv.price         as previous_price,
       prv.price_date    as previous_price_date,
       case when cur.price is not null and prv.price is not null and prv.price > 0
            then round((cur.price - prv.price) / prv.price * 100, 1) end as change_pct,
       (select count(*) from supplier_price x
         where x.supplier_code = sp.supplier_code
           and x.product_id = sp.product_id)        as price_count
  from supplier_product sp
  join product pr on pr.id = sp.product_id
  left join ranked cur on cur.supplier_code = sp.supplier_code
                      and cur.product_id = sp.product_id and cur.rn = 1
  left join ranked prv on prv.supplier_code = sp.supplier_code
                      and prv.product_id = sp.product_id and prv.rn = 2;

create or replace function public.set_supplier_price(
  p_supplier text, p_product text, p_date date, p_price numeric,
  p_source text default 'MANUAL', p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v_id bigint; v_old numeric;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah harga supplier.';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Harga tidak boleh kosong atau negatif.';
  end if;

  select price into v_old from supplier_price
   where supplier_code = p_supplier and product_id = p_product and price_date = p_date;

  insert into supplier_price(supplier_code, product_id, price_date, price, source, note, created_by)
  values (p_supplier, p_product, p_date, round(p_price, 2), coalesce(p_source,'MANUAL'), p_note, auth.uid())
  on conflict (supplier_code, product_id, price_date)
    do update set price = excluded.price, source = excluded.source,
                  note = excluded.note, created_by = excluded.created_by
  returning id into v_id;

  insert into supplier_product(supplier_code, product_id)
  values (p_supplier, p_product)
  on conflict (supplier_code, product_id) do nothing;

  perform write_audit(
    case when v_old is null then 'SET HARGA SUPPLIER' else 'UBAH HARGA SUPPLIER' end,
    p_supplier || '/' || p_product, 'harga ' || p_date::text,
    coalesce(v_old::text,'-'), round(p_price,2)::text);

  return v_id;
end $fn$;

create or replace function public.set_preferred_supplier(
  p_supplier text, p_product text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_old text;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah supplier utama.';
  end if;
  select default_supplier_code into v_old from product where id = p_product;

  update supplier_product set is_preferred = false where product_id = p_product;
  insert into supplier_product(supplier_code, product_id, is_preferred)
  values (p_supplier, p_product, true)
  on conflict (supplier_code, product_id) do update set is_preferred = true;
  update product set default_supplier_code = p_supplier where id = p_product;

  perform write_audit('SET SUPPLIER UTAMA', p_product, 'supplier',
    coalesce(v_old,'-'), p_supplier);
end $fn$;

create or replace function public.add_supplier_products(
  p_supplier text, p_products text[])
returns int language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah katalog supplier.';
  end if;
  insert into supplier_product(supplier_code, product_id)
  select p_supplier, x from unnest(p_products) as x
  on conflict (supplier_code, product_id) do nothing;
  get diagnostics v_n = row_count;
  perform write_audit('TAMBAH PRODUK SUPPLIER', p_supplier, 'produk', '-',
    v_n::text || ' produk');
  return v_n;
end $fn$;

create or replace function public.remove_supplier_product(
  p_supplier text, p_product text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not rbac('m.supplier','delete') then
    raise exception 'Tidak memiliki hak akses untuk menghapus produk supplier.';
  end if;
  delete from supplier_product where supplier_code = p_supplier and product_id = p_product;
  update product set default_supplier_code = null
   where id = p_product and default_supplier_code = p_supplier;
  perform write_audit('HAPUS PRODUK SUPPLIER', p_supplier, 'produk', p_product, '-');
end $fn$;

alter table supplier_product enable row level security;
alter table supplier_price   enable row level security;

drop policy if exists supplier_product_sel on supplier_product;
drop policy if exists supplier_product_ins on supplier_product;
drop policy if exists supplier_product_upd on supplier_product;
drop policy if exists supplier_product_del on supplier_product;
create policy supplier_product_sel on supplier_product for select
  using (rbac('m.supplier','view'));
create policy supplier_product_ins on supplier_product for insert
  with check (rbac('m.supplier','create'));
create policy supplier_product_upd on supplier_product for update
  using (rbac('m.supplier','edit')) with check (rbac('m.supplier','edit'));
create policy supplier_product_del on supplier_product for delete
  using (rbac('m.supplier','delete'));

drop policy if exists supplier_price_sel on supplier_price;
drop policy if exists supplier_price_ins on supplier_price;
drop policy if exists supplier_price_upd on supplier_price;
drop policy if exists supplier_price_del on supplier_price;
create policy supplier_price_sel on supplier_price for select
  using (rbac('m.supplier','view'));
create policy supplier_price_ins on supplier_price for insert
  with check (rbac('m.supplier','create'));
create policy supplier_price_upd on supplier_price for update
  using (rbac('m.supplier','edit')) with check (rbac('m.supplier','edit'));
create policy supplier_price_del on supplier_price for delete
  using (rbac('m.supplier','delete'));

grant select on supplier_product, supplier_price to authenticated;
grant insert, update, delete on supplier_product, supplier_price to authenticated;
grant usage, select on sequence supplier_price_id_seq to authenticated;
grant select on supplier_price_current, supplier_product_view to authenticated;

grant execute on function public.supplier_price_at(text,text,date) to authenticated;
grant execute on function public.last_po_price(text,text,date) to authenticated;
grant execute on function public.set_supplier_price(text,text,date,numeric,text,text) to authenticated;
grant execute on function public.set_preferred_supplier(text,text) to authenticated;
grant execute on function public.add_supplier_products(text,text[]) to authenticated;
grant execute on function public.remove_supplier_product(text,text) to authenticated;

update app_role set menus = menus || '["buy.supplierprice"]'::jsonb
 where code in ('WHOUSE','FINANCE','MGMT','PURCH')
   and menus::text <> '"*"'
   and not (menus ? 'buy.supplierprice');

insert into supplier_product(supplier_code, product_id, is_preferred)
select default_supplier_code, id, true
  from product
 where default_supplier_code is not null
on conflict (supplier_code, product_id) do update set is_preferred = true;

insert into supplier_product(supplier_code, product_id)
select distinct po.supplier_code, grl.product_id
  from goods_receipt_line grl
  join goods_receipt g  on g.no = grl.grn_no and g.status <> 'CANCELLED'
  join purchase_order po on po.no = g.po_no
on conflict (supplier_code, product_id) do nothing;

insert into supplier_price(supplier_code, product_id, price_date, price, source, note)
select po.supplier_code, l.product_id, po.po_date,
       round(sum(l.price * l.qty) / nullif(sum(l.qty), 0), 2),
       'GRN', 'Diisi otomatis dari harga PO'
  from purchase_order_line l
  join purchase_order po on po.no = l.po_no
 where po.status <> 'CANCELLED'
 group by po.supplier_code, l.product_id, po.po_date
having sum(l.qty) > 0
on conflict (supplier_code, product_id, price_date) do nothing;

insert into supplier_price(supplier_code, product_id, price_date, price, source, note)
select sp.supplier_code, sp.product_id, current_date, pr.base_price, 'MANUAL',
       'Harga awal dari harga pokok master produk'
  from supplier_product sp
  join product pr on pr.id = sp.product_id
 where pr.base_price > 0
   and not exists (select 1 from supplier_price x
                    where x.supplier_code = sp.supplier_code
                      and x.product_id = sp.product_id)
on conflict (supplier_code, product_id, price_date) do nothing;
