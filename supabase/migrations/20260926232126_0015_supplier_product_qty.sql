/* 0015 — Kuantitas pasok dan realisasi pembelian per supplier + produk

   Melengkapi daftar produk supplier dengan sisi kuantitas:
     min_order_qty     minimum pembelian yang diminta supplier (kolom dari 0011)
     capacity_per_day  kemampuan pasok per hari
     qty_ordered       realisasi qty yang pernah dipesan lewat PO
     qty_received      realisasi qty yang benar-benar diterima
     purchase_value    nilai pembelian termasuk landed cost

   Tiga yang terakhir dihitung dari dokumen, bukan diinput, supaya tidak bisa
   berbeda dengan PO dan penerimaan barang yang sebenarnya. */

alter table supplier_product
  add column if not exists capacity_per_day numeric(14,2) not null default 0;

comment on column supplier_product.capacity_per_day is
  'Kemampuan pasok supplier per hari dalam satuan produk. 0 berarti belum diketahui.';

create or replace function public.set_supplier_product_terms(
  p_supplier text, p_product text,
  p_min_qty numeric default null, p_capacity numeric default null,
  p_lead int default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_min numeric; v_cap numeric; v_lead int;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah syarat pasok supplier.';
  end if;
  if coalesce(p_min_qty, 0) < 0 or coalesce(p_capacity, 0) < 0 then
    raise exception 'Kuantitas tidak boleh negatif.';
  end if;

  select min_order_qty, capacity_per_day, lead_time_days
    into v_min, v_cap, v_lead
    from supplier_product where supplier_code = p_supplier and product_id = p_product;
  if not found then
    insert into supplier_product(supplier_code, product_id) values (p_supplier, p_product);
    v_min := 0; v_cap := 0; v_lead := 1;
  end if;

  update supplier_product set
      min_order_qty    = coalesce(p_min_qty,  min_order_qty),
      capacity_per_day = coalesce(p_capacity, capacity_per_day),
      lead_time_days   = coalesce(p_lead,     lead_time_days),
      note             = coalesce(p_note,     note)
   where supplier_code = p_supplier and product_id = p_product;

  perform write_audit('UBAH SYARAT PASOK', p_supplier || '/' || p_product,
    'min/kapasitas/lead',
    format('%s/%s/%s', v_min, v_cap, v_lead),
    format('%s/%s/%s', coalesce(p_min_qty, v_min), coalesce(p_capacity, v_cap),
                       coalesce(p_lead, v_lead)));
end $fn$;

grant execute on function public.set_supplier_product_terms(text,text,numeric,numeric,int,text) to authenticated;

drop view if exists supplier_product_view;

create view supplier_product_view as
with ranked as (
  select supplier_code, product_id, price_date, price,
         row_number() over (partition by supplier_code, product_id
                            order by price_date desc) as rn
    from supplier_price),
ordered as (
  select p.supplier_code, l.product_id,
         sum(l.qty) as qty_ordered,
         count(distinct l.po_no) as po_count,
         max(p.po_date) as last_po_date
    from purchase_order_line l
    join purchase_order p on p.no = l.po_no
   where p.status <> 'CANCELLED'
   group by 1, 2),
received as (
  select p.supplier_code, grl.product_id,
         sum(grl.qty) as qty_received,
         sum(grl.qty * grl.unit_cost) as purchase_value,
         max(g.grn_date) as last_grn_date
    from goods_receipt_line grl
    join goods_receipt g on g.no = grl.grn_no and g.status <> 'CANCELLED'
    join purchase_order p on p.no = g.po_no
   group by 1, 2)
select sp.supplier_code,
       sp.product_id,
       pr.name           as product_name,
       pr.unit,
       pr.category,
       pr.category_name,
       pr.sell_price,
       pr.base_price,
       pr.stock,
       sp.is_preferred,
       sp.lead_time_days,
       sp.min_order_qty,
       sp.capacity_per_day,
       sp.note,
       cur.price         as current_price,
       cur.price_date    as current_price_date,
       prv.price         as previous_price,
       prv.price_date    as previous_price_date,
       case when cur.price is not null and prv.price is not null and prv.price > 0
            then round((cur.price - prv.price) / prv.price * 100, 1) end as change_pct,
       (select count(*) from supplier_price x
         where x.supplier_code = sp.supplier_code
           and x.product_id = sp.product_id)        as price_count,
       coalesce(o.qty_ordered, 0)    as qty_ordered,
       coalesce(r.qty_received, 0)   as qty_received,
       coalesce(r.purchase_value, 0) as purchase_value,
       coalesce(o.po_count, 0)       as po_count,
       o.last_po_date,
       r.last_grn_date
  from supplier_product sp
  join product pr on pr.id = sp.product_id
  left join ranked cur on cur.supplier_code = sp.supplier_code
                      and cur.product_id = sp.product_id and cur.rn = 1
  left join ranked prv on prv.supplier_code = sp.supplier_code
                      and prv.product_id = sp.product_id and prv.rn = 2
  left join ordered o  on o.supplier_code = sp.supplier_code and o.product_id = sp.product_id
  left join received r on r.supplier_code = sp.supplier_code and r.product_id = sp.product_id;

create or replace view supplier_summary_view as
select s.code        as supplier_code,
       count(*)                                          as product_count,
       count(*) filter (where v.is_preferred)             as preferred_count,
       string_agg(distinct v.category_name, ', ')         as categories,
       count(distinct v.category)                        as category_count,
       coalesce(sum(v.qty_ordered), 0)                    as qty_ordered,
       coalesce(sum(v.qty_received), 0)                   as qty_received,
       coalesce(sum(v.purchase_value), 0)                 as purchase_value,
       max(v.last_grn_date)                               as last_grn_date
  from supplier s
  join supplier_product_view v on v.supplier_code = s.code
 group by s.code;

grant select on supplier_product_view, supplier_summary_view to authenticated;

/* ---------- DATA DEMO: kapasitas pasok dan minimum order ----------
   Kapasitas diturunkan dari qty yang pernah diterima supaya masuk akal
   terhadap riwayat, dengan lantai per kategori untuk produk yang belum
   pernah dibeli. */
with dasar as (
  select v.supplier_code, v.product_id, v.category, v.qty_received, v.qty_ordered,
         case v.category
           when 'SAY' then 150 when 'CAB' then 80 when 'BUA' then 120
           when 'REM' then 40  when 'TEL' then 200 when 'DRY' then 250
           else 100 end as lantai
    from supplier_product_view v)
update supplier_product sp
   set capacity_per_day = greatest(
         d.lantai,
         ceil(coalesce(nullif(d.qty_received, 0), d.qty_ordered, 0) / 8.0 / 10) * 10),
       min_order_qty = case
         when d.category in ('REM','CAB') then 5
         when d.category = 'TEL' then 30
         when d.category = 'DRY' then 25
         else 10 end
  from dasar d
 where d.supplier_code = sp.supplier_code and d.product_id = sp.product_id;
