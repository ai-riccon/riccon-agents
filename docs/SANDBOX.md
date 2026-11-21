# 沙箱

权限规则减少误操作，但不是安全边界。处理敏感数据、迁移、T4 或生产关键操作时，必须在一次性运行时中执行，并把结果记录为证据。

## 层级

| 层级 | 用途 | 最低要求 |
|---|---|---|
| L0 本地 | T1/T2 的普通读写和测试 | 不碰生产凭据；危险命令 ask |
| L1 项目容器 | build、测试、数据库副本、预览 | 项目目录挂载；依赖可复现；失败不污染宿主 |
| L2 T4 隔离 | PII、认证、支付、迁移、生产关键 | `network none` 或白名单、只读项目、非 root、无生产密钥、CPU/内存/墙钟上限 |

沙箱不是“跑一次容器”就算完成。L2 需要：

- 合同声明 `sandbox.required`、`sandbox.runtime`、`sandbox.network`/`sandbox.allowlist`、`sandbox.mounts`、`sandbox.secrets`、`sandbox.attestation_terms`、`sandbox.evidence`；
- `commands.sandbox` 可复现；
- `docs/SANDBOX.md` 写清挂载、网络、密钥、清理、限制；
- 一次通过的沙箱证据；
- `riccon sandbox check` 通过。

## 合同示例

```yaml
commands:
  sandbox: bash scripts/sandbox.sh
sandbox:
  required: true
  runtime: docker
  network: none
  mounts:
    - project:ro
    - tmpfs:/tmp
  secrets: none
  limits:
    cpus: 2
    memory: 2g
    timeout_minutes: 30
  attestation_terms:
    - "network=none"
    - "project=ro"
    - "uid=10001:10001"
    - "sandbox: OK"
  evidence: EV-0001   # 必须是 commands.sandbox 产生的 passing EV
environments:
  sandbox: Docker node:26-slim; network none; read-only project mount
```

具体镜像、用户、挂载和命令属于项目合同，不写死在团队定义里。

## 检查

```bash
riccon sandbox check --project .
```

T4 缺声明、运行时、网络/密钥策略、挂载、limits、attestation_terms、`commands.sandbox`、`docs/SANDBOX.md` 或证据时失败；低于 T4 时缺项是 warning。`sandbox.network` 在 T4 只允许 `none` 或 `allowlist`；`allowlist` 必须同时提供非空 `sandbox.allowlist`。T4 挂载拒绝 `:rw`、宿主绝对路径和 `host` 挂载。`sandbox.evidence` 必须是 `commands.sandbox` 产生的 passing EV（`manual: false`、`exit_code: 0`、哈希匹配），且日志必须包含合同声明的 `attestation_terms`；不能是手写文档路径或纯 `exit 0` no-op。

## 发布

`riccon release check` 会检查发布记录、用户批准、T4 发布产物和 `RELEASE` 评审，并在 T4 调用 `sandbox check`。沙箱 EV 必须出现在 release evidence 中，不是替代品。

## 限制

- 容器共享宿主内核；不能防御内核漏洞或恶意镜像。
- 只读挂载不等于数据不可读；敏感数据仍需最小化和脱敏。
- 不使用宿主 Docker socket、特权模式或宿主网络。
- 沙箱失败时保留日志，不保留密钥和 PII。
