alter table purchase_order_line
  add column if not exists price_source text,
  add column if not exists prev_price numeric(14,2),
  add column if not exists prev_po_no text;

comment on column purchase_order_line.price_source is
  'Asal harga: LIST = daftar harga supplier, GRN = harga aktual penerimaan terakhir, BASE = harga pokok master produk';

create or replace function public.po_price_for(
  p_supplier text, p_product text, p_date date)
returns table (price numeric, source text)
language plpgsql stable security definer set search_path = public as $fn$
declare v numeric;
begin
  v := supplier_price_at(p_supplier, p_product, p_date);
  if v is not null and v > 0 then
    return query select v, 'LIST'::text; return;
  end if;

  select avg_landed_cost into v from purchase_price_daily
   where product_id = p_product and price_date <= p_date
   order by price_date desc limit 1;
  if v is not null and v > 0 then
    return query select round(v, 2), 'GRN'::text; return;
  end if;

  select base_price into v from product where id = p_product;
  return query select coalesce(v, 0), 'BASE'::text;
end $fn$;

create or replace function public.create_po_from_order(p_order_no text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ord record; s record; l record; v_no text; i int;
        v_gross numeric; v_tax numeric; v_out jsonb := '[]'::jsonb;
        v_price numeric; v_src text; v_prev numeric; v_prev_po text;
        v_naik int; v_turun int;
begin
  if not rbac('buy.po','create') then raise exception 'Tidak memiliki hak membuat Purchase Order'; end if;
  select * into v_ord from sales_order where no = p_order_no;
  if not found then raise exception 'Sales Order % tidak ditemukan', p_order_no; end if;
  if exists (select 1 from purchase_order where order_no = p_order_no and status <> 'CANCELLED') then
    return jsonb_build_object('created', 0, 'note', 'PO untuk order ini sudah ada');
  end if;

  for s in
    select coalesce(
             (select sp.supplier_code from supplier_product sp
               where sp.product_id = sl.product_id and sp.is_preferred limit 1),
             pr.default_supplier_code, 'SUP-UMUM') as supplier_code
    from sales_order_line sl join product pr on pr.id = sl.product_id
    where sl.order_no = p_order_no
    group by 1
  loop
    if not exists (select 1 from supplier where code = s.supplier_code) then continue; end if;
    v_no := next_doc_no('PO');
    insert into purchase_order(no, po_date, expected_date, supplier_code, warehouse_code,
        order_no, term_code, status, note, created_by)
    values (v_no, today_jkt(),
            coalesce(v_ord.delivery_date - 1, today_jkt()),
            s.supplier_code, v_ord.warehouse_code, p_order_no,
            (select term_code from supplier where code = s.supplier_code),
            'SENT', 'Dibuat otomatis dari ' || p_order_no, auth.uid());

    i := 0; v_gross := 0; v_tax := 0; v_naik := 0; v_turun := 0;
    for l in
      select sl.*, pr.base_price, pr.tax_rate
      from sales_order_line sl join product pr on pr.id = sl.product_id
      where sl.order_no = p_order_no
        and coalesce(
              (select sp.supplier_code from supplier_product sp
                where sp.product_id = sl.product_id and sp.is_preferred limit 1),
              pr.default_supplier_code, 'SUP-UMUM') = s.supplier_code
      order by sl.line_no
    loop
      i := i + 1;
      select price, source into v_price, v_src
        from po_price_for(s.supplier_code, l.product_id, today_jkt());
      select price, po_no into v_prev, v_prev_po
        from last_po_price(s.supplier_code, l.product_id, today_jkt());
      if v_prev is not null and v_prev > 0 then
        if v_price > v_prev then v_naik := v_naik + 1;
        elsif v_price < v_prev then v_turun := v_turun + 1; end if;
      end if;

      insert into purchase_order_line(po_no, line_no, product_id, name, unit, qty,
          price, disc_pct, tax_pct, so_line_id, price_source, prev_price, prev_po_no)
      values (v_no, i, l.product_id, l.name, l.unit, l.qty, v_price, 0, 0, l.id,
              v_src, v_prev, v_prev_po);
      update sales_order_line set po_line_id = currval('purchase_order_line_id_seq')
        where id = l.id;
      v_gross := v_gross + round(l.qty * v_price, 2);
    end loop;

    update purchase_order set gross = v_gross, sub = v_gross, tax = v_tax,
      total = v_gross + v_tax,
      note = 'Dibuat otomatis dari ' || p_order_no ||
             case when v_naik + v_turun > 0
                  then ' · perubahan harga: ' || v_naik || ' naik, ' || v_turun || ' turun'
                  else '' end
     where no = v_no;
    v_out := v_out || jsonb_build_object('no', v_no, 'supplier', s.supplier_code,
      'lines', i, 'total', v_gross, 'naik', v_naik, 'turun', v_turun);
  end loop;

  if jsonb_array_length(v_out) > 0 then
    insert into sales_order_timeline(order_no, text, by_user)
    values (p_order_no, 'Purchase Order dibuat otomatis (' || jsonb_array_length(v_out) || ' supplier)',
            (select username from app_user where id = auth.uid()));
    perform write_audit('CREATE PO', p_order_no, 'po', '-', v_out::text);
  end if;
  return jsonb_build_object('created', jsonb_array_length(v_out), 'po', v_out);
end $fn$;

grant execute on function public.po_price_for(text,text,date) to authenticated;

with prev as (
  select l.id,
         lag(l.price) over (partition by p.supplier_code, l.product_id
                            order by p.po_date, p.no) as prev_price,
         lag(p.no)    over (partition by p.supplier_code, l.product_id
                            order by p.po_date, p.no) as prev_po_no
    from purchase_order_line l
    join purchase_order p on p.no = l.po_no
   where p.status <> 'CANCELLED')
update purchase_order_line l
   set prev_price = prev.prev_price,
       prev_po_no = prev.prev_po_no,
       price_source = coalesce(l.price_source, 'LIST')
  from prev
 where prev.id = l.id;

update purchase_order_line set price_source = 'BASE' where price_source is null;
