import cv2
import socket

# Test multi-channel on 192.168.1.65
for ch in ['ch00_0', 'ch00_1', 'ch01_0', 'ch01_1', 'ch02_0', 'onvif1', 'onvif2', 'stream1']:
    url = f"rtsp://192.168.1.65/live/{ch}"
    cap = cv2.VideoCapture(url)
    ret, frame = cap.read()
    print(f"{url} -> ret={ret}")
    cap.release()

# Also test 192.168.1.68 & 192.168.1.111
for ip in ['192.168.1.68', '192.168.1.111', '192.168.1.1']:
    s = socket.socket()
    s.settimeout(0.3)
    p554 = s.connect_ex((ip, 554)) == 0
    s.close()
    print(f"{ip}:554 RTSP -> {p554}")
