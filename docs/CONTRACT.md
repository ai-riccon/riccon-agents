# 项目合同

项目合同是项目 `AGENTS.md` 中的一个受管 YAML 区块：

```text
<!-- riccon:contract:start -->
contract_version: 1
project:
  name: demo
  type: web-app
  risk_tier: T3
  status: greenfield
# ... 其余合同字段
<!-- riccon:contract:end -->
```

它是团队关于技术栈、命令、工具、环境、约束和 DoD 的唯一事实源。

## 字段

| 字段 | 用途 |
|---|---|
| `contract_version` | Schema 版本；当前为 `1`。 |
| `project` | 名称、类型、风险等级、绿地/现有。 |
| `product` | 目标、用户、MVC、non-goals、成功指标、模块路线图。 |
| `stack` | 语言、框架、运行时、数据库、包管理器、版本；多栈仓库用 `stack.subprojects` 显式列出子项目、命令和状态。 |
| `repo_map` | 源码、测试、文档、基础设施和契约根。 |
| `commands` | 安装、构建、lint、类型检查、测试、E2E、代码覆盖率、运行、预览部署、生产部署、沙箱。 |
| `sandbox` | 是否必需、运行时、网络、挂载、密钥、限制和沙箱证据；T4 的 `evidence` 必须是 `commands.sandbox` 产生的 passing EV。 |
| `tools` | 必需/可选工具、MCP 工具、降级策略。 |
| `environments` | 本地、预览、沙箱、生产。 |
| `integrations` | 认证、支付、邮件、存储、外部 API。 |
| `data` | PII、保留期、迁移。 |
| `constraints` | 风格、安全、性能、可访问性、代码覆盖率门槛、许可、合规。 |
| `coding_standard` | 编码规范路径、owner、注释语言；Architect 在 Builder 开始前创建。 |
| `quality` | DoD 证据绑定模式：`strict`（默认，新项目）或 `legacy`（存量迁移）。 |
| `definition_of_done` | 模块和发布检查清单；新模板包含 `coverage`。 |
| `decision_owners` | 产品、UX、架构、生产、花钱、破坏性操作由用户还是团队决定。 |
| `budget` | token 策略、墙钟策略、成本可见性。 |

`commands.coverage` 是代码覆盖率的唯一入口；`constraints.coverage.line/branch` 是门槛（0–100）。覆盖率默认指代码行/分支覆盖率，不是 AC 覆盖；AC 覆盖单独报告。新项目默认 line ≥80%、branch ≥70%，已有项目采用 baseline ratchet，不能低于基线。`coding_standard.path` 默认 `docs/CODING-STANDARDS.md`，由 Architect 按技术栈和行业最佳实践填写；Builder 必须遵循，Verifier 检查。

`stack.subprojects` 用于多栈/单仓多项目：每项至少包含 `path`、`languages`、`package_manager`，可带 `frameworks`、`kind` 和子项目 `commands`。`riccon adopt` 会扫描根目录常见的 `client/`、`frontend/`、`web/`、`backend/` 等一层子目录并填充；顶层 `commands` 只代表主栈，子项目命令必须显式引用，不能假设同一套命令。

新项目 `riccon init` 默认写入 `constraints.coverage: {line: 80, branch: 70}` 和包含 `coverage` 的模块 DoD；`commands.coverage` 仍为空，项目必须填入真实命令后才能通过 strict gate。这是“未配置就不放行”，不是零门槛。

`quality.evidence_binding`：

- `strict`：新项目默认。review 必须用 `dod_evidence.<key>` 把 `acceptance/build/tests/e2e/coverage/docs` 指向真实、`manual: false`、`exit_code: 0`、哈希校验通过、已列入 `reviewed_evidence` 的 EV；`build/tests/e2e/coverage` 还要求 EV 命令覆盖对应 `commands.build/test/test_e2e/coverage`。DoD 声称的项没有绑定、命令为空/`not-implemented`/`true`/`echo`/`sleep`/`|| true` 等占位或 no-op，gate 直接失败；未加引号的管道默认失败；`||` 只允许 `exit 非零`，`; true`、`exit 0`、后台 `&` 等掩盖写法也失败。
- `legacy`：存量项目迁移窗口。缺少 `dod_evidence` 只产生 warning；一旦提供，仍按上述规则校验。旧合同没有 `quality` 时按 legacy 处理。
- 新项目用 `riccon init --evidence-binding strict`；`riccon init` 默认 strict，测试/迁移可显式传 `legacy`。`riccon adopt` 生成 `legacy`，存量项目补上真实命令和 `dod_evidence` 后再切 strict。

JSON Schema 见 [`schemas/contract.schema.json`](../schemas/contract.schema.json)。

## 校验

```bash
riccon contract validate --project .
riccon contract validate --project . --strict
```

检查：

- schema：必填字段、枚举、类型；
- 重复的工具/模块 ID；
- 风险等级对应的命令是否缺失；T4 缺 `sandbox.required`、`sandbox.runtime`、`commands.sandbox` 时给 warning；
- 产品目标/MVC/技术栈是否为空；
- repo-map 路径是否还不存在；
- DoD 默认值。

Warnings 是建议；`--strict` 把它们升级为 errors。

发布时，`riccon release check` 还会检查 `definition_of_done.release`。T4 发布记录必须引用威胁模型、负载测试、回滚演练和 runbook；T1–T3 至少要求回滚演练和 runbook。

## 起草

绿地项目：Lead 问用户产品目标/用户/MVC/non-goals；Architect 提技术栈和命令；用户批准不可逆部分。

现有项目：`riccon adopt` 只读检查并给出带证据的草案；`--write` 只写 `.riccon/`、`AGENTS.md` 和 `docs/ADOPTION.md`，不改源码。不要编造未检测到或未确认的版本、命令或依赖。

## 冲突规则

- 合同优先于假设；仓库优先于过期合同。两者不一致时停下来问。
- 失败的命令是合同或仓库 bug；记录证据，先解决。
- 声明为 required 的工具缺失时是 blocker 或已批准降级；绝不静默跳过。
- 缺失路径在需要它的模块开始前是 warning，之后是 blocker。
- 风险等级不确定时向上取，不向下取。

## 修改合同

技术栈、命令、工具和 DoD 是关键决策：

1. 写决策包。
2. 等用户答复（只有 T1–T3 可逆且写明默认值时才可沉默执行）。
3. 准备 diff。
4. 写入；编辑 `AGENTS.md` 需要审批。
5. 运行 `riccon contract validate`。
6. 记录 ADR 或决策。
7. 运行 `riccon contract sync`，更新 `.riccon/project.json` 中的合同哈希。

## 工具

```yaml
tools:
  required:
    - id: example
      purpose: 这个项目为什么需要它
      fallback: 不可用时怎么办
  optional: []
  mcp: []
  fallback: 记录降级，改范围前先问用户
```

团队启动时检查可用性。Required 缺失 → blocker 或已批准降级。Optional 缺失 → 记录后继续。MCP server 在 OpenCode 配置中启用，不在合同里启用。

## 质量标准

- 命令从项目根目录可直接复制运行。
- 路径真实存在，或明确标注为计划中。
- DoD 的 key 与 verifier 实际检查的一致。
- 决策所有者明确。
- 预算策略说明软/硬上限时发生什么。
- 没有密钥、token 或私有 URL。
