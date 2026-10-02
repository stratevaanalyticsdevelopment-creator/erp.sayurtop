/* 0012 — DATA DEMO daftar harga supplier (bukan data nyata) */

insert into supplier_product(supplier_code, product_id, lead_time_days, note)
select 'SUP-UMUM', id, 1, 'Alternatif pasar induk — harga lebih tinggi, stok hampir selalu ada'
  from product where active
on conflict (supplier_code, product_id) do nothing;

insert into supplier_product(supplier_code, product_id, lead_time_days, note)
select alt.supplier_code, p.id, alt.lead_time,
       'Alternatif kedua — dipakai saat supplier utama tidak dapat memasok'
  from product p
  join (values
        ('SAY','SUP-002', 2), ('SAY','SUP-003', 2),
        ('CAB','SUP-002', 2), ('CAB','SUP-001', 2),
        ('BUA','SUP-006', 3),
        ('REM','SUP-003', 2),
        ('DRY','SUP-006', 2),
        ('TEL','SUP-007', 2)
       ) as alt(cat, supplier_code, lead_time) on alt.cat = p.category
 where p.active
   and (abs(hashtext(p.id || alt.supplier_code)) % 100) < 45
on conflict (supplier_code, product_id) do nothing;

with tanggal as (
  select (current_date - (w * 7))::date as d from generate_series(8, 1, -1) as w
  union
  select (current_date - x)::date from generate_series(4, 0, -1) as x
),
faktor as (
  select code,
         case type
           when 'Petani'      then 0.96
           when 'Peternak'    then 0.97
           when 'Pengepul'    then 0.99
           when 'Distributor' then 1.01
           when 'Pasar Induk' then 1.06
           else 1.00 end as f
    from supplier
),
volatilitas as (
  select * from (values
    ('CAB', 0.22), ('SAY', 0.13), ('BUA', 0.09),
    ('REM', 0.07), ('TEL', 0.06), ('DRY', 0.03)
  ) as v(cat, vol)
)
insert into supplier_price(supplier_code, product_id, price_date, price, source, note)
select sp.supplier_code, sp.product_id, t.d,
       greatest(
         100,
         round(
           pr.base_price * fk.f
           * (1
              + vo.vol * 0.55 * sin(
                  2 * pi() * ((current_date - t.d)
                    + (abs(hashtext(sp.product_id)) % 21)) / 21.0)
              + vo.vol * 0.45 * (
                  (abs(hashtext(sp.product_id || sp.supplier_code || t.d::text)) % 2000) / 1000.0 - 1.0))
           / 100.0) * 100
       ),
       'MANUAL', 'Data contoh — harga penawaran harian supplier'
  from supplier_product sp
  join product pr   on pr.id = sp.product_id and pr.base_price > 0
  join faktor fk    on fk.code = sp.supplier_code
  join volatilitas vo on vo.cat = pr.category
 cross join tanggal t
on conflict (supplier_code, product_id, price_date) do nothing;

update supplier_product sp set is_preferred = true
 where exists (select 1 from product p
                where p.id = sp.product_id
                  and p.default_supplier_code = sp.supplier_code)
   and not sp.is_preferred;
