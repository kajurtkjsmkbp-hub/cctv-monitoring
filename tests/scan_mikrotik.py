import socket
from concurrent.futures import ThreadPoolExecutor

def check(ip):
    res = {}
    for p in [8291, 8728, 80, 554, 8899]:
        s = socket.socket()
        s.settimeout(0.3)
        if s.connect_ex((ip, p)) == 0:
            res[p] = True
        s.close()
    if res:
        print(f"IP {ip}: open ports {list(res.keys())}")
    return ip, res

print("Scanning 192.168.1.1 - 254...")
with ThreadPoolExecutor(max_workers=50) as ex:
    ips = [f"192.168.1.{i}" for i in range(1, 255)]
    results = list(ex.map(check, ips))
