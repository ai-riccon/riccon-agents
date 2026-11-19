# Riccon Agents — 团队仓库说明

本文件是给维护 **riccon-agents** 仓库本身的 agent 看的，同时是团队内容的索引。目标项目的合同写在各自项目的 `AGENTS.md` 里；本文件不是目标项目模板。

## 内容索引

| 主题         | 唯一主源                                                                  | 说明                                                    |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| 设计与流程   | `docs/DESIGN.md`                                                          | 目标、角色、流程、自治刹车、质量                        |
| 项目合同     | `docs/CONTRACT.md`                                                        | 合同字段、校验、修改流程                                |
| 状态与验收   | `docs/STATE.md`                                                           | `.riccon/` 状态、模块/任务生命周期、gate、验收          |
| 权限         | `docs/PERMISSIONS.md` + `templates/agents/permissions.yml`                | YAML 是权限唯一事实源                                   |
| 模型与步数   | `templates/agents/models.yml`                                             | 同步到 agent frontmatter，doctor 校验                   |
| 沙箱         | `docs/SANDBOX.md`                                                         | 隔离边界和证据                                          |
| 评测         | `docs/EVALS.md`                                                           | 证据层级和评测方法                                      |
| 目标项目模板 | `templates/project/AGENTS.md` + `templates/project/docs/COLLABORATION.md` | AGENTS 保留合同、索引和硬规则；详细协作在 COLLABORATION |
| 版本         | `package.json` + `scripts/lib/version.mjs`                                | README、AGENTS、CHANGELOG 由 doctor 校验                |
| 内核命令     | `scripts/lib/cli.mjs` + `docs/STATE.md`                                   | 行为以代码和测试为准                                    |

## 命令

```bash
npm install
npm test
node scripts/riccon.mjs doctor
node scripts/install.mjs --dry-run
npm run check
npm run sync:agents
```

## 规则

- 团队定义必须与目标技术栈无关。不要把目标栈、框架、数据库或目录假设写进 `.opencode/**` 或 `templates/project/AGENTS.md`。`riccon doctor` 会检查一组禁用词。
- `templates/agents/permissions.yml` 是 agent 权限的唯一事实源；`templates/agents/models.yml` 是模型和步数的唯一事实源。改完运行 `npm run sync:agents`；`riccon doctor` 会在 agent 定义漂移时报错。
- 除 `subagent` 和 `question` 的角色边界外，不设 deny。其他能力一律 allow 或 ask。
- ask 规则必须排在宽泛 allow 之后；OpenCode 使用最后匹配。`riccon doctor` 会检查顺序。
- schema 是数据契约。改 schema 时同步改 fixtures 和测试；运行时枚举必须从 schema 派生或由测试比对。
- 测试使用 `node:test`；不要引入测试框架。
- 不要把密钥写进仓库、日志、任务卡、提示词或证据。
- 文档保持小且当前；更新 canonical 文件，不要新增平行文档。目标项目的 `AGENTS.md` 只维护合同、内容索引和硬规则，详细内容放 canonical 文档。
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

- 当前版本：`0.1.8`。
- 版本号同步修改：`package.json`、`package-lock.json`、`scripts/lib/version.mjs`、`README.md`、`AGENTS.md`、`CHANGELOG.md`；`riccon doctor` 会检查一致性。
- 打 annotated tag：`vX.Y.Z`；tag 必须指向通过验证的 release commit。
- 公开仓库只保留团队内核、模板、测试和公开文档；历史试点/审计材料不进入仓库。
