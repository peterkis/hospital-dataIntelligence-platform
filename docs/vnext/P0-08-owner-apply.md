# P0-08 Owner Application Apply Coordinator

基线 main `a03b07a00313d85518db3670ea4ac5877e97fae1`，tree
`75db19ba45049b4b98f699f9c67ba2eb1cc3e71a`。以用户提供的
`START-P0-08.current-baseline.prompt.md` 接续原 v3；只实现本票。

## 接口与边界

`openCatalog` 提供 `planOwnerUnit`、`readApplyCandidate`、`approveApplyUnit`、
`applyUnit`、`resumeOutcome`、`reconcileCommittedUnit` 的 closed typed API。
生产 composition 没有就绪的领域 Owner port，保持 `BLOCKED_DEPENDENCY`。
P0-07 预览 token 不被这些接口接受，原 ORG/PER 路径仍不能冻结批准。
没有新增 HTTP 路由、页面、真实业务域、外部配送或后台服务。

内部 `ApplyOwnerPort` 仅在 composition 接入。临时 runner 安装原生 SQL 的
`FINITE_LEFT` 和 `FINITE_RIGHT` 两个受限写面及可信合成源，在同一个生产
Coordinator 中执行；测试不复制 Coordinator，也不把测试 Owner 注册成 ORG/PER。
测试源是有限 typed input，使用自己的 `FINITE_PAIR_CONTRACT_V1` 和显式
`FINITE_PAIR_ALL_ROWS_V1` 原子政策；它不代表真实文件/业务数据已接入。

候选的完整内容由 Owner 从受限源读取；调用者只给 job、revision、维度、根 request。
原子政策、全部成员、显式意图、alias、expected heads、完整 diff、源/契约/规则/
解释/变换依据和质量 head 经稳定键排序 HMAC 绑定。P0-07 与 Apply 共用绑定工具，
但使用不同 domain，不能把预览转作批准。数组顺序仍是契约的一部分。
整体单元最多 100 行、512 KiB；超限或未声明环整单元拒绝，不运行时拆分。

批准人以自己的身份读取加密冻结候选，批准精确摘要。数据库按 underlying identity
执行 maker-checker；候选、批准均不可变。根 request 在冻结前确定，批准后不能换
request 执行。敏感内容使用已有 key-provider 与 AES-256-GCM，AAD 绑定候选摘要；
公开结果只含技术 ID/版本，普通表不存原值或低熵业务键普通 SHA。
候选原值读取同时检查当前对象 READ 和 REVIEW，将主体、候选 ID、院区/用途和
受限摘要记入既有审计链，提交后才解密返回；缺 key 不会撤销已经提交的合法访问
尝试审计。这是独立的只读根，不向 Apply 写根引入 savepoint。

## 一个写根事务

Coordinator 复用 `901002` 授权/目录串行锁，在同一连接、根事务内重新检查当前
执行人和批准人的权限、候选内容、源 revision、质量/规则与目标 heads，并在任何
业务写入前全量验证。当前测试单元跨两个 Owner 共三行；每个 scoped port 只能
调用自己的有限 SECURITY DEFINER 命令，应用角色没有跨 Owner DML 权限。

写根不设置、移动或回滚到 P0-07 的读审计 savepoint。Owner 异常及 `ok:false`
均抛出事务根，领域事实、单元 outcome、成功审计一起回滚；成功时一起提交。
新增三张不可变关联表保存加密候选、批准、唯一消耗；复用既有 request_identity、
outcome 和 hash-chain audit。对账结果以原审计保存，不另建 Outbox 或回执表组。

## 恢复与对账

同一 underlying identity/request 只能关联一个候选；并发重放返回原 IDs。
已提交 outcome 的恢复先检查当前读取权限，不解密原文件、不依赖 provider key，
也不要求过期原源重新批准。新的 Apply 缺 key 仍失败关闭。

确定性拒绝、事务提交前 transport failure、`COMMIT_UNKNOWN`、`COMMITTED` 后
`POST_COMMIT_FAILED` 分开报告。COMMIT 附近异常要求用原 request 查询/安全重试，
不自动创建新操作。提交后回调失败仍保持本地 COMMITTED。对账调用两个已登记
Owner 的 exact-read，比较实际 ID/版本；缺失或版本不匹配产生 MISMATCH 审计。

## 原六项 AC 与证据

| AC | 实际测试断言 |
|---|---|
| P0-08-AC-01 第 N 行失败前 N-1 领域写全回滚 | 第三行 throw / ok:false；跨两个 Owner 的前两行、读取审计及成功回执均无新增 |
| P0-08-AC-02 业务异常和网络错误分类不混 | OWNER_REJECTED、TRANSPORT_FAILED、真实 COMMIT 后 ACK 丢失、提交后回调失败 |
| P0-08-AC-03 并发 head 变化不能用旧 dryrun 放行 | 双连接锁竞争；源 revision、quality、rule、成员、目标 head 漂移；当前授权撤销 |
| P0-08-AC-04 相同 request 返回原 IDs | 同请求并发、alias 身份重放、请求冲突、新连接及无 key 子进程恢复 |
| P0-08-AC-05 外部 consumer 失败不伪称本地未 commit | 抛错测试回调后仍 COMMITTED，exact-read 对账 MATCHED/MISMATCH |
| P0-08-AC-06 应用用户不跨 Owner DML | 普通应用 SQL 写测试 Owner/候选、调用受信命令均 42501 |

适用入口：`npm.cmd run prototype:db:with -- vnext:p0-08:validate`。
串行执行本票 typecheck、fresh、当前前缀升级/codegen、P0-07 共享绑定回归、
P0-11 保护边界回归、模块边界和 API build；任一子命令失败使总门禁非零。
其余 P0-05/06 未改的领域规则不重演全部历史矩阵，不宣称本轮重新验收。
实际命令、失败/后续 GREEN、receipt、最终同候选 Spec/Standards 审阅和
commit/tree 记录在 ignored `.runtime/vnext/p0-08/`。

源码前缀为 0051；开工实查唯一持久库仍为 0037，`CURRENT_DB_INTEGRATION_PENDING`。
本轮只在 receipt-owned 临时库安装迁移和受信 Owner 角色，并按 receipt 销毁。
持久库升级/角色部署、数据库实际重启、P0-02 浏览器验收均未执行；
`BROWSER_BLOCKED` 保留。完成后仅一个本地提交，不 push，不开始 P0-09。

## PR #10 审阅修正

用户随后单独授权 P0-08 的推送、远端 Codex 审阅、修复、合并和分支清理；持久库
升级/角色部署及 P0-09 仍不在范围。首轮三个反例分别复现后修正，日志保留在
`pr10-r1-*`，不覆盖原本地完成交接或迁移 0049。

0050 在候选上增加 underlying identity/request 的数据库唯一约束，在同根锁内
先恢复已冻结候选。同身份别名、并发及重试返回原 candidate ID/digest；不同输入
使用相同 request 返回 REQUEST_CONFLICT。恢复不隐式重算或替换冻结意图；变更源
需要新请求、新观察和适用批准，原候选 Apply 仍重查当前版本。0049→0050 的升级
保留已有候选字节；若历史上已存在重复身份/request，迁移失败关闭，不删除或
合并历史批准，需独立处置。原 0048→0049 验证日志仍保留。

所有命令在取得数据库连接前检查 Owner 就绪性，未接线的生产 composition 在
0037 或普通应用角色下均返回 BLOCKED_DEPENDENCY。提交前 transport 分类覆盖
本地 pg/pg-pool 的已知无 code 连接终止及 SQLSTATE 08 类；COMMIT 附近的异常
仍单独返回 COMMIT_UNKNOWN，不据此推断回滚。

第二轮补充 0051：批准前必须存在该批准人成功读取当前冻结候选的回执。先提交的
READ_SENSITIVE 是访问尝试；只有解密/验签成功、再次检查当前 READ/REVIEW 后才
记录 READ_READY。回执绑定精确 candidate/digest、actor 与 underlying identity，
批准行通过外键保存所用 audit ID，Apply 再次核对这条原回执。maker 或其他候选
的读取、缺 key 的失败读取、单纯知道 ID/digest 都不能代替批准人自己的审阅。
旧批准的新增外键保持 NULL，不能追加一次事后读取来追认；未提交旧候选需新请求
和适用批准，已提交技术 outcome 仍可按原路径恢复。0050→0051 升级保留原候选
与批准字段，并实测缺回执旧批准继续阻断。
