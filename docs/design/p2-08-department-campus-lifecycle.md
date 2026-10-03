# P2-08 科室院区关系与全生命周期

基线：`1ce02731828e88a7a29c1b77b37cebe80099e86e`，当前分支 `main`。本票依据用户批准的计划及 ADR 0134 实施。外部 P2-08 prompt 是规格来源，其 NOT_STARTED/NOT_RUN 不代表实际执行结果。

## 范围与阶段顺序

P1-07 的 Campus/运营主体/许可准入与 P2-06 的影响评估和处置先就绪；本票完成 Department 领域和 typed API；P2-07 再接维护页面和阶段集成。不存在要求先完成 P2-07 才能实现 P2-08 的循环依赖。

不接旧库，不搬旧数据。仅使用 `.runtime/vnext/creation.json` 所属研发库及独占 receipt 的临时库。合成政策、合成证据和模拟外部影响均不代表院方政策采纳。Location 留 P3-07；实际 Assignment 写入留 P4；跨消费 Release 补偿留 P8-05。原 P0-02 browser 待验保留。

## 稳定身份与时间

Department 身份不含 Campus。属性、生命周期和院区服务关系分别追加版本；跨院区服务切换沿用 Department ID，亦不复制 Person。关系精确绑定 Campus、运营主体、有限服务代码集和完整 `[validFrom, validTo)` 区间。缺失许可 scope 不视作全院覆盖。

SUSPEND 持续到显式 RESUME。RESUME 不追加属性身份版本，须重新核验恢复后所有保留关系的未来期间。上游失效后，原服务集的结束或严格缩减仍可执行；之后重新提交恢复。DEPRECATED 与 SUPERSEDED 不可恢复或回填扩张，未来退出前的合法区间不被提前关闭。

所有业务时间按北京时间解析，记录时间由数据库产生。读取支持 businessAt 和 recordAsOf，使用原 exact 版本及原记录时点；当前准入另行重核，不能把后来的可用状态改写成原接受依据。

## 公共职责与输入输出

复用 Department Owner、Catalog ApplyCoordinator 和现有 Campus/Operating Owner，不新建编排服务。

| 职责 | 公共输入 | 主要输出/约束 |
|---|---|---|
| assignDepartmentToCampus | `ASSIGN`，Department 属性/lifecycle head，typed Campus/Subject，服务集、期间 | 独立关系身份和首版本；全期间 Department 与实际运营/许可准入 |
| moveServiceScope | `MOVE`，精确来源关系版本、指定服务子集、目标端点、共同 T | 来源结束、未切换部分显式留原院区、目标建立；一个根事务、共同 R |
| suspend/resume/deprecate | 判别命令、预期双 head、生效点、理由和证据 | 追加生命周期版本；显式恢复与终态约束 |
| revise/end relation | 精确关系版本、完整服务集及新期间 | 追加完整版本；安全缩减不依赖上游重新变为有效 |
| compensateEvolution | `compensatesEvent` exact 引用及新的演变输入 | 同身份更名或从合法承继身份建立新身份；旧事件和终态不改 |
| admission/history/query | typed Department、完整期间或 B/R | 全期间覆盖结论、生命周期和独立关系历史 |
| relations/diff | Department、B/R、可选 Campus、cursor/limit 或精确双版本 | 有界列表及同关系版本对比 |

`/api/vnext/department-lifecycle/` 提供 inputs、inputs/read、verify、plan、review、approve、apply、resume、history、query、admission、relations 和 relations/diff。现有演变路径增加 compensate。全部命令使用 closed schemas，在 Ajv 处理前拒绝类型强制转换；生成 OpenAPI、客户端和正反类型编译案例同步更新。

同一生命周期单元要求共同生效点及同类影响语义。服务范围 MOVE 的源/余量/目标由 Owner 展开，计入有限写预算。多领域演变通过显式 `campusChanges` 组合 END 与 ASSIGN：承继对象使用单元内 typed alias，同身份更名可引用原身份。省略 companion 不会自动继承关系，亦不自动迁人。

## 批准、事务与恢复

1. 先按当前主体权限读取原 Department、关系、实际 Campus/Subject 与 source；再解释输入和时间。原输入与独立验证以 AES-GCM 密封，摘要绑定原始内容；解释不修改原输入。
2. ORG04 当前 CORE 合同、输入 revision、双 head、独立自然人身份、原证据摘要和实际运行/许可期间均进入批准依据。FULL 尚未就绪时明确 BLOCKED_DEPENDENCY。
3. plan 冻结完整单元，独立 reviewer 读取同候选并批准。apply 在共享 advisory lock、单个事务下重观察；依据变化使旧候选 STALE。不能审批的业务输入保留可读原稿及明确 issues。
4. SQL HMAC 权威入口绑定当前事务和批准单元。主事实、关系版本、影响 case、audit、共同结果一并提交或回滚。失败不结束来源；同 request 的已接受结果可恢复与重放。
5. 历史恢复重核当前访问权限和原 exact 引用，不把 retention TTL 或新准入政策用作改写旧 outcome 的理由。

0134—0140 均为前向迁移。6 个新表只存领域必需的输入、验证、根操作、生命周期及关系/版本。关系版本属于生命周期或演变的一个根操作，deferred guard 核对共同 R、端点以及最终无重复服务区间。永久代码归属继续由原 Owner 维护。

0140 根据固定候选两轴评审补齐：原提交身份与冻结/最终批准身份的 SQL 防线；当前终态的任职准入与演变前驱限制；跨治理域关系与 SourceMapping 按自身 scope 授权，同时保留原 case 的治理域。Identifier 没有归属院区，继续核验请求域、scheme 与目标读取权限。历史 coverage 保留完整有效片段；层级的 ownerDepartmentId 与节点均检查生命周期完整期间，截止退出时点的历史层级仍可发布。当前 admission 单独拒绝终态的新任职，显式旧 R 仍保留原接受知识。HTTP review 输出原输入、独立验证、冻结状态/材料/许可依据/assessment 与展开后的 MOVE 三项写入。

服务角色只显式获得公开入口权限；不能直接修改事实表、读取签名权威密钥或调用未签名的内部 companion writer。启动前执行实际 privilege 检查，缺少授权时在 listener 前失败。验证工具的实际角色亦撤销这些内部入口。

## 共用影响评估与处置

复用 P2-06 的同一 assessment/case/disposition/receipt 台账，新增生命周期 root 的 dispatch 与 `CAMPUS_RELATION` 有界反向引用。保留冻结批准观察与后续当前观察的区别。原外部责任、独立批准、receipt、模拟标识和终态规则继续适用。

关系处置证明必须绑定已提交 candidate/request、当前精确关系版本与对应根 outcome，不能用旧缩减证明掩盖后续扩张。CLOSE_RELATION 经独立批准和真实当前复核后关闭有界义务；外部迁移未执行不会被写成完成。

## 验收责任与证据

| 验收 | 当前领域证明 | 后票/实际边界 |
|---|---|---|
| AC01 | 两院区服务关系、部分 MOVE、同身份更名、目标失败来源不变、关系共同 R | 未建 Location，不声明空间迁址完成 |
| AC02 | SPLIT 明确承继身份；仅显式 alias 接收关系；handoff 保持 NOT_EXECUTED | 实际 Person/Assignment 迁移待 P4 |
| AC03 | 公共 Owner 及真实 loopback HTTP 的完整期间暂停拒绝、历史 R、显式恢复 | 实际 Assignment 写入联测待 P4，院方政策未采纳 |
| AC04 | 更名/拆合前向补偿，原事件/代码/终态保留；复合根故障全部回滚 | Release 补偿映射 P8-05 |
| AC05 | 真实 Operating Owner 全期间许可核验，父院区不可用与证照撤销后恢复拒绝；相关许可回归 | 不以合成证据证明真实医院证照有效 |

Q15/A013 在本票映射为共同 T/R、原 exact 引用、显式承继和领域前向补偿。所有原字段/条件仍由原合同与 `field-routing.csv` 管理；UI、空间、真实任职、真实消费配送的责任按上述后票保留，不整体预填来源验收 PASS。

可复跑命令（数据库 runner 必须串行）：

```powershell
npm.cmd run vnext:p2-08:typecheck
npm.cmd run prototype:db:with -- vnext:p2-08:validate --upgrade
npm.cmd run prototype:db:with -- vnext:p2-08:deploy
npm.cmd run prototype:db:with -- vnext:p2-08:regression
```

前驱升级固定读取基线代码并在 prefix 0133 创建真实已接受演变及待批准候选，升级后逐行/键/ledger/OID 核对，恢复原 outcome/event/cases，拒绝旧待批准依据。fresh 验证生成类型与真实角色/HTTP/事务用例。持久部署保留唯一研发库 OID 和所有前驱行/键，复用已发布合同，验证新合成 cohort 的生成客户端请求及重放。

执行日志、升级报告、部署/保全报告、回归分项和最终 commit/tree handoff 位于 ignored `.runtime/vnext/p2-08/`。只有 READY、目标 exit 0、cleanupPassed=true 的完整 runner 才作为该轮通过证据；启动失败、RED、过渡失败日志不作为验收。

2026-10-03 执行结果：完整 28 项适用回归全部通过，P2-08 的 14 个公共 Owner/HTTP/实际 PostgreSQL 角色用例通过。0133 前驱升级保留原行、键、ledger、已接受 outcome/event/cases，原待批准候选被判 STALE；研发库 OID 206108 当前为 0140，保全检查和生成客户端真实 HTTP 暂停、恢复、重放均通过。两个最终数据库 runner 均 READY、target exit 0、cleanupPassed=true。Standards 与 Spec 的独立固定候选评审均无剩余阻断。

评审采用 implement 调用的 code-review：按实施基线固定候选，两位独立只读 reviewer 分别判断 Standards 与 Spec，修复后仅复跑受影响检查。最终提交为当前 `main` 一个本地完成提交，不 fetch/push，不进入 P2-07。
