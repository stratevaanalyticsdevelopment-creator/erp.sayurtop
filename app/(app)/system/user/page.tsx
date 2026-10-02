'use client';
/* User Management — akun pengguna dan perannya. Hak akses menu/aksi
   ditentukan oleh Role, bukan per pengguna (sama dengan versi HTML). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Card, CardBody, DataTable, F, Fg, Modal, ModalBody, ModalFoot, ModalHead, PageHead,
} from '@/components/ui';

type Row = {
  id: string; username: string; name: string; email: string;
  role_code: string; salesperson_code: string | null; active: boolean;
};

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('app_user').select('*').order('username');
    setRows((data as Row[]) || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  function openNew() {
    setIsNew(true); setPass('');
    setEdit({ id: '', username: '', name: '', email: '', role_code: 'SALES', salesperson_code: '', active: true });
  }
  function openEdit(u: Row) { setIsNew(false); setPass(''); setEdit({ ...u }); }

  async function save() {
    if (!edit) return;
    if (!edit.username.trim() || !edit.name.trim()) {
      s.toast('Username dan nama wajib diisi.', 'err'); return;
    }
    setBusy(true);
    if (isNew) {
      const res = await fetch('/api/admin/user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: edit.username, name: edit.name,
          email: edit.email || `${edit.username.trim().toLowerCase()}@sayurtop.co.id`,
          password: pass, role_code: edit.role_code, salesperson_code: edit.salesperson_code || '',
        }),
      });
      const j = await res.json();
      setBusy(false);
      if (!res.ok) { s.toast(j.error || 'Gagal membuat akun.', 'err'); return; }
      s.toast(`Akun ${edit.username} dibuat.`, 'ok');
    } else {
      const { error } = await supabase.from('app_user').update({
        name: edit.name.trim(), email: edit.email.trim(), role_code: edit.role_code,
        salesperson_code: edit.salesperson_code || null, active: edit.active,
      }).eq('id', edit.id);
      if (error) { setBusy(false); s.toast(errMsg(error), 'err'); return; }
      await supabase.rpc('write_audit', {
        p_action: 'EDIT USER', p_doc: edit.username, p_field: 'role',
        p_before: '-', p_after: edit.role_code,
      });
      if (pass) {
        const res = await fetch('/api/admin/user', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: edit.id, password: pass }),
        });
        const j = await res.json();
        if (!res.ok) {
          setBusy(false);
          s.toast(`Data tersimpan, tetapi password gagal diubah: ${j.error}`, 'warn');
          setEdit(null); await load(); return;
        }
      }
      setBusy(false);
      s.toast(`User ${edit.username} tersimpan.`, 'ok');
    }
    setEdit(null); await load();
  }

  return (
    <>
      <PageHead title="User Management"
        desc="Akun pengguna beserta perannya. Hak akses menu dan aksi ditentukan oleh Role, bukan per pengguna."
        actions={s.can('create') ? <button className="btn pri" onClick={openNew}>+ User Baru</button> : undefined} />

      <Card><CardBody flush>
        <DataTable<Row> rows={rows} rowKey={(r) => r.id} cols={[
          { t: 'Username', f: (u) => <span className="doc-no">{u.username}</span> },
          { t: 'Nama', f: (u) => u.name },
          { t: 'Email', f: (u) => <span className="sm">{u.email}</span> },
          { t: 'Role', f: (u) => <span className="bdg2 b-brand">
            {s.roles.find((r) => r.code === u.role_code)?.name || u.role_code}</span> },
          { t: 'Sales Link', f: (u) => (u.salesperson_code
            ? <span className="sm mono">{u.salesperson_code}</span> : <span className="mut">—</span>) },
          { t: 'Status', f: (u) => (u.active
            ? <span className="bdg2 b-green">Aktif</span> : <span className="bdg2 b-grey">Nonaktif</span>) },
          { t: '', cls: 'ctr', f: (u) => (s.can('edit')
            ? <button className="btn sm" onClick={() => openEdit(u)}>Edit</button> : null) },
        ]} />
      </CardBody></Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} size="mid">
        {edit ? (<>
          <ModalHead title={isNew ? 'User Baru' : 'Edit ' + edit.username} onClose={() => setEdit(null)} />
          <ModalBody>
            <Fg c={2}>
              <F label="Username">
                <input value={edit.username} disabled={!isNew}
                  onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></F>
              <F label="Nama Lengkap">
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></F>
              <F label="Email" help="Dipakai sebagai kredensial masuk ke Supabase Auth.">
                <input value={edit.email} disabled={!isNew}
                  onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></F>
              <F label={isNew ? 'Password' : 'Password Baru'}
                help={isNew ? 'Minimal 6 karakter.' : 'Kosongkan bila tidak ingin mengganti password.'}>
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></F>
              <F label="Role">
                <select value={edit.role_code} onChange={(e) => setEdit({ ...edit, role_code: e.target.value })}>
                  {s.roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select></F>
              <F label="Tautkan ke Sales">
                <select value={edit.salesperson_code || ''}
                  onChange={(e) => setEdit({ ...edit, salesperson_code: e.target.value })}>
                  <option value="">— tidak ada —</option>
                  {s.salespersons.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                </select></F>
              <F label="Status" full>
                <select value={edit.active ? '1' : '0'} disabled={isNew}
                  onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}>
                  <option value="1">Aktif</option><option value="0">Nonaktif</option>
                </select></F>
            </Fg>
            {isNew ? (
              <div className="info-box mt14">Akun baru dibuat melalui Supabase Auth. Baris pada tabel
                <b> app_user</b> terbentuk otomatis oleh trigger, sehingga role dan tautan sales langsung berlaku.</div>
            ) : null}
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setEdit(null)}>Batal</button>
            <button className="btn pri" onClick={save} disabled={busy}>Simpan</button>
          </ModalFoot>
        </>) : null}
      </Modal>
    </>
  );
}
