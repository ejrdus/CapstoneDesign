/**
 * 통합 평가 스크립트 — 12주차 과제: 탐지율/오탐률 측정
 *
 * tests/samples/benign 과 tests/samples/malicious 디렉토리의 모든 .py 샘플을
 * /api/analyze에 차례로 보내고, 결과를 모아 confusion matrix와 핵심 지표를
 * 산출한다. 결과는 tests/results/ 디렉토리에 JSON + Markdown으로 저장된다.
 *
 * 사용법:
 *   1) 서버 실행: npm run dev
 *   2) 다른 터미널에서: npm run evaluate -- --name baseline
 *      (이름 생략 시 timestamp만 사용)
 *
 * 옵션:
 *   --name <label>    결과 파일 라벨 (예: baseline, prefilter)
 *   --compare <path>  비교 대상 JSON 파일 경로 (이전 baseline과 diff)
 *
 * 각 샘플마다 aiService를 무작위 값으로 설정해 세션 컨텍스트 오염을 방지.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SAMPLES_DIR = path.join(__dirname, 'samples');
const RESULTS_DIR = path.join(__dirname, 'results');

// --- CLI 인자 파싱 ---
function parseArgs(argv) {
  const args = { name: null, compare: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--name' && argv[i + 1]) { args.name = argv[i + 1]; i += 1; }
    else if (a === '--compare' && argv[i + 1]) { args.compare = argv[i + 1]; i += 1; }
  }
  return args;
}

async function analyze(code, sampleName, maxRetries = 3) {
  // 샘플마다 다른 aiService 값을 사용 → 세션 누적 분석 비활성화 (단일 코드 평가)
  const sessionSalt = crypto.randomBytes(8).toString('hex');
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(`${SERVER_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language: 'python',
        aiService: `eval-${sampleName}-${sessionSalt}`,
      }),
    });
    if (response.ok) return response.json();

    const text = await response.text();
    lastErr = new Error(`HTTP ${response.status}: ${text}`);
    // 529(overloaded) / 5xx / 429(rate limit)는 백오프 후 재시도
    const retriable = response.status === 529 || response.status === 429 || response.status >= 500;
    if (!retriable || attempt === maxRetries) break;
    const waitMs = 5000 * attempt;
    process.stdout.write(`[retry ${attempt}/${maxRetries - 1} after ${waitMs / 1000}s] `);
    await new Promise((resolve) => { setTimeout(resolve, waitMs); });
  }
  throw lastErr;
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
      const prefiltered = r.details?.prefiltered === true;
      results.push({
        file,
        label,
        riskLevel: r.riskLevel,
        category: r.category,
        threatCount,
        threatTypes,
        elapsed: Number(elapsed),
        prefiltered,
      });
      console.log(`${r.riskLevel.padEnd(8)} (${threatCount} threats, ${elapsed}s${prefiltered ? ', pre-filtered' : ''})`);
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

function computeMetrics(cm) {
  const safeDiv = (n, d) => (d === 0 ? 0 : n / d);
  const { TP, FP, TN, FN } = cm;
  return {
    accuracy: safeDiv(TP + TN, TP + TN + FP + FN),
    precision: safeDiv(TP, TP + FP),
    recall: safeDiv(TP, TP + FN),
    f1: (() => {
      const p = safeDiv(TP, TP + FP);
      const r = safeDiv(TP, TP + FN);
      return safeDiv(2 * p * r, p + r);
    })(),
    fpRate: safeDiv(FP, FP + TN),
    fnRate: safeDiv(FN, FN + TP),
  };
}

function computeTiming(results) {
  const ok = results.filter((r) => !r.error);
  const total = ok.reduce((s, r) => s + r.elapsed, 0);
  const prefilterCount = ok.filter((r) => r.prefiltered).length;
  return {
    samples: ok.length,
    totalSeconds: Number(total.toFixed(1)),
    avgSeconds: ok.length ? Number((total / ok.length).toFixed(2)) : 0,
    prefilteredCount: prefilterCount,
    llmCallCount: ok.length - prefilterCount,
  };
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

function renderMarkdown(name, timestamp, all, cm, metrics, timing) {
  const lines = [];
  lines.push(`# 평가 리포트: ${name}`);
  lines.push('');
  lines.push(`- 생성 시각: ${timestamp}`);
  lines.push(`- 서버: ${SERVER_URL}`);
  lines.push(`- 총 샘플: ${all.length}개 (benign ${all.filter((r) => r.label === 'benign').length}, malicious ${all.filter((r) => r.label === 'malicious').length})`);
  lines.push('');

  lines.push('## 핵심 지표');
  lines.push('');
  lines.push('| 지표 | 값 |');
  lines.push('|---|---|');
  lines.push(`| Accuracy | ${(metrics.accuracy * 100).toFixed(1)}% |`);
  lines.push(`| Precision | ${(metrics.precision * 100).toFixed(1)}% |`);
  lines.push(`| Recall (탐지율) | ${(metrics.recall * 100).toFixed(1)}% |`);
  lines.push(`| F1 Score | ${(metrics.f1 * 100).toFixed(1)}% |`);
  lines.push(`| FP Rate (오탐률) | ${(metrics.fpRate * 100).toFixed(1)}% |`);
  lines.push(`| FN Rate (미탐률) | ${(metrics.fnRate * 100).toFixed(1)}% |`);
  lines.push('');

  lines.push('## Confusion Matrix');
  lines.push('');
  lines.push('| | Predicted Positive (caution/danger) | Predicted Negative (safe) |');
  lines.push('|---|---|---|');
  lines.push(`| **Actual Malicious** | TP = ${cm.TP} | FN = ${cm.FN} |`);
  lines.push(`| **Actual Benign** | FP = ${cm.FP} | TN = ${cm.TN} |`);
  lines.push('');

  lines.push('## 성능 (Timing)');
  lines.push('');
  lines.push(`- 총 소요: ${timing.totalSeconds}s`);
  lines.push(`- 평균: ${timing.avgSeconds}s/sample`);
  lines.push(`- LLM 호출: ${timing.llmCallCount}회`);
  lines.push(`- 사전필터 통과: ${timing.prefilteredCount}회`);
  lines.push('');

  lines.push('## 샘플별 상세 결과');
  lines.push('');
  lines.push('| File | Label | Predicted | Threats | 결과 |');
  lines.push('|---|---|---|---|---|');
  for (const r of all) {
    if (r.error) {
      lines.push(`| ${r.file} | ${r.label} | ERROR | - | ✗ |`);
      continue;
    }
    const predictedPositive = r.riskLevel === 'caution' || r.riskLevel === 'danger';
    const actualPositive = r.label === 'malicious';
    const correct = predictedPositive === actualPositive;
    lines.push(`| ${r.file} | ${r.label} | ${r.riskLevel} | ${r.threatCount} | ${correct ? '✓' : '✗'} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function pct(v) { return `${(v * 100).toFixed(1)}%`; }

function printComparison(baseline, current) {
  console.log('\n## 이전 결과와 비교 (baseline → current)');
  const m1 = baseline.metrics;
  const m2 = current.metrics;
  const t1 = baseline.timing;
  const t2 = current.timing;
  const diff = (a, b) => {
    const d = b - a;
    if (Math.abs(d) < 0.0001) return '±0.0%p';
    const sign = d > 0 ? '+' : '';
    return `${sign}${(d * 100).toFixed(1)}%p`;
  };
  console.log(`  Accuracy   ${pct(m1.accuracy).padStart(7)} → ${pct(m2.accuracy).padStart(7)}   (${diff(m1.accuracy, m2.accuracy)})`);
  console.log(`  Precision  ${pct(m1.precision).padStart(7)} → ${pct(m2.precision).padStart(7)}   (${diff(m1.precision, m2.precision)})`);
  console.log(`  Recall     ${pct(m1.recall).padStart(7)} → ${pct(m2.recall).padStart(7)}   (${diff(m1.recall, m2.recall)})`);
  console.log(`  F1         ${pct(m1.f1).padStart(7)} → ${pct(m2.f1).padStart(7)}   (${diff(m1.f1, m2.f1)})`);
  console.log(`  FP Rate    ${pct(m1.fpRate).padStart(7)} → ${pct(m2.fpRate).padStart(7)}   (${diff(m1.fpRate, m2.fpRate)})`);
  console.log(`  FN Rate    ${pct(m1.fnRate).padStart(7)} → ${pct(m2.fnRate).padStart(7)}   (${diff(m1.fnRate, m2.fnRate)})`);
  console.log(`  Avg time   ${String(t1.avgSeconds).padStart(5)}s → ${String(t2.avgSeconds).padStart(5)}s`);
  console.log(`  LLM calls  ${String(t1.llmCallCount).padStart(5)}  → ${String(t2.llmCallCount).padStart(5)}   (pre-filtered: ${t2.prefilteredCount})`);
}

async function main() {
  const args = parseArgs(process.argv);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label = args.name || 'run';

  // 서버 헬스 체크
  try {
    const h = await fetch(`${SERVER_URL}/health`);
    if (!h.ok) throw new Error(`status ${h.status}`);
  } catch (e) {
    console.error(`서버에 연결할 수 없습니다 (${SERVER_URL}): ${e.message}`);
    console.error('먼저 "npm run dev"로 서버를 실행하세요.');
    process.exit(1);
  }

  console.log(`평가 시작: ${SERVER_URL} (label=${label})`);
  console.log('각 샘플마다 고유 aiService 값 사용 (세션 컨텍스트 격리)\n');

  console.log('=== Benign (expected: safe) ===');
  const benign = await runDir('benign', path.join(SAMPLES_DIR, 'benign'));

  console.log('\n=== Malicious (expected: caution or danger) ===');
  const malicious = await runDir('malicious', path.join(SAMPLES_DIR, 'malicious'));

  const all = [...benign, ...malicious];
  const cm = buildConfusion(all);
  const metrics = computeMetrics(cm);
  const timing = computeTiming(all);

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
  console.log(`Actual Malicious  | TP = ${String(cm.TP).padEnd(15)}| FN = ${String(cm.FN).padEnd(15)}|`);
  console.log(`Actual Benign     | FP = ${String(cm.FP).padEnd(15)}| TN = ${String(cm.TN).padEnd(15)}|`);

  console.log('\n## 핵심 지표');
  console.log(`Accuracy   : ${pct(metrics.accuracy)}   (전체 정답 비율)`);
  console.log(`Precision  : ${pct(metrics.precision)}   (위험으로 분류한 것 중 실제 악성 비율)`);
  console.log(`Recall     : ${pct(metrics.recall)}   (탐지율 — 실제 악성을 잡아낸 비율)`);
  console.log(`F1 Score   : ${pct(metrics.f1)}   (Precision/Recall 조화평균)`);
  console.log(`FP Rate    : ${pct(metrics.fpRate)}   (오탐률 — 정상을 위험으로 잘못 분류한 비율)`);
  console.log(`FN Rate    : ${pct(metrics.fnRate)}   (미탐률 — 악성을 놓친 비율)`);

  // 성능
  console.log('\n## 성능');
  console.log(`총 소요 : ${timing.totalSeconds}s`);
  console.log(`평균    : ${timing.avgSeconds}s/sample`);
  console.log(`LLM 호출 : ${timing.llmCallCount}회 (사전필터 통과: ${timing.prefilteredCount}회)`);

  // 위험도 분포 (보조 정보)
  const dangerOf = (l) => all.filter((r) => r.label === l && r.riskLevel === 'danger').length;
  const cautionOf = (l) => all.filter((r) => r.label === l && r.riskLevel === 'caution').length;
  const safeOf = (l) => all.filter((r) => r.label === l && r.riskLevel === 'safe').length;
  console.log('\n## 위험도 분포 (참고)');
  console.log('              | danger | caution | safe');
  console.log(`Malicious     |   ${dangerOf('malicious')}    |    ${cautionOf('malicious')}    |   ${safeOf('malicious')}`);
  console.log(`Benign        |   ${dangerOf('benign')}    |    ${cautionOf('benign')}    |   ${safeOf('benign')}`);

  // 오류 케이스 별도 출력
  const errors = all.filter((r) => r.error);
  if (errors.length > 0) {
    console.log('\n## 분석 오류 발생 샘플');
    for (const e of errors) console.log(`  - ${e.file}: ${e.error}`);
  }

  // --- 결과 저장 ---
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const baseName = `${label}-${timestamp}`;
  const jsonPath = path.join(RESULTS_DIR, `${baseName}.json`);
  const mdPath = path.join(RESULTS_DIR, `${baseName}.md`);
  const report = {
    label,
    timestamp,
    serverUrl: SERVER_URL,
    samples: all,
    confusion: cm,
    metrics,
    timing,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(label, timestamp, all, cm, metrics, timing));
  console.log(`\n결과 저장: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`           ${path.relative(process.cwd(), mdPath)}`);

  // --- 비교 ---
  if (args.compare) {
    try {
      const baseline = JSON.parse(fs.readFileSync(args.compare, 'utf-8'));
      printComparison(baseline, report);
    } catch (e) {
      console.error(`\n비교 파일 로드 실패 (${args.compare}): ${e.message}`);
    }
  }

  console.log('\n평가 완료.');
}

main().catch((err) => {
  console.error('평가 실패:', err);
  process.exit(1);
});
