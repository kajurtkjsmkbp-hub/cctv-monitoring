import requests
import time

def send_ptz(ip, x, y, zoom=0.0):
    url = f"http://{ip}:8899/onvif/ptz_service"
    xml_move = f"""<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" 
            xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" 
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <tptz:ContinuousMove>
      <tptz:ProfileToken>PROFILE_000</tptz:ProfileToken>
      <tptz:Velocity>
        <tt:PanTilt x="{x}" y="{y}"/>
        <tt:Zoom x="{zoom}"/>
      </tptz:Velocity>
    </tptz:ContinuousMove>
  </s:Body>
</s:Envelope>"""

    xml_stop = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" 
            xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <s:Body>
    <tptz:Stop>
      <tptz:ProfileToken>PROFILE_000</tptz:ProfileToken>
      <tptz:PanTilt>true</tptz:PanTilt>
      <tptz:Zoom>true</tptz:Zoom>
    </tptz:Stop>
  </s:Body>
</s:Envelope>"""

    headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
    r1 = requests.post(url, data=xml_move, headers=headers, timeout=2)
    print("ContinuousMove status:", r1.status_code)
    time.sleep(0.3)
    r2 = requests.post(url, data=xml_stop, headers=headers, timeout=2)
    print("Stop status:", r2.status_code)

if __name__ == "__main__":
    send_ptz("192.168.1.65", 0.3, 0.0)
