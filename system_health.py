"""
System Health Monitor for Aegis Vision / Khanza.NET Vision CCTV
Reads CPU, RAM, Disk, Uptime, and Load Average with support for Linux (Proxmox LXC) and Windows.
"""

import os
import time
import shutil
import platform

def get_system_metrics():
    sys_name = platform.system()
    is_lxc = False
    if sys_name == "Linux":
        if os.path.exists("/dev/lxd") or os.path.exists("/dev/lxc") or os.path.exists("/etc/pve") or os.path.exists("/.dockerenv"):
            is_lxc = True

    platform_desc = "Proxmox LXC (Linux)" if is_lxc else f"{sys_name} Server"

    res = {
        "platform": platform_desc,
        "cpu_percent": 0.0,
        "ram_used_mb": 0,
        "ram_total_mb": 0,
        "ram_percent": 0.0,
        "disk_total_gb": 0.0,
        "disk_used_gb": 0.0,
        "disk_free_gb": 0.0,
        "disk_percent": 0.0,
        "uptime": "0s",
        "load_avg": [0.0, 0.0, 0.0]
    }

    # 1. Disk Usage
    try:
        base_path = "/" if sys_name != "Windows" else "C:\\"
        total, used, free = shutil.disk_usage(base_path)
        res["disk_total_gb"] = round(total / (1024 ** 3), 1)
        res["disk_used_gb"] = round(used / (1024 ** 3), 1)
        res["disk_free_gb"] = round(free / (1024 ** 3), 1)
        res["disk_percent"] = round((used / total) * 100, 1) if total > 0 else 0.0
    except Exception:
        pass

    # 2. Try psutil if installed
    try:
        import psutil
        # Non-blocking cpu percent
        res["cpu_percent"] = round(psutil.cpu_percent(interval=None), 1)
        vm = psutil.virtual_memory()
        res["ram_total_mb"] = round(vm.total / (1024 ** 2))
        res["ram_used_mb"] = round((vm.total - vm.available) / (1024 ** 2))
        res["ram_percent"] = round(vm.percent, 1)

        boot = psutil.boot_time()
        up_secs = int(time.time() - boot)
        hours, rem = divmod(up_secs, 3600)
        mins, secs = divmod(rem, 60)
        days, hours = divmod(hours, 24)
        if days > 0:
            res["uptime"] = f"{days}h {hours}j {mins}m"
        elif hours > 0:
            res["uptime"] = f"{hours}j {mins}m"
        else:
            res["uptime"] = f"{mins}m {secs}d"

        if hasattr(os, "getloadavg"):
            res["load_avg"] = [round(x, 2) for x in os.getloadavg()]
        return res
    except Exception:
        pass

    # 3. Fallback for Native Linux /proc (LXC without psutil)
    if sys_name == "Linux":
        # Memory from /proc/meminfo
        try:
            meminfo = {}
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        k = parts[0].strip()
                        v = parts[1].strip().split()[0]
                        meminfo[k] = int(v)  # kB
            total_kb = meminfo.get("MemTotal", 0)
            avail_kb = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))
            used_kb = max(0, total_kb - avail_kb)
            res["ram_total_mb"] = round(total_kb / 1024)
            res["ram_used_mb"] = round(used_kb / 1024)
            res["ram_percent"] = round((used_kb / total_kb) * 100, 1) if total_kb > 0 else 0.0
        except Exception:
            pass

        # Load Average from /proc/loadavg
        try:
            with open("/proc/loadavg", "r") as f:
                parts = f.read().split()
                res["load_avg"] = [round(float(parts[0]), 2), round(float(parts[1]), 2), round(float(parts[2]), 2)]
                res["cpu_percent"] = min(100.0, round(float(parts[0]) * 25.0, 1))
        except Exception:
            pass

        # Uptime from /proc/uptime
        try:
            with open("/proc/uptime", "r") as f:
                up_secs = int(float(f.read().split()[0]))
                hours, rem = divmod(up_secs, 3600)
                mins, secs = divmod(rem, 60)
                days, hours = divmod(hours, 24)
                if days > 0:
                    res["uptime"] = f"{days}h {hours}j {mins}m"
                elif hours > 0:
                    res["uptime"] = f"{hours}j {mins}m"
                else:
                    res["uptime"] = f"{mins}m {secs}d"
        except Exception:
            pass

    return res
