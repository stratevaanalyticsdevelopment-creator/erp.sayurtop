'use client';
/* System Settings — identitas perusahaan dan parameter transaksi.
   Berbeda dari versi HTML yang menyimpan ke localStorage, nilai di sini
   tersimpan pada tabel `settings` di Supabase dan berlaku untuk semua
   pengguna. Backup/restore/reset lokal karena itu tidak lagi relevan;
   penggantinya adalah ekspor data dan backup bawaan Supabase. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import { Card, CardBody, CardHead, F, Fg, Kv, PageHead } from '@/components/ui';
import { num, today } from '@/lib/format';
import type { Company, Settings } from '@/lib/types';

const EMPTY_CO: Company = {
  name: '', legal: '', addr: '', phone: '', email: '', npwp: '', bank: '',
};

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [co, setCo] = useState<Company>(s.settings?.company || EMPTY_CO);
  const [st, setSt] = useState<Settings | null>(s.settings);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (s.settings) { setCo(s.settings.company); setSt(s.settings); }
  }, [s.settings]);

  const loadCounts = useCallback(async () => {
    const tables = ['product', 'customer', 'sales_order', 'delivery', 'invoice',
      'credit_note', 'payment', 'journal', 'audit_log'];
    const res = await Promise.all(tables.map((t) =>
      supabase.from(t).select('*', { count: 'exact', head: true })));
    const m: Record<string, number> = {};
    tables.forEach((t, i) => { m[t] = res[i].count || 0; });
    setCounts(m);
  }, [supabase]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  async function saveCo() {
    setBusy(true);
    const { error } = await supabase.from('settings').update({ company: co }).eq('id', 1);
    if (error) { setBusy(false); s.toast(errMsg(error), 'err'); return; }
    await supabase.rpc('write_audit', {
      p_action: 'EDIT SETTINGS', p_doc: 'company', p_field: '-',
      p_before: '-', p_after: 'identitas perusahaan diperbarui',
    });
    setBusy(false);
    await s.reloadMaster();
    s.toast('Identitas perusahaan tersimpan.', 'ok');
  }

  async function saveParam() {
    if (!st) return;
    setBusy(true);
    const { error } = await supabase.from('settings').update({
      vat_rate: st.vat_rate, default_term: st.default_term, default_warehouse: st.default_warehouse,
      approval_order_limit: st.approval_order_limit, approval_disc_limit: st.approval_disc_limit,
    }).eq('id', 1);
    if (error) { setBusy(false); s.toast(errMsg(error), 'err'); return; }
    await supabase.rpc('write_audit', {
      p_action: 'EDIT SETTINGS', p_doc: 'parameter', p_field: '-',
      p_before: '-', p_after: 'parameter transaksi diperbarui',
    });
    setBusy(false);
    await s.reloadMaster();
    s.toast('Parameter tersimpan.', 'ok');
  }

  async function exportMaster() {
    setBusy(true);
    const tables = ['product', 'customer', 'salesperson', 'warehouse', 'driver', 'vehicle',
      'payment_term', 'tax', 'bank_account', 'coa', 'app_role', 'settings'];
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
    for (const t of tables) {
      const { data } = await supabase.from(t).select('*');
      out[t] = data || [];
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `strateva-o2c-sayurtop-master-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBusy(false);
    s.toast('Master data diunduh.', 'ok');
  }

  const editable = s.can('edit');

  return (
    <>
      <PageHead title="System Settings"
        desc="Parameter umum aplikasi dan identitas perusahaan yang tercetak pada dokumen." />

      <div className="grid-2">
        <Card>
          <CardHead title="Identitas Perusahaan" />
          <CardBody>
            <Fg c={2}>
              <F label="Nama Perusahaan" full>
                <input value={co.name} onChange={(e) => setCo({ ...co, name: e.target.value })} /></F>
              <F label="Badan Hukum" full>
                <input value={co.legal} onChange={(e) => setCo({ ...co, legal: e.target.value })} /></F>
              <F label="Alamat" full>
                <textarea value={co.addr} onChange={(e) => setCo({ ...co, addr: e.target.value })} /></F>
              <F label="Telepon">
                <input value={co.phone} onChange={(e) => setCo({ ...co, phone: e.target.value })} /></F>
              <F label="Email">
                <input value={co.email} onChange={(e) => setCo({ ...co, email: e.target.value })} /></F>
              <F label="NPWP">
                <input value={co.npwp} onChange={(e) => setCo({ ...co, npwp: e.target.value })} /></F>
              <F label="Rekening Bank">
                <input value={co.bank} onChange={(e) => setCo({ ...co, bank: e.target.value })} /></F>
            </Fg>
            <button className="btn pri mt14" onClick={saveCo} disabled={busy || !editable}>Simpan Identitas</button>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Parameter Transaksi" />
          <CardBody>
            <Fg c={2}>
              <F label="Tarif PPN Default (%)">
                <input type="number" value={st?.vat_rate ?? 0}
                  onChange={(e) => st && setSt({ ...st, vat_rate: Number(e.target.value) || 0 })} /></F>
              <F label="Termin Default">
                <select value={st?.default_term || ''}
                  onChange={(e) => st && setSt({ ...st, default_term: e.target.value })}>
                  {s.terms.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                </select></F>
              <F label="Gudang Default">
                <select value={st?.default_warehouse || ''}
                  onChange={(e) => st && setSt({ ...st, default_warehouse: e.target.value })}>
                  {s.warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
                </select></F>
              <F label="Batas Order Butuh Approval">
                <input type="number" step={1000000} value={st?.approval_order_limit ?? 0}
                  onChange={(e) => st && setSt({ ...st, approval_order_limit: Number(e.target.value) || 0 })} /></F>
              <F label="Batas Diskon Butuh Approval (%)">
                <input type="number" value={st?.approval_disc_limit ?? 0}
                  onChange={(e) => st && setSt({ ...st, approval_disc_limit: Number(e.target.value) || 0 })} /></F>
              <F label="Mata Uang"><input value={st?.currency || 'IDR'} disabled /></F>
            </Fg>
            <button className="btn pri mt14" onClick={saveParam} disabled={busy || !editable}>Simpan Parameter</button>
          </CardBody>
        </Card>
      </div>

      <Card className="mt14">
        <CardHead title="Data &amp; Pemeliharaan" />
        <CardBody>
          <div className="kv mb12">
            <span className="k">Produk</span><span className="v">{num(counts.product || 0, 0)} SKU</span>
            <span className="k">Customer</span><span className="v">{num(counts.customer || 0, 0)}</span>
            <span className="k">Sales Order</span><span className="v">{num(counts.sales_order || 0, 0)}</span>
            <span className="k">Surat Jalan</span><span className="v">{num(counts.delivery || 0, 0)}</span>
            <span className="k">Invoice</span><span className="v">{num(counts.invoice || 0, 0)}</span>
            <span className="k">Credit Note</span><span className="v">{num(counts.credit_note || 0, 0)}</span>
            <span className="k">Payment</span><span className="v">{num(counts.payment || 0, 0)}</span>
            <span className="k">Jurnal</span><span className="v">{num(counts.journal || 0, 0)}</span>
            <span className="k">Audit Log</span><span className="v">{num(counts.audit_log || 0, 0)} entri</span>
          </div>
          <div className="flexr" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={exportMaster} disabled={busy}>⇩ Export Master Data (JSON)</button>
          </div>
          <div className="warn-box mt14">Seluruh data tersimpan di Supabase, bukan di peramban. Backup
            berkala dan <i>point-in-time recovery</i> diatur dari dashboard Supabase
            (<b>Database → Backups</b>), sehingga tombol restore dan reset lokal tidak lagi disediakan di sini.</div>
        </CardBody>
      </Card>

      <Card className="mt14">
        <CardHead title="Keamanan Akses" />
        <CardBody>
          <Kv rows={[
            ['Model otorisasi', 'Row Level Security di Postgres — aturan diterapkan di database, bukan di antarmuka.'],
            ['Pemeriksa hak akses', 'Fungsi rbac(menu, aksi) dipanggil oleh setiap policy tabel.'],
            ['Identitas', 'Supabase Auth; app_user.id dipetakan ke auth.uid().'],
            ['Konsekuensi', 'Menyembunyikan tombol di antarmuka bukan satu-satunya pengaman; permintaan langsung ke API tetap ditolak database bila hak akses tidak memadai.'],
          ]} />
        </CardBody>
      </Card>
    </>
  );
}
