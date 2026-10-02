'use client';
/* =====================================================================
   EDITOR BARIS DOKUMEN
   Perilaku sama dengan versi HTML:
   - harga, satuan, dan PPN terisi otomatis dari master saat produk dipilih
   - harga yang diubah manual tidak tertimpa saat qty/diskon berubah
   - baris yang tidak cocok master ditandai merah, tidak dihapus diam-diam
   - peringatan seketika bila harga setelah diskon di bawah harga pokok
   Di React seluruhnya digerakkan state, sehingga masalah pembacaan DOM
   basi pada versi HTML tidak mungkin terjadi.
   ===================================================================== */
import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { docBelowCost, docMargin, lineNet, lineTax } from '@/lib/calc';
import { num, rp } from '@/lib/format';
import type { DocLine, Product } from '@/lib/types';

export type EditLine = DocLine & { priceAuto?: boolean; raw?: string };

export function newLine(defTax: number): EditLine {
  return { product_id: '', name: '', unit: '', qty: 1, price: 0, disc_pct: 0, tax_pct: defTax, priceAuto: true };
}

function parseProdKey(v: string, products: Product[]): Product | null {
  const t = (v || '').trim();
  if (!t) return null;
  const id = t.split(' — ')[0].trim();
  const byId = products.find((p) => p.id === id);
  if (byId) return byId;
  const lv = t.toLowerCase();
  return products.find((p) => p.name.toLowerCase() === lv) ||
    products.find((p) => p.id.toLowerCase() === lv) || null;
}

export function LineEditor({ lines, setLines, defTax }: {
  lines: EditLine[]; setLines: (l: EditLine[]) => void; defTax: number;
}) {
  const s = useStore();
  const active = useMemo(() => s.products.filter((p) => p.active), [s.products]);

  function patch(i: number, p: Partial<EditLine>) {
    const out = lines.slice();
    out[i] = { ...out[i], ...p };
    setLines(out);
  }
  function pickProduct(i: number, raw: string) {
    const p = parseProdKey(raw, active);
    if (p) {
      // Produk berganti → seluruh nilai turunan ditarik ulang dari master.
      if (p.id !== lines[i].product_id) {
        patch(i, { product_id: p.id, name: p.name, unit: p.unit, price: p.sell_price,
          priceAuto: true, tax_pct: defTax, raw: undefined });
      } else {
        patch(i, { raw: undefined });
      }
    } else {
      patch(i, { product_id: '', name: raw, unit: '', raw });
    }
  }

  const below = docBelowCost(lines, s.productMap);
  const m = docMargin(lines, s.productMap);

  return (
    <>
      <table className="lines">
        <thead>
          <tr>
            <th>Produk</th><th>Satuan</th><th className="num">Qty</th><th className="num">Harga</th>
            <th className="num">Disc %</th><th className="num">PPN %</th><th className="num">Jumlah</th><th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const unres = !l.product_id && (l.raw || l.name || '').trim();
            const bc = below.find((b) => b.i === i)?.w;
            return (
              <tr key={i}>
                <td style={{ minWidth: 230 }}>
                  <input list="prodDL" placeholder="Ketik SKU atau nama produk"
                    title={unres ? 'Produk tidak ada di master produk' : undefined}
                    style={unres ? { borderColor: 'var(--red)', background: 'var(--red-bg)' } : undefined}
                    value={l.raw !== undefined ? l.raw : (l.product_id ? `${l.product_id} — ${l.name}` : (l.name || ''))}
                    onChange={(e) => patch(i, { raw: e.target.value })}
                    onBlur={(e) => pickProduct(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                </td>
                <td style={{ width: 78 }}>
                  <input value={l.unit || ''} readOnly tabIndex={-1} title="Satuan mengikuti master produk"
                    style={{ background: 'var(--grey-bg)', color: 'var(--ink-3)' }} />
                </td>
                <td style={{ width: 92 }}>
                  <input className="num" type="number" min={0} step={0.5} value={l.qty}
                    onChange={(e) => patch(i, { qty: Number(e.target.value) || 0 })} />
                </td>
                <td style={{ width: 120 }}>
                  <input className="num" type="number" min={0} step={100} value={l.price}
                    title={bc ? `Harga jual setelah diskon ${rp(bc.net)} lebih rendah dari harga pokok ${rp(bc.base)}` : undefined}
                    style={bc ? { borderColor: 'var(--red)', background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 700 } : undefined}
                    onChange={(e) => patch(i, { price: Number(e.target.value) || 0, priceAuto: false })} />
                </td>
                <td style={{ width: 78 }}>
                  <input className="num" type="number" min={0} max={100} step={0.5} value={l.disc_pct}
                    onChange={(e) => patch(i, { disc_pct: Number(e.target.value) || 0 })} />
                </td>
                <td style={{ width: 74 }}>
                  <input className="num" type="number" min={0} max={100} step={1} value={l.tax_pct}
                    onChange={(e) => patch(i, { tax_pct: Number(e.target.value) || 0 })} />
                </td>
                <td className="num" style={{ width: 120 }}>{rp(lineNet(l) + lineTax(l))}</td>
                <td style={{ width: 38 }}>
                  <button className="del" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt8">
        <button className="btn sm" onClick={() => setLines([...lines, newLine(defTax)])}>+ Tambah Baris</button>
        <span className="sm mut" style={{ marginLeft: 10 }}>
          Harga otomatis terisi dari master produk dan tetap dapat disesuaikan.
        </span>
      </div>

      <datalist id="prodDL">
        {active.map((p) => <option key={p.id} value={`${p.id} — ${p.name}`} />)}
      </datalist>

      {below.length ? (
        <div className="err-box mt8">
          <b>⚠ Harga jual di bawah harga pokok pada {below.length} baris.</b>
          <div style={{ marginTop: 6 }}>
            {below.map((b, i) => (
              <div key={i}>
                • {b.l.name} — harga setelah diskon {rp(b.w.net)} / {b.l.unit || 'unit'} vs harga pokok {rp(b.w.base)}{' '}
                <b>(rugi {rp(b.w.gap)} per {b.l.unit || 'unit'}, {num(b.w.pct, 1)}%)</b>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 7 }}>
            Estimasi margin dokumen: <b>{rp(m.margin)}</b> ({num(m.pct, 1)}%). Dokumen masih dapat disimpan,
            namun ditandai dan wajib disetujui Sales Manager.
          </div>
        </div>
      ) : m.rev ? (
        <div className="info-box mt8">
          Estimasi margin kotor dokumen: <b>{rp(m.margin)}</b> ({num(m.pct, 1)}%) — dihitung dari harga pokok pada master produk.
        </div>
      ) : null}
    </>
  );
}

export function unresolvedLines(lines: EditLine[]): string[] {
  return lines.filter((l) => !l.product_id && (l.raw || l.name || '').trim())
    .map((l) => (l.raw || l.name) as string);
}

export function Totals({ t, extra }: { t: { gross: number; disc: number; sub: number; tax: number; total: number };
  extra?: React.ReactNode }) {
  return (
    <div className="tot-box mt14">
      <div className="tot-row"><span>Subtotal Bruto</span><span className="v">{rp(t.gross)}</span></div>
      <div className="tot-row neg"><span>Diskon</span><span className="v">−{rp(t.disc)}</span></div>
      <div className="tot-row"><span>Dasar Pengenaan Pajak</span><span className="v">{rp(t.sub)}</span></div>
      <div className="tot-row"><span>PPN</span><span className="v">{rp(t.tax)}</span></div>
      {extra}
      <div className="tot-row grand"><span>Grand Total</span><span className="v">{rp(t.total)}</span></div>
    </div>
  );
}
