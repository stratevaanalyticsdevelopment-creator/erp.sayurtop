'use client';
/* Form penerbitan Surat Jalan dari Sales Order.
   Qty dibatasi sisa outstanding; database menolak over-delivery sebagai
   lapisan pengaman kedua. */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import { F, Fg, Modal, ModalBody, ModalFoot, ModalHead, SecT } from './ui';
import { num, today } from '@/lib/format';
import type { OrderOutstanding, SalesOrder } from '@/lib/types';

export function SjForm({ order, onClose, onDone }: {
  order: SalesOrder; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [outs, setOuts] = useState<OrderOutstanding[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [date, setDate] = useState(today());
  const [whc, setWhc] = useState(order.warehouse_code || '');
  const [drv, setDrv] = useState(s.drivers[0]?.code || '');
  const [veh, setVeh] = useState(s.drivers[0]?.vehicle_code || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('order_outstanding_view').select('*').eq('order_no', order.no);
      const rows = ((data as OrderOutstanding[]) || []).filter((r) => Number(r.outstanding_qty) > 0);
      setOuts(rows);
      const q: Record<string, number> = {};
      rows.forEach((r) => { q[r.product_id] = Number(r.outstanding_qty); });
      setQty(q);
    })();
  }, [supabase, order.no]);

  const over = outs.filter((r) => (qty[r.product_id] || 0) > Number(r.outstanding_qty));
  const noStock = outs.filter((r) => {
    const p = s.prod(r.product_id);
    return p && (qty[r.product_id] || 0) > Number(p.stock);
  });
  const c = s.cust(order.customer_code);

  async function save() {
    const lines = outs.filter((r) => (qty[r.product_id] || 0) > 0)
      .map((r) => ({ product_id: r.product_id, qty: qty[r.product_id] }));
    if (!lines.length) { s.toast('Isi minimal satu qty pengiriman.', 'err'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('create_delivery', {
      p: { order_no: order.no, delivery_date: date, warehouse_code: whc,
        driver_code: drv, vehicle_code: veh, note: note || null, lines },
    });
    setBusy(false);
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Surat Jalan ${data} diterbitkan.`, 'ok');
    await onDone();
  }

  return (
    <Modal open onClose={onClose} size="wide">
      <ModalHead title={`Surat Jalan dari ${order.no}`} onClose={onClose}
        sub={`${c.name} — qty maksimum dibatasi sisa outstanding order.`} />
      <ModalBody>
        <Fg c={4}>
          <F label="Tanggal Kirim"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></F>
          <F label="Gudang"><select value={whc} onChange={(e) => setWhc(e.target.value)}>
            {s.warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}</select></F>
          <F label="Driver"><select value={drv} onChange={(e) => {
            setDrv(e.target.value);
            const d = s.drivers.find((x) => x.code === e.target.value);
            if (d?.vehicle_code) setVeh(d.vehicle_code);
          }}>{s.drivers.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</select></F>
          <F label="Kendaraan"><select value={veh} onChange={(e) => setVeh(e.target.value)}>
            {s.vehicles.map((v) => <option key={v.code} value={v.code}>{v.code} — {v.type}</option>)}</select></F>
        </Fg>

        <div className="info-box mt14">
          Alamat kirim: <b>{c.shipping_address || '-'}</b><br />
          PIC penerima: {c.pic || '-'} · {c.wa || '-'}
        </div>

        <SecT>Barang yang Dikirim</SecT>
        <table className="lines">
          <thead><tr>
            <th>SKU</th><th>Produk</th><th className="num">Order</th><th className="num">Sudah Kirim</th>
            <th className="num">Outstanding</th><th className="num">Qty Kirim</th><th className="num">Stok</th>
          </tr></thead>
          <tbody>
            {outs.map((r) => {
              const p = s.prod(r.product_id);
              const q = qty[r.product_id] || 0;
              const low = p && q > Number(p.stock);
              return (
                <tr key={r.product_id}>
                  <td><span className="doc-no">{r.product_id}</span></td>
                  <td>{r.name}</td>
                  <td className="num">{num(r.ordered_qty, 0)}</td>
                  <td className="num">{num(r.delivered_qty, 0)}</td>
                  <td className="num"><b>{num(r.outstanding_qty, 0)}</b></td>
                  <td style={{ width: 110 }}>
                    <input className="num" type="number" min={0} max={Number(r.outstanding_qty)} step={0.5}
                      value={q} onChange={(e) => setQty({ ...qty, [r.product_id]: Number(e.target.value) || 0 })} />
                  </td>
                  <td className="num" style={{ color: low ? 'var(--red)' : 'inherit', fontWeight: low ? 700 : 400 }}>
                    {num(p?.stock || 0, 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {over.length ? (
          <div className="err-box mt14">
            <b>Over-delivery dicegah.</b> Qty melebihi outstanding pada: {over.map((r) => r.name).join(', ')}.
          </div>
        ) : null}
        {noStock.length ? (
          <div className="warn-box mt14">
            <b>Stok tidak mencukupi</b> untuk: {noStock.map((r) => r.name).join(', ')}. Surat Jalan tetap dapat
            diterbitkan, stok akan menjadi minus.
          </div>
        ) : null}

        <SecT>Catatan Pengiriman</SecT>
        <F label=""><textarea value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="cth. Barang dikirim dengan cold chain, suhu 4–8°C." /></F>
      </ModalBody>
      <ModalFoot>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn pri" onClick={save} disabled={busy || over.length > 0}>Terbitkan Surat Jalan</button>
      </ModalFoot>
    </Modal>
  );
}
