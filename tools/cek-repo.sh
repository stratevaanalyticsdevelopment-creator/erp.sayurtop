#!/usr/bin/env bash
# Memeriksa apakah repositori GitHub sudah memuat seluruh berkas proyek.
#
# Galat "Module not found: Can't resolve '@/components/ui'" di Vercel hampir
# selalu berarti sebagian berkas tidak ikut terunggah — bukan salah kode.
# Fitur "Add files via upload" di web GitHub membuang kelebihan berkas tanpa
# peringatan apa pun.
#
# Cara pakai, dari dalam folder hasil clone repositori:
#
#   bash tools/cek-repo.sh
#
# Atau membandingkan repositori terhadap paket asli:
#
#   bash tools/cek-repo.sh /path/ke/paket-asli/MANIFEST.txt
set -euo pipefail

MAN="${1:-MANIFEST.txt}"
if [ ! -f "$MAN" ]; then
  echo "MANIFEST.txt tidak ditemukan. Jalankan dari akar proyek, atau"
  echo "sebutkan lokasinya: bash tools/cek-repo.sh /path/MANIFEST.txt"
  exit 2
fi

if git rev-parse --git-dir >/dev/null 2>&1; then
  git ls-files | LC_ALL=C sort > /tmp/.repo-files
  SUMBER="daftar berkas yang benar-benar masuk git"
else
  find . -type f -not -path './node_modules/*' -not -path './.next/*' \
    -not -name 'MANIFEST.txt' -not -name '.env.local' \
    | sed 's|^\./||' | LC_ALL=C sort > /tmp/.repo-files
  SUMBER="isi folder (bukan repositori git)"
fi

HILANG=$(comm -23 <(grep -v '^\.env\.local$' "$MAN" | LC_ALL=C sort) /tmp/.repo-files || true)

echo "Diperiksa terhadap: $SUMBER"
echo "Seharusnya ada : $(grep -vc '^\.env\.local$' "$MAN") berkas"
echo "Yang ditemukan : $(wc -l < /tmp/.repo-files) berkas"
echo

if [ -z "$HILANG" ]; then
  echo "LENGKAP — seluruh berkas ada. Bila Vercel masih gagal, penyebabnya"
  echo "bukan berkas yang hilang; baca bagian lain di DEPLOY.md."
  exit 0
fi

echo "BERKAS HILANG ($(printf '%s\n' "$HILANG" | wc -l)):"
printf '%s\n' "$HILANG" | sed 's/^/  /'
echo
echo "Unggah berkas di atas, lalu jalankan ulang pemeriksaan ini."
exit 1
