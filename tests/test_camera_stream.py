import requests
import xml.etree.ElementTree as ET
import re

SOAP_GET_PROFILES = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <s:Body>
    <trt:GetProfiles/>
  </s:Body>
</s:Envelope>"""

SOAP_GET_STREAM_URI = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" 
            xmlns:trt="http://www.onvif.org/ver10/media/wsdl" 
            xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    <trt:GetStreamUri>
      <trt:StreamSetup>
        <tt:Stream>RTP-Unicast</tt:Stream>
        <tt:Transport>
          <tt:Protocol>RTSP</tt:Protocol>
        </tt:Transport>
      </trt:StreamSetup>
      <trt:ProfileToken>{token}</trt:ProfileToken>
    </trt:GetStreamUri>
  </s:Body>
</s:Envelope>"""

for ip in ["192.168.1.65", "192.168.1.66", "192.168.1.67"]:
    media_url = f"http://{ip}:8899/onvif/media_service"
    print(f"\n--- Checking Media on {ip} ---")
    try:
        r = requests.post(media_url, data=SOAP_GET_PROFILES, headers={"Content-Type": "application/soap+xml"}, timeout=3)
        # Find Profile tokens
        tokens = re.findall(r'<[^>]*Profiles[^>]*token="([^"]+)"', r.text)
        names = re.findall(r'<[^:]+:Name>([^<]+)<', r.text)
        print(f"Tokens: {tokens}")
        print(f"Names: {names}")

        for token in tokens:
            body = SOAP_GET_STREAM_URI.format(token=token)
            r_uri = requests.post(media_url, data=body, headers={"Content-Type": "application/soap+xml"}, timeout=3)
            uris = re.findall(r'<[^>]*Uri[^>]*>([^<]+)<', r_uri.text)
            print(f"  Stream URI for {token}: {uris}")
    except Exception as e:
        print("Media query error:", e)
