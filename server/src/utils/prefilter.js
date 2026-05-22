/**
 * 사전필터(Prefilter) 모듈 — 다국어 지원
 *
 * LLM 호출은 비용(토큰)과 지연(2~20초)을 수반하므로, 명백히 위험 패턴이
 * 하나도 없는 짧은 코드는 LLM 분석 없이 즉시 safe로 판정한다.
 *
 * 정책: 보수적(conservative) — false negative(악성을 safe로 잘못 판정)를
 * 절대 피하기 위해, 의심 패턴이 단 하나라도 매칭되면 사전필터를 통과시키지
 * 않고 LLM 분석으로 넘긴다.
 *
 * 통과 조건 (모두 만족):
 *   1) 코드 길이 ≤ MAX_PREFILTER_CHARS, 줄 수 ≤ MAX_PREFILTER_LINES
 *   2) 비식별화 마커([REDACTED_*]) 없음
 *   3) 공통 + 언어별 HIGH_RISK_PATTERNS 중 어느 것도 매칭되지 않음
 *   4) 알 수 없는 언어(unknown)면 안전을 위해 LLM으로 보냄
 */

// 모든 언어 공통 — 텍스트 자체에서 발견되면 위험한 패턴
const COMMON_PATTERNS = [
  // 역쉘 페이로드 패턴 (언어 무관)
  { name: 'bash_interactive', pattern: /bash\s+-i\b/ },
  { name: 'dev_tcp', pattern: /\/dev\/tcp\// },
  { name: 'nc_listen_exec', pattern: /\bnc\s+-[le]/ },
  // 민감 파일 경로 (언어 무관 — 코드 어디든 발견되면 의심)
  { name: 'etc_sensitive', pattern: /\/etc\/(passwd|shadow|sudoers)/ },
  { name: 'ssh_credentials', pattern: /\.ssh\/(id_rsa|id_ed25519|authorized_keys|known_hosts)/ },
  // sudo 호출
  { name: 'sudo_cmd', pattern: /\bsudo\s+/ },
];

// === 언어별 위험 패턴 ===

const PYTHON_PATTERNS = [
  // 코드 실행 — 메서드 접근(re.compile 등) 제외
  { name: 'py_exec_call', pattern: /(?<![.\w])exec\s*\(/ },
  { name: 'py_eval_call', pattern: /(?<![.\w])eval\s*\(/ },
  { name: 'py_compile_call', pattern: /(?<![.\w])compile\s*\(/ },
  { name: 'py_dunder_import', pattern: /__import__\s*\(/ },
  // 쉘/프로세스 실행
  { name: 'py_subprocess', pattern: /\bsubprocess\b/ },
  { name: 'py_os_system', pattern: /\bos\.system\b/ },
  { name: 'py_os_popen', pattern: /\bos\.popen\b/ },
  { name: 'py_pty_spawn', pattern: /\bpty\.spawn\b/ },
  { name: 'py_commands_legacy', pattern: /\bcommands\.(getoutput|getstatusoutput)\b/ },
  // 네트워크
  { name: 'py_socket', pattern: /\bsocket\b/ },
  { name: 'py_requests', pattern: /\brequests\b/ },
  { name: 'py_urllib', pattern: /\burllib\b/ },
  { name: 'py_http_client', pattern: /\bhttp\.client\b/ },
  { name: 'py_ftplib', pattern: /\bftplib\b/ },
  { name: 'py_smtplib', pattern: /\bsmtplib\b/ },
  { name: 'py_paramiko', pattern: /\bparamiko\b/ },
  { name: 'py_pysftp', pattern: /\bpysftp\b/ },
  // 파일 파괴
  { name: 'py_shutil_rmtree', pattern: /\bshutil\.rmtree\b/ },
  { name: 'py_os_remove', pattern: /\bos\.remove\b/ },
  { name: 'py_os_unlink', pattern: /\bos\.unlink\b/ },
  { name: 'py_os_rmdir', pattern: /\bos\.rmdir\b/ },
  // 키로거/모니터링
  { name: 'py_pynput', pattern: /\bpynput\b/ },
  { name: 'py_keyboard_lib', pattern: /\bkeyboard\b/ },
  { name: 'py_pyHook', pattern: /\bpyHook\b/ },
  { name: 'py_ctypes', pattern: /\bctypes\b/ },
  { name: 'py_win32_api', pattern: /\bwin32(api|gui|con)\b/ },
  // 암호화
  { name: 'py_fernet', pattern: /\bFernet\b/ },
  { name: 'py_aes', pattern: /\bAES\b/ },
  { name: 'py_cipher', pattern: /\bcipher\b/i },
  { name: 'py_cryptography_lib', pattern: /\bcryptography\./ },
  { name: 'py_crypto_mod', pattern: /\bCrypto\./ },
  { name: 'py_encrypt_method', pattern: /\.encrypt\s*\(/ },
  // 권한 상승
  { name: 'py_setuid', pattern: /\bos\.setuid\b/ },
  // 난독화
  { name: 'py_base64_decode', pattern: /base64\.b(64|32|16)decode/ },
  { name: 'py_zlib_decompress', pattern: /\bzlib\.decompress\b/ },
  { name: 'py_marshal_loads', pattern: /\bmarshal\.(loads|load)\b/ },
  { name: 'py_pickle_loads', pattern: /\bpickle\.(loads|load)\b/ },
  // 동적 스코프
  { name: 'py_globals_call', pattern: /\bglobals\s*\(\s*\)/ },
  { name: 'py_locals_call', pattern: /\blocals\s*\(\s*\)/ },
  // 위험 파일 열기
  { name: 'py_open_sensitive', pattern: /\bopen\s*\(\s*['"](\/etc\/|\/proc\/|\/sys\/)/ },
  // 환경변수 dump
  { name: 'py_env_dump', pattern: /os\.environ\.(copy|items|keys)\s*\(/ },
];

const GO_PATTERNS = [
  // 프로세스 실행
  { name: 'go_exec_command', pattern: /\bexec\.Command\b/ },
  { name: 'go_syscall_exec', pattern: /\bsyscall\.(Exec|ForkExec|StartProcess)\b/ },
  // 네트워크
  { name: 'go_net_dial', pattern: /\bnet\.Dial\b/ },
  { name: 'go_net_listen', pattern: /\bnet\.Listen\b/ },
  { name: 'go_http_client', pattern: /\bhttp\.(Get|Post|NewRequest|Client)\b/ },
  // 파일 파괴
  { name: 'go_os_remove', pattern: /\bos\.(Remove|RemoveAll)\b/ },
  // 권한/시스템
  { name: 'go_syscall_setuid', pattern: /\bsyscall\.Setuid\b/ },
  { name: 'go_os_chmod', pattern: /\bos\.Chmod\b/ },
  // 동적 코드 (Go는 eval 없지만 plugin 로드는 위험)
  { name: 'go_plugin_open', pattern: /\bplugin\.Open\b/ },
  // 암호화
  { name: 'go_crypto_aes', pattern: /\bcrypto\/aes\b/ },
  { name: 'go_crypto_cipher', pattern: /\bcrypto\/cipher\b/ },
];

const RUST_PATTERNS = [
  // 프로세스 실행
  { name: 'rs_process_command', pattern: /\bProcess::new\b|\bCommand::new\b/ },
  { name: 'rs_std_process', pattern: /\bstd::process::Command\b/ },
  // unsafe 블록 (C ABI 호출 등)
  { name: 'rs_unsafe_block', pattern: /\bunsafe\s*\{/ },
  // 네트워크
  { name: 'rs_tcp_stream', pattern: /\bTcpStream\b/ },
  { name: 'rs_tcp_listener', pattern: /\bTcpListener\b/ },
  { name: 'rs_reqwest', pattern: /\breqwest::/ },
  // 파일 파괴
  { name: 'rs_fs_remove', pattern: /\bfs::remove_(file|dir|dir_all)\b/ },
  // libc / FFI
  { name: 'rs_libc', pattern: /\blibc::/ },
  // 암호화
  { name: 'rs_aes', pattern: /\baes::/ },
  { name: 'rs_openssl', pattern: /\bopenssl::/ },
];

const C_PATTERNS = [
  // 시스템 호출
  { name: 'c_system', pattern: /\bsystem\s*\(/ },
  { name: 'c_popen', pattern: /\bpopen\s*\(/ },
  { name: 'c_execve', pattern: /\bexec[lv]p?e?\s*\(/ },
  { name: 'c_fork', pattern: /\bfork\s*\(\s*\)/ },
  // 메모리 위험 함수
  { name: 'c_unsafe_strcpy', pattern: /\b(strcpy|strcat|sprintf|gets)\s*\(/ },
  // 권한
  { name: 'c_setuid', pattern: /\bsetuid\s*\(/ },
  { name: 'c_setgid', pattern: /\bsetgid\s*\(/ },
  // 네트워크
  { name: 'c_socket', pattern: /\bsocket\s*\(\s*AF_INET\b/ },
  { name: 'c_connect', pattern: /\bconnect\s*\(/ },
  { name: 'c_bind', pattern: /\bbind\s*\(\s*[a-zA-Z_]\w*\s*,\s*\(/ },
  // 파일 파괴
  { name: 'c_unlink', pattern: /\bunlink\s*\(/ },
  { name: 'c_remove', pattern: /\bremove\s*\(\s*["']/ },
  // 함수 포인터 동적 호출
  { name: 'c_dlopen', pattern: /\bdlopen\s*\(/ },
  { name: 'c_dlsym', pattern: /\bdlsym\s*\(/ },
];

const JAVA_PATTERNS = [
  // 프로세스 실행
  { name: 'java_runtime_exec', pattern: /Runtime\.getRuntime\(\)\.exec\b/ },
  { name: 'java_process_builder', pattern: /\bProcessBuilder\b/ },
  // 동적 로딩
  { name: 'java_class_forname', pattern: /Class\.forName\b/ },
  { name: 'java_reflection_invoke', pattern: /\.getMethod\(.*\)\.invoke\(/ },
  // 네트워크
  { name: 'java_socket', pattern: /\b(new\s+)?Socket\s*\(/ },
  { name: 'java_server_socket', pattern: /\bServerSocket\b/ },
  { name: 'java_url_openconn', pattern: /\.openConnection\s*\(/ },
  { name: 'java_http_client', pattern: /\bHttpClient\b/ },
  // 파일 파괴
  { name: 'java_file_delete', pattern: /\.delete\s*\(\s*\)/ },
  { name: 'java_files_delete', pattern: /\bFiles\.delete\b/ },
  // 직렬화 역직렬화 (취약)
  { name: 'java_object_inputstream', pattern: /\bObjectInputStream\b/ },
  // 암호화
  { name: 'java_cipher', pattern: /\bCipher\.getInstance\b/ },
  // 권한
  { name: 'java_setsecurity', pattern: /\bSystem\.setSecurityManager\b/ },
];

const RUBY_PATTERNS = [
  // 쉘 실행 — 백틱·%x{}·system·exec·spawn·`open with |`
  { name: 'rb_backtick', pattern: /`[^`]*`/ },
  { name: 'rb_x_string', pattern: /%x[\{\(\[]/ },
  { name: 'rb_system_call', pattern: /(?<![.\w])(system|exec|spawn)\s*[\(\s]/ },
  { name: 'rb_open_pipe', pattern: /\bopen\s*\(\s*["']\|/ },
  // 코드 실행
  { name: 'rb_eval', pattern: /(?<![.\w])(eval|instance_eval|class_eval|module_eval)\s*\(/ },
  // 네트워크
  { name: 'rb_net_http', pattern: /\bNet::HTTP\b/ },
  { name: 'rb_socket', pattern: /\b(TCPSocket|UDPSocket|Socket)\b/ },
  { name: 'rb_open_uri', pattern: /\bopen-uri\b/ },
  // 파일 파괴
  { name: 'rb_file_delete', pattern: /\bFile\.(delete|unlink)\b/ },
  { name: 'rb_fileutils_rm', pattern: /\bFileUtils\.rm(_r|_rf|_f)?\b/ },
  // 직렬화 위험
  { name: 'rb_marshal_load', pattern: /\bMarshal\.load\b/ },
  { name: 'rb_yaml_load', pattern: /\bYAML\.(load|unsafe_load)\b/ },
];

// 언어 키를 정규화하여 매핑
const LANGUAGE_PATTERNS = {
  python: PYTHON_PATTERNS,
  py: PYTHON_PATTERNS,
  go: GO_PATTERNS,
  golang: GO_PATTERNS,
  rust: RUST_PATTERNS,
  rs: RUST_PATTERNS,
  c: C_PATTERNS,
  'c++': C_PATTERNS,
  cpp: C_PATTERNS,
  cxx: C_PATTERNS,
  java: JAVA_PATTERNS,
  ruby: RUBY_PATTERNS,
  rb: RUBY_PATTERNS,
};

const MAX_PREFILTER_LINES = 100;
const MAX_PREFILTER_CHARS = 3000;
const REDACTED_MARKER = /\[REDACTED_/;

/**
 * 코드가 사전필터를 통과(LLM 호출 스킵)할 수 있는지 판단한다.
 *
 * @param {string} code - 전처리/비식별화된 코드
 * @param {string} [language] - 프로그래밍 언어. 미지정/미지원 시 LLM으로 보냄
 * @returns {{ skip: boolean, reason: string, matchedRule?: string }}
 */
function prefilter(code, language) {
  const lineCount = code.split('\n').length;
  if (code.length > MAX_PREFILTER_CHARS || lineCount > MAX_PREFILTER_LINES) {
    return { skip: false, reason: 'too_long' };
  }

  if (REDACTED_MARKER.test(code)) {
    return { skip: false, reason: 'redacted_content' };
  }

  // 공통 패턴 (언어 무관) — 텍스트 자체가 위험하면 매칭
  for (const { name, pattern } of COMMON_PATTERNS) {
    if (pattern.test(code)) {
      return { skip: false, reason: 'pattern_match', matchedRule: name };
    }
  }

  // 언어별 패턴
  const langKey = (language || '').toLowerCase().trim();
  const langPatterns = LANGUAGE_PATTERNS[langKey];
  if (!langPatterns) {
    // 알 수 없는 언어 → 안전하게 LLM으로
    return { skip: false, reason: 'unsupported_language', matchedRule: langKey || 'unknown' };
  }

  for (const { name, pattern } of langPatterns) {
    if (pattern.test(code)) {
      return { skip: false, reason: 'pattern_match', matchedRule: name };
    }
  }

  return { skip: true, reason: 'no_risk_pattern' };
}

module.exports = {
  prefilter,
  COMMON_PATTERNS,
  LANGUAGE_PATTERNS,
  PYTHON_PATTERNS,
  GO_PATTERNS,
  RUST_PATTERNS,
  C_PATTERNS,
  JAVA_PATTERNS,
  RUBY_PATTERNS,
  MAX_PREFILTER_CHARS,
  MAX_PREFILTER_LINES,
};
