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
  # test 与 coverage 建议使用同一条 coverage 全量命令；模块 gate 只跑一次，不要重复全量。
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

<!-- riccon:team:start -->
## 内容索引

本文件保留合同和硬规则；详细协作规则按下面索引读取。开始或恢复任何模块前，必须读 Project Contract 和 `docs/COLLABORATION.md`。

| 内容 | 位置 |
|---|---|
| 技术栈、命令、工具、DoD、预算 | `AGENTS.md#project-contract` |
| 角色边界、模块/任务生命周期、验收顺序、评审、证据 | `docs/COLLABORATION.md` |
| 产品目标、用户、MVC、non-goals、AC | `docs/PRODUCT.md` |
| 架构、数据模型、API/事件契约、ADR | `docs/ARCHITECTURE.md`、`docs/adr/` |
| 编码规范、注释、覆盖率门槛 | `docs/CODING-STANDARDS.md` |
| 产品验收和用户验收 | `docs/ACCEPTANCE.md` |
| 运行、部署、回滚 | `docs/RUNBOOK.md` |
| 沙箱和隔离边界 | `docs/SANDBOX.md` |
| 执行状态、任务、证据、评审、handoff | `.riccon/state.json` 和最新 handoff |
| 团队内核、命令和 skills | 已安装的 `~/.config/opencode/riccon/` |

## 硬规则

以下规则即使不读详细文档也必须遵守；详细说明见 `docs/COLLABORATION.md`。

- 合同是技术栈、命令、工具和约束的唯一事实源；合同里没有的目录、命令或工具不要假设。
- 每个任务都有 `write_scope` 和验收标准；不要静默扩大任何一项。并行 builder 使用实例 owner（例如 `riccon/builder-b2`）；同一 owner 同时只能有一个 `in_progress`，不要用 `--force` 绕过。
- 先提交，再 `riccon evidence run`；strict 下 dirty 证据、空命令、占位命令和掩盖失败的写法不能让 gate 通过。模块 gate 的 `test` 和 `coverage` 优先共用同一条 coverage 全量 EV；长命令移到后台后结束回合等通知，禁止 `sleep`/`tail`/`ps` 轮询。
- Product 的 brief/AC/non-goals 必须经过 Lead、用户、Architect、Verifier 的评审链；未批准不进入模块实现。
- Architect 的架构/ADR 必须经过 Lead、用户（不可逆项）、Verifier、Ops 评审；未评审的 ADR 保持 `proposed`。
- Builder 只把任务移到 `review`，不自己 `done`；高风险任务在 done 前必须有独立 Verifier 评审。
- gate 通过后、模块 done 前，Product 预验收必须 `pass`；done 后再做用户最终验收，用户未 `accepted` 前不启动下一个用户可见模块。
- 验收失败用 `kind: fix` + `fixes_module`，或在显式决策后重新打开；不要只靠标题或 `depends_on`。
- 不把密钥写进仓库、`.riccon/`、日志、任务卡、证据、提示词或 handoff。
- 产品范围、不可逆技术选择、生产发布、花钱和破坏性操作由用户拥有；其余授权给团队。
- 文档、注释、commit message、决策包、评审包和 handoff 默认中文；代码注释必须中文，标识符、命令、字段名保持英文。
- 所有时间默认北京时间（`Asia/Shanghai`，UTC+08:00）；数据库和 API/日志/UI 按合同约定使用带偏移时间。
<!-- riccon:team:end -->

## 项目补充

项目特定规则写在这里，例如成本口径、数据库时区、验证分层或工具路由。项目补充不能削弱上面的硬规则和 Project Contract。
