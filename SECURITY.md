# 安全与隐私 / Security and privacy

## 数据去哪里

词光支持游客使用和可选账号，不接入统计或追踪。游客进度保存在当前浏览器 localStorage；注册把当前进度保存到 MySQL，登录已有账号使用远程数据覆盖本地，登录后自动上传变更。退出注销当前会话并清空本地进度，远程数据保留。可在「我的」里导出 JSON 备份；远程快照经结构校验后才应用。

Guest progress stays in localStorage. Optional accounts store progress in MySQL with HttpOnly session cookies. Registration uploads guest data; signing in replaces local progress; signing out clears local progress while preserving remote data. No analytics or tracking. Backups remain available.

## 凭据 / Credentials

网页运行不需要任何 API key。只有 `scripts/atlas/` 中的内容生成脚本需要调用模型服务，它们从环境变量（`SUB2_BASE_URL`、`SUB2_API_KEY`、`ELEVENLABS_API_KEY`）或仓库外的目录（`ATLAS_SECRETS`）读取凭据，不会写入仓库。

- 不要使用 `VITE_*` 变量存放凭据，它们会被打包进浏览器代码。
- 公开前运行 `npm run pack:public`，它会按白名单导出并扫描凭据和个人路径。扫描是辅助手段，不能替代人工检查。
- 如果凭据意外泄露，请立刻在服务商处吊销或轮换。

## 报告问题 / Reporting

发现安全问题请通过 GitHub 私密漏洞报告（Security → Report a vulnerability）联系维护者，不要公开贴出细节。

## 账号服务

密码使用随机盐 scrypt 哈希，数据库只保存会话令牌的 SHA-256 哈希；密码与凭证不进入进度快照或备份。生产使用 HTTPS 和 Secure Cookie。用户名密码注册不提供找回密码。MySQL 凭据只在服务端 .env 或部署环境中配置。

写接口校验 JSON 与来源白名单，服务端由 Cookie 会话确定用户，并核对 X-Atlas-User。远程进度按用户和词库隔离，版本过旧返回冲突。API 响应使用 no-store，Service Worker 绕过 /api/。
