'use client';
/* Grafik SVG inline — port dari versi HTML (tanpa pustaka eksternal). */
import { rp, rpShort } from '@/lib/format';

export type Pt = { l: string; v: number; c?: string };

export function BarChart({ data, h = 210, w = 760 }: { data: Pt[]; h?: number; w?: number }) {
  const pl = 52, pb = 26, pt = 12, pr = 10;
  const max = Math.max(...data.map((d) => d.v), 1);
  const step = (w - pl - pr) / Math.max(data.length, 1);
  const bw = Math.min(step * 0.6, 46);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = pt + ((h - pt - pb) * i) / 4;
        return (
          <g key={i}>
            <line x1={pl} y1={y} x2={w - pr} y2={y} stroke="#EFF3F8" strokeWidth={1} />
            <text x={pl - 7} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="#8A98AC">
              {rpShort(max * (1 - i / 4)).replace('Rp ', '')}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const hgt = (h - pt - pb) * (d.v / max);
        const x = pl + step * i + (step - bw) / 2;
        const y = h - pb - hgt;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(hgt, 1)} rx={3} fill={d.c || '#0046B0'}>
              <title>{d.l}: {rp(d.v)}</title>
            </rect>
            <text x={x + bw / 2} y={h - pb + 13} textAnchor="middle" fontSize={10} fill="#5A6B83">{d.l}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({ data, h = 220, w = 760 }: { data: Pt[]; h?: number; w?: number }) {
  const pl = 56, pb = 26, pt = 14, pr = 12;
  const max = Math.max(...data.map((d) => d.v), 1);
  const n = Math.max(data.length - 1, 1);
  const px = (i: number) => pl + ((w - pl - pr) * i) / n;
  const py = (v: number) => pt + (h - pt - pb) * (1 - v / max);
  const d1 = data.map((d, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(d.v).toFixed(1)).join(' ');
  const area = d1 + ` L${px(data.length - 1).toFixed(1)},${h - pb} L${px(0).toFixed(1)},${h - pb} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = pt + ((h - pt - pb) * i) / 4;
        return (
          <g key={i}>
            <line x1={pl} y1={y} x2={w - pr} y2={y} stroke="#EFF3F8" />
            <text x={pl - 7} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="#8A98AC">
              {rpShort(max * (1 - i / 4)).replace('Rp ', '')}
            </text>
          </g>
        );
      })}
      <path d={area} fill="rgba(0,70,176,.09)" />
      <path d={d1} fill="none" stroke="#0046B0" strokeWidth={2.2} strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(d.v)} r={3.4} fill="#fff" stroke="#FF5E00" strokeWidth={2}>
            <title>{d.l}: {rp(d.v)}</title>
          </circle>
          {(data.length <= 14 || i % 2 === 0) && (
            <text x={px(i)} y={h - pb + 13} textAnchor="middle" fontSize={9.5} fill="#5A6B83">{d.l}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
