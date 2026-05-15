/**
 * 통합 평가 스크립트 — 12주차 과제: 탐지율/오탐률 측정
 *
 * tests/samples/benign 과 tests/samples/malicious 디렉토리의 모든 .py 샘플을
 * /api/analyze에 차례로 보내고, 결과를 모아 confusion matrix와 핵심 지표를
 * 산출한다.
 *
 * 사용법:
 *   1) 서버 실행: npm run dev
 *   2) 다른 터미널에서: npm run evaluate
 *
 * 각 샘플마다 aiService를 무작위 값으로 설정해 세션 컨텍스트 오염을 방지.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SAMPLES_DIR = path.join(__dirname, 'samples');

async function analyze(code, sampleName) {
  // 샘플마다 다른 aiService 값을 사용 → 세션 누적 분석 비활성화 (단일 코드 평가)
  const sessionSalt = crypto.randomBytes(8).toString('hex');
  const response = await fetch(`${SERVER_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      language: 'python',
      aiService: `eval-${sampleName}-${sessionSalt}`,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function runDir(label, dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.py')).sort();
  const results = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    const code = fs.readFileSync(filePath, 'utf-8');
    process.stdout.write(`  ${file.padEnd(35)} ... `);
    const t0 = Date.now();
    try {
      const r = await analyze(code, file);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const threatCount = r.details?.threats?.length || 0;
      const threatTypes = (r.details?.threats || []).map((t) => t.type);
      results.push({
        file,
        label,
        riskLevel: r.riskLevel,
        category: r.category,
        threatCount,
        threatTypes,
        elapsed,
      });
      console.log(`${r.riskLevel.padEnd(8)} (${threatCount} threats, ${elapsed}s)`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ file, label, error: err.message });
    }
  }
  return results;
}

function buildConfusion(results) {
  // Positive = malicious. Threshold: caution or danger = positive prediction.
  let TP = 0; let FP = 0; let TN = 0; let FN = 0;
  for (const r of results) {
    if (r.error) continue;
    const predictedPositive = r.riskLevel === 'caution' || r.riskLevel === 'danger';
    const actualPositive = r.label === 'malicious';
    if (predictedPositive && actualPositive) TP += 1;
    else if (predictedPositive && !actualPositive) FP += 1;
    else if (!predictedPositive && !actualPositive) TN += 1;
    else FN += 1;
  }
  return { TP, FP, TN, FN };
}

function formatTable(title, headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const sep = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
  const fmtRow = (cells) => '|' + cells.map((c, i) => ' ' + String(c).padEnd(widths[i]) + ' ').join('|') + '|';
  console.log(`\n${title}`);
  console.log(sep);
  console.log(fmtRow(headers));
  console.log(sep);
  for (const r of rows) console.log(fmtRow(r));
  console.log(sep);
}

async function main() {
  // 서버 헬스 체크
  try {
    const h = await fetch(`${SERVER_URL}/health`);
    if (!h.ok) throw new Error(`status ${h.status}`);
  } catch (e) {
    console.error(`서버에 연결할 수 없습니다 (${SERVER_URL}): ${e.message}`);
    console.error('먼저 "npm run dev"로 서버를 실행하세요.');
    process.exit(1);
  }

  console.log(`평가 시작: ${SERVER_URL}`);
  console.log(`각 샘플마다 고유 aiService 값 사용 (세션 컨텍스트 격리)\n`);

  console.log('=== Benign (expected: safe) ===');
  const benign = await runDir('benign', path.join(SAMPLES_DIR, 'benign'));

  console.log('\n=== Malicious (expected: caution or danger) ===');
  const malicious = await runDir('malicious', path.join(SAMPLES_DIR, 'malicious'));

  const all = [...benign, ...malicious];
  const { TP, FP, TN, FN } = buildConfusion(all);

  // 상세 결과 표
  formatTable(
    '\n## 샘플별 상세 결과',
    ['File', 'Label', 'Predicted', 'Threats', '결과'],
    all.filter((r) => !r.error).map((r) => {
      const predictedPositive = r.riskLevel === 'caution' || r.riskLevel === 'danger';
      const actualPositive = r.label === 'malicious';
      const correct = predictedPositive === actualPositive;
      const verdict = correct ? '✓' : '✗';
      return [r.file, r.label, r.riskLevel, r.threatCount, verdict];
    }),
  );

  // Confusion matrix
  console.log('\n## Confusion Matrix');
  console.log('                  | Predicted Positive | Predicted Negative |');
  console.log('                  | (caution/danger)   | (safe)             |');
  console.log('------------------+--------------------+--------------------+');
  console.log(`Actual Malicious  | TP = ${String(TP).padEnd(15)}| FN = ${String(FN).padEnd(15)}|`);
  console.log(`Actual Benign     | FP = ${String(FP).padEnd(15)}| TN = ${String(TN).padEnd(15)}|`);

  // 지표
  const safeDiv = (n, d) => (d === 0 ? 0 : n / d);
  const accuracy = safeDiv(TP + TN, TP + TN + FP + FN);
  const precision = safeDiv(TP, TP + FP);
  const recall = safeDiv(TP, TP + FN);
  const f1 = safeDiv(2 * precision * recall, precision + recall);
  const fpRate = safeDiv(FP, FP + TN);
  const fnRate = safeDiv(FN, FN + TP);

  console.log('\n## 핵심 지표');
  console.log(`Accuracy   : ${(accuracy * 100).toFixed(1)}%   (전체 정답 비율)`);
  console.log(`Precision  : ${(precision * 100).toFixed(1)}%   (위험으로 분류한 것 중 실제 악성 비율)`);
  console.log(`Recall     : ${(recall * 100).toFixed(1)}%   (탐지율 — 실제 악성을 잡아낸 비율)`);
  console.log(`F1 Score   : ${(f1 * 100).toFixed(1)}%   (Precision/Recall 조화평균)`);
  console.log(`FP Rate    : ${(fpRate * 100).toFixed(1)}%   (오탐률 — 정상을 위험으로 잘못 분류한 비율)`);
  console.log(`FN Rate    : ${(fnRate * 100).toFixed(1)}%   (미탐률 — 악성을 놓친 비율)`);

  // 위험도 분포 (보조 정보)
  const dangerOf = (label) => all.filter((r) => r.label === label && r.riskLevel === 'danger').length;
  const cautionOf = (label) => all.filter((r) => r.label === label && r.riskLevel === 'caution').length;
  const safeOf = (label) => all.filter((r) => r.label === label && r.riskLevel === 'safe').length;
  console.log('\n## 위험도 분포 (참고)');
  console.log(`              | danger | caution | safe`);
  console.log(`Malicious     |   ${dangerOf('malicious')}    |    ${cautionOf('malicious')}    |   ${safeOf('malicious')}`);
  console.log(`Benign        |   ${dangerOf('benign')}    |    ${cautionOf('benign')}    |   ${safeOf('benign')}`);

  // 오류 케이스 별도 출력
  const errors = all.filter((r) => r.error);
  if (errors.length > 0) {
    console.log('\n## 분석 오류 발생 샘플');
    for (const e of errors) console.log(`  - ${e.file}: ${e.error}`);
  }

  console.log('\n평가 완료.');
}

main().catch((err) => {
  console.error('평가 실패:', err);
  process.exit(1);
});
