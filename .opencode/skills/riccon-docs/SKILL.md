---
name: Riccon 文档
description: "Riccon 项目的最小文档规则：产品、架构、ADR、运行手册、评审包和 handoff，避免文档膨胀。"
---

# Riccon 文档

文档的目的是让下一个会话和用户高效工作。保持小、当前、并链接到证据。

## 1. 最小集合

项目文档：

```text
AGENTS.md              项目合同和协作约定
docs/PRODUCT.md        目标、用户、MVC、non-goals、成功指标、路线图
docs/ARCHITECTURE.md   组件、数据流、数据模型、契约、风险
docs/RUNBOOK.md        运行、部署、检查、回滚、恢复
docs/adr/              不应被重新争论的决策
.riccon/reviews/        模块评审报告
.riccon/handoffs/       会话交接
```

不要为每个主题建平行文档。扩展 canonical 文件，或写 ADR。

## 2. 规则

- 文档描述当前状态，不描述尝试历史。
- 代码和文档在同一任务里变更；没有文档变更时记录 no-impact 理由。
- 生成的文档由工具生成；不要手改。
- 链接证据，不要粘贴大段日志。
- 没有密钥、token、私有 URL 或客户数据。
- 产品文档要短到新会话可以先读完。
- 版本 = git 版本；不要建 `v1/`、`v2/` 副本。

## 3. ADR

决策难以逆转时写 ADR：

- 技术栈/运行时选择；
- 数据模型或公开契约；
- 认证/安全模型；
- 部署架构；
- 对合同的刻意偏离。

格式：

```text
# ADR-NNNN: 标题
Status: proposed | accepted | superseded
Context:
Decision:
Consequences:
Alternatives:
Evidence:
```

## 4. 运行手册

运行手册必须回答：

- 本地如何安装和运行；
- 如何运行测试和验证命令；
- 如何部署 preview 和 production；
- 如何检查日志、指标和健康状态；
- 如何回滚；
- 生产决策找谁。

## 5. 评审包

一页，链接到证据：

- demo/预览；
- 验收表；
- 变更；
- 验证结果；
- P0/P1/P2 和剩余风险；
- 开放决策；
- 下一模块；
- veto 截止时间。

## 6. Handoff

handoff 是下一个会话的入口：

- 改了什么；
- 证据路径；
- 下一步；
- 不能变的不变量；
- 风险和 blocker；
- first-read 顺序。

写“看聊天记录”的 handoff 不是 handoff。
