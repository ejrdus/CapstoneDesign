/**
 * Shadow DOM 브릿지 초기화 (document_start 시점)
 *
 * Gemini의 closed Shadow DOM을 우회하기 위해
 * 페이지 스크립트보다 먼저 attachShadow를 패치한다.
 * 이 파일은 별도 content_scripts 엔트리로 document_start에 로드됨.
 */

import { injectShadowDomBridge } from './shadowDomBridge';

// Gemini 도메인에서만 실행
injectShadowDomBridge();
