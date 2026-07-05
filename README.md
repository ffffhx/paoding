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
</p>

<img src="docs/assets/cook.gif" width="300" alt="跟做模式演示" />

</div>

---

## 这是什么

给它一个做菜视频（B站 / YouTube 链接，或本地文件），庖丁会：

1. **听懂它** —— 下载音频 → 语音转文字（口播是做菜视频里最值钱的信息）。
2. **拆成步骤** —— 大模型整理成结构化菜谱：食材、用量、火候、时间、到位判断。
3. **讲透为什么** —— 对**每一步**生成三段式讲解：
   > 🤔 **为什么这么做** ｜ **不这么做会怎样** ｜ **怎么判断到位了**
4. **陪你做** —— 一个手机跟做 App：一步一屏、语音免手、多计时器、AI 随问。

## 为什么不一样

市面上"视频转菜谱"的工具不少，但它们只给你一份**扁平菜谱**——告诉你*做什么*，不告诉你*为什么*。而讲原理讲得好的（America's Test Kitchen、ChefSteps）又是人工编辑、不吃你随手刷到的视频。

**庖丁把两者缝在一起**：自动解析任意视频 × 每步深度原理讲解。你不只是照着做，而是**搞懂**——为什么油要七成热、为什么先焯水、为什么这步省了会翻车。

<div align="center">
<img src="docs/assets/why.png" width="300" alt="每步讲透为什么" />
</div>

## 功能

| | |
|---|---|
| 🎬 **智能解析** | 粘链接或传视频，**实时进度百分比**；手机可从别的 App 分享链接直接解析 |
| 📖 **跟做模式** | 一步一屏 / 大字 / 屏幕常亮 / 进度条 / 上下步 / 左右滑 / 断点续做 |
| 🤔 **每步为什么** | 三段式原理讲解，关键信息（火候/时间/用量）高亮，术语可点开秒懂 |
| 🎙 **免手操作** | 语音说「下一步 / 上一步 / 朗读」翻页，朗读当前步骤（洗手做菜刚需） |
| ⏱ **多计时器** | 从步骤自动识别时长，多个并行、跨步骤保留、到点响铃+震动+系统通知 |
| 💬 **AI 助手** | 对每步追问、🆘 翻车补救、食材替代、这道菜为什么这样设计、每份营养估算 |
| 🧺 **食材 & 购物** | 勾除清单、份量缩放（人份±自动换算）、一键生成购物清单 |
| ⭐ **收藏 & 记录** | 收藏整菜 + 收藏单步技巧、笔记、做过打卡 + 评分、搜索/标签筛选、分享导出 |
| 🌙 **顺手** | 暗色模式、字号、朗读语速、可装到手机主屏（PWA）、离线看已解析菜谱 |
| 🛡 **诚实** | 视频没讲清的绝不臆造，如实标「视频未明确」；每步带置信度，靠推测的会标「⚠️ 推测」 |

<div align="center">
<img src="docs/assets/home.png" width="270" alt="首页" />&nbsp;&nbsp;
<img src="docs/assets/dark.png" width="270" alt="暗色模式" />
</div>

## 管线

```
视频URL / 本地文件
   → [yt-dlp]      下载音频 + 抓标题/简介
   → [ffmpeg]      抽音轨（16k 单声道）
   → [ASR]         口播转文字（本地 whisper.cpp 或 Whisper 兼容接口）
   → [LLM]         整理成结构化菜谱 JSON
   → [LLM]         逐步生成「为什么」讲解     ← 庖丁的核心差异
   → JSON + Markdown + App 跟做
```

## 快速开始

**依赖**：Node 22+、`ffmpeg`、`yt-dlp`（解析在线链接用），以及大模型+ASR（本地或云端）。

### 方案 A：全本地零成本（推荐，Mac 首选）

```bash
# 大模型（Ollama 自带 OpenAI 兼容接口）
ollama pull qwen2.5:14b

# 本地语音转写
brew install whisper-cpp ffmpeg yt-dlp
mkdir -p models
curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

# 配置（默认就是本地方案）
cp .env.example .env

# 起 App
node app/server.mjs
```

不花钱、不申请 key、视频不出本机。想提质量随时把 `.env` 里的 `PAODING_LLM_*` 换成云端旗舰模型（豆包 / Gemini / GPT / Claude 等任意 OpenAI 兼容接口），其余不变。

### 命令行（不开 App）

```bash
node bin/paoding.mjs ./红烧肉.mp4
node bin/paoding.mjs "https://www.bilibili.com/video/BVxxxx" --depth advanced
```

## 装到手机

`node app/server.mjs` 启动后会打印**局域网地址**（如 `http://192.168.1.5:4177`）。手机连同一 WiFi 打开它 → 浏览器菜单「添加到主屏幕」→ 就是一个全屏 App。App 界面跑在手机、解析引擎跑在电脑，两者通过局域网通信。

> B站等平台反爬（HTTP 412）：`.env` 里设 `PAODING_COOKIES_FROM_BROWSER=chrome`，借用浏览器已登录的 cookie 即可。

## 目录

```
src/            解析引擎（download / transcribe / chef / explain / pipeline）
bin/paoding.mjs 命令行入口
app/            跟做 App / PWA（index.html + styles.css + app.js + sw.js + server.mjs）
docs/           产品需求与技术方案
```

产出的菜谱 JSON（每步含 `why`、`risk_level`、`confidence`）就是 App 的数据契约。

## Roadmap

- [ ] 抽帧 + 视觉 OCR，兜住「没口播只有字幕」的视频
- [ ] 更多真实视频调 prompt，沉淀跨视频「技法库」
- [ ] Capacitor / Tauri 打包成 iOS / Android 原生 APK

## 致谢

站在开源肩膀上：[yt-dlp](https://github.com/yt-dlp/yt-dlp) · [whisper.cpp](https://github.com/ggerganov/whisper.cpp) · [Ollama](https://ollama.com) · [ffmpeg](https://ffmpeg.org)。

## License

[MIT](LICENSE)

<div align="center">
<sub>庖丁解牛 —— 把每一道菜，解剖到你看得懂为什么。</sub>
</div>
