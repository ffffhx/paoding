import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 运行子进程；onData(chunk) 用于实时解析进度（stdout+stderr 都喂过去）。
function run(cmd, args, { capture = false, onData } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const feed = (buf, isErr) => {
      const s = buf.toString();
      if (isErr) err += s;
      else if (capture) out += s;
      if (onData) onData(s);
    };
    child.stdout.on("data", (b) => feed(b, false));
    child.stderr.on("data", (b) => feed(b, true));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} 退出码 ${code}${err ? `：${err.slice(-400)}` : ""}`));
    });
  });
}

async function has(cmd) {
  try {
    await run("which", [cmd], { capture: true });
    return true;
  } catch {
    return false;
  }
}

const isUrl = (s) => /^https?:\/\//i.test(s);

// 反爬相关的 yt-dlp 公共参数：UA + 站点 Referer + 可选浏览器 cookie。
function ytdlpArgs(input, ytdlp = {}) {
  const args = ["--no-warnings"];
  if (ytdlp.userAgent) args.push("--user-agent", ytdlp.userAgent);
  try {
    const host = new URL(input).hostname;
    args.push("--add-header", `Referer:https://${host}/`);
  } catch {}
  if (ytdlp.cookiesBrowser) args.push("--cookies-from-browser", ytdlp.cookiesBrowser);
  return args;
}

// 输入：URL 或本地视频路径。onProgress({pct,message}) 报告 0~100 的获取进度。
// wantVideo=true 时下载/保留视频文件（供视觉抽帧），并在返回里带 videoPath。
export async function acquire(input, ytdlp = {}, onProgress = () => {}, { wantVideo = false } = {}) {
  if (!(await has("ffmpeg"))) {
    throw new Error("未找到 ffmpeg，请先安装：brew install ffmpeg");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-"));
  const cleanup = () => fs.rmSync(workDir, { recursive: true, force: true });

  let meta = { title: "", description: "", duration: null };
  let sourceMedia, videoPath = null;

  try {
  if (isUrl(input)) {
    if (!(await has("yt-dlp"))) {
      cleanup();
      throw new Error("未找到 yt-dlp（解析链接需要它）：brew install yt-dlp");
    }
    const common = ytdlpArgs(input, ytdlp);
    onProgress({ pct: 3, message: "读取视频信息…" });
    try {
      const json = await run("yt-dlp", ["-j", ...common, input], { capture: true });
      const info = JSON.parse(json);
      meta = { title: info.title || "", description: info.description || "", duration: info.duration ?? null };
    } catch (e) {
      console.warn(`  · 元数据抓取失败（继续）：${e.message}`);
    }
    if (wantVideo) {
      onProgress({ pct: 8, message: `下载视频${meta.title ? "：" + meta.title : ""}` });
      const tmpl = path.join(workDir, "video.%(ext)s");
      await run("yt-dlp", ["-f", "bv*[height<=720]+ba/b[height<=720]/best", "--merge-output-format", "mp4", "--no-playlist", ...common, "-o", tmpl, input], {
        onData: (s) => { const m = s.match(/(\d+(?:\.\d+)?)%\s+of/); if (m) onProgress({ pct: 8 + Math.min(90, +m[1]) * 0.6, message: "下载视频…" }); },
      });
      const vf = fs.readdirSync(workDir).find((f) => f.startsWith("video."));
      if (!vf) { cleanup(); throw new Error("视频下载失败"); }
      sourceMedia = path.join(workDir, vf); videoPath = sourceMedia;
    } else {
      onProgress({ pct: 8, message: `下载音频${meta.title ? "：" + meta.title : ""}` });
      const tmpl = path.join(workDir, "audio.%(ext)s");
      await run("yt-dlp", ["-x", "--audio-format", "mp3", "--no-playlist", ...common, "-o", tmpl, input], {
        onData: (s) => { const m = s.match(/(\d+(?:\.\d+)?)%\s+of/); if (m) onProgress({ pct: 8 + Math.min(90, +m[1]) * 0.8, message: "下载音频…" }); },
      });
      sourceMedia = path.join(workDir, "audio.mp3");
    }
  } else {
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) {
      cleanup();
      throw new Error(`本地文件不存在：${abs}`);
    }
    meta.title = path.basename(abs).replace(/\.[^.]+$/, "");
    sourceMedia = abs;
    if (wantVideo) videoPath = abs;
    onProgress({ pct: 40, message: "读取本地文件…" });
  }

  onProgress({ pct: 88, message: "抽取音频轨…" });
  const audioPath = path.join(workDir, "asr.mp3");
  await run("ffmpeg", ["-y", "-i", sourceMedia, "-ac", "1", "-ar", "16000", "-b:a", "64k", "-vn", audioPath]);
  onProgress({ pct: 100, message: "音频就绪" });

  return { audioPath, videoPath, meta, cleanup };
  } catch (e) {
    cleanup(); // 下载/抽音轨失败也清理临时目录，避免泄漏
    throw e;
  }
}
