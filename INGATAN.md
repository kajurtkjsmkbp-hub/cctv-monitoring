# 🧠 INGATAN ABADI SISTEM (AEGIS VISION CCTV MEMORY BANK)

> **Dokumen ini dibuat khusus sebagai pusat memori abadi AI Antigravity.**  
> Kapan pun sesi ditutup, logout, atau Anda login kembali di masa depan, membaca file ini akan langsung mengembalikan 100% konteks, arsitektur, konfigurasi jaringan, serta riwayat pengembangan proyek ini.

---

## 📌 1. Identitas & Repositori Proyek

* **Nama Sistem:** Aegis Vision • ONVIF CCTV Command Station
* **Versi:** v2.5 PRO
* **Tipe Sistem:** Video Management System (VMS) berbasis Web, Single Page Application (SPA), ultra low-latency RTSP proxying, AI Motion & Biometric Recognition, Timeshift DVR, dan PTZ Command.
* **GitHub Repository:** [https://github.com/kajurtkjsmkbp-hub/cctv-monitoring.git](https://github.com/kajurtkjsmkbp-hub/cctv-monitoring.git)
* **Branch Utama:** `main`
* **Akun Git Pengembang:**
  * Nama: `kajurtkjsmkbp-hub`
  * Email: `kajur.tkj.smkbp@gmail.com`
* **Lokasi Server Aktif:**
  * **PC Windows (Development & Monitoring Lokal):** `http://192.168.1.81:5000` (atau `http://127.0.0.1:5000`)
  * **Proxmox LXC (Server Produksi 24/7):** `http://192.168.1.115:5000`
  * Direktori Windows: `C:\Users\Komputer Vintage\Music\CCTV`
  * Direktori Proxmox LXC: `/opt/cctv-monitoring`

---

## 🌐 2. Topologi Jaringan & Spesifikasi 4 Kamera CCTV Fisik

Semua kamera adalah kamera fisik tipe **macro-video-soft IPCamera (V380 / ONVIF Profile S)**:

| ID | Nama Kamera | IP Address | Port ONVIF | Port RTSP | Subnet & Gateway | MAC Address Fisik | Fitur PTZ | URL Stream RTSP |
|---|---|---|---|---|---|---|---|---|
| **cam-1** | **CAM 01 - Main Entrance** | `192.168.1.65` | `8899` | `554` | Subnet 1 (`192.168.1.1`) | `00:55:7b:79:b2:aa` | ✅ Aktif (8 Arah + Zoom) | Sub: `rtsp://192.168.1.65/live/ch00_1`<br>HD: `rtsp://192.168.1.65/live/ch00_0` |
| **cam-2** | **CAM 02 - Corridor & Hallway** | `192.168.1.66` | `8899` | `554` | Subnet 1 (`192.168.1.1`) | `00:55:7b:77:29:65` | ✅ Aktif (8 Arah + Zoom) | Sub: `rtsp://192.168.1.66/live/ch00_1`<br>HD: `rtsp://192.168.1.66/live/ch00_0` |
| **cam-3** | **CAM 03 - Backyard & Perimeter** | `192.168.1.67` | `8899` | `554` | Subnet 1 (`192.168.1.1`) | `00:55:7b:f4:34:b8` | ✅ Aktif (8 Arah + Zoom) | Sub: `rtsp://192.168.1.67/live/ch00_1`<br>HD: `rtsp://192.168.1.67/live/ch00_0` |
| **cam-4** | **CAM 04 - Ruang Tamu** | `192.168.50.69` | `8899` | `554` | **Subnet 50 via Mikrotik `192.168.1.64`** | `00:55:7b:a0:8f:b2` | ✅ Aktif (8 Arah + Zoom) | Sub: `rtsp://192.168.50.69/live/ch00_1`<br>HD: `rtsp://192.168.50.69/live/ch00_0` |

### ⚠️ KUNCI PENTING TENTANG CCTV 4 (Subnet 192.168.50.x):
* **Kenapa CCTV 4 berbeda sendiri?** CCTV 4 berada di bawah router Mikrotik (`192.168.1.64`) pada subnet `192.168.50.0/24`.
* **Kebutuhan Static Route:**
  * **Di Windows:** Dijalankan via script `tambah_route_mikrotik.bat` (`route add 192.168.50.0 mask 255.255.255.0 192.168.1.64 -p`).
  * **Di Proxmox LXC (`192.168.1.115`):** Wajib menjalankan:
    ```bash
    ip route add 192.168.50.0/24 via 192.168.1.64
    ```
  * *Sudah diotomatisasi:* File `systemd/aegis-cctv.service` dan skrip `update_proxmox_lxc.sh` sudah memiliki baris perintah injeksi rute otomatis ini saat servis dinyalakan.

---

## 🛠️ 3. Arsitektur Kode & Optimasi Kritis

### A. Backend Python
1. **`app.py`**:
   * Server Flask melayani API REST (`/api/stats`, `/api/cameras`, `/api/dvr_frame`, `/api/auto-heal`, `/api/ptz/move`, dll.).
   * Endpoint stream MJPEG: `/stream/<cam_id>` dan single frame `/api/frame/<cam_id>`.
2. **`camera_manager.py`**:
   * Multi-threaded video pipeline: Tiap kamera memiliki thread independen (`_run_stream`).
   * **Solusi Anti-Lag Deteksi Gerakan:**
     * *Asynchronous File & Telegram Saving:* `_save_event_snapshot()` dan pengiriman Telegram dipindah ke background daemon thread (`_async_event_save`). Thread RTSP tidak pernah terhambat disk I/O.
     * *Smart Contour Filter:* Kontur dibatasi hanya jika `area > 450` dan hanya memproses **maksimal 4 objek terbesar** (menghilangkan lag akibat daun/angin).
     * *Face Detection Throttling:* Model deep-learning YuNet hanya dijalankan **1 kali setiap 4 frame** (`self.frame_count % 4 == 0`), menghemat 75% beban CPU.
     * *Single-Pass JPEG Cache:* Kompresi frame ke JPEG hanya dilakukan sekali di worker (`self.cached_jpeg`), dibagi rata ke semua browser client dengan latency 0 ms.
     * *Network Health & Ping Monitor:* Mengukur latency TCP handshake langsung ke port kamera dan diekspos ke `/api/stats`.
     * *Auto-Heal DHCP:* Memantau MAC address fisik kamera (`00:55:7b:...`). Jika IP kamera berubah oleh DHCP, sistem otomatis memperbarui URL RTSP tanpa intervensi manual.
3. **`onvif_scanner.py`**:
   * Implementasi WS-Discovery UDP 3702 Multicast/Unicast probe.
   * Ekstraktor URN UUID untuk mendapatkan MAC Address asli perangkat.
4. **`ptz_controller.py`**:
   * Mengirim SOAP XML Command ke service `/onvif/ptz_service` kamera (ContinuousMove, Stop, AbsoluteMove).
5. **`face_recognition_manager.py`**:
   * Manajemen database biometrik wajah terdaftar (`config/known_faces.json`).
6. **`settings_manager.py`**:
   * Konfigurasi sistem (`config/settings.json`) termasuk bot Telegram, arming schedule, dan batas retensi storage.

### B. Frontend JavaScript & CSS
1. **`templates/index.html`**:
   * Antarmuka Cyber Dark Theme (Tailwind CSS CDN + Lucide Icons).
   * Bilah Master Synchronized Playback (`#master-sync-bar`).
   * Tombol Auto-Heal DHCP, Scan ONVIF, dan Layout Switcher (1x1, 2x2, 3x2, 3x3, 1+5).
2. **`static/js/app.js`**:
   * **Persistence Layout (`localStorage`):** Pilihan layout (seperti mode 6-layar `grid-3x2`) disimpan di `localStorage.getItem('cctv_layout')` sehingga tidak akan reset saat halaman dimuat ulang.
   * **Screen WakeLock & Keep-Alive:** Menjaga browser Chrome/Edge agar tidak menidurkan tab CCTV (*prevent tab discarding/sleeping*).
   * **Header Kamera 2-Baris (2-Tier Hierarchy):**
     * Baris 1: Titik status + Nama Lengkap + Badge Gerakan/AI + Tombol Suara.
     * Baris 2: Alamat IP + Port + Badge Ping Latency berwarna + FPS + Resolusi.
     * Responsif sempurna: tidak terpotong di layar HP maupun monitor PC.
   * **Master Scrubber Synchronized Playback:** Mengontrol mundur 10s, 30s, pause, dan kembali ke siaran langsung untuk ke-4 kamera secara bersamaan.

---

## 🚀 4. Proxmox LXC Deployment & Pemeliharaan

### File Konfigurasi & Skrip Produksi:
* **`systemd/aegis-cctv.service`**:
  ```ini
  [Unit]
  Description=Aegis Vision - ONVIF CCTV Command Station
  After=network.target

  [Service]
  Type=simple
  User=root
  WorkingDirectory=/opt/cctv-monitoring
  ExecStartPre=-/bin/sh -c "ip route add 192.168.50.0/24 via 192.168.1.64 2>/dev/null || true"
  ExecStart=/opt/cctv-monitoring/venv/bin/python app.py
  Restart=always
  RestartSec=5
  Environment=PYTHONUNBUFFERED=1

  [Install]
  WantedBy=multi-user.target
  ```
* **`install_proxmox_lxc.sh`**: Skrip instalasi otomatis sekali jalan di container Debian/Ubuntu.
* **`update_proxmox_lxc.sh`**: Skrip pembaruan otomatis dari GitHub dengan `git reset --hard origin/main` (bebas konflik permission).

### Perintah Rutin di Terminal Proxmox LXC:
```bash
# Perbarui sistem ke commit terbaru di GitHub:
cd /opt/cctv-monitoring
./update_proxmox_lxc.sh

# Cek status layanan CCTV:
systemctl status aegis-cctv

# Pantau log aktivitas live:
journalctl -u aegis-cctv -f

# Sambungkan rute CCTV 4 manual:
ip route add 192.168.50.0/24 via 192.168.1.64
```

### Mount Harddisk Eksternal Proxmox ke Folder Rekaman:
Di host Proxmox VE (file `/etc/pve/lxc/<ID_CONTAINER>.conf`):
```text
mp0: /mnt/pve/hdd-cctv,mp=/opt/cctv-monitoring/static/recordings
```

---

## 💡 5. Preferensi & Keputusan Desain Pengguna (User Preferences)

1. **Bahasa Komunikasi:** Bahasa Indonesia (jelas, sopan, lugas, teknis namun mudah dipahami).
2. **Kerapian Header Kartu Kamera:**
   - Tidak boleh ada teks penting yang terpotong (`...`), terutama nomor IP, ping, nama kamera, atau indikator gerakan.
   - Tombol audio berdiri sendiri di header masing-masing kamera.
3. **Penyimpanan Rekaman:** Folder rekaman video (`static/recordings`), foto kejadian (`static/events`), dan tangkapan snapshot (`static/snapshots`) diabaikan oleh `.gitignore` demi menjaga privasi dan kebersihan repositori Git.
4. **Stabilitas Video:** Framerate stabil di angka hardware kamera (~12 - 15 FPS), ping < 20 ms.

---
*Dokumen ini diperbarui secara berkala dan disinkronkan langsung ke GitHub Repository.*
