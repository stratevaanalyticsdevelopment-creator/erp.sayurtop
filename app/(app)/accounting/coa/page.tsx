'use client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, PageHead } from '@/components/ui';
import { useGl } from '@/lib/use-gl';
import { trialBalance } from '@/lib/gl';
import { rp, today } from '@/lib/format';
import type { Coa } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';
import { createClient } from '@/lib/supabase/client';
import { errMsg } from '@/lib/store';
import { useMemo, useState } from 'react';
import { F, Fg, Modal, ModalBody, ModalFoot, ModalHead } from '@/components/ui';

export default function Page() {
  const s = useStore();
  const { rows } = useGl(null, today());
  const tb = trialBalance(rows, s.coa);
  const groups = new Map<string, Coa[]>();
  s.coa.forEach((a) => groups.set(a.group_name, [...(groups.get(a.group_name) || []), a]));

  const supabase = useMemo(() => createClient(), []);
  const [add, setAdd] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', type: 'ASSET', group_name: '', normal: 'D' });
  const [busy, setBusy] = useState(false);

  async function saveAcc() {
    if (!form.code.trim() || !form.name.trim() || !form.group_name.trim()) {
      s.toast('Kode, nama, dan kelompok wajib diisi.', 'err'); return;
    }
    setBusy(true);
    const { error } = await supabase.from('coa').insert({ ...form, code: form.code.trim() });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast('Akun tersimpan.', 'ok');
    setAdd(false); setForm({ code: '', name: '', type: 'ASSET', group_name: '', normal: 'D' });
    await s.reloadMaster();
  }

  function exportCsv() {
    downloadCsv('coa', ['Kode', 'Nama Akun', 'Tipe', 'Kelompok', 'Saldo Normal', 'Saldo Berjalan'],
      s.coa.map((a) => [a.code, a.name, a.type, a.group_name, a.normal,
        tb.find((x) => x.code === a.code)?.bal ?? 0]));
  }

  return (
    <>
      <PageHead title="Chart of Accounts"
        desc="Daftar akun yang digunakan mesin jurnal otomatis. Perubahan pemetaan akun berdampak langsung pada laporan keuangan."
        actions={<>
          {s.can('create') ? <button className="btn pri" onClick={() => setAdd(true)}>+ Akun Baru</button> : null}
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />
      <div className="info-box mb12">
        <b>Pemetaan akun otomatis:</b> Piutang 1200 · Kas/Bank 1110 · Persediaan 1300 · PPN Keluaran 2200 ·
        Penjualan 4100 · Retur Penjualan 4200 · HPP 5100 · Uang Muka Pelanggan 2400.
      </div>
      {[...groups.entries()].map(([g, list]) => (
        <Card key={g} className="mb12">
          <CardHead title={g} />
          <CardBody flush>
            <DataTable<Coa> rows={list} rowKey={(r) => r.code} cols={[
              { t: 'Kode', f: (a) => <span className="doc-no">{a.code}</span> },
              { t: 'Nama Akun', f: (a) => a.name },
              { t: 'Tipe', f: (a) => <span className="bdg2 b-brand">{a.type}</span> },
              { t: 'Saldo Normal', cls: 'ctr', f: (a) => a.normal === 'D' ? 'Debit' : 'Kredit' },
              { t: 'Saldo Berjalan', cls: 'num', f: (a) => rp(tb.find((x) => x.code === a.code)?.bal || 0) },
            ]} />
          </CardBody>
        </Card>
      ))}
      <Modal open={add} onClose={() => setAdd(false)} size="mid">
        <ModalHead title="Akun Baru" onClose={() => setAdd(false)}
          sub="Akun baru langsung dapat dipakai pada jurnal manual dan laporan keuangan." />
        <ModalBody>
          <Fg c={2}>
            <F label="Kode Akun"><input value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })} /></F>
            <F label="Nama Akun"><input value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} /></F>
            <F label="Tipe"><select value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {['ASSET', 'LIAB', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE'].map((t) => <option key={t}>{t}</option>)}
            </select></F>
            <F label="Saldo Normal"><select value={form.normal}
              onChange={(e) => setForm({ ...form, normal: e.target.value })}>
              <option value="D">Debit</option><option value="C">Kredit</option>
            </select></F>
            <F label="Kelompok" full help="Mis. Aset Lancar, Kewajiban Lancar, Beban Operasional.">
              <input value={form.group_name}
                onChange={(e) => setForm({ ...form, group_name: e.target.value })} /></F>
          </Fg>
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setAdd(false)}>Batal</button>
          <button className="btn pri" onClick={saveAcc} disabled={busy}>Simpan</button>
        </ModalFoot>
      </Modal>
    </>
  );
}
