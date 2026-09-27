import socket
import uuid
import re
import urllib.request
import json

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

def parse_onvif_response(data_str, addr):
    xaddrs = re.findall(r'<(?:[^:]+:)?XAddrs[^>]*>([^<]+)<', data_str)
    scopes = re.findall(r'<(?:[^:]+:)?Scopes[^>]*>([^<]+)<', data_str)
    types = re.findall(r'<(?:[^:]+:)?Types[^>]*>([^<]+)<', data_str)

    xaddr_list = xaddrs[0].split() if xaddrs else []
    scope_str = scopes[0] if scopes else ""
    type_str = types[0] if types else ""

    name = ""
    hardware = ""
    location = ""
    for item in scope_str.split():
        if "/name/" in item:
            name = item.split("/name/")[-1].replace('%20', ' ')
        elif "/hardware/" in item:
            hardware = item.split("/hardware/")[-1].replace('%20', ' ')
        elif "/location/" in item:
            location = item.split("/location/")[-1].replace('%20', ' ')

    return {
        "ip": addr[0],
        "port": addr[1],
        "xaddrs": xaddr_list,
        "name": name or "ONVIF IP Camera",
        "hardware": hardware or "Generic ONVIF Device",
        "location": location or "Local Network",
        "scopes": scope_str,
        "types": type_str
    }

def scan_onvif_multicast(bind_ip="192.168.1.81", timeout=3.0):
    discovered = {}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        sock.bind((bind_ip, 0))
    except Exception as e:
        print(f"Bind to {bind_ip} failed: {e}")

    try:
        # Set outgoing interface for multicast
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(bind_ip))
    except Exception as e:
        print(f"Multicast IF error: {e}")

    sock.settimeout(timeout)

    xml_msg = ONVIF_PROBE_XML.format(msg_id=str(uuid.uuid4())).encode('utf-8')

    # Send multicast & subnet broadcast
    targets = [
        ('239.255.255.250', 3702),
        ('255.255.255.255', 3702),
        ('192.168.1.255', 3702),
        ('192.168.1.65', 3702),
        ('192.168.1.66', 3702),
        ('192.168.1.67', 3702),
        ('192.168.1.68', 3702),
        ('192.168.1.111', 3702),
    ]

    for target in targets:
        try:
            sock.sendto(xml_msg, target)
        except Exception as e:
            pass

    try:
        while True:
            data, addr = sock.recvfrom(65535)
            raw = data.decode('utf-8', errors='ignore')
            dev = parse_onvif_response(raw, addr)
            dev_ip = dev['ip']
            if dev_ip not in discovered:
                discovered[dev_ip] = dev
                print(f"[FOUND ONVIF] {dev_ip} - {dev['name']} ({dev['hardware']}) XAddrs: {dev['xaddrs']}")
    except socket.timeout:
        pass
    except Exception as e:
        print(f"Error during recv: {e}")
    finally:
        sock.close()

    return list(discovered.values())

def check_ports(ip, ports=[80, 554, 8000, 8080, 8899, 37777]):
    open_ports = []
    for port in ports:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.4)
        if s.connect_ex((ip, port)) == 0:
            open_ports.append(port)
        s.close()
    return open_ports

if __name__ == "__main__":
    print("Scanning with bind_ip 192.168.1.81...")
    devs = scan_onvif_multicast()
    print(f"Discovered via ONVIF: {len(devs)}")
    
    print("\nChecking ARP candidates for open CCTV ports (80, 554 RTSP, 8000, 8899 ONVIF, etc.):")
    candidates = ['192.168.1.65', '192.168.1.66', '192.168.1.67', '192.168.1.68', '192.168.1.111']
    for ip in candidates:
        open_p = check_ports(ip)
        print(f"{ip}: open ports = {open_p}")
