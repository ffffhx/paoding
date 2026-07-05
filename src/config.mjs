import fs from "node:fs";
import path from "node:path";

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

export function loadConfig() {
  // 优先读引擎目录下的 .env，再读当前工作目录的 .env。
  loadDotEnv(path.resolve(new URL("..", import.meta.url).pathname));
  loadDotEnv(process.cwd());

  const llmBase = process.env.PAODING_LLM_BASE_URL?.replace(/\/$/, "");
  const llmKey = process.env.PAODING_LLM_API_KEY;
  const llmModel = process.env.PAODING_LLM_MODEL || "gpt-4o-mini";

  if (!llmBase || !llmKey) {
    throw new Error(
      "缺少大模型配置：请设置 PAODING_LLM_BASE_URL 和 PAODING_LLM_API_KEY（见 .env.example）",
    );
  }

  return {
    llm: { baseUrl: llmBase, apiKey: llmKey, model: llmModel },
    asr: {
      // local = 本地 whisper.cpp；openai = 云端 OpenAI 兼容接口
      provider: (process.env.PAODING_ASR_PROVIDER || "openai").toLowerCase(),
      baseUrl: (process.env.PAODING_ASR_BASE_URL || llmBase).replace(/\/$/, ""),
      apiKey: process.env.PAODING_ASR_API_KEY || llmKey,
      model: process.env.PAODING_ASR_MODEL || "whisper-1",
      whisperBin: process.env.PAODING_WHISPER_BIN || "whisper-cli",
      whisperModel: process.env.PAODING_WHISPER_MODEL || "",
      lang: process.env.PAODING_ASR_LANG || "zh",
    },
    outDir: process.env.PAODING_OUT_DIR || path.join(process.cwd(), "paoding-out"),
    depth: process.env.PAODING_DEPTH || "balanced",
    ytdlp: {
      // 用浏览器已登录的 cookie 绕过 B站等平台的反爬（412）。留空则不带 cookie。
      cookiesBrowser: process.env.PAODING_COOKIES_FROM_BROWSER || "",
      userAgent:
        process.env.PAODING_YTDLP_UA ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    },
  };
}
