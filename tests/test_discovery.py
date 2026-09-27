import socket
import uuid
import re
import xml.etree.ElementTree as ET

def probe_onvif(timeout=4.0):
    uid = str(uuid.uuid4())
    msg = f'''<?xml version="1.0" encoding="utf-8"?>
<Envelope xmlns="http://www.w3.org/2003/05/soap-envelope" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <Header>
    <wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:{uid}</wsa:MessageID>
    <wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
    <wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>
  </Header>
  <Body>
    <Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">
      <Types>dn:NetworkVideoTransmitter</Types>
    </Probe>
  </Body>
</Envelope>'''

    results = []
    # Try all local network interfaces / default interface
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    sock.settimeout(timeout)
    
    # Send broadcast and multicast
    try:
        sock.sendto(msg.encode('utf-8'), ('239.255.255.250', 3702))
    except Exception as e:
        print("Multicast send error:", e)

    # Also try broadcast on 255.255.255.255:3702
    try:
        bsock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        bsock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        bsock.sendto(msg.encode('utf-8'), ('255.255.255.255', 3702))
        bsock.close()
    except Exception as e:
        pass

    try:
        while True:
            data, addr = sock.recvfrom(65535)
            raw = data.decode('utf-8', errors='ignore')
            xaddrs = re.findall(r'<(?:[^:]+:)?XAddrs[^>]*>([^<]+)<', raw)
            scopes = re.findall(r'<(?:[^:]+:)?Scopes[^>]*>([^<]+)<', raw)
            types = re.findall(r'<(?:[^:]+:)?Types[^>]*>([^<]+)<', raw)
            
            xaddr_str = xaddrs[0] if xaddrs else ""
            scope_str = scopes[0] if scopes else ""
            type_str = types[0] if types else ""

            # Extract hardware, name from scopes
            name = ""
            hardware = ""
            location = ""
            for item in scope_str.split():
                if "onvif://www.onvif.org/name/" in item:
                    name = item.split("/name/")[-1].replace('%20', ' ')
                elif "onvif://www.onvif.org/hardware/" in item:
                    hardware = item.split("/hardware/")[-1].replace('%20', ' ')
                elif "onvif://www.onvif.org/location/" in item:
                    location = item.split("/location/")[-1].replace('%20', ' ')

            results.append({
                "ip": addr[0],
                "port": addr[1],
                "xaddrs": xaddr_str.split(),
                "name": name or "ONVIF Camera",
                "hardware": hardware,
                "location": location,
                "scopes": scope_str,
                "types": type_str,
                "raw_preview": raw[:300]
            })
    except socket.timeout:
        pass
    except Exception as e:
        print("Receive error:", e)
    finally:
        sock.close()

    return results

if __name__ == "__main__":
    print("Scanning network for ONVIF devices...")
    devs = probe_onvif()
    print(f"Total discovered devices: {len(devs)}")
    for i, dev in enumerate(devs, 1):
        print(f"Device #{i}:")
        print(f"  IP: {dev['ip']}")
        print(f"  Name: {dev['name']}")
        print(f"  Hardware: {dev['hardware']}")
        print(f"  XAddrs: {dev['xaddrs']}")
