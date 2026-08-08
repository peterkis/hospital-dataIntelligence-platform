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

机器可读事实见[初始化回执](receipt-20260808.json)，其独立摘要见[SHA-256文件](receipt-20260808.sha256)，设计边界见[ADR-0110](../../../docs/adr/0110-use-local-wsl2-anolis-8-9-for-capacity-simulation.md)。

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

不要把它设为默认发行版，也不要在容量运行期间启动`AlmaLinux-8`、`Anolis-8.9-T09`或其他WSL/Docker Desktop后端。

## Phase 01基础工具装配

仓库内的幂等装配脚本固定Node.js和Docker Engine版本，并通过官方SHA-256校验Node.js归档：

```powershell
wsl -d Anolis-8.9-HDI-POC -u root -- bash /mnt/d/Projects/Hospital-DataIntelligence-Platform/phase-plan/environment/anolis-8.9-wsl2/bootstrap-phase-01.sh
```

Docker Engine运行在本发行版内部，不依赖Docker Desktop；正式容量运行期间仍禁止启动其他WSL发行版或Docker Desktop后端。`docker-daemon.json`限制本机仿真环境的容器日志轮转，避免无界日志侵占10 GiB根磁盘。PostgreSQL和Keycloak的精确镜像及摘要由后续运行依赖清单冻结，不在本脚本中使用浮动标签。

若宿主机使用TUN/假IP网络而Docker守护进程无法直接拉取镜像，可以只为当前WSL systemd运行期注入本地代理；脚本不保存代理地址或凭据，也不修改Git内的Docker配置：

```powershell
wsl -d Anolis-8.9-HDI-POC -u root -- env DOCKER_PROXY_URL=http://127.0.0.1:<本机代理端口> bash /mnt/d/Projects/Hospital-DataIntelligence-Platform/phase-plan/environment/anolis-8.9-wsl2/configure-docker-proxy.sh
```

WSL重启后该运行期变量自动消失；只有拉取缺失镜像时才需要重新注入。正式证据必须记录镜像摘要，不能把本地代理或镜像标签当成制品身份。

实际工具版本、镜像摘要及观测容量见[`runtime-baseline.lock.json`](runtime-baseline.lock.json)。本机镜像存在后执行以下命令可在完全禁止拉取的条件下验证Node/npm、Docker、PostgreSQL、Keycloak、`pgcrypto`、`btree_gist`及数据库时区：

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

- 官方源归档：`AnolisOS-8.9-x86_64-docker.tar`
- 官方源归档SHA-256：`fc56aadc23ede60dcee23d81a6204334cde0c140a79b5aa23a83d40fe6517960`
- WSL配置SHA-256：`1b3e3aaa99535b1108e80fb6dc54892b26d2daf79e13706d02a7d64dd994bdd3`
- `/etc/wsl.conf` SHA-256：`ba83d197121edf71d6bd9af3674dbd45139eca03fe93d422d7339849fa0c0881`
- `/etc/wsl-distribution.conf` SHA-256：`6a88e886d6563e53a44b676c24b8cb2fd08b68ad3738d4f8383b20cd147e6917`

WSL启动器可能打印root用户级systemd会话未启动的提示；初始化核验中PID 1为systemd、系统状态为`running`且失败单元为零。容量证据只依赖系统级服务，不得把该提示隐藏为“生产服务器完全等价”。

10 GiB是来宾根块设备的逻辑容量上限，不是Windows目录的硬配额。VHDX会按写入量动态增长，且与项目制品、测试证据共同占用D盘；若容量运行前宿主盘余量不足，必须先停止，不得把宿主盘耗尽造成的失败解释为应用容量结论。

本环境已安装并验证Phase 01应用、PostgreSQL 18.4、Keycloak及隔离仿真消费者，核心纵向切片证据位于仓库忽略目录`.runtime/evidence/`。尚未执行容量画像，因此现有结果不得解释为生产容量、性能SLA或全院初始化上限。
