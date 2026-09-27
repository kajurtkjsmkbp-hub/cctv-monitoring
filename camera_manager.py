"""
Camera Manager Engine
Handles multi-camera RTSP ingestion, threaded frame decoding, AI motion detection,
recording, snapshots, and simulated test streams.
"""

import os
import cv2
import time
import json
import math
import shutil
import numpy as np
import threading
import socket
from collections import deque
from datetime import datetime
from ptz_controller import PTZController
from settings_manager import settings_mgr
from face_recognition_manager import face_recognition_mgr

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config", "cameras.json")
SNAPSHOT_DIR = os.path.join(BASE_DIR, "static", "snapshots")
RECORDING_DIR = os.path.join(BASE_DIR, "static", "recordings")
EVENT_DIR = os.path.join(BASE_DIR, "static", "events")
YUNET_MODEL = os.path.join(BASE_DIR, "models", "face_detection_yunet.onnx")

for d in [os.path.dirname(CONFIG_FILE), SNAPSHOT_DIR, RECORDING_DIR, EVENT_DIR, os.path.dirname(YUNET_MODEL)]:
    os.makedirs(d, exist_ok=True)

DEFAULT_CAMERAS = [
    {
        "id": "cam-1",
        "name": "CAM 01 - Main Entrance",
        "ip": "192.168.1.65",
        "mac": "00:55:7b:79:b2:aa",
        "onvif_port": 8899,
        "rtsp_url": "rtsp://192.168.1.65/live/ch00_1",
        "rtsp_hd_url": "rtsp://192.168.1.65/live/ch00_0",
        "type": "onvif",
        "has_ptz": True,
        "stream_quality": "sub",
        "motion_detection": True,
        "filter": "normal",
        "enabled": True
    },
    {
        "id": "cam-2",
        "name": "CAM 02 - Corridor & Hallway",
        "ip": "192.168.1.66",
        "mac": "00:55:7b:77:29:65",
        "onvif_port": 8899,
        "rtsp_url": "rtsp://192.168.1.66/live/ch00_1",
        "rtsp_hd_url": "rtsp://192.168.1.66/live/ch00_0",
        "type": "onvif",
        "has_ptz": True,
        "stream_quality": "sub",
        "motion_detection": True,
        "filter": "normal",
        "enabled": True
    },
    {
        "id": "cam-3",
        "name": "CAM 03 - Backyard & Perimeter",
        "ip": "192.168.1.67",
        "mac": "00:55:7b:f4:34:b8",
        "onvif_port": 8899,
        "rtsp_url": "rtsp://192.168.1.67/live/ch00_1",
        "rtsp_hd_url": "rtsp://192.168.1.67/live/ch00_0",
        "type": "onvif",
        "has_ptz": True,
        "stream_quality": "sub",
        "motion_detection": True,
        "filter": "normal",
        "enabled": True
    },
    {
        "id": "cam-4",
        "name": "CAM 04 - Mikrotik (192.168.50.69)",
        "ip": "192.168.50.69",
        "mac": "00:55:7b:a0:8f:b2",
        "onvif_port": 8899,
        "rtsp_url": "rtsp://192.168.50.69/live/ch00_1",
        "rtsp_hd_url": "rtsp://192.168.50.69/live/ch00_0",
        "type": "onvif",
        "has_ptz": True,
        "stream_quality": "sub",
        "motion_detection": True,
        "filter": "normal",
        "enabled": True
    }
]

class CameraWorker:
    def __init__(self, cam_data):
        self.data = cam_data
        self.cam_id = cam_data["id"]
        self.lock = threading.Lock()
        self.running = True
        self.connected = False
        self.last_frame = None
        self.fps = 0.0
        self.frame_count = 0
        self.last_fps_time = time.time()
        self.resolution = "0x0"
        
        # Motion detection state
        self.motion_detected = False
        self.last_motion_time = 0
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=36, detectShadows=False)
        self.motion_contours = []
        self.last_event_save_time = 0

        # Recording state
        self.is_recording = False
        self.video_writer = None
        self.recording_filename = None
        self.recording_start_time = None

        # PTZ Controller
        if self.data.get("has_ptz") and self.data.get("ip"):
            self.ptz = PTZController(self.data["ip"], self.data.get("onvif_port", 8899))
        else:
            self.ptz = None

        # AI Face Detection & Auto-Zoom State (2-second Smart Punch-In Zoom)
        self.is_zoomed = False
        self.zoom_start_time = 0
        self.last_zoom_end_time = 0
        self.zoom_target = None
        self.last_face_score = 0.0
        self.recognized_person = None  # (name, role, conf, is_known)
        self.face_detector = None
        if os.path.exists(YUNET_MODEL) and hasattr(cv2, 'FaceDetectorYN'):
            try:
                self.face_detector = cv2.FaceDetectorYN.create(
                    YUNET_MODEL, "", (320, 180), score_threshold=0.20
                )
            except Exception:
                self.face_detector = None

        # Timeshift DVR Ring Buffer (up to 300 seconds / 5 minutes instant rewind at 4 fps)
        self.dvr_buffer = deque(maxlen=1200)
        self.last_dvr_sample_time = 0

        # Network Health & Ping Latency Tracking
        self.ping_ms = None
        self.last_ping_time = 0

        # Pre-encoded JPEG cache for zero-lag streaming
        self.cached_jpeg = None

        # Start background ingestion thread
        self.thread = threading.Thread(target=self._run_stream, daemon=True)
        self.thread.start()

    def update_config(self, new_data):
        with self.lock:
            old_url = self.get_active_rtsp_url()
            self.data.update(new_data)
            if self.data.get("has_ptz") and self.data.get("ip") and not self.ptz:
                self.ptz = PTZController(self.data["ip"], self.data.get("onvif_port", 8899))
            new_url = self.get_active_rtsp_url()
            if old_url != new_url and self.data.get("type") != "simulated":
                self.connected = False # trigger reconnect in worker loop

    def get_active_rtsp_url(self):
        quality = self.data.get("stream_quality", "sub")
        if quality == "hd" and self.data.get("rtsp_hd_url"):
            return self.data["rtsp_hd_url"]
        return self.data.get("rtsp_url") or self.data.get("rtsp_hd_url", "")

    def _run_stream(self):
        while self.running:
            if not self.data.get("enabled", True):
                time.sleep(1.0)
                continue

            if self.data.get("type") == "simulated":
                self._run_simulated_stream()
                continue

            rtsp_url = self.get_active_rtsp_url()
            if not rtsp_url:
                time.sleep(1.0)
                continue

            # Open RTSP stream with low-latency settings
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|max_delay;500000"
            cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            if not cap.isOpened():
                self.connected = False
                time.sleep(2.0)
                continue

            self.connected = True
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 360)
            self.resolution = f"{width}x{height}"

            fail_count = 0
            while self.running and self.data.get("enabled", True):
                # Verify if RTSP URL changed
                if self.get_active_rtsp_url() != rtsp_url:
                    break

                ret, frame = cap.read()
                if not ret or frame is None:
                    fail_count += 1
                    if fail_count > 15:
                        self.connected = False
                        break
                    time.sleep(0.04)
                    continue

                fail_count = 0
                self._process_frame(frame)

            cap.release()
            self.connected = False
            time.sleep(1.0)

    def _run_simulated_stream(self):
        """Generates a high-tech synthetic CCTV radar & surveillance feed."""
        self.connected = True
        self.resolution = "640x360"
        angle = 0
        w, h = 640, 360
        center = (w // 2, h // 2)

        while self.running and self.data.get("type") == "simulated":
            if not self.data.get("enabled", True):
                time.sleep(1.0)
                continue

            frame = np.zeros((h, w, 3), dtype=np.uint8)
            frame[:, :] = (14, 20, 27) # Dark cyber slate

            # Draw radar grid circles
            for r in [50, 100, 140]:
                cv2.circle(frame, center, r, (30, 60, 45), 1)

            # Draw crosshairs
            cv2.line(frame, (center[0] - 160, center[1]), (center[0] + 160, center[1]), (25, 55, 40), 1)
            cv2.line(frame, (center[0], center[1] - 150), (center[0], center[1] + 150), (25, 55, 40), 1)

            # Draw sweeping beam
            angle = (angle + 4) % 360
            rad = math.radians(angle)
            end_x = int(center[0] + 140 * math.cos(rad))
            end_y = int(center[1] + 140 * math.sin(rad))
            cv2.line(frame, center, (end_x, end_y), (0, 240, 120), 2)

            # Draw simulated moving targets
            t1_x = int(center[0] + 80 * math.cos(rad * 0.4))
            t1_y = int(center[1] + 60 * math.sin(rad * 0.4))
            cv2.circle(frame, (t1_x, t1_y), 5, (0, 255, 255), -1)
            cv2.putText(frame, "TARGET-A", (t1_x + 8, t1_y + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)

            # Scanlines effect
            frame[::6, :] = (frame[::6, :] * 0.8).astype(np.uint8)

            # Simulated motion trigger occasionally
            if 40 < angle < 80:
                self.motion_detected = True
                self.last_motion_time = time.time()
                cv2.rectangle(frame, (t1_x - 12, t1_y - 12), (t1_x + 40, t1_y + 12), (0, 0, 255), 1)
            elif time.time() - self.last_motion_time > 2.0:
                self.motion_detected = False

            self._process_frame(frame, is_synthetic=True)
            time.sleep(0.04) # ~25 FPS

    def _process_frame(self, frame, is_synthetic=False):
        now = time.time()

        # Calculate FPS
        self.frame_count += 1
        if now - self.last_fps_time >= 1.0:
            self.fps = round(self.frame_count / (now - self.last_fps_time), 1)
            self.frame_count = 0
            self.last_fps_time = now

        ai_enabled = settings_mgr.get("ai_detection_enabled", True)
        tripwire_enabled = settings_mgr.get("virtual_tripwire_enabled", True)
        wire_y = int(frame.shape[0] * 0.72)
        any_tripwire_breach = False
        dominant_event = "MOTION"
        detected_objects = []

        # 1. Apply Privacy Masks if configured (Masks out sensitive areas before any processing/streaming)
        masks = self.data.get("privacy_masks", [])
        if masks and not is_synthetic:
            for mask in masks:
                try:
                    mx = int(mask.get("x", 0))
                    my = int(mask.get("y", 0))
                    mw = int(mask.get("w", 0))
                    mh = int(mask.get("h", 0))
                    mtype = mask.get("type", "black")
                    if mw > 0 and mh > 0:
                        mx2 = min(frame.shape[1], mx + mw)
                        my2 = min(frame.shape[0], my + mh)
                        if mtype == "blur":
                            sub = frame[my:my2, mx:mx2]
                            if sub.size > 0:
                                frame[my:my2, mx:mx2] = cv2.GaussianBlur(sub, (25, 25), 0)
                        else:
                            cv2.rectangle(frame, (mx, my), (mx2, my2), (18, 18, 18), -1)
                            cv2.putText(frame, "PRIVACY MASK", (mx + 4, min(frame.shape[0] - 6, my + 16)),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (120, 120, 120), 1, cv2.LINE_AA)
                except Exception:
                    pass

        # Perform Motion & AI Detection if enabled
        if self.data.get("motion_detection", True) and not is_synthetic:
            # Resize for fast motion processing
            small = cv2.resize(frame, (320, 180))
            scale_x = frame.shape[1] / 320.0
            scale_y = frame.shape[0] / 180.0
            fgmask = self.bg_subtractor.apply(small)
            _, thresh = cv2.threshold(fgmask, 200, 255, cv2.THRESH_BINARY)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            # Filter contours by area and take only top 4 largest objects to prevent CPU choke on foliage
            valid_contours = []
            motion_found = False
            for c in contours:
                area = cv2.contourArea(c)
                if area > 450:
                    valid_contours.append((area, c))

            if valid_contours:
                motion_found = True
                valid_contours.sort(key=lambda x: x[0], reverse=True)
                for area, c in valid_contours[:4]:
                    rx, ry, rw, rh = cv2.boundingRect(c)
                    x = int(rx * scale_x)
                    y = int(ry * scale_y)
                    w = int(rw * scale_x)
                    h = int(rh * scale_y)

                    ar = float(h) / max(1.0, float(w))
                    obj_area = w * h

                    label = "MOTION"
                    conf = 70
                    color = (0, 200, 255) # Sleek Amber/Cyan

                    # AI Object Classification (Calibrated for high-angle CCTV cameras)
                    if ai_enabled:
                        if (0.75 <= ar <= 3.6 and h >= 45) or (ar > 1.20 and h >= 35):
                            label = "PERSON"
                            conf = min(96, int(82 + min(14, (ar - 0.75) * 5)))
                            color = (0, 230, 140) # Emerald Green (soothing & clear)
                        elif ar <= 0.75 and obj_area > 12000 and w >= 110:
                            label = "VEHICLE"
                            conf = 88
                            color = (0, 210, 255) # Cyan
                        else:
                            label = "MOTION"
                            conf = 74
                            color = (0, 200, 255) # Sleek Amber/Cyan

                    # Virtual Tripwire Check
                    if tripwire_enabled and (y <= wire_y <= (y + h)):
                        label = "TRIPWIRE BREACH"
                        color = (0, 0, 255)
                        any_tripwire_breach = True
                        dominant_event = "TRIPWIRE BREACH"

                    if dominant_event != "TRIPWIRE BREACH":
                        if label == "PERSON":
                            dominant_event = "PERSON"
                        elif label == "VEHICLE" and dominant_event != "PERSON":
                            dominant_event = "VEHICLE"

                    detected_objects.append((x, y, w, h, label, conf, color))

            if motion_found:
                self.motion_detected = True
                self.last_motion_time = now
                self.motion_contours = detected_objects
                # Auto record motion event snapshot asynchronously (zero thread blocking)
                if now - self.last_event_save_time > 10.0:
                    self.last_event_save_time = now
                    f_snap = frame.copy()
                    threading.Thread(target=self._async_event_save, args=(f_snap, dominant_event), daemon=True).start()
            elif now - self.last_motion_time > 3.0:
                self.motion_detected = False
                self.motion_contours = []

        # AI Face Auto-Zoom Evaluation
        face_zoom_enabled = settings_mgr.get("face_auto_zoom_enabled", True)
        zoom_duration = float(settings_mgr.get("face_zoom_duration", 2.0))
        zoom_cooldown = float(settings_mgr.get("face_zoom_cooldown", 4.0))
        raw_thresh = settings_mgr.get("face_zoom_threshold", 50)
        try:
            zoom_threshold = float(raw_thresh) / 100.0 if float(raw_thresh) > 1.0 else float(raw_thresh)
        except Exception:
            zoom_threshold = 0.50

        # 1. If currently in zoom mode:
        if face_zoom_enabled and self.is_zoomed:
            if now - self.zoom_start_time < zoom_duration and self.zoom_target:
                zx1, zy1, zw, zh = self.zoom_target
                cropped = frame[zy1:zy1+zh, zx1:zx1+zw]
                processed_frame = cv2.resize(cropped, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_LINEAR)

                # Draw high-tech HUD Target Lock Overlay with recognition & countdown
                rem = max(0.0, zoom_duration - (now - self.zoom_start_time))
                rec = self.recognized_person
                if rec and rec[3]: # Known Person!
                    hud_label = f" AI RECOGNIZED: {rec[0].upper()} ({rec[1]}) [{rem:.1f}s] "
                    box_bg = (0, 200, 100) # Emerald
                elif rec and not rec[3]:
                    hud_label = f" AI: UNKNOWN / ASING [{rem:.1f}s] (Conf: {int(self.last_face_score * 100)}%) "
                    box_bg = (0, 140, 255) # Amber
                else:
                    hud_label = f" AI FACE AUTO-ZOOM [{rem:.1f}s] (Conf: {int(self.last_face_score * 100)}%) "
                    box_bg = (0, 240, 255) # Cyan

                (htw, hth), _ = cv2.getTextSize(hud_label, cv2.FONT_HERSHEY_DUPLEX, 0.4, 1)
                cv2.rectangle(processed_frame, (12, 34), (12 + htw + 6, 34 + hth + 8), box_bg, -1)
                cv2.putText(processed_frame, hud_label, (15, 34 + hth + 3), cv2.FONT_HERSHEY_DUPLEX, 0.4, (0, 0, 0), 1, cv2.LINE_AA)

                # Targeting crosshair in center
                cx = frame.shape[1] // 2
                cy = frame.shape[0] // 2
                cv2.circle(processed_frame, (cx, cy), 32, box_bg, 1, cv2.LINE_AA)
                cv2.line(processed_frame, (cx - 45, cy), (cx - 15, cy), box_bg, 2, cv2.LINE_AA)
                cv2.line(processed_frame, (cx + 15, cy), (cx + 45, cy), box_bg, 2, cv2.LINE_AA)
                cv2.line(processed_frame, (cx, cy - 45), (cx, cy - 15), box_bg, 2, cv2.LINE_AA)
                cv2.line(processed_frame, (cx, cy + 15), (cx, cy + 45), box_bg, 2, cv2.LINE_AA)
            else:
                # Zoom expired -> smoothly return to normal full-frame view
                self.is_zoomed = False
                self.last_zoom_end_time = now
                self.zoom_target = None
                self.recognized_person = None
                processed_frame = frame.copy()
        else:
            processed_frame = frame.copy()

        # 2. If not zoomed, check if face detected >= custom accuracy threshold to trigger zoom & recognition
        # Throttled to every 4th frame (saves 75% CPU and prevents video stutter/lag)
        if face_zoom_enabled and not self.is_zoomed and (now - self.last_zoom_end_time > zoom_cooldown) and not is_synthetic and self.face_detector is not None and (self.frame_count % 4 == 0):
            try:
                small_face = cv2.resize(frame, (320, 180))
                s_scale_x = frame.shape[1] / 320.0
                s_scale_y = frame.shape[0] / 180.0
                res = self.face_detector.detect(small_face)
                if res[1] is not None and len(res[1]) > 0:
                    faces = res[1]
                    best_face = max(faces, key=lambda f: f[-1])
                    score = float(best_face[-1])
                    if score >= zoom_threshold: # User-configured accuracy threshold
                        fx = int(best_face[0] * s_scale_x)
                        fy = int(best_face[1] * s_scale_y)
                        fw = int(best_face[2] * s_scale_x)
                        fh = int(best_face[3] * s_scale_y)

                        orig_h, orig_w = frame.shape[:2]

                        # Crop face for biometric recognition
                        fc_x1 = max(0, fx)
                        fc_y1 = max(0, fy)
                        fc_x2 = min(orig_w, fx + fw)
                        fc_y2 = min(orig_h, fy + fh)
                        face_crop = frame[fc_y1:fc_y2, fc_x1:fc_x2]

                        # Match with FaceRecognitionManager
                        p_name, p_role, p_conf, p_known = face_recognition_mgr.match_face(face_crop)
                        self.recognized_person = (p_name, p_role, p_conf, p_known)

                        # If unknown person and system is armed, notify Telegram asynchronously
                        if not p_known and settings_mgr.is_armed() and settings_mgr.get("telegram_unknown_faces", True):
                            f_alert = frame.copy()
                            def _async_face_alert():
                                try:
                                    ret, buf = cv2.imencode('.jpg', f_alert, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
                                    if ret:
                                        settings_mgr.send_telegram_alert(
                                            self.cam_id, 
                                            self.data.get("name", "Camera"), 
                                            "UNKNOWN FACE / WAJAH ASING", 
                                            buf.tobytes()
                                        )
                                except Exception:
                                    pass
                            threading.Thread(target=_async_face_alert, daemon=True).start()

                        crop_w = int(orig_w / 2.0)
                        crop_h = int(orig_h / 2.0)
                        fcx = fx + fw // 2
                        fcy = fy + fh // 2
                        zx1 = max(0, min(orig_w - crop_w, fcx - crop_w // 2))
                        zy1 = max(0, min(orig_h - crop_h, fcy - crop_h // 2))

                        self.zoom_target = (zx1, zy1, crop_w, crop_h)
                        self.is_zoomed = True
                        self.zoom_start_time = now
                        self.last_face_score = score

                        # Crop and zoom this initial frame immediately
                        cropped = frame[zy1:zy1+crop_h, zx1:zx1+crop_w]
                        processed_frame = cv2.resize(cropped, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
            except Exception:
                pass

        # Apply Visual Filter if configured
        filter_mode = self.data.get("filter", "normal")

        if filter_mode == "night":
            # High-gain green night-vision
            gray = cv2.cvtColor(processed_frame, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
            enhanced = clahe.apply(gray)
            processed_frame = np.zeros_like(frame)
            processed_frame[:, :, 1] = enhanced # green channel
            processed_frame[:, :, 0] = (enhanced * 0.2).astype(np.uint8)
        elif filter_mode == "thermal":
            # False color thermal map
            gray = cv2.cvtColor(processed_frame, cv2.COLOR_BGR2GRAY)
            processed_frame = cv2.applyColorMap(gray, cv2.COLORMAP_INFERNO)
        elif filter_mode == "bw":
            gray = cv2.cvtColor(processed_frame, cv2.COLOR_BGR2GRAY)
            processed_frame = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

        # Draw Virtual Tripwire Laser Line
        if tripwire_enabled and not is_synthetic:
            laser_color = (0, 0, 255) if any_tripwire_breach else (0, 240, 255)
            cv2.line(processed_frame, (0, wire_y), (processed_frame.shape[1], wire_y), laser_color, 1, cv2.LINE_AA)
            tripwire_text = "!! TRIPWIRE BREACH !!" if any_tripwire_breach else "LASER TRIPWIRE ACTIVE"
            cv2.putText(processed_frame, tripwire_text, (processed_frame.shape[1] - 180, wire_y - 6),
                        cv2.FONT_HERSHEY_DUPLEX, 0.35, laser_color, 1, cv2.LINE_AA)

        # Draw Sleek, Non-Obtrusive Corner Reticles if enabled
        show_boxes = settings_mgr.get("show_bounding_boxes", True)
        if show_boxes and self.motion_detected and self.motion_contours and not is_synthetic:
            for obj in self.motion_contours:
                if len(obj) == 7:
                    x, y, w, h, label, conf, color = obj
                else:
                    x, y, w, h = obj[:4]
                    label, conf, color = "MOTION", 75, (0, 200, 255)

                # 1. Subtle, elegant 1px corner reticles [ ] (never blocks the subject's body/face)
                c_len = min(14, max(5, w // 5), max(5, h // 5))
                # Top-left corner
                cv2.line(processed_frame, (x, y), (x + c_len, y), color, 1, cv2.LINE_AA)
                cv2.line(processed_frame, (x, y), (x, y + c_len), color, 1, cv2.LINE_AA)
                # Top-right corner
                cv2.line(processed_frame, (x + w, y), (x + w - c_len, y), color, 1, cv2.LINE_AA)
                cv2.line(processed_frame, (x + w, y), (x + w, y + c_len), color, 1, cv2.LINE_AA)
                # Bottom-left corner
                cv2.line(processed_frame, (x, y + h), (x + c_len, y + h), color, 1, cv2.LINE_AA)
                cv2.line(processed_frame, (x, y + h), (x, y + h - c_len), color, 1, cv2.LINE_AA)
                # Bottom-right corner
                cv2.line(processed_frame, (x + w, y + h), (x + w - c_len, y + h), color, 1, cv2.LINE_AA)
                cv2.line(processed_frame, (x + w, y + h), (x + w, y + h - c_len), color, 1, cv2.LINE_AA)

                # 2. Translucent Minimalist Label (Semi-transparent backdrop, highly legible without obscuring video)
                tag = f" {label} {conf}% "
                (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.32, 1)
                
                # Position label above box if space allows; otherwise below box so it NEVER covers head/face
                if y > th + 10:
                    tag_y = y - 4
                    bg_y1 = y - th - 7
                    bg_y2 = y - 1
                else:
                    tag_y = y + h + th + 4
                    bg_y1 = y + h + 2
                    bg_y2 = y + h + th + 8

                bg_x1 = max(0, x)
                bg_x2 = min(processed_frame.shape[1], x + tw + 4)

                if bg_y2 <= processed_frame.shape[0] and bg_y1 >= 0 and bg_x2 > bg_x1:
                    sub_rect = processed_frame[bg_y1:bg_y2, bg_x1:bg_x2]
                    dark_fill = np.zeros_like(sub_rect)
                    cv2.addWeighted(dark_fill, 0.6, sub_rect, 0.4, 0, sub_rect)
                    processed_frame[bg_y1:bg_y2, bg_x1:bg_x2] = sub_rect
                    cv2.putText(processed_frame, tag, (bg_x1 + 2, tag_y), cv2.FONT_HERSHEY_SIMPLEX, 0.32, color, 1, cv2.LINE_AA)

        # Add Sleek Cyber On-Screen Display (OSD) Timestamp
        time_str = datetime.now().strftime("%Y-%m-%d  %H:%M:%S")
        cv2.putText(processed_frame, f"{self.data.get('name', 'CAM')} | {time_str}", 
                    (12, 24), cv2.FONT_HERSHEY_DUPLEX, 0.5, (240, 240, 240), 1, cv2.LINE_AA)
        
        # OSD status badge
        fps_str = f"{self.fps} FPS"
        cv2.putText(processed_frame, fps_str, (processed_frame.shape[1] - 80, 24), 
                    cv2.FONT_HERSHEY_DUPLEX, 0.45, (0, 230, 150), 1, cv2.LINE_AA)

        if self.is_recording:
            # Draw blinking RED record indicator
            if int(now * 2) % 2 == 0:
                cv2.circle(processed_frame, (processed_frame.shape[1] - 100, 20), 6, (0, 0, 255), -1)
                cv2.putText(processed_frame, "REC", (processed_frame.shape[1] - 135, 24), 
                            cv2.FONT_HERSHEY_DUPLEX, 0.45, (0, 0, 255), 1, cv2.LINE_AA)
            if self.video_writer:
                try:
                    self.video_writer.write(processed_frame)
                except Exception:
                    pass

        # Single-pass JPEG encoding (shared by all HTTP streams and DVR buffer, saves 60% CPU)
        ret_cache, buf_cache = cv2.imencode('.jpg', processed_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        jpeg_bytes = buf_cache.tobytes() if ret_cache else None

        with self.lock:
            self.last_frame = processed_frame
            if jpeg_bytes:
                self.cached_jpeg = jpeg_bytes

        # Save to Timeshift DVR Ring Buffer every 0.25s (~4 FPS, high-smoothness timeshift)
        if now - self.last_dvr_sample_time >= 0.25:
            self.last_dvr_sample_time = now
            if jpeg_bytes:
                with self.lock:
                    self.dvr_buffer.append((now, jpeg_bytes))

    def get_dvr_frame(self, seconds_back):
        """Retrieve historical frame from DVR ring buffer at seconds_back offset."""
        with self.lock:
            if not self.dvr_buffer:
                return self.get_jpeg_frame()
            now = time.time()
            target_ts = now - max(0.0, float(seconds_back))
            best_data = None
            min_diff = float("inf")
            for ts, data in self.dvr_buffer:
                diff = abs(ts - target_ts)
                if diff < min_diff:
                    min_diff = diff
                    best_data = data
            return best_data if best_data else self.get_jpeg_frame()

    def get_dvr_buffer_range(self):
        """Return maximum available history in seconds currently stored in memory."""
        with self.lock:
            if not self.dvr_buffer:
                return 0.0
            now = time.time()
            oldest_ts = self.dvr_buffer[0][0]
            return max(1.0, round(now - oldest_ts, 1))

    def _async_event_save(self, frame_to_save, dominant_event):
        """Asynchronously writes event snapshot to disk and sends Telegram alert without blocking video ingestion."""
        try:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            fn = f"event_{self.cam_id}_{ts}.jpg"
            filepath = os.path.join(EVENT_DIR, fn)
            cv2.imwrite(filepath, frame_to_save, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if settings_mgr.get("telegram_enabled", False):
                ret, buf = cv2.imencode('.jpg', frame_to_save, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
                if ret:
                    settings_mgr.send_telegram_alert(
                        self.cam_id, 
                        self.data.get("name", "Camera"), 
                        dominant_event, 
                        buf.tobytes()
                    )
        except Exception as e:
            print(f"[AsyncEventSave] Error: {e}")

    def get_jpeg_frame(self):
        """Instant zero-latency JPEG delivery using pre-encoded worker cache."""
        with self.lock:
            if self.cached_jpeg is not None:
                return self.cached_jpeg
            if self.last_frame is not None:
                ret, buffer = cv2.imencode('.jpg', self.last_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                if ret:
                    self.cached_jpeg = buffer.tobytes()
                    return self.cached_jpeg
        
        # If no frame yet, return fallback image
        blank = np.zeros((360, 640, 3), dtype=np.uint8)
        blank[:, :] = (20, 20, 25)
        text = f"{self.data.get('name', 'Camera')} - Connecting..." if self.data.get('enabled', True) else "Camera Disabled"
        cv2.putText(blank, text, (150, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (120, 120, 120), 1)
        ret, buffer = cv2.imencode('.jpg', blank)
        return buffer.tobytes()

    def snapshot(self):
        with self.lock:
            if self.last_frame is not None:
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"snap_{self.cam_id}_{ts}.jpg"
                filepath = os.path.join(SNAPSHOT_DIR, filename)
                cv2.imwrite(filepath, self.last_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
                return {"success": True, "url": f"/static/snapshots/{filename}", "filename": filename}
        return {"success": False, "error": "No frame available to snapshot"}

    def start_recording(self):
        with self.lock:
            if self.is_recording:
                return {"success": True, "filename": self.recording_filename}
            if self.last_frame is None:
                return {"success": False, "error": "No frame available to record"}

            h, w = self.last_frame.shape[:2]
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            self.recording_filename = f"rec_{self.cam_id}_{ts}.avi"
            filepath = os.path.join(RECORDING_DIR, self.recording_filename)
            fourcc = cv2.VideoWriter_fourcc(*'MJPG')
            self.video_writer = cv2.VideoWriter(filepath, fourcc, 20.0, (w, h))
            self.is_recording = True
            self.recording_start_time = time.time()
            return {"success": True, "filename": self.recording_filename}

    def stop_recording(self):
        with self.lock:
            if not self.is_recording:
                return {"success": False, "error": "Not recording"}
            self.is_recording = False
            if self.video_writer:
                try:
                    self.video_writer.release()
                except Exception:
                    pass
                self.video_writer = None
            fn = self.recording_filename
            return {"success": True, "filename": fn, "url": f"/static/recordings/{fn}"}

    def measure_ping(self):
        now = time.time()
        if now - self.last_ping_time < 3.0:
            return self.ping_ms
        self.last_ping_time = now
        ip = self.data.get("ip")
        if not ip:
            return None
        port = int(self.data.get("onvif_port") or 8899)
        try:
            t0 = time.perf_counter()
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.5)
            s.connect((ip, port))
            s.close()
            t1 = time.perf_counter()
            self.ping_ms = round((t1 - t0) * 1000, 1)
        except Exception:
            try:
                t0 = time.perf_counter()
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(0.5)
                s.connect((ip, 554))
                s.close()
                t1 = time.perf_counter()
                self.ping_ms = round((t1 - t0) * 1000, 1)
            except Exception:
                self.ping_ms = None
        return self.ping_ms

    def get_status(self):
        return {
            "id": self.cam_id,
            "name": self.data.get("name"),
            "ip": self.data.get("ip"),
            "type": self.data.get("type", "onvif"),
            "connected": self.connected,
            "enabled": self.data.get("enabled", True),
            "fps": self.fps,
            "resolution": self.resolution,
            "motion": self.motion_detected,
            "is_recording": self.is_recording,
            "has_ptz": self.data.get("has_ptz", False),
            "stream_quality": self.data.get("stream_quality", "sub"),
            "filter": self.data.get("filter", "normal"),
            "ping_ms": self.measure_ping()
        }

    def stop(self):
        self.running = False
        if self.video_writer:
            self.video_writer.release()


class CameraManager:
    def __init__(self):
        self.workers = {}
        self.cameras = self.load_config()
        self._init_workers()
        self.heal_thread = threading.Thread(target=self._auto_heal_daemon, daemon=True)
        self.heal_thread.start()

    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        self.save_config(DEFAULT_CAMERAS)
        return DEFAULT_CAMERAS

    def save_config(self, cams=None):
        if cams is not None:
            self.cameras = cams
        with open(CONFIG_FILE, "w") as f:
            json.dump(self.cameras, f, indent=2)

    def _init_workers(self):
        for cam in self.cameras:
            self.workers[cam["id"]] = CameraWorker(cam)

    def get_camera_list(self):
        res = []
        for cam in self.cameras:
            cid = cam["id"]
            worker = self.workers.get(cid)
            status = worker.get_status() if worker else {
                "id": cid, "name": cam.get("name"), "connected": False, "motion": False
            }
            combined = {**cam, **status}
            res.append(combined)
        return res

    def get_worker(self, cam_id):
        return self.workers.get(cam_id)

    def add_camera(self, cam_data):
        cid = f"cam-{int(time.time() * 1000) % 100000}"
        cam_data["id"] = cid
        if "type" not in cam_data:
            cam_data["type"] = "onvif"
        if "stream_quality" not in cam_data:
            cam_data["stream_quality"] = "sub"
        if "enabled" not in cam_data:
            cam_data["enabled"] = True

        self.cameras.append(cam_data)
        self.save_config()
        self.workers[cid] = CameraWorker(cam_data)
        return cam_data

    def update_camera(self, cam_id, updates):
        for cam in self.cameras:
            if cam["id"] == cam_id:
                cam.update(updates)
                self.save_config()
                if cam_id in self.workers:
                    self.workers[cam_id].update_config(cam)
                return cam
        return None

    def delete_camera(self, cam_id):
        self.cameras = [c for c in self.cameras if c["id"] != cam_id]
        self.save_config()
        if cam_id in self.workers:
            self.workers[cam_id].stop()
            del self.workers[cam_id]
        return True

    def get_gallery_items(self):
        items = []
        # Snapshots
        if os.path.exists(SNAPSHOT_DIR):
            for fn in sorted(os.listdir(SNAPSHOT_DIR), reverse=True):
                if fn.endswith((".jpg", ".jpeg", ".png")):
                    fp = os.path.join(SNAPSHOT_DIR, fn)
                    items.append({
                        "type": "snapshot",
                        "filename": fn,
                        "url": f"/static/snapshots/{fn}",
                        "size": os.path.getsize(fp),
                        "timestamp": os.path.getmtime(fp)
                    })
        # Recordings
        if os.path.exists(RECORDING_DIR):
            for fn in sorted(os.listdir(RECORDING_DIR), reverse=True):
                if fn.endswith((".mp4", ".avi", ".mkv")):
                    fp = os.path.join(RECORDING_DIR, fn)
                    items.append({
                        "type": "recording",
                        "filename": fn,
                        "url": f"/static/recordings/{fn}",
                        "size": os.path.getsize(fp),
                        "timestamp": os.path.getmtime(fp)
                    })
        # Motion events
        if os.path.exists(EVENT_DIR):
            for fn in sorted(os.listdir(EVENT_DIR), reverse=True):
                if fn.endswith((".jpg", ".jpeg")):
                    fp = os.path.join(EVENT_DIR, fn)
                    items.append({
                        "type": "event",
                        "filename": fn,
                        "url": f"/static/events/{fn}",
                        "size": os.path.getsize(fp),
                        "timestamp": os.path.getmtime(fp)
                    })
        return sorted(items, key=lambda x: x["timestamp"], reverse=True)

    def get_storage_stats(self):
        try:
            total, used, free = shutil.disk_usage(BASE_DIR)
            total_gb = round(total / (1024 ** 3), 2)
            used_gb = round(used / (1024 ** 3), 2)
            free_gb = round(free / (1024 ** 3), 2)
            used_pct = round((used / total) * 100, 1)
        except Exception:
            total_gb, used_gb, free_gb, used_pct = 0, 0, 0, 0

        def dir_size(path):
            total_b = 0
            count = 0
            if os.path.exists(path):
                for f in os.scandir(path):
                    if f.is_file():
                        total_b += f.stat().st_size
                        count += 1
            return round(total_b / (1024 ** 2), 2), count # MB, count

        snap_mb, snap_count = dir_size(SNAPSHOT_DIR)
        rec_mb, rec_count = dir_size(RECORDING_DIR)
        event_mb, event_count = dir_size(EVENT_DIR)

        return {
            "total_gb": total_gb,
            "used_gb": used_gb,
            "free_gb": free_gb,
            "used_percent": used_pct,
            "retention_days": settings_mgr.get("storage_retention_days", 14),
            "max_percent": settings_mgr.get("storage_max_percent", 90),
            "snapshots": {"size_mb": snap_mb, "count": snap_count},
            "recordings": {"size_mb": rec_mb, "count": rec_count},
            "events": {"size_mb": event_mb, "count": event_count}
        }

    def cleanup_old_files(self):
        """FIFO auto-purge based on retention days and max disk usage percentage."""
        retention_days = settings_mgr.get("storage_retention_days", 14)
        max_pct = settings_mgr.get("storage_max_percent", 90)
        cutoff_time = time.time() - (retention_days * 86400)
        purged = 0

        all_files = []
        for target_dir in [RECORDING_DIR, EVENT_DIR, SNAPSHOT_DIR]:
            if not os.path.exists(target_dir):
                continue
            for fname in os.listdir(target_dir):
                fp = os.path.join(target_dir, fname)
                if os.path.isfile(fp):
                    mtime = os.path.getmtime(fp)
                    if mtime < cutoff_time:
                        try:
                            os.remove(fp)
                            purged += 1
                        except Exception:
                            pass
                    else:
                        all_files.append((fp, mtime, os.path.getsize(fp)))

        # Check disk capacity threshold
        try:
            total, used, free = shutil.disk_usage(BASE_DIR)
            cur_pct = (used / total) * 100
            if cur_pct > max_pct:
                # FIFO purge oldest files first
                all_files.sort(key=lambda x: x[1])
                for fp, mtime, sz in all_files:
                    try:
                        os.remove(fp)
                        purged += 1
                    except Exception:
                        pass
                    # Recheck disk usage
                    t, u, f = shutil.disk_usage(BASE_DIR)
                    if (u / t) * 100 <= (max_pct - 3):
                        break
        except Exception:
            pass

        return purged

    def _auto_heal_daemon(self):
        """Monitors cameras and automatically detects IP changes via DHCP."""
        cleanup_counter = 0
        while True:
            time.sleep(25)
            try:
                # Periodic FIFO storage cleanup (every ~10 minutes)
                cleanup_counter += 1
                if cleanup_counter >= 24:
                    cleanup_counter = 0
                    self.cleanup_old_files()

                # If any camera is disconnected, trigger auto heal
                disconnected = [c for c in self.cameras if not self.workers.get(c["id"]) or not self.workers[c["id"]].connected]
                if disconnected:
                    self.auto_heal_dhcp_ips()
            except Exception:
                pass

    def auto_heal_dhcp_ips(self):
        """
        Scans network for any camera whose IP has changed via DHCP.
        Matches by hardware MAC address embedded in ONVIF WS-Discovery URN UUID.
        """
        healed = []
        from onvif_scanner import scan_network_onvif, get_onvif_uuid_mac

        targets = [c for c in self.cameras if c.get("mac") and (not self.workers.get(c["id"]) or not self.workers[c["id"]].connected)]
        if not targets:
            return {"status": "all_connected", "healed": []}

        discovered_all = []
        for prefix in ["192.168.1.", "192.168.50."]:
            try:
                devs = scan_network_onvif(subnet_prefix=prefix, start_range=1, end_range=120)
                discovered_all.extend(devs)
            except Exception:
                pass

        for dev in discovered_all:
            dev_ip = dev.get("ip")
            dev_mac = dev.get("mac") or get_onvif_uuid_mac(dev_ip)
            if not dev_mac:
                continue

            for target in targets:
                target_mac = target.get("mac", "").lower()
                if target_mac and target_mac == dev_mac.lower():
                    old_ip = target.get("ip")
                    if old_ip != dev_ip:
                        print(f"[DHCP AUTO-HEAL] Re-attaching {target['name']}: {old_ip} -> {dev_ip}")
                        updates = {
                            "ip": dev_ip,
                            "rtsp_url": dev.get("rtsp_sub") or f"rtsp://{dev_ip}/live/ch00_1",
                            "rtsp_hd_url": dev.get("rtsp_main") or f"rtsp://{dev_ip}/live/ch00_0"
                        }
                        self.update_camera(target["id"], updates)
                        healed.append({"id": target["id"], "name": target["name"], "old_ip": old_ip, "new_ip": dev_ip})

        return {"status": "success", "healed": healed}

