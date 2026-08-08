---
status: accepted
extends: 0097
clarifies: 0096
extended_by: 0099
---

# 消费者交付转换只允许受控声明式能力并在验证失败时关闭

消费者交付配置默认只能组合一组受控、声明式且可验证的表示转换：字段选择、字段排序、字段重命名、明确且确定的格式或类型转换、空值与默认值策略、常量元数据，以及对已发布代码映射版本的引用。每项操作必须显式声明输入、输出和失败行为，不得用操作组合绕过本决策的禁区；引用映射也不能隐式访问当前映射或改变记录基数。

行过滤、记录拆分、记录合并、聚合、计算字段和一对多展开属于可能改变成员集合、基数或业务含义的高风险语义转换，默认不得进入消费者交付配置。确有需要时，必须先把所需能力作为独立高风险转换能力完成显式审批并提供固定测试向量；该审批不得由普通配置终审、操作员导出或实现侧白名单替代。本决策只建立例外门禁，不批准任何具体高风险能力。

消费者交付配置绝对禁止任意脚本、SQL、网络调用和运行时回查当前领域表、当前映射或其他当前业务状态。配置版本终审前必须针对其精确来源`projection_type + projection_schema_version`及固定样例向量执行验证；未知操作、字段或类型不匹配、未发布或不适用的映射版本、测试预期不一致，以及任何验证错误都失败关闭并阻断批准。

`release-distribution`运行时只能执行配置版本中已经批准且通过验证的声明式计划。出现未批准能力或契约不匹配时必须失败关闭，不得回退脚本、SQL、网络调用或查询当前数据。真实快照中单条数据转换失败的整作业语义由[ADR-0099](0099-fail-the-entire-managed-export-job-on-any-record-conversion-error.md)进一步限定；[ADR-0100](0100-stage-managed-export-after-phase-01-and-reserve-record-push.md)确认Phase 01不实现受控导出，完整POC邻接薄切也只允许本ADR的默认受控表示转换，不启用任何高风险语义转换；[ADR-0103](0103-use-deterministic-uncompressed-zip-for-managed-export-artifacts.md)冻结转换结果的确定性无压缩ZIP表示；[ADR-0104](0104-store-managed-export-artifacts-in-postgresql-for-complete-poc.md)冻结完整POC的PostgreSQL `bytea`原子存储边界；[ADR-0105](0105-retain-managed-export-artifacts-until-poc-evidence-baseline-disposal.md)冻结完成制品在POC内的保留与禁止选择性删除语义；[ADR-0106](0106-set-managed-export-artifact-capacity-from-representative-measurement.md)冻结容量先测后定、最终ZIP精确字节计量与超限失败关闭方法；[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)冻结前置隔离实验与集成后真实链路核验；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)冻结正常宽度、字段宽度和中文多字节/CSV转义压力画像，并要求全部容量记录仍可通过本ADR的声明式转换；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)冻结各画像逐字段精确分布、适用字段身份及不合法映射失败关闭；[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)冻结受限本机WSL2容量环境及独占运行门禁。声明式规则的具体语法、编译或解释方式、私有执行组件位置，以及重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合和数值上限仍未确定。
