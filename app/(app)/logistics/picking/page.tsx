'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Badge, Card, CardBody, DataTable, PageHead } from '@/components/ui';
import { SjForm } from '@/components/sj-form';
import { dDiff, dFmt, num, today } from '@/lib/format';
import type { OrderOutstanding, SalesOrder } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SalesOrder[]>([]);
  const [outs, setOuts] = useState<OrderOutstanding[]>([]);
  const [sjFor, setSjFor] = useState<SalesOrder | null>(null);

  const load = useCallback(async () => {
    const [o, ov] = await Promise.all([
      supabase.from('sales_order').select('*').in('status', ['APPROVED', 'PROCESSING', 'PARTIALLY DELIVERED'])
        .order('delivery_date'),
      supabase.from('order_outstanding_view').select('*').gt('outstanding_qty', 0),
    ]);
    const outRows = (ov.data as OrderOutstanding[]) || [];
    setOuts(outRows);
    setRows(((o.data as SalesOrder[]) || []).filter((x) => outRows.some((r) => r.order_no === x.no)));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const T = today();
  return (
    <>
      <PageHead title="Picking List"
        desc="Order yang sudah disetujui dan masih memiliki sisa barang untuk disiapkan gudang. Urut berdasarkan target kirim terdekat." />
      <Card><CardBody flush>
        <DataTable<SalesOrder> rows={rows} rowKey={(r) => r.no}
          emptyT="Tidak ada order menunggu picking" emptyD="Semua order sudah dikirim penuh."
          cols={[
            { t: 'No. SO', f: (o) => <span className="doc-no">{o.no}</span> },
            { t: 'Target Kirim', f: (o) => {
              const d = o.delivery_date ? dDiff(o.delivery_date, T) : 0;
              return <>{dFmt(o.delivery_date)}{d > 0 ? <> <span className="bdg2 b-red">Telat {d}h</span></>
                : d === 0 ? <> <span className="bdg2 b-amber">Hari ini</span></> : null}</>;
            } },
            { t: 'Customer', f: (o) => s.cust(o.customer_code).name },
            { t: 'Gudang', f: (o) => <span className="sm">{s.wh(o.warehouse_code).name}</span> },
            { t: 'Sisa Item', cls: 'ctr', f: (o) => outs.filter((r) => r.order_no === o.no).length },
            { t: 'Sisa Qty', cls: 'num', f: (o) => num(outs.filter((r) => r.order_no === o.no)
              .reduce((a, b) => a + Number(b.outstanding_qty), 0), 0) },
            { t: 'Status', f: (o) => <Badge st={o.status} /> },
            { t: '', cls: 'ctr', f: (o) => s.can('create')
              ? <button className="btn sm pri" onClick={() => setSjFor(o)}>Buat Surat Jalan</button> : null },
          ]} />
      </CardBody></Card>
      {sjFor ? <SjForm order={sjFor} onClose={() => setSjFor(null)}
        onDone={async () => { setSjFor(null); await load(); }} /> : null}
    </>
  );
}
