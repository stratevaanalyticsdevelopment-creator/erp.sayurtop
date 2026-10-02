/* 0019 — Penghitung nomor PO Customer dinaikkan di atas nomor tertinggi yang ada

   Migrasi 0018 menyetel penghitung ke JUMLAH order tiap customer. Data demo
   memakai akhiran acak 4 digit (mis. PO-0008-8426), sehingga setelah cukup
   banyak order baru penghitung bisa mencapai angka yang sudah terpakai dan
   menerbitkan nomor kembar. Penghitung disetel ke akhiran numerik tertinggi
   yang sudah ada, supaya nomor berikutnya pasti belum dipakai. */
insert into doc_counter(prefix, year, seq)
select 'POC-' || customer_code, 0,
       max((regexp_replace(po_no, '^.*-', ''))::int)
  from sales_order
 where po_no ~ '-[0-9]+$'
 group by customer_code
on conflict (prefix, year) do update set seq = greatest(doc_counter.seq, excluded.seq);
