---
status: accepted
extends: 0083
clarifies: 0069
---

# 版本与生命周期由治理对象模块拥有

Phase 01不建立独立的通用版本模块、`VersionService`、`BaseVersion`或通用版本CRUD框架：`charge-catalog`拥有收费项目稳定身份、收费项目版本、演进关系及其业务生命周期，`price-list`拥有价表稳定身份、价表发布版本、价格条目及其业务生命周期，未来治理对象也由各自模块拥有内容版本和状态转换。工作流模块只拥有审批模板、变更请求和审批动作，发布交付能力只拥有通用发布包络、快照及Outbox，审计能力只拥有只追加证据；它们通过稳定身份、明确版本引用和事务作用域接口协作，不得取得、修改或泛化领域版本主权。通用`governance_release`用于关联一次审批后的发布事实，不取代`charge_item_version`或`price_list_release`，也不提供绕过领域不变量的低级写入口。
