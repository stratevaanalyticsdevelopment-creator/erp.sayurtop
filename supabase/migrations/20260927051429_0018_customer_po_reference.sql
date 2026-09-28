/* 0018 — Nomor referensi PO Customer terisi otomatis

   Banyak pelanggan Sayur Top tidak menerbitkan Purchase Order sendiri,
   sehingga kolom PO Customer pada Sales Order selalu kosong dan dokumen
   turunannya (Surat Jalan, Invoice) kehilangan referensi silang.

   Sistem kini membuat nomor referensi internal per customer:

       PO-<kode customer tanpa awalan CUST->-<urut 4 digit>
       contoh: PO-0008-0001

   Nomor ini tetap boleh ditimpa dengan nomor PO asli dari customer.
   Penomorannya memakai doc_counter yang sama dengan nomor dokumen lain,
   jadi aman dipakai beberapa pengguna sekaligus. */

create or replace function public.next_cust_po(p_customer text)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_key text; v_n int;
begin
  if p_customer is null or p_customer = '' then
    raise exception 'Customer wajib dipilih sebelum nomor PO dibuat.';
  end if;
  v_key := 'POC-' || p_customer;
  insert into doc_counter(prefix, year, seq) values (v_key, 0, 1)
  on conflict (prefix, year) do update set seq = doc_counter.seq + 1
  returning seq into v_n;
  return 'PO-' || regexp_replace(p_customer, '^CUST-', '') || '-' || lpad(v_n::text, 4, '0');
end $fn$;

/* Nomor berikutnya tanpa menaikkan penghitung, dipakai saat form dibuka. */
create or replace function public.peek_cust_po(p_customer text)
returns text language sql stable security definer set search_path = public as $fn$
  select 'PO-' || regexp_replace(p_customer, '^CUST-', '') || '-' ||
         lpad((coalesce((select seq from doc_counter
                          where prefix = 'POC-' || p_customer and year = 0), 0) + 1)::text,
              4, '0');
$fn$;

grant execute on function public.next_cust_po(text) to authenticated;
grant execute on function public.peek_cust_po(text) to authenticated;

/* create_sales_order mengisi sendiri bila po_no dikirim kosong. */
create or replace function public.create_sales_order(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; v_po text; l jsonb; i int := 0;
        v_gross numeric := 0; v_disc numeric := 0; v_sub numeric := 0;
        v_tax numeric := 0; v_total numeric := 0;
        v_qty numeric; v_price numeric; v_dp numeric; v_tp numeric;
        v_line_gross numeric; v_line_disc numeric; v_line_sub numeric; v_line_tax numeric;
begin
  if not rbac('sales.order','create') then
    raise exception 'Tidak memiliki hak membuat Sales Order';
  end if;
  v_no := next_doc_no('SO');
  v_po := nullif(p->>'po_no','');
  if v_po is null then
    v_po := next_cust_po(p->>'customer_code');
  end if;

  insert into sales_order(no, order_date, delivery_date, customer_code, salesperson_code,
      warehouse_code, po_no, term_code, note, status, created_by)
  values (v_no, (p->>'order_date')::date, nullif(p->>'delivery_date','')::date,
          p->>'customer_code', nullif(p->>'salesperson_code',''), nullif(p->>'warehouse_code',''),
          v_po, nullif(p->>'term_code',''), nullif(p->>'note',''),
          coalesce(nullif(p->>'status',''), 'DRAFT'), auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    v_qty   := coalesce((l->>'qty')::numeric, 0);
    v_price := coalesce((l->>'price')::numeric, 0);
    v_dp    := coalesce((l->>'disc_pct')::numeric, 0);
    v_tp    := coalesce((l->>'tax_pct')::numeric, 0);
    v_line_gross := round(v_qty * v_price, 2);
    v_line_disc  := round(v_line_gross * v_dp / 100, 2);
    v_line_sub   := v_line_gross - v_line_disc;
    v_line_tax   := round(v_line_sub * v_tp / 100, 2);

    insert into sales_order_line(order_no, line_no, product_id, name, unit, qty, price,
        disc_pct, tax_pct)
    values (v_no, i, l->>'product_id', l->>'name', l->>'unit', v_qty, v_price, v_dp, v_tp);

    v_gross := v_gross + v_line_gross;
    v_disc  := v_disc + v_line_disc;
    v_sub   := v_sub + v_line_sub;
    v_tax   := v_tax + v_line_tax;
  end loop;

  v_total := v_sub + v_tax;
  update sales_order set gross = v_gross, disc = v_disc, sub = v_sub, tax = v_tax,
    total = v_total where no = v_no;

  insert into sales_order_timeline(order_no, text, by_user)
  values (v_no, 'Sales Order dibuat', (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE SO', v_no, 'total', '-', v_total::text);
  return v_no;
end $fn$;

grant execute on function public.create_sales_order(jsonb) to authenticated;

/* Order lama yang kolom PO-nya kosong diisi dengan nomor referensi,
   berurut menurut tanggal order tiap customer. */
with isi as (
  select o.no, o.customer_code,
         (select count(*) from sales_order x
           where x.customer_code = o.customer_code
             and x.po_no is not null and x.po_no <> '')
         + row_number() over (partition by o.customer_code order by o.order_date, o.no) as urut
    from sales_order o where o.po_no is null or o.po_no = '')
update sales_order o
   set po_no = 'PO-' || regexp_replace(i.customer_code, '^CUST-', '') || '-'
               || lpad(i.urut::text, 4, '0')
  from isi i
 where i.no = o.no;

/* Penghitung disesuaikan agar nomor berikutnya tidak menabrak yang sudah ada. */
insert into doc_counter(prefix, year, seq)
select 'POC-' || customer_code, 0, count(*)
  from sales_order where po_no is not null and po_no <> ''
 group by customer_code
on conflict (prefix, year) do update set seq = greatest(doc_counter.seq, excluded.seq);
