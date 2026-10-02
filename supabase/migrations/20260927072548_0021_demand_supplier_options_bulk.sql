/* 0021 — Pilihan supplier untuk seluruh produk yang sedang dibutuhkan

   Halaman Kebutuhan Pembelian memerlukan daftar supplier beserta harganya
   untuk setiap produk yang tampil. Memanggil supplier_options_for satu per
   satu produk berarti puluhan permintaan untuk satu layar; fungsi ini
   mengembalikan semuanya dalam satu permintaan.
*/
create or replace function public.demand_supplier_options(p_date date default null)
returns table (product_id text, supplier_code text, supplier_name text, supplier_type text,
               price numeric, price_source text, price_date date,
               is_preferred boolean, lead_time_days int,
               min_order_qty numeric, capacity_per_day numeric, term_code text)
language sql stable security definer set search_path = public as $fn$
  select sp.product_id, sp.supplier_code, s.name, s.type,
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
   where sp.product_id in (select d.product_id from purchase_demand_view d)
   order by sp.product_id, sp.is_preferred desc, pp.price asc, s.name;
$fn$;

grant execute on function public.demand_supplier_options(date) to authenticated;
