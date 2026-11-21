---
description: 只读分析指定项目最近一次会话，评估 Riccon 团队交付质量与执行效率，提出并在确认后验证团队优化。
---

# /riccon-improve

加载 `riccon-core`、`riccon-contract`、`riccon-verify` 和 `riccon-docs`。

用户调用时必须提供目标项目路径。没有提供时只问一次“目标项目路径是什么？”，不要猜。

内核命令统一使用安装后的路径，不要依赖 `riccon` 在 PATH：

```bash
RICCON="node $HOME/.config/opencode/riccon/scripts/riccon.mjs"
```

## 0. 阶段与硬约束

本命令分四个阶段，顺序不能跳：

1. **只读分析**：读目标项目，不写任何文件。
2. **方案确认**：只输出方案，等用户明确确认。
3. **执行与验证**：只改 `riccon-agents`，改完做落地验证。
4. **项目同步 prompt**：只输出给项目侧 Lead 的 prompt，不直接改目标项目。

硬约束：

- 只读阶段禁止修改目标项目、`riccon-agents` 或 `.riccon/`；禁止运行 `upgrade`、`contract sync`、`state` 写操作、`evidence run`、`handoff new`。
- 不读取或复制 `.env`、密钥、生产凭据、PII、私有 URL；证据日志只摘要，不贴敏感内容。
- 不从聊天历史推断状态；以目标项目的 `.riccon/`、最新 handoff、合同和 git 为准。
- 任务质量优先于效率。不得为了提速降低 DoD、覆盖率、E2E、a11y、security、性能预算、独立评审、证据或 gate 标准。
- 不得删除、改写或追溯修改历史评审、证据和 handoff。
- 团队级问题只改 `riccon-agents`；项目级问题只写进最后的项目侧 prompt。
- 没有真实缺陷时不要为了“有产出”而制造优化；明确说“不需要改”。

## 1. 只读分析输入

按顺序读取，缺失时记录“证据不足”，不要猜：

1. 目标项目 `AGENTS.md` 的 Project Contract、`docs/COLLABORATION.md`、`docs/CODING-STANDARDS.md`、`docs/SANDBOX.md`。
2. `.riccon/project.json`、`.riccon/state.json`、最新和上一份 `.riccon/handoffs/handoff-*.md`。
3. 最近会话窗口内的 `.riccon/tasks/`、`.riccon/modules/`、`.riccon/evidence/`、`.riccon/reviews/`、`.riccon/decisions/`、`.riccon/releases/`、`.riccon/runs/`。
4. `git log`、`git status`、`git diff --stat`、相关 commit 的 `git show --stat`；只读。
5. `riccon-agents` 当前 `package.json`、`scripts/lib/version.mjs`、`templates/` 和 `.opencode/` 的规则，用来区分“项目特有”与“团队模板/prompt/门禁缺陷”。

先比较目标项目 `.riccon/project.json` 的 `team_version` 与当前团队版本。旧版本可能已经修复了部分问题；把“版本漂移”与“当前团队仍存在的缺陷”分开，不要把已修复的历史问题重复算作新优化。

## 2. “最近一次会话”的界定

- 按 front matter `created_at` 排序 handoff；最新一份是当前会话边界，上一份用于确定窗口起点。
- 默认窗口：`上一份 handoff.created_at < t <= 最新 handoff.created_at`。
- 没有上一份 handoff 时，用最新 handoff 的 `session`、`quality_gate`、`created_at` 和当前 state 作为窗口；仍不足时，用最近 20 个 commit / 最近 24 小时作为补充，并明确标注不确定性。
- 没有 handoff 时，明确写“缺少 handoff，无法准确界定会话”，改用当前模块、最新评审/证据和 git 最近提交，降低结论强度。
- 如果 `status` 显示 last handoff stale，把它记为一个交接效率问题，但仍用最新 handoff + 当前 state 重建窗口；不要因为 stale 就跳过分析。

## 3. 交付质量分析

至少检查：

- gate / release gate 状态，失败项和修复历史。
- 模块 Product 预验收、用户最终验收、accepted/rejected/conditional 的状态和顺序。
- 模块/任务 review 的 verdict、DoD 布尔值、`dod_evidence`、`reviewed_evidence`、reviewer 独立性和 session 真实性。
- P0/P1/P2/P3 findings 是否关闭；有没有 open P0/P1/P2/P3，或缺少 owner/due/accepted_reason 的 accepted；模块评审是否列出 `reviewed_task_reviews`。
- 证据是否真实：manual、dirty、空命令、占位命令、日志 hash/字节、commit 祖先、scope 越界、任务归属。
- 测试是否可能假绿：零测试、skip、retry、无断言、吞错、永远 exit 0、全量重复或缺失。
- 高风险任务（认证、权限、迁移、并发、安全边界、AI 工具调用）是否有独立 Verifier 在 done 前评审。
- 任务粒度、验收标准可观察性、模块拆分、fix/rework 模块是否合理。
- 文档、runbook、ADR、CODING-STANDARDS 是否与实现/合同一致。

任何 P0/P1、自证、假绿、缺证据或 scope 漏检都优先按质量问题处理；效率优化不能抵消它们。

## 4. 执行效率分析

至少检查：

- 模块墙钟与上限、任务耗时、证据 `duration_ms`、命令超时和后台等待。
- 证据重跑、失败命令、retry、同一命令重复取证、全量测试重复执行。
- 任务/模块返工、blocked 次数、review fail 次数、修复模块数量、重复派单或 owner 冲突。
- handoff 频率、上下文预算检查点、subagent 拆分是否在安全边界、是否因上下文切换造成返工。
- 决策等待、开放阻塞决策、last handoff stale、未完成验收导致的解锁停滞。
- 工具缺失/降级、MCP 不可用、命令不可复现、环境准备时间。
- 模块 `budget_usage` 和 `state.budget_usage` 是否记录、口径是否一致；未测量不能当成零成本。

效率问题必须和交付质量分开写；如果提高效率会降低质量，直接否决该优化。优化前后尽量用同一会话窗口/命令做基线对比；没有基线时只写预期，不要声称已经提升。

## 5. 只读阶段输出格式

先输出一页分析，不要改文件：

1. **结论**：健康 / 需要优化 / 证据不足。
2. **会话窗口**：latest handoff、previous handoff、session、时间范围、目标项目 team_version。
3. **证据表**：问题、来源文件/行、时间、影响；不贴敏感日志。
4. **团队缺陷**：按质量/效率分组，标注 P0–P3、根因属于 prompt、模板、门禁、schema、文档、权限还是工具链。
5. **项目特有因素**：明确哪些问题应由项目侧处理，不混入团队优化。
6. **优化方案**（只有需要时）：
   - 排序原则：先修复会放行错误、假绿或越权的质量问题，再修复交接/上下文，最后才优化速度；
   - 目标与非目标；
   - 按“质量优先”排序的改动清单；
   - 预计修改的 `riccon-agents` 文件；
   - 验收标准和验证命令；
   - 风险、兼容性、回滚方式；
   - 明确不做什么（不降门禁、不删历史证据、不改目标项目）。

输出方案后停止，明确写：

> 以上只是方案，尚未修改任何文件。请确认是否执行；确认后我才开始改 `riccon-agents`。

## 6. 确认后的执行

用户明确确认后才执行：

- 只改 `riccon-agents`，不直接改目标项目。
- 按仓库 `AGENTS.md` 的规则修改；保持技术栈无关，更新 canonical 文档，不新增平行文档。
- 行为/命令/模板变化同步更新测试、模板、README、CHANGELOG 和版本号；权限/模型变更运行 `npm run sync:agents`。
- 新增或修改规则必须可验证；不要只改文案而不改对应代码，反之亦然。
- 不做全局安装，除非用户明确要求。

## 7. 执行后的真实落地验证

改完必须验证，不能只说“已完成”：

- 检查 diff：只包含方案内文件，没有顺手重构、密钥或无关改动。
- 运行 `npm test`、`npm run check`、`node scripts/riccon.mjs doctor`。
- 行为变化用临时项目做最小场景验证；规则变化检查 schema、模板、命令和文档是否同步。
- 检查版本号、命令列表、agent 权限/模型、模板、doctor 检查、CHANGELOG 是否一致。
- 搜索过期或冲突文案：旧版本号、旧模型名、旧路径、旧命令、旧规则、重复事实源。
- 安装 dry-run：`node scripts/install.mjs --dry-run`。
- 任一项失败就继续修或报告失败；不得把失败说成完成。

验证输出必须包含：修改文件、测试/命令结果、未覆盖项和剩余风险。

## 8. 项目侧同步 prompt

验证通过后，给用户一段可直接发给目标项目 Lead 的 prompt。prompt 必须：

- 说明团队版本变化和需要同步的文件；
- 区分 `upgrade` 能自动同步的 managed block 和需要人工合并的 `docs/COLLABORATION.md`；
- 列出合同、模板或文档变化，但不包含密钥/PII；
- 要求项目 Lead 先读状态和 handoff，再执行；T4/生产/安全策略变更先走决策；
- 要求运行 `contract validate --strict`、`contract sync`、`state validate` 和相关 gate/release 检查；
- 明确不要改业务源码、不要改写历史评审/证据、不要静默降级；
- 要求更新 handoff 并回报证据。

只输出 prompt，不要替项目侧执行。

## 9. 最终回执

最后按顺序给出：

1. 只读分析结论；
2. 是否执行了优化；
3. 实际修改和验证结果；
4. 过期/冲突文案检查结果；
5. 给项目侧 Lead 的同步 prompt。

没有证据的结论不要写成事实；无法验证时写“未验证”和原因。
