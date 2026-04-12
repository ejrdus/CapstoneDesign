const express = require('express');
const router = express.Router();
const { validateAnalyzeRequest } = require('../utils/validator');
const { preprocessCode } = require('../utils/codePreprocessor');
const { analyzeWithLLM } = require('../services/llmService');
const { classifyRisk } = require('../services/riskClassifier');
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

    // 3. LLM 의미 분석
    const llmResult = await analyzeWithLLM(cleanCode, language);

    // 4. 위험도 판정
    const riskResult = classifyRisk(llmResult);

    const result = {
      riskLevel: riskResult.riskLevel,
      category: riskResult.category,
      reason: riskResult.reason,
      details: riskResult.details,
      analyzedAt: new Date().toISOString(),
    };

    // 5. 분석 로그 DB 저장
    try {
      db.prepare(`
        INSERT INTO analysis_logs (code, language, ai_service, risk_level, category, reason, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        code,
        language || 'unknown',
        aiService || 'Unknown',
        riskResult.riskLevel,
        riskResult.category,
        riskResult.reason,
        JSON.stringify(riskResult.details),
        req.ip
      );
    } catch (dbErr) {
      console.error('[DB] 로그 저장 실패:', dbErr.message);
    }

    // 6. 응답
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
