'use client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, PageHead } from '@/components/ui';
import { useGl } from '@/lib/use-gl';
import { trialBalance } from '@/lib/gl';
import { rp, today } from '@/lib/format';
import type { Coa } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const { rows } = useGl(null, today());
  const tb = trialBalance(rows, s.coa);
  const groups = new Map<string, Coa[]>();
  s.coa.forEach((a) => groups.set(a.group_name, [...(groups.get(a.group_name) || []), a]));

  return (
    <>
      <PageHead title="Chart of Accounts"
        desc="Daftar akun yang digunakan mesin jurnal otomatis. Perubahan pemetaan akun berdampak langsung pada laporan keuangan." />
      <div className="info-box mb12">
        <b>Pemetaan akun otomatis:</b> Piutang 1200 · Kas/Bank 1110 · Persediaan 1300 · PPN Keluaran 2200 ·
        Penjualan 4100 · Retur Penjualan 4200 · HPP 5100 · Uang Muka Pelanggan 2400.
      </div>
      {[...groups.entries()].map(([g, list]) => (
        <Card key={g} className="mb12">
          <CardHead title={g} />
          <CardBody flush>
            <DataTable<Coa> rows={list} rowKey={(r) => r.code} cols={[
              { t: 'Kode', f: (a) => <span className="doc-no">{a.code}</span> },
              { t: 'Nama Akun', f: (a) => a.name },
              { t: 'Tipe', f: (a) => <span className="bdg2 b-brand">{a.type}</span> },
              { t: 'Saldo Normal', cls: 'ctr', f: (a) => a.normal === 'D' ? 'Debit' : 'Kredit' },
              { t: 'Saldo Berjalan', cls: 'num', f: (a) => rp(tb.find((x) => x.code === a.code)?.bal || 0) },
            ]} />
          </CardBody>
        </Card>
      ))}
    </>
  );
}
