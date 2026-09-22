# P1-03 院区引用权威收敛

基线ef2573f，P1-02已合并。按用户确认计划实施；不新增DDL，当前链0061。只用唯一receipt库或本次owned临时库。NORTH/SOUTH仍为治理范围；ORG02的17字段责任不变，本票新增源字段0。

## 接口与不变量

从organization-master公共入口提供只读CampusReferencePort。resolve批量输入typed stable refs和可选B/R；pin输入owner/id/资料版本序号/版本UUID（不能冒用整体head）；coverage输入stable refs、完整业务期间和可选R。每批最多100，空批items=[]，输入顺序保持；同一stable ID重复即CAMPUS_REFERENCE_CONFLICT。返回共同observedAt/asOf，resolve还返回businessAt。已知身份但资料空档保留null资料及独立运营状态；在R尚不可见的身份返回NOT_FOUND。pin固定资料事实，不制造复合快照、审批或新版本表。

同一读取核心服务当前普通query/list/version/history/diff及引用接口；HTTP与进程内消费不查询旧表。每次读取重查当前权限，混合越权批次整体拒绝；inTransaction绑定已有CatalogTransactionScope，使用相同授权/写入序列锁，不另开连接。没有业务缓存，旧pin是历史证据而不是当前资格。coverage只证明资料覆盖，含分段与缺口；不判断运行许可或通用扩张资格，后票必须在自己事务中重查。FULL及未实现关系继续BLOCKED_DEPENDENCY。

## 调用方与边界

机器清单见tooling/vnext/p1-03-call-sites.json。当前HTTP读取、generated client、workbench composition与P1-02/03验证都经Owner的references只读面。旧platform.campus reader及Price/Department composition保留源码，但不在vNext运行链；依赖图检查禁止从当前入口重新导入这些权威。现有部署脚本走HTTP，无额外FK需迁移，不双写旧表。

## 验证与交付

公开Owner、真实HTTP、实际数据库角色是已确认TDD边界。AC01由调用方依赖门禁及HTTP验证，AC02由直接DML拒绝，AC03由生成类型/客户端/仅receipt连接验证，AC04由改名后的旧pin/当前读取/撤权复读，AC05由重复及跨版本重复输入断言。B/R、半开区间、微秒、无界/缺口及资料/状态分离需专项验证。

每次DB成功需wrapper READY、目标exit0、cleanupPassed=true；无DDL故升级门禁NOT_APPLICABLE，临时库完整链用于隔离DOMAIN测试。持久验证仅HTTP读取，OID/账本/业务内容/签名权威保持不变。UI、实际重启及正式验收NOT_RUN；A012仅当前真实消费者，旧Price/Department不冒报回归。最终Spec/Standards独立审阅及commit/tree、命令证据另存ignored handoff，不push、不创建PR、不进入P1-04。

## 实测结果与限制

DOMAIN 15/15、P1-02回归36/36、unit2/2通过；typecheck、API/generated-client build、模块边界与重复codegen一致通过。持久库4个已有DEMO节点的生成客户端真实HTTP读取通过，OID206108及0061账本、业务与签名权威内容保持不变。详细命令、RED/GREEN、receipt和最终审阅tree见.runtime/vnext/p1-03/handoff.json。

依赖门禁遍历当前入口可达的相对导入、re-export和字面量动态导入；明确拒绝绝对/file:导入、未知动态/alias及旧platform.campus字面量。已有parser按固定TS/JS后缀加载同一local-datetime原语的路径被精确识别，两分支均检查。此门禁验证当前源码依赖，不代替生产认证或任意程序的安全证明。

pin结果reference仅含owner/id/version/versionId，可直接再次传入pin接口；期间与recordedAt是结果的旁列事实。resolve返回profileVersion可空；资料空档不伪造版本。coverage中的segments.from/to是对请求窗口裁剪后的有效分段，其profileVersion可交pin读取原始不可变期间。
