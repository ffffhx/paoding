import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOutputLang } from "./outputLanguage.mjs";

// 极简 .env 加载：不引第三方依赖，只读 KEY=VALUE。
function loadDotEnv(cwd) {
  const p = path.join(cwd, ".env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function loadEnvFiles() {
  // 优先读引擎目录下的 .env，再读当前工作目录的 .env。
  // 用 fileURLToPath 而非 .pathname：后者对含空格/中文的安装路径会残留 %20 等编码，导致 .env 读不到。
  loadDotEnv(fileURLToPath(new URL("..", import.meta.url)));
  loadDotEnv(process.cwd());
}

export function loadConfig() {
  loadEnvFiles();

  const llmBase = process.env.PAODING_LLM_BASE_URL?.replace(/\/$/, "");
  const llmKey = process.env.PAODING_LLM_API_KEY;
  const llmModel = process.env.PAODING_LLM_MODEL || "gpt-4o-mini";
  const outputLang = normalizeOutputLang(process.env.PAODING_OUTPUT_LANG || "zh");

  if (!llmBase || !llmKey) {
    throw new Error(
      "缺少大模型配置：请设置 PAODING_LLM_BASE_URL 和 PAODING_LLM_API_KEY（见 .env.example）",
    );
  }

  const visionModel = process.env.PAODING_VISION_MODEL || "";
  const envBool = (name, fallback) => {
    const raw = process.env[name];
    if (raw == null || raw === "") return fallback;
    return /^(1|true|yes)$/i.test(raw);
  };

  return {
    llm: { baseUrl: llmBase, apiKey: llmKey, model: llmModel, outputLang },
    // 视觉模型（可选）：设了 PAODING_VISION_MODEL 才开启抽帧读屏，兜住「没口播只有字幕」的视频
    vision: visionModel ? {
      baseUrl: (process.env.PAODING_VISION_BASE_URL || llmBase).replace(/\/$/, ""),
      apiKey: process.env.PAODING_VISION_API_KEY || llmKey,
      model: visionModel,
      maxFrames: Number(process.env.PAODING_VISION_MAX_FRAMES || 20),
      stepImageFast: envBool("PAODING_STEP_IMAGE_FAST", false),
      ingredientImages: envBool("PAODING_INGREDIENT_IMAGES", true),
    } : null,
    asr: {
      // local = 本地 whisper.cpp；openai = 云端 OpenAI 兼容接口
      provider: (process.env.PAODING_ASR_PROVIDER || "openai").toLowerCase(),
      baseUrl: (process.env.PAODING_ASR_BASE_URL || llmBase).replace(/\/$/, ""),
      apiKey: process.env.PAODING_ASR_API_KEY || llmKey,
      model: process.env.PAODING_ASR_MODEL || "whisper-1",
      whisperBin: process.env.PAODING_WHISPER_BIN || "whisper-cli",
      whisperModel: process.env.PAODING_WHISPER_MODEL || "",
      whisperNoGpu: /^(1|true|yes)$/i.test(process.env.PAODING_WHISPER_NO_GPU || ""),
      whisperThreads: Number(process.env.PAODING_WHISPER_THREADS || 0),
      ffmpegBin: process.env.PAODING_FFMPEG_BIN || "ffmpeg",
      lang: process.env.PAODING_ASR_LANG || "zh",
    },
    outDir: process.env.PAODING_OUT_DIR || path.join(process.cwd(), "paoding-out"),
    depth: process.env.PAODING_DEPTH || "balanced",
    ytdlp: {
      bin: process.env.PAODING_YTDLP_BIN || "yt-dlp",
      ffmpegBin: process.env.PAODING_FFMPEG_BIN || "ffmpeg",
      // 远程机优先使用同步的 cookie 文件；本机也可直接读取浏览器登录态。
      cookiesFile: process.env.PAODING_COOKIES_FILE || "",
      cookiesBrowser: process.env.PAODING_COOKIES_FROM_BROWSER || "",
      userAgent:
        process.env.PAODING_YTDLP_UA ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    },
  };
}
