-- =====================================================================
-- MASTER SUPPLIER + PENYESUAIAN HAK AKSES UNTUK MODUL PEMBELIAN
-- =====================================================================

insert into supplier(code,name,type,pic,phone,address,term_code,bank_name,bank_account) values
('SUP-UMUM','Pasar Induk Kramat Jati (Umum)','Pasar Induk','Bpk. Iwan','0812-9000-0000',
 'Pasar Induk Kramat Jati, Jakarta Timur','COD','-','-'),
('SUP-001','Kelompok Tani Lembang Sejahtera','Petani','Bpk. Dadang','0812-9001-1001',
 'Desa Cikahuripan, Lembang, Bandung Barat','NET7','BRI','003401009988501'),
('SUP-002','Gapoktan Cianjur Makmur','Petani','Bpk. Asep','0812-9002-1002',
 'Kec. Pacet, Cianjur, Jawa Barat','NET7','BRI','003401007766502'),
('SUP-003','UD Berkah Tani Brebes','Pengepul','Ibu Siti','0812-9003-1003',
 'Jl. Raya Pantura KM 12, Brebes, Jawa Tengah','NET14','BCA','778811223'),
('SUP-004','CV Buah Nusantara Jaya','Distributor','Bpk. Handoko','0812-9004-1004',
 'Jl. Gudang Buah No. 7, Jakarta Timur','NET14','Mandiri','1230077665544'),
('SUP-005','Peternakan Telur Sumber Rejeki','Peternak','Bpk. Slamet','0812-9005-1005',
 'Desa Sidorejo, Blitar, Jawa Timur','NET7','BNI','4455667788'),
('SUP-006','Toko Rempah Sari Bumi','Distributor','Ibu Wati','0812-9006-1006',
 'Pasar Senen Blok III, Jakarta Pusat','NET14','BCA','665544332'),
('SUP-007','PT Sembako Prima Distribusi','Distributor','Bpk. Rudi','0812-9007-1007',
 'Kawasan Pergudangan Marunda, Jakarta Utara','NET30','Mandiri','1230099887766');

-- Supplier default per kategori produk, dipakai saat PO dibuat otomatis dari SO.
update product set default_supplier_code = case category
  when 'SAY' then 'SUP-001'
  when 'BUA' then 'SUP-004'
  when 'CAB' then 'SUP-003'
  when 'REM' then 'SUP-006'
  when 'TEL' then 'SUP-005'
  when 'DRY' then 'SUP-007'
  else 'SUP-UMUM' end;

-- Sebagian sayur dipasok Cianjur agar demo memperlihatkan lebih dari satu PO per SO.
update product set default_supplier_code = 'SUP-002'
where category = 'SAY' and (abs(hashtext(id)) % 3) = 0;

-- ---------- Hak akses ----------
-- Menu baru: m.supplier, buy.po, buy.inbound, buy.landed, buy.price
-- ADMIN dan AUDITOR memakai '*' sehingga otomatis ikut.

update app_role set menus = menus || '["m.supplier","buy.po","buy.inbound","buy.landed","buy.price"]'::jsonb
where code = 'WHOUSE';

update app_role set menus = menus || '["m.supplier","buy.po","buy.inbound","buy.landed","buy.price"]'::jsonb
where code = 'FINANCE';

update app_role set menus = menus || '["buy.po","buy.price"]'::jsonb
where code = 'MGMT';

-- Role baru khusus pembelian.
insert into app_role(code,name,description,menus,acts) values
('PURCH','Purchasing','Pengadaan barang: PO ke supplier, penerimaan barang, dan landed cost.',
 '["dashboard","buy.po","buy.inbound","buy.landed","buy.price","m.supplier","m.product","m.warehouse","sales.order","log.receipt"]',
 '["view","create","edit","print","export"]')
on conflict (code) do nothing;
