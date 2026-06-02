const Anthropic = require('@anthropic-ai/sdk');
const { SECURITY_ANALYSIS_PROMPT } = require('../prompts/securityAnalysis');

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다. server/.env 파일을 확인하세요.');
}

const client = new Anthropic();

// 분석에 사용하는 Claude 모델. 보안 분석은 정확도가 최우선이므로 최신·최상위 모델 사용.
// (고-처리량 환경에서 비용이 문제면 'claude-sonnet-4-6'로 1차 스크리닝 후
//  의심 케이스만 opus로 재분석하는 2단계 구성을 고려할 수 있다.)
const ANALYSIS_MODEL = 'claude-opus-4-8';
// 참고: claude-opus-4-8 등 최신 모델은 temperature 파라미터를 더 이상 받지 않는다
// (전달 시 API가 `temperature` is deprecated 400 반환). 결정론적 동작은 모델 기본값에 의존한다.

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

const THREAT_FLAGS = ['irreversible', 'system_wide', 'unambiguous_malice', 'obfuscated'];

/**
 * 응답 text 블록에서 JSON을 안전하게 파싱한다.
 * json_schema로 구조를 강제하지만, 트렁케이션/모델 폴백 등으로 깨진 JSON이
 * 올 수 있으므로 try/catch로 감싸 원문 일부를 로깅하고 명확한 에러를 던진다.
 */
function safeParseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[LLM] JSON 파싱 실패 (${context}): ${e.message} | raw(앞 300자): ${String(text).slice(0, 300)}`);
    throw new Error(`LLM 응답 JSON 파싱 실패 (${context}): ${e.message}`);
  }
}

/**
 * 위협 객체 하나를 방어적으로 정규화한다.
 * - 4개 플래그를 boolean으로 강제(null/undefined → false 마스킹 방지)
 * - severity를 [0,1]로 클램핑(누락/NaN → 0.5)
 * - 알 수 없는 type은 버리지 않고 경고만 (riskClassifier가 플래그로 등급화)
 */
function normalizeThreat(threat) {
  for (const flag of THREAT_FLAGS) {
    threat[flag] = Boolean(threat[flag]);
  }
  const sev = Number(threat.severity);
  threat.severity = Number.isFinite(sev) ? Math.max(0, Math.min(1, sev)) : 0.5;
  if (!THREAT_TYPES.includes(threat.type)) {
    console.warn(`[LLM] 알 수 없는 threat.type='${threat.type}' — 플래그 기반으로만 등급화됨`);
  }
  return threat;
}

/**
 * LLM 분석 결과(JSON) 한 건을 정규화한다.
 * confidence를 [0,1]로 클램핑하고(누락 → 1.0 보수적), threats 배열·플래그를 정리한다.
 */
function normalizeAnalysis(result) {
  if (!result || typeof result !== 'object') {
    return { intent: '', confidence: 1.0, threats: [] };
  }
  const conf = Number(result.confidence);
  result.confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 1.0;
  result.threats = Array.isArray(result.threats) ? result.threats.map(normalizeThreat) : [];
  return result;
}

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
    model: ANALYSIS_MODEL,
    max_tokens: 8192,
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

  // 안전 거부(refusal) 처리 — 입력 코드 자체가 매우 위험하면 모델이 분석을 거부하고
  // stop_reason='refusal' + 빈 content를 반환한다. 이를 에러로 던지면(fail-closed → 500)
  // 가장 위험한 입력에서 분석이 멈추므로, "분석기가 거부할 만큼 위험한 코드"로 간주해
  // 고위험 신호(refused)를 반환한다(fail-safe). 라우터가 이를 danger로 확정한다.
  const textBlock = response.content.find((b) => b.type === 'text');
  if (response.stop_reason === 'refusal' || !textBlock) {
    console.warn(`[LLM] 분석 거부(stop_reason=${response.stop_reason}) — 고위험으로 처리(fail-safe)`);
    return {
      refused: true,
      intent: 'LLM이 안전 정책에 따라 분석을 거부 — 분석기가 거부할 만큼 명백히 위험한 코드',
      confidence: 0.9,
      threats: [],
    };
  }
  return normalizeAnalysis(safeParseJson(textBlock.text, 'single'));
}

// ─── 배치 분석 ──────────────────────────────────────────────
// 여러 코드 블록을 한 번의 LLM 호출로 분석한다. 메시지 단위로 여러 블록이
// 발견됐을 때 N번 호출하던 것을 1번으로 줄여 latency를 크게 감소시킨다.
// 토큰은 비슷하지만 round-trip 1회로 끝나므로 사용자 체감 응답이 빨라진다.

const BATCH_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
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
        required: ['blockId', 'intent', 'confidence', 'threats'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

/**
 * 여러 코드 블록을 한 번의 LLM 호출로 분석.
 * @param {Array<{ id: string, code: string, language: string }>} blocks
 * @returns {Promise<Array<{ blockId, intent, confidence, threats }>>}
 */
async function analyzeBatchWithLLM(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const blockSections = blocks.map((b) =>
    `\n=== BLOCK ${b.id} (${b.language || 'unknown'}) ===\n\`\`\`${b.language || ''}\n${b.code}\n\`\`\``
  ).join('\n');

  const userPrompt = `다음 ${blocks.length}개의 코드 블록을 각각 보안 관점에서 분석하세요. ` +
    `응답의 results 배열은 입력과 동일한 순서/blockId로 정확히 ${blocks.length}개를 포함해야 합니다.\n${blockSections}`;

  const response = await client.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 16384,
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
        schema: BATCH_RESPONSE_SCHEMA,
      },
    },
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (response.usage) {
    const cached = response.usage.cache_read_input_tokens || 0;
    const written = response.usage.cache_creation_input_tokens || 0;
    if (cached || written) {
      console.log(`[LLM batch] blocks=${blocks.length} cache_read=${cached} cache_write=${written} input=${response.usage.input_tokens} output=${response.usage.output_tokens}`);
    }
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude 배치 응답에 text 블록이 없습니다.');
  const parsed = safeParseJson(textBlock.text, 'batch');
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return results.map(normalizeAnalysis);
}

module.exports = { analyzeWithLLM, analyzeBatchWithLLM };
