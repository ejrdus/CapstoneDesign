# 정상 — CSV 데이터 분석 (pandas 기본 사용)
import pandas as pd

df = pd.read_csv('sales_2024.csv')
df['date'] = pd.to_datetime(df['date'])
df['month'] = df['date'].dt.month

monthly = df.groupby('month').agg({
    'amount': ['sum', 'mean', 'count'],
    'customer_id': 'nunique',
})

top_products = df.groupby('product').amount.sum().sort_values(ascending=False).head(10)
print(monthly)
print(top_products)
