'use client';
/* Kerangka halaman master sederhana: daftar + form tambah/ubah.
   Dipakai ulang oleh Warehouse, Sales Person, Driver, Tax, Payment Term,
   Bank Account, dan COA agar markup-nya konsisten dengan versi HTML. */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import { Card, CardBody, Col, DataTable, F, Fg, Modal, ModalBody, ModalFoot, ModalHead, PageHead } from './ui';

export type FieldDef = {
  k: string; t: string; type?: 'text' | 'number'; lock?: boolean; full?: boolean;
  options?: { v: string; t: string }[];
};

export function SimpleMaster<T extends Record<string, unknown>>({
  title, desc, table, idKey, cols, fields, addLabel, orderBy,
}: {
  title: string; desc: React.ReactNode; table: string; idKey: string;
  cols: Col<T>[]; fields: FieldDef[]; addLabel?: string; orderBy?: string;
}) {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<T[]>([]);
  const [edit, setEdit] = useState<T | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useMemo(() => async () => {
    const { data } = await supabase.from(table).select('*').order(orderBy || idKey);
    setRows((data as T[]) || []);
  }, [supabase, table, idKey, orderBy]);

  useEffect(() => { load(); }, [load]);

  function open(row: T | null) {
    if (!s.can(row ? 'edit' : 'create')) {
      s.toast(`Role ${s.profile?.role_name} tidak memiliki hak akses "${row ? 'edit' : 'create'}".`, 'err');
      return;
    }
    setIsNew(!row);
    setEdit(row || ({} as T));
    const f: Record<string, string> = {};
    fields.forEach((fd) => { f[fd.k] = row ? String((row as Record<string, unknown>)[fd.k] ?? '') : ''; });
    setForm(f);
  }

  async function save() {
    const payload: Record<string, unknown> = {};
    fields.forEach((fd) => {
      const v = form[fd.k] ?? '';
      payload[fd.k] = fd.type === 'number' ? Number(v) || 0 : v;
    });
    if (!payload[idKey]) { s.toast('Kode wajib diisi.', 'err'); return; }
    setBusy(true);
    const q = isNew
      ? supabase.from(table).insert(payload)
      : supabase.from(table).update(payload).eq(idKey, (edit as Record<string, unknown>)[idKey] as string);
    const { error } = await q;
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`${title} tersimpan.`, 'ok');
    setEdit(null);
    await load();
    await s.reloadMaster();
  }

  const allCols: Col<T>[] = s.can('edit')
    ? [...cols, { t: '', cls: 'ctr', f: (r) => <button className="btn sm" onClick={() => open(r)}>Edit</button> }]
    : cols;

  return (
    <>
      <PageHead title={title} desc={desc}
        actions={s.can('create')
          ? <button className="btn pri" onClick={() => open(null)}>+ {addLabel || 'Tambah'}</button>
          : undefined} />
      <Card><CardBody flush><DataTable cols={allCols} rows={rows} /></CardBody></Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} size="mid">
        {edit ? (
          <>
            <ModalHead title={(isNew ? 'Tambah ' : 'Edit ') + title} onClose={() => setEdit(null)} />
            <ModalBody>
              <Fg c={2}>
                {fields.map((fd) => (
                  <F key={fd.k} label={fd.t} full={fd.full}>
                    {fd.options ? (
                      <select value={form[fd.k] ?? ''} onChange={(e) => setForm({ ...form, [fd.k]: e.target.value })}>
                        {fd.options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                      </select>
                    ) : (
                      <input type={fd.type === 'number' ? 'number' : 'text'} value={form[fd.k] ?? ''}
                        disabled={!isNew && fd.lock}
                        onChange={(e) => setForm({ ...form, [fd.k]: e.target.value })} />
                    )}
                  </F>
                ))}
              </Fg>
            </ModalBody>
            <ModalFoot>
              <button className="btn" onClick={() => setEdit(null)}>Batal</button>
              <button className="btn pri" onClick={save} disabled={busy}>Simpan</button>
            </ModalFoot>
          </>
        ) : null}
      </Modal>
    </>
  );
}
