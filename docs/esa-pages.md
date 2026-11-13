# 阿里云 ESA Pages + OSS 部署

本部署使用以下地址：

| 用途           | 地址                                                             |
| -------------- | ---------------------------------------------------------------- |
| 前端自定义域名 | `https://word.yckara.top`                                        |
| 已部署的 API   | `https://word-api.yckara.top`                                    |
| OSS Bucket     | `word-atlas-oss`，深圳 `cn-shenzhen`                             |
| 媒体对象前缀   | `word-atlas/atlas/`                                              |
| 边缘回源基地址 | `https://word-atlas-oss.oss-cn-shenzhen.aliyuncs.com/word-atlas` |

## 访问链路

```text
浏览器 → word.yckara.top → ESA Pages
                         ├─ 页面、JS、CSS、词库 index/entries JSON：静态托管
                         ├─ /api/*：边缘函数 → HTTPS API → Nginx → Express → MySQL
                         └─ /atlas/img、thumb、audio/*：边缘函数 → OSS
```

浏览器继续访问同源 `/api`，Cookie 由浏览器保存在 `word.yckara.top`，由边缘函数透传给账号 API。注册、登录、同步及错误响应都不进入边缘缓存。API 服务器的 `CORS_ORIGINS` 必须包含 `https://word.yckara.top`，并保留 `COOKIE_SECURE=true`。

完整媒体 GET 请求可写入 ESA Cache API，TTL 为一天；Range、HEAD 和条件请求直接回源 OSS，音频拖动播放保留 `206` 和 `Content-Range`。OSS 请求不携带登录 Cookie、Authorization 或用户 ID。OSS 媒体需要匿名可读，浏览器不直接访问 OSS，因此不需要额外配置 Bucket 的浏览器跨域规则。

## 1. 上传公开媒体到 OSS

安装并配置阿里云官方 [ossutil 2](https://help.aliyun.com/en/oss/developer-reference/ossutil-overview/)。使用具备目标前缀上传权限的 RAM 身份或 ECS RAM Role，运行 `ossutil config` 按提示配置；不要把 AccessKey 写进前端环境变量、仓库或 Pages 配置。

在包含完整 `public/atlas/` 的前端源码目录执行：

```bash
nvm use
npm ci
# 可选：复制公开地址配置；默认地址已在脚本中配置
cp .env.pages.example .env.pages.local

# 先查看文件数量和将执行的命令，不连接 OSS
npm run upload:oss -- --dry-run

# 上传图片、缩略图、音频以及内容许可
npm run upload:oss
```

上传目标：

```text
oss://word-atlas-oss/word-atlas/
├── CONTENT_LICENSE.md
└── atlas/
    ├── img/*.webp
    ├── thumb/*.webp
    └── audio/{uk,us,ex,ex2}/*.mp3
```

脚本仅选择 `.webp` 图片和 `.mp3` 音频，拒绝媒体目录中的符号链接，并使用 ossutil 的增量上传。媒体共 37,501 个文件，约 621 MiB。只对这些上传对象设置 `public-read`，不修改整个 Bucket 的 ACL，不上传本地学习数据或私有词库。

Bucket 使用标准存储。确认阻止公共访问设置不会拦截此公开媒体前缀；如果已有同名私有对象，增量上传可能跳过它们，需要在 OSS 控制台将该媒体前缀下的对象权限调整为公共读。不要设置公共读写。

### 从深圳 ECS 使用内网上传

只有在 ECS 上已有完整前端源码和媒体时，才在该目录执行：

```bash
ATLAS_OSS_UPLOAD_ENDPOINT=https://oss-cn-shenzhen-internal.aliyuncs.com \
npm run upload:oss
```

`word-atlas-oss.oss-cn-shenzhen-internal.aliyuncs.com` 是 Bucket 内网访问地址；ossutil 的 Endpoint 参数使用不含 Bucket 名的服务地址 `oss-cn-shenzhen-internal.aliyuncs.com`。Pages 边缘节点仍使用公网 Bucket 地址回源，构建脚本会拒绝将内网 Endpoint 配置为边缘回源地址。

上传完成后验证对象可匿名读取：

```bash
curl -I https://word-atlas-oss.oss-cn-shenzhen.aliyuncs.com/word-atlas/atlas/img/abandon.webp
curl -I https://word-atlas-oss.oss-cn-shenzhen.aliyuncs.com/word-atlas/atlas/audio/us/abandon.mp3
```

两个请求均应返回 `200`。如果返回 `403`，检查对象公共读权限、阻止公共访问和防盗链；如果返回 `404`，检查对象是否上传到上述前缀。回源不携带 Referer，设置防盗链时需允许无 Referer 的服务器回源。

## 2. 构建 Pages 产物

```bash
npm run build:pages
```

该命令生成：

- `dist-pages/`：前端和词库 JSON，当前 140 个文件，约 14 MiB。
- `edge/config.generated.js`：仅包含公开 API/OSS 地址及缓存版本。

图片和单词音频不复制到 Pages 产物，从而满足 ESA 每项目最多 2000 个静态文件、单文件最大 25 MB 的限制。普通 `npm run build` 仍输出包含完整媒体的 `dist/`，适用于原有静态部署。

可在 Pages 构建环境或 `.env.pages.local` 设置：

| 变量                        | 默认值                                                           | 用途                               |
| --------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| `ATLAS_API_ORIGIN`          | `https://word-api.yckara.top`                                    | API HTTPS 来源，不带 `/api`        |
| `ATLAS_OSS_BASE_URL`        | `https://word-atlas-oss.oss-cn-shenzhen.aliyuncs.com/word-atlas` | OSS 公网来源及对象前缀             |
| `ATLAS_MEDIA_CACHE_VERSION` | `v1`                                                             | 媒体缓存命名空间，更新媒体时可递增 |

`ATLAS_OSS_DESTINATION`、`ATLAS_OSS_UPLOAD_ENDPOINT` 只用于上传脚本，不需要配置到 Pages。修改构建变量后需重新部署。

## 3. 导入 ESA Pages

先将本次代码修改提交并推送到前端 GitHub 仓库，再打开阿里云 ESA 控制台，选择 **边缘计算和 AI → 函数和 Pages → 创建 → 导入 GitHub 仓库**。

当前前端仓库为 `yangcaiop/word-atlas`，生产分支为 `main`。构建配置：

| 项目         | 设置                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| 框架         | Vite + React                                                             |
| 根目录       | `/`；此客户端本身是独立 Git 仓库。若改为 monorepo，选择实际客户端子目录  |
| Node.js      | `22`；项目 `engines.node` 已配置为 `22.x`                                |
| 安装命令     | `npm ci --registry=https://registry.npmmirror.com/ --no-audit --no-fund` |
| 构建命令     | `npm run build:pages`                                                    |
| 静态资源目录 | `./dist-pages`                                                           |
| 函数入口     | `./edge/index.js`                                                        |

这些配置已写入仓库根目录的 `esa.jsonc`，其优先级高于控制台同名配置。不要将构建命令改为普通 `npm run build`；不要把 `public/` 选为静态资源目录。

项目使用 Hash 路由，`esa.jsonc` 故意不设置 `assets.notFoundStrategy`。这样 `/api/*` 和缺失的媒体路径会进入边缘函数，直接在地址栏打开 `/api/health` 也能获得 JSON，而不会被单页应用兜底成 `index.html`。

账号 API 路径始终禁止缓存：在 ESA 站点缓存规则中，对 `/api` 和 `/api/*` 设置绕过缓存，并确保其优先级高于泛化静态缓存规则。不要对账号接口开启忽略 Cookie 的强制缓存。媒体由边缘函数自身的 Cache API 管理；首次回源和缓存淘汰后会重新访问 OSS。

## 4. 绑定前端域名

在 Pages 项目添加自定义域名 `word.yckara.top`，按控制台返回的值配置 DNS/CNAME，启用该域名的 HTTPS。这里的前端域名应指向 Pages 提供的目标，不应指向 ECS 的 `120.77.137.82`。

API 域名 `word-api.yckara.top` 继续使用现有 ECS 和 Nginx。不要将 API 域名绑定到前端 Pages 项目，也不要把 Pages 的回源目标改成前端域名自身。

默认预览域名可以检查页面。注册、登录等写请求会携带预览域名作为 Origin，当前后端只允许明确配置的来源，因此账号联调使用正式 `word.yckara.top`。需要在预览域名联调时，将该项目的精确 HTTPS 预览来源加入 API 白名单，不使用泛化通配来源。

## 5. 验证上线

```bash
curl -i https://word.yckara.top/api/health
curl -I https://word.yckara.top/atlas/img/abandon.webp
curl -I https://word.yckara.top/atlas/audio/us/abandon.mp3
curl -i -H 'Range: bytes=0-31' https://word.yckara.top/atlas/audio/us/abandon.mp3
```

健康检查应返回 JSON 和 `200`；媒体为正确的图片/音频类型，Range 请求返回 `206`。用完整 GET 连续请求同一张图，可查看 `X-Atlas-Cache` 从 `MISS` 变为 `HIT`；HEAD/Range 请求显示 `BYPASS`。缓存是按边缘节点保存的，不同节点第一次访问仍可能为 `MISS`。

浏览器验证注册、刷新登录状态、收藏或学习后同步、另一设备登录后拉取，以及退出账号。账号响应应含 `Cache-Control: no-store`；浏览器应持有 `word.yckara.top` 下的 HttpOnly、Secure 会话 Cookie。

目前服务器限流识别到的来源是边缘回源节点。默认注册/登录限制为每 IP 每 15 分钟 30 次；若需精确识别访客 IP，应按 ESA 的可信回源范围配置 Nginx real-ip，而不是直接信任客户端提交的 `X-Forwarded-For`。

## 更新与排查

- 更新界面或词库 JSON：推送代码，触发 Pages 重建。
- 更新媒体：重新运行上传脚本，必要时递增 `ATLAS_MEDIA_CACHE_VERSION` 后重建。浏览器/Service Worker 也可能已有媒体缓存，需要结合其缓存版本处理。
- `/api` 返回 HTML：确认函数入口及 `esa.jsonc` 正确，未启用 SPA 导航兜底，未把账号路径缓存为页面。
- 注册返回 `403`：检查 API 的来源白名单是否含实际前端完整来源。
- 媒体返回 `403/404`：先检查 OSS 原始对象 URL，再检查 Pages 的回源地址和前缀。

官方参考：[构建与路由](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/build-pages)、[Pages 限制](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/what-is-functions-and-pages/)、[边缘 Fetch API](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/fetch-1)、[Cache API](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/cache-api)、[ossutil 2 上传](https://help.aliyun.com/en/oss/developer-reference/cp-upload-file)。
