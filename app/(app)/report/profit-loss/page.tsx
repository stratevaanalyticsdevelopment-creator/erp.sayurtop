'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, Kpi, KpiGrid, PageHead, Seg } from '@/components/ui';
import { useGl } from '@/lib/use-gl';
import { plData, trialBalance } from '@/lib/gl';
import { dFmt, num, rp, rpShort, today, ymOf } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import { PrintReport } from '@/components/print-docs';

function Row({ lb, v, b, ind, neg }: { lb: string; v?: number; b?: boolean; ind?: boolean; neg?: boolean }) {
  return (
    <tr>
      <td style={ind ? { paddingLeft: 28 } : undefined}>{b ? <b>{lb}</b> : lb}</td>
      <td className="num">{v === undefined ? '' : b
        ? <b>{neg ? `(${rp(Math.abs(v))})` : rp(v)}</b>
        : (neg ? `(${rp(Math.abs(v))})` : rp(v))}</td>
    </tr>
  );
}

export default function Page() {
  const s = useStore();
  const [from, setFrom] = useState(ymOf(today()) + '-01');
  const [to, setTo] = useState(today());
  const { rows, loading } = useGl(from, to);
  const d = plData(trialBalance(rows, s.coa));

  const [print, setPrint] = useState(false);
  const prRows = [
    { label: 'Penjualan Kotor', value: d.sales },
    { label: 'Retur Penjualan', value: -d.ret, indent: true },
    { label: 'Diskon Penjualan', value: -d.disc, indent: true },
    { label: 'Penjualan Bersih', value: d.netSales, bold: true, sep: true },
    { label: 'Harga Pokok Penjualan', value: -d.cogs },
    { label: 'Laba Kotor', value: d.gross, bold: true, sep: true },
    ...d.exp.map((e) => ({ label: `${e.code} — ${e.name}`, value: -e.bal, indent: true })),
    { label: 'Total Beban Operasional', value: -d.totExp, bold: true },
    { label: 'Laba Operasional', value: d.opProfit, bold: true, sep: true },
  ];

  function exportCsv() {
    downloadCsv('pl', ['Keterangan', 'Jumlah'],
      prRows.map((r) => [r.label, typeof r.value === 'number' ? r.value : '']));
  }

  function quick(q: string) {
    const t = today(); const y = t.slice(0, 4); const m = +t.slice(5, 7);
    if (q === 'm') setFrom(t.slice(0, 7) + '-01');
    if (q === 'q') setFrom(`${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`);
    if (q === 'y') setFrom(`${y}-01-01`);
    setTo(t);
  }

  return (
    <>
      <PageHead title="Laporan Laba Rugi (Profit & Loss)"
        desc="Disusun dari jurnal periode berjalan. Penjualan bersih = penjualan kotor dikurangi retur dan diskon penjualan."
        actions={<>
          <button className="btn" onClick={() => setPrint(true)}>🖨 Cetak</button>
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />
      <div className="fbar">
        <label className="sm mut">Periode</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="sm mut">s/d</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Seg value="" options={[{ v: 'm', t: 'Bulan Ini' }, { v: 'q', t: 'Kuartal' }, { v: 'y', t: 'Tahun Berjalan' }]}
          onChange={quick} />
      </div>
      <KpiGrid>
        <Kpi cls="k-blue" lb="Penjualan Bersih" vl={rpShort(d.netSales)} sb={`Setelah retur ${rpShort(d.ret)}`} />
        <Kpi cls="k-green" lb="Laba Kotor" vl={rpShort(d.gross)} sb={`Margin ${num(d.gm, 1)}%`} />
        <Kpi cls="k-amber" lb="Beban Operasional" vl={rpShort(d.totExp)} sb={`${num(d.exp.length, 0)} pos beban`} />
        <Kpi cls={d.opProfit >= 0 ? 'k-green' : 'k-red'} lb="Laba Operasional" vl={rpShort(d.opProfit)}
          sb={d.netSales ? `${num((d.opProfit / d.netSales) * 100, 1)}% dari penjualan` : '-'} />
      </KpiGrid>
      <Card>
        <CardHead title={`Laba Rugi · ${dFmt(from)} — ${dFmt(to)}`} />
        <CardBody flush>
          {loading ? <div className="mut" style={{ padding: 20 }}>Memuat…</div> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Keterangan</th><th className="num" style={{ width: 220 }}>Jumlah</th></tr></thead>
              <tbody>
                <Row lb="PENDAPATAN" b />
                <Row lb="Penjualan Barang" v={d.sales} ind />
                <Row lb="Retur Penjualan" v={d.ret} ind neg />
                <Row lb="Diskon Penjualan" v={d.disc} ind neg />
                <Row lb="Penjualan Bersih" v={d.netSales} b />
                <tr><td colSpan={2} style={{ height: 8 }} /></tr>
                <Row lb="HARGA POKOK PENJUALAN" b />
                <Row lb="Harga Pokok Penjualan" v={d.cogs} ind neg />
                <Row lb="LABA KOTOR" v={d.gross} b />
                <tr><td colSpan={2} style={{ height: 8 }} /></tr>
                <Row lb="BEBAN OPERASIONAL" b />
                {d.exp.map((e) => <Row key={e.code} lb={e.name} v={e.bal} ind neg />)}
                <Row lb="Total Beban Operasional" v={d.totExp} b neg />
                <tr><td colSpan={2} style={{ height: 8 }} /></tr>
                <Row lb="LABA OPERASIONAL" v={d.opProfit} b />
              </tbody>
            </table></div>
          )}
        </CardBody>
      </Card>
      {print ? <PrintReport title="Laporan Laba Rugi" period={`Periode ${from} s/d ${to}`}
        rows={prRows} onClose={() => setPrint(false)} /> : null}
    </>
  );
}
