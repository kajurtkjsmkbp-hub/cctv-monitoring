import socket
from concurrent.futures import ThreadPoolExecutor

def scan_port(p):
    s = socket.socket()
    s.settimeout(0.2)
    if s.connect_ex(('192.168.1.64', p)) == 0:
        print(f"Port {p} OPEN on 192.168.1.64")
        return p
    s.close()
    return None

common_ports = [
    21, 22, 23, 53, 80, 81, 443, 554, 1055, 1723, 1935, 2000, 3702, 5000, 5544, 7000, 8000, 8001, 8050, 8080, 8081, 
    8291, 8554, 8728, 8729, 8888, 8899, 9000, 10000, 34567, 37777, 65534
]

print("Scanning ports on Mikrotik 192.168.1.64...")
open_p = []
with ThreadPoolExecutor(max_workers=30) as ex:
    for p in ex.map(scan_port, common_ports):
        if p:
            open_p.append(p)

print("Open ports on 192.168.1.64:", open_p)
