/* 0027 — Menutup akses RPC tanpa login

   TEMUAN

   Supabase Security Advisor melaporkan 40 fungsi `SECURITY DEFINER` yang dapat
   dipanggil oleh peran `anon`, yaitu tanpa login sama sekali, lewat
   `/rest/v1/rpc/<nama>`. Kunci anon memang bersifat publik — ia tertanam di
   bundel JavaScript aplikasi yang terbit, sehingga siapa pun yang membuka
   situsnya memilikinya.

   Sebagian besar fungsi itu sebenarnya terlindungi oleh penjaganya sendiri:
   `rbac(menu, aksi)` menolak bila `auth.uid()` tidak cocok dengan pengguna
   aktif, dan `auth.uid()` bernilai null untuk anon. Tetapi empat fungsi yang
   MENULIS tidak memiliki penjaga itu:

       post_journal(...)          -> menyisipkan jurnal
       void_journals_for(ref)     -> membatalkan jurnal
       refresh_base_price(grn)    -> mengubah harga pokok produk
       refresh_invoice_status(no) -> mengubah status invoice

   Ditambah dua lagi yang bisa dipakai untuk merusak jejak dan penomoran:

       write_audit(...)           -> memalsukan baris audit
       next_doc_no(prefix)        -> menghabiskan nomor dokumen

   Artinya, dengan kunci yang terbuka itu, seseorang dapat menyuntikkan jurnal
   ke dalam pembukuan tanpa pernah login. Itu cacat keamanan, bukan sekadar
   peringatan linter.

   PERBAIKAN

   Aplikasi tidak memanggil satu pun RPC sebelum login — proses masuk memakai
   Supabase Auth (`auth.signInWithPassword`), bukan RPC di skema public. Karena
   itu hak EXECUTE peran `anon` dicabut dari SELURUH fungsi di skema public.
   Hak peran `authenticated` tidak diubah, sehingga tidak ada alur aplikasi
   yang terganggu.

   Pencabutan ini menutup celahnya untuk setiap fungsi sekaligus, termasuk
   fungsi yang ditambahkan kemudian — baris terakhir di bawah juga mengubah
   hak bawaan agar fungsi baru tidak otomatis terbuka untuk anon lagi.

   YANG MASIH TERBUKA, DAN PERLU KEPUTUSAN ANDA

   `post_journal`, `next_doc_no`, dan `write_audit` dipanggil langsung oleh
   aplikasi sebagai pengguna yang sudah login, dan ketiganya tidak memiliki
   penjaga `rbac()`. Jadi pengguna mana pun yang sudah masuk — termasuk peran
   Sales — secara teknis masih dapat memanggilnya langsung. Menambahkan penjaga
   `rbac('acc.journal','create')` pada `post_journal` akan menutup itu, tetapi
   juga akan menolak alur yang sah: saat seorang Sales membuat invoice,
   `post_journal` ikut terpanggil sementara ia tidak punya hak akuntansi.
   Memperbaikinya dengan benar berarti memindahkan pembuatan jurnal ke dalam
   fungsi pemanggilnya, sehingga tidak lagi perlu dipanggil dari klien.
   Perubahan itu tidak dilakukan di sini karena menyentuh alur pembukuan dan
   sebaiknya diputuskan lebih dulu.
*/

/* ---------- Cabut hak anon dari seluruh fungsi di skema public ----------

   Catatan penting: `revoke ... from anon` saja TIDAK cukup, dan pernah membuat
   perbaikan ini tampak berhasil padahal tidak. Postgres memberikan EXECUTE
   kepada `PUBLIC` secara bawaan pada setiap fungsi baru, dan `anon` mewarisi
   hak itu sebagai anggota PUBLIC — bukan lewat pemberian langsung. Jadi yang
   harus dicabut adalah hak PUBLIC-nya.

   Karena `authenticated` juga mewarisi dari PUBLIC, hak itu diberikan kembali
   secara eksplisit di langkah yang sama, sehingga akses pengguna yang sudah
   login tidak berubah sedikit pun.

   `handle_new_auth_user()` dikecualikan: ia fungsi trigger pada auth.users yang
   dijalankan oleh peran internal Supabase saat pengguna dibuat. Mencabut hak
   PUBLIC darinya berisiko menggagalkan pembuatan pengguna, sementara
   memanggilnya lewat RPC tidak berguna bagi penyerang — ia mengembalikan tipe
   trigger dan langsung gagal di luar konteks trigger.
*/
do $cabut$
declare r record; v_n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname <> 'handle_new_auth_user'
       and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
    v_n := v_n + 1;
  end loop;
  raise notice 'hak PUBLIC dicabut dan hak authenticated ditegaskan pada % fungsi', v_n;
end $cabut$;

/* Fungsi yang dibuat kemudian tidak lagi otomatis terbuka untuk anon. */
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

/* ---------- search_path yang tetap untuk today_jkt ----------

   Peringatan kedua dari advisor: fungsi tanpa `set search_path` dapat
   terpengaruh oleh search_path pemanggilnya. Pada fungsi SECURITY DEFINER itu
   jalur serangan klasik — objek bernama sama di skema lain bisa dipakai
   mendahului objek yang dimaksud.
*/
create or replace function public.today_jkt()
returns date language sql stable security definer set search_path = public as $fn$
  select (now() at time zone 'Asia/Jakarta')::date;
$fn$;

/* today_jkt dibuat ulang di atas, jadi hak bawaannya ikut baru — tegaskan lagi. */
revoke execute on function public.today_jkt() from public, anon;
grant  execute on function public.today_jkt() to authenticated, service_role;

/* ---------- Pemeriksaan hasil ----------

   Baris pertama harus nol selain handle_new_auth_user. Baris kedua harus tetap
   mencakup seluruh fungsi yang dipakai aplikasi.
*/
select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))
         as masih_terbuka_untuk_anon,
       count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         as boleh_untuk_pengguna_login,
       count(*) as total_fungsi
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.prokind = 'f';
