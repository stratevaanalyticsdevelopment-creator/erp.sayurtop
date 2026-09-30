/* 0020 — Kebutuhan pembelian dan Purchase Order manual dengan pilihan supplier

   Sebelumnya Purchase Order terbit otomatis saat Sales Order disetujui,
   memakai supplier default pada master produk dan tanpa dapat dipilih.
   Akibatnya pembeli tidak pernah melihat kebutuhan pembelian secara utuh dan
   tidak bisa membandingkan supplier sebelum memesan.

   Sekarang:
   - Sales Order yang disetujui masuk ke daftar kebutuhan pembelian
   - pembeli memilih supplier dan qty per produk, lalu menerbitkan PO
   - satu PO per supplier, boleh menggabungkan kebutuhan beberapa Sales Order
   - alokasi tiap baris PO ke baris Sales Order dicatat, sehingga HPP faktur
     tetap dapat ditelusuri ke penerimaan barang yang menjadi sumbernya
*/

-- ---------------------------------------------------------------- 1. ALOKASI
-- Satu baris PO bisa memenuhi beberapa baris Sales Order sekaligus, jadi
-- tautannya tidak lagi satu-ke-satu dan harus punya tabelnya sendiri.
create table if not exists po_line_allocation (
  po_line_id bigint not null references purchase_order_line(id) on delete cascade,
  so_line_id bigint not null references sales_order_line(id)    on delete cascade,
  qty        numeric(14,2) not null check (qty > 0),
  created_at timestamptz not null default now(),
  primary key (po_line_id, so_line_id));

create index if not exists po_line_allocation_so_idx on po_line_allocation(so_line_id);

-- Data lama memakai tautan satu-ke-satu purchase_order_line.so_line_id.
-- Dipindahkan ke tabel alokasi supaya perhitungan kebutuhan hanya punya
-- satu jalur baca.
insert into po_line_allocation(po_line_id, so_line_id, qty)
select pl.id, pl.so_line_id, pl.qty
  from purchase_order_line pl
 where pl.so_line_id is not null
on conflict (po_line_id, so_line_id) do nothing;

-- ------------------------------------------------------- 2. KEBUTUHAN PER SO
-- Basis qty terkirim memakai (produk, no. SO), sama dengan Picking List dan
-- Packaging — bukan delivery_line.so_line_id, yang tidak terisi pada seluruh
-- data penerimaan yang ada.
create or replace view purchase_demand_line_view as
with terkirim as (
  select dl.product_id, d.order_no, sum(dl.qty) as qty_sj
    from delivery_line dl
    join delivery d on d.no = dl.delivery_no and d.status <> 'CANCELLED'
   group by 1, 2),
dipesan as (
  select a.so_line_id, sum(a.qty) as qty_po
    from po_line_allocation a
    join purchase_order_line pl on pl.id = a.po_line_id
    join purchase_order p on p.no = pl.po_no and p.status <> 'CANCELLED'
   group by 1)
select sl.id                  as so_line_id,
       o.no                   as order_no,
       o.order_date,
       o.delivery_date,
       o.status               as order_status,
       o.customer_code,
       c.name                 as customer_name,
       o.warehouse_code,
       sl.product_id,
       pr.name                as product_name,
       pr.category,
       pr.category_name,
       pr.unit,
       pr.stock,
       pr.default_supplier_code,
       sl.qty                 as qty_order,
       coalesce(t.qty_sj, 0)  as qty_delivered,
       coalesce(dp.qty_po, 0) as qty_ordered,
       greatest(0, sl.qty - coalesce(t.qty_sj, 0) - coalesce(dp.qty_po, 0)) as qty_needed
  from sales_order o
  join sales_order_line sl on sl.order_no = o.no
  join product pr on pr.id = sl.product_id
  join customer c on c.code = o.customer_code
  left join terkirim t  on t.product_id = sl.product_id and t.order_no = o.no
  left join dipesan  dp on dp.so_line_id = sl.id
 where o.status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED')
   and greatest(0, sl.qty - coalesce(t.qty_sj, 0) - coalesce(dp.qty_po, 0)) > 0;

-- -------------------------------------------------- 3. KEBUTUHAN PER PRODUK
-- Stok dikurangkan di tingkat produk, bukan per baris order: gudang tidak
-- memesan ulang barang yang sudah ada, dan stok satu produk melayani
-- order mana saja.
create or replace view purchase_demand_view as
select d.product_id,
       d.product_name,
       d.category,
       d.category_name,
       d.unit,
       d.stock,
       d.default_supplier_code,
       sum(d.qty_needed)                            as qty_needed,
       greatest(0, sum(d.qty_needed) - d.stock)     as qty_buy,
       min(d.delivery_date)                         as delivery_first,
       max(d.delivery_date)                         as delivery_last,
       count(distinct d.order_no)                   as order_count,
       count(distinct d.customer_code)              as customer_count,
       (select count(*) from supplier_product sp where sp.product_id = d.product_id) as supplier_count
  from purchase_demand_line_view d
 group by d.product_id, d.product_name, d.category, d.category_name,
          d.unit, d.stock, d.default_supplier_code;

-- --------------------------------------------- 4. PILIHAN SUPPLIER PER PRODUK
-- Harga memakai jenjang yang sama dengan PO: daftar harga supplier pada
-- tanggal tersebut, lalu harga penerimaan terakhir, lalu harga pokok master.
create or replace function public.supplier_options_for(p_product text, p_date date default null)
returns table (supplier_code text, supplier_name text, supplier_type text,
               price numeric, price_source text, price_date date,
               is_preferred boolean, lead_time_days int,
               min_order_qty numeric, capacity_per_day numeric, term_code text)
language sql stable security definer set search_path = public as $fn$
  select sp.supplier_code, s.name, s.type,
         pp.price, pp.source,
         (select max(x.price_date) from supplier_price x
           where x.supplier_code = sp.supplier_code
             and x.product_id = sp.product_id
             and x.price_date <= coalesce(p_date, today_jkt())),
         sp.is_preferred, sp.lead_time_days, sp.min_order_qty,
         sp.capacity_per_day, s.term_code
    from supplier_product sp
    join supplier s on s.code = sp.supplier_code
    cross join lateral po_price_for(sp.supplier_code, sp.product_id,
                                    coalesce(p_date, today_jkt())) pp
   where sp.product_id = p_product
   order by sp.is_preferred desc, pp.price asc, s.name;
$fn$;

-- ---------------------------------------------------- 5. PO DIBUAT MANUAL
-- Satu pemanggilan menerbitkan satu PO untuk satu supplier. Qty tiap baris
-- dialokasikan ke baris Sales Order dengan tanggal kirim paling awal lebih
-- dulu; kelebihan qty di atas kebutuhan dibiarkan tanpa alokasi dan masuk
-- sebagai stok.
create or replace function public.create_purchase_order(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_sup record; v_no text; l jsonb; d record; v_prod record;
        i int := 0; v_line_id bigint; v_qty numeric; v_left numeric;
        v_alloc numeric; v_price numeric; v_src text;
        v_prev_price numeric; v_prev_po text;
        v_gross numeric := 0; v_date date; v_exp date; v_wh text;
        v_dems jsonb; v_orders text[] := '{}'; v_user text; o text;
begin
  if not rbac('buy.po','create') then
    raise exception 'Tidak memiliki hak membuat Purchase Order'; end if;

  select * into v_sup from supplier where code = p->>'supplier_code';
  if not found then
    raise exception 'Supplier % tidak ditemukan', coalesce(p->>'supplier_code','(kosong)'); end if;
  if p->'lines' is null or jsonb_typeof(p->'lines') <> 'array'
     or jsonb_array_length(p->'lines') = 0 then
    raise exception 'Purchase Order tanpa baris barang'; end if;

  v_date := coalesce(nullif(p->>'po_date','')::date, today_jkt());
  v_exp  := coalesce(nullif(p->>'expected_date','')::date, v_date + 1);
  v_wh   := coalesce(nullif(p->>'warehouse_code',''),
                     (select code from warehouse order by code limit 1));
  select username into v_user from app_user where id = auth.uid();

  v_no := next_doc_no('PO');
  insert into purchase_order(no, po_date, expected_date, supplier_code, warehouse_code,
    order_no, term_code, note, status, gross, disc, sub, tax, total, created_by)
  values (v_no, v_date, v_exp, v_sup.code, v_wh, null,
    coalesce(nullif(p->>'term_code',''), v_sup.term_code, 'COD'),
    nullif(p->>'note',''), 'SENT', 0, 0, 0, 0, 0, auth.uid());

  for l in select value from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    select * into v_prod from product where id = l->>'product_id';
    if not found then
      raise exception 'Produk % tidak ditemukan', coalesce(l->>'product_id','(kosong)'); end if;

    v_qty := nullif(l->>'qty','')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Qty baris % (%) tidak valid', i, v_prod.name; end if;

    -- Harga boleh ditimpa pembeli; bila tidak, ambil dari daftar harga supplier.
    if nullif(l->>'price','') is not null then
      v_price := (l->>'price')::numeric; v_src := 'MANUAL';
    else
      select pp.price, pp.source into v_price, v_src
        from po_price_for(v_sup.code, v_prod.id, v_date) pp;
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Harga baris % (%) tidak valid', i, v_prod.name; end if;

    select lp.price, lp.po_no into v_prev_price, v_prev_po
      from last_po_price(v_sup.code, v_prod.id, v_date) lp;

    insert into purchase_order_line(po_no, line_no, product_id, name, unit, qty, price,
      disc_pct, tax_pct, received_qty, so_line_id, price_source, prev_price, prev_po_no)
    values (v_no, i, v_prod.id, v_prod.name, v_prod.unit, v_qty, v_price,
      0, 0, 0, null, v_src, v_prev_price, v_prev_po)
    returning id into v_line_id;

    v_gross := v_gross + round(v_qty * v_price, 2);

    -- Kebutuhan disalin lebih dulu ke jsonb: view-nya berubah begitu alokasi
    -- pertama masuk, sehingga tidak boleh dibaca sambil ditulisi.
    select coalesce(jsonb_agg(jsonb_build_object(
             'so_line_id', so_line_id, 'order_no', order_no, 'qty_needed', qty_needed)
             order by delivery_date, order_no, so_line_id), '[]'::jsonb)
      into v_dems
      from purchase_demand_line_view where product_id = v_prod.id;

    v_left := v_qty;
    for d in select (e->>'so_line_id')::bigint as so_line_id,
                    e->>'order_no'             as order_no,
                    (e->>'qty_needed')::numeric as qty_needed
               from jsonb_array_elements(v_dems) e loop
      exit when v_left <= 0;
      v_alloc := least(v_left, d.qty_needed);
      if v_alloc > 0 then
        insert into po_line_allocation(po_line_id, so_line_id, qty)
        values (v_line_id, d.so_line_id, v_alloc);
        -- Tautan untuk HPP: baris SO menunjuk baris PO yang memasok barangnya.
        update sales_order_line set po_line_id = v_line_id where id = d.so_line_id;
        v_left := v_left - v_alloc;
        if not (d.order_no = any(v_orders)) then v_orders := v_orders || d.order_no; end if;
      end if;
    end loop;
  end loop;

  update purchase_order
     set gross = v_gross, sub = v_gross, total = v_gross,
         -- Kolom order_no hanya terisi bila PO ini memang berasal dari satu
         -- Sales Order saja; daftar lengkapnya dibaca dari alokasi.
         order_no = case when array_length(v_orders, 1) = 1 then v_orders[1] else null end
   where no = v_no;

  foreach o in array v_orders loop
    insert into sales_order_timeline(order_no, text, by_user)
    values (o, 'Purchase Order ' || v_no || ' diterbitkan ke ' || v_sup.name, v_user);
  end loop;

  perform write_audit('BUAT PO', v_no, 'supplier', '-',
    v_sup.code || ' · ' || i || ' produk · ' ||
    coalesce(array_length(v_orders,1), 0) || ' Sales Order');
  return v_no;
end $fn$;

-- ------------------------------------------- 6. SUMBER SALES ORDER TIAP PO
create or replace view purchase_order_source_view as
select pl.po_no,
       array_agg(distinct sl.order_no order by sl.order_no) as order_nos,
       count(distinct sl.order_no)                          as order_count,
       count(distinct o.customer_code)                      as customer_count
  from po_line_allocation a
  join purchase_order_line pl on pl.id = a.po_line_id
  join sales_order_line sl on sl.id = a.so_line_id
  join sales_order o on o.no = sl.order_no
 group by pl.po_no;

-- Alokasi tiap baris PO, untuk ditampilkan pada rincian PO dan dipakai gudang
-- saat barang datang.
create or replace view po_allocation_view as
select pl.po_no,
       pl.id            as po_line_id,
       pl.line_no,
       pl.product_id,
       pl.name          as product_name,
       pl.unit,
       pl.qty           as qty_po,
       a.qty            as qty_alokasi,
       sl.order_no,
       o.customer_code,
       c.name           as customer_name,
       o.delivery_date
  from po_line_allocation a
  join purchase_order_line pl on pl.id = a.po_line_id
  join sales_order_line sl on sl.id = a.so_line_id
  join sales_order o on o.no = sl.order_no
  join customer c on c.code = o.customer_code;

-- ------------------------------------- 7. APPROVAL TIDAK LAGI MENERBITKAN PO
create or replace function public.approve_sales_order(p_no text, p_ok boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_user text;
begin
  if not rbac('sales.approval','approve') then raise exception 'Tidak memiliki hak approval'; end if;
  select username into v_user from app_user where id = auth.uid();
  if p_ok then
    update sales_order set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
      where no = p_no and status = 'SUBMITTED';
    if not found then raise exception 'Order % tidak berstatus SUBMITTED', p_no; end if;
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Disetujui Sales Manager', v_user);
    -- Pembelian kini keputusan pembeli: barisnya masuk daftar kebutuhan
    -- pembelian, supplier dipilih di menu Purchase Order.
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Masuk daftar kebutuhan pembelian — menunggu pemilihan supplier', v_user);
    perform write_audit('APPROVE SO', p_no, 'status', 'SUBMITTED', 'APPROVED');
  else
    update sales_order set status = 'REJECTED' where no = p_no and status = 'SUBMITTED';
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Ditolak' || coalesce(' — ' || p_reason, ''), v_user);
    perform write_audit('REJECT SO', p_no, 'status', 'SUBMITTED', 'REJECTED: ' || coalesce(p_reason,''));
  end if;
end $fn$;

-- Jalur PO otomatis per Sales Order dihapus agar tidak ada dua cara membuat PO
-- yang saling bertentangan dengan penggabungan per supplier.
drop function if exists public.create_po_from_order(text);

-- ------------------------------------------------------------- 8. RLS & HAK
alter table po_line_allocation enable row level security;

drop policy if exists po_line_allocation_sel on po_line_allocation;
drop policy if exists po_line_allocation_ins on po_line_allocation;
drop policy if exists po_line_allocation_upd on po_line_allocation;
drop policy if exists po_line_allocation_del on po_line_allocation;
create policy po_line_allocation_sel on po_line_allocation for select
  using (rbac('buy.po','view'));
create policy po_line_allocation_ins on po_line_allocation for insert
  with check (rbac('buy.po','create'));
create policy po_line_allocation_upd on po_line_allocation for update
  using (rbac('buy.po','edit')) with check (rbac('buy.po','edit'));
create policy po_line_allocation_del on po_line_allocation for delete
  using (rbac('buy.po','delete'));

grant select on po_line_allocation to authenticated;
grant insert, update, delete on po_line_allocation to authenticated;
grant select on purchase_demand_line_view, purchase_demand_view,
                purchase_order_source_view, po_allocation_view to authenticated;
grant execute on function public.supplier_options_for(text,date) to authenticated;
grant execute on function public.create_purchase_order(jsonb) to authenticated;
