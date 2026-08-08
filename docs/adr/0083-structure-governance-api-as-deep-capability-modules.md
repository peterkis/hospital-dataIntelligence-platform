---
status: accepted
extends: 0069
clarifies: 0073
---

# governance-api按治理能力组织深模块

`apps/governance-api`内部按治理能力建立深模块，每个模块只通过一个小型外部接口暴露命令、查询、不变量和错误语义，HTTP路由、状态机、SQL映射、仓储实现及适配器均隐藏在模块内部；组合根是唯一具体依赖装配位置，不建立全局`controllers/services/repositories`横向层、`BaseService`、`BaseRepository`或承载业务逻辑的`shared/common`层。跨模块协作只能调用对方接口，不得读取或写入对方表、导入内部类型或形成循环依赖；跨模块原子命令由事务运行器建立绑定同一数据库事务的作用域应用上下文，原始`pg`连接或Kysely事务不得进入模块外部接口，提交后动作只能在事务成功后执行。模块接口同时是主要测试面，持久化行为使用真实PostgreSQL验证；只有存在真实变化点时才建立内部seam和adapter，不为模拟仓储或套用分层模板制造假接口。ADR-0069中列举的收费项目、价表、工作流、权限、版本、审计、快照和Outbox表示必须保留的能力责任，不等于“一项责任固定对应一个独立模块”；Phase 01实际模块清单和依赖图另行确认。
