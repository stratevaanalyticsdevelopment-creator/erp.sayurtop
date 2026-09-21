/* =====================================================================
   HANYA UNTUK PENGUJIAN LOKAL — bukan bagian aplikasi.
   Emulator ringkas PostgREST + Auth Supabase di atas snapshot JSON.
   Dipakai agar seluruh halaman dapat diverifikasi secara visual tanpa
   akses jaringan ke Supabase; aplikasi tetap memakai @supabase/supabase-js
   apa adanya, hanya URL-nya yang diarahkan ke server ini.
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock-data.json'), 'utf8'));
const PORT = +(process.argv[2] || 54321);

const TOKEN = 'mock-access-token';
let CURRENT = DATA.app_user.find((u) => u.username === 'admin');

function cmp(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function applyFilter(rows, key, raw) {
  const m = /^(eq|neq|gt|gte|lt|lte|like|ilike|in|is|not)\.(.*)$/s.exec(raw);
  if (!m) return rows;
  let [, op, val] = m;
  if (op === 'not') {
    const inner = /^(eq|neq|is)\.(.*)$/s.exec(val);
    if (!inner) return rows;
    const [, iop, ival] = inner;
    return rows.filter((r) => !matchOne(r[key], iop, ival));
  }
  return rows.filter((r) => matchOne(r[key], op, val));
}
function matchOne(cell, op, val) {
  if (op === 'is') return val === 'null' ? cell === null || cell === undefined : String(cell) === val;
  if (op === 'in') {
    const list = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
    return list.includes(String(cell));
  }
  if (op === 'like' || op === 'ilike') {
    const rx = new RegExp('^' + val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$',
      op === 'ilike' ? 'i' : '');
    return rx.test(String(cell ?? ''));
  }
  const n = Number(val);
  const c = typeof cell === 'number' && !Number.isNaN(n) ? cell : String(cell ?? '');
  const v = typeof cell === 'number' && !Number.isNaN(n) ? n : val;
  switch (op) {
    case 'eq': return String(cell) === String(val);
    case 'neq': return String(cell) !== String(val);
    case 'gt': return cmp(c, v) > 0;
    case 'gte': return cmp(c, v) >= 0;
    case 'lt': return cmp(c, v) < 0;
    case 'lte': return cmp(c, v) <= 0;
    default: return true;
  }
}

/* Relasi yang dipakai aplikasi: <tabel induk>.<nama embed> → tabel & kolom kunci. */
const EMBEDS = {
  journal_line: { journal: { table: 'journal', fk: 'journal_no', pk: 'no' } },
};

/** Memecah daftar select menjadi kolom biasa dan spesifikasi embed. */
function parseSelect(sel) {
  const plain = [];
  const embeds = [];
  let depth = 0, buf = '';
  const flush = () => {
    const s = buf.trim(); buf = '';
    if (!s) return;
    const m = /^([A-Za-z0-9_]+)(!inner|!left)?\(([^)]*)\)$/.exec(s);
    if (m) embeds.push({ name: m[1], inner: m[2] === '!inner', cols: m[3].split(',').map((x) => x.trim()) });
    else plain.push(s);
  };
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { flush(); continue; }
    buf += ch;
  }
  flush();
  return { plain, embeds };
}

/** Mengembalikan baris induk yang dilengkapi objek embed (null bila tak ada pasangan). */
function attachEmbeds(table, rows, embeds) {
  if (!embeds.length) return rows.map((r) => ({ ...r }));
  const rel = EMBEDS[table] || {};
  return rows.map((r) => {
    const o = { ...r };
    embeds.forEach((e) => {
      const def = rel[e.name];
      if (!def) { o[e.name] = null; return; }
      const child = (DATA[def.table] || []).find((c) => c[def.pk] === r[def.fk]);
      if (!child) { o[e.name] = null; return; }
      const picked = {};
      (e.cols.includes('*') ? Object.keys(child) : e.cols).forEach((c) => { picked[c] = child[c]; });
      o[e.name] = picked;
    });
    return o;
  });
}

function selectCols(rows, sel) {
  if (!sel || sel === '*') return rows;
  const { plain, embeds } = parseSelect(sel);
  if (!plain.length && !embeds.length) return rows;
  return rows.map((r) => {
    const o = {};
    plain.forEach((c) => { o[c] = r[c]; });
    embeds.forEach((e) => { o[e.name] = r[e.name] ?? null; });
    return o;
  });
}

function rpc(name, body) {
  if (name === 'my_profile') {
    const role = DATA.app_role.find((r) => r.code === CURRENT.role_code);
    return [{
      id: CURRENT.id, username: CURRENT.username, name: CURRENT.name, email: CURRENT.email,
      role_code: CURRENT.role_code, role_name: role.name, menus: role.menus, acts: role.acts,
      salesperson_code: CURRENT.salesperson_code,
    }];
  }
  if (name === 'today_jkt') {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // Fungsi transaksi tidak disimulasikan; pengujian menulis data dilakukan
  // langsung terhadap Supabase, bukan lewat emulator ini.
  return { mock: true, name, body };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, obj) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
        'access-control-expose-headers': 'content-range',
        'content-range': '0-0/*',
      });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') return send(200, {});

    const p = url.pathname;

    /* ---------- AUTH ---------- */
    if (p.startsWith('/auth/v1/token')) {
      const b = body ? JSON.parse(body) : {};
      const u = DATA.app_user.find((x) => x.email === String(b.email || '').toLowerCase());
      if (!u) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      CURRENT = u;
      return send(200, {
        access_token: TOKEN, token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'mock-refresh',
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
          app_metadata: {}, user_metadata: {}, created_at: u.created_at },
      });
    }
    if (p.startsWith('/auth/v1/user')) {
      return send(200, { id: CURRENT.id, aud: 'authenticated', role: 'authenticated',
        email: CURRENT.email, app_metadata: {}, user_metadata: {}, created_at: CURRENT.created_at });
    }
    if (p.startsWith('/auth/v1/logout')) return send(204, {});

    /* ---------- RPC ---------- */
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.split('/').pop();
      return send(200, rpc(name, body ? JSON.parse(body) : {}));
    }

    /* ---------- TABEL ---------- */
    if (p.startsWith('/rest/v1/')) {
      const table = p.replace('/rest/v1/', '');
      let rows = (DATA[table] || []).slice();
      if (!DATA[table]) return send(404, { message: `relation "${table}" tidak ada di snapshot` });

      const sel = url.searchParams.get('select');
      const spec = sel ? parseSelect(sel) : { plain: [], embeds: [] };
      rows = attachEmbeds(table, rows, spec.embeds);

      for (const [k, v] of url.searchParams.entries()) {
        if (['select', 'order', 'limit', 'offset', 'or'].includes(k)) continue;
        if (k.includes('.')) {
          /* Filter pada sumber daya tersemat, mis. journal.journal_date=gte.2026-01-01 */
          const [emb, col] = k.split('.');
          const e = spec.embeds.find((x) => x.name === emb);
          if (!e) continue;
          rows = rows.filter((r) => r[emb] && applyFilter([r[emb]], col, v).length > 0);
          continue;
        }
        rows = applyFilter(rows, k, v);
      }
      /* !inner membuang baris induk yang tidak punya pasangan. */
      spec.embeds.filter((e) => e.inner).forEach((e) => { rows = rows.filter((r) => r[e.name]); });
      const ord = url.searchParams.get('order');
      if (ord) {
        ord.split(',').reverse().forEach((o) => {
          const [col, dir] = o.split('.');
          rows.sort((a, b) => (dir === 'desc' ? -cmp(a[col], b[col]) : cmp(a[col], b[col])));
        });
      }
      const count = rows.length;
      const off = +(url.searchParams.get('offset') || 0);
      const lim = url.searchParams.get('limit');
      if (off) rows = rows.slice(off);
      if (lim) rows = rows.slice(0, +lim);

      const prefer = String(req.headers.prefer || '');
      const isHead = req.method === 'HEAD' || prefer.includes('count=exact') && req.method === 'GET' && sel === null;
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'content-range',
        'content-range': `0-${Math.max(rows.length - 1, 0)}/${count}`,
      });
      if (req.method === 'HEAD') return res.end();
      const accept = String(req.headers.accept || '');
      const out = selectCols(rows, sel);
      if (accept.includes('vnd.pgrst.object')) return res.end(JSON.stringify(out[0] ?? null));
      return res.end(JSON.stringify(out));
    }

    send(404, { message: 'not found' });
  });
});

server.listen(PORT, () => console.log('mock supabase di http://localhost:' + PORT));
