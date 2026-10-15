"""
Authentication and Role-Based Access Control (RBAC) Manager for Khanza.NET Vision CCTV
Handles user credentials, password hashing (PBKDF2), permissions per camera, and shareable magic tokens.
"""

import os
import json
import secrets
import hashlib
import threading
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(BASE_DIR, "config", "users.json")

DEFAULT_PERMISSIONS_USER = {
    "can_ptz": False,
    "can_dvr": False,
    "can_snapshot": False,
    "can_record": False,
    "can_audio": True,
    "can_gallery": False,
    "can_settings": False
}

DEFAULT_PERMISSIONS_ADMIN = {
    "can_ptz": True,
    "can_dvr": True,
    "can_snapshot": True,
    "can_record": True,
    "can_audio": True,
    "can_gallery": True,
    "can_settings": True
}

def hash_password(password: str, salt: str = None) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with random salt."""
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return f"{salt}${hashed}"

def verify_password(password: str, stored_hash: str) -> bool:
    """Verify password against stored salt$hash."""
    try:
        salt, _ = stored_hash.split('$', 1)
        expected = hash_password(password, salt)
        return secrets.compare_digest(expected, stored_hash)
    except Exception:
        return False

class AuthManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.users = self.load_users()

    def load_users(self):
        with self.lock:
            if os.path.exists(USERS_FILE):
                try:
                    with open(USERS_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, list) and len(data) > 0:
                            return data
                except Exception as e:
                    print(f"[AuthManager] Error loading users.json: {e}")

            # Generate default Admin account if empty/not exists
            default_admin = {
                "id": "usr_admin",
                "username": "admin",
                "display_name": "Pemilik (Super Admin)",
                "password_hash": hash_password("admin"),
                "role": "admin",
                "allowed_cameras": ["*"],
                "permissions": DEFAULT_PERMISSIONS_ADMIN.copy(),
                "token": "admin_" + secrets.token_urlsafe(16),
                "active": True,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            users = [default_admin]
            self._save_to_disk(users)
            return users

    def _save_to_disk(self, users_data):
        try:
            os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
            with open(USERS_FILE, "w", encoding="utf-8") as f:
                json.dump(users_data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[AuthManager] Error saving users.json: {e}")

    def save(self):
        with self.lock:
            self._save_to_disk(self.users)

    def get_all_users(self, safe=True):
        """Returns list of users. If safe=True, strips password_hash."""
        with self.lock:
            res = []
            for u in self.users:
                uc = u.copy()
                if safe:
                    uc.pop("password_hash", None)
                res.append(uc)
            return res

    def get_user_by_id(self, user_id, safe=True):
        with self.lock:
            for u in self.users:
                if u.get("id") == user_id:
                    uc = u.copy()
                    if safe:
                        uc.pop("password_hash", None)
                    return uc
            return None

    def get_user_by_username(self, username):
        username = username.strip().lower()
        with self.lock:
            for u in self.users:
                if u.get("username", "").strip().lower() == username:
                    return u.copy()
            return None

    def get_user_by_token(self, token, safe=True):
        if not token:
            return None
        token = token.strip()
        with self.lock:
            for u in self.users:
                if u.get("token") == token and u.get("active", True):
                    uc = u.copy()
                    if safe:
                        uc.pop("password_hash", None)
                    return uc
            return None

    def authenticate(self, username, password):
        """Validates username and password. Returns safe user object if valid, else None."""
        user = self.get_user_by_username(username)
        if not user or not user.get("active", True):
            return None
        if verify_password(password, user.get("password_hash", "")):
            user.pop("password_hash", None)
            return user
        return None

    def create_user(self, username, password, display_name="", role="user", allowed_cameras=None, permissions=None):
        username = username.strip().lower()
        if not username:
            return {"success": False, "error": "Username tidak boleh kosong"}
        if len(password) < 4:
            return {"success": False, "error": "Password minimal 4 karakter"}

        if self.get_user_by_username(username):
            return {"success": False, "error": f"Username '{username}' sudah terdaftar"}

        if allowed_cameras is None:
            allowed_cameras = ["cam-1"]
        
        perms = DEFAULT_PERMISSIONS_ADMIN.copy() if role == "admin" else DEFAULT_PERMISSIONS_USER.copy()
        if permissions and isinstance(permissions, dict):
            perms.update(permissions)

        user_id = "usr_" + secrets.token_hex(6)
        token = secrets.token_urlsafe(20)

        new_user = {
            "id": user_id,
            "username": username,
            "display_name": display_name.strip() or username.title(),
            "password_hash": hash_password(password),
            "role": role if role in ["admin", "user"] else "user",
            "allowed_cameras": ["*"] if role == "admin" else allowed_cameras,
            "permissions": perms,
            "token": token,
            "active": True,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        with self.lock:
            self.users.append(new_user)
            self._save_to_disk(self.users)

        safe_user = new_user.copy()
        safe_user.pop("password_hash", None)
        return {"success": True, "user": safe_user}

    def update_user(self, user_id, data):
        with self.lock:
            target = None
            for u in self.users:
                if u.get("id") == user_id:
                    target = u
                    break
            if not target:
                return {"success": False, "error": "User tidak ditemukan"}

            if "display_name" in data:
                target["display_name"] = str(data["display_name"]).strip()

            if "password" in data and data["password"]:
                pwd = str(data["password"])
                if len(pwd) < 4:
                    return {"success": False, "error": "Password minimal 4 karakter"}
                target["password_hash"] = hash_password(pwd)

            if target.get("role") != "admin" or user_id != "usr_admin":
                if "role" in data and data["role"] in ["admin", "user"]:
                    target["role"] = data["role"]
                if "allowed_cameras" in data and isinstance(data["allowed_cameras"], list):
                    target["allowed_cameras"] = data["allowed_cameras"]
                if "active" in data:
                    target["active"] = bool(data["active"])

            if "permissions" in data and isinstance(data["permissions"], dict):
                if target.get("role") == "admin":
                    target["permissions"] = DEFAULT_PERMISSIONS_ADMIN.copy()
                else:
                    target["permissions"].update(data["permissions"])

            self._save_to_disk(self.users)
            safe_user = target.copy()
            safe_user.pop("password_hash", None)
            return {"success": True, "user": safe_user}

    def delete_user(self, user_id):
        if user_id == "usr_admin":
            return {"success": False, "error": "Akun Super Admin utama tidak dapat dihapus"}

        with self.lock:
            initial_len = len(self.users)
            self.users = [u for u in self.users if u.get("id") != user_id]
            if len(self.users) < initial_len:
                self._save_to_disk(self.users)
                return {"success": True}
            return {"success": False, "error": "User tidak ditemukan"}

    def regenerate_token(self, user_id):
        with self.lock:
            for u in self.users:
                if u.get("id") == user_id:
                    u["token"] = secrets.token_urlsafe(20)
                    self._save_to_disk(self.users)
                    return {"success": True, "token": u["token"]}
            return {"success": False, "error": "User tidak ditemukan"}

    def can_access_camera(self, user, cam_id):
        """Checks if a user has permission to access a camera ID."""
        if not user:
            return False
        if user.get("role") == "admin":
            return True
        allowed = user.get("allowed_cameras", [])
        return ("*" in allowed) or (cam_id in allowed)

    def has_permission(self, user, perm_name):
        """Checks if a user has a specific permission enabled."""
        if not user:
            return False
        if user.get("role") == "admin":
            return True
        perms = user.get("permissions", {})
        return bool(perms.get(perm_name, False))

auth_mgr = AuthManager()
