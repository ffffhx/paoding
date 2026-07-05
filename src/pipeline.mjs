import fs from "node:fs";
import path from "node:path";
import { acquire } from "./download.mjs";
import { transcribe } from "./transcribe.mjs";
import { structureRecipe } from "./chef.mjs";
import { explainSteps } from "./explain.mjs";
import { toMarkdown } from "./render.mjs";

const slug = (s) =>
  (s || "recipe")
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40) || "recipe";

// 完整管线：视频 → 音频 → 转写 → 结构化 → 逐步讲解 → 落盘。
// onProgress({stage, pct, message})：stage 是阶段名，pct 是 0~100 的总体进度。
export async function processVideo(input, config, { keepTranscript = false, onProgress = () => {} } = {}) {
  const step = (n, msg) => console.log(`\x1b[36m[${n}/5]\x1b[0m ${msg}`);
  const emit = (stage, pct, message) => onProgress({ stage, pct: Math.round(pct), message });

  step(1, "获取视频并抽取音频…");
  emit("acquire", 2, "准备中…");
  const { audioPath, meta, cleanup } = await acquire(input, config.ytdlp, (p) =>
    emit("acquire", p.pct * 0.3, p.message),
  );

  try {
    step(2, "语音转文字（ASR）…");
    emit("transcribe", 30, "语音转文字…");
    const transcript = await transcribe(config.asr, audioPath, (p) =>
      emit("transcribe", 30 + p.pct * 0.35, p.message),
    );

    step(3, "整理成结构化菜谱…");
    emit("structure", 68, "整理成步骤…");
    const recipe = await structureRecipe(config.llm, { transcript, meta });
    emit("structure", 82, "步骤已生成");

    step(4, `逐步生成「为什么」讲解（深度：${config.depth}）…`);
    emit("explain", 85, "逐步生成「为什么」…");
    await explainSteps(config.llm, recipe, config.depth);
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
