---
description: 运行模块验证，收集独立评审，检查门禁并生成一页评审包。
---

# /riccon-review

加载 `riccon-core` 和 `riccon-verify`。

1. 确认模块可以验证：所有任务 done 且有证据。
2. 给 `riccon/verifier` 一个自包含 brief：模块、验收标准、合同、diff、声明的命令和证据路径。
3. verifier 必须运行声明的命令和关键 E2E 旅程，并写 `.riccon/reviews/<module>-review.md`，包含 verdict、DoD 清单、`dod_evidence` 和 findings；strict 项目不得用自报代替真实 EV。任务级/架构级独立评审写到 `.riccon/reviews/tasks/<task>-review.md`，不参与模块 gate。
4. 运行 `riccon gate check --module <module> --project .`。
5. gate 失败时：
   - 把 P0/P1 findings 连同可复现案例退回 builder；
   - 不要改 review 来强行通过；
   - 不要把模块标记为 done。
6. gate 通过后、模块 done 前，让 Product 按 `docs/COLLABORATION.md` 和 `docs/ACCEPTANCE.md` 做预验收，并用 `riccon module update <module> --product-status ...` 记录；Product `pass` 后才能 `module update <module> --status done`。
7. 模块 done 后，再给用户一页评审包并收集最终验收：
   - demo/预览链接；
   - 验收标准表；
   - 变更和证据链接；
   - 验证结果（build、tests、E2E、a11y、security、performance）；
   - P0/P1/P2 findings 和剩余风险；
   - 下一模块计划和 veto 截止时间。
8. 用 `--user-status` 记录用户结论；用户未 `accepted` 前不启动下一个用户可见模块。更新状态，然后写 handoff。
