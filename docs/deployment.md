# 部署 / Deployment

`npm run build` 生成纯静态站点 `dist/`，可以放到任何静态托管（Nginx、Cloudflare Pages、Vercel、GitHub Pages）。

## 子路径

```bash
ATLAS_BASE=/words/ npm run build
```

## Nginx 示例

```nginx
location ^~ /words/ {
    alias /var/www/word-atlas/;
    try_files $uri $uri/ /words/index.html;
    expires 7d;
}
```

## GitHub Pages

仓库带有 `.github/workflows/pages.yml`。在仓库 Settings → Pages 选择 “GitHub Actions”，然后手动运行 “Deploy to GitHub Pages”。

## 体积

插画与音频合计约数百 MB。建议在 CDN 后部署，或按需只发布 `thumb/` 和部分音频。

## 可选账号与 MySQL 服务

游客可继续使用纯静态部署。账号功能部署相邻 word-atlas-api：创建 MySQL 数据库，配置 MYSQL_URL，执行 npm ci、npm run db:migrate、npm run build，再运行 npm start。完整配置见 API README。

生产推荐前端和 API 同源。API 固定使用根路径 /api/，不随 ATLAS_BASE 改变。Nginx 示例：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
    client_max_body_size 5m;
}
```

设置 CORS_ORIGINS 为完整前端来源（不带子路径），NODE_ENV=production；Cookie 默认 Secure，须通过 HTTPS 访问。单层可信代理可设 TRUST_PROXY_HOPS=1，并让 Express 只监听代理可访问的地址。代理与 Express JSON 大小限制应一致。

本地开发和 vite preview 都将 /api 代理到 http://127.0.0.1:3000。使用其他服务时设置 ATLAS_API_TARGET，例如 ATLAS_API_TARGET=http://127.0.0.1:3001 npm run dev。跨站 Cookie 需要另外评估 SameSite 与浏览器限制，默认使用同源代理。

`npm run db:migrate` 只负责初始化数据库。开发时需要在 `word-atlas-api/` 单独运行并保持 `npm run dev`，再启动客户端；可访问 `http://localhost:5188/api/health` 确认代理已连到后端。后端未启动时，注册和登录会提示账号服务暂时不可用。

发布时同步更新 sw.js。新版本绕过 API 请求并清理旧缓存，避免缓存账号或用户进度响应。
