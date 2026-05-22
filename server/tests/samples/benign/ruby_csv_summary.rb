# 정상 — CSV 파일 읽어서 컬럼별 합계 출력
require 'csv'

totals = Hash.new(0)

CSV.foreach('sales.csv', headers: true) do |row|
  totals['amount'] += row['amount'].to_f
  totals['quantity'] += row['quantity'].to_i
end

totals.each do |key, value|
  puts "#{key}: #{value}"
end
