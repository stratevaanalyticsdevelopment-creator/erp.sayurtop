'use client';
/* Perbandingan Harga Supplier — matriks produk × supplier untuk satu
   tanggal. Harga yang ditampilkan adalah harga penawaran yang berlaku pada
   tanggal itu (harga terakhir yang tidak melewati tanggal tersebut), bukan
   harga hasil penerimaan barang. Untuk harga aktual pakai Harga Beli Harian. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { dFmt, num, rp, rpShort, today } from '@/lib/format';
import { downloadCsv } from '@/lib/csv';
import type { SupplierPrice } from '@/lib/types';

type Cell = { price: number; date: string };
type Row = {
  product_id: string; name: string; unit: string; category_name: string;
  sell_price: number; preferred: string | null;
  cells: Record<string, Cell>;
  best: string | null; bestPrice: number | null;
  prefPrice: number | null; hemat: number;
};

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [date, setDate] = useState(today());
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const [only, setOnly] = useState<'ALL' | 'MULTI' | 'MAHAL'>('ALL');
  const [prices, setPrices] = useState<SupplierPrice[]>([]);
  const [cat2, setCat2] = useState<Map<string, boolean>>(new Map());
  const [pref, setPref] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [pr, sp] = await Promise.all([
      /* Semua harga sampai tanggal terpilih; harga berlaku diambil per
         supplier + produk dari tanggal terbaru. */
      supabase.from('supplier_price').select('supplier_code,product_id,price,price_date')
        .lte('price_date', date).order('price_date', { ascending: false }),
      supabase.from('supplier_product').select('supplier_code,product_id,is_preferred'),
    ]);
    setPrices((pr.data as SupplierPrice[]) || []);
    const m = new Map<string, string>(); const ada = new Map<string, boolean>();
    ((sp.data as { supplier_code: string; product_id: string; is_preferred: boolean }[]) || [])
      .forEach((r) => { ada.set(r.product_id + '|' + r.supplier_code, true);
        if (r.is_preferred) m.set(r.product_id, r.supplier_code); });
    setPref(m); setCat2(ada);
    setLoading(false);
  }, [supabase, date]);
  useEffect(() => { load(); }, [load]);

  /* Supplier yang punya harga pada periode ini, urut kode. */
  const sups = useMemo(() => {
    const set = new Set(prices.map((p) => p.supplier_code));
    return s.suppliers.filter((x) => set.has(x.code)).map((x) => x.code)
      .sort((a, b) => a.localeCompare(b));
  }, [prices, s.suppliers]);

  const rows = useMemo<Row[]>(() => {
    const byProd = new Map<string, Record<string, Cell>>();
    prices.forEach((p) => {
      const c = byProd.get(p.product_id) || {};
      /* Data sudah urut tanggal menurun, jadi entri pertama adalah harga berlaku. */
      if (!c[p.supplier_code]) c[p.supplier_code] = { price: Number(p.price), date: p.price_date };
      byProd.set(p.product_id, c);
    });
    const out: Row[] = [];
    byProd.forEach((cells, pid) => {
      const p = s.prod(pid);
      const entries = Object.entries(cells);
      if (!entries.length) return;
      let best: string | null = null; let bestPrice: number | null = null;
      entries.forEach(([sc, c]) => {
        if (bestPrice === null || c.price < bestPrice) { bestPrice = c.price; best = sc; }
      });
      const prefSup = pref.get(pid) || null;
      const prefPrice = prefSup && cells[prefSup] ? cells[prefSup].price : null;
      out.push({
        product_id: pid, name: p?.name || pid, unit: p?.unit || '',
        category_name: p?.category_name || '', sell_price: Number(p?.sell_price) || 0,
        preferred: prefSup, cells, best, bestPrice,
        prefPrice,
        hemat: prefPrice !== null && bestPrice !== null ? prefPrice - bestPrice : 0,
      });
    });
    return out.sort((a, b) => b.hemat - a.hemat || a.product_id.localeCompare(b.product_id));
  }, [prices, pref, s]);

  const cats = useMemo(() =>
    [...new Set(rows.map((r) => r.category_name).filter(Boolean))].sort(), [rows]);

  const shown = rows.filter((r) => {
    if (cat !== 'ALL' && r.category_name !== cat) return false;
    if (only === 'MULTI' && Object.keys(r.cells).length < 2) return false;
    if (only === 'MAHAL' && r.hemat <= 0) return false;
    const t = q.toLowerCase();
    return !t || r.product_id.toLowerCase().includes(t) || r.name.toLowerCase().includes(t);
  });

  const multi = rows.filter((r) => Object.keys(r.cells).length >= 2).length;
  const mahal = rows.filter((r) => r.hemat > 0);
  const totalHemat = mahal.reduce((a, b) => a + b.hemat, 0);

  function exportCsv() {
    downloadCsv('perbandinganhargasupplier',
      ['SKU', 'Produk', 'Satuan', 'Kategori', 'Supplier Utama', 'Harga Utama',
       'Supplier Termurah', 'Harga Termurah', 'Selisih per Unit', 'Jumlah Supplier',
       ...sups.map((c) => s.supp(c).name)],
      shown.map((r) => [r.product_id, r.name, r.unit, r.category_name,
        r.preferred ? s.supp(r.preferred).name : '', r.prefPrice ?? '',
        r.best ? s.supp(r.best).name : '', r.bestPrice ?? '',
        r.hemat > 0 ? r.hemat : 0, Object.keys(r.cells).length,
        ...sups.map((c) => r.cells[c] ? r.cells[c].price : '')]));
  }

  return (
    <>
      <PageHead title="Perbandingan Harga Supplier"
        desc="Harga penawaran yang berlaku pada tanggal terpilih, dibandingkan antar supplier. Harga termurah ditandai hijau; supplier utama ditandai bintang. Untuk harga aktual hasil penerimaan barang, lihat Harga Beli Harian."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />

      <div className="fbar">
        <input className="grow" placeholder="Cari SKU atau nama produk…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="ALL">Semua Kategori</option>
          {cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={only} onChange={(e) => setOnly(e.target.value as 'ALL' | 'MULTI' | 'MAHAL')}>
          <option value="ALL">Semua produk</option>
          <option value="MULTI">Hanya yang punya ≥2 supplier</option>
          <option value="MAHAL">Supplier utama bukan termurah</option>
        </select>
        <label className="sm mut">Harga berlaku</label>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        <span className="sm mut">{shown.length} produk</span>
        {loading ? <span className="sm mut">Memuat…</span> : null}
      </div>

      <KpiGrid>
        <Kpi cls="k-blue" lb="Produk Dibandingkan" vl={num(rows.length, 0)}
          sb={`${num(sups.length, 0)} supplier punya harga`} />
        <Kpi cls="k-acc" lb="Punya ≥2 Supplier" vl={num(multi, 0)}
          sb={rows.length ? `${num((multi / rows.length) * 100, 0)}% dari produk` : ''} />
        <Kpi cls="k-amber" lb="Utama Bukan Termurah" vl={num(mahal.length, 0)}
          sb="Perlu ditinjau ulang" />
        <Kpi cls="k-green" lb="Potensi Hemat / Unit" vl={rpShort(totalHemat)}
          sb="Jumlah selisih harga utama vs termurah" />
      </KpiGrid>

      <Card><CardBody flush>
        <DataTable<Row> rows={shown} rowKey={(r) => r.product_id}
          emptyT="Belum ada harga supplier pada tanggal ini"
          emptyD="Ubah tanggal, atau isi harga lewat Master Supplier → Produk & Harga."
          cols={[
            { t: 'SKU', f: (r) => <span className="doc-no">{r.product_id}</span> },
            { t: 'Produk', f: (r) => (<>{r.name}
              <span className="sm mut"> · {r.unit}</span></>) },
            ...sups.map((sc) => ({
              t: s.supp(sc).name, cls: 'num' as const,
              f: (r: Row) => {
                const c = r.cells[sc];
                if (!c) return <span className="mut">—</span>;
                const isBest = r.best === sc && Object.keys(r.cells).length > 1;
                const isPref = r.preferred === sc;
                const stale = c.date !== date;
                return (
                  <span title={`Harga ${dFmt(c.date)}${stale ? ' (harga terakhir sebelum tanggal ini)' : ''}`}
                    style={isBest ? { color: 'var(--green)', fontWeight: 700 } : undefined}>
                    {isPref ? '★ ' : ''}{rp(c.price)}{stale ? <span className="mut"> *</span> : null}
                  </span>);
              },
            })),
            { t: 'Termurah', f: (r) => (r.best
              ? <span className="bdg2 b-green">{s.supp(r.best).name}</span>
              : <span className="mut">—</span>) },
            { t: 'Selisih Utama', cls: 'num', f: (r) => (r.hemat > 0
              ? <span className="bdg2 b-amber">+{rp(r.hemat)}</span>
              : r.hemat < 0 ? <span className="bdg2 b-green">{rp(r.hemat)}</span>
              : <span className="mut">—</span>) },
            { t: 'Margin Termurah', cls: 'ctr', f: (r) => {
              if (!r.bestPrice || !r.sell_price) return <span className="mut">—</span>;
              const m = ((r.sell_price - r.bestPrice) / r.sell_price) * 100;
              return <span className={'bdg2 ' + (m < 10 ? 'b-red' : m < 20 ? 'b-amber' : 'b-green')}>
                {m.toFixed(1)}%</span>;
            } },
          ]} />
      </CardBody></Card>

      <div className="info-box mt14">
        Tanda <b>★</b> menunjukkan supplier utama produk tersebut — supplier inilah yang dipakai
        Purchase Order otomatis dari Sales Order. Tanda <b>*</b> berarti harga itu bukan dicatat pada
        tanggal terpilih, melainkan harga terakhir yang diketahui sebelum tanggal tersebut.
        Supplier utama diubah dari Master Supplier → Produk &amp; Harga → Jadikan Utama.
      </div>
    </>
  );
}
