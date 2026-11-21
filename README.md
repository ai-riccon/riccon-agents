# Riccon Agents

**受监督的 AI 智能体软件交付团队。**
用合同、状态、证据、独立评审和门禁，把 OpenCode 中的多个 agent 组织成一条可审计、可恢复、可交接的软件交付流水线。

当前版本：`0.1.11`。这是**受监督原型**，不是“全自主软件公司”，生产发布仍需独立批准。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [能力总览](#能力总览)
- [六个角色](#六个角色)
- [轨道与交付循环](#轨道与交付循环)
- [质量与治理](#质量与治理)
- [并行交付与上下文](#并行交付与上下文)
- [安全、权限与沙箱](#安全权限与沙箱)
- [发布门禁](#发布门禁)
- [快速开始](#快速开始)
- [主要命令](#主要命令)
- [状态目录](#状态目录)
- [仓库结构](#仓库结构)
- [设计原则](#设计原则)
- [诚实限制](#诚实限制)
- [文档](#文档)
- [许可](#许可)

---

## 它解决什么问题

单个 coding agent 很容易“说完成了”，但很难证明：

- 谁改了什么，是否越过任务写入范围；
- 测试、E2E、覆盖率、可访问性、安全扫描是否真的运行过；
- 评审是否独立，还是实现者自己给自己打分；
- 模块完成前，产品、用户、风险和发布条件是否真的被检查；
- 会话中断后，下一班 agent 能否不靠聊天历史恢复；
- 发布前是否有人明确批准，失败后能否回滚。

Riccon 把这些变成可检查的文件和状态：

```text
合同 → 模块 → 任务 → 证据 → 独立评审 → gate → handoff → 发布门禁
```

目标项目的 `AGENTS.md` 是技术栈、命令、DoD、决策所有权和风险等级的唯一事实源；工具权限由团队 `templates/agents/permissions.yml` 管理；`.riccon/` 是执行状态的唯一事实源；聊天历史不是记忆。

---

## 能力总览

| 能力域         | 团队能做什么                                                       | 主要产物                                                        |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| 产品定义       | 发现目标用户和关键旅程，写用户故事、验收标准、范围与非目标         | `docs/PRODUCT.md`、`docs/ACCEPTANCE.md`                         |
| 架构与技术决策 | 选型、数据模型、API/事件契约、ADR、初始脚手架、编码规范            | `docs/ARCHITECTURE.md`、`docs/adr/`、`docs/CODING-STANDARDS.md` |
| 计划与拆分     | 按用户可见结果拆模块，按可独立验收的结果拆任务，声明 `write_scope` | `.riccon/modules/`、`.riccon/tasks/`                            |
| 实现           | 在任务范围内写源码、单元/集成测试、迁移和代码级文档                | 代码、测试、迁移                                                |
| 独立验证       | 新上下文跑定向复验、全量合同验证、E2E、可访问性、安全基线          | `.riccon/evidence/`、`.riccon/reviews/`                         |
| 质量门禁       | 检查任务完成、证据真实、评审独立、无阻塞决策、scope 未越界         | `state.gate`、`gate check` 报告                                 |
| 发布治理       | 发布记录、用户批准、T4 产物、第二评审、沙箱检查、回滚演练          | `.riccon/releases/`、`RELEASE` 评审                             |
| 恢复与交接     | 从状态 + handoff 恢复，不依赖旧聊天；记录下一步、不变量和风险      | `.riccon/handoffs/`                                             |
| 成本可见       | 记录模块请求数、token、墙钟和成本估算                              | `module cost`、`budget_usage`                                   |

---

## 六个角色

| 角色               | 负责                                                             | 不写                          |
| ------------------ | ---------------------------------------------------------------- | ----------------------------- |
| `riccon/lead`      | 合同提案、状态、计划、派单、门禁、决策、评审包、handoff          | 生产源码、测试、迁移          |
| `riccon/product`   | 产品目标、用户故事、验收标准、范围、UX 流程、文案、非生产原型    | 生产源码、测试、部署          |
| `riccon/architect` | 技术栈、架构、数据模型、API/事件契约、ADR、初始脚手架、编码规范  | 功能代码、功能测试、生产 UI   |
| `riccon/builder`   | 任务 `write_scope` 内的生产源码、单元/集成测试、迁移、代码级文档 | 决策、其他 agent 的报告、合同 |
| `riccon/verifier`  | 独立验收/E2E 测试、代码审查、安全基线、评审报告、证据            | 生产源码、迁移、构建配置      |
| `riccon/ops`       | CI/CD、容器、部署、可观测性、回滚、运行手册                      | 功能代码、产品行为            |

关键边界：

- 只有 **Lead** 可以 spawn subagent 或直接问用户；其他 agent 的 `subagent` 和 `question` 权限是 deny。
- **Builder 只把任务移到 `review`，不自己 `done`。**
- **Verifier 用新上下文**，不继承 builder 的推理；模块级验证必须独立复验。
- 高风险任务（认证、权限、迁移、并发、安全边界、AI 工具调用）在 `done` 前必须有独立 Verifier 评审。
- 任何人不能自我验收；Lead 不能既实现又批准。

### 并行 builder 的实例 owner

同一个 owner 同时只能有一个 `in_progress` 任务。需要 2–3 个 builder 并行时，每个 builder 实例使用唯一 owner，例如：

```text
riccon/builder-route
riccon/builder-quota
riccon/builder-key
riccon/builder-cost
```

每个任务仍然必须声明不重叠的 `write_scope`；一个文件只能有一个 writer。`--force` 不会绕过 active-task 冲突。

---

## 轨道与交付循环

| 轨道 | 适用场景                        | 流程                                                       |
| ---- | ------------------------------- | ---------------------------------------------------------- |
| T1   | bug 修复、小改动                | intake → 修复 → review → 回归                              |
| T2   | 现有产品加功能                  | intake → 轻量设计 → 构建 → review → 测试                   |
| T3   | 0→1 MVP、重大子系统             | G0–G6：intake、define、plan、build、verify、release、retro |
| T4   | 认证、支付、PII、迁移、生产关键 | T3 + 威胁建模、性能、回滚演练、明确发布批准                |

### 模块生命周期

```text
planned → building → verifying → review_pending → done
```

- 依赖全部 `done`，且前一个用户可见模块完成 Product/用户验收后，下一个用户可见模块才能开始。
- 修复模块用 `kind: fix` + `fixes_module`，不受源模块未验收阻挡。
- 模块进入 `review_pending` 前，所有任务必须 `done`。
- 模块 `done` 前：gate 必须 pass，Product 预验收必须 pass。
- 模块 `done` 后：再做用户最终验收；用户 `accepted` 前不启动下一个用户可见模块。

### 任务生命周期

```text
planned → ready → in_progress → review → done
```

- 任务进入 `in_progress` 前，模块必须是 `building`，依赖必须全部 `done`。
- 任务必须有 `write_scope` 和验收标准；范围过大时在开始前拆分。
- 一个任务只承载一个可独立验收的用户可见结果。
- 任务第一次进入 `in_progress` 时记录 `baseline_commit`；review/done 时检查 `write_scope` 外的改动。
- `review`/`done` 至少需要一条证据；`done` 还需要最新一条执行证据为 exit 0。

---

## 质量与治理

### 合同是唯一事实源

目标项目的 `AGENTS.md` 管理区块包含：

- 项目类型、风险等级、产品目标、用户、MVC、non-goals、成功指标和模块路线图；
- 技术栈、仓库地图、构建/测试/覆盖率/E2E/a11y/security 命令；
- 必需/可选工具及降级方案；
- 环境、集成、数据和约束；
- 模块/发布 DoD；
- 决策所有者；
- 预算策略。

规则：

- 每个会话先读合同并运行 `riccon contract validate`。
- 不假设技术栈、目录名或命令；读合同。
- 改技术栈、命令、工具或 DoD 必须有已答复的决策和 diff。
- 合同与仓库冲突时停下来问，不要猜。

### 证据不是声明

证据是记录下来的产物：

- 命令、工作目录、退出码、开始/结束时间和耗时；
- 捕获的输出及其 hash/路径；
- UI/E2E 的截图、trace、报告或预览 URL；
- 任务 ID 和产生它的 agent。

```bash
riccon evidence run --task TASK-0001 --agent riccon/builder -- "npm test"
riccon evidence add --task TASK-0001 --command "npm test" --output test.log --exit-code 0
```

严格模式（新项目默认）下：

- **模块 review** 的 `dod_evidence` 必须把 `acceptance/build/tests/e2e/coverage/docs` 绑定到真实、非 manual、exit 0、已列入 `reviewed_evidence` 的 EV；RELEASE 评审用 `reviewed_evidence` 覆盖发布证据，不复用模块 review 的 `dod_evidence` 绑定；
- `build/tests/e2e/coverage` 的 EV 命令必须覆盖合同对应命令；
- 先提交再取证；`dirty: true` 的证据会让 gate 失败；
- 空命令、`not-implemented`、`true`、`echo`、`sleep`、未加引号的管道、`|| true`、`; true`、后台 `&` 等掩盖失败的写法会被拒绝；
- gate 会重算日志 hash 和字节数，校验 commit 是 HEAD 祖先，拒绝被改过的证据。

Verifier 必须识别假绿：

- 命令执行了零个测试；
- 测试被跳过且没有 owner/到期时间；
- retry 掩盖 flake；为通过追加参数必须记 P2 finding + owner + 到期；
- 测试没有断言，或只对坏状态做快照；
- 命令吞掉错误或永远 exit 0；
- 证据缺失、被截断，或来自另一个工作区；
- gate 只校验计划，不校验证据；
- review 由变更作者自己写。

### 独立评审

- 模块评审写在 `.riccon/reviews/<module>-review.md`，参与模块 gate。
- 任务级/架构级评审写在 `.riccon/reviews/tasks/<task>-review.md`，不参与模块 gate，由 Lead 在 closeout 核对。
- Review 必须绑定当前 module、最新证据、reviewer 元数据和 `independent: true`。
- `reviewer.session` 应是真实 `ses_...` 会话 ID；0.1.9 起新 review 使用合成标签会让 gate 失败，旧 review 只产生 warning。
- P0/P1 必须在 gate 通过前修复，gate/release 始终失败；P2/P3 不能保持 `open`，必须 `fixed` 或带 `owner`/`due`/`accepted_reason` 的 `accepted`。0.1.11 之前的旧评审在 `state validate` 中只产生 warning，不追溯失败。
- 模块评审必须给出 `verdict`、DoD 清单、按严重级别排序的 findings 和证据链接。
- 0.1.11 起，模块评审用 `reviewed_task_reviews` 列出本模块每个已有 task review 的最新 `review_id`；缺失时新评审不能通过 gate。替换旧模块评审前先归档到 `.riccon/archive/reviews/`，`previous_review` 找不到会让 `state validate` warning。

### 门禁

`riccon gate check --module M01` 检查：

- 合同有效；
- 模块存在，且不是 planned/blocked；
- 所有任务 done，最后一条执行证据通过，没有 blocker；
- 每个证据的输出存在、hash/字节匹配、属于该任务；
- review 存在、有效、verdict pass，绑定当前 module，覆盖最新证据且晚于证据，reviewer 独立；
- 合同 DoD 全部为 true，且 strict 绑定时每项都有真实 passed EV；
- 没有 open/accepted P0/P1；0.1.11 起新评审不得有 open P2/P3，accepted P2/P3 必须带 owner/due/accepted_reason；
- 没有被阻塞的开放决策；
- 墙钟在模块上限内（或 `--allow-overrun`）；
- `--require-scope` 可把无 baseline 的 scope 检查从 warning 升级为 fail。

Gate 结果写入 `state.gate`。`module update M01 --status done` 会运行 gate，失败时拒绝标记 done。

### 决策包

用户决策是一个包，不是聊天里的一句话：

- 问题和为什么现在要定；
- 选项及后果；
- 推荐；
- 用户沉默时的默认值；
- 截止时间和所有者。

用户拥有产品、UX 方向、不可逆/高成本技术选择、交付、花钱和风险例外。团队拥有常规架构、库选择、重构、测试和文档。T4、生产、花钱或破坏性操作永远不允许沉默通过。

### 交接

`.riccon/handoffs/handoff-0001.md` 记录：

- 摘要、下一步、不变量、风险和 first-read 路径；
- 当前模块/task、开放决策、gate 和验收状态；
- 新会话只读 `.riccon/` + handoff 就能继续，不需要重读旧聊天。

handoff 前必须满足：

- 没有 `in_progress`/`review` 任务；
- done 任务都有证据；
- phase 为 modules/release/operate 时 gate 为 pass；
- gate 的 `checked_at` 不早于被 gate 模块的最新任务/评审；
- `next` 非空且不是占位词；
- `first_read` 路径存在。

0.1.8 起，gate 新鲜度只比较**被 gate 模块**的任务和模块评审；其他模块的任务/评审不会让 gate 过期。

---

## 并行交付与上下文

### 并行规则

- 一个 task 同时只能有一个 active subagent；同一个 task 不并行派单。
- 并行只用于不同 task/module，且写范围完全不重叠；一个文件只能有一个 writer。
- 最多 2–3 个 builder 实例并行，每个实例使用唯一 owner。
- 同一 owner 同时只能有一个 `in_progress`；第二个任务必须等第一个进入 `review`。
- Verifier 每个 task 使用新上下文；不要复用上一个 task 的 verifier 会话。
- 模块 gate 的 `test` 和 `coverage` 可以共用同一条 coverage 全量命令和同一条 EV，避免同一提交跑两遍全量。
- 长命令被 shell 移到后台后，agent 结束回合并等待自动恢复通知；禁止 `sleep`/`tail`/`ps` 轮询。

### 上下文预算

- 输入接近 **120K tokens**、已用 **300/440 steps**、**60 次工具调用**，或自动 compaction 一次，是检查点，不是强制 handoff。
- 先判断现在切会不会降低质量或导致返工；不会才在安全边界切。
- Architect/Verifier 接近上下文预算时，优先在 task 边界拆新 subagent，不要在 review 或验证中途切。
- handoff 不替代 gate、review 或用户批准。

### 并行任务与 scope

- 同一模块允许多个不同 owner 的并行任务，但每个任务必须声明不重叠的 `write_scope`。
- 项目级 scope 校验使用全项目所有任务 `write_scope` 的并集做路径归属；并集只能回答“这个路径被某个任务声明过”，不能证明 authorship。
- 并行任务结束后，Verifier 必须人工审阅 `git diff baseline..end` 的实际内容；不能仅凭 gate 的 union 结果判定 authorship。

---

## 安全、权限与沙箱

- 项目内读/写/执行、MCP 工具、网络访问和 skills 默认 allow。
- 破坏性、对外副作用、金钱/身份/法律、敏感数据操作前 ask。
- 编辑合同、`.opencode/**`、`.git/**`、已安装的 Riccon 内核，以及写项目外目录前 ask。
- 只有 subagent spawn 和直接问用户受角色限制。
- 数据库和服务的真正安全边界是沙箱/一次性运行时；权限模式不是。
- 绝不把密钥写进仓库、状态、日志、任务卡、证据、提示词或 handoff。
- T4 发布前运行 `riccon sandbox check` 和 `riccon release check`。
- `sandbox check` 是声明 + 脚本静态检查 + 日志，不是 runtime attestation；真实隔离仍需可信 runner 或用户风险接受。

---

## 发布门禁

`riccon release check` 检查：

- 合同有效，phase 为 `release` 或 `operate`；
- 所有模块 `done`；
- 每个模块 `product_acceptance.product_status` 为 `pass`，`user_status` 为 `accepted`；
- 发布记录存在且状态为 `approved`/`released`；
- 批准决策已 `answered`、owner 为 `user`、`answer_kind: approve`，绑定同一 `release_id`/`environment`；
- release evidence 全部存在、属于已知任务、hash 匹配、非 manual、exit 0；
- 发布产物存在：T4 要求威胁模型、负载测试、回滚演练和 runbook；T1–T3 至少要求回滚演练和 runbook；
- `RELEASE` 评审 verdict pass，覆盖 release 全部 evidence，reviewer 独立且使用真实 `ses_...` 会话 ID；模板见 `templates/state/release-review.md`，用 `reviewed_evidence` 覆盖发布证据；
- 没有 open/accepted P0/P1；0.1.11 起新评审不得有 open P2/P3，accepted P2/P3 必须带 owner/due/accepted_reason；没有被阻塞的开放决策；
- T4 调用 `sandbox check`，并要求 release evidence 包含 `sandbox.evidence` 指向的 passing EV；
- T4 staging/production 还需要第二评审文件，绑定同一 release/version/environment，使用不同 model/agent/session。

生产发布必须明确 yes，沉默不算批准。

---

## 快速开始

要求：**Node.js ≥ 26**，OpenCode 已安装。

```bash
git clone https://github.com/ai-riccon/riccon-agents.git
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

安装器只写 agent/command/skill 相关目录和 `~/.config/opencode/riccon/`，不修改 `opencode.json` 或 `default_agent`。

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

### 已有项目

```bash
riccon adopt --write          # 只读分析后写入状态骨架
riccon upgrade --write        # 同步团队管理的 AGENTS 区块和文档
riccon contract validate      # 校验项目合同
riccon state validate         # 校验状态、任务、证据和评审引用
```

`adopt` 默认 legacy evidence binding；新项目默认 strict。`upgrade` 不覆盖项目自己的合同命令和文档正文，只同步团队管理区块。

---

## 主要命令

下列命令中的 `riccon` 指已安装内核的 CLI；如果 `command -v riccon` 为空，使用 `node "$HOME/.config/opencode/riccon/scripts/riccon.mjs"`。

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

OpenCode 命令：

```text
/riccon-start
/riccon-status
/riccon-plan
/riccon-review
/riccon-decision
/riccon-resume
/riccon-release
/riccon-improve
```

---

## 状态目录

```text
.riccon/
├─ project.json          项目元数据和合同 hash
├─ state.json            phase、当前模块、gate、health、next、预算
├─ modules/              模块目标、验收、任务、review、墙钟上限
├─ tasks/                owner、status、write_scope、验收、证据、tools
├─ decisions/            问题、选项、推荐、截止、默认值、答案
├─ evidence/             按任务分组的命令日志和 hash
├─ reviews/              模块评审
│  └─ tasks/             任务级/架构级评审
├─ handoffs/             会话摘要、下一步、不变量、风险
├─ releases/             发布记录、批准、产物和证据
├─ runs/                 命令和使用记录
└─ archive/              旧状态，不静默删除
```

机器状态用 JSON；决策、发布、评审和 handoff 用带 YAML front matter 的 Markdown。任何地方都不要存密钥。

---

## 仓库结构

```text
.opencode/agents/riccon/     Lead、Product、Architect、Builder、Verifier、Ops
.opencode/commands/           /riccon-start、status、plan、review、decision、resume、release、improve
.opencode/skills/            core、contract、verify、docs
schemas/                     状态和记录的 JSON schema
scripts/                     内核、CLI、安装器、adopt、gate、release、sandbox
templates/                   项目合同、文档、状态记录模板
tests/                       内核、安装器和模板测试
docs/                        设计、合同、状态、权限、沙箱、评测、模型
```

agent 定义、命令和 skills 是团队管理的唯一事实源；目标项目里的 agent 不得编辑 `.opencode/**`。

---

## 设计原则

- **合同先于代码**：技术栈、命令、DoD、权限不明确就不开工。
- **证据先于声明**：没有 exit 0、可复现的证据，不算完成。
- **独立验证**：Builder 不自证；Verifier 用新上下文检查产物。
- **fail-closed**：无效 commit、缺失证据、占位命令、越界 scope 直接失败。
- **小步交付**：一个模块一条关键旅程；任务范围过大时拆分。
- **人类保留关键决策**：生产、花钱、破坏性操作和产品范围由用户决定。
- **技术栈无关**：团队定义不绑定框架、数据库或目录结构。
- **上下文有预算**：长会话在安全边界交接，不把半截工作留给下一个会话猜。
- **时间默认北京时间**：`Asia/Shanghai`（UTC+08:00）；内核时间戳、证据、日志和 UI 使用带偏移的时间；数据库按合同/ADR 使用带时区类型或显式存储偏移。

---

## 诚实限制

- 这是**受监督原型**，不是生产就绪平台。
- 本地内核不能密码学证明“谁批准/谁评审”；reviewer 元数据仍是自报。
- EV JSON、日志和 commit 绑定能发现不一致，但不能证明执行真实发生。
- sandbox check 是声明 + 脚本静态检查 + 日志，不是 runtime attestation。
- scope 检查只能做路径归属，不能证明 authorship；合并前仍需人工看 diff。
- 生产发布、真实 PII、生产密钥和 T4 生产环境必须单独评审与批准。
- Agent 是概率系统；合同、证据和 gate 降低风险，但不能消除错误。

---

## 文档

- [设计](docs/DESIGN.md)
- [项目合同](docs/CONTRACT.md)
- [状态与门禁](docs/STATE.md)
- [权限](docs/PERMISSIONS.md)
- [沙箱](docs/SANDBOX.md)
- [评测方法](docs/EVALS.md)
- [模型映射](docs/MODELS.md)

---

## 许可

Apache-2.0。见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
