import requests

for p in [81, 8080]:
    try:
        r = requests.get(f'http://192.168.1.64:{p}', timeout=2)
        print(f"Port {p} -> {r.status_code}")
        print("Server:", r.headers.get("Server"))
        print("Text preview:", r.text[:200])
    except Exception as e:
        print(f"Port {p} error:", e)
