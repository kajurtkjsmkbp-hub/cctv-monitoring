import requests
import re

SOAP_GET_NODES = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <s:Body>
    <tptz:GetNodes/>
  </s:Body>
</s:Envelope>"""

ptz_url = "http://192.168.1.65:8899/onvif/ptz_service"
try:
    r = requests.post(ptz_url, data=SOAP_GET_NODES, headers={"Content-Type": "application/soap+xml"}, timeout=3)
    print("PTZ Nodes Status:", r.status_code)
    print(r.text[:600])
except Exception as e:
    print("PTZ test error:", e)
