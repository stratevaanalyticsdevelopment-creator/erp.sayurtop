/* =====================================================================
   KEBUTUHAN PEMBELIAN KOSONG — diagnosis dan perbaikan
   =====================================================================

   Jalankan di SQL Editor proyek Supabase yang dipakai aplikasi.
   Hanya membaca, kecuali satu langkah penyegaran tanggal yang dijelaskan
   di bagian 3 — dan langkah itu pun menolak berjalan bila menemukan tanda
   data sungguhan.

   Daftar kebutuhan melewati empat saringan berlapis:

     1. Sales Order harus berstatus APPROVED / PROCESSING / PARTIALLY DELIVERED
     2. masih ada qty yang belum terkirim dan belum dipesan ke supplier
     3. tanggal kirimnya masuk rentang yang dipilih di halaman (bawaan: hari
        ini sampai H+6)
     4. setelah dikurangi stok, masih ada yang perlu dibeli

   Skrip ini menunjukkan di saringan mana barisnya habis.
   ===================================================================== */

-- ---------------------------------------------------------------------
-- 1. Struktur: apakah objek yang dibutuhkan halaman ini ada
-- ---------------------------------------------------------------------
select 'STRUKTUR' as bagian,
       (to_regclass('public.purchase_demand_line_view') is not null) as view_kebutuhan_ada,
       (to_regclass('public.po_line_allocation')        is not null) as tabel_alokasi_ada,
       (to_regprocedure('public.demand_supplier_options(date)') is not null) as fungsi_opsi_supplier_ada,
       (to_regprocedure('public.refresh_demo_data(integer,boolean)') is not null) as fungsi_penyegar_ada;

/* Bila salah satu bernilai false: jalankan setup-susulan.sql lebih dulu.
   Tanpa view itu, halaman Kebutuhan Pembelian akan selalu kosong. */


-- ---------------------------------------------------------------------
-- 2. Isi: di saringan mana barisnya habis
-- ---------------------------------------------------------------------
select 'SALES ORDER' as bagian, status, count(*) as jumlah,
       min(delivery_date) as kirim_paling_awal,
       max(delivery_date) as kirim_paling_akhir
  from sales_order
 group by status
 order by jumlah desc;

/* Yang dihitung sebagai kebutuhan hanya APPROVED, PROCESSING, dan
   PARTIALLY DELIVERED. Order DRAFT atau SUBMITTED harus disetujui dulu
   lewat menu Order Approval. */

select 'SARINGAN' as bagian,
       (select count(*) from sales_order
         where status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED'))
         as sales_order_terbuka,
       (select count(*) from purchase_demand_line_view)
         as baris_kebutuhan_seluruhnya,
       (select count(*) from purchase_demand_line_view
         where delivery_date between today_jkt() and today_jkt() + 6)
         as baris_dalam_rentang_halaman,
       (select count(distinct product_id) from purchase_demand_line_view
         where delivery_date between today_jkt() and today_jkt() + 6)
         as produk_dalam_rentang,
       today_jkt()     as rentang_dari,
       today_jkt() + 6 as rentang_sampai;

/* Cara membacanya:

   sales_order_terbuka = 0
       Tidak ada order yang disetujui. Setujui dulu di Order Approval.

   baris_kebutuhan_seluruhnya = 0 padahal ada order terbuka
       Seluruh order sudah terkirim penuh atau barangnya sudah dipesan.

   baris_kebutuhan_seluruhnya > 0 tetapi baris_dalam_rentang_halaman = 0
       Inilah sebab paling sering: tanggal kirimnya sudah lewat. Lanjut ke
       bagian 3.
*/


-- ---------------------------------------------------------------------
-- 3. Sebab paling sering: tanggal data contoh membeku
-- ---------------------------------------------------------------------

/* Data contoh dibuat sekali lalu tanggalnya tetap, sementara hari ini terus
   maju. Halaman Kebutuhan Pembelian menyaring tanggal kirim hari ini sampai
   H+6, jadi begitu seluruh order terbuka tertinggal di masa lalu, daftarnya
   kosong meski datanya ada.

   Blok di bawah menyegarkannya bila fungsinya tersedia. Fungsi itu menolak
   berjalan bila menemukan tanda data sungguhan — customer di luar pola
   CUST-0000, atau lebih dari 400 dokumen. */
do $segarkan$
declare v_hasil jsonb; v_n int;
begin
  /* Langkah A — geser seluruh tanggal dokumen agar sejajar dengan hari ini. */
  if to_regprocedure('public.refresh_demo_data(integer,boolean)') is null then
    raise notice 'A. Fungsi refresh_demo_data belum ada. Jalankan setup-susulan.sql lebih dulu.';
  else
    begin
      execute 'select refresh_demo_data()' into v_hasil;
      raise notice 'A. Penggeseran tanggal: %', v_hasil;
    exception when others then
      raise notice 'A. Penggeseran dilewati: %', sqlerrm;
    end;
  end if;

  /* Langkah B — sebar ulang tanggal kirim order terbuka ke hari ini s.d. H+3,
     supaya Packaging, Picking List, dan Kebutuhan Pembelian terisi.

     Dipakai versi _cron karena versi biasa memeriksa hak akses lewat rbac(),
     dan di SQL Editor tidak ada sesi pengguna sehingga selalu ditolak. */
  begin
    if to_regprocedure('public.refresh_demo_schedule_cron()') is not null then
      execute 'select refresh_demo_schedule_cron()' into v_n;
      raise notice 'B. Jadwal kirim disegarkan untuk % Sales Order', v_n;
    elsif to_regprocedure('public.refresh_demo_schedule()') is not null then
      execute 'select refresh_demo_schedule()' into v_n;
      raise notice 'B. Jadwal kirim disegarkan untuk % Sales Order', v_n;
    else
      raise notice 'B. Fungsi penyegar jadwal belum ada. Jalankan setup-susulan.sql lebih dulu.';
    end if;
  exception when others then
    raise notice 'B. Penyegaran jadwal dilewati: %', sqlerrm;
  end;
end $segarkan$;


-- ---------------------------------------------------------------------
-- 4. Hasil akhir — baris inilah yang menentukan
-- ---------------------------------------------------------------------
select 'HASIL' as bagian,
       (select count(*) from purchase_demand_line_view
         where delivery_date between today_jkt() and today_jkt() + 6)
         as baris_kebutuhan_di_halaman,
       (select count(distinct product_id) from purchase_demand_line_view
         where delivery_date between today_jkt() and today_jkt() + 6)
         as produk_perlu_dibeli,
       (select count(distinct order_no) from purchase_demand_line_view
         where delivery_date between today_jkt() and today_jkt() + 6)
         as sales_order_menunggu,
       (select count(*) from packing_line_view)   as baris_packaging,
       (select coalesce(sum(debit) - sum(credit), 0) from journal_line) as trial_balance,
       (select count(*) from product where stock < 0) as stok_negatif;

/* baris_kebutuhan_di_halaman lebih dari 0 berarti halaman Purchase Order >
   Kebutuhan Pembelian sudah terisi. Muat ulang halamannya (Ctrl+Shift+R).

   trial_balance harus 0,00 dan stok_negatif harus 0 — penyegaran tanggal
   tidak boleh menggeser angka keuangan mana pun. */
