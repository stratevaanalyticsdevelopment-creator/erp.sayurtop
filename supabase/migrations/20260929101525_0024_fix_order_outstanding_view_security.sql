/* 0024 — Picking List memberi angka berbeda-beda tergantung akun yang login

   `order_outstanding_view` satu-satunya view yang dibuat dengan
   `security_invoker = on`; seluruh view lain memakai `off`. Bedanya menentukan
   siapa yang dipakai saat membaca tabel di dalamnya:

   - off : view dibaca atas nama pemiliknya, sehingga seluruh baris terbaca
           utuh lalu hasilnya disaring oleh hak menu di lapisan aplikasi
   - on  : view dibaca atas nama pengguna yang sedang login, sehingga RLS tiap
           tabel di dalamnya ikut berlaku

   Akibatnya fatal dan senyap. Saat `delivery_line` tidak terbaca oleh peran
   tertentu, kolom qty terkirim menjadi nol, dan seluruh baris order tampak
   belum dikirim sama sekali:

       admin / sukir  →  88 baris   (benar)
       budi / direktur → 593 baris  (seluruh baris order, seolah belum ada
                                     satu pun pengiriman)
       lina            →   0 baris

   Angka 593 itu bukan sekadar tampilan: Picking List akan menyuruh gudang
   menyiapkan barang yang sudah dikirim.

   Perbaikannya menyamakan view ini dengan yang lain. Hak akses menu tetap
   ditegakkan seperti sebelumnya — halaman Picking List hanya muncul untuk
   peran yang memilikinya (WHOUSE dan ADMIN).
*/
alter view public.order_outstanding_view set (security_invoker = off);
