'use client';
import { SimpleMaster } from '@/components/crud';
import type { Driver } from '@/lib/types';

export default function Page() {
  return (
    <SimpleMaster<Driver>
      title="Driver & Vehicle" addLabel="Driver" table="driver" idKey="code"
      desc="Pengemudi dan kendaraan pengiriman. Dipilih saat menerbitkan Surat Jalan."
      cols={[
        { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
        { t: 'Nama', f: (r) => r.name },
        { t: 'SIM', f: (r) => r.sim || '-' },
        { t: 'Telepon', f: (r) => r.phone || '-' },
        { t: 'Kendaraan', f: (r) => <span className="mono sm">{r.vehicle_code || '-'}</span> },
      ]}
      fields={[
        { k: 'code', t: 'Kode', lock: true },
        { k: 'name', t: 'Nama' },
        { k: 'sim', t: 'Jenis SIM' },
        { k: 'phone', t: 'Telepon' },
        { k: 'vehicle_code', t: 'Nomor Kendaraan' },
      ]}
    />
  );
}
