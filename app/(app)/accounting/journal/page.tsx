'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import {
  Card, CardBody, DataTable, F, Fg, Modal, ModalBody, ModalFoot, ModalHead, PageHead, SecT,
} from '@/components/ui';
import { dAdd, dFmt, dFmtL, rp, today } from '@/lib/format';
import type { Journal, JournalLine } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';
import { errMsg } from '@/lib/store';

type JvLine = { acc: string; desc: string; d: number; c: number };

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Journal[]>([]);
  const [from, setFrom] = useState(dAdd(today(), -60));
  const [to, setTo] = useState(today());
  const [q, setQ] = useState('');
  const [type, setType] = useState('ALL');
  const [detail, setDetail] = useState<Journal | null>(null);
  const [jl, setJl] = useState<JournalLine[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('journal').select('*')
        .gte('journal_date', from).lte('journal_date', to)
        .order('journal_date', { ascending: false }).order('no', { ascending: false });
      setRows((data as Journal[]) || []);
    })();
  }, [supabase, from, to]);

  const types = [...new Set(rows.map((j) => j.ref_type))].sort();
  const filtered = rows.filter((j) => {
    if (type !== 'ALL' && j.ref_type !== type) return false;
    const t = q.toLowerCase();
    return !t || j.no.toLowerCase().includes(t) || (j.ref || '').toLowerCase().includes(t) ||
      (j.memo || '').toLowerCase().includes(t);
  });

  function exportCsv() {
    downloadCsv('journal',
      ['No Jurnal', 'Tanggal', 'Jenis', 'Referensi', 'Keterangan', 'Debit', 'Kredit', 'Status'],
      filtered.map((j) => [j.no, j.journal_date, j.ref_type, j.ref || '', j.memo || '',
        Number(j.debit), Number(j.credit), j.posted ? 'POSTED' : 'DRAFT']));
  }

  /* ---------- Jurnal manual ---------- */
  const [form, setForm] = useState(false);
  const [jvDate, setJvDate] = useState(today());
  const [jvMemo, setJvMemo] = useState('');
  const [L, setL] = useState<JvLine[]>([]);
  const [busy, setBusy] = useState(false);

  const totD = L.reduce((a, l) => a + (Number(l.d) || 0), 0);
  const totC = L.reduce((a, l) => a + (Number(l.c) || 0), 0);
  const okJv = totD > 0 && totD === totC && L.filter((l) => l.acc && (l.d || l.c)).length >= 2;

  function openForm() {
    if (!s.can('create')) { s.toast('Tidak memiliki hak akses.', 'err'); return; }
    setJvDate(today()); setJvMemo('');
    setL([{ acc: '', desc: '', d: 0, c: 0 }, { acc: '', desc: '', d: 0, c: 0 }]);
    setForm(true);
  }
  function setLine(i: number, patch: Partial<JvLine>) {
    setL(L.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  }

  async function saveJv() {
    if (!okJv) return;
    setBusy(true);
    const lines = L.filter((l) => l.acc && (l.d || l.c))
      .map((l) => ({ acc: l.acc, desc: l.desc || jvMemo || 'Jurnal manual', d: Number(l.d) || 0, c: Number(l.c) || 0 }));
    const { data: no, error } = await supabase.rpc('post_journal', {
      p_date: jvDate, p_ref_type: 'MANUAL', p_ref: '-',
      p_memo: jvMemo.trim() || 'Jurnal manual', p_lines: lines,
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Jurnal ${String(no)} diposting.`, 'ok');
    setForm(false);
    const { data } = await supabase.from('journal').select('*')
      .gte('journal_date', from).lte('journal_date', to)
      .order('journal_date', { ascending: false }).order('no', { ascending: false });
    setRows((data as Journal[]) || []);
  }

  async function open(j: Journal) {
    const { data } = await supabase.from('journal_line').select('*').eq('journal_no', j.no).order('line_no');
    setJl((data as JournalLine[]) || []); setDetail(j);
  }

  return (
    <>
      <PageHead title="General Journal"
        desc="Seluruh jurnal yang dihasilkan sistem. Transaksi operasional (invoice, retur, pembayaran) menghasilkan jurnal otomatis sehingga tidak perlu penjurnalan manual."
        actions={<>
          {s.can('create') ? <button className="btn pri" onClick={openForm}>+ Jurnal Manual</button> : null}
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />
      <div className="fbar">
        <input className="grow" placeholder="Cari nomor jurnal, referensi, atau keterangan…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="ALL">Semua Jenis</option>{types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="sm mut">{filtered.length} jurnal</span>
      </div>
      <Card><CardBody flush>
        <DataTable<Journal> rows={filtered} rowKey={(r) => r.no} onRow={open}
          foot={<tr><td colSpan={5}>Total</td>
            <td className="num">{rp(filtered.reduce((a, b) => a + Number(b.debit), 0))}</td>
            <td className="num">{rp(filtered.reduce((a, b) => a + Number(b.credit), 0))}</td><td /></tr>}
          cols={[
            { t: 'No. Jurnal', f: (j) => <span className="doc-no">{j.no}</span> },
            { t: 'Tanggal', f: (j) => dFmt(j.journal_date) },
            { t: 'Jenis', f: (j) => <span className="bdg2 b-brand">{j.ref_type}</span> },
            { t: 'Referensi', f: (j) => <span className="sm mono">{j.ref || '-'}</span> },
            { t: 'Keterangan', f: (j) => <span className="sm">{j.memo}</span> },
            { t: 'Debit', cls: 'num', f: (j) => rp(j.debit) },
            { t: 'Kredit', cls: 'num', f: (j) => rp(j.credit) },
            { t: 'Balance', cls: 'ctr', f: (j) => Number(j.debit) === Number(j.credit)
              ? <span className="bdg2 b-green">✓</span> : <span className="bdg2 b-red">✕</span> },
          ]} />
      </CardBody></Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} size="mid">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<>{detail.no} <span className="bdg2 b-brand">{detail.ref_type}</span></>}
            sub={`${dFmtL(detail.journal_date)} · ${detail.memo}`} />
          <ModalBody>
            <DataTable<JournalLine> rows={jl}
              foot={<tr><td colSpan={2}>Total</td><td className="num">{rp(detail.debit)}</td>
                <td className="num">{rp(detail.credit)}</td></tr>}
              cols={[
                { t: 'Akun', f: (l) => <><span className="mono sm">{l.account_code}</span> {s.accName(l.account_code)}</> },
                { t: 'Keterangan', f: (l) => <span className="sm mut">{l.description}</span> },
                { t: 'Debit', cls: 'num', f: (l) => l.debit ? rp(l.debit) : <span className="mut">—</span> },
                { t: 'Kredit', cls: 'num', f: (l) => l.credit ? rp(l.credit) : <span className="mut">—</span> },
              ]} />
            <div className="info-box mt14">Referensi dokumen: <b>{detail.ref || '-'}</b></div>
          </ModalBody>
          <ModalFoot><button className="btn" onClick={() => setDetail(null)}>Tutup</button></ModalFoot>
        </>) : null}
      </Modal>
      <Modal open={form} onClose={() => setForm(false)} size="mid">
        <ModalHead title="Jurnal Manual" onClose={() => setForm(false)}
          sub="Gunakan hanya untuk transaksi non-operasional (beban, penyesuaian). Jurnal harus balance." />
        <ModalBody>
          <Fg>
            <F label="Tanggal"><input type="date" value={jvDate} onChange={(e) => setJvDate(e.target.value)} /></F>
            <F label="Keterangan"><input value={jvMemo} onChange={(e) => setJvMemo(e.target.value)}
              placeholder="cth. Beban listrik cold storage September" /></F>
          </Fg>
          <SecT>Baris Jurnal</SecT>
          <table className="lines"><thead><tr><th>Akun</th><th>Keterangan</th>
            <th className="num">Debit</th><th className="num">Kredit</th><th /></tr></thead>
            <tbody>{L.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 230 }}>
                  <select value={l.acc} onChange={(e) => setLine(i, { acc: e.target.value })}>
                    <option value="">— pilih akun —</option>
                    {s.coa.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select></td>
                <td><input value={l.desc} placeholder="Keterangan"
                  onChange={(e) => setLine(i, { desc: e.target.value })} /></td>
                <td style={{ width: 130 }}><input className="num" type="number" min={0} step={1000} value={l.d}
                  onChange={(e) => setLine(i, { d: Number(e.target.value) || 0 })} /></td>
                <td style={{ width: 130 }}><input className="num" type="number" min={0} step={1000} value={l.c}
                  onChange={(e) => setLine(i, { c: Number(e.target.value) || 0 })} /></td>
                <td style={{ width: 38 }}>
                  <button className="del" onClick={() => setL(L.filter((_, x) => x !== i))}>✕</button></td>
              </tr>))}</tbody></table>
          <div className="mt8"><button className="btn sm"
            onClick={() => setL([...L, { acc: '', desc: '', d: 0, c: 0 }])}>+ Tambah Baris</button></div>
          <div className="tot-box mt14">
            <div className="tot-row"><span>Total Debit</span><span className="v">{rp(totD)}</span></div>
            <div className="tot-row"><span>Total Kredit</span><span className="v">{rp(totC)}</span></div>
            <div className="tot-row grand"><span>Selisih</span><span className="v">{rp(totD - totC)}</span></div>
          </div>
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setForm(false)}>Batal</button>
          <button className="btn pri" onClick={saveJv} disabled={!okJv || busy}>Posting Jurnal</button>
        </ModalFoot>
      </Modal>
    </>
  );
}
