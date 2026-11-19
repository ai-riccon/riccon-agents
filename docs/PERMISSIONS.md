# 权限与安全

## 模型

项目工作默认允许；破坏性、对外可见、花钱、触及敏感数据或修改团队规则的动作前询问。除两个角色边界外没有 deny：非 Lead agent 不能 spawn subagent，也不能直接问用户。

这符合用户的偏好：不禁止能力；只对可能造成伤害的动作询问。

## 矩阵

| 动作 | 效果 |
|---|---|
| 项目内读/写/执行 | allow |
| MCP 工具、web fetch/search、skills | allow |
| Spawn subagent | 仅 Lead |
| 直接问用户 | 仅 Lead |
| 破坏性命令（删除、reset、drop、force push、prune） | ask |
| 对外副作用（生产部署、发布、发消息、公开仓库、DNS） | ask |
| 金钱、身份、法律（购买、付费 API、开户、证书） | ask |
| 敏感数据（`.env*`、密钥、生产凭据、PII） | ask |
| 编辑 `AGENTS.md`、`.opencode/**`、`.git/**` | ask |
| 写项目外目录 | ask |
| 读取已安装的 Riccon 内核 | allow |

## 破坏性 ask 基线

Agent 定义包含以下 ask：

- `rm`、`rmdir`、`chmod -R`、`chown -R`、`dd`、`mkfs`；
- `git reset --hard`、`git clean`、`git push`、`git rebase`、`git filter-*`、`git restore`、`git checkout --`、`git branch -D`、`git tag -d`；
- 容器/云删除和 prune 命令；
- SQL `DROP`/`TRUNCATE` 模式；
- publish、生产部署、全局安装和系统包命令；
- `sudo`、`shutdown`、`reboot`、`kill -9`、`pkill`、macOS `defaults write`/`security`。

项目可以在自己的配置里追加更具体的 ask。基线不是穷尽的。

## 规则顺序

OpenCode 使用有序规则，最后匹配生效。Agent 定义把宽泛 allow 放在前面，具体 ask 放在后面。`riccon doctor` 会在 ask 排在宽泛 allow 之前时报错，因为宽泛 allow 会覆盖 ask。

`templates/agents/permissions.yml` 是权限的唯一事实源；`templates/agents/models.yml` 是模型和步数的唯一事实源。改完运行 `npm run sync:agents`（`sync:permissions` 保留为兼容别名）。

## 诚实的限制

模式匹配不是安全边界。Agent 可以运行一个删除数据的脚本、一个 drop 表的数据库客户端，或一个修改共享资源的云 CLI。Ask 列表减少误操作，但不能阻止一个困惑或故意的 agent。

对重要操作使用一次性运行时：

- v1：项目 Docker/Compose 环境跑构建、测试、数据库和预览；git worktree/commit 用于文件回滚；
- T4/生产：只挂载项目的容器或 VM，限制网络出口，不放生产凭据；
- 绝不对生产跑破坏性数据库测试。

合同用 `sandbox`、`commands.sandbox` 和 `docs/SANDBOX.md` 声明隔离边界；发布前运行 `riccon sandbox check`。T4 缺沙箱声明、命令、文档或证据时失败。`/riccon-release` 会同时运行 `riccon release check`，发布记录必须引用 owner 为 user 且已 answered 的批准决策。

OpenCode 快照可以恢复文件；不能恢复数据库、外部服务、进程或 git 状态。

## 密钥

- 绝不把密钥写进仓库、`.riccon/`、日志、任务卡、证据、提示词或 handoff。
- 配置里使用环境变量替换，不要内联密钥。
- 读和编辑 `.env*` 都是 ask。
- 依赖、容器和 CI 配置从平台 secret store 取密钥。
- 密钥泄露时停下来、轮换，并在不复制密钥的前提下记录事件。

## 角色边界

- 只有 Lead 可以 spawn subagent。
- 只有 Lead 可以直接问用户；其他 agent 把问题交回 Lead。
- Verifier 可以写独立测试和报告，不写生产源码。
- 事后 diff 审计会发现角色越界；权限系统只强制上面两个角色边界。

## 修改权限

- 团队基线：改 `templates/agents/permissions.yml`，同步，跑 doctor，跑测试。
- 项目特定 ask：在项目的 OpenCode 配置里加规则，不要改团队模板。
- 新增 `deny` 需要明确的设计决策。当前设计只允许对 `subagent` 和 `question` 做 deny。
