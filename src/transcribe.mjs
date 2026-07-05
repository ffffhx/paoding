import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 支持两种 ASR：
//   provider=local  → 本地 whisper.cpp（whisper-cli），免费离线，Mac 首选
//   provider=openai → OpenAI 兼容的 /audio/transcriptions（Whisper 云端）
export async function transcribe(asr, audioPath, onProgress = () => {}) {
  if (asr.provider === "local") return transcribeLocal(asr, audioPath, onProgress);
  return transcribeCloud(asr, audioPath);
}

// ---- 本地 whisper.cpp ----
function transcribeLocal(asr, audioPath, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const bin = asr.whisperBin || "whisper-cli";
    if (!asr.whisperModel || !fs.existsSync(asr.whisperModel)) {
      return reject(
        new Error(
          `未找到 whisper 模型文件（PAODING_WHISPER_MODEL=${asr.whisperModel || "未设置"}）。\n` +
            "  下载示例：见 README「全本地模式」。",
        ),
      );
    }
    const outBase = path.join(os.tmpdir(), `paoding-asr-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    const args = [
      "-m", asr.whisperModel,
      "-f", audioPath,
      "-l", asr.lang || "zh",
      "-otxt", "-of", outBase,
      "-pp", // 打印进度，供解析
    ];
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d;
      const m = String(d).match(/progress\s*=\s*(\d+)\s*%/);
      if (m) onProgress({ pct: +m[1], message: "语音转文字…" });
    });
    child.on("error", (e) =>
      reject(new Error(`调用 ${bin} 失败：${e.message}（brew install whisper-cpp）`)),
    );
    child.on("close", (code) => {
      const txtPath = `${outBase}.txt`;
      if (code !== 0) {
        return reject(new Error(`whisper.cpp 退出码 ${code}：${err.slice(0, 400)}`));
      }
      try {
        const text = fs.readFileSync(txtPath, "utf8").trim();
        fs.rmSync(txtPath, { force: true });
        if (!text) return reject(new Error("whisper.cpp 返回空转写。"));
        resolve(text);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ---- 云端 OpenAI 兼容 ----
async function transcribeCloud(asr, audioPath) {
  const buf = fs.readFileSync(audioPath);
  const sizeMB = buf.length / (1024 * 1024);
  if (sizeMB > 24) {
    console.warn(`  · 音频约 ${sizeMB.toFixed(1)}MB，可能超过接口上限；长视频建议后续做分片。`);
  }

  const form = new FormData();
  form.append("file", new Blob([buf]), path.basename(audioPath));
  form.append("model", asr.model);
  form.append("prompt", "这是一段中文做菜教学视频，包含食材、用量、火候和步骤。");

  const res = await fetch(`${asr.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${asr.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ASR 请求失败 ${res.status}：${detail.slice(0, 500)}`);
  }
  const data = await res.json().catch(() => null);
  const text = data?.text ?? "";
  if (!text.trim()) throw new Error("ASR 返回空转写文本。");
  return text.trim();
}
