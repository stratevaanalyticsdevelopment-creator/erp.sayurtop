'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardBody, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { useGl } from '@/lib/use-gl';
import { dAdd, dFmt, num, rp, today } from '@/lib/format';
import type { GlRow } from '@/lib/gl';
import { downloadCsv } from '@/lib/csv';

export default function Page() {
  const s = useStore();
  const [acc, setAcc] = useState('1200');
  const [from, setFrom] = useState(dAdd(today(), -60));
  const [to, setTo] = useState(today());
  const { rows } = useGl(from, to, acc);
  const { rows: prior } = useGl(null, dAdd(from, -1), acc);

  const a = s.coa.find((x) => x.code === acc);
  const openBal = prior.reduce((sum, l) => sum + (a?.normal === 'D' ? l.d - l.c : l.c - l.d), 0);
  let bal = openBal;
  const withRun = rows.map((l) => { bal += a?.normal === 'D' ? l.d - l.c : l.c - l.d; return { ...l, run: bal }; });

  function exportCsv() {
    downloadCsv('gl',
      ['Tanggal', 'No Jurnal', 'Referensi', 'Keterangan', 'Debit', 'Kredit', 'Saldo'],
      withRun.map((l) => [l.date, l.jno, l.ref || '', l.desc || '', l.d, l.c, l.run]));
  }

  return (
    <>
      <PageHead title="General Ledger"
        desc="Buku besar per akun beserta saldo berjalan. Setiap baris dapat ditelusuri kembali ke dokumen sumbernya."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />
      <div className="fbar">
        <select value={acc} onChange={(e) => setAcc(e.target.value)}>
          {s.coa.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.name}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <KpiGrid>
        <Kpi cls="k-blue" lb="Saldo Awal" vl={rp(openBal)} sb={`s/d ${dFmt(dAdd(from, -1))}`} />
        <Kpi cls="k-green" lb="Mutasi Debit" vl={rp(rows.reduce((x, l) => x + l.d, 0))} sb={`${num(rows.length, 0)} baris`} />
        <Kpi cls="k-amber" lb="Mutasi Kredit" vl={rp(rows.reduce((x, l) => x + l.c, 0))} sb="" />
        <Kpi cls="k-acc" lb="Saldo Akhir" vl={rp(bal)} sb={dFmt(to)} />
      </KpiGrid>
      <Card><CardBody flush>
        <DataTable<GlRow & { run: number }> rows={withRun} cols={[
          { t: 'Tanggal', f: (l) => dFmt(l.date) },
          { t: 'No. Jurnal', f: (l) => <span className="doc-no">{l.jno}</span> },
          { t: 'Referensi', f: (l) => <span className="sm mono">{l.ref || '-'}</span> },
          { t: 'Keterangan', f: (l) => <span className="sm">{l.desc}</span> },
          { t: 'Debit', cls: 'num', f: (l) => l.d ? rp(l.d) : <span className="mut">—</span> },
          { t: 'Kredit', cls: 'num', f: (l) => l.c ? rp(l.c) : <span className="mut">—</span> },
          { t: 'Saldo', cls: 'num', f: (l) => <b>{rp(l.run)}</b> },
        ]} />
      </CardBody></Card>
    </>
  );
}
