'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Card, CardBody, DataTable, F, Fg, Kpi, KpiGrid, Kv, Modal, ModalBody, ModalFoot, ModalHead,
  PageHead, SecT, Timeline,
} from '@/components/ui';
import { invOutstanding } from '@/lib/calc';
import { dDiff, dFmt, dFmtL, num, rp, rpShort, today } from '@/lib/format';
import type { Collection, Invoice } from '@/lib/types';

type Hist = { collection_no: string; contact_date: string; channel: string; note: string | null; by_user: string | null };

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [inv, setInv] = useState<Invoice[]>([]);
  const [cols, setCols] = useState<Collection[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [add, setAdd] = useState<Invoice | null>(null);
  const [form, setForm] = useState({ date: today(), ch: 'Telepon', note: '', promise: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [iv, c, h] = await Promise.all([
      supabase.from('invoice_view').select('*').gt('outstanding', 0).order('due_date'),
      supabase.from('collection').select('*'),
      supabase.from('collection_history').select('*').order('contact_date'),
    ]);
    setInv((iv.data as Invoice[]) || []);
    setCols((c.data as Collection[]) || []);
    setHist((h.data as Hist[]) || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const T = today();
  const rows = inv.map((i) => ({ inv: i, col: cols.find((c) => c.invoice_no === i.no), od: dDiff(i.due_date, T) }))
    .sort((a, b) => b.od - a.od);
  const colHist = (no?: string) => hist.filter((h) => h.collection_no === no);

  async function saveActivity() {
    if (!add) return;
    if (!form.note.trim()) { s.toast('Catatan wajib diisi.', 'err'); return; }
    setBusy(true);
    let col = cols.find((c) => c.invoice_no === add.no);
    if (!col) {
      const { data: no, error: e1 } = await supabase.rpc('next_doc_no', { p_prefix: 'COL' });
      if (e1) { setBusy(false); s.toast(errMsg(e1), 'err'); return; }
      const { error: e2 } = await supabase.from('collection').insert({
        no, invoice_no: add.no, customer_code: add.customer_code, amount: invOutstanding(add),
        due_date: add.due_date, status: dDiff(add.due_date, T) > 0 ? 'OVERDUE' : 'OPEN',
        promise_date: form.promise || null,
      });
      if (e2) { setBusy(false); s.toast(errMsg(e2), 'err'); return; }
      col = { no: no as string } as Collection;
    } else if (form.promise) {
      await supabase.from('collection').update({ promise_date: form.promise }).eq('no', col.no);
    }
    const { error } = await supabase.from('collection_history').insert({
      collection_no: col.no, contact_date: form.date, channel: form.ch,
      note: form.note.trim(), by_user: s.profile?.username,
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast('Aktivitas penagihan tercatat.', 'ok');
    setAdd(null); setForm({ date: today(), ch: 'Telepon', note: '', promise: '' }); await load();
  }

  return (
    <>
      <PageHead title="Collection / Penagihan"
        desc="Daftar tugas penagihan beserta riwayat kontak dengan pelanggan. Invoice dengan umur piutang terbesar ditampilkan lebih dulu." />
      <KpiGrid>
        <Kpi cls="k-amber" lb="Perlu Ditagih" vl={`${num(rows.filter((r) => r.od > -7).length, 0)} invoice`}
          sb={rpShort(rows.filter((r) => r.od > -7).reduce((a, b) => a + invOutstanding(b.inv), 0))} />
        <Kpi cls="k-red" lb="Overdue" vl={`${num(rows.filter((r) => r.od > 0).length, 0)} invoice`}
          sb={rpShort(rows.filter((r) => r.od > 0).reduce((a, b) => a + invOutstanding(b.inv), 0))} />
        <Kpi cls="k-blue" lb="Janji Bayar" vl={`${num(cols.filter((c) => c.promise_date).length, 0)} customer`}
          sb="Promise to pay tercatat" />
        <Kpi cls="k-blue" lb="Kontak 30 Hari"
          vl={`${num(hist.filter((h) => dDiff(h.contact_date, T) <= 30).length, 0)} aktivitas`} sb="" />
      </KpiGrid>
      <Card><CardBody flush>
        <DataTable rows={rows} rowKey={(r) => r.inv.no} onRow={(r) => setDetail(r.inv)} cols={[
          { t: 'No. Invoice', f: (r) => <span className="doc-no">{r.inv.no}</span> },
          { t: 'Customer', f: (r) => <>{s.cust(r.inv.customer_code).name}
            <div className="sm mut">{s.cust(r.inv.customer_code).pic || '-'} · {s.cust(r.inv.customer_code).wa || '-'}</div></> },
          { t: 'Jatuh Tempo', f: (r) => dFmt(r.inv.due_date) },
          { t: 'Umur', cls: 'num', f: (r) => r.od > 0
            ? <b style={{ color: 'var(--red)' }}>{r.od} hari</b> : <span className="mut">{-r.od} hari lagi</span> },
          { t: 'Sisa Tagihan', cls: 'num', f: (r) => <b>{rp(invOutstanding(r.inv))}</b> },
          { t: 'Kontak Terakhir', f: (r) => {
            const h = colHist(r.col?.no); const last = h[h.length - 1];
            return last ? <span className="sm">{dFmt(last.contact_date)} · {last.channel}</span>
              : <span className="mut sm">Belum ada</span>;
          } },
          { t: 'Janji Bayar', f: (r) => r.col?.promise_date
            ? <span className="bdg2 b-blue">{dFmt(r.col.promise_date)}</span> : <span className="mut">—</span> },
          { t: '', cls: 'ctr', f: (r) => s.can('create')
            ? <button className="btn sm" onClick={() => setAdd(r.inv)}>+ Catat</button> : null },
        ]} />
      </CardBody></Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead title={`Penagihan — ${detail.no}`} onClose={() => setDetail(null)}
            sub={`${s.cust(detail.customer_code).name} · sisa ${rp(invOutstanding(detail))} · jatuh tempo ${dFmtL(detail.due_date)}`} />
          <ModalBody>
            <div className="mb12"><Kv rows={[
              ['PIC', s.cust(detail.customer_code).pic || '-'],
              ['Kontak', `${s.cust(detail.customer_code).wa || '-'} · ${s.cust(detail.customer_code).email || '-'}`],
            ]} /></div>
            <SecT>Riwayat Kontak</SecT>
            {(() => {
              const col = cols.find((c) => c.invoice_no === detail.no);
              const h = colHist(col?.no);
              return h.length
                ? <Timeline items={h.map((x) => ({ t: `${x.channel} — ${x.note}`, d: `${dFmtL(x.contact_date)} · ${x.by_user || '-'}` }))} />
                : <div className="info-box">Belum ada aktivitas penagihan untuk invoice ini.</div>;
            })()}
          </ModalBody>
          <ModalFoot>
            {s.can('create') ? <button className="btn pri" onClick={() => { const d = detail; setDetail(null); setAdd(d); }}>+ Catat Aktivitas</button> : null}
            <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      <Modal open={!!add} onClose={() => setAdd(null)} size="mid">
        <ModalHead title="Catat Aktivitas Penagihan" onClose={() => setAdd(null)} />
        <ModalBody>
          <Fg>
            <F label="Tanggal"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></F>
            <F label="Saluran"><select value={form.ch} onChange={(e) => setForm({ ...form, ch: e.target.value })}>
              <option>Telepon</option><option>WhatsApp</option><option>Email</option>
              <option>Kunjungan</option><option>Surat Tagihan</option></select></F>
            <F label="Catatan" full><textarea value={form.note} placeholder="Hasil pembicaraan dengan customer"
              onChange={(e) => setForm({ ...form, note: e.target.value })} /></F>
            <F label="Janji Bayar (opsional)" full><input type="date" value={form.promise}
              onChange={(e) => setForm({ ...form, promise: e.target.value })} /></F>
          </Fg>
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setAdd(null)}>Batal</button>
          <button className="btn pri" onClick={saveActivity} disabled={busy}>Simpan</button>
        </ModalFoot>
      </Modal>
    </>
  );
}
