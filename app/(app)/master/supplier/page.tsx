'use client';
/* Master Supplier — petani, pengepul, dan distributor pemasok barang.
   Setiap supplier punya daftar produk yang dipasok beserta riwayat harga
   penawarannya, karena harga sayur berubah hampir tiap hari. Supplier yang
   ditandai "utama" menentukan tujuan Purchase Order otomatis dari SO. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { SimpleMaster } from '@/components/crud';
import { SupplierProducts } from '@/components/supplier-products';
import { SUPPLIER_TYPES } from '@/lib/menu';
import { downloadCsv } from '@/lib/csv';
import { num, rp, rpShort } from '@/lib/format';
import type { Supplier, SupplierSummary } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState<Supplier | null>(null);
  const [stat, setStat] = useState<Map<string, SupplierSummary>>(new Map());

  const load = useCallback(async () => {
    const { data } = await supabase.from('supplier_summary_view').select('*');
    setStat(new Map(((data as SupplierSummary[]) || []).map((r) => [r.supplier_code, r])));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  /* Kategori panjang dipendekkan agar kolom tidak melebar; nama lengkapnya
     tetap muncul sebagai tooltip. */
  const jenisSingkat = (t: string | null) => {
    if (!t) return '—';
    const ls = t.split(', ');
    return ls.length <= 2 ? ls.join(', ') : `${ls.slice(0, 2).join(', ')} +${ls.length - 2}`;
  };

  function exportCsv() {
    downloadCsv('suppliers',
      ['Kode', 'Nama', 'Tipe', 'PIC', 'Telepon', 'Termin', 'Bank', 'No Rekening',
       'Jenis Produk', 'Jumlah Jenis', 'Jumlah Produk', 'Produk Utama',
       'Qty Dipesan', 'Qty Diterima', 'Nilai Pembelian', 'Terima Terakhir',
       'Alamat', 'Status'],
      s.suppliers.map((r) => {
        const x = stat.get(r.code);
        return [r.code, r.name, r.type || '', r.pic || '', r.phone || '',
          s.termOf(r.term_code).name, r.bank_name || '', r.bank_account || '',
          x?.categories || '', x?.category_count ?? 0,
          x?.product_count ?? 0, x?.preferred_count ?? 0,
          Number(x?.qty_ordered) || 0, Number(x?.qty_received) || 0,
          Math.round(Number(x?.purchase_value) || 0), x?.last_grn_date || '',
          r.address || '', r.active ? 'Aktif' : 'Nonaktif'];
      }));
  }

  return (
    <>
      <SimpleMaster<Supplier>
        title="Supplier"
        desc="Pemasok barang: petani, pengepul, peternak, dan distributor. Kolom Qty Dibeli menampilkan qty diterima dibanding qty dipesan. Tekan “Produk & Harga” untuk daftar produk, harga berlaku, dan kuantitas pasok per produk."
        table="supplier" idKey="code" addLabel="Supplier"
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>}
        rowAction={(r) => (
          <button className="btn sm" title="Daftar produk yang dipasok dan harga berlakunya"
            onClick={() => setOpen(r)}>Produk &amp; Harga</button>)}
        cols={[
          { t: 'Kode', f: (r) => <span className="doc-no">{r.code}</span> },
          { t: 'Nama', f: (r) => r.name },
          { t: 'Tipe', f: (r) => <span className="bdg2 b-brand">{r.type || '-'}</span> },
          { t: 'PIC / Telepon', f: (r) => <span className="sm">{r.pic || '-'} · {r.phone || '-'}</span> },
          { t: 'Termin', f: (r) => <span className="sm">{s.termOf(r.term_code).name}</span> },
          { t: 'Bank', f: (r) => <span className="sm mut">{r.bank_name || '-'} {r.bank_account || ''}</span> },
          { t: 'Jenis Produk', f: (r) => {
            const x = stat.get(r.code);
            return x?.categories
              ? <span className="sm" title={x.categories}>{jenisSingkat(x.categories)}</span>
              : <span className="mut">—</span>;
          } },
          { t: 'Produk', cls: 'ctr', f: (r) => stat.get(r.code)?.product_count ?? 0 },
          { t: 'Produk Utama', cls: 'ctr', f: (r) => {
            const u = stat.get(r.code)?.preferred_count ?? 0;
            return u ? <span className="bdg2 b-green">{u}</span> : <span className="mut">—</span>;
          } },
          { t: 'Qty Dibeli', cls: 'num', f: (r) => {
            const x = stat.get(r.code);
            const o = Number(x?.qty_ordered) || 0; const d = Number(x?.qty_received) || 0;
            if (!o && !d) return <span className="mut">—</span>;
            return <span title={`${num(d, 0)} diterima dari ${num(o, 0)} dipesan`}>
              {num(d, 0)}<span className="mut"> / {num(o, 0)}</span></span>;
          } },
          { t: 'Nilai Beli', cls: 'num', f: (r) => {
            const v = Number(stat.get(r.code)?.purchase_value) || 0;
            return v ? <span title={rp(v)}>{rpShort(v)}</span> : <span className="mut">—</span>;
          } },
          { t: 'Status', f: (r) => (r.active
            ? <span className="bdg2 b-green">Aktif</span> : <span className="bdg2 b-grey">Nonaktif</span>) },
        ]}
        fields={[
          { k: 'code', t: 'Kode', lock: true },
          { k: 'name', t: 'Nama Supplier' },
          { k: 'type', t: 'Tipe', options: SUPPLIER_TYPES.map((t) => ({ v: t, t })) },
          { k: 'pic', t: 'Nama PIC' },
          { k: 'phone', t: 'Telepon / WA' },
          { k: 'term_code', t: 'Termin Pembayaran', options: s.terms.map((t) => ({ v: t.code, t: t.name })) },
          { k: 'address', t: 'Alamat', full: true },
          { k: 'bank_name', t: 'Nama Bank' },
          { k: 'bank_account', t: 'No. Rekening' },
        ]}
      />

      {open ? (
        <SupplierProducts supplierCode={open.code} supplierName={open.name}
          onClose={() => { setOpen(null); load(); }} />) : null}
    </>
  );
}
