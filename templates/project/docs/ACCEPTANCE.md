# 产品验收

本文件记录两层验收：

1. **Product 预验收**：实现是否按 `docs/PRODUCT.md`、UX 设计和范围落地；
2. **用户最终验收**：用户是否接受这个用户可见结果。

它不是 Verifier 的模块 review，也不是发布批准。Verifier 负责独立验证 AC、安全和行为；Product 不能替代 Verifier，用户保留最终接受权。

## 范围

- 模块：
- 版本/commit：
- 验收日期：
- 验收人：Product、用户

## 验收标准

| AC    | 结果    | 证据      | 备注 |
| ----- | ------- | --------- | ---- |
| AC-01 | pending | EV / demo |      |
| AC-02 | pending | EV / demo |      |

结果值：`pass`、`fail`、`waived`（必须有用户书面理由）。

## Product 预验收

- 结论：`pending | pass | changes-requested | blocked`
- 需求一致性：目标用户、MVC、non-goals 是否被遵守
- UX/文案：关键流程、空态、错误态、加载态、权限不足、移动端是否按设计
- 发现项：任务 ID / finding / 需要补的 AC
- 备注：

Product 预验收不检查实现细节、安全边界或测试充分性；这些由 Verifier 负责。发现缺口时先退回任务，不把问题留给用户验收。

## 用户最终验收

- 结论：`pending | accepted | rejected | conditional`
- 决策 ID：
- 条件/剩余项：
- 下一步：

## 规则

- Product 预验收未 `pass` 前，不提交用户最终验收。
- 模块 gate 未通过前，不提交用户最终验收。
- 用户未 `accepted` 前，不进入下一个用户可见模块；最终产品验收未 `accepted` 前，不进入生产发布。
- `conditional` 必须列出条件和截止时间，并建立后续任务。
- 验收结论不替代 gate、release check 或生产批准。
