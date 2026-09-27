"""
Aegis Vision - Next-Gen CCTV & ONVIF Command Center
Main Flask Backend Server
"""

import os
import time
import json
import base64
import cv2
import numpy as np
import subprocess
from datetime import datetime
from flask import Flask, render_template, Response, request, jsonify, send_from_directory
from flask_cors import CORS

from camera_manager import CameraManager, SNAPSHOT_DIR, RECORDING_DIR, EVENT_DIR
from onvif_scanner import scan_network_onvif, get_camera_onvif_details
from settings_manager import settings_mgr
from face_recognition_manager import face_recognition_mgr

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

camera_manager = CameraManager()

@app.route("/")
def index():
    return render_template("index.html")

def gen_frames(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return
    try:
        while True:
            frame_bytes = worker.get_jpeg_frame()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n'
                   b'Content-Length: ' + str(len(frame_bytes)).encode('ascii') + b'\r\n\r\n'
                   + frame_bytes + b'\r\n')
            time.sleep(0.04) # ~25 FPS
    except Exception:
        pass

@app.route("/stream/<cam_id>")
def stream_camera(cam_id):
    resp = Response(gen_frames(cam_id),
                    mimetype='multipart/x-mixed-replace; boundary=frame')
    resp.headers['Cache-Control'] = 'no-cache, private'
    resp.headers['Pragma'] = 'no-cache'
    return resp

@app.route("/api/frame/<cam_id>")
def get_single_frame(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return "Camera not found", 404
    frame_bytes = worker.get_jpeg_frame()
    resp = Response(frame_bytes, mimetype='image/jpeg')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    return resp

@app.route("/api/dvr_frame/<cam_id>")
def get_dvr_frame_endpoint(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return "Camera not found", 404
    offset = float(request.args.get("offset", 0))
    frame_bytes = worker.get_dvr_frame(offset)
    resp = Response(frame_bytes, mimetype='image/jpeg')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    return resp

def gen_dvr_replay(cam_id, offset):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return
    with worker.lock:
        frames = list(worker.dvr_buffer)
    if frames:
        target_ts = time.time() - float(offset)
        start_idx = 0
        for i, (ts, _) in enumerate(frames):
            if ts >= target_ts:
                start_idx = i
                break
        for i in range(start_idx, len(frames)):
            f_bytes = frames[i][1]
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n'
                   b'Content-Length: ' + str(len(f_bytes)).encode('ascii') + b'\r\n\r\n'
                   + f_bytes + b'\r\n')
            time.sleep(0.20)
    # Continue live streaming seamlessly
    try:
        while True:
            frame_bytes = worker.get_jpeg_frame()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n'
                   b'Content-Length: ' + str(len(frame_bytes)).encode('ascii') + b'\r\n\r\n'
                   + frame_bytes + b'\r\n')
            time.sleep(0.04)
    except Exception:
        pass

@app.route("/stream_dvr/<cam_id>")
def stream_dvr(cam_id):
    offset = float(request.args.get("offset", 10))
    resp = Response(gen_dvr_replay(cam_id, offset),
                    mimetype='multipart/x-mixed-replace; boundary=frame')
    resp.headers['Cache-Control'] = 'no-cache, private'
    return resp

@app.route("/api/cameras", methods=["GET"])
def get_cameras():
    return jsonify({"cameras": camera_manager.get_camera_list()})

@app.route("/api/cameras", methods=["POST"])
def add_camera():
    data = request.get_json() or {}
    if not data.get("name"):
        data["name"] = f"Camera {data.get('ip', 'New')}"
    created = camera_manager.add_camera(data)
    return jsonify({"success": True, "camera": created})

@app.route("/api/cameras/<cam_id>", methods=["PUT"])
def update_camera(cam_id):
    data = request.get_json() or {}
    updated = camera_manager.update_camera(cam_id, data)
    if updated:
        return jsonify({"success": True, "camera": updated})
    return jsonify({"success": False, "error": "Camera not found"}), 404

@app.route("/api/cameras/<cam_id>", methods=["DELETE"])
def delete_camera(cam_id):
    res = camera_manager.delete_camera(cam_id)
    return jsonify({"success": res})

@app.route("/api/cameras/<cam_id>/stream-quality", methods=["POST"])
def toggle_quality(cam_id):
    data = request.get_json() or {}
    quality = data.get("quality", "sub") # 'sub' or 'hd'
    updated = camera_manager.update_camera(cam_id, {"stream_quality": quality})
    return jsonify({"success": bool(updated), "stream_quality": quality})

@app.route("/api/cameras/<cam_id>/filter", methods=["POST"])
def set_filter(cam_id):
    data = request.get_json() or {}
    f_mode = data.get("filter", "normal") # normal, night, thermal, bw
    updated = camera_manager.update_camera(cam_id, {"filter": f_mode})
    return jsonify({"success": bool(updated), "filter": f_mode})

@app.route("/api/cameras/<cam_id>/toggle-motion", methods=["POST"])
def toggle_motion(cam_id):
    data = request.get_json() or {}
    enabled = data.get("enabled", True)
    updated = camera_manager.update_camera(cam_id, {"motion_detection": enabled})
    return jsonify({"success": bool(updated), "motion_detection": enabled})

@app.route("/api/scan", methods=["POST", "GET"])
def scan_network():
    req_data = request.get_json() if request.is_json else {}
    prefix = req_data.get("prefix", "192.168.1.")
    start_r = int(req_data.get("start", 1))
    end_r = int(req_data.get("end", 100))
    discovered = scan_network_onvif(subnet_prefix=prefix, start_range=start_r, end_range=end_r)
    return jsonify({"success": True, "count": len(discovered), "devices": discovered})

@app.route("/api/auto-heal", methods=["POST", "GET"])
def trigger_auto_heal():
    res = camera_manager.auto_heal_dhcp_ips()
    return jsonify(res)

@app.route("/api/ptz/<cam_id>/nudge", methods=["POST"])
def ptz_nudge(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker or not worker.ptz:
        return jsonify({"success": False, "error": "PTZ not supported on this camera"}), 400
    
    data = request.get_json() or {}
    direction = data.get("direction", "up")
    speed = float(data.get("speed", 0.5))
    res = worker.ptz.nudge(direction, speed=speed)
    return jsonify(res)

@app.route("/api/ptz/<cam_id>/continuous", methods=["POST"])
def ptz_continuous(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker or not worker.ptz:
        return jsonify({"success": False, "error": "PTZ not supported on this camera"}), 400
    
    data = request.get_json() or {}
    x = float(data.get("x", 0.0))
    y = float(data.get("y", 0.0))
    zoom = float(data.get("zoom", 0.0))
    res = worker.ptz.move(x, y, zoom)
    return jsonify(res)

@app.route("/api/ptz/<cam_id>/stop", methods=["POST"])
def ptz_stop(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker or not worker.ptz:
        return jsonify({"success": False, "error": "PTZ not supported on this camera"}), 400
    res = worker.ptz.stop()
    return jsonify(res)

@app.route("/api/snapshot/<cam_id>", methods=["POST"])
def take_snapshot(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return jsonify({"success": False, "error": "Camera not found"}), 404
    res = worker.snapshot()
    return jsonify(res)

@app.route("/api/record/<cam_id>/start", methods=["POST"])
def start_record(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return jsonify({"success": False, "error": "Camera not found"}), 404
    res = worker.start_recording()
    return jsonify(res)

@app.route("/api/record/<cam_id>/stop", methods=["POST"])
def stop_record(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return jsonify({"success": False, "error": "Camera not found"}), 404
    res = worker.stop_recording()
    return jsonify(res)

@app.route("/api/gallery", methods=["GET"])
def get_gallery():
    items = camera_manager.get_gallery_items()
    return jsonify({"items": items})

@app.route("/api/gallery/delete", methods=["POST"])
def delete_gallery_item():
    data = request.get_json() or {}
    fn = data.get("filename", "")
    item_type = data.get("type", "snapshot")
    
    target_dir = SNAPSHOT_DIR if item_type == "snapshot" else (RECORDING_DIR if item_type == "recording" else EVENT_DIR)
    fp = os.path.join(target_dir, os.path.basename(fn))
    if os.path.exists(fp):
        try:
            os.remove(fp)
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    return jsonify({"success": False, "error": "File not found"}), 404

@app.route("/api/stats", methods=["GET"])
def get_stats():
    cams = camera_manager.get_camera_list()
    online = sum(1 for c in cams if c.get("connected"))
    motion_cams = [c["id"] for c in cams if c.get("motion")]
    rec_cams = [c["id"] for c in cams if c.get("is_recording")]
    gallery_count = len(camera_manager.get_gallery_items())
    
    return jsonify({
        "total_cameras": len(cams),
        "online_cameras": online,
        "motion_active": len(motion_cams) > 0,
        "motion_camera_ids": motion_cams,
        "recording_camera_ids": rec_cams,
        "gallery_total": gallery_count,
        "cameras": cams
    })

@app.route("/api/audio/<cam_id>")
def get_cam_audio(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return jsonify({"success": False, "error": "Camera not found"}), 404
    return jsonify({
        "success": True,
        "cam_id": cam_id,
        "has_audio": True,
        "status": "active"
    })

@app.route("/api/audio_stream/<cam_id>")
def stream_camera_audio(cam_id):
    worker = camera_manager.get_worker(cam_id)
    if not worker:
        return "Camera not found", 404
    rtsp_url = worker.data.get("rtsp_url")
    if not rtsp_url:
        return "No RTSP URL", 404

    def generate_mp3():
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", rtsp_url,
            "-vn",
            "-acodec", "libmp3lame",
            "-b:a", "64k",
            "-ar", "16000",
            "-ac", "1",
            "-f", "mp3",
            "pipe:1"
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=2048)
        try:
            while True:
                chunk = proc.stdout.read(2048)
                if not chunk:
                    break
                yield chunk
        except GeneratorExit:
            proc.kill()
        finally:
            if proc.poll() is None:
                proc.kill()

    return Response(generate_mp3(), mimetype="audio/mpeg")

@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify({"success": True, "settings": settings_mgr.settings})

@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.get_json() or {}
    updated = settings_mgr.update(data)
    return jsonify({"success": True, "settings": updated})

@app.route("/api/settings/test-telegram", methods=["POST"])
def test_telegram_route():
    res = settings_mgr.test_telegram()
    return jsonify(res)

@app.route("/api/storage", methods=["GET"])
def get_storage_stats():
    return jsonify(camera_manager.get_storage_stats())

@app.route("/api/storage/cleanup", methods=["POST"])
def trigger_storage_cleanup():
    purged = camera_manager.cleanup_old_files()
    return jsonify({"success": True, "purged": purged, "stats": camera_manager.get_storage_stats()})

@app.route("/api/verify-pin", methods=["POST"])
def verify_pin():
    data = request.get_json() or {}
    pin = str(data.get("pin", "")).strip()
    correct_pin = str(settings_mgr.get("security_pin", "1234")).strip()
    is_enabled = settings_mgr.get("pin_enabled", False)
    if not is_enabled:
        return jsonify({"success": True, "valid": True})
    return jsonify({"success": True, "valid": (pin == correct_pin)})

# ==========================================
# 1. PWA MANIFEST & SERVICE WORKER
# ==========================================
@app.route("/manifest.json")
def pwa_manifest():
    return send_from_directory("static", "manifest.json", mimetype="application/manifest+json")

@app.route("/sw.js")
def pwa_sw():
    return send_from_directory("static", "sw.js", mimetype="application/javascript")

# ==========================================
# 2. AI FACE RECOGNITION API
# ==========================================
@app.route("/api/faces", methods=["GET"])
def get_faces():
    return jsonify({"success": True, "faces": face_recognition_mgr.get_faces_list()})

@app.route("/api/faces", methods=["POST"])
def register_face():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    role = data.get("role", "Keluarga").strip()
    notes = data.get("notes", "").strip()
    img_b64 = data.get("image_base64", "")
    cam_id = data.get("cam_id", "")

    if not name:
        return jsonify({"success": False, "error": "Nama wajib diisi"}), 400

    img_bgr = None
    if cam_id:
        worker = camera_manager.get_worker(cam_id)
        if worker and worker.last_frame is not None:
            img_bgr = worker.last_frame.copy()
    elif img_b64:
        try:
            if "," in img_b64:
                img_b64 = img_b64.split(",", 1)[1]
            raw = base64.b64decode(img_b64)
            nparr = np.frombuffer(raw, np.uint8)
            img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            return jsonify({"success": False, "error": f"Format gambar tidak valid: {e}"}), 400

    if img_bgr is None:
        return jsonify({"success": False, "error": "Gambar wajah tidak ditemukan"}), 400

    res = face_recognition_mgr.register_face(name, img_bgr, role=role, notes=notes)
    return jsonify(res)

@app.route("/api/faces/<face_id>", methods=["DELETE"])
def delete_face(face_id):
    res = face_recognition_mgr.delete_face(face_id)
    return jsonify(res)

# ==========================================
# 3. PRIVACY MASKS API
# ==========================================
@app.route("/api/cameras/<cam_id>/privacy-masks", methods=["POST"])
def set_privacy_masks(cam_id):
    data = request.get_json() or {}
    masks = data.get("masks", [])
    updated = camera_manager.update_camera(cam_id, {"privacy_masks": masks})
    return jsonify({"success": bool(updated), "privacy_masks": masks})

# ==========================================
# 4. ARMING & SECURITY SCHEDULE API
# ==========================================
@app.route("/api/arming/status", methods=["GET"])
def get_arming_status():
    return jsonify({
        "success": True,
        "is_armed": settings_mgr.is_armed(),
        "mode": settings_mgr.get("arming_mode", "auto"),
        "start_time": settings_mgr.get("arming_start_time", "22:00"),
        "end_time": settings_mgr.get("arming_end_time", "06:00")
    })

@app.route("/api/arming/toggle", methods=["POST"])
def toggle_arming():
    cur_mode = settings_mgr.get("arming_mode", "auto")
    next_modes = {"auto": "always_armed", "always_armed": "disarmed", "disarmed": "auto"}
    new_mode = next_modes.get(cur_mode, "auto")
    settings_mgr.update({"arming_mode": new_mode})
    return jsonify({
        "success": True,
        "mode": new_mode,
        "is_armed": settings_mgr.is_armed()
    })

# ==========================================
# 5. SMART 24-HOUR VIDEO TIMELINE API
# ==========================================
@app.route("/api/timeline", methods=["GET"])
def get_timeline():
    target_date = request.args.get("date", datetime.now().strftime("%Y-%m-%d"))
    date_str = target_date.replace("-", "")

    items = camera_manager.get_gallery_items()
    day_items = []
    for it in items:
        ts = it.get("created_at", "")
        if ts.startswith(target_date) or date_str in it.get("filename", ""):
            day_items.append(it)

    timeline_events = []
    for it in day_items:
        try:
            fn = it.get("filename", "")
            parts = fn.split("_")
            h, m, s = 0, 0, 0
            if len(parts) >= 4:
                time_part = parts[3].split(".")[0]
                if len(time_part) >= 4:
                    h = int(time_part[0:2])
                    m = int(time_part[2:4])
                    s = int(time_part[4:6]) if len(time_part) >= 6 else 0
            sec_of_day = h * 3600 + m * 60 + s
            
            timeline_events.append({
                "type": it.get("type"),
                "cam_id": it.get("cam_id"),
                "cam_name": it.get("cam_name"),
                "filename": it.get("filename"),
                "url": it.get("url"),
                "time_str": f"{h:02d}:{m:02d}:{s:02d}",
                "second": sec_of_day,
                "percent": round((sec_of_day / 86400.0) * 100, 2)
            })
        except Exception:
            continue

    timeline_events.sort(key=lambda x: x["second"])
    return jsonify({
        "success": True,
        "date": target_date,
        "total_events": len(timeline_events),
        "events": timeline_events
    })

if __name__ == "__main__":
    print("=" * 60)
    print("  AEGIS VISION - CCTV & ONVIF COMMAND STATION")
    print("  Web Server: http://127.0.0.1:5000")
    print("  Local IP:   http://192.168.1.81:5000")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
