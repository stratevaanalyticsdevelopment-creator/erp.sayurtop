-- Helper RBAC: dibaca dari app_user + app_role, dipakai seluruh policy RLS.
create or replace function public.rbac(p_menu text, p_act text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from app_user u join app_role r on r.code = u.role_code
    where u.id = auth.uid() and u.active
      and (r.menus = '"*"'::jsonb or r.menus ? p_menu)
      and (r.acts  = '"*"'::jsonb or r.acts  ? p_act));
$fn$;

create or replace function public.my_profile()
returns table (id uuid, username text, name text, email text, role_code text,
               role_name text, menus jsonb, acts jsonb, salesperson_code text)
language sql stable security definer set search_path = public as $fn$
  select u.id, u.username, u.name, u.email, u.role_code, r.name, r.menus, r.acts, u.salesperson_code
  from app_user u join app_role r on r.code = u.role_code
  where u.id = auth.uid() and u.active;
$fn$;

-- Penomoran dokumen: tahun mengikuti zona waktu Asia/Jakarta.
create or replace function public.next_doc_no(p_prefix text)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_year int := extract(year from (now() at time zone 'Asia/Jakarta'))::int; v_seq int;
begin
  insert into doc_counter(prefix, year, seq) values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set seq = doc_counter.seq + 1
  returning seq into v_seq;
  return p_prefix || '-' || v_year || '-' || lpad(v_seq::text, 6, '0');
end $fn$;

create or replace function public.today_jkt() returns date
language sql stable as $fn$ select (now() at time zone 'Asia/Jakarta')::date $fn$;

create or replace function public.write_audit(p_action text, p_doc text, p_field text,
  p_before text, p_after text) returns void
language plpgsql security definer set search_path = public as $fn$
declare u record;
begin
  select username, name into u from app_user where id = auth.uid();
  insert into audit_log(user_id, username, user_name, action, doc, field, before_val, after_val)
  values (auth.uid(), coalesce(u.username,'system'), coalesce(u.name,'System'),
          p_action, p_doc, p_field, p_before, p_after);
end $fn$;

-- Profil aplikasi dibuat otomatis saat user auth baru dibuat.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into app_user(id, username, name, email, role_code, salesperson_code, active)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.email,
          coalesce(new.raw_user_meta_data->>'role_code', 'SALES'),
          nullif(new.raw_user_meta_data->>'salesperson_code',''),
          true)
  on conflict (id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- RLS untuk seluruh tabel, dipetakan ke kunci menu yang sama dengan versi HTML.
do $mig$
declare t record;
begin
  for t in select * from (values
    ('product','m.product'), ('customer','m.customer'), ('salesperson','m.sales'),
    ('warehouse','m.warehouse'), ('driver','m.driver'), ('vehicle','m.driver'),
    ('payment_term','m.term'), ('tax','m.tax'), ('bank_account','m.bank'),
    ('coa','acc.coa'),
    ('sales_order','sales.order'), ('sales_order_line','sales.order'),
    ('sales_order_timeline','sales.order'),
    ('delivery','log.sj'), ('delivery_line','log.sj'),
    ('invoice','ar.invoice'), ('invoice_line','ar.invoice'), ('invoice_delivery','ar.invoice'),
    ('sales_return','sales.return'), ('sales_return_line','sales.return'),
    ('credit_note','ar.creditnote'), ('credit_note_line','ar.creditnote'),
    ('payment','ar.payment'), ('payment_alloc','ar.payment'),
    ('collection','ar.collection'), ('collection_history','ar.collection'),
    ('journal','acc.journal'), ('journal_line','acc.journal'),
    ('audit_log','sys.audit'), ('settings','sys.settings'),
    ('app_role','sys.role'), ('app_user','sys.user')
  ) as x(tbl, menu) loop
    execute format('alter table %I enable row level security', t.tbl);
    execute format('create policy %I on %I for select to authenticated using (public.rbac(%L,''view''))',
      t.tbl||'_sel', t.tbl, t.menu);
    execute format('create policy %I on %I for insert to authenticated with check (public.rbac(%L,''create''))',
      t.tbl||'_ins', t.tbl, t.menu);
    execute format('create policy %I on %I for update to authenticated using (public.rbac(%L,''edit'')) with check (public.rbac(%L,''edit''))',
      t.tbl||'_upd', t.tbl, t.menu, t.menu);
    execute format('create policy %I on %I for delete to authenticated using (public.rbac(%L,''delete''))',
      t.tbl||'_del', t.tbl, t.menu);
  end loop;
end $mig$;

-- Setiap pengguna selalu boleh membaca profilnya sendiri dan referensi dasar.
create policy app_user_self on app_user for select to authenticated using (id = auth.uid());
create policy app_role_read on app_role for select to authenticated using (true);
create policy settings_read on settings for select to authenticated using (true);
create policy coa_read on coa for select to authenticated using (true);
create policy term_read on payment_term for select to authenticated using (true);
create policy tax_read on tax for select to authenticated using (true);
create policy bank_read on bank_account for select to authenticated using (true);
create policy wh_read on warehouse for select to authenticated using (true);
create policy sp_read on salesperson for select to authenticated using (true);
create policy audit_ins on audit_log for insert to authenticated with check (true);

-- doc_counter tidak diakses langsung: hanya lewat next_doc_no() yang security definer.
alter table doc_counter enable row level security;

grant execute on function public.rbac(text,text) to authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.next_doc_no(text) to authenticated;
grant execute on function public.today_jkt() to authenticated;
grant execute on function public.write_audit(text,text,text,text,text) to authenticated;
