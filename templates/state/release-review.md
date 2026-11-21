---
# RELEASE 评审模板。发布评审写到 .riccon/reviews/RELEASE-review.md，
# 由 review.schema.json 校验；release check 要求 module_id=RELEASE 并绑定 release_id/version/environment。
review_id: REV-RELEASE-001
module_id: RELEASE
release_id: REL-0001
version: "0.1.0"
environment: sandbox
verifier: riccon/verifier
reviewer:
  # 真实 OpenCode 会话 ID；REPLACE_WITH_REAL_SESSION_ID 不是有效值，提交前必须替换。
  agent: riccon/verifier
  session: REPLACE_WITH_REAL_SESSION_ID
  model: opencode-go/deepseek-v4.1-flash#max
  independent: true
verdict: pass
# release DoD 使用合同 definition_of_done.release；release check 校验布尔值，
# 不要求模块 review 的 dod_evidence 绑定。
dod:
  build: true
  tests: true
  e2e: true
  security: true
  rollback: true
  approval: true
# 必须覆盖 release evidence 的全部 EV；release check 会逐项核对。
reviewed_evidence: []
# pass 时不得保留 open finding；P0/P1 必须 fixed；P2/P3 accepted 必须写 owner、due、accepted_reason。
findings: []
evidence: []
created_at: "2026-01-01T00:00:00+08:00"
---

# REV-RELEASE-001：发布评审

## 结论

通过 / 不通过 / 阻塞，以及一句理由。

## 发布范围

- Release：
- 版本：
- 环境：
- 产物：威胁模型、负载测试、回滚演练、runbook（按轨道要求）

## 验证了什么

- build、tests、E2E：
- security、rollback、approval：
- 证据覆盖：

## 未验证

写清楚无法验证的内容及原因；不要用“未运行”冒充通过。

## Findings

无。

## 剩余风险

未记录。
