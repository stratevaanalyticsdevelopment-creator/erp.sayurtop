/* 0023 — Penyegaran jadwal data contoh berjalan otomatis tiap hari

   Migrasi 0022 menyediakan refresh_demo_schedule(), tapi harus dipanggil
   manual. Tanpa penjadwal, jadwal kirim kembali membeku dan dalam beberapa
   hari Picking List serta Packaging mengosong lagi.

   pg_cron menjalankannya sekali tiap hari pukul 01:00 waktu Jakarta
   (18:00 UTC hari sebelumnya).

   Yang disentuh hanya kolom delivery_date pada Sales Order yang belum
   selesai. Surat Jalan, Invoice, dan jurnal tidak ikut berubah, jadi tidak
   ada angka keuangan yang bergeser oleh penjadwal ini.

   Mematikannya:  select cron.unschedule('segarkan-jadwal-demo');
   Menyalakan lagi: jalankan ulang blok cron.schedule di bawah.
*/
create extension if not exists pg_cron;

-- Versi tanpa pemeriksaan hak akses, khusus dipanggil penjadwal.
-- pg_cron berjalan tanpa sesi pengguna, sehingga rbac() tidak dapat dipakai.
create or replace function public.refresh_demo_schedule_cron()
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n integer;
begin
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

do $sched$
begin
  perform cron.unschedule('segarkan-jadwal-demo');
exception when others then null;   -- belum pernah dijadwalkan
end $sched$;

select cron.schedule('segarkan-jadwal-demo', '0 18 * * *',
                     $job$select public.refresh_demo_schedule_cron();$job$);
