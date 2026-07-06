<div align="center">

<img src="app/icons/icon-512.png" width="112" alt="庖丁" />

# 庖丁 · Paoding

**把做菜视频拆成分步骤，讲透每一步「为什么这么做」。**

_Turn any cooking video into step-by-step instructions that explain the **why** behind every move._

<p>
<img src="https://img.shields.io/badge/license-MIT-E4572E" />
<img src="https://img.shields.io/badge/PWA-可装到手机主屏-6A8D3F" />
<img src="https://img.shields.io/badge/本地零成本-Ollama%20%2B%20whisper.cpp-2A2724" />
<img src="https://img.shields.io/badge/Node-22%2B-8A817A" />
<img src="https://github.com/ffffhx/paoding/actions/workflows/test.yml/badge.svg" alt="test" />
</p>

<img src="docs/assets/cook.gif" width="300" alt="跟做模式演示" />

</div>

---

## 这是什么

给它一个做菜视频（B站 / 抖音 / YouTube 链接、本地文件），**或一段图文/文字帖**（小红书 / 公众号 / 任意粘贴的文字），庖丁会：

1. **听懂它** —— 视频走「下载音频 → 语音转文字」；文字帖直接读文字（口播/文案是做菜内容里最值钱的信息）。
2. **拆成步骤** —— 大模型整理成结构化菜谱：食材（含 `qty/unit` 可精确缩放）、火候、时间、到位判断。
3. **讲透为什么** —— 对**每一步**生成三段式讲解：
   > 🤔 **为什么这么做** ｜ **不这么做会怎样** ｜ **怎么判断到位了**
4. **陪你做** —— 手机 App + 电脑桌面双端：一步一屏、语音免手、多计时器、AI 随问、本步用到的食材高亮。

## 为什么不一样

市面上"视频转菜谱"的工具不少，但它们只给你一份**扁平菜谱**——告诉你*做什么*，不告诉你*为什么*。而讲原理讲得好的（America's Test Kitchen、ChefSteps）又是人工编辑、不吃你随手刷到的视频。

**庖丁把两者缝在一起**：自动解析任意视频 × 每步深度原理讲解。你不只是照着做，而是**搞懂**——为什么油要七成热、为什么先焯水、为什么这步省了会翻车。

| 维度 | 庖丁 | Mealie v3.13+ | ReciMe / Deglaze 类 | ATK / ChefSteps 类 |
|---|---|---|---|---|
| 视频音频转写 | ✅ | ✅ | ✅ | ❌ |
| 画面级理解（VL/OCR） | ✅ 可选 | ❌ 主要用音频转写 | ❌/未见明确支持 | ❌ 人工制作内容 |
| 每步状态截图 | ✅ 自动截原视频 | ❌ | ❌/少见 | ✅ 人工拍摄 |
| 每步为什么 | ✅ 自动逐步解释 | ❌ | ❌ | ✅ 人工编辑 |
| 中文平台（B站/抖音/小红书） | ✅ 重点支持 | ❌ | ❌ | ❌ |
| 自托管零成本 | ✅ Ollama + whisper.cpp | ✅ 开源自托管，生态/多用户/i18n 更成熟 | ❌ 商业 App | ❌ 内容站/课程 |
| 多用户/权限/i18n | ⚠️ 轻量单人优先 | ✅ 强 | ⚠️ 取决于产品 | ⚠️ 非菜谱管理系统 |

<div align="center">
<img src="docs/assets/why.png" width="300" alt="每步讲透为什么" />
</div>

## 功能

| | |
|---|---|
| 🎬 **智能解析** | 粘链接（B站/抖音/YouTube）或传视频，**实时进度 + 排队**、可后台化；手机可从别的 App 分享链接直接解析 |
| 🔎 **读画面字幕** | 可选视觉 OCR（qwen2.5-VL）：抽帧读屏上字幕/画面，**兜住没口播、只有字幕的视频** |
| 📸 **画面配图** | 从原视频截出**每步的状态图**（“鸡蛋煎到什么样”一眼看到）和**食材/小料特写**（视觉定位+裁剪）；时间戳定位、视觉模型挑帧复核，找不到就不硬配 |
| 📝 **文字也能解析** | 除视频外：**粘贴小红书图文/公众号/任意文字帖**，或贴链接时自动兜底抓网页文字 |
| 📱 **双端一套** | 手机装成 App（Capacitor 安卓 APK）+ 电脑桌面响应式；同一后端、改一处两端同步、检测到新版**自动更新**（免重装） |
| 📖 **跟做模式** | 一步一屏 / 大字 / 屏幕常亮 / 进度条 / 左右滑 / 断点续做 / **本步用到的食材高亮** |
| 🤔 **每步为什么** | 三段式原理讲解，关键信息（火候/时间/用量）高亮，术语可点开秒懂 |
| 🎞 **跳回原视频** | 每步可跳回 B站 / YouTube 对应时间段；不支持时间戳的平台只打开原链接 |
| 🎙 **免手操作** | 语音说「下一步 / 上一步 / 朗读」翻页，朗读当前步骤（洗手做菜刚需） |
| ⏱ **多计时器** | 从步骤自动识别时长，多个并行、跨步骤保留、到点响铃+震动+系统通知 |
| 💬 **AI 助手** | 对每步追问、🆘 翻车补救、食材替代（**该替就替、不能替直说**）、整菜设计、结构化营养估算 |
| 🧺 **食材 & 购物** | 份量缩放（按 `qty/unit` 精确重算）、购物清单**同名合并 + 按超市货架分区**，本周计划展示每日营养合计与周日均 |
| ✏️ **可编辑** | AI 出错能直接改：标题/用量/步骤/讲解随手修正，保存即同步 |
| ☁️ **同步 & 备份** | 收藏/笔记/评分/购物清单**跨设备共享**（手机↔电脑）；一键导出备份 / 导入恢复 |
| 📤 **开放导出** | 复制 Markdown、下载 **Cooklang `.cook`** 与 **schema.org JSON-LD**，与菜谱生态互通 |
| ⭐ **收藏 & 记录** | 收藏整菜 + 收藏单步技巧、笔记、做过打卡 + 评分、搜索/标签筛选 |
| 🌙 **顺手** | 暗色模式、字号、朗读语速、装到主屏（PWA）、离线看已解析菜谱、双指缩放 |
| 🛡 **诚实** | 视频没讲清的绝不臆造，如实标「视频未明确」；每步带置信度，靠推测的会标「⚠️ 推测」 |
| 🧰 **自托管** | Docker / Compose 可复制部署；APK 首次启动填自己的后端地址，不再绑定私人服务 |

<div align="center">
<img src="docs/assets/home.png" width="270" alt="首页" />&nbsp;&nbsp;
<img src="docs/assets/dark.png" width="270" alt="暗色模式" />
</div>

## 管线

```
视频URL / 本地文件                     图文帖链接 / 粘贴的文字
   → [yt-dlp]  下载音频 + 标题/简介         → [fetch]  抓网页文字(og/正文) 或直接用粘贴内容
   → [ffmpeg]  抽音轨（16k 单声道）                       │
   → [ASR]     口播转文字(whisper.cpp/云，带时间戳)        │
        └──────────────┬──────────────────────────────────┘
                       ↓
                → [LLM]  整理成结构化菜谱 JSON（食材 qty/unit、火候、时间、每步对应的视频时间段…）
                → [LLM]  逐步生成「为什么」讲解     ← 庖丁的核心差异
                → [视觉] （可选）按每步时间段抽候选帧 → VL 挑最能体现状态的一张；
                          识别食材画面 → 定位裁特写（找不到就不配，绝不硬凑）
                → JSON + Markdown(嵌图) + 双端跟做（可导出 .cook / JSON-LD）
```

> 视频抓不到时（如小红书无 yt-dlp 抽取器）会**自动改按文字帖**抓网页文字；纯图文/文字帖直接走右侧文字管线。

## 快速开始

**依赖**：Node 22+、`ffmpeg`、`yt-dlp`（解析在线链接用），以及大模型+ASR（本地或云端）。

### 方案 A：全本地零成本（推荐，Mac 首选）

```bash
# 大模型（Ollama 自带 OpenAI 兼容接口）
ollama pull qwen2.5:14b
ollama pull qwen2.5vl:7b   # 可选：视觉模型（读画面字幕 + 每步状态图/食材图）

# 本地语音转写
brew install whisper-cpp ffmpeg yt-dlp
mkdir -p models
curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

# 配置（默认就是本地方案）
cp .env.example .env
# 局域网/公网可访问时必须设置 API token；本机浏览器单独用可改为 PAODING_HOST=127.0.0.1
openssl rand -hex 16  # 把输出填到 .env 的 PAODING_API_TOKEN

# 起 App
node app/server.mjs
```

不花钱、不申请 key、视频不出本机。想提质量随时把 `.env` 里的 `PAODING_LLM_*` 换成云端旗舰模型（豆包 / Gemini / GPT / Claude 等任意 OpenAI 兼容接口），其余不变。

### 命令行（不开 App）

```bash
node bin/paoding.mjs ./红烧肉.mp4
node bin/paoding.mjs "https://www.bilibili.com/video/BVxxxx" --depth advanced
```

### 方案 C：Docker 一键起

```bash
cp .env.example .env
openssl rand -hex 16  # 填到 .env 的 PAODING_API_TOKEN

mkdir -p models
curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

docker compose up --build
```

默认会把菜谱写到 `./recipes/`，解析任务元数据写到同级 `./jobs/`，用户数据写到 Docker volume。若本机已跑 Ollama，`.env` 里的 `PAODING_LLM_BASE_URL` 可用默认的 `http://host.docker.internal:11434/v1`。

也可以让 compose 顺手起一个 Ollama：

```bash
docker compose --profile ollama up -d ollama
docker compose exec ollama ollama pull qwen2.5:14b
docker compose --profile ollama up --build paoding
```

## 装到手机

`node app/server.mjs` 启动后会打印**局域网地址**（如 `http://192.168.1.5:4177`）。手机连同一 WiFi 打开它 → 浏览器菜单「添加到主屏幕」→ 就是一个全屏 App。App 界面跑在手机、解析引擎跑在电脑，两者通过局域网通信。

默认监听局域网地址时会强制开启 API token；在 `.env` 设置 `PAODING_API_TOKEN`，再到 App「设置 → API Token」填同一个值。只在本机浏览器使用可设 `PAODING_HOST=127.0.0.1` 跳过强制鉴权。CORS 默认只允许同源与 Capacitor，跨域自托管前端可用 `PAODING_CORS_ORIGINS=https://你的域名` 放行。

> B站等平台反爬（HTTP 412）：`.env` 里设 `PAODING_COOKIES_FROM_BROWSER=chrome`，借用浏览器已登录的 cookie 即可。

解析服务默认同时跑 2 个任务，最多排队 10 个；可用 `PAODING_MAX_JOBS` 和 `PAODING_MAX_QUEUE` 调整。任务状态会写入 `jobs/`，服务重启后正在执行的任务会标为「已中断」，首页「最近任务」可看到并重新发起。

安全边界：服务端会在抓网页、下载视频前拒绝本机、私网与链路本地地址，避免把后端当成内网探测器。`yt-dlp` 仍可能跟随平台侧重定向；首跳会被庖丁拦截，公网部署时仍建议放在受控网络与鉴权之后使用。

### 安卓 APK

Capacitor APK 不再写死任何个人后端地址；首次打开会加载本地设置页，填自己的后端地址和 API Token 后再使用。仓库也不再提供指向作者私人后端的 `paoding-debug.apk`，需要 APK 时请在本机执行 `npx cap sync android` 后自行打包。

## 自动部署

云服务器上的 Caddy 把 `/paoding/*` 反代到 `127.0.0.1:14177`，这个端口由 Mac 上的 `com.paoding.tunnel` 通过 autossh 反向转发到本机 `4177`。实际 App 服务由 Mac 上的 `com.paoding.server` 跑 `node app/server.mjs`。

服务端会兼容 `/paoding` 子路径：即使 Caddy 没有剥掉前缀，`/paoding/`、`/paoding/index.html` 和 `/paoding/api/*` 都会正常落到同一套 App。

仓库内置自动部署 workflow：`.github/workflows/deploy.yml`。每次 push 到 `main` 会在这台 Mac 的 `paoding` self-hosted runner 上执行；路径、launchd 服务名和健康检查 URL 都集中在 workflow 顶部 `env:`，fork 后按需改一处即可。

1. `git pull --ff-only origin main` 更新部署目录
2. `npm test`
3. 重启 App launchd 服务
4. 重启隧道 launchd 服务
5. 校验本机和公网健康检查 URL

## 目录

```
src/            解析引擎（download / fetchText / transcribe / chef / explain / pipeline）
bin/paoding.mjs 命令行入口
app/            跟做 App / PWA（index.html + styles.css + app.js + sw.js + server.mjs）
android/        Capacitor 安卓工程（npx cap sync android 后 gradlew 打 APK）
Dockerfile      自托管镜像（内置 ffmpeg / yt-dlp / whisper.cpp）
docs/           产品需求与技术方案
```

产出的菜谱 JSON（每步含 `why`、`risk_level`、`confidence`）就是 App 的数据契约。

## 测试

```bash
node --test        # 或 npm test
```

纯 Node 内置测试器、零第三方依赖：`test/backend`（解析纯函数）、`test/server`（起隔离实例测接口）、`test/frontend`（vm 沙箱跑真实 `app.js` 测纯逻辑）。GitHub Actions 每次 push / PR 自动跑（`.github/workflows/test.yml`）。

## Roadmap

- [x] 文字帖解析（小红书图文 / 公众号 / 粘贴文字）+ 视频抓不到时自动兜底
- [x] Capacitor 打包安卓 APK + 桌面响应式（双端一套代码）
- [x] 跨设备同步收藏/笔记/评分/购物清单 + 导出备份
- [x] 菜谱可编辑、结构化用量份量缩放、购物清单智能合并、导出 Cooklang / schema.org
- [x] 抽帧 + 视觉 OCR（qwen2.5-VL），兜住「没口播只有字幕」的视频（前端「读画面字幕」开关）
- [x] 画面配图：时间戳定位每步 → 截「到位状态」截图；食材/小料识别 + 视觉定位裁特写（前端「提取画面截图」开关 / CLI `--images`）
- [x] 本周膳食计划（周日历排菜 → 一键合并购物清单 → 每日营养合计 / 周日均）
- [x] 公网安全加固：强制 token、CORS 收紧、SSRF 过滤、LLM 接口限流
- [x] Docker / Compose 自托管 + APK 后端地址运行时配置
- [x] 每步跳回原视频时间段（B站 / YouTube 时间戳）
- [x] 结构化营养估算落库、缓存失效、JSON-LD 导出
- [ ] 更多真实视频调 prompt，沉淀跨视频「技法库」

## 致谢

站在开源肩膀上：[yt-dlp](https://github.com/yt-dlp/yt-dlp) · [whisper.cpp](https://github.com/ggerganov/whisper.cpp) · [Ollama](https://ollama.com) · [ffmpeg](https://ffmpeg.org)。

## License

[MIT](LICENSE)

<div align="center">
<sub>庖丁解牛 —— 把每一道菜，解剖到你看得懂为什么。</sub>
</div>
