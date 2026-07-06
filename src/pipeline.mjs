import fs from "node:fs";
import path from "node:path";
import { acquire } from "./download.mjs";
import { transcribe } from "./transcribe.mjs";
import { structureRecipe } from "./chef.mjs";
import { explainSteps } from "./explain.mjs";
import { toMarkdown } from "./render.mjs";
import { fetchArticleText } from "./fetchText.mjs";
import { extractFrames, visionTranscript } from "./vision.mjs";

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

  const useVision = !!config.vision;
  step(1, useVision ? "下载视频并抽取音频…" : "获取视频并抽取音频…");
  emit("acquire", 2, "准备中…");
  const { audioPath, videoPath, meta, cleanup } = await acquire(input, config.ytdlp, (p) =>
    emit("acquire", p.pct * 0.25, p.message), { wantVideo: useVision, signal },
  );

  try {
    step(2, "语音转文字（ASR）…");
    emit("transcribe", 25, "语音转文字…");
    let transcript = await transcribe(config.asr, audioPath, (p) =>
      emit("transcribe", 25 + p.pct * 0.2, p.message), signal,
    );

    // 视觉：抽帧 + 读屏上字幕/画面观察，融合进转写（兜住没口播、只有字幕的视频）
    if (useVision && videoPath) {
      step(2.5, "看画面读字幕（视觉）…");
      emit("vision", 46, "看画面读字幕…");
      try {
        const frames = await extractFrames(videoPath, { max: config.vision.maxFrames, signal });
        const visual = await visionTranscript(config.vision, frames, (p) =>
          emit("vision", 46 + p.pct * 0.2, p.message), signal,
        );
        if (visual) transcript = `${transcript || ""}\n\n【画面观察 / 屏上文字】\n${visual}`.trim();
      } catch (e) {
        console.warn(`  · 视觉解析失败（跳过，仅用口播）：${e.message}`);
      }
    }

    step(3, "整理成结构化菜谱…");
    emit("structure", 68, "整理成步骤…");
    const recipe = await structureRecipe(config.llm, { transcript, meta, signal });
    emit("structure", 82, "步骤已生成");

    step(4, `逐步生成「为什么」讲解（深度：${config.depth}）…`);
    emit("explain", 85, "逐步生成「为什么」…");
    await explainSteps(config.llm, recipe, config.depth, signal);
    emit("explain", 98, "讲解已生成");

    step(5, "写出结果…");
    recipe.source = input;
    recipe.created_at = new Date().toISOString();
    if (keepTranscript) recipe._transcript = transcript;

    fs.mkdirSync(config.outDir, { recursive: true });
    const base = path.join(config.outDir, slug(recipe.title || meta.title));
    fs.writeFileSync(`${base}.json`, JSON.stringify(recipe, null, 2));
    fs.writeFileSync(`${base}.md`, toMarkdown(recipe, input));
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
