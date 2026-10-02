'use client';
/* Master Sales Person — memakai kerangka master yang sama dengan halaman
   master lain, ditambah kolom realisasi dan capaian terhadap target. */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Prog } from '@/components/ui';
import { SimpleMaster } from '@/components/crud';
import { rp } from '@/lib/format';
import type { Salesperson } from '@/lib/types';

export default function Page() {
  const supabase = useMemo(() => createClient(), []);
  const [perf, setPerf] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('invoice').select('salesperson_code,sub').neq('status', 'CANCELLED');
      const m = new Map<string, number>();
      ((data as { salesperson_code: string; sub: number }[]) || []).forEach((r) => {
        if (!r.salesperson_code) return;
        m.set(r.salesperson_code, (m.get(r.salesperson_code) || 0) + Number(r.sub));
      });
      setPerf(m);
    })();
  }, [supabase]);

  return (
    <SimpleMaster<Salesperson>
      title="Sales Person"
      desc="Tim penjualan beserta area dan target tahunan. Realisasi dihitung dari nilai invoice sebelum PPN."
      table="salesperson" idKey="code" addLabel="Sales"
      cols={[
        { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
        { t: 'Nama', f: (r) => r.name },
        { t: 'Area', f: (r) => <span className="sm">{r.area || '-'}</span> },
        { t: 'Telepon', f: (r) => r.phone || '-' },
        { t: 'Target', cls: 'num', f: (r) => rp(r.target) },
        { t: 'Realisasi', cls: 'num', f: (r) => rp(perf.get(r.code) || 0) },
        { t: 'Capaian', f: (r) => (
          <Prog pct={r.target ? Math.round(((perf.get(r.code) || 0) / r.target) * 100) : 0} />) },
      ]}
      fields={[
        { k: 'code', t: 'Kode', lock: true },
        { k: 'name', t: 'Nama' },
        { k: 'area', t: 'Area', full: true },
        { k: 'phone', t: 'Telepon' },
        { k: 'target', t: 'Target Tahunan', type: 'number' },
      ]}
    />
  );
}
