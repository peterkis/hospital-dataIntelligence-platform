# 本机 WSL2 Anolis OS 8.9 容量仿真环境

## 已建立实例

- WSL发行版：`Anolis-8.9-HDI-POC`
- 安装目录：`D:\WSL\Anolis-8.9-HDI-POC`
- 根磁盘：动态VHDX，来宾逻辑容量上限10 GiB
- 宿主盘：D盘为健康NVMe/GPT；2026-08-08 13:40:35观测剩余约14.89 GiB，运行容量实验前必须重新核验
- 资源：8个逻辑处理器、4 GiB共享WSL2内存、swap关闭
- 用户空间：Anolis OS 8.9 x86_64
- PID 1：systemd
- 时区：`Asia/Shanghai`
- 默认Linux用户：root，仅用于本机环境装配；不代表生产运维身份模型
- 当前状态：已完成Phase 01运行依赖与核心纵向切片验证；是否正在运行以实时核验结果为准

WSL 创建事实见历史[初始化回执](receipt-20260808.json)及其[SHA-256](receipt-20260808.sha256)；现行容器运行时见[Podman 迁移回执](receipt-20260830-podman.json)及其[SHA-256](receipt-20260830-podman.sha256)。环境边界见[ADR-0110](../../../docs/adr/0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)，运行时权威见[ADR-0111](../../../docs/adr/0111-use-podman-as-the-phase-01-container-runtime.md)。

## 启停

容量运行前先停止所有WSL2实例，使全局资源包络重新生效：

```powershell
wsl --shutdown
wsl -d Anolis-8.9-HDI-POC -u root -- true
wsl --list --running
```

`wsl --list --running`必须只返回`Anolis-8.9-HDI-POC`。运行结束后停止该实例：

```powershell
wsl --terminate Anolis-8.9-HDI-POC
```

不要把它设为默认发行版，也不要在容量运行期间启动`AlmaLinux-8`、`Anolis-8.9-T09`、Docker Desktop、Podman Machine或其他WSL/容器后端。

## Phase 01基础工具装配

仓库内的幂等装配脚本固定Node.js与rootful Podman版本，并通过官方SHA-256校验Node.js归档：

```powershell
wsl -d Anolis-8.9-HDI-POC -u root -- bash /mnt/d/Projects/Hospital-DataIntelligence-Platform/phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01.sh
```

Podman运行在本发行版内部，唯一兼容API为本机rootful Unix socket `/run/podman/podman.sock`；不安装Docker CLI，也不依赖Compose provider、Docker Desktop或Podman Machine。所有受管容器使用host network，并由进程显式绑定`127.0.0.1`冻结端口；禁止桥接网络、`--publish`和端口NAT。每只长期容器单独设置10 MiB日志上限。PostgreSQL和Keycloak只使用[`podman-phase-01-runtime.sh`](podman-phase-01-runtime.sh)中的完整registry digest。

若宿主机使用TUN/假IP网络而Podman API服务需要代理，可以只为当前WSL systemd运行期注入本地代理；脚本不保存代理地址或凭据，也不修改Git内配置：

```powershell
wsl -d Anolis-8.9-HDI-POC -u root -- env PODMAN_PROXY_URL=http://127.0.0.1:<本机代理端口> bash /mnt/d/Projects/Hospital-DataIntelligence-Platform/phase-plan/environment/anolis-8.9-wsl2/configure-podman-proxy.sh
```

WSL重启后该运行期变量自动消失；直接执行显式基线镜像取得时，应把同一代理值作为该条`podman pull <完整摘要>`命令的`HTTP_PROXY`/`HTTPS_PROXY`环境传入。正式运行前镜像缺失必须失败关闭，正式运行本身禁止拉取；代理和标签都不是制品身份。

实际工具版本、镜像摘要、host-network回环端口及观测容量见[`runtime-baseline.lock.json`](runtime-baseline.lock.json)。本机镜像存在后执行以下命令可在完全禁止拉取的条件下验证Node/npm、Podman、PostgreSQL、Keycloak、`pgcrypto`、`btree_gist`、数据库时区和回环绑定：

```powershell
wsl -d Anolis-8.9-HDI-POC -u root -- bash /mnt/d/Projects/Hospital-DataIntelligence-Platform/phase-plan/environment/anolis-8.9-wsl2/verify-phase-01-runtime.sh
```

## 共享资源配置

`C:\Users\zqpet\.wslconfig`当前固定：

```ini
[wsl2]
networkingMode=mirrored
memory=4GB
processors=8
swap=0
guiApplications=false

[experimental]
autoMemoryReclaim=gradual
```

这些值作用于全部WSL2发行版，不是`Anolis-8.9-HDI-POC`的私有配额。原配置已保存在`C:\Users\zqpet\.wslconfig.before-anolis-8.9-hdi-poc-20260808.bak`；恢复前必须先确认不会覆盖用户后续对`.wslconfig`的修改。

## 证据边界

- 历史WSL官方源归档（名称为来源事实，不表示现行运行时）：`AnolisOS-8.9-x86_64-docker.tar`
- 官方源归档SHA-256：`fc56aadc23ede60dcee23d81a6204334cde0c140a79b5aa23a83d40fe6517960`
- WSL配置SHA-256：`1b3e3aaa99535b1108e80fb6dc54892b26d2daf79e13706d02a7d64dd994bdd3`
- `/etc/wsl.conf` SHA-256：`ba83d197121edf71d6bd9af3674dbd45139eca03fe93d422d7339849fa0c0881`
- `/etc/wsl-distribution.conf` SHA-256：`6a88e886d6563e53a44b676c24b8cb2fd08b68ad3738d4f8383b20cd147e6917`

WSL启动器可能打印root用户级systemd会话未启动的提示；初始化核验中PID 1为systemd、系统状态为`running`且失败单元为零。容量证据只依赖系统级服务，不得把该提示隐藏为“生产服务器完全等价”。

10 GiB是来宾根块设备的逻辑容量上限，不是Windows目录的硬配额。VHDX会按写入量动态增长，且与项目制品、测试证据共同占用D盘；若容量运行前宿主盘余量不足，必须先停止，不得把宿主盘耗尽造成的失败解释为应用容量结论。

本环境已完成Podman基线、PostgreSQL 18.4扩展、Keycloak readiness、Podman socket下的Testcontainers纵向场景和仓库运行时生命周期探针。迁移后尚未启动新的readiness、正式ABG、Chrome或独立复核；既有`.runtime/evidence/`保持历史终态，当前结果不得解释为正式验收、生产容量、性能SLA或全院初始化上限。
