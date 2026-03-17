const OpenAI = require('openai');
const { SECURITY_ANALYSIS_PROMPT } = require('../prompts/securityAnalysis');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * LLM API를 통해 코드의 의미와 맥락을 분석
 * @param {string} code - 전처리된 코드
 * @param {string} language - 프로그래밍 언어
 * @returns {Object} LLM 분석 결과 (JSON)
 */
async function analyzeWithLLM(code, language) {
  const userMessage = `
다음 ${language} 코드를 보안 관점에서 분석해주세요:

\`\`\`${language}
${code}
\`\`\`
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SECURITY_ANALYSIS_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  return JSON.parse(content);
}

module.exports = { analyzeWithLLM };
