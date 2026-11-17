---
schema_version: 1
id: REL-0001
version: 0.1.0
environment: sandbox
scope: ""
status: draft
risk_tier: T4
artifacts:
  threat_model: docs/THREAT-MODEL.md
  load_test: docs/LOAD-TEST.md
  rollback_drill: docs/ROLLBACK-DRILL.md
  runbook: docs/RUNBOOK.md
approval:
  by: user
  decision_id: DEC-0001
  release_id: REL-0001
  environment: sandbox
  answer_kind: approve
  answer_sha256: "0000000000000000000000000000000000000000000000000000000000000000"
  approved_at: "2026-01-01T00:00:00.000Z"
evidence:
  - EV-0001
created_at: "2026-01-01T00:00:00.000Z"
updated_at: "2026-01-01T00:00:00.000Z"
---

# REL-0001

使用 `riccon release new` 创建发布记录；用户批准后先 `riccon decision answer --kind approve --release REL-0001`，再 `riccon release approve`。模板中的 `answer_sha256` 是占位值，实际值由命令写入。
