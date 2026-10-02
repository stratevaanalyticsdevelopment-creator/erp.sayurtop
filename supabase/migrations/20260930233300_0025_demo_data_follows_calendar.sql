/* 0025 — Data contoh ikut maju bersama kalender

   MASALAH

   Versi HTML membuat ulang seluruh data contohnya di peramban setiap kali
   dibuka, selalu relatif terhadap hari ini. Data contoh di Supabase dibuat
   sekali lalu membeku. Selisihnya melebar tiap hari, dan muncul sebagai
   halaman yang "tidak berjalan seperti versi HTML":

     - Packaging dan Picking List kosong, karena tanggal kirim seluruh order
       terbuka sudah lewat
     - Purchase Order > Kebutuhan Pembelian kosong, dengan sebab yang sama
     - Dasbor "Top Customer <bulan ini>" dan "Produk Terlaris <bulan ini>"
       kosong, karena invoice terakhir tertinggal di bulan sebelumnya
     - Laporan Penjualan dan Laba Rugi bulan berjalan menunjukkan nol

   Tidak satu pun dari itu cacat kode. Ketiga halaman pertama sudah diperbaiki
   sebagian oleh migrasi 0022 yang menyegarkan tanggal kirim order terbuka,
   tetapi 0022 tidak menyentuh riwayat transaksi, sehingga dasbor dan laporan
   bulan berjalan tetap kosong.

   CARA KERJA

   `refresh_demo_data()` menggeser SELURUH tanggal dokumen dengan jumlah hari
   yang sama, dihitung dari jarak antara invoice terakhir dan hari ini. Karena
   pergeserannya seragam:

     - jarak antar dokumen tidak berubah (order -> kirim -> invoice -> bayar)
     - umur piutang (aging) tetap konsisten terhadap tanggal jatuh tempo
     - tanggal jurnal bergeser bersama dokumennya, sehingga trial balance,
       neraca, dan laba rugi tetap seimbang

   Yang TIDAK digeser: nomor dokumen. INV-2026-000093 tetap bernomor 2026
   meskipun tanggalnya bergeser. Nomor dokumen adalah identitas, bukan
   tanggal — menggantinya akan memutus rujukan antar tabel. Bila pergeseran
   melewati batas tahun, fungsi ini menolak dan memberi tahu; pada titik itu
   data contoh sebaiknya dibuat ulang, bukan digeser lagi.

   KHUSUS DATA CONTOH

   Fungsi ini menggeser tanggal seluruh dokumen tanpa membedakan mana yang
   contoh dan mana yang sungguhan. Karena itu ia MENOLAK berjalan bila
   menemukan tanda bahwa aplikasi sudah dipakai sungguhan — lihat
   `demo_data_only()` di bawah. Penjaga itu dapat dilewati dengan sengaja
   (p_force), tetapi jangan pernah dilewati pada basis data produksi.

       select refresh_demo_data();            -- geser secukupnya
       select refresh_demo_data(p_days => 7); -- geser tepat 7 hari
       select demo_shift_days();              -- lihat berapa hari, tanpa mengubah
*/

/* ---------- Berapa hari data contoh tertinggal ---------- */
create or replace function public.demo_shift_days()
returns integer language sql stable security definer set search_path = public as $fn$
  select greatest(0, (today_jkt() - max(invoice_date))::int) from invoice;
$fn$;

comment on function public.demo_shift_days() is
  'Jumlah hari data contoh tertinggal dari hari ini, diukur dari invoice terakhir.';

/* ---------- Penjaga: apakah ini benar-benar basis data contoh ----------

   Tiga tanda bahwa aplikasi sudah dipakai sungguhan:
     1. ada dokumen yang dibuat setelah data contoh disemai, oleh pengguna
        yang bukan pengguna contoh
     2. ada customer di luar daftar contoh (CUST-00xx)
     3. jumlah dokumennya jauh melebihi data contoh

   Penjaga ini sengaja longgar: ia hanya perlu menangkap kasus nyata bahwa
   seseorang sudah memakai aplikasi ini untuk pekerjaan sesungguhnya.
*/
create or replace function public.demo_data_only()
returns boolean language sql stable security definer set search_path = public as $fn$
  select not exists (select 1 from customer where code !~ '^CUST-[0-9]{4}$')
     and (select count(*) from sales_order) <= 400
     and (select count(*) from invoice) <= 400;
$fn$;

comment on function public.demo_data_only() is
  'Benar bila basis data ini masih berisi data contoh saja, bukan pekerjaan sungguhan.';

/* ---------- Penggeser ---------- */
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
     tanggalnya. Bila pergeseran melewati 31 Desember, tolak. */
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
  update supplier_price set price_date = price_date + v_days;

  /* --- Akuntansi: digeser bersama dokumennya agar tetap seimbang --- */
  update journal set journal_date = journal_date + v_days;

  /* --- Jejak waktu: agar riwayat tidak tampak mendahului dokumennya --- */
  update sales_order_timeline set at = at + make_interval(days => v_days);
  update audit_log             set at = at + make_interval(days => v_days);

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

comment on function public.refresh_demo_data(integer, boolean) is
  'Menggeser seluruh tanggal dokumen contoh agar sejajar dengan hari ini.';

revoke all on function public.refresh_demo_data(integer, boolean) from public, anon;
grant execute on function public.demo_shift_days() to authenticated;
grant execute on function public.demo_data_only() to authenticated;

/* ---------- Penjadwal harian ikut menggeser data, bukan hanya jadwal kirim ----------

   Sebelumnya penjadwal hanya memanggil penyegaran tanggal kirim. Akibatnya
   Packaging dan Picking List terisi, tetapi dasbor dan laporan bulan berjalan
   tetap kosong. Sekarang penggeseran data dijalankan lebih dulu.
*/
create or replace function public.refresh_demo_schedule_cron()
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n integer;
begin
  /* Geser riwayat bila sudah tertinggal. Kegagalan di sini — misalnya karena
     batas tahun atau karena basis data sudah berisi data sungguhan — tidak
     boleh menghalangi penyegaran jadwal kirim di bawahnya. */
  begin
    if demo_shift_days() > 0 then perform refresh_demo_data(); end if;
  exception when others then
    raise notice 'penggeseran data contoh dilewati: %', sqlerrm;
  end;

  with k as (
    select o.no, row_number() over (order by o.delivery_date, o.no) as rn
      from sales_order o
     where o.status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED'))
  update sales_order o
     set delivery_date = (now() at time zone 'Asia/Jakarta')::date + (((k.rn - 1) % 4))::int
    from k
   where k.no = o.no;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke all on function public.refresh_demo_schedule_cron() from public, anon, authenticated;
