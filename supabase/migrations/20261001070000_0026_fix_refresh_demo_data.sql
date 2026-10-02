/* 0026 — Dua koreksi pada refresh_demo_data() dari migrasi 0025

   Migrasi 0025 sudah dijalankan sebelum dua cacat ini ditemukan oleh uji.
   Riwayat migrasi dibiarkan apa adanya; koreksinya berdiri sebagai migrasi
   tersendiri agar pemutaran ulang riwayat pada proyek mana pun menghasilkan
   fungsi yang benar.

   CACAT 1 — supplier_price ditolak kunci unik

       ERROR: 23505 duplicate key value violates unique constraint
              "supplier_price_supplier_code_product_id_price_date_key"
       DETAIL: Key (supplier_code, product_id, price_date)=(SUP-003, SAY-0060,
               2026-09-23) already exists.

   Tabel itu memiliki kunci unik (supplier_code, product_id, price_date).
   Menggeser seluruh baris dalam satu perintah ditolak karena Postgres
   memeriksa keunikan per baris: baris yang sudah digeser bertabrakan dengan
   baris yang belum. Solusinya dua langkah lewat offset yang lebih panjang
   daripada rentang riwayat harga mana pun, sehingga himpunan tanggal lama dan
   baru tidak pernah bersinggungan.

   CACAT 2 — nama kolom jejak waktu salah

       ERROR: 42703 column "at" does not exist

   Kolom waktu pada `sales_order_timeline` dan `audit_log` bernama `ts`, bukan
   `at`.

   Selain dua hal itu, isi fungsinya sama dengan 0025.
*/
create or replace function public.refresh_demo_data(p_days integer default null,
                                                    p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_days  integer := coalesce(p_days, demo_shift_days());
  v_maks  date;
  v_inv   integer := 0;
  v_no    text;
begin
  if not p_force and not demo_data_only() then
    raise exception 'Basis data ini tampak berisi data sungguhan, bukan data contoh. '
                    'Pergeseran tanggal dibatalkan. Bila memang disengaja, '
                    'jalankan: select refresh_demo_data(p_force => true);';
  end if;

  if v_days <= 0 then
    return jsonb_build_object('digeser_hari', 0,
      'keterangan', 'Data contoh sudah sejajar dengan hari ini, tidak ada yang digeser.');
  end if;

  /* Batas tahun: nomor dokumen memuat tahun dan tidak boleh berbeda dari
     tanggalnya. */
  select max(d) into v_maks from (
    select max(invoice_date) as d from invoice
    union all select max(delivery_date) from delivery
    union all select max(journal_date)  from journal
    union all select max(po_date)       from purchase_order
    union all select max(delivery_date) from sales_order) x;

  if extract(year from v_maks + v_days) <> extract(year from v_maks) then
    raise exception 'Pergeseran % hari akan melewati batas tahun (% menjadi %). '
                    'Nomor dokumen memuat tahun, sehingga data contoh sebaiknya '
                    'dibuat ulang alih-alih digeser.',
                    v_days, v_maks, v_maks + v_days;
  end if;

  /* --- Penjualan --- */
  update quotation    set quo_date = quo_date + v_days,
                          valid_until = valid_until + v_days;
  update sales_order  set order_date = order_date + v_days,
                          delivery_date = delivery_date + v_days;
  update delivery     set delivery_date = delivery_date + v_days,
                          recv_date = recv_date + v_days;
  update invoice      set invoice_date = invoice_date + v_days,
                          due_date = due_date + v_days;
  update sales_return set return_date = return_date + v_days;
  update credit_note  set cn_date = cn_date + v_days;
  update payment      set pay_date = pay_date + v_days;
  update collection   set due_date = due_date + v_days,
                          promise_date = promise_date + v_days;
  update collection_history set contact_date = contact_date + v_days;

  /* --- Pembelian --- */
  update purchase_order set po_date = po_date + v_days,
                            expected_date = expected_date + v_days;
  update goods_receipt  set grn_date = grn_date + v_days;

  /* KOREKSI 1: dua langkah, agar tidak bertabrakan dengan kunci uniknya. */
  update supplier_price set price_date = price_date + 100000;
  update supplier_price set price_date = price_date - 100000 + v_days;

  /* --- Akuntansi: digeser bersama dokumennya agar tetap seimbang --- */
  update journal set journal_date = journal_date + v_days;

  /* KOREKSI 2: kolomnya bernama ts, bukan at. */
  update sales_order_timeline set ts = ts + make_interval(days => v_days);
  update audit_log             set ts = ts + make_interval(days => v_days);

  /* Status invoice bergantung pada jatuh tempo terhadap hari ini, jadi
     dihitung ulang setelah tanggalnya bergeser. */
  for v_no in select no from invoice loop
    perform refresh_invoice_status(v_no);
    v_inv := v_inv + 1;
  end loop;

  return jsonb_build_object(
    'digeser_hari', v_days,
    'invoice_dihitung_ulang', v_inv,
    'tanggal_terakhir', v_maks + v_days,
    'keterangan', format('Seluruh tanggal dokumen digeser %s hari; '
                         'jarak antar dokumen, umur piutang, dan pembukuan tidak berubah.',
                         v_days));
end $fn$;

revoke all on function public.refresh_demo_data(integer, boolean) from public, anon;
