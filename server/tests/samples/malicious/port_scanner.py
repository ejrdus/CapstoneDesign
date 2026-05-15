# 네트워크 스캐닝 — dual-use 케이스 (펜테스트 합법/공격 정찰 불법)
# 분석기가 어떻게 판정하는지 보는 경계선 샘플
import socket
import sys

target = sys.argv[1] if len(sys.argv) > 1 else '192.168.1.1'
open_ports = []

for port in range(1, 1024):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.1)
    if s.connect_ex((target, port)) == 0:
        open_ports.append(port)
        print(f"Open: {port}")
    s.close()

print(f"\nFound {len(open_ports)} open ports on {target}")
