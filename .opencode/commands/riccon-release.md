---
description: 运行 T4 或生产发布门禁，需要用户明确批准并准备回滚方案。
---

# /riccon-release

加载 `riccon-core`、`riccon-verify` 和 `riccon-docs`。

1. 确认发布所需的模块全部 done，且各自 gate 通过。
2. 运行 `riccon state validate --project .` 和 `riccon contract validate --project .`。
3. 运行 `riccon sandbox check --project .`。T4 必须有沙箱声明、`commands.sandbox`、`docs/SANDBOX.md`、limits，以及 `commands.sandbox` 产生的 passing EV；`sandbox.evidence` 必须是该 EV，network 只能是 `none`/`allowlist`。
4. 确认 Project Contract 的 release DoD：
   - build、tests 和关键 E2E 全绿；
   - 安全基线和依赖扫描干净；
   - 威胁模型和针对性滥用案例审查（T4）；
   - 负载/性能测试在预算内（T4）；
   - 迁移 forward 和 rollback 在副本上验证；
   - 可观测性和告警就位；
   - runbook 和回滚方案已写；
   - 没有开放的 P0/P1。
5. 用 `riccon release new` 创建发布记录，填 `artifacts`；缺产物时不要进入批准。
6. 让独立 Verifier 写 `RELEASE` 评审；作者不写自己的发布评审。
7. 给用户发布决策包：版本、环境、范围、证据、风险、回滚、成本和确切的生产动作。生产发布必须明确 yes；沉默不算批准。
8. 用户明确批准后，运行 `riccon decision answer DEC-XXXX --answer "..." --kind approve --release REL-0001`，再运行 `riccon release approve REL-0001 --decision DEC-XXXX`。T4 staging/production 还要带 `--second-review-model` 和 `--second-review-path`，指向一个绑定同一 release/version/environment 的独立 review 文件；sandbox 只需 warning。
9. 运行 `riccon release check`。它会重算 evidence 哈希、校验批准绑定、调用 `sandbox check`；失败时修复，不要绕过。
10. 批准后部署，运行 smoke 检查并记录证据；smoke 失败时执行回滚并记录失败，不要盲目重试。
11. 更新状态、写 handoff，并生成发布报告。
