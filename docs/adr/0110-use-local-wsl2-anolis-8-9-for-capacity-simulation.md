---
status: accepted
extends: 0109
clarifies: 0107
related: 0068
---

# 采用本机 WSL2 Anolis OS 8.9 作为受限容量实验环境

派生交付制品的两阶段容量证据固定使用本机 WSL2 中新建且独立登记的 `Anolis-8.9-HDI-POC` 发行版作为当前实验环境。发行版安装于 `D:\WSL\Anolis-8.9-HDI-POC`，使用从 OpenAnolis 8.9 GA x86_64 官方 Docker 归档重建的干净根文件系统；源归档 SHA-256 固定为 `fc56aadc23ede60dcee23d81a6204334cde0c140a79b5aa23a83d40fe6517960`。来宾用户空间必须报告 `ID=anolis`、`VERSION_ID=8.9`、`x86_64`，PID 1 必须为 `systemd`，系统时区必须为 `Asia/Shanghai`。

当前实验资源包络固定为 8 个逻辑处理器、4 GiB WSL2 内存、关闭 swap，以及 10 GiB 来宾根块设备。根磁盘必须在创建时通过 WSL `--vhd-size 10GB` 固化，不得在实验之间扩容；磁盘压力或空间不足必须作为可解释的实验结果失败关闭，不能临时移动数据、外挂第二磁盘或清理证据后重跑。10 GiB描述的是来宾VHD的逻辑容量上限；动态VHDX在Windows宿主上的当前物理文件大小不等于逻辑容量，且VHDX元数据不受“精确10 GiB宿主目录配额”表述约束。

WSL2 的处理器、内存和 swap 由 `%UserProfile%\.wslconfig` 配置，作用域是共享的 WSL2 轻量虚拟机而非单个发行版。因此每次容量证据运行前必须先停止全部 WSL 实例，再只启动 `Anolis-8.9-HDI-POC`；运行前、运行中和运行后都必须保存 `wsl --list --running`、`.wslconfig`摘要、实际 `nproc`、`MemTotal`、swap列表和根块设备容量。任一其他发行版或 Docker Desktop WSL 后端并发运行时，该次结果不具备容量判定资格。镜像网络、GUI关闭和渐进内存回收保持本机既有设置；默认WSL发行版不因本决策改变。

容量实验实施时，治理应用、PostgreSQL 18.4和独立仿真消费者仍在同一发行版内运行并使用回环网络；Node.js 24.18.0、PostgreSQL 18.4、依赖/镜像摘要、数据库耐久性设置、代码固定点、合成画像及字段分布版本都必须进入同一环境清单。当前初始化只建立并核验操作系统与资源边界，不声称这些应用组件已经安装，也不提前执行容量实验。

本环境只能证明 Anolis OS 8.9 用户空间、systemd和受限资源下的本地POC兼容性。其内核是 Microsoft WSL2 内核，宿主资源仍可能被 Windows 进程占用；它不是独占物理服务器、Anolis原生内核、生产网络、生产存储或医院内网服务器的等价物，不得据此外推生产吞吐、SLA、全院初始化规模、部署规格或招标参数。10 GiB和4 GiB是当前合成POC的故意受限实验包络，不是未来全院容量建议。

初始化事实、配置摘要和局限性由[环境回执](../../phase-plan/environment/anolis-8.9-wsl2/receipt-20260808.json)及[操作说明](../../phase-plan/environment/anolis-8.9-wsl2/README.md)记录。该回执证明环境已经建立，不替代ADR-0107要求的前置隔离容量实验或集成后真实链路核验。重复次数、峰值RSS/磁盘余量/时间阈值、结果聚合判定、最终派生制品MiB上限和生产部署环境仍须后续逐项确认。本决策不改变Phase 01仅实现 `SNAPSHOT_PULL` 的范围，不增加ABG-01至ABG-40、72个REST或20个界面场景，也不授权提前实现 `MANAGED_EXPORT_HANDOFF`。

参考：[Microsoft WSL高级配置](https://learn.microsoft.com/windows/wsl/wsl-config)、[Microsoft自定义WSL发行版](https://learn.microsoft.com/windows/wsl/build-custom-distro)、[OpenAnolis 8.9 GA x86_64目录](https://mirrors.openanolis.cn/anolis/8.9/isos/GA/x86_64/)。
