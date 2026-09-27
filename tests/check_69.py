import socket
import requests

print("--- Checking 192.168.1.69 ---")
for p in [80, 554, 8899, 8000, 8080, 37777, 34567]:
    s = socket.socket()
    s.settimeout(0.3)
    if s.connect_ex(('192.168.1.69', p)) == 0:
        print(f"192.168.1.69 port {p}: OPEN")
    s.close()

try:
    r = requests.get('http://192.168.1.69', timeout=2)
    print("192.168.1.69 HTTP Server:", r.headers.get("Server"))
    print("192.168.1.69 Content:", r.text[:200])
except Exception as e:
    print("192.168.1.69 HTTP error:", e)
