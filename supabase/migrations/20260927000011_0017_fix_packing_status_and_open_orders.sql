/* 0017 — Perbaikan status pada packing_line_view, dan order terbuka untuk demo

   1. BUG: packing_line_view memakai status 'PARTIAL', padahal nilai yang
      dipakai aplikasi adalah 'PARTIALLY DELIVERED' (lihat ST.PARTIAL).
      Akibatnya order yang terkirim sebagian tidak muncul di halaman
      Packaging, padahal justru order itu yang paling perlu disiapkan.

   2. DATA DEMO: hanya ada 1 order berstatus APPROVED dan 2 PARTIALLY
      DELIVERED, semuanya dengan tanggal kirim yang sudah lewat, sehingga
      halaman Packaging tampak kosong. Sebagian order DRAFT dan SUBMITTED
      disetujui dan tanggal kirimnya disebar beberapa hari ke depan agar
      halaman ini memperlihatkan keadaan yang wajar untuk distributor sayur.

      Aman terhadap laporan keuangan: order berstatus APPROVED belum
      menerbitkan Surat Jalan maupun faktur, jadi tidak ada jurnal yang
      dibuat, diubah, atau dipindahkan. */

create or replace view packing_line_view as
with terkirim as (
  select dl.product_id, d.order_no, sum(dl.qty) as qty_sj
    from delivery_line dl
    join delivery d on d.no = dl.delivery_no and d.status <> 'CANCELLED'
   group by 1, 2)
select o.no                as order_no,
       o.delivery_date,
       o.customer_code,
       c.name              as customer_name,
       c.type              as customer_type,
       c.shipping_address,
       o.warehouse_code,
       o.status            as order_status,
       sl.product_id,
       pr.name             as product_name,
       pr.category,
       pr.category_name,
       pr.unit,
       pr.pack_size,
       pr.pack_unit,
       pr.stock,
       sl.qty              as qty_order,
       coalesce(t.qty_sj, 0) as qty_delivered,
       sl.qty - coalesce(t.qty_sj, 0) as qty_outstanding,
       case when pr.pack_size > 0
            then floor((sl.qty - coalesce(t.qty_sj, 0)) / pr.pack_size)
            else 0 end     as koli_penuh,
       case when pr.pack_size > 0
            then (sl.qty - coalesce(t.qty_sj, 0)) - floor((sl.qty - coalesce(t.qty_sj, 0)) / pr.pack_size) * pr.pack_size
            else sl.qty - coalesce(t.qty_sj, 0) end as qty_sisa
  from sales_order o
  join sales_order_line sl on sl.order_no = o.no
  join product pr on pr.id = sl.product_id
  join customer c on c.code = o.customer_code
  left join terkirim t on t.product_id = sl.product_id and t.order_no = o.no
 where o.status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED')
   and sl.qty - coalesce(t.qty_sj, 0) > 0;

grant select on packing_line_view to authenticated;

/* Order DRAFT dan SUBMITTED disetujui, tanggal kirim disebar H+0 sampai H+3. */
with kandidat as (
  select no, row_number() over (order by order_date desc) as rn
    from sales_order where status in ('DRAFT','SUBMITTED'))
update sales_order o
   set status = 'APPROVED',
       delivery_date = current_date + (((k.rn - 1) % 4))::int
  from kandidat k
 where k.no = o.no;

/* Order terbuka yang tanggal kirimnya sudah lewat digeser ke hari ini dan
   besok supaya tidak seluruhnya tampil sebagai keterlambatan. */
with lama as (
  select no, row_number() over (order by delivery_date) as rn
    from sales_order
   where status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED')
     and delivery_date < current_date)
update sales_order o
   set delivery_date = current_date + (((l.rn - 1) % 2))::int
  from lama l
 where l.no = o.no;
