import requests
import re
import socket
import subprocess

def get_cam_ids(ip, port=8899):
    url = f"http://{ip}:{port}/onvif/device_service"
    soap = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetDeviceInformation/></s:Body>
</s:Envelope>"""
    try:
        r = requests.post(url, data=soap, headers={'Content-Type': 'application/soap+xml'}, timeout=2)
        m_s = re.search(r'<(?:[^:]+:)?SerialNumber[^>]*>([^<]+)<', r.text)
        m_h = re.search(r'<(?:[^:]+:)?HardwareId[^>]*>([^<]+)<', r.text)
        m_m = re.search(r'<(?:[^:]+:)?Model[^>]*>([^<]+)<', r.text)
        return (m_s.group(1) if m_s else "None"), (m_h.group(1) if m_h else "None"), (m_m.group(1) if m_m else "None")
    except Exception as e:
        return f"Error: {e}", "Error", "Error"

# Get ARP table
def get_arp():
    arp_map = {}
    try:
        out = subprocess.check_output("arp -a", shell=True, text=True)
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0].count('.') == 3 and '-' in parts[1]:
                arp_map[parts[0]] = parts[1]
    except Exception:
        pass
    return arp_map

arp = get_arp()
for ip in ['192.168.1.65', '192.168.1.66', '192.168.1.67', '192.168.50.69']:
    s, h, m = get_cam_ids(ip)
    mac = arp.get(ip, "Unknown")
    print(f"{ip}: MAC={mac} | Serial={s} | Model={m}")
