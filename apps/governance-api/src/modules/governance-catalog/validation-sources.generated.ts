// Generated from checksum-verified v3 inputs; do not edit source package.
export const conditionMappings = [
  {
    "id": "SRC-COND-001",
    "dataset": "ORG01",
    "field": "unified_credit_code",
    "text": "主体持有统一社会信用代码时必填；无法确认主体性质时不得以院区代码代替。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-001_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "院办",
    "evidenceClaim": "主体持有统一社会信用代码时必填；无法确认主体性质时不得以院区代码代替。",
    "inputs": [
      "unified_credit_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "院办 must establish the applicability and evidence required by ORG01.unified_credit_code; row presence cannot prove: 主体持有统一社会信用代码时必填；无法确认主体性质时不得以院区代码代替。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-002",
    "dataset": "ORG01",
    "field": "institution_code",
    "text": "作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-002_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "院办",
    "evidenceClaim": "作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "inputs": [
      "institution_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "院办 must establish the applicability and evidence required by ORG01.institution_code; row presence cannot prove: 作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-003",
    "dataset": "ORG01",
    "field": "license_number",
    "text": "作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-003_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "院办",
    "evidenceClaim": "作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "inputs": [
      "license_number",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "院办 must establish the applicability and evidence required by ORG01.license_number; row presence cannot prove: 作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-004",
    "dataset": "ORG01",
    "field": "license_valid_from",
    "text": "作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-004_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "院办",
    "evidenceClaim": "作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "inputs": [
      "license_valid_from",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "院办 must establish the applicability and evidence required by ORG01.license_valid_from; row presence cannot prove: 作为持证医疗机构上线时必填，依据已核验的登记/执业证照填写；筹建主体不得伪造。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-005",
    "dataset": "ORG02",
    "field": "campus_address",
    "text": "实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-005_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "院办",
    "evidenceClaim": "实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。",
    "inputs": [
      "campus_address",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "院办 must establish the applicability and evidence required by ORG02.campus_address; row presence cannot prove: 实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-006",
    "dataset": "ORG02",
    "field": "admin_division_code",
    "text": "实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-006_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "院办",
    "evidenceClaim": "实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。",
    "inputs": [
      "admin_division_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "院办 must establish the applicability and evidence required by ORG02.admin_division_code; row presence cannot prove: 实际对外服务的物理院区启用时必填；行政区划绑定已确认的代码集版本。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-007",
    "dataset": "ORG03",
    "field": "license_scope",
    "text": "该主体在该院区开展需许可的医疗服务时必填，并核对证照覆盖。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-007_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "院办",
    "evidenceClaim": "该主体在该院区开展需许可的医疗服务时必填，并核对证照覆盖。",
    "inputs": [
      "license_scope",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "院办 must establish the applicability and evidence required by ORG03.license_scope; row presence cannot prove: 该主体在该院区开展需许可的医疗服务时必填，并核对证照覆盖。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-008",
    "dataset": "ORG04",
    "field": "established_on",
    "text": "新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-008_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。",
    "inputs": [
      "established_on",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG04.established_on; row presence cannot prove: 新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-009",
    "dataset": "ORG04",
    "field": "establishment_doc",
    "text": "新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-009_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。",
    "inputs": [
      "establishment_doc",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG04.establishment_doc; row presence cannot prove: 新设、合并、拆分或正式调整组织时必填；历史证据缺失进入问题台账，不臆造日期。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-010",
    "dataset": "ORG05",
    "field": "owner_org_id",
    "text": "视图拟正式发布时必填，明确唯一最终负责组织。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-010_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "数据治理牵头部门",
    "evidenceClaim": "视图拟正式发布时必填，明确唯一最终负责组织。",
    "inputs": [
      "owner_org_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "数据治理牵头部门 must establish the applicability and evidence required by ORG05.owner_org_id; row presence cannot prove: 视图拟正式发布时必填，明确唯一最终负责组织。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-011",
    "dataset": "ORG06",
    "field": "parent_org_id",
    "text": "非根节点必填；视图正式声明的根节点可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-011_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "非根节点必填；视图正式声明的根节点可空。",
    "inputs": [
      "parent_org_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG06.parent_org_id; row presence cannot prove: 非根节点必填；视图正式声明的根节点可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-012",
    "dataset": "ORG07",
    "field": "receiving_rule_ref",
    "text": "存在年龄、性别、病种、门急住或其他收治限制时必填；无特殊限制需经业务确认。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-012_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "存在年龄、性别、病种、门急住或其他收治限制时必填；无特殊限制需经业务确认。",
    "inputs": [
      "receiving_rule_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by ORG07.receiving_rule_ref; row presence cannot prove: 存在年龄、性别、病种、门急住或其他收治限制时必填；无特殊限制需经业务确认。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-013",
    "dataset": "ORG07",
    "field": "business_owner_id",
    "text": "院区业务单元启用前必填；指向有效人员，不填写自由文本姓名作为关联。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-013_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "院区业务单元启用前必填；指向有效人员，不填写自由文本姓名作为关联。",
    "inputs": [
      "business_owner_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by ORG07.business_owner_id; row presence cannot prove: 院区业务单元启用前必填；指向有效人员，不填写自由文本姓名作为关联。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-014",
    "dataset": "ORG08",
    "field": "managing_unit_id",
    "text": "病区启用时必填；管理归口与可收治科室关联分别维护。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-014_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "病区启用时必填；管理归口与可收治科室关联分别维护。",
    "inputs": [
      "managing_unit_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by ORG08.managing_unit_id; row presence cannot prove: 病区启用时必填；管理归口与可收治科室关联分别维护。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-015",
    "dataset": "ORG08",
    "field": "admission_rule_ref",
    "text": "有专科收治、混合病区、年龄或特殊隔离限制时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-015_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "有专科收治、混合病区、年龄或特殊隔离限制时必填。",
    "inputs": [
      "admission_rule_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by ORG08.admission_rule_ref; row presence cannot prove: 有专科收治、混合病区、年龄或特殊隔离限制时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-016",
    "dataset": "ORG10",
    "field": "sharing_rule",
    "text": "同病区被多个科室使用或存在跨院区转入边界时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-016_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "同病区被多个科室使用或存在跨院区转入边界时必填。",
    "inputs": [
      "sharing_rule",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by ORG10.sharing_rule; row presence cannot prove: 同病区被多个科室使用或存在跨院区转入边界时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-017",
    "dataset": "ORG12",
    "field": "floor_label",
    "text": "地点属于楼层、房间或楼层内设施时必填；院区、楼宇层级可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-017_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "后勤管理部门",
    "evidenceClaim": "地点属于楼层、房间或楼层内设施时必填；院区、楼宇层级可空。",
    "inputs": [
      "floor_label",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "后勤管理部门 must establish the applicability and evidence required by ORG12.floor_label; row presence cannot prove: 地点属于楼层、房间或楼层内设施时必填；院区、楼宇层级可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-018",
    "dataset": "ORG12",
    "field": "room_number",
    "text": "地点属于具有房间编号的房间/诊室/手术间时必填；不得以显示名作为稳定ID。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-018_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "后勤管理部门",
    "evidenceClaim": "地点属于具有房间编号的房间/诊室/手术间时必填；不得以显示名作为稳定ID。",
    "inputs": [
      "room_number",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "后勤管理部门 must establish the applicability and evidence required by ORG12.room_number; row presence cannot prove: 地点属于具有房间编号的房间/诊室/手术间时必填；不得以显示名作为稳定ID。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-019",
    "dataset": "ORG15",
    "field": "appointment_doc",
    "text": "负责人关系正式启用或调整时必填，可引用受控签审记录。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-019_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "负责人关系正式启用或调整时必填，可引用受控签审记录。",
    "inputs": [
      "appointment_doc",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG15.appointment_doc; row presence cannot prove: 负责人关系正式启用或调整时必填，可引用受控签审记录。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-020",
    "dataset": "ORG17",
    "field": "permitted_scope",
    "text": "许可/备案/院内准入存在范围、级别或条件限制时必填；不以空值表示无限许可。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-020_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "许可/备案/院内准入存在范围、级别或条件限制时必填；不以空值表示无限许可。",
    "inputs": [
      "permitted_scope",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by ORG17.permitted_scope; row presence cannot prove: 许可/备案/院内准入存在范围、级别或条件限制时必填；不以空值表示无限许可。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-021",
    "dataset": "ORG20",
    "field": "weight",
    "text": "分配方式为固定比例时必填，0≤weight≤1；同口径同期间同分配组之和为1。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-021_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "财务部",
    "evidenceClaim": "分配方式为固定比例时必填，0≤weight≤1；同口径同期间同分配组之和为1。",
    "inputs": [
      "weight",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "财务部 must establish the applicability and evidence required by ORG20.weight; row presence cannot prove: 分配方式为固定比例时必填，0≤weight≤1；同口径同期间同分配组之和为1。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-022",
    "dataset": "ORG20",
    "field": "rule_ref",
    "text": "分配方式不是固定比例时必填；按工时、工作量等动态规则引用，不编造固定比例。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-022_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "财务部",
    "evidenceClaim": "分配方式不是固定比例时必填；按工时、工作量等动态规则引用，不编造固定比例。",
    "inputs": [
      "rule_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "财务部 must establish the applicability and evidence required by ORG20.rule_ref; row presence cannot prove: 分配方式不是固定比例时必填；按工时、工作量等动态规则引用，不编造固定比例。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-023",
    "dataset": "ORG22",
    "field": "resolution_rule",
    "text": "源代码在相同有效期下对应多个目标或存在拆分时必填，并可由上下文唯一裁决。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-023_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "信息管理部",
    "evidenceClaim": "源代码在相同有效期下对应多个目标或存在拆分时必填，并可由上下文唯一裁决。",
    "inputs": [
      "resolution_rule",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "信息管理部 must establish the applicability and evidence required by ORG22.resolution_rule; row presence cannot prove: 源代码在相同有效期下对应多个目标或存在拆分时必填，并可由上下文唯一裁决。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-024",
    "dataset": "ORG24",
    "field": "location_id",
    "text": "实体床位投入使用时必填；非实体候床/虚拟资源须另行明确类型。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-024_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "护理部",
    "evidenceClaim": "实体床位投入使用时必填；非实体候床/虚拟资源须另行明确类型。",
    "inputs": [
      "location_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "护理部 must establish the applicability and evidence required by ORG24.location_id; row presence cannot prove: 实体床位投入使用时必填；非实体候床/虚拟资源须另行明确类型。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-025",
    "dataset": "ORG24",
    "field": "charge_item_id",
    "text": "该床位需按床位类别收费时必填，指向已批准收费项目，不直接填价格。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-025_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "护理部",
    "evidenceClaim": "该床位需按床位类别收费时必填，指向已批准收费项目，不直接填价格。",
    "inputs": [
      "charge_item_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "护理部 must establish the applicability and evidence required by ORG24.charge_item_id; row presence cannot prove: 该床位需按床位类别收费时必填，指向已批准收费项目，不直接填价格。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-026",
    "dataset": "ORG26",
    "field": "migration_plan_ref",
    "text": "组织调整影响在途患者、账号、库存、财务或消费者映射时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-026_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "组织调整影响在途患者、账号、库存、财务或消费者映射时必填。",
    "inputs": [
      "migration_plan_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG26.migration_plan_ref; row presence cannot prove: 组织调整影响在途患者、账号、库存、财务或消费者映射时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-027",
    "dataset": "ORG27",
    "field": "from_target_type",
    "text": "撤销、合并、拆分、更名/迁移等存在前身对象的事件必填；纯新设可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-027_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "撤销、合并、拆分、更名/迁移等存在前身对象的事件必填；纯新设可空。",
    "inputs": [
      "from_target_type",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG27.from_target_type; row presence cannot prove: 撤销、合并、拆分、更名/迁移等存在前身对象的事件必填；纯新设可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-028",
    "dataset": "ORG27",
    "field": "from_target_id",
    "text": "撤销、合并、拆分、更名/迁移等存在前身对象的事件必填；纯新设可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-028_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "撤销、合并、拆分、更名/迁移等存在前身对象的事件必填；纯新设可空。",
    "inputs": [
      "from_target_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG27.from_target_id; row presence cannot prove: 撤销、合并、拆分、更名/迁移等存在前身对象的事件必填；纯新设可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-029",
    "dataset": "ORG27",
    "field": "to_target_type",
    "text": "新设、合并、拆分、迁移等存在承继对象的事件必填；无承继撤销可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-029_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "新设、合并、拆分、迁移等存在承继对象的事件必填；无承继撤销可空。",
    "inputs": [
      "to_target_type",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG27.to_target_type; row presence cannot prove: 新设、合并、拆分、迁移等存在承继对象的事件必填；无承继撤销可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-030",
    "dataset": "ORG27",
    "field": "to_target_id",
    "text": "新设、合并、拆分、迁移等存在承继对象的事件必填；无承继撤销可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-030_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "新设、合并、拆分、迁移等存在承继对象的事件必填；无承继撤销可空。",
    "inputs": [
      "to_target_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG27.to_target_id; row presence cannot prove: 新设、合并、拆分、迁移等存在承继对象的事件必填；无承继撤销可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-031",
    "dataset": "ORG27",
    "field": "context_rule",
    "text": "一对多承继或不同业务采取不同迁移去向时必填；不按比例盲目改写历史业务外键。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-031_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "一对多承继或不同业务采取不同迁移去向时必填；不按比例盲目改写历史业务外键。",
    "inputs": [
      "context_rule",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by ORG27.context_rule; row presence cannot prove: 一对多承继或不同业务采取不同迁移去向时必填；不按比例盲目改写历史业务外键。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-032",
    "dataset": "PER01",
    "field": "gender_code",
    "text": "相关实名核验、执业或必要业务要求使用性别时填；非必要消费视图不下发。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-032_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "相关实名核验、执业或必要业务要求使用性别时填；非必要消费视图不下发。",
    "inputs": [
      "gender_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER01.gender_code; row presence cannot prove: 相关实名核验、执业或必要业务要求使用性别时填；非必要消费视图不下发。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-033",
    "dataset": "PER01",
    "field": "identity_evidence_ref",
    "text": "身份核验状态为已核验时必填；共享表只保留安全引用。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-033_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "身份核验状态为已核验时必填；共享表只保留安全引用。",
    "inputs": [
      "identity_evidence_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER01.identity_evidence_ref; row presence cannot prove: 身份核验状态为已核验时必填；共享表只保留安全引用。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-034",
    "dataset": "PER02",
    "field": "evidence_ref",
    "text": "证件标识被确认为有效身份匹配依据时必填；不得用未经确认的号码建立同人关系。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-034_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "证件标识被确认为有效身份匹配依据时必填；不得用未经确认的号码建立同人关系。",
    "inputs": [
      "evidence_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER02.evidence_ref; row presence cannot prove: 证件标识被确认为有效身份匹配依据时必填；不得用未经确认的号码建立同人关系。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-035",
    "dataset": "PER04",
    "field": "join_date",
    "text": "来院时间被用于本轮在岗判定或任职有效期核验时必填；历史缺失单独标记。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-035_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "来院时间被用于本轮在岗判定或任职有效期核验时必填；历史缺失单独标记。",
    "inputs": [
      "join_date",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER04.join_date; row presence cannot prove: 来院时间被用于本轮在岗判定或任职有效期核验时必填；历史缺失单独标记。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-036",
    "dataset": "PER05",
    "field": "position_level",
    "text": "岗位采用分级管理/聘任等级时必填；非分级岗位可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-036_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "岗位采用分级管理/聘任等级时必填；非分级岗位可空。",
    "inputs": [
      "position_level",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER05.position_level; row presence cannot prove: 岗位采用分级管理/聘任等级时必填；非分级岗位可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-037",
    "dataset": "PER05",
    "field": "clinical_admin_class",
    "text": "岗位参与临床/行政分类报表或厂商岗位映射时必填；分类不自动授予系统权限。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-037_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "岗位参与临床/行政分类报表或厂商岗位映射时必填；分类不自动授予系统权限。",
    "inputs": [
      "clinical_admin_class",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER05.clinical_admin_class; row presence cannot prove: 岗位参与临床/行政分类报表或厂商岗位映射时必填；分类不自动授予系统权限。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-038",
    "dataset": "PER05",
    "field": "qualification_requirement",
    "text": "岗位设置了任职资质、职称或培训准入要求时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-038_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "岗位设置了任职资质、职称或培训准入要求时必填。",
    "inputs": [
      "qualification_requirement",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER05.qualification_requirement; row presence cannot prove: 岗位设置了任职资质、职称或培训准入要求时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-039",
    "dataset": "PER06",
    "field": "unit_id",
    "text": "承担具体临床、护理、医技或药学业务的任职必填；纯院级行政任职可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-039_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "承担具体临床、护理、医技或药学业务的任职必填；纯院级行政任职可空。",
    "inputs": [
      "unit_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER06.unit_id; row presence cannot prove: 承担具体临床、护理、医技或药学业务的任职必填；纯院级行政任职可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-040",
    "dataset": "PER06",
    "field": "campus_id",
    "text": "存在明确工作地点的院区任职必填；院级行政关系可空但不得解读为全院区授权。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-040_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "存在明确工作地点的院区任职必填；院级行政关系可空但不得解读为全院区授权。",
    "inputs": [
      "campus_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER06.campus_id; row presence cannot prove: 存在明确工作地点的院区任职必填；院级行政关系可空但不得解读为全院区授权。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-041",
    "dataset": "PER06",
    "field": "appointment_date",
    "text": "岗位任命/聘任有正式起始日期时必填；不得复用工号或以录入日期替代。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-041_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "岗位任命/聘任有正式起始日期时必填；不得复用工号或以录入日期替代。",
    "inputs": [
      "appointment_date",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER06.appointment_date; row presence cannot prove: 岗位任命/聘任有正式起始日期时必填；不得复用工号或以录入日期替代。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-042",
    "dataset": "PER07",
    "field": "specialty_code",
    "text": "按已批准标准专业目录管理时必填；没有可用标准映射时不得编造代码。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-042_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "按已批准标准专业目录管理时必填；没有可用标准映射时不得编造代码。",
    "inputs": [
      "specialty_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER07.specialty_code; row presence cannot prove: 按已批准标准专业目录管理时必填；没有可用标准映射时不得编造代码。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-043",
    "dataset": "PER07",
    "field": "specialty_name",
    "text": "本次启用专业身份时必填；应与已采用专业代码对应，未编码专业须审签。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-043_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "本次启用专业身份时必填；应与已采用专业代码对应，未编码专业须审签。",
    "inputs": [
      "specialty_name",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER07.specialty_name; row presence cannot prove: 本次启用专业身份时必填；应与已采用专业代码对应，未编码专业须审签。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-044",
    "dataset": "PER08",
    "field": "qualification_code",
    "text": "证书采用标准专业/类别/等级编码或被准入规则引用时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-044_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "证书采用标准专业/类别/等级编码或被准入规则引用时必填。",
    "inputs": [
      "qualification_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER08.qualification_code; row presence cannot prove: 证书采用标准专业/类别/等级编码或被准入规则引用时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-045",
    "dataset": "PER08",
    "field": "issuer",
    "text": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-045_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "inputs": [
      "issuer",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER08.issuer; row presence cannot prove: 资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-046",
    "dataset": "PER08",
    "field": "evidence_ref",
    "text": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-046_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "inputs": [
      "evidence_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER08.evidence_ref; row presence cannot prove: 资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-047",
    "dataset": "PER08",
    "field": "verified_on",
    "text": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-047_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "inputs": [
      "verified_on",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER08.verified_on; row presence cannot prove: 资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-048",
    "dataset": "PER08",
    "field": "verified_by",
    "text": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-048_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "inputs": [
      "verified_by",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER08.verified_by; row presence cannot prove: 资质用于正式临床准入前必填；证据、核验日期和责任岗位均应可追溯。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-049",
    "dataset": "PER09",
    "field": "practice_scope_code",
    "text": "该执业登记存在执业范围/专业编码时必填，按登记证照或权威登记资料核验。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-049_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "该执业登记存在执业范围/专业编码时必填，按登记证照或权威登记资料核验。",
    "inputs": [
      "practice_scope_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER09.practice_scope_code; row presence cannot prove: 该执业登记存在执业范围/专业编码时必填，按登记证照或权威登记资料核验。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-050",
    "dataset": "PER09",
    "field": "multi_site_record_ref",
    "text": "经医务部门核定实际依法需要多机构执业备案时必填；不能按院区数量推断。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-050_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "经医务部门核定实际依法需要多机构执业备案时必填；不能按院区数量推断。",
    "inputs": [
      "multi_site_record_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER09.multi_site_record_ref; row presence cannot prove: 经医务部门核定实际依法需要多机构执业备案时必填；不能按院区数量推断。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-051",
    "dataset": "PER10",
    "field": "unit_id",
    "text": "执业服务关系限定到具体业务单元时必填；仅到院区须显式说明批准范围。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-051_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "执业服务关系限定到具体业务单元时必填；仅到院区须显式说明批准范围。",
    "inputs": [
      "unit_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER10.unit_id; row presence cannot prove: 执业服务关系限定到具体业务单元时必填；仅到院区须显式说明批准范围。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-052",
    "dataset": "PER11",
    "field": "unit_id",
    "text": "专项医疗授权限定到特定单元时必填；院区级授权不得自动扩大至其他院区。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-052_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "专项医疗授权限定到特定单元时必填；院区级授权不得自动扩大至其他院区。",
    "inputs": [
      "unit_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER11.unit_id; row presence cannot prove: 专项医疗授权限定到特定单元时必填；院区级授权不得自动扩大至其他院区。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-053",
    "dataset": "PER11",
    "field": "revocation_reason",
    "text": "授权被提前撤销时必填，并同时记载撤销生效时间与批准依据。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-053_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "授权被提前撤销时必填，并同时记载撤销生效时间与批准依据。",
    "inputs": [
      "revocation_reason",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER11.revocation_reason; row presence cannot prove: 授权被提前撤销时必填，并同时记载撤销生效时间与批准依据。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-054",
    "dataset": "PER12",
    "field": "acquired_on",
    "text": "技术资格被用于聘任、监管或准入时必填；证据缺失时不得宣告资格已核验。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-054_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "技术资格被用于聘任、监管或准入时必填；证据缺失时不得宣告资格已核验。",
    "inputs": [
      "acquired_on",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER12.acquired_on; row presence cannot prove: 技术资格被用于聘任、监管或准入时必填；证据缺失时不得宣告资格已核验。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-055",
    "dataset": "PER13",
    "field": "assignment_id",
    "text": "技术职务聘任与具体人事任职绑定时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-055_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "技术职务聘任与具体人事任职绑定时必填。",
    "inputs": [
      "assignment_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER13.assignment_id; row presence cannot prove: 技术职务聘任与具体人事任职绑定时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-056",
    "dataset": "PER13",
    "field": "title_qualification_id",
    "text": "该项职务聘任以已取得技术资格为前提时必填；特殊聘任须保留批准依据。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-056_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "该项职务聘任以已取得技术资格为前提时必填；特殊聘任须保留批准依据。",
    "inputs": [
      "title_qualification_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER13.title_qualification_id; row presence cannot prove: 该项职务聘任以已取得技术资格为前提时必填；特殊聘任须保留批准依据。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-057",
    "dataset": "PER14",
    "field": "assignment_id",
    "text": "成员资格依托本院具体任职时必填；外部协作成员采用已审定的替代依据。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-057_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "成员资格依托本院具体任职时必填；外部协作成员采用已审定的替代依据。",
    "inputs": [
      "assignment_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER14.assignment_id; row presence cannot prove: 成员资格依托本院具体任职时必填；外部协作成员采用已审定的替代依据。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-058",
    "dataset": "PER14",
    "field": "team_role",
    "text": "医疗组按组长、成员、带教等职责分工运作时必填，不由系统角色反推。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-058_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "医务部",
    "evidenceClaim": "医疗组按组长、成员、带教等职责分工运作时必填，不由系统角色反推。",
    "inputs": [
      "team_role",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "医务部 must establish the applicability and evidence required by PER14.team_role; row presence cannot prove: 医疗组按组长、成员、带教等职责分工运作时必填，不由系统角色反推。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-059",
    "dataset": "PER15",
    "field": "from_assignment_id",
    "text": "已有本院任职人员轮转/支援调出时必填；外部首次来院可空。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-059_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "已有本院任职人员轮转/支援调出时必填；外部首次来院可空。",
    "inputs": [
      "from_assignment_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER15.from_assignment_id; row presence cannot prove: 已有本院任职人员轮转/支援调出时必填；外部首次来院可空。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-060",
    "dataset": "PER15",
    "field": "supervisor_person_id",
    "text": "学生、进修、规培等需带教审核或支援需指定接收责任人时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-060_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "学生、进修、规培等需带教审核或支援需指定接收责任人时必填。",
    "inputs": [
      "supervisor_person_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER15.supervisor_person_id; row presence cannot prove: 学生、进修、规培等需带教审核或支援需指定接收责任人时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-061",
    "dataset": "PER17",
    "field": "person_id",
    "text": "账号类型为HUMAN时必填；服务账号不得绑定虚构员工。",
    "handler": "ACCOUNT_HUMAN_V1",
    "requirementId": "SRC-COND-061_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "信息管理部",
    "evidenceClaim": "账号类型为HUMAN时必填；服务账号不得绑定虚构员工。",
    "inputs": [
      "account_kind",
      "person_id"
    ],
    "dispositionReason": "Exact HUMAN/SERVICE code only; unknown/unadopted codes remain UNKNOWN",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-062",
    "dataset": "PER17",
    "field": "default_unit_id",
    "text": "应用需要默认登录单元时必填；默认值不等于完整授权范围。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-062_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "信息管理部",
    "evidenceClaim": "应用需要默认登录单元时必填；默认值不等于完整授权范围。",
    "inputs": [
      "default_unit_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "信息管理部 must establish the applicability and evidence required by PER17.default_unit_id; row presence cannot prove: 应用需要默认登录单元时必填；默认值不等于完整授权范围。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-063",
    "dataset": "PER18",
    "field": "separation_of_duties",
    "text": "角色涉及制单/审核/付款、处方/审核或其他互斥职责时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-063_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "信息管理部",
    "evidenceClaim": "角色涉及制单/审核/付款、处方/审核或其他互斥职责时必填。",
    "inputs": [
      "separation_of_duties",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "信息管理部 must establish the applicability and evidence required by PER18.separation_of_duties; row presence cannot prove: 角色涉及制单/审核/付款、处方/审核或其他互斥职责时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-064",
    "dataset": "PER19",
    "field": "unit_id",
    "text": "权限按临床业务单元/科室隔离时必填；空范围不能被实现为全部科室。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-064_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "业务系统归口部门",
    "evidenceClaim": "权限按临床业务单元/科室隔离时必填；空范围不能被实现为全部科室。",
    "inputs": [
      "unit_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "业务系统归口部门 must establish the applicability and evidence required by PER19.unit_id; row presence cannot prove: 权限按临床业务单元/科室隔离时必填；空范围不能被实现为全部科室。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-065",
    "dataset": "PER19",
    "field": "assignment_id",
    "text": "账号权限依据员工岗位任职批准时必填；其他依据必须显式审签。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-065_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "业务系统归口部门",
    "evidenceClaim": "账号权限依据员工岗位任职批准时必填；其他依据必须显式审签。",
    "inputs": [
      "assignment_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "业务系统归口部门 must establish the applicability and evidence required by PER19.assignment_id; row presence cannot prove: 账号权限依据员工岗位任职批准时必填；其他依据必须显式审签。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-066",
    "dataset": "PER19",
    "field": "scope_expression",
    "text": "存在患者、资源、操作类别等额外权限过滤条件时必填，使用版本化可执行表达式。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-066_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "业务系统归口部门",
    "evidenceClaim": "存在患者、资源、操作类别等额外权限过滤条件时必填，使用版本化可执行表达式。",
    "inputs": [
      "scope_expression",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "业务系统归口部门 must establish the applicability and evidence required by PER19.scope_expression; row presence cannot prove: 存在患者、资源、操作类别等额外权限过滤条件时必填，使用版本化可执行表达式。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-067",
    "dataset": "PER21",
    "field": "resolution_evidence",
    "text": "完成同一人映射、冲突工号裁决或人工身份归并时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-067_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "信息管理部",
    "evidenceClaim": "完成同一人映射、冲突工号裁决或人工身份归并时必填。",
    "inputs": [
      "resolution_evidence",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "信息管理部 must establish the applicability and evidence required by PER21.resolution_evidence; row presence cannot prove: 完成同一人映射、冲突工号裁决或人工身份归并时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-068",
    "dataset": "PER23",
    "field": "school_name",
    "text": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-068_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "inputs": [
      "school_name",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER23.school_name; row presence cannot prove: 该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-069",
    "dataset": "PER23",
    "field": "major_name",
    "text": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-069_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "inputs": [
      "major_name",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER23.major_name; row presence cannot prove: 该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-070",
    "dataset": "PER23",
    "field": "education_code",
    "text": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-070_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "inputs": [
      "education_code",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER23.education_code; row presence cannot prove: 该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-071",
    "dataset": "PER23",
    "field": "graduation_date",
    "text": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-071_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "inputs": [
      "graduation_date",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER23.graduation_date; row presence cannot prove: 该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-072",
    "dataset": "PER23",
    "field": "evidence_ref",
    "text": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-072_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "inputs": [
      "evidence_ref",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER23.evidence_ref; row presence cannot prove: 该学历学位经历用于人事确认、资格核验或监管报送时必填；尚在读应另设明确状态而非伪造毕业日期。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-073",
    "dataset": "PER24",
    "field": "employment_id",
    "text": "事件针对某一聘用关系的入职、离职、返聘或调动时必填。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-073_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "事件针对某一聘用关系的入职、离职、返聘或调动时必填。",
    "inputs": [
      "employment_id",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER24.employment_id; row presence cannot prove: 事件针对某一聘用关系的入职、离职、返聘或调动时必填。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-074",
    "dataset": "PER24",
    "field": "affected_assignments",
    "text": "事件影响一个以上任职或需批量停用关系时必填，并可列举受影响ID。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-074_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "事件影响一个以上任职或需批量停用关系时必填，并可列举受影响ID。",
    "inputs": [
      "affected_assignments",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER24.affected_assignments; row presence cannot prove: 事件影响一个以上任职或需批量停用关系时必填，并可列举受影响ID。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-075",
    "dataset": "PER24",
    "field": "access_revocation_ticket",
    "text": "离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-075_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。",
    "inputs": [
      "access_revocation_ticket",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER24.access_revocation_ticket; row presence cannot prove: 离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-076",
    "dataset": "PER24",
    "field": "access_verified_at",
    "text": "离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-076_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "组织人事部",
    "evidenceClaim": "离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。",
    "inputs": [
      "access_verified_at",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "组织人事部 must establish the applicability and evidence required by PER24.access_verified_at; row presence cannot prove: 离职、停岗或其他需撤权事件闭环前必填；仅修改人员状态不算撤权完成。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  },
  {
    "id": "SRC-COND-077",
    "dataset": "PER25",
    "field": "public_title",
    "text": "拟向预约/互联网渠道展示职称时必填，取自经核验且当前有效的资格/聘任依据。",
    "handler": "MANUAL_EVIDENCE_V1",
    "requirementId": "SRC-COND-077_EVIDENCE_V1",
    "version": "P0_05_SOURCE_V1",
    "evidenceOwner": "门诊部",
    "evidenceClaim": "拟向预约/互联网渠道展示职称时必填，取自经核验且当前有效的资格/聘任依据。",
    "inputs": [
      "public_title",
      "CURRENT_OWNER_VERIFIED_APPLICABILITY_AND_EVIDENCE"
    ],
    "dispositionReason": "门诊部 must establish the applicability and evidence required by PER25.public_title; row presence cannot prove: 拟向预约/互联网渠道展示职称时必填，取自经核验且当前有效的资格/聘任依据。",
    "whenTrue": "REQUIRE_VALUE_AND_SOURCE_EVIDENCE",
    "whenFalse": "ALLOW_ONLY_CONTRACT_DECLARED_ABSENCE",
    "whenUnknown": "BLOCK",
    "evidenceCapability": "NOT_READY"
  }
] as const;
export const sourceFieldLimits:Record<string,Record<string,{maxLength:number;reference:string;precision:number|null;scale:number|null;int32:boolean}>> = {
  "ORG01": {
    "legal_entity_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "entity_nature": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unified_credit_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "institution_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "license_number": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "authority": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_address": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "license_valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "license_valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "registration_evidence": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG02": {
    "campus_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "node_role": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_address": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "admin_division_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "operation_status": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "opening_date": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "public_phone": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG03": {
    "legal_campus_rel_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_entity_id": {
      "maxLength": 64,
      "reference": "ORG01.legal_entity_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "relation_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "license_scope": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_primary_operator": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "evidence_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG04": {
    "org_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_short_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_type": {
      "maxLength": 64,
      "reference": "enum:org_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "established_on": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "abolished_on": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "establishment_doc": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "description": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_virtual": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG05": {
    "view_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "view_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "view_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "view_type": {
      "maxLength": 64,
      "reference": "enum:view_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "single_parent": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "purpose": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "owner_org_id": {
      "maxLength": 64,
      "reference": "ORG04.org_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "aggregation_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG06": {
    "hierarchy_edge_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "view_id": {
      "maxLength": 64,
      "reference": "ORG05.view_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "parent_org_id": {
      "maxLength": 64,
      "reference": "ORG04.org_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "child_org_id": {
      "maxLength": 64,
      "reference": "ORG04.org_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "relation_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "sort_order": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "is_primary_path": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG07": {
    "unit_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_id": {
      "maxLength": 64,
      "reference": "ORG04.org_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_entity_id": {
      "maxLength": 64,
      "reference": "ORG01.legal_entity_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_type": {
      "maxLength": 64,
      "reference": "enum:unit_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "public_phone": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "service_description": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "receiving_rule_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "business_owner_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG08": {
    "ward_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ward_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ward_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "managing_unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ward_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "admission_rule_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "public_phone": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG09": {
    "nursing_unit_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "nursing_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "nursing_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "managing_org_id": {
      "maxLength": 64,
      "reference": "ORG04.org_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "care_level": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "office_phone": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG10": {
    "unit_ward_rel_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ward_id": {
      "maxLength": 64,
      "reference": "ORG08.ward_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "relation_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_primary": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "sharing_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG11": {
    "ward_nursing_rel_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ward_id": {
      "maxLength": 64,
      "reference": "ORG08.ward_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "nursing_unit_id": {
      "maxLength": 64,
      "reference": "ORG09.nursing_unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "coverage_scope": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_primary": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "handover_rule_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG12": {
    "location_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "location_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "location_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "parent_location_id": {
      "maxLength": 64,
      "reference": "ORG12.location_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "location_type": {
      "maxLength": 64,
      "reference": "enum:location_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "floor_label": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "room_number": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "address_detail": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_accessible": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG13": {
    "object_location_rel_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "location_id": {
      "maxLength": 64,
      "reference": "ORG12.location_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "usage_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_primary": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "sharing_description": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG14": {
    "team_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "team_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "team_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_id": {
      "maxLength": 64,
      "reference": "ORG04.org_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "team_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "service_scope": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG15": {
    "responsibility_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "responsibility_role": {
      "maxLength": 64,
      "reference": "enum:responsibility_role",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "appointment_doc": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_acting": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG16": {
    "capability_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "capability_type": {
      "maxLength": 64,
      "reference": "enum:capability_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "care_setting": {
      "maxLength": 64,
      "reference": "enum:care_setting",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "enabled": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "rule_ref": {
      "maxLength": 64,
      "reference": "GOV09.config_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_dept": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG17": {
    "subject_license_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "code_system_id": {
      "maxLength": 64,
      "reference": "REF01.code_system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "code_system_version": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "subject_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "license_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "permitted_scope": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verifier": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG18": {
    "regulatory_map_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "scheme_id": {
      "maxLength": 64,
      "reference": "REF01.code_system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "scheme_version": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "external_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "external_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_entity_id": {
      "maxLength": 64,
      "reference": "ORG01.legal_entity_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "mapping_relation": {
      "maxLength": 64,
      "reference": "enum:mapping_relation",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "purpose": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG19": {
    "cost_center_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "cost_center_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "cost_center_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ledger_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_entity_id": {
      "maxLength": 64,
      "reference": "ORG01.legal_entity_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "center_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "parent_cost_center_id": {
      "maxLength": 64,
      "reference": "ORG19.cost_center_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "financial_owner": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG20": {
    "allocation_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "cost_center_id": {
      "maxLength": 64,
      "reference": "ORG19.cost_center_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "allocation_basis": {
      "maxLength": 64,
      "reference": "enum:allocation_basis",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "allocation_group": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "weight": {
      "maxLength": 8192,
      "reference": "",
      "precision": 18,
      "scale": 6,
      "int32": false
    },
    "rule_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ledger_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG21": {
    "stat_relation_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "stat_scheme_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "stat_scheme_version": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "stat_group_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "stat_group_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "aggregation_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "snapshot_basis": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG22": {
    "org_map_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "from_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_entity_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_context": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "mapping_relation": {
      "maxLength": 64,
      "reference": "enum:mapping_relation",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "resolution_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verified_by": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG23": {
    "org_identifier_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identifier_kind": {
      "maxLength": 64,
      "reference": "enum:identifier_kind",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identifier_system": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identifier_value": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "language": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_preferred": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG24": {
    "bed_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "bed_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "bed_label": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ward_id": {
      "maxLength": 64,
      "reference": "ORG08.ward_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "location_id": {
      "maxLength": 64,
      "reference": "ORG12.location_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "bed_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "bed_status": {
      "maxLength": 64,
      "reference": "enum:bed_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "charge_item_id": {
      "maxLength": 64,
      "reference": "BIZ02.charge_item_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_licensed_capacity": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG25": {
    "bed_snapshot_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "as_of_date": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "bed_count_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "bed_count": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "calculation_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG26": {
    "org_event_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "change_type": {
      "maxLength": 64,
      "reference": "enum:change_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "effective_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "decision_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "reason": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "historical_reporting_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "migration_plan_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "ORG27": {
    "succession_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_event_id": {
      "maxLength": 64,
      "reference": "ORG26.org_event_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "from_target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "from_target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "to_target_type": {
      "maxLength": 64,
      "reference": "enum:target_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "to_target_id": {
      "maxLength": 64,
      "reference": "poly:org_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "transfer_scope": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "context_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER01": {
    "person_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_no": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "display_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "gender_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "birth_date": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "nationality_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identity_verification_status": {
      "maxLength": 64,
      "reference": "enum:verification_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identity_evidence_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_status": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER02": {
    "person_identifier_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identifier_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identifier_system": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "identifier_token": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "masked_value": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "issuer_country": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "document_valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "document_valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verification_status": {
      "maxLength": 64,
      "reference": "enum:verification_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "evidence_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER03": {
    "contact_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "contact_type": {
      "maxLength": 64,
      "reference": "enum:contact_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "contact_value": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "use_purpose": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_public": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_verified": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "preferred": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER04": {
    "employment_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_entity_id": {
      "maxLength": 64,
      "reference": "ORG01.legal_entity_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "employee_no": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "employment_type": {
      "maxLength": 64,
      "reference": "enum:employment_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "employment_status": {
      "maxLength": 64,
      "reference": "enum:employment_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "join_date": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "contract_start": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "contract_end": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "departure_date": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "hr_source_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER05": {
    "position_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "position_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "position_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "position_category": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "position_level": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "profession_type": {
      "maxLength": 64,
      "reference": "enum:profession_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "clinical_admin_class": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "qualification_requirement": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_clinical": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER06": {
    "assignment_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "employment_id": {
      "maxLength": 64,
      "reference": "PER04.employment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "org_id": {
      "maxLength": 64,
      "reference": "ORG04.org_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "position_id": {
      "maxLength": 64,
      "reference": "PER05.position_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "assignment_type": {
      "maxLength": 64,
      "reference": "enum:assignment_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_primary_hr": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "assignment_status": {
      "maxLength": 64,
      "reference": "enum:assignment_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "workload_fraction": {
      "maxLength": 8192,
      "reference": "",
      "precision": 18,
      "scale": 6,
      "int32": false
    },
    "appointment_date": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "appointment_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER07": {
    "practitioner_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "profession_type": {
      "maxLength": 64,
      "reference": "enum:profession_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "specialty_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "specialty_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "professional_status": {
      "maxLength": 64,
      "reference": "enum:verification_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "credential_owner": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "external_practitioner_no": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER08": {
    "qualification_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "certificate_kind": {
      "maxLength": 64,
      "reference": "enum:certificate_kind",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "certificate_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "certificate_no_secure_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "qualification_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "issuer": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "issued_on": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "certificate_expires_on": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verification_status": {
      "maxLength": 64,
      "reference": "enum:verification_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verified_on": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verified_by": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "evidence_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER09": {
    "registration_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "practitioner_id": {
      "maxLength": 64,
      "reference": "PER07.practitioner_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "qualification_id": {
      "maxLength": 64,
      "reference": "PER08.qualification_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "registered_entity_id": {
      "maxLength": 64,
      "reference": "ORG01.legal_entity_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "registration_no_secure_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "registration_category": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "practice_scope_code": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "practice_scope_text": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "multi_site_record_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verification_status": {
      "maxLength": 64,
      "reference": "enum:verification_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER10": {
    "practice_scope_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "registration_id": {
      "maxLength": 64,
      "reference": "PER09.registration_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "allowed_scope": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "restriction": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verification_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER11": {
    "privilege_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "practitioner_id": {
      "maxLength": 64,
      "reference": "PER07.practitioner_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "registration_id": {
      "maxLength": 64,
      "reference": "PER09.registration_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "privilege_type": {
      "maxLength": 64,
      "reference": "enum:privilege_type",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "privilege_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_entity_id": {
      "maxLength": 64,
      "reference": "ORG01.legal_entity_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "grant_status": {
      "maxLength": 64,
      "reference": "enum:grant_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "supervision_required": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "authorization_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "revoked_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "revocation_reason": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER12": {
    "title_qualification_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "title_code": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "title_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "title_level": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "acquired_on": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "qualification_id": {
      "maxLength": 64,
      "reference": "PER08.qualification_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "code_system_version": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER13": {
    "title_appointment_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "employment_id": {
      "maxLength": 64,
      "reference": "PER04.employment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "assignment_id": {
      "maxLength": 64,
      "reference": "PER06.assignment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "title_qualification_id": {
      "maxLength": 64,
      "reference": "PER12.title_qualification_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "appointed_title_code": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "appointed_title_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "appointed_level": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "appointed_on": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "appointment_doc": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER14": {
    "membership_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "team_id": {
      "maxLength": 64,
      "reference": "ORG14.team_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "practitioner_id": {
      "maxLength": 64,
      "reference": "PER07.practitioner_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "assignment_id": {
      "maxLength": 64,
      "reference": "PER06.assignment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_leader": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "outpatient_enabled": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "inpatient_enabled": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "team_role": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER15": {
    "rotation_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "from_assignment_id": {
      "maxLength": 64,
      "reference": "PER06.assignment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "to_assignment_id": {
      "maxLength": 64,
      "reference": "PER06.assignment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "rotation_purpose": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "training_program": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "supervisor_person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "plan_approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER16": {
    "supervision_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "trainee_practitioner_id": {
      "maxLength": 64,
      "reference": "PER07.practitioner_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "supervisor_practitioner_id": {
      "maxLength": 64,
      "reference": "PER07.practitioner_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "review_scope": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "review_before_effective": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref_business": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER17": {
    "account_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "account_subject": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "login_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "account_kind": {
      "maxLength": 64,
      "reference": "enum:account_kind",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "responsible_person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "account_status": {
      "maxLength": 64,
      "reference": "enum:account_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "default_unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "authentication_policy_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "must_change_initial_secret": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "disabled_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER18": {
    "iam_role_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "role_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "role_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "permission_manifest_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "risk_level": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "business_approver_role": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "separation_of_duties": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_privileged": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER19": {
    "account_grant_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "account_id": {
      "maxLength": 64,
      "reference": "PER17.account_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "iam_role_id": {
      "maxLength": 64,
      "reference": "PER18.iam_role_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "campus_id": {
      "maxLength": 64,
      "reference": "ORG02.campus_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "assignment_id": {
      "maxLength": 64,
      "reference": "PER06.assignment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "scope_expression": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "grant_status": {
      "maxLength": 64,
      "reference": "enum:grant_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ticket": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "revoked_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "grant_reason": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER20": {
    "sign_binding_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "account_id": {
      "maxLength": 64,
      "reference": "PER17.account_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "certificate_serial": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "certificate_issuer": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "certificate_fingerprint": {
      "maxLength": 128,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "cert_not_before": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "cert_not_after": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "revocation_status": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verification_time": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER21": {
    "person_map_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "from_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_entity_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_context": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_entity_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "target_id": {
      "maxLength": 64,
      "reference": "poly:person_target",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "mapping_relation": {
      "maxLength": 64,
      "reference": "enum:mapping_relation",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verified_by": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "resolution_evidence": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER22": {
    "hr_private_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "ethnicity_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "political_status_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "marital_status_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "legal_processing_basis": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "permitted_purpose": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "permitted_consumers": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "retention_rule": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER23": {
    "education_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "school_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "major_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "education_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "degree_code": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "graduation_date": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "verification_status": {
      "maxLength": 64,
      "reference": "enum:verification_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "evidence_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER24": {
    "person_event_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "person_id": {
      "maxLength": 64,
      "reference": "PER01.person_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "event_type": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "employment_id": {
      "maxLength": 64,
      "reference": "PER04.employment_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "effective_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "decision_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "affected_assignments": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "access_revocation_ticket": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "access_verified_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER25": {
    "service_profile_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "practitioner_id": {
      "maxLength": 64,
      "reference": "PER07.practitioner_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "unit_id": {
      "maxLength": 64,
      "reference": "ORG07.unit_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "public_display_name": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "public_title": {
      "maxLength": 160,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "expertise_description": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "photo_asset_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "public_profile_approval": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "search_alias": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  },
  "PER26": {
    "account_post_id": {
      "maxLength": 64,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "account_id": {
      "maxLength": 64,
      "reference": "PER17.account_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "position_id": {
      "maxLength": 64,
      "reference": "PER05.position_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "is_default": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "enabled": {
      "maxLength": 64,
      "reference": "enum:yes_no",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "sort_order": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "version_no": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": true
    },
    "valid_from": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "valid_to": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "record_status": {
      "maxLength": 64,
      "reference": "enum:record_status",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_system_id": {
      "maxLength": 64,
      "reference": "GOV01.system_id",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "source_record_id": {
      "maxLength": 256,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "approval_ref": {
      "maxLength": 2000,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    },
    "recorded_at": {
      "maxLength": 8192,
      "reference": "",
      "precision": null,
      "scale": null,
      "int32": false
    }
  }
};
