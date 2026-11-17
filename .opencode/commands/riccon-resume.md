---
description: 从状态和最新 handoff 恢复 Riccon 项目，不重读全部聊天历史。
---

# /riccon-resume

加载 `riccon-core`。

1. 运行 `riccon status --project .`。
2. 读 `.riccon/state.json`、最新 `.riccon/handoffs/handoff-*.md`、当前模块和开放决策。
3. 只读 `AGENTS.md` 的 Project Contract 和相关的 architecture/ADR。
4. 汇总：
   - 已完成什么，证据在哪；
   - 正在进行什么，谁负责；
   - 什么被阻塞，为什么；
   - 确切的下一步。
5. 检查 `git status` 和 `git diff --stat`。不要假设工作区与 handoff 一致。
6. 从下一步继续。不要重新做发现，也不要重新争论已记录的决策。
7. handoff 与工作区不一致时，先停下来报告差异，再改文件。
