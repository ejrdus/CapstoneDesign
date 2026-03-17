# 정상 코드 샘플 - 웹 스크래퍼
import requests
from bs4 import BeautifulSoup

def scrape_headlines(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')
    headlines = soup.find_all('h2')
    return [h.text.strip() for h in headlines]

if __name__ == '__main__':
    news = scrape_headlines('https://news.example.com')
    for headline in news:
        print(headline)
