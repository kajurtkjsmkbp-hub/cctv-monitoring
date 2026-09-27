import requests

for ip in ['192.168.1.111', '192.168.1.68']:
    try:
        r = requests.get(f'http://{ip}', timeout=2)
        print(f"=== {ip} ===")
        print("Server header:", r.headers.get("Server"))
        print("Content preview:\n", r.text[:300])
    except Exception as e:
        print(f"{ip} error:", e)
