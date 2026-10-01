-- Halaman Document Numbering perlu membaca nomor berjalan terakhir.
-- Penulisan tetap tertutup: hanya fungsi next_doc_no (SECURITY DEFINER) yang menaikkan seq.
create policy doc_counter_sel on public.doc_counter
  for select using (rbac('sys.numbering','view'));
