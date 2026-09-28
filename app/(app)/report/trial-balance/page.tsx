'use client';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardBody, DataTable, PageHead } from '@/components/ui';
import { useGl } from '@/lib/use-gl';
import { trialBalance, type TbRow } from '@/lib/gl';
import { rp, today } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';

export default function Page() {
  const s = useStore();
  const [to, setTo] = useState(today());
  const { rows } = useGl(null, to);
  const tb = trialBalance(rows, s.coa);
  const td = tb.reduce((a, b) => a + b.d, 0);
  const tc = tb.reduce((a, b) => a + b.c, 0);

  function exportCsv() {
    downloadCsv('tb', ['Kode', 'Nama Akun', 'Tipe', 'Debit', 'Kredit', 'Saldo'],
      tb.map((r) => [r.code, r.name, r.type, r.d, r.c, r.bal]));
  }

  return (
    <>
      <PageHead title="Neraca Saldo (Trial Balance)"
        desc="Rekapitulasi seluruh mutasi debit dan kredit per akun. Total debit wajib sama dengan total kredit."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />
      <div className="fbar">
        <label className="sm mut">Sampai dengan</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <span className={Math.abs(td - tc) < 1 ? 'bdg2 b-green' : 'bdg2 b-red'}>
          {Math.abs(td - tc) < 1 ? 'Balance ✓' : 'Selisih ' + rp(td - tc)}
        </span>
      </div>
      <Card><CardBody flush>
        <DataTable<TbRow> rows={tb} rowKey={(r) => r.code}
          foot={<tr><td colSpan={3}>TOTAL</td><td className="num">{rp(td)}</td><td className="num">{rp(tc)}</td>
            <td className="num">{Math.abs(td - tc) < 1 ? 'Balance' : 'Selisih ' + rp(td - tc)}</td></tr>}
          cols={[
            { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
            { t: 'Nama Akun', f: (r) => r.name },
            { t: 'Tipe', f: (r) => <span className="sm mut">{r.type}</span> },
            { t: 'Mutasi Debit', cls: 'num', f: (r) => r.d ? rp(r.d) : <span className="mut">—</span> },
            { t: 'Mutasi Kredit', cls: 'num', f: (r) => r.c ? rp(r.c) : <span className="mut">—</span> },
            { t: 'Saldo', cls: 'num', f: (r) => <><b>{rp(r.bal)}</b> <span className="sm mut">{r.normal === 'D' ? 'D' : 'K'}</span></> },
          ]} />
      </CardBody></Card>
    </>
  );
}
