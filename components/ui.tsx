'use client';
/* =====================================================================
   KOMPONEN UI — menghasilkan markup dan class yang identik dengan
   versi HTML single-file, sehingga tampilannya sama persis.
   ===================================================================== */
import React, { useEffect, useRef } from 'react';
import { ST_CLASS } from '@/lib/menu';

/* ---------- PAGE HEAD ---------- */
export function PageHead({ title, desc, actions }: {
  title: string; desc?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

/* ---------- CARD ---------- */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={'card' + (className ? ' ' + className : '')}>{children}</div>;
}
export function CardHead({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="card-h">
      <h3>{title}</h3>
      {right ? <div className="r">{right}</div> : null}
    </div>
  );
}
export function CardBody({ children, flush }: { children: React.ReactNode; flush?: boolean }) {
  return <div className={'card-b' + (flush ? ' flush' : '')}>{children}</div>;
}

/* ---------- BADGE ---------- */
export function Badge({ st }: { st: string }) {
  return <span className={'bdg2 ' + (ST_CLASS[st] || 'b-grey')}>{st}</span>;
}

/* ---------- KPI ---------- */
export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="kpi-grid">{children}</div>;
}
export function Kpi({ lb, vl, sb, cls }: {
  lb: string; vl: React.ReactNode; sb?: React.ReactNode; cls?: string;
}) {
  return (
    <div className={'kpi ' + (cls || '')}>
      <div className="lb">{lb}</div>
      <div className="vl">{vl}</div>
      <div className="sb">{sb}</div>
    </div>
  );
}

/* ---------- EMPTY ---------- */
export function EmptyBox({ t, d }: { t: string; d?: string }) {
  return (
    <div className="empty">
      <div className="ic">◍</div>
      <div className="t">{t}</div>
      <div className="d">{d || ''}</div>
    </div>
  );
}

/* ---------- TABLE ---------- */
export type Col<T> = {
  t: string;
  cls?: 'num' | 'ctr';
  w?: string;
  f: (row: T, i: number) => React.ReactNode;
};
export function DataTable<T>({ cols, rows, onRow, foot, emptyT, emptyD, rowKey }: {
  cols: Col<T>[]; rows: T[]; onRow?: (row: T) => void; foot?: React.ReactNode;
  emptyT?: string; emptyD?: string; rowKey?: (row: T, i: number) => string;
}) {
  if (!rows.length) {
    return <EmptyBox t={emptyT || 'Belum ada data'}
      d={emptyD || 'Data akan tampil di sini setelah dokumen dibuat.'} />;
  }
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>{cols.map((c, i) => (
            <th key={i} className={c.cls} style={c.w ? { width: c.w } : undefined}>{c.t}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i} className={onRow ? 'clk' : undefined}
                onClick={onRow ? (e) => {
                  if ((e.target as HTMLElement).closest('button,a,input,select')) return;
                  onRow(r);
                } : undefined}>
              {cols.map((c, j) => <td key={j} className={c.cls}>{c.f(r, i)}</td>)}
            </tr>
          ))}
        </tbody>
        {foot ? <tfoot>{foot}</tfoot> : null}
      </table>
    </div>
  );
}

/* ---------- MODAL ---------- */
export function Modal({ open, onClose, size, children }: {
  open: boolean; onClose: () => void; size?: 'wide' | 'mid' | 'narrow'; children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ov show" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (size ? ' ' + size : '')}>{children}</div>
    </div>
  );
}
export function ModalHead({ title, sub, onClose, extra }: {
  title: React.ReactNode; sub?: React.ReactNode; onClose: () => void; extra?: React.ReactNode;
}) {
  return (
    <div className="m-h">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {extra}
      <button className="x" onClick={onClose}>✕</button>
    </div>
  );
}
export function ModalBody({ children }: { children: React.ReactNode }) {
  return <div className="m-b">{children}</div>;
}
export function ModalFoot({ children, left }: { children: React.ReactNode; left?: React.ReactNode }) {
  return (
    <div className="m-f">
      {left ? <div className="left">{left}</div> : null}
      {children}
    </div>
  );
}

/* ---------- FORM ---------- */
export function SecT({ children }: { children: React.ReactNode }) {
  return <div className="sec-t">{children}</div>;
}
export function Fg({ children, c }: { children: React.ReactNode; c?: 2 | 3 | 4 }) {
  return <div className={'fg' + (c ? ' c' + c : '')}>{children}</div>;
}
export function F({ label, children, help, full }: {
  label: string; children: React.ReactNode; help?: React.ReactNode; full?: boolean;
}) {
  return (
    <div className={'f' + (full ? ' full' : '')}>
      <label>{label}</label>
      {children}
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}

/* ---------- TOTAL BOX ---------- */
export function TotRow({ label, value, cls }: { label: React.ReactNode; value: React.ReactNode; cls?: string }) {
  return (
    <div className={'tot-row' + (cls ? ' ' + cls : '')}>
      <span>{label}</span><span className="v">{value}</span>
    </div>
  );
}

/* ---------- PROGRESS ---------- */
export function Prog({ pct }: { pct: number }) {
  const cls = pct >= 100 ? 'full' : pct > 0 ? 'part' : '';
  return (
    <>
      <div className="prog"><i className={cls} style={{ width: Math.min(pct, 100) + '%' }} /></div>
      <div className="sm mut" style={{ marginTop: 3 }}>{pct}%</div>
    </>
  );
}

/* ---------- TIMELINE ---------- */
export function Timeline({ items }: { items: { t: React.ReactNode; d: React.ReactNode }[] }) {
  return (
    <div className="tl">
      {items.map((x, i) => (
        <div key={i} className={'tl-i ' + (i === items.length - 1 ? 'cur' : 'done')}>
          <div className="t">{x.t}</div>
          <div className="d">{x.d}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- KV ---------- */
export function Kv({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <span className="k">{k}</span><span className="v">{v}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---------- SEGMENTED ---------- */
export function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; t: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : undefined} onClick={() => onChange(o.v)}>{o.t}</button>
      ))}
    </div>
  );
}

/* ---------- TABS ---------- */
export function Tabs<T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; t: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : undefined} onClick={() => onChange(o.v)}>{o.t}</button>
      ))}
    </div>
  );
}

/* ---------- CONFIRM ---------- */
export function ConfirmBox({ open, title, body, yesLabel, danger, onYes, onClose }: {
  open: boolean; title: string; body: React.ReactNode; yesLabel?: string;
  danger?: boolean; onYes: () => void; onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="narrow">
      <ModalHead title={title} onClose={onClose} />
      <ModalBody><div style={{ fontSize: 13, lineHeight: 1.65 }}>{body}</div></ModalBody>
      <ModalFoot>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={'btn ' + (danger ? 'danger' : 'pri')} onClick={onYes}>{yesLabel || 'Ya, Lanjutkan'}</button>
      </ModalFoot>
    </Modal>
  );
}

/* ---------- AUTO FOCUS ---------- */
export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

/* ---------- PRINT ---------- */
export function PrintDoc({ children }: { children: React.ReactNode }) {
  return <div className="print-doc">{children}</div>;
}
