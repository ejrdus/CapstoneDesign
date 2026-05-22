import React, { useMemo } from 'react';

// LLM이 반환하는 threats 카테고리(한국어)에 표시할 라벨/색
const TYPE_LABEL = {
  file_destruction: '파일 파괴',
  reverse_shell: '역방향 셸',
  privilege_escalation: '권한 상승',
  data_exfiltration: '정보 유출',
  ransomware: '랜섬웨어',
  obfuscation: '난독화',
  network_access: '네트워크',
  code_execution: '코드 실행',
  analyzer_subversion: '분석기 우회',
};

/**
 * 히스토리에서 위협 유형별 등장 횟수를 막대로 보여주는 mini chart.
 * danger/caution 항목의 details.threats 배열을 집계.
 */
export default function ThreatChart({ history }) {
  const { rows, total } = useMemo(() => {
    const counts = {};
    for (const item of history) {
      if (item.riskLevel !== 'danger' && item.riskLevel !== 'caution') continue;
      const threats = item.details && Array.isArray(item.details.threats) ? item.details.threats : [];
      // details가 history에 없는 케이스가 있어, fallback으로 category 한 건 카운트
      if (threats.length === 0 && item.category) {
        counts['__category'] = (counts['__category'] || 0) + 1;
        continue;
      }
      for (const t of threats) {
        const key = t.type || t.category || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    const entries = Object.entries(counts)
      .filter(([k]) => k !== '__category')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const totalCount = entries.reduce((s, [, n]) => s + n, 0);
    return { rows: entries, total: totalCount };
  }, [history]);

  if (rows.length === 0) return null;

  const max = Math.max(...rows.map(([, n]) => n));

  return (
    <div className="threat-chart">
      <div className="threat-chart-title">위협 유형 분포 (Top {rows.length})</div>
      <div className="threat-chart-rows">
        {rows.map(([type, count]) => {
          const pct = Math.round((count / max) * 100);
          return (
            <div className="threat-row" key={type}>
              <span className="threat-row-label">{TYPE_LABEL[type] || type}</span>
              <div className="threat-row-bar">
                <div
                  className="threat-row-fill"
                  style={{ width: `${Math.max(pct, 6)}%` }}
                />
              </div>
              <span className="threat-row-count">{count}</span>
            </div>
          );
        })}
      </div>
      <div className="threat-chart-total">총 위협 인스턴스: {total}건</div>
    </div>
  );
}
