'use client';
import { SimpleMaster } from '@/components/crud';
import { useStore } from '@/lib/store';
import { num } from '@/lib/format';
import type { Tax } from '@/lib/types';

export default function Page() {
  const s = useStore();
  return (
    <SimpleMaster<Tax>
      title="Tax" addLabel="Pajak" table="tax" idKey="code"
      desc="Tarif pajak yang dapat dipilih pada baris dokumen. PPN keluaran diposting ke akun 2200."
      cols={[
        { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
        { t: 'Nama', f: (r) => r.name },
        { t: 'Tarif', cls: 'num', f: (r) => num(r.rate, 0) + '%' },
        { t: 'Akun', f: (r) => <><span className="mono sm">{r.account_code || '-'}</span>{' '}
          {r.account_code && r.account_code !== '-' ? s.accName(r.account_code) : ''}</> },
      ]}
      fields={[
        { k: 'code', t: 'Kode', lock: true },
        { k: 'name', t: 'Nama' },
        { k: 'rate', t: 'Tarif (%)', type: 'number' },
        { k: 'account_code', t: 'Kode Akun' },
      ]}
    />
  );
}
