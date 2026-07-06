import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatVision, parseModelJSON } from "./llm.mjs";

function run(cmd, args, signal, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"], signal });
    let out = "", err = "";
    if (capture) child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.slice(-300) || `退出码 ${code}`))));
  });
}

function resolveFfmpegBin() {
  return process.env.PAODING_FFMPEG_BIN || "ffmpeg";
}

// 从视频抽关键帧：优先场景切换、抽不到再退回固定间隔；缩放到 768 宽、限量。返回 base64 jpg 数组。
export async function extractFrames(videoPath, { max = 20, signal } = {}) {
  const ffmpeg = resolveFfmpegBin();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-frames-"));
  const pattern = path.join(dir, "f-%04d.jpg");
  const collect = () => fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
  try {
    // 场景切换抽帧
    await run(ffmpeg, ["-y", "-i", videoPath, "-vf", "select='gt(scene,0.3)',scale=768:-1", "-vsync", "vfr", "-frames:v", String(max), pattern], signal).catch(() => {});
    let files = collect();
    if (files.length < 3) {
      // 兜底：每 6 秒一帧
      files.forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
      await run(ffmpeg, ["-y", "-i", videoPath, "-vf", "fps=1/6,scale=768:-1", "-frames:v", String(max), pattern], signal);
      files = collect();
    }
    return files.slice(0, max).map((f) => fs.readFileSync(path.join(dir, f)).toString("base64"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 视觉模型逐批读帧：抽屏上文字（字幕/用量标注）+ 画面里能确认的食材/动作/火候，拼成「画面转写」。
export async function visionTranscript(vision, frames, onProgress = () => {}, signal) {
  if (!frames.length) return "";
  const batch = 6, parts = [];
  for (let i = 0; i < frames.length; i += batch) {
    onProgress({ pct: Math.round((i / frames.length) * 100), message: `看画面读字幕…（${Math.min(i + batch, frames.length)}/${frames.length}）` });
    try {
      const text = await chatVision(vision, {
        system: "你在看一段做菜视频按时间顺序截取的若干帧。请抽出两类信息：\n1) 画面上出现的所有文字（字幕、标题、用量/火候标注等），逐字照抄，别改写。\n2) 画面里能明确看到的食材、操作动作、火候/状态。\n只写你真的看到的，绝不脑补。简洁中文，分点。看不到有用信息就回「（本组无有用信息）」。",
        user: "这些是按时间先后排列的截图：",
        images: frames.slice(i, i + batch),
        signal,
      });
      if (text && !text.includes("本组无有用信息")) parts.push(text.trim());
    } catch (e) {
      // 单批失败不影响整体
    }
  }
  return parts.join("\n");
}

/* ================= 画面截图：步骤状态图 + 食材图 ================= */

const FRAME_WIDTH = 960; // 落盘/喂 VL 的统一宽度：手机展示够清晰，单张 ~100KB

// 视频总时长（秒）；yt-dlp 元数据缺失或本地文件时用 ffprobe 兜底。
export async function probeDuration(videoPath, signal) {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath], signal, true);
  const d = parseFloat(out);
  return Number.isFinite(d) && d > 0 ? d : null;
}

// 一个步骤时间段内取 n 个候选时刻，偏向段末：「煎至金黄」这类到位状态通常出现在一步的结尾。
// 口播与画面常有 ±几秒偏移，所以候选散布整个区间、由视觉模型做最终裁决，不盲信时间戳。
export function candidateTimes([start, end], duration, n = 4) {
  const lo = Math.max(0, Math.min(start, duration - 1));
  const hi = Math.max(lo + 0.5, Math.min(end, duration - 0.5));
  const fracs = n <= 1 ? [0.85] : [0.3, 0.55, 0.8, 0.97].slice(0, n);
  const times = fracs.map((f) => lo + (hi - lo) * f);
  // 去掉间隔小于 1 秒的重复时刻（短步骤会挤在一起）
  const out = [];
  for (const t of times) if (!out.length || t - out[out.length - 1] >= 1) out.push(Math.round(t * 10) / 10);
  return out;
}

// 在第 tSec 秒抽一帧存为 jpg。-ss 放在 -i 前走快速 seek，抽几十帧也只要几秒。
export async function extractFrameAt(videoPath, tSec, outPath, signal) {
  await run(resolveFfmpegBin(), ["-y", "-ss", String(tSec), "-i", videoPath, "-frames:v", "1", "-vf", `scale=${FRAME_WIDTH}:-2`, "-q:v", "3", outPath], signal);
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
}

// 从 JPEG 文件头读宽高（SOF 段），免起 ffprobe 子进程。
export function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// 规整视觉模型给的 bbox：[x1,y1,x2,y2] 像素坐标 → 加边距、夹回图内的 {x,y,w,h}；不可用返回 null。
export function clampBbox(bbox, width, height, padRatio = 0.08) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v) => Number.isFinite(Number(v)))) return null;
  let [x1, y1, x2, y2] = bbox.map(Number);
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  const pad = Math.round(Math.max(x2 - x1, y2 - y1) * padRatio);
  x1 = Math.max(0, Math.floor(x1 - pad)); y1 = Math.max(0, Math.floor(y1 - pad));
  x2 = Math.min(width, Math.ceil(x2 + pad)); y2 = Math.min(height, Math.ceil(y2 + pad));
  const w = x2 - x1, h = y2 - y1;
  if (w < 32 || h < 32) return null; // 太小的框裁出来没法看，退回整帧
  return { x: x1, y: y1, w, h };
}

const b64 = (p) => fs.readFileSync(p).toString("base64");

// 对每个带 source_time 的步骤：段内抽多张候选帧 → 视觉模型挑最能体现该步状态的一张 → 存为 step-<index>.jpg。
// 单步失败只跳过该步，绝不让截图问题毁掉整趟解析。
export async function extractStepImages(vision, videoPath, recipe, { duration, imagesDir, onProgress = () => {}, signal } = {}) {
  const steps = (recipe.steps || []).filter((s) => Array.isArray(s.source_time));
  if (!steps.length || !duration) return 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-stepimg-"));
  let saved = 0;
  const seen = new Set(); // 已存图的指纹：两步挑中同一帧时只留第一张（重复图没有信息量）
  try {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      onProgress({ pct: Math.round((i / steps.length) * 100), message: `截取步骤画面…（${i + 1}/${steps.length}）` });
      try {
        const times = candidateTimes(s.source_time, duration);
        const files = [];
        for (let k = 0; k < times.length; k++) {
          const fp = path.join(tmp, `s${s.index}-c${k}.jpg`);
          if (await extractFrameAt(videoPath, times[k], fp, signal)) files.push(fp);
        }
        if (!files.length) continue;
        let best = 1;
        if (files.length > 1) {
          const cue = s.params?.cue ? `，到位标准：「${s.params.cue}」` : "";
          const ans = await chatVision(vision, {
            system: "你在帮做菜教程挑选步骤配图。只输出 JSON，不要解释。",
            user: `这是同一做菜步骤时间段内按先后截取的 ${files.length} 张图（编号 1~${files.length}）。步骤：「${s.title || ""}：${s.action || ""}」${cue}。\n选出最能清晰展示这一步操作或完成状态的一张（画面清楚、食物为主体；避开人脸特写、转场、黑屏、片头片尾）。都不合适就选 0。\n输出 JSON：{"best": 编号}`,
            images: files.map(b64),
            signal,
          });
          const n = Number(parseModelJSON(ans)?.best);
          if (!Number.isFinite(n) || n < 1 || n > files.length) continue; // 0 或非法 = 没有合适的，别硬配
          best = n;
        }
        const chosen = files[best - 1];
        const hash = crypto.createHash("md5").update(fs.readFileSync(chosen)).digest("hex");
        if (seen.has(hash)) continue;
        seen.add(hash);
        const name = `step-${s.index}.jpg`;
        fs.copyFileSync(chosen, path.join(imagesDir, name));
        s.image = name;
        saved++;
      } catch {
        // 本步截图失败，跳过
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return saved;
}

// 食材图：候选帧 = 开头集中展示段（多数教程头 30~60 秒会把食材过一遍镜头）+ 每个食材首次被口播提到的时刻。
// 视觉模型逐批标注「哪个食材在哪张图里最清楚」，再对命中的食材请模型框出位置裁特写；框不出就用整帧。
// 找不到就不配图——不硬凑，符合「视频没有的绝不臆造」。
export async function extractIngredientImages(vision, videoPath, recipe, { duration, segments = [], imagesDir, onProgress = () => {}, signal } = {}) {
  const ings = (recipe.ingredients || []).filter((it) => it && it.name);
  if (!ings.length || !duration) return 0;

  // ---- 候选时刻 ----
  const times = [];
  const pushTime = (t) => {
    t = Math.max(0.5, Math.min(t, duration - 0.5));
    if (!times.some((x) => Math.abs(x - t) < 2)) times.push(Math.round(t * 10) / 10);
  };
  const introEnd = Math.min(duration * 0.3, 75);
  for (let k = 0; k < 6; k++) pushTime(1 + ((introEnd - 1) * k) / 5);
  for (const it of ings) {
    const seg = segments.find((sg) => sg.text && sg.text.includes(it.name));
    if (seg) pushTime(seg.start + 1);
  }
  const capped = times.sort((a, b) => a - b).slice(0, 14);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-ingimg-"));
  let saved = 0;
  try {
    onProgress({ pct: 5, message: "截取食材画面…" });
    const frames = []; // {file, time}
    for (let k = 0; k < capped.length; k++) {
      const fp = path.join(tmp, `f${k}.jpg`);
      if (await extractFrameAt(videoPath, capped[k], fp, signal)) frames.push({ file: fp, time: capped[k] });
    }
    if (!frames.length) return 0;

    // ---- 逐批标注：食材名 → 最清楚的帧（全局编号）----
    const names = ings.map((it) => it.name);
    const bestFrame = {}; // name -> frame（保留最先命中的：开头展示段优先，通常最干净）
    const batch = 6;
    for (let i = 0; i < frames.length; i += batch) {
      const part = frames.slice(i, i + batch);
      onProgress({ pct: 10 + Math.round((i / frames.length) * 40), message: `识别画面里的食材…（${Math.min(i + batch, frames.length)}/${frames.length}）` });
      try {
        const ans = await chatVision(vision, {
          system: "你在帮做菜教程给食材清单配图。只输出 JSON，不要解释。",
          user: `这是做菜视频的 ${part.length} 张截图（编号 1~${part.length}）。这道菜的食材清单：${names.join("、")}。\n对每个食材：若它的【本体】（生料或独立摆放的样子，不是下锅后的成品）在某张图中清楚可见，给出看得最清楚的一张图的编号；看不到就填 0。只依据画面，绝不猜测。\n输出 JSON：{"食材名": 编号}`,
          images: part.map((f) => b64(f.file)),
          signal,
        });
        const map = parseModelJSON(ans) || {};
        for (const [name, v] of Object.entries(map)) {
          const n = Number(v);
          if (!names.includes(name) || bestFrame[name] || !Number.isFinite(n) || n < 1 || n > part.length) continue;
          bestFrame[name] = part[n - 1];
        }
      } catch {
        // 单批失败不影响整体
      }
    }

    // ---- 对命中的食材：请模型框位置 → 裁特写；框不出就整帧 ----
    const hit = ings.filter((it) => bestFrame[it.name]);
    for (let i = 0; i < hit.length; i++) {
      const it = hit[i];
      onProgress({ pct: 55 + Math.round((i / hit.length) * 40), message: `裁剪食材特写…（${i + 1}/${hit.length}）` });
      const frame = bestFrame[it.name];
      const name = `ing-${ings.indexOf(it) + 1}.jpg`;
      const outPath = path.join(imagesDir, name);
      try {
        // 定位调用兼做第二道复核：批量标注阶段小模型偶有幻觉，这里单独盯着一张图再确认一次。
        // found=false → 放弃该食材（宁缺毋滥）；found=true 但框不可用 → 退回整帧。
        const ans = await chatVision(vision, {
          system: "你是视觉定位助手。只依据画面、绝不猜测。只输出 JSON，不要解释。",
          user: `图中有明确可见的「${it.name}」吗？有就框出来，输出 JSON：{"found": true, "bbox_2d": [x1, y1, x2, y2]}（像素坐标，左上角与右下角）。没有就输出 {"found": false}。`,
          images: [b64(frame.file)],
          signal,
        });
        const r = parseModelJSON(ans);
        if (!r?.found) continue;
        const dim = jpegSize(fs.readFileSync(frame.file));
        const box = dim ? clampBbox(r.bbox_2d, dim.width, dim.height) : null;
        let cropped = false;
        if (box) {
          await run(resolveFfmpegBin(), ["-y", "-i", frame.file, "-vf", `crop=${box.w}:${box.h}:${box.x}:${box.y}`, "-q:v", "3", outPath], signal).catch(() => {});
          cropped = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
        }
        if (!cropped) fs.copyFileSync(frame.file, outPath);
        it.image = name;
        saved++;
      } catch {
        // 本食材失败，跳过
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return saved;
}
