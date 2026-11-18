# {{PROJECT_NAME}} — Agent 说明

本文件是 Riccon 智能体团队在该项目中的协作合同，也是技术栈、命令、工具和约束的唯一事实源。保持受管区块有效；区块外的说明可以自由编辑。

## Project Contract

<!-- riccon:contract:start -->

```yaml
contract_version: 1
project:
  name: "{{PROJECT_NAME}}"
  type: web-app
  risk_tier: T3
  status: greenfield
  timezone: Asia/Shanghai
product:
  goal: ""
  users: []
  mvc: ""
  non_goals: []
  success_metrics: []
  module_roadmap: []
stack:
  languages: []
  frameworks: []
  runtime: ""
  database: ""
  package_manager: ""
  versions: {}
  subprojects: []
repo_map:
  source: []
  tests: []
  docs: docs
  infra: ""
  contracts: ""
commands:
  install: ""
  build: ""
  lint: ""
  typecheck: ""
  test: ""
  test_e2e: ""
  coverage: ""
  run: ""
  deploy_preview: ""
  deploy_prod: ""
  sandbox: ""
sandbox:
  required: false
  runtime: ""
  network: ""
  mounts: []
  secrets: ""
  limits: {}
  evidence: ""
tools:
  required: []
  optional: []
  mcp: []
  fallback: "记录任务证据中的降级，改范围前先问用户。"
environments:
  local: ""
  preview: ""
  sandbox: ""
  production: ""
integrations:
  auth: ""
  payments: ""
  email: ""
  storage: ""
  external_apis: []
data:
  pii: false
  retention: ""
  migrations: ""
constraints:
  style: ""
  security: ""
  performance: ""
  accessibility: ""
  coverage:
    line: 80
    branch: 70
  licensing: ""
  compliance: []
coding_standard:
  path: docs/CODING-STANDARDS.md
  owner: riccon/architect
  comments: zh-CN
quality:
  evidence_binding: strict
definition_of_done:
  module: [acceptance, build, tests, coverage, e2e, review, docs, evidence]
  release: [build, tests, e2e, security, rollback, approval]
decision_owners:
  product: user
  ux: user
  architecture: user
  production: user
  spending: user
  destructive: user
budget:
  tokens: "none"
  wall_clock: "8h/module, 3d/mvc"
  cost: visible
```

<!-- riccon:contract:end -->

## 协作约定

- 开始工作前读 `.riccon/state.json`、最新 handoff 和本文件中的合同。
- 不假设合同里没有的目录、命令或工具。
- 每个任务都有写入范围和验收标准；不要静默扩大任何一项。
- 证据是命令、退出码和输出路径，不是声明。strict 绑定下，review 的 `dod_evidence` 必须把 acceptance/build/tests/e2e/coverage/docs 指向真实、通过、已评审的证据；命令必须与合同 `commands` 对应项匹配，空命令和 `not-implemented`/占位命令直接失败；未加引号管道默认失败，`||` 只允许 `exit 非零`，`; true`、`exit 0`、后台 `&` 等掩盖失败也失败。
- 不要把密钥写进仓库、状态、日志或提示词。
- 不要编辑 `.riccon/` 中其他角色负责的决策或报告。
- 代码变更同步更新文档，或记录 no-impact 理由。
- 产品范围、不可逆技术选择、生产、花钱和破坏性操作由用户拥有；其余授权给团队。
- 文档、注释、决策包、评审包和 handoff 默认中文；代码注释必须中文；代码标识符、命令和字段名保持英文。
- 代码注释至少方法级；复杂业务流程必须有行级或段落注释；不写重复、无信息量的注释。
- Architect 在 Builder 开始前创建 `docs/CODING-STANDARDS.md`，按技术栈和行业最佳实践定义编码规范；Builder 必须遵循，Verifier 检查。
- “覆盖率”默认指代码行/分支覆盖率，不是 AC 覆盖；门槛见合同 `constraints.coverage`，报告必须可由 `commands.coverage` 复现。
- 现有历史代码的注释迁移单独成任务，不和行为变更混合。
- Product 的 brief/AC/non-goals 必须经 Lead 完整性评审、用户范围批准、Architect 可行性评审和 Verifier 可验证性检查；未批准不进入模块实现。
- Architect 的架构/ADR 必须经 Lead 完整性、用户不可逆决策、Verifier 可测试性/安全边界、Ops 可运维性检查；未评审的 ADR 保持 `proposed`。
- Builder 只把任务移到 review，不自己 done；高风险任务（认证、权限、迁移、并发、安全、AI 工具调用）done 前必须有独立 Verifier 评审。
- 模块 gate 通过后，用 `docs/ACCEPTANCE.md` 记录用户对 AC 和用户可见结果的产品验收；未 accepted 不进入下一个用户可见模块。
- 所有时间默认北京时间（`Asia/Shanghai`，UTC+08:00）；数据库用带时区类型，API/日志/UI 使用带偏移的 ISO 8601。
- 任务过大（`write_scope` 超过 8 项或 acceptance 超过 6 项）时先拆分；不要用一个大任务让 Builder 长时间只读。
- 模块结束用 `riccon module cost` 记录 requests/tokens/墙钟/成本估算；全零且 `confidence` 不是 `unmeasured` 会被拒绝，0 不等于免费。
