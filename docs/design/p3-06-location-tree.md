# P3-06 空间地点树

## 授权范围与基线

用户批准的 P3-06 计划是本票规格。基线为
`a035d8451340e61092ff945d14ed7e3d77da140a`，源迁移前缀 0148。
前置院区能力已合入；一个 receipt-bound HDIP-MC-VNEXT 持久研发库，
owned 临时库只作验证。本票没有旧库、旧收费 SDK 或真实生产数据前提。

## 用户可调用的闭环

`location-master` 唯一入口暴露 stage/receiveFile/readInput、独立 verify、
preview/plan/review/approve/apply、resume/reconcile、query/list/tree、
history/exact/diff/coverage 和 readChange。实际 Fastify 路由统一位于
`/api/vnext/locations/`，生成客户端为 `createLocationClient`。
工作台实际启动负责装配 Owner、检查服务授权并关闭数据库池。

封闭命令 CREATE/REVISE/MOVE_CONTAINMENT/CLOSE/SPLIT 表达领域意图。
CREATE 没有 target 字段，不能指定新 UUID；既有 target 必须带 Owner、
ID 和 expectedVersion。REVISE 没有 parent 字段，移动用专用命令。
文件行保留全部 ORG12 18 字段，另有与行准确对应的封闭操作封装；SPLIT
通过 typed input 明确后继和证据。CSV/JSON/XLSX 不自动猜操作、丢字段、
按名字匹配或将缺行当删除。

ORG12_CORE_V1 与 ORG12-FULL 分开。FULL 仍受 P3-07/P3-11 约束；
CORE 仍保留全部字段。CAMPUS 类型在合成采纳版本显式增加，原来源副本
不改。STRICT_LOCATION_V1 重用文件防护：未知列、重复键、宏、公式、
外链、隐藏内容、非法时间和丢失前导零均不被猜测修复。

## 身份、事实与证据

- location 保存 DB 生成身份及固定院区；code 永久占用院区内代码。
- version 保存不可变属性、父引用、B/R、流内序号、原因和操作根引用。
- change 保存单原子单元所有实际 ID/版本及拆分前后关联；新版本与操作根
  通过同一事务及延迟 FK 共同创建，无可修改正式草稿。
- input/verification 只保存认证加密的完整源输入与核验。来源定位在版本中
  是 inputId/row 的证据指针，原定位文本不写普通审计或公共版本事实。
- 公共 apply_candidate/apply_approval/outcome/audit 继续是审批与结果权威。
  不能通过上传 ACTIVE 或填写 approval_ref 取得本平台授权。
- apply_binding 在公共 FREEZE 的同一根事务绑定完整写入的语义摘要；
  SQL 在生成任何地点 ID 前比对冻结内容。原文件和解析共用首个 await 前
  保存的私有字节快照，读取保护输入和冻结候选仍重查当前依赖授权。

SOURCE_PLUS08_TO_LOCAL 只有准确发布契约声明 LOCATION_SOURCE_PLUS08_V1
规则时可执行；只接受 +08:00，原值在保护输入内保留。平台自己的 API
时间始终无偏移，微秒不经 JavaScript Date。recorded_at 是来源证据，
目标 R 与序号由数据库生成。

## 准入、时间与事务

每个相关 B 边界都验证整个院区最终树。根只能是 CAMPUS；其下是
BUILDING → FLOOR → ROOM/CLINIC_ROOM/OPERATING_ROOM/WAREHOUSE。
窗口可以位于楼层或房间类内。非根必须有完整父链覆盖；OTHER 阻断。
SRC-COND-017/018 为机器规则，楼层内地点必须有楼层标识，指定房间类
必须有房间号。编号可变，代码永久归属，名称不产生身份。

普通资料和关系是局部覆盖；CLOSE 永久遮蔽其业务边界之后的所有开放
断言。关闭可以先于已安排的未来修订，但只能在原有效期间内缩短或确认
终点。非叶子关闭须同批明确迁出/关闭后代，包含未来后代；没有隐式级联。
SPLIT 在共同边界关闭旧房间并新建至少两个同院区、同楼层身份，保留关联。
拆分关联同时记录业务边界有效前驱版本和审批时的 head 版本；未来迁层
不会改变较早拆分所用的楼层。REVISE 不能借资料覆盖抹除既有迁层片段。

新增/扩张用事务内 Campus port 核验完整资料覆盖及永久退出边界。
PLANNING/SUSPENDED 不自动阻断物理资料；Location 不证明临床许可。
关闭不重复上游准入，却仍需当前权限和 maker-checker。

一个 revision 一个完整原子单元，最多 100 个展开命令，沿用公共 512 KiB
候选预算。全批预验，批准冻结输入、契约、规则、核验、头版本、依赖和
差异。批准和应用重算，变化返回 STALE_VALIDATION。SQL 使用受限函数、
事务签名、当前权限及独立最终图 oracle；应用角色无直接领域表权限。
任何失败零正式事实，保留保护输入和问题。ACK 不明使用 COMMIT_UNKNOWN
与原 outcome，不再次生成身份。

## 验证及交接

测试面经用户批准：公开 Owner、生成客户端真实 loopback HTTP、真实限制
角色的受控 SQL。五项 AC 对应图拒绝、历史、拆分、新建不调用地理服务、
全批先验证。补充覆盖分段期间、终态、代码归属、scope、同人别名、撤权、
并发、文件保护、幂等及升级保全。

命令：vnext:p3-06:unit/typecheck/validate/upgrade/deploy。
数据库入口统一为 `npm.cmd run prototype:db:with -- <script>`；仅有
READY、target exit 0 与 cleanupPassed=true 才记本地成功。DDL 检查 fresh、
0148 前驱升级及 codegen；同时校验当前 OpenAPI/client、模块边界和构建。
具体运行、原 RED、后续 GREEN、review tree 与最终 commit 见 ignored 的
`.runtime/vnext/p3-06/` 交接索引，不以设计文字预填执行结果。

Q10 只覆盖空间树与组织/资源分离；床位、现场盘点、组织使用地点、跨域
搬迁、维护页和真实医院政策留后票。正式医院验收及未执行的浏览器/完整
重启保持 NOT_RUN；旧浏览器待验不因本票自动消失。默认 local-only，
不 fetch/push/PR，交付一个本地完成 commit 后停止。
