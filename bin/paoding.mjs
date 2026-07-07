#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { processVideo } from "../src/pipeline.mjs";
import { DEPTHS } from "../src/explain.mjs";
import { formatTimingTable } from "../src/timings.mjs";

const HELP = `庖丁 · 做菜视频解析引擎 (MVP)

用法:
  paoding <视频URL 或 本地视频路径> [选项]

选项:
  --depth <beginner|balanced|advanced>  讲解深度（默认取 PAODING_DEPTH 或 balanced）
  --out <目录>                          输出目录（默认 ./paoding-out）
  --images                              截取步骤状态图 + 食材图（需配置 PAODING_VISION_MODEL，会下载整段视频）
  --keep-transcript                     在 JSON 里保留原始转写文本（调试用）
  -h, --help                            显示帮助

示例:
  paoding ./红烧肉.mp4
  paoding "https://www.bilibili.com/video/BVxxxx" --depth advanced --images

配置见 .env.example（需要 OpenAI 兼容的大模型接口 + ASR）。`;

function parseArgs(argv) {
  const args = { input: null, depth: null, out: null, keepTranscript: false, images: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    else if (a === "--depth") args.depth = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--keep-transcript") args.keepTranscript = true;
    else if (a === "--images") args.images = true;
    else if (!a.startsWith("-") && !args.input) args.input = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`\x1b[31m配置错误：\x1b[0m ${e.message}`);
    process.exit(1);
  }
  if (args.depth) {
    if (!DEPTHS.includes(args.depth)) {
      console.error(`\x1b[31m参数错误：\x1b[0m --depth 只能是 ${DEPTHS.join(" | ")}（收到「${args.depth}」）`);
      process.exit(1);
    }
    config.depth = args.depth;
  }
  if (args.out) config.outDir = args.out;
  if (args.images) {
    if (!config.vision) {
      console.error("\x1b[31m参数错误：\x1b[0m --images 需要视觉模型，请先设置 PAODING_VISION_MODEL（如 qwen2.5vl:7b）");
      process.exit(1);
    }
    config.images = config.vision; // 截图挑帧/食材识别复用视觉模型配置
  }

  const t0 = Date.now();
  try {
    const { recipe, files } = await processVideo(args.input, config, {
      keepTranscript: args.keepTranscript,
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n\x1b[32m✓ 完成\x1b[0m 《${recipe.title}》 共 ${recipe.steps.length} 步，用时 ${secs}s`);
    const timingTable = formatTimingTable(recipe.timings);
    if (timingTable) console.log(timingTable);
    console.log(`  · Markdown: ${files.md}`);
    console.log(`  · JSON:     ${files.json}`);
  } catch (e) {
    console.error(`\n\x1b[31m✗ 失败：\x1b[0m ${e.message}`);
    process.exit(1);
  }
}

main();
