"""
Settings and Alert Manager for Aegis Vision
Handles system preferences, Telegram Bot integration, and storage thresholds.
"""

import os
import json
import time
import requests
import threading
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(BASE_DIR, "config", "settings.json")

DEFAULT_SETTINGS = {
    "telegram_enabled": False,
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "telegram_alert_mode": "person",  # 'all', 'person', 'tripwire'
    "telegram_cooldown_seconds": 30,
    "ai_detection_enabled": True,
    "virtual_tripwire_enabled": True,
    "show_bounding_boxes": True,  # If True, draws sleek reticles; if False, clean stream
    "face_auto_zoom_enabled": True,
    "face_zoom_threshold": 50,  # Percentage 30% - 95%, default 50%
    "face_zoom_duration": 2.0,  # Duration in seconds, default 2.0s
    "face_zoom_cooldown": 4.0,
    "storage_retention_days": 14,
    "storage_max_percent": 90,
    "arming_mode": "auto",  # 'auto', 'always_armed', 'disarmed'
    "arming_start_time": "22:00",
    "arming_end_time": "06:00",
    "telegram_unknown_faces": True,
    "security_pin": "1234",
    "pin_enabled": False,
    "patrol_interval_seconds": 8,
    "floorplan_image": "/static/images/default_floorplan.svg",
    "camera_map_coords": {
        "cam-1": {"x": 18, "y": 80},
        "cam-2": {"x": 48, "y": 50},
        "cam-3": {"x": 82, "y": 25},
        "cam-4": {"x": 80, "y": 78}
    }
}

class SettingsManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.settings = self.load()
        self.last_telegram_alerts = {} # cam_id -> timestamp

    def load(self):
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r") as f:
                    data = json.load(f)
                    res = DEFAULT_SETTINGS.copy()
                    res.update(data)
                    return res
            except Exception:
                pass
        self.save(DEFAULT_SETTINGS)
        return DEFAULT_SETTINGS.copy()

    def save(self, data=None):
        if data:
            self.settings.update(data)
        with self.lock:
            with open(SETTINGS_FILE, "w") as f:
                json.dump(self.settings, f, indent=2)

    def get(self, key, default=None):
        return self.settings.get(key, default)

    def is_armed(self):
        """Returns True if the security alarm/alert system is armed based on schedule."""
        mode = self.get("arming_mode", "auto")
        if mode == "always_armed":
            return True
        if mode == "disarmed":
            return False

        try:
            cur_time = datetime.now().strftime("%H:%M")
            start = self.get("arming_start_time", "22:00")
            end = self.get("arming_end_time", "06:00")

            if start <= end:
                return start <= cur_time <= end
            else:
                return cur_time >= start or cur_time <= end
        except Exception:
            return True

    def update(self, new_settings):
        self.save(new_settings)
        return self.settings

    def send_telegram_alert(self, cam_id, cam_name, event_type, image_bytes):
        """Dispatches photo notification to user's Telegram Bot asynchronously."""
        if not self.settings.get("telegram_enabled"):
            return False

        token = self.settings.get("telegram_bot_token", "").strip()
        chat_id = self.settings.get("telegram_chat_id", "").strip()
        if not token or not chat_id:
            return False

        alert_mode = self.settings.get("telegram_alert_mode", "person")
        if alert_mode == "person" and event_type not in ["PERSON", "TRIPWIRE BREACH"]:
            return False

        now = time.time()
        cooldown = self.settings.get("telegram_cooldown_seconds", 30)
        if now - self.last_telegram_alerts.get(cam_id, 0) < cooldown:
            return False

        self.last_telegram_alerts[cam_id] = now

        def _worker():
            try:
                url = f"https://api.telegram.org/bot{token}/sendPhoto"
                caption = (
                    f"🚨 *AEGIS VISION SECURITY ALERT* 📹\n\n"
                    f"📍 *Kamera:* `{cam_name}`\n"
                    f"⚠️ *Objek:* `{event_type}`\n"
                    f"⏰ *Waktu:* `{time.strftime('%Y-%m-%d %H:%M:%S')}`\n\n"
                    f"🌐 _Pantau langsung: http://192.168.1.81:5000_"
                )
                files = {"photo": ("alert.jpg", image_bytes, "image/jpeg")}
                data = {"chat_id": chat_id, "caption": caption, "parse_mode": "Markdown"}
                requests.post(url, files=files, data=data, timeout=8)
            except Exception as e:
                print(f"[Telegram Alert Error]: {e}")

        threading.Thread(target=_worker, daemon=True).start()
        return True

    def test_telegram(self):
        """Sends a test ping to verified configured Telegram bot."""
        token = self.settings.get("telegram_bot_token", "").strip()
        chat_id = self.settings.get("telegram_chat_id", "").strip()
        if not token or not chat_id:
            return {"success": False, "error": "Bot Token atau Chat ID belum diisi!"}

        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            msg = (
                f"🛡️ *AEGIS VISION - Tes Notifikasi Berhasil!* ✅\n\n"
                f"Sistem CCTV Command Center Anda telah sukses terhubung ke bot Telegram ini.\n"
                f"Notifikasi peringatan dengan foto akan otomatis dikirimkan ke sini jika terdeteksi penyusup/gerakan."
            )
            r = requests.post(url, json={"chat_id": chat_id, "text": msg, "parse_mode": "Markdown"}, timeout=8)
            res = r.json()
            if res.get("ok"):
                return {"success": True, "message": "Pesan tes berhasil dikirim ke Telegram!"}
            else:
                return {"success": False, "error": res.get("description", "Error Telegram")}
        except Exception as e:
            return {"success": False, "error": str(e)}

settings_mgr = SettingsManager()
