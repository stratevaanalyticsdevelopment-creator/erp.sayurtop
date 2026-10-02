/* 0022 — Penyegaran jadwal kirim data contoh

   Halaman Picking List dan Packaging hanya menampilkan order terbuka dalam
   rentang tanggal kirim (bawaan: hari ini sampai H+6). Migrasi 0017 menyebar
   tanggal kirim order terbuka satu kali saja, relatif terhadap tanggal migrasi
   itu dijalankan. Akibatnya jadwalnya membeku: setiap hari berlalu, makin
   banyak order jatuh ke masa lalu dan hilang dari kedua halaman, sampai
   akhirnya kosong sama sekali.

   Versi HTML tidak mengalami ini karena menjadwalkan ulang setiap kali data
   contohnya dibuat di peramban. Fungsi di bawah menyamakan perilakunya di
   sisi basis data, dan boleh dijalankan ulang kapan saja.

   Aman terhadap pembukuan: yang diubah hanya kolom delivery_date pada Sales
   Order yang belum selesai. Tanggal dokumen yang sudah terbit — Surat Jalan,
   Invoice, jurnal — tidak disentuh sama sekali, jadi tidak ada angka keuangan
   yang bergeser.
*/
create or replace function public.refresh_demo_schedule()
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n integer;
begin
  if not rbac('sales.order','edit') then
    raise exception 'Tidak memiliki hak mengubah Sales Order'; end if;

  with k as (
    select o.no, row_number() over (order by o.delivery_date, o.no) as rn
      from sales_order o
     where o.status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED'))
  update sales_order o
     set delivery_date = today_jkt() + (((k.rn - 1) % 4))::int
    from k
   where k.no = o.no;

  get diagnostics v_n = row_count;
  perform write_audit('SEGARKAN JADWAL DEMO', '-', 'delivery_date', '-',
    v_n || ' Sales Order disebar ke ' || today_jkt() || ' s/d ' || (today_jkt() + 3));
  return v_n;
end $fn$;

grant execute on function public.refresh_demo_schedule() to authenticated;

-- Dijalankan sekali agar jadwalnya langsung segar.
do $once$
begin
  with k as (
    select o.no, row_number() over (order by o.delivery_date, o.no) as rn
      from sales_order o
     where o.status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED'))
  update sales_order o
     set delivery_date = (now() at time zone 'Asia/Jakarta')::date + (((k.rn - 1) % 4))::int
    from k
   where k.no = o.no;
end $once$;
