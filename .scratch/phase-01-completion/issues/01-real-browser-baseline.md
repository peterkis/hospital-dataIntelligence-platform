# 01 — 真实浏览器验证现有纵向切片

**What to build:** 让人员用户通过真实Keycloak登录和同源管理界面，完成现有收费项目发布、价表发布与价格解析，并把这条路径固化为后续任务复用的浏览器验收接缝。

**Blocked by:** None — can start immediately.

**Status:** claimed

- [ ] Playwright通过真实Keycloak重定向、Authorization Code与PKCE S256完成登录，不使用测试身份请求头或预置浏览器令牌。
- [ ] 浏览器只保存不透明服务端会话Cookie，访问令牌和刷新令牌不出现在URL、存储或前端包中。
- [ ] 管理界面只通过冻结OpenAPI生成客户端完成收费项目发布、完整价表发布和价格解析。
- [ ] CSRF缺失或伪造时写操作失败，合法请求只在服务端事务确认后显示成功。
- [ ] 场景连接真实PostgreSQL、Keycloak和治理应用，结果可追溯到发布、快照和解析证据。
- [ ] Playwright产生机器可读结果；失败时保留trace及必要截图，既有单元、集成和实时验证仍通过。

## Comments

- 2026-08-09：已认领。按冻结OpenAPI生成客户端和真实Keycloak浏览器接缝实施；重型测试受本机可用内存门禁约束。
- 2026-08-09：开发完成。已通过受影响workspace类型检查、生产构建、仓库静态门禁、OpenAPI生成/摘要/规范校验、Playwright双浏览器用例收集及结果目录不可覆盖检查；主机可用内存约1.6 GiB，真实PostgreSQL＋Keycloak＋Chrome/Edge链路和完整测试套件按用户要求暂缓，工单保持`claimed`。
