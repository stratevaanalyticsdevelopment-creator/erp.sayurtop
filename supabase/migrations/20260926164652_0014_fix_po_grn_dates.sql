/* 0014 — Perbaikan tanggal Purchase Order dan penerimaan barang (data demo)

   Seluruh 112 PO dan 93 GRN tercatat pada satu tanggal yang sama (tanggal
   migrasi 0010 dijalankan), padahal Sales Order-nya tersebar Juni–September.
   Akibatnya: Harga Beli Harian hanya berisi satu hari, filter tanggal pada
   modul pembelian tidak berarti, dan riwayat harga supplier ikut menumpuk.

   Perbaikan: PO memakai tanggal Sales Order sumbernya, GRN sehari setelah PO
   (tidak melewati tanggal kirim SO maupun hari ini). Jurnal GRN dipindahkan
   ke tanggal GRN yang baru.

   Aman terhadap laporan keuangan: jurnal GRN hanya menyentuh akun neraca
   (Persediaan, Kas & Bank, Utang Supplier), tidak ada akun laba-rugi, jadi
   laba-rugi periode mana pun tidak berubah. Neraca per hari ini juga tidak
   berubah karena seluruh tanggal baru tetap <= hari ini. */

-- 1. Tanggal PO mengikuti Sales Order sumbernya
update purchase_order p
   set po_date = o.order_date,
       expected_date = coalesce(o.delivery_date - 1, o.order_date)
  from sales_order o
 where o.no = p.order_no;

-- 2. Tanggal GRN sehari setelah PO, tidak melewati tanggal kirim atau hari ini
update goods_receipt g
   set grn_date = least(
         p.po_date + 1,
         coalesce((select o.delivery_date from sales_order o where o.no = p.order_no), p.po_date + 1),
         current_date)
  from purchase_order p
 where p.no = g.po_no;

-- GRN tidak boleh mendahului PO-nya
update goods_receipt g set grn_date = p.po_date
  from purchase_order p where p.no = g.po_no and g.grn_date < p.po_date;

-- 3. Jurnal GRN ikut pindah ke tanggal GRN
update journal j set journal_date = g.grn_date
  from goods_receipt g where g.journal_no = j.no;

-- 4. Riwayat harga supplier yang berasal dari PO diisi ulang pada tanggal yang benar
delete from supplier_price where note = 'Diisi otomatis dari harga PO';

insert into supplier_price(supplier_code, product_id, price_date, price, source, note)
select po.supplier_code, l.product_id, po.po_date,
       round(sum(l.price * l.qty) / nullif(sum(l.qty), 0), 2),
       'GRN', 'Diisi otomatis dari harga PO'
  from purchase_order_line l
  join purchase_order po on po.no = l.po_no
 where po.status <> 'CANCELLED'
 group by po.supplier_code, l.product_id, po.po_date
having sum(l.qty) > 0
on conflict (supplier_code, product_id, price_date) do nothing;

-- 5. Harga PO sebelumnya dihitung ulang memakai urutan tanggal yang benar
with prev as (
  select l.id,
         lag(l.price) over (partition by p.supplier_code, l.product_id
                            order by p.po_date, p.no) as prev_price,
         lag(p.no)    over (partition by p.supplier_code, l.product_id
                            order by p.po_date, p.no) as prev_po_no
    from purchase_order_line l
    join purchase_order p on p.no = l.po_no
   where p.status <> 'CANCELLED')
update purchase_order_line l
   set prev_price = prev.prev_price, prev_po_no = prev.prev_po_no
  from prev where prev.id = l.id;