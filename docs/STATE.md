# 状态模型

`.riccon/` 是执行状态的唯一事实源。聊天历史不是记忆。

所有状态、证据、评审、决策、发布和 handoff 时间戳默认北京时间（`Asia/Shanghai`，UTC+08:00），格式为带偏移的 ISO 8601；`Date.parse` 仍可比较不同偏移的时间。

## 布局

```text
.riccon/
├─ project.json          项目元数据和合同哈希
├─ state.json            phase、当前模块、gate、health、下一步、预算使用
├─ modules/
│  └─ M01.json           模块目标、验收、任务、review、墙钟上限
├─ tasks/
│  └─ TASK-0001.json     owner、status、写入范围、验收、证据、tools
├─ decisions/
│  └─ DEC-0001.md        问题、选项、推荐、截止、默认值、答案
├─ evidence/
│  └─ TASK-0001/         命令日志和 EV-*.json 记录
├─ reviews/
│  ├─ M01-review.md      模块评审：独立 verdict、DoD 清单、findings
│  └─ tasks/
│     └─ TASK-0001-review.md  任务级/架构级独立评审
├─ releases/
│  └─ REL-0001.md        版本、环境、发布产物、用户批准
├─ handoffs/
│  └─ handoff-0001.md    会话摘要、下一步、不变量、风险
├─ runs/                 命令和使用记录
└─ archive/              旧状态；不静默删除
```

机器状态用 JSON。决策、评审和 handoff 用带 YAML front matter 的 Markdown。任何地方都不要放密钥。

## 实体

### 项目

`project.json`：`schema_version`、`team_version`、`name`、`type`、`risk_tier`、`status`、`contract.path`、`contract.sha256`、时间戳。`loadContract` 会重算 AGENTS.md 合同区块的 SHA-256；不一致时 `contract validate`/`state validate`/gate/release 失败，`contract sync` 修复。

### 状态

`state.json`：`phase`、`current_module`、`gate`、`health`、`last_handoff`、`next_action`、`active_tasks`、`budget_usage`、时间戳。

Phases：`init`、`contract`、`discovery`、`mvc`、`modules`、`release`、`operate`、`blocked`。

### 模块

`modules/M01.json`：`id`、`title`、`goal`、`kind`（`mvc|feature|fix`）、`status`、`depends_on`、`acceptance`、`tasks`、`review`、`wall_clock_limit_hours`、`started_at`、`finished_at`、`budget_usage`。

模块状态：

```text
planned → building → verifying → review_pending → done
   任意活动状态 → blocked → planned/building/verifying
```

依赖全部 `done` 后模块才能进入 `building`。`review_pending` 需要至少一个任务且所有任务 `done`；它不是未完成工作的等待区。`done` 表示 gate 通过，下一个模块可以开始。

### 任务

`tasks/TASK-0001.json`：`id`、`module_id`、`title`、`owner`、`status`、`write_scope`、`acceptance`、`evidence`、`tools_used`、`blocker`、`baseline_commit`。

任务状态：

```text
planned → ready → in_progress → review → done
   任意活动状态 → blocked
```

`review` 和 `done` 至少需要一条证据。`done` 还需要至少一条**执行证据**（`manual: false`），且该任务最后一条执行证据必须 `exit_code: 0`；只有手工 `evidence add` 证据不能建立 done。strict 绑定要求先提交再取证：`dirty: true` 的证据会让 gate 失败（legacy 只 warning）。`true`、`:`、`exit 0`、`echo`/`sleep` 这类 no-op，以及 `|| true` 掩盖失败的命令，不能建立 done。内核会重算 `output_sha256` 和 `output_bytes`，并校验证据归属；日志被改动、路径越界或记录属于别的任务都会失败。失败命令是证据，但不是通过。

任务创建时如果 `write_scope` 超过 8 项或 acceptance 超过 6 项，CLI 会提示拆分（`warnings` 字段）；这是粒度提示，不是硬限制。

任务第一次进入 `in_progress` 时记录 `baseline_commit`，之后 review/blocked 再回到 in_progress 不会重置 baseline；同时按 owner 写入 `state.active_tasks`；同一 owner 已有另一个 in-progress 任务时拒绝，活跃任务改 owner 也会检查目标 owner 是否被占用，除非显式 `--force`。进入 `review`/`done` 时，内核用 git 比较 baseline 以来的 tracked/untracked 变更；`write_scope` 之外的文件会导致失败（`.riccon/`、`.codegraph/`、`node_modules/` 除外）。done 任务必须有可解析、且是 HEAD 祖先的 `end_commit`；无 git 却记录 commit、done 缺 `end_commit`、无效/倒退 commit 都 fail-closed。并行任务可用 `task update --baseline-commit SHA --end-commit SHA` 显式设置范围：commit 必须存在且是 HEAD 祖先，baseline 必须是 end 的祖先；`--end-commit` 只允许 review/done。module gate 在 `--require-scope` 下还会检查“每个 done 任务 end_commit 之后提交的文件是否落在全项目任一任务的 write_scope 内”，因此 end_commit 之后的已提交越界改动也会失败。没有 baseline 的旧任务在普通 gate 产生 `task-scope-unverified` warning，在 `--require-scope` 下失败。

任务评审分级：

- **低风险**：普通 UI、文档、简单 CRUD、格式化。Lead 检查 diff、测试和证据后可 done；模块 Verifier 仍在模块 review 覆盖。
- **高风险**：认证、权限、数据迁移、并发/事务、安全边界、AI 工具调用、生产配置。任务 done 前必须有独立 Verifier 评审结论；不能只靠 Builder 自检或 Lead 代看。
- Builder 只把任务移到 `review`，不自己 `done`；Lead 负责确认评审和证据后再推进。

测试节奏：

- **任务级**：跑受影响测试；高风险、跨模块契约、迁移和模块最后任务在最终提交上跑一次全量。低/中风险任务把全量留给模块收尾。
- **模块级**：gate 前在最终提交上跑一次全量合同 test/coverage/E2E；全量命令的覆盖绑定在模块 review 的 `dod_evidence`，不在每个任务重复。
- **一次取证**：先提交，再在主工作树用 `riccon evidence run` 记录最终命令；不要先跑一遍再取证，也不要为取证新建临时工作树。
- 长测试设置超时并保留日志；超时是失败，不是通过。

并行任务规则：

- 同一 owner 同时只能有一个 `in_progress` 任务，除非显式 `--force`；`--force` 只解决占位，不改变审阅责任。
- 同一模块允许多个不同 owner 的并行任务，但每个任务必须声明不重叠的 `write_scope`；重叠时由 Lead 在启动前拆范围，内核不会自动合并两个任务的归属。
- 项目级 scope 校验使用**全项目所有任务 write_scope 的并集**做路径归属。并集只能回答“这个文件路径被某个任务声明过”，不能证明“这次改动由该任务作者完成”。
- 并行任务结束后，Verifier 必须人工审阅 `git diff baseline..end` 的实际内容；不能仅凭 gate 的 union 结果判定 authorship。发现 scope 外或跨任务改动时，先拆任务或调整 baseline/end，再重新 gate。
- 显式 `--end-commit` 之后的新提交不再属于该任务；未认领变更由 `--require-scope` gate 检查。

### 证据

`evidence/TASK-0001/EV-0001.json` 加日志文件。字段：`command`、`manual`、`commit`、`dirty`、`exit_code`、`output_path`、`output_sha256`、`output_bytes`、`agent`、`cwd`、时间戳、`duration_ms`、`note`。

证据由 `riccon evidence run` 或 `riccon evidence add` 产生。`evidence run` 记录 `manual: false`、当前 git `commit` 和 `dirty`；`evidence add` 只复制已有日志，记录 `manual: true`，不能单独满足 done 或 release。内核不编造证据；gate/release 会重算日志哈希和字节数。gate 会拒绝不在 HEAD 祖先链上的 commit；release/sandbox 会拒绝 dirty 工作树的证据；release evidence 必须被对应 task 引用；`evidence run` 的日志 `# command:`、`# exit_code:` 头必须存在且与 EV JSON 一致，否则校验失败。普通 gate 对旧记录缺 `commit` 只产生 warning；`gate --require-scope` 和严格 `release check` 要求执行证据带 `commit` 和布尔 `dirty`，缺失 fail-closed。`--legacy-scope` 只对 sandbox 归档记录降级为 warning。

### 决策

`decisions/DEC-0001.md` front matter：`decision_id`、`title`、`status`（`open|answered|applied|expired`）、`owner`、`module_id`、`blocking`、`question`、`options`、`recommendation`、`consequences`、`deadline`、`default`、`answer`、`answer_kind`（`approve|reject|choose|defer`）、`release_id`、`environment`、时间戳。

决策用 `riccon decision new|answer|list|show` 维护。`answer` 只在 `open` 时写入一次；已回答的决策不可覆盖。批准类决策必须用 `--kind approve --release REL-0001` 绑定到 draft release，环境由 release 推导。

阻塞中的 open decision 会让 gate 失败。

### 评审

`reviews/M01-review.md` front matter：`review_id`、`module_id`、`verifier`、`reviewer`（`agent`、`session`、`model`、`independent`）、`verdict`（`pass|fail|blocked`）、`dod` 布尔值、`dod_evidence`（DoD key → EV ID 或数组）、`findings`（`P0`–`P3`，状态 `open|fixed|accepted`）、`evidence`、`reviewed_evidence`、`created_at`。

模块评审固定写在 `.riccon/reviews/<module>-review.md`，由 `review.schema.json` 校验，只有它能参与模块 gate。任务级/架构级独立评审写在 `.riccon/reviews/tasks/<task>-review.md`，由 `task-review.schema.json` 校验；它不进入模块 gate，由 Lead 在任务 closeout 时核对，并在模块评审中引用。`state validate` 会校验两类评审；顶层出现 `task_id` 的评审会提示迁移到 `reviews/tasks/`。

Gate 要求 `verdict: pass`、所有必需 DoD key 为 true，并且没有 open/accepted 的 P0/P1。Review 还必须绑定当前 module，`reviewed_evidence` 覆盖每个任务的最新证据，`created_at` 晚于被评审证据，且 `reviewer.independent: true`。

`quality.evidence_binding: strict` 时，每个为 true 的 `acceptance/build/tests/e2e/coverage/docs` 必须有 `dod_evidence` 绑定；绑定的 EV 必须属于本模块、`manual: false`、`exit_code: 0`、哈希校验通过且列入 `reviewed_evidence`。`build/tests/e2e/coverage` 的 EV 命令还必须覆盖合同对应命令。空命令、`not-implemented`、`true`/`echo`/`sleep`/`|| true` 等占位或 no-op 会让 gate 失败；未加引号的管道默认失败（没有 pipefail 时退出码来自最后一个命令）；`||` 只允许 `exit 非零`，`;`/换行后接 `echo`、`true`、`cat`、`tee`、`sleep`、`exit 0` 失败；后台 `&` 失败。`&&`、`|| exit 1`、`for ... || exit 1` 和带引号的 `bash -o pipefail -c '...'` 保留。`review` 和 `evidence` 两项由结构检查本身覆盖，不需要绑定。`quality.evidence_binding: legacy`（旧合同默认）缺少 `dod_evidence` 只产生 warning；一旦提供仍按严格规则校验。`reviewer.agent` 可以是 `riccon/verifier` 或会话级的 verifier 身份；它不能是同一模块中实现类任务的 owner（`riccon/verifier` 自己的验证类任务不触发冲突）。Release review 还要绑定 `release_id`/`version`/`environment`，并覆盖 release 的全部 evidence。

`reviewer.agent/session/model` 是记录字段，不是身份凭证；本地内核不能证明 reviewer 与 Builder/Lead 是不同主体。复审仍把“独立 reviewer”列为未完全解决的风险。

### 发布

`releases/REL-0001.md` front matter：`id`、`version`、`environment`（`sandbox|staging|production`）、`scope`、`status`（`draft|approved|released|rolled_back|blocked`）、`risk_tier`、`artifacts`（威胁模型、负载测试、回滚演练、runbook）、`approval`（`by: user`、`decision_id`、`release_id`、`environment`、`answer_kind: approve`、`answer_sha256`、`approved_at`）、`evidence`、时间戳。

发布记录不替代用户批准：`riccon release approve` 只接受绑定到同一 release、同一 environment、`answer_kind: approve` 且所有者是 user 的已回答决策；决策回答先于 release 创建、哈希不匹配、或 release 不是 `draft` 都会失败。批准后不能重复 approve 覆盖历史。`approval.release_sha256` 绑定批准时的 version/scope/artifacts 文件字节、每条 EV JSON/日志字节与命令/退出码摘要、绑定该 release 的评审文件字节，以及 `second_review.review_path` 指向的第二评审文件字节；批准后修改任一项都会让 `release check` 失败。T4 staging/production 缺少该字段直接失败；sandbox 旧记录只产生 warning。

`release check` 默认重跑每个模块的 gate 和 `write_scope`，不相信旧的 module done；`--legacy-scope` 仅允许 sandbox 归档记录跳过这一步并产生 warning，staging/production 不允许。严格模式还要求 release evidence 带 `commit`/`dirty`。T4 还会调用 `sandbox check`。T4 的 `sandbox.evidence` 必须是 `commands.sandbox` 产生的 passing EV，`sandbox.network` 只能是 `none` 或 `allowlist`。T4 staging/production 批准还需要 `approval.second_review`：它必须绑定一个真实 review 文件（`review_path`、`review_id`、`review_sha256`、`model`），该文件要声明 `review_kind: second`、绑定同一 release/version/environment、覆盖 release evidence，且 reviewer 不是 builder/lead；它不能复用主 RELEASE 评审，且必须与主 review 使用不同 model/agent/session；review 内容变化会让 `release check` 失败。第二评审中的 open/accepted P0/P1 也会阻断 release。sandbox 批准只产生 warning。生产发布必须明确 yes，沉默不算批准。

权限 ask 让 `decision answer`/`release approve`/`contract sync` 需要用户确认，但本地 CLI 不能证明执行者身份；`release check` 的 PASS 不是生产放行，生产第二模型评审的 provenance 仍未解决。

### Handoff

`handoffs/handoff-0001.md` front matter：`handoff_id`、`session`、`summary`、`next`、`invariants`、`risks`、`first_read`、`quality_gate`、`created_at`。

`riccon handoff new` 会先检查：没有 `in_progress`/`review` 任务；done 任务都有证据；phase 为 modules/release/operate 时 module gate 为 pass，且 gate 的 module 必须是当前/最后一个 done 模块；gate 的 `checked_at` 不能早于最新任务或评审；release gate 不是 fail，operate 阶段必须 pass；`next` 非空且不是占位词；`first_read` 非空且路径存在。任一项失败就拒绝写 handoff。`first_read` 传空数组会回退默认列表，不会绕过检查。

触发时机：每个模块 gate 完成后、phase 切换、发出决策/评审包后、会话暂停超过 24h、切换项目/风险等级/模型、进入 T4/生产批准前。输入接近 120K tokens、300/440 steps、60 次工具调用或自动 compaction 一次只是**检查点**，不是强制 handoff：先判断是否会降低质量或导致返工，不会才切。handoff 前必须满足：状态/证据/review/gate 已更新、代码文档可恢复、没有半写文件/未完成 subagent/未应用决策、`next` 可直接执行、新会话无需重读旧聊天。任何一项不满足就继续或标 blocked；不得为了省成本跳过测试、E2E、独立 review 或证据。handoff 不替代 gate、review 或用户批准。handoff 后新开 session 运行 `/riccon-resume`。

## 门禁

`riccon gate check --module M01` 检查：

- 合同有效；
- 模块存在，且不是 planned/blocked；
- 所有任务 done，最后一条执行证据通过，没有 blocker；
- 每个证据的输出存在、哈希/字节匹配、属于该任务；manual 证据只产生 warning；
- review 存在、有效、verdict 为 pass，绑定当前 module，覆盖最新证据且晚于证据，reviewer 独立；
- 合同的 DoD（或默认值）全部为 true，且 strict 绑定时每项都有真实 passed EV；
- DoD 对应的合同命令非空、非占位；strict 下空/占位命令直接失败；
- 没有 open/accepted P0/P1；
- 没有被阻塞的开放决策；
- 墙钟在模块上限内（或 `--allow-overrun`）；`--require-scope` 可把无 baseline 的 scope 检查从 warning 升级为 fail。

Gate 结果写入 `state.gate`。`riccon module update M01 --status done` 会运行 gate，失败时拒绝标记 done。

## 发布门禁

`riccon release check` 检查：

- 合同有效，phase 为 `release` 或 `operate`；
- 所有模块 `done`；
- 发布记录存在且状态为 `approved`/`released`；
- 批准决策存在、已 `answered`、owner 为 `user`、`answer_kind: approve`，并绑定同一 `release_id` 和 `environment`；`answer_sha256` 匹配，时间线不倒置；有新审批时 `release_sha256` 必须匹配当前 version/scope/artifacts 原始字节、EV JSON/日志、绑定该 release 的 RELEASE 评审与第二评审文件；
- 发布 evidence 全部存在、属于已知任务、哈希匹配、非 manual、exit 0；
- 发布产物存在：T4 要求威胁模型、负载测试、回滚演练和 runbook；T1–T3 至少要求回滚演练和 runbook；
- `RELEASE` 评审存在、verdict `pass`，按 `release_id` 选择，绑定同一 `release_id`/`version`/`environment`，覆盖 release 全部 evidence，reviewer 独立且 review 晚于证据；主/第二评审的 open/accepted P0/P1 都阻断；合同 `definition_of_done.release` 全部 true；
- T4 调用 `sandbox check`，并要求 release evidence 包含 `sandbox.evidence` 指向的 passing EV；
- 没有 open/accepted P0/P1，没有被阻塞的开放决策。

结果写入 `state.release_gate`。`riccon sandbox check` 独立检查沙箱声明、`commands.sandbox`、`docs/SANDBOX.md`、limits 和沙箱证据；还会静态检查 `commands.sandbox` 指向的脚本是否声明 `docker/podman run`、`--network none`、`--read-only`、`--cap-drop ALL`、`--user`。T4 的 `sandbox.evidence` 必须是 `commands.sandbox` 的 passing EV，network 只能是 `none`/`allowlist`。这不是 runtime attestation；真实隔离仍需可信 runner 或用户风险接受。

## 预算

`budget_usage` 记录模块级请求数、输入/输出 token、墙钟分钟、估算成本和来源。用 `riccon module cost M01 --requests N --input-tokens N --output-tokens N --wall-clock-minutes N --cost-usd N --confidence estimated|measured|unmeasured --source TEXT` 写入；全零且 `confidence` 不是 `unmeasured` 会被拒绝，`estimated`/`measured` 缺少 `source` 也会被拒绝，避免把未测量当成零成本。token 上限默认 `none`；墙钟限制由 gate 执行。成本可见，但不硬停。

## CLI

```bash
riccon init
riccon adopt --write
riccon contract validate
riccon contract sync
riccon state validate
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
