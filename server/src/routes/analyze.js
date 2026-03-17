const express = require('express');
const router = express.Router();
const { validateAnalyzeRequest } = require('../utils/validator');
const { preprocessCode } = require('../utils/codePreprocessor');
const { analyzeWithLLM } = require('../services/llmService');
const { classifyRisk } = require('../services/riskClassifier');

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

    const { code, language } = req.body;

    // 2. 코드 전처리
    const cleanCode = preprocessCode(code);

    // 3. LLM 의미 분석
    const llmResult = await analyzeWithLLM(cleanCode, language);

    // 4. 위험도 판정
    const riskResult = classifyRisk(llmResult);

    // 5. 응답
    res.json({
      riskLevel: riskResult.riskLevel,
      category: riskResult.category,
      reason: riskResult.reason,
      details: riskResult.details,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
