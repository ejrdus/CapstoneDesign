const express = require('express');
const router = express.Router();
const { validateAnalyzeRequest } = require('../utils/validator');
const { preprocessCode } = require('../utils/codePreprocessor');
const { anonymize, logRedactions } = require('../utils/anonymizer');
const { analyzeWithLLM } = require('../services/llmService');
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

    // 3. LLM 의미 분석 (비식별화된 코드로 분석, 인젝션 방어는 시스템 프롬프트에 내장됨)
    const llmResult = await analyzeWithLLM(anonymizedCode, language);

    // 4. 단일 코드 블록 위험도 판정
    const riskResult = classifyRisk(llmResult);

    const result = {
      riskLevel: riskResult.riskLevel,
      category: riskResult.category,
      reason: riskResult.reason,
      details: riskResult.details,
      analyzedAt: new Date().toISOString(),
    };

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

module.exports = router;