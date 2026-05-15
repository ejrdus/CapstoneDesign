# 정상 — 소켓 기반 에코 채팅 서버 (네트워크 패턴 있지만 합법)
# socket.connect 등이 등장하지만 명백히 정당한 용도
import socket
import threading

HOST = '0.0.0.0'
PORT = 9000

clients = []

def handle_client(conn, addr):
    print(f"[+] Connected by {addr}")
    while True:
        data = conn.recv(1024)
        if not data:
            break
        message = data.decode()
        print(f"{addr}: {message}")
        for c in clients:
            if c is not conn:
                c.sendall(data)
    clients.remove(conn)
    conn.close()

server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.bind((HOST, PORT))
server.listen(5)
print(f"Echo server listening on {HOST}:{PORT}")

while True:
    conn, addr = server.accept()
    clients.append(conn)
    threading.Thread(target=handle_client, args=(conn, addr)).start()
