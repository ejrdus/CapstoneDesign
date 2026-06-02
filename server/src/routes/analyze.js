const express = require('express');
const router = express.Router();
const { validateAnalyzeRequest, normalizeLanguage } = require('../utils/validator');
const { preprocessCode } = require('../utils/codePreprocessor');
const { anonymize, logRedactions } = require('../utils/anonymizer');
const { prefilter } = require('../utils/prefilter');
const { analyzeWithLLM, analyzeBatchWithLLM } = require('../services/llmService');
const { classifyRisk } = require('../services/riskClassifier');
const { recordAnalysis, getSessionHistory } = require('../services/sessionTracker');
const { detectAttackChain } = require('../services/multiStageDetector');
const db = require('../database');

/**
 * POST /api/analyze
 * 코드 보안 분석 요청
 */
router.post('/', async (req, res, next) => {
  try {
    // 1. 요청 검증
    const validation = validateAnalyzeRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }

    const { code, aiService, sessionId } = req.body;
    const language = normalizeLanguage(req.body.language); // python3→python 등 별칭 정규화

    // 2. 코드 전처리
    const cleanCode = preprocessCode(code);

    // 2-1. 비식별화 (민감 정보 마스킹)
    const { anonymized: anonymizedCode, replacements } = anonymize(cleanCode);
    logRedactions(replacements);

    // 2-2. 사전필터 — 위험 패턴이 전혀 없는 짧은 코드는 LLM 호출 스킵
    //      언어 미지정/미지원 시 사전필터를 통과시키지 않고 LLM으로 보냄
    const pf = prefilter(anonymizedCode, language);

    let result;
    if (pf.skip) {
      console.log(`[Prefilter] LLM skip (${pf.reason})`);
      result = {
        riskLevel: 'safe',
        category: '정상',
        reason: '위험 패턴이 감지되지 않았습니다 (사전필터).',
        details: {
          intent: '단순 코드 — 위험 호출/네트워크/암호화/난독화 패턴 없음',
          confidence: 0.85,
          threats: [],
          prefiltered: true,
          prefilterReason: pf.reason,
        },
        analyzedAt: new Date().toISOString(),
      };
    } else {
      // 3. LLM 의미 분석 (비식별화된 코드로 분석, 인젝션 방어는 시스템 프롬프트에 내장됨)
      const llmResult = await analyzeWithLLM(anonymizedCode, language);

      // 4. 단일 코드 블록 위험도 판정
      //    LLM이 분석을 거부(refused)하면 = 분석기가 거부할 만큼 위험한 코드 → danger로 확정
      let riskResult;
      if (llmResult.refused) {
        riskResult = {
          riskLevel: 'danger',
          category: 'LLM 분석 거부 (고위험)',
          reason: 'LLM이 안전상의 이유로 분석을 거부했습니다 — 분석기가 거부할 정도로 위험한 코드로 간주하여 차단합니다.',
          details: { ...llmResult },
        };
      } else {
        riskResult = classifyRisk(llmResult);
      }

      result = {
        riskLevel: riskResult.riskLevel,
        category: riskResult.category,
        reason: riskResult.reason,
        details: { ...riskResult.details, prefiltered: false, prefilterReason: pf.reason },
        analyzedAt: new Date().toISOString(),
      };
    }

    // 5. 세션 누적 분석 (다단계 공격 체인 탐지)
    //    conversationId(sessionId) 우선 — NAT 환경에서 IP 충돌 방지
    recordAnalysis(sessionId, req.ip, aiService, result);
    const sessionHistory = getSessionHistory(sessionId, req.ip, aiService);
    const chainDetection = detectAttackChain(sessionHistory);

    if (chainDetection) {
      result.sessionContext = {
        historyLength: chainDetection.historyLength,
        seenThreatTypes: chainDetection.seenTypes,
        matchedAttackChains: chainDetection.matchedPatterns,
        broadPatternDetected: chainDetection.broadPattern,
      };

      const matchedChains = chainDetection.matchedPatterns;
      if (matchedChains.length > 0 || chainDetection.broadPattern) {
        console.log(
          `[Session] history=${chainDetection.historyLength} `
          + `types=[${chainDetection.seenTypes.join(',')}] `
          + `chains=[${matchedChains.map((p) => p.name).join(',') || 'none'}] `
          + `broad=${chainDetection.broadPattern}`,
        );
      }

      // 다단계 공격 체인 에스컬레이션 — 개별 블록은 caution으로 강등됐어도, 세션에 누적된
      // 위협들이 알려진 공격 체인(랜섬웨어/RCE/유출/백도어)을 이루면 danger로 승격한다.
      // (broadPattern 단독은 노이즈가 많아 승격하지 않고 참고 정보로만 둔다)
      if (matchedChains.length > 0 && result.riskLevel === 'caution') {
        const chainNames = matchedChains.map((p) => p.name).join(', ');
        result.riskLevel = 'danger';
        result.reason += ` [다단계 공격 체인 탐지: ${chainNames} — 세션 누적 위협으로 위험도 승격]`;
        result.sessionContext.escalated = true;
        console.log(`[Session] riskLevel 승격 caution→danger (chains: ${chainNames})`);
      }
    }

    // 6. 분석 로그 DB 저장 (비식별화된 코드만 저장)
    try {
      db.prepare(`
        INSERT INTO analysis_logs (code, language, ai_service, risk_level, category, reason, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        anonymizedCode,
        language || 'unknown',
        aiService || 'Unknown',
        result.riskLevel,
        result.category,
        result.reason,
        JSON.stringify(result.details),
        db.hashIp(req.ip)
      );
    } catch (dbErr) {
      console.error('[DB] 로그 저장 실패:', dbErr.message);
    }

    // 7. 응답
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/analyze/batch
 * 여러 코드 블록을 한 번에 분석 (메시지 단위 일괄 분석).
 * 각 블록별로 전처리 → 비식별화 → 사전필터를 적용한 뒤, 사전필터를 통과하지
 * 못한 블록만 묶어 LLM에 한 번만 호출한다.
 *
 * body:  { blocks: [{ id, code, language }, ...], aiService? }
 * resp:  { results: [{ id, riskLevel, category, reason, details }, ...] }
 */
router.post('/batch', async (req, res, next) => {
  try {
    const { blocks, aiService } = req.body || {};
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ error: 'blocks 배열이 필요합니다.' });
    }
    if (blocks.length > 20) {
      return res.status(400).json({ error: '한 번에 최대 20개 블록까지 분석 가능합니다.' });
    }

    // 블록별 전처리 + 비식별화 + 사전필터
    const prepared = blocks.map((b) => {
      const id = String(b.id);
      const language = normalizeLanguage(b.language); // 별칭 정규화 (python3→python 등)
      const cleanCode = preprocessCode(b.code || '');
      const { anonymized, replacements } = anonymize(cleanCode);
      logRedactions(replacements);
      const pf = prefilter(anonymized, language);
      return { id, language, anonymized, prefilter: pf };
    });

    // 사전필터로 통과 가능한 블록은 LLM 호출 없이 즉시 결과 생성
    const llmTargets = prepared.filter((p) => !p.prefilter.skip);

    let llmResults = [];
    if (llmTargets.length > 0) {
      llmResults = await analyzeBatchWithLLM(
        llmTargets.map((p) => ({ id: p.id, code: p.anonymized, language: p.language }))
      );
    }
    const llmById = new Map(llmResults.map((r) => [String(r.blockId), r]));

    // LLM이 일부 블록을 누락/재정렬했는지 확인 — 조용히 누락되면 'unknown' fallback이
    // 나가므로, 운영 가시성을 위해 명시적으로 경고 로깅한다.
    const missingIds = llmTargets.filter((p) => !llmById.has(p.id)).map((p) => p.id);
    if (missingIds.length > 0) {
      console.warn(`[Batch] LLM 응답 누락 blockIds=[${missingIds.join(',')}] (요청 ${llmTargets.length}건 중 ${missingIds.length}건 누락)`);
    }

    // 최종 결과 조립
    const results = prepared.map((p) => {
      if (p.prefilter.skip) {
        return {
          id: p.id,
          riskLevel: 'safe',
          category: '정상',
          reason: '위험 패턴이 감지되지 않았습니다 (사전필터).',
          details: {
            intent: '단순 코드 — 위험 호출/네트워크/암호화/난독화 패턴 없음',
            confidence: 0.85,
            threats: [],
            prefiltered: true,
            prefilterReason: p.prefilter.reason,
          },
          analyzedAt: new Date().toISOString(),
        };
      }
      const llmResult = llmById.get(p.id);
      if (!llmResult) {
        // LLM이 블록을 누락한 경우 안전한 fallback
        return {
          id: p.id,
          riskLevel: 'unknown',
          category: '분석 누락',
          reason: 'LLM이 이 블록을 반환하지 않았습니다.',
          details: { intent: '', confidence: 0, threats: [], prefiltered: false, prefilterReason: p.prefilter.reason },
          analyzedAt: new Date().toISOString(),
        };
      }
      const riskResult = classifyRisk(llmResult);
      const result = {
        id: p.id,
        riskLevel: riskResult.riskLevel,
        category: riskResult.category,
        reason: riskResult.reason,
        details: { ...riskResult.details, prefiltered: false, prefilterReason: p.prefilter.reason },
        analyzedAt: new Date().toISOString(),
      };

      // DB 로그 (블록 단위)
      try {
        db.prepare(`
          INSERT INTO analysis_logs (code, language, ai_service, risk_level, category, reason, details, ip_address)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          p.anonymized,
          p.language || 'unknown',
          aiService || 'Unknown',
          result.riskLevel,
          result.category,
          result.reason,
          JSON.stringify(result.details),
          db.hashIp(req.ip)
        );
      } catch (dbErr) {
        console.error('[DB] 배치 로그 저장 실패:', dbErr.message);
      }
      return result;
    });

    console.log(`[Batch] blocks=${blocks.length} prefiltered=${prepared.length - llmTargets.length} llm=${llmTargets.length}`);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

module.exports = router;