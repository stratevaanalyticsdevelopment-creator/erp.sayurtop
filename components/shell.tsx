'use client';
/* Shell aplikasi: sidebar + topbar. Markup dan class sama dengan versi HTML. */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MENU, PAGE_TITLE, HREF_KEY } from '@/lib/menu';
import { useStore } from '@/lib/store';
import { createClient } from '@/lib/supabase/client';
import { Modal, ModalBody, ModalFoot, ModalHead, DataTable } from './ui';
import { rp, rpShort } from '@/lib/format';

export default function Shell({ children }: { children: React.ReactNode }) {
  const s = useStore();
  const path = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [alerts, setAlerts] = useState<{ t: string; href: string; c: string }[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ t: string; no: string; d: string; href: string }[] | null>(null);
  const [burger, setBurger] = useState(false);

  const key = HREF_KEY[path] || 'dashboard';
  const meta = PAGE_TITLE[key] || { t: '', g: '' };

  useEffect(() => {
    const f = () => setBurger(window.innerWidth <= 900);
    f(); window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  /* Kotak cari halaman langsung siap diketik begitu menu dibuka, tanpa perlu
     diklik lebih dulu. Jeda satu putaran agar halaman tujuan selesai dirender.
     Tidak dipaksakan bila pengguna sudah memindahkan fokus sendiri. */
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.querySelector('.ov.show')) return;
      const a = document.activeElement;
      if (a && a !== document.body && a.tagName !== 'MAIN') return;
      const el = document.querySelector<HTMLInputElement>('.content .fbar input.grow');
      if (el) el.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [path]);

  useEffect(() => {
    if (!s.ready || !s.profile) return;
    (async () => {
      const [ap, ov, tr, low] = await Promise.all([
        supabase.from('sales_order').select('no', { count: 'exact', head: true }).eq('status', 'SUBMITTED'),
        supabase.from('invoice_view').select('outstanding').eq('calc_status', 'OVERDUE'),
        supabase.from('delivery').select('no', { count: 'exact', head: true }).eq('status', 'IN TRANSIT'),
        supabase.from('product').select('id,stock,min_stock'),
      ]);
      setPending(ap.count || 0);
      const overdueRows = (ov.data as { outstanding: number }[]) || [];
      const overdueVal = overdueRows.reduce((a, b) => a + Number(b.outstanding || 0), 0);
      const lowN = ((low.data as { stock: number; min_stock: number }[]) || [])
        .filter((p) => Number(p.stock) <= Number(p.min_stock)).length;
      setAlerts([
        { t: `${ap.count || 0} Sales Order menunggu approval`, href: '/sales/approval', c: 'var(--red)' },
        { t: `${overdueRows.length} Invoice lewat jatuh tempo — ${rpShort(overdueVal)}`, href: '/ar/aging', c: 'var(--red)' },
        { t: `${tr.count || 0} Surat Jalan belum dikonfirmasi`, href: '/logistics/delivery', c: 'var(--acc)' },
        { t: `${lowN} Produk di bawah stok minimum`, href: '/master/product', c: 'var(--amber)' },
      ]);
    })();
  }, [s.ready, s.profile, supabase, path]);

  async function search() {
    const t = q.trim();
    if (t.length < 2) return;
    const like = `%${t}%`;
    const [so, sj, iv, cn, pay] = await Promise.all([
      supabase.from('sales_order').select('no,customer_code').ilike('no', like).limit(10),
      supabase.from('delivery').select('no,customer_code').ilike('no', like).limit(10),
      supabase.from('invoice').select('no,customer_code').ilike('no', like).limit(10),
      supabase.from('credit_note').select('no,customer_code').ilike('no', like).limit(10),
      supabase.from('payment').select('no,customer_code').ilike('no', like).limit(10),
    ]);
    type R = { no: string; customer_code: string };
    const out: { t: string; no: string; d: string; href: string }[] = [];
    ((so.data as R[]) || []).forEach((r) => out.push({ t: 'Sales Order', no: r.no, d: s.cust(r.customer_code).name, href: `/sales/order?doc=${r.no}` }));
    ((sj.data as R[]) || []).forEach((r) => out.push({ t: 'Surat Jalan', no: r.no, d: s.cust(r.customer_code).name, href: `/logistics/surat-jalan?doc=${r.no}` }));
    ((iv.data as R[]) || []).forEach((r) => out.push({ t: 'Invoice', no: r.no, d: s.cust(r.customer_code).name, href: `/ar/invoice?doc=${r.no}` }));
    ((cn.data as R[]) || []).forEach((r) => out.push({ t: 'Credit Note', no: r.no, d: s.cust(r.customer_code).name, href: `/ar/credit-note?doc=${r.no}` }));
    ((pay.data as R[]) || []).forEach((r) => out.push({ t: 'Payment', no: r.no, d: s.cust(r.customer_code).name, href: `/ar/payment?doc=${r.no}` }));
    s.customers.filter((c) => c.name.toLowerCase().includes(t.toLowerCase()) || c.code.toLowerCase().includes(t.toLowerCase()))
      .slice(0, 8).forEach((c) => out.push({ t: 'Customer', no: c.code, d: c.name, href: `/ar/statement?cust=${c.code}` }));
    s.products.filter((p) => p.name.toLowerCase().includes(t.toLowerCase()) || p.id.toLowerCase().includes(t.toLowerCase()))
      .slice(0, 8).forEach((p) => out.push({ t: 'Produk', no: p.id, d: `${p.name} — ${rp(p.sell_price)}`, href: `/master/product?doc=${p.id}` }));
    setHits(out.slice(0, 40));
  }

  const ini = (s.profile?.name || 'U').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div id="app" style={{ display: 'block' }}>
      <div className="shell">
        <aside className={'sidebar' + (open ? ' open' : '')}>
          <div className="sb-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/logo-sm-accent.png" alt="Sayur Top" />
            <div className="sys">Strateva O2C ERP</div>
          </div>
          <nav className="sb-nav">
            {MENU.map((g, gi) => {
              const items = g.items.filter((i) => s.canMenu(i.k));
              if (!items.length) return null;
              return (
                <div key={gi}>
                  {g.grp ? <div className="nav-grp">{g.grp}</div> : null}
                  {items.map((i) => (
                    <Link key={i.k} href={i.href} className={'nav-item' + (key === i.k ? ' on' : '')}
                      onClick={() => setOpen(false)}>
                      <span className="ic">{i.ic}</span>
                      <span>{i.t}</span>
                      {i.badge === 'approval' && pending > 0 ? <span className="bdg alert">{pending}</span> : null}
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="main">
          <header className="topbar">
            {burger ? <button className="tb-btn no-print" onClick={() => setOpen((v) => !v)}>☰</button> : null}
            <div>
              <div className="tb-title">{meta.t}</div>
              <div className="tb-crumb">{meta.g}</div>
            </div>
            <div className="tb-search">
              <span className="si">⌕</span>
              <input placeholder="Cari dokumen, pelanggan, produk…" value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
            </div>
            <button className="tb-btn" title="Notifikasi" onClick={() => setShowAlerts(true)}>
              🔔{pending > 0 ? <span className="dot" /> : null}
            </button>
            <button className="tb-btn" title="Bantuan" onClick={() => setShowHelp(true)}>?</button>
            <div className="tb-user" onClick={() => setShowUser(true)}>
              <div className="av">{ini}</div>
              <div>
                <div className="nm">{s.profile?.name}</div>
                <div className="rl">{s.profile?.role_name}</div>
              </div>
            </div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>

      <Modal open={!!hits} onClose={() => setHits(null)} size="mid">
        <ModalHead title="Hasil Pencarian" sub={`${hits?.length || 0} hasil untuk "${q}"`} onClose={() => setHits(null)} />
        <ModalBody>
          <DataTable
            rows={hits || []}
            onRow={(r) => { setHits(null); router.push(r.href); }}
            emptyT="Tidak ditemukan"
            emptyD="Coba kata kunci lain, misalnya nomor dokumen atau nama produk."
            cols={[
              { t: 'Jenis', f: (r) => <span className="bdg2 b-brand">{r.t}</span> },
              { t: 'Nomor / Kode', f: (r) => <span className="doc-no">{r.no}</span> },
              { t: 'Keterangan', f: (r) => r.d },
            ]}
          />
        </ModalBody>
      </Modal>

      <Modal open={showAlerts} onClose={() => setShowAlerts(false)} size="narrow">
        <ModalHead title="Notifikasi" onClose={() => setShowAlerts(false)} />
        <ModalBody>
          <div className="act-list">
            {alerts.map((a, i) => (
              <div key={i} className="act" onClick={() => { setShowAlerts(false); router.push(a.href); }}>
                <span className="dot" style={{ background: a.c }} />
                <span className="tx">{a.t}</span>
                <span className="go">›</span>
              </div>
            ))}
          </div>
        </ModalBody>
      </Modal>

      <Modal open={showUser} onClose={() => setShowUser(false)} size="narrow">
        <ModalHead title={s.profile?.name || ''} onClose={() => setShowUser(false)} />
        <ModalBody>
          <div className="kv">
            <span className="k">Username</span><span className="v">{s.profile?.username}</span>
            <span className="k">Email</span><span className="v">{s.profile?.email}</span>
            <span className="k">Role</span><span className="v">{s.profile?.role_name}</span>
            <span className="k">Hak Aksi</span>
            <span className="v">{s.profile?.acts === '*' ? 'Seluruh aksi' : (s.profile?.acts as string[])?.join(', ')}</span>
          </div>
        </ModalBody>
        <ModalFoot>
          <button className="btn danger" onClick={async () => {
            await supabase.auth.signOut();
            router.replace('/login'); router.refresh();
          }}>Keluar</button>
          <button className="btn" onClick={() => setShowUser(false)}>Tutup</button>
        </ModalFoot>
      </Modal>

      <Modal open={showHelp} onClose={() => setShowHelp(false)} size="mid">
        <ModalHead title="Panduan Singkat Strateva O2C ERP" sub="Alur kerja dan aturan utama aplikasi."
          onClose={() => setShowHelp(false)} />
        <ModalBody>
          <div className="sec-t">Alur Order-to-Cash</div>
          <div className="info-box">
            Quotation → Sales Order → Approval → Picking → <b>Surat Jalan</b> → Goods Receipt →{' '}
            <b>Invoice</b> → (Retur → Credit Note) → Penagihan → <b>Payment</b> → Jurnal → Laporan Keuangan.
          </div>
          <div className="sec-t">Aturan Penting</div>
          <ul style={{ fontSize: 12.5, lineHeight: 1.9, paddingLeft: 20 }}>
            <li>Satu Sales Order dapat menghasilkan <b>beberapa Surat Jalan dan Invoice</b> (partial delivery).</li>
            <li>Qty Surat Jalan dibatasi sisa outstanding order — <b>over-delivery ditolak oleh database</b>, bukan hanya UI.</li>
            <li>Invoice hanya dapat dibuat dari Surat Jalan yang sudah <b>dikonfirmasi diterima</b> customer.</li>
            <li>Retur diproses dari detail invoice: sistem membuat Sales Return dan Credit Note, mengurangi sisa tagihan,
              mengembalikan stok, serta membalik jurnal penjualan dan HPP.</li>
            <li><b>Edit Invoice</b> untuk koreksi input; alasan wajib diisi dan jurnal diposting ulang otomatis.</li>
            <li>Satu pembayaran dapat <b>dialokasikan ke beberapa invoice</b>; kelebihan menjadi Uang Muka Pelanggan.</li>
            <li>Seluruh perubahan tercatat di <b>Audit Log</b> beserta nilai sebelum dan sesudah.</li>
          </ul>
        </ModalBody>
        <ModalFoot><button className="btn" onClick={() => setShowHelp(false)}>Tutup</button></ModalFoot>
      </Modal>
    </div>
  );
}
