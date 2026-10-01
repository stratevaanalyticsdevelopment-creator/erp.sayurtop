'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SimpleMaster } from '@/components/crud';
import { num } from '@/lib/format';
import type { Driver } from '@/lib/types';

export default function Page() {
  const supabase = useMemo(() => createClient(), []);
  const [trips, setTrips] = useState<Map<string, number>>(new Map());

  /* Jumlah Surat Jalan per driver, untuk kolom Pengiriman. */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('delivery').select('driver_code');
      const m = new Map<string, number>();
      ((data as { driver_code: string | null }[]) || []).forEach((d) => {
        if (d.driver_code) m.set(d.driver_code, (m.get(d.driver_code) || 0) + 1);
      });
      setTrips(m);
    })();
  }, [supabase]);

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
        { t: 'Pengiriman', cls: 'num', f: (r) => num(trips.get(r.code) || 0, 0) },
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
