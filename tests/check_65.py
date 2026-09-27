import requests
import re
import cv2

url = 'http://192.168.1.65:8899/onvif/media_service'
soap_profiles = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <s:Body><trt:GetProfiles/></s:Body>
</s:Envelope>"""

r = requests.post(url, data=soap_profiles, headers={'Content-Type': 'application/soap+xml'})
profiles = re.findall(r'<trt:Profiles[^>]*token="([^"]+)"', r.text)
print("Profiles found:", profiles)

# Check stream URIs
soap_stream = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
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

for p in profiles:
    r2 = requests.post(url, data=soap_stream.format(token=p), headers={'Content-Type': 'application/soap+xml'})
    uris = re.findall(r'<[^>]*Uri[^>]*>([^<]+)<', r2.text)
    print(f"Token {p} URI:", uris)
    if uris:
        cap = cv2.VideoCapture(uris[0])
        ret, frame = cap.read()
        print(f" -> Stream test {uris[0]}: ret={ret}, shape={frame.shape if ret else None}")
        cap.release()
