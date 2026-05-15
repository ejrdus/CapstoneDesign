# 경계선 케이스 — 단일 임시 파일 삭제 (irreversible 하지만 system_wide 아님)
import os
os.remove('/tmp/cache.txt')
print('done')
