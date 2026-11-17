# 模型映射

模型映射属于部署配置，不写进 agent prompt；项目合同也不绑定模型。本文记录当前公开快照的默认值，方便替换成你自己的模型。

## 默认映射

写入 `.opencode/agents/riccon/*.md` 的 frontmatter；`#variant` 是思考强度。

| 角色      | 默认模型                            | 思考强度 | 说明                     |
| --------- | ----------------------------------- | -------- | ------------------------ |
| Lead      | `opencode-go/deepseek-v4.1-flash`   | `max`    | 长会话、拆模块、汇总评审 |
| Product   | `opencode-go/deepseek-v4.1-flash`   | `high`   | 结构化写作、验收标准     |
| Architect | `opencode-go/deepseek-v4.1-flash`   | `max`    | 架构、契约、ADR          |
| Builder   | `opencode-go/deepseek-v4.1-flash`   | `max`    | 代码任务 token 量最大    |
| Verifier  | `opencode-go/deepseek-v4.1-flash`   | `max`    | 独立验证、代码审查       |
| Ops       | `opencode-go/deepseek-v4.1-flash`   | `high`   | CI/CD、容器、脚本        |
| 扫描/摘要 | `opencode/deepseek-v4.1-flash-free` | `high`   | 低风险分类和摘要         |

## 替换原则

- 模型能力必须覆盖角色职责：Verifier 不能比 Builder 明显弱，否则独立评审会形式化。
- 重要安全评审、T4 发布和生产批准，建议用不同模型或人工复核一次。
- 降级必须写进 handoff；不要静默换弱模型后仍声称同等级验证。
- 模型价格、上下文和额度会变化；以你的 OpenCode/模型供应商配置为准。

## 应用方式

agent 文件已经写入默认值，例如：

```yaml
model: opencode-go/deepseek-v4.1-flash#max
```

覆盖方式：

- 全局/项目 `opencode.json(c)` 的 `agents.<id>.model`；
- 或直接改 agent Markdown 的 `model`。

OpenCode 会话会保存自己选中的模型；切换 primary agent 不会自动改变已有会话的模型。新会话才使用 agent 默认值。

`templates/agents/models.yml` 是同一映射的部署侧模板。
