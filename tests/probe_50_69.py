import socket
import requests
import uuid

ip = "192.168.50.69"
print(f"--- Probing ports on {ip} ---")

ports_to_test = [80, 554, 8000, 8080, 8899, 37777, 34567, 10000, 8008, 8888, 5000, 23, 22]
open_ports = []

for p in ports_to_test:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.8)
    res = s.connect_ex((ip, p))
    if res == 0:
        print(f"Port {p}: OPEN")
        open_ports.append(p)
    s.close()

print(f"Open ports on {ip}: {open_ports}")

# Test UDP WS-Discovery unicast to 192.168.50.69:3702
print("\n--- Sending ONVIF Unicast Probe to 192.168.50.69:3702 ---")
msg = f"""<?xml version="1.0" encoding="utf-8"?>
<Envelope xmlns="http://www.w3.org/2003/05/soap-envelope" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <Header>
    <wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:{uuid.uuid4()}</wsa:MessageID>
    <wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
    <wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>
  </Header>
  <Body>
    <Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">
      <Types>dn:NetworkVideoTransmitter</Types>
    </Probe>
  </Body>
</Envelope>"""

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(2.0)
try:
    sock.sendto(msg.encode(), (ip, 3702))
    data, addr = sock.recvfrom(65535)
    print(f"ONVIF Response from {addr}:")
    print(data.decode(errors='ignore')[:500])
except Exception as e:
    print("UDP ONVIF Unicast result:", e)
finally:
    sock.close()

# If any HTTP port open, test SOAP device_service
for p in [8899, 80, 8000, 8080]:
    url = f"http://{ip}:{p}/onvif/device_service"
    try:
        r = requests.post(url, data="""<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><s:Body><tds:GetDeviceInformation/></s:Body></s:Envelope>""", headers={'Content-Type': 'application/soap+xml'}, timeout=1.5)
        print(f"SOAP probe on port {p}: status {r.status_code}")
    except Exception as e:
        pass
