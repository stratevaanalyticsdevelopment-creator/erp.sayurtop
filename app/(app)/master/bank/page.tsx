'use client';
import { SimpleMaster } from '@/components/crud';
import { useStore } from '@/lib/store';
import type { BankAccount } from '@/lib/types';

export default function Page() {
  const s = useStore();
  return (
    <SimpleMaster<BankAccount>
      title="Bank Account" addLabel="Rekening" table="bank_account" idKey="code"
      desc="Rekening penerimaan pembayaran. Setiap rekening dipetakan ke akun Kas & Bank di COA."
      cols={[
        { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
        { t: 'Nama Bank', f: (r) => r.name },
        { t: 'Nomor Rekening', f: (r) => <span className="mono">{r.account_no || '-'}</span> },
        { t: 'Atas Nama', f: (r) => r.holder || '-' },
        { t: 'Akun COA', f: (r) => <><span className="mono sm">{r.coa_code}</span> {s.accName(r.coa_code || '')}</> },
      ]}
      fields={[
        { k: 'code', t: 'Kode', lock: true },
        { k: 'name', t: 'Nama Bank' },
        { k: 'account_no', t: 'Nomor Rekening' },
        { k: 'holder', t: 'Atas Nama' },
        { k: 'coa_code', t: 'Kode Akun COA' },
      ]}
    />
  );
}
