const { anonymize } = require('./src/utils/anonymizer');

const testCode = `
import requests

api_key = "sk-abcdef1234567890abcdef1234567890"
user_email = "ceo@samsung.com"
internal_ip = "10.0.1.5"
home_path = "/home/seokga/project"

response = requests.post(
  "https://api.example.com",
  headers={"Authorization": "Bearer " + api_key}
)
`;

console.log("=".repeat(60));
console.log("원본 코드:");
console.log("=".repeat(60));
console.log(testCode);

const result = anonymize(testCode);

console.log("=".repeat(60));
console.log("비식별화 후:");
console.log("=".repeat(60));
console.log(result.anonymized);

console.log("=".repeat(60));
console.log("마스킹 통계:");
console.log("=".repeat(60));
console.log(result.replacements);