# P1-02 院区稳定节点与运营状态

基线 `3e4330bf61a5398eb2d4b681cca31e38fb4a7fdd`，用户授权一次 fetch origin main，已核对包含 P1-01 最终审查提交。仅合成本地研发，最终候选与执行结果见 ignored `.runtime/vnext/p1-02/handoff.json`。不 push、不创建 PR、不进入 P1-03。

## 模型及接线

organization-master 唯一写 Owner；新增 campus 子模块及 0057 前向迁移。Campus 是永久物理节点，campus_event 签发流内整体版本；campus_version、campus_plan、campus_operation 分别保存资料、计划和运营断言，campus_code 永久保留代码归属。更名和迁址不生成法人或地点实体。DB生成ID与记录时间，应用角色无直接DML权限；公共 Apply 协调器负责冻结、审阅回执、独立批准、事务提交和恢复。

复用加密输入表、输入 revision、请求绑定和撤回能力，以 ORG01/ORG02 显式区分类型；机构和院区入口在任何写入副作用前执行双向类型校验。输入和候选分别使用带域的认证加密/HMAC，复用已绑定持久库的 provider，不能丢失密钥后生成替代钥匙。

NORTH/SOUTH 只表示现有合成治理范围，精确对象权限独立绑定新院区ID；三个展示节点不映射成三个权限字符串。未来调用方权威收敛归 P1-03。

## 时间与生命周期

手工命令业务时间使用 Asia/Shanghai 本地字符串；保持微秒、半开区间和 null 无界。源 recordedAt 还显式允许 +08:00，原值保留在受保护输入，只有规范化命令去除该偏移；不接受其他偏移或通过 JavaScript Date 转换。

CREATE 产生 PLANNING。REVISE 不变更计划或运营状态。SCHEDULE_OPENING/CANCEL_OPENING 只改变计划；计划到期不会自动启用。ACTIVATE 经过单独审批，可未来生效为 TRIAL_RUNNING/RUNNING，必须覆盖完整资料期间及区划采纳期间。SUSPEND 必须无界，并覆盖起点后的既有启用安排；本票不能再 ACTIVATE 或为相交期间增加计划。停用后资料仍可更正，但不得恢复状态；恢复、永久退出及依赖影响归 P1-07。

资料、计划、状态分别按业务区间及真实记录时间读回；高版本只替换重叠断言。openingDate 表示有证据的实际启用日期，不能为未来日期，计划与实际不自动互填。实际地理真实性、公开电话属性由材料与签审确认，格式校验不能冒称院方真实核验。publicPhone 仅为声明公开的联络号码，不联接Person手机号。

## 17 字段采纳与条件

| ORG02字段 | 采纳位置和验证 |
| --- | --- |
| campus_id | source.alias；平台ID由DB生成，target为独立typed reference |
| campus_code | facts.campusCode及永久campus_code归属；不隐式规范化、停用不释放 |
| campus_name | facts.campusName；资料修订保ID |
| node_role | facts.nodeRole；手工合成契约明确HEADQUARTERS/HIGH_TECH/CITY_CENTER，不推导法人 |
| campus_address | facts.campusAddress；物理院区启用/运行中修订必须有地址 |
| admin_division_code | facts.adminDivision.code，加准确contractId/versionId、codeSystem/version、sourceVersionId |
| operation_status | sourceOperationStatus；与明确命令及当前状态一致，不直接upsert |
| opening_date | facts.openingDate；真实日历、不得未来、未知null |
| public_phone | facts.publicPhone；普通读取保留，审批材料确认公开属性 |
| version_no | source.versionNo；平台整体版本由DB递增 |
| valid_from | 命令validFrom；半开业务起点 |
| valid_to | 命令validTo；null无界且有值须大于起点；停用仅null |
| record_status | source.recordStatus；正式命令要求PUBLISHED |
| source_system_id | source.systemId/versionId；来源资格及完整期间检查 |
| source_record_id | source.recordLocator；受保护定位，不输出普通日志 |
| approval_ref | source.approvalRef；不能替代平台签审，停用仍必填 |
| recorded_at | source.recordedAt原值；平台recorded_at由DB实际产生 |

本票增加计划时点、准确区划引用和受控证据引用等typed扩展；不改源schema、FULL草案或P0-10冻结材料。

SRC-COND-005/006 由手工 Owner 对物理节点和整个实际启用窗口执行地址/区划检查。目录仅允许特定 `ORG02_MANUAL_CORE_V1` 模板采纳这两条已固定源文本的Owner条件声明，代码集必须 SYNTHETIC_ADOPTED。目录端口在同根事务验证准确当前发布版本、成员、来源访问和整个有效期间，并将publication/semantics摘要绑定候选。未知、候选、已退役或期间不足失败关闭。

**这个有限模板不表示通用ORG02文件机器校验就绪。** 通用验证器仍对这些条件返回人工材料门禁/NOT_EVALUATED，ORG02文件adapter仍NOT_READY。手工CORE输入只复用既有材料job/revision作为受保护证据通道；非空未实现LOCATION/CAMPUS_OPERATION引用及FULL保持BLOCKED_DEPENDENCY，不降级。真实行政区划标准和真实医院登记均待院方确认。

非扩张停用/取消计划不重验上游材料或代码集有效性，但必须检查当前权限、整体版本、正式来源意图、非空审批引用和maker-checker。关闭不是绕过治理的任意写入口。

## API与客户端

`/api/vnext/campuses`：inputs、plan、review、approve、apply、resume、withdraw；query支持当前或指定B/R；list按授权过滤且分页上限100；versions/query取准确资料版本；history分别返回资料/计划/状态；diff比较资料及业务期间；restricted-input单独授权并审计。

所有请求响应为closed TypeBox。身份来自composition可信actor resolver，当前本机演示使用既有合成header解析器，不代表生产认证。普通响应保留所有资料字段，来源定位、审批材料原文只在受限输入。自身operationStatus与固定operatingPermission=NOT_EVALUABLE同时表达，不能冒充P1-04运营许可。

OpenAPI与generated-api-client同步，公开createCampusClient的typed调用方法；真实HTTP测试使用该客户端。缺Owner、密钥或材料失败关闭。代码冲突候选保留带digest的blocker，但不能批准/应用。同请求重放返回原事实，换载荷冲突；提交后恢复只依赖当前READ，不重验旧材料资格。

## 验收、部署与证据

入口：vnext:p1-02:unit、vnext:p1-02:typecheck、vnext:p1-02:validate；DB均通过prototype:db:with wrapper。validate支持fresh及 --upgrade（0056创建真实机构事实→0057核验保留）；--generate仅用于受控数据库类型生成。前缀/权限/审计回滚/并发测试在receipt-owned临时库，结束删除本次库与临时角色。

vnext:p1-02:deploy 仅接受已观察0056持久前缀，先记录既有业务表内容摘要，迁移账本单独核对旧前缀不变及准确追加0057，迁移后比较原字段内容（input新增domain不算旧事实变化），再授权及HTTP创建本部/高新/中心三个DEMO节点，执行更名/迁址/计划/预约启用/停用/旧R回读。断言OID与密钥文件不变、机构数量未增加。迁移核验成功后写入OID/requestId/ledger/密钥摘要绑定的检查点，后续HTTP步骤失败可用 --resume 在0057继续；没有有效检查点则阻断，不能伪造迁移前保留证据。失败保留现场，不能重建持久库。

| 验收 | 对应场景 |
| --- | --- |
| AC01 | 创建/更名保持ID，准确版本与历史 |
| AC02 | 迁址不新增机构，运行中地址更正重验 |
| AC03 | 计划不启动；预约启用微秒边界和提前停用覆盖 |
| AC04 | 停用后不可恢复/复用ID，旧业务代码仍保留归属 |
| AC05 | null不通配；空地址/区划、错误引用和资料窗口缺口阻断 |
| 公共治理 | 别名自审、撤权、错误scope、输入双向隔离、候选撤回、代码并发、审计回滚、直接DML、ACK恢复 |
| 依赖与来源 | 来源时间原值、FULL不降级、区划退役后批准失效、非扩张路径、开业实际日期 |

证据日志保留 `.runtime/vnext/p1-02-*.log`，早期receipt白名单错误为工具接线失败，不算领域RED；无Owner能力、缺计划写入、空地址错误获批、类型串用、期间差异遗漏及偏移输入不支持均保留各自RED/GREEN。差异字段无顺序约定，测试修正为集合顺序比较；全控制面boot超时改为只启动相关路由，未增加超时。

A011仅覆盖三个服务节点及不推导法人，运营关系部分留给P1-04/P1-07。UI、实际服务重启、正式验收为NOT_RUN；本票不取消历史验收边界。完成须以持久部署结果和同候选Spec/Standards复审为准，不把单元测试或HTTP等同浏览器或生产就绪。

## 2eaea4f 后续 TDD 修复

0058 在SQL分页前按固定记录时点筛选已知院区身份；list整页共用同一B/R时点，查询未来业务状态仍可展示当前已知的筹建节点。函数替换保留已有服务角色EXECUTE权限，旧三参调用以默认当前R兼容。既有0057不修改。validate增加 --upgrade-57，验证旧数据和现有角色权限保留。

cleanup从经过验证的规范receipt身份定位disposed文件，不依赖命令行扩展名大小写。已有凭证须匹配name/OID/disposed，且原OID数据库确已不存在才能报告重复清理成功。真实CLI回归覆盖大写路径、重复调用和错误OID凭证；测试只操作本次receipt-owned临时库。

初次部署入口同步至已审查的0058链（允许从56部署）；57或58的恢复请求按原检查点账本前缀验证，并再次检查新增迁移不改业务数据。已完成0057交付的库使用只读冒烟修复入口 vnext:p1-02:fix-deploy（经prototype:db:with）；只接受57/58，验证旧表内容和旧账本前缀不变，以现有服务角色完成真实HTTP历史列表读取，不新增业务记录。最终修复证据见ignored修复handoff。

## PR #14 第一轮远程审查修复

0059 前向迁移在 legacy organization write/plan/withdraw SQL 入口的任何副作用前固定 ORG01 域检查；院区使用显式 ORG02 的受控 plan/withdraw 入口。新增入口继承既有服务角色 EXECUTE ACL，不扩大表写权限。

ORG02_MANUAL_CORE_V1 发布必须同时声明 SRC-COND-005/campus_address 与 SRC-COND-006/admin_division_code，并绑定相应 EVALUATED 字段。区划准入重新检查该完整声明；旧的不完整发布记录保留历史，但不能支持新的扩张准入，需另行签审完整后继版本。

运营空档返回 NOT_ESTABLISHED，资料修订及计划命令不能以 PLANNING 冒充；运营状态按自身 B/R 断言读取，不依赖资料是否存在，故资料到期后的有效停用仍可见。

四个问题分别保留公共 SQL/Owner/HTTP 的 RED→GREEN 证据。validate --upgrade-58 覆盖旧不完整契约升级后阻断、旧发布历史保留、旧服务权限及业务内容保留。当前完整链为0059；初次部署入口同步至0059，恢复接受57/58/59并核验既有检查点。已部署58使用 vnext:p1-02:review-deploy，经 receipt wrapper 执行；只接受58/59，核对OID、旧账本与业务摘要，以既有服务角色进行真实HTTP只读冒烟，不重写历史契约或新增业务记录。旧 fix-deploy 仍限定其0058历史修复链。

## PR #14 第二轮远程审查修复

0060 关闭旧 campus_write 三参数入口，新 campus_write_approved 只接受受信任协调器的事务票据。票据完整绑定执行人、输入、准确命令、候选ID/摘要和数据库事务ID；协调器完成当前双方权限、准确审批、输入revision、证据与依赖重检后才交给Owner签发。SQL再次检查候选与输入、独立审批、当前权限和revision。HMAC-SHA256使用现有lookup密钥按独立域派生的32字节权威密钥；SQL采用RFC2104的固定32字节key计算，与Node标准createHmac互验，不新增扩展。服务数据库账号不能读取、修改或初始化该密钥，也没有签名接口。票据跨事务无效，改变命令或actor也不能复用。已有提交恢复保持原outcome路径。

密钥仅由receipt绑定管理流程初始化，已有值不匹配则失败，不覆盖；敏感初始化同时抑制服务端语句/错误/耗时/采样日志和本地stderr。原有密钥文件不变。初次部署入口同步到0060；已完成0059的库使用 vnext:p1-02:approved-deploy（经wrapper），检查OID/旧账本/业务内容后初始化权威，使用既有服务角色完成真实HTTP候选、独立签审、写入、读取和同请求重放，仅新增一个明确DEMO节点。旧review-deploy保持0059历史边界。

validate --upgrade-59 验证真实机构前缀事实保留和新SQL边界；服务角色反例包括无审批旧入口、伪造票据、密钥越权读取、票据篡改及跨事务重放。公开HTTP契约未变，数据库类型与新增权威表同步。

## PR #14 第三轮远程审查修复

任何已记录的 SUSPEND（包括未来生效的停用）都会阻断后续 ACTIVATE，不能通过补录在停用起点之前结束的启用区间绕过终态；计划仍仅在与停用期间相交时阻断。Owner与0061 SQL前向迁移分别落实此规则，不修改0057/0060。两个公共边界均先复现RED，再验证GREEN；SQL反例由隔离测试中的受信任签名器推进expected head，以独立于协调器的stale检查验证数据库生命周期约束。

validate --upgrade-60 核验现有前缀事实保留。已部署0060的持久库使用 vnext:p1-02:suspension-deploy（经wrapper），只接受60/61，保持OID、旧账本、业务数据及密钥权威不变，并以原服务权限验证真实HTTP读取；不新增业务记录。初次部署入口同步0061。
