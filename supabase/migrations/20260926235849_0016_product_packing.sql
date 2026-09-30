/* 0016 — Isi per kemasan pada master produk, untuk halaman Packaging

   Gudang menyiapkan barang per produk lalu memecahnya per customer. Supaya
   jumlah koli bisa dihitung, master produk perlu tahu isi satu kemasan:

     pack_size  isi satu kemasan dalam satuan produk (10 Kg per Peti)
     pack_unit  nama kemasannya (Peti, Karton, Karung, Krat, Pack, Ikat)

   pack_size = 0 berarti produk tidak dikemas dalam satuan tetap dan
   ditimbang lepas; halaman Packaging menandainya sebagai "lepas".

   Catatan penting soal cara menghitung koli: koli dihitung PER CUSTOMER,
   bukan dari total qty seluruh customer. Sepuluh kilo untuk dua customer
   berbeda tetap menjadi dua kemasan, bukan satu, karena barangnya tidak
   boleh tercampur. */

alter table product
  add column if not exists pack_size numeric(12,2) not null default 0,
  add column if not exists pack_unit text;

comment on column product.pack_size is
  'Isi satu kemasan dalam satuan produk. 0 = ditimbang lepas, tanpa kemasan tetap.';
comment on column product.pack_unit is
  'Nama kemasan: Peti, Karton, Karung, Krat, Pack, Ikat.';

/* ---------- DATA DEMO: isi kemasan per kategori dan satuan ----------
   Angka mengikuti kebiasaan distributor sayur: sayur daun per peti 10 kg,
   cabe dan bawang per karung 25 kg, buah per karton 12 kg, rempah per pack
   5 kg, telur per peti 15 kg, dry goods per karton 12 pack. Produk dengan
   satuan Pcs dibiarkan lepas. */
update product set pack_unit = 'Peti',   pack_size = 10 where category = 'SAY' and unit = 'Kg';
update product set pack_unit = 'Karton', pack_size = 24 where category = 'SAY' and unit = 'Pack';
update product set pack_unit = 'Karung', pack_size = 25 where category = 'CAB';
update product set pack_unit = 'Karton', pack_size = 12 where category = 'BUA' and unit = 'Kg';
update product set pack_unit = 'Karton', pack_size = 20 where category = 'BUA' and unit = 'Pack';
update product set pack_unit = 'Pack',   pack_size = 5  where category = 'REM';
update product set pack_unit = 'Peti',   pack_size = 15 where category = 'TEL' and unit = 'Kg';
update product set pack_unit = 'Peti',   pack_size = 10 where category = 'TEL' and unit = 'Pack';
update product set pack_unit = 'Karton', pack_size = 12 where category = 'DRY' and unit = 'Pack';
update product set pack_unit = null,     pack_size = 0  where unit = 'Pcs';

/* ---------- VIEW: baris packing per customer ----------
   Sisa qty yang belum dikirim dari Sales Order yang sudah disetujui, satu
   baris per produk + customer + SO, lengkap dengan hitungan koli.

   qty_outstanding dihitung sama dengan Picking List: qty SO dikurangi qty
   yang sudah keluar lewat Surat Jalan yang tidak dibatalkan. */
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
 where o.status in ('APPROVED','PROCESSING','PARTIAL')
   and sl.qty - coalesce(t.qty_sj, 0) > 0;

grant select on packing_line_view to authenticated;

/* Menu baru log.packaging untuk role yang mengurus gudang dan pengiriman. */
update app_role set menus = menus || '["log.packaging"]'::jsonb
 where code in ('WHOUSE','SALES','SLSMGR','FINANCE','MGMT')
   and menus::text <> '"*"'
   and not (menus ? 'log.packaging');
