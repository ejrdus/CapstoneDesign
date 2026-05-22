const express = require('express');
const router = express.Router();
const { validateAnalyzeRequest } = require('../utils/validator');
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

    const { code, language, aiService } = req.body;

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
      const riskResult = classifyRisk(llmResult);

      result = {
        riskLevel: riskResult.riskLevel,
        category: riskResult.category,
        reason: riskResult.reason,
        details: { ...riskResult.details, prefiltered: false, prefilterReason: pf.reason },
        analyzedAt: new Date().toISOString(),
      };
    }

    // 5. 세션 누적 분석 (다단계 공격 체인 탐지)
    recordAnalysis(req.ip, aiService, result);
    const sessionHistory = getSessionHistory(req.ip, aiService);
    const chainDetection = detectAttackChain(sessionHistory);

    if (chainDetection) {
      result.sessionContext = {
        historyLength: chainDetection.historyLength,
        seenThreatTypes: chainDetection.seenTypes,
        matchedAttackChains: chainDetection.matchedPatterns,
        broadPatternDetected: chainDetection.broadPattern,
      };

      // 세션 컨텍스트가 위험하면 단일 분석 결과를 강화
      const sessionEscalated = chainDetection.matchedPatterns.length > 0 || chainDetection.broadPattern;
      if (sessionEscalated) {
        const sessionReason = chainDetection.matchedPatterns.length > 0
          ? `이 대화에서 누적된 위협이 공격 체인 패턴(${chainDetection.matchedPatterns.map((p) => p.name).join(', ')})과 일치합니다.`
          : `이 대화에서 ${chainDetection.seenTypes.length}개의 서로 다른 위협 유형이 누적 탐지되었습니다.`;

        if (result.riskLevel === 'safe') {
          // 현재 코드는 깨끗해도 누적 패턴이 위험하면 caution으로 강등
          result.riskLevel = 'caution';
          result.category = '대화 누적 위협';
          result.reason = `[세션 누적 분석] ${sessionReason}`;
        } else {
          // 이미 caution/danger면 reason에 세션 정보만 부기
          result.reason = `${result.reason} [세션 누적: ${sessionReason}]`;
        }

        console.log(
          `[Session] history=${chainDetection.historyLength} `
          + `types=[${chainDetection.seenTypes.join(',')}] `
          + `chains=[${chainDetection.matchedPatterns.map((p) => p.name).join(',') || 'none'}] `
          + `broad=${chainDetection.broadPattern}`,
        );
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
        req.ip
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
      const language = b.language;
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
          req.ip
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