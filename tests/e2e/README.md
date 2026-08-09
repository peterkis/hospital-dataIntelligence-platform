# Phase 01 浏览器端到端验证

本工作区只承载真实浏览器场景。测试通过真实 Keycloak 重定向登录，在提交人、专业复核人和Owner终审人三个合成人员身份间受控切换，并通过同源管理界面和冻结 OpenAPI 生成客户端验证收费项目发布、完整价表发布及价格解析；不提供测试身份请求头、预置令牌或数据库旁路。

## 运行前提

- PostgreSQL、Keycloak 与 `governance-api` 已按 Phase 01 本地运行基线启动，管理界面可从 `http://127.0.0.1:3000` 访问。
- 已安装 Google Chrome 与 Microsoft Edge；Playwright 使用本机浏览器通道，不下载另一套浏览器。
- `PHASE01_E2E_PASSWORD` 只在当前进程环境中提供，不写入仓库、配置、命令脚本或测试结果。
- 正式运行前应确认本机内存充足。默认两个浏览器串行执行且 `workers=1`；资源紧张时先不启动浏览器，不得用伪造身份或缩减真实依赖来替代。

只收集并检查用例配置，不启动浏览器：

```powershell
npm run test:e2e:list
```

内存充足后执行全部本机浏览器：

```powershell
$env:PHASE01_E2E_PASSWORD = '<local-keycloak-password>'
npm run test:e2e
Remove-Item Env:PHASE01_E2E_PASSWORD
```

可用 `PHASE01_E2E_BROWSER=chrome` 或 `edge` 选择单一浏览器；`PHASE01_E2E_BASE_URL` 可覆盖服务地址。编排器默认生成唯一 `PHASE01_E2E_RUN_ID`，也可由外部显式设置；同名目录已存在时运行必须失败，不允许覆盖或补写旧结果。测试业务代码由该运行 ID 和浏览器项目名确定性派生。

## 结果边界

每次运行都在 `.runtime/e2e/<run-id>/` 创建独立目录，输出 JSON、JUnit、失败截图和失败 trace，不覆盖旧结果。该目录是本地诊断区，不是不可变证据包；trace 可能包含临时会话材料，后续证据编排不得直接归档它，也不得把密码、令牌或完整 Cookie 纳入正式证据。
