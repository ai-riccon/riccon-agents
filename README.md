# Riccon Agents

**受监督的 AI 智能体软件交付团队。** 用合同、状态、证据、独立评审和门禁，把 OpenCode 中的多个 agent 组织成可审计的交付流程。

当前版本：`0.1.6`。这是**受监督原型**，不是“全自主软件公司”，生产发布仍需独立批准。

## 它解决什么问题

单个 coding agent 容易“说完成了”，但很难证明：

- 谁改了什么、范围是否越界；
- 测试、E2E、覆盖率是否真的运行过；
- 评审是否独立；
- 发布前风险是否被看见。

Riccon 把这些变成可检查的状态和文件：

```text
合同 → 模块 → 任务 → 证据 → 独立评审 → gate → handoff → 发布门禁
```

## 团队角色

| 角色      | 职责                                       |
| --------- | ------------------------------------------ |
| Lead      | 拆模块、派任务、维护状态、汇总评审包       |
| Product   | 发现、用户故事、验收标准、范围与非目标     |
| Architect | 技术栈、架构、数据/API 契约、ADR、编码规范 |
| Builder   | 在任务写入范围内实现源码、测试、迁移       |
| Verifier  | 独立验证、代码审查、安全基线、评审报告     |
| Ops       | CI/CD、容器、部署、可观测性、回滚          |

agent 定义在 `.opencode/agents/riccon/`，命令和 skills 在 `.opencode/commands/`、`.opencode/skills/`。

## 核心机制

- **合同**：目标项目的 `AGENTS.md` 是技术栈、命令、DoD、权限和风险等级的唯一事实源。
- **状态**：`.riccon/` 记录模块、任务、决策、证据、评审、发布和 handoff。
- **证据**：命令、退出码、日志、commit、hash；不是“我跑过了”。
- **独立评审**：review 绑定 module、证据和 reviewer 元数据；P0/P1 不修不能过 gate。
- **门禁**：任务完成、证据有效、评审通过、无阻塞决策才允许模块 done。
- **发布门禁**：release check 复跑模块 gate/scope；T4 还要 sandbox check 和用户批准。

严格模式（新项目默认）还要求：

- review 的 `dod_evidence` 把 acceptance/build/tests/e2e/coverage 绑定到真实、通过、已评审的 EV；
- 证据命令必须覆盖合同命令；
- 空命令、`not-implemented`、`| echo`、`|| echo`、`; true`、后台 `&` 等掩盖失败的写法会被拒绝；
- 先提交再取证，`dirty: true` 的证据会让 gate 失败。

## 快速开始

要求：Node.js ≥ 26，OpenCode 已安装。

```bash
git clone <this-repo>
cd riccon-agents
npm install
npm test
node scripts/riccon.mjs doctor
```

安装到 OpenCode（先 dry-run）：

```bash
node scripts/install.mjs --dry-run
node scripts/install.mjs
```

安装器只写 agent/command/skill 相关目录，不修改 `opencode.json` 或 `default_agent`。

### 初始化目标项目

```bash
cd /path/to/your-project
node /path/to/riccon-agents/scripts/riccon.mjs init \
  --name my-project \
  --type web-app \
  --risk-tier T3 \
  --evidence-binding strict
```

然后：

1. 编辑 `AGENTS.md` 中的 Project Contract：产品目标、技术栈、命令、DoD、coverage、sandbox。
2. 运行 `riccon contract validate` / `riccon contract sync`。
3. 用 `riccon module new`、`riccon task new` 拆分模块和任务。
4. Builder 实现，`riccon evidence run` 记录证据。
5. Verifier 写 review，Lead 运行 `riccon gate check`。
6. 模块通过后 `riccon handoff new`，再进入下一个模块。

## 主要命令

```bash
riccon init
riccon adopt --write
riccon upgrade [--write] [--adopt-legacy]
riccon contract validate|sync|show
riccon module new|update|cost|list|show
riccon task new|update|list|show
riccon evidence run|add|list
riccon decision new|answer|list|show
riccon gate check --module M01
riccon release new|check|approve|list|show
riccon sandbox check
riccon handoff new|list|show
riccon status
riccon doctor
```

## 仓库地图

```text
.opencode/agents/riccon/     Lead、Product、Architect、Builder、Verifier、Ops
.opencode/commands/           /riccon-start、status、plan、review、decision、resume、release
.opencode/skills/            core、contract、verify、docs
schemas/                     状态和记录的 JSON schema
scripts/                     内核、CLI、安装器、adopt、gate、release、sandbox
templates/                   项目合同、文档、状态记录模板
tests/                       内核与安装器测试
docs/                        设计、合同、状态、权限、沙箱、评测、模型
```

## 设计原则

- **合同先于代码**：技术栈、命令、DoD、权限不明确就不开工。
- **证据先于声明**：没有 exit 0、可复现的证据，不算完成。
- **独立验证**：Builder 不自证；Verifier 用新上下文检查产物。
- **fail-closed**：无效 commit、缺失证据、占位命令、越界 scope 直接失败。
- **小步交付**：一个模块一条关键旅程；任务范围过大时拆分。
- **人类保留关键决策**：生产、花钱、破坏性操作和产品范围由用户决定。
- **技术栈无关**：团队定义不绑定框架、数据库或目录结构。
- **时间默认北京时间**：`Asia/Shanghai`（UTC+08:00）；内核时间戳、证据、数据库时间字段、日志和 UI 都使用带偏移的时间。

## 诚实限制

- 这是**受监督原型**，不是生产就绪平台。
- 本地内核不能密码学证明“谁批准/谁评审”；reviewer 元数据仍是自报。
- EV JSON、日志和 commit 绑定能发现不一致，但不能证明执行真实发生。
- sandbox check 是声明 + 脚本静态检查 + 日志，不是 runtime attestation。
- scope 检查只能做路径归属，不能证明 authorship；合并前仍需人工看 diff。
- 生产发布、真实 PII、生产密钥和 T4 生产环境必须单独评审与批准。

## 文档

- [设计](docs/DESIGN.md)
- [项目合同](docs/CONTRACT.md)
- [状态与门禁](docs/STATE.md)
- [权限](docs/PERMISSIONS.md)
- [沙箱](docs/SANDBOX.md)
- [评测方法](docs/EVALS.md)
- [模型映射](docs/MODELS.md)

## 许可

Apache-2.0。见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
