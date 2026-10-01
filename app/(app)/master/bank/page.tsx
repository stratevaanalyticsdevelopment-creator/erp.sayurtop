'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SimpleMaster } from '@/components/crud';
import { useStore } from '@/lib/store';
import { rp } from '@/lib/format';
import type { BankAccount } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [recv, setRecv] = useState<Map<string, number>>(new Map());

  /* Total penerimaan pembayaran per rekening. */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('payment').select('bank_code,amount');
      const m = new Map<string, number>();
      ((data as { bank_code: string | null; amount: number }[]) || []).forEach((p) => {
        if (p.bank_code) m.set(p.bank_code, (m.get(p.bank_code) || 0) + Number(p.amount));
      });
      setRecv(m);
    })();
  }, [supabase]);

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
        { t: 'Penerimaan', cls: 'num', f: (r) => rp(recv.get(r.code) || 0) },
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
