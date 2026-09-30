'use client';
/* Role & Permission — matriks hak akses menu dan daftar aksi per role. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Card, CardBody, CardHead, DataTable, Modal, ModalBody, ModalFoot, ModalHead, PageHead,
} from '@/components/ui';
import { ACTIONS, MENU, ROLE_ORDER } from '@/lib/menu';

type Role = { code: string; name: string; description: string | null; menus: string[] | '*'; acts: string[] | '*' };

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Role[]>([]);
  const [users, setUsers] = useState<{ role_code: string }[]>([]);
  const [edit, setEdit] = useState<Role | null>(null);
  const [acts, setActs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, u] = await Promise.all([
      supabase.from('app_role').select('*'),
      supabase.from('app_user').select('role_code'),
    ]);
    const rk = (c: string) => { const i = ROLE_ORDER.indexOf(c); return i < 0 ? 999 : i; };
    setRows((((r.data as Role[]) || []).slice()
      .sort((a, b) => rk(a.code) - rk(b.code) || a.code.localeCompare(b.code))));
    setUsers((u.data as { role_code: string }[]) || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  function open(r: Role) {
    setEdit(r);
    setActs(r.acts === '*' ? [...ACTIONS] : [...r.acts]);
  }

  async function save() {
    if (!edit) return;
    setBusy(true);
    const before = edit.acts === '*' ? '*' : edit.acts.join(',');
    const next: string[] | '*' = acts.length === ACTIONS.length ? '*' : acts;
    const { error } = await supabase.from('app_role').update({ acts: next }).eq('code', edit.code);
    if (error) { setBusy(false); s.toast(errMsg(error), 'err'); return; }
    await supabase.rpc('write_audit', {
      p_action: 'EDIT ROLE', p_doc: edit.code, p_field: 'acts',
      p_before: before, p_after: acts.join(','),
    });
    setBusy(false);
    s.toast(`Hak akses ${edit.name} diperbarui.`, 'ok');
    setEdit(null); await load();
  }

  return (
    <>
      <PageHead title="Role &amp; Permission"
        desc="Matriks hak akses. Setiap role dibatasi pada menu tertentu dan aksi tertentu (view, create, edit, approve, post, dan seterusnya)." />

      <Card className="mb12"><CardBody flush>
        <DataTable<Role> rows={rows} rowKey={(r) => r.code} cols={[
          { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
          { t: 'Nama Role', f: (r) => r.name },
          { t: 'Deskripsi', f: (r) => <span className="sm">{r.description || '-'}</span> },
          { t: 'Menu', cls: 'ctr', f: (r) => (r.menus === '*'
            ? <span className="bdg2 b-brand">Semua</span> : r.menus.length) },
          { t: 'Aksi', f: (r) => (r.acts === '*'
            ? <span className="bdg2 b-brand">Semua</span> : <span className="sm">{r.acts.join(', ')}</span>) },
          { t: 'Pengguna', cls: 'ctr', f: (r) => users.filter((u) => u.role_code === r.code).length },
          { t: '', cls: 'ctr', f: (r) => (s.can('edit')
            ? <button className="btn sm" onClick={() => open(r)}>Edit Aksi</button> : null) },
        ]} />
      </CardBody></Card>

      <Card>
        <CardHead title="Matriks Akses Menu" />
        <CardBody flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Menu</th>
                {rows.map((r) => <th key={r.code} className="ctr">{r.code}</th>)}</tr></thead>
              <tbody>
                {MENU.flatMap((g) => [
                  ...(g.grp ? [(
                    <tr key={'g:' + g.grp}>
                      <td colSpan={rows.length + 1} className="bold"
                        style={{ background: 'var(--brand-25)' }}>{g.grp}</td>
                    </tr>
                  )] : []),
                  ...g.items.map((it) => (
                    <tr key={it.k}>
                      <td>{it.t}</td>
                      {rows.map((r) => {
                        const ok = r.menus === '*' || r.menus.indexOf(it.k) >= 0;
                        return <td key={r.code} className="ctr">{ok
                          ? <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓</span>
                          : <span className="mut">—</span>}</td>;
                      })}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} size="mid">
        {edit ? (<>
          <ModalHead title={'Hak Aksi — ' + edit.name} onClose={() => setEdit(null)}
            sub="Centang aksi yang diizinkan untuk role ini." />
          <ModalBody>
            {edit.acts === '*' ? (
              <div className="info-box mb12">Role ini memiliki seluruh aksi. Mengubah daftar di bawah akan membatasi aksesnya.</div>
            ) : null}
            <div className="fg c2">
              {ACTIONS.map((a) => (
                <label key={a} className="flexr" style={{ padding: '7px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={acts.includes(a)} style={{ width: 'auto' }}
                    onChange={(e) => setActs(e.target.checked
                      ? [...acts, a] : acts.filter((x) => x !== a))} />
                  {' '}<span>{a}</span>
                </label>
              ))}
            </div>
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
