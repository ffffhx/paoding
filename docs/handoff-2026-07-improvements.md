# 交接文档：竞品调研落地改进（2026-07）

> 本文档由一轮完整的竞品调研 + 代码库工程评估沉淀而来，交给编码 Agent 独立执行。
> 按 P0 → P4 顺序逐项完成，**每完成一项单独 commit**（commit message 用中文，风格参考 `git log` 里现有的 `feat:` / `merge:` 前缀）。
> **绝对不要 push**——push 到 main 会触发 self-hosted runner 自动部署重启线上服务，由人来决定何时合并。

## 背景（为什么做这些）

庖丁的差异化定位（视频→结构化菜谱 + 每步讲"为什么" + 中文平台支持）经调研确认在全球商业产品和开源项目中均无直接竞争者。但最强开源对标 Mealie（12.6k stars）v3.13 已上线"粘视频链接 → Whisper 转写 → LLM 结构化"的导入，窗口期有限。当前最要紧的不是加新功能，而是两个结构性短板：

1. **安全姿态与公网部署不匹配**：后端经 anyip.dev 隧道公网暴露，但鉴权默认关闭 + CORS 全开 + SSRF 无过滤。
2. **部署不可复制**：别人无法自托管（无 Docker、APK 写死作者的隧道地址）。

## 项目约束（务必遵守）

- **运行时零第三方依赖**是项目原则：所有改动只用 Node 内置模块（http/crypto/fs/child_process/fetch），不引入 npm 运行时依赖。
- 测试用 Node 内置测试器：`npm test`（= `node --test`）。改完每项必须全绿；新增的纯逻辑要配测试（放 `test/backend` 或 `test/server`，参考现有风格）。
- UI 与文案全部简体中文，代码注释风格与现有一致（克制、只写代码看不出来的约束）。
- `app/server.mjs` 是单文件裸 `http.createServer` 手写路由；改动保持这个风格，不引框架。

---

## P0：安全加固（最高优先级）

**现状**（文件行号基于当前 HEAD，可能有少量偏移，以实际代码为准）：

- `app/server.mjs:24,136`：`PAODING_API_TOKEN` 不设置时 `authOk()` 直接放行。公网任何人可 `DELETE /api/recipes/:id`、`PUT /api/userdata`、`POST /api/import`，并无限调用 `/api/ask` 等 LLM 接口烧 API key。
- `app/server.mjs:238`：CORS `Access-Control-Allow-Origin: *`。
- `app/server.mjs:323` + `src/fetchText.mjs:34`：`parse-url` / `parse-text` 接受任意 URL 只校验 `^https?://`，服务端会去 fetch / yt-dlp 下载 → SSRF（可探内网 / 169.254.169.254 云元数据）。
- 已做对的（不要动）：token 比较用 `crypto.timingSafeEqual`；yt-dlp/ffmpeg 走 `spawn` 参数数组无 shell；路径穿越防护 + 图片名白名单正则已有测试覆盖。

**要做**：

1. **非回环监听时强制鉴权**：server 启动时若监听地址非 127.0.0.1/localhost（现状是 0.0.0.0）且未设置 `PAODING_API_TOKEN`，启动直接报错退出，错误信息给出两条出路（设 token / 显式设 `PAODING_ALLOW_INSECURE=1` 表示"我知道我在裸奔"）。`.env.example` 与 README 同步更新。
2. **CORS 收紧**：默认只允许同源与 Capacitor 的 origin（`capacitor://localhost`、`https://localhost`）；新增 `PAODING_CORS_ORIGINS` 环境变量（逗号分隔）供自定义。注意保留现有 `OPTIONS` 预检逻辑与图片 GET 豁免行为。
3. **SSRF 过滤**：抽一个 `assertPublicUrl(url)` 纯函数（建议放 `src/` 下新模块或 fetchText.mjs 内导出），解析 URL 后用 `dns.promises.lookup` 解析主机名，拒绝：回环（127.0.0.0/8、::1）、私网（10/8、172.16/12、192.168/16、fc00::/7、fe80::/10）、链路本地/元数据（169.254.0.0/16）、0.0.0.0。`parse-url`、`parse-text` 的网页抓取路径都要过这道闸。同时把这个校验应用到 yt-dlp 下载入口前（yt-dlp 自身会跟随跳转，至少把首跳挡住并在 README 说明剩余风险）。纯函数要配单测（私网 IP、域名解析到私网、正常公网域名三类 case）。
4. **轻量速率限制**：对 LLM 类接口（`/api/ask`、`/api/nutrition` 等所有会调 LLM 的端点）加内存滑动窗口限流（如每 IP 每分钟 20 次，环境变量可调），超限 429。零依赖手写即可，配测试。

## P1：部署可复制（Docker 化 + APK 地址可配）

**现状**：自托管需手动装 Node22 + ffmpeg + yt-dlp + whisper-cpp + Ollama + 手动下模型；仓库里 `paoding-debug.apk` 和 `capacitor.config.json` 的 `server.url` 写死指向作者隧道 `https://124-221-36-36.anyip.dev:8443/paoding/`，别人装 APK 连的是作者后端。

**要做**：

1. **Dockerfile + docker-compose.yml**：镜像内置 ffmpeg、yt-dlp、whisper-cpp（或 whisper 模型挂 volume）；compose 里可选带一个 ollama 服务（profile 或注释掉的示例均可）；`recipes/`、`models/`、userdata 落 volume。目标体验：`docker compose up` + 首次拉模型说明 = 可用。README「快速开始」新增"方案 C：Docker 一键起"。CI 不用跑 Docker 构建（可选加，不强求）。
2. **APK 后端地址运行时可配**：把 Capacitor 从"编译期写死 server.url"改为：App 首次启动加载本地打包的一个轻量设置页（或在现有前端加"服务器地址"设置项），用户填自己的后端地址（含 token），存本地后跳转/加载。`capacitor.config.json` 不再含作者个人地址。同时把仓库根目录的 `paoding-debug.apk` 删掉（或在 README 声明它已过时、指向作者私人后端，建议自行打包）。安卓工程无法在本机验证构建的话，改完配置与前端逻辑、在 commit message 里注明"未跑 gradlew 验证"即可。
3. **deploy.yml 去硬编码**：把写死的路径 `/Users/bytedance/Code/paoding`、launchd 服务名、公网校验地址抽成 workflow 顶部的 `env:` 变量，便于别人 fork 后自定义（行为保持不变）。

## P2：步骤跳回原视频（性价比最高的新功能）

**现状**：菜谱 JSON 每步已有 `source_time` 时间段（结构化阶段产出，画面配图也基于它），但前端展示/跟做模式没有"跳回原视频对应时刻"的入口。竞品里只有 Preplo（iOS 小产品）做了这个，属差异化空白。

**要做**：

1. 菜谱详情页与跟做模式每步旁加一个"▶ 看原视频这一段"入口：
   - B站链接：拼 `?t=秒数` 跳转原视频页；YouTube：`&t=秒数s`；抖音等不支持时间戳定位的平台：只给原链接。
   - 菜谱 JSON 顶层已有来源 URL 字段（确认实际字段名，形如 `source`/`url`），没有来源 URL 或该步没有 `source_time` 时不渲染入口，**不硬造**（与项目"诚实"原则一致）。
2. 时间戳→各平台跳转 URL 的拼接逻辑抽成纯函数放 `app/app.js` 可测试区（现有 `test/frontend` 是 vm 沙箱跑真实 app.js 的模式，跟着加测试）。

## P3：营养信息结构化落库

**现状**：`/api/nutrition`（`app/server.mjs:431` 附近）是一次性 LLM 聊天式粗估，结果不落库、每次重算。竞品（Flavorish/ReciMe/Recify）营养都是标配。

**要做**：

1. 定义营养 schema 并入菜谱 JSON：`nutrition: { per_serving: { calories_kcal, protein_g, fat_g, carbs_g, sodium_mg }, disclaimer, estimated: true }`，LLM 按 JSON 格式产出（复用 `src/llm.mjs` 的 `chatJSON` 及其防畸形 JSON 兜底）。
2. `/api/nutrition` 改为：已有缓存直接返回；没有则 LLM 估算 → 写回菜谱 JSON → 返回。菜谱被编辑（食材/份量变更）时使缓存失效（找到现有的菜谱保存端点，在食材变更时清掉 `nutrition`）。
3. 前端菜谱页展示每份营养卡片（带"AI 估算，仅供参考"标注）；份量缩放时按比例换算显示。
4. 导出联动：schema.org JSON-LD 导出（`app/app.js:753` 附近）带上 `nutrition`（NutritionInformation 类型）。

## P4：README 竞争定位更新

调研关键结论（写 README 用）：

- 视频转菜谱类产品（ReciMe、Deglaze、Flavorish、Samsung Food、Recify、Mealie v3.13+…）**没有一家**做每步"为什么"原理解释；讲原理的（America's Test Kitchen「Why This Recipe Works」、Parsnip、Zest）全是人工编辑内容、不吃外部视频。两个阵营互不相交。
- 海外全部产品与开源项目不支持抖音/B站/小红书；国内下厨房/懒饭/豆果/美食杰均无"贴链接→结构化菜谱"。
- Mealie v3.13 视频导入只用音频转写，不看画面、无步骤截图、无原理解释。
- 从任意用户视频自动截"每步状态图 + 食材特写"的产品未见（SideChef 是人工制作内容）。

**要做**：README「为什么不一样」一节下加一个简洁的对比表（庖丁 vs Mealie vs ReciMe/Deglaze 类 vs ATK 类），维度：视频音频转写 / 画面级理解(VL) / 每步状态截图 / 每步为什么 / 中文平台(B站抖音小红书) / 自托管零成本。实事求是，别贬低别人（Mealie 生态/多用户/i18n 都比庖丁强，表里如实体现庖丁弱的维度，比如多用户）。同时 Roadmap 勾掉/新增本轮完成项。

---

## 验收清单

- [ ] 每项独立 commit，`npm test` 全绿
- [ ] P0 的 SSRF 纯函数、限流、P2 的 URL 拼接函数有单测
- [ ] `.env.example`、README 与新增环境变量同步
- [ ] 未引入任何 npm 运行时依赖
- [ ] 未 push
