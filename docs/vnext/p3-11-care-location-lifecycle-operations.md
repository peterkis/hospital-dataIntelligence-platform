# P3-11 合成 CORE 操作约定

本票只使用 `TEST_POLICY_ONLY`。院方政策为 `NOT_ADOPTED`，临床为 `NOT_READY`。人员任职、床位资源及快照、患者和外部消费者的依赖为 `NOT_EVALUABLE`；这不是零依赖或处置结案。

## 准确输入与审批

先通过原 Owner 建立受保护输入及独立核验。组合输入只引用有限 Owner 枚举、原输入 ID、revision、digest 和契约版本，不复制一套可编辑业务字段。切换时间是无时区本地时间，最多六位小数，期间为 `[from,to)`，null 表示无界。

调用生成客户端 `createCareLocationLifecycleClient`，按以下顺序执行：

1. 用 `assessSpaceMove` 读取完整期间的已实现依赖和未接入能力。逐项准备原关系 END、绑定 REBIND、后继关系 CREATE 或其他有限领域命令。
2. 用 `stage` 或 `scheduleUnitMove`、`closeCareRelation`、`reopenSuspendedUnit` 提交准确成员引用。暂停使用 CLOSE 类组合中的显式 SUSPEND 命令。
3. 由独立底层身份执行 `verify`，然后读取 `preview`。护理交接另需 Nursing Owner 确认；确认、核验和整包审批可以由同一合资格人完成。
4. 原组合提交人以稳定请求 ID 执行 `plan`。审批者读取 `review`，再对准确 candidate ID 和 digest 执行 `approve`。其当前权限必须覆盖全部 Owner、来源和目标院区，并独立于全部成员及组合输入提交人。
5. 用原 candidate ID 和请求 ID 执行 `apply`，回读结果和各 Owner 事实，并执行 `reconcile`。只有 `COMMITTED` 且 `MATCHED` 才能记为完成。

最多100条展开命令，包括从属绑定命令；冻结内容最多512 KiB。超限整包拒绝，不自动分批。同一个目标不能在包内重复修改。材料、期待头、确认、成员或完整影响集合变化后，旧审批失效；重新组装、冻结和审批。

组织提案仍是提案。包内消费者保存准确原输入引用；执行时先写入其依赖的组织版本，再在同一个数据库事务和共同 R 下通过公开 Owner 端口解析实际准入。受限 SQL 检查同一候选、准确原成员、领域版本和 R，并重新检查准入。其他事务看不到中间状态。Owner 内 END/CREATE 批次仍由原 Owner 原子执行。

物理 MOVE_CONTAINMENT 的影响评价及提交前核查使用原命令准确 `[validFrom,validTo)`。有限调整不要求结束该窗口以外的后续使用。与物理变更同包建立的地点使用引用准确 Location 输入，生产者执行后由 Location Owner 在共同 R 解析实际完整期间物理树；输入成员排列不改变执行依赖。冻结输入保留提案依据，接受后的使用历史保存实际物理树依据。

## 生命周期与历史

暂停保留 ID、代码、归属、历史关系和占位，停止新增与扩张准入。RESUME 必须显式批准并重新核验完整期间，保留原 ID，不恢复已 END 或永久关闭的关系。CLOSE 永久遮蔽后续开放安排，不能恢复或复用历史代码。属性修订和未来版本不能解除这些限制。

三类组织暂停期间的归属按准确 B/R 下的已知绑定筛选，护理科室归属也按该绑定读取；此归属读取不授予暂停期间的有效绑定或准入资格。永久 CLOSE 后的当前绑定筛选仍遮蔽预排未来归属，关闭前的旧 R 保留原安排。

退出后的病区院区和护理科室展示保留退出点前最后已生效的准确归属；预排在退出点或之后的绑定不能改变该展示。该历史归属不构成有效绑定或准入，不按对象初始字段覆盖已生效的搬迁。

护理单元直接科室活动的影响报告按完整 SUSPEND/RESUME 期间计算，保留暂停中段的缺口。准确且仍为当前头的原 SUSPEND 回执可以证明该活动窗口已收缩；显式恢复后该回执不再是当前处置证明，新活动重新纳入依赖报告。这不证明独立护理覆盖、地点使用或能力关系已结束。

同院区换地点只结束旧地点使用并建立新使用，组织和逻辑科室 ID 不变。跨院区组织重新绑定必须显式处置来源范围的关系、能力及许可，并重新核验目标范围；物理地点 ID 保留在原院区。没有人员写入命令。

护理部分交接结束原完整覆盖，再建立保留和接收范围；重划使用不可变分区版本及新数据库 ID。旧新范围、全部当前和未来受影响覆盖及责任映射必须完整。独立安全 END 可留下可查询缺口，不能标为交接完成。

HANDOVER 组合要求每个准确 END 有确认过的后继集，保留原剩余期间及主要责任；整范围交接同样不能缩短期末或取消主要责任。剩余期末取原声明上界和已接受的未来 END 中最早者；新包自己的 END 不能改变这项核验依据。Nursing 确认、原 Coverage Owner 与受限 SQL 均核验连续性。仅 END 使用 CLOSE，回执为未完成交接。

原关系已经独立 END 时，可经新确认和审批在完全相同的切换点建立连续后继；原 END 和已结束状态保持不变。计算后继期末时只排除该同点 END，其他已接受的 END 仍限定上界。晚于原结束点的交接不能填补历史缺口，也不能标为交接完成。

整包重划的最终数据库检查采用相同的同点计算。已经在切换点结束的旧覆盖不再占位，单独重划无需再处置它；若显式纳入交接，仍需准确当前头、新护理确认、完整旧新映射及合资格整包审批。

`history` 区分原输入和独立核验依据、当前 B/R 下的生命周期以及当前依赖处置。历史读取也检查当前读取和材料权限。对象停止新增与依赖结案分别表达；关闭对象本身不会隐式修改关系。

## 提交恢复

`COMMIT_UNKNOWN` 表示提交 ACK 丢失，不能据此认定回滚。使用完全相同的 candidate ID 和请求 ID 调用 `resume`，再 `reconcile`。不得换请求 ID重复执行。相同原请求的准确重放返回原结果；改变载荷会拒绝。

## 验证与部署入口

纯编译检查可直接运行：

```powershell
npm.cmd run vnext:p3-11:unit
npm.cmd run vnext:p3-11:typecheck
```

所有连接数据库的工作使用受控入口，串行运行：

```powershell
npm.cmd run prototype:db:with -- vnext:p3-11:validate
npm.cmd run prototype:db:with -- vnext:p3-11:upgrade
npm.cmd run prototype:db:with -- vnext:p3-11:authority
npm.cmd run prototype:db:with -- vnext:p3-11:regression
npm.cmd run prototype:db:with -- vnext:p3-11:deploy
```

成功同时要求 READY、目标 exit0、CLOSED 和 `cleanupPassed=true`。环境失败和领域反例保留原记录。长命令用 cmd.exe 重定向日志，避免 PowerShell 收集大输出。编译和数据库测试串行执行，避免本机内存压力影响证据。

受影响回归保留完整30个入口，顺序执行。P3-11 编译图使用官方 `--singleThreaded` 参数，子进程设置 `GOMAXPROCS=1` 控制本机编译并发；根类型检查和工作区构建仍执行原命令。此资源设置不降低类型或领域检查范围。`--from` 只产生 PARTIAL_PASS，不能单独代替完整回归。

升级入口从准确0205源码及原 Owner 建立 populated 前驱，并通过该源码准备所需原 Owner 的测试角色权限后冻结基线，保存旧行多重集、重复数量、列、账本、密钥摘要、ACL、历史和原结果。前驱的通用传输契约不能冒充许可契约；许可测试按完整定义复用准确已发布契约，或经原契约的独立审批追加版本。部署入口只接受原研发库 receipt、名称 `hdi_mc_vnext_a7049c9e5c2a4364` 及 OID206108，前向追加迁移并保存保全证据。已安装迁移不可改写。

准确命令、RED/GREEN、候选审阅和最终 commit/tree 映射保存在 ignored `.runtime/vnext/p3-11/`。专门浏览器、完整重启、容量和正式医院验收保持各自原状态。原本地停止线已由用户后续发布授权扩展为推送、PR37独立审查、修复复审、准确head合并、main快进及本票已合并分支/工作树清理；不进入后票。

## PR37 读取契约修复

`getWardNursingHandoverReceipt` 返回封闭的 `NOT_COMPLETED`、`CONFIRMED_SCHEDULED` 或 `CONFIRMED_EFFECTIVE` 分支。未完成分支携带准确源头、nullable切换点、空后继和`NOT_READY`；确认分支携带已接受END的版本ID/序号、确认中的准确源期待头、切换点及全部后继的ID、版本、护理typed reference和覆盖范围。独立安全END不成为完成交接的凭据。

同点已独立END后建立的合法后继、原有未来END上界内的提前交接和跨院区重划均按准确确认事件关联。0251只增加护理覆盖Owner的有限读取函数，跨院区读取仍检查每个后继当前权限。0001–0250保持已安装原字节，既有责任占位、确认和outcome不重写。

query、list及窗口交接状态使用同一准确确认解析。后续无关END不遮蔽已接受的交接，旧R仍只显示当时已知确认。历史查询也不绕过当前源/后继读取权限。服务端输出不符合这两个封闭读取响应时返回`OWNER_RESPONSE_INVALID`（HTTP500），不将服务器输出错误归为申请人错误。

0252前向修复Nursing有限RESUME后再次SUSPEND的准入：切换点处必须开放，暂停结束时间仍为null；当前头、属性不变、审批和权限检查保留。恢复、修订和重绑定仍检查完整申请期间，不以切换点核验代替扩张准入。

`evaluateWardNursingEndpointImpacts` 的生命周期响应包括`SUSPEND / RESUME / CLOSE`，结束时间使用nullable微秒本地时间。R仅限制记录认知；未显式提供B时按当前业务时间解释。官方TypeBox、OpenAPI、生成客户端和当前调用方应一起更新。

专项选择器为`npm.cmd run prototype:db:with -- vnext:p3-11:validate --receipt-contracts`。选择器SKIP只说明范围选择；完整fresh、准确0205升级及受影响回归仍以各自完整终态证据为准。

窗口`handovers[].confirmation`保留关系CREATE/REVISE中原接受的incoming交接声明，作为原接受依据。未END时`status`评价该接收声明；已END时`status`评价准确outgoing交接是否完成。该原声明不充当后来交出的证明；准确已接受END、切换点和全部后继通过`getWardNursingHandoverReceipt`读取。两个字段分工由公开TypeBox描述明确，原事实不改写。
