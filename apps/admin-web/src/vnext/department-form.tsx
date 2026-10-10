import { useEffect, useRef, useState, type ReactNode } from "react";
import { Field, displayTime } from "./workspace-fields.js";
import { encodeWorkbenchFile } from "./workbench-file.js";

export interface FormSchema {
  type?: string;
  const?: unknown;
  enum?: readonly unknown[];
  anyOf?: readonly FormSchema[];
  properties?: Readonly<Record<string, FormSchema>>;
  required?: readonly string[];
  items?: FormSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
}
export interface ReferenceChoice {
  value: string;
  label: string;
  owner?: string;
  version?: string;
  versionId?: string;
}
export type ReferenceChoices = Readonly<
  Record<string, readonly ReferenceChoice[]>
>;
export const fieldLabels: Record<string, string> = {
  id: "对象",
  owner: "责任领域",
  kind: "类别",
  campus: "治理院区",
  profile: "来源契约",
  payload: "维护内容",
  entries: "来源条目",
  row: "来源记录",
  intent: "维护动作",
  target: "目标对象",
  origin: "来源类别",
  evidenceId: "证据材料",
  requestId: "请求标识",
  jobId: "导入任务",
  revisionId: "任务修订",
  inputId: "核验申请",
  inputDigest: "输入摘要",
  candidateId: "变更候选",
  maker: "提交身份",
  approvedBy: "批准身份",
  currentSchema: "符合当前契约",
  structuralStatus: "文件结构结果",
  issues: "检查问题",
  draft: "私有草稿",
  view: "冻结视图",
  viewState: "视图当前治理状态",
  facts: "已提交事实",
  diff: "候选变更对照",
  basis: "版本与证据依据",
  contract: "契约依据",
  schemas: "契约结构",
  definition: "完整契约定义",
  sourcePolicies: "来源处理策略",
  commandFacts: "已核对领域命令",
  closureId: "关闭事实",
  canWrite: "当前可维护",
  canReview: "当前可审批",
  inputCoverage: "输入覆盖",
  responseStatus: "响应交付状态",
  contentDigest: "冻结内容摘要",
  selectionPolicy: "冻结版本选择规则",
  digest: "候选摘要",
  expectedVersion: "预期版本",
  expectedHead: "预期记录头",
  expectedLifecycleHead: "预期生命周期头",
  version: "版本",
  versionId: "准确版本",
  fromVersion: "起始版本",
  toVersion: "目标版本",
  after: "继续读取游标",
  afterId: "继续读取游标",
  afterVersion: "继续读取版本",
  limit: "每页数量",
  recordAsOf: "记录时点 R",
  businessAt: "业务时点 B",
  validFrom: "业务起始时间",
  validTo: "业务结束时间",
  valid_from: "业务起始时间",
  valid_to: "业务结束时间",
  recordedAt: "平台记录时间 R",
  recorded_at: "来源记录时间",
  recordedFrom: "平台记录时间 R",
  sourceRecordedAt: "来源记录时间",
  reason: "理由",
  action: "动作",
  state: "状态",
  status: "状态",
  recordStatus: "来源记录状态",
  record_status: "来源记录状态",
  timePolicy: "来源时间口径",
  sourceArtifactId: "原始文件证据",
  sourceSystemId: "来源系统",
  source_system_id: "来源系统",
  sourceRecordId: "来源记录定位",
  source_record_id: "来源记录定位",
  approvalRef: "来源批准依据",
  approval_ref: "来源批准依据",
  sourceVersion: "来源版本",
  version_no: "来源版本",
  sourceClientKey: "来源稳定键",
  org_id: "来源行键",
  org_code: "院内科室编码",
  org_name: "科室名称",
  org_short_name: "简称",
  org_type: "科室类型",
  established_on: "成立日期",
  abolished_on: "来源撤销日期",
  establishment_doc: "成立依据",
  description: "职责说明",
  is_virtual: "是否虚拟",
  mapping: "映射目标版本",
  org_map_id: "映射来源行键",
  from_system_id: "外部来源系统",
  source_entity_type: "来源实体类型",
  source_code: "外部编码",
  source_name: "来源名称",
  source_context: "来源上下文",
  target_type: "目标类型",
  target_id: "目标对象",
  mapping_relation: "映射关系",
  resolution_rule: "解析规则",
  verified_by: "来源核验人",
  fromSystemId: "外部来源系统",
  sourceEntityType: "来源实体类型",
  sourceCode: "外部编码",
  sourceContext: "来源上下文",
  contextApproved: "上下文已核验",
  sourceKeyReuse: "已核验来源键复用",
  identifier: "标识目标版本",
  org_identifier_id: "标识来源行键",
  identifier_kind: "标识类别",
  identifier_system: "标识命名空间",
  identifier_value: "标识内容",
  language: "语言",
  is_preferred: "是否首选",
  scheme: "标识命名空间",
  value: "标识内容",
  policyApproved: "政策已核验",
  targetType: "目标类型",
  targetId: "目标对象",
  viewId: "层级视图",
  viewCode: "视图编码",
  viewName: "视图名称",
  viewType: "视图类型",
  parentCardinality: "父子约束",
  purpose: "视图用途",
  aggregationRule: "聚合规则",
  ownerDepartmentId: "责任科室",
  nodes: "整树节点",
  nodeKey: "节点稳定键",
  parentNodeKey: "父节点稳定键",
  nodeKind: "节点类型",
  departmentId: "科室身份",
  departmentVersionId: "准确科室版本",
  groupCode: "分组编码",
  groupId: "分组身份",
  groupVersionId: "准确分组版本",
  displayName: "冻结显示名称",
  relationName: "关系名称",
  sortOrder: "排序",
  isPrimaryPath: "主路径",
  sourceEvidence: "关系来源证据",
  dependencies: "FULL 引用",
  dataset: "来源数据集",
  snapshot: "冻结快照",
  leftVersion: "左侧版本",
  rightVersion: "右侧版本",
  event: "演化事件",
  org_event_id: "演化来源键",
  change_type: "演化类型",
  effective_at: "生效时间",
  decision_ref: "正式决定依据",
  historical_reporting_rule: "历史统计规则",
  migration_plan_ref: "迁移计划依据",
  relations: "承继关系",
  succession_id: "承继来源键",
  from_target_type: "前驱类型",
  from_target_id: "前驱对象",
  to_target_type: "后继类型",
  to_target_id: "后继对象",
  transfer_scope: "转移范围",
  context_rule: "上下文规则",
  predecessors: "前驱科室",
  successors: "后继科室",
  rename: "同身份改名",
  name: "名称",
  shortName: "简称",
  contracts: "配套契约",
  successionContractId: "承继契约",
  successionContractVersionId: "承继契约版本",
  departmentContractId: "科室契约",
  departmentContractVersionId: "科室契约版本",
  decisionEvidenceId: "决定证据",
  migrationEvidenceId: "迁移证据",
  contextEvidenceId: "上下文证据",
  impacts: "影响声明",
  domain: "影响领域",
  determination: "影响判定",
  ownerRole: "责任角色",
  ownerSignatory: "责任签署人",
  ownerDecisionRef: "责任签署依据",
  requiredAction: "要求的处置",
  materialsAccepted: "材料已核验",
  impactReviews: "影响独立核验",
  ownerAttestationAccepted: "已核对责任签署",
  dispositionAccepted: "已核对处置",
  impactAssessment: "准确影响评估",
  compensatesEvent: "正向补偿的原事件",
  campusChanges: "院区关系调整",
  commands: "维护命令",
  department: "科室及准确版本",
  effectiveAt: "生效时间",
  subject: "法人主体",
  destination: "目标院区及主体",
  services: "服务范围",
  relation: "院区关系及准确版本",
  campusId: "院区",
  relationId: "院区关系",
  rows: "逐行核验",
  disposition: "处置方式",
  historicalException: "历史缺失依据例外",
  rowNumber: "行号",
  assessmentId: "影响评估",
  eventId: "事件",
  caseId: "影响案件",
  responsibilityId: "责任分配依据",
  proposalEventId: "处置提案",
  result: "准确已提交结果",
  oldRelation: "原关系处置",
  consumers: "接收服务身份",
  consumerActor: "回执服务身份",
  outcome: "回执结果",
  receiptRef: "回执依据",
  simulated: "合成回执",
  head: "当前记录头",
  obligation: "影响义务",
  remainingSpans: "仍未解决的期间",
  affectedSpans: "受影响期间",
  coverage: "评估覆盖范围",
  references: "准确引用",
  from: "起始时间",
  to: "结束时间",
  change: "当前变化",
  constraint: "约束结果",
  frozenLabel: "冻结名称",
  current: "当前引用",
  items: "记录",
  total: "总数",
  unresolved: "未解决",
  simulatedCompleted: "合成完成",
  history: "历史",
  handoffs: "合成服务交接",
  metadata: "文件声明",
  bytesBase64: "导入文件",
  fileRequestId: "文件请求标识",
  job: "导入任务声明",
  scope: "环境范围",
  contractId: "已发布契约",
  contractVersionId: "准确契约版本",
  retentionSeconds: "材料保留秒数",
  input: "任务来源声明",
  declaredSha256: "声明文件摘要",
};
const vocabulary: Record<string, string> = {
  CORE: "CORE 独立来源",
  FULL: "FULL（依赖未就绪）",
  NORTH: "北院区",
  SOUTH: "南院区",
  CREATE: "新建",
  REVISE: "修订",
  REGISTER: "登记",
  CORRECT: "更正",
  RETRACT: "撤回",
  END: "结束",
  CHANGE: "变更",
  CLOSE: "关闭",
  REVOKE: "撤销",
  ASSIGN: "分配",
  MOVE: "转移",
  SUSPEND: "暂停",
  RESUME: "恢复",
  DEPRECATE: "废弃",
  RENAME: "同身份改名",
  SPLIT: "拆分",
  MERGE: "合并",
  NEW: "新建来源",
  HISTORICAL: "历史来源",
  ACTIVE: "有效",
  DRAFT: "草稿",
  REVIEW: "审核中",
  RETIRED: "已退役",
  DEPARTMENT: "科室",
  GROUP: "视图分组",
  ADMINISTRATIVE: "行政视图",
  OPERATIONAL: "业务视图",
  MEDICAL_RECORD: "病历视图",
  FINANCE: "财务",
  STATISTICAL: "统计视图",
  STRICT_TREE: "严格树",
  LOCAL: "本地时间",
  SOURCE_OFFSET_08: "来源东八区时间",
  Y: "是",
  N: "否",
  ORG: "科室",
  LEGAL: "法人主体",
  CAMPUS: "院区",
  INPUT: "核验申请",
  EVENT: "已保存事件",
  AFFECTED: "受影响",
  UNAFFECTED: "不受影响",
  UNKNOWN: "尚未判定",
  KEEP_HISTORY: "保留历史",
  CLOSE_RELATION: "关闭关系",
  NEW_RELATION: "建立后继关系",
  MIGRATE_EXTERNAL: "外部迁移",
  SOURCE_MAPPING: "来源映射",
  IDENTIFIER: "标识",
  HIERARCHY: "层级",
  CAMPUS_RELATION: "院区关系",
  PERSONNEL: "人员",
  PATIENT: "患者",
  ACCOUNT: "账户",
  INVENTORY: "库存",
  CONSUMER: "消费方",
  SYNTHETIC: "合成环境",
  SIMULATED_COMPLETED: "合成完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
  SYNTHETIC_ALIAS: "合成别名",
  SYNTHETIC_DEPARTMENT_CODE: "合成院内科室码",
  SYNTHETIC_FORMER_NAME: "合成旧名称",
  SYNTHETIC_SEARCH_CODE: "合成检索码",
};
export const human = (value: unknown): string =>
  typeof value === "string"
    ? (vocabulary[value] ?? displayTime(value))
    : value === null
      ? "无"
      : String(value);
export function initialForm(schema: FormSchema): unknown {
  if(schema.type==='boolean')return false;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) {
    const nullable = schema.anyOf.find((branch) => branch.type === "null");
    return initialForm(nullable ?? schema.anyOf[0]!);
  }
  if (schema.type === "null") return null;
  if (schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([key]) => schema.required?.includes(key))
        .map(([key, child]) => [key, initialForm(child)])
        .filter(([, value]) => value !== undefined),
    );
  if (schema.type === "array")
    return Array.from({ length: schema.minItems ?? 0 }, () =>
      initialForm(schema.items!),
    ).filter((value) => value !== undefined);
  if (schema.type === "integer" || schema.type === "number")
    return schema.minimum ?? 0;
  return schema.minLength || schema.pattern ? undefined : "";
}
/** Restore fixed vocabulary omitted by an incomplete draft; never infer a union discriminator. */
export function fixedForm(schema: FormSchema, value: unknown): unknown {
  if(schema.type==='boolean')return value;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length === 1) return schema.enum[0];
  if (schema.anyOf) {
    const selected = schema.anyOf.find((branch) =>
      branchMatches(branch, value),
    );
    return selected ? fixedForm(selected, value) : value;
  }
  if (Array.isArray(value) && schema.items)
    return value.map((item) => fixedForm(schema.items!, item));
  if (schema.properties && value && typeof value === "object") {
    const data = { ...object(value) };
    for (const [key, child] of Object.entries(schema.properties)) {
      if (
        Object.hasOwn(data, key) ||
        child.const !== undefined ||
        child.enum?.length === 1
      )
        data[key] = fixedForm(child, data[key]);
    }
    return data;
  }
  return value;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const branchMatches = (schema: FormSchema, value: unknown): boolean =>
  schema.const !== undefined
    ? schema.const === value
    : schema.enum
      ? schema.enum.includes(value)
      : schema.properties
        ? Object.entries(schema.properties)
            .filter(([, child]) => child.const !== undefined || child.enum)
            .every(([key, child]) => branchMatches(child, object(value)[key]))
        : schema.type === "null"
          ? value === null
          : schema.type === typeof value;
export function DepartmentForm({
  schema,
  value,
  onChange,
  choices = {},
  disabled = false,
  label = "维护内容",
  field = "",
  root = value,
  preserveTimePrecision=false,
  labels={},
  resolveReferenceChoices,
  bindReferenceSelection,
}: {
  schema: FormSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  choices?: ReferenceChoices;
  disabled?: boolean;
  label?: string;
  field?: string;
  root?: unknown;
  preserveTimePrecision?:boolean;
  labels?:Readonly<Record<string,string>>;
  resolveReferenceChoices?:((field:string,root:Readonly<Record<string,unknown>>)=>readonly ReferenceChoice[]|undefined)|undefined;
  bindReferenceSelection?:((schema:FormSchema,field:string,value:Readonly<Record<string,unknown>>)=>Readonly<Record<string,unknown>>)|undefined;
}) {
  const child = (
    childSchema: FormSchema,
    item: unknown,
    change: (next: unknown) => void,
    key: string,
  ): ReactNode => (
    <DepartmentForm
      schema={childSchema}
      value={item}
      onChange={change}
      choices={choices}
      disabled={disabled}
      label={labels[key]??fieldLabels[key] ?? key}
      field={key}
      root={root}
      preserveTimePrecision={preserveTimePrecision}
      labels={labels}
      resolveReferenceChoices={resolveReferenceChoices}
      bindReferenceSelection={bindReferenceSelection}
    />
  );
  if (schema.anyOf) {
    const primitives = schema.anyOf.every(
      (branch) => branch.const !== undefined || branch.enum,
    );
    if (primitives) {
      const options = schema.anyOf.flatMap(
        (branch) => branch.enum ?? [branch.const],
      );
      return (
        <label>
          {label}
          <select
            aria-label={label}
            disabled={disabled}
            value={String(value ?? "")}
            onChange={(event) =>
              onChange(
                options.find((option) => String(option) === event.target.value),
              )
            }
          >
            <option value="">请选择</option>
            {options.map((option) => (
              <option key={String(option)} value={String(option)}>
                {human(option)}
              </option>
            ))}
          </select>
        </label>
      );
    }
    const nullable = schema.anyOf.find((branch) => branch.type === "null"),
      branches = schema.anyOf.filter((branch) => branch.type !== "null");
    const selected =
      branches.find((branch) => branchMatches(branch, value)) ?? branches[0]!;
    if (nullable)
      return (
        <fieldset className="form-object">
          <legend>{label}</legend>
          <label>
            <input
              type="checkbox"
              checked={value !== null && value !== undefined}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked ? (initialForm(selected) ?? "") : null,
                )
              }
            />
            填写{label}（未填写表示无界或新建对象）
          </label>
          {value !== null &&
            value !== undefined &&
            child(selected, value, onChange, field)}
        </fieldset>
      );
    return (
      <fieldset className="form-object">
        <legend>{label}</legend>
        <label>
          {label}类别
          <select
            aria-label={label + "类别"}
            disabled={disabled}
            value={branches.indexOf(selected)}
            onChange={(event) =>
              onChange(initialForm(branches[Number(event.target.value)]!))
            }
          >
            {branches.map((branch, index) => {
              const option = Object.values(branch.properties ?? {}).find(
                (item) => item.const !== undefined || item.enum,
              );
              return (
                <option key={index} value={index}>
                  {human(option?.const ?? option?.enum?.[0] ?? index + 1)}
                </option>
              );
            })}
          </select>
        </label>
        {child(selected, value, onChange, field)}
      </fieldset>
    );
  }
  if (schema.properties) {
    const data = {...object(value)};
    const ownerSchema=schema.properties['owner'],fixedOwner=ownerSchema?.const??(ownerSchema?.enum?.length===1?ownerSchema.enum[0]:undefined);
    if(typeof fixedOwner==='string'&&data['owner']===undefined)data['owner']=fixedOwner;
    return (
      <fieldset className="form-object">
        <legend>{label}</legend>
        <div className="workspace-form">
          {Object.entries(schema.properties)
            .filter(([key]) => !["requestId", "fileRequestId"].includes(key)&&!(key==='owner'&&typeof fixedOwner==='string'))
            .map(([key, item]) => (
              <div className="form-field" key={key} data-field={key}>
                <DepartmentForm
                  schema={item}
                  value={data[key]}
                  onChange={(next) => {
                    const updated = { ...data };
                    if (next === undefined) delete updated[key];
                    else updated[key] = next;
                    if (
                      key === "id" &&
                      typeof next === "string" &&
                      typeof data["owner"] === "string"
                    ) {
                      const ref = choices[data["owner"]]?.findLast(
                        (option) => option.value === next,
                      );
                      if (
                        ref?.version &&
                        schema.properties?.["expectedVersion"]
                      )
                        updated["expectedVersion"] = ref.version;
                      if(ref?.version&&schema.properties?.['expectedHead'])updated['expectedHead']=ref.version;
                      if(ref?.version&&schema.properties?.['version'])updated['version']=ref.version;
                      if(ref?.versionId&&schema.properties?.['versionId'])updated['versionId']=ref.versionId;
                    }
                    onChange(bindReferenceSelection?.(schema,key,updated)??updated);
                  }}
                  choices={choices}
                  resolveReferenceChoices={resolveReferenceChoices}
                  bindReferenceSelection={bindReferenceSelection}
                  disabled={disabled}
                  label={
                    key === "recordedAt" &&
                    schema.properties?.["sourceSystemId"]
                      ? "来源记录时间"
                      : (labels[key]??fieldLabels[key] ?? key)
                  }
                  field={key}
                  root={data}
                  preserveTimePrecision={preserveTimePrecision}
                  labels={labels}
                />
              </div>
            ))}
        </div>
      </fieldset>
    );
  }
  if (schema.type === "array") {
    const data = Array.isArray(value) ? value : [];
    return (
      <fieldset className="form-array">
        <legend>{label}</legend>
        {data.map((item, index) => (
          <section className="form-row" key={index} data-row={index+1} data-array-field={field}>
            <h4>
              {label} · {index + 1}
            </h4>
            {child(
              schema.items!,
              item,
              (next) =>
                onChange(data.map((old, at) => (at === index ? next : old))),
              field,
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(data.filter((_, at) => at !== index))}
            >
              移除此条目
            </button>
          </section>
        ))}
        <button
          type="button"
          disabled={disabled || data.length >= (schema.maxItems ?? 100)}
          onClick={() => onChange([...data, initialForm(schema.items!)])}
        >
          添加{label}
        </button>
      </fieldset>
    );
  }
  if (schema.const !== undefined)
    return (
      <p>
        {label}：{human(schema.const)}
      </p>
    );
  if (schema.type === "boolean")
    return <label className="confirmation"><input type="checkbox" checked={value===true} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>{label}</label>;
  if (schema.enum)
    return (
      <label>
        {label}
        <select
          aria-label={label}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(event) =>
            onChange(
              schema.enum!.find((item) => String(item) === event.target.value),
            )
          }
        >
          <option value="">请选择</option>
          {schema.enum.map((item) => (
            <option key={String(item)} value={String(item)}>
              {human(item)}
            </option>
          ))}
        </select>
      </label>
    );
  if (field === "bytesBase64"||field==='contentBase64')
    return (
      <DepartmentFileInput
        label={label}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  let options = choices[field];
  if (field === "id") {
    const owner = object(root)["owner"];
    options = owner ? choices[String(owner)] : choices["objects"];
  }
  if((field==='version'||field==='versionId')&&typeof object(root)['owner']==='string'){
    const data=object(root),available=choices[String(data['owner'])];
    if(available)options=available.filter(choice=>choice.value===data['id']).map(choice=>({value:field==='versionId'?choice.versionId??'':choice.version??'',label:choice.label})).filter(choice=>choice.value);
  }
  if (field === "target_id") {
    const target = object(root)["target_type"];
    options = target ? choices[String(target)] : choices["ORG"];
  }
  if (field === "from_target_id" || field === "to_target_id") {
    const type =
      object(root)[
        field === "from_target_id" ? "from_target_type" : "to_target_type"
      ];
    options = typeof type === "string" ? choices[type] : [];
  }
  if (field === "identifier_system" || field === "scheme")
    options = [
      "SYNTHETIC_DEPARTMENT_CODE",
      "SYNTHETIC_ALIAS",
      "SYNTHETIC_FORMER_NAME",
      "SYNTHETIC_SEARCH_CODE",
    ].map((value) => ({ value, label: human(value) }));
  const resolvedChoices=resolveReferenceChoices?.(field,object(root));
  if(resolvedChoices!==undefined)options=resolvedChoices;
  if (options)
    return (
      <label>
        {label}
        <select
          aria-label={label}
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">请选择</option>
          {Boolean(value) &&
            !options.some((option) => option.value === value) && (
              <option value={String(value)}>
                原准确引用 · {String(value)}
              </option>
            )}
          {[...new Map(options.map(option=>[option.value,option])).values()].map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  const numeric = schema.type === "integer" || schema.type === "number";
  return (
    <Field
      label={label}
      value={value === undefined ? "" : String(value)}
      onChange={(next) =>
        onChange(
          next === ""
            ? schema.minLength || schema.pattern || numeric
              ? undefined
              : ""
            : numeric
              ? Number(next)
              : next,
        )
      }
      disabled={disabled}
      type={numeric ? "number" : "text"}
      time={!preserveTimePrecision&&/^(validFrom|validTo|valid_from|valid_to|businessAt|recordAsOf|recordedAt|recorded_at|effectiveAt|effective_at|from|to)$/.test(
        field,
      )}
    />
  );
}
export function DepartmentData({
  value,
  label = "结果",
  onSelect,
}: {
  value: unknown;
  label?: string;
  onSelect?: (record: Record<string, unknown>) => void;
}) {
  if (Array.isArray(value))
    return value.length ? (
      <div className="data-array">
        {value.map((item, index) => (
          <DepartmentData
            key={index}
            value={item}
            label={label + " · " + (index + 1)}
            {...(onSelect ? { onSelect } : {})}
          />
        ))}
      </div>
    ) : (
      <p>{label}：无记录</p>
    );
  if (value && typeof value === "object")
    return (
      <section className="data-record">
        <h4>{label}</h4>
        {onSelect &&
          Object.keys(value).some((key) =>
            ["id", "viewId", "candidateId", "caseId", "inputId"].includes(key),
          ) && (
            <button onClick={() => onSelect(recordValue(value))}>
              使用此准确记录
            </button>
          )}
        <dl>
          {Object.entries(value)
            .filter(
              ([key]) =>
                key !== "bytesBase64" &&
                !(key === "recordedAt" && "sourceRecordedAt" in value),
            )
            .map(([key, item]) => (
              <div key={key}>
                <dt>{fieldLabels[key] ?? key}</dt>
                <dd>
                  {item && typeof item === "object" ? (
                    [
                      "basis",
                      "contract",
                      "schemas",
                      "definition",
                      "sourcePolicies",
                    ].includes(key) ? (
                      <details>
                        <summary>{fieldLabels[key] ?? key}</summary>
                        <DepartmentData
                          value={item}
                          label={fieldLabels[key] ?? key}
                          {...(onSelect ? { onSelect } : {})}
                        />
                      </details>
                    ) : (
                      <DepartmentData
                        value={item}
                        label={fieldLabels[key] ?? key}
                        {...(onSelect ? { onSelect } : {})}
                      />
                    )
                  ) : (
                    human(item)
                  )}
                </dd>
              </div>
            ))}
        </dl>
      </section>
    );
  return (
    <p>
      {label}：{human(value)}
    </p>
  );
}
function recordValue(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
function DepartmentFileInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setBusy(false);
    return () => {
      epoch.current++;
    };
  }, [onChange]);
  return (
    <label>
      {label}
      <input
        type="file"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const token = epoch.current;
          setBusy(true);
          setError("");
          void encodeWorkbenchFile(file)
            .then((bytes) => {
              if (token === epoch.current) onChange(bytes);
            })
            .catch((error) => {
              if (token === epoch.current)
                setError(
                  error instanceof Error ? error.message : "文件读取失败",
                );
            })
            .finally(() => {
              if (token === epoch.current) setBusy(false);
            });
        }}
      />
      {typeof value === "string" && value.length > 0 && (
        <small>文件已读取，提交时保存原始证据</small>
      )}
      {error && <span role="alert">{error}</span>}
    </label>
  );
}
