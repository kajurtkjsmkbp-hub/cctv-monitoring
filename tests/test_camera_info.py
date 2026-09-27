import requests
import xml.etree.ElementTree as ET
import re

SOAP_DEVICE_INFO = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body>
    <tds:GetDeviceInformation/>
  </s:Body>
</s:Envelope>"""

SOAP_CAPABILITIES = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <s:Body>
    <tds:GetCapabilities>
      <tds:Category>All</tds:Category>
    </tds:GetCapabilities>
  </s:Body>
</s:Envelope>"""

def parse_tag(text, tag):
    m = re.search(rf'<(?:[^:]+:)?{tag}[^>]*>([^<]+)<', text)
    return m.group(1) if m else "Unknown"

for ip in ["192.168.1.65", "192.168.1.66", "192.168.1.67"]:
    url = f"http://{ip}:8899/onvif/device_service"
    print(f"\n================ Device at {ip} ================")
    
    # 1. Device Info
    try:
        r = requests.post(url, data=SOAP_DEVICE_INFO, headers={"Content-Type": "application/soap+xml"}, timeout=3)
        print("Manufacturer:   ", parse_tag(r.text, "Manufacturer"))
        print("Model:          ", parse_tag(r.text, "Model"))
        print("FirmwareVersion:", parse_tag(r.text, "FirmwareVersion"))
        print("SerialNumber:   ", parse_tag(r.text, "SerialNumber"))
        print("HardwareId:     ", parse_tag(r.text, "HardwareId"))
    except Exception as e:
        print("Device Info error:", e)

    # 2. Capabilities (Media service URL)
    try:
        r = requests.post(url, data=SOAP_CAPABILITIES, headers={"Content-Type": "application/soap+xml"}, timeout=3)
        media_xaddr = re.findall(r'<(?:[^:]+:)?Media>(?:.*?<(?:[^:]+:)?XAddr>([^<]+)<)?', r.text, re.DOTALL)
        ptz_xaddr = re.findall(r'<(?:[^:]+:)?PTZ>(?:.*?<(?:[^:]+:)?XAddr>([^<]+)<)?', r.text, re.DOTALL)
        events_xaddr = re.findall(r'<(?:[^:]+:)?Events>(?:.*?<(?:[^:]+:)?XAddr>([^<]+)<)?', r.text, re.DOTALL)
        print("Media XAddr:    ", media_xaddr[0] if media_xaddr else "None")
        print("PTZ XAddr:      ", ptz_xaddr[0] if ptz_xaddr else "None")
        print("Events XAddr:   ", events_xaddr[0] if events_xaddr else "None")
    except Exception as e:
        print("Capabilities error:", e)
