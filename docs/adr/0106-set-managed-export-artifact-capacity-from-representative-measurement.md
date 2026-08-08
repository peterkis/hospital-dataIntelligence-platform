---
status: accepted
extends: 0104
clarifies: 0094
related: 0105
extended_by: 0107
---

# 派生交付制品容量先测后定并超限失败关闭

完整POC的`MANAGED_EXPORT_HANDOFF`必须设置单个派生交付制品的明确硬上限，但本决策不凭经验直接指定MiB数值，也不继承Phase 01规范快照的16 MiB护栏。具体上限只能在完整POC受控导出实施前，通过代表性合成容量实验取得证据后由后续ADR冻结；未经该实验和后续决策，不得把受控导出标记为可实施或通过容量门禁。

容量计量对象是确定性ZIP已经完整形成且由制品外摘要覆盖的最终精确字节，不是`records.csv`行数、成员未打包大小、PostgreSQL物理占用、TOAST后大小、HTTP传输编码后大小或证据包压缩后大小。实验必须使用事先冻结且可重复生成的代表性合成负载画像，并至少记录最终ZIP字节数、Node.js进程峰值RSS和生成耗时、PostgreSQL写入耗时及WAL增量、平台API下载耗时与摘要核验结果，以及不可覆盖证据包的总体积。[ADR-0107](0107-use-two-stage-capacity-evidence-with-integrated-ratification.md)进一步确认实验执行载体和集成后复验规则；[ADR-0108](0108-freeze-managed-export-capacity-workload-profile-matrix.md)冻结`F00`、`N10`、`N30`、`N50`、`N100`、`W50`和`E50`七类画像、精确最终CSV数据行数、比较目的、生成输入及业务fixture隔离边界；[ADR-0109](0109-freeze-managed-export-capacity-field-distribution-rules.md)冻结普通、宽度和编码/转义画像的逐字段分布、适用字段资格，以及Unicode码点长度与最终ZIP字节计量分层；[ADR-0110](0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)冻结受限本机WSL2 Anolis OS 8.9运行环境、独占运行门禁和非生产证据边界。重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合和最终容量数值仍须逐项确认。

后续上限一经冻结，平台必须在完整ZIP与摘要形成后、成功提交事务开始前按最终精确字节检查。超过上限时作业失败关闭，不得形成`managed_export_artifact`、成功尝试、成功作业终态或可交付资格；失败尝试的临时字节仍不取得制品身份。不得通过压缩成员、分片、截断、裁剪、改换确定性表示、自动转用其他存储或临时放宽上限规避容量门禁。

如果代表性实验表明当前一次性生成、内存承载或PostgreSQL `bytea`方案不能在冻结资源与时间阈值内安全工作，必须在完整POC受控导出实施前重新确认流式生成/读取或替代存储架构，并更新相关契约、摘要作用域和证据边界；不得以完成POC为由静默改变ADR-0103、ADR-0104或本决策。本决策不确定未来全院初始化或生产环境的容量、性能SLA和存储方案，也不进入Phase 01或增加ABG、REST、界面场景编号。
