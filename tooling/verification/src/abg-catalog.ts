export interface AbgGateDefinition {
  readonly gateId: `ABG-${string}`;
  readonly title: string;
  readonly evidenceClass: 'STATIC' | 'API' | 'BROWSER' | 'DATABASE' | 'FAULT' | 'CONSUMER' | 'CAPACITY' | 'RUN';
}

const titles = [
  ['仓库、运行时与冻结依赖拓扑', 'STATIC'],
  ['空库迁移、摘要、Schema指纹和派生类型', 'DATABASE'],
  ['Asia/Shanghai无时区日期时间全链路', 'API'],
  ['Keycloak人员、服务身份与本地主体绑定', 'API'],
  ['治理对象级授权允许与拒绝矩阵', 'API'],
  ['院区范围授权与全院主权边界', 'API'],
  ['收费项目草稿增删改查与拒绝证据', 'API'],
  ['收费项目稳定身份、新版本候选与不可变发布', 'DATABASE'],
  ['收费项目双时态历史和版本差异', 'API'],
  ['价表草稿、条目修改和完整快照', 'API'],
  ['通用/专用互斥、院区范围与排他约束', 'DATABASE'],
  ['固定两级价格解析、失败关闭与证据', 'API'],
  ['CSV与JSON收费项目导入等价性', 'API'],
  ['批次内判重与稳定行身份', 'API'],
  ['行级部分成功和失败证据', 'DATABASE'],
  ['原批次幂等重试与成功行跳过', 'FAULT'],
  ['新批次同键建立版本候选', 'API'],
  ['价表条目导入和发布前冲突校验', 'API'],
  ['普通内容冻结模板与阶段顺序', 'API'],
  ['职责分离、内容漂移和终态阻断', 'API'],
  ['高风险价表专业复核和Owner终审', 'API'],
  ['院区差异价前置确认和单一Owner主权', 'API'],
  ['纯投影Schema升级同人例外与范围校验', 'API'],
  ['不兼容消费者隔离、订阅升级和原快照重放', 'CONSUMER'],
  ['紧急单人暂停追加事件和未来阻断', 'API'],
  ['暂停前历史解析与早期记录时点不变', 'DATABASE'],
  ['影响事项和非紧急操作者事后复核', 'API'],
  ['新版本补偿发布、关系和闭环恢复', 'CONSUMER'],
  ['审计多维筛选与对象级读取授权', 'API'],
  ['哈希链重算和首个篡改位置', 'DATABASE'],
  ['相同本地时间下显式序号唯一顺序', 'DATABASE'],
  ['发布逐写点原子故障矩阵', 'FAULT'],
  ['Outbox丢唤醒和数据库轮询恢复', 'FAULT'],
  ['租约回收、通知后崩溃和至少一次投递', 'FAULT'],
  ['双消费者隔离、严格下一版本和缺口阻断', 'CONSUMER'],
  ['完整未压缩快照下载、双摘要和流式客户端', 'CONSUMER'],
  ['16 MiB与16 MiB加1精确规范制品边界', 'CAPACITY'],
  ['TypeBox、OpenAPI 3.1和生成客户端唯一权威', 'STATIC'],
  ['深模块、表所有权与禁止旁路自动门禁', 'STATIC'],
  ['cleanup 后终态生命周期完整且 evidence 具备预封存资格', 'RUN'],
] as const satisfies readonly (readonly [string, AbgGateDefinition['evidenceClass']])[];

export const ABG_GATES: readonly AbgGateDefinition[] = titles.map(([title, evidenceClass], index) => ({
  gateId: `ABG-${String(index + 1).padStart(2, '0')}` as `ABG-${string}`,
  title,
  evidenceClass,
}));

if (ABG_GATES.length !== 40) throw new Error('ABG_GATE_CATALOG_MUST_CONTAIN_40_GATES');
