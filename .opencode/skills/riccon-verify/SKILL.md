---
name: Riccon 验证
description: "Riccon 模块的独立验证：按轨道划分 DoD、证据、假绿识别、E2E、可访问性、安全、性能、迁移和评审报告。"
---

# Riccon 验证

验证必须独立。builder 不给自己打分，Lead 不因为 gate 失败就降低标准。

## 1. 什么算证据

证据是记录下来的产物，不是声明：

- 命令、工作目录、退出码、开始/结束时间和耗时；
- 捕获的输出（日志）及其哈希/路径；
- UI/E2E 的截图、trace、报告或预览 URL；
- 任务 ID 和产生它的 agent。

用内核记录证据：

```bash
riccon evidence run --task TASK-0001 --agent riccon/builder -- "npm test"
riccon evidence add --task TASK-0001 --command "npm test" --output test.log --exit-code 0
```

没有证据就没有 done。跳过的命令不是通过。

## 2. 按轨道的 DoD

T1/T2：

- 变更面的 build/lint/typecheck；
- 相关单元/集成测试；
- 独立 review；
- 证据。

T3/MVC：

- 模块验收标准全部通过；
- build/lint/typecheck；
- 单元/集成/契约测试；
- 有 UI 时在真实浏览器跑关键 E2E；
- 可访问性基线：变更页无 critical/serious，键盘路径可用；
- 安全基线：密钥扫描、依赖 high/critical、新端点的 authz/输入校验；
- 性能预算：变更页面/API 的 p95、无明显 N+1、适用时 bundle 预算；
- 迁移在副本上验证 forward 和 rollback；
- 文档/运行手册更新，或写 no-impact 理由；
- 独立 verifier verdict 为 `pass`，无开放 P0/P1；
- gate check 通过。

T4 额外要求：威胁建模、负载/性能测试、容灾/回滚演练、明确发布批准。发布评审写 `.riccon/reviews/RELEASE-review.md`，DoD 使用合同的 `definition_of_done.release`；发布记录和批准由 Lead 维护，Verifier 不代替用户批准。发布前同时运行 `riccon sandbox check` 和 `riccon release check`。

## 3. 假绿

出现以下情况时拒绝“绿色”结果：

- 命令执行了零个测试；
- 测试被跳过且没有 owner/到期时间；
- retry 掩盖了 flake；
- 测试没有断言，或只对坏状态做快照；
- 命令吞掉错误或永远 exit 0；
- 证据缺失、被截断，或来自另一个工作区；
- gate 只校验计划，不校验证据；
- review 由变更作者自己写。

## 4. UI 与 E2E

- 端到端走关键旅程，不只测组件。
- 检查 loading、empty、error 和 success 状态。
- 检查浏览器 console 和网络失败。
- 对变更页面跑可访问性检查。
- 截屏或 trace 放进评审包。
- 视觉回归是信号，不是验收的替代品。

## 5. 安全基线

- 仓库、日志、证据、提示词、任务卡里没有密钥。
- 依赖扫描：没有未解决的 high/critical。
- 新端点：authn、authz、输入校验、限流/滥用考虑。
- 新数据：PII 分类、保留期、日志脱敏。
- 迁移：最小权限、备份/恢复、回滚。
- T4：威胁模型和针对性的滥用案例审查。

## 6. 性能

- 先定义预算再测量。
- 测变更面，不测整个产品。
- 记录环境和命令。
- 没有预算时按 warning 处理，不要因此跳过。

## 7. 评审报告

写 `.riccon/reviews/<module>-review.md`，带 YAML front matter：

```yaml
review_id: REV-M01-001
module_id: M01
verifier: riccon/verifier
verdict: pass | fail | blocked
dod:
  acceptance: true
  build: true
  tests: true
  coverage: true
  e2e: true
  review: true
  docs: true
  evidence: true
dod_evidence:
  acceptance: [EV-0001]
  build: [EV-0002]
  tests: [EV-0002]
  coverage: [EV-0002]
  e2e: [EV-0003]
  docs: [EV-0004]
findings:
  - id: F-001
    severity: P0 | P1 | P2 | P3
    title: ...
    status: open | fixed | accepted
created_at: ...
```

`quality.evidence_binding: strict` 时，`dod_evidence` 是必填项：每个 true 的 acceptance/build/tests/e2e/coverage/docs 必须指向真实、非 manual、exit 0、已列入 `reviewed_evidence` 的 EV；build/tests/e2e/coverage 的命令还要覆盖合同命令。不要用自报、空命令或 `not-implemented` 占位通过；未加引号管道默认被拒绝，`||` 只允许 `exit 非零`，`; true`/`exit 0`/后台 `&` 等掩盖失败的命令也会被 gate 拒绝。

然后运行 `riccon gate check --module M01`。

给用户的一页评审包链接到这份报告；它不替代报告。

## 8. 独立性

- 用新上下文，不继承 builder 的推理。
- 读验收标准和 diff，不只看总结。
- builder 的解释和产物不一致时，相信产物。
- 无法验证时写 `not verified` 和原因，不要猜。
