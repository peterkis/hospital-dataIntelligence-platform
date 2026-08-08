---
status: accepted
extends: 0088
clarifies: 0080
extended_by: 0090
---

# 消费者精确声明投影支持且不兼容仅阻断对应投递

每个消费者订阅必须以不可变订阅版本显式列出其支持的精确`projection_type + projection_schema_version`集合；每个组合引用平台登记的唯一Schema摘要。禁止使用`latest`、通配符、版本范围、SemVer推断、消费者运行时探测或按字段试读来声称兼容。支持集合发生变化必须形成新的订阅版本，既有发布预检和投递证据继续冻结原订阅版本。

平台在领域发布提交前，使用候选投影契约和当时适用的活动订阅版本执行本地、确定性的逐订阅兼容性预检，并随发布事实冻结预检输入、结果和规则版本；预检不调用消费者。`SUPPORTED`允许该订阅进入正常投递，`UNSUPPORTED`不阻断或回滚领域发布，而是使该消费者的投递进入明确的`BLOCKED_INCOMPATIBLE`状态并创建影响事项。被阻断投递不得进行网络调用、追加发送尝试或推进平台及消费者水位；其他兼容消费者继续独立投递。

消费者升级后必须先发布新的订阅支持版本，再通过受控重放重新校验原事件和原不可变快照。新校验及后续尝试只追加留证，原不兼容结果、影响事项、事件、快照和摘要不得覆盖。`release-distribution`不得自动降级、转换、迁移、重新解释载荷或私自选择另一投影Schema版本。[ADR-0090](0090-use-one-canonical-projection-snapshot-per-release-in-phase-01.md)进一步确认Phase 01每个发布只有一个规范投影和一个权威快照；Schema升级形成新的显式发布，不能在同一发布下复制变体。

该规则保持领域发布主权不受消费者升级节奏绑架，同时在任何不兼容内容到达消费者前失败关闭，并延续[ADR-0080](0080-run-outbox-dispatch-in-process-with-durable-polling.md)和[ADR-0086](0086-unify-release-registration-and-delivery-in-one-deep-module.md)已经确认的消费者独立投递、发布不回滚和单一深模块边界。
