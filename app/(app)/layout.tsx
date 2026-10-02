'use client';
import { AppProvider, useStore } from '@/lib/store';
import Shell from '@/components/shell';

function Gate({ children }: { children: React.ReactNode }) {
  const s = useStore();
  if (!s.ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100vh', color: 'var(--ink-3)', fontSize: 13 }}>
        Memuat data…
      </div>
    );
  }
  if (s.error) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', padding: 24 }}>
        <div className="err-box"><b>Tidak dapat memuat aplikasi.</b><br />{s.error}</div>
      </div>
    );
  }
  return <Shell>{children}</Shell>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppProvider><Gate>{children}</Gate></AppProvider>;
}
