#!/usr/bin/env bash
# Membuat MANIFEST.txt — daftar seluruh berkas yang harus ada di repositori.
# Dijalankan dari akar proyek setiap kali paket dirilis ulang.
set -euo pipefail
cd "$(dirname "$0")/.."

find . -type f \
  -not -path './node_modules/*' \
  -not -path './.next/*' \
  -not -name 'MANIFEST.txt' \
  -not -name '.env.local' \
  | sed 's|^\./||' | LC_ALL=C sort > MANIFEST.txt

echo "MANIFEST.txt ditulis: $(wc -l < MANIFEST.txt) berkas"
