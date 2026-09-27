'use client';
/* Audit Log — jejak perubahan dokumen beserta nilai sebelum dan sesudah.
   Baris ditulis oleh fungsi database (write_audit), bukan oleh klien,
   sehingga jejak tetap utuh walau perubahan dilakukan dari luar aplikasi. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardBody, DataTable, PageHead } from '@/components/ui';
import { tsFmt } from '@/lib/format';
import type { AuditRow } from '@/lib/types';

const LIMIT = 600;

export default function Page() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [act, setAct] = useState('ALL');

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      supabase.from('audit_log').select('*').order('ts', { ascending: false })
        .order('id', { ascending: false }).limit(LIMIT),
      supabase.from('audit_log').select('id', { count: 'exact', head: true }),
    ]);
    setRows((r.data as AuditRow[]) || []);
    setTotal(c.count || 0);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const acts = [...new Set(rows.map((a) => a.action))].sort();
  const filtered = rows.filter((a) => {
    if (act !== 'ALL' && a.action !== act) return false;
    const t = q.toLowerCase();
    if (!t) return true;
    return (a.doc || '').toLowerCase().includes(t) || (a.username || '').toLowerCase().includes(t)
      || a.action.toLowerCase().includes(t) || String(a.after_val || '').toLowerCase().includes(t);
  });

  function exportCsv() {
    const head = ['Waktu', 'User', 'Aksi', 'Dokumen', 'Field', 'Sebelum', 'Sesudah'];
    const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = [head.join(','), ...filtered.map((a) => [
      a.ts, a.username, a.action, a.doc, a.field, a.before_val, a.after_val,
    ].map(esc).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'audit-log.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <PageHead title="Audit Log"
        desc="Seluruh perubahan dokumen tercatat lengkap dengan nilai sebelum dan sesudah — termasuk edit invoice, retur, perubahan harga produk, dan approval."
        actions={<button className="btn" onClick={exportCsv}>⇩ Export CSV</button>} />
      <div className="fbar">
        <input className="grow" placeholder="Cari dokumen, user, atau aksi…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={act} onChange={(e) => setAct(e.target.value)}>
          <option value="ALL">Semua Aksi</option>
          {acts.map((a) => <option key={a}>{a}</option>)}
        </select>
        <span className="sm mut">{filtered.length} dari {total} entri</span>
      </div>
      <Card><CardBody flush>
        <DataTable<AuditRow> rows={filtered} rowKey={(a) => String(a.id)}
          emptyT="Tidak ada entri audit" emptyD="Jejak perubahan akan tampil di sini."
          cols={[
            { t: 'Waktu', f: (a) => <span className="sm mono">{tsFmt(a.ts)}</span> },
            { t: 'User', f: (a) => <>{a.user_name || a.username}
              <div className="sm mut">{a.username}</div></> },
            { t: 'Aksi', f: (a) => <span className="bdg2 b-brand">{a.action}</span> },
            { t: 'Dokumen', f: (a) => <span className="mono sm">{a.doc}</span> },
            { t: 'Field', f: (a) => <span className="sm">{a.field}</span> },
            { t: 'Sebelum', f: (a) => <span className="sm mut">{String(a.before_val ?? '').slice(0, 60)}</span> },
            { t: 'Sesudah', f: (a) => <span className="sm">{String(a.after_val ?? '').slice(0, 60)}</span> },
          ]} />
      </CardBody></Card>
      {total > LIMIT ? (
        <div className="info-box mt14">Menampilkan {LIMIT} entri terbaru dari {total}. Pencarian di atas
          bekerja pada entri yang dimuat; untuk penelusuran seluruh riwayat, gunakan kueri langsung ke tabel
          <b> audit_log</b>.</div>
      ) : null}
    </>
  );
}
