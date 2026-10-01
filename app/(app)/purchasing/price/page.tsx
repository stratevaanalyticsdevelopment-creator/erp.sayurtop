'use client';
/* Harga Beli Harian — pergerakan harga beli aktual per produk per hari,
   dihitung dari penerimaan barang. Kolom "Biaya/Unit" sudah termasuk
   landed cost dan itulah angka yang dipakai sebagai HPP. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { LineChart } from '@/components/charts';
import { DateRange, defaultRange, type Range } from '@/components/filters';
import { CATEGORIES } from '@/lib/menu';
import { dFmt, num, rp, rpShort } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import type { PriceDaily } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<PriceDaily[]>([]);
  const [range, setRange] = useState<Range>(defaultRange('d30'));
  const [cat, setCat] = useState('ALL');
  const [prod, setProd] = useState('ALL');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    let query = supabase.from('purchase_price_daily').select('*')
      .order('price_date', { ascending: false });
    if (range.from) query = query.gte('price_date', range.from);
    if (range.to) query = query.lte('price_date', range.to);
    const { data } = await query;
    setRows((data as PriceDaily[]) || []);
  }, [supabase, range]);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => {
    const p = s.prod(r.product_id);
    if (cat !== 'ALL' && p?.category !== cat) return false;
    if (prod !== 'ALL' && r.product_id !== prod) return false;
    const t = q.toLowerCase();
    return !t || r.product_id.toLowerCase().includes(t) || (p?.name || '').toLowerCase().includes(t);
  });

  const prodOptions = s.products
    .filter((p) => cat === 'ALL' || p.category === cat)
    .filter((p) => rows.some((r) => r.product_id === p.id));

  /* Deret harga untuk grafik hanya bermakna bila satu produk dipilih. */
  const series = prod !== 'ALL'
    ? [...filtered].sort((a, b) => a.price_date.localeCompare(b.price_date))
      .map((r) => ({ l: r.price_date.slice(8) + '/' + r.price_date.slice(5, 7), v: Number(r.avg_landed_cost) }))
    : [];

  const nilai = filtered.reduce((a, r) => a + Number(r.avg_price) * Number(r.qty), 0);
  const nilaiLanded = filtered.reduce((a, r) => a + Number(r.avg_landed_cost) * Number(r.qty), 0);

  /* Selisih harga terhadap harga pokok master, untuk melihat produk yang naik. */
  const withDelta = filtered.map((r) => {
    const base = Number(s.prod(r.product_id)?.base_price || 0);
    const cost = Number(r.avg_landed_cost);
    return { ...r, base, delta: base ? ((cost - base) / base) * 100 : 0 };
  });

  function exportCsv() {
    downloadCsv('pricedaily',
      ['Tanggal', 'SKU', 'Produk', 'Kategori', 'Qty Diterima', 'Harga Beli Rata-rata',
        'Terendah', 'Tertinggi', 'Biaya per Unit', 'Harga Pokok Master', 'Selisih %'],
      withDelta.map((r) => [r.price_date, r.product_id, s.prod(r.product_id)?.name || r.product_id,
        s.prod(r.product_id)?.category_name || '', Number(r.qty), Number(r.avg_price),
        Number(r.min_price), Number(r.max_price), Number(r.avg_landed_cost), r.base,
        r.base ? r.delta.toFixed(1) : '']));
  }

  return (
    <>
      <PageHead title="Harga Beli Harian"
        desc="Harga beli aktual per produk per hari, dihitung dari penerimaan barang. Kolom Biaya/Unit sudah termasuk landed cost — angka inilah yang dipakai sebagai HPP pada faktur penjualan yang tertaut."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />

      <div className="fbar"><DateRange value={range} onChange={setRange} /></div>
      <div className="fbar">
        <input className="grow" placeholder="Cari SKU atau nama produk…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => { setCat(e.target.value); setProd('ALL'); }}>
          <option value="ALL">Semua Kategori</option>
          {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select value={prod} onChange={(e) => setProd(e.target.value)}>
          <option value="ALL">Semua Produk</option>
          {prodOptions.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.name}</option>)}
        </select>
        <span className="sm mut">{filtered.length} baris harga</span>
      </div>

      <KpiGrid>
        <Kpi cls="k-blue" lb="Produk Terpantau" vl={num(new Set(filtered.map((r) => r.product_id)).size, 0)}
          sb={`${range.from || 'awal'} — ${range.to || 'kini'}`} />
        <Kpi cls="k-acc" lb="Nilai Pembelian" vl={rpShort(nilai)} />
        <Kpi cls="k-amber" lb="Setelah Landed Cost" vl={rpShort(nilaiLanded)}
          sb={nilai ? '+' + num(((nilaiLanded - nilai) / nilai) * 100, 2) + '%' : '-'} />
        <Kpi cls="k-green" lb="Total Qty Diterima"
          vl={num(filtered.reduce((a, r) => a + Number(r.qty), 0), 0) + ' unit'} />
      </KpiGrid>

      {series.length > 1 ? (
        <Card className="mb12">
          <CardHead title={`Pergerakan Biaya per Unit — ${s.prod(prod)?.name || prod}`} />
          <CardBody><LineChart data={series} /></CardBody>
        </Card>
      ) : null}

      <Card><CardBody flush>
        <DataTable<typeof withDelta[number]> rows={withDelta} rowKey={(r) => r.product_id + r.price_date}
          emptyT="Belum ada data harga beli pada rentang ini"
          emptyD="Harga terbentuk otomatis setiap kali barang diterima di gudang."
          cols={[
            { t: 'Tanggal', f: (r) => dFmt(r.price_date) },
            { t: 'SKU', f: (r) => <span className="doc-no">{r.product_id}</span> },
            { t: 'Produk', f: (r) => s.prod(r.product_id)?.name || r.product_id },
            { t: 'Kategori', f: (r) => <span className="sm mut">
              {s.prod(r.product_id)?.category_name || '-'}</span> },
            { t: 'Qty', cls: 'num', f: (r) => num(r.qty, 0) },
            { t: 'Harga Beli', cls: 'num', f: (r) => rp(r.avg_price) },
            { t: 'Terendah', cls: 'num', f: (r) => <span className="sm mut">{rp(r.min_price)}</span> },
            { t: 'Tertinggi', cls: 'num', f: (r) => <span className="sm mut">{rp(r.max_price)}</span> },
            { t: 'Biaya / Unit', cls: 'num', f: (r) => <b>{rp(r.avg_landed_cost)}</b> },
            { t: 'vs Master', cls: 'num', f: (r) => (!r.base || Math.abs(r.delta) < 0.05
              ? <span className="mut">setara</span>
              : <span style={{ color: r.delta > 0 ? 'var(--red)' : 'var(--green)' }}>
                {r.delta > 0 ? '▲' : '▼'} {num(Math.abs(r.delta), 1)}%</span>) },
          ]} />
      </CardBody></Card>
    </>
  );
}
