---
# 模块评审模板；任务级/架构级评审使用 templates/state/task-review.md，
# 并写到 .riccon/reviews/tasks/，不要放在 reviews/ 顶层。
review_id: REV-M01-001
module_id: M01
verifier: riccon/verifier
reviewer:
  agent: riccon/verifier
  session: session-id
  model: opencode-go/deepseek-v4.1-flash#max
  independent: true
verdict: pass
dod:
  acceptance: true
  build: true
  tests: true
  coverage: true
  e2e: true
  review: true
  docs: true
  evidence: true
# strict 项目必须填写；每个 true 的 DoD（review/evidence 除外）至少绑定一条
# 真实、通过、已列入 reviewed_evidence 的 EV。模块 review 的 tests/coverage
# 必须绑定覆盖合同 commands 的全量 EV；任务级定向 EV 不能替代模块全量绑定。
dod_evidence:
  acceptance: [EV-0001]
  build: [EV-0002]
  tests: [EV-0002]
  coverage: [EV-0002]
  e2e: [EV-0003]
  docs: [EV-0004]
findings: []
evidence: []
reviewed_evidence: []
notes: 一页摘要放在模块评审包里；reviewed_evidence 必须覆盖每个任务的最新证据。
created_at: "2026-01-01T00:00:00.000Z"
---

# REV-M01-001：模块 M01 评审

## 结论

通过。

## 验证了什么

- 构建：
- 测试：
- E2E：
- 可访问性：
- 安全：
- 性能：

## 未验证

写清楚无法验证的内容及原因。

## Findings

无。

## 剩余风险

未记录。
