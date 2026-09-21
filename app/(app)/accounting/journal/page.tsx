'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, DataTable, Modal, ModalBody, ModalFoot, ModalHead, PageHead } from '@/components/ui';
import { dAdd, dFmt, dFmtL, rp, today } from '@/lib/format';
import type { Journal, JournalLine } from '@/lib/types';

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

  async function open(j: Journal) {
    const { data } = await supabase.from('journal_line').select('*').eq('journal_no', j.no).order('line_no');
    setJl((data as JournalLine[]) || []); setDetail(j);
  }

  return (
    <>
      <PageHead title="General Journal"
        desc="Seluruh jurnal yang dihasilkan sistem. Transaksi operasional (invoice, retur, pembayaran) menghasilkan jurnal otomatis sehingga tidak perlu penjurnalan manual." />
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
    </>
  );
}
