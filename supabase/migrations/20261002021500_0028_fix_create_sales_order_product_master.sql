/* 0028 — create_sales_order menolak setiap Sales Order baru

   GEJALA

   Tombol "Simpan & Ajukan Approval" di form Sales Order Baru tidak
   menghasilkan apa-apa selain pesan merah:

       null value in column "name" of relation "sales_order_line"
       violates not-null constraint

   Tombol "Simpan Draft" gagal dengan cara yang sama. Artinya tidak satu pun
   Sales Order baru dapat dibuat lewat aplikasi — dan karena Kebutuhan
   Pembelian dihitung dari Sales Order yang disetujui, menu itu ikut tampak
   "tidak terhubung" padahal view-nya benar.

   SEBAB

   `create_sales_order` mengambil nama dan satuan produk dari payload klien:

       values (v_no, i, l->>'product_id', l->>'name', l->>'unit', ...)

   Klien tidak mengirimnya, dan memang tidak seharusnya: master produk adalah
   sumber kebenaran untuk nama dan satuan. `update_sales_order` — yang ditulis
   belakangan — sudah melakukannya dengan benar:

       values (v_o.no, i, pr.id, pr.name, pr.unit, ...)

   Jadi kedua fungsi ini tidak konsisten, dan yang salah adalah yang dipakai
   untuk membuat order baru. Versi HTML juga mengambil nama dan satuan dari
   master produknya, sehingga perbaikan ini sekaligus menyamakan perilaku
   kedua versi aplikasi.

   PERBAIKAN

   Produk dicari di master, lalu nama dan satuannya diambil dari sana. Bila
   product_id tidak ada di master, order ditolak dengan pesan yang menyebut
   kodenya — sebelumnya baris seperti itu diam-diam tersimpan dengan kode
   produk yang tidak dikenal.

   Selebihnya fungsi ini tidak berubah: penomoran, PO customer, perhitungan
   bruto/diskon/PPN, timeline, dan audit tetap sama persis.
*/
create or replace function public.create_sales_order(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; v_po text; l jsonb; i int := 0;
        v_gross numeric := 0; v_disc numeric := 0; v_sub numeric := 0;
        v_tax numeric := 0; v_total numeric := 0;
        v_qty numeric; v_price numeric; v_dp numeric; v_tp numeric;
        v_line_gross numeric; v_line_disc numeric; v_line_sub numeric; v_line_tax numeric;
        pr record;
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

    /* Nama dan satuan diambil dari master produk, bukan dari payload —
       sama dengan update_sales_order dan dengan versi HTML. */
    select * into pr from product where id = l->>'product_id';
    if not found then
      raise exception 'Produk % tidak ditemukan di master produk',
        coalesce(l->>'product_id', '(kosong)');
    end if;

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
    values (v_no, i, pr.id, pr.name, pr.unit, v_qty, v_price, v_dp, v_tp);

    v_gross := v_gross + v_line_gross;
    v_disc  := v_disc + v_line_disc;
    v_sub   := v_sub + v_line_sub;
    v_tax   := v_tax + v_line_tax;
  end loop;

  if i = 0 then
    raise exception 'Sales Order tanpa baris barang';
  end if;

  v_total := v_sub + v_tax;
  update sales_order set gross = v_gross, disc = v_disc, sub = v_sub, tax = v_tax,
    total = v_total where no = v_no;

  insert into sales_order_timeline(order_no, text, by_user)
  values (v_no, 'Sales Order dibuat', (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE SO', v_no, 'total', '-', v_total::text);
  return v_no;
end $fn$;

revoke execute on function public.create_sales_order(jsonb) from public, anon;
grant  execute on function public.create_sales_order(jsonb) to authenticated, service_role;
