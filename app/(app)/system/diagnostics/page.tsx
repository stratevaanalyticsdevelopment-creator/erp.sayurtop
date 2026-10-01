'use client';
/* Diagnostik koneksi — menjawab satu pertanyaan: basis data mana yang sedang
   dipakai, dan apakah isinya lengkap.

   Halaman ini dibuat setelah sebuah kesalahan sambung basis data tidak
   terdeteksi berhari-hari: aplikasi menunjuk proyek Supabase yang tidak
   memiliki view dan fungsi terbaru, sehingga Purchase Order › Kebutuhan
   Pembelian, Picking List, dan Packaging tampil kosong tanpa pesan apa pun.
   Layar ini membuat keadaan seperti itu terlihat dalam satu pandangan. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, DataTable, Kpi, KpiGrid, PageHead, SecT } from '@/components/ui';
import { num } from '@/lib/format';

/* Objek yang dibutuhkan tiap menu. Bila salah satu tidak ada, menu yang
   memakainya pasti tampil kosong. */
const PERIKSA: { objek: string; jenis: 'view' | 'tabel' | 'fungsi'; dipakai: string; migrasi: string }[] = [
  { objek: 'sales_order',               jenis: 'tabel',  dipakai: 'Sales Order',            migrasi: '0001' },
  { objek: 'invoice',                   jenis: 'tabel',  dipakai: 'Invoice',                migrasi: '0001' },
  { objek: 'purchase_order',            jenis: 'tabel',  dipakai: 'Purchase Order',         migrasi: '0007' },
  { objek: 'goods_receipt',             jenis: 'tabel',  dipakai: 'Inbound / Receiving',    migrasi: '0007' },
  { objek: 'order_outstanding_view',    jenis: 'view',   dipakai: 'Picking List',           migrasi: '0007' },
  { objek: 'supplier_product',          jenis: 'tabel',  dipakai: 'Harga Supplier',         migrasi: '0011' },
  { objek: 'supplier_price',            jenis: 'tabel',  dipakai: 'Harga Supplier',         migrasi: '0011' },
  { objek: 'supplier_product_view',     jenis: 'view',   dipakai: 'Master Supplier',        migrasi: '0015' },
  { objek: 'packing_line_view',         jenis: 'view',   dipakai: 'Packaging',              migrasi: '0016' },
  { objek: 'po_line_allocation',        jenis: 'tabel',  dipakai: 'Purchase Order',         migrasi: '0020' },
  { objek: 'purchase_demand_line_view', jenis: 'view',   dipakai: 'PO › Kebutuhan Pembelian', migrasi: '0020' },
  { objek: 'purchase_demand_view',      jenis: 'view',   dipakai: 'PO › Kebutuhan Pembelian', migrasi: '0020' },
  { objek: 'purchase_order_source_view', jenis: 'view',  dipakai: 'Purchase Order',         migrasi: '0020' },
  { objek: 'po_allocation_view',        jenis: 'view',   dipakai: 'Purchase Order',         migrasi: '0020' },
];

const FUNGSI: { nama: string; args: Record<string, unknown>; dipakai: string; migrasi: string }[] = [
  { nama: 'peek_cust_po',           args: { p_customer: 'CUST-0001' },  dipakai: 'Sales Order',              migrasi: '0018' },
  { nama: 'supplier_price_at',      args: { p_supplier: 'SUP-001', p_product: 'SAY-001', p_date: '2026-01-01' }, dipakai: 'Purchase Order', migrasi: '0011' },
  { nama: 'demand_supplier_options', args: {},                          dipakai: 'PO › Kebutuhan Pembelian', migrasi: '0021' },
];

type Hasil = { nama: string; jenis: string; dipakai: string; migrasi: string;
               ada: boolean; baris: number | null; pesan: string | null };
type Turunan = { nama: string; jml: number | null; ket: string };

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [hasil, setHasil] = useState<Hasil[]>([]);
  const [turunan, setTurunan] = useState<Turunan[]>([]);
  const [buku, setBuku] = useState<{ unbal: number | null; neg: number | null; tertinggal: number | null }>(
    { unbal: null, neg: null, tertinggal: null });
  const [sedang, setSedang] = useState(true);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  /* Ref proyek adalah bagian pertama nama host: https://<ref>.supabase.co */
  const ref = url.replace(/^https?:\/\//, '').split('.')[0] || '(tidak diatur)';

  const jalankan = useCallback(async () => {
    setSedang(true);
    const out: Hasil[] = [];

    for (const p of PERIKSA) {
      const { count, error } = await supabase.from(p.objek)
        .select('*', { count: 'exact', head: true });
      out.push({
        nama: p.objek, jenis: p.jenis, dipakai: p.dipakai, migrasi: p.migrasi,
        ada: !error, baris: error ? null : (count ?? 0),
        pesan: error ? error.message : null,
      });
    }
    for (const f of FUNGSI) {
      const { error } = await supabase.rpc(f.nama, f.args);
      out.push({
        nama: f.nama + '()', jenis: 'fungsi', dipakai: f.dipakai, migrasi: f.migrasi,
        ada: !error, baris: null, pesan: error ? error.message : null,
      });
    }
    setHasil(out);

    /* Hitungan turunan: yang benar-benar dilihat pengguna di tiga halaman yang
       paling sering tampak kosong. Angka di sini dihitung tanpa filter tanggal,
       jadi bila di sini terisi tetapi halamannya kosong, penyebabnya filter. */
    const cacah = async (objek: string) => {
      const { count, error } = await supabase.from(objek)
        .select('*', { count: 'exact', head: true });
      return error ? null : (count ?? 0);
    };
    setTurunan([
      { nama: 'Kebutuhan Pembelian', jml: await cacah('purchase_demand_line_view'),
        ket: 'baris kebutuhan dari Sales Order terbuka yang belum dialokasikan ke PO' },
      { nama: 'Packaging', jml: await cacah('packing_line_view'),
        ket: 'baris siap kemas; halaman menyaring tanggal kirim hari ini s.d. H+6' },
      { nama: 'Picking List', jml: await cacah('order_outstanding_view'),
        ket: 'baris order yang belum terkirim penuh' },
    ]);

    /* Keutuhan pembukuan dan — yang paling menentukan — berapa hari data contoh
       tertinggal dari kalender. Bila angka itu besar, halaman yang menyaring
       "hari ini" atau "bulan ini" akan kosong meski kodenya benar. */
    const { data: jl } = await supabase.from('journal_line').select('journal_no,debit,credit');
    let unbal: number | null = null;
    if (jl) {
      const per = new Map<string, number>();
      for (const r of jl as { journal_no: string; debit: number; credit: number }[]) {
        per.set(r.journal_no, (per.get(r.journal_no) ?? 0) + Number(r.debit) - Number(r.credit));
      }
      unbal = [...per.values()].filter((v) => Math.abs(v) > 0.005).length;
    }
    const { count: neg } = await supabase.from('product')
      .select('*', { count: 'exact', head: true }).lt('stock', 0);
    const { data: lag } = await supabase.rpc('demo_shift_days');
    setBuku({ unbal, neg: neg ?? null, tertinggal: typeof lag === 'number' ? lag : null });

    setSedang(false);
  }, [supabase]);

  useEffect(() => { jalankan(); }, [jalankan]);

  const hilang = hasil.filter((h) => !h.ada);
  const kosong = hasil.filter((h) => h.ada && h.baris === 0);
  const migrasiKurang = [...new Set(hilang.map((h) => h.migrasi))].sort();

  return (
    <>
      <PageHead title="Diagnostik Koneksi"
        desc="Memastikan aplikasi tersambung ke basis data yang benar dan isinya lengkap. Bila sebuah menu tampil kosong, jawabannya ada di halaman ini."
        actions={<button className="btn" onClick={jalankan} disabled={sedang}>
          {sedang ? 'Memeriksa…' : '↻ Periksa Ulang'}</button>} />

      <KpiGrid>
        <Kpi cls="k-blue" lb="Proyek Supabase" vl={ref} sb={url || 'NEXT_PUBLIC_SUPABASE_URL belum diatur'} />
        <Kpi cls={hilang.length ? 'k-red' : 'k-green'} lb="Objek Tidak Ditemukan"
          vl={num(hilang.length, 0)} sb={`dari ${num(hasil.length, 0)} yang diperiksa`} />
        <Kpi cls={kosong.length ? 'k-amber' : 'k-green'} lb="Ada Tapi Kosong"
          vl={num(kosong.length, 0)} sb="objek tanpa satu baris pun" />
        <Kpi cls="k-acc" lb="Akun Aktif" vl={s.profile?.username || '-'}
          sb={s.profile?.role_name || ''} />
      </KpiGrid>

      {hilang.length ? (
        <div className="err-box mt14">
          <b>{hilang.length} objek tidak ada di basis data ini.</b><br />
          Menu yang memakainya akan selalu tampil kosong. Objek tersebut dibuat oleh
          migrasi <b>{migrasiKurang.join(', ')}</b>.<br />
          <span className="sm">Dua kemungkinan: aplikasi menunjuk proyek Supabase yang salah
          (periksa <b>NEXT_PUBLIC_SUPABASE_URL</b> di Environment Variables Vercel — proyek
          yang benar adalah <b>yartnygvfuxazlqhlcrc</b>), atau migrasi tersebut memang belum
          dijalankan di proyek ini. Untuk kasus kedua, jalankan berkas
          <b> supabase/setup-susulan.sql</b> di SQL Editor.</span>
        </div>
      ) : (
        <div className="info-box mt14">
          <b>Seluruh objek yang dibutuhkan tersedia.</b> Bila sebuah menu masih tampil kosong,
          penyebabnya bukan struktur basis data melainkan isinya — perhatikan kolom Jumlah Baris
          di bawah, dan rentang tanggal pada filter halaman tersebut.
        </div>
      )}

      <SecT>Objek yang Dibutuhkan Tiap Menu</SecT>
      <Card><CardBody flush>
        <DataTable<Hasil> rows={hasil} rowKey={(r) => r.nama}
          emptyT="Sedang memeriksa…" emptyD=""
          cols={[
            { t: 'Status', cls: 'ctr', f: (r) => (r.ada
              ? <span className="bdg2 b-green">ADA</span>
              : <span className="bdg2 b-red">TIDAK ADA</span>) },
            { t: 'Objek', f: (r) => <span className="doc-no">{r.nama}</span> },
            { t: 'Jenis', f: (r) => <span className="sm mut">{r.jenis}</span> },
            { t: 'Dipakai Menu', f: (r) => r.dipakai },
            { t: 'Migrasi', cls: 'ctr', f: (r) => <span className="sm mono">{r.migrasi}</span> },
            { t: 'Jumlah Baris', cls: 'num', f: (r) => (r.baris === null
              ? <span className="mut">—</span>
              : r.baris === 0
                ? <span className="bdg2 b-amber">0</span>
                : num(r.baris, 0)) },
            { t: 'Keterangan', f: (r) => (r.pesan
              ? <span className="sm" style={{ color: 'var(--red)' }}>{r.pesan}</span>
              : <span className="sm mut">—</span>) },
          ]} />
      </CardBody></Card>

      <SecT>Hitungan Turunan</SecT>
      <Card><CardBody flush>
        <DataTable<Turunan> rows={turunan} rowKey={(r) => r.nama}
          emptyT="Sedang menghitung…" emptyD=""
          cols={[
            { t: 'Halaman', f: (r) => r.nama },
            { t: 'Baris', cls: 'num', f: (r) => (r.jml === null
              ? <span className="mut">—</span>
              : r.jml === 0
                ? <span className="bdg2 b-amber">0</span>
                : num(r.jml, 0)) },
            { t: 'Keterangan', f: (r) => <span className="sm mut">{r.ket}</span> },
          ]} />
      </CardBody></Card>

      <SecT>Keutuhan Pembukuan</SecT>
      <Card><CardBody>
        <div className="kv">
          <span className="k">Jurnal Tidak Balance</span>
          <span className="v">{buku.unbal === null ? '—'
            : buku.unbal ? <b style={{ color: 'var(--red)' }}>{buku.unbal}</b> : '0'}</span>
          <span className="k">Produk Stok Negatif</span>
          <span className="v">{buku.neg === null ? '—'
            : buku.neg ? <b style={{ color: 'var(--red)' }}>{buku.neg}</b> : '0'}</span>
          <span className="k">Data Contoh Tertinggal</span>
          <span className="v">{buku.tertinggal === null
            ? <span className="mut">— (fungsi demo_shift_days belum ada, migrasi 0025)</span>
            : buku.tertinggal === 0
              ? '0 hari — sejajar dengan hari ini'
              : <><b style={{ color: 'var(--amber)' }}>{buku.tertinggal} hari</b>
                  {' '}— jalankan <code>select refresh_demo_data();</code> agar halaman
                  yang menyaring tanggal tidak kosong</>}</span>
        </div>
      </CardBody></Card>

      <div className="info-box mt14">Halaman ini hanya membaca, tidak mengubah apa pun. Kolom
        <b> Jumlah Baris</b> dihitung langsung dari basis data tanpa filter tanggal, jadi angkanya
        bisa lebih besar daripada yang tampil di menu masing-masing — menu memakai rentang tanggal
        kirim, halaman ini tidak.</div>
    </>
  );
}
