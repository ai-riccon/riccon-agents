---
description: 把已批准的 MVC 和模块路线图拆成模块与任务，写明写入范围、验收标准和负责人。
---

# /riccon-plan

加载 `riccon-core` 和 `riccon-contract`。

1. 读 Project Contract、`docs/COLLABORATION.md`（如存在）、`.riccon/state.json` 和最新 handoff。
2. MVC 未定义时停下来，请用户确认。
3. 创建或更新模块计划：
   - 纵向切片，每个模块有用户可见结果；
   - 依赖和解锁顺序；
   - 验收标准；
   - 风险等级和墙钟上限。
4. 为每个模块创建任务，写明：
   - 唯一 owner；
   - 不重叠的写入范围；
   - 验收标准；
   - 必需工具和证据；
   - 文档影响。
5. 使用内核：
   `riccon module new ...`、`riccon task new ...`。
6. 更新状态并写 handoff。计划通过校验、MVC 范围确认前，不要开始构建。
7. 计划保持小：MVC 加接下来 1–2 个模块，不做投机性 backlog。
