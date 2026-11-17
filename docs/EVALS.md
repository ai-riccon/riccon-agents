# 评测方法

本文定义如何验证 Riccon 团队，而不是某个具体项目的测试计划。目标是区分“流程跑通”和“真的能交付”。

## 证据层级

| 层级        | 内容                                             | 能证明什么                             |
| ----------- | ------------------------------------------------ | -------------------------------------- |
| L1 内核测试 | `npm test`、`npm run check`                      | schema、CLI、gate、release、安装器行为 |
| L2 临时项目 | init → module → task → evidence → gate → handoff | 流程可执行，状态和门禁一致             |
| L3 示例项目 | 受监督的 Web/CLI/SaaS 示例                       | 多角色协作、E2E、覆盖率、sandbox       |
| L4 真实项目 | 真实仓库、真实约束、受监督                       | 流程在非玩具环境下的可用性             |

L2 是合并门禁；L3/L4 是能力评估。不能用 L1/L2 宣称真实项目可交付。

## 评测任务

### E1 小型 Web SaaS（T3）

从零做一个有登录、列表/创建/状态流转和基础测试的小系统。验证 Product、Architect、Builder、Verifier 的完整循环。

### E2 API 或 CLI（T2/T3）

做一个小型 API 或 CLI，验证合同命令、错误 envelope、测试和发布门禁。

### E3 现有项目的小功能（T2）

在隔离副本里接管一个现有项目，只读 adopt，完成一个小功能。验证 `adopt`、source baseline、write_scope 和回滚。

### E4 真实项目（可选）

用户自己的仓库，受监督完成一个模块。必须显式接受身份/provenance、sandbox attestation 和 scope 归因风险。

## 指标

- **正确性**：验收标准逐条通过；关键旅程 E2E；负例存在。
- **证据质量**：每条完成声明有 EV；命令/退出码/日志/hash 可复现；review 覆盖最新 EV。
- **独立性**：Verifier 不复用 Builder 上下文；P0/P1 必须修复；P2/P3 有书面接受。
- **范围纪律**：`write_scope` 不越界；无静默扩大范围。
- **可回滚**：迁移/部署有回滚路径或恢复方案。
- **成本/时间**：模块墙钟、请求/token 估算可记录；不能把未测量当零成本。
- **覆盖率**：代码 line/branch 覆盖率，不是 AC 覆盖；不得低于合同门槛和基线。

## 流程

1. 固定评测任务、环境和预算。
2. 记录基线 commit、合同、命令和 DoD。
3. 按角色分工执行；每个任务一个 active subagent。
4. 记录 EV；先提交再取证。
5. Verifier 独立写 review；Lead 跑 gate。
6. 记录失败、返工、成本、墙钟和人工介入。
7. 结果只能用于对应层级；不能把示例结果外推到生产。

## 什么会证伪声称

- 测试通过但没有断言，或只跑 0 个测试；
- E2E 被 skip/retry 掩盖；
- review 自报 DoD，没有绑定 EV；
- 证据命令是 `true`/`echo`/`sleep`，或用管道/回退掩盖失败；
- 任务 done 但 scope 越界；
- 发布检查没有在最终 HEAD 上运行；
- 身份/provenance 或 sandbox runtime 未经验证，却被说成已证明。

## 模型评测

模型 bake-off 的任务、量规和原始结果属于内部评测材料，不随公开仓库发布。模型映射见 [MODELS.md](./MODELS.md)。
