import socket
import uuid
import re

def get_onvif_uuid(ip, port=3702):
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
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(1.5)
    try:
        s.sendto(msg.encode(), (ip, port))
        data, _ = s.recvfrom(65535)
        raw = data.decode(errors='ignore')
        m = re.search(r'<(?:[^:]+:)?Address[^>]*>([^<]+)<', raw)
        return m.group(1) if m else "Unknown"
    except Exception as e:
        return f"Error: {e}"
    finally:
        s.close()

for ip in ['192.168.1.65', '192.168.1.66', '192.168.1.67', '192.168.50.69']:
    u = get_onvif_uuid(ip)
    print(f"{ip}: ONVIF URN UUID = {u}")
