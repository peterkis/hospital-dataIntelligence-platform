# P2-02 Hierarchy 视图导入

P2-02 在当前 vNext Department Owner 内治理 ORG05 视图定义和 ORG06 完整结构。每次候选只描述一个视图和一个完整业务有效期间；候选先在内存中完成严格森林校验，再进入独立复核和完整快照发布。

## 领域约束

- 一个视图内每个 Department 只能出现一次；每个节点最多一个父节点；循环、缺父、重复 node key 和重复 Department 在发布前阻断。
- 同一 Department 可以在不同视图使用不同父节点。
- GROUP 只拥有视图内节点身份。发布时生成 group/group-version 引用，不写入 Department 外键。
- 财务和统计视图可以登记定义，但当前候选导入返回 `VIEW_TYPE_NOT_OPERATIONAL`。
- `validFrom`、`validTo`、`recordedAt` 使用 `Asia/Shanghai` 本地时间；偏移时间和跨期间候选拒绝。
- 发布时每个 Department 版本必须覆盖候选的完整业务区间；版本边界跨越候选期间时要求拆分候选。
- 快照保存展示名称、引用版本、深度、排序和内容摘要；后续改名不会改变已发布快照。

2026-09-29 的持久研发库修复通过 0088 层级迁移和 0089 Department 前向修复完成；不重写 0084、0085、0087 历史账本。receipt 绑定数据库 OID 206108 的账本由 87 追加到 89，既有业务行与密钥摘要保持不变，wrapper readiness、P2-02 fresh 和 0087→current 升级均通过。

## 写入边界

`hierarchy_create_view`、`hierarchy_store_candidate`、`hierarchy_approve` 和 `hierarchy_publish` 是 SECURITY DEFINER 入口。应用角色只有读取新表和执行受控函数的权限，不能直接插入正式层级事实。发布函数锁定视图、重新检查 Department 版本覆盖，并在一笔事务中写完整版本、节点、审计和候选状态。

HTTP 路由位于 `/api/vnext/hierarchy/`：视图创建、候选导入、候选审批、快照发布和快照读取。维护页面不在本票范围，交由 P2-07 接入通用工作台。
