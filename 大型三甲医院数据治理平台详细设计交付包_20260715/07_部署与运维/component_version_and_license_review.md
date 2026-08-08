# 开源组件版本、许可证与供应链安全复核清单

本文件不锁定具体版本。招标/采购和每次升级前，必须针对候选版本重新验证以下项目。

| 组件 | 建议角色 | 复核重点 |
|---|---|---|
| Kubernetes | 容器编排 | 支持周期、CNI/CSI、国产OS/CPU兼容、升级跨度 |
| Kafka KRaft | 事件总线 | 控制器与Broker分离、客户端兼容、Schema、ACL、Mirror |
| NiFi | 医疗接口/数据流 | 集群、Provenance、插件CVE、流版本化、队列磁盘 |
| SeaTunnel | 批量同步 | 目标数据库连接器、断点续传、回灌限速 |
| Debezium/Flink CDC | CDC | Oracle/SQL Server/国产库支持、DDL/LOB、许可证与驱动 |
| PostgreSQL/Patroni | 事务数据库 | 扩展、驱动、fencing、WAL、备份恢复 |
| Ceph | 对象存储 | 硬件兼容、EC/副本、RGW Multisite、运维能力 |
| Iceberg/Trino | 湖仓与查询 | Catalog、对象存储、Schema演进、小文件与引擎兼容 |
| Doris（既有） | 服务加速 | 当前版本生命周期、滚动/蓝绿升级、数据对账、退出路线 |
| OpenMetadata/DataHub | 元数据目录 | Connector版本、数据库/OpenSearch依赖、中文化与权限 |
| GX/Soda | 质量执行 | 开源版边界、规则可移植、证据和工作流集成 |
| Keycloak | IAM | HA、缓存、数据库、会话/令牌、升级和事件日志 |
| APISIX/OPA | 网关与策略 | etcd HA、OIDC、插件供应链、策略测试与回滚 |
| Flowable | 治理流程 | 社区版功能、表单/流程版本、数据库兼容 |
| OpenSearch | 审计检索 | 许可证、分片/快照、插件、版本兼容与保留成本 |
| Zingg/Splink/OpenEMPI | 实体解析 | 许可证、社区活跃、可解释性、医疗适配、误合并风险 |

## 必须产出

- 软件物料清单SBOM、许可证清单、CVE扫描、签名与来源证明；
- 版本兼容矩阵、PoC报告、性能与恢复测试；
- 社区/厂商支持与退出方案；
- 配置、规则、脚本、Connector源码和构建制品的医院可控托管；
- 升级前后数据、接口、Schema、审计与回退验证。
