'use client';
/* Hook pengambil baris buku besar dari Supabase dengan rentang tanggal. */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from './supabase/client';
import type { GlRow } from './gl';

type Raw = {
  account_code: string; description: string | null; debit: number; credit: number; line_no: number;
  journal: { no: string; journal_date: string; ref: string | null; ref_type: string; memo: string | null } | null;
};

export function useGl(from: string | null, to: string | null, acc?: string) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<GlRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      let q = supabase.from('journal_line')
        .select('account_code,description,debit,credit,line_no,journal!inner(no,journal_date,ref,ref_type,memo)');
      if (acc) q = q.eq('account_code', acc);
      if (from) q = q.gte('journal.journal_date', from);
      if (to) q = q.lte('journal.journal_date', to);
      const { data } = await q;
      if (!alive) return;
      const out: GlRow[] = ((data as unknown as Raw[]) || []).map((l) => ({
        date: l.journal?.journal_date || '', jno: l.journal?.no || '',
        ref: l.journal?.ref || null, refType: l.journal?.ref_type || '',
        memo: l.journal?.memo || null, acc: l.account_code, desc: l.description,
        d: Number(l.debit), c: Number(l.credit),
      }));
      out.sort((a, b) => (a.date === b.date ? a.jno.localeCompare(b.jno) : a.date.localeCompare(b.date)));
      setRows(out);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [supabase, from, to, acc]);

  return { rows, loading };
}
