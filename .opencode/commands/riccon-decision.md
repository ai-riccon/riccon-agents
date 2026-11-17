---
description: 列出开放的 Riccon 决策，一次批量询问用户，并把答案记录到决策包。
---

# /riccon-decision

加载 `riccon-core` 和 `riccon-contract`。

1. 读 `.riccon/decisions/*.md`，列出开放决策，blocking 的优先。
2. 每个开放决策给出：
   - 问题和为什么现在要定；
   - 选项及后果；
   - 你的推荐；
   - 用户沉默时的默认值；
   - 默认值生效的截止时间。
3. 一次批量询问用户，不要把决策拆成很多条消息。
4. 用 `riccon decision answer DEC-0001 --answer "..." --kind approve|reject|choose|defer [--release REL-0001]` 写回答案；不要手改 front matter。批准类决策必须带 `--kind approve --release REL-0001`，内核会绑定 release 和 environment。已回答的决策不可覆盖；变更实际执行前不要标 `applied`。
5. 答案改变产品范围、stack、commands、tools 或 DoD 时，带 diff 更新 Project Contract，并重新运行 `riccon contract validate`。编辑合同需要审批。
6. 用户沉默时：
   - T1–T3 可逆决策：执行声明的默认值并记录；
   - T4、生产、花钱或破坏性决策：停下来等。
7. 更新状态并写 handoff。
