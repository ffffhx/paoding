import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatVision } from "./llm.mjs";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300) || `退出码 ${code}`))));
  });
}

// 从视频抽关键帧：优先场景切换、抽不到再退回固定间隔；缩放到 768 宽、限量。返回 base64 jpg 数组。
export async function extractFrames(videoPath, { max = 20 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-frames-"));
  const pattern = path.join(dir, "f-%04d.jpg");
  const collect = () => fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  try {
    // 场景切换抽帧
    await run("ffmpeg", ["-y", "-i", videoPath, "-vf", "select='gt(scene,0.3)',scale=768:-1", "-vsync", "vfr", "-frames:v", String(max), pattern]).catch(() => {});
    let files = collect();
    if (files.length < 3) {
      // 兜底：每 6 秒一帧
      files.forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
      await run("ffmpeg", ["-y", "-i", videoPath, "-vf", "fps=1/6,scale=768:-1", "-frames:v", String(max), pattern]);
      files = collect();
    }
    return files.slice(0, max).map((f) => fs.readFileSync(path.join(dir, f)).toString("base64"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 视觉模型逐批读帧：抽屏上文字（字幕/用量标注）+ 画面里能确认的食材/动作/火候，拼成「画面转写」。
export async function visionTranscript(vision, frames, onProgress = () => {}) {
  if (!frames.length) return "";
  const batch = 6, parts = [];
  for (let i = 0; i < frames.length; i += batch) {
    onProgress({ pct: Math.round((i / frames.length) * 100), message: `看画面读字幕…（${Math.min(i + batch, frames.length)}/${frames.length}）` });
    try {
      const text = await chatVision(vision, {
        system: "你在看一段做菜视频按时间顺序截取的若干帧。请抽出两类信息：\n1) 画面上出现的所有文字（字幕、标题、用量/火候标注等），逐字照抄，别改写。\n2) 画面里能明确看到的食材、操作动作、火候/状态。\n只写你真的看到的，绝不脑补。简洁中文，分点。看不到有用信息就回「（本组无有用信息）」。",
        user: "这些是按时间先后排列的截图：",
        images: frames.slice(i, i + batch),
      });
      if (text && !text.includes("本组无有用信息")) parts.push(text.trim());
    } catch (e) {
      // 单批失败不影响整体
    }
  }
  return parts.join("\n");
}
