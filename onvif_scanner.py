"""
ONVIF WS-Discovery and Network Scanner Engine
Discovers ONVIF CCTV cameras and queries device capabilities and RTSP profiles.
"""

import socket
import uuid
import re
import requests
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

ONVIF_PROBE_XML = """<?xml version="1.0" encoding="utf-8"?>
<Envelope xmlns="http://www.w3.org/2003/05/soap-envelope" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <Header>
    <wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:{msg_id}</wsa:MessageID>
    <wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
    <wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>
  </Header>
  <Body>
    <Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">
      <Types>dn:NetworkVideoTransmitter</Types>
    </Probe>
  </Body>
</Envelope>"""

SOAP_DEVICE_INFO = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetDeviceInformation/></s:Body>
</s:Envelope>"""

SOAP_CAPABILITIES = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body><tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities></s:Body>
</s:Envelope>"""

SOAP_PROFILES = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <s:Body><trt:GetProfiles/></s:Body>
</s:Envelope>"""

SOAP_STREAM_URI = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" 
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl" 
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>{token}</trt:ProfileToken>
    </trt:GetStreamUri>
  </s:Body>
</s:Envelope>"""

def get_local_ips():
    """Returns candidate local IPv4 addresses (excluding 127.0.0.1)."""
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    # Always prioritize 192.168.1.81 if present
    if "192.168.1.81" not in ips:
        ips.append("192.168.1.81")
    return ips

def parse_tag(text, tag):
    m = re.search(rf'<(?:[^:]+:)?{tag}[^>]*>([^<]+)<', text)
    return m.group(1).strip() if m else ""

def get_onvif_uuid_mac(ip, port=3702):
    """Fetches ONVIF WS-Discovery probe response and extracts hardware MAC address."""
    uid = str(uuid.uuid4())
    msg = ONVIF_PROBE_XML.format(msg_id=uid).encode('utf-8')
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(1.2)
    try:
        s.sendto(msg, (ip, port))
        data, _ = s.recvfrom(65535)
        raw = data.decode(errors='ignore')
        m = re.search(r'([0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2})', raw)
        if m:
            return m.group(1).lower()
    except Exception:
        pass
    finally:
        s.close()
    return ""

def get_camera_onvif_details(ip, onvif_port=8899):
    """Queries ONVIF device service, media service, and profiles for detailed camera specs."""
    dev_url = f"http://{ip}:{onvif_port}/onvif/device_service"
    headers = {"Content-Type": "application/soap+xml; charset=utf-8"}
    details = {
        "ip": ip,
        "mac": get_onvif_uuid_mac(ip),
        "onvif_port": onvif_port,
        "device_service": dev_url,
        "manufacturer": "Generic Camera",
        "model": "IPCamera",
        "firmware": "Unknown",
        "serial": "Unknown",
        "media_service": f"http://{ip}:{onvif_port}/onvif/media_service",
        "ptz_service": f"http://{ip}:{onvif_port}/onvif/ptz_service",
        "has_ptz": True,
        "rtsp_main": f"rtsp://{ip}/live/ch00_0",
        "rtsp_sub": f"rtsp://{ip}/live/ch00_1",
        "profiles": []
    }

    try:
        r_info = requests.post(dev_url, data=SOAP_DEVICE_INFO, headers=headers, timeout=2.5)
        if r_info.status_code == 200:
            details["manufacturer"] = parse_tag(r_info.text, "Manufacturer") or details["manufacturer"]
            details["model"] = parse_tag(r_info.text, "Model") or details["model"]
            details["firmware"] = parse_tag(r_info.text, "FirmwareVersion") or details["firmware"]
            details["serial"] = parse_tag(r_info.text, "SerialNumber") or details["serial"]
    except Exception:
        pass

    try:
        r_cap = requests.post(dev_url, data=SOAP_CAPABILITIES, headers=headers, timeout=2.5)
        if r_cap.status_code == 200:
            media_m = re.findall(r'<(?:[^:]+:)?Media>(?:.*?<(?:[^:]+:)?XAddr>([^<]+)<)?', r_cap.text, re.DOTALL)
            ptz_m = re.findall(r'<(?:[^:]+:)?PTZ>(?:.*?<(?:[^:]+:)?XAddr>([^<]+)<)?', r_cap.text, re.DOTALL)
            if media_m and media_m[0]:
                details["media_service"] = media_m[0]
            if ptz_m and ptz_m[0]:
                details["ptz_service"] = ptz_m[0]
                details["has_ptz"] = True
    except Exception:
        pass

    # Query profiles
    try:
        r_prof = requests.post(details["media_service"], data=SOAP_PROFILES, headers=headers, timeout=2.5)
        if r_prof.status_code == 200:
            tokens = re.findall(r'<[^>]*Profiles[^>]*token="([^"]+)"', r_prof.text)
            for idx, token in enumerate(tokens):
                r_uri = requests.post(details["media_service"], data=SOAP_STREAM_URI.format(token=token), headers=headers, timeout=2.0)
                uris = re.findall(r'<[^>]*Uri[^>]*>([^<]+)<', r_uri.text)
                uri = uris[0] if uris else ""
                details["profiles"].append({"token": token, "uri": uri})
                if idx == 0 and uri:
                    details["rtsp_main"] = uri
                elif idx == 1 and uri:
                    details["rtsp_sub"] = uri
    except Exception:
        pass

    return details

def probe_port(ip, port, timeout=0.3):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    res = s.connect_ex((ip, port)) == 0
    s.close()
    return res

def scan_network_onvif(subnet_prefix="192.168.1.", start_range=1, end_range=120):
    """
    Comprehensive hybrid scan:
    1. WS-Discovery via Multicast & Subnet Broadcast
    2. Concurrent Port Sweep on ONVIF (8899, 8000, 80) and RTSP (554)
    3. ONVIF Device Information Extraction
    """
    discovered_ips = set()
    results = []

    # Step 1: WS-Discovery UDP Broadcast/Multicast
    local_ips = get_local_ips()
    for bind_ip in local_ips:
        if not bind_ip.startswith("192.168."):
            continue
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.bind((bind_ip, 0))
            try:
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(bind_ip))
            except Exception:
                pass
            sock.settimeout(1.5)

            msg = ONVIF_PROBE_XML.format(msg_id=str(uuid.uuid4())).encode('utf-8')
            targets = [('239.255.255.250', 3702), ('255.255.255.255', 3702), (f"{subnet_prefix}255", 3702)]
            for t in targets:
                try:
                    sock.sendto(msg, t)
                except Exception:
                    pass

            while True:
                try:
                    data, addr = sock.recvfrom(65535)
                    dev_ip = addr[0]
                    if dev_ip.startswith(subnet_prefix) and dev_ip not in discovered_ips:
                        discovered_ips.add(dev_ip)
                except (socket.timeout, ConnectionResetError):
                    break
            sock.close()
        except Exception:
            pass

    # Step 2: Concurrent quick check on subnet IPs for ONVIF port 8899 / 554
    candidate_ips = [f"{subnet_prefix}{i}" for i in range(start_range, end_range + 1)]
    # Ensure known IPs are always checked
    for known in ["192.168.1.65", "192.168.1.66", "192.168.1.67", "192.168.50.69"]:
        if known not in candidate_ips:
            candidate_ips.append(known)

    def check_ip(ip):
        # Check port 8899 (ONVIF) or port 554 (RTSP)
        has_8899 = probe_port(ip, 8899, timeout=0.25)
        has_554 = probe_port(ip, 554, timeout=0.25)
        if has_8899 or has_554:
            return ip, 8899 if has_8899 else 80
        return None, None

    with ThreadPoolExecutor(max_workers=40) as executor:
        scan_results = executor.map(check_ip, candidate_ips)
        for ip, port in scan_results:
            if ip and ip != "192.168.1.81": # don't include self host as camera
                discovered_ips.add(ip)

    # Step 3: Query ONVIF Details for each discovered IP
    for ip in sorted(list(discovered_ips)):
        # Check port 8899 or fallback to 80
        onvif_port = 8899 if probe_port(ip, 8899, 0.2) else (80 if probe_port(ip, 80, 0.2) else 8899)
        info = get_camera_onvif_details(ip, onvif_port)
        results.append(info)

    return results

if __name__ == "__main__":
    print("Testing scanner...")
    cams = scan_network_onvif()
    print(f"Discovered: {len(cams)} cameras:")
    for c in cams:
        print(f" - {c['ip']}: {c['manufacturer']} {c['model']} | RTSP Main: {c['rtsp_main']}")
