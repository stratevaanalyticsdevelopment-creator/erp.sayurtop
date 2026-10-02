insert into coa(code,name,type,group_name,normal) values
('1110','Kas & Bank','ASSET','Aset Lancar','D'),
('1200','Piutang Usaha','ASSET','Aset Lancar','D'),
('1290','Cadangan Kerugian Piutang','ASSET','Aset Lancar','C'),
('1300','Persediaan Barang Dagang','ASSET','Aset Lancar','D'),
('1400','Biaya Dibayar di Muka','ASSET','Aset Lancar','D'),
('1500','Aset Tetap','ASSET','Aset Tidak Lancar','D'),
('1590','Akumulasi Penyusutan','ASSET','Aset Tidak Lancar','C'),
('2100','Utang Usaha','LIAB','Kewajiban Lancar','C'),
('2200','PPN Keluaran','LIAB','Kewajiban Lancar','C'),
('2300','Beban Yang Masih Harus Dibayar','LIAB','Kewajiban Lancar','C'),
('2400','Uang Muka Pelanggan','LIAB','Kewajiban Lancar','C'),
('3100','Modal Disetor','EQUITY','Ekuitas','C'),
('3200','Laba Ditahan','EQUITY','Ekuitas','C'),
('4100','Penjualan Barang','REVENUE','Pendapatan','C'),
('4200','Retur Penjualan','REVENUE','Pendapatan','D'),
('4300','Diskon Penjualan','REVENUE','Pendapatan','D'),
('5100','Harga Pokok Penjualan','COGS','HPP','D'),
('6100','Beban Gaji & Upah','EXPENSE','Beban Operasional','D'),
('6200','Beban Sewa','EXPENSE','Beban Operasional','D'),
('6300','Beban Transportasi & BBM','EXPENSE','Beban Operasional','D'),
('6400','Beban Packaging & Sortir','EXPENSE','Beban Operasional','D'),
('6500','Beban Listrik & Pendingin','EXPENSE','Beban Operasional','D'),
('6600','Beban Penyusutan','EXPENSE','Beban Operasional','D'),
('6900','Beban Lain-lain','EXPENSE','Beban Operasional','D');

insert into payment_term(code,name,days) values
('COD','Cash on Delivery',0),('NET7','Net 7 Hari',7),('NET14','Net 14 Hari',14),
('NET30','Net 30 Hari',30),('NET45','Net 45 Hari',45);

insert into tax(code,name,rate,account_code) values
('PPN11','PPN Keluaran 11%',11,'2200'),('NONPPN','Non PPN',0,null);

insert into bank_account(code,name,account_no,holder,coa_code) values
('BCA-01','Bank BCA','2103366778','CV Sayur Top Nusantara','1110'),
('MDR-01','Bank Mandiri','1230098877665','CV Sayur Top Nusantara','1110'),
('CASH-01','Kas Besar','-','-','1110');

insert into warehouse(code,name,addr,pic) values
('WH-JKT','Gudang Pasar Induk Kramat Jati','Jl. Raya Pasar Induk Kramat Jati No. 88, Jakarta Timur','Bpk. Sukir'),
('WH-BKS','Gudang Transit Bekasi','Jl. Industri Raya Blok D5, Bekasi','Bpk. Darmo');

insert into salesperson(code,name,area,target,phone) values
('SLS-01','Budi Santoso','Jakarta Pusat & Selatan',1400000000,'0812-1000-0001'),
('SLS-02','Rina Marlina','Jakarta Utara & Barat',1300000000,'0812-1000-0002'),
('SLS-03','Agus Prasetyo','Bekasi, Tangerang, Depok',1000000000,'0812-1000-0003');

insert into vehicle(code,type,capacity) values
('B 9812 KCE','Truk Box Pendingin 4 Roda','2.000 Kg'),
('B 9345 UFM','Truk Box Pendingin 4 Roda','2.000 Kg'),
('B 2290 TQL','Pickup Box','1.000 Kg');

insert into driver(code,name,sim,phone,vehicle_code) values
('DRV-01','Slamet Riyadi','B1 Umum','0857-2200-1100','B 9812 KCE'),
('DRV-02','Joko Susilo','B1 Umum','0857-2200-2200','B 9345 UFM'),
('DRV-03','Rahmat Hidayat','A Umum','0857-2200-3300','B 2290 TQL');

insert into customer(code,name,type,npwp,credit_limit,term_code,salesperson_code,wa,email,pic,billing_address,shipping_address) values
('CUST-0001','Hotel Grand Meridien Jakarta','Hotel','01.223.445.6-021.000',350000000,'NET30','SLS-01','0812-1100-2201','purchasing@grandmeridien.co.id','Ibu Ratna (Purchasing)','Jl. MH Thamrin No. 12, Jakarta Pusat 10230','Loading Dock B, Jl. MH Thamrin No. 12, Jakarta Pusat'),
('CUST-0002','PT Boga Rasa Catering','Katering','02.331.887.2-013.000',250000000,'NET30','SLS-01','0811-9822-3311','proc@bogarasa.id','Bpk. Hendra (Procurement)','Jl. Sudirman Kav. 45, Jakarta Selatan 12190','Central Kitchen, Jl. Warung Buncit Raya No. 7, Jakarta Selatan'),
('CUST-0003','Resto Nusantara Kemang','Restoran','03.114.552.8-017.000',90000000,'NET14','SLS-02','0813-5500-1188','andri@restonusantara.com','Chef Andri','Jl. Kemang Raya No. 21, Jakarta Selatan 12730','Jl. Kemang Raya No. 21, Jakarta Selatan 12730'),
('CUST-0004','Fresh Mart Supermarket','Retail','04.667.221.0-045.000',420000000,'NET45','SLS-02','0812-7788-9900','buyer.fresh@freshmart.co.id','Ibu Melati (Fresh Buyer)','Jl. Boulevard Raya Blok M No. 3, Jakarta Utara 14240','Gudang DC Fresh Mart, Jl. Yos Sudarso KM 8, Jakarta Utara'),
('CUST-0005','Dapur Sehat Cloud Kitchen','Cloud Kitchen','05.229.118.4-009.000',60000000,'NET7','SLS-03','0857-1122-7788','ops@dapursehat.id','Ibu Sari','Ruko Green Park Blok C2, Jakarta Barat 11520','Ruko Green Park Blok C2, Jakarta Barat 11520'),
('CUST-0006','Hotel Santika Bekasi','Hotel','06.881.334.7-402.000',180000000,'NET30','SLS-03','0811-3344-5566','cc@santikabekasi.com','Bpk. Wawan (Cost Control)','Jl. Ahmad Yani No. 99, Bekasi 17141','Receiving Area, Jl. Ahmad Yani No. 99, Bekasi 17141'),
('CUST-0007','Warung Padang Sederhana Group','Restoran','07.445.990.1-006.000',75000000,'NET14','SLS-01','0812-3399-4455','zul@padangsederhana.id','Bpk. Zul','Jl. Fatmawati No. 55, Jakarta Selatan 12430','Jl. Fatmawati No. 55, Jakarta Selatan 12430'),
('CUST-0008','PT Aero Catering Service','Katering','08.552.774.3-054.000',500000000,'NET45','SLS-02','0811-8080-2020','sc@aerocatering.co.id','Ibu Dewi (Supply Chain)','Area Perkantoran Bandara Soekarno-Hatta, Tangerang 15126','Gudang ACS Gate 3, Bandara Soekarno-Hatta, Tangerang'),
('CUST-0009','Kafe Kopi Kita','Kafe','-',25000000,'COD','SLS-03','0895-6677-8899','tia@kopikita.id','Mbak Tia','Jl. Panglima Polim IX No. 4, Jakarta Selatan 12160','Jl. Panglima Polim IX No. 4, Jakarta Selatan 12160'),
('CUST-0010','RS Harapan Bunda — Instalasi Gizi','Institusi','09.773.226.5-031.000',150000000,'NET30','SLS-01','0812-4455-6677','gizi@rsharapanbunda.co.id','Ibu Nur (Ahli Gizi)','Jl. Raya Bogor KM 22, Jakarta Timur 13830','Instalasi Gizi Lt. 1, Jl. Raya Bogor KM 22, Jakarta Timur'),
('CUST-0011','Sekolah Global Mandiri (Kantin)','Institusi','-',40000000,'NET14','SLS-03','0813-2211-3344','kantin@globalmandiri.sch.id','Bpk. Toni','Jl. Cibubur Raya No. 1, Jakarta Timur 13720','Kantin Sekolah, Jl. Cibubur Raya No. 1, Jakarta Timur'),
('CUST-0012','Bistro Eropa Senopati','Restoran','10.336.558.9-012.000',110000000,'NET14','SLS-02','0878-9900-1122','marco@bistroeropa.com','Chef Marco','Jl. Senopati No. 78, Jakarta Selatan 12110','Jl. Senopati No. 78, Jakarta Selatan 12110');

insert into app_role(code,name,description,menus,acts) values
('ADMIN','Administrator','Akses penuh seluruh modul dan konfigurasi sistem.','"*"','"*"'),
('SALES','Sales','Membuat quotation dan sales order, tidak dapat approve.',
 '["dashboard","sales.quotation","sales.order","sales.return","m.customer","m.product","rep.sales","ar.outstanding"]',
 '["view","create","edit","print","export"]'),
('SLSMGR','Sales Manager','Approval sales order, diskon, dan credit limit.',
 '["dashboard","sales.quotation","sales.order","sales.approval","sales.return","m.customer","m.product","rep.sales","ar.aging","ar.outstanding"]',
 '["view","create","edit","approve","print","export","cancel"]'),
('WHOUSE','Warehouse','Picking, packing, dan penerbitan Surat Jalan.',
 '["dashboard","log.picking","log.sj","log.delivery","log.receipt","sales.order","m.product","m.warehouse","rep.delivery"]',
 '["view","create","edit","print","export"]'),
('FINANCE','Finance','Invoice, credit note, retur, dan posting jurnal.',
 '["dashboard","ar.invoice","ar.creditnote","ar.outstanding","ar.aging","ar.statement","sales.return","acc.journal","acc.gl","acc.coa","rep.pl","rep.bs","rep.cf","rep.tb","rep.sales","rep.aging","m.customer","m.product","m.tax","m.term","m.bank"]',
 '["view","create","edit","post","print","export","approve"]'),
('COLLECT','Collector','Penagihan dan follow-up piutang.',
 '["dashboard","ar.outstanding","ar.aging","ar.collection","ar.statement","m.customer","rep.aging"]',
 '["view","create","edit","print","export"]'),
('CASHIER','Cashier','Penerimaan dan alokasi pembayaran.',
 '["dashboard","ar.payment","ar.outstanding","ar.statement","m.bank"]',
 '["view","create","edit","print","export"]'),
('MGMT','Management','Dashboard dan seluruh laporan, read-only.',
 '["dashboard","rep.pl","rep.bs","rep.cf","rep.tb","rep.sales","rep.aging","rep.delivery","ar.aging","sales.order","ar.invoice"]',
 '["view","print","export"]'),
('AUDITOR','Auditor','Read-only seluruh modul termasuk audit trail.','"*"','["view","print","export"]');

insert into settings(id, company, vat_rate, default_term, default_warehouse,
  approval_order_limit, approval_disc_limit, currency)
values (1, jsonb_build_object(
  'name','SAYUR TOP', 'legal','CV Sayur Top Nusantara',
  'tagline','Fresh Supply, Trusted Partner',
  'addr','Jl. Raya Pasar Induk Kramat Jati No. 88, Jakarta Timur 13540',
  'phone','(021) 8778 2200', 'email','order@sayurtop.co.id',
  'npwp','02.345.678.9-007.000',
  'bank','Bank Mandiri — 1230098877665 a/n CV Sayur Top Nusantara'),
  11, 'NET30', 'WH-JKT', 100000000, 10, 'IDR');
