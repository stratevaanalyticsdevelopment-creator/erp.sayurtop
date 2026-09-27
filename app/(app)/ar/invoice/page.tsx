'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import {
  Badge, Card, CardBody, DataTable, F, Fg, Kpi, KpiGrid, Kv, Modal, ModalBody, ModalFoot,
  ModalHead, PageHead, SecT,
} from '@/components/ui';
import { EditLine, LineEditor, Totals, unresolvedLines } from '@/components/line-editor';
import { PrintInvoice } from '@/components/print-docs';
import { PayForm } from '@/components/pay-form';
import { RETURN_REASONS, ST } from '@/lib/menu';
import { calcDoc, invOutstanding, invStatus, lineNet } from '@/lib/calc';
import { dAdd, dDiff, dFmt, dFmtL, num, rp, rpShort, today } from '@/lib/format';
import type { CreditNote, DocLine, Invoice, Payment, Delivery } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';

function InvoicePage() {
  const s = useStore();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Invoice[]>([]);
  const [q, setQ] = useState('');
  const [st, setSt] = useState('ALL');
  const [custF, setCustF] = useState('ALL');
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [sjNos, setSjNos] = useState<string[]>([]);
  const [cns, setCns] = useState<CreditNote[]>([]);
  const [pays, setPays] = useState<Payment[]>([]);
  const [sjMap, setSjMap] = useState<Map<string, string[]>>(new Map());
  const [printing, setPrinting] = useState(false);
  const [retOpen, setRetOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* form retur */
  const [retLines, setRetLines] = useState<{ pid: string; name: string; unit: string; max: number; qty: number; reason: string; price: number; disc: number; tax: number }[]>([]);
  const [retDate, setRetDate] = useState(today());
  const [retWh, setRetWh] = useState('');
  const [retNote, setRetNote] = useState('');
  const [retOther, setRetOther] = useState('');

  /* form edit */
  const [edLines, setEdLines] = useState<EditLine[]>([]);
  const [edHead, setEdHead] = useState<{ invoice_date: string; due_date: string; term_code: string; po_no: string }>(
    { invoice_date: '', due_date: '', term_code: '', po_no: '' });
  const [edReason, setEdReason] = useState('');

  const load = useCallback(async () => {
    const [iv, idl] = await Promise.all([
      supabase.from('invoice_view').select('*')
        .order('invoice_date', { ascending: false }).order('no', { ascending: false }),
      supabase.from('invoice_delivery').select('invoice_no,delivery_no'),
    ]);
    setRows((iv.data as Invoice[]) || []);
    const m = new Map<string, string[]>();
    ((idl.data as { invoice_no: string; delivery_no: string }[]) || []).forEach((x) => {
      m.set(x.invoice_no, [...(m.get(x.invoice_no) || []), x.delivery_no]);
    });
    setSjMap(m);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (iv: Invoice) => {
    const [ld, sj, cn, pa] = await Promise.all([
      supabase.from('invoice_line').select('*').eq('invoice_no', iv.no).order('line_no'),
      supabase.from('invoice_delivery').select('delivery_no').eq('invoice_no', iv.no),
      supabase.from('credit_note').select('*').eq('invoice_no', iv.no).order('cn_date'),
      supabase.from('payment_alloc').select('payment_no,amount').eq('invoice_no', iv.no),
    ]);
    const full = { ...iv, lines: (ld.data as DocLine[]) || [] };
    setDetail(full);
    setSjNos(((sj.data as { delivery_no: string }[]) || []).map((x) => x.delivery_no));
    setCns((cn.data as CreditNote[]) || []);
    const payNos = ((pa.data as { payment_no: string }[]) || []).map((x) => x.payment_no);
    if (payNos.length) {
      const { data: pd } = await supabase.from('payment').select('*').in('no', payNos);
      setPays((pd as Payment[]) || []);
    } else setPays([]);
  }, [supabase]);

  useEffect(() => {
    const doc = params.get('doc');
    if (doc && rows.length) { const iv = rows.find((x) => x.no === doc); if (iv) openDetail(iv); }
  }, [params, rows, openDetail]);

  const filtered = rows.filter((i) => {
    if (st !== 'ALL' && invStatus(i) !== st) return false;
    if (custF !== 'ALL' && i.customer_code !== custF) return false;
    const t = q.toLowerCase();
    return !t || i.no.toLowerCase().includes(t) || (i.order_no || '').toLowerCase().includes(t) ||
      s.cust(i.customer_code).name.toLowerCase().includes(t) || (i.po_no || '').toLowerCase().includes(t);
  });
  const tot = filtered.reduce((a, b) => a + Number(b.net_total ?? b.total), 0);
  const os = filtered.reduce((a, b) => a + invOutstanding(b), 0);
  const ret = filtered.reduce((a, b) => a + Number(b.return_total), 0);
  const ovd = filtered.filter((i) => invStatus(i) === ST.OVERDUE);

  /* ---------- RETUR ---------- */
  /* Invoice baru: pilih Surat Jalan yang sudah diterima dan belum ditagihkan. */
  const [pickSj, setPickSj] = useState(false);
  const [sjList, setSjList] = useState<Delivery[]>([]);
  const [invDate, setInvDate] = useState(today());

  async function openPickSj() {
    const [d, idl] = await Promise.all([
      supabase.from('delivery').select('*').eq('status', 'RECEIVED').order('delivery_date'),
      supabase.from('invoice_delivery').select('delivery_no'),
    ]);
    const done = new Set(((idl.data as { delivery_no: string }[]) || []).map((x) => x.delivery_no));
    const list = ((d.data as Delivery[]) || []).filter((x) => !done.has(x.no));
    if (!list.length) { s.toast('Tidak ada Surat Jalan yang menunggu penagihan.', 'warn'); return; }
    setSjList(list); setPickSj(true);
  }

  async function makeInvoice(sj: Delivery) {
    setBusy(true);
    const { data, error } = await supabase.rpc('create_invoice_from_delivery', {
      p: { delivery_no: sj.no, invoice_date: invDate },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Invoice ${data} diterbitkan dan jurnal diposting.`, 'ok');
    setPickSj(false); await load();
  }

  function exportCsv() {
    downloadCsv('invoices',
      ['No Invoice', 'Tanggal', 'Jatuh Tempo', 'Customer', 'No SO', 'Subtotal', 'PPN', 'Total',
       'Retur', 'Dibayar', 'Sisa', 'Umur (hari)', 'Status'],
      filtered.map((i) => [i.no, i.invoice_date, i.due_date, s.cust(i.customer_code).name,
        i.order_no || '', Number(i.sub), Number(i.tax), Number(i.total), Number(i.return_total),
        Number(i.paid), invOutstanding(i), Math.max(0, dDiff(i.due_date, today())), invStatus(i)]));
  }

  function openRetur() {
    if (!detail) return;
    setRetLines((detail.lines || []).map((l) => ({
      pid: l.product_id, name: l.name, unit: l.unit,
      max: Number(l.qty) - Number(l.ret_qty || 0), qty: 0, reason: '',
      price: Number(l.price), disc: Number(l.disc_pct || 0), tax: Number(l.tax_pct || 0),
    })));
    setRetDate(today()); setRetWh(s.settings?.default_warehouse || s.warehouses[0]?.code || '');
    setRetNote(''); setRetOther(''); setRetOpen(true);
  }
  const retCalc = (() => {
    let sub = 0, tax = 0;
    retLines.forEach((l) => {
      if (!l.qty) return;
      const g = l.qty * l.price;
      const n = g - (g * l.disc) / 100;
      sub += n; tax += (n * l.tax) / 100;
    });
    sub = Math.round(sub); tax = Math.round(tax);
    return { sub, tax, tot: sub + tax };
  })();
  const retMissing = retLines.some((l) => l.qty > 0 && !l.reason);

  async function saveRetur() {
    if (!detail) return;
    const lines = retLines.filter((l) => l.qty > 0).map((l) => ({
      product_id: l.pid, qty: l.qty, reason: l.reason === 'Lainnya' ? (retOther || 'Lainnya') : l.reason,
    }));
    if (!lines.length) { s.toast('Isi minimal satu qty retur.', 'err'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('process_return', {
      p: { invoice_no: detail.no, return_date: retDate, warehouse_code: retWh, note: retNote || null, lines },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    const r = data as { return_no: string; cn_no: string; total: number };
    s.toast(`Retur ${r.return_no} diproses. Credit Note ${r.cn_no} senilai ${rp(r.total)} mengurangi tagihan ${detail.no}.`, 'ok');
    setRetOpen(false); setDetail(null); await load(); await s.reloadMaster();
  }

  /* ---------- EDIT INVOICE ---------- */
  function openEdit() {
    if (!detail) return;
    setEdLines((detail.lines || []).map((l) => ({ ...l, priceAuto: false })));
    setEdHead({ invoice_date: detail.invoice_date, due_date: detail.due_date,
      term_code: detail.term_code || '', po_no: detail.po_no || '' });
    setEdReason(''); setEditOpen(true);
  }
  async function saveEdit() {
    if (!detail) return;
    if (!edReason.trim()) { s.toast('Alasan perubahan wajib diisi.', 'err'); return; }
    const bad = unresolvedLines(edLines);
    if (bad.length) { s.toast(`Produk tidak dikenali: ${bad.join(', ')}.`, 'err'); return; }
    const clean = edLines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!clean.length) { s.toast('Invoice harus memiliki minimal satu baris.', 'err'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('update_invoice', {
      p: { no: detail.no, invoice_date: edHead.invoice_date, due_date: edHead.due_date,
        term_code: edHead.term_code, po_no: edHead.po_no, reason: edReason.trim(),
        lines: clean.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price,
          disc_pct: l.disc_pct, tax_pct: l.tax_pct })) },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Invoice ${detail.no} diperbarui, jurnal diposting ulang.`, 'ok');
    setEditOpen(false); setDetail(null); await load();
  }

  const hasRet = detail ? Number(detail.return_total) > 0 : false;
  const stDetail = detail ? invStatus(detail) : '';

  return (
    <>
      <PageHead title="Invoice"
        desc={<>Invoice diterbitkan dari Surat Jalan yang sudah diterima customer. Barang retur diproses lewat tombol{' '}
          <b>Retur Barang</b> pada detail invoice — sistem otomatis membuat Credit Note, mengurangi piutang,
          dan membalik jurnal HPP.</>}
        actions={<>
          {s.can('create') ? <button className="btn pri" onClick={openPickSj}>+ Invoice Baru</button> : null}
          <button className="btn" onClick={exportCsv}>⇩ Export CSV</button>
        </>} />

      <KpiGrid>
        <Kpi cls="k-blue" lb="Nilai Invoice (filter)" vl={rpShort(tot)} sb={`${num(filtered.length, 0)} invoice`} />
        <Kpi cls="k-amber" lb="Outstanding" vl={rpShort(os)}
          sb={`${num(filtered.filter((i) => invOutstanding(i) > 0).length, 0)} belum lunas`} />
        <Kpi cls={ret ? 'k-acc' : 'k-green'} lb="Nilai Retur" vl={rpShort(ret)}
          sb={`${num(filtered.filter((i) => Number(i.return_total) > 0).length, 0)} invoice ada retur`} />
        <Kpi cls="k-red" lb="Overdue" vl={rpShort(ovd.reduce((a, b) => a + invOutstanding(b), 0))}
          sb={`${num(ovd.length, 0)} invoice`} />
      </KpiGrid>

      <div className="fbar">
        <input className="grow" placeholder="Cari no. invoice, SO, PO, atau customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="ALL">Semua Status</option>
          {[ST.OPEN, ST.PART_PAID, ST.PAID, ST.OVERDUE, ST.CANCELLED].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select value={custF} onChange={(e) => setCustF(e.target.value)}>
          <option value="ALL">Semua Customer</option>
          {s.customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
        </select>
      </div>

      <Card><CardBody flush>
        <DataTable<Invoice> rows={filtered} rowKey={(r) => r.no} onRow={openDetail} cols={[
          { t: 'No. Invoice', f: (i) => <><span className="doc-no">{i.no}</span>
            {Number(i.return_total) > 0 ? <> <span className="bdg2 b-lime">RETUR</span></> : null}</> },
          { t: 'Tanggal', f: (i) => dFmt(i.invoice_date) },
          { t: 'Jatuh Tempo', f: (i) => {
            const d = dDiff(i.due_date, today());
            return <>{dFmt(i.due_date)}{d > 0 && invOutstanding(i) > 0
              ? <span className="sm" style={{ color: 'var(--red)' }}> +{d}h</span> : null}</>;
          } },
          { t: 'Customer', f: (i) => s.cust(i.customer_code).name },
          { t: 'Ref SJ', f: (i) => <span className="sm mono">{(sjMap.get(i.no) || []).join(', ') || '-'}</span> },
          { t: 'Nilai', cls: 'num', f: (i) => rp(i.total) },
          { t: 'Retur', cls: 'num', f: (i) => Number(i.return_total)
            ? <span style={{ color: 'var(--acc)' }}>−{rp(i.return_total)}</span> : <span className="mut">—</span> },
          { t: 'Dibayar', cls: 'num', f: (i) => rp(i.paid) },
          { t: 'Sisa', cls: 'num', f: (i) => invOutstanding(i) > 0
            ? <b>{rp(invOutstanding(i))}</b> : <span className="mut">0</span> },
          { t: 'Status', f: (i) => <Badge st={invStatus(i)} /> },
        ]} />
      </CardBody></Card>

      {/* ---------- DETAIL ---------- */}
      <Modal open={!!detail && !printing && !retOpen && !editOpen && !payOpen} onClose={() => setDetail(null)} size="wide">
        {detail ? (<>
          <ModalHead onClose={() => setDetail(null)}
            title={<>{detail.no} <Badge st={stDetail} />{hasRet ? <> <span className="bdg2 b-lime">ADA RETUR</span></> : null}</>}
            sub={`${s.cust(detail.customer_code).name} · terbit ${dFmtL(detail.invoice_date)} · jatuh tempo ${dFmtL(detail.due_date)}`} />
          <ModalBody>
            <div className="grid-2">
              <Kv rows={[
                ['Customer', s.cust(detail.customer_code).name],
                ['NPWP', s.cust(detail.customer_code).npwp || '-'],
                ['Alamat Tagih', s.cust(detail.customer_code).billing_address || '-'],
                ['Termin', s.termOf(detail.term_code).name],
              ]} />
              <Kv rows={[
                ['Sales Order', detail.order_no || '-'],
                ['Surat Jalan', sjNos.join(', ') || '-'],
                ['PO Customer', detail.po_no || '-'],
                ['Jurnal', detail.journal_no || '-'],
              ]} />
            </div>

            <SecT>Detail Tagihan</SecT>
            <DataTable<DocLine> rows={detail.lines || []} cols={[
              { t: 'SKU', f: (l) => <span className="doc-no">{l.product_id}</span> },
              { t: 'Produk', f: (l) => <>{l.name}{l.ret_reason
                ? <div className="sm" style={{ color: 'var(--acc)' }}>Retur: {l.ret_reason}</div> : null}</> },
              { t: 'Qty', cls: 'num', f: (l) => `${num(l.qty, 0)} ${l.unit}` },
              { t: 'Qty Retur', cls: 'num', f: (l) => Number(l.ret_qty)
                ? <b style={{ color: 'var(--acc)' }}>−{num(l.ret_qty, 0)}</b> : <span className="mut">—</span> },
              { t: 'Qty Net', cls: 'num', f: (l) => num(Number(l.qty) - Number(l.ret_qty || 0), 0) },
              { t: 'Harga', cls: 'num', f: (l) => rp(l.price) },
              { t: 'Disc', cls: 'num', f: (l) => `${l.disc_pct || 0}%` },
              { t: 'Jumlah', cls: 'num', f: (l) => rp(lineNet(l)) },
            ]} />

            {/* Pertanyaan yang selalu muncul saat ada retur: mengapa Jumlah tidak
                memakai Qty Net. Dijelaskan di tempat kejadiannya. */}
            {hasRet ? (
              <div className="info-box mt14">Kolom <b>Jumlah</b> tetap memakai <b>Qty</b> asli,
                bukan Qty Net. Faktur yang sudah terbit tidak diubah nilainya; retur dikreditkan
                lewat <b>Credit Note</b> tersendiri yang tampil di rekap bawah sebagai pengurang
                sisa tagihan. Dengan begitu nilai faktur asli, nilai retur, dan sisa tagihan
                ketiganya tetap dapat ditelusuri — dan jumlah yang harus dibayar pelanggan sudah
                bersih dari retur.</div>) : null}

            <Totals t={{ gross: detail.gross, disc: detail.disc, sub: detail.sub, tax: detail.tax, total: detail.total }} />
            <div className="tot-box">
              {hasRet ? <div className="tot-row neg"><span>Retur / Credit Note</span>
                <span className="v">−{rp(detail.return_total)}</span></div> : null}
              <div className="tot-row neg"><span>Telah Dibayar</span><span className="v">−{rp(detail.paid)}</span></div>
              <div className="tot-row grand" style={{ borderTopColor: 'var(--acc)' }}>
                <span>Sisa Tagihan</span>
                <span className="v" style={{ color: invOutstanding(detail) > 0 ? 'var(--acc)' : 'var(--green)' }}>
                  {rp(invOutstanding(detail))}</span>
              </div>
            </div>

            {cns.length ? (<>
              <SecT>Credit Note / Retur</SecT>
              <DataTable<CreditNote> rows={cns} cols={[
                { t: 'No. CN', f: (c) => <span className="doc-no">{c.no}</span> },
                { t: 'Tanggal', f: (c) => dFmt(c.cn_date) },
                { t: 'Alasan', f: (c) => <span className="sm">{c.reason || '-'}</span> },
                { t: 'Nilai', cls: 'num', f: (c) => '−' + rp(c.total) },
                { t: 'Jurnal', f: (c) => <span className="sm mono">{c.journal_no || '-'}</span> },
              ]} />
            </>) : null}

            {pays.length ? (<>
              <SecT>Riwayat Pembayaran</SecT>
              <DataTable<Payment> rows={pays} cols={[
                { t: 'No. Payment', f: (p) => <span className="doc-no">{p.no}</span> },
                { t: 'Tanggal', f: (p) => dFmt(p.pay_date) },
                { t: 'Metode', f: (p) => p.method },
                { t: 'Bank', f: (p) => s.banks.find((b) => b.code === p.bank_code)?.name || '-' },
                { t: 'Jumlah', cls: 'num', f: (p) => rp(p.amount) },
              ]} />
            </>) : null}
          </ModalBody>
          <ModalFoot left={<>
            {s.can('edit') && stDetail !== ST.CANCELLED
              ? <button className="btn" onClick={openEdit}>✎ Edit Invoice</button> : null}
            {s.can('create') && stDetail !== ST.CANCELLED
              ? <button className="btn warn" onClick={openRetur}>↩ Retur Barang</button> : null}
          </>}>
            <button className="btn" onClick={() => setPrinting(true)}>🖨 Cetak Invoice</button>
            {invOutstanding(detail) > 0 && s.can('create')
              ? <button className="btn pri" onClick={() => setPayOpen(true)}>💰 Catat Pembayaran</button> : null}
            <button className="btn" onClick={() => setDetail(null)}>Tutup</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      {/* ---------- RETUR ---------- */}
      <Modal open={retOpen} onClose={() => setRetOpen(false)} size="wide">
        {detail ? (<>
          <ModalHead title={`Retur Barang — Invoice ${detail.no}`} onClose={() => setRetOpen(false)}
            sub={`${s.cust(detail.customer_code).name} · Credit Note akan dibuat otomatis dan mengurangi piutang.`} />
          <ModalBody>
            <div className="info-box mb12">
              Sistem akan: (1) membuat dokumen <b>Sales Return</b>, (2) menerbitkan <b>Credit Note</b> sebesar
              nilai retur termasuk PPN, (3) mengurangi <b>sisa tagihan</b> invoice ini, (4) mengembalikan{' '}
              <b>stok</b> produk, dan (5) memposting <b>jurnal</b>: Retur Penjualan &amp; PPN Keluaran di debit,
              Piutang Usaha di kredit, serta pembalikan HPP.
            </div>
            <Fg c={3}>
              <F label="Tanggal Retur"><input type="date" value={retDate} min={detail.invoice_date}
                onChange={(e) => setRetDate(e.target.value)} /></F>
              <F label="Nomor Retur"><input value="(otomatis)" disabled /></F>
              <F label="Barang Kembali ke Gudang"><select value={retWh} onChange={(e) => setRetWh(e.target.value)}>
                {s.warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}</select></F>
            </Fg>
            <SecT>Barang yang Diretur</SecT>
            <table className="lines">
              <thead><tr>
                <th>SKU</th><th>Produk</th><th className="num">Qty Invoice</th><th className="num">Sudah Retur</th>
                <th className="num">Maks Retur</th><th className="num">Qty Retur</th>
                <th className="num">Qty Net Setelah Retur</th><th>Alasan</th><th className="num">Nilai Retur</th>
              </tr></thead>
              <tbody>
                {retLines.map((l, i) => {
                  const ivl = detail.lines?.[i];
                  const g = l.qty * l.price, n = g - (g * l.disc) / 100;
                  return (
                    <tr key={l.pid}>
                      <td><span className="doc-no">{l.pid}</span></td>
                      <td>{l.name}</td>
                      <td className="num">{num(ivl?.qty || 0, 0)}</td>
                      <td className="num">{num(ivl?.ret_qty || 0, 0)}</td>
                      <td className="num"><b>{num(l.max, 0)}</b></td>
                      <td style={{ width: 100 }}>
                        <input className="num" type="number" min={0} max={l.max} step={0.5} disabled={l.max <= 0}
                          value={l.qty} onChange={(e) => {
                            const v = Math.min(Number(e.target.value) || 0, l.max);
                            setRetLines(retLines.map((x, j) => j === i ? { ...x, qty: v } : x));
                          }} />
                      </td>
                      {/* Qty yang benar-benar tertagih setelah retur ini diproses:
                          qty invoice − yang sudah diretur sebelumnya − yang diretur sekarang. */}
                      <td className="num">
                        <b style={l.qty > 0 ? { color: 'var(--acc)' } : undefined}>
                          {num(l.max - l.qty, 0)}</b> {l.unit}
                      </td>
                      <td style={{ minWidth: 190 }}>
                        <select value={l.reason} onChange={(e) =>
                          setRetLines(retLines.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))}>
                          <option value="">— pilih alasan —</option>
                          {RETURN_REASONS.map((r) => <option key={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className="num">{rp(n + (n * l.tax) / 100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {retLines.some((l) => l.reason === 'Lainnya') ? (
              <div className="mt8"><F label="Alasan lainnya">
                <input value={retOther} onChange={(e) => setRetOther(e.target.value)} placeholder="Tuliskan alasan retur" /></F></div>
            ) : null}
            <div className="tot-box mt14">
              <div className="tot-row"><span>Nilai Retur (sebelum PPN)</span><span className="v">{rp(retCalc.sub)}</span></div>
              <div className="tot-row"><span>PPN atas Retur</span><span className="v">{rp(retCalc.tax)}</span></div>
              <div className="tot-row grand"><span>Total Credit Note</span><span className="v">{rp(retCalc.tot)}</span></div>
              <div className="tot-row"><span>Sisa tagihan saat ini</span><span className="v">{rp(invOutstanding(detail))}</span></div>
              <div className="tot-row"><span><b>Sisa tagihan setelah retur</b></span>
                <span className="v bold">{rp(invOutstanding(detail) - retCalc.tot)}</span></div>
            </div>
            {invOutstanding(detail) - retCalc.tot < 0 ? (
              <div className="warn-box mt14"><b>Nilai retur melebihi sisa tagihan.</b> Selisih{' '}
                {rp(retCalc.tot - invOutstanding(detail))} akan menjadi kelebihan bayar yang dapat dialokasikan ke invoice lain.</div>
            ) : null}
            {retMissing ? <div className="err-box mt14">Setiap baris yang diretur wajib memiliki alasan.</div> : null}
            <SecT>Catatan Retur</SecT>
            <F label=""><textarea value={retNote} onChange={(e) => setRetNote(e.target.value)}
              placeholder="cth. Retur dibawa kembali oleh driver pada pengiriman berikutnya." /></F>
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setRetOpen(false)}>Batal</button>
            <button className="btn warn" onClick={saveRetur} disabled={busy || retCalc.tot <= 0 || retMissing}>
              Proses Retur &amp; Terbitkan Credit Note</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      {/* ---------- EDIT INVOICE ---------- */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} size="wide">
        {detail ? (<>
          <ModalHead title={`Edit Invoice ${detail.no}`} onClose={() => setEditOpen(false)}
            sub="Perubahan akan membalik dan memposting ulang jurnal invoice. Seluruh perubahan tercatat di audit log." />
          <ModalBody>
            {Number(detail.paid) > 0 ? (
              <div className="warn-box mb12">
                <b>Invoice sudah menerima pembayaran {rp(detail.paid)}.</b> Qty dan harga tetap dapat diperbaiki,
                namun untuk pengembalian barang gunakan menu <b>Retur Barang</b> agar piutang, PPN, dan HPP
                terkoreksi melalui Credit Note.
              </div>
            ) : null}
            {hasRet ? (
              <div className="info-box mb12">
                Invoice ini memiliki retur senilai {rp(detail.return_total)}. Nilai retur tidak ikut berubah saat
                mengedit baris di bawah, dan qty baru tidak boleh lebih kecil dari qty yang sudah diretur.
              </div>
            ) : null}
            <Fg>
              <F label="Nomor Invoice"><input value={detail.no} disabled /></F>
              <F label="Tanggal Invoice"><input type="date" value={edHead.invoice_date}
                onChange={(e) => setEdHead({ ...edHead, invoice_date: e.target.value })} /></F>
              <F label="Termin"><select value={edHead.term_code} onChange={(e) => setEdHead({
                ...edHead, term_code: e.target.value,
                due_date: dAdd(edHead.invoice_date, s.termOf(e.target.value).days) })}>
                {s.terms.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></F>
              <F label="Jatuh Tempo"><input type="date" value={edHead.due_date}
                onChange={(e) => setEdHead({ ...edHead, due_date: e.target.value })} /></F>
              <F label="PO Customer"><input value={edHead.po_no}
                onChange={(e) => setEdHead({ ...edHead, po_no: e.target.value })} /></F>
              <F label="Referensi SJ"><input value={sjNos.join(', ')} disabled /></F>
            </Fg>
            <SecT>Detail Tagihan</SecT>
            <LineEditor lines={edLines} setLines={setEdLines}
              defTax={s.cust(detail.customer_code).npwp === '-' ? 0 : 11} />
            <Totals t={calcDoc(edLines)} />
            <SecT>Alasan Perubahan</SecT>
            <F label="" help="Wajib diisi — menjadi keterangan pada audit log dan jurnal koreksi.">
              <textarea value={edReason} onChange={(e) => setEdReason(e.target.value)}
                placeholder="cth. Koreksi harga sesuai kesepakatan, salah input qty, dll." /></F>
          </ModalBody>
          <ModalFoot>
            <button className="btn" onClick={() => setEditOpen(false)}>Batal</button>
            <button className="btn pri" onClick={saveEdit} disabled={busy}>Simpan &amp; Posting Ulang Jurnal</button>
          </ModalFoot>
        </>) : null}
      </Modal>

      {printing && detail ? <PrintInvoice iv={detail} sjNos={sjNos} onClose={() => setPrinting(false)} /> : null}
      {payOpen && detail ? (
        <PayForm invoice={detail} onClose={() => setPayOpen(false)}
          onDone={async () => { setPayOpen(false); setDetail(null); await load(); }} />
      ) : null}
      <Modal open={pickSj} onClose={() => setPickSj(false)} size="mid">
        <ModalHead title="Terbitkan Invoice dari Surat Jalan" onClose={() => setPickSj(false)}
          sub="Hanya Surat Jalan berstatus RECEIVED yang belum pernah ditagihkan." />
        <ModalBody>
          <Fg>
            <F label="Tanggal Invoice" help="Jatuh tempo dihitung otomatis dari termin order.">
              <input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></F>
          </Fg>
          <SecT>Surat Jalan Menunggu Penagihan</SecT>
          <DataTable<Delivery> rows={sjList} rowKey={(d) => d.no} onRow={makeInvoice} cols={[
            { t: 'No. SJ', f: (d) => <span className="doc-no">{d.no}</span> },
            { t: 'Tanggal', f: (d) => dFmt(d.delivery_date) },
            { t: 'No. SO', f: (d) => <span className="sm mono">{d.order_no}</span> },
            { t: 'Customer', f: (d) => s.cust(d.customer_code).name },
            { t: 'Qty', cls: 'num', f: (d) => num(d.qty_total, 0) },
            { t: '', cls: 'ctr', f: () => <button className="btn sm pri" disabled={busy}>Terbitkan</button> },
          ]} />
        </ModalBody>
        <ModalFoot><button className="btn" onClick={() => setPickSj(false)}>Tutup</button></ModalFoot>
      </Modal>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="mut" style={{ padding: 20 }}>Memuat…</div>}><InvoicePage /></Suspense>;
}
