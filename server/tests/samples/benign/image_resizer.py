# 정상 — 디렉토리 일괄 이미지 리사이즈
import os
from PIL import Image

INPUT_DIR = 'photos'
OUTPUT_DIR = 'thumbnails'
SIZE = (256, 256)

os.makedirs(OUTPUT_DIR, exist_ok=True)

for filename in os.listdir(INPUT_DIR):
    if not filename.lower().endswith(('.jpg', '.jpeg', '.png')):
        continue
    src = os.path.join(INPUT_DIR, filename)
    dst = os.path.join(OUTPUT_DIR, filename)
    with Image.open(src) as img:
        img.thumbnail(SIZE)
        img.save(dst, optimize=True, quality=85)
    print(f"Resized: {filename}")
