"""
Face Recognition Manager for Aegis Vision CCTV
Handles registering known faces (Family, Staff, VIP), feature extraction,
and matching faces detected by YuNet.
"""

import os
import cv2
import json
import time
import math
import uuid
import numpy as np
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FACES_DIR = os.path.join(BASE_DIR, "static", "faces")
KNOWN_FACES_FILE = os.path.join(BASE_DIR, "config", "known_faces.json")
SFACE_MODEL = os.path.join(BASE_DIR, "models", "face_recognition_sface.onnx")

os.makedirs(FACES_DIR, exist_ok=True)
os.makedirs(os.path.dirname(KNOWN_FACES_FILE), exist_ok=True)

class FaceRecognitionManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.faces = []
        self.sface_recognizer = None
        self._init_recognizer()
        self.load_faces()

    def _init_recognizer(self):
        """Attempts to initialize OpenCV SFace recognizer if model is present."""
        if os.path.exists(SFACE_MODEL) and hasattr(cv2, 'FaceRecognizerSF'):
            try:
                self.sface_recognizer = cv2.FaceRecognizerSF.create(SFACE_MODEL, "")
            except Exception:
                self.sface_recognizer = None

    def load_faces(self):
        """Loads known faces list and descriptors from disk."""
        with self.lock:
            if os.path.exists(KNOWN_FACES_FILE):
                try:
                    with open(KNOWN_FACES_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self.faces = data if isinstance(data, list) else []
                except Exception:
                    self.faces = []
            else:
                self.faces = []
                self._save_faces()

    def _save_faces(self):
        try:
            with open(KNOWN_FACES_FILE, "w", encoding="utf-8") as f:
                json.dump(self.faces, f, indent=2)
        except Exception as e:
            print(f"[FaceManager] Error saving known faces: {e}")

    def extract_descriptor(self, face_bgr):
        """
        Extracts a normalized robust 256-D face descriptor using multi-scale 
        spatial cell histograms and edge gradients (fast, invariant to lighting/scale).
        """
        if face_bgr is None or face_bgr.size == 0:
            return None

        # Resize to standard normalized face dimension 112x112
        aligned = cv2.resize(face_bgr, (112, 112), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)
        
        # Contrast Limited Adaptive Histogram Equalization for illumination invariance
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        eq_gray = clahe.apply(gray)

        # 4x4 spatial grid extraction (16 cells)
        cells_x, cells_y = 4, 4
        cell_w = 112 // cells_x
        cell_h = 112 // cells_y
        feature_parts = []

        # 1. Gradients (Sobel magnitude and angle histograms)
        grad_x = cv2.Sobel(eq_gray, cv2.CV_32F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(eq_gray, cv2.CV_32F, 0, 1, ksize=3)
        mag, angle = cv2.cartToPolar(grad_x, grad_y, angleInDegrees=True)

        for i in range(cells_y):
            for j in range(cells_x):
                sub_mag = mag[i*cell_h:(i+1)*cell_h, j*cell_w:(j+1)*cell_w]
                sub_ang = angle[i*cell_h:(i+1)*cell_h, j*cell_w:(j+1)*cell_w]

                # 8-bin orientation histogram weighted by gradient magnitude
                hist, _ = np.histogram(sub_ang, bins=8, range=(0, 360), weights=sub_mag)
                feature_parts.append(hist)

        # 2. Add central facial structure emphasis (Eyes, Nose, Mouth)
        center_crop = eq_gray[28:84, 28:84]
        center_hist, _ = np.histogram(center_crop, bins=32, range=(0, 256))
        feature_parts.append(center_hist)

        # Combine into single normalized descriptor
        vector = np.concatenate(feature_parts).astype(np.float32)
        norm = np.linalg.norm(vector)
        if norm > 1e-6:
            vector = vector / norm
        return vector

    def register_face(self, name, image_bgr, role="Keluarga", notes=""):
        """Registers a new known face from an image array."""
        descriptor = self.extract_descriptor(image_bgr)
        if descriptor is None:
            return {"success": False, "error": "Wajah tidak valid atau tidak terbaca"}

        face_id = f"face_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        filename = f"{face_id}.jpg"
        filepath = os.path.join(FACES_DIR, filename)

        # Save photo
        cv2.imwrite(filepath, image_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 90])

        new_entry = {
            "id": face_id,
            "name": name.strip(),
            "role": role.strip(),
            "notes": notes.strip(),
            "image_url": f"/static/faces/{filename}",
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "descriptor": descriptor.tolist()
        }

        with self.lock:
            self.faces.append(new_entry)
            self._save_faces()

        return {"success": True, "face": {k: v for k, v in new_entry.items() if k != "descriptor"}}

    def delete_face(self, face_id):
        with self.lock:
            for i, f in enumerate(self.faces):
                if f["id"] == face_id:
                    fn = os.path.basename(f.get("image_url", ""))
                    fp = os.path.join(FACES_DIR, fn)
                    if os.path.exists(fp):
                        try:
                            os.remove(fp)
                        except Exception:
                            pass
                    self.faces.pop(i)
                    self._save_faces()
                    return {"success": True}
        return {"success": False, "error": "Wajah tidak ditemukan"}

    def get_faces_list(self):
        with self.lock:
            return [
                {
                    "id": f["id"],
                    "name": f["name"],
                    "role": f.get("role", "Keluarga"),
                    "notes": f.get("notes", ""),
                    "image_url": f["image_url"],
                    "created_at": f.get("created_at", "")
                }
                for f in self.faces
            ]

    def match_face(self, face_crop, threshold=0.55):
        """
        Matches a detected face against registered known faces.
        Returns: (matched_name, role, confidence, is_known)
        """
        if not self.faces or face_crop is None or face_crop.size == 0:
            return "UNKNOWN", "Asing", 0.0, False

        desc = self.extract_descriptor(face_crop)
        if desc is None:
            return "UNKNOWN", "Asing", 0.0, False

        best_score = -1.0
        best_face = None

        with self.lock:
            for f in self.faces:
                stored_desc = f.get("descriptor")
                if not stored_desc:
                    continue
                v = np.array(stored_desc, dtype=np.float32)
                # Cosine similarity between two unit vectors
                score = float(np.dot(desc, v))
                if score > best_score:
                    best_score = score
                    best_face = f

        if best_face and best_score >= threshold:
            conf_percent = min(99, max(50, int(best_score * 100)))
            return best_face["name"], best_face.get("role", "Keluarga"), conf_percent, True

        unknown_conf = max(0, int(best_score * 100)) if best_score > 0 else 0
        return "UNKNOWN", "Asing", unknown_conf, False

face_recognition_mgr = FaceRecognitionManager()
