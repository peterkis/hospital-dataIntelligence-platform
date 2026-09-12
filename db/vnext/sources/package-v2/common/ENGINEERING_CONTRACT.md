# 所有Codex票据的共同工程契约（当前授权）

你正在执行 HDIP-MC-VNEXT，不是在直接执行旧PV兼容要求。执行前读实际AGENTS/CONTEXT、当前task、对应phase、datasets和docs/01–08。本包文件存在不表示平台实现完成。

1. **范围**：一次选一个ready task。任务依赖由machine/tasks.json定义；前置实现及其实际receipt未完成不得扩大后续领域。只有用户明确选择整phase才按拓扑逐票执行，不默认自动跑86票。
2. **基线**：P0-00根据当前本地Git对象建安全开发基线；后来从已验收前票handoff实际HEAD继续。main b84ebca6…仅为本包观察。不要硬编码旧Person branch或未来SHA。local-only远端=NOT_OBSERVED，no-push不推出远端不存在提交。
3. **允许重构**：旧API/投影/客户端/脚本不必兼容，可统一重做。必须更新全部当前调用方、schema、生成类型和测试；旧hash测试可替换但不能删除仍成立的业务不变量。源码/DDL命名可调整，owner边界和源语义不可丢。
4. **数据安全**：默认receipt-owned新vNext开发库，保留旧证据库。DROP旧库、reset Git、删用户文件、修改安全策略均未授权。新fresh临时库可按本票creation receipt精确清理。真实人员/证件/HR文件默认禁止，开发只用synthetic。
5. **先RED**：保存tests-only差异、时间、argv、exit和预计失败，再实现runtime/DDL。不能把后补负控改写成初始RED；实际未跑就记NOT_RUN。环境失败不等于领域反例。
6. **领域分离**：Person/E/A/Role/Credential/Account独立；机构/院区/科室/单元/病区/护理/地点独立；多视图/成员关系不混；跨owner只经公开端口，importer无别域DML。
7. **完整期间**：采用半开B区间、实际R、微秒和null无界。按对象语义选择完整期限或局部规则分段；不能首点校验、旧开放版本回退、多个独立事务拼快照或scope笛卡尔。
8. **写入原子**：同根事务内owner commands、依赖证据、outcome、audit；外部调用outbox后发。dry-run与approve绑定exact input/transform/contract/rule/dependency版本；apply前当前授权及head重验。ACK丢失读根outcome，不二次创建。
9. **未知与历史**：源字段未ready标BLOCKED_DEPENDENCY；FULL文件不能自动降级CORE。旧input/version不可就地修复；变化新增版本/修订/补偿。当前读取不是历史接受依据，source时间不是DB记录时间。
10. **权限隐私**：按object/type/campus/purpose/field组核验；maker不可self-approve；硬错误不可override；raw敏感字段不入audit/error/log/metrics/普通投影。相同request重放也须当前访问授权。
11. **维护可用性**：本task交付不是孤立DDL；需要领域contract/owner、导入adapter或明确未ready注册、当前typed API、最小可操作UI入口、审计/历史和测试。纯规则/基础设施票可由其指定工作台/后续消费证明，不造空假界面。
12. **验证**：逐task-specific反例、契约/类型/owner边界、适用DB/权限/并发/rollback/replay；DDL验证fresh与当前lineage升级；持久化变动真实restart。阶段门禁跑当前全范围回归与真实browser，不保旧URL字节而保当前一致性。
13. **隔离**：共享定义/退役/破坏SQL竞态只在owned fresh库；retained skip需要对应fresh覆盖，不改SKIP成PASS。非任务资源不终止。使用仓库既有prototype:db:with或P0-00审定的新等价管理入口。
14. **交付**：更新task/design/coverage状态；分别Spec/Standards同tree只读审查，0阻断且披露方法。不存在的审查工具/浏览器不虚构执行；必要gate无法做则BLOCKED。
15. **提交停止**：默认本票一个本地完成commit，不push；tracked文档在commit前整理，FINAL_SHA/资源观察放ignored receipt。不自引用二次amend。完成本票即停止，下一票需要用户选择。

所有命令必须来自当前仓库已存在脚本或本票新建并测试的脚本；文档里的接口/模型名称是目标契约，不代表现有代码已经有。不得输出工具参数当运行结果。
