# 目标领域结构与字段分流

## 一个医院治理边界，多层不同身份
医院本部、高新医院、成都市中心医院是本轮三服务节点范围。不得仅从名称推导三个法人，实际机构主体、注册许可与运营关系由院办确认。不同主体/院区可有多个独立运营关系，但每条关系必须有类型、业务期间、依据和明确 Owner。

```text
OrganizationSubject ── OperationRelation ── Campus
Department ── CampusBusinessUnit ── LocationUsage ── Location
Department ── HierarchyViewVersion（行政/运营/病案/财务/统计分别治理）
CampusBusinessUnit ── UnitWardRelation ── Ward ── WardNursingRelation ── NursingUnit
Person ── Engagement(employer) ── Assignment(typed placement) ── AssignmentRole
Person ── Practitioner ── Credential / Registration / PracticeLocation / Privilege
Account ── VerifiedIdentityBinding ── Person
Account ── Role×Scope grant ── (campus,unit,assignment)
```

## 11个维护归口
| 归口 | 数据范围 | 建议模块 |
|---|---|---|
| 治理控制与数据质量 | 契约/来源/导入/问题/审批/审计 | batch-import、workflow、audit、authorization |
| 组织主体与院区 | ORG01–03 | organization-master |
| 科室与多视图 | ORG04–06、22–23、26–27 | department-master |
| 业务单元及护理服务组织 | ORG07–11、14、16–17 | care-organization + 专业模块 |
| 物理空间 | ORG12–13 | location-master |
| 监管核算统计 | ORG18–21 | organization-reference-mapping |
| 床位资源及口径快照 | ORG24–25 | bed-resource |
| 人员任用任职 | PER01–02、04、06、15、21、24 | person-master |
| 岗位医疗组及专业资格 | ORG15、PER05、07–14、16、25 | role/credential深能力，避免新建第二Person |
| 数字身份与访问 | PER17–20、26 | identity-access + authorization |
| 受限HR与经历 | PER03、22–23 | hr-restricted |

这不是将53张逻辑采集表照抄为53张物理表。模型文件里的稳定实体、版本、关系、事件、快照、受限资料必须分流到真实 owner。`maps/field-routing.csv` 保留866字段原定义及执行路由建议。

## 分层反例
- 人员手机号相同不能合并人员；多个工号/合同不能复制Person。
- 同一科室搬房间通常只改地点关系；实质拆分产生新科室身份。
- 行政树组节点不能被任职、医嘱来源映射或业务单元当成真实Department。
- 业务单元有临床能力不代表所有在该单元任职者都有执业资格。
- 护理单元不是病区，病区不是楼层；共享病区不是强制一科室一病区。
- 成本中心不是科室主身份；统计视图不产生新的法人或人员归属。
- 电子账号角色、岗位、职称资格、职务聘任、专项授权是不同关系。

## 数据集分阶段就绪
CORE profile 与 FULL profile 必须是两个明确版本化契约，不能悄悄丢字段。例：PER06 原表 position_id 为必填；P4 安置内核可以用已批准的独立 PLACEMENT profile，但完整 PER06 profile 需等P5岗位/任职角色就绪。已上传 FULL 文件不能因为岗位模块未实现便把 position_id 丢掉后应用。
ORG07负责人(P5-02)、PER21 ACCOUNT(P6-07)/PRACTITIONER(P5-04)、PER15监督(P5-10)同理。前置引用未就绪→保留隔离候选并标 BLOCKED_DEPENDENCY。原字段不因暂缓而消失。

## 单一写权威
Importer拥有input/job/issue，不拥有Person/Department/Location表写权。跨域事务通过 composition 注入 transaction-scoped owner ports。同一数据库FK允许跨schema保证引用，不赋予模块跨schema DML权力。API可重构，但这一所有权不放宽。
