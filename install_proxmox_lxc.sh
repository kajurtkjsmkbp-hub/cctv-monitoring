#!/usr/bin/env bash
# ============================================================
#  Aegis Vision CCTV - Proxmox LXC Automated Installer
#  Target OS: Debian 11/12 or Ubuntu 20.04/22.04/24.04 (LXC)
# ============================================================

set -e

echo "=== [1/6] Memperbarui Repositori Sistem & Paket Dependensi ==="
apt-get update
apt-get install -y python3 python3-pip python3-venv git curl ffmpeg libgl1 libglib2.0-0

INSTALL_DIR="/opt/cctv-monitoring"

echo "=== [2/6] Mempersiapkan Direktori Instalasi: ${INSTALL_DIR} ==="
if [ ! -d "${INSTALL_DIR}" ]; then
    echo "Mengkloning repositori dari GitHub..."
    git clone https://github.com/kajurtkjsmkbp-hub/cctv-monitoring.git "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

echo "=== [3/6] Membuat Python Virtual Environment (venv) ==="
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

echo "=== [4/6] Menginstal Dependensi Python ==="
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt

echo "=== [5/6] Memastikan Struktur Direktori Siap ==="
mkdir -p static/recordings static/snapshots static/events static/faces config models

echo "=== [6/6] Memasang & Mengaktifkan Systemd Service ==="
cp systemd/aegis-cctv.service /etc/systemd/system/aegis-cctv.service
systemctl daemon-reload
systemctl enable aegis-cctv
systemctl restart aegis-cctv

IP_ADDR=$(hostname -I | awk '{print $1}')
echo "============================================================"
echo "  INSTALASI SELESAI & BERHASIL DIJALANKAN!"
echo "  Buka browser Anda di:"
echo "  http://${IP_ADDR}:5000"
echo "============================================================"
echo "  Perintah Cek Status : systemctl status aegis-cctv"
echo "  Perintah Cek Log    : journalctl -u aegis-cctv -f"
echo "============================================================"
