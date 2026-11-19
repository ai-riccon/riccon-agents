# 变更日志

## 0.1.8（2026-11-20）

- 修复 handoff gate 新鲜度检查：只与被 gate 模块的任务比较；其他模块的 planned/ready 任务不再让 gate 过期。
- 新增回归测试：新模块 planned 任务不阻塞 handoff；被 gate 模块的任务更新仍会触发 stale。

## 0.1.7（2026-11-20）

- 验证效率：verifier 每个 task 新开上下文；长命令移到后台后结束回合等待通知，禁止 `sleep`/`tail` 轮询；模块 gate 的 `test` 与 `coverage` 可共用同一条 coverage 全量 EV。
- 并行 builder：引入实例 owner 约定（如 `riccon/builder-b2`），同一 owner 仍只允许一个 `in_progress`；`--force` 不再绕过 active-task 冲突。
- 状态完整性：`state validate` 增加“in_progress 任务必须出现在 active_tasks”的反向检查，修复 `--force` 造成的幽灵 active task。
- 评审独立性：gate 识别 builder 实例 owner；新 review 要求真实 `ses_...` 会话 ID，旧合成标签只产生 warning。
- 模板和文档同步：目标项目硬规则、协作文档、任务/评审模板和 doctor 增加实例 owner、单次全量、真实 session ID 约定。

## 0.1.6（2026-11-19）

- 单一真源收敛：模型和步数以 `templates/agents/models.yml` 为准，权限和 agent frontmatter 由 `sync:agents` 同步，doctor 校验版本/模型/步数。
- 验收状态集中到 `acceptance.mjs`，从 module schema 读取枚举；Product pass 和用户最终验收增加生命周期约束。
- `state.validate` 增加验收顺序 warning；`state.schema.json` 补齐 `release_gate`。
- 目标项目 `AGENTS.md` 拆分为合同、内容索引、硬规则和 `docs/COLLABORATION.md` 详细规则；新增 managed team block 和 `riccon upgrade` 的同步基础。
- 修正 Product 预验收时点、下一模块解锁条件、review 命令、6 项 acceptance 阈值等文案漂移。

## 0.1.5（2026-11-17）

- 证据命令解析加固：新增轻量 shell 分段分析，未加引号的管道默认拒绝，`||` 只允许 `exit 非零`，`;`/后台 `&` 后的 `echo`、`true`、`cat`、`tee`、`sleep`、`exit 0` 拒绝。
- 归一化 `exit 000`、`exit +0`、`exit 256` 等退出码；识别 `|&`、分组、`sudo`/`time` 等前缀。
- 保留安全写法：`&&`、`|| exit 1`、`for ... || exit 1`、`2>&1`、带引号的 pipefail 脚本。
- 新增 `tests/shell.test.mjs`，并补充 gate 负例。

## 0.1.4（2026-11-17）

- strict DoD 证据绑定：合同新增 `quality.evidence_binding: strict|legacy`；review 用 `dod_evidence` 绑定真实、通过、已评审的 EV。
- 空命令、`not-implemented`、占位/no-op 命令在 strict gate 失败；新项目默认 strict，`adopt` 默认 legacy。
- 显式任务 scope：`task update --baseline-commit/--end-commit`，校验 commit 存在、HEAD 祖先和顺序。
- 先提交再取证：strict 下 `dirty: true` 证据失败；任务范围过大时提示拆分。
- 新增 `module cost`，按模块记录 requests/tokens/墙钟/成本估算。
- `adopt` 识别 `client/frontend/web/...` 子项目，写入 `stack.subprojects`。

## 0.1.0

- 首个公开快照：合同、模块、任务、证据、独立评审、gate、handoff、发布门禁、沙箱检查、adopt、CLI、安装器、agent 定义和模板。
