# Aegis Vision • ONVIF CCTV Command Station 🛡️📹

A modern, ultra low-latency, web-based CCTV Surveillance & Video Management System (VMS) with native **ONVIF WS-Discovery**, RTSP Proxying, AI Motion & Biometric Face Recognition, PTZ (Pan-Tilt-Zoom) Active Controls, Timeshift DVR Scrubber, Multi-Camera Synchronized Playback, and Real-time Network Latency Monitor.

---

## 🌟 Fitur Unggulan

1. **Auto ONVIF WS-Discovery**:
   - Memindai jaringan otomatis (UDP 3702 Multicast/Broadcast + RTSP probe).
   - Mendeteksi profil kamera, port ONVif, Main HD & Sub stream secara instan.
2. **AI Computer Vision & Deep Learning**:
   - **AI Motion Detection**: Background subtraction (MOG2) dengan filter kontur cerdas (anti-noise daun/angin).
   - **YuNet Deep Learning Face Auto-Zoom**: Deteksi wajah akurat dengan pembesaran target HUD otomatis.
   - **Biometric Face Recognition**: Mengenali wajah terdaftar (Keluarga, Karyawan, VIP) serta peringatan Telegram instan untuk Wajah Asing (*Unknown Face*).
3. **Timeshift DVR & Multi-Camera Synchronized Playback**:
   - Putar ulang rekaman mundur (-10s, -30s) atau geser bilah scrubber secara real-time.
   - **Master Synchronized Playback Bar**: Mengontrol mundur, maju, jeda, dan kembali ke siaran langsung untuk seluruh kamera secara serentak.
4. **Physical ONVIF PTZ Controls**:
   - D-Pad 8-arah interaktif + Slider Kecepatan Putaran + Zoom In/Out terhubung langsung ke motor servo kamera.
5. **Network Health & Ping Latency Monitor**:
   - Pengukuran latensi TCP handshake real-time untuk setiap kamera dengan badge warna dinamis (Hijau <50ms, Kuning <120ms, Merah >120ms).
6. **Desain Responsif 2-Tier Hierarchy**:
   - Tampilan bersih tanpa teks terpotong di layar HP, tablet, maupun monitor PC/SOC.
   - Pilihan layout fleksibel: **1x1, 2x2, 3x2 (6 Layar), 3x3, dan Focus 1+5**. Pilihan layout tersimpan otomatis di `localStorage`.
7. **Penyimpanan Lokal & Keamanan**:
   - Perekaman video manual/terjadwal dan penyimpanan bukti tangkapan gerakan (*Event Log*).
   - Sensor Privasi (*Privacy Masking*) untuk menyamarkan area sensitif langsung dari browser.

---

## 🖥️ Panduan Instalasi di Proxmox LXC (Debian 12 / Ubuntu 22.04/24.04)

Menjalankan Aegis Vision di dalam container **Proxmox LXC** sangat disarankan karena ringan, hemat daya (RAM hanya ~150-300 MB), dan dapat berjalan 24/7 tanpa beban berlebih pada server Proxmox VE.

### 1. Spesifikasi Rekomendasi LXC Container
- **Template OS**: Debian 12 (Bookworm) atau Ubuntu 22.04 / 24.04 Standard
- **Cores**: 2 vCPU (cukup untuk 4-8 kamera)
- **RAM**: 2048 MB (minimal 1024 MB)
- **Disk**: 16 GB - 32 GB (atau mount storage eksternal untuk rekaman)
- **Network**: Bridge `vmbr0` (pastikan 1 segmen IP dengan kamera CCTV, misal DHCP atau Static IP)

---

### Cara 1: Instalasi Cepat Otomatis (1 Perintah)

Buka console root di LXC Proxmox Anda, lalu jalankan:

```bash
apt-get update && apt-get install -y git curl
git clone https://github.com/kajurtkjsmkbp-hub/cctv-monitoring.git /opt/cctv-monitoring
cd /opt/cctv-monitoring
chmod +x install_proxmox_lxc.sh update_proxmox_lxc.sh
./install_proxmox_lxc.sh
```

Skrip ini akan otomatis menginstal paket sistem, Python venv, dependensi pip, menyusun struktur folder, serta memasang dan mengaktifkan background service `systemd`!

---

### Cara 2: Instalasi Manual Langkah-demi-Langkah

Jika Anda ingin melakukan instalasi secara manual langkah demi langkah di dalam LXC:

#### Langkah 1: Update Sistem & Instal Paket Pendukung
```bash
apt-get update && apt-get upgrade -y
apt-get install -y python3 python3-pip python3-venv git curl ffmpeg libgl1 libglib2.0-0
```

#### Langkah 2: Kloning Repositori
```bash
git clone https://github.com/kajurtkjsmkbp-hub/cctv-monitoring.git /opt/cctv-monitoring
cd /opt/cctv-monitoring
```

#### Langkah 3: Buat & Konfigurasi Virtual Environment Python
```bash
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt
```

#### Langkah 4: Siapkan Direktori Penyimpanan Rekaman
```bash
mkdir -p static/recordings static/snapshots static/events static/faces config models
```

#### Langkah 5: Pasang Service Systemd (Auto-Start Saat Boot)
Salin file service agar CCTV otomatis menyala saat container Proxmox di-boot:
```bash
cp systemd/aegis-cctv.service /etc/systemd/system/aegis-cctv.service
systemctl daemon-reload
systemctl enable aegis-cctv
systemctl start aegis-cctv
```

#### Langkah 6: Verifikasi Status Layanan
```bash
systemctl status aegis-cctv
```
Jika status berwarna hijau `active (running)`, buka browser di komputer/HP Anda:
```text
http://<IP_LXC_PROXMOX>:5000
```
*(Contoh: `http://192.168.1.150:5000`)*

---

### 💾 (Opsional) Menghubungkan Harddisk / Storage Tambahan di Proxmox LXC

Jika Anda memiliki Harddisk khusus CCTV di server Proxmox dan ingin menyimpan rekaman video ke harddisk tersebut:

1. Di Host Proxmox VE (bukan di dalam LXC), buka file konfigurasi LXC (misal ID container `105`):
   ```bash
   nano /etc/pve/lxc/105.conf
   ```
2. Tambahkan bind-mount di baris paling bawah:
   ```text
   mp0: /mnt/pve/hdd-cctv,mp=/opt/cctv-monitoring/static/recordings
   ```
3. Restart container LXC:
   ```bash
   pct restart 105
   ```
Semua file rekaman video CCTV kini langsung tersimpan di harddisk eksternal Proxmox.

---

## 🔄 Panduan Update Sistem di Proxmox LXC

Setiap kali ada pembaruan fitur atau perbaikan kode di GitHub:

### Cara Cepat: Menggunakan Skrip Updater
Masuk ke terminal LXC dan jalankan:
```bash
cd /opt/cctv-monitoring
./update_proxmox_lxc.sh
```

### Cara Manual:
```bash
cd /opt/cctv-monitoring
# 1. Tarik pembaruan kode terbaru
git pull origin master

# 2. Perbarui dependensi jika ada pustaka baru
venv/bin/pip install -r requirements.txt

# 3. Reload daemon dan restart service
systemctl daemon-reload
systemctl restart aegis-cctv

# 4. Cek log real-time untuk memastikan berjalan mulus
journalctl -u aegis-cctv -f
```

---

## 💻 Panduan Menjalankan di Windows (Lokal)

Jika ingin menjalankan sistem ini di komputer/laptop Windows:
1. Pastikan Python 3.10+ sudah terinstal.
2. Buka folder proyek di Terminal / Command Prompt.
3. Instal pustaka yang dibutuhkan:
   ```cmd
   pip install -r requirements.txt
   ```
4. Jalankan aplikasi:
   ```cmd
   python app.py
   ```
   Atau cukup klik ganda file [`start_cctv.bat`](file:///C:/Users/Komputer%20Vintage/Music/CCTV/start_cctv.bat).
5. Buka browser di `http://127.0.0.1:5000`.

---

## 🛠️ Perintah Berguna di Proxmox LXC

| Kebutuhan | Perintah |
|---|---|
| Cek status server CCTV | `systemctl status aegis-cctv` |
| Restart server CCTV | `systemctl restart aegis-cctv` |
| Hentikan server CCTV | `systemctl stop aegis-cctv` |
| Lihat log aktivitas live | `journalctl -u aegis-cctv -f` |
| Cek penggunaan CPU & RAM | `htop` |

---

## 📄 Lisensi
Hak Cipta © 2026 Aegis Vision. Dikembangkan untuk pengawasan CCTV modern berkinerja tinggi.
