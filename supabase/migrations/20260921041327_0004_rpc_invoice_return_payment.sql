-- ---------- INVOICE ----------
create or replace function public.invoice_journal_lines(p_no text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with i as (select * from invoice where no = p_no),
       c as (select coalesce(sum(round(p.base_price * il.qty, 2)),0) as cogs
             from invoice_line il join product p on p.id = il.product_id where il.invoice_no = p_no)
  select jsonb_build_array(
    jsonb_build_object('acc','1200','desc','Piutang ' || i.customer_code || ' — ' || i.no, 'd', i.total, 'c', 0),
    jsonb_build_object('acc','4100','desc','Penjualan barang — ' || i.no, 'd', 0, 'c', i.sub))
    || case when i.tax > 0 then jsonb_build_array(
         jsonb_build_object('acc','2200','desc','PPN Keluaran — ' || i.no, 'd', 0, 'c', i.tax))
       else '[]'::jsonb end
    || case when c.cogs > 0 then jsonb_build_array(
         jsonb_build_object('acc','5100','desc','HPP atas ' || i.no, 'd', c.cogs, 'c', 0),
         jsonb_build_object('acc','1300','desc','Pengurangan persediaan — ' || i.no, 'd', 0, 'c', c.cogs))
       else '[]'::jsonb end
  from i, c;
$fn$;

create or replace function public.create_invoice_from_delivery(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; v_dv record; v_ord record; v_days int; v_date date;
        v_gross numeric := 0; v_disc numeric := 0; v_tax numeric := 0;
        r record; i int := 0; v_lg numeric; v_net numeric; v_jv text;
begin
  if not rbac('ar.invoice','create') then raise exception 'Tidak memiliki hak membuat Invoice'; end if;
  select * into v_dv from delivery where no = p->>'delivery_no';
  if not found then raise exception 'Surat Jalan % tidak ditemukan', p->>'delivery_no'; end if;
  if v_dv.status <> 'RECEIVED' then
    raise exception 'Surat Jalan % belum dikonfirmasi diterima customer', v_dv.no; end if;
  if exists (select 1 from invoice_delivery where delivery_no = v_dv.no) then
    raise exception 'Surat Jalan % sudah ditagihkan', v_dv.no; end if;

  select * into v_ord from sales_order where no = v_dv.order_no;
  v_date := coalesce((p->>'invoice_date')::date, today_jkt());
  select days into v_days from payment_term
    where code = coalesce(nullif(p->>'term_code',''), v_ord.term_code);
  v_no := next_doc_no('INV');

  insert into invoice(no, invoice_date, due_date, customer_code, order_no, po_no, term_code,
      salesperson_code, note, status, posted, created_by)
  values (v_no, v_date, v_date + coalesce(v_days,0), v_dv.customer_code, v_ord.no, v_ord.po_no,
          coalesce(nullif(p->>'term_code',''), v_ord.term_code), v_ord.salesperson_code,
          nullif(p->>'note',''), 'OPEN', true, auth.uid());
  insert into invoice_delivery(invoice_no, delivery_no) values (v_no, v_dv.no);

  for r in select * from delivery_line where delivery_no = v_dv.no order by id loop
    i := i + 1;
    v_lg := round(r.qty * r.price, 2);
    v_net := v_lg - v_lg * r.disc_pct/100;
    v_gross := v_gross + v_lg; v_disc := v_disc + (v_lg - v_net);
    v_tax := v_tax + v_net * r.tax_pct/100;
    insert into invoice_line(invoice_no, line_no, product_id, name, unit, qty, price, disc_pct, tax_pct)
    values (v_no, i, r.product_id, r.name, r.unit, r.qty, r.price, r.disc_pct, r.tax_pct);
  end loop;

  update invoice set gross = round(v_gross,2), disc = round(v_disc,2),
    sub = round(v_gross - v_disc,2), tax = round(v_tax,2),
    total = round(v_gross - v_disc + v_tax,2) where no = v_no;

  v_jv := post_journal(v_date, 'INVOICE', v_no,
    'Penjualan kepada ' || v_dv.customer_code || ' — ' || v_no, invoice_journal_lines(v_no));
  update invoice set journal_no = v_jv where no = v_no;
  perform refresh_invoice_status(v_no);

  update sales_order set status = 'INVOICED' where no = v_ord.no and status = 'DELIVERED';
  insert into sales_order_timeline(order_no, text, by_user)
  values (v_ord.no, 'Invoice ' || v_no || ' diterbitkan',
          (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE INVOICE', v_no, 'total', '-',
    (select total::text from invoice where no = v_no));
  return v_no;
end $fn$;

create or replace function public.update_invoice(p jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_inv record; l jsonb; i int := 0; v_lg numeric; v_net numeric;
        v_gross numeric := 0; v_disc numeric := 0; v_tax numeric := 0;
        v_ret numeric; v_jv text; v_reason text := nullif(p->>'reason','');
        pr record; v_date date; v_due date;
begin
  if not rbac('ar.invoice','edit') then raise exception 'Tidak memiliki hak mengubah Invoice'; end if;
  if v_reason is null then raise exception 'Alasan perubahan wajib diisi'; end if;
  select * into v_inv from invoice where no = p->>'no';
  if not found then raise exception 'Invoice % tidak ditemukan', p->>'no'; end if;
  if v_inv.status = 'CANCELLED' then raise exception 'Invoice sudah dibatalkan'; end if;

  v_date := coalesce((p->>'invoice_date')::date, v_inv.invoice_date);
  v_due  := coalesce((p->>'due_date')::date, v_inv.due_date);

  -- qty baru tidak boleh lebih kecil dari qty yang sudah diretur
  for l in select * from jsonb_array_elements(p->'lines') loop
    select coalesce(sum(ret_qty),0) into v_ret from invoice_line
      where invoice_no = v_inv.no and product_id = l->>'product_id';
    if (l->>'qty')::numeric < v_ret then
      raise exception 'Qty produk % (%) lebih kecil dari qty yang sudah diretur (%)',
        l->>'product_id', (l->>'qty')::numeric, v_ret; end if;
  end loop;

  create temp table _old_ret on commit drop as
    select product_id, sum(ret_qty) as ret_qty, max(ret_reason) as ret_reason
    from invoice_line where invoice_no = v_inv.no group by product_id;
  delete from invoice_line where invoice_no = v_inv.no;

  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into pr from product where id = l->>'product_id';
    if not found then raise exception 'Produk % tidak ditemukan', l->>'product_id'; end if;
    i := i + 1;
    v_lg := round((l->>'qty')::numeric * (l->>'price')::numeric, 2);
    v_net := v_lg - v_lg * coalesce((l->>'disc_pct')::numeric,0)/100;
    v_gross := v_gross + v_lg; v_disc := v_disc + (v_lg - v_net);
    v_tax := v_tax + v_net * coalesce((l->>'tax_pct')::numeric,0)/100;
    insert into invoice_line(invoice_no, line_no, product_id, name, unit, qty, price,
      disc_pct, tax_pct, ret_qty, ret_reason)
    select v_inv.no, i, pr.id, pr.name, pr.unit, (l->>'qty')::numeric, (l->>'price')::numeric,
           coalesce((l->>'disc_pct')::numeric,0), coalesce((l->>'tax_pct')::numeric,0),
           coalesce(o.ret_qty,0), o.ret_reason
    from (select 1) z left join _old_ret o on o.product_id = pr.id;
  end loop;

  update invoice set invoice_date = v_date, due_date = v_due,
    term_code = coalesce(nullif(p->>'term_code',''), term_code),
    po_no = coalesce(nullif(p->>'po_no',''), po_no),
    gross = round(v_gross,2), disc = round(v_disc,2), sub = round(v_gross - v_disc,2),
    tax = round(v_tax,2), total = round(v_gross - v_disc + v_tax,2)
  where no = v_inv.no;

  if (select total - return_total - paid from invoice where no = v_inv.no) < -0.005 then
    raise exception 'Nilai invoice menjadi lebih kecil dari pembayaran dan retur yang sudah tercatat';
  end if;

  perform void_journals_for(v_inv.no);
  v_jv := post_journal(v_date, 'INVOICE', v_inv.no,
    'Koreksi invoice ' || v_inv.no || ' — ' || v_reason, invoice_journal_lines(v_inv.no));
  update invoice set journal_no = v_jv where no = v_inv.no;
  perform refresh_invoice_status(v_inv.no);

  perform write_audit('EDIT INVOICE', v_inv.no, 'total', v_inv.total::text,
    (select total::text from invoice where no = v_inv.no));
  perform write_audit('EDIT INVOICE', v_inv.no, 'alasan', '-', v_reason);
end $fn$;

-- ---------- RETUR → CREDIT NOTE ----------
create or replace function public.process_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ret_no text; v_cn_no text; v_inv record; l jsonb; il record; pr record;
        v_qty numeric; v_lg numeric; v_net numeric;
        v_sub numeric := 0; v_tax numeric := 0; v_cogs numeric := 0;
        v_date date; v_reason text := null; v_jv text; v_lines jsonb;
begin
  if not rbac('ar.invoice','create') then raise exception 'Tidak memiliki hak memproses retur'; end if;
  select * into v_inv from invoice where no = p->>'invoice_no';
  if not found then raise exception 'Invoice % tidak ditemukan', p->>'invoice_no'; end if;
  if v_inv.status = 'CANCELLED' then raise exception 'Invoice sudah dibatalkan'; end if;
  v_date := coalesce((p->>'return_date')::date, today_jkt());

  v_ret_no := next_doc_no('RET');
  insert into sales_return(no, return_date, invoice_no, order_no, customer_code,
      warehouse_code, note, status, created_by)
  values (v_ret_no, v_date, v_inv.no, v_inv.order_no, v_inv.customer_code,
          nullif(p->>'warehouse_code',''), nullif(p->>'note',''), 'APPROVED', auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := (l->>'qty')::numeric;
    continue when v_qty is null or v_qty <= 0;
    select * into il from invoice_line
      where invoice_no = v_inv.no and product_id = l->>'product_id' limit 1;
    if not found then raise exception 'Produk % tidak ada pada invoice %', l->>'product_id', v_inv.no; end if;
    if v_qty > (il.qty - il.ret_qty) then
      raise exception 'Qty retur % melebihi sisa yang dapat diretur (%) untuk %',
        v_qty, il.qty - il.ret_qty, il.name; end if;
    if nullif(l->>'reason','') is null then
      raise exception 'Alasan retur wajib diisi untuk %', il.name; end if;

    v_lg := round(v_qty * il.price, 2);
    v_net := v_lg - v_lg * il.disc_pct/100;
    v_sub := v_sub + v_net;
    v_tax := v_tax + v_net * il.tax_pct/100;
    select * into pr from product where id = il.product_id;
    v_cogs := v_cogs + round(pr.base_price * v_qty, 2);

    insert into sales_return_line(return_no, product_id, name, unit, qty, price, disc_pct, tax_pct, reason)
    values (v_ret_no, il.product_id, il.name, il.unit, v_qty, il.price, il.disc_pct, il.tax_pct, l->>'reason');

    update invoice_line set ret_qty = ret_qty + v_qty, ret_reason = l->>'reason'
      where id = il.id;
    update product set stock = stock + v_qty where id = il.product_id;   -- barang kembali ke gudang
    if v_reason is null then v_reason := l->>'reason'; end if;
  end loop;

  if v_sub <= 0 then raise exception 'Retur harus memuat minimal satu barang dengan qty lebih dari 0'; end if;

  v_cn_no := next_doc_no('CN');
  insert into credit_note(no, cn_date, invoice_no, return_no, customer_code, reason, note,
      sub, tax, total, status, posted, created_by)
  values (v_cn_no, v_date, v_inv.no, v_ret_no, v_inv.customer_code, v_reason, nullif(p->>'note',''),
          round(v_sub,2), round(v_tax,2), round(v_sub + v_tax,2), 'POSTED', true, auth.uid());
  insert into credit_note_line(cn_no, product_id, name, unit, qty, price, disc_pct, tax_pct, reason)
    select v_cn_no, product_id, name, unit, qty, price, disc_pct, tax_pct, reason
    from sales_return_line where return_no = v_ret_no;

  update sales_return set reason = v_reason, sub = round(v_sub,2), tax = round(v_tax,2),
    total = round(v_sub + v_tax,2), cn_no = v_cn_no where no = v_ret_no;
  update invoice set return_total = return_total + round(v_sub + v_tax,2) where no = v_inv.no;
  perform refresh_invoice_status(v_inv.no);

  v_lines := jsonb_build_array(
    jsonb_build_object('acc','4200','desc','Retur penjualan — ' || v_inv.no, 'd', round(v_sub,2), 'c', 0));
  if v_tax > 0 then v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('acc','2200','desc','Koreksi PPN Keluaran — ' || v_cn_no, 'd', round(v_tax,2), 'c', 0));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('acc','1200','desc','Pengurangan piutang — ' || v_cn_no, 'd', 0, 'c', round(v_sub + v_tax,2)));
  if v_cogs > 0 then v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('acc','1300','desc','Penerimaan kembali barang retur — ' || v_cn_no, 'd', v_cogs, 'c', 0),
    jsonb_build_object('acc','5100','desc','Koreksi HPP atas retur — ' || v_cn_no, 'd', 0, 'c', v_cogs));
  end if;
  v_jv := post_journal(v_date, 'CREDIT NOTE', v_cn_no,
    'Retur penjualan ' || v_inv.customer_code || ' — ' || v_cn_no, v_lines);
  update credit_note set journal_no = v_jv where no = v_cn_no;

  insert into sales_order_timeline(order_no, text, by_user)
    values (v_inv.order_no, 'Retur ' || v_ret_no || ' — Credit Note ' || v_cn_no,
            (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE RETURN', v_ret_no, 'invoice', v_inv.no, round(v_sub + v_tax,2)::text);
  return jsonb_build_object('return_no', v_ret_no, 'cn_no', v_cn_no,
    'total', round(v_sub + v_tax,2), 'journal_no', v_jv);
end $fn$;

-- ---------- PAYMENT ----------
create or replace function public.record_payment(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; a jsonb; v_amt numeric; v_alloc numeric := 0; v_os numeric;
        v_date date; v_lines jsonb; v_coa text; v_jv text; v_adv numeric;
begin
  if not rbac('ar.payment','create') then raise exception 'Tidak memiliki hak mencatat pembayaran'; end if;
  v_amt := (p->>'amount')::numeric;
  if v_amt is null or v_amt <= 0 then raise exception 'Jumlah pembayaran harus lebih dari 0'; end if;
  v_date := coalesce((p->>'pay_date')::date, today_jkt());
  v_no := next_doc_no('PAY');

  insert into payment(no, pay_date, customer_code, amount, method, bank_code, ref, status, created_by)
  values (v_no, v_date, p->>'customer_code', round(v_amt,2),
          coalesce(nullif(p->>'method',''),'Transfer'), nullif(p->>'bank_code',''),
          nullif(p->>'ref',''), 'POSTED', auth.uid());

  for a in select * from jsonb_array_elements(coalesce(p->'alloc','[]'::jsonb)) loop
    if (a->>'amount')::numeric <= 0 then continue; end if;
    select (total - return_total - paid) into v_os from invoice where no = a->>'invoice_no';
    if v_os is null then raise exception 'Invoice % tidak ditemukan', a->>'invoice_no'; end if;
    if (a->>'amount')::numeric > v_os + 0.005 then
      raise exception 'Alokasi % melebihi sisa tagihan % pada invoice %',
        (a->>'amount')::numeric, v_os, a->>'invoice_no'; end if;
    insert into payment_alloc(payment_no, invoice_no, amount)
      values (v_no, a->>'invoice_no', round((a->>'amount')::numeric,2));
    update invoice set paid = paid + round((a->>'amount')::numeric,2) where no = a->>'invoice_no';
    perform refresh_invoice_status(a->>'invoice_no');
    v_alloc := v_alloc + (a->>'amount')::numeric;
  end loop;

  if v_alloc > v_amt + 0.005 then raise exception 'Total alokasi melebihi jumlah pembayaran'; end if;
  v_adv := round(v_amt - v_alloc, 2);
  update payment set advance = v_adv where no = v_no;

  select coalesce(coa_code,'1110') into v_coa from bank_account where code = p->>'bank_code';
  v_lines := jsonb_build_array(jsonb_build_object('acc', coalesce(v_coa,'1110'),
    'desc','Penerimaan pembayaran — ' || v_no, 'd', round(v_amt,2), 'c', 0));
  if v_alloc > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('acc','1200',
    'desc','Pelunasan piutang ' || (p->>'customer_code') || ' — ' || v_no, 'd', 0, 'c', round(v_alloc,2)));
  end if;
  if v_adv > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('acc','2400',
    'desc','Uang muka pelanggan ' || (p->>'customer_code'), 'd', 0, 'c', v_adv));
  end if;
  v_jv := post_journal(v_date, 'PAYMENT', v_no,
    'Penerimaan pembayaran ' || (p->>'customer_code') || ' — ' || v_no, v_lines);
  update payment set journal_no = v_jv where no = v_no;

  -- order dinyatakan PAID bila seluruh invoice-nya lunas
  update sales_order o set status = 'PAID'
  where o.no in (select distinct i.order_no from invoice i
                 join payment_alloc pa on pa.invoice_no = i.no where pa.payment_no = v_no)
    and not exists (select 1 from invoice i2 where i2.order_no = o.no
                    and i2.status <> 'CANCELLED' and (i2.total - i2.return_total - i2.paid) > 0.005);

  perform write_audit('CREATE PAYMENT', v_no, 'amount', '-', round(v_amt,2)::text);
  return v_no;
end $fn$;

grant execute on function public.create_invoice_from_delivery(jsonb) to authenticated;
grant execute on function public.update_invoice(jsonb) to authenticated;
grant execute on function public.process_return(jsonb) to authenticated;
grant execute on function public.record_payment(jsonb) to authenticated;
grant execute on function public.invoice_journal_lines(text) to authenticated;
