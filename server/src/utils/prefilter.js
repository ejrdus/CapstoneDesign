/**
 * 사전필터(Prefilter) 모듈
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
 *   3) HIGH_RISK_PATTERNS 중 어느 것도 매칭되지 않음
 */

const HIGH_RISK_PATTERNS = [
  // 코드 실행 — 메서드 접근(re.compile, foo.eval 등)은 제외하기 위해 lookbehind 사용
  { name: 'exec_call', pattern: /(?<![.\w])exec\s*\(/ },
  { name: 'eval_call', pattern: /(?<![.\w])eval\s*\(/ },
  { name: 'compile_call', pattern: /(?<![.\w])compile\s*\(/ },
  { name: 'dunder_import', pattern: /__import__\s*\(/ },

  // 쉘/프로세스 실행
  { name: 'subprocess', pattern: /\bsubprocess\b/ },
  { name: 'os_system', pattern: /\bos\.system\b/ },
  { name: 'os_popen', pattern: /\bos\.popen\b/ },
  { name: 'pty_spawn', pattern: /\bpty\.spawn\b/ },
  { name: 'commands_legacy', pattern: /\bcommands\.(getoutput|getstatusoutput)\b/ },

  // 네트워크 (in/outbound)
  { name: 'socket', pattern: /\bsocket\b/ },
  { name: 'requests', pattern: /\brequests\b/ },
  { name: 'urllib', pattern: /\burllib\b/ },
  { name: 'http_client', pattern: /\bhttp\.client\b/ },
  { name: 'ftplib', pattern: /\bftplib\b/ },
  { name: 'smtplib', pattern: /\bsmtplib\b/ },
  { name: 'paramiko', pattern: /\bparamiko\b/ },
  { name: 'pysftp', pattern: /\bpysftp\b/ },

  // 파일 파괴/제거
  { name: 'shutil_rmtree', pattern: /\bshutil\.rmtree\b/ },
  { name: 'os_remove', pattern: /\bos\.remove\b/ },
  { name: 'os_unlink', pattern: /\bos\.unlink\b/ },
  { name: 'os_rmdir', pattern: /\bos\.rmdir\b/ },

  // 모니터링/키로거
  { name: 'pynput', pattern: /\bpynput\b/ },
  { name: 'keyboard_lib', pattern: /\bkeyboard\b/ },
  { name: 'pyHook', pattern: /\bpyHook\b/ },
  { name: 'ctypes', pattern: /\bctypes\b/ },
  { name: 'win32_api', pattern: /\bwin32(api|gui|con)\b/ },

  // 암호화 (랜섬웨어 의심)
  { name: 'fernet', pattern: /\bFernet\b/ },
  { name: 'aes', pattern: /\bAES\b/ },
  { name: 'cipher', pattern: /\bcipher\b/i },
  { name: 'cryptography_lib', pattern: /\bcryptography\./ },
  { name: 'crypto_mod', pattern: /\bCrypto\./ },
  { name: 'encrypt_method', pattern: /\.encrypt\s*\(/ },

  // 권한 상승
  { name: 'setuid', pattern: /\bos\.setuid\b/ },
  { name: 'etc_sensitive', pattern: /\/etc\/(passwd|shadow|sudoers)/ },
  { name: 'sudo_cmd', pattern: /\bsudo\s+/ },

  // 난독화/디코더
  { name: 'base64_decode', pattern: /base64\.b(64|32|16)decode/ },
  { name: 'zlib_decompress', pattern: /\bzlib\.decompress\b/ },
  { name: 'marshal_loads', pattern: /\bmarshal\.(loads|load)\b/ },
  { name: 'pickle_loads', pattern: /\bpickle\.(loads|load)\b/ },

  // 역쉘 패턴
  { name: 'bash_interactive', pattern: /bash\s+-i\b/ },
  { name: 'dev_tcp', pattern: /\/dev\/tcp\// },
  { name: 'nc_listen_exec', pattern: /\bnc\s+-[le]/ },

  // 동적 스코프 조작
  { name: 'globals_call', pattern: /\bglobals\s*\(\s*\)/ },
  { name: 'locals_call', pattern: /\blocals\s*\(\s*\)/ },

  // 위험 파일 열기
  { name: 'open_sensitive', pattern: /\bopen\s*\(\s*['"](\/etc\/|\/proc\/|\/sys\/)/ },

  // 환경변수 dump
  { name: 'env_dump', pattern: /os\.environ\.(copy|items|keys)\s*\(/ },
];

const MAX_PREFILTER_LINES = 100;
const MAX_PREFILTER_CHARS = 3000;
const REDACTED_MARKER = /\[REDACTED_/;

/**
 * 코드가 사전필터를 통과(LLM 호출 스킵)할 수 있는지 판단한다.
 *
 * @param {string} code - 전처리/비식별화된 코드
 * @returns {{ skip: boolean, reason: string, matchedRule?: string }}
 *   skip=true  → safe로 즉시 반환 가능
 *   skip=false → LLM 분석 필요 (reason은 통과 거부 사유)
 */
function prefilter(code) {
  const lineCount = code.split('\n').length;
  if (code.length > MAX_PREFILTER_CHARS || lineCount > MAX_PREFILTER_LINES) {
    return { skip: false, reason: 'too_long' };
  }

  if (REDACTED_MARKER.test(code)) {
    return { skip: false, reason: 'redacted_content' };
  }

  for (const { name, pattern } of HIGH_RISK_PATTERNS) {
    if (pattern.test(code)) {
      return { skip: false, reason: 'pattern_match', matchedRule: name };
    }
  }

  return { skip: true, reason: 'no_risk_pattern' };
}

module.exports = {
  prefilter,
  HIGH_RISK_PATTERNS,
  MAX_PREFILTER_CHARS,
  MAX_PREFILTER_LINES,
};
