# 정상 — 로그 파일 파싱 (파일 읽기 + 정규식)
import re
from collections import Counter

LOG_PATTERN = re.compile(r'(\d+\.\d+\.\d+\.\d+).*?"(\w+) (\S+) HTTP.*?" (\d+)')

ip_counts = Counter()
status_counts = Counter()
errors = []

with open('access.log') as f:
    for line in f:
        m = LOG_PATTERN.search(line)
        if not m:
            continue
        ip, method, path, status = m.groups()
        ip_counts[ip] += 1
        status_counts[status] += 1
        if status.startswith('5'):
            errors.append((ip, path, status))

print(f"Top 10 IPs:")
for ip, count in ip_counts.most_common(10):
    print(f"  {ip}: {count}")

print(f"\nStatus distribution:")
for status, count in sorted(status_counts.items()):
    print(f"  {status}: {count}")

print(f"\n5xx errors: {len(errors)}")
