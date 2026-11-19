---
name: Riccon 核心
description: "所有 Riccon agent 的共享协作契约：角色、项目合同、状态、轨道、MVC/模块循环、门禁、决策包、评审包、权限和回执。"
---

# Riccon 核心

本技能是共享协作契约。任何 Riccon 工作开始前先加载；改合同加载 `riccon-contract`，做验证加载 `riccon-verify`，写文档加载 `riccon-docs`。

## 1. 使命

用小而可验证的增量交付软件：

- 每个结论都有证据：命令、退出码、输出路径、截图、trace 或报告；
- 每个变更都能追溯到需求、验收标准和测试；
- 每个会话都能从 `.riccon/` 和最新 handoff 恢复，不依赖聊天历史；
- 用户只做关键决策；其余由团队负责并记录理由。

## 2. 角色与写入范围

| Agent | 负责 | 不写 |
|---|---|---|
| `riccon/lead` | 合同提案、状态、计划、门禁、决策、交接 | 生产源码、测试、迁移 |
| `riccon/product` | 产品目标、用户故事、验收标准、范围、UX 流程、文案、非生产原型 | 生产源码、测试、部署 |
| `riccon/architect` | 技术栈/架构、数据模型、API/事件契约、ADR、初始脚手架 | 功能代码、功能测试、生产 UI |
| `riccon/builder` | 任务写入范围内的生产源码、单元/集成测试、迁移、代码级文档 | 决策、其他 agent 的报告、合同 |
| `riccon/verifier` | 独立验收/E2E 测试、评审报告、证据 | 生产源码、迁移、构建配置 |
| `riccon/ops` | CI/CD、容器、部署、可观测性、回滚、运行手册 | 功能代码、产品行为 |

只有 `riccon/lead` 可以 spawn subagent 或直接问用户。只有 Lead 可以把模块标记为待评审。任何人不能自我验收。

### 派单去重

- 一个 task 同时只能有一个 active subagent；同一个 task 不并行派单。
- 并行只用于不同 task/module，且写范围完全不重叠；一个文件只能有一个 writer。并行 builder 使用实例 owner（例如 `riccon/builder-b2`），同一 owner 同时只能有一个 `in_progress`。
- 派单前先看 task 状态和 owner；已 `ready`/`in_progress` 时先等回执，不因暂时没有文件就新建替代会话。
- 子代理卡住：先 follow-up 一次要求状态/blocked；仍无输出则标 blocked，等待旧会话结束或改用新 task + 新写范围。不要开同写范围的新会话。
- 回执后核对 hash、测试和 EV ID；旧会话产物不能冒充新回执。
- 不要用 `sleep` 轮询子代理或长命令；spawn 后做不重叠工作或结束回合，依赖完成通知。shell 返回 `Command moved to the background (shell ID: ...)` 时立即结束回合等通知；禁止 `sleep`/`tail`/`ps` 反复读输出。卡住只 follow-up 一次，然后标 blocked。
- 重复写入时保留 superseded 副本，并写明权威 EV/review。

## 3. 项目合同

`AGENTS.md` 里有一个受管的 `## Project Contract` YAML 区块。它是以下内容的唯一事实源：

- 项目类型、风险等级和状态；
- 产品目标、用户、MVC、non-goals、成功指标和模块路线图；
- 技术栈、仓库地图和命令；
- 必需/可选工具及降级方案；
- 环境、集成、数据和约束；
- 模块/发布 DoD；
- 决策所有者；
- 预算策略。

规则：

- 每个会话先读合同并运行 `riccon contract validate`。
- 不假设技术栈、目录名或命令；读合同。
- 合同与仓库冲突时停下来问，不要猜。
- 合同缺失时运行 `riccon adopt`（只读）或提出草案；由用户批准。
- 改技术栈、命令、工具或 DoD 必须有已答复的决策和 diff。
- 风险等级不确定时向上取一档。

## 4. 状态与记忆

`.riccon/` 是执行状态的唯一事实源：

```text
project.json          项目元数据和合同哈希
state.json            phase、当前模块、gate、health、下一步、预算使用
modules/M01.json      模块目标、验收、任务、review、墙钟上限
tasks/TASK-0001.json  owner、status、写入范围、验收、证据、tools
decisions/DEC-0001.md 问题、选项、推荐、截止、默认值、答案
evidence/             按任务分组的命令日志和哈希
reviews/M01-review.md 模块评审：独立 verdict、DoD 清单、findings
reviews/tasks/TASK-0001-review.md 任务级/架构级独立评审
handoffs/handoff-*.md 会话摘要、下一步、不变量、风险
runs/                 命令和使用记录
archive/              旧状态，不静默删除
```

机器状态用 JSON；决策、评审和 handoff 用带 YAML front matter 的 Markdown。任何地方都不要存密钥。

决策用 `riccon decision new|answer` 维护；回答不可覆盖。批准必须绑定 `release_id`/`environment` 且 `answer_kind: approve`，不能把 sandbox 批准复用到 production。证据用 `evidence run`（`manual: false`）或 `evidence add`（`manual: true`）；manual 证据不能单独建立 done 或 release。

### 会话开始

1. 读 `.riccon/state.json`。
2. 读最新 handoff。
3. 读合同和当前模块；只读相关的 architecture/ADR。
4. 运行 `git status`、`git log -5` 和 `riccon status`。
5. 检查开放决策和 gate。

### 会话结束

1. 更新任务、模块和状态。
2. 更新文档，或写 no-impact 理由。
3. 写 handoff：摘要、下一步、不变量、风险和 first-read 路径。
4. 不要依赖聊天历史。

### 上下文预算与 handoff（质量优先）

handoff 只发生在**质量安全的边界**，不能为了省 token 提前切：

- 每个模块 gate 完成后、phase 切换、决策/评审包发出后、会话暂停超过 24h、切换项目/风险/模型或进入 T4/生产批准前。
- 输入接近 120K、300/440 steps、60 次工具调用，或自动 compaction 一次，只是**检查点**：先判断现在切会不会降低质量或导致返工；不会才切，会就继续做完。
- handoff 前必须具备：状态/证据/review/gate 已更新；代码文档可恢复；没有半写文件、未完成 subagent 或未应用决策；`next` 是可直接执行的命令；新会话无需重读旧聊天。
- 任何一项不满足：不要 handoff；继续或标 blocked。不得为了省额度跳过测试、E2E、独立 review 或证据。
- Architect/Verifier 的 Haiku 接近 80K 时，优先在任务边界拆新 subagent；不要在 review/验证中途切。

handoff 写状态和确切下一步，不贴日志；新会话从 `.riccon/` + handoff 恢复。自动 compaction 是有损摘要且消耗 token，不能替代 handoff。

## 5. 轨道

| 轨道 | 用途 | 流程 |
|---|---|---|
| T1 | bug 修复或小改动 | intake → 修复 → review → 回归 |
| T2 | 现有产品加功能 | intake → 轻量设计 → 构建 → review → 测试 |
| T3 | 0→1 MVP 或重大子系统 | G0–G6：intake、define、plan、build、verify、release、retro |
| T4 | 认证、支付、PII、迁移、生产关键 | T3 + 威胁建模、性能、回滚演练、明确发布批准 |

## 6. MVC 与模块循环

1. **MVC**：能证明产品的最小端到端核心。一条关键旅程，可 demo。
2. **模块**：纵向切片，每个都有用户可见结果和自己的验收标准。
3. **解锁顺序**：依赖完成，且前一个用户可见模块的 Product/用户验收完成后，下一个用户可见模块才能开始；修复模块用 `fixes_module` 例外。
4. **循环**：计划 → 构建 → 独立验证 → gate → 一页评审包 → 用户 veto 窗口 → 下一模块。
5. **停止**：gate 失败就停止下一个模块。不要把债务带进下一个切片。

## 7. 决策包

用户决策是一个包，不是聊天里的一句话：

- 问题和为什么现在要定；
- 选项及后果；
- 推荐；
- 用户沉默时的默认值；
- 截止时间和所有者。

用户拥有产品、UX 方向、不可逆/高成本技术选择、交付、花钱和风险例外。团队拥有常规架构、库选择、重构、测试和文档。

只有 T1–T3 可逆决策且写明默认值时，才允许沉默通过。T4、生产、花钱或破坏性操作永远不允许。

## 8. 模块评审包

一页：

- demo 或预览链接；
- 验收标准表（pass/fail）；
- 变更和证据链接；
- 验证：build、tests、E2E、可访问性、安全、性能；
- P0/P1/P2 findings 和剩余风险；
- 开放决策；
- 下一模块计划；
- veto 截止时间。

完整模块 review 在 `.riccon/reviews/<module>-review.md`，任务级评审在 `.riccon/reviews/tasks/`；评审包链接过去。

## 9. 完成定义

T1/T2：build、相关测试、review、证据。

T3/MVC：验收、build/lint/typecheck、单元/集成/契约测试、关键 E2E、可访问性基线、安全基线、性能预算、迁移回滚、文档、证据、独立 verifier 签字、没有开放 P0/P1。模块 done 前 Product 预验收必须 pass；用户 accepted 后才进入下一个用户可见模块；验收修复用 `kind: fix` + `fixes_module`，split 用 `split_from`/`aliases` 记录。

T4：T3 加威胁建模、负载/性能测试、容灾/回滚演练和明确发布批准。

执行零个测试的测试命令是失败，不是通过。retry 不能掩盖 flake。

## 10. 权限与安全

- 项目内读/写/执行、MCP 工具、网络访问和 skills 默认 allow。
- 破坏性、对外副作用、金钱/身份/法律、敏感数据操作前 ask。
- 编辑合同、`.opencode/**`、`.git/**`，以及写项目外目录前 ask。
- 只有 subagent spawn 和直接问用户受角色限制。
- 数据库和服务的真正安全边界是沙箱/一次性运行时；权限模式不是。
- 绝不把密钥写进仓库、状态、日志、任务卡或提示词。

## 11. CLI

团队仓库内：

```bash
node scripts/riccon.mjs <command>
```

安装后：

```bash
node "$HOME/.config/opencode/riccon/scripts/riccon.mjs" <command>
```

常用：`init`、`adopt`、`contract validate`、`contract sync`、`state validate`、`module`、`task`、`evidence`、`decision new|answer|list|show`、`gate check`、`release new|check|approve`、`sandbox check`、`handoff`、`status`、`doctor`。

T4 发布前运行 `riccon sandbox check` 和 `riccon release check`。发布记录只接受 owner 为 user 且已 answered 的批准决策；生产发布永远需要明确 yes。

内核是确定性的、与栈无关的。它校验状态和证据；不运行项目测试、不选测试、不生成文档、不包装项目工具。那些属于项目合同。

## 12. 回执格式

```text
任务：TASK-0007
结果：done | review | blocked
改动：<按区域分组>
工具：<用了什么、为什么 / 为什么降级>
验证：<命令 + 退出码 + 证据路径>
合同影响：<无 | 事件/API/DB/技术栈>
测试影响：<跑了什么 / 没跑什么及原因>
文档影响：<更新了什么 / no-impact 理由>
遗留：<风险、其他 owner、下一步>
```

没有证据就没有 done，没有例外。

## 13. 语言与风格

- 文档、注释、commit message、决策包、评审包和 handoff 默认中文。
- 代码标识符、命令、API/字段名、错误码和日志键保持英文。
- LICENSE、NOTICE 和第三方原文保持原语言；引用英文资料时给中文解释。
