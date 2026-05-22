/**
 * 사전필터 단위 테스트 — LLM 호출 없이 16개 샘플 전체 검증
 *
 * 검증 기준:
 *   - malicious 샘플 9개: 모두 사전필터에서 차단되어야 함 (skip=false)
 *   - benign 샘플 7개: 통과 가능한 것은 통과, 위험 패턴이 있는 것은 LLM으로
 *
 * False negative (악성을 통과시킴) 가 발생하면 테스트 실패.
 */

const fs = require('fs');
const path = require('path');
const { prefilter } = require('../src/utils/prefilter');
const { anonymize } = require('../src/utils/anonymizer');
const { preprocessCode } = require('../src/utils/codePreprocessor');

const SAMPLES_DIR = path.join(__dirname, 'samples');

// 확장자 → 언어 매핑
const EXT_TO_LANG = {
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.java': 'java',
  '.rb': 'ruby',
};

function checkDir(label, dir) {
  const files = fs.readdirSync(dir)
    .filter((f) => Object.keys(EXT_TO_LANG).some((ext) => f.endsWith(ext)))
    .sort();
  const results = [];
  for (const file of files) {
    const code = fs.readFileSync(path.join(dir, file), 'utf-8');
    const ext = '.' + file.split('.').pop();
    const language = EXT_TO_LANG[ext];
    const clean = preprocessCode(code);
    const { anonymized } = anonymize(clean);
    const pf = prefilter(anonymized, language);
    results.push({ file, label, language, ...pf });
  }
  return results;
}

function main() {
  console.log('=== 사전필터 단위 테스트 ===\n');

  const benign = checkDir('benign', path.join(SAMPLES_DIR, 'benign'));
  const malicious = checkDir('malicious', path.join(SAMPLES_DIR, 'malicious'));

  console.log('[Benign — 통과 가능]');
  for (const r of benign) {
    const verdict = r.skip ? '✓ skip(LLM 안 부름)' : `→ LLM (${r.reason}${r.matchedRule ? ': ' + r.matchedRule : ''})`;
    console.log(`  ${r.file.padEnd(28)} ${verdict}`);
  }

  console.log('\n[Malicious — 모두 LLM으로 가야 함]');
  let falseNegatives = 0;
  for (const r of malicious) {
    if (r.skip) {
      console.log(`  ${r.file.padEnd(28)} ✗ FALSE NEGATIVE — 사전필터가 악성을 safe로 흘림!`);
      falseNegatives += 1;
    } else {
      console.log(`  ${r.file.padEnd(28)} ✓ LLM (${r.reason}${r.matchedRule ? ': ' + r.matchedRule : ''})`);
    }
  }

  const benignSkipped = benign.filter((r) => r.skip).length;
  const benignTotal = benign.length;
  const maliciousBlocked = malicious.filter((r) => !r.skip).length;
  const maliciousTotal = malicious.length;

  console.log('\n=== 요약 ===');
  console.log(`Benign 사전필터 통과율: ${benignSkipped}/${benignTotal} (${((benignSkipped / benignTotal) * 100).toFixed(0)}%) → LLM 호출 절감`);
  console.log(`Malicious 차단율:       ${maliciousBlocked}/${maliciousTotal} (${((maliciousBlocked / maliciousTotal) * 100).toFixed(0)}%) → LLM으로 정상 전달`);

  if (falseNegatives > 0) {
    console.error(`\n❌ 테스트 실패 — false negative ${falseNegatives}건 발생`);
    process.exit(1);
  }
  console.log('\n✅ 테스트 통과 — false negative 0건');
}

main();
