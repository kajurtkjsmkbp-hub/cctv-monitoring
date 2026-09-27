#!/usr/bin/env bash
# ============================================================
#  Aegis Vision CCTV - Proxmox LXC Updater Script
# ============================================================

set -e

INSTALL_DIR="/opt/cctv-monitoring"

if [ ! -d "${INSTALL_DIR}" ]; then
    echo "Error: Direktori ${INSTALL_DIR} tidak ditemukan!"
    exit 1
fi

cd "${INSTALL_DIR}"

echo "=== [1/4] Mengambil Pembaruan Terbaru dari GitHub ==="
git fetch origin
git pull origin main || git pull origin master

echo "=== [2/4] Memperbarui Dependensi Python (jika ada) ==="
venv/bin/pip install -r requirements.txt

echo "=== [3/4] Memperbarui File Service Systemd ==="
cp systemd/aegis-cctv.service /etc/systemd/system/aegis-cctv.service
systemctl daemon-reload

echo "=== [4/4] Merestart Layanan CCTV ==="
systemctl restart aegis-cctv

echo "============================================================"
echo "  PEMBARUAN (UPDATE) BERHASIL DITERAPKAN!"
echo "  Layanan aegis-cctv telah aktif kembali."
echo "  Cek status dengan: systemctl status aegis-cctv"
echo "============================================================"
