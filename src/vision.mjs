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

const roundTime = (t) => Math.round(t * 10) / 10;

function spreadTimes(start, end, count, minGap = 1, { includeEnd = false } = {}) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || count <= 0 || end < start) return [];
  const raw = [];
  const span = Math.max(0, end - start);
  for (let i = 0; i < count; i++) {
    const ratio = includeEnd
      ? (count === 1 ? 1 : i / (count - 1))
      : ((i + 0.5) / count);
    raw.push(roundTime(start + ratio * span));
  }
  const out = [];
  for (const t of (includeEnd ? raw.slice().reverse() : raw)) {
    if (!out.some((x) => Math.abs(x - t) < minGap)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

// 读屏 OCR 的专项补抽点：片头配方表窗口 + 片尾配方卡帧。
// 很多短视频会先口播几句，10-30 秒才给整屏配方表；片尾窗口为最后 20%，普通长视频至少覆盖最后 30 秒。
export function recipeCardCapturePoints(duration, {
  max = 8,
  headCount = 3,
  tailCount = 5,
  headSeconds = 30,
  tailRatio = 0.2,
  minTailSeconds = 30,
  minGapSeconds = 1,
} = {}) {
  const d = Number(duration);
  const capNum = Number(max);
  const cap = Math.max(0, Math.floor(Number.isFinite(capNum) ? capNum : headCount + tailCount));
  if (!Number.isFinite(d) || d <= 1 || cap <= 0) return [];

  const reserve = Math.min(headCount + tailCount, cap);
  let head = reserve >= tailCount + 1 ? Math.min(headCount, reserve - tailCount) : (reserve >= 3 ? 1 : 0);
  let tail = reserve - head;
  if (tail > tailCount) {
    head = Math.min(headCount, head + tail - tailCount);
    tail = tailCount;
  }

  const safeEnd = Math.max(0.6, d - 0.5);
  const headEnd = Math.min(headSeconds, safeEnd);
  const tailWindow = d < minTailSeconds ? Math.max(1, d * tailRatio) : Math.max(d * tailRatio, minTailSeconds);
  const tailStart = Math.max(0.5, d - tailWindow);

  const points = [
    ...spreadTimes(0.5, headEnd, head, minGapSeconds).map((time) => ({ kind: "head", time })),
    ...spreadTimes(tailStart, safeEnd, tail, minGapSeconds, { includeEnd: true }).map((time) => ({ kind: "tail", time })),
  ].sort((a, b) => a.time - b.time);

  const out = [];
  for (const p of points) {
    if (!out.some((x) => Math.abs(x.time - p.time) < minGapSeconds)) out.push(p);
  }
  return out;
}

async function extractVisionFrameAt(ffmpeg, videoPath, tSec, outPath, signal) {
  await run(ffmpeg, ["-y", "-ss", String(tSec), "-i", videoPath, "-frames:v", "1", "-vf", "scale=768:-1", "-q:v", "3", outPath], signal);
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
}

// 从视频抽关键帧：优先场景切换、抽不到再退回固定间隔；缩放到 768 宽、限量。返回 base64 jpg 数组。
export async function extractFrames(videoPath, { max = 20, duration = null, signal } = {}) {
  const ffmpeg = resolveFfmpegBin();
  const maxFrames = Math.max(0, Math.floor(Number(max) || 0));
  if (!maxFrames) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-frames-"));
  const scenePattern = path.join(dir, "scene-%04d.jpg");
  const collect = (prefix) => fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".jpg")).sort();
  try {
    const d = Number.isFinite(Number(duration)) && Number(duration) > 0
      ? Number(duration)
      : await probeDuration(videoPath, signal).catch(() => null);
    const minSceneBudget = maxFrames > 8 ? 3 : Math.min(2, Math.floor(maxFrames / 2));
    const cardPoints = recipeCardCapturePoints(d, { max: Math.max(0, maxFrames - minSceneBudget) });
    const sceneBudget = Math.max(0, maxFrames - cardPoints.length);

    // 场景切换抽帧
    if (sceneBudget > 0) {
      await run(ffmpeg, ["-y", "-i", videoPath, "-vf", "select='gt(scene,0.3)',scale=768:-1", "-vsync", "vfr", "-frames:v", String(sceneBudget), scenePattern], signal).catch(() => {});
    }
    let sceneFiles = collect("scene-");
    if (sceneBudget > 0 && sceneFiles.length < Math.min(3, sceneBudget)) {
      // 兜底：每 6 秒一帧
      sceneFiles.forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
      await run(ffmpeg, ["-y", "-i", videoPath, "-vf", "fps=1/6,scale=768:-1", "-frames:v", String(sceneBudget), scenePattern], signal);
      sceneFiles = collect("scene-");
    }

    const headFiles = [], tailFiles = [];
    for (let i = 0; i < cardPoints.length; i++) {
      const p = cardPoints[i];
      const name = `${p.kind}-${String(i + 1).padStart(2, "0")}.jpg`;
      const file = path.join(dir, name);
      try {
        if (await extractVisionFrameAt(ffmpeg, videoPath, p.time, file, signal)) {
          (p.kind === "head" ? headFiles : tailFiles).push(name);
        }
      } catch {
        // 单个补抽点失败不影响其它帧
      }
    }

    const files = [...headFiles, ...sceneFiles, ...tailFiles].slice(0, maxFrames);
    return files.map((f) => fs.readFileSync(path.join(dir, f)).toString("base64"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const VISION_TRANSCRIPT_BATCH_SIZE = 3;
export const VISION_TRANSCRIPT_HEAD_SINGLE_FRAMES = 3;

const RECIPE_CARD_MARKER = "【画面配方卡】";
const VISION_AMOUNT_RE = /\d+(?:\.\d+)?\s*(?:g|克|kg|千克|ml|毫升|L|升|个|只|枚|颗|勺|匙|杯|份)/gi;

function recipeCardScore(text) {
  const marked = ensureRecipeCardMarker(text);
  const amountCount = marked.match(VISION_AMOUNT_RE)?.length || 0;
  return (marked.includes(RECIPE_CARD_MARKER) ? 100 : 0) + amountCount;
}

// 视觉模型逐批读帧：抽屏上文字（字幕/用量标注）+ 画面里能确认的食材/动作/火候，拼成「画面转写」。
export async function visionTranscript(vision, frames, onProgress = () => {}, signal) {
  if (!frames.length) return "";
  const batch = VISION_TRANSCRIPT_BATCH_SIZE, parts = [];
  for (let i = 0; i < frames.length;) {
    const size = i < Math.min(VISION_TRANSCRIPT_HEAD_SINGLE_FRAMES, frames.length) ? 1 : batch;
    const end = Math.min(i + size, frames.length);
    onProgress({ pct: Math.round((i / frames.length) * 100), message: `看画面读字幕…（${end}/${frames.length}）` });
    try {
      const text = await chatVision(vision, {
        system: "你在看一段做菜视频按时间顺序截取的若干帧。请抽出两类信息：\n1) 画面上出现的所有文字（字幕、标题、用量/火候标注等），逐字照抄，别改写。\n2) 画面里能明确看到的食材、操作动作、火候/状态。\n如果遇到整屏文字、列表排版、配料表、配方卡这类高价值画面，必须逐字完整转录（尤其是用量数字与单位），并用「【画面配方卡】」标记该段。\n只写你真的看到的，绝不脑补。简洁中文，分点。看不到有用信息就回「（本组无有用信息）」。",
        user: "这些是按时间先后排列的截图：",
        images: frames.slice(i, end),
        signal,
      });
      let finalText = text;
      if (size === 1 && i < VISION_TRANSCRIPT_HEAD_SINGLE_FRAMES && recipeCardScore(text) < 103) {
        const retry = await chatVision(vision, {
          system: "你在看一张做菜视频截图。这张图可能是整屏配方表、配料表或材料清单。请只做 OCR：逐字抄出画面中所有配方表文字和用量数字，不要总结、不要省略。如果看到表格、列表或配方卡，必须以「【画面配方卡】」开头。看不清就写「看不清」。",
          user: "请转录这张截图里的配方表/配料表文字：",
          images: frames.slice(i, end),
          signal,
        });
        if (recipeCardScore(retry) > recipeCardScore(text)) finalText = retry;
      }
      if (finalText && !finalText.includes("本组无有用信息")) parts.push(ensureRecipeCardMarker(finalText.trim()));
    } catch (e) {
      // 单批失败不影响整体
    }
    i = end;
  }
  return parts.join("\n");
}

/* ================= 画面截图：步骤状态图 + 食材图 ================= */

export function ensureRecipeCardMarker(text) {
  const trimmed = String(text || "").trim();
  const marker = RECIPE_CARD_MARKER;
  if (!trimmed) return trimmed;
  if (trimmed.startsWith(marker)) return trimmed;
  const body = trimmed.split(marker).join("").trim();
  if (!/(配方表|配方卡|配料表|材料表|用料表|食材清单)/.test(body)) return trimmed;
  const amounts = body.match(VISION_AMOUNT_RE) || [];
  if (amounts.length < 3) return trimmed;
  return `${marker}\n${body}`;
}

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

export function stepImageCandidateCount(sourceTime, duration) {
  const d = Number(duration);
  if (Number.isFinite(d) && d > 0 && d <= 180) return 1;
  if (!Array.isArray(sourceTime) || sourceTime.length < 2) return 1;
  const span = Math.max(0, Number(sourceTime[1]) - Number(sourceTime[0]));
  if (!Number.isFinite(span) || span <= 10) return 1;
  if (span <= 25) return 2;
  return 4;
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

function abortReason(signal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason : new Error("操作已取消");
}

function throwIfAborted(signal) {
  const reason = abortReason(signal);
  if (reason) throw reason;
}

export async function mapLimitSettled(items, limit, fn, { signal } = {}) {
  const list = Array.from(items || []);
  if (!list.length) return [];
  const workerCount = Math.max(1, Math.min(Math.floor(Number(limit)) || 1, list.length));
  const results = new Array(list.length);
  let next = 0;

  async function worker() {
    while (true) {
      throwIfAborted(signal);
      const index = next++;
      if (index >= list.length) return;
      try {
        results[index] = { status: "fulfilled", value: await fn(list[index], index) };
      } catch (e) {
        if (signal?.aborted) throw e;
        results[index] = { status: "rejected", reason: e };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function ingredientCropConcurrency(vision) {
  const raw = Number(vision?.ingredientConcurrency || process.env.PAODING_INGREDIENT_IMAGE_CONCURRENCY || 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(1, Math.min(3, Math.floor(raw)));
}

function imageMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

// 拍照/截图导入：只做 OCR/转录，绝不把看不清的内容补全成菜谱。
export async function transcribeRecipeImage(vision, imagePath, { index = 1, total = 1, signal } = {}) {
  return chatVision(vision, {
    system: "你是菜谱图片转录助手。请只根据图片中真实可见的文字和版面，原样转录菜谱相关内容：标题、食材、用量、步骤、火候、时间、备注。不要把看不清或没有出现的信息补全，不要创作新菜谱。若图片中没有可识别的菜谱内容，只输出「（未识别到菜谱内容）」。",
    user: `这是第 ${index}/${total} 张菜谱图片。按阅读顺序转录可见菜谱文字；多余广告、水印、无关评论可省略。`,
    images: [{ b64: b64(imagePath), mime: imageMime(imagePath) }],
    temperature: 0.1,
    signal,
  });
}

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
        const times = candidateTimes(s.source_time, duration, stepImageCandidateCount(s.source_time, duration));
        const files = [];
        for (let k = 0; k < times.length; k++) {
          const fp = path.join(tmp, `s${s.index}-c${k}.jpg`);
          if (await extractFrameAt(videoPath, times[k], fp, signal)) files.push(fp);
        }
        if (!files.length) continue;
        let best = 1;
        const cue = s.params?.cue ? `，到位标准：「${s.params.cue}」` : "";
        if (files.length === 1) {
          const ans = await chatVision(vision, {
            system: "你在帮做菜教程挑选步骤配图。只输出 JSON，不要解释。",
            user: `这是一张候选步骤图。步骤：「${s.title || ""}：${s.action || ""}」${cue}。\n它是否清晰展示这一步的操作或完成状态？食物/锅具应为主体；黑屏、转场、片头片尾、纯人脸特写、不相关画面都算不合适。\n输出 JSON：{"ok": true 或 false}`,
            images: [b64(files[0])],
            signal,
          });
          const parsed = parseModelJSON(ans);
          if (parsed?.ok !== true && Number(parsed?.best) !== 1) continue;
        } else {
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

    const frameCache = new Map();
    const frameInfo = (frame) => {
      let cached = frameCache.get(frame.file);
      if (!cached) {
        const buf = fs.readFileSync(frame.file);
        cached = { b64: buf.toString("base64"), dim: jpegSize(buf) };
        frameCache.set(frame.file, cached);
      }
      return cached;
    };

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
          images: part.map((f) => frameInfo(f).b64),
          signal,
        });
        const map = parseModelJSON(ans) || {};
        for (const [name, v] of Object.entries(map)) {
          const n = Number(v);
          if (!names.includes(name) || bestFrame[name] || !Number.isFinite(n) || n < 1 || n > part.length) continue;
          bestFrame[name] = part[n - 1];
        }
      } catch (e) {
        if (signal?.aborted) throw e;
        // 单批失败不影响整体
      }
    }

    // ---- 对命中的食材：请模型框位置 → 裁特写；框不出就整帧 ----
    const hit = ings.filter((it) => bestFrame[it.name]);
    let started = 0;
    const cropResults = await mapLimitSettled(hit, ingredientCropConcurrency(vision), async (it) => {
      const current = ++started;
      onProgress({ pct: 55 + Math.round(((current - 1) / hit.length) * 40), message: `裁剪食材特写…（${current}/${hit.length}）` });
      const frame = bestFrame[it.name];
      const name = `ing-${ings.indexOf(it) + 1}.jpg`;
      const outPath = path.join(imagesDir, name);
      // 定位调用兼做第二道复核：批量标注阶段小模型偶有幻觉，这里单独盯着一张图再确认一次。
      // found=false → 放弃该食材（宁缺毋滥）；found=true 但框不可用 → 退回整帧。
      const info = frameInfo(frame);
      const ans = await chatVision(vision, {
        system: "你是视觉定位助手。只依据画面、绝不猜测。只输出 JSON，不要解释。",
        user: `图中有明确可见的「${it.name}」吗？有就框出来，输出 JSON：{"found": true, "bbox_2d": [x1, y1, x2, y2]}（像素坐标，左上角与右下角）。没有就输出 {"found": false}。`,
        images: [info.b64],
        signal,
      });
      const r = parseModelJSON(ans);
      if (!r?.found) return 0;
      const box = info.dim ? clampBbox(r.bbox_2d, info.dim.width, info.dim.height) : null;
      let cropped = false;
      if (box) {
        await run(resolveFfmpegBin(), ["-y", "-i", frame.file, "-vf", `crop=${box.w}:${box.h}:${box.x}:${box.y}`, "-q:v", "3", outPath], signal).catch((e) => {
          if (signal?.aborted) throw e;
        });
        cropped = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
      }
      if (!cropped) fs.copyFileSync(frame.file, outPath);
      it.image = name;
      return 1;
    }, { signal });
    saved += cropResults.reduce((sum, r) => sum + (r.status === "fulfilled" ? Number(r.value) || 0 : 0), 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return saved;
}
