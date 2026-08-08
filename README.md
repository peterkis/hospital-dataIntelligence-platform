# Hospital Data Intelligence Platform

本仓库是单医院治理主体、多院区范围内的医院基础数据治理POC工程。当前工程阶段为Phase 01可执行架构基线，首先打通收费项目、价表、价格解析、发布审计和仿真消费纵向切片。

权威范围及架构门禁见[Phase 01计划](phase-plan/01-poc-executable-architecture-baseline.md)，领域术语见[CONTEXT.md](CONTEXT.md)。

截至2026-08-08，收费项目—价表—解析—审计—`SNAPSHOT_PULL`仿真消费核心纵向切片已通过真实PostgreSQL、Keycloak和两个隔离消费者的可重复验证。该结论只代表核心架构门禁通过，不代表完整Phase 01、72个REST场景或20个界面场景已经完成。

## 工程基线

- Node.js `24.18.0`
- npm `11.9.0`
- 单一根`package-lock.json`
- npm workspaces：`apps/*`、`packages/*`、`tests/*`、`tooling/*`

```powershell
npm ci
npm run check
npm run typecheck
npm test
npm run build
```

运行态验证使用`npm run verify:phase-01:live`。每次运行在`.runtime/evidence/<run-id>/`生成只读结果、消费者状态与SHA-256清单；`.runtime`被Git忽略，证据包需按验收流程另行归档。

`MANAGED_EXPORT_HANDOFF`和`RECORD_PUSH`不属于Phase 01实现范围，不得在当前骨架中预建空模块或旁路接口。
