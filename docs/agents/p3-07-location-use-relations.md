# P3-07 地点使用关系与用途字典操作手册

本手册描述合成 CORE 的操作和验证条件。业务规格见
`.scratch/p3-07-location-use-relations/spec.md`、`CONTEXT.md` 和 ADR0143。
基线为 `cb7cbfecf692bdfbac8f017bd570ac1b31256123`，原迁移前缀为0200；
本票只追加迁移，旧字节、事实、原结果、密钥和账本必须保留。
实际通过状态以 `.runtime/vnext/p3-07/` 的当前候选证据为准。

## 字典维护与关系发布

工作台入口 `/admin/vnext/location-usage-types`。选择当前身份后，新用途以稳定编码、
名称、含义、说明、期间和准确来源/材料申请。独立身份打开经过认证的材料，核验含义，
再审批内容。改名保留用途身份、编码和含义；改变含义须创建新条目。用途版本是保留原
起点的完整声明，最新已批准有限版本结束后不会回退旧开放版本。

启用/停用需要当前人类维护权限、期待头和理由，使用数据库实际时间，没有独立审批
步骤。操作无法发布草稿或夹带内容修改。响应丢失时使用页面保存的原请求恢复；改载荷
必须用新请求。身份切换后旧身份响应不得更新当前界面。内容历史与启停历史可查询。

历史查询可指定业务时点B和记录时点R，页面将这种查询作为只读视图。内容按R选择完整
版本，适用期间仍明确返回；`enabled` 是该B/R下的启停状态，`applicableAtBusinessTime`
表示显式B是否处于该内容期间，未指定B时为null。它们不代替完整窗口的来源及其他依赖
准入核验。当前维护省略B/R，命令仍使用当前权限和数据库实际时间。

关系接口 `/api/vnext/location-uses/*` 接收准确的组织、院区、地点和用途身份。
组织目标限 ORG/UNIT/WARD/NURSING；所在地不会创建或修改组织归属。
CREATE 建立稳定身份，REVISE 追加同一固定元组/起点的完整声明；END 永久释放。
地点或用途变更使用同一单元 END+CREATE。原子单元最多100条，一条失败整单元回滚。
尚未开始的关系可在开始日前取消，取消后不再占用其计划期间。文件 END 保留源行的
原声明期间，以闭合操作中的 `endAt` 指定释放边界；源行期间与释放命令分别保留。
独占与任何相交声明冲突，跨用途也适用；共享每条独立核验 WHOLE_LOCATION_V1 策略。
主要地点按组织类型/ID、院区和用途稳定ID核对，改名不能绕开约束。

停用用途或上游退出形成当前准入缺口，已有声明仍保留独占/主要地点占位。重新启用
重新评价依赖；既往停用区间保留。纯期间收缩和END保留原接受依据，仍要求当前权限、
期待版本、理由和独立审批。查询分别呈现原接受依据、当前复核与完整窗口缺口。

ORG13 使用独立 ORG13_CORE_V1 / STRICT_LOCATION_USE_V1。保留原文件、15字段、原词元、
物理行号与转换依据。用途是准确稳定编码，不接受名称或模糊匹配。JSON要求原生数字
版号和null结束边界；CSV/XLSX文本版号及空结束仅按准确已发布转换规则处理。
明确已发布契约声明时才接受源+08:00转换，其他偏移拒绝。
本票HTTP整数字段在解码时核对原数字词元的数学值和安全整数范围；`1.0`、`1e0`
可表示整数1，高精度小数不能通过舍入变成版号。数字词元上限8192字符，字段自己的
版号或条数上限仍独立检查。此校验只在本票HTTP入口启用。

## 验证入口

在仓库根目录核对分支、基线、工作区和可写范围，保留无关附件与ignored证据。
数据库操作必须遵循 [Prototype PostgreSQL](prototype-database.md)，独占使用wrapper，
完成一轮资源清理后再开始下一轮。

| 命令 | 验证内容 |
| --- | --- |
| `npm.cmd run vnext:p3-07:unit` | 期间规则、CORE选择、严格HTTP输入等无数据库检查。 |
| `npm.cmd run vnext:p3-07:typecheck` | 本票Owner、客户端、页面和验证代码类型检查。 |
| `npm.cmd run prototype:db:with -- vnext:p3-07:validate --generate` | 自有fresh库完整迁移、DB类型生成、Owner/HTTP/受限SQL专项矩阵。 |
| `npm.cmd run prototype:db:with -- vnext:p3-07:upgrade` | 准确基线归档的原Owner建立真实0200旧事实，再前向升级、核对行及重复数量、列、账本、密钥、历史和原结果。 |
| `npm.cmd run prototype:db:with -- vnext:p3-07:regression` | 顺序执行脚本内完整受影响检查，保留逐项原始结果。 |
| `npm.cmd run prototype:db:with -- vnext:p3-07:browser` | 提供自有真实库/工作台，由实际浏览器完成字典流程及两个视口验收。READY不是浏览器通过。 |
| `npm.cmd run prototype:db:with -- vnext:p3-07:deploy` | 最终候选通过后，唯一保留库前向升级、保全与真实启动/生成客户端HTTP。 |

数据库通过同时要求 DATABASE_SESSION_READY、目标退出码0、最终
DATABASE_SESSION_CLOSED 的 cleanupPassed=true。环境安装失败不计领域RED。
原FAIL与后续GREEN分别保存，不覆盖旧记录。回归 `--from <脚本>` 会记 omittedChecks
和PARTIAL_PASS，不能声称完整回归通过。另执行官方契约生成/核对、模块边界、vNext
数据库权威/时间类型、根类型检查及五个工作区构建。

## 保留库与恢复

仅部署 `.runtime/vnext/creation.json` 中的 `hdi_mc_vnext_a7049c9e5c2a4364`，
OID206108、HDIP-MC-VNEXT谱系及0200正确校验和前缀必须先现场核对。
复用原Owner角色和密钥；部署前快照需保存全部旧行哈希及重复数量、列、账本和密钥摘要。
部署后新增事实允许追加，旧事实不得丢失。新迁移在实际保留库安装后不得改字节；
后续修复继续追加迁移。

中断后的临时资源仅依据本次P3-07自有receipt恢复处置，使用
`vnext:p3-07:validate --dispose .runtime/vnext/fresh/hdi_mc_vnext_<16hex>.json`
的同一wrapper入口。处置器核对准确库/角色/OID/密钥归属，不终止无关会话，不操作保留库。
连接信息和密钥保留在原受保护或ignored存储中，交接中只记摘要和证据位置。

医院政策NOT_ADOPTED、临床NOT_READY、ORG13-FULL BLOCKED_DEPENDENCY。
组织空间整页、完整服务重启、容量和正式医院验收NOT_RUN；P3-10/P3-11不在本票。
完成本地提交和ignored交接后停止，不push、不创建PR、不合并。
