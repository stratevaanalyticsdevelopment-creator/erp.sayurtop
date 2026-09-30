'use client';
import { SimpleMaster } from '@/components/crud';
import type { Warehouse } from '@/lib/types';

export default function Page() {
  return (
    <SimpleMaster<Warehouse>
      title="Warehouse" addLabel="Gudang" table="warehouse" idKey="code"
      desc="Lokasi gudang pengirim. Digunakan pada Sales Order dan Surat Jalan."
      cols={[
        { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
        { t: 'Nama Gudang', f: (r) => r.name },
        { t: 'Alamat', f: (r) => <span className="sm">{r.addr || '-'}</span> },
        { t: 'Penanggung Jawab', f: (r) => r.pic || '-' },
      ]}
      fields={[
        { k: 'code', t: 'Kode', lock: true },
        { k: 'name', t: 'Nama Gudang' },
        { k: 'addr', t: 'Alamat', full: true },
        { k: 'pic', t: 'Penanggung Jawab' },
      ]}
    />
  );
}
