/**
 * confidence 캘리브레이션 분석 도구
 *
 * 목적: 시스템의 confidence가 "데이터 기준으로 실제로 잘 맞는지"를 측정한다.
 * (현재 0.7/0.3 임계값은 직관으로 정해졌고 캘리브레이션 데이터가 없다는 한계 해소용)
 *
 * 입력: evaluate.js가 생성한 결과 JSON (samples[].confidence + samples[].label/riskLevel 포함)
 * 출력:
 *   1) Reliability diagram 데이터 — confidence 구간별 건수·평균신뢰도·실제 정확도
 *   2) ECE(Expected Calibration Error) — 신뢰도와 실제 정확도의 가중 평균 격차
 *   3) danger 임계값 스윕 — CONFIDENCE_THRESHOLD를 바꿔가며 악성 탐지(recall)/오탐(FP) 변화
 *
 * 사용법:
 *   node tests/calibrate.js tests/results/<result>.json
 *   npm run calibrate -- tests/results/<result>.json
 *
 * 주의: 의미 있는 캘리브레이션을 위해선 표본이 충분(수백 개 이상)해야 한다. 표본이
 *       작으면 참고용 지표로만 보라.
 */

const fs = require('fs');
const path = require('path');

function loadReport(file) {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  if (!Array.isArray(data.samples)) {
    throw new Error('결과 JSON에 samples 배열이 없습니다. evaluate.js로 생성한 파일인지 확인하세요.');
  }
  return data;
}

// 예측이 맞았는지: (caution|danger)=positive, label=malicious=positive 기준
function isCorrect(s) {
  const predictedPositive = s.riskLevel === 'caution' || s.riskLevel === 'danger';
  const actualPositive = s.label === 'malicious';
  return predictedPositive === actualPositive;
}

function fmtPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function reliabilityBins(samples, nBins = 10) {
  const withConf = samples.filter((s) => typeof s.confidence === 'number' && !s.error);
  const bins = Array.from({ length: nBins }, () => ({ n: 0, confSum: 0, correct: 0 }));
  for (const s of withConf) {
    const c = Math.max(0, Math.min(0.999999, s.confidence));
    const idx = Math.floor(c * nBins);
    bins[idx].n += 1;
    bins[idx].confSum += s.confidence;
    if (isCorrect(s)) bins[idx].correct += 1;
  }
  return { bins, total: withConf.length };
}

function expectedCalibrationError(bins, total) {
  if (total === 0) return null;
  let ece = 0;
  for (const b of bins) {
    if (b.n === 0) continue;
    const avgConf = b.confSum / b.n;
    const acc = b.correct / b.n;
    ece += (b.n / total) * Math.abs(avgConf - acc);
  }
  return ece;
}

function thresholdSweep(samples) {
  // block-tier 위협이 있고 confidence로 danger/caution이 갈리는 표본에 대해,
  // 임계값 t를 바꾸면 danger 비율이 어떻게 변하는지 본다. eval 지표상 caution/danger 모두
  // positive이므로 recall은 동일하나, "확정 차단(danger)" 비율과 그 정확도를 본다.
  const mal = samples.filter((s) => s.label === 'malicious' && typeof s.confidence === 'number' && !s.error);
  const ben = samples.filter((s) => s.label === 'benign' && typeof s.confidence === 'number' && !s.error);
  const rows = [];
  for (let t = 0.3; t <= 0.95 + 1e-9; t += 0.05) {
    // 모델이 실제로 내린 danger 판정 중, confidence >= t였던 비율로 근사
    const malDangerAtT = mal.filter((s) => s.riskLevel === 'danger' && s.confidence >= t).length;
    const benDangerAtT = ben.filter((s) => s.riskLevel === 'danger' && s.confidence >= t).length;
    rows.push({
      t: t.toFixed(2),
      malDanger: malDangerAtT,
      malTotal: mal.length,
      benDanger: benDangerAtT,
      benTotal: ben.length,
    });
  }
  return rows;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('사용법: node tests/calibrate.js <result.json>');
    process.exit(1);
  }
  const report = loadReport(file);
  const samples = report.samples;
  const usable = samples.filter((s) => typeof s.confidence === 'number' && !s.error);

  console.log(`\n# confidence 캘리브레이션 분석 — ${path.basename(file)}`);
  console.log(`총 표본: ${samples.length}개 (confidence 보유: ${usable.length}개)`);
  if (usable.length === 0) {
    console.log('\nconfidence 값을 가진 표본이 없습니다. 최신 evaluate.js로 결과를 다시 생성하세요.');
    return;
  }
  if (usable.length < 100) {
    console.log('⚠️  표본이 100개 미만 — 아래 지표는 참고용입니다(통계적 신뢰 낮음).');
  }

  const { bins, total } = reliabilityBins(usable);
  console.log('\n## Reliability Diagram (confidence 구간별)');
  console.log('| 구간 | 건수 | 평균 confidence | 실제 정확도 | 격차 |');
  console.log('|---|---|---|---|---|');
  for (let i = 0; i < bins.length; i += 1) {
    const b = bins[i];
    if (b.n === 0) continue;
    const lo = (i / bins.length).toFixed(1);
    const hi = ((i + 1) / bins.length).toFixed(1);
    const avgConf = b.confSum / b.n;
    const acc = b.correct / b.n;
    const gap = avgConf - acc;
    const sign = gap > 0 ? '과신' : (gap < 0 ? '과소' : '');
    console.log(`| ${lo}~${hi} | ${b.n} | ${fmtPct(avgConf)} | ${fmtPct(acc)} | ${(gap * 100).toFixed(1)}%p ${sign} |`);
  }

  const ece = expectedCalibrationError(bins, total);
  console.log(`\n## ECE (Expected Calibration Error): ${fmtPct(ece)}`);
  console.log('  - 0%에 가까울수록 confidence가 잘 캘리브레이션됨.');
  console.log('  - 값이 크고 대부분 "과신"이면 → 임계값을 높이거나 confidence를 보정(Platt/isotonic) 권장.');

  console.log('\n## danger 임계값 스윕 (CONFIDENCE_THRESHOLD 후보)');
  console.log('| t | 악성→danger | 정상→danger(오차단) |');
  console.log('|---|---|---|');
  for (const r of thresholdSweep(usable)) {
    console.log(`| ${r.t} | ${r.malDanger}/${r.malTotal} | ${r.benDanger}/${r.benTotal} |`);
  }
  console.log('\n  - 악성→danger가 높고 정상→danger가 0에 가까운 t가 이상적.');
  console.log('  - 현재 코드 기본값은 0.70 (riskClassifier.CONFIDENCE_THRESHOLD).');
  console.log('');
}

main();
