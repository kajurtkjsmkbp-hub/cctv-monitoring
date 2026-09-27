import requests
import re

# Query PTZ Nodes and Configurations
r = requests.post(
    'http://192.168.1.65:8899/onvif/ptz_service',
    data='''<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <s:Body>
    <tptz:GetNodes/>
  </s:Body>
</s:Envelope>''',
    headers={'Content-Type': 'application/soap+xml'}
)
print("PTZ Response length:", len(r.text))
nodes = re.findall(r'token="([^"]+)"', r.text)
print("Tokens found in PTZ:", nodes)
