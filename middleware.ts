import { NextResponse, type NextRequest } from 'next/server';

/* =====================================================================
   MIDDLEWARE — pengalihan halaman saja.

   Middleware berjalan di Edge runtime dan mengawal SETIAP permintaan:
   satu galat di sini membuat seluruh rute mengembalikan 500
   (MIDDLEWARE_INVOCATION_FAILED), termasuk halaman login. Karena itu di
   sini tidak ada pustaka Supabase, tidak ada panggilan jaringan, dan
   seluruh isinya dibungkus try/catch — kegagalan apa pun berakhir dengan
   permintaan diteruskan, bukan situs mati.

   Penyegaran sesi ditangani klien Supabase di peramban (createBrowserClient
   menyimpan sesi di cookie dan memperbaruinya sendiri), sehingga tidak perlu
   dilakukan di sini.

   Ini BUKAN lapisan keamanan. Otorisasi ditegakkan Row Level Security di
   database: cookie palsu hanya mengantar pengguna ke halaman yang kemudian
   gagal memuat data.
   ===================================================================== */

/** Nama cookie sesi Supabase: sb-<project-ref>-auth-token, bisa terpecah
 *  menjadi beberapa bagian bernomor bila isinya panjang. */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export function middleware(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname;
    const isLogin = path === '/login' || path.startsWith('/login/');
    const signedIn = request.cookies.getAll()
      .some((c) => AUTH_COOKIE.test(c.name) && c.value);

    if (!signedIn && !isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      url.searchParams.set('next', path);
      return NextResponse.redirect(url);
    }
    if (signedIn && isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
  } catch {
    /* Diabaikan dengan sengaja: lihat catatan di atas. */
  }
  return NextResponse.next();
}

export const config = {
  /* Lewati route handler, aset Next, dan semua berkas statis (apa pun yang
     mengandung titik, termasuk robots.txt dan gambar). */
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};
