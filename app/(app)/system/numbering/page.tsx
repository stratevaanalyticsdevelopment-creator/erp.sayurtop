'use client';
/* Document Numbering — format penomoran dan nomor berjalan terakhir.
   Nomor dialokasikan oleh fungsi next_doc_no() di database, sehingga tidak
   ada dua dokumen yang bisa memperoleh nomor sama meski dibuat bersamaan. */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardBody, DataTable, PageHead } from '@/components/ui';
import { num, pad } from '@/lib/format';

const FORMATS = [
  { doc: 'Quotation', prefix: 'QUO' },
  { doc: 'Sales Order', prefix: 'SO' },
  { doc: 'Surat Jalan', prefix: 'SJ' },
  { doc: 'Invoice', prefix: 'INV' },
  { doc: 'Credit Note', prefix: 'CN' },
  { doc: 'Sales Return', prefix: 'RET' },
  { doc: 'Payment', prefix: 'PAY' },
  { doc: 'Collection', prefix: 'COL' },
  { doc: 'Journal', prefix: 'JV' },
].map((x) => ({ ...x, format: `${x.prefix}-{YYYY}-{000000}` }));

type Row = typeof FORMATS[number];

export default function Page() {
  const supabase = useMemo(() => createClient(), []);
  const year = new Date().getFullYear();
  const [seq, setSeq] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('doc_counter').select('prefix,year,seq').eq('year', year);
      setSeq(new Map(((data as { prefix: string; seq: number }[]) || []).map((r) => [r.prefix, r.seq])));
    })();
  }, [supabase, year]);

  const last = (p: string) => seq.get(p) || 0;

  return (
    <>
      <PageHead title="Document Numbering"
        desc="Format penomoran dokumen. Nomor berjalan direset otomatis setiap pergantian tahun." />
      <Card><CardBody flush>
        <DataTable<Row> rows={FORMATS} rowKey={(r) => r.prefix} cols={[
          { t: 'Dokumen', f: (n) => <b>{n.doc}</b> },
          { t: 'Prefix', f: (n) => <span className="doc-no">{n.prefix}</span> },
          { t: 'Format', f: (n) => <span className="mono sm">{n.format}</span> },
          { t: 'Nomor Terakhir', cls: 'num', f: (n) => num(last(n.prefix), 0) },
          { t: 'Contoh Berikutnya', f: (n) => (
            <span className="mono sm">{`${n.prefix}-${year}-${pad(last(n.prefix) + 1, 6)}`}</span>) },
        ]} />
      </CardBody></Card>
      <div className="info-box mt14">Nomor dialokasikan oleh fungsi <b>next_doc_no()</b> di database dengan
        penguncian baris, sehingga dua dokumen yang dibuat bersamaan tidak mungkin memperoleh nomor yang sama.</div>
    </>
  );
}
