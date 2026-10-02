'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore, errMsg } from '@/lib/store';
import { Card, CardBody, DataTable, PageHead } from '@/components/ui';
import { dFmt, num, rp } from '@/lib/format';
import type { DocLine, SalesOrder } from '@/lib/types';

export default function Page() {
  const s = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SalesOrder[]>([]);
  const [lines, setLines] = useState<Map<string, DocLine[]>>(new Map());
  const [os, setOs] = useState<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    const { data } = await supabase.from('sales_order').select('*').eq('status', 'SUBMITTED').order('order_date');
    const o = (data as SalesOrder[]) || [];
    setRows(o);
    if (o.length) {
      const { data: ld } = await supabase.from('sales_order_line').select('*').in('order_no', o.map((x) => x.no));
      const m = new Map<string, DocLine[]>();
      ((ld as (DocLine & { order_no: string })[]) || []).forEach((l) => {
        m.set(l.order_no, [...(m.get(l.order_no) || []), l]);
      });
      setLines(m);
    }
    const { data: iv } = await supabase.from('invoice_view').select('customer_code,outstanding').gt('outstanding', 0);
    const mo = new Map<string, number>();
    ((iv as { customer_code: string; outstanding: number }[]) || []).forEach((r) =>
      mo.set(r.customer_code, (mo.get(r.customer_code) || 0) + Number(r.outstanding)));
    setOs(mo);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function act(no: string, ok: boolean) {
    const { error } = await supabase.rpc('approve_sales_order', { p_no: no, p_ok: ok, p_reason: null });
    if (error) { s.toast(errMsg(error), 'err'); return; }
    s.toast(`Order ${no} ${ok ? 'disetujui' : 'ditolak'}.`, ok ? 'ok' : 'warn');
    await load();
  }

  const lim = Number(s.settings?.approval_order_limit || 0);
  const dlim = Number(s.settings?.approval_disc_limit || 0);

  return (
    <>
      <PageHead title="Order Approval"
        desc={`Order yang menunggu persetujuan. Aturan: order di atas ${rp(lim)} atau diskon di atas ${dlim}% wajib disetujui Sales Manager; pelanggaran credit limit dan harga di bawah harga pokok ditandai otomatis.`} />
      <Card><CardBody flush>
        <DataTable<SalesOrder> rows={rows} rowKey={(r) => r.no}
          emptyT="Tidak ada order menunggu approval" emptyD="Semua order sudah diproses."
          cols={[
            { t: 'No. SO', f: (o) => <span className="doc-no">{o.no}</span> },
            { t: 'Tanggal', f: (o) => dFmt(o.order_date) },
            { t: 'Customer', f: (o) => s.cust(o.customer_code).name },
            { t: 'Nilai', cls: 'num', f: (o) => rp(o.total) },
            { t: 'Diskon Maks', cls: 'num', f: (o) => {
              const d = Math.max(0, ...(lines.get(o.no) || []).map((l) => Number(l.disc_pct) || 0));
              return d > dlim ? <b style={{ color: 'var(--red)' }}>{num(d, 1)}%</b> : num(d, 1) + '%';
            } },
            { t: 'Credit Limit', f: (o) => {
              const c = s.cust(o.customer_code);
              const over = Number(c.credit_limit) > 0 && (os.get(c.code) || 0) + Number(o.total) > Number(c.credit_limit);
              return over ? <span className="bdg2 b-red">Melebihi limit</span> : <span className="bdg2 b-green">Aman</span>;
            } },
            { t: 'Butuh Approval', f: (o) => {
              const d = Math.max(0, ...(lines.get(o.no) || []).map((l) => Number(l.disc_pct) || 0));
              const r: string[] = [];
              if (Number(o.total) > lim) r.push('Nilai order');
              if (d > dlim) r.push('Diskon');
              const tag = o.below_cost?.length
                ? <span className="bdg2 b-red" title={`${o.below_cost.length} baris di bawah harga pokok`}>Di bawah harga pokok</span>
                : null;
              return <>{tag}{tag && r.length ? ' ' : ''}{r.length ? <span className="sm">{r.join(', ')}</span>
                : (tag ? null : <span className="sm mut">Standar</span>)}</>;
            } },
            { t: '', cls: 'ctr', f: (o) => s.can('approve') ? <>
              <button className="btn sm pri" onClick={() => act(o.no, true)}>Approve</button>{' '}
              <button className="btn sm danger" onClick={() => act(o.no, false)}>Tolak</button>
            </> : null },
          ]} />
      </CardBody></Card>
    </>
  );
}
