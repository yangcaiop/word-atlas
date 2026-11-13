# Word Atlas 客户端编码规范

本文件适用于 `word-atlas-client/` 及其子目录，供开发者和编码代理共同遵守。以下约定基于当前实现；修改时优先保持现有行为和数据兼容，以小范围改动逐步落实规范。

## 1. 项目边界与技术栈

- 当前是 React 19 + TypeScript 5.9 + Vite 6 的单页应用，使用 npm 和 ES Modules。开发和 Pages 构建使用 Node.js 22。
- 保持可选账号、本地优先、无追踪的产品方向。游客无需服务端；注册、登录与同步使用相邻 `word-atlas-api/` 的 Express + MySQL 服务。
- 沿用函数组件、React Hooks、Context、自定义外部状态仓库、Hash 路由和原生 CSS；遵守 `CONTRIBUTING.md`，不引入状态管理或 UI 框架依赖。
- 复习调度使用 `ts-fsrs`，图标使用 `lucide-react`，星图使用原生 WebGL2 并提供 Canvas 2D 降级。
- 新增依赖应有明确用途，先检查现有模块和浏览器原生能力；依赖变更同步提交 `package.json` 与 `package-lock.json`。

## 2. 目录职责与依赖边界

| 路径                                         | 职责与约束                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/main.tsx`                               | React 挂载、全局样式和字体引入、生产环境 Service Worker 注册。                     |
| `src/App.tsx`                                | 应用启动、词库切换、主题、导航和全局界面组合；业务算法放到对应模块。               |
| `src/pages/`                                 | 页面组件及页面内交互，调用数据、状态和工具模块组织流程。                           |
| `src/atlas/types.ts`                         | 词库、词条、紧凑索引、媒体能力的共享契约。                                         |
| `src/atlas/data.ts`、`context.tsx`           | 词库适配、分块请求、缓存、Context 和词条加载 Hooks。                               |
| `src/store/store.ts`                         | 持久化状态、订阅、数据校验、备份导入导出与本地保存。                               |
| `src/store/srs.ts`                           | FSRS 适配、卡片序列化、掌握状态判定。                                              |
| `src/store/session.ts`                       | 今日计划、题型、干扰项、评分、重试和学习统计。                                     |
| `src/lib/`                                   | 文本、打字、路由、音频和动效等按职责划分的工具；纯计算模块保持可独立测试。         |
| `src/ui/`                                    | 可复用界面与分享能力，优先复用 `Sheet`、`Speak`、`Illustration`、`Ring`、`toast`。 |
| `src/galaxy/`                                | 星图布局、渲染引擎、React 交互适配和星图分享。                                     |
| `src/styles/app.css`                         | 全局设计变量、基础样式、组件和页面样式、响应式及主题规则。                         |
| `public/atlas/`、`data/`                     | 网页词库与可下载数据，必须保持结构、顺序、内容及媒体引用一致。                     |
| `scripts/atlas/`                             | Python 内容生成与编译脚本；中间数据写入被忽略的 `.local/forge/`。                  |
| `scripts/*.mjs`、`scripts/package_public.py` | 校验、截图、演示录制及公开导出工具。                                               |

- 页面可以依赖 `ui`、`atlas`、`store`、`lib` 和 `galaxy`；数据与业务模块不得反向依赖页面、`App.tsx` 或具体 UI 组件。
- 词条通过 `useAtlas()`、`useEntry()` 和 `Atlas` 接口访问；组件中不要重复实现索引解析、分块请求或媒体 URL 拼装。
- 跨页面共享的业务规则放在已有业务模块。仅在一处使用、与页面紧密相关的小组件和 Hooks 可留在页面文件内；避免无实际复用的抽象。

## 3. TypeScript、命名与格式

- 保持 `tsconfig.json` 的 `strict`、`noUnusedLocals`、`noUnusedParameters` 和 `verbatimModuleSyntax`，不得通过放宽配置绕过类型问题。
- 使用 `import type` 或内联 `type` 导入纯类型。当前使用相对路径导入；未配置路径别名，不直接引入 `@/` 等写法。
- 组件、组件文件、接口和类型用 `PascalCase`；函数、变量和工具文件用 `camelCase`；Hooks 以 `use` 开头；固定配置常量可用 `UPPER_SNAKE_CASE`。CSS 类名用 `kebab-case`，状态类沿用 `is-*`。
- 组件优先使用命名导出和函数声明，沿用 `App.tsx` 的默认导出入口。简单 Props 可内联，复杂或复用 Props 提取具名类型。
- 对有限状态使用字符串联合类型，对有不同数据形态的状态使用可辨识联合类型，例如现有 `Route`、`Step`；共享契约集中维护，避免重复定义。
- 外部输入先使用 `unknown`，通过运行时校验收窄。不得新增以 `any`、`as never`、双重断言或 `@ts-ignore` 掩盖数据不确定性的代码；非空断言仅用于已有明确保证的边界。
- 普通代码使用有含义的名称。保留现有数据协议中的 `w`、`ex`、`m`、`s`、`d` 等紧凑字段，避免单纯为可读性破坏数据格式。
- 使用仓库已安装的 Prettier。当前没有仓库级 Prettier 配置，采用默认格式：2 空格缩进、分号、双引号和自动换行。只格式化本次修改文件，避免顺带重排全仓库。
- 注释说明业务约束、单位、降级原因和边界条件；共享接口与重要不变量使用简短 JSDoc，不逐行复述实现。
- 用户文案以简体中文为主，代码标识使用英文。错误提示说明失败事项和可采取的操作，避免直接展示堆栈或原始服务响应。

## 4. React 与异步交互

- 局部交互使用 `useState`，不参与渲染的计时器、DOM 引用和累计值使用 `useRef`；可由现有数据推导的值不要再维护一份可变状态。
- 共享学习数据和设置通过 `useStore(selector)` 读取，通过 `store.progress()`、`store.settings()` 等已有入口修改；不得直接修改 `store.get()` 返回的对象。
- `useStore` 基于 `useSyncExternalStore`。selector 应返回稳定的已有值或基本类型，避免每次调用都新建对象、数组导致快照持续变化；衍生集合在取得状态后计算或用 `useMemo` 缓存。
- 更新数组、对象和嵌套状态时使用不可变更新。涉及旧值的本地状态更新优先使用函数形式。
- Hooks 顶层调用，依赖数组应反映实际读取的响应式值。不要复制现有的 `eslint-disable` 注释作为省略依赖的理由；刻意按会话或步骤重置时明确生命周期依据。
- 应用入口启用了 `StrictMode`。Effect 创建的监听器、订阅、Observer、定时器、动画帧和媒体资源必须有对应清理，确保重复挂载不会重复注册或计分。
- 异步词条加载和页面切换应处理过期结果，沿用 `useEntry` 的存活标记或使用 `AbortController`，避免旧请求覆盖当前选择。
- 请求检查 `response.ok`，界面区分加载、空数据、失败和成功。失败缓存应允许重试；保留词库加载层的请求去重与缓存。
- Promise 必须有失败处理。只有调用链已处理异常或存在明确降级策略时才用 `void` 启动后台任务；不得静默吞掉学习保存、备份导入等关键失败。
- 列表使用稳定业务 ID 作为 `key`。需要切换题目后重置状态时，可沿用会话 ID 与步骤索引组合的 `key`。

## 5. 学习状态、存储与业务不变量

- 当前进度协议为 `Progress.version = 2`。设置键为 `word-atlas:settings`；游客进度键为 `word-atlas:v2:${datasetId}`，账号进度键为 `word-atlas:v2:user:${userId}:${datasetId}`，身份键为 `word-atlas:identity`。账号缓存同时持久化版本与待上传标记，禁止合并不同用户或词库进度。
- 新增设置同步更新 `Settings`、`defaultSettings`、`sanitizeSettings` 和对应界面。新增持久化字段同步更新类型、默认值、清洗、备份处理及必要测试。
- 新用户默认使用暗色主题、美式发音，并从 A1 开始学习；首次引导的默认选项应与设置保持一致，已有用户偏好按保存值恢复。
- 变更已有存储字段、版本、键名或词条 ID 时，必须设计兼容读取或明确的数据迁移；不得通过清空用户进度解决兼容问题。
- localStorage 和备份 JSON 都是不可信输入。新增或修改的输入结构应校验字段类型、枚举、数值范围及嵌套内容；TypeScript 类型断言不等于运行时校验。
- 保留按词库加载后才写入、变更后防抖保存、`pagehide` / 隐藏时 `flush`、跨标签页 `storage` 同步和 `saveError` 反馈机制。直接持久化新的界面偏好时也需处理存储不可用或配额不足。
- 卡片时间持久化为毫秒时间戳，通过 `srs.ts` 与 FSRS 的 `Date` 转换。日统计使用 `dayKey()` 的用户本地日期，不使用 UTC 日期代替。
- 同一个词在一轮学习中只有首次作答更新 FSRS、首次正确率、新词和复习统计；答错后的重试不再计分，最多两次。`pending` 答案应能跨刷新恢复，避免重复统计。
- 沿用先复习、再以 5 个新词为组进行初见与回忆的流程。评分规则统一在 `gradeFor()` 中维护：答错为 Again，使用提示或作答慢为 Hard，通常答对为 Good，快速正确拼写可为 Easy。
- 掌握状态统一调用 `isMastered()`，当前定义是 FSRS Review 状态且稳定度至少 21 天；不要在页面或星图另写一套阈值。
- 打字练习独立记录，不改变 FSRS 卡片。复用 `lib/typing.ts` 的规范化和指标计算，保留 IME、Unicode、移动键盘标点、删除及纠错的统计语义；WPM 按每 5 个正确字符计 1 词。
- 备份导入检查应用标识、版本和词库 ID；导出和导入均不携带活动学习会话。破坏性操作通过现有界面流程明确提示影响。

- 账号与同步代码位于 src/account/。注册用游客进度初始化远程，登录已有账号严格远程覆盖；初始化完成前禁止上传。自动上传防抖 2 秒、串行发送，使用 revision 防止旧设备静默覆盖。
- 退出前处理待上传数据，成功后清空本地、进入空白游客模式；退出清空不上传空快照。API 使用 HttpOnly Cookie，同步和退出请求核对 X-Atlas-User，Service Worker 绕过 /api/。
- 云端只同步公开词库，快照排除活动会话；偏好排除 dataset、onboarded。远程响应严格校验后才交给本地容错清洗，失败时保留本地进度。

## 6. 词库、媒体与生成产物

- 修改数据前阅读 `docs/dataset.md`、`docs/pipeline.md` 和 `CONTRIBUTING.md`，以 `src/atlas/types.ts` 与实际脚本为当前结构依据。
- `IndexRow` 固定为 `[id, word, zh, ipa, cefrIndex, topicIndex, media]`；`WordRef.order` 对应索引位置，分块号为 `Math.floor(order / index.chunk)`。索引、分块顺序、CEFR / topic 映射必须同步。
- `id` 必须唯一且符合 `^[a-z0-9-]{1,64}$`，同时用于学习进度、路由和媒体文件名。不得为排序或显示需要随意变更 ID。
- 媒体位标记以 `MEDIA` 为准：`img=1`、`uk=2`、`us=4`、`ex=8`、`ex2=16`。通过 `atlas.img()` / `atlas.audio()` 获取资源，允许返回 `null`，不得假定所有词都有图片或全部音频。
- 展示列表优先用缩略图，词卡用完整图；图片失败复用 `Illustration` 的降级，录音缺失复用 `lib/audio.ts` 的设备语音降级。
- 少量内容纠错同步修改 `data/word-atlas.json`、CSV 中对应字段、`public/atlas/entries/` 对应词条；若影响首义、词头、IPA、难度、话题、媒体或统计，还需更新 `public/atlas/index.json`。有 forge 源数据时同步修正，避免重新生成覆盖修正。
- 批量新增或重排应通过 `scripts/atlas/build_atlas.py` 生成，保持 JSON、CSV、索引、分块和媒体一致。`npm run build:atlas` 依赖 `.local/forge/` 源数据，处理图片还需要 `cwebp`；源数据不完整时不要运行，以免覆盖已有词库。
- 不对紧凑 JSON、CSV 或大批媒体做无业务意义的重新格式化。`dist/`、`node_modules/`、`*.tsbuildinfo` 和 `.local/` 不作为源码提交，`PUBLIC_MANIFEST.json` 由公开导出工具生成。
- Python 脚本沿用 4 空格缩进、`snake_case` 函数名、`pathlib` 路径与 UTF-8 数据读写；共享路径、凭据和重试复用 `scripts/atlas/common.py`。Node 脚本沿用 `.mjs` 与 `node:` 内置模块。

## 7. 样式、无障碍与性能

- 在 `src/styles/app.css` 的对应区域维护样式，优先复用 `--paper`、`--ink`、`--line`、色彩、圆角、阴影和字体变量，以及已有按钮、面板、分段控件等类名。
- 新增主题变量同时覆盖浅色、系统深色和显式 `data-theme="dark"`；不要只修改其中一套深色规则。固定布局使用 CSS，内联样式仅用于动态尺寸、坐标和 CSS 变量等运行时值。
- 适配至少覆盖桌面和 375px 手机宽度，沿用现有断点、底部导航及 `safe-area-inset-*`，检查横向溢出、长词、词卡和软键盘遮挡。
- 交互使用语义化 `button`、`a`、`input` 等元素；图标按钮提供 `aria-label`，保留可见焦点、表单标签、键盘操作、加载状态和禁用状态。信息图片提供有效替代文本，装饰图片使用空 `alt`。
- 弹层优先复用 `Sheet` 的焦点约束、Escape 关闭、滚动锁定及关闭后焦点恢复。全局快捷键避开输入框、文本域、可编辑元素和输入法组合输入。
- 动效尊重 `prefers-reduced-motion`，浏览器增强能力先检测再使用。音频复用统一播放与环境声压低逻辑，处理自动播放限制并在离开相关界面时停止播放。
- 词库保持索引先加载、完整词条按块加载与按需预取，不把全部词库 JSON 或媒体打包进主 JavaScript。
- 星图计算与渲染分别放在 `layout.ts` 和 `engine.ts`，逐帧数据保存在引擎或 ref，避免逐帧触发 React 重渲染。保留低性能设备质量分级、不可见时暂停、资源销毁及 WebGL2 不可用时的降级。

## 8. 静态部署、离线与凭据

- 公开资源 URL 必须支持 `import.meta.env.BASE_URL`；词库资源优先走 `Atlas` 接口。页面跳转和词卡打开复用 `lib/router.ts` 的 `href`、`go`、`openWord`、`closeWord`，保持 Hash 路由及前进后退行为。
- 同时支持根路径和 `ATLAS_BASE=/words/` 子路径部署。新增路由同步维护 `Route`、解析、链接生成、页面渲染和相关导航。
- Service Worker 仅生产环境注册。修改缓存策略或需更新的缓存资源时检查 `public/sw.js` 的版本与失效策略，保留同源、GET、Range 请求绕过和缓存容量约束；验证首次联网、再次访问和已缓存内容的离线行为。
- `.local/` 及 `/local/` 资源属于本机开发适配，公开应用必须在无私有词库时正常运行；不得把私有目录、映射文件或开发媒体路径复制到 `public/` 或公开数据。
- 网页运行不需要 API key。生成脚本仅从环境变量或 `ATLAS_SECRETS` 指定的仓库外文件读取凭据；禁止使用会暴露到浏览器包中的 `VITE_*` 变量保存密钥，也不得在源码、日志或截图中写入真实凭据。
- 新词库文本、插画、词条录音记录来源并满足 CC BY 4.0 再分发要求，保留现有署名；代码及第三方资源分别遵循其许可。
- 公开导出走 `scripts/package_public.py` 的白名单与扫描；新增发布文件时核对是否纳入白名单。该脚本会清理目标目录，不作为日常测试命令运行。
- ESA Pages 配置位于 `esa.jsonc`，边缘函数位于 `edge/`。`build:pages` 生成不含词库媒体的 `dist-pages/` 与只含公开来源的 `edge/config.generated.js`；生成文件不提交。普通 `build` 保留原有完整静态产物及子路径支持。
- 边缘函数仅转发 `/api` 和白名单媒体路径。API 响应禁止共享缓存，必须透传会话 Cookie、Origin 和 X-Atlas-User；OSS 媒体请求不携带账号凭据。Range、HEAD、条件请求旁路完整对象缓存。ESA Cache API 使用全局 cache.get/put，缓存键要求 HTTP，但实际回源必须 HTTPS；不要读取或设置 ESA 禁止访问的 Host、Connection 等头。
- OSS 上传使用 `scripts/upload-oss.mjs` 和用户在 ossutil 中配置的身份，仅上传公开媒体与内容许可。深圳 ECS 可选择内网上传 Endpoint；Pages 回源只能使用公网地址。修改 Bucket 前缀时同步修改上传目标与回源基地址，参见 `docs/esa-pages.md`。

## 9. 常用命令与验证要求

下列命令均在 `word-atlas-client/` 目录执行；上级目录没有统一 npm 工程。

| 命令                                          | 用途与注意事项                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm ci`                                      | 按锁文件安装依赖。                                                               |
| `npm run dev`                                 | 启动 Vite，默认 `http://localhost:5188`，端口被占用时直接报错。                  |
| `npm test`                                    | 使用 Node Test Runner + `tsx` 运行前端及 `edge/` 代理行为测试。                  |
| `npm run check:atlas`                         | 检查网页词库计数、ID、分块顺序、结构和媒体文件；不验证释义正确性或下载数据同步。 |
| `npm run build`                               | 执行 `tsc -b` 严格类型检查和 Vite 生产构建，输出 `dist/`。                       |
| `npm run build:pages`                         | 生成 ESA Pages 产物与公开回源配置，并检查静态文件数量及大小限制。                |
| `npm run upload:oss -- --dry-run`             | 只检查公开媒体并打印上传计划，不连接 OSS。                                       |
| `npm run upload:oss`                          | 通过已配置的 ossutil 上传公开媒体到指定 OSS 前缀。                               |
| `ATLAS_BASE=/words/ npm run build`            | 验证子路径构建；资源、路由或部署配置变更时还需预览验证。                         |
| `npm run preview`                             | 在 5188 端口预览生产构建；先停止占用该端口的开发服务。                           |
| `npx --no-install prettier --check AGENTS.md` | 检查本规范格式；检查其他文件时替换为本次修改的路径。                             |

- 单文件格式化使用 `npx --no-install prettier --write <文件路径>`；现有 `npm run format` 会重写多个源码和配置文件，仅在明确需要批量格式化时使用。
- 提交前遵循贡献指南执行 `npm test`、`npm run check:atlas`、`npm run build`。纯文档改动至少核对命令、路径、链接和文档格式；未执行的检查如实说明原因。
- 现有单测与实现相邻，使用 `*.test.ts`、`node:test` 和 `node:assert/strict`。新增测试沿用该体系；覆盖业务结果、边界输入及回归场景，不为文案、样式或实现细节机械增加测试。
- 修改评分、会话恢复、FSRS、存储清洗、备份或打字统计时增加对应行为测试；时间和随机逻辑尽量通过显式参数或种子控制，不依赖真实等待与精确随机间隔。
- 视觉变更检查浅色、深色和 375px 手机宽度并提供截图；按变更范围验证键盘、词条弹层、学习继续、音频或星图交互。只修改文档不要求浏览器验证。
- 校验脚本的 warning 与 error 分开报告：结构和媒体检查通过不代表内容已人工审校。交付说明实际修改、实际执行的检查、结果和未解决限制。

## 10. 渐进维护

- 开始修改前检查当前仓库的 `git status`，保留已有未提交改动；只修改任务相关文件，不覆盖用户配置或顺带清理无关文件。
- 当前没有配置 ESLint、`lint` 命令或浏览器端自动测试流水线，不得把现有 `eslint-disable` 注释视为规则已启用，也不得声称未执行的检查已通过。
- 现有部分页面和全局 CSS 较长，部分输入校验、类型断言和 Effect 依赖仍可改进。这些是维护现状，不作为新增代码模板；修改触及相关逻辑时按本规范收敛，不附带全量架构重写或格式化。
- 新增模块、改变目录职责、持久化协议、数据流程或开发命令时同步更新本文件及相关文档，保证规范与实际可执行行为一致。
