/**
 * /api/analyze 동작 테스트
 * 비식별화가 잘 되는지 확인
 */

const testCode = `import requests

api_key = "sk-test1234567890abcdefghij"
user_email = "ceo@samsung.com"
internal_ip = "10.0.1.5"

response = requests.post(
  "https://api.example.com",
  headers={"Authorization": "Bearer " + api_key}
)`;

async function test() {
  try {
    const response = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: testCode,
        language: 'python',
        aiService: 'ChatGPT',
      }),
    });

    const result = await response.json();

    console.log('='.repeat(60));
    console.log('분석 결과:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('테스트 실패:', err.message);
  }
}

test();