---
decision_id: DEC-0001
title: 选择一个交付方向
status: open
owner: user
module_id: null
blocking: true
question: 团队应该选择哪个方案？
options:
  - 方案 A
  - 方案 B
recommendation: 方案 A
consequences: 写清楚每个方案的成本、可逆性和风险。
deadline: null
default: 方案 A
answer: null
answer_kind: null
release_id: null
environment: null
created_at: "2026-01-01T00:00:00.000Z"
answered_at: null
---

# DEC-0001：选择一个交付方向

## 背景

为什么现在需要这个决策。

## 选项

1. 方案 A — 后果。
2. 方案 B — 后果。

## 推荐

方案 A，因为……

## 决策

用 `riccon decision answer DEC-0001 --answer "..." --kind approve|reject|choose|defer` 记录答案；批准类决策加 `--release REL-0001`。不要手改 front matter。
