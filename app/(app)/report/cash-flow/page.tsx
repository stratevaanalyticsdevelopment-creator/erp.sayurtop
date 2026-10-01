'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardBody, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { useGl } from '@/lib/use-gl';
import { cashFlowData, type CfRow } from '@/lib/gl';
import { dAdd, dFmt, rp, rpShort, today, ymOf } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import { PrintReport } from '@/components/print-docs';

export default function Page() {
  const s = useStore();
  const [from, setFrom] = useState(ymOf(today()) + '-01');
  const [to, setTo] = useState(today());
  const { rows, loading } = useGl(from, to);
  const { rows: prior } = useGl(null, dAdd(from, -1));
  const openBal = prior.filter((l) => l.acc === '1110').reduce((a, l) => a + l.d - l.c, 0);
  const d = cashFlowData(rows, s.accName, openBal);

  const [print, setPrint] = useState(false);
  const prRows = [
    { label: 'Kas Awal Periode', value: d.open, bold: true },
    { label: 'ARUS KAS OPERASI', bold: true },
    ...d.ops.map((r) => ({ label: r.name, value: r.amt, indent: true })),
    { label: 'Total Arus Kas Operasi', value: d.totOps, bold: true },
    { label: 'ARUS KAS INVESTASI', bold: true },
    ...d.inv.map((r) => ({ label: r.name, value: r.amt, indent: true })),
    { label: 'Total Arus Kas Investasi', value: d.totInv, bold: true },
    { label: 'ARUS KAS PENDANAAN', bold: true },
    ...d.fin.map((r) => ({ label: r.name, value: r.amt, indent: true })),
    { label: 'Total Arus Kas Pendanaan', value: d.totFin, bold: true },
    { label: 'Kas Akhir Periode', value: d.close, bold: true, sep: true },
  ];
  function exportCsv() {
    downloadCsv('cf', ['Keterangan', 'Jumlah'],
      prRows.map((r) => [r.label, typeof r.value === 'number' ? r.value : '']));
  }

  const sect = (title: string, arr: CfRow[], tot: number) => (
    <>
      <tr><td colSpan={2} className="bold" style={{ background: 'var(--brand-25)' }}>{title}</td></tr>
      {arr.length ? arr.map((r) => (
        <tr key={r.acc}><td style={{ paddingLeft: 24 }}>{r.name}</td>
          <td className="num" style={{ color: r.amt < 0 ? 'var(--red)' : 'inherit' }}>
            {r.amt < 0 ? `(${rp(-r.amt)})` : rp(r.amt)}</td></tr>
      )) : (
        <tr><td style={{ paddingLeft: 24 }} className="mut">Tidak ada transaksi</td>
          <td className="num mut">—</td></tr>
      )}
      <tr><td className="bold" style={{ paddingLeft: 24 }}>Arus Kas Bersih</td>
        <td className="num bold">{tot < 0 ? `(${rp(-tot)})` : rp(tot)}</td></tr>
    </>
  );

  return (
    <>
      <PageHead title="Laporan Arus Kas (Cash Flow)"
        desc="Metode langsung — disusun dari seluruh mutasi akun Kas & Bank, dikelompokkan menurut lawan akunnya."
        actions={<>
          <button className="btn" onClick={() => setPrint(true)}>🖨 Cetak</button>
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />
      <div className="fbar">
        <label className="sm mut">Periode</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <KpiGrid>
        <Kpi cls="k-blue" lb="Kas Awal" vl={rpShort(d.open)} sb={dFmt(from)} />
        <Kpi cls={d.totOps >= 0 ? 'k-green' : 'k-red'} lb="Arus Kas Operasi" vl={rpShort(d.totOps)} sb="" />
        <Kpi cls="k-amber" lb="Arus Kas Investasi" vl={rpShort(d.totInv)} sb="" />
        <Kpi cls="k-acc" lb="Kas Akhir" vl={rpShort(d.close)} sb={dFmt(to)} />
      </KpiGrid>
      <Card><CardBody flush>
        {loading ? <div className="mut" style={{ padding: 20 }}>Memuat…</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Keterangan</th><th className="num" style={{ width: 220 }}>Jumlah</th></tr></thead>
            <tbody>
              <tr><td className="bold">Saldo Kas Awal Periode</td><td className="num bold">{rp(d.open)}</td></tr>
              {sect('ARUS KAS DARI AKTIVITAS OPERASI', d.ops, d.totOps)}
              {sect('ARUS KAS DARI AKTIVITAS INVESTASI', d.inv, d.totInv)}
              {sect('ARUS KAS DARI AKTIVITAS PENDANAAN', d.fin, d.totFin)}
              <tr><td className="bold">Kenaikan (Penurunan) Kas Bersih</td>
                <td className="num bold">{rp(d.totOps + d.totInv + d.totFin)}</td></tr>
              <tr><td className="bold">Saldo Kas Akhir Periode</td><td className="num bold">{rp(d.close)}</td></tr>
            </tbody>
          </table></div>
        )}
      </CardBody></Card>
      {print ? <PrintReport title="Laporan Arus Kas" period={`Periode ${from} s/d ${to}`}
        rows={prRows} onClose={() => setPrint(false)} /> : null}
    </>
  );
}
