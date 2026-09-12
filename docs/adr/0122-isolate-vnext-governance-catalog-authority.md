---
status: accepted
extends: [0071, 0073, 0074]
---

# 以独立原生 SQL lineage 管理 vNext 治理目录

根据 P0-01 的显式授权，目录专用控制平面在 receipt 绑定的新库中建立；旧业务 schema、生成类型和证据库不迁入。governance-catalog 是唯一元数据写 Owner，受限 SECURITY DEFINER 命令校验当前主体、scope、exact head 与复核摘要，将版本、事件、outcome 和最小审计同事务保存。应用角色仅执行有限函数；只读表权限供元数据类型发现，RLS 默认拒绝行读取。DB schema owner 为本地迁移管理员，不能宣称管理员无法绕过治理机制。

目录对象与源字段声明分开保存；来源主目录保持 DRAFT/待院方确认，合成治理使用独立 SYNTHETIC scope。责任范围只接受 ALL/NORTH/SOUTH 与 ALL/IDENTITY/CONTACT 的有限集合，按覆盖关系和半开期间冲突检查；所有目录命令在同根事务串行化，不提供自由范围表达式。修订为新完整版本，旧发布与旧 R 保留；未发布修订不会移除既有已发布 Owner 的冲突防护。
