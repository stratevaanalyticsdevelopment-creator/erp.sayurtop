-- =====================================================================
-- PO OTOMATIS DARI SO + AUTO-MATCH HPP
-- Tautan baris dibawa sepanjang rantai: sales_order_line → delivery_line
-- → invoice_line, sehingga HPP setiap baris faktur dapat ditelusuri ke
-- baris PO dan penerimaan barang yang menjadi sumbernya.
-- =====================================================================

alter table delivery_line add column so_line_id bigint references sales_order_line(id);
alter table invoice_line  add column so_line_id bigint references sales_order_line(id);
create index delivery_line_sol_idx on delivery_line(so_line_id);
create index invoice_line_sol_idx  on invoice_line(so_line_id);

-- ---------- HPP per unit ----------
-- Urutan sumber biaya, dari yang paling spesifik:
--   1. biaya aktual penerimaan barang atas baris PO yang ditautkan ke baris SO
--   2. rata-rata harga beli produk pada tanggal faktur
--   3. harga beli terakhir sebelum tanggal faktur
--   4. harga pokok standar pada master produk
-- Tingkat 2–4 diperlukan agar faktur tanpa PO (mis. data lama atau barang
-- dari stok) tetap memiliki HPP dan neraca tidak timpang.
create or replace function public.hpp_unit(p_product_id text, p_so_line_id bigint, p_date date)
returns numeric language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select round(sum(grl.unit_cost * grl.qty) / nullif(sum(grl.qty),0), 2)
       from sales_order_line sl
       join goods_receipt_line grl on grl.po_line_id = sl.po_line_id
       join goods_receipt g on g.no = grl.grn_no and g.status <> 'CANCELLED'
      where sl.id = p_so_line_id and sl.po_line_id is not null),
    (select avg_landed_cost from purchase_price_daily
      where product_id = p_product_id and price_date = p_date),
    (select avg_landed_cost from purchase_price_daily
      where product_id = p_product_id and price_date <= p_date
      order by price_date desc limit 1),
    (select base_price from product where id = p_product_id),
    0);
$fn$;

-- Asal-usul HPP sebuah baris faktur, untuk ditampilkan di layar.
create or replace function public.hpp_source(p_so_line_id bigint)
returns text language sql stable security definer set search_path = public as $fn$
  select case when exists (
    select 1 from sales_order_line sl
      join goods_receipt_line grl on grl.po_line_id = sl.po_line_id
      join goods_receipt g on g.no = grl.grn_no and g.status <> 'CANCELLED'
     where sl.id = p_so_line_id and sl.po_line_id is not null)
  then 'PO' else 'ESTIMASI' end;
$fn$;

-- ---------- PO otomatis dari Sales Order ----------
create or replace function public.create_po_from_order(p_order_no text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ord record; s record; l record; v_no text; i int;
        v_gross numeric; v_tax numeric; v_out jsonb := '[]'::jsonb;
begin
  if not rbac('buy.po','create') then raise exception 'Tidak memiliki hak membuat Purchase Order'; end if;
  select * into v_ord from sales_order where no = p_order_no;
  if not found then raise exception 'Sales Order % tidak ditemukan', p_order_no; end if;
  if exists (select 1 from purchase_order where order_no = p_order_no and status <> 'CANCELLED') then
    return jsonb_build_object('created', 0, 'note', 'PO untuk order ini sudah ada');
  end if;

  -- Satu PO per supplier, berisi seluruh baris SO milik supplier tersebut.
  for s in
    select coalesce(pr.default_supplier_code, 'SUP-UMUM') as supplier_code
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

    i := 0; v_gross := 0; v_tax := 0;
    for l in
      select sl.*, pr.base_price, pr.tax_rate
      from sales_order_line sl join product pr on pr.id = sl.product_id
      where sl.order_no = p_order_no
        and coalesce(pr.default_supplier_code,'SUP-UMUM') = s.supplier_code
      order by sl.line_no
    loop
      i := i + 1;
      insert into purchase_order_line(po_no, line_no, product_id, name, unit, qty,
          price, disc_pct, tax_pct, so_line_id)
      values (v_no, i, l.product_id, l.name, l.unit, l.qty, l.base_price, 0, 0, l.id);
      -- tautan balik untuk Auto-Match HPP
      update sales_order_line set po_line_id = currval('purchase_order_line_id_seq')
        where id = l.id;
      v_gross := v_gross + round(l.qty * l.base_price, 2);
    end loop;

    update purchase_order set gross = v_gross, sub = v_gross, tax = v_tax,
      total = v_gross + v_tax where no = v_no;
    v_out := v_out || jsonb_build_object('no', v_no, 'supplier', s.supplier_code,
      'lines', i, 'total', v_gross);
  end loop;

  if jsonb_array_length(v_out) > 0 then
    insert into sales_order_timeline(order_no, text, by_user)
    values (p_order_no, 'Purchase Order dibuat otomatis (' || jsonb_array_length(v_out) || ' supplier)',
            (select username from app_user where id = auth.uid()));
    perform write_audit('CREATE PO', p_order_no, 'po', '-', v_out::text);
  end if;
  return jsonb_build_object('created', jsonb_array_length(v_out), 'po', v_out);
end $fn$;

-- Approval SO sekaligus menerbitkan PO ke supplier.
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
    -- Kegagalan pembuatan PO tidak boleh membatalkan approval.
    begin
      perform create_po_from_order(p_no);
    exception when others then
      insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'PO otomatis gagal dibuat: ' || sqlerrm, v_user);
    end;
  else
    update sales_order set status = 'REJECTED' where no = p_no and status = 'SUBMITTED';
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Ditolak' || coalesce(' — ' || p_reason, ''), v_user);
    perform write_audit('REJECT SO', p_no, 'status', 'SUBMITTED', 'REJECTED: ' || coalesce(p_reason,''));
  end if;
end $fn$;

-- ---------- Bawa tautan baris SO ke Surat Jalan ----------
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
    if v_qty > v_out.outstanding_qty then
      raise exception 'Over-delivery pada %: qty % melebihi sisa outstanding %',
        v_out.name, v_qty, v_out.outstanding_qty; end if;
    insert into delivery_line(delivery_no, product_id, name, unit, qty, ordered_qty,
        price, disc_pct, tax_pct, so_line_id)
    select v_no, sl.product_id, sl.name, sl.unit, v_qty, sl.qty, sl.price, sl.disc_pct, sl.tax_pct, sl.id
    from sales_order_line sl where sl.order_no = v_ord.no and sl.product_id = l->>'product_id'
    limit 1;
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

-- ---------- Bawa tautan baris SO ke Invoice ----------
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
    insert into invoice_line(invoice_no, line_no, product_id, name, unit, qty, price,
        disc_pct, tax_pct, so_line_id)
    values (v_no, i, r.product_id, r.name, r.unit, r.qty, r.price, r.disc_pct, r.tax_pct, r.so_line_id);
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

-- ---------- HPP faktur memakai biaya aktual pembelian ----------
create or replace function public.invoice_journal_lines(p_no text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with i as (select * from invoice where no = p_no),
       c as (select coalesce(sum(round(
               hpp_unit(il.product_id, il.so_line_id, (select invoice_date from i)) * il.qty, 2)),0) as cogs
             from invoice_line il where il.invoice_no = p_no)
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

grant execute on function public.hpp_unit(text,bigint,date) to authenticated;
grant execute on function public.hpp_source(bigint) to authenticated;
grant execute on function public.create_po_from_order(text) to authenticated;
