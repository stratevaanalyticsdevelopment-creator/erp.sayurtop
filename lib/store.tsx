'use client';
/* =====================================================================
   APP STORE — memuat profil pengguna dan seluruh master data sekali,
   lalu menyediakannya ke semua halaman (sepadan dengan objek DB pada
   versi HTML). Termasuk kontrol hak akses dan notifikasi toast.
   ===================================================================== */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from './supabase/client';
import type {
  Profile, Product, Customer, Salesperson, Warehouse, Driver, Vehicle,
  PaymentTerm, Tax, BankAccount, Coa, Settings,
} from './types';

type Role = { code: string; name: string; description: string | null; menus: string[] | '*'; acts: string[] | '*' };
type Toast = { id: number; msg: string; kind?: 'ok' | 'err' | 'warn' };

type Store = {
  ready: boolean;
  error: string | null;
  profile: Profile | null;
  products: Product[];
  productMap: Map<string, Product>;
  customers: Customer[];
  salespersons: Salesperson[];
  warehouses: Warehouse[];
  drivers: Driver[];
  vehicles: Vehicle[];
  terms: PaymentTerm[];
  taxes: Tax[];
  banks: BankAccount[];
  coa: Coa[];
  roles: Role[];
  settings: Settings | null;
  cust: (code: string | null | undefined) => Customer;
  prod: (id: string | null | undefined) => Product | undefined;
  wh: (code: string | null | undefined) => Warehouse;
  sp: (code: string | null | undefined) => Salesperson;
  termOf: (code: string | null | undefined) => PaymentTerm;
  accName: (code: string) => string;
  can: (act: string) => boolean;
  canMenu: (k: string) => boolean;
  toast: (msg: string, kind?: 'ok' | 'err' | 'warn') => void;
  reloadMaster: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);
export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore harus dipakai di dalam <AppProvider>');
  return s;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [terms, setTerms] = useState<PaymentTerm[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [coa, setCoa] = useState<Coa[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tid = useRef(1);

  const toast = useCallback((msg: string, kind?: 'ok' | 'err' | 'warn') => {
    const id = tid.current++;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const loadMaster = useCallback(async () => {
    const [p, c, s, w, d, v, t, tx, b, a, r, st] = await Promise.all([
      supabase.from('product').select('*').order('id'),
      supabase.from('customer').select('*').order('code'),
      supabase.from('salesperson').select('*').order('code'),
      supabase.from('warehouse').select('*').order('code'),
      supabase.from('driver').select('*').order('code'),
      supabase.from('vehicle').select('*').order('code'),
      supabase.from('payment_term').select('*').order('days'),
      supabase.from('tax').select('*').order('code'),
      supabase.from('bank_account').select('*').order('code'),
      supabase.from('coa').select('*').order('code'),
      supabase.from('app_role').select('*').order('code'),
      supabase.from('settings').select('*').limit(1).maybeSingle(),
    ]);
    setProducts((p.data as Product[]) || []);
    setCustomers((c.data as Customer[]) || []);
    setSalespersons((s.data as Salesperson[]) || []);
    setWarehouses((w.data as Warehouse[]) || []);
    setDrivers((d.data as Driver[]) || []);
    setVehicles((v.data as Vehicle[]) || []);
    setTerms((t.data as PaymentTerm[]) || []);
    setTaxes((tx.data as Tax[]) || []);
    setBanks((b.data as BankAccount[]) || []);
    setCoa((a.data as Coa[]) || []);
    setRoles((r.data as Role[]) || []);
    setSettings((st.data as Settings) || null);
  }, [supabase]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error: e } = await supabase.rpc('my_profile');
        if (e) throw e;
        const prof = Array.isArray(data) ? data[0] : data;
        if (!prof) throw new Error('Profil pengguna tidak ditemukan atau akun dinonaktifkan.');
        if (!alive) return;
        setProfile(prof as Profile);
        await loadMaster();
        if (alive) setReady(true);
      } catch (err: unknown) {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
          setReady(true);
        }
      }
    })();
    return () => { alive = false; };
  }, [supabase, loadMaster]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const value: Store = useMemo(() => ({
    ready, error, profile, products, productMap, customers, salespersons, warehouses,
    drivers, vehicles, terms, taxes, banks, coa, roles, settings,
    cust: (code) => customers.find((x) => x.code === code) ||
      ({ code: code || '-', name: code || '-' } as Customer),
    prod: (id) => (id ? productMap.get(id) : undefined),
    wh: (code) => warehouses.find((x) => x.code === code) || ({ code: code || '-', name: code || '-' } as Warehouse),
    sp: (code) => salespersons.find((x) => x.code === code) || ({ code: code || '-', name: code || '-' } as Salesperson),
    termOf: (code) => terms.find((x) => x.code === code) ||
      ({ code: code || '-', name: code || '-', days: 0 } as PaymentTerm),
    accName: (code) => coa.find((x) => x.code === code)?.name || code,
    can: (act) => {
      const acts = profile?.acts;
      return acts === '*' || (Array.isArray(acts) && acts.includes(act));
    },
    canMenu: (k) => {
      const menus = profile?.menus;
      return menus === '*' || (Array.isArray(menus) && menus.includes(k));
    },
    toast,
    reloadMaster: loadMaster,
  }), [ready, error, profile, products, productMap, customers, salespersons, warehouses,
    drivers, vehicles, terms, taxes, banks, coa, roles, settings, toast, loadMaster]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div id="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.kind || '')}>
            <span className="ti">{t.kind === 'err' ? '✕' : t.kind === 'warn' ? '!' : t.kind === 'ok' ? '✓' : 'i'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Pembungkus pemanggilan Supabase agar pesan error tampil seragam. */
export function errMsg(e: unknown): string {
  if (!e) return 'Terjadi kesalahan.';
  if (typeof e === 'string') return e;
  const any = e as { message?: string; hint?: string; details?: string };
  return any.message || any.details || any.hint || 'Terjadi kesalahan.';
}
