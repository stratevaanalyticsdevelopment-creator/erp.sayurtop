'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { Card, CardBody, DataTable, PageHead } from '@/components/ui';
import { dFmt, num } from '@/lib/format';
import type { Delivery } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [inv, setInv] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      const [d, idl] = await Promise.all([
        supabase.from('delivery').select('*').eq('status', 'RECEIVED').order('recv_date', { ascending: false }),
        supabase.from('invoice_delivery').select('invoice_no,delivery_no'),
      ]);
      setRows((d.data as Delivery[]) || []);
      const m = new Map<string, string>();
      ((idl.data as { invoice_no: string; delivery_no: string }[]) || []).forEach((x) => m.set(x.delivery_no, x.invoice_no));
      setInv(m);
    })();
  }, [supabase]);

  return (
    <>
      <PageHead title="Goods Receipt"
        desc="Bukti penerimaan barang oleh customer. Menjadi dasar penerbitan invoice dan titik awal perhitungan jatuh tempo." />
      <Card><CardBody flush>
        <DataTable<Delivery> rows={rows} rowKey={(r) => r.no} cols={[
          { t: 'No. SJ', f: (d) => <span className="doc-no">{d.no}</span> },
          { t: 'Tgl Terima', f: (d) => dFmt(d.recv_date) },
          { t: 'Customer', f: (d) => s.cust(d.customer_code).name },
          { t: 'Penerima', f: (d) => <span className="sm">{d.recv_by || '-'}</span> },
          { t: 'Qty', cls: 'num', f: (d) => num(d.qty_total, 0) },
          { t: 'Invoice', f: (d) => inv.get(d.no)
            ? <span className="sm mono">{inv.get(d.no)}</span>
            : <span className="bdg2 b-amber">Belum ditagih</span> },
        ]} />
      </CardBody></Card>
    </>
  );
}
