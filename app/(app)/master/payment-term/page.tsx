'use client';
import { SimpleMaster } from '@/components/crud';
import { useStore } from '@/lib/store';
import { num } from '@/lib/format';
import type { PaymentTerm } from '@/lib/types';

export default function Page() {
  const s = useStore();
  return (
    <SimpleMaster<PaymentTerm>
      title="Payment Term" addLabel="Termin" table="payment_term" idKey="code" orderBy="days"
      desc="Termin pembayaran menentukan tanggal jatuh tempo invoice secara otomatis."
      cols={[
        { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
        { t: 'Nama', f: (r) => r.name },
        { t: 'Hari', cls: 'num', f: (r) => num(r.days, 0) + ' hari' },
        { t: 'Dipakai', cls: 'num', f: (r) => s.customers.filter((c) => c.term_code === r.code).length + ' customer' },
      ]}
      fields={[
        { k: 'code', t: 'Kode', lock: true },
        { k: 'name', t: 'Nama' },
        { k: 'days', t: 'Jumlah Hari', type: 'number' },
      ]}
    />
  );
}
