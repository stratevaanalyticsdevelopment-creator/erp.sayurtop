'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Card, CardBody, DataTable, F, Fg, Modal, ModalBody, ModalFoot, ModalHead, PageHead, Prog, SecT,
} from '@/components/ui';
import { rp } from '@/lib/format';
import type { Customer } from '@/lib/types';

const TYPES = ['Hotel', 'Restoran', 'Katering', 'Retail', 'Cloud Kitchen', 'Kafe', 'Institusi', 'Lainnya'];

export default function Page() {
  const s = useStore();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState('');
  const [os, setOs] = useState<Map<string, number>>(new Map());
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('invoice_view').select('customer_code,outstanding').gt('outstanding', 0);
      const m = new Map<string, number>();
      ((data as { customer_code: string; outstanding: number }[]) || []).forEach((r) =>
        m.set(r.customer_code, (m.get(r.customer_code) || 0) + Number(r.outstanding)));
      setOs(m);
    })();
  }, [supabase]);

  const rows = s.customers.filter((c) =>
    !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase().includes(q.toLowerCase()));

  function open(c: Customer | null) {
    if (!s.can(c ? 'edit' : 'create')) { s.toast('Tidak memiliki hak akses.', 'err'); return; }
    setIsNew(!c);
    setEdit(c ? { ...c } : {
      code: '', name: '', type: 'Restoran', npwp: '-', credit_limit: 50000000,
      term_code: s.terms[0]?.code, salesperson_code: s.salespersons[0]?.code,
      wa: '', email: '', pic: '', billing_address: '', shipping_address: '', active: true,
    });
  }
  async function save() {
    if (!edit?.name?.trim()) { s.toast('Nama customer wajib diisi.', 'err'); return; }
    const code = edit.code?.trim() || 'CUST-' + String(s.customers.length + 1).padStart(4, '0');
    setBusy(true);
    const payload = { ...edit, code, credit_limit: Number(edit.credit_limit) || 0 };
    const { error } = isNew
      ? await supabase.from('customer').insert(payload)
      : await supabase.from('customer').update(payload).eq('code', code);
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast('Customer tersimpan.', 'ok');
    setEdit(null); await s.reloadMaster();
  }

  return (
    <>
      <PageHead title="Master Customer"
        desc="Data pelanggan menjadi sumber tunggal untuk alamat, termin, pajak, dan credit limit di seluruh dokumen."
        actions={s.can('create') ? <button className="btn pri" onClick={() => open(null)}>+ Customer Baru</button> : undefined} />

      <div className="fbar">
        <input className="grow" placeholder="Cari nama atau kode customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sm mut">{rows.length} customer</span>
      </div>

      <Card><CardBody flush>
        <DataTable<Customer> rows={rows} rowKey={(r) => r.code}
          onRow={(c) => router.push(`/ar/statement?cust=${c.code}`)}
          cols={[
            { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
            { t: 'Nama', f: (r) => <>{r.name}<div className="sm mut">{r.pic || '-'} · {r.wa || '-'}</div></> },
            { t: 'Tipe', f: (r) => <span className="bdg2 b-brand">{r.type || '-'}</span> },
            { t: 'Termin', f: (r) => s.termOf(r.term_code).name },
            { t: 'Credit Limit', cls: 'num', f: (r) => rp(r.credit_limit) },
            { t: 'AR Berjalan', cls: 'num', f: (r) => {
              const v = os.get(r.code) || 0;
              return <span style={{ color: r.credit_limit > 0 && v > r.credit_limit ? 'var(--red)' : 'inherit' }}>{rp(v)}</span>;
            } },
            { t: 'Pemakaian Limit', f: (r) => <Prog pct={r.credit_limit ? Math.min(100, Math.round(((os.get(r.code) || 0) / r.credit_limit) * 100)) : 0} /> },
            { t: 'Sales', f: (r) => <span className="sm">{s.sp(r.salesperson_code).name}</span> },
            { t: '', cls: 'ctr', f: (r) => s.can('edit')
              ? <button className="btn sm" onClick={() => open(r)}>Edit</button> : null },
          ]} />
      </CardBody></Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} size="mid">
        {edit ? (<>
          <ModalHead title={isNew ? 'Customer Baru' : 'Edit ' + edit.name} onClose={() => setEdit(null)} />
          <ModalBody>
            <SecT>Identitas</SecT>
            <Fg>
              <F label="Kode Customer"><input value={edit.code || ''} disabled={!isNew} placeholder="otomatis"
                onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></F>
              <F label="Nama"><input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></F>
              <F label="Tipe"><select value={edit.type || ''} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
              <F label="NPWP"><input value={edit.npwp || ''} onChange={(e) => setEdit({ ...edit, npwp: e.target.value })} /></F>
            </Fg>
            <SecT>Alamat &amp; Kontak</SecT>
            <Fg c={2}>
              <F label="Alamat Penagihan"><textarea value={edit.billing_address || ''}
                onChange={(e) => setEdit({ ...edit, billing_address: e.target.value })} /></F>
              <F label="Alamat Pengiriman"><textarea value={edit.shipping_address || ''}
                onChange={(e) => setEdit({ ...edit, shipping_address: e.target.value })} /></F>
              <F label="Contact Person"><input value={edit.pic || ''} onChange={(e) => setEdit({ ...edit, pic: e.target.value })} /></F>
              <F label="WhatsApp / Telepon"><input value={edit.wa || ''} onChange={(e) => setEdit({ ...edit, wa: e.target.value })} /></F>
              <F label="Email" full><input value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></F>
            </Fg>
            <SecT>Komersial</SecT>
            <Fg c={3}>
              <F label="Credit Limit"><input type="number" value={edit.credit_limit ?? 0}
                onChange={(e) => setEdit({ ...edit, credit_limit: Number(e.target.value) })} /></F>
              <F label="Termin Pembayaran"><select value={edit.term_code || ''}
                onChange={(e) => setEdit({ ...edit, term_code: e.target.value })}>
                {s.terms.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></F>
              <F label="Sales Person"><select value={edit.salesperson_code || ''}
                onChange={(e) => setEdit({ ...edit, salesperson_code: e.target.value })}>
                {s.salespersons.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></F>
            </Fg>
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
