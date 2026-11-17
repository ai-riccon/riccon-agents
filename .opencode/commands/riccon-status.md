---
description: 显示当前 Riccon 阶段、模块、门禁、开放决策、证据和下一步。
---

# /riccon-status

加载 `riccon-core`。

1. 运行 `riccon status --project .`。
2. 运行 `riccon state validate --project .`，报告 errors，而不只是 warnings。
3. 汇总：
   - 项目、风险等级和 phase；
   - 当前模块及其 DoD 进度；
   - gate 状态和失败项；
   - 开放决策，尤其是 blocking 的；
   - 最新 handoff 和确切的下一步。
4. gate 失败时，列出失败项和负责人。不要提议降低门禁标准。
5. 除非用户要求细节，否则控制在一屏内。
