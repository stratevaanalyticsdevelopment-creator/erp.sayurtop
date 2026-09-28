# Tahap 1 — modul pembelian (migrasi 0007–0010)

Empat migrasi berikut menambah modul pembelian di atas skema yang sudah ada.
Jalankan berurutan **setelah** migrasi 0001–0006 dan tiga migrasi tambahan
sebelumnya.

| Berkas | Isi |
| --- | --- |
| `0007_purchasing_schema` | Tabel `supplier`, `purchase_order(+line)`, `goods_receipt(+line)`, `landed_cost`; kolom `product.default_supplier_code` dan `sales_order_line.po_line_id`; view `purchase_price_daily`; CoA 1310/2150/5200; policy RLS |
| `0008_po_from_so_and_hpp_match` | Kolom `so_line_id` pada `delivery_line` & `invoice_line`; fungsi `hpp_unit()` dan `hpp_source()`; `create_po_from_order()`; `approve_sales_order()` menerbitkan PO; `create_delivery()` & `create_invoice_from_delivery()` membawa tautan baris; `invoice_journal_lines()` memakai HPP aktual |
| `0009_receive_goods_landed_cost` | `receive_goods()`, `apply_landed_cost()`, `realloc_landed()`, `refresh_base_price()`; `process_return()` memakai HPP yang sama dengan fakturnya |
| `0010_seed_supplier_and_roles` | 8 supplier contoh, supplier default per kategori produk, menu baru pada role WHOUSE/FINANCE/MGMT, role baru `PURCH` (Purchasing) |

## Urutan HPP

`hpp_unit(product_id, so_line_id, tanggal)` mengambil biaya dari sumber
paling spesifik yang tersedia:

1. biaya aktual penerimaan barang atas baris PO yang ditautkan ke baris SO
2. rata-rata harga beli produk pada tanggal faktur
3. harga beli terakhir sebelum tanggal faktur
4. harga pokok standar pada master produk

Tingkat 2–4 diperlukan agar faktur tanpa PO — data lama, atau barang yang
diambil dari stok — tetap memiliki HPP sehingga neraca tidak timpang.
Halaman faktur menandai baris yang HPP-nya berasal dari PO dengan label
`PO`, sisanya `ESTIMASI`.
