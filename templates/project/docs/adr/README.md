# 架构决策记录

每个决策一个文件：`ADR-NNNN-short-title.md`。

```text
# ADR-NNNN: 标题
Status: proposed | accepted | superseded
Reviewers:
Approved-by:
Review-date:
Supersedes:
Context:
Decision:
Consequences:
Alternatives:
Evidence:
```

决策难以逆转时写 ADR：技术栈、数据模型、公开契约、认证/安全、部署架构，或对合同的刻意偏离。

ADR 由 Architect 起草，默认 `proposed`；Lead 检查完整性，用户批准不可逆/高成本选择，Verifier 检查可测试性和安全边界，Ops 检查可运维/可回滚。不要在未经评审时自行标 `accepted`。
