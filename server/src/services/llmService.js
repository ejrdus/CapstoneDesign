const { GoogleGenerativeAI } = require('@google/generative-ai');
const { SECURITY_ANALYSIS_PROMPT } = require('../prompts/securityAnalysis');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Gemini API를 통해 코드의 의미와 맥락을 분석
 * @param {string} code - 전처리된 코드
 * @param {string} language - 프로그래밍 언어
 * @returns {Object} LLM 분석 결과 (JSON)
 */
async function analyzeWithLLM(code, language) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });

  const prompt = `${SECURITY_ANALYSIS_PROMPT}

다음 ${language} 코드를 보안 관점에서 분석해주세요:

\`\`\`${language}
${code}
\`\`\`
`;

  const result = await model.generateContent(prompt);
  const content = result.response.text();
  return JSON.parse(content);
}

module.exports = { analyzeWithLLM };
