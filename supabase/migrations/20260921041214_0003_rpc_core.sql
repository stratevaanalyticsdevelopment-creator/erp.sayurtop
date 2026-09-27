-- ---------- JURNAL ----------
create or replace function public.post_journal(p_date date, p_ref_type text, p_ref text,
  p_memo text, p_lines jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; l jsonb; i int := 0; v_d numeric := 0; v_c numeric := 0;
        v_diff numeric; v_last bigint;
begin
  v_no := next_doc_no('JV');
  insert into journal(no, journal_date, ref_type, ref, memo, debit, credit, created_by)
  values (v_no, p_date, p_ref_type, p_ref, p_memo, 0, 0, auth.uid());
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into journal_line(journal_no, line_no, account_code, description, debit, credit)
    values (v_no, i, l->>'acc', l->>'desc',
            round(coalesce((l->>'d')::numeric,0),2), round(coalesce((l->>'c')::numeric,0),2))
    returning id into v_last;
  end loop;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_d, v_c
    from journal_line where journal_no = v_no;
  v_diff := v_d - v_c;
  if v_diff <> 0 then   -- serap selisih pembulatan ke baris terakhir
    if v_diff > 0 then update journal_line set credit = credit + v_diff where id = v_last;
    else update journal_line set debit = debit + (-v_diff) where id = v_last; end if;
    select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_d, v_c
      from journal_line where journal_no = v_no;
  end if;
  update journal set debit = v_d, credit = v_c where no = v_no;
  return v_no;
end $fn$;

create or replace function public.void_journals_for(p_ref text)
returns void language sql security definer set search_path = public as $fn$
  delete from journal where ref = p_ref;
$fn$;

create or replace function public.calc_invoice_status(p_total numeric, p_ret numeric,
  p_paid numeric, p_due date)
returns text language sql stable set search_path = public as $fn$
  select case when p_total - p_ret - p_paid <= 0.005 then 'PAID'
              when p_paid > 0 then 'PARTIALLY PAID'
              when p_due < today_jkt() then 'OVERDUE'
              else 'OPEN' end;
$fn$;

create or replace function public.refresh_invoice_status(p_no text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  update invoice set status = calc_invoice_status(total, return_total, paid, due_date)
  where no = p_no and status <> 'CANCELLED';
end $fn$;

create view invoice_view with (security_invoker = on) as
  select i.*, (i.total - i.return_total) as net_total,
         (i.total - i.return_total - i.paid) as outstanding,
         calc_invoice_status(i.total, i.return_total, i.paid, i.due_date) as calc_status,
         greatest(0, (today_jkt() - i.due_date)) as days_overdue
  from invoice i;

-- Sisa qty yang belum dikirim per baris order.
create view order_outstanding_view with (security_invoker = on) as
  select l.order_no, l.product_id, l.name, l.unit, l.qty as ordered_qty,
         coalesce(d.sent,0) as delivered_qty,
         greatest(0, l.qty - coalesce(d.sent,0)) as outstanding_qty
  from sales_order_line l
  left join (
    select dl.product_id, dv.order_no, sum(dl.qty) as sent
    from delivery_line dl join delivery dv on dv.no = dl.delivery_no
    where dv.status <> 'CANCELLED'
    group by dl.product_id, dv.order_no) d
    on d.order_no = l.order_no and d.product_id = l.product_id;

-- ---------- SALES ORDER ----------
create or replace function public.create_sales_order(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; l jsonb; i int := 0; p_rec record;
        v_gross numeric := 0; v_disc numeric := 0; v_tax numeric := 0;
        v_net numeric; v_line_gross numeric; v_below jsonb := '[]'::jsonb;
        v_unit_net numeric; v_status text := coalesce(p->>'status','DRAFT');
begin
  if not rbac('sales.order','create') then raise exception 'Tidak memiliki hak membuat Sales Order'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then
    raise exception 'Sales Order harus memiliki minimal satu baris produk'; end if;

  v_no := next_doc_no('SO');
  insert into sales_order(no, order_date, delivery_date, customer_code, salesperson_code,
      warehouse_code, po_no, term_code, note, status, created_by)
  values (v_no, coalesce((p->>'order_date')::date, today_jkt()),
          nullif(p->>'delivery_date','')::date, p->>'customer_code',
          nullif(p->>'salesperson_code',''), nullif(p->>'warehouse_code',''),
          nullif(p->>'po_no',''), nullif(p->>'term_code',''), nullif(p->>'note',''),
          v_status, auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into p_rec from product where id = l->>'product_id';
    if not found then raise exception 'Produk % tidak ditemukan di master', l->>'product_id'; end if;
    i := i + 1;
    v_line_gross := round((l->>'qty')::numeric * (l->>'price')::numeric, 2);
    v_net := v_line_gross - v_line_gross * coalesce((l->>'disc_pct')::numeric,0)/100;
    v_gross := v_gross + v_line_gross;
    v_disc  := v_disc + (v_line_gross - v_net);
    v_tax   := v_tax + v_net * coalesce((l->>'tax_pct')::numeric,0)/100;
    insert into sales_order_line(order_no, line_no, product_id, name, unit, qty, price, disc_pct, tax_pct)
    values (v_no, i, p_rec.id, p_rec.name, p_rec.unit, (l->>'qty')::numeric, (l->>'price')::numeric,
            coalesce((l->>'disc_pct')::numeric,0), coalesce((l->>'tax_pct')::numeric,0));

    -- kontrol margin: harga setelah diskon vs harga pokok
    v_unit_net := (l->>'price')::numeric * (1 - coalesce((l->>'disc_pct')::numeric,0)/100);
    if p_rec.base_price > 0 and v_unit_net < p_rec.base_price then
      v_below := v_below || jsonb_build_object('product_id', p_rec.id, 'name', p_rec.name,
        'unit', p_rec.unit, 'price', (l->>'price')::numeric,
        'disc_pct', coalesce((l->>'disc_pct')::numeric,0),
        'net', round(v_unit_net,2), 'base', p_rec.base_price,
        'gap', round(p_rec.base_price - v_unit_net,2));
    end if;
  end loop;

  update sales_order set gross = round(v_gross,2), disc = round(v_disc,2),
    sub = round(v_gross - v_disc,2), tax = round(v_tax,2),
    total = round(v_gross - v_disc + v_tax,2),
    below_cost = case when jsonb_array_length(v_below) > 0 then v_below else null end
  where no = v_no;

  insert into sales_order_timeline(order_no, text, by_user)
  values (v_no, 'Sales Order dibuat', (select username from app_user where id = auth.uid()));
  if v_status = 'SUBMITTED' then
    insert into sales_order_timeline(order_no, text, by_user)
    values (v_no, 'Diajukan untuk approval', (select username from app_user where id = auth.uid()));
  end if;
  if jsonb_array_length(v_below) > 0 then
    insert into sales_order_timeline(order_no, text, by_user)
    values (v_no, 'Ditandai di bawah harga pokok (' || jsonb_array_length(v_below) || ' baris)',
            (select username from app_user where id = auth.uid()));
    perform write_audit('SO DI BAWAH HARGA POKOK', v_no, 'baris', '-', v_below::text);
  end if;
  perform write_audit('CREATE SO', v_no, 'total', '-',
    (select total::text from sales_order where no = v_no));
  return v_no;
end $fn$;

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
    insert into sales_order_timeline(order_no, text, by_user) values (p_no, 'Disetujui Sales Manager', v_user);
    perform write_audit('APPROVE SO', p_no, 'status', 'SUBMITTED', 'APPROVED');
  else
    update sales_order set status = 'REJECTED' where no = p_no and status = 'SUBMITTED';
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Ditolak' || coalesce(' — ' || p_reason, ''), v_user);
    perform write_audit('REJECT SO', p_no, 'status', 'SUBMITTED', 'REJECTED: ' || coalesce(p_reason,''));
  end if;
end $fn$;

-- ---------- SURAT JALAN ----------
create or replace function public.create_delivery(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; l jsonb; v_ord record; v_out record; v_qty numeric;
        v_total numeric := 0; v_full boolean; v_user text;
begin
  if not rbac('log.sj','create') then raise exception 'Tidak memiliki hak membuat Surat Jalan'; end if;
  select * into v_ord from sales_order where no = p->>'order_no';
  if not found then raise exception 'Sales Order % tidak ditemukan', p->>'order_no'; end if;
  if v_ord.status not in ('APPROVED','PROCESSING','PARTIALLY DELIVERED') then
    raise exception 'Order % berstatus %, belum dapat dikirim', v_ord.no, v_ord.status; end if;

  v_no := next_doc_no('SJ');
  select username into v_user from app_user where id = auth.uid();
  insert into delivery(no, delivery_date, order_no, customer_code, warehouse_code,
      driver_code, vehicle_code, note, status, created_by)
  values (v_no, coalesce((p->>'delivery_date')::date, today_jkt()), v_ord.no, v_ord.customer_code,
          coalesce(nullif(p->>'warehouse_code',''), v_ord.warehouse_code),
          nullif(p->>'driver_code',''), nullif(p->>'vehicle_code',''),
          nullif(p->>'note',''), 'IN TRANSIT', auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := (l->>'qty')::numeric;
    continue when v_qty is null or v_qty <= 0;
    select * into v_out from order_outstanding_view
      where order_no = v_ord.no and product_id = l->>'product_id';
    if not found then raise exception 'Produk % tidak ada pada order %', l->>'product_id', v_ord.no; end if;
    -- Pencegahan over-delivery ditegakkan di database, bukan hanya di UI.
    if v_qty > v_out.outstanding_qty then
      raise exception 'Over-delivery pada %: qty % melebihi sisa outstanding %',
        v_out.name, v_qty, v_out.outstanding_qty; end if;
    insert into delivery_line(delivery_no, product_id, name, unit, qty, ordered_qty, price, disc_pct, tax_pct)
    select v_no, sl.product_id, sl.name, sl.unit, v_qty, sl.qty, sl.price, sl.disc_pct, sl.tax_pct
    from sales_order_line sl where sl.order_no = v_ord.no and sl.product_id = l->>'product_id';
    update product set stock = stock - v_qty where id = l->>'product_id';
    v_total := v_total + v_qty;
  end loop;

  if v_total <= 0 then raise exception 'Surat Jalan harus memuat minimal satu barang'; end if;
  update delivery set qty_total = v_total where no = v_no;

  select bool_and(outstanding_qty <= 0) into v_full from order_outstanding_view where order_no = v_ord.no;
  update sales_order set status = case when v_full then 'DELIVERED' else 'PARTIALLY DELIVERED' end
    where no = v_ord.no;
  insert into sales_order_timeline(order_no, text, by_user)
    values (v_ord.no, 'Surat Jalan ' || v_no || ' diterbitkan (' || v_total || ' unit)', v_user);
  perform write_audit('CREATE SJ', v_no, 'qty', '-', v_total::text);
  return v_no;
end $fn$;

create or replace function public.confirm_delivery(p_no text, p_recv_by text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_ord text;
begin
  if not rbac('log.sj','edit') then raise exception 'Tidak memiliki hak konfirmasi penerimaan'; end if;
  update delivery set status = 'RECEIVED', recv_date = today_jkt(), recv_by = p_recv_by
    where no = p_no and status = 'IN TRANSIT' returning order_no into v_ord;
  if not found then raise exception 'Surat Jalan % tidak berstatus IN TRANSIT', p_no; end if;
  insert into sales_order_timeline(order_no, text, by_user)
    values (v_ord, 'Barang diterima customer (' || p_no || ')',
            (select username from app_user where id = auth.uid()));
  perform write_audit('RECEIVE SJ', p_no, 'status', 'IN TRANSIT', 'RECEIVED');
end $fn$;

grant execute on function public.post_journal(date,text,text,text,jsonb) to authenticated;
grant execute on function public.create_sales_order(jsonb) to authenticated;
grant execute on function public.approve_sales_order(text,boolean,text) to authenticated;
grant execute on function public.create_delivery(jsonb) to authenticated;
grant execute on function public.confirm_delivery(text,text) to authenticated;
grant execute on function public.refresh_invoice_status(text) to authenticated;
grant execute on function public.calc_invoice_status(numeric,numeric,numeric,date) to authenticated;
