import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { acquire } from "./download.mjs";
import { transcribe, formatTimedTranscript } from "./transcribe.mjs";
import { structureRecipe, clampStepTimes, sourceTimeCoverage } from "./chef.mjs";
import { explainSteps } from "./explain.mjs";
import { toMarkdown } from "./render.mjs";
import { fetchArticleText, unusableRecipeTextReason } from "./fetchText.mjs";
import { createStageTimer } from "./timings.mjs";
import { extractFrames, visionTranscript, probeDuration, extractStepImages, extractIngredientImages, transcribeRecipeImage } from "./vision.mjs";

const slug = (s) =>
  (s || "recipe")
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40) || "recipe";

const RETAINED_MEDIA_EXTS = new Set([".mp4", ".webm", ".m4v", ".mov", ".ogv", ".mp3", ".m4a"]);

// App 跟做模式要在原地播放对应时间段，不能只留下会跳出应用的来源链接。
// 固定写进菜谱同名资源目录，目录会随菜谱删除一起清理。
export function retainSourceMedia(videoPath, basePath) {
  if (!videoPath || !fs.existsSync(videoPath)) return "";
  const rawExt = path.extname(videoPath).toLowerCase();
  const ext = RETAINED_MEDIA_EXTS.has(rawExt) ? rawExt : ".mp4";
  fs.mkdirSync(basePath, { recursive: true });
  for (const old of fs.readdirSync(basePath)) {
    if (/^source\.(?:mp4|webm|m4v|mov|ogv|mp3|m4a)$/i.test(old)) {
      fs.rmSync(path.join(basePath, old), { force: true });
    }
  }
  const file = `source${ext}`;
  fs.copyFileSync(videoPath, path.join(basePath, file));
  return file;
}

function transcodeRetainedVideo(ffmpeg, input, output, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg || "ffmpeg", [
      "-y", "-i", input,
      "-vf", "fps=30,scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
      "-c:a", "aac", "-b:a", "96k",
      "-movflags", "+faststart",
      output,
    ], { stdio: ["ignore", "ignore", "pipe"], signal });
    let errorText = "";
    child.stderr.on("data", (buf) => { errorText += buf.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}${errorText ? `：${errorText.slice(-300)}` : ""}`));
    });
  });
}

export async function retainPlayableSourceMedia(videoPath, basePath, { ffmpeg = "ffmpeg", signal } = {}) {
  const ext = path.extname(videoPath || "").toLowerCase();
  if ([".mp3", ".m4a"].includes(ext)) return retainSourceMedia(videoPath, basePath);
  fs.mkdirSync(basePath, { recursive: true });
  const tmp = path.join(basePath, "source.tmp.mp4");
  const dest = path.join(basePath, "source.mp4");
  fs.rmSync(tmp, { force: true });
  try {
    await transcodeRetainedVideo(ffmpeg, videoPath, tmp, signal);
    for (const old of fs.readdirSync(basePath)) {
      if (/^source\.(?:mp4|webm|m4v|mov|ogv|mp3|m4a)$/i.test(old)) fs.rmSync(path.join(basePath, old), { force: true });
    }
    fs.renameSync(tmp, dest);
    return "source.mp4";
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (signal?.aborted) throw e;
    console.warn(`  · 原视频 H.264 转码失败，保留原编码：${e.message}`);
    return retainSourceMedia(videoPath, basePath);
  }
}

function timeoutMinutes(envName, fallback) {
  const raw = Number(process.env[envName]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, raw);
}

function abortError(signal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason : new Error("操作已取消");
}

async function withStageTimeout(label, minutes, parentSignal, fn) {
  const parentError = abortError(parentSignal);
  if (parentError) throw parentError;
  if (!minutes) return fn(parentSignal);

  const ctrl = new AbortController();
  const timeout = new Error(`${label}超时（超过 ${minutes} 分钟），已跳过`);
  let timer;
  const onAbort = () => ctrl.abort(abortError(parentSignal) || new Error("操作已取消"));
  try {
    parentSignal?.addEventListener("abort", onAbort, { once: true });
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort(timeout);
        reject(timeout);
      }, minutes * 60 * 1000);
      timer.unref?.();
    });
    return await Promise.race([fn(ctrl.signal), timeoutPromise]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

// 完整管线：视频 → 音频 → 转写 → 结构化 → 逐步讲解 → 落盘。
// onProgress({stage, pct, message})：stage 是阶段名，pct 是 0~100 的总体进度。
export async function processVideo(input, config, { keepTranscript = false, retainMedia = false, onProgress = () => {}, signal } = {}) {
  const step = (n, msg) => console.log(`\x1b[36m[${n}/5]\x1b[0m ${msg}`);
  const emit = (stage, pct, message) => onProgress({ stage, pct: Math.round(pct), message });
  const timer = createStageTimer();

  // vision = 抽帧读屏上字幕；images = 步骤/食材截图。两者都需要完整视频与视觉模型。
  const useVision = !!config.vision;
  const useImages = !!config.images;
  const keepSourceMedia = !!retainMedia;
  step(1, useVision || useImages || keepSourceMedia ? "下载视频并抽取音频…" : "获取视频并抽取音频…");
  emit("acquire", 2, "准备中…");
  const { audioPath, videoPath, meta, cleanup } = await timer.time("acquire", () =>
    acquire(input, config.ytdlp, (p) =>
      emit("acquire", p.pct * 0.25, p.message), { wantVideo: useVision || useImages || keepSourceMedia, signal }),
  );

  try {
    step(2, "语音转文字（ASR）…");
    emit("transcribe", 25, "语音转文字…");
    const asrOut = await timer.time("transcribe", () =>
      transcribe(config.asr, audioPath, (p) =>
        emit("transcribe", 25 + p.pct * 0.2, p.message), signal),
    );
    const segments = asrOut.segments || [];
    let transcript = asrOut.text;

    // 视觉：抽帧 + 读屏上字幕/画面观察，融合进转写（兜住没口播、只有字幕的视频）
    let visualNote = "";
    if (useVision && videoPath) {
      step(2.5, "看画面读字幕（视觉）…");
      emit("vision", 46, "看画面读字幕…");
      try {
        visualNote = await timer.time("vision", async () => {
          const frames = await extractFrames(videoPath, { max: config.vision.maxFrames, duration: meta.duration, signal });
          return visionTranscript(config.vision, frames, (p) =>
            emit("vision", 46 + p.pct * 0.2, p.message), signal,
          );
        });
      } catch (e) {
        console.warn(`  · 视觉解析失败（跳过，仅用口播）：${e.message}`);
      }
    }

    // 有分段时间戳就喂 [分:秒] 标记版转写，让 LLM 顺带标出每步对应的视频时间段（截图定位用）
    const llmTranscript = [
      segments.length ? formatTimedTranscript(segments) : transcript,
      visualNote ? `【画面观察 / 屏上文字】\n${visualNote}` : "",
    ].filter(Boolean).join("\n\n").trim();
    if (visualNote) transcript = `${transcript || ""}\n\n【画面观察 / 屏上文字】\n${visualNote}`.trim();

    step(3, "整理成结构化菜谱…");
    emit("structure", 68, "整理成步骤…");
    const recipe = await timer.time("structure", async () => {
      const out = await structureRecipe(config.llm, { transcript: llmTranscript, meta, signal });
      // 模型偶尔把 source_time 外推超过片长 → 用转写真实的最大时间戳硬校验
      if (segments.length) clampStepTimes(out.steps, Math.max(...segments.map((s) => s.end)));
      out.source_time_coverage = sourceTimeCoverage(out.steps);
      return out;
    });
    console.log(`  · source_time 覆盖率：${recipe.source_time_coverage.summary}`);
    emit("structure", 80, "步骤已生成");

    step(4, `逐步生成「为什么」讲解（深度：${config.depth}）…`);
    emit("explain", 82, "逐步生成「为什么」…");
    await timer.time("explain", () => explainSteps(config.llm, recipe, config.depth, signal));
    emit("explain", useImages ? 88 : 98, "讲解已生成");

    fs.mkdirSync(config.outDir, { recursive: true });
    const base = path.join(config.outDir, slug(recipe.title || meta.title));
    recipe.source = input;
    recipe.created_at = new Date().toISOString();
    if (keepTranscript) recipe._transcript = llmTranscript;
    const writeOutputs = () => {
      fs.writeFileSync(`${base}.json`, JSON.stringify(recipe, null, 2));
      fs.writeFileSync(`${base}.md`, toMarkdown(recipe, input, path.basename(base)));
    };
    recipe.timings = timer.snapshot();
    writeOutputs();

    // 步骤状态图 + 食材图：截到几张算几张，任何失败只降级为无图，不毁掉整趟解析
    if (useImages && videoPath) {
      step(4.5, "截取步骤与食材画面…");
      emit("images", 88, "截取步骤与食材画面…");
      try {
        const duration = meta.duration || (await probeDuration(videoPath, signal));
        if (duration) {
          fs.rmSync(base, { recursive: true, force: true }); // 同名菜谱重复解析：清掉旧图，别新旧混杂
          fs.mkdirSync(base, { recursive: true });
          await timer.time("step_images", () => withStageTimeout(
            "步骤截图",
            timeoutMinutes("PAODING_STEP_IMAGE_TIMEOUT_MIN", 3),
            signal,
            (stageSignal) => extractStepImages(config.images, videoPath, recipe, {
              duration, imagesDir: base, signal: stageSignal,
              onProgress: (p) => emit("images", 88 + p.pct * 0.05, p.message),
            }),
          ));
          await timer.time("ingredient_images", () => withStageTimeout(
            "食材截图",
            timeoutMinutes("PAODING_INGREDIENT_IMAGE_TIMEOUT_MIN", 3),
            signal,
            (stageSignal) => extractIngredientImages(config.images, videoPath, recipe, {
              duration, segments, imagesDir: base, signal: stageSignal,
              onProgress: (p) => emit("images", 93 + p.pct * 0.05, p.message),
            }),
          ));
          // 一张都没截到就删掉空目录
          if (!fs.readdirSync(base).length) fs.rmdirSync(base);
          recipe.timings = timer.snapshot();
          writeOutputs();
        }
      } catch (e) {
        console.warn(`  · 画面截图失败（跳过，图片可能不完整）：${e.message}`);
      }
    }

    if (keepSourceMedia && videoPath) {
      try {
        recipe.source_media = await retainPlayableSourceMedia(videoPath, base, {
          ffmpeg: config.ytdlp?.ffmpegBin,
          signal,
        });
      } catch (e) {
        console.warn(`  · 原视频保存失败（应用内片段播放将降级为外链）：${e.message}`);
      }
    }

    step(5, "写出结果…");
    recipe.timings = timer.snapshot({ includeTotal: true });
    writeOutputs();
    emit("done", 100, "完成");

    return { recipe, files: { json: `${base}.json`, md: `${base}.md` } };
  } finally {
    cleanup();
  }
}

// 文字管线：文字帖 URL（抓网页文字）或直接粘贴的文字 → 结构化 → 讲解 → 落盘。
// 用于小红书图文/公众号/下厨房等没有音频的来源，跳过下载与转写。
export async function processText(input, config, { onProgress = () => {}, signal } = {}) {
  const emit = (stage, pct, message) => onProgress({ stage, pct: Math.round(pct), message });
  const timer = createStageTimer();
  const isUrl = /^https?:\/\//i.test(input);
  let title = "", text = "";

  if (isUrl) {
    emit("acquire", 6, "抓取网页文字…");
    ({ title, text } = await timer.time("acquire", () => fetchArticleText(input, config.ytdlp || {})));
    const unusableReason = unusableRecipeTextReason({ title, text });
    if (unusableReason) {
      throw new Error(`${unusableReason}。可直接复制帖子文字，用「粘贴文字」解析。`);
    }
  } else {
    text = input;
    title = (input.split("\n").find((l) => l.trim()) || "").slice(0, 30);
  }

  emit("structure", 40, "整理成步骤…");
  const recipe = await timer.time("structure", () =>
    structureRecipe(config.llm, { transcript: text, meta: { title, description: text.slice(0, 2000) }, signal }),
  );
  for (const step of recipe.steps || []) delete step.source_time;
  delete recipe.source_time_coverage;
  emit("structure", 60, "步骤已生成");

  emit("explain", 65, "逐步生成「为什么」…");
  await timer.time("explain", () => explainSteps(config.llm, recipe, config.depth, signal));
  emit("explain", 96, "讲解已生成");

  recipe.source = isUrl ? input : "（粘贴文字）";
  recipe.created_at = new Date().toISOString();
  recipe.timings = timer.snapshot({ includeTotal: true });
  fs.mkdirSync(config.outDir, { recursive: true });
  const base = path.join(config.outDir, slug(recipe.title || title));
  fs.writeFileSync(`${base}.json`, JSON.stringify(recipe, null, 2));
  fs.writeFileSync(`${base}.md`, toMarkdown(recipe, recipe.source));
  emit("done", 100, "完成");
  return { recipe, files: { json: `${base}.json`, md: `${base}.md` } };
}

function usableImageTranscript(text) {
  const cleaned = String(text || "")
    .replace(/（?未识别到菜谱内容）?/g, "")
    .replace(/没有可识别的菜谱内容/g, "")
    .replace(/\s+/g, "");
  return cleaned.length >= 10;
}

// 图片管线：拍照/截图 → 视觉模型转录 → 结构化 → 逐步讲解 → 落盘。
// 图片来源没有可靠视频时间轴，所有步骤都不保留 source_time。
export async function processImages(paths, config, { onProgress = () => {}, signal } = {}) {
  const emit = (stage, pct, message) => onProgress({ stage, pct: Math.round(pct), message });
  const timer = createStageTimer();
  const files = Array.isArray(paths) ? paths : [];
  if (!config.vision) throw new Error("需配置视觉模型后才能拍照/图片导入。");
  if (!files.length) throw new Error("请至少提供一张菜谱图片。");

  const parts = [];
  await timer.time("vision", async () => {
    for (let i = 0; i < files.length; i++) {
      emit("vision", 5 + (i / files.length) * 35, `识别第 ${i + 1}/${files.length} 张图片…`);
      const text = await transcribeRecipeImage(config.vision, files[i], { index: i + 1, total: files.length, signal });
      if (usableImageTranscript(text)) parts.push(`【第 ${i + 1} 张图】\n${text.trim()}`);
    }
  });
  const transcript = parts.join("\n\n").trim();
  if (!usableImageTranscript(transcript)) throw new Error("图片中未识别到菜谱内容。");

  emit("structure", 50, "整理成步骤…");
  const recipe = await timer.time("structure", () => structureRecipe(config.llm, {
    transcript,
    meta: { title: "图片导入菜谱", description: transcript.slice(0, 2000) },
    signal,
  }));
  for (const step of recipe.steps || []) delete step.source_time;
  emit("structure", 68, "步骤已生成");

  emit("explain", 72, "逐步生成「为什么」…");
  await timer.time("explain", () => explainSteps(config.llm, recipe, config.depth, signal));
  emit("explain", 96, "讲解已生成");

  recipe.source = "（图片导入）";
  recipe.source_type = "image";
  recipe.imported = true;
  recipe.created_at = new Date().toISOString();
  recipe.timings = timer.snapshot({ includeTotal: true });

  fs.mkdirSync(config.outDir, { recursive: true });
  const base = path.join(config.outDir, slug(recipe.title || "图片导入菜谱"));
  fs.writeFileSync(`${base}.json`, JSON.stringify(recipe, null, 2));
  fs.writeFileSync(`${base}.md`, toMarkdown(recipe, recipe.source));
  emit("done", 100, "完成");
  return { recipe, files: { json: `${base}.json`, md: `${base}.md` } };
}
