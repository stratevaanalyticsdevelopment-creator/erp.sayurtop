create or replace function public.update_sales_order(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_o record; l jsonb; i int := 0; pr record;
        v_gross numeric := 0; v_disc numeric := 0; v_tax numeric := 0;
        v_net numeric; v_lg numeric; v_below jsonb := '[]'::jsonb; v_unit_net numeric;
begin
  if not rbac('sales.order','edit') then raise exception 'Tidak memiliki hak mengubah Sales Order'; end if;
  select * into v_o from sales_order where no = p->>'no';
  if not found then raise exception 'Sales Order % tidak ditemukan', p->>'no'; end if;
  if v_o.status not in ('DRAFT','SUBMITTED') then
    raise exception 'Order berstatus % tidak dapat diubah', v_o.status; end if;
  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then
    raise exception 'Sales Order harus memiliki minimal satu baris produk'; end if;

  delete from sales_order_line where order_no = v_o.no;

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into pr from product where id = l->>'product_id';
    if not found then raise exception 'Produk % tidak ditemukan di master', l->>'product_id'; end if;
    i := i + 1;
    v_lg := round((l->>'qty')::numeric * (l->>'price')::numeric, 2);
    v_net := v_lg - v_lg * coalesce((l->>'disc_pct')::numeric,0)/100;
    v_gross := v_gross + v_lg; v_disc := v_disc + (v_lg - v_net);
    v_tax := v_tax + v_net * coalesce((l->>'tax_pct')::numeric,0)/100;
    insert into sales_order_line(order_no, line_no, product_id, name, unit, qty, price, disc_pct, tax_pct)
    values (v_o.no, i, pr.id, pr.name, pr.unit, (l->>'qty')::numeric, (l->>'price')::numeric,
            coalesce((l->>'disc_pct')::numeric,0), coalesce((l->>'tax_pct')::numeric,0));

    v_unit_net := (l->>'price')::numeric * (1 - coalesce((l->>'disc_pct')::numeric,0)/100);
    if pr.base_price > 0 and v_unit_net < pr.base_price then
      v_below := v_below || jsonb_build_object('product_id', pr.id, 'name', pr.name, 'unit', pr.unit,
        'price', (l->>'price')::numeric, 'disc_pct', coalesce((l->>'disc_pct')::numeric,0),
        'net', round(v_unit_net,2), 'base', pr.base_price, 'gap', round(pr.base_price - v_unit_net,2));
    end if;
  end loop;

  update sales_order set
    order_date    = coalesce((p->>'order_date')::date, order_date),
    delivery_date = coalesce(nullif(p->>'delivery_date','')::date, delivery_date),
    customer_code = coalesce(nullif(p->>'customer_code',''), customer_code),
    salesperson_code = coalesce(nullif(p->>'salesperson_code',''), salesperson_code),
    warehouse_code   = coalesce(nullif(p->>'warehouse_code',''), warehouse_code),
    po_no  = nullif(p->>'po_no',''),
    term_code = coalesce(nullif(p->>'term_code',''), term_code),
    note   = nullif(p->>'note',''),
    status = coalesce(nullif(p->>'status',''), status),
    gross = round(v_gross,2), disc = round(v_disc,2), sub = round(v_gross - v_disc,2),
    tax = round(v_tax,2), total = round(v_gross - v_disc + v_tax,2),
    below_cost = case when jsonb_array_length(v_below) > 0 then v_below else null end
  where no = v_o.no;

  insert into sales_order_timeline(order_no, text, by_user)
  values (v_o.no, 'Dokumen diubah', (select username from app_user where id = auth.uid()));
  if jsonb_array_length(v_below) > 0 then
    perform write_audit('SO DI BAWAH HARGA POKOK', v_o.no, 'baris', '-', v_below::text);
  end if;
  perform write_audit('EDIT SO', v_o.no, 'total', v_o.total::text,
    (select total::text from sales_order where no = v_o.no));
end $$;

grant execute on function public.update_sales_order(jsonb) to authenticated;
