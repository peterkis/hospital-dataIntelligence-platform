---
status: accepted
extends: 0069
supersedes: 0021
clarifies: 0074
---

# Keycloak认证与平台对象级授权分离

Phase 01精确采用Keycloak 26.7.0作为独立验证身份提供方，并在证据基线中冻结镜像摘要；不连接医院AD、LDAP、统一身份、CA或正式单点登录。Keycloak使用与治理Schema隔离的厂商数据库边界，只负责人员和服务身份的认证、会话及标准令牌签发，不承载人员主数据、治理角色、治理对象权限或院区授权。现有Fastify模块化单体是唯一OIDC机密客户端和认证适配器：人员登录使用Authorization Code与PKCE S256，令牌只保留在受控服务端，浏览器只持有安全的不透明会话Cookie且不新增第二个BFF；应用服务和每个仿真消费者分别使用独立机密客户端及Client Credentials。平台仅依据已验证的发行者与外部主体或客户端标识显式绑定本地安全主体，并在每次命令和查询中按治理对象、操作、院区范围及有效期执行本地授权和职责分离，不按姓名、工号、邮箱或Keycloak角色推断权限；人员主数据身份与IAM主体保持独立，服务身份不能充当人员审批人。OIDC/JWT的`iat`、`exp`、`nbf`和`auth_time`保持标准`NumericDate`并只在认证协议边界校验，不转换为平台日期时间字段；平台自有业务、记录、审计、API及治理Schema日期时间继续完全服从`Asia/Shanghai`无时区规则。
