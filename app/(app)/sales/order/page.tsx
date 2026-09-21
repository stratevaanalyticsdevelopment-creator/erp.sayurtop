'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Badge, Card, CardBody, ConfirmBox, DataTable, F, Fg, Kv, Modal, ModalBody, ModalFoot,
  ModalHead, PageHead, Prog, SecT, Timeline,
} from '@/components/ui';
import { EditLine, LineEditor, Totals, newLine, unresolvedLines } from '@/components/line-editor';
import { ST } from '@/lib/menu';
import { calcDoc, docBelowCost, docMargin, lineNet } from '@/lib/calc';
import { dAdd, dFmt, dFmtL, num, rp, today, tsFmt } from '@/lib/format';
import type { BelowCost, DocLine, OrderOutstanding, SalesOrder } from '@/lib/types';
import { SjForm } from '@/components/sj-form';

const STATUSES = [ST.DRAFT, ST.SUBMITTED, ST.APPROVED, ST.PROCESSING, ST.PARTIAL,
  ST.DELIVERED, ST.INVOICED, ST.PAID, ST.CANCELLED];

function OrdersPage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SalesOrder[]>([]);
  const [outs, setOuts] = useState<OrderOutstanding[]>([]);
  const [q, setQ] = useState('');
  const [st, setSt] = useState('ALL');
  const [custF, setCustF] = useState('ALL');
  const [detail, setDetail] = useState<SalesOrder | null>(null);
  const [form, setForm] = useState<Partial<SalesOrder> | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmBelow, setConfirmBelow] = useState(false);
  const [sjFor, setSjFor] = useState<SalesOrder | null>(null);
  const [reject, setReject] = useState<SalesOrder | null>(null);
  const [rejectWhy, setRejectWhy] = useState('');

  const load = useCallback(async () => {
    const [o, ov] = await Promise.all([
      supabase.from('sales_order').select('*').order('order_date', { ascending: false }).order('no', { ascending: false }),
      supabase.from('order_outstanding_view').select('*'),
    ]);
    setRows((o.data as SalesOrder[]) || []);
    setOuts((ov.data as OrderOutstanding[]) || []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const doc = params.get('doc');
    if (doc && rows.length) { const o = rows.find((x) => x.no === doc); if (o) openDetail(o); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, rows.length]);

  const progress = useCallback((no: string) => {
    const mine = outs.filter((x) => x.order_no === no);
    const tot = mine.reduce((a, b) => a + Number(b.ordered_qty), 0);
    const del = mine.reduce((a, b) => a + Number(b.delivered_qty), 0);
    return tot ? Math.min(100, Math.round((del / tot) * 100)) : 0;
  }, [outs]);

  const filtered = rows.filter((o) => {
    if (st === '__BELOW') { if (!o.below_cost?.length) return false; }
    else if (st !== 'ALL' && o.status !== st) return false;
    if (custF !== 'ALL' && o.customer_code !== custF) return false;
    const t = q.toLowerCase();
    return !t || o.no.toLowerCase().includes(t) || s.cust(o.customer_code).name.toLowerCase().includes(t) ||
      (o.po_no || '').toLowerCase().includes(t);
  });

  async function openDetail(o: SalesOrder) {
    const { data } = await supabase.from('sales_order_line').select('*').eq('order_no', o.no).order('line_no');
    setDetail({ ...o, lines: (data as DocLine[]) || [] });
  }

  function openForm(o: SalesOrder | null, ls: DocLine[] = []) {
    if (!s.can(o ? 'edit' : 'create')) { s.toast('Tidak memiliki hak akses.', 'err'); return; }
    const c = o ? s.cust(o.customer_code) : s.customers[0];
    setForm(o ? { ...o } : {
      no: '(otomatis)', order_date: today(), delivery_date: dAdd(today(), 2),
      customer_code: c.code, salesperson_code: c.salesperson_code, warehouse_code: s.settings?.default_warehouse,
      term_code: c.term_code, po_no: '', note: '',
    });
    const defTax = c.npwp === '-' ? 0 : 11;
    setLines(ls.length ? ls.map((l) => ({ ...l, priceAuto: false })) : [newLine(defTax)]);
  }

  const defTax = form ? (s.cust(form.customer_code).npwp === '-' ? 0 : 11) : 11;
  const tot = calcDoc(lines);
  const below = docBelowCost(lines, s.productMap);

  async function persist(status: string, ack = false) {
    const bad = unresolvedLines(lines);
    if (bad.length) {
      s.toast(`Produk tidak dikenali: ${bad.slice(0, 3).join(', ')}. Pilih dari daftar produk.`, 'err');
      return;
    }
    const clean = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!clean.length) { s.toast('Minimal satu baris produk dengan qty lebih dari 0.', 'err'); return; }
    if (below.length && !ack) { setConfirmBelow(true); return; }

    const payload = {
      no: form?.no, order_date: form?.order_date, delivery_date: form?.delivery_date,
      customer_code: form?.customer_code, salesperson_code: form?.salesperson_code,
      warehouse_code: form?.warehouse_code, po_no: form?.po_no, term_code: form?.term_code,
      note: form?.note, status,
      lines: clean.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price,
        disc_pct: l.disc_pct, tax_pct: l.tax_pct })),
    };
    setBusy(true);
    const isEdit = !!form?.no && form.no !== '(otomatis)';
    const { data, error } = isEdit
      ? await supabase.rpc('update_sales_order', { p: payload })
      : await supabase.rpc('create_sales_order', { p: payload });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(isEdit ? `Perubahan Sales Order ${form?.no} tersimpan.`
      : `Sales Order ${data} tersimpan.${below.length ? ' Ditandai di bawah harga pokok.' : ''}`,
      below.length ? 'warn' : 'ok');
    setForm(null); setConfirmBelow(false); await load();
  }

  async function approve(o: SalesOrder, ok: boolean, reason?: string) {
    const { error } = await supabase.rpc('approve_sales_order', { p_no: o.no, p_ok: ok, p_reason: reason || null });
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Order ${o.no} ${ok ? 'disetujui' : 'ditolak'}.`, ok ? 'ok' : 'warn');
    setDetail(null); setReject(null); setRejectWhy(''); await load();
  }

  async function cancelOrder(o: SalesOrder) {
    const { error } = await supabase.from('sales_order').update({ status: ST.CANCELLED }).eq('no', o.no);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Order ${o.no} dibatalkan.`, 'warn');
    setDetail(null); await load();
  }

  const detailOuts = detail ? outs.filter((x) => x.order_no === detail.no) : [];
  const canSJ = detail && [ST.APPROVED, ST.PROCESSING, ST.PARTIAL].includes(detail.status) &&
    detailOuts.some((x) => Number(x.outstanding_qty) > 0);

  return (
    <>
      <PageHead title="Sales Order"
        desc="Seluruh order pelanggan Sayur Top. Satu order dapat menghasilkan beberapa Surat Jalan dan Invoice (partial delivery)."
        actions={s.can('create') ? <button className="btn pri" onClick={() => openForm(null)}>+ Sales Order Baru</button> : undefined} />

      <div className="fbar">
        <input className="grow" placeholder="Cari no. SO, customer, atau PO customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="ALL">Semua Status</option>
          {STATUSES.map((x) => <option key={x}>{x}</option>)}
          <option value="__BELOW">⚠ Di bawah harga pokok</option>
        </select>
        <select value={custF} onChange={(e) => setCustF(e.target.value)}>
          <option value="ALL">Semua Customer</option>
          {s.customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select>
        <span className="sm mut">{filtered.length} order · {rp(filtered.reduce((a, b) => a + Number(b.total), 0))}</span>
      </div>

      <Card><CardBody flush>
        <DataTable<SalesOrder> rows={filtered} rowKey={(r) => r.no} onRow={openDetail} cols={[
          { t: 'No. SO', f: (o) => <><span className="doc-no">{o.no}</span>
            {o.below_cost?.length ? <> <span className="bdg2 b-red" title="Harga jual di bawah harga pokok">⚠</span></> : null}</> },
          { t: 'Tanggal', f: (o) => dFmt(o.order_date) },
          { t: 'Customer', f: (o) => s.cust(o.customer_code).name },
          { t: 'PO Customer', f: (o) => <span className="sm mono">{o.po_no || '-'}</span> },
          { t: 'Sales', f: (o) => <span className="sm">{s.sp(o.salesperson_code).name}</span> },
          { t: 'Progress Kirim', f: (o) => <Prog pct={progress(o.no)} /> },
          { t: 'Total', cls: 'num', f: (o) => rp(o.total) },
          { t: 'Status', f: (o) => <Badge st={o.status} /> },
        ]} />
      </CardBody></Card>

      {/* ---------- DETAIL ---------- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="wide">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<>{detail.no} &nbsp;<Badge st={detail.status} /></>}
            sub={`${s.cust(detail.customer_code).name} · ${dFmtL(detail.order_date)} · PO ${detail.po_no || '-'}`} />
          <ModalBody>
            <div className="grid-2">
              <Kv rows={[
                ['Customer', s.cust(detail.customer_code).name],
                ['Alamat Kirim', s.cust(detail.customer_code).shipping_address || '-'],
                ['Sales Person', s.sp(detail.salesperson_code).name],
                ['Gudang', s.wh(detail.warehouse_code).name],
              ]} />
              <Kv rows={[
                ['Tanggal Order', dFmtL(detail.order_date)],
                ['Target Kirim', dFmtL(detail.delivery_date)],
                ['Termin', s.termOf(detail.term_code).name],
                ['Dibuat', tsFmt(detail.created_at)],
              ]} />
            </div>

            {detail.below_cost?.length ? (
              <div className="err-box mt14">
                <b>⚠ Order ini memuat {detail.below_cost.length} baris dengan harga jual di bawah harga pokok.</b>
                <div style={{ marginTop: 6 }}>
                  {(detail.below_cost as BelowCost[]).map((b, i) => (
                    <div key={i}>• {b.name} — {rp(b.net)} vs harga pokok {rp(b.base)} (rugi {rp(b.gap)} per {b.unit})</div>
                  ))}
                </div>
              </div>
            ) : detail.lines?.length ? (
              <div className="info-box mt14">
                Estimasi margin kotor order: <b>{rp(docMargin(detail.lines, s.productMap).margin)}</b>{' '}
                ({num(docMargin(detail.lines, s.productMap).pct, 1)}%) — berdasarkan harga pokok master produk saat ini.
              </div>
            ) : null}

            <SecT>Detail Barang &amp; Realisasi Pengiriman</SecT>
            <DataTable<DocLine> rows={detail.lines || []} cols={[
              { t: 'SKU', f: (l) => <span className="doc-no">{l.product_id}</span> },
              { t: 'Produk', f: (l) => l.name },
              { t: 'Order', cls: 'num', f: (l) => `${num(l.qty, 0)} ${l.unit}` },
              { t: 'Terkirim', cls: 'num', f: (l) => num(detailOuts.find((x) => x.product_id === l.product_id)?.delivered_qty || 0, 0) },
              { t: 'Sisa', cls: 'num', f: (l) => {
                const o = Number(detailOuts.find((x) => x.product_id === l.product_id)?.outstanding_qty || 0);
                return o > 0 ? <b style={{ color: 'var(--acc)' }}>{num(o, 0)}</b> : <span className="mut">0</span>;
              } },
              { t: 'Harga', cls: 'num', f: (l) => rp(l.price) },
              { t: 'Disc', cls: 'num', f: (l) => `${l.disc_pct || 0}%` },
              { t: 'Jumlah', cls: 'num', f: (l) => rp(lineNet(l)) },
            ]} />
            <Totals t={{ gross: detail.gross, disc: detail.disc, sub: detail.sub, tax: detail.tax, total: detail.total }} />

            <SecT>Document Timeline</SecT>
            <TimelineFor no={detail.no} />
          </ModalBody>
          <ModalFoot left={<>
            {detail.status === ST.SUBMITTED && s.can('approve') ? <>
              <button className="btn danger" onClick={() => setReject(detail)}>Tolak</button>
              <button className="btn blue" onClick={() => approve(detail, true)}>✓ Approve Order</button>
            </> : null}
            {[ST.DRAFT, ST.SUBMITTED].includes(detail.status) && s.can('edit') ? (
              <button className="btn" onClick={() => { const d = detail; setDetail(null); openForm(d, d.lines || []); }}>Edit</button>
            ) : null}
            {[ST.DRAFT, ST.SUBMITTED].includes(detail.status) && s.can('cancel') ? (
              <button className="btn danger" onClick={() => cancelOrder(detail)}>Batalkan</button>
            ) : null}
          </>}>
            {canSJ && s.can('create') ? (
              <button className="btn" onClick={() => { const d = detail; setDetail(null); setSjFor(d); }}>🚚 Buat Surat Jalan</button>
            ) : null}
            <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      {/* ---------- FORM ---------- */}
      <Modal open={!!form} onClose={() => setForm(null)} size="wide">
        {form ? (<>
          <ModalHead onClose={() => setForm(null)}
            title={form.no && form.no !== '(otomatis)' ? `Edit Sales Order ${form.no}` : 'Sales Order Baru'}
            sub="Data customer, harga, dan pajak diambil dari master — tidak perlu diketik ulang." />
          <ModalBody>
            <SecT>Header Dokumen</SecT>
            <Fg>
              <F label="Nomor SO"><input value={form.no || '(otomatis)'} disabled /></F>
              <F label="Tanggal Order"><input type="date" value={form.order_date || ''}
                onChange={(e) => setForm({ ...form, order_date: e.target.value })} /></F>
              <F label="Target Kirim"><input type="date" value={form.delivery_date || ''}
                onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} /></F>
              <F label="Customer"><select value={form.customer_code || ''} onChange={(e) => {
                const c = s.cust(e.target.value);
                const nt = c.npwp === '-' ? 0 : 11;
                setForm({ ...form, customer_code: c.code, term_code: c.term_code, salesperson_code: c.salesperson_code });
                setLines(lines.map((l) => ({ ...l, tax_pct: nt })));
              }}>{s.customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</select></F>
              <F label="PO Customer"><input value={form.po_no || ''} placeholder="Nomor PO dari customer"
                onChange={(e) => setForm({ ...form, po_no: e.target.value })} /></F>
              <F label="Termin Pembayaran"><select value={form.term_code || ''}
                onChange={(e) => setForm({ ...form, term_code: e.target.value })}>
                {s.terms.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></F>
              <F label="Sales Person"><select value={form.salesperson_code || ''}
                onChange={(e) => setForm({ ...form, salesperson_code: e.target.value })}>
                {s.salespersons.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></F>
              <F label="Gudang Pengirim"><select value={form.warehouse_code || ''}
                onChange={(e) => setForm({ ...form, warehouse_code: e.target.value })}>
                {s.warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}</select></F>
            </Fg>
            <CustInfo code={form.customer_code || ''} addTotal={tot.total} />
            <SecT>Detail Barang</SecT>
            <LineEditor lines={lines} setLines={setLines} defTax={defTax} />
            <Totals t={tot} />
            <SecT>Catatan</SecT>
            <F label=""><textarea value={form.note || ''} placeholder="Catatan pengiriman, permintaan khusus customer, dll."
              onChange={(e) => setForm({ ...form, note: e.target.value })} /></F>
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setForm(null)}>Batal</button>
            <button className="btn" onClick={() => persist(ST.DRAFT)} disabled={busy}>Simpan Draft</button>
            <button className="btn pri" onClick={() => persist(ST.SUBMITTED)} disabled={busy}>Simpan &amp; Ajukan Approval</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      <ConfirmBox open={confirmBelow} danger yesLabel="Ya, Lanjutkan"
        title="Harga Jual di Bawah Harga Pokok"
        onClose={() => setConfirmBelow(false)} onYes={() => persist(ST.SUBMITTED, true)}
        body={<>
          <div>{below.length} baris memiliki harga jual (setelah diskon) lebih rendah dari harga pokok:</div>
          <ul style={{ margin: '9px 0 9px 18px', lineHeight: 1.8 }}>
            {below.map((b, i) => (
              <li key={i}><b>{b.l.name}</b> — {rp(b.w.net)} vs harga pokok {rp(b.w.base)}{' '}
                <span style={{ color: 'var(--red)' }}>(rugi {rp(b.w.gap)} per {b.l.unit || 'unit'})</span></li>
            ))}
          </ul>
          <div>Estimasi margin dokumen <b>{rp(docMargin(lines, s.productMap).margin)}</b>. Order akan ditandai{' '}
            <b>DI BAWAH HARGA POKOK</b> dan wajib disetujui Sales Manager.</div>
        </>} />

      <Modal open={!!reject} onClose={() => setReject(null)} size="narrow">
        <ModalHead title="Tolak Order" onClose={() => setReject(null)} />
        <ModalBody>
          <F label="Alasan penolakan"><textarea rows={4} value={rejectWhy} onChange={(e) => setRejectWhy(e.target.value)} /></F>
        </ModalBody>
        <ModalFoot>
          <button className="btn" onClick={() => setReject(null)}>Batal</button>
          <button className="btn danger" onClick={() => reject && approve(reject, false, rejectWhy)}>Tolak Order</button>
        </ModalFoot>
      </Modal>

      {sjFor ? <SjForm order={sjFor} onClose={() => setSjFor(null)} onDone={async () => { setSjFor(null); await load(); }} /> : null}
    </>
  );
}

function CustInfo({ code, addTotal }: { code: string; addTotal: number }) {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [os, setOs] = useState(0);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('invoice_view').select('outstanding').eq('customer_code', code).gt('outstanding', 0);
      setOs(((data as { outstanding: number }[]) || []).reduce((a, b) => a + Number(b.outstanding), 0));
    })();
  }, [supabase, code]);
  const c = s.cust(code);
  const after = os + addTotal;
  const over = Number(c.credit_limit) > 0 && after > Number(c.credit_limit);
  return (
    <div className={over ? 'warn-box mt14' : 'info-box mt14'}>
      <b>{c.name}</b> · {c.type || '-'} · NPWP {c.npwp || '-'}<br />
      Kirim ke: {c.shipping_address || '-'}<br />
      Credit limit {rp(c.credit_limit)} · AR berjalan {rp(os)} · Setelah order ini {rp(after)}
      {over ? <b> — MELEBIHI CREDIT LIMIT, butuh approval Sales Manager.</b> : null}
    </div>
  );
}

function TimelineFor({ no }: { no: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<{ ts: string; text: string; by_user: string | null }[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('sales_order_timeline').select('ts,text,by_user')
        .eq('order_no', no).order('ts').order('id');
      setItems((data as { ts: string; text: string; by_user: string | null }[]) || []);
    })();
  }, [supabase, no]);
  return <Timeline items={items.map((t) => ({ t: t.text, d: `${tsFmt(t.ts)} · ${t.by_user || '-'}` }))} />;
}

export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><OrdersPage /></Suspense>;
}
