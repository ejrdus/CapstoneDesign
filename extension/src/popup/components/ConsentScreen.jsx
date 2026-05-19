import React from 'react';

export default function ConsentScreen({ onAccept }) {
  return (
    <div className="consent-screen">
      <div className="consent-icon">🛡️</div>
      <h2 className="consent-title">AI Script Monitor</h2>
      <p className="consent-subtitle">코드 보안 분석 서비스</p>

      <div className="consent-box">
        <div className="consent-section-title">데이터 전송 안내</div>
        <ul className="consent-list">
          <li>AI 응답에 포함된 코드가 <strong>분석 서버</strong>로 전송됩니다.</li>
          <li>전송 전 API 키, 비밀번호 등 민감 정보는 <strong>자동 비식별화</strong>됩니다.</li>
          <li>분석 결과는 <strong>24시간 후 자동 삭제</strong>됩니다.</li>
          <li>수집된 데이터는 보안 분석 목적으로만 사용됩니다.</li>
        </ul>
      </div>

      <button className="consent-accept-btn" onClick={onAccept}>
        동의하고 시작하기
      </button>

      <p className="consent-footer">
        설정 탭에서 언제든 서버 주소를 변경하거나 분석을 비활성화할 수 있습니다.
      </p>
    </div>
  );
}
