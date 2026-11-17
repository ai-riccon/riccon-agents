# 变更日志

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
