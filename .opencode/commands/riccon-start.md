---
description: 启动或恢复一个 Riccon 项目。初始化 .riccon/，确认 Project Contract，并确定 MVC 与模块路线图。
---

# /riccon-start

加载 `riccon-core` 和 `riccon-contract`。

1. 运行当前项目的内核 status：
   - macOS/Linux：`node "$HOME/.config/opencode/riccon/scripts/riccon.mjs" status --project .`
   - Windows：`node "%USERPROFILE%\.config\opencode\riccon\scripts\riccon.mjs" status --project .`
2. `.riccon/` 不存在时先运行 `riccon init`。已存在时不要重复初始化；读状态和最新 handoff。
3. 读 `AGENTS.md` 里的 Project Contract，运行 `riccon contract validate`。合同缺失或为空时：
   - 只读检查仓库。
   - 提出合同草案（stack、commands、tools、repo map），附证据。
   - 请用户确认产品目标、用户、MVC、non-goals 和成功指标。
   - 用户批准后才写合同。
4. 只问关键问题：产品目标/用户、MVC 范围、non-goals、约束，以及任何不可逆技术选择。合并成一个决策包。
5. 创建 MVC 模块和第一批任务计划。用户未批准的模块不要提前创建。
6. 更新 `.riccon/state.json`，然后写 handoff。

合同未通过校验、MVC 未得到用户确认前，不要开始实现。
