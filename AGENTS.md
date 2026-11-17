# Riccon Agents — 团队仓库说明

本文件是给维护 **riccon-agents** 仓库本身的 agent 看的。目标项目的合同写在各自项目的 `AGENTS.md` 里；本文件不是目标项目模板。

## 先读

1. `README.md`
2. `docs/DESIGN.md`
3. `docs/CONTRACT.md`
4. `docs/STATE.md`
5. `docs/PERMISSIONS.md`
6. `docs/SANDBOX.md`
7. `docs/EVALS.md`
8. `docs/MODELS.md`
9. `templates/project/AGENTS.md`

## 命令

```bash
npm install
npm test
node scripts/riccon.mjs doctor
node scripts/install.mjs --dry-run
npm run check
npm run sync:permissions
```

## 规则

- 团队定义必须与目标技术栈无关。不要把目标栈、框架、数据库或目录假设写进 `.opencode/**` 或 `templates/project/AGENTS.md`。`riccon doctor` 会检查一组禁用词。
- `templates/agents/permissions.yml` 是 agent 权限的唯一事实源。改完运行 `npm run sync:permissions`；`riccon doctor` 会在 agent 权限漂移时报错。
- 除 `subagent` 和 `question` 的角色边界外，不设 deny。其他能力一律 allow 或 ask。
- ask 规则必须排在宽泛 allow 之后；OpenCode 使用最后匹配。`riccon doctor` 会检查顺序。
- schema 是契约。改 schema 时同步改 fixtures 和测试。
- 测试使用 `node:test`；不要引入测试框架。
- 不要把密钥写进仓库、日志、任务卡、提示词或证据。
- 文档保持小且当前；更新 canonical 文件，不要新增平行文档。
- “覆盖率”默认指代码行/分支覆盖率，不是 AC 覆盖；AC 覆盖单独报告。新项目默认 line ≥80%、branch ≥70%，项目合同可覆盖；新增/修改代码不得降低基线。
- 新项目由 Architect 在 Builder 开始前创建 `docs/CODING-STANDARDS.md`，按技术栈和行业最佳实践定义编码规范；Builder 必须遵循，Verifier 检查。
- 团队可以提出修改自身定义的提案，但必须由人应用；目标项目里的 agent 不得编辑 `.opencode/**`。
- 正式发布前必须通过 `npm test`、`npm run check`、临时项目 init → module → task → evidence → gate → handoff，以及最终 HEAD 的 CI。

## 语言与风格

- 文档、注释、commit message、决策包、评审包和 handoff 默认中文。
- 代码注释必须中文；每个方法至少方法级注释；复杂业务流程必须有行级或段落注释；不写重复、无信息量的注释。
- 代码标识符、命令、API/字段名、错误码和日志键保持英文；现有历史代码的注释迁移单独成任务，不和行为变更混合。
- LICENSE、NOTICE 和第三方原文保持原语言。

## 发布

- 当前版本：`0.1.5`。
- 版本号同步修改：`package.json`、`package-lock.json`、`scripts/lib/version.mjs`、`CHANGELOG.md`。
- 打 annotated tag：`vX.Y.Z`；tag 必须指向通过验证的 release commit。
- 公开仓库只保留团队内核、模板、测试和公开文档；历史试点/审计材料不进入仓库。
