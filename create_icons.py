import os
import cv2
import numpy as np

img_dir = os.path.join(os.path.dirname(__file__), "static", "images")
os.makedirs(img_dir, exist_ok=True)

def generate_icon(size, filename):
    img = np.zeros((size, size, 3), dtype=np.uint8)
    img[:, :] = (17, 9, 6) # Dark cyber background
    
    center = (size // 2, size // 2)
    radius = int(size * 0.42)
    # Cyan outer ring
    cv2.circle(img, center, radius, (255, 240, 0), int(size * 0.03))
    # Shield shape or camera lens
    cv2.circle(img, center, int(radius * 0.7), (255, 200, 0), int(size * 0.02))
    cv2.circle(img, center, int(radius * 0.35), (255, 255, 0), -1)
    cv2.circle(img, (int(center[0] - radius * 0.12), int(center[1] - radius * 0.12)), int(radius * 0.08), (255, 255, 255), -1)
    
    cv2.imwrite(os.path.join(img_dir, filename), img)

generate_icon(192, "icon-192.png")
generate_icon(512, "icon-512.png")
print("Icons created successfully!")
