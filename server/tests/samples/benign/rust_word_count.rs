// 정상 — 표준입력에서 단어 빈도 계산
use std::collections::HashMap;
use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();

    let mut counts: HashMap<&str, u32> = HashMap::new();
    for word in input.split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }

    let mut sorted: Vec<_> = counts.iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(a.1));

    for (word, count) in sorted.iter().take(10) {
        println!("{}: {}", word, count);
    }
}
