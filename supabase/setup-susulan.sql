/* =====================================================================
   SETUP SUSULAN -- Strateva O2C ERP untuk Sayur Top
   =====================================================================

   Menjalankan berkas ini membuat sebuah proyek Supabase yang sudah memiliki
   skema dasar (migrasi 0001-0006: master, penjualan, piutang, akuntansi)
   menjadi lengkap sampai versi terbaru: modul pembelian, katalog dan riwayat
   harga supplier, kemasan produk, Picking List, Packaging, serta Purchase
   Order dengan tab Kebutuhan Pembelian.

   CARA PAKAI
   Supabase -> project yang dipakai aplikasi -> SQL Editor -> New query ->
   tempelkan seluruh isi berkas ini -> Run. Perlu satu sampai dua menit.

   AMAN DIJALANKAN ULANG
   Seluruh pernyataan memakai penjaga: create table if not exists,
   add column if not exists, drop view if exists sebelum membuat ulang,
   create or replace untuk fungsi, dan on conflict do nothing untuk data
   contoh. Menjalankannya dua kali tidak menggandakan data.

   TIDAK MENYENTUH PEMBUKUAN
   Berkas ini tidak membuat, mengubah, atau menghapus satu pun jurnal.
   Migrasi 0014 (penyesuaian tanggal PO/GRN lama) sengaja TIDAK disertakan
   karena memindahkan jurnal penerimaan barang -- itu hanya berlaku untuk
   data contoh yang dibuat pada 26 September 2026 dan berbahaya bila
   dijalankan di atas data lain.

   MENYEGARKAN TANGGAL DATA CONTOH
   Di bagian akhir, berkas ini menjalankan refresh_demo_data(): seluruh tanggal
   dokumen contoh digeser agar sejajar dengan hari ini. Tanpa langkah itu
   Packaging, Picking List, Kebutuhan Pembelian, dan angka "bulan ini" di
   dasbor akan kosong meskipun struktur basis datanya sudah lengkap. Fungsinya
   menolak berjalan bila menemukan tanda data sungguhan -- lihat
   README-data-ikut-kalender.md.

   SETELAH SELESAI
   Perhatikan tabel laporan di akhir keluaran SQL Editor, lalu buka menu
   System > Diagnostik Koneksi di aplikasi. Seluruh baris harus berstatus ADA.
   ===================================================================== */


/* ---------- PENJAGA: skema dasar harus sudah ada ----------

   Berkas ini melengkapi proyek yang sudah memiliki skema dasar. Bila tabel
   dasarnya belum ada, berhenti di sini dengan pesan yang jelas alih-alih
   menghasilkan puluhan galat yang membingungkan.
*/
do $penjaga$
declare v_kurang text[];
begin
  select array_agg(t) into v_kurang from unnest(
    array['sales_order','sales_order_line','invoice','invoice_line','product',
          'customer','journal','journal_line','delivery','app_user','app_role']) as t
   where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t and c.relkind = 'r');
  if v_kurang is not null and array_length(v_kurang, 1) > 0 then
    raise exception E'Skema dasar belum ada di proyek ini. Tabel yang belum ada: %.\n'
                    'Jalankan dulu migrasi 0001 sampai 0006 dari folder supabase/migrations, '
                    'lalu jalankan berkas ini.', array_to_string(v_kurang, ', ');
  end if;
  raise notice 'skema dasar terdeteksi lengkap, melanjutkan';
end $penjaga$;

-- ====================================================================
-- BAGIAN 0007 -- 20260925231147_0007_purchasing_schema.sql
-- ====================================================================

-- =====================================================================
-- MODUL PEMBELIAN — supplier, Purchase Order, Inbound (Goods Receipt),
-- landed cost, dan penautan PO↔SO sebagai dasar Auto-Match HPP.
-- =====================================================================

create table if not exists supplier (
  code text primary key,
  name text not null,
  type text,                              -- Petani / Pengepul / Distributor / Pasar Induk
  pic text, phone text, address text,
  term_code text references payment_term(code),
  bank_name text, bank_account text,
  active boolean not null default true,
  created_at timestamptz not null default now());

-- Supplier default per produk: dipakai saat PO dibuat otomatis dari SO.
alter table product add column if not exists default_supplier_code text references supplier(code);

create table if not exists purchase_order (
  no text primary key,
  po_date date not null,
  expected_date date,
  supplier_code text not null references supplier(code),
  warehouse_code text references warehouse(code),
  order_no text references sales_order(no),   -- SO yang memicu PO ini
  term_code text references payment_term(code),
  note text,
  status text not null default 'DRAFT',       -- DRAFT/SENT/PARTIALLY RECEIVED/RECEIVED/CANCELLED
  gross numeric(16,2) not null default 0,
  disc  numeric(16,2) not null default 0,
  sub   numeric(16,2) not null default 0,
  tax   numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now());
create index if not exists purchase_order_supplier_idx on purchase_order(supplier_code);
create index if not exists purchase_order_date_idx on purchase_order(po_date desc);
create index if not exists purchase_order_so_idx on purchase_order(order_no);
create index if not exists purchase_order_status_idx on purchase_order(status);

create table if not exists purchase_order_line (
  id bigserial primary key,
  po_no text not null references purchase_order(no) on delete cascade,
  line_no int not null,
  product_id text not null references product(id),
  name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0),
  price numeric(16,2) not null default 0 check (price >= 0),
  disc_pct numeric(6,3) not null default 0,
  tax_pct  numeric(6,3) not null default 0,
  received_qty numeric(16,3) not null default 0,
  so_line_id bigint references sales_order_line(id),   -- tautan ke baris SO
  unique (po_no, line_no));
create index if not exists purchase_order_line_po_idx on purchase_order_line(po_no);
create index if not exists purchase_order_line_so_idx on purchase_order_line(so_line_id);

-- Tautan balik pada baris SO: dipakai Auto-Match HPP.
alter table sales_order_line add column if not exists po_line_id bigint references purchase_order_line(id);
create index if not exists sales_order_line_po_idx on sales_order_line(po_line_id);

create table if not exists goods_receipt (
  no text primary key,
  grn_date date not null,
  po_no text references purchase_order(no),
  supplier_code text not null references supplier(code),
  warehouse_code text references warehouse(code),
  supplier_invoice text,                    -- nomor nota/faktur dari supplier
  note text,
  status text not null default 'POSTED',
  qty_total numeric(16,3) not null default 0,
  goods_total   numeric(16,2) not null default 0,   -- nilai barang sebelum landed cost
  landed_total  numeric(16,2) not null default 0,   -- total biaya tambahan
  total numeric(16,2) not null default 0,           -- nilai persediaan yang dikapitalisasi
  journal_no text,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now());
create index if not exists goods_receipt_po_idx on goods_receipt(po_no);
create index if not exists goods_receipt_date_idx on goods_receipt(grn_date desc);
create index if not exists goods_receipt_supplier_idx on goods_receipt(supplier_code);

create table if not exists goods_receipt_line (
  id bigserial primary key,
  grn_no text not null references goods_receipt(no) on delete cascade,
  po_line_id bigint references purchase_order_line(id),
  product_id text not null references product(id),
  name text not null, unit text not null,
  qty numeric(16,3) not null check (qty > 0),        -- qty yang benar-benar diterima
  price numeric(16,2) not null check (price >= 0),   -- harga beli aktual hari itu
  landed_alloc numeric(16,2) not null default 0,     -- porsi landed cost baris ini
  unit_cost numeric(16,4) not null default 0);       -- (price*qty + landed_alloc) / qty
create index if not exists goods_receipt_line_grn_idx on goods_receipt_line(grn_no);
create index if not exists goods_receipt_line_pol_idx on goods_receipt_line(po_line_id);
create index if not exists goods_receipt_line_prod_idx on goods_receipt_line(product_id);

create table if not exists landed_cost (
  id bigserial primary key,
  grn_no text not null references goods_receipt(no) on delete cascade,
  kind text not null,                        -- Transport / Bongkar Muat / Sortir & Packing / Retribusi / Lain-lain
  description text,
  amount numeric(16,2) not null check (amount >= 0),
  alloc_method text not null default 'VALUE' check (alloc_method in ('VALUE','QTY')),
  created_at timestamptz not null default now());
create index if not exists landed_cost_grn_idx on landed_cost(grn_no);

-- Harga beli aktual per produk per hari (rata-rata tertimbang dari penerimaan).
drop view if exists purchase_price_daily cascade;
create view purchase_price_daily with (security_invoker = on) as
  select l.product_id, g.grn_date as price_date,
         sum(l.qty) as qty,
         round(sum(l.price * l.qty) / nullif(sum(l.qty),0), 2)     as avg_price,
         round(sum(l.unit_cost * l.qty) / nullif(sum(l.qty),0), 2) as avg_landed_cost,
         min(l.price) as min_price, max(l.price) as max_price,
         count(*) as n_receipt
  from goods_receipt_line l
  join goods_receipt g on g.no = l.grn_no
  where g.status <> 'CANCELLED'
  group by l.product_id, g.grn_date;

-- CoA tambahan untuk pembelian.
insert into coa(code,name,type,group_name,normal) values
  ('1310','Persediaan Dalam Perjalanan','ASSET','Aset Lancar','D'),
  ('2150','Utang Supplier','LIAB','Kewajiban Lancar','C'),
  ('5200','Biaya Angkut Pembelian','COGS','HPP','D')
on conflict (code) do nothing;

-- Penomoran dokumen baru.
insert into doc_counter(prefix, year, seq)
select p, extract(year from (now() at time zone 'Asia/Jakarta'))::int, 0
from unnest(array['PO','GRN']) p
on conflict (prefix, year) do nothing;

-- ---------- RLS ----------
do $mig$
declare t record;
begin
  for t in select * from (values
    ('supplier','m.supplier'),
    ('purchase_order','buy.po'), ('purchase_order_line','buy.po'),
    ('goods_receipt','buy.inbound'), ('goods_receipt_line','buy.inbound'),
    ('landed_cost','buy.landed')
  ) as x(tbl, menu) loop
    execute format('alter table %I enable row level security', t.tbl);
    execute format('drop policy if exists %I on %I', t.tbl||'_sel', t.tbl);
    execute format('create policy %I on %I for select to authenticated using (public.rbac(%L,''view''))',
      t.tbl||'_sel', t.tbl, t.menu);
    execute format('drop policy if exists %I on %I', t.tbl||'_ins', t.tbl);
    execute format('create policy %I on %I for insert to authenticated with check (public.rbac(%L,''create''))',
      t.tbl||'_ins', t.tbl, t.menu);
    execute format('drop policy if exists %I on %I', t.tbl||'_upd', t.tbl);
    execute format('create policy %I on %I for update to authenticated using (public.rbac(%L,''edit'')) with check (public.rbac(%L,''edit''))',
      t.tbl||'_upd', t.tbl, t.menu, t.menu);
    execute format('drop policy if exists %I on %I', t.tbl||'_del', t.tbl);
    execute format('create policy %I on %I for delete to authenticated using (public.rbac(%L,''delete''))',
      t.tbl||'_del', t.tbl, t.menu);
  end loop;
end $mig$;

-- Supplier dibaca juga oleh halaman PO dan Inbound.
drop policy if exists supplier_read on supplier;
create policy supplier_read on supplier for select to authenticated using (true);

-- ====================================================================
-- BAGIAN 0008 -- 20260925231314_0008_po_from_so_and_hpp_match.sql
-- ====================================================================

-- =====================================================================
-- PO OTOMATIS DARI SO + AUTO-MATCH HPP
-- Tautan baris dibawa sepanjang rantai: sales_order_line → delivery_line
-- → invoice_line, sehingga HPP setiap baris faktur dapat ditelusuri ke
-- baris PO dan penerimaan barang yang menjadi sumbernya.
-- =====================================================================

alter table delivery_line add column if not exists so_line_id bigint references sales_order_line(id);
alter table invoice_line  add column if not exists so_line_id bigint references sales_order_line(id);
create index if not exists delivery_line_sol_idx on delivery_line(so_line_id);
create index if not exists invoice_line_sol_idx  on invoice_line(so_line_id);

-- ---------- HPP per unit ----------
-- Urutan sumber biaya, dari yang paling spesifik:
--   1. biaya aktual penerimaan barang atas baris PO yang ditautkan ke baris SO
--   2. rata-rata harga beli produk pada tanggal faktur
--   3. harga beli terakhir sebelum tanggal faktur
--   4. harga pokok standar pada master produk
-- Tingkat 2–4 diperlukan agar faktur tanpa PO (mis. data lama atau barang
-- dari stok) tetap memiliki HPP dan neraca tidak timpang.
create or replace function public.hpp_unit(p_product_id text, p_so_line_id bigint, p_date date)
returns numeric language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select round(sum(grl.unit_cost * grl.qty) / nullif(sum(grl.qty),0), 2)
       from sales_order_line sl
       join goods_receipt_line grl on grl.po_line_id = sl.po_line_id
       join goods_receipt g on g.no = grl.grn_no and g.status <> 'CANCELLED'
      where sl.id = p_so_line_id and sl.po_line_id is not null),
    (select avg_landed_cost from purchase_price_daily
      where product_id = p_product_id and price_date = p_date),
    (select avg_landed_cost from purchase_price_daily
      where product_id = p_product_id and price_date <= p_date
      order by price_date desc limit 1),
    (select base_price from product where id = p_product_id),
    0);
$fn$;

-- Asal-usul HPP sebuah baris faktur, untuk ditampilkan di layar.
create or replace function public.hpp_source(p_so_line_id bigint)
returns text language sql stable security definer set search_path = public as $fn$
  select case when exists (
    select 1 from sales_order_line sl
      join goods_receipt_line grl on grl.po_line_id = sl.po_line_id
      join goods_receipt g on g.no = grl.grn_no and g.status <> 'CANCELLED'
     where sl.id = p_so_line_id and sl.po_line_id is not null)
  then 'PO' else 'ESTIMASI' end;
$fn$;

-- ---------- PO otomatis dari Sales Order ----------
create or replace function public.create_po_from_order(p_order_no text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ord record; s record; l record; v_no text; i int;
        v_gross numeric; v_tax numeric; v_out jsonb := '[]'::jsonb;
begin
  if not rbac('buy.po','create') then raise exception 'Tidak memiliki hak membuat Purchase Order'; end if;
  select * into v_ord from sales_order where no = p_order_no;
  if not found then raise exception 'Sales Order % tidak ditemukan', p_order_no; end if;
  if exists (select 1 from purchase_order where order_no = p_order_no and status <> 'CANCELLED') then
    return jsonb_build_object('created', 0, 'note', 'PO untuk order ini sudah ada');
  end if;

  -- Satu PO per supplier, berisi seluruh baris SO milik supplier tersebut.
  for s in
    select coalesce(pr.default_supplier_code, 'SUP-UMUM') as supplier_code
    from sales_order_line sl join product pr on pr.id = sl.product_id
    where sl.order_no = p_order_no
    group by 1
  loop
    if not exists (select 1 from supplier where code = s.supplier_code) then continue; end if;
    v_no := next_doc_no('PO');
    insert into purchase_order(no, po_date, expected_date, supplier_code, warehouse_code,
        order_no, term_code, status, note, created_by)
    values (v_no, today_jkt(),
            coalesce(v_ord.delivery_date - 1, today_jkt()),
            s.supplier_code, v_ord.warehouse_code, p_order_no,
            (select term_code from supplier where code = s.supplier_code),
            'SENT', 'Dibuat otomatis dari ' || p_order_no, auth.uid());

    i := 0; v_gross := 0; v_tax := 0;
    for l in
      select sl.*, pr.base_price, pr.tax_rate
      from sales_order_line sl join product pr on pr.id = sl.product_id
      where sl.order_no = p_order_no
        and coalesce(pr.default_supplier_code,'SUP-UMUM') = s.supplier_code
      order by sl.line_no
    loop
      i := i + 1;
      insert into purchase_order_line(po_no, line_no, product_id, name, unit, qty,
          price, disc_pct, tax_pct, so_line_id)
      values (v_no, i, l.product_id, l.name, l.unit, l.qty, l.base_price, 0, 0, l.id);
      -- tautan balik untuk Auto-Match HPP
      update sales_order_line set po_line_id = currval('purchase_order_line_id_seq')
        where id = l.id;
      v_gross := v_gross + round(l.qty * l.base_price, 2);
    end loop;

    update purchase_order set gross = v_gross, sub = v_gross, tax = v_tax,
      total = v_gross + v_tax where no = v_no;
    v_out := v_out || jsonb_build_object('no', v_no, 'supplier', s.supplier_code,
      'lines', i, 'total', v_gross);
  end loop;

  if jsonb_array_length(v_out) > 0 then
    insert into sales_order_timeline(order_no, text, by_user)
    values (p_order_no, 'Purchase Order dibuat otomatis (' || jsonb_array_length(v_out) || ' supplier)',
            (select username from app_user where id = auth.uid()));
    perform write_audit('CREATE PO', p_order_no, 'po', '-', v_out::text);
  end if;
  return jsonb_build_object('created', jsonb_array_length(v_out), 'po', v_out);
end $fn$;

-- Approval SO sekaligus menerbitkan PO ke supplier.
create or replace function public.approve_sales_order(p_no text, p_ok boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_user text;
begin
  if not rbac('sales.approval','approve') then raise exception 'Tidak memiliki hak approval'; end if;
  select username into v_user from app_user where id = auth.uid();
  if p_ok then
    update sales_order set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
      where no = p_no and status = 'SUBMITTED';
    if not found then raise exception 'Order % tidak berstatus SUBMITTED', p_no; end if;
    insert into sales_order_timeline(order_no, text, by_user) values (p_no, 'Disetujui Sales Manager', v_user);
    perform write_audit('APPROVE SO', p_no, 'status', 'SUBMITTED', 'APPROVED');
    -- Kegagalan pembuatan PO tidak boleh membatalkan approval.
    begin
      perform create_po_from_order(p_no);
    exception when others then
      insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'PO otomatis gagal dibuat: ' || sqlerrm, v_user);
    end;
  else
    update sales_order set status = 'REJECTED' where no = p_no and status = 'SUBMITTED';
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Ditolak' || coalesce(' — ' || p_reason, ''), v_user);
    perform write_audit('REJECT SO', p_no, 'status', 'SUBMITTED', 'REJECTED: ' || coalesce(p_reason,''));
  end if;
end $fn$;

-- ---------- Bawa tautan baris SO ke Surat Jalan ----------
create or replace function public.create_delivery(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; l jsonb; v_ord record; v_out record; v_qty numeric;
        v_total numeric := 0; v_full boolean; v_user text;
begin
  if not rbac('log.sj','create') then raise exception 'Tidak memiliki hak membuat Surat Jalan'; end if;
  select * into v_ord from sales_order where no = p->>'order_no';
  if not found then raise exception 'Sales Order % tidak ditemukan', p->>'order_no'; end if;
  if v_ord.status not in ('APPROVED','PROCESSING','PARTIALLY DELIVERED') then
    raise exception 'Order % berstatus %, belum dapat dikirim', v_ord.no, v_ord.status; end if;

  v_no := next_doc_no('SJ');
  select username into v_user from app_user where id = auth.uid();
  insert into delivery(no, delivery_date, order_no, customer_code, warehouse_code,
      driver_code, vehicle_code, note, status, created_by)
  values (v_no, coalesce((p->>'delivery_date')::date, today_jkt()), v_ord.no, v_ord.customer_code,
          coalesce(nullif(p->>'warehouse_code',''), v_ord.warehouse_code),
          nullif(p->>'driver_code',''), nullif(p->>'vehicle_code',''),
          nullif(p->>'note',''), 'IN TRANSIT', auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := (l->>'qty')::numeric;
    continue when v_qty is null or v_qty <= 0;
    select * into v_out from order_outstanding_view
      where order_no = v_ord.no and product_id = l->>'product_id';
    if not found then raise exception 'Produk % tidak ada pada order %', l->>'product_id', v_ord.no; end if;
    if v_qty > v_out.outstanding_qty then
      raise exception 'Over-delivery pada %: qty % melebihi sisa outstanding %',
        v_out.name, v_qty, v_out.outstanding_qty; end if;
    insert into delivery_line(delivery_no, product_id, name, unit, qty, ordered_qty,
        price, disc_pct, tax_pct, so_line_id)
    select v_no, sl.product_id, sl.name, sl.unit, v_qty, sl.qty, sl.price, sl.disc_pct, sl.tax_pct, sl.id
    from sales_order_line sl where sl.order_no = v_ord.no and sl.product_id = l->>'product_id'
    limit 1;
    update product set stock = stock - v_qty where id = l->>'product_id';
    v_total := v_total + v_qty;
  end loop;

  if v_total <= 0 then raise exception 'Surat Jalan harus memuat minimal satu barang'; end if;
  update delivery set qty_total = v_total where no = v_no;

  select bool_and(outstanding_qty <= 0) into v_full from order_outstanding_view where order_no = v_ord.no;
  update sales_order set status = case when v_full then 'DELIVERED' else 'PARTIALLY DELIVERED' end
    where no = v_ord.no;
  insert into sales_order_timeline(order_no, text, by_user)
    values (v_ord.no, 'Surat Jalan ' || v_no || ' diterbitkan (' || v_total || ' unit)', v_user);
  perform write_audit('CREATE SJ', v_no, 'qty', '-', v_total::text);
  return v_no;
end $fn$;

-- ---------- Bawa tautan baris SO ke Invoice ----------
create or replace function public.create_invoice_from_delivery(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; v_dv record; v_ord record; v_days int; v_date date;
        v_gross numeric := 0; v_disc numeric := 0; v_tax numeric := 0;
        r record; i int := 0; v_lg numeric; v_net numeric; v_jv text;
begin
  if not rbac('ar.invoice','create') then raise exception 'Tidak memiliki hak membuat Invoice'; end if;
  select * into v_dv from delivery where no = p->>'delivery_no';
  if not found then raise exception 'Surat Jalan % tidak ditemukan', p->>'delivery_no'; end if;
  if v_dv.status <> 'RECEIVED' then
    raise exception 'Surat Jalan % belum dikonfirmasi diterima customer', v_dv.no; end if;
  if exists (select 1 from invoice_delivery where delivery_no = v_dv.no) then
    raise exception 'Surat Jalan % sudah ditagihkan', v_dv.no; end if;

  select * into v_ord from sales_order where no = v_dv.order_no;
  v_date := coalesce((p->>'invoice_date')::date, today_jkt());
  select days into v_days from payment_term
    where code = coalesce(nullif(p->>'term_code',''), v_ord.term_code);
  v_no := next_doc_no('INV');

  insert into invoice(no, invoice_date, due_date, customer_code, order_no, po_no, term_code,
      salesperson_code, note, status, posted, created_by)
  values (v_no, v_date, v_date + coalesce(v_days,0), v_dv.customer_code, v_ord.no, v_ord.po_no,
          coalesce(nullif(p->>'term_code',''), v_ord.term_code), v_ord.salesperson_code,
          nullif(p->>'note',''), 'OPEN', true, auth.uid());
  insert into invoice_delivery(invoice_no, delivery_no) values (v_no, v_dv.no);

  for r in select * from delivery_line where delivery_no = v_dv.no order by id loop
    i := i + 1;
    v_lg := round(r.qty * r.price, 2);
    v_net := v_lg - v_lg * r.disc_pct/100;
    v_gross := v_gross + v_lg; v_disc := v_disc + (v_lg - v_net);
    v_tax := v_tax + v_net * r.tax_pct/100;
    insert into invoice_line(invoice_no, line_no, product_id, name, unit, qty, price,
        disc_pct, tax_pct, so_line_id)
    values (v_no, i, r.product_id, r.name, r.unit, r.qty, r.price, r.disc_pct, r.tax_pct, r.so_line_id);
  end loop;

  update invoice set gross = round(v_gross,2), disc = round(v_disc,2),
    sub = round(v_gross - v_disc,2), tax = round(v_tax,2),
    total = round(v_gross - v_disc + v_tax,2) where no = v_no;

  v_jv := post_journal(v_date, 'INVOICE', v_no,
    'Penjualan kepada ' || v_dv.customer_code || ' — ' || v_no, invoice_journal_lines(v_no));
  update invoice set journal_no = v_jv where no = v_no;
  perform refresh_invoice_status(v_no);

  update sales_order set status = 'INVOICED' where no = v_ord.no and status = 'DELIVERED';
  insert into sales_order_timeline(order_no, text, by_user)
  values (v_ord.no, 'Invoice ' || v_no || ' diterbitkan',
          (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE INVOICE', v_no, 'total', '-',
    (select total::text from invoice where no = v_no));
  return v_no;
end $fn$;

-- ---------- HPP faktur memakai biaya aktual pembelian ----------
create or replace function public.invoice_journal_lines(p_no text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  with i as (select * from invoice where no = p_no),
       c as (select coalesce(sum(round(
               hpp_unit(il.product_id, il.so_line_id, (select invoice_date from i)) * il.qty, 2)),0) as cogs
             from invoice_line il where il.invoice_no = p_no)
  select jsonb_build_array(
    jsonb_build_object('acc','1200','desc','Piutang ' || i.customer_code || ' — ' || i.no, 'd', i.total, 'c', 0),
    jsonb_build_object('acc','4100','desc','Penjualan barang — ' || i.no, 'd', 0, 'c', i.sub))
    || case when i.tax > 0 then jsonb_build_array(
         jsonb_build_object('acc','2200','desc','PPN Keluaran — ' || i.no, 'd', 0, 'c', i.tax))
       else '[]'::jsonb end
    || case when c.cogs > 0 then jsonb_build_array(
         jsonb_build_object('acc','5100','desc','HPP atas ' || i.no, 'd', c.cogs, 'c', 0),
         jsonb_build_object('acc','1300','desc','Pengurangan persediaan — ' || i.no, 'd', 0, 'c', c.cogs))
       else '[]'::jsonb end
  from i, c;
$fn$;

grant execute on function public.hpp_unit(text,bigint,date) to authenticated;
grant execute on function public.hpp_source(bigint) to authenticated;
grant execute on function public.create_po_from_order(text) to authenticated;

-- ====================================================================
-- BAGIAN 0009 -- 20260925231425_0009_receive_goods_landed_cost.sql
-- ====================================================================

-- =====================================================================
-- INBOUND (GOODS RECEIPT) + LANDED COST
-- Penerimaan barang mencatat harga beli aktual hari itu, membebankan
-- biaya tambahan ke persediaan, lalu memperbarui harga pokok master
-- produk sehingga HPP berikutnya memakai biaya hari berjalan.
-- =====================================================================

-- Membagi landed cost ke baris penerimaan dan menghitung ulang unit_cost.
create or replace function public.realloc_landed(p_grn text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_val numeric; v_qty numeric; v_by_val numeric; v_by_qty numeric;
begin
  select coalesce(sum(price * qty),0), coalesce(sum(qty),0) into v_val, v_qty
    from goods_receipt_line where grn_no = p_grn;
  select coalesce(sum(amount) filter (where alloc_method = 'VALUE'),0),
         coalesce(sum(amount) filter (where alloc_method = 'QTY'),0)
    into v_by_val, v_by_qty from landed_cost where grn_no = p_grn;

  update goods_receipt_line l set
    landed_alloc = round(
      case when v_val > 0 then v_by_val * (l.price * l.qty) / v_val else 0 end +
      case when v_qty > 0 then v_by_qty * l.qty / v_qty else 0 end, 2)
  where l.grn_no = p_grn;

  update goods_receipt_line l set
    unit_cost = round((l.price * l.qty + l.landed_alloc) / nullif(l.qty,0), 4)
  where l.grn_no = p_grn;

  update goods_receipt g set
    goods_total  = coalesce((select sum(price * qty)    from goods_receipt_line where grn_no = p_grn),0),
    landed_total = coalesce((select sum(landed_alloc)   from goods_receipt_line where grn_no = p_grn),0),
    total        = coalesce((select sum(price * qty + landed_alloc) from goods_receipt_line where grn_no = p_grn),0)
  where g.no = p_grn;
end $fn$;

-- Harga pokok master mengikuti biaya aktual hari penerimaan.
create or replace function public.refresh_base_price(p_grn text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_date date;
begin
  select grn_date into v_date from goods_receipt where no = p_grn;
  update product p set base_price = d.avg_landed_cost
  from purchase_price_daily d
  where d.product_id = p.id and d.price_date = v_date
    and d.avg_landed_cost > 0
    and p.id in (select product_id from goods_receipt_line where grn_no = p_grn);
end $fn$;

-- ---------- Penerimaan barang ----------
create or replace function public.receive_goods(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; l jsonb; c jsonb; v_po record; v_qty numeric; v_price numeric;
        v_total_qty numeric := 0; v_g record; v_jv text; v_lines jsonb;
        v_supplier text; v_date date; v_pol bigint;
begin
  if not rbac('buy.inbound','create') then raise exception 'Tidak memiliki hak mencatat penerimaan barang'; end if;
  v_date := coalesce((p->>'grn_date')::date, today_jkt());

  if nullif(p->>'po_no','') is not null then
    select * into v_po from purchase_order where no = p->>'po_no';
    if not found then raise exception 'Purchase Order % tidak ditemukan', p->>'po_no'; end if;
    if v_po.status = 'CANCELLED' then raise exception 'Purchase Order % sudah dibatalkan', v_po.no; end if;
    v_supplier := v_po.supplier_code;
  else
    v_supplier := nullif(p->>'supplier_code','');
    if v_supplier is null then raise exception 'Supplier wajib diisi bila penerimaan tanpa PO'; end if;
  end if;

  v_no := next_doc_no('GRN');
  insert into goods_receipt(no, grn_date, po_no, supplier_code, warehouse_code,
      supplier_invoice, note, status, created_by)
  values (v_no, v_date, nullif(p->>'po_no',''), v_supplier,
          coalesce(nullif(p->>'warehouse_code',''), v_po.warehouse_code),
          nullif(p->>'supplier_invoice',''), nullif(p->>'note',''), 'POSTED', auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := (l->>'qty')::numeric;
    continue when v_qty is null or v_qty <= 0;
    v_price := coalesce((l->>'price')::numeric, 0);
    v_pol := nullif(l->>'po_line_id','')::bigint;

    -- Tidak boleh menerima melebihi jumlah yang dipesan.
    if v_pol is not null then
      if not exists (select 1 from purchase_order_line where id = v_pol and po_no = v_po.no) then
        raise exception 'Baris PO % bukan milik %', v_pol, v_po.no; end if;
      if v_qty > (select qty - received_qty from purchase_order_line where id = v_pol) then
        raise exception 'Penerimaan % melebihi sisa pesanan pada baris PO %', v_qty, v_pol; end if;
      update purchase_order_line set received_qty = received_qty + v_qty where id = v_pol;
    end if;

    insert into goods_receipt_line(grn_no, po_line_id, product_id, name, unit, qty, price, unit_cost)
    select v_no, v_pol, pr.id, pr.name, pr.unit, v_qty, v_price, v_price
    from product pr where pr.id = l->>'product_id';

    update product set stock = stock + v_qty where id = l->>'product_id';
    v_total_qty := v_total_qty + v_qty;
  end loop;

  if v_total_qty <= 0 then raise exception 'Penerimaan harus memuat minimal satu barang'; end if;

  for c in select * from jsonb_array_elements(coalesce(p->'landed','[]'::jsonb)) loop
    if coalesce((c->>'amount')::numeric,0) <= 0 then continue; end if;
    insert into landed_cost(grn_no, kind, description, amount, alloc_method)
    values (v_no, coalesce(nullif(c->>'kind',''),'Lain-lain'), nullif(c->>'description',''),
            (c->>'amount')::numeric, coalesce(nullif(c->>'alloc_method',''),'VALUE'));
  end loop;

  update goods_receipt set qty_total = v_total_qty where no = v_no;
  perform realloc_landed(v_no);
  perform refresh_base_price(v_no);

  select * into v_g from goods_receipt where no = v_no;
  v_lines := jsonb_build_array(
    jsonb_build_object('acc','1300','desc','Penerimaan barang — ' || v_no, 'd', v_g.total, 'c', 0),
    jsonb_build_object('acc','2150','desc','Utang ' || v_supplier || ' — ' || v_no, 'd', 0, 'c', v_g.goods_total));
  if v_g.landed_total > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('acc','1110','desc','Biaya masuk barang — ' || v_no, 'd', 0, 'c', v_g.landed_total));
  end if;
  v_jv := post_journal(v_date, 'GOODS RECEIPT', v_no,
    'Penerimaan barang dari ' || v_supplier || ' — ' || v_no, v_lines);
  update goods_receipt set journal_no = v_jv where no = v_no;

  -- Status PO mengikuti sisa yang belum diterima.
  if v_po.no is not null then
    update purchase_order set status = case
      when (select bool_and(received_qty >= qty) from purchase_order_line where po_no = v_po.no)
        then 'RECEIVED' else 'PARTIALLY RECEIVED' end
    where no = v_po.no;
  end if;

  perform write_audit('RECEIVE GOODS', v_no, 'total', '-', v_g.total::text);
  return v_no;
end $fn$;

-- ---------- Menambah landed cost pada penerimaan yang sudah tercatat ----------
create or replace function public.apply_landed_cost(p jsonb)
returns void language plpgsql security definer set search_path = public as $fn$
declare c jsonb; v_g record; v_before numeric; v_delta numeric;
begin
  if not rbac('buy.landed','create') then raise exception 'Tidak memiliki hak menambah landed cost'; end if;
  select * into v_g from goods_receipt where no = p->>'grn_no';
  if not found then raise exception 'Penerimaan % tidak ditemukan', p->>'grn_no'; end if;
  v_before := v_g.landed_total;

  for c in select * from jsonb_array_elements(coalesce(p->'landed','[]'::jsonb)) loop
    if coalesce((c->>'amount')::numeric,0) <= 0 then continue; end if;
    insert into landed_cost(grn_no, kind, description, amount, alloc_method)
    values (v_g.no, coalesce(nullif(c->>'kind',''),'Lain-lain'), nullif(c->>'description',''),
            (c->>'amount')::numeric, coalesce(nullif(c->>'alloc_method',''),'VALUE'));
  end loop;

  perform realloc_landed(v_g.no);
  perform refresh_base_price(v_g.no);
  select * into v_g from goods_receipt where no = p->>'grn_no';
  v_delta := v_g.landed_total - v_before;

  if v_delta <> 0 then
    perform post_journal(v_g.grn_date, 'LANDED COST', v_g.no,
      'Tambahan biaya masuk barang — ' || v_g.no,
      jsonb_build_array(
        jsonb_build_object('acc','1300','desc','Kapitalisasi biaya — ' || v_g.no, 'd', v_delta, 'c', 0),
        jsonb_build_object('acc','1110','desc','Pembayaran biaya masuk — ' || v_g.no, 'd', 0, 'c', v_delta)));
    perform write_audit('LANDED COST', v_g.no, 'landed_total', v_before::text, v_g.landed_total::text);
  end if;
end $fn$;

-- ---------- Retur memakai HPP yang sama dengan fakturnya ----------
create or replace function public.process_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ret_no text; v_cn_no text; v_inv record; l jsonb; il record;
        v_qty numeric; v_lg numeric; v_net numeric;
        v_sub numeric := 0; v_tax numeric := 0; v_cogs numeric := 0;
        v_date date; v_reason text := null; v_jv text; v_lines jsonb;
begin
  if not rbac('ar.invoice','create') then raise exception 'Tidak memiliki hak memproses retur'; end if;
  select * into v_inv from invoice where no = p->>'invoice_no';
  if not found then raise exception 'Invoice % tidak ditemukan', p->>'invoice_no'; end if;
  if v_inv.status = 'CANCELLED' then raise exception 'Invoice sudah dibatalkan'; end if;
  v_date := coalesce((p->>'return_date')::date, today_jkt());

  v_ret_no := next_doc_no('RET');
  insert into sales_return(no, return_date, invoice_no, order_no, customer_code,
      warehouse_code, note, status, created_by)
  values (v_ret_no, v_date, v_inv.no, v_inv.order_no, v_inv.customer_code,
          nullif(p->>'warehouse_code',''), nullif(p->>'note',''), 'APPROVED', auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := (l->>'qty')::numeric;
    continue when v_qty is null or v_qty <= 0;
    select * into il from invoice_line
      where invoice_no = v_inv.no and product_id = l->>'product_id' limit 1;
    if not found then raise exception 'Produk % tidak ada pada invoice %', l->>'product_id', v_inv.no; end if;
    if v_qty > (il.qty - il.ret_qty) then
      raise exception 'Qty retur % melebihi sisa yang dapat diretur (%) untuk %',
        v_qty, il.qty - il.ret_qty, il.name; end if;
    if nullif(l->>'reason','') is null then
      raise exception 'Alasan retur wajib diisi untuk %', il.name; end if;

    v_lg := round(v_qty * il.price, 2);
    v_net := v_lg - v_lg * il.disc_pct/100;
    v_sub := v_sub + v_net;
    v_tax := v_tax + v_net * il.tax_pct/100;
    v_cogs := v_cogs + round(hpp_unit(il.product_id, il.so_line_id, v_inv.invoice_date) * v_qty, 2);

    insert into sales_return_line(return_no, product_id, name, unit, qty, price, disc_pct, tax_pct, reason)
    values (v_ret_no, il.product_id, il.name, il.unit, v_qty, il.price, il.disc_pct, il.tax_pct, l->>'reason');

    update invoice_line set ret_qty = ret_qty + v_qty, ret_reason = l->>'reason' where id = il.id;
    update product set stock = stock + v_qty where id = il.product_id;
    if v_reason is null then v_reason := l->>'reason'; end if;
  end loop;

  if v_sub <= 0 then raise exception 'Retur harus memuat minimal satu barang dengan qty lebih dari 0'; end if;

  v_cn_no := next_doc_no('CN');
  insert into credit_note(no, cn_date, invoice_no, return_no, customer_code, reason, note,
      sub, tax, total, status, posted, created_by)
  values (v_cn_no, v_date, v_inv.no, v_ret_no, v_inv.customer_code, v_reason, nullif(p->>'note',''),
          round(v_sub,2), round(v_tax,2), round(v_sub + v_tax,2), 'POSTED', true, auth.uid());
  insert into credit_note_line(cn_no, product_id, name, unit, qty, price, disc_pct, tax_pct, reason)
    select v_cn_no, product_id, name, unit, qty, price, disc_pct, tax_pct, reason
    from sales_return_line where return_no = v_ret_no;

  update sales_return set reason = v_reason, sub = round(v_sub,2), tax = round(v_tax,2),
    total = round(v_sub + v_tax,2), cn_no = v_cn_no where no = v_ret_no;
  update invoice set return_total = return_total + round(v_sub + v_tax,2) where no = v_inv.no;
  perform refresh_invoice_status(v_inv.no);

  v_lines := jsonb_build_array(
    jsonb_build_object('acc','4200','desc','Retur penjualan — ' || v_inv.no, 'd', round(v_sub,2), 'c', 0));
  if v_tax > 0 then v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('acc','2200','desc','Koreksi PPN Keluaran — ' || v_cn_no, 'd', round(v_tax,2), 'c', 0));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('acc','1200','desc','Pengurangan piutang — ' || v_cn_no, 'd', 0, 'c', round(v_sub + v_tax,2)));
  if v_cogs > 0 then v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('acc','1300','desc','Penerimaan kembali barang retur — ' || v_cn_no, 'd', v_cogs, 'c', 0),
    jsonb_build_object('acc','5100','desc','Koreksi HPP atas retur — ' || v_cn_no, 'd', 0, 'c', v_cogs));
  end if;
  v_jv := post_journal(v_date, 'CREDIT NOTE', v_cn_no,
    'Retur penjualan ' || v_inv.customer_code || ' — ' || v_cn_no, v_lines);
  update credit_note set journal_no = v_jv where no = v_cn_no;

  insert into sales_order_timeline(order_no, text, by_user)
    values (v_inv.order_no, 'Retur ' || v_ret_no || ' — Credit Note ' || v_cn_no,
            (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE RETURN', v_ret_no, 'invoice', v_inv.no, round(v_sub + v_tax,2)::text);
  return jsonb_build_object('return_no', v_ret_no, 'cn_no', v_cn_no,
    'total', round(v_sub + v_tax,2), 'journal_no', v_jv);
end $fn$;

grant execute on function public.receive_goods(jsonb) to authenticated;
grant execute on function public.apply_landed_cost(jsonb) to authenticated;
grant execute on function public.realloc_landed(text) to authenticated;
grant execute on function public.refresh_base_price(text) to authenticated;

-- ====================================================================
-- BAGIAN 0010 -- 20260925231453_0010_seed_supplier_and_roles.sql
-- ====================================================================

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
 'Kawasan Pergudangan Marunda, Jakarta Utara','NET30','Mandiri','1230099887766')
on conflict (code) do nothing;

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

-- ====================================================================
-- BAGIAN 0011 -- 20260926163800_0011_supplier_price_list.sql
-- ====================================================================

/* 0011 — Daftar produk per supplier dan riwayat harga beli */

create table if not exists supplier_product (
  supplier_code  text not null references supplier(code) on delete cascade,
  product_id     text not null references product(id) on delete cascade,
  is_preferred   boolean not null default false,
  lead_time_days int not null default 1,
  min_order_qty  numeric(14,2) not null default 0,
  note           text,
  created_at     timestamptz not null default now(),
  primary key (supplier_code, product_id));

create index if not exists supplier_product_product_idx on supplier_product(product_id);

create table if not exists supplier_price (
  id            bigserial primary key,
  supplier_code text not null references supplier(code) on delete cascade,
  product_id    text not null references product(id) on delete cascade,
  price_date    date not null,
  price         numeric(14,2) not null check (price >= 0),
  source        text not null default 'MANUAL'
                check (source in ('MANUAL','GRN','IMPORT')),
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (supplier_code, product_id, price_date));

create index if not exists supplier_price_lookup_idx
  on supplier_price(supplier_code, product_id, price_date desc);
create index if not exists supplier_price_date_idx on supplier_price(price_date);

drop view if exists supplier_price_current cascade;
create view supplier_price_current as
select distinct on (supplier_code, product_id)
       supplier_code, product_id, price_date, price, source
  from supplier_price
 order by supplier_code, product_id, price_date desc;

create or replace function public.supplier_price_at(
  p_supplier text, p_product text, p_date date)
returns numeric language sql stable security definer set search_path = public as $fn$
  select price from supplier_price
   where supplier_code = p_supplier and product_id = p_product
     and price_date <= p_date
   order by price_date desc limit 1;
$fn$;

create or replace function public.last_po_price(
  p_supplier text, p_product text, p_before date)
returns table (price numeric, po_no text, po_date date)
language sql stable security definer set search_path = public as $fn$
  select l.price, p.no, p.po_date
    from purchase_order_line l
    join purchase_order p on p.no = l.po_no
   where p.supplier_code = p_supplier
     and l.product_id = p_product
     and p.status <> 'CANCELLED'
     and p.po_date < p_before
   order by p.po_date desc, p.no desc
   limit 1;
$fn$;

drop view if exists supplier_product_view cascade;
create view supplier_product_view as
with ranked as (
  select supplier_code, product_id, price_date, price,
         row_number() over (partition by supplier_code, product_id
                            order by price_date desc) as rn
    from supplier_price)
select sp.supplier_code,
       sp.product_id,
       pr.name           as product_name,
       pr.unit,
       pr.category_name,
       pr.sell_price,
       pr.base_price,
       sp.is_preferred,
       sp.lead_time_days,
       sp.min_order_qty,
       sp.note,
       cur.price         as current_price,
       cur.price_date    as current_price_date,
       prv.price         as previous_price,
       prv.price_date    as previous_price_date,
       case when cur.price is not null and prv.price is not null and prv.price > 0
            then round((cur.price - prv.price) / prv.price * 100, 1) end as change_pct,
       (select count(*) from supplier_price x
         where x.supplier_code = sp.supplier_code
           and x.product_id = sp.product_id)        as price_count
  from supplier_product sp
  join product pr on pr.id = sp.product_id
  left join ranked cur on cur.supplier_code = sp.supplier_code
                      and cur.product_id = sp.product_id and cur.rn = 1
  left join ranked prv on prv.supplier_code = sp.supplier_code
                      and prv.product_id = sp.product_id and prv.rn = 2;

create or replace function public.set_supplier_price(
  p_supplier text, p_product text, p_date date, p_price numeric,
  p_source text default 'MANUAL', p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v_id bigint; v_old numeric;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah harga supplier.';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Harga tidak boleh kosong atau negatif.';
  end if;

  select price into v_old from supplier_price
   where supplier_code = p_supplier and product_id = p_product and price_date = p_date;

  insert into supplier_price(supplier_code, product_id, price_date, price, source, note, created_by)
  values (p_supplier, p_product, p_date, round(p_price, 2), coalesce(p_source,'MANUAL'), p_note, auth.uid())
  on conflict (supplier_code, product_id, price_date)
    do update set price = excluded.price, source = excluded.source,
                  note = excluded.note, created_by = excluded.created_by
  returning id into v_id;

  insert into supplier_product(supplier_code, product_id)
  values (p_supplier, p_product)
  on conflict (supplier_code, product_id) do nothing;

  perform write_audit(
    case when v_old is null then 'SET HARGA SUPPLIER' else 'UBAH HARGA SUPPLIER' end,
    p_supplier || '/' || p_product, 'harga ' || p_date::text,
    coalesce(v_old::text,'-'), round(p_price,2)::text);

  return v_id;
end $fn$;

create or replace function public.set_preferred_supplier(
  p_supplier text, p_product text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_old text;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah supplier utama.';
  end if;
  select default_supplier_code into v_old from product where id = p_product;

  update supplier_product set is_preferred = false where product_id = p_product;
  insert into supplier_product(supplier_code, product_id, is_preferred)
  values (p_supplier, p_product, true)
  on conflict (supplier_code, product_id) do update set is_preferred = true;
  update product set default_supplier_code = p_supplier where id = p_product;

  perform write_audit('SET SUPPLIER UTAMA', p_product, 'supplier',
    coalesce(v_old,'-'), p_supplier);
end $fn$;

create or replace function public.add_supplier_products(
  p_supplier text, p_products text[])
returns int language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah katalog supplier.';
  end if;
  insert into supplier_product(supplier_code, product_id)
  select p_supplier, x from unnest(p_products) as x
  on conflict (supplier_code, product_id) do nothing;
  get diagnostics v_n = row_count;
  perform write_audit('TAMBAH PRODUK SUPPLIER', p_supplier, 'produk', '-',
    v_n::text || ' produk');
  return v_n;
end $fn$;

create or replace function public.remove_supplier_product(
  p_supplier text, p_product text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not rbac('m.supplier','delete') then
    raise exception 'Tidak memiliki hak akses untuk menghapus produk supplier.';
  end if;
  delete from supplier_product where supplier_code = p_supplier and product_id = p_product;
  update product set default_supplier_code = null
   where id = p_product and default_supplier_code = p_supplier;
  perform write_audit('HAPUS PRODUK SUPPLIER', p_supplier, 'produk', p_product, '-');
end $fn$;

alter table supplier_product enable row level security;
alter table supplier_price   enable row level security;

drop policy if exists supplier_product_sel on supplier_product;
drop policy if exists supplier_product_ins on supplier_product;
drop policy if exists supplier_product_upd on supplier_product;
drop policy if exists supplier_product_del on supplier_product;
drop policy if exists supplier_product_sel on supplier_product;
create policy supplier_product_sel on supplier_product for select
  using (rbac('m.supplier','view'));
drop policy if exists supplier_product_ins on supplier_product;
create policy supplier_product_ins on supplier_product for insert
  with check (rbac('m.supplier','create'));
drop policy if exists supplier_product_upd on supplier_product;
create policy supplier_product_upd on supplier_product for update
  using (rbac('m.supplier','edit')) with check (rbac('m.supplier','edit'));
drop policy if exists supplier_product_del on supplier_product;
create policy supplier_product_del on supplier_product for delete
  using (rbac('m.supplier','delete'));

drop policy if exists supplier_price_sel on supplier_price;
drop policy if exists supplier_price_ins on supplier_price;
drop policy if exists supplier_price_upd on supplier_price;
drop policy if exists supplier_price_del on supplier_price;
drop policy if exists supplier_price_sel on supplier_price;
create policy supplier_price_sel on supplier_price for select
  using (rbac('m.supplier','view'));
drop policy if exists supplier_price_ins on supplier_price;
create policy supplier_price_ins on supplier_price for insert
  with check (rbac('m.supplier','create'));
drop policy if exists supplier_price_upd on supplier_price;
create policy supplier_price_upd on supplier_price for update
  using (rbac('m.supplier','edit')) with check (rbac('m.supplier','edit'));
drop policy if exists supplier_price_del on supplier_price;
create policy supplier_price_del on supplier_price for delete
  using (rbac('m.supplier','delete'));

grant select on supplier_product, supplier_price to authenticated;
grant insert, update, delete on supplier_product, supplier_price to authenticated;
grant usage, select on sequence supplier_price_id_seq to authenticated;
grant select on supplier_price_current, supplier_product_view to authenticated;

grant execute on function public.supplier_price_at(text,text,date) to authenticated;
grant execute on function public.last_po_price(text,text,date) to authenticated;
grant execute on function public.set_supplier_price(text,text,date,numeric,text,text) to authenticated;
grant execute on function public.set_preferred_supplier(text,text) to authenticated;
grant execute on function public.add_supplier_products(text,text[]) to authenticated;
grant execute on function public.remove_supplier_product(text,text) to authenticated;

update app_role set menus = menus || '["buy.supplierprice"]'::jsonb
 where code in ('WHOUSE','FINANCE','MGMT','PURCH')
   and menus::text <> '"*"'
   and not (menus ? 'buy.supplierprice');

insert into supplier_product(supplier_code, product_id, is_preferred)
select default_supplier_code, id, true
  from product
 where default_supplier_code is not null
on conflict (supplier_code, product_id) do update set is_preferred = true;

insert into supplier_product(supplier_code, product_id)
select distinct po.supplier_code, grl.product_id
  from goods_receipt_line grl
  join goods_receipt g  on g.no = grl.grn_no and g.status <> 'CANCELLED'
  join purchase_order po on po.no = g.po_no
on conflict (supplier_code, product_id) do nothing;

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

insert into supplier_price(supplier_code, product_id, price_date, price, source, note)
select sp.supplier_code, sp.product_id, current_date, pr.base_price, 'MANUAL',
       'Harga awal dari harga pokok master produk'
  from supplier_product sp
  join product pr on pr.id = sp.product_id
 where pr.base_price > 0
   and not exists (select 1 from supplier_price x
                    where x.supplier_code = sp.supplier_code
                      and x.product_id = sp.product_id)
on conflict (supplier_code, product_id, price_date) do nothing;

-- ====================================================================
-- BAGIAN 0012 -- 20260926163942_0012_seed_supplier_price_demo.sql
-- ====================================================================

/* 0012 — DATA DEMO daftar harga supplier (bukan data nyata) */

insert into supplier_product(supplier_code, product_id, lead_time_days, note)
select 'SUP-UMUM', id, 1, 'Alternatif pasar induk — harga lebih tinggi, stok hampir selalu ada'
  from product where active
on conflict (supplier_code, product_id) do nothing;

insert into supplier_product(supplier_code, product_id, lead_time_days, note)
select alt.supplier_code, p.id, alt.lead_time,
       'Alternatif kedua — dipakai saat supplier utama tidak dapat memasok'
  from product p
  join (values
        ('SAY','SUP-002', 2), ('SAY','SUP-003', 2),
        ('CAB','SUP-002', 2), ('CAB','SUP-001', 2),
        ('BUA','SUP-006', 3),
        ('REM','SUP-003', 2),
        ('DRY','SUP-006', 2),
        ('TEL','SUP-007', 2)
       ) as alt(cat, supplier_code, lead_time) on alt.cat = p.category
 where p.active
   and (abs(hashtext(p.id || alt.supplier_code)) % 100) < 45
on conflict (supplier_code, product_id) do nothing;

with tanggal as (
  select (current_date - (w * 7))::date as d from generate_series(8, 1, -1) as w
  union
  select (current_date - x)::date from generate_series(4, 0, -1) as x
),
faktor as (
  select code,
         case type
           when 'Petani'      then 0.96
           when 'Peternak'    then 0.97
           when 'Pengepul'    then 0.99
           when 'Distributor' then 1.01
           when 'Pasar Induk' then 1.06
           else 1.00 end as f
    from supplier
),
volatilitas as (
  select * from (values
    ('CAB', 0.22), ('SAY', 0.13), ('BUA', 0.09),
    ('REM', 0.07), ('TEL', 0.06), ('DRY', 0.03)
  ) as v(cat, vol)
)
insert into supplier_price(supplier_code, product_id, price_date, price, source, note)
select sp.supplier_code, sp.product_id, t.d,
       greatest(
         100,
         round(
           pr.base_price * fk.f
           * (1
              + vo.vol * 0.55 * sin(
                  2 * pi() * ((current_date - t.d)
                    + (abs(hashtext(sp.product_id)) % 21)) / 21.0)
              + vo.vol * 0.45 * (
                  (abs(hashtext(sp.product_id || sp.supplier_code || t.d::text)) % 2000) / 1000.0 - 1.0))
           / 100.0) * 100
       ),
       'MANUAL', 'Data contoh — harga penawaran harian supplier'
  from supplier_product sp
  join product pr   on pr.id = sp.product_id and pr.base_price > 0
  join faktor fk    on fk.code = sp.supplier_code
  join volatilitas vo on vo.cat = pr.category
 cross join tanggal t
on conflict (supplier_code, product_id, price_date) do nothing;

update supplier_product sp set is_preferred = true
 where exists (select 1 from product p
                where p.id = sp.product_id
                  and p.default_supplier_code = sp.supplier_code)
   and not sp.is_preferred;

-- ====================================================================
-- BAGIAN 0013 -- 20260926164448_0013_po_price_from_supplier_list.sql
-- ====================================================================

alter table purchase_order_line
  add column if not exists price_source text,
  add column if not exists prev_price numeric(14,2),
  add column if not exists prev_po_no text;

comment on column purchase_order_line.price_source is
  'Asal harga: LIST = daftar harga supplier, GRN = harga aktual penerimaan terakhir, BASE = harga pokok master produk';

create or replace function public.po_price_for(
  p_supplier text, p_product text, p_date date)
returns table (price numeric, source text)
language plpgsql stable security definer set search_path = public as $fn$
declare v numeric;
begin
  v := supplier_price_at(p_supplier, p_product, p_date);
  if v is not null and v > 0 then
    return query select v, 'LIST'::text; return;
  end if;

  select avg_landed_cost into v from purchase_price_daily
   where product_id = p_product and price_date <= p_date
   order by price_date desc limit 1;
  if v is not null and v > 0 then
    return query select round(v, 2), 'GRN'::text; return;
  end if;

  select base_price into v from product where id = p_product;
  return query select coalesce(v, 0), 'BASE'::text;
end $fn$;

create or replace function public.create_po_from_order(p_order_no text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ord record; s record; l record; v_no text; i int;
        v_gross numeric; v_tax numeric; v_out jsonb := '[]'::jsonb;
        v_price numeric; v_src text; v_prev numeric; v_prev_po text;
        v_naik int; v_turun int;
begin
  if not rbac('buy.po','create') then raise exception 'Tidak memiliki hak membuat Purchase Order'; end if;
  select * into v_ord from sales_order where no = p_order_no;
  if not found then raise exception 'Sales Order % tidak ditemukan', p_order_no; end if;
  if exists (select 1 from purchase_order where order_no = p_order_no and status <> 'CANCELLED') then
    return jsonb_build_object('created', 0, 'note', 'PO untuk order ini sudah ada');
  end if;

  for s in
    select coalesce(
             (select sp.supplier_code from supplier_product sp
               where sp.product_id = sl.product_id and sp.is_preferred limit 1),
             pr.default_supplier_code, 'SUP-UMUM') as supplier_code
    from sales_order_line sl join product pr on pr.id = sl.product_id
    where sl.order_no = p_order_no
    group by 1
  loop
    if not exists (select 1 from supplier where code = s.supplier_code) then continue; end if;
    v_no := next_doc_no('PO');
    insert into purchase_order(no, po_date, expected_date, supplier_code, warehouse_code,
        order_no, term_code, status, note, created_by)
    values (v_no, today_jkt(),
            coalesce(v_ord.delivery_date - 1, today_jkt()),
            s.supplier_code, v_ord.warehouse_code, p_order_no,
            (select term_code from supplier where code = s.supplier_code),
            'SENT', 'Dibuat otomatis dari ' || p_order_no, auth.uid());

    i := 0; v_gross := 0; v_tax := 0; v_naik := 0; v_turun := 0;
    for l in
      select sl.*, pr.base_price, pr.tax_rate
      from sales_order_line sl join product pr on pr.id = sl.product_id
      where sl.order_no = p_order_no
        and coalesce(
              (select sp.supplier_code from supplier_product sp
                where sp.product_id = sl.product_id and sp.is_preferred limit 1),
              pr.default_supplier_code, 'SUP-UMUM') = s.supplier_code
      order by sl.line_no
    loop
      i := i + 1;
      select price, source into v_price, v_src
        from po_price_for(s.supplier_code, l.product_id, today_jkt());
      select price, po_no into v_prev, v_prev_po
        from last_po_price(s.supplier_code, l.product_id, today_jkt());
      if v_prev is not null and v_prev > 0 then
        if v_price > v_prev then v_naik := v_naik + 1;
        elsif v_price < v_prev then v_turun := v_turun + 1; end if;
      end if;

      insert into purchase_order_line(po_no, line_no, product_id, name, unit, qty,
          price, disc_pct, tax_pct, so_line_id, price_source, prev_price, prev_po_no)
      values (v_no, i, l.product_id, l.name, l.unit, l.qty, v_price, 0, 0, l.id,
              v_src, v_prev, v_prev_po);
      update sales_order_line set po_line_id = currval('purchase_order_line_id_seq')
        where id = l.id;
      v_gross := v_gross + round(l.qty * v_price, 2);
    end loop;

    update purchase_order set gross = v_gross, sub = v_gross, tax = v_tax,
      total = v_gross + v_tax,
      note = 'Dibuat otomatis dari ' || p_order_no ||
             case when v_naik + v_turun > 0
                  then ' · perubahan harga: ' || v_naik || ' naik, ' || v_turun || ' turun'
                  else '' end
     where no = v_no;
    v_out := v_out || jsonb_build_object('no', v_no, 'supplier', s.supplier_code,
      'lines', i, 'total', v_gross, 'naik', v_naik, 'turun', v_turun);
  end loop;

  if jsonb_array_length(v_out) > 0 then
    insert into sales_order_timeline(order_no, text, by_user)
    values (p_order_no, 'Purchase Order dibuat otomatis (' || jsonb_array_length(v_out) || ' supplier)',
            (select username from app_user where id = auth.uid()));
    perform write_audit('CREATE PO', p_order_no, 'po', '-', v_out::text);
  end if;
  return jsonb_build_object('created', jsonb_array_length(v_out), 'po', v_out);
end $fn$;

grant execute on function public.po_price_for(text,text,date) to authenticated;

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
   set prev_price = prev.prev_price,
       prev_po_no = prev.prev_po_no,
       price_source = coalesce(l.price_source, 'LIST')
  from prev
 where prev.id = l.id;

update purchase_order_line set price_source = 'BASE' where price_source is null;

-- ====================================================================
-- BAGIAN 0015 -- 20260926232126_0015_supplier_product_qty.sql
-- ====================================================================

/* 0015 — Kuantitas pasok dan realisasi pembelian per supplier + produk

   Melengkapi daftar produk supplier dengan sisi kuantitas:
     min_order_qty     minimum pembelian yang diminta supplier (kolom dari 0011)
     capacity_per_day  kemampuan pasok per hari
     qty_ordered       realisasi qty yang pernah dipesan lewat PO
     qty_received      realisasi qty yang benar-benar diterima
     purchase_value    nilai pembelian termasuk landed cost

   Tiga yang terakhir dihitung dari dokumen, bukan diinput, supaya tidak bisa
   berbeda dengan PO dan penerimaan barang yang sebenarnya. */

alter table supplier_product
  add column if not exists capacity_per_day numeric(14,2) not null default 0;

comment on column supplier_product.capacity_per_day is
  'Kemampuan pasok supplier per hari dalam satuan produk. 0 berarti belum diketahui.';

create or replace function public.set_supplier_product_terms(
  p_supplier text, p_product text,
  p_min_qty numeric default null, p_capacity numeric default null,
  p_lead int default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_min numeric; v_cap numeric; v_lead int;
begin
  if not rbac('m.supplier','edit') then
    raise exception 'Tidak memiliki hak akses untuk mengubah syarat pasok supplier.';
  end if;
  if coalesce(p_min_qty, 0) < 0 or coalesce(p_capacity, 0) < 0 then
    raise exception 'Kuantitas tidak boleh negatif.';
  end if;

  select min_order_qty, capacity_per_day, lead_time_days
    into v_min, v_cap, v_lead
    from supplier_product where supplier_code = p_supplier and product_id = p_product;
  if not found then
    insert into supplier_product(supplier_code, product_id) values (p_supplier, p_product);
    v_min := 0; v_cap := 0; v_lead := 1;
  end if;

  update supplier_product set
      min_order_qty    = coalesce(p_min_qty,  min_order_qty),
      capacity_per_day = coalesce(p_capacity, capacity_per_day),
      lead_time_days   = coalesce(p_lead,     lead_time_days),
      note             = coalesce(p_note,     note)
   where supplier_code = p_supplier and product_id = p_product;

  perform write_audit('UBAH SYARAT PASOK', p_supplier || '/' || p_product,
    'min/kapasitas/lead',
    format('%s/%s/%s', v_min, v_cap, v_lead),
    format('%s/%s/%s', coalesce(p_min_qty, v_min), coalesce(p_capacity, v_cap),
                       coalesce(p_lead, v_lead)));
end $fn$;

grant execute on function public.set_supplier_product_terms(text,text,numeric,numeric,int,text) to authenticated;

drop view if exists supplier_product_view cascade;

drop view if exists supplier_product_view cascade;
create view supplier_product_view as
with ranked as (
  select supplier_code, product_id, price_date, price,
         row_number() over (partition by supplier_code, product_id
                            order by price_date desc) as rn
    from supplier_price),
ordered as (
  select p.supplier_code, l.product_id,
         sum(l.qty) as qty_ordered,
         count(distinct l.po_no) as po_count,
         max(p.po_date) as last_po_date
    from purchase_order_line l
    join purchase_order p on p.no = l.po_no
   where p.status <> 'CANCELLED'
   group by 1, 2),
received as (
  select p.supplier_code, grl.product_id,
         sum(grl.qty) as qty_received,
         sum(grl.qty * grl.unit_cost) as purchase_value,
         max(g.grn_date) as last_grn_date
    from goods_receipt_line grl
    join goods_receipt g on g.no = grl.grn_no and g.status <> 'CANCELLED'
    join purchase_order p on p.no = g.po_no
   group by 1, 2)
select sp.supplier_code,
       sp.product_id,
       pr.name           as product_name,
       pr.unit,
       pr.category,
       pr.category_name,
       pr.sell_price,
       pr.base_price,
       pr.stock,
       sp.is_preferred,
       sp.lead_time_days,
       sp.min_order_qty,
       sp.capacity_per_day,
       sp.note,
       cur.price         as current_price,
       cur.price_date    as current_price_date,
       prv.price         as previous_price,
       prv.price_date    as previous_price_date,
       case when cur.price is not null and prv.price is not null and prv.price > 0
            then round((cur.price - prv.price) / prv.price * 100, 1) end as change_pct,
       (select count(*) from supplier_price x
         where x.supplier_code = sp.supplier_code
           and x.product_id = sp.product_id)        as price_count,
       coalesce(o.qty_ordered, 0)    as qty_ordered,
       coalesce(r.qty_received, 0)   as qty_received,
       coalesce(r.purchase_value, 0) as purchase_value,
       coalesce(o.po_count, 0)       as po_count,
       o.last_po_date,
       r.last_grn_date
  from supplier_product sp
  join product pr on pr.id = sp.product_id
  left join ranked cur on cur.supplier_code = sp.supplier_code
                      and cur.product_id = sp.product_id and cur.rn = 1
  left join ranked prv on prv.supplier_code = sp.supplier_code
                      and prv.product_id = sp.product_id and prv.rn = 2
  left join ordered o  on o.supplier_code = sp.supplier_code and o.product_id = sp.product_id
  left join received r on r.supplier_code = sp.supplier_code and r.product_id = sp.product_id;

drop view if exists supplier_summary_view cascade;
create view supplier_summary_view as
select s.code        as supplier_code,
       count(*)                                          as product_count,
       count(*) filter (where v.is_preferred)             as preferred_count,
       string_agg(distinct v.category_name, ', ')         as categories,
       count(distinct v.category)                        as category_count,
       coalesce(sum(v.qty_ordered), 0)                    as qty_ordered,
       coalesce(sum(v.qty_received), 0)                   as qty_received,
       coalesce(sum(v.purchase_value), 0)                 as purchase_value,
       max(v.last_grn_date)                               as last_grn_date
  from supplier s
  join supplier_product_view v on v.supplier_code = s.code
 group by s.code;

grant select on supplier_product_view, supplier_summary_view to authenticated;

/* ---------- DATA DEMO: kapasitas pasok dan minimum order ----------
   Kapasitas diturunkan dari qty yang pernah diterima supaya masuk akal
   terhadap riwayat, dengan lantai per kategori untuk produk yang belum
   pernah dibeli. */
with dasar as (
  select v.supplier_code, v.product_id, v.category, v.qty_received, v.qty_ordered,
         case v.category
           when 'SAY' then 150 when 'CAB' then 80 when 'BUA' then 120
           when 'REM' then 40  when 'TEL' then 200 when 'DRY' then 250
           else 100 end as lantai
    from supplier_product_view v)
update supplier_product sp
   set capacity_per_day = greatest(
         d.lantai,
         ceil(coalesce(nullif(d.qty_received, 0), d.qty_ordered, 0) / 8.0 / 10) * 10),
       min_order_qty = case
         when d.category in ('REM','CAB') then 5
         when d.category = 'TEL' then 30
         when d.category = 'DRY' then 25
         else 10 end
  from dasar d
 where d.supplier_code = sp.supplier_code and d.product_id = sp.product_id;

-- ====================================================================
-- BAGIAN 0016 -- 20260926235849_0016_product_packing.sql
-- ====================================================================

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
drop view if exists packing_line_view cascade;
create view packing_line_view as
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

-- ====================================================================
-- BAGIAN 0017 -- 20260927000011_0017_fix_packing_status_and_open_orders.sql
-- ====================================================================

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

drop view if exists packing_line_view cascade;
create view packing_line_view as
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

-- ====================================================================
-- BAGIAN 0018 -- 20260927051429_0018_customer_po_reference.sql
-- ====================================================================

/* 0018 — Nomor referensi PO Customer terisi otomatis

   Banyak pelanggan Sayur Top tidak menerbitkan Purchase Order sendiri,
   sehingga kolom PO Customer pada Sales Order selalu kosong dan dokumen
   turunannya (Surat Jalan, Invoice) kehilangan referensi silang.

   Sistem kini membuat nomor referensi internal per customer:

       PO-<kode customer tanpa awalan CUST->-<urut 4 digit>
       contoh: PO-0008-0001

   Nomor ini tetap boleh ditimpa dengan nomor PO asli dari customer.
   Penomorannya memakai doc_counter yang sama dengan nomor dokumen lain,
   jadi aman dipakai beberapa pengguna sekaligus. */

create or replace function public.next_cust_po(p_customer text)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_key text; v_n int;
begin
  if p_customer is null or p_customer = '' then
    raise exception 'Customer wajib dipilih sebelum nomor PO dibuat.';
  end if;
  v_key := 'POC-' || p_customer;
  insert into doc_counter(prefix, year, seq) values (v_key, 0, 1)
  on conflict (prefix, year) do update set seq = doc_counter.seq + 1
  returning seq into v_n;
  return 'PO-' || regexp_replace(p_customer, '^CUST-', '') || '-' || lpad(v_n::text, 4, '0');
end $fn$;

/* Nomor berikutnya tanpa menaikkan penghitung, dipakai saat form dibuka. */
create or replace function public.peek_cust_po(p_customer text)
returns text language sql stable security definer set search_path = public as $fn$
  select 'PO-' || regexp_replace(p_customer, '^CUST-', '') || '-' ||
         lpad((coalesce((select seq from doc_counter
                          where prefix = 'POC-' || p_customer and year = 0), 0) + 1)::text,
              4, '0');
$fn$;

grant execute on function public.next_cust_po(text) to authenticated;
grant execute on function public.peek_cust_po(text) to authenticated;

/* create_sales_order mengisi sendiri bila po_no dikirim kosong. */
create or replace function public.create_sales_order(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; v_po text; l jsonb; i int := 0;
        v_gross numeric := 0; v_disc numeric := 0; v_sub numeric := 0;
        v_tax numeric := 0; v_total numeric := 0;
        v_qty numeric; v_price numeric; v_dp numeric; v_tp numeric;
        v_line_gross numeric; v_line_disc numeric; v_line_sub numeric; v_line_tax numeric;
begin
  if not rbac('sales.order','create') then
    raise exception 'Tidak memiliki hak membuat Sales Order';
  end if;
  v_no := next_doc_no('SO');
  v_po := nullif(p->>'po_no','');
  if v_po is null then
    v_po := next_cust_po(p->>'customer_code');
  end if;

  insert into sales_order(no, order_date, delivery_date, customer_code, salesperson_code,
      warehouse_code, po_no, term_code, note, status, created_by)
  values (v_no, (p->>'order_date')::date, nullif(p->>'delivery_date','')::date,
          p->>'customer_code', nullif(p->>'salesperson_code',''), nullif(p->>'warehouse_code',''),
          v_po, nullif(p->>'term_code',''), nullif(p->>'note',''),
          coalesce(nullif(p->>'status',''), 'DRAFT'), auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    v_qty   := coalesce((l->>'qty')::numeric, 0);
    v_price := coalesce((l->>'price')::numeric, 0);
    v_dp    := coalesce((l->>'disc_pct')::numeric, 0);
    v_tp    := coalesce((l->>'tax_pct')::numeric, 0);
    v_line_gross := round(v_qty * v_price, 2);
    v_line_disc  := round(v_line_gross * v_dp / 100, 2);
    v_line_sub   := v_line_gross - v_line_disc;
    v_line_tax   := round(v_line_sub * v_tp / 100, 2);

    insert into sales_order_line(order_no, line_no, product_id, name, unit, qty, price,
        disc_pct, tax_pct)
    values (v_no, i, l->>'product_id', l->>'name', l->>'unit', v_qty, v_price, v_dp, v_tp);

    v_gross := v_gross + v_line_gross;
    v_disc  := v_disc + v_line_disc;
    v_sub   := v_sub + v_line_sub;
    v_tax   := v_tax + v_line_tax;
  end loop;

  v_total := v_sub + v_tax;
  update sales_order set gross = v_gross, disc = v_disc, sub = v_sub, tax = v_tax,
    total = v_total where no = v_no;

  insert into sales_order_timeline(order_no, text, by_user)
  values (v_no, 'Sales Order dibuat', (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE SO', v_no, 'total', '-', v_total::text);
  return v_no;
end $fn$;

grant execute on function public.create_sales_order(jsonb) to authenticated;

/* Order lama yang kolom PO-nya kosong diisi dengan nomor referensi,
   berurut menurut tanggal order tiap customer. */
with isi as (
  select o.no, o.customer_code,
         (select count(*) from sales_order x
           where x.customer_code = o.customer_code
             and x.po_no is not null and x.po_no <> '')
         + row_number() over (partition by o.customer_code order by o.order_date, o.no) as urut
    from sales_order o where o.po_no is null or o.po_no = '')
update sales_order o
   set po_no = 'PO-' || regexp_replace(i.customer_code, '^CUST-', '') || '-'
               || lpad(i.urut::text, 4, '0')
  from isi i
 where i.no = o.no;

/* Penghitung disesuaikan agar nomor berikutnya tidak menabrak yang sudah ada. */
insert into doc_counter(prefix, year, seq)
select 'POC-' || customer_code, 0, count(*)
  from sales_order where po_no is not null and po_no <> ''
 group by customer_code
on conflict (prefix, year) do update set seq = greatest(doc_counter.seq, excluded.seq);

-- ====================================================================
-- BAGIAN 0019 -- 20260927051452_0019_cust_po_counter_above_max.sql
-- ====================================================================

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

-- ====================================================================
-- BAGIAN 0020 -- 20260927071152_0020_purchase_demand_and_manual_po.sql
-- ====================================================================

/* 0020 — Kebutuhan pembelian dan Purchase Order manual dengan pilihan supplier

   Sebelumnya Purchase Order terbit otomatis saat Sales Order disetujui,
   memakai supplier default pada master produk dan tanpa dapat dipilih.
   Akibatnya pembeli tidak pernah melihat kebutuhan pembelian secara utuh dan
   tidak bisa membandingkan supplier sebelum memesan.

   Sekarang:
   - Sales Order yang disetujui masuk ke daftar kebutuhan pembelian
   - pembeli memilih supplier dan qty per produk, lalu menerbitkan PO
   - satu PO per supplier, boleh menggabungkan kebutuhan beberapa Sales Order
   - alokasi tiap baris PO ke baris Sales Order dicatat, sehingga HPP faktur
     tetap dapat ditelusuri ke penerimaan barang yang menjadi sumbernya
*/

-- ---------------------------------------------------------------- 1. ALOKASI
-- Satu baris PO bisa memenuhi beberapa baris Sales Order sekaligus, jadi
-- tautannya tidak lagi satu-ke-satu dan harus punya tabelnya sendiri.
create table if not exists po_line_allocation (
  po_line_id bigint not null references purchase_order_line(id) on delete cascade,
  so_line_id bigint not null references sales_order_line(id)    on delete cascade,
  qty        numeric(14,2) not null check (qty > 0),
  created_at timestamptz not null default now(),
  primary key (po_line_id, so_line_id));

create index if not exists po_line_allocation_so_idx on po_line_allocation(so_line_id);

-- Data lama memakai tautan satu-ke-satu purchase_order_line.so_line_id.
-- Dipindahkan ke tabel alokasi supaya perhitungan kebutuhan hanya punya
-- satu jalur baca.
insert into po_line_allocation(po_line_id, so_line_id, qty)
select pl.id, pl.so_line_id, pl.qty
  from purchase_order_line pl
 where pl.so_line_id is not null
on conflict (po_line_id, so_line_id) do nothing;

-- ------------------------------------------------------- 2. KEBUTUHAN PER SO
-- Basis qty terkirim memakai (produk, no. SO), sama dengan Picking List dan
-- Packaging — bukan delivery_line.so_line_id, yang tidak terisi pada seluruh
-- data penerimaan yang ada.
drop view if exists purchase_demand_line_view cascade;
create view purchase_demand_line_view as
with terkirim as (
  select dl.product_id, d.order_no, sum(dl.qty) as qty_sj
    from delivery_line dl
    join delivery d on d.no = dl.delivery_no and d.status <> 'CANCELLED'
   group by 1, 2),
dipesan as (
  select a.so_line_id, sum(a.qty) as qty_po
    from po_line_allocation a
    join purchase_order_line pl on pl.id = a.po_line_id
    join purchase_order p on p.no = pl.po_no and p.status <> 'CANCELLED'
   group by 1)
select sl.id                  as so_line_id,
       o.no                   as order_no,
       o.order_date,
       o.delivery_date,
       o.status               as order_status,
       o.customer_code,
       c.name                 as customer_name,
       o.warehouse_code,
       sl.product_id,
       pr.name                as product_name,
       pr.category,
       pr.category_name,
       pr.unit,
       pr.stock,
       pr.default_supplier_code,
       sl.qty                 as qty_order,
       coalesce(t.qty_sj, 0)  as qty_delivered,
       coalesce(dp.qty_po, 0) as qty_ordered,
       greatest(0, sl.qty - coalesce(t.qty_sj, 0) - coalesce(dp.qty_po, 0)) as qty_needed
  from sales_order o
  join sales_order_line sl on sl.order_no = o.no
  join product pr on pr.id = sl.product_id
  join customer c on c.code = o.customer_code
  left join terkirim t  on t.product_id = sl.product_id and t.order_no = o.no
  left join dipesan  dp on dp.so_line_id = sl.id
 where o.status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED')
   and greatest(0, sl.qty - coalesce(t.qty_sj, 0) - coalesce(dp.qty_po, 0)) > 0;

-- -------------------------------------------------- 3. KEBUTUHAN PER PRODUK
-- Stok dikurangkan di tingkat produk, bukan per baris order: gudang tidak
-- memesan ulang barang yang sudah ada, dan stok satu produk melayani
-- order mana saja.
drop view if exists purchase_demand_view cascade;
create view purchase_demand_view as
select d.product_id,
       d.product_name,
       d.category,
       d.category_name,
       d.unit,
       d.stock,
       d.default_supplier_code,
       sum(d.qty_needed)                            as qty_needed,
       greatest(0, sum(d.qty_needed) - d.stock)     as qty_buy,
       min(d.delivery_date)                         as delivery_first,
       max(d.delivery_date)                         as delivery_last,
       count(distinct d.order_no)                   as order_count,
       count(distinct d.customer_code)              as customer_count,
       (select count(*) from supplier_product sp where sp.product_id = d.product_id) as supplier_count
  from purchase_demand_line_view d
 group by d.product_id, d.product_name, d.category, d.category_name,
          d.unit, d.stock, d.default_supplier_code;

-- --------------------------------------------- 4. PILIHAN SUPPLIER PER PRODUK
-- Harga memakai jenjang yang sama dengan PO: daftar harga supplier pada
-- tanggal tersebut, lalu harga penerimaan terakhir, lalu harga pokok master.
create or replace function public.supplier_options_for(p_product text, p_date date default null)
returns table (supplier_code text, supplier_name text, supplier_type text,
               price numeric, price_source text, price_date date,
               is_preferred boolean, lead_time_days int,
               min_order_qty numeric, capacity_per_day numeric, term_code text)
language sql stable security definer set search_path = public as $fn$
  select sp.supplier_code, s.name, s.type,
         pp.price, pp.source,
         (select max(x.price_date) from supplier_price x
           where x.supplier_code = sp.supplier_code
             and x.product_id = sp.product_id
             and x.price_date <= coalesce(p_date, today_jkt())),
         sp.is_preferred, sp.lead_time_days, sp.min_order_qty,
         sp.capacity_per_day, s.term_code
    from supplier_product sp
    join supplier s on s.code = sp.supplier_code
    cross join lateral po_price_for(sp.supplier_code, sp.product_id,
                                    coalesce(p_date, today_jkt())) pp
   where sp.product_id = p_product
   order by sp.is_preferred desc, pp.price asc, s.name;
$fn$;

-- ---------------------------------------------------- 5. PO DIBUAT MANUAL
-- Satu pemanggilan menerbitkan satu PO untuk satu supplier. Qty tiap baris
-- dialokasikan ke baris Sales Order dengan tanggal kirim paling awal lebih
-- dulu; kelebihan qty di atas kebutuhan dibiarkan tanpa alokasi dan masuk
-- sebagai stok.
create or replace function public.create_purchase_order(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_sup record; v_no text; l jsonb; d record; v_prod record;
        i int := 0; v_line_id bigint; v_qty numeric; v_left numeric;
        v_alloc numeric; v_price numeric; v_src text;
        v_prev_price numeric; v_prev_po text;
        v_gross numeric := 0; v_date date; v_exp date; v_wh text;
        v_dems jsonb; v_orders text[] := '{}'; v_user text; o text;
begin
  if not rbac('buy.po','create') then
    raise exception 'Tidak memiliki hak membuat Purchase Order'; end if;

  select * into v_sup from supplier where code = p->>'supplier_code';
  if not found then
    raise exception 'Supplier % tidak ditemukan', coalesce(p->>'supplier_code','(kosong)'); end if;
  if p->'lines' is null or jsonb_typeof(p->'lines') <> 'array'
     or jsonb_array_length(p->'lines') = 0 then
    raise exception 'Purchase Order tanpa baris barang'; end if;

  v_date := coalesce(nullif(p->>'po_date','')::date, today_jkt());
  v_exp  := coalesce(nullif(p->>'expected_date','')::date, v_date + 1);
  v_wh   := coalesce(nullif(p->>'warehouse_code',''),
                     (select code from warehouse order by code limit 1));
  select username into v_user from app_user where id = auth.uid();

  v_no := next_doc_no('PO');
  insert into purchase_order(no, po_date, expected_date, supplier_code, warehouse_code,
    order_no, term_code, note, status, gross, disc, sub, tax, total, created_by)
  values (v_no, v_date, v_exp, v_sup.code, v_wh, null,
    coalesce(nullif(p->>'term_code',''), v_sup.term_code, 'COD'),
    nullif(p->>'note',''), 'SENT', 0, 0, 0, 0, 0, auth.uid());

  for l in select value from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    select * into v_prod from product where id = l->>'product_id';
    if not found then
      raise exception 'Produk % tidak ditemukan', coalesce(l->>'product_id','(kosong)'); end if;

    v_qty := nullif(l->>'qty','')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Qty baris % (%) tidak valid', i, v_prod.name; end if;

    -- Harga boleh ditimpa pembeli; bila tidak, ambil dari daftar harga supplier.
    if nullif(l->>'price','') is not null then
      v_price := (l->>'price')::numeric; v_src := 'MANUAL';
    else
      select pp.price, pp.source into v_price, v_src
        from po_price_for(v_sup.code, v_prod.id, v_date) pp;
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Harga baris % (%) tidak valid', i, v_prod.name; end if;

    select lp.price, lp.po_no into v_prev_price, v_prev_po
      from last_po_price(v_sup.code, v_prod.id, v_date) lp;

    insert into purchase_order_line(po_no, line_no, product_id, name, unit, qty, price,
      disc_pct, tax_pct, received_qty, so_line_id, price_source, prev_price, prev_po_no)
    values (v_no, i, v_prod.id, v_prod.name, v_prod.unit, v_qty, v_price,
      0, 0, 0, null, v_src, v_prev_price, v_prev_po)
    returning id into v_line_id;

    v_gross := v_gross + round(v_qty * v_price, 2);

    -- Kebutuhan disalin lebih dulu ke jsonb: view-nya berubah begitu alokasi
    -- pertama masuk, sehingga tidak boleh dibaca sambil ditulisi.
    select coalesce(jsonb_agg(jsonb_build_object(
             'so_line_id', so_line_id, 'order_no', order_no, 'qty_needed', qty_needed)
             order by delivery_date, order_no, so_line_id), '[]'::jsonb)
      into v_dems
      from purchase_demand_line_view where product_id = v_prod.id;

    v_left := v_qty;
    for d in select (e->>'so_line_id')::bigint as so_line_id,
                    e->>'order_no'             as order_no,
                    (e->>'qty_needed')::numeric as qty_needed
               from jsonb_array_elements(v_dems) e loop
      exit when v_left <= 0;
      v_alloc := least(v_left, d.qty_needed);
      if v_alloc > 0 then
        insert into po_line_allocation(po_line_id, so_line_id, qty)
        values (v_line_id, d.so_line_id, v_alloc);
        -- Tautan untuk HPP: baris SO menunjuk baris PO yang memasok barangnya.
        update sales_order_line set po_line_id = v_line_id where id = d.so_line_id;
        v_left := v_left - v_alloc;
        if not (d.order_no = any(v_orders)) then v_orders := v_orders || d.order_no; end if;
      end if;
    end loop;
  end loop;

  update purchase_order
     set gross = v_gross, sub = v_gross, total = v_gross,
         -- Kolom order_no hanya terisi bila PO ini memang berasal dari satu
         -- Sales Order saja; daftar lengkapnya dibaca dari alokasi.
         order_no = case when array_length(v_orders, 1) = 1 then v_orders[1] else null end
   where no = v_no;

  foreach o in array v_orders loop
    insert into sales_order_timeline(order_no, text, by_user)
    values (o, 'Purchase Order ' || v_no || ' diterbitkan ke ' || v_sup.name, v_user);
  end loop;

  perform write_audit('BUAT PO', v_no, 'supplier', '-',
    v_sup.code || ' · ' || i || ' produk · ' ||
    coalesce(array_length(v_orders,1), 0) || ' Sales Order');
  return v_no;
end $fn$;

-- ------------------------------------------- 6. SUMBER SALES ORDER TIAP PO
drop view if exists purchase_order_source_view cascade;
create view purchase_order_source_view as
select pl.po_no,
       array_agg(distinct sl.order_no order by sl.order_no) as order_nos,
       count(distinct sl.order_no)                          as order_count,
       count(distinct o.customer_code)                      as customer_count
  from po_line_allocation a
  join purchase_order_line pl on pl.id = a.po_line_id
  join sales_order_line sl on sl.id = a.so_line_id
  join sales_order o on o.no = sl.order_no
 group by pl.po_no;

-- Alokasi tiap baris PO, untuk ditampilkan pada rincian PO dan dipakai gudang
-- saat barang datang.
drop view if exists po_allocation_view cascade;
create view po_allocation_view as
select pl.po_no,
       pl.id            as po_line_id,
       pl.line_no,
       pl.product_id,
       pl.name          as product_name,
       pl.unit,
       pl.qty           as qty_po,
       a.qty            as qty_alokasi,
       sl.order_no,
       o.customer_code,
       c.name           as customer_name,
       o.delivery_date
  from po_line_allocation a
  join purchase_order_line pl on pl.id = a.po_line_id
  join sales_order_line sl on sl.id = a.so_line_id
  join sales_order o on o.no = sl.order_no
  join customer c on c.code = o.customer_code;

-- ------------------------------------- 7. APPROVAL TIDAK LAGI MENERBITKAN PO
create or replace function public.approve_sales_order(p_no text, p_ok boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_user text;
begin
  if not rbac('sales.approval','approve') then raise exception 'Tidak memiliki hak approval'; end if;
  select username into v_user from app_user where id = auth.uid();
  if p_ok then
    update sales_order set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
      where no = p_no and status = 'SUBMITTED';
    if not found then raise exception 'Order % tidak berstatus SUBMITTED', p_no; end if;
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Disetujui Sales Manager', v_user);
    -- Pembelian kini keputusan pembeli: barisnya masuk daftar kebutuhan
    -- pembelian, supplier dipilih di menu Purchase Order.
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Masuk daftar kebutuhan pembelian — menunggu pemilihan supplier', v_user);
    perform write_audit('APPROVE SO', p_no, 'status', 'SUBMITTED', 'APPROVED');
  else
    update sales_order set status = 'REJECTED' where no = p_no and status = 'SUBMITTED';
    insert into sales_order_timeline(order_no, text, by_user)
      values (p_no, 'Ditolak' || coalesce(' — ' || p_reason, ''), v_user);
    perform write_audit('REJECT SO', p_no, 'status', 'SUBMITTED', 'REJECTED: ' || coalesce(p_reason,''));
  end if;
end $fn$;

-- Jalur PO otomatis per Sales Order dihapus agar tidak ada dua cara membuat PO
-- yang saling bertentangan dengan penggabungan per supplier.
drop function if exists public.create_po_from_order(text);

-- ------------------------------------------------------------- 8. RLS & HAK
alter table po_line_allocation enable row level security;

drop policy if exists po_line_allocation_sel on po_line_allocation;
drop policy if exists po_line_allocation_ins on po_line_allocation;
drop policy if exists po_line_allocation_upd on po_line_allocation;
drop policy if exists po_line_allocation_del on po_line_allocation;
drop policy if exists po_line_allocation_sel on po_line_allocation;
create policy po_line_allocation_sel on po_line_allocation for select
  using (rbac('buy.po','view'));
drop policy if exists po_line_allocation_ins on po_line_allocation;
create policy po_line_allocation_ins on po_line_allocation for insert
  with check (rbac('buy.po','create'));
drop policy if exists po_line_allocation_upd on po_line_allocation;
create policy po_line_allocation_upd on po_line_allocation for update
  using (rbac('buy.po','edit')) with check (rbac('buy.po','edit'));
drop policy if exists po_line_allocation_del on po_line_allocation;
create policy po_line_allocation_del on po_line_allocation for delete
  using (rbac('buy.po','delete'));

grant select on po_line_allocation to authenticated;
grant insert, update, delete on po_line_allocation to authenticated;
grant select on purchase_demand_line_view, purchase_demand_view,
                purchase_order_source_view, po_allocation_view to authenticated;
grant execute on function public.supplier_options_for(text,date) to authenticated;
grant execute on function public.create_purchase_order(jsonb) to authenticated;

-- ====================================================================
-- BAGIAN 0021 -- 20260927072548_0021_demand_supplier_options_bulk.sql
-- ====================================================================

/* 0021 — Pilihan supplier untuk seluruh produk yang sedang dibutuhkan

   Halaman Kebutuhan Pembelian memerlukan daftar supplier beserta harganya
   untuk setiap produk yang tampil. Memanggil supplier_options_for satu per
   satu produk berarti puluhan permintaan untuk satu layar; fungsi ini
   mengembalikan semuanya dalam satu permintaan.
*/
create or replace function public.demand_supplier_options(p_date date default null)
returns table (product_id text, supplier_code text, supplier_name text, supplier_type text,
               price numeric, price_source text, price_date date,
               is_preferred boolean, lead_time_days int,
               min_order_qty numeric, capacity_per_day numeric, term_code text)
language sql stable security definer set search_path = public as $fn$
  select sp.product_id, sp.supplier_code, s.name, s.type,
         pp.price, pp.source,
         (select max(x.price_date) from supplier_price x
           where x.supplier_code = sp.supplier_code
             and x.product_id = sp.product_id
             and x.price_date <= coalesce(p_date, today_jkt())),
         sp.is_preferred, sp.lead_time_days, sp.min_order_qty,
         sp.capacity_per_day, s.term_code
    from supplier_product sp
    join supplier s on s.code = sp.supplier_code
    cross join lateral po_price_for(sp.supplier_code, sp.product_id,
                                    coalesce(p_date, today_jkt())) pp
   where sp.product_id in (select d.product_id from purchase_demand_view d)
   order by sp.product_id, sp.is_preferred desc, pp.price asc, s.name;
$fn$;

grant execute on function public.demand_supplier_options(date) to authenticated;

-- ====================================================================
-- BAGIAN 0022 -- 20260928101153_0022_refresh_demo_schedule.sql
-- ====================================================================

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

-- ====================================================================
-- BAGIAN 0023 -- 20260928101748_0023_cron_refresh_demo_schedule.sql
-- ====================================================================

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
/* Ekstensi pg_cron hanya untuk penjadwal data contoh. Bila tidak tersedia
   pada proyek ini, bagian penjadwal dilewati — struktur basis data tetap
   terpasang lengkap, hanya penyegaran jadwal harus dipanggil manual:

       select refresh_demo_schedule();
*/
do $ext$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron tidak tersedia (%), penjadwal dilewati', sqlerrm;
end $ext$;

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
  begin
    perform cron.unschedule('segarkan-jadwal-demo');
  exception when others then null;   -- belum pernah dijadwalkan
  end;

  perform cron.schedule('segarkan-jadwal-demo', '0 18 * * *',
                        $job$select public.refresh_demo_schedule_cron();$job$);
  raise notice 'penjadwal harian "segarkan-jadwal-demo" terpasang';
exception when undefined_function or undefined_table or invalid_schema_name then
  raise notice 'pg_cron tidak terpasang, penjadwal dilewati — '
               'jalankan select refresh_demo_schedule(); bila jadwal perlu disegarkan';
end $sched$;

-- ====================================================================
-- BAGIAN 0024 -- 20260929101525_0024_fix_order_outstanding_view_security.sql
-- ====================================================================

/* 0024 — Picking List memberi angka berbeda-beda tergantung akun yang login

   `order_outstanding_view` satu-satunya view yang dibuat dengan
   `security_invoker = on`; seluruh view lain memakai `off`. Bedanya menentukan
   siapa yang dipakai saat membaca tabel di dalamnya:

   - off : view dibaca atas nama pemiliknya, sehingga seluruh baris terbaca
           utuh lalu hasilnya disaring oleh hak menu di lapisan aplikasi
   - on  : view dibaca atas nama pengguna yang sedang login, sehingga RLS tiap
           tabel di dalamnya ikut berlaku

   Akibatnya fatal dan senyap. Saat `delivery_line` tidak terbaca oleh peran
   tertentu, kolom qty terkirim menjadi nol, dan seluruh baris order tampak
   belum dikirim sama sekali:

       admin / sukir  →  88 baris   (benar)
       budi / direktur → 593 baris  (seluruh baris order, seolah belum ada
                                     satu pun pengiriman)
       lina            →   0 baris

   Angka 593 itu bukan sekadar tampilan: Picking List akan menyuruh gudang
   menyiapkan barang yang sudah dikirim.

   Perbaikannya menyamakan view ini dengan yang lain. Hak akses menu tetap
   ditegakkan seperti sebelumnya — halaman Picking List hanya muncul untuk
   peran yang memilikinya (WHOUSE dan ADMIN).
*/
do $v$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='order_outstanding_view' and c.relkind='v') then
    alter view public.order_outstanding_view set (security_invoker = off);
  end if;
end $v$;

-- ====================================================================
-- BAGIAN 0025 -- 20260930233300_0025_demo_data_follows_calendar.sql
-- ====================================================================

/* 0025 — Data contoh ikut maju bersama kalender

   MASALAH

   Versi HTML membuat ulang seluruh data contohnya di peramban setiap kali
   dibuka, selalu relatif terhadap hari ini. Data contoh di Supabase dibuat
   sekali lalu membeku. Selisihnya melebar tiap hari, dan muncul sebagai
   halaman yang "tidak berjalan seperti versi HTML":

     - Packaging dan Picking List kosong, karena tanggal kirim seluruh order
       terbuka sudah lewat
     - Purchase Order > Kebutuhan Pembelian kosong, dengan sebab yang sama
     - Dasbor "Top Customer <bulan ini>" dan "Produk Terlaris <bulan ini>"
       kosong, karena invoice terakhir tertinggal di bulan sebelumnya
     - Laporan Penjualan dan Laba Rugi bulan berjalan menunjukkan nol

   Tidak satu pun dari itu cacat kode. Ketiga halaman pertama sudah diperbaiki
   sebagian oleh migrasi 0022 yang menyegarkan tanggal kirim order terbuka,
   tetapi 0022 tidak menyentuh riwayat transaksi, sehingga dasbor dan laporan
   bulan berjalan tetap kosong.

   CARA KERJA

   `refresh_demo_data()` menggeser SELURUH tanggal dokumen dengan jumlah hari
   yang sama, dihitung dari jarak antara invoice terakhir dan hari ini. Karena
   pergeserannya seragam:

     - jarak antar dokumen tidak berubah (order -> kirim -> invoice -> bayar)
     - umur piutang (aging) tetap konsisten terhadap tanggal jatuh tempo
     - tanggal jurnal bergeser bersama dokumennya, sehingga trial balance,
       neraca, dan laba rugi tetap seimbang

   Yang TIDAK digeser: nomor dokumen. INV-2026-000093 tetap bernomor 2026
   meskipun tanggalnya bergeser. Nomor dokumen adalah identitas, bukan
   tanggal — menggantinya akan memutus rujukan antar tabel. Bila pergeseran
   melewati batas tahun, fungsi ini menolak dan memberi tahu; pada titik itu
   data contoh sebaiknya dibuat ulang, bukan digeser lagi.

   KHUSUS DATA CONTOH

   Fungsi ini menggeser tanggal seluruh dokumen tanpa membedakan mana yang
   contoh dan mana yang sungguhan. Karena itu ia MENOLAK berjalan bila
   menemukan tanda bahwa aplikasi sudah dipakai sungguhan — lihat
   `demo_data_only()` di bawah. Penjaga itu dapat dilewati dengan sengaja
   (p_force), tetapi jangan pernah dilewati pada basis data produksi.

       select refresh_demo_data();            -- geser secukupnya
       select refresh_demo_data(p_days => 7); -- geser tepat 7 hari
       select demo_shift_days();              -- lihat berapa hari, tanpa mengubah
*/

/* ---------- Berapa hari data contoh tertinggal ---------- */
create or replace function public.demo_shift_days()
returns integer language sql stable security definer set search_path = public as $fn$
  select greatest(0, (today_jkt() - max(invoice_date))::int) from invoice;
$fn$;

comment on function public.demo_shift_days() is
  'Jumlah hari data contoh tertinggal dari hari ini, diukur dari invoice terakhir.';

/* ---------- Penjaga: apakah ini benar-benar basis data contoh ----------

   Tiga tanda bahwa aplikasi sudah dipakai sungguhan:
     1. ada dokumen yang dibuat setelah data contoh disemai, oleh pengguna
        yang bukan pengguna contoh
     2. ada customer di luar daftar contoh (CUST-00xx)
     3. jumlah dokumennya jauh melebihi data contoh

   Penjaga ini sengaja longgar: ia hanya perlu menangkap kasus nyata bahwa
   seseorang sudah memakai aplikasi ini untuk pekerjaan sesungguhnya.
*/
create or replace function public.demo_data_only()
returns boolean language sql stable security definer set search_path = public as $fn$
  select not exists (select 1 from customer where code !~ '^CUST-[0-9]{4}$')
     and (select count(*) from sales_order) <= 400
     and (select count(*) from invoice) <= 400;
$fn$;

comment on function public.demo_data_only() is
  'Benar bila basis data ini masih berisi data contoh saja, bukan pekerjaan sungguhan.';

/* ---------- Penggeser ---------- */
create or replace function public.refresh_demo_data(p_days integer default null,
                                                    p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_days  integer := coalesce(p_days, demo_shift_days());
  v_maks  date;
  v_inv   integer := 0;
  v_no    text;
begin
  if not p_force and not demo_data_only() then
    raise exception 'Basis data ini tampak berisi data sungguhan, bukan data contoh. '
                    'Pergeseran tanggal dibatalkan. Bila memang disengaja, '
                    'jalankan: select refresh_demo_data(p_force => true);';
  end if;

  if v_days <= 0 then
    return jsonb_build_object('digeser_hari', 0,
      'keterangan', 'Data contoh sudah sejajar dengan hari ini, tidak ada yang digeser.');
  end if;

  /* Batas tahun: nomor dokumen memuat tahun dan tidak boleh berbeda dari
     tanggalnya. Bila pergeseran melewati 31 Desember, tolak. */
  select max(d) into v_maks from (
    select max(invoice_date) as d from invoice
    union all select max(delivery_date) from delivery
    union all select max(journal_date)  from journal
    union all select max(po_date)       from purchase_order
    union all select max(delivery_date) from sales_order) x;

  if extract(year from v_maks + v_days) <> extract(year from v_maks) then
    raise exception 'Pergeseran % hari akan melewati batas tahun (% menjadi %). '
                    'Nomor dokumen memuat tahun, sehingga data contoh sebaiknya '
                    'dibuat ulang alih-alih digeser.',
                    v_days, v_maks, v_maks + v_days;
  end if;

  /* --- Penjualan --- */
  update quotation    set quo_date = quo_date + v_days,
                          valid_until = valid_until + v_days;
  update sales_order  set order_date = order_date + v_days,
                          delivery_date = delivery_date + v_days;
  update delivery     set delivery_date = delivery_date + v_days,
                          recv_date = recv_date + v_days;
  update invoice      set invoice_date = invoice_date + v_days,
                          due_date = due_date + v_days;
  update sales_return set return_date = return_date + v_days;
  update credit_note  set cn_date = cn_date + v_days;
  update payment      set pay_date = pay_date + v_days;
  update collection   set due_date = due_date + v_days,
                          promise_date = promise_date + v_days;
  update collection_history set contact_date = contact_date + v_days;

  /* --- Pembelian --- */
  update purchase_order set po_date = po_date + v_days,
                            expected_date = expected_date + v_days;
  update goods_receipt  set grn_date = grn_date + v_days;
  update supplier_price set price_date = price_date + v_days;

  /* --- Akuntansi: digeser bersama dokumennya agar tetap seimbang --- */
  update journal set journal_date = journal_date + v_days;

  /* --- Jejak waktu: agar riwayat tidak tampak mendahului dokumennya --- */
  update sales_order_timeline set at = at + make_interval(days => v_days);
  update audit_log             set at = at + make_interval(days => v_days);

  /* Status invoice bergantung pada jatuh tempo terhadap hari ini, jadi
     dihitung ulang setelah tanggalnya bergeser. */
  for v_no in select no from invoice loop
    perform refresh_invoice_status(v_no);
    v_inv := v_inv + 1;
  end loop;

  return jsonb_build_object(
    'digeser_hari', v_days,
    'invoice_dihitung_ulang', v_inv,
    'tanggal_terakhir', v_maks + v_days,
    'keterangan', format('Seluruh tanggal dokumen digeser %s hari; '
                         'jarak antar dokumen, umur piutang, dan pembukuan tidak berubah.',
                         v_days));
end $fn$;

comment on function public.refresh_demo_data(integer, boolean) is
  'Menggeser seluruh tanggal dokumen contoh agar sejajar dengan hari ini.';

revoke all on function public.refresh_demo_data(integer, boolean) from public, anon;
grant execute on function public.demo_shift_days() to authenticated;
grant execute on function public.demo_data_only() to authenticated;

/* ---------- Penjadwal harian ikut menggeser data, bukan hanya jadwal kirim ----------

   Sebelumnya penjadwal hanya memanggil penyegaran tanggal kirim. Akibatnya
   Packaging dan Picking List terisi, tetapi dasbor dan laporan bulan berjalan
   tetap kosong. Sekarang penggeseran data dijalankan lebih dulu.
*/
create or replace function public.refresh_demo_schedule_cron()
returns integer language plpgsql security definer set search_path = public as $fn$
declare v_n integer;
begin
  /* Geser riwayat bila sudah tertinggal. Kegagalan di sini — misalnya karena
     batas tahun atau karena basis data sudah berisi data sungguhan — tidak
     boleh menghalangi penyegaran jadwal kirim di bawahnya. */
  begin
    if demo_shift_days() > 0 then perform refresh_demo_data(); end if;
  exception when others then
    raise notice 'penggeseran data contoh dilewati: %', sqlerrm;
  end;

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

-- ====================================================================
-- BAGIAN 0026 -- 20261001070000_0026_fix_refresh_demo_data.sql
-- ====================================================================

/* 0026 — Dua koreksi pada refresh_demo_data() dari migrasi 0025

   Migrasi 0025 sudah dijalankan sebelum dua cacat ini ditemukan oleh uji.
   Riwayat migrasi dibiarkan apa adanya; koreksinya berdiri sebagai migrasi
   tersendiri agar pemutaran ulang riwayat pada proyek mana pun menghasilkan
   fungsi yang benar.

   CACAT 1 — supplier_price ditolak kunci unik

       ERROR: 23505 duplicate key value violates unique constraint
              "supplier_price_supplier_code_product_id_price_date_key"
       DETAIL: Key (supplier_code, product_id, price_date)=(SUP-003, SAY-0060,
               2026-09-23) already exists.

   Tabel itu memiliki kunci unik (supplier_code, product_id, price_date).
   Menggeser seluruh baris dalam satu perintah ditolak karena Postgres
   memeriksa keunikan per baris: baris yang sudah digeser bertabrakan dengan
   baris yang belum. Solusinya dua langkah lewat offset yang lebih panjang
   daripada rentang riwayat harga mana pun, sehingga himpunan tanggal lama dan
   baru tidak pernah bersinggungan.

   CACAT 2 — nama kolom jejak waktu salah

       ERROR: 42703 column "at" does not exist

   Kolom waktu pada `sales_order_timeline` dan `audit_log` bernama `ts`, bukan
   `at`.

   Selain dua hal itu, isi fungsinya sama dengan 0025.
*/
create or replace function public.refresh_demo_data(p_days integer default null,
                                                    p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_days  integer := coalesce(p_days, demo_shift_days());
  v_maks  date;
  v_inv   integer := 0;
  v_no    text;
begin
  if not p_force and not demo_data_only() then
    raise exception 'Basis data ini tampak berisi data sungguhan, bukan data contoh. '
                    'Pergeseran tanggal dibatalkan. Bila memang disengaja, '
                    'jalankan: select refresh_demo_data(p_force => true);';
  end if;

  if v_days <= 0 then
    return jsonb_build_object('digeser_hari', 0,
      'keterangan', 'Data contoh sudah sejajar dengan hari ini, tidak ada yang digeser.');
  end if;

  /* Batas tahun: nomor dokumen memuat tahun dan tidak boleh berbeda dari
     tanggalnya. */
  select max(d) into v_maks from (
    select max(invoice_date) as d from invoice
    union all select max(delivery_date) from delivery
    union all select max(journal_date)  from journal
    union all select max(po_date)       from purchase_order
    union all select max(delivery_date) from sales_order) x;

  if extract(year from v_maks + v_days) <> extract(year from v_maks) then
    raise exception 'Pergeseran % hari akan melewati batas tahun (% menjadi %). '
                    'Nomor dokumen memuat tahun, sehingga data contoh sebaiknya '
                    'dibuat ulang alih-alih digeser.',
                    v_days, v_maks, v_maks + v_days;
  end if;

  /* --- Penjualan --- */
  update quotation    set quo_date = quo_date + v_days,
                          valid_until = valid_until + v_days;
  update sales_order  set order_date = order_date + v_days,
                          delivery_date = delivery_date + v_days;
  update delivery     set delivery_date = delivery_date + v_days,
                          recv_date = recv_date + v_days;
  update invoice      set invoice_date = invoice_date + v_days,
                          due_date = due_date + v_days;
  update sales_return set return_date = return_date + v_days;
  update credit_note  set cn_date = cn_date + v_days;
  update payment      set pay_date = pay_date + v_days;
  update collection   set due_date = due_date + v_days,
                          promise_date = promise_date + v_days;
  update collection_history set contact_date = contact_date + v_days;

  /* --- Pembelian --- */
  update purchase_order set po_date = po_date + v_days,
                            expected_date = expected_date + v_days;
  update goods_receipt  set grn_date = grn_date + v_days;

  /* KOREKSI 1: dua langkah, agar tidak bertabrakan dengan kunci uniknya. */
  update supplier_price set price_date = price_date + 100000;
  update supplier_price set price_date = price_date - 100000 + v_days;

  /* --- Akuntansi: digeser bersama dokumennya agar tetap seimbang --- */
  update journal set journal_date = journal_date + v_days;

  /* KOREKSI 2: kolomnya bernama ts, bukan at. */
  update sales_order_timeline set ts = ts + make_interval(days => v_days);
  update audit_log             set ts = ts + make_interval(days => v_days);

  /* Status invoice bergantung pada jatuh tempo terhadap hari ini, jadi
     dihitung ulang setelah tanggalnya bergeser. */
  for v_no in select no from invoice loop
    perform refresh_invoice_status(v_no);
    v_inv := v_inv + 1;
  end loop;

  return jsonb_build_object(
    'digeser_hari', v_days,
    'invoice_dihitung_ulang', v_inv,
    'tanggal_terakhir', v_maks + v_days,
    'keterangan', format('Seluruh tanggal dokumen digeser %s hari; '
                         'jarak antar dokumen, umur piutang, dan pembukuan tidak berubah.',
                         v_days));
end $fn$;

revoke all on function public.refresh_demo_data(integer, boolean) from public, anon;

-- ====================================================================
-- BAGIAN 0027 -- 20261001072000_0027_revoke_anon_rpc.sql
-- ====================================================================

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

-- ====================================================================
-- BAGIAN 0028 -- 20261002021500_0028_fix_create_sales_order_product_master.sql
-- ====================================================================

/* 0028 — create_sales_order menolak setiap Sales Order baru

   GEJALA

   Tombol "Simpan & Ajukan Approval" di form Sales Order Baru tidak
   menghasilkan apa-apa selain pesan merah:

       null value in column "name" of relation "sales_order_line"
       violates not-null constraint

   Tombol "Simpan Draft" gagal dengan cara yang sama. Artinya tidak satu pun
   Sales Order baru dapat dibuat lewat aplikasi — dan karena Kebutuhan
   Pembelian dihitung dari Sales Order yang disetujui, menu itu ikut tampak
   "tidak terhubung" padahal view-nya benar.

   SEBAB

   `create_sales_order` mengambil nama dan satuan produk dari payload klien:

       values (v_no, i, l->>'product_id', l->>'name', l->>'unit', ...)

   Klien tidak mengirimnya, dan memang tidak seharusnya: master produk adalah
   sumber kebenaran untuk nama dan satuan. `update_sales_order` — yang ditulis
   belakangan — sudah melakukannya dengan benar:

       values (v_o.no, i, pr.id, pr.name, pr.unit, ...)

   Jadi kedua fungsi ini tidak konsisten, dan yang salah adalah yang dipakai
   untuk membuat order baru. Versi HTML juga mengambil nama dan satuan dari
   master produknya, sehingga perbaikan ini sekaligus menyamakan perilaku
   kedua versi aplikasi.

   PERBAIKAN

   Produk dicari di master, lalu nama dan satuannya diambil dari sana. Bila
   product_id tidak ada di master, order ditolak dengan pesan yang menyebut
   kodenya — sebelumnya baris seperti itu diam-diam tersimpan dengan kode
   produk yang tidak dikenal.

   Selebihnya fungsi ini tidak berubah: penomoran, PO customer, perhitungan
   bruto/diskon/PPN, timeline, dan audit tetap sama persis.
*/
create or replace function public.create_sales_order(p jsonb)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_no text; v_po text; l jsonb; i int := 0;
        v_gross numeric := 0; v_disc numeric := 0; v_sub numeric := 0;
        v_tax numeric := 0; v_total numeric := 0;
        v_qty numeric; v_price numeric; v_dp numeric; v_tp numeric;
        v_line_gross numeric; v_line_disc numeric; v_line_sub numeric; v_line_tax numeric;
        pr record;
begin
  if not rbac('sales.order','create') then
    raise exception 'Tidak memiliki hak membuat Sales Order';
  end if;
  v_no := next_doc_no('SO');
  v_po := nullif(p->>'po_no','');
  if v_po is null then
    v_po := next_cust_po(p->>'customer_code');
  end if;

  insert into sales_order(no, order_date, delivery_date, customer_code, salesperson_code,
      warehouse_code, po_no, term_code, note, status, created_by)
  values (v_no, (p->>'order_date')::date, nullif(p->>'delivery_date','')::date,
          p->>'customer_code', nullif(p->>'salesperson_code',''), nullif(p->>'warehouse_code',''),
          v_po, nullif(p->>'term_code',''), nullif(p->>'note',''),
          coalesce(nullif(p->>'status',''), 'DRAFT'), auth.uid());

  for l in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1;

    /* Nama dan satuan diambil dari master produk, bukan dari payload —
       sama dengan update_sales_order dan dengan versi HTML. */
    select * into pr from product where id = l->>'product_id';
    if not found then
      raise exception 'Produk % tidak ditemukan di master produk',
        coalesce(l->>'product_id', '(kosong)');
    end if;

    v_qty   := coalesce((l->>'qty')::numeric, 0);
    v_price := coalesce((l->>'price')::numeric, 0);
    v_dp    := coalesce((l->>'disc_pct')::numeric, 0);
    v_tp    := coalesce((l->>'tax_pct')::numeric, 0);
    v_line_gross := round(v_qty * v_price, 2);
    v_line_disc  := round(v_line_gross * v_dp / 100, 2);
    v_line_sub   := v_line_gross - v_line_disc;
    v_line_tax   := round(v_line_sub * v_tp / 100, 2);

    insert into sales_order_line(order_no, line_no, product_id, name, unit, qty, price,
        disc_pct, tax_pct)
    values (v_no, i, pr.id, pr.name, pr.unit, v_qty, v_price, v_dp, v_tp);

    v_gross := v_gross + v_line_gross;
    v_disc  := v_disc + v_line_disc;
    v_sub   := v_sub + v_line_sub;
    v_tax   := v_tax + v_line_tax;
  end loop;

  if i = 0 then
    raise exception 'Sales Order tanpa baris barang';
  end if;

  v_total := v_sub + v_tax;
  update sales_order set gross = v_gross, disc = v_disc, sub = v_sub, tax = v_tax,
    total = v_total where no = v_no;

  insert into sales_order_timeline(order_no, text, by_user)
  values (v_no, 'Sales Order dibuat', (select username from app_user where id = auth.uid()));
  perform write_audit('CREATE SO', v_no, 'total', '-', v_total::text);
  return v_no;
end $fn$;

revoke execute on function public.create_sales_order(jsonb) from public, anon;
grant  execute on function public.create_sales_order(jsonb) to authenticated, service_role;

-- ====================================================================
-- LAPORAN HASIL — dibaca langsung di SQL Editor
-- ====================================================================

/* ---------- LANGKAH TERAKHIR: samakan tanggal data contoh dengan hari ini ----------

   Ini yang membuat Packaging, Picking List, Kebutuhan Pembelian, dan angka
   "bulan ini" di dasbor terisi. Fungsinya menolak berjalan bila menemukan
   tanda data sungguhan, jadi aman dijalankan di sini.
*/
select case when demo_shift_days() = 0
            then jsonb_build_object('digeser_hari', 0,
                   'keterangan', 'Tanggal data contoh sudah sejajar dengan hari ini.')
            else refresh_demo_data() end as penyegaran_tanggal;

/* Tiga halaman yang biasanya kosong dibaca di sini. Bila angkanya nol,
   sebabnya bukan struktur basis data lagi (struktur sudah lengkap setelah
   skrip ini), melainkan isi datanya — lihat kolom "catatan". */
with periksa as (
  select 1 as urut, 'Kebutuhan Pembelian' as halaman,
         (select count(*) from purchase_demand_line_view) as baris,
         'butuh Sales Order terbuka yang belum dialokasikan ke PO' as catatan
  union all
  select 2, 'Packaging',
         (select count(*) from packing_line_view),
         'butuh Sales Order terbuka bertanggal kirim hari ini s.d. H+6'
  union all
  select 3, 'Picking List',
         (select count(*) from order_outstanding_view),
         'butuh Sales Order yang belum terkirim penuh'
  union all
  select 4, 'Harga Supplier',
         (select count(*) from supplier_product_view),
         'pasangan supplier x produk'
  union all
  select 5, 'Sales Order terbuka',
         (select count(*) from sales_order
           where status in ('APPROVED','PROCESSING','PARTIALLY DELIVERED')),
         'sumber data ketiga halaman di atas'
)
select halaman,
       baris,
       case when baris > 0 then 'TERISI' else 'KOSONG' end as status,
       case when baris > 0 then '-' else catatan end as catatan
  from periksa order by urut;

/* ---------- Apakah data contoh sudah tertinggal dari kalender ----------

   Ini penyebab tunggal yang paling sering: data contoh dibuat sekali lalu
   membeku, sementara hari ini terus maju. Halaman yang menyaring tanggal
   kirim atau bulan berjalan lalu tampak rusak padahal kodenya benar.
*/
select demo_shift_days()                       as data_contoh_tertinggal_hari,
       case when demo_shift_days() = 0 then 'SEJAJAR — tidak perlu tindakan'
            else 'TERTINGGAL — jalankan: select refresh_demo_data();' end as tindakan,
       (select max(invoice_date) from invoice)  as invoice_terakhir,
       today_jkt()                              as hari_ini;

/* Menggeser seluruh tanggal dokumen agar sejajar dengan hari ini. Aman
   dijalankan berulang; jarak antar dokumen, umur piutang, dan pembukuan
   tidak berubah. Lihat komentar migrasi 0025 untuk rinciannya.

       select refresh_demo_data();
*/

/* Bila "Sales Order terbuka" bernilai nol, seluruh halaman di atas memang
   kosong secara sah — tidak ada yang perlu disiapkan gudang. Untuk data
   contoh, segarkan jadwalnya:

       select refresh_demo_schedule();

   Bila angka di atas sudah terisi tetapi halaman di aplikasi masih kosong,
   berarti aplikasi tidak membaca basis data INI. Buka menu
   Sistem > Diagnostik Koneksi di aplikasi dan bandingkan nama proyeknya.
*/
