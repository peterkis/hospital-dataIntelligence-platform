# 基线导入审计与来源影响问题

迁移 0006 和当前 seed 补齐 P0-01 元数据范围内的 ADR 0006/0018 要求。没有创建 ORG/PER 业务实例、执行导入适配器或代替 P0-02 契约工作。

当前 fresh seed 在同一事务内写入 53 项 DATASET 的版本和 DRAFT 事件、逐项 `BASELINE_IMPORT` 审计及一个 `BASELINE_IMPORT_BATCH` 审计。摘要绑定 snapshot hash、dataset code、技术对象/版本、完整元数据内容和 B；批次绑定来源摘要、记录数和 manifest 数量。只保存技术引用与摘要，不将原始内容复制进审计。重复 seed 不增加数据或审计，任一审计失败使整个导入回滚。

对旧 vNext 库中已有但未写审计的导入，0006 只在当前升级事务追加 `BASELINE_IMPORT_OBSERVED` / `BASELINE_IMPORT_BATCH_OBSERVED`，明确表示升级时观察。原审计、原业务记录时间和原导入事件均不修改，不能把观察补记当作历史导入当时已有审计。receipt-bound `vnext:catalog:import:upgrade` 在实际五份迁移前缀上先保存元数据/outcome/原审计摘要，再执行前向升级并验证原行不变、53 项及批次得到覆盖。新审计继续进入 0004 哈希链。

来源废止复核先通过 `GET /api/vnext/sources/{id}/change-impact` 枚举当前已接受引用和保留的历史版本引用，包括传递引用；遍历使用数据库版本 UUID，而非 UUID 文本大小写。页面显示被结束的已发布内容、B、影响引用及“提交时立即生效”，然后将内容摘要、影响摘要与当前 head 一起提交。引用变化使影响摘要失效；不同身份的当前 REVIEW 权限仍是必要条件。

废止事务为当前受影响下游逐项追加 `impact_event` OPEN，同时写审计与原 outcome。问题以 case UUID + 正 bigint event_sequence 排序，保持只追加。下游经独立复核废止，或者通过现有完整来源链校验后重新发布时，追加 CLOSED，绑定准确的 resolution_event；不会自动修改引用或替换下游。`impact-cases` 读取当前状态及按序排列的完整问题事件，页面提供“查看影响问题”。历史引用和原版本永久保留；受信新引用仍经 source qualification 拒绝已退役链。

既有已废止来源若仍有当前受影响引用，升级仅创建标为 `UPGRADE_IMPACT_OBSERVATION` 的当前问题，不伪造历史预览或原失效时已创建问题的证据。测试使用 receipt-owned fresh 库验证根→子→孙引用、大写 UUID、陈旧影响摘要、故障原子回滚、重放不重复建问题，以及下游独立废止后的关闭证据。问题闭环只覆盖本目录元数据，其他业务对象的失效与问题治理仍属于后续各域票。

同样的保护覆盖来源定义重发：当 PUBLISH 将替换仍被当前下游固定引用的定义时，也必须核对 `change-impact` 并携带匹配的 impactDigest；存在当前引用而没有摘要时拒绝发布。发布为这些引用创建 `UPSTREAM_SOURCE_REPUBLISHED` 问题，下游明确修订到当前定义并经独立复核重发后关闭，原固定引用保持原样。初次发布且无当前下游时不要求额外影响摘要。页面提供“载入发布影响摘要”。测试也覆盖上游重发→子/孙逐一合格重发→问题关闭，不只验证废止。

升级观察也覆盖此前重发造成的失效：对仍为 PUBLISHED 的上游，只为固定到旧定义版本的当前直接/间接下游建问题，排除固定到当前已接受版本的健康引用。`vnext:catalog:impact:upgrade` 真实安装五份迁移，执行旧发布行为形成失效引用及健康引用，再升级到 0006，验证观察覆盖、健康排除和原审计/outcome 保留。

普通目录 GET 按 ADR 0006 保留请求级完成日志：仅服务器签发的随机 request ID、固定路由模板、状态、完成时间和耗时，经本地进程日志捕获保存。客户请求 ID、原始 URL/查询、路径实体 ID、headers/body 和响应内容不进入记录；本目录没有真实敏感业务实体查询。`vnext:catalog:reference:logs` 对真实 HTTP 成功、拒绝、无效 GET 各验证一条记录，并核对合成 canary 未进入日志。该日志不是新增遥测服务或敏感实体审计平台。
