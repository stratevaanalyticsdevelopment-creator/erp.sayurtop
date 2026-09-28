'use client';
/* Form penerimaan pembayaran — satu pembayaran dapat dialokasikan ke
   beberapa invoice; kelebihan menjadi Uang Muka Pelanggan (akun 2400). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import { F, Fg, Modal, ModalBody, ModalFoot, ModalHead, SecT } from './ui';
import { invOutstanding } from '@/lib/calc';
import { dDiff, dFmt, rp, today } from '@/lib/format';
import type { Invoice } from '@/lib/types';

export function PayForm({ invoice, customerCode, onClose, onDone }: {
  invoice?: Invoice | null; customerCode?: string;
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [cust, setCust] = useState(invoice?.customer_code || customerCode || s.customers[0]?.code || '');
  const [list, setList] = useState<Invoice[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState('Transfer');
  const [bank, setBank] = useState(s.banks[0]?.code || '');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async (code: string) => {
    const { data } = await supabase.from('invoice_view').select('*')
      .eq('customer_code', code).gt('outstanding', 0).order('due_date');
    const rows = (data as Invoice[]) || [];
    setList(rows);
    setAlloc({});
    if (invoice) {
      const target = rows.find((r) => r.no === invoice.no);
      if (target) {
        setAmount(invOutstanding(target));
        setAlloc({ [target.no]: invOutstanding(target) });
      }
    }
  }, [supabase, invoice]);

  useEffect(() => { loadList(cust); }, [cust, loadList]);

  const allocTot = Object.values(alloc).reduce((a, b) => a + (Number(b) || 0), 0);
  const rest = amount - allocTot;

  function auto() {
    let left = amount;
    const next: Record<string, number> = {};
    list.forEach((i) => {
      const os = invOutstanding(i);
      const give = Math.min(left, os);
      if (give > 0) { next[i.no] = give; left -= give; }
    });
    setAlloc(next);
  }

  async function save() {
    if (amount <= 0) { s.toast('Jumlah pembayaran harus lebih dari 0.', 'err'); return; }
    if (allocTot > amount + 0.005) { s.toast('Alokasi melebihi jumlah pembayaran.', 'err'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('record_payment', {
      p: { pay_date: date, customer_code: cust, amount, method, bank_code: bank, ref: ref || null,
        alloc: Object.entries(alloc).filter(([, v]) => Number(v) > 0)
          .map(([invoice_no, v]) => ({ invoice_no, amount: Number(v) })) },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Pembayaran ${data} tercatat, jurnal diposting.`, 'ok');
    await onDone();
  }

  return (
    <Modal open onClose={onClose} size="wide">
      <ModalHead title="Catat Pembayaran" onClose={onClose}
        sub="Isi jumlah diterima, lalu alokasikan ke invoice. Sisa alokasi tercatat sebagai uang muka pelanggan." />
      <ModalBody>
        <Fg>
          <F label="Tanggal"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></F>
          <F label="Customer"><select value={cust} disabled={!!invoice} onChange={(e) => setCust(e.target.value)}>
            {s.customers.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</select></F>
          <F label="Metode"><select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>Transfer</option><option>Giro</option><option>Tunai</option><option>Virtual Account</option></select></F>
          <F label="Bank Penerima"><select value={bank} onChange={(e) => setBank(e.target.value)}>
            {s.banks.map((b) => <option key={b.code} value={b.code}>{b.name} — {b.account_no}</option>)}</select></F>
          <F label="Jumlah Diterima"><input type="number" min={0} step={1000} value={amount}
            onChange={(e) => setAmount(Number(e.target.value) || 0)} /></F>
          <F label="Referensi / No. Bukti"><input value={ref} placeholder="cth. TRX889201"
            onChange={(e) => setRef(e.target.value)} /></F>
        </Fg>

        <SecT>Alokasi ke Invoice</SecT>
        {list.length ? (
          <table className="lines">
            <thead><tr><th>Invoice</th><th>Tgl</th><th>Jatuh Tempo</th>
              <th className="num">Sisa Tagihan</th><th className="num">Alokasi</th></tr></thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.no}>
                  <td><span className="doc-no">{i.no}</span></td>
                  <td>{dFmt(i.invoice_date)}</td>
                  <td>{dFmt(i.due_date)}{dDiff(i.due_date, today()) > 0
                    ? <> <span className="bdg2 b-red">overdue</span></> : null}</td>
                  <td className="num">{rp(invOutstanding(i))}</td>
                  <td style={{ width: 150 }}>
                    <input className="num" type="number" min={0} step={1000} value={alloc[i.no] || 0}
                      onChange={(e) => setAlloc({ ...alloc, [i.no]: Number(e.target.value) || 0 })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="info-box">Customer ini tidak memiliki invoice terbuka.</div>}

        <div className="tot-box mt14">
          <div className="tot-row"><span>Jumlah Diterima</span><span className="v">{rp(amount)}</span></div>
          <div className="tot-row"><span>Total Dialokasikan</span><span className="v">{rp(allocTot)}</span></div>
          <div className="tot-row grand"><span>Belum Dialokasikan</span><span className="v">{rp(rest)}</span></div>
        </div>
        {allocTot > amount ? (
          <div className="err-box mt14">Total alokasi melebihi jumlah yang diterima.</div>
        ) : rest > 0 && amount > 0 ? (
          <div className="info-box mt14">Sisa {rp(rest)} akan dicatat sebagai <b>Uang Muka Pelanggan</b> (akun 2400)
            dan dapat dialokasikan ke invoice berikutnya.</div>
        ) : null}
      </ModalBody>
      <ModalFoot>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn" onClick={auto}>Alokasi Otomatis (FIFO)</button>
        <button className="btn pri" onClick={save} disabled={busy || amount <= 0 || allocTot > amount}>
          Simpan &amp; Posting Jurnal</button>
      </ModalFoot>
    </Modal>
  );
}
