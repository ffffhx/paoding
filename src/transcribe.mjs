import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 支持两种 ASR：
//   provider=local  → 本地 whisper.cpp（whisper-cli），免费离线，Mac 首选
//   provider=openai → OpenAI 兼容的 /audio/transcriptions（Whisper 云端）
export async function transcribe(asr, audioPath, onProgress = () => {}) {
  if (asr.provider === "local") return transcribeLocal(asr, audioPath, onProgress);
  return transcribeCloud(asr, audioPath, onProgress);
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
// OpenAI 的 /audio/transcriptions 有 25MB 单文件上限，长视频必然超。
// 超阈值就用 ffmpeg 按时长切片、逐段转写再拼接，兜住长视频。
const ASR_MAX_MB = 24; // 略低于 25MB 硬上限留余量
const SEG_SECONDS = 15 * 60; // 15 分钟一段；acquire 出的是 16k 单声道 64k mp3，一段 ≈ 7MB

async function transcribeCloud(asr, audioPath, onProgress = () => {}) {
  const sizeMB = fs.statSync(audioPath).size / (1024 * 1024);

  // 未超限：单次请求（原路径）。
  if (sizeMB <= ASR_MAX_MB) {
    onProgress({ pct: 10, message: "语音转文字…" });
    const text = await transcribeChunk(asr, audioPath);
    onProgress({ pct: 100, message: "语音转文字…" });
    if (!text.trim()) throw new Error("ASR 返回空转写文本。");
    return text.trim();
  }

  // 超限：切片 → 逐段转写 → 拼接。
  console.warn(`  · 音频约 ${sizeMB.toFixed(1)}MB，超过接口上限，自动按 ${SEG_SECONDS / 60} 分钟分片转写。`);
  const { chunks, cleanup } = await splitAudio(audioPath, SEG_SECONDS);
  try {
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress({ pct: Math.round((i / chunks.length) * 100), message: `语音转文字…（分片 ${i + 1}/${chunks.length}）` });
      const t = await transcribeChunk(asr, chunks[i]);
      if (t.trim()) parts.push(t.trim());
    }
    onProgress({ pct: 100, message: "语音转文字…" });
    const text = parts.join("\n").trim();
    if (!text) throw new Error("ASR 分片转写全部为空。");
    return text;
  } finally {
    cleanup();
  }
}

// 单个音频文件 → 文本（一次 OpenAI 兼容请求）。
async function transcribeChunk(asr, filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), path.basename(filePath));
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
  return data?.text ?? "";
}

// 用 ffmpeg 按 segSeconds 把音频切成多段 mp3；返回有序分片路径 + 清理函数。
function splitAudio(audioPath, segSeconds) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-asr-seg-"));
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    const pattern = path.join(dir, "chunk-%03d.mp3");
    const args = [
      "-y", "-i", audioPath,
      "-f", "segment", "-segment_time", String(segSeconds),
      "-c", "copy", "-reset_timestamps", "1",
      pattern,
    ];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { cleanup(); reject(new Error(`调用 ffmpeg 切片失败：${e.message}`)); });
    child.on("close", (code) => {
      if (code !== 0) { cleanup(); return reject(new Error(`ffmpeg 切片退出码 ${code}：${err.slice(-300)}`)); }
      const chunks = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3"))
        .sort()
        .map((f) => path.join(dir, f));
      if (!chunks.length) { cleanup(); return reject(new Error("ffmpeg 切片未产出任何分片。")); }
      resolve({ chunks, cleanup });
    });
  });
}
