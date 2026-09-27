"""
ONVIF PTZ (Pan-Tilt-Zoom) Controller
Sends ONVIF SOAP requests for PTZ ContinuousMove, RelativeMove, and Stop operations.
"""

import requests
import xml.etree.ElementTree as ET

class PTZController:
    def __init__(self, ip, onvif_port=8899, ptz_service_url=None):
        self.ip = ip
        self.onvif_port = onvif_port
        self.service_url = ptz_service_url or f"http://{ip}:{onvif_port}/onvif/ptz_service"
        self.profile_token = "PROFILE_000"

    def move(self, x=0.0, y=0.0, zoom=0.0, profile_token=None):
        """
        Sends ContinuousMove.
        x: Pan velocity (-1.0 to 1.0, negative = left, positive = right)
        y: Tilt velocity (-1.0 to 1.0, negative = down, positive = up)
        zoom: Zoom velocity (-1.0 to 1.0, negative = zoom out, positive = zoom in)
        """
        token = profile_token or self.profile_token
        soap_body = f"""<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" 
            xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" 
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <tptz:ContinuousMove>
      <tptz:ProfileToken>{token}</tptz:ProfileToken>
      <tptz:Velocity>
        <tt:PanTilt x="{x:.2f}" y="{y:.2f}"/>
        <tt:Zoom x="{zoom:.2f}"/>
      </tptz:Velocity>
    </tptz:ContinuousMove>
  </s:Body>
</s:Envelope>"""

        headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
        try:
            r = requests.post(self.service_url, data=soap_body, headers=headers, timeout=2.0)
            return {"success": r.status_code == 200, "status_code": r.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def stop(self, profile_token=None):
        """Sends Stop command to halt PTZ movement."""
        token = profile_token or self.profile_token
        soap_body = f"""<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" 
            xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <s:Body>
    <tptz:Stop>
      <tptz:ProfileToken>{token}</tptz:ProfileToken>
      <tptz:PanTilt>true</tptz:PanTilt>
      <tptz:Zoom>true</tptz:Zoom>
    </tptz:Stop>
  </s:Body>
</s:Envelope>"""

        headers = {'Content-Type': 'application/soap+xml; charset=utf-8'}
        try:
            r = requests.post(self.service_url, data=soap_body, headers=headers, timeout=2.0)
            return {"success": r.status_code == 200, "status_code": r.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def nudge(self, direction, speed=0.5, duration=0.25):
        """Moves in a specific direction for a short burst (discrete step)."""
        import time
        x, y = 0.0, 0.0
        if direction == "up":
            y = speed
        elif direction == "down":
            y = -speed
        elif direction == "left":
            x = -speed
        elif direction == "right":
            x = speed
        elif direction == "up-left":
            x, y = -speed, speed
        elif direction == "up-right":
            x, y = speed, speed
        elif direction == "down-left":
            x, y = -speed, -speed
        elif direction == "down-right":
            x, y = speed, -speed
        elif direction == "zoom-in":
            return self.zoom_step(speed, duration)
        elif direction == "zoom-out":
            return self.zoom_step(-speed, duration)

        res = self.move(x, y, 0.0)
        time.sleep(duration)
        self.stop()
        return res

    def zoom_step(self, speed, duration=0.25):
        import time
        res = self.move(0.0, 0.0, speed)
        time.sleep(duration)
        self.stop()
        return res
