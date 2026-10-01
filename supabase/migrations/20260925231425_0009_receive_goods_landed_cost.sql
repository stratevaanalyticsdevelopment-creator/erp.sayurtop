-- =====================================================================
-- INBOUND (GOODS RECEIPT) + LANDED COST
-- Penerimaan barang mencatat harga beli aktual hari itu, membebankan
-- biaya tambahan ke persediaan, lalu memperbarui harga pokok master
-- produk sehingga HPP berikutnya memakai biaya hari berjalan.
-- =====================================================================

-- Membagi landed cost ke baris penerimaan dan menghitung ulang unit_cost.
create or replace function public.realloc_landed(p_grn text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_val numeric; v_qty numeric; v_by_val numeric; v_by_qty numeric;
begin
  select coalesce(sum(price * qty),0), coalesce(sum(qty),0) into v_val, v_qty
    from goods_receipt_line where grn_no = p_grn;
  select coalesce(sum(amount) filter (where alloc_method = 'VALUE'),0),
         coalesce(sum(amount) filter (where alloc_method = 'QTY'),0)
    into v_by_val, v_by_qty from landed_cost where grn_no = p_grn;

  update goods_receipt_line l set
    landed_alloc = round(
      case when v_val > 0 then v_by_val * (l.price * l.qty) / v_val else 0 end +
      case when v_qty > 0 then v_by_qty * l.qty / v_qty else 0 end, 2)
  where l.grn_no = p_grn;

  update goods_receipt_line l set
    unit_cost = round((l.price * l.qty + l.landed_alloc) / nullif(l.qty,0), 4)
  where l.grn_no = p_grn;

  update goods_receipt g set
    goods_total  = coalesce((select sum(price * qty)    from goods_receipt_line where grn_no = p_grn),0),
    landed_total = coalesce((select sum(landed_alloc)   from goods_receipt_line where grn_no = p_grn),0),
    total        = coalesce((select sum(price * qty + landed_alloc) from goods_receipt_line where grn_no = p_grn),0)
  where g.no = p_grn;
end $fn$;

-- Harga pokok master mengikuti biaya aktual hari penerimaan.
create or replace function public.refresh_base_price(p_grn text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_date date;
begin
  select grn_date into v_date from goods_receipt where no = p_grn;
  update product p set base_price = d.avg_landed_cost
  from purchase_price_daily d
  where d.product_id = p.id and d.price_date = v_date
    and d.avg_landed_cost > 0
    and p.id in (select product_id from goods_receipt_line where grn_no = p_grn);
end $fn$;

-- ---------- Penerimaan barang ----------
create or replace function public.receive_goods(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; l jsonb; c jsonb; v_po record; v_qty numeric; v_price numeric;
        v_total_qty numeric := 0; v_g record; v_jv text; v_lines jsonb;
        v_supplier text; v_date date; v_pol bigint;
begin
  if not rbac('buy.inbound','create') then raise exception 'Tidak memiliki hak mencatat penerimaan barang'; end if;
  v_date := coalesce((p->>'grn_date')::date, today_jkt());

  if nullif(p->>'po_no','') is not null then
    select * into v_po from purchase_order where no = p->>'po_no';
    if not found then raise exception 'Purchase Order % tidak ditemukan', p->>'po_no'; end if;
    if v_po.status = 'CANCELLED' then raise exception 'Purchase Order % sudah dibatalkan', v_po.no; end if;
    v_supplier := v_po.supplier_code;
  else
    v_supplier := nullif(p->>'supplier_code','');
    if v_supplier is null then raise exception 'Supplier wajib diisi bila penerimaan tanpa PO'; end if;
  end if;

  v_no := next_doc_no('GRN');
  insert into goods_receipt(no, grn_date, po_no, supplier_code, warehouse_code,
      supplier_invoice, note, status, created_by)
  values (v_no, v_date, nullif(p->>'po_no',''), v_supplier,
          coalesce(nullif(p->>'warehouse_code',''), v_po.warehouse_code),
          nullif(p->>'supplier_invoice',''), nullif(p->>'note',''), 'POSTED', auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := (l->>'qty')::numeric;
    continue when v_qty is null or v_qty <= 0;
    v_price := coalesce((l->>'price')::numeric, 0);
    v_pol := nullif(l->>'po_line_id','')::bigint;

    -- Tidak boleh menerima melebihi jumlah yang dipesan.
    if v_pol is not null then
      if not exists (select 1 from purchase_order_line where id = v_pol and po_no = v_po.no) then
        raise exception 'Baris PO % bukan milik %', v_pol, v_po.no; end if;
      if v_qty > (select qty - received_qty from purchase_order_line where id = v_pol) then
        raise exception 'Penerimaan % melebihi sisa pesanan pada baris PO %', v_qty, v_pol; end if;
      update purchase_order_line set received_qty = received_qty + v_qty where id = v_pol;
    end if;

    insert into goods_receipt_line(grn_no, po_line_id, product_id, name, unit, qty, price, unit_cost)
    select v_no, v_pol, pr.id, pr.name, pr.unit, v_qty, v_price, v_price
    from product pr where pr.id = l->>'product_id';

    update product set stock = stock + v_qty where id = l->>'product_id';
    v_total_qty := v_total_qty + v_qty;
  end loop;

  if v_total_qty <= 0 then raise exception 'Penerimaan harus memuat minimal satu barang'; end if;

  for c in select * from jsonb_array_elements(coalesce(p->'landed','[]'::jsonb)) loop
    if coalesce((c->>'amount')::numeric,0) <= 0 then continue; end if;
    insert into landed_cost(grn_no, kind, description, amount, alloc_method)
    values (v_no, coalesce(nullif(c->>'kind',''),'Lain-lain'), nullif(c->>'description',''),
            (c->>'amount')::numeric, coalesce(nullif(c->>'alloc_method',''),'VALUE'));
  end loop;

  update goods_receipt set qty_total = v_total_qty where no = v_no;
  perform realloc_landed(v_no);
  perform refresh_base_price(v_no);

  select * into v_g from goods_receipt where no = v_no;
  v_lines := jsonb_build_array(
    jsonb_build_object('acc','1300','desc','Penerimaan barang — ' || v_no, 'd', v_g.total, 'c', 0),
    jsonb_build_object('acc','2150','desc','Utang ' || v_supplier || ' — ' || v_no, 'd', 0, 'c', v_g.goods_total));
  if v_g.landed_total > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('acc','1110','desc','Biaya masuk barang — ' || v_no, 'd', 0, 'c', v_g.landed_total));
  end if;
  v_jv := post_journal(v_date, 'GOODS RECEIPT', v_no,
    'Penerimaan barang dari ' || v_supplier || ' — ' || v_no, v_lines);
  update goods_receipt set journal_no = v_jv where no = v_no;

  -- Status PO mengikuti sisa yang belum diterima.
  if v_po.no is not null then
    update purchase_order set status = case
      when (select bool_and(received_qty >= qty) from purchase_order_line where po_no = v_po.no)
        then 'RECEIVED' else 'PARTIALLY RECEIVED' end
    where no = v_po.no;
  end if;

  perform write_audit('RECEIVE GOODS', v_no, 'total', '-', v_g.total::text);
  return v_no;
end $fn$;

-- ---------- Menambah landed cost pada penerimaan yang sudah tercatat ----------
create or replace function public.apply_landed_cost(p jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare c jsonb; v_g record; v_before numeric; v_delta numeric;
begin
  if not rbac('buy.landed','create') then raise exception 'Tidak memiliki hak menambah landed cost'; end if;
  select * into v_g from goods_receipt where no = p->>'grn_no';
  if not found then raise exception 'Penerimaan % tidak ditemukan', p->>'grn_no'; end if;
  v_before := v_g.landed_total;

  for c in select * from jsonb_array_elements(coalesce(p->'landed','[]'::jsonb)) loop
    if coalesce((c->>'amount')::numeric,0) <= 0 then continue; end if;
    insert into landed_cost(grn_no, kind, description, amount, alloc_method)
    values (v_g.no, coalesce(nullif(c->>'kind',''),'Lain-lain'), nullif(c->>'description',''),
            (c->>'amount')::numeric, coalesce(nullif(c->>'alloc_method',''),'VALUE'));
  end loop;

  perform realloc_landed(v_g.no);
  perform refresh_base_price(v_g.no);
  select * into v_g from goods_receipt where no = p->>'grn_no';
  v_delta := v_g.landed_total - v_before;

  if v_delta <> 0 then
    perform post_journal(v_g.grn_date, 'LANDED COST', v_g.no,
      'Tambahan biaya masuk barang — ' || v_g.no,
      jsonb_build_array(
        jsonb_build_object('acc','1300','desc','Kapitalisasi biaya — ' || v_g.no, 'd', v_delta, 'c', 0),
        jsonb_build_object('acc','1110','desc','Pembayaran biaya masuk — ' || v_g.no, 'd', 0, 'c', v_delta)));
    perform write_audit('LANDED COST', v_g.no, 'landed_total', v_before::text, v_g.landed_total::text);
  end if;
end $fn$;

-- ---------- Retur memakai HPP yang sama dengan fakturnya ----------
create or replace function public.process_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ret_no text; v_cn_no text; v_inv record; l jsonb; il record;
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
    v_cogs := v_cogs + round(hpp_unit(il.product_id, il.so_line_id, v_inv.invoice_date) * v_qty, 2);

    insert into sales_return_line(return_no, product_id, name, unit, qty, price, disc_pct, tax_pct, reason)
    values (v_ret_no, il.product_id, il.name, il.unit, v_qty, il.price, il.disc_pct, il.tax_pct, l->>'reason');

    update invoice_line set ret_qty = ret_qty + v_qty, ret_reason = l->>'reason' where id = il.id;
    update product set stock = stock + v_qty where id = il.product_id;
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

grant execute on function public.receive_goods(jsonb) to authenticated;
grant execute on function public.apply_landed_cost(jsonb) to authenticated;
grant execute on function public.realloc_landed(text) to authenticated;
grant execute on function public.refresh_base_price(text) to authenticated;
