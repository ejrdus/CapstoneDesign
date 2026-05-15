const Anthropic = require('@anthropic-ai/sdk');
const { SECURITY_ANALYSIS_PROMPT } = require('../prompts/securityAnalysis');

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다. server/.env 파일을 확인하세요.');
}

const client = new Anthropic();

const THREAT_TYPES = [
  'file_destruction',
  'reverse_shell',
  'privilege_escalation',
  'data_exfiltration',
  'ransomware',
  'obfuscation',
  'network_access',
  'code_execution',
  'analyzer_subversion',
];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    confidence: { type: 'number' },
    threats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: THREAT_TYPES },
          category: { type: 'string' },
          severity: { type: 'number' },
          description: { type: 'string' },
          evidence: { type: 'string' },
          lineHint: { type: 'string' },
          irreversible: { type: 'boolean' },
          system_wide: { type: 'boolean' },
          unambiguous_malice: { type: 'boolean' },
          obfuscated: { type: 'boolean' },
        },
        required: [
          'type', 'category', 'severity', 'description', 'evidence', 'lineHint',
          'irreversible', 'system_wide', 'unambiguous_malice', 'obfuscated',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['intent', 'confidence', 'threats'],
  additionalProperties: false,
};

/**
 * Claude API를 통해 코드의 의미와 맥락을 분석
 * @param {string} code - 전처리된 코드
 * @param {string} language - 프로그래밍 언어
 * @returns {Object} LLM 분석 결과 (JSON)
 */
async function analyzeWithLLM(code, language) {
  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SECURITY_ANALYSIS_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: RESPONSE_SCHEMA,
      },
    },
    messages: [
      {
        role: 'user',
        content: `다음 ${language} 코드를 보안 관점에서 분석해주세요:\n\n\`\`\`${language}\n${code}\n\`\`\``,
      },
    ],
  });

  if (response.usage) {
    const cached = response.usage.cache_read_input_tokens || 0;
    const written = response.usage.cache_creation_input_tokens || 0;
    if (cached || written) {
      console.log(`[LLM] cache_read=${cached} cache_write=${written} input=${response.usage.input_tokens} output=${response.usage.output_tokens}`);
    }
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('Claude 응답에 text 블록이 없습니다.');
  }
  return JSON.parse(textBlock.text);
}

module.exports = { analyzeWithLLM };
