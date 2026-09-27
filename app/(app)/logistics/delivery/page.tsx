'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import { Card, CardBody, CardHead, DataTable, Kpi, KpiGrid, PageHead } from '@/components/ui';
import { dDiff, dFmt, num, today } from '@/lib/format';
import type { Delivery } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [invoiced, setInvoiced] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [d, idl] = await Promise.all([
      supabase.from('delivery').select('*').order('delivery_date', { ascending: false }),
      supabase.from('invoice_delivery').select('delivery_no'),
    ]);
    setRows((d.data as Delivery[]) || []);
    setInvoiced(new Set(((idl.data as { delivery_no: string }[]) || []).map((x) => x.delivery_no)));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function confirm(d: Delivery) {
    const { error } = await supabase.rpc('confirm_delivery', {
      p_no: d.no, p_recv_by: s.cust(d.customer_code).pic || 'Penerima',
    });
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Surat Jalan ${d.no} dikonfirmasi.`, 'ok');
    await load();
  }

  const T = today();
  const transit = rows.filter((d) => d.status === 'IN TRANSIT');
  return (
    <>
      <PageHead title="Delivery Tracking"
        desc="Pemantauan status pengiriman harian. Surat Jalan yang belum dikonfirmasi customer tidak dapat ditagihkan." />
      <KpiGrid>
        <Kpi cls="k-blue" lb="Dikirim Hari Ini" vl={`${num(rows.filter((d) => d.delivery_date === T).length, 0)} SJ`}
          sb={`${num(rows.filter((d) => d.delivery_date === T).reduce((a, b) => a + Number(b.qty_total), 0), 0)} unit`} />
        <Kpi cls={transit.length ? 'k-acc' : 'k-green'} lb="In Transit" vl={`${num(transit.length, 0)} SJ`}
          sb="Menunggu konfirmasi penerimaan" />
        <Kpi cls="k-green" lb="Diterima (30 hari)"
          vl={`${num(rows.filter((d) => d.status === 'RECEIVED' && dDiff(d.delivery_date, T) <= 30).length, 0)} SJ`} sb="" />
        <Kpi cls="k-amber" lb="Belum Ditagih"
          vl={`${num(rows.filter((d) => d.status === 'RECEIVED' && !invoiced.has(d.no)).length, 0)} SJ`}
          sb="Siap dibuatkan invoice" />
      </KpiGrid>
      <Card>
        <CardHead title="Surat Jalan Belum Dikonfirmasi" />
        <CardBody flush>
          <DataTable<Delivery> rows={transit} rowKey={(r) => r.no}
            emptyT="Semua pengiriman sudah dikonfirmasi" cols={[
              { t: 'No. SJ', f: (d) => <span className="doc-no">{d.no}</span> },
              { t: 'Tanggal', f: (d) => <>{dFmt(d.delivery_date)} <span className="sm mut">({dDiff(d.delivery_date, T)} hari)</span></> },
              { t: 'Customer', f: (d) => s.cust(d.customer_code).name },
              { t: 'Driver', f: (d) => <span className="sm">{s.drivers.find((x) => x.code === d.driver_code)?.name || '-'}</span> },
              { t: 'Qty', cls: 'num', f: (d) => num(d.qty_total, 0) },
              { t: '', cls: 'ctr', f: (d) => s.can('edit')
                ? <button className="btn sm blue" onClick={() => confirm(d)}>Konfirmasi</button> : null },
            ]} />
        </CardBody>
      </Card>
    </>
  );
}
