# 科室主数据标准核验：HL7 FHIR R4

核验范围：HL7 FHIR R4 v4.0.1 官方规范。以下是资源职责边界和本项目主数据建模相关结论；链接均为 HL7 一级来源。

## 结论摘要

- **概念科室树使用 `Organization.partOf`。** `Organization` 明确包括 department；`partOf` 为 `0..1 Reference(Organization)`，递归可表达医院到科室、亚科室的多层树。
- **物理空间树使用 `Location.partOf`。** `Location` 用于建筑、病区、病房、床位等物理地点；`partOf` 为 `0..1 Reference(Location)`。它不应替代概念科室树。
- **服务与组织单元分离。** `HealthcareService` 描述由组织在地点提供的服务，而不是科室树节点；它通过 `providedBy` 关联组织、通过 `location` 关联一个或多个地点。
- **`OrganizationAffiliation` 在 R4 中存在，但不用于同一医院内的父子科室。** 它是两个独立组织之间的非层级关系，并明确不应在 affiliates 属于同一组织时使用。
- **`Identifier` 是业务/跨系统标识，不是 FHIR 资源服务器身份。** 资源身份的服务器逻辑标识为 `Resource.id`；`identifier` 是可跨上下文保持稳定的 business identifier。`Reference.identifier` 可作为尚未知 literal reference 时的逻辑引用，但仍不是 `Resource.id`。

## 资源定义、边界和关系

| 对象 | 官方定义与关键字段 | 对科室主数据的结论 |
| --- | --- | --- |
| `Organization` | 官方定义为为共同目标形成的人员或组织集合，明确包含 “departments”。规范说明常以 `partOf` 形成组织层级，并用其表达概念组织结构；字段 `partOf` 为 `0..1 Reference(Organization)`。见 [Organization](https://hl7.org/fhir/R4/organization.html)。 | **支持多层级科室树。** 每个子节点最多一个直接父节点，因此标准核心表达的是单父树；未原生定义同一节点的多父节点、命名视图或多套并行组织树。后一句是由 `partOf` 的 `0..1` 基数作出的实现边界推论。 |
| `Location` | 官方定义为提供服务、存放或容纳资源的物理地点，示例包括 building、ward、room、bed。规范明确 Location 描述组织运营的物理结构，而 Organization 描述如 ward 的概念层级。`partOf` 为 `0..1 Reference(Location)`；`managingOrganization` 链接负责供给和维护的组织。见 [Location](https://hl7.org/fhir/R4/location.html)。 | **支持多层物理地点树。** 院区、楼宇、病区、病房、床位宜在此树中表达；可从地点层级链接到相应 `Organization` 层级。 |
| `HealthcareService` | 官方定义为组织在地点提供的一项或一类医疗服务。`providedBy` 为 `0..1 Reference(Organization)`，`location` 为 `0..* Reference(Location)`；规范直接区分“Organization provides the services, HealthcareService describes the services”。见 [HealthcareService](https://hl7.org/fhir/R4/healthcareservice.html)。 | **不作为科室树节点。** 用于挂接科室/机构提供的服务目录及其可提供服务的地点。 |
| `OrganizationAffiliation` | R4 已定义此资源：两个独立组织在某期间的关联，可选带地点、服务信息；它定义非层级关系。规范写明 `Organization.partOf` 用于单一组织内的树，`OrganizationAffiliation` 用于两个不同组织，且“should not be used when the affiliates are part of a single organization”。见 [OrganizationAffiliation](https://hl7.org/fhir/R4/organizationaffiliation.html)。 | **不用于医院内部父子科室或其替代多视图。** 可用于独立法人/独立业务实体的合作、成员、服务可用性等关系。 |
| `Identifier` | 官方定义为给定 `system` 内关联单个对象/实体的字母数字串，通常用于把资源内容连接到外部框架或协议；标识可因人工或系统流程而变更/退役。`system` 是命名空间，`value` 在其内唯一。见 [Identifier 数据类型](https://hl7.org/fhir/R4/datatypes.html#Identifier)。 | **业务标识符，不等同于资源逻辑身份。** 需要明确 `system`，并依业务语义管理其有效性和分配者。 |

## Organization 与 Location 的配合

FHIR 明确区分两棵层级树：`Organization` 层级传达概念结构，`Location` 层级表达物理结构。规范还说明，Location 层级的每一点可链接到 Organization 层级的适当层次，未必都链接到顶层组织。见 [Organization 的 Boundaries and Relationships](https://hl7.org/fhir/R4/organization.html)。因此，科室（概念归属）与病区/病房/床位（物理空间）应分别建模，再通过组织管理关系、服务提供关系或业务资源引用连接。

## Identifier 与资源身份

`Resource.id` 是服务器赋予的 logical id，在同一服务器同一资源类型空间内唯一，分配后不改变；资源引用通常按资源位置/逻辑 ID 工作。FHIR 同时把资源内 `identifier` 定义为 business identifier：它识别跨上下文的底层现实世界概念，并可用于检索。见 [Resource Identity](https://hl7.org/fhir/R4/resource.html#identification)。

因此，项目应避免把业务科室编码直接当作 FHIR REST 资源的 `id` 语义来依赖。若只有业务标识而未知目标实例，`Reference.identifier` 可形成 logical reference；官方同时说明它不要求目标已作为 FHIR 实例暴露，是否可解析取决于业务上下文。见 [Logical References](https://hl7.org/fhir/R4/references.html#logical)。

## IHE mCSD附加层级

IHE mCSD建立在FHIR R4目录资源之上；其[当前发布指南](https://profiles.ihe.net/ITI/mCSD/index.html)为4.0.0。IHE发布的[Additional Hierarchies扩展](https://profiles.ihe.net/ITI/mCSD/StructureDefinition-IHE.mCSD.OrganizationHierarchy.html)明确说明：存在附加层级时，可在Organization上同时记录`hierarchy-type`和该层级中的`part-of`父组织。因此，mCSD为“同一组织参与多个有明确类型的层级”提供了标准化表达依据。

该扩展只定义附加层级类型及父组织引用，并不替医院定义视图Owner、治理对象级权限、审批发布、不可变完整快照、双时态查询或运营迁移流程。因此，本项目的多视角治理模型与mCSD语义兼容，但不能把mCSD扩展本身当成完整的院内科室主数据治理方案。

## 时间语义：必须分别建模

**明确结论：FHIR R4 与 mCSD 并未把“主数据生效时间（effective/business validity）”、“运营迁移时间（operational migration/event time）”和“system/transaction time”统一定义为一组标准的“双时间”模型。**

FHIR 基础资源仅将 `Resource.id`、`meta` 等作为资源基础元素；上述目录资源则分别提供状态或局部期间语义，例如 `Organization.active`、`Location.status`、`OrganizationAffiliation.period` 与 `Identifier.period`。这些字段既不构成对任意科室主数据版本的一致 valid-time 区间，也不定义与系统写入/更正时间成对、可统一查询的 transaction-time 区间；mCSD 对这些目录资源的采用不改变这一基础边界。

故本项目必须显式分开建模并记录至少三类时间：

1. **主数据生效时间**：该组织/科室归属、名称、编码或层级关系在业务世界何时有效；
2. **运营迁移时间**：实际启用、迁科、迁址、停用或业务切换发生的事件时间；
3. **system/transaction time**：本平台何时接收、写入、修订或撤销该事实。

不得以 `active`/`status`、单一 `period` 或 `meta.lastUpdated` 互相替代。需要可追溯历史时，应在本项目的数据模型中保留独立的有效期间、事件时间和系统版本/交易审计字段；FHIR 资源可承载相应值或通过项目 Profile/Extension 约束，但不会自动提供统一双时间语义。
