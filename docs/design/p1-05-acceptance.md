# P1-05 验收矩阵与证据入口

本表说明可执行断言及证据位置，不代替最终运行结果。完成提交、候选 tree、最终审阅及持久库运行索引见 ignored handoff；历史 RED、环境失败和 GREEN 均保留在 `.runtime/vnext/p1-05-*.log`。

| 门禁 | 断言位置/方法 |
|---|---|
| AC-01 | `p1-05-db.test.ts`：同一单元 12 命令产生 1 主体、3 院区、3 关系；关系读取确认主体 ID 一致 |
| AC-02 | 第三关系写入、最终成功审计的故障注入，前后领域/授权转换/子命令/outcome 计数不变；HTTP 错误第三关系不进入应用 |
| AC-03 | 两连接同请求、原请求重放、真实 HTTP 提交后 socket 丢失、无密钥恢复返回相同 IDs；变更清单同请求冲突 |
| AC-04 | UUID 外观 JOB_ALIAS 仍生成新身份；错误 PLATFORM_REF 与原文不一致阻断；没有名字匹配或跨任务别名查找 |
| AC-05 | 批准后引用证照撤销，整包 stale，院区/关系/子命令/成功提交数量不变 |
| 文件安全 | P1-05 unit 与既有 parser 回归：关系定位、乱序工作表、隐藏/重复表、公式、原始坐标、偏移/前导零；原 STRICT_V1/V2 不变 |
| 条件和字段 | 19/17/15 完整契约及字段采纳表；原字段类型/长度；SRC-COND-001–007 的 Owner 准入和独立核验门禁 |
| 许可和时态 | 既有部分范围核验失败；第二证照与相邻独立范围接续成功；半开/微秒与 B/R 复用已回归的 Owner 算法 |
| 状态 | 新院区筹建；已有院区明确引用修订保留 ID；停用声明不能通过资料修订夹带；关系成立仍不使运营窗口获准 |
| 核验 | 同 underlying identity 别名自核验拒绝；准确材料成功读取后才可核验；核验和整包审批分别记录 |
| 授权 | 配对 A 的只读人员不获得 B 或 WRITE；子表保护权限撤回后整份原文件拒绝；实际 NORTH/SOUTH 维度逐项核权 |
| revision | 更新三表契约绑定保持 job ID、更换 revision；重新预授权与核验；文件 CORE 不降级为单表 CSV |
| SQL | 应用角色直接 DML、伪造签名/会话上下文、从整包作业调用单行手工 stage 均拒绝 |
| 质量账本 | 签名解析与校验使用公共账本；结构拒绝保留失败证据；同物理行号按真实工作表区分 |
| 工程 | fresh、0064 前缀升级、既有数据保留、类型生成/验证、生成客户端真实 HTTP、模块边界与受影响公共/P1 回归 |

持久库验收由 `prototype:db:with -- vnext:p1-05:deploy` 执行：核对 receipt/OID、原账本和旧行摘要，追加前向迁移、最小服务函数授权、派生签名权威及明确 DEMO 预授权，再经生成客户端上传、核验、批准、应用、重试和拒绝错误整包。必须保留 READY、目标 exit 0、cleanupPassed=true；脚本准备好不等于部署通过。

范围状态：UI、实际服务重启验收、正式验收均为 NOT_RUN；FULL、非本票策略/模板的组织组合、批量生命周期、真实医院采纳继续不就绪。没有新建维护页面，没有进入 P1-06/P1-07。

## 本地验证记录（2026-09-23）

| 检查 | 结果 | 日志（`.runtime/vnext/`） |
|---|---|---|
| P1-05 fresh | 28/28 PASS；READY/exit 0/cleanup true | `p1-05-review2-green.log` |
| P1-05 unit | 4/4 PASS | `p1-05-final-unit.log` |
| 全仓 typecheck | exit 0 | `p1-05-final-repo-typecheck.log` |
| OpenAPI/client 重新生成 | exit 0，产物无新增差异 | `p1-05-final-codegen.log` |
| 模块与当前院区引用边界 | PASS | `p1-05-final-boundaries.log`、`p1-05-final-reference-boundaries.log` |
| P1-01 / P1-03 / P1-04 | 28/16/20 PASS | `p1-05-final-regression-vnext-p1-0{1,3,4}-validate.log` |
| P1-02 | 36 PASS；本次相关 Owner 接线回归 | `p1-05-regression-p1-02.log` |
| 文件 / 校验 / 质量 / Apply | 12/18/28/18 PASS | `p1-05-final-regression-vnext-{files-validate,validation-fresh,quality-fresh,apply-fresh}.log` |

上述数据库成功运行均记录 READY、目标 exit 0 和 cleanupPassed=true。两轮审阅发现的权限与准入问题均保留新增反例的实际 RED 和后续 GREEN；`p1-05-review2-red.log` 为最后两项缺陷的 26 PASS/2 FAIL，不能当作成功证据。固定代码 tree `43ec26c789b4d506ef9e189355653e527643faa3` 的 Spec/Standards 均无未解决 P0/P1/P2；最终提交绑定见交接。


0064→0069 最终前缀升级：28/28 PASS，原前缀及数据摘要保持，见 `p1-05-final-upgrade.log`。唯一持久研发库部署：PASS，OID `206108` 不变、原 64 项迁移 checksum/旧行/原密钥摘要保持。生成客户端真实 HTTP 完成整包上传、独立核验、审批、原子应用、ACK 丢失恢复与相同 IDs 重放；1 主体、3 院区、3 关系成功，错误第三关系整包无领域/授权转换/outcome 增量。

持久证据：`.runtime/vnext/p1-05/deployment-1790101411963.{before,migration,result}.json`、同前缀 `.events.jsonl`，wrapper 日志 `p1-05-persistent-deploy.log` 具有 READY、目标 exit 0、cleanupPassed=true。适用本票 DOMAIN 门禁及 AC-01–05 完成；以上不表示真实医院采纳、UI、服务重启或正式验收通过。
