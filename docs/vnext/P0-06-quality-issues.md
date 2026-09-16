# P0-06 质量事项账本

本票在 `governance-catalog` 内追加质量事项 Owner，串联已验签校验运行、问题摄取、责任分派、完整文件纠正、后继修订重验和有证据的局部解决。范围不包含业务 Apply、工单平台、完整页面、ORG/PER 业务实例或 P0-07。

## 设计摘要

- `0038_quality_issue_ledger.sql` 只追加 `quality_issue` 与 `issue_disposition` 两张表，并在 `import_job` 上追加处置流水位。问题来源不可变；处置只追加。job/revision/run 使用复合外键绑定，应用角色只有有限 Owner 函数权限，表启用 RLS。
- `quality_issue` 只保存 dataset、CSV/JSON/XLSX 定位、row/field/rule、稳定 bounded code、来源状态、分类、责任引用和受限 related refs；不保存原值、业务键文本或 quarantine payload。
- 问题来源同时冻结 `campus/purpose`，分派要求已发布责任目录的 dataset、院区 authorityScope 和 purpose 对应 fieldGroup 均匹配；摄取候选集合由 `quality_candidate_digest` 绑定到新校验运行签名，旧运行没有该摘要时不能作为新的问题摄取或解决证据。资格读取另使用覆盖候选、NOT_RUN 层和权限维度的 `quality_eligibility_digest`。
- `issue_disposition` 记录 `ASSIGN`、`CORRECTION_PROPOSED`、`RESOLVED`、`BATCH_REJECTED`。DB 生成 identity，job 内 `quality_disposition_sequence` 作为并发 head；`quality_issue.issue_sequence` 作为 job 内问题来源流顺序；状态由历史事件计算。
- `openIssue` 通过 `createValidationEvidenceReader` 在同一根事务内读取并验证 run HMAC、ERROR_REPORT 和 parse provenance，只摄取 `FAIL`、`UNKNOWN`、`NOT_EVALUATED` 的真实阻断项；PASS、exact duplicates 和 L8–L10 `NOT_RUN` 不展开为逐行问题，L6 缺 Owner 生成一项 job-level dependency blocker。人工 evidence requirement 与对应 rule result 合并；数据库 Owner 还校验候选摘要，拒绝客户端伪造候选。
- `proposeCorrection` 接受完整文件，使用内部事务 seam 将 `receiveFile(REVISE)`、受限 RAW_FILE 和纠正关联同根提交；后续 parse/validate 独立执行。文件意图由 provider HMAC 绑定，不记录原值或普通摘要。
- `resolveWithEvidence` 只按冻结业务键完整文本元组精确匹配，拒绝 trim、姓名匹配、缺键、重复键、改键和候选行冒充身份；新 run 必须是同 job 当前后继 FILE revision、契约/rule/parser policy 兼容，并在 `RULE_EXECUTION_V1` 中对目标 rule/field/row 具有 PASS。
- `rejectBatch` 将 job 置为 `REJECTED`，禁止新 revision、parse 和 validate；历史读取、已提交请求的安全 replay 与 P0-11 清理边界保留。
- 跨 Owner 的根事务只通过内部 `CatalogTransactionScope` 传递；组合根持有具体 Kysely transaction，质量/文件/验签 seam 不暴露 raw Kysely。

## 公共 typed API

`openCatalog()` 暴露：`openIssue`、`assignIssue`、`proposeCorrection`、`resolveWithEvidence`、`rejectBatch`、`qualityIssueRead`、`qualityIssueDetail`、`qualityEligibilityRead`。所有输入为 TypeBox closed schema；不接受 client decision、severity override、自由 JSON 或原值。

`proposeCorrection` 的 `requestId` 是质量关联请求，`receiveRequestId` 是其内部文件接收幂等身份；两者均受 closed schema 约束。完整文件通过 bytes 参数接收，格式、parser policy、retention 和 scope/campus/purpose 显式冻结。

## IMP016 覆盖

IMP016 要求错误报告能够以 `dataset/row/field/rule/code` 定位，而不是只给自由文本。本票的 `quality_issue` 保留 `dataset_code`、`row_number`、`field_code`、`rule_code`、`bounded_code`，并保留来源状态与 layer；普通台账不保存 sourceText 或原始行。`quality.test.ts` 验证 PASS 不摄取、人工要求合并、L6 分类和 L8–L10 不展开；Owner 测试验证 ERROR、REVIEW、dependency、跨 run 独立和敏感值不泄露。

## 验证索引

完整证据保存在 ignored `.runtime/vnext/p0-06/`。本票聚合命令：

```text
npm.cmd run prototype:db:with -- vnext:p0-06:validate
```

该命令实际包含 P0-06 fresh/upgrade（含 types generate/verify）、P0-03 job fresh、P0-04 file、P0-05 validation、P0-11 protected regression、unit/typecheck、module-boundary 和 governance-api build。最终运行 fresh/upgrade 均为 7/7；所有变更数据库均为 P0-06/P0-03/P0-04/P0-05/P0-11 receipt-owned 临时库；当前持久 vNext 库本轮只执行 `vnext:db:inspect`，保持 37 项迁移，未安装 0038。

## 最终只读复审

以 `3318a2e3aa54e47c70a1a9009e5f9635e3caf566` 为固定基线的 Standards/Spec 双轴复审均无当前 actionable findings；复审代理未执行数据库或网络操作。详细记录见 ignored evidence `03-review.md`。

P0-02 `BROWSER_BLOCKED`、P0 `IN_PROGRESS`、生产 Apply、实际重启/UI/生产扫描仍是本票外或明确 NOT_RUN 项。

## PR #8 第一轮修复

0039 前向修复两项远端 P1，0038 保持原 checksum。运行新增 quality_resolution_digest，HMAC 同时覆盖该摘要；内部证明只包含 job/contract 域分离的 keyed 行键和真实执行 PASS 定位，不向公共读取返回。SQL resolve 对指定运行的证明摘要、唯一键对应、后继修订、相同规则/解析/解释策略和目标 PASS 独立检查，并在请求重放之前重查当前作业、契约及受限 READ 权限。

该机制沿用 P0-05 已声明的同 provider 可信 Owner 边界：SQL 参数和签名本身不是独立认证，应用角色任意伪造的无效签名运行仍不能通过 Owner 验签。未引入数据库密钥托管。0038-only 历史运行缺少新证明时，继续解释/安全重放，但不能作为自动解决所需的完整证据；不补写历史签名。当前持久库仍为37，无0038质量事项需要迁移认证。

拒绝批次的 file guard 移至既有授权和请求重放之后；解析复用原受限 STORE 幂等，在拒绝后允许已提交输出重放、禁止新输出和新 parse provenance。真实反例包括app-role直接伪造解决、篡改证明、错误目标行/字段、撤READ后的首次调用与成功请求重放，以及拒绝后文件/解析重放。最初3项反例实测失败；首版修复的SQL同名变量错误单独保留，未计为通过。

本轮聚合回归通过；最终权限修复后补跑fresh和38前缀升级。证据见ignored `pr8-r1-*.log`及PR handoff。独立Spec/Standards只读复审与远端Codex review分别记录，不互相替代。

## PR #8 第二轮修复与校验连接边界

0040 撤销 PUBLIC/hdi_prototype 对全部 accept_validation 重载的执行权。仅持有 provider 的受信校验 Owner 进程使用独立、最小权限的数据库连接调用该入口；整个文件/校验/质量事务继续使用同一个 pool 和根事务，不在事务中切换连接。普通应用连接的新校验返回 VALIDATION_OWNER_REQUIRED，既有已提交运行仍按当前授权和 HMAC 安全重放。

当前 typed 接入方式仍为 `openCatalog(trustedOwnerConnection, provider)`。受信登录主体不得是管理员、数据库/schema/table Owner，不得给普通应用角色授予该主体的成员资格；它只需要既有受限函数和必要元数据 SELECT，以及 accept_validation 的执行权。持久库安装时必须由整合会话明确配置这一连接和凭据，不能回退到管理员或把权限重新授给普通应用角色。本轮没有创建持久角色、没有安装持久库迁移。

P0-05/P0-06 测试 runner 使用仅限 TEMPORARY_VALIDATION 的 validation-owner-session：随机角色、独立密码、无继承/成员关系/高权限，核验同库OID/端口。密码仅经stdin配置并在进程环境传递，不写receipt或日志；provider密钥仍不入库。先落独占intent，事务创建NOLOGIN角色并取OID，落ownership后才启用登录。失败携带无敏感内容的精确恢复身份；数据库清理后核对role OID、属性、会话及成员关系再删除，不做跨库DROP OWNED。`--owner-failure-probe` 已实测创建后receipt写入前失败的清理路径。

SRC-COND-061 对已知 HUMAN/SERVICE 结果记录条件规则自身的PASS覆盖，条件为真时缺值仍有独立REQUIRED错误；不会将整体run改成PASS。责任分派用现有definition_spans在同一R下选择当前B有效的已发布版本，不被后续DRAFT/SUBMIT遮蔽，未生效或退休仍不可分派。

第二轮证据索引为ignored `pr8-r2-*.log`及PR handoff；首次权限反例遇到原制品唯一约束，后续改用独立错误制品明确验证应用角色权限拒绝。历史失败保留，不改写为通过。

## PR #8 第三轮修复

0041 允许校验已确认的exact duplicates参与跨修订纠正：TypeScript按已验签duplicates排除后续副本；SQL复用原proof中BUSINESS_KEY的PASS覆盖，要求同键组每行都通过判重并限定首行为代表。任一冲突同键行仍使整组UNMATCHED，不修改旧proof、digest或签名。

resolveWithEvidence明确检查调用方newRevisionId等于新run实际revision，不静默覆盖错误引用。openIssue先调用有限的quality_issue_open_prior：重查当前主体、job与精确目的/范围READ，从不可变事项按issue_sequence重建原candidates并比对原request digest。已提交请求在payload过期、purge或provider不可用后可返回原技术结果；新请求仍需有效证据，不恢复原值。原SQL ingest replay也进入相同权限检查。

第三轮四条反例实际失败后，fresh 13/13、40→41升级13/13通过；升级含新增SQL直接调用的冲突/非代表行拒绝，以及purge后无provider重放。首次fresh因迁移换行文本匹配失败退出，单独保留；后续未改写历史迁移。两轴只读复审无新增actionable finding，命令索引见ignored pr8-r3日志与handoff。

## PR #8 第四轮修复

0042 将接收后关联的 quality_issue_record_correction 限制到受信 Owner，并核对 RAW_FILE 的 receiveRequestId、format、parserPolicy。现有 Owner 的授权由迁移依据 accept_validation ACL补齐，包括后续新增的有限 prior 接口；runner 中的手工升级 grant 已删除。临时设施创建新 Owner 时只补齐同一有限能力，不将内部入口重新授给普通应用角色。

纠正入口在任何异步等待前复制字节，摘要与接收使用同一副本，结束后清零。首次和重放统一返回持久化 receipt（jobId/issueId/head/eventId/kind/revisionId/artifactId/storageStatus），移除仅首次存在的 received 嵌套值；当前调用方已更新。纠正新请求及重放检查精确契约 WRITE、目的/院区 STORE。

新增 resolution prior 使用新处置中冻结的公共技术请求摘要，先重查当前权限再恢复已提交结果，不要求当前修订仍等于目标修订，也不读取过期材料。旧处置没有该摘要时不回填；仍需可用的原证据和原 outcome 摘要核验，材料丢失不伪造恢复。

摄取与分派补齐精确对象 WRITE，分派重放还检查当前 job/责任读取权限。停止批次只依赖当前主体、本 job 提交身份和本地 dataset WRITE，不因上游 source/parameter 读取权限失效而无法停止。

19项Owner测试覆盖本轮权限、重放、缓冲区变更、响应一致性及停止边界。新增twoTextFields fixture仅选择R/O的真实源文本字段，避免把未实现人工条件作为安全测试前提；没有放宽契约门禁。证据见ignored pr8-r4日志与handoff，历史失败原样保留。

## PR #8 第五轮修复

纠正命令的内部文件接收 reason 固定为 QUALITY_CORRECTION，符合既有 ImportJob 的 A–Z/下划线语法。公共 reason 仍保存在质量请求摘要和处置事件中；FIX_1 等带数字原因可正常纠正，相同请求重放保持一致，改成 FIX_2 仍冲突。旧已提交请求在进入文件接收前重放，不改历史记录。本轮无DDL变化。

## PR #8 第六轮修复

0043 对问题列表的总数与分页使用相同的campus/purpose精确过滤，保留原身份、job READ及稳定顺序。混合维度不再使整个job无法列出问题；其他维度的行和计数不会进入当前页。回归覆盖三个合法维度、每页一项、尾页、空交叉维度和runId一致性。

## PR #8 第七轮修复

0044 将列表/详情的 issue sequence 及处置历史 head 以十进制字符串输出，遵循 ADR-0073 的无损 int8 边界；SQL 排序仍使用 bigint。typed API 同步为字符串。受控测试将新作业流水位设在 JavaScript 安全整数上限之外，验证连续序号、详情、历史和命令 head 均不舍入；不改写既有事项或处置。
