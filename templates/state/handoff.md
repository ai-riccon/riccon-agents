---
handoff_id: HANDOFF-0001
session: null
summary: 改了什么，以及下一个会话需要知道什么。
next: 确切的下一步。
invariants:
  - 没有决策不要改公开契约。
risks:
  - 未记录。
first_read:
  - .riccon/state.json
  - AGENTS.md#project-contract
  - .riccon/handoffs/handoff-0001.md
quality_gate:
  status: pass
  gate_status: pass
  gate_module_id: M01
  gate_checked_at: "2026-01-01T00:00:00.000Z"
  release_gate_status: none
  product_acceptance_open: []
  active_tasks: 0
  checked_at: "2026-01-01T00:00:00.000Z"
created_at: "2026-01-01T00:00:00.000Z"
---

# HANDOFF-0001

## 摘要

改了什么，为什么。

## 下一步

确切的下一步。

## 不变量

- 没有决策不要改公开契约。

## 风险

- 未记录。

## 上下文

- 触发原因：模块 gate / phase 切换 / 上下文预算 / 会话结束。
- 质量门槛：状态、证据、review、gate 已更新；没有半写文件或未完成 subagent。
- 新会话：运行 `/riccon-resume`，从 `.riccon/` 和本文件恢复；不要重读旧聊天。

## 先读

1. `.riccon/state.json`
2. `AGENTS.md#project-contract`
3. `.riccon/handoffs/handoff-0001.md`
