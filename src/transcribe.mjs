import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchWithRetry } from "./fetchRetry.mjs";

// 支持两种 ASR：
//   provider=local  → 本地 whisper.cpp（whisper-cli），免费离线，Mac 首选
//   provider=openai → OpenAI 兼容的 /audio/transcriptions（Whisper 云端）
// 返回 { text, segments }：segments 为 [{start,end,text}]（秒），供按时间截图；拿不到时为 []。
export async function transcribe(asr, audioPath, onProgress = () => {}, signal) {
  if (asr.provider === "local") return transcribeLocal(asr, audioPath, onProgress, signal);
  return transcribeCloud(asr, audioPath, onProgress, signal);
}

// whisper.cpp -oj 的 JSON → {text, segments}。offsets 是毫秒。
export function parseWhisperJson(data) {
  const segs = Array.isArray(data?.transcription) ? data.transcription : [];
  const segments = segs
    .map((s) => ({
      start: (s.offsets?.from ?? 0) / 1000,
      end: (s.offsets?.to ?? 0) / 1000,
      text: String(s.text || "").trim(),
    }))
    .filter((s) => s.text);
  return { text: segments.map((s) => s.text).join("\n").trim(), segments };
}

// 分片转写时把每段的时间戳平移回全片时间轴。
export function offsetSegments(segments, offsetSec) {
  return (segments || []).map((s) => ({ ...s, start: s.start + offsetSec, end: s.end + offsetSec }));
}

// 带时间戳的转写文本（喂给 LLM 定位每步的时间段）：[分:秒] 一行一段。
export function formatTimedTranscript(segments) {
  const mmss = (t) => {
    const s = Math.max(0, Math.round(t));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  return (segments || []).map((s) => `[${mmss(s.start)}] ${s.text}`).join("\n");
}

// ---- 本地 whisper.cpp ----
function resolveWhisperBin(asr = {}) {
  return asr.whisperBin || process.env.PAODING_WHISPER_BIN || "whisper-cli";
}

function resolveFfmpegBin(asr = {}) {
  return asr.ffmpegBin || process.env.PAODING_FFMPEG_BIN || "ffmpeg";
}

function transcribeLocal(asr, audioPath, onProgress = () => {}, signal) {
  return new Promise((resolve, reject) => {
    const bin = resolveWhisperBin(asr);
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
      "-oj", "-of", outBase, // JSON 输出：文本 + 每段起止时间戳（按时间截图要用）
      "-pp", // 打印进度，供解析
    ];
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], signal });
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
      const jsonPath = `${outBase}.json`;
      if (code !== 0) {
        fs.rmSync(jsonPath, { force: true }); // 失败时也清掉可能已半写的输出，别在 tmp 里留垃圾
        return reject(new Error(`whisper.cpp 退出码 ${code}：${err.slice(0, 400)}`));
      }
      try {
        const out = parseWhisperJson(JSON.parse(fs.readFileSync(jsonPath, "utf8")));
        fs.rmSync(jsonPath, { force: true });
        if (!out.text) return reject(new Error("whisper.cpp 返回空转写。"));
        resolve(out);
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

async function transcribeCloud(asr, audioPath, onProgress = () => {}, signal) {
  const sizeMB = fs.statSync(audioPath).size / (1024 * 1024);

  // 未超限：单次请求（原路径）。
  if (sizeMB <= ASR_MAX_MB) {
    onProgress({ pct: 10, message: "语音转文字…" });
    const out = await transcribeChunk(asr, audioPath, signal);
    onProgress({ pct: 100, message: "语音转文字…" });
    if (!out.text.trim()) throw new Error("ASR 返回空转写文本。");
    return { text: out.text.trim(), segments: out.segments };
  }

  // 超限：切片 → 逐段转写 → 拼接（时间戳平移回全片时间轴）。
  console.warn(`  · 音频约 ${sizeMB.toFixed(1)}MB，超过接口上限，自动按 ${SEG_SECONDS / 60} 分钟分片转写。`);
  const { chunks, cleanup } = await splitAudio(asr, audioPath, SEG_SECONDS, signal);
  try {
    const parts = [], segments = [];
    for (let i = 0; i < chunks.length; i++) {
      onProgress({ pct: Math.round((i / chunks.length) * 100), message: `语音转文字…（分片 ${i + 1}/${chunks.length}）` });
      const out = await transcribeChunk(asr, chunks[i], signal);
      if (out.text.trim()) parts.push(out.text.trim());
      segments.push(...offsetSegments(out.segments, i * SEG_SECONDS));
    }
    onProgress({ pct: 100, message: "语音转文字…" });
    const text = parts.join("\n").trim();
    if (!text) throw new Error("ASR 分片转写全部为空。");
    return { text, segments };
  } finally {
    cleanup();
  }
}

// 单个音频文件 → {text, segments}（一次 OpenAI 兼容请求）。
// 先请求 verbose_json 拿分段时间戳；有些兼容服务不支持该格式，失败就退回默认格式（只有文本、无时间戳）。
async function transcribeChunk(asr, filePath, signal, _verbose = true) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), path.basename(filePath));
  form.append("model", asr.model);
  form.append("prompt", "这是一段中文做菜教学视频，包含食材、用量、火候和步骤。");
  if (_verbose) form.append("response_format", "verbose_json");

  const res = await fetchWithRetry(`${asr.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${asr.apiKey}` },
    body: form,
    signal,
  });
  if (!res.ok) {
    if (_verbose && res.status >= 400 && res.status < 500) return transcribeChunk(asr, filePath, signal, false);
    const detail = await res.text().catch(() => "");
    throw new Error(`ASR 请求失败 ${res.status}：${detail.slice(0, 500)}`);
  }
  const data = await res.json().catch(() => null);
  const segments = (Array.isArray(data?.segments) ? data.segments : [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || "").trim() }))
    .filter((s) => s.text);
  return { text: data?.text ?? "", segments };
}

// 用 ffmpeg 按 segSeconds 把音频切成多段 mp3；返回有序分片路径 + 清理函数。
function splitAudio(asr, audioPath, segSeconds, signal) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-asr-seg-"));
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    const ffmpeg = resolveFfmpegBin(asr);
    const pattern = path.join(dir, "chunk-%03d.mp3");
    const args = [
      "-y", "-i", audioPath,
      "-f", "segment", "-segment_time", String(segSeconds),
      "-c", "copy", "-reset_timestamps", "1",
      pattern,
    ];
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], signal });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { cleanup(); reject(new Error(`调用 ffmpeg（${ffmpeg}）切片失败：${e.message}`)); });
    child.on("close", (code) => {
      if (code !== 0) { cleanup(); return reject(new Error(`ffmpeg（${ffmpeg}）切片退出码 ${code}：${err.slice(-300)}`)); }
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
