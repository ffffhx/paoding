import fs from "node:fs";
import path from "node:path";
import { acquire } from "./download.mjs";
import { transcribe, formatTimedTranscript } from "./transcribe.mjs";
import { structureRecipe, clampStepTimes } from "./chef.mjs";
import { explainSteps } from "./explain.mjs";
import { toMarkdown } from "./render.mjs";
import { fetchArticleText } from "./fetchText.mjs";
import { extractFrames, visionTranscript, probeDuration, extractStepImages, extractIngredientImages, transcribeRecipeImage } from "./vision.mjs";

const slug = (s) =>
  (s || "recipe")
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40) || "recipe";

// 完整管线：视频 → 音频 → 转写 → 结构化 → 逐步讲解 → 落盘。
// onProgress({stage, pct, message})：stage 是阶段名，pct 是 0~100 的总体进度。
export async function processVideo(input, config, { keepTranscript = false, onProgress = () => {}, signal } = {}) {
  const step = (n, msg) => console.log(`\x1b[36m[${n}/5]\x1b[0m ${msg}`);
  const emit = (stage, pct, message) => onProgress({ stage, pct: Math.round(pct), message });

  // vision = 抽帧读屏上字幕；images = 步骤/食材截图。两者都需要完整视频与视觉模型。
  const useVision = !!config.vision;
  const useImages = !!config.images;
  step(1, useVision || useImages ? "下载视频并抽取音频…" : "获取视频并抽取音频…");
  emit("acquire", 2, "准备中…");
  const { audioPath, videoPath, meta, cleanup } = await acquire(input, config.ytdlp, (p) =>
    emit("acquire", p.pct * 0.25, p.message), { wantVideo: useVision || useImages, signal },
  );

  try {
    step(2, "语音转文字（ASR）…");
    emit("transcribe", 25, "语音转文字…");
    const asrOut = await transcribe(config.asr, audioPath, (p) =>
      emit("transcribe", 25 + p.pct * 0.2, p.message), signal,
    );
    const segments = asrOut.segments || [];
    let transcript = asrOut.text;

    // 视觉：抽帧 + 读屏上字幕/画面观察，融合进转写（兜住没口播、只有字幕的视频）
    let visualNote = "";
    if (useVision && videoPath) {
      step(2.5, "看画面读字幕（视觉）…");
      emit("vision", 46, "看画面读字幕…");
      try {
        const frames = await extractFrames(videoPath, { max: config.vision.maxFrames, signal });
        visualNote = await visionTranscript(config.vision, frames, (p) =>
          emit("vision", 46 + p.pct * 0.2, p.message), signal,
        );
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
    const recipe = await structureRecipe(config.llm, { transcript: llmTranscript, meta, signal });
    // 模型偶尔把 source_time 外推超过片长 → 用转写真实的最大时间戳硬校验
    if (segments.length) clampStepTimes(recipe.steps, Math.max(...segments.map((s) => s.end)));
    emit("structure", 80, "步骤已生成");

    step(4, `逐步生成「为什么」讲解（深度：${config.depth}）…`);
    emit("explain", 82, "逐步生成「为什么」…");
    await explainSteps(config.llm, recipe, config.depth, signal);
    emit("explain", useImages ? 88 : 98, "讲解已生成");

    fs.mkdirSync(config.outDir, { recursive: true });
    const base = path.join(config.outDir, slug(recipe.title || meta.title));

    // 步骤状态图 + 食材图：截到几张算几张，任何失败只降级为无图，不毁掉整趟解析
    if (useImages && videoPath) {
      step(4.5, "截取步骤与食材画面…");
      emit("images", 88, "截取步骤与食材画面…");
      try {
        const duration = meta.duration || (await probeDuration(videoPath, signal));
        if (duration) {
          fs.rmSync(base, { recursive: true, force: true }); // 同名菜谱重复解析：清掉旧图，别新旧混杂
          fs.mkdirSync(base, { recursive: true });
          await extractStepImages(config.images, videoPath, recipe, {
            duration, imagesDir: base, signal,
            onProgress: (p) => emit("images", 88 + p.pct * 0.05, p.message),
          });
          await extractIngredientImages(config.images, videoPath, recipe, {
            duration, segments, imagesDir: base, signal,
            onProgress: (p) => emit("images", 93 + p.pct * 0.05, p.message),
          });
          // 一张都没截到就删掉空目录
          if (!fs.readdirSync(base).length) fs.rmdirSync(base);
        }
      } catch (e) {
        console.warn(`  · 画面截图失败（跳过，菜谱不带图）：${e.message}`);
      }
    }

    step(5, "写出结果…");
    recipe.source = input;
    recipe.created_at = new Date().toISOString();
    if (keepTranscript) recipe._transcript = llmTranscript;

    fs.writeFileSync(`${base}.json`, JSON.stringify(recipe, null, 2));
    fs.writeFileSync(`${base}.md`, toMarkdown(recipe, input, path.basename(base)));
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
  const isUrl = /^https?:\/\//i.test(input);
  let title = "", text = "";

  if (isUrl) {
    emit("acquire", 6, "抓取网页文字…");
    ({ title, text } = await fetchArticleText(input, config.ytdlp || {}));
    if (text.trim().length < 20) {
      throw new Error("没抓到足够的文字（可能是登录墙或纯图片帖）。可直接复制帖子文字，用「粘贴文字」解析。");
    }
  } else {
    text = input;
    title = (input.split("\n").find((l) => l.trim()) || "").slice(0, 30);
  }

  emit("structure", 40, "整理成步骤…");
  const recipe = await structureRecipe(config.llm, { transcript: text, meta: { title, description: text.slice(0, 2000) }, signal });
  emit("structure", 60, "步骤已生成");

  emit("explain", 65, "逐步生成「为什么」…");
  await explainSteps(config.llm, recipe, config.depth, signal);
  emit("explain", 96, "讲解已生成");

  recipe.source = isUrl ? input : "（粘贴文字）";
  recipe.created_at = new Date().toISOString();
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
  const files = Array.isArray(paths) ? paths : [];
  if (!config.vision) throw new Error("需配置视觉模型后才能拍照/图片导入。");
  if (!files.length) throw new Error("请至少提供一张菜谱图片。");

  const parts = [];
  for (let i = 0; i < files.length; i++) {
    emit("vision", 5 + (i / files.length) * 35, `识别第 ${i + 1}/${files.length} 张图片…`);
    const text = await transcribeRecipeImage(config.vision, files[i], { index: i + 1, total: files.length, signal });
    if (usableImageTranscript(text)) parts.push(`【第 ${i + 1} 张图】\n${text.trim()}`);
  }
  const transcript = parts.join("\n\n").trim();
  if (!usableImageTranscript(transcript)) throw new Error("图片中未识别到菜谱内容。");

  emit("structure", 50, "整理成步骤…");
  const recipe = await structureRecipe(config.llm, {
    transcript,
    meta: { title: "图片导入菜谱", description: transcript.slice(0, 2000) },
    signal,
  });
  for (const step of recipe.steps || []) delete step.source_time;
  emit("structure", 68, "步骤已生成");

  emit("explain", 72, "逐步生成「为什么」…");
  await explainSteps(config.llm, recipe, config.depth, signal);
  emit("explain", 96, "讲解已生成");

  recipe.source = "（图片导入）";
  recipe.source_type = "image";
  recipe.imported = true;
  recipe.created_at = new Date().toISOString();

  fs.mkdirSync(config.outDir, { recursive: true });
  const base = path.join(config.outDir, slug(recipe.title || "图片导入菜谱"));
  fs.writeFileSync(`${base}.json`, JSON.stringify(recipe, null, 2));
  fs.writeFileSync(`${base}.md`, toMarkdown(recipe, recipe.source));
  emit("done", 100, "完成");
  return { recipe, files: { json: `${base}.json`, md: `${base}.md` } };
}
