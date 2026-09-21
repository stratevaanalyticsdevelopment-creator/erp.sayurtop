'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { useGl } from '@/lib/use-gl';
import { bsData, trialBalance } from '@/lib/gl';
import { rp, rpShort, today } from '@/lib/format';

export default function Page() {
  const s = useStore();
  const [asOf, setAsOf] = useState(today());
  const { rows, loading } = useGl(null, asOf);
  const d = bsData(trialBalance(rows, s.coa));

  const sect = (title: string, arr: { code: string; name: string; bal: number }[], extra?: React.ReactNode) => (
    <>
      <tr><td colSpan={2} className="bold" style={{ background: 'var(--brand-25)' }}>{title}</td></tr>
      {arr.map((a) => (
        <tr key={a.code}><td style={{ paddingLeft: 24 }}>{a.code} — {a.name}</td>
          <td className="num">{rp(a.bal)}</td></tr>
      ))}
      {extra}
    </>
  );

  return (
    <>
      <PageHead title="Neraca (Balance Sheet)"
        desc="Posisi keuangan per tanggal terpilih. Laba tahun berjalan dihitung otomatis dari akun pendapatan dan beban." />
      <div className="fbar">
        <label className="sm mut">Per tanggal</label>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>
      <KpiGrid>
        <Kpi cls="k-blue" lb="Total Aset" vl={rpShort(d.totA)} sb="" />
        <Kpi cls="k-amber" lb="Total Kewajiban" vl={rpShort(d.totL)} sb="" />
        <Kpi cls="k-green" lb="Total Ekuitas" vl={rpShort(d.totE)} sb={`Termasuk laba berjalan ${rpShort(d.profit)}`} />
        <Kpi cls={Math.abs(d.diff) < 1 ? 'k-green' : 'k-red'} lb="Selisih (Balance Check)" vl={rp(d.diff)}
          sb={Math.abs(d.diff) < 1 ? 'Neraca seimbang' : 'Periksa jurnal'} />
      </KpiGrid>
      {loading ? <div className="mut" style={{ padding: 20 }}>Memuat…</div> : (
        <div className="grid-2">
          <Card>
            <CardHead title="Aset" />
            <CardBody flush><div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Akun</th><th className="num" style={{ width: 190 }}>Saldo</th></tr></thead>
              <tbody>
                {sect('ASET', d.assets)}
                <tr><td className="bold">TOTAL ASET</td><td className="num bold">{rp(d.totA)}</td></tr>
              </tbody>
            </table></div></CardBody>
          </Card>
          <Card>
            <CardHead title="Kewajiban & Ekuitas" />
            <CardBody flush><div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Akun</th><th className="num" style={{ width: 190 }}>Saldo</th></tr></thead>
              <tbody>
                {sect('KEWAJIBAN', d.liab,
                  <tr><td className="bold" style={{ paddingLeft: 24 }}>Total Kewajiban</td>
                    <td className="num bold">{rp(d.totL)}</td></tr>)}
                {sect('EKUITAS', d.eq, <>
                  <tr><td style={{ paddingLeft: 24 }}>Laba (Rugi) Tahun Berjalan</td>
                    <td className="num">{rp(d.profit)}</td></tr>
                  <tr><td className="bold" style={{ paddingLeft: 24 }}>Total Ekuitas</td>
                    <td className="num bold">{rp(d.totE)}</td></tr>
                </>)}
                <tr><td className="bold">TOTAL KEWAJIBAN &amp; EKUITAS</td>
                  <td className="num bold">{rp(d.totL + d.totE)}</td></tr>
              </tbody>
            </table></div></CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
