import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromHtml } from "../src/fetchText.mjs";
import { toMarkdown } from "../src/render.mjs";
import { formatProcessError, isUrl, ytdlpArgs } from "../src/download.mjs";
import { loadConfig } from "../src/config.mjs";
import { DEPTHS } from "../src/explain.mjs";
import { assertPublicUrl, isPrivateAddress } from "../src/urlSafety.mjs";
import { createSlidingWindowRateLimiter } from "../src/rateLimit.mjs";
import { createJobQueue } from "../src/jobs.mjs";
import { fetchWithRetry } from "../src/fetchRetry.mjs";
import { outputLanguageInstruction, withOutputLanguage } from "../src/outputLanguage.mjs";
import { applyIngredientFixes, fixIngredientName, replaceIngredientTypos } from "../src/ingredientFix.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_FFMPEG = path.join(TEST_DIR, "fixtures", "bin", "fake-ffmpeg.mjs");

test("isUrl 只认 http(s)", () => {
  assert.equal(isUrl("https://x.com"), true);
  assert.equal(isUrl("http://x.com"), true);
  assert.equal(isUrl("小红书一段文字"), false);
  assert.equal(isUrl("ftp://x"), false);
});

test("ytdlpArgs 带 Referer 与可选 cookie", () => {
  const a = ytdlpArgs("https://www.bilibili.com/video/BV1", { cookiesBrowser: "chrome", userAgent: "UA" });
  assert.ok(a.includes("--user-agent") && a.includes("UA"));
  assert.ok(a.join(" ").includes("Referer:https://www.bilibili.com/"));
  assert.ok(a.includes("--cookies-from-browser") && a.includes("chrome"));
  const b = ytdlpArgs("https://x.com", {});
  assert.ok(!b.includes("--cookies-from-browser"));
});

test("yt-dlp 412 错误提示用户配置浏览器 cookies", () => {
  const msg = formatProcessError("yt-dlp", 1, "ERROR: HTTP Error 412: Precondition Failed");
  assert.match(msg, /B站返回 412/);
  assert.match(msg, /PAODING_COOKIES_FROM_BROWSER=chrome/);
});

test("extractFromHtml 优先 og:title / og:description，去脚本", () => {
  const html = `<html><head><meta property="og:title" content="番茄炒蛋"><meta property="og:description" content="鸡蛋3个 番茄2个"></head><body><script>bad()</script>正文</body></html>`;
  const r = extractFromHtml(html);
  assert.equal(r.title, "番茄炒蛋");
  assert.ok(r.text.includes("鸡蛋3个"));
  assert.ok(!r.text.includes("bad()"));
});

test("extractFromHtml 无 og 时用 <title> 与正文", () => {
  const html = `<html><head><title>菜谱页</title></head><body><article>切葱花，热锅下油，翻炒出锅收汁装盘完成这道菜</article></body></html>`;
  const r = extractFromHtml(html);
  assert.equal(r.title, "菜谱页");
  assert.ok(r.text.includes("切葱花"));
});

test("toMarkdown 结构完整", () => {
  const md = toMarkdown({ title: "西红柿炒蛋", servings: "2人份", ingredients: [{ name: "鸡蛋", amount: "3个" }], steps: [{ index: 1, title: "打蛋", action: "打散", params: { time: "2分钟" }, why: { reason: "更嫩" } }] }, "http://src");
  assert.ok(md.includes("# 西红柿炒蛋"));
  assert.ok(md.includes("- 鸡蛋 · 3个"));
  assert.ok(md.includes("### 第 1 步 · 打蛋"));
  assert.ok(md.includes("时间：2分钟"));
  assert.ok(md.includes("原理：更嫩"));
  assert.ok(md.includes("来源：http://src"));
});

test("loadConfig 返回必填结构", () => {
  // 让测试不依赖本地 .env（CI 无 .env）：process.env 优先于 .env
  process.env.PAODING_LLM_BASE_URL ||= "http://localhost:11434/v1";
  process.env.PAODING_LLM_API_KEY ||= "test";
  const c = loadConfig();
  assert.ok(c.llm.baseUrl && c.llm.apiKey && c.llm.model);
  assert.ok(c.asr && c.ytdlp);
  assert.equal(typeof c.depth, "string");
});

test("输出语言约束默认 zh 不改变 prompt，en 才追加", () => {
  const system = "原始 system prompt";
  assert.equal(withOutputLanguage(system, undefined), system);
  assert.equal(withOutputLanguage(system, "zh"), system);
  assert.match(withOutputLanguage(system, "en"), /Output language: English/);
  assert.throws(() => outputLanguageInstruction("fr"), /只支持 zh 或 en/);
});

test("ingredientFix 纠正常见 ASR 食材同音字并保留不确定词", () => {
  assert.deepEqual(fixIngredientName("白纸"), { name: "白芷", corrected: true, original: "白纸" });
  assert.deepEqual(fixIngredientName("肉豆扣粉"), { name: "肉豆蔻粉", corrected: true, original: "肉豆扣粉" });
  assert.deepEqual(fixIngredientName("白糖"), { name: "白糖", corrected: false });
  assert.equal(replaceIngredientTypos("加入白纸、肉豆扣和草扣。"), "加入白芷、肉豆蔻和草蔻。");
});

test("applyIngredientFixes 修正食材名、追加 note 并替换步骤文本", () => {
  const recipe = {
    ingredients: [
      { name: "白纸", amount: "2片", note: "香料" },
      { name: "肉豆扣", amount: "1个", note: "" },
      { name: "白糖", amount: "10克", note: "" },
    ],
    steps: [
      { title: "下白纸", action: "加入白纸和肉豆扣，小火煮香。", params: { cue: "白纸香味出来" } },
    ],
  };
  applyIngredientFixes(recipe);
  assert.equal(recipe.ingredients[0].name, "白芷");
  assert.equal(recipe.ingredients[0].note, "香料；转写作「白纸」，已按烹饪常识纠正。");
  assert.equal(recipe.ingredients[1].name, "肉豆蔻");
  assert.equal(recipe.ingredients[1].note, "转写作「肉豆扣」，已按烹饪常识纠正。");
  assert.equal(recipe.ingredients[2].note, "");
  assert.equal(recipe.steps[0].title, "下白芷");
  assert.equal(recipe.steps[0].action, "加入白芷和肉豆蔻，小火煮香。");
  assert.equal(recipe.steps[0].params.cue, "白芷香味出来");
  applyIngredientFixes(recipe);
  assert.equal(recipe.ingredients[0].note, "香料；转写作「白纸」，已按烹饪常识纠正。");
});

test("applyIngredientFixes 只按本菜谱命中的纠错项替换步骤，避免词表误伤", () => {
  const recipe = {
    ingredients: [{ name: "白糖", amount: "10克", note: "" }],
    steps: [
      { title: "垫白纸", action: "用白纸吸油，保持自然粉色。", params: { cue: "纸面吸走多余油" } },
    ],
  };
  applyIngredientFixes(recipe);
  assert.equal(recipe.steps[0].title, "垫白纸");
  assert.equal(recipe.steps[0].action, "用白纸吸油，保持自然粉色。");
  assert.equal(recipe.steps[0].params.cue, "纸面吸走多余油");

  const corrected = {
    ingredients: [{ name: "肉豆扣粉", amount: "1克", note: "" }],
    steps: [{ title: "下香料", action: "加入肉豆扣粉和肉豆扣，小火煮香。" }],
  };
  applyIngredientFixes(corrected);
  assert.equal(corrected.ingredients[0].name, "肉豆蔻粉");
  assert.equal(corrected.steps[0].action, "加入肉豆蔻粉和肉豆蔻，小火煮香。");
});

test("applyIngredientFixes 纠正食材 note 里的香料同音字且不误改步骤里的白纸", () => {
  const recipe = {
    ingredients: [
      {
        name: "香料包",
        amount: "1个",
        note: "包含八角、白纸（转写作「原词」，已按烹饪常识纠正）、肉豆扣、桂皮。",
      },
    ],
    steps: [
      { title: "吸油", action: "出锅后用白纸吸油。" },
    ],
  };

  applyIngredientFixes(recipe);
  assert.equal(
    recipe.ingredients[0].note,
    "包含八角、白芷（转写作「白纸」，已按烹饪常识纠正）、肉豆蔻、桂皮。；转写作「肉豆扣」，已按烹饪常识纠正。",
  );
  assert.equal(recipe.steps[0].action, "出锅后用白纸吸油。");

  applyIngredientFixes(recipe);
  assert.equal(
    recipe.ingredients[0].note,
    "包含八角、白芷（转写作「白纸」，已按烹饪常识纠正）、肉豆蔻、桂皮。；转写作「肉豆扣」，已按烹饪常识纠正。",
  );
});

test("loadConfig 读取 PAODING_OUTPUT_LANG", () => {
  const old = {
    PAODING_LLM_BASE_URL: process.env.PAODING_LLM_BASE_URL,
    PAODING_LLM_API_KEY: process.env.PAODING_LLM_API_KEY,
    PAODING_OUTPUT_LANG: process.env.PAODING_OUTPUT_LANG,
  };
  try {
    process.env.PAODING_LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.PAODING_LLM_API_KEY = "test";
    process.env.PAODING_OUTPUT_LANG = "en";
    assert.equal(loadConfig().llm.outputLang, "en");
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("DEPTHS 是三个合法深度", () => {
  assert.deepEqual([...DEPTHS].sort(), ["advanced", "balanced", "beginner"]);
});

test("assertPublicUrl 拒绝本机/私网/链路本地地址", async () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("10.1.2.3"), true);
  assert.equal(isPrivateAddress("100.64.0.1"), true);
  assert.equal(isPrivateAddress("172.16.0.1"), true);
  assert.equal(isPrivateAddress("192.168.1.9"), true);
  assert.equal(isPrivateAddress("169.254.169.254"), true);
  assert.equal(isPrivateAddress("198.18.0.1"), true);
  assert.equal(isPrivateAddress("203.0.113.10"), true);
  assert.equal(isPrivateAddress("224.0.0.1"), true);
  assert.equal(isPrivateAddress("255.255.255.255"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("::ffff:100.64.0.1"), true);
  assert.equal(isPrivateAddress("fc00::1"), true);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("ff02::1"), true);
  assert.equal(isPrivateAddress("2001:db8::1"), true);
  assert.equal(isPrivateAddress("93.184.216.34"), false);
  assert.equal(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
  await assert.rejects(() => assertPublicUrl("http://127.0.0.1:4177/"), /拒绝访问/);
  await assert.rejects(() => assertPublicUrl("http://100.64.0.1/"), /拒绝访问/);
  await assert.rejects(() => assertPublicUrl("http://[::1]/"), /拒绝访问/);
});

test("assertPublicUrl 拒绝解析到私网的域名，允许公网地址", async () => {
  await assert.rejects(() => assertPublicUrl("https://private.example/a", {
    lookup: async () => [{ address: "192.168.1.8", family: 4 }],
  }), /拒绝访问/);
  assert.equal(await assertPublicUrl("https://public.example/a", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  }), "https://public.example/a");
});

test("滑动窗口限流按 key 计数并随时间恢复", () => {
  let now = 1000;
  const limiter = createSlidingWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.take("ip1").allowed, true);
  assert.equal(limiter.take("ip1").allowed, true);
  assert.equal(limiter.take("ip1").allowed, false);
  assert.equal(limiter.take("ip2").allowed, true);
  now = 2001;
  assert.equal(limiter.take("ip1").allowed, true);
});

test("任务队列 FIFO、位置与上限", () => {
  const q = createJobQueue(2);
  assert.deepEqual(q.enqueue({ id: "a", start: () => {} }), { ok: true, position: 1 });
  assert.deepEqual(q.enqueue({ id: "b", start: () => {} }), { ok: true, position: 2 });
  assert.equal(q.isFull(), true);
  assert.deepEqual(q.enqueue({ id: "c", start: () => {} }), { ok: false, position: 0 });
  assert.equal(q.position("b"), 2);
  assert.equal(q.dequeueReady().id, "a");
  assert.equal(q.position("b"), 1);
  assert.equal(q.dequeueReady().id, "b");
  assert.equal(q.dequeueReady(), null);
});

test("fetchWithRetry 重试网络错误、5xx 与 429", async () => {
  let calls = 0;
  const res = await fetchWithRetry("https://example.test/a", {}, {
    delaysMs: [0, 0],
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error("socket hang up");
      if (calls === 2) return new Response("busy", { status: 503 });
      return new Response("ok", { status: 200 });
    },
  });
  assert.equal(await res.text(), "ok");
  assert.equal(calls, 3);

  let hit429 = 0;
  const after429 = await fetchWithRetry("https://example.test/b", {}, {
    delaysMs: [0],
    fetchImpl: async () => (++hit429 === 1 ? new Response("limit", { status: 429 }) : new Response("ok")),
  });
  assert.equal(after429.status, 200);
  assert.equal(hit429, 2);
});

test("fetchWithRetry 不重试普通 4xx", async () => {
  let calls = 0;
  const res = await fetchWithRetry("https://example.test/404", {}, {
    delaysMs: [0, 0],
    fetchImpl: async () => { calls++; return new Response("no", { status: 404 }); },
  });
  assert.equal(res.status, 404);
  assert.equal(calls, 1);
});

test("fetchWithRetry 尊重 AbortSignal", async () => {
  const ac = new AbortController();
  ac.abort(new Error("stop-now"));
  let calls = 0;
  await assert.rejects(() => fetchWithRetry("https://example.test/abort", { signal: ac.signal }, {
    fetchImpl: async () => { calls++; return new Response("never"); },
  }), /stop-now/);
  assert.equal(calls, 0);

  const ac2 = new AbortController();
  let delayedCalls = 0;
  const p = fetchWithRetry("https://example.test/retry", { signal: ac2.signal }, {
    delaysMs: [50],
    fetchImpl: async () => { delayedCalls++; return new Response("retry", { status: 503 }); },
  });
  setTimeout(() => ac2.abort(new Error("stop-delay")), 0);
  await assert.rejects(() => p, /stop-delay/);
  assert.equal(delayedCalls, 1);
});

/* ===== 画面截图（步骤状态图/食材图）相关纯函数 ===== */
import { parseWhisperJson, offsetSegments, formatTimedTranscript } from "../src/transcribe.mjs";
import { normalizeSourceTime, clampStepTimes, sourceTimeCoverage, normalizeTools, normalizeRecipePhases, extractRecipeCardTranscript, inferBakingToolFallback, annotateRecipeCardSources } from "../src/chef.mjs";
import { candidateTimes, clampBbox, jpegSize, recipeCardCapturePoints, ensureRecipeCardMarker, mapLimitSettled, extractIngredientImages, visionTranscript } from "../src/vision.mjs";

test("parseWhisperJson 解析 whisper.cpp -oj 输出", () => {
  const out = parseWhisperJson({
    transcription: [
      { offsets: { from: 0, to: 3200 }, text: " 今天做红烧肉" },
      { offsets: { from: 3200, to: 7800 }, text: " 五花肉切块" },
      { offsets: { from: 7800, to: 8000 }, text: "  " }, // 空段丢弃
    ],
  });
  assert.equal(out.text, "今天做红烧肉\n五花肉切块");
  assert.deepEqual(out.segments, [
    { start: 0, end: 3.2, text: "今天做红烧肉" },
    { start: 3.2, end: 7.8, text: "五花肉切块" },
  ]);
});

test("parseWhisperJson 容忍缺字段/脏输入", () => {
  assert.deepEqual(parseWhisperJson({}), { text: "", segments: [] });
  assert.deepEqual(parseWhisperJson(null), { text: "", segments: [] });
});

test("offsetSegments 平移回全片时间轴", () => {
  const segs = offsetSegments([{ start: 1, end: 2, text: "a" }], 900);
  assert.deepEqual(segs, [{ start: 901, end: 902, text: "a" }]);
});

test("formatTimedTranscript 输出 [分:秒] 标记", () => {
  const t = formatTimedTranscript([
    { start: 0, end: 3, text: "起锅烧油" },
    { start: 65.4, end: 70, text: "下肉煸炒" },
  ]);
  assert.equal(t, "[00:00] 起锅烧油\n[01:05] 下肉煸炒");
});

test("normalizeSourceTime 规整时间段", () => {
  assert.deepEqual(normalizeSourceTime([10, 25]), [10, 25]);
  assert.deepEqual(normalizeSourceTime([25, 10]), [10, 25]); // 颠倒自动换位
  assert.deepEqual(normalizeSourceTime([8, 8]), [8, 10]); // 零长度兜成 2 秒窗
  assert.equal(normalizeSourceTime(null), null);
  assert.equal(normalizeSourceTime([1]), null);
  assert.equal(normalizeSourceTime(["a", "b"]), null);
  assert.equal(normalizeSourceTime([-5, 10]), null);
});

test("sourceTimeCoverage 统计步骤时间戳覆盖率", () => {
  assert.deepEqual(sourceTimeCoverage([
    { index: 1, source_time: [0, 10] },
    { index: 2 },
    { index: 3, source_time: [20, 30] },
  ]), {
    steps_with_source_time: 2,
    total_steps: 3,
    summary: "2/3 步有时间戳",
  });
  assert.deepEqual(sourceTimeCoverage(null), {
    steps_with_source_time: 0,
    total_steps: 0,
    summary: "0/0 步有时间戳",
  });
});

test("normalizeTools 清洗工具清单并保留替代说明", () => {
  assert.deepEqual(normalizeTools(null), []);
  assert.deepEqual(normalizeTools([
    { name: " 裱花袋 ", purpose: "挤奶油", essential: true, substitute: "保鲜袋剪角", substitute_note: "线条不稳定", inferred: false },
    { name: "戚风模具", purpose: "帮助爬升", essential: "true", substitute: "  ", substitute_note: "防粘模具会影响爬升", inferred: "true" },
    { name: "<b>抹刀</b>\n", purpose: { text: "整理 <i>奶油</i>" }, essential: "1", substitute: { name: "勺子" }, substitute_note: ["边缘粗糙", "<script>bad()</script>"], inferred: 1 },
    { name: "", purpose: "无效" },
    "bad",
  ]), [
    { name: "裱花袋", purpose: "挤奶油", essential: true, substitute: "保鲜袋剪角", substitute_note: "线条不稳定", inferred: false },
    { name: "戚风模具", purpose: "帮助爬升", essential: true, substitute: null, substitute_note: "防粘模具会影响爬升", inferred: true },
    { name: "抹刀", purpose: "整理 奶油", essential: true, substitute: "勺子", substitute_note: "边缘粗糙", inferred: true },
  ]);
});

test("inferBakingToolFallback 为甜品烘焙步骤补齐缺失工具且不重复已有工具", () => {
  const recipe = {
    title: "松软戚风蛋糕",
    cuisine: "烘焙",
    tags: ["甜品", "蛋糕"],
    ingredients: [
      { name: "低筋面粉", amount: "80克" },
      { name: "鸡蛋", amount: "5个" },
    ],
    tools: [
      {
        name: "烤箱",
        purpose: "烘烤蛋糕",
        essential: true,
        substitute: null,
        substitute_note: "需要稳定烘烤温度",
        inferred: false,
      },
    ],
    steps: [
      { title: "打发", action: "用电动打蛋器打发蛋白。" },
      { title: "混合", action: "低筋面粉过筛后倒入蛋黄盆，用刮刀翻拌均匀。" },
      { title: "烘烤", action: "面糊倒入模具，送入预热好的烤箱烘烤。" },
      { title: "冷却", action: "出炉后倒扣在烤架上放凉，再脱模。" },
    ],
  };

  const tools = inferBakingToolFallback(recipe, recipe.tools);
  const names = tools.map((tool) => tool.name);
  assert.equal(names.filter((name) => name === "烤箱").length, 1);
  for (const name of ["打蛋器", "模具", "筛网", "耐热盆", "烤架", "刮刀"]) {
    assert.ok(names.includes(name), `应补齐 ${name}`);
    assert.equal(tools.find((tool) => tool.name === name).inferred, true);
  }
});

test("inferBakingToolFallback 非甜品不因打蛋/过筛误补烘焙工具", () => {
  const recipe = {
    title: "家常蒸水蛋",
    cuisine: "家常菜",
    tags: ["快手", "蒸菜"],
    ingredients: [{ name: "鸡蛋", amount: "3个" }],
    steps: [
      { title: "打蛋", action: "鸡蛋打散后用滤网过筛，倒入碗中。" },
      { title: "蒸制", action: "放入蒸锅，小火蒸到凝固。" },
    ],
  };
  assert.deepEqual(inferBakingToolFallback(recipe, []), []);
});

test("normalizeRecipePhases 清洗批量/单份 phase 并拒绝半拆", () => {
  const ok = {
    batch_info: { yield: "一壶茶汤（约1300毫升）", makes_servings: "4", makes_note: "按每杯250毫升推算（推算）", serving_desc: "以下为单杯用量" },
    ingredients: [
      { name: "茉莉茶汤", phase: "batch" },
      { name: "牛奶", phase: "serving" },
    ],
    steps: [
      { title: "泡茶", phase: "batch" },
      { title: "组装", phase: "serving" },
    ],
  };
  normalizeRecipePhases(ok);
  assert.equal(ok.ingredients[0].phase, "batch");
  assert.equal(ok.steps[1].phase, "serving");
  assert.equal(ok.batch_info.makes_servings, 4);

  const partial = {
    batch_info: { yield: "一壶" },
    ingredients: [{ name: "茶汤", phase: "batch" }, { name: "牛奶" }],
    steps: [{ title: "泡茶", phase: "batch" }, { title: "组装", phase: "serving" }],
  };
  normalizeRecipePhases(partial);
  assert.ok(partial.ingredients.every((i) => !("phase" in i)));
  assert.ok(partial.steps.every((s) => !("phase" in s)));
  assert.equal(partial.batch_info, undefined);

  const illegal = { ingredients: [{ name: "茶", phase: "base" }], steps: [{ title: "做", phase: "serving" }] };
  normalizeRecipePhases(illegal);
  assert.equal(illegal.ingredients[0].phase, undefined);
  assert.equal(illegal.steps[0].phase, undefined);
});

test("extractRecipeCardTranscript 提取画面配方卡段落", () => {
  const text = [
    "[00:00] 口播说牛奶大约一杯",
    "【画面观察 / 屏上文字】",
    "普通字幕：搅拌均匀",
    "【画面配方卡】",
    "牛奶 400毫升",
    "茉莉茶汤 1300毫升",
    "【其它画面】",
    "倒入杯中",
  ].join("\n");
  assert.equal(extractRecipeCardTranscript(text), "【画面配方卡】\n牛奶 400毫升\n茉莉茶汤 1300毫升");
});

test("recipeCardCapturePoints 为片头和片尾配方卡预留时间点", () => {
  const points = recipeCardCapturePoints(120, { max: 8 });
  assert.equal(points.length, 8);
  assert.deepEqual(points.map((p) => p.kind), ["head", "head", "head", "tail", "tail", "tail", "tail", "tail"]);
  assert.ok(points.slice(0, 3).every((p) => p.time >= 0.5 && p.time <= 30));
  assert.ok(points.slice(0, 3).some((p) => p.time >= 10 && p.time <= 20));
  assert.ok(points.slice(3).every((p) => p.time >= 90 && p.time <= 119.5));
  for (let i = 1; i < points.length; i++) assert.ok(points[i].time > points[i - 1].time);

  const short = recipeCardCapturePoints(20, { max: 4 });
  assert.ok(short.some((p) => p.kind === "tail" && p.time >= 16 && p.time <= 19.5));
  assert.ok(short.some((p) => p.kind === "tail" && p.time >= 19));
  const tiny = recipeCardCapturePoints(2, { max: 2 });
  assert.ok(tiny.some((p) => p.kind === "tail" && p.time >= 1.4));
  const long = recipeCardCapturePoints(7200, { max: 8 });
  assert.equal(long.length, 8);
  assert.ok(long.some((p) => p.kind === "tail" && p.time >= 7199));
  assert.equal(recipeCardCapturePoints(null, { max: 8 }).length, 0);
});

test("ensureRecipeCardMarker 为漏标的配方表视觉转录补标记", () => {
  const text = [
    "万能面包配方表",
    "高粉：150g 牛奶：75g 白砂糖：60g",
    "奶粉：5g 盐：4g 黄油：36g",
  ].join("\n");
  assert.equal(ensureRecipeCardMarker(text), `【画面配方卡】\n${text}`);
  assert.equal(ensureRecipeCardMarker(`【画面配方卡】\n${text}`), `【画面配方卡】\n${text}`);
  assert.equal(ensureRecipeCardMarker(`${text}\n【画面配方卡】`), `【画面配方卡】\n${text}`);
  assert.equal(ensureRecipeCardMarker("配方表：无明确信息"), "配方表：无明确信息");
  assert.equal(ensureRecipeCardMarker("今天分享一个面包配方，揉到出膜。"), "今天分享一个面包配方，揉到出膜。");
});

test("annotateRecipeCardSources 按配方卡用量为食材补出处 note", () => {
  const recipe = {
    ingredients: [
      { name: "高筋面粉", amount: "150克", qty: 150, unit: "克", note: "" },
      { name: "牛奶", amount: "150毫升（面种75g+主面75g）", qty: 150, unit: "毫升", note: "可用0.9倍水替代" },
      { name: "盐", amount: "少许", qty: null, unit: "", note: "" },
      { name: "橄榄油", amount: "10克", qty: 10, unit: "克", note: "" },
    ],
  };
  annotateRecipeCardSources(recipe, [
    "【画面配方卡】",
    "万能面包配方表",
    "高粉：150g",
    "牛奶：75g",
    "盐：4g",
  ].join("\n"));
  assert.equal(recipe.ingredients[0].note, "出处：画面配方卡");
  assert.equal(recipe.ingredients[1].note, "可用0.9倍水替代；出处：画面配方卡");
  assert.equal(recipe.ingredients[2].note, "");
  assert.equal(recipe.ingredients[3].note, "");
  annotateRecipeCardSources(recipe, "【画面配方卡】\n高粉：150g\n牛奶：75g");
  assert.equal(recipe.ingredients[0].note, "出处：画面配方卡");
  assert.equal(recipe.ingredients[1].note, "可用0.9倍水替代；出处：画面配方卡");
});

test("visionTranscript 片头逐张读屏避免配方卡被多图稀释", async () => {
  const originalFetch = globalThis.fetch;
  const batchSizes = [];
  const progress = [];
  globalThis.fetch = async (input, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    const system = String(body.messages?.find((m) => m.role === "system")?.content || "");
    const userContent = body.messages?.find((m) => m.role === "user")?.content || [];
    const imageCount = userContent.filter((part) => part?.type === "image_url").length;
    batchSizes.push(imageCount);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: system.includes("请只做 OCR")
            ? "万能面包配方表\n高粉：150g 牛奶：75g 白砂糖：60g"
            : "这个配方表可以做出千变万化的面包来",
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const frames = Array.from({ length: 6 }, (_, i) => Buffer.from(`frame-${i}`).toString("base64"));
    const text = await visionTranscript(
      { baseUrl: "http://vision-stub.test/v1", apiKey: "test", model: "stub-vision" },
      frames,
      (p) => progress.push(p.message),
    );
    assert.deepEqual(batchSizes, [1, 1, 1, 1, 1, 1, 3]);
    assert.deepEqual(progress, ["看画面读字幕…（1/6）", "看画面读字幕…（2/6）", "看画面读字幕…（3/6）", "看画面读字幕…（6/6）"]);
    assert.match(text, /【画面配方卡】/);
    assert.match(text, /高粉：150g/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("candidateTimes 段内取样、偏向段末、夹回视频范围", () => {
  const ts = candidateTimes([10, 30], 300);
  assert.ok(ts.length >= 2 && ts.length <= 4);
  assert.ok(ts.every((t) => t >= 10 && t <= 30));
  assert.ok(ts[ts.length - 1] > 25, "最后一个候选应接近段末");
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] > ts[i - 1]);
  // 时间段超出视频末尾时夹回
  const tail = candidateTimes([290, 400], 300);
  assert.ok(tail.every((t) => t <= 299.5));
  // 极短区间不产出重叠时刻
  const short = candidateTimes([5, 6], 300);
  assert.ok(short.length >= 1);
});

test("mapLimitSettled 限制并发并把单项失败保留为 rejected", async () => {
  let active = 0, maxActive = 0;
  const calls = [];
  const out = await mapLimitSettled([1, 2, 3, 4], 2, async (n) => {
    calls.push(n);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (n === 3) throw new Error("bad item");
    return n * 10;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(calls.sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.deepEqual(out.map((r) => r.status), ["fulfilled", "fulfilled", "rejected", "fulfilled"]);
  assert.deepEqual(out.filter((r) => r.status === "fulfilled").map((r) => r.value), [10, 20, 40]);
});

test("clampBbox 加边距/夹回图内/拒绝碎框", () => {
  const box = clampBbox([100, 100, 300, 260], 960, 540);
  assert.ok(box.x < 100 && box.y < 100, "应向外扩边距");
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= 960 && box.y + box.h <= 540);
  // 越界坐标夹回
  const edge = clampBbox([-50, -50, 500, 600], 960, 540);
  assert.equal(edge.x, 0); assert.equal(edge.y, 0); assert.ok(edge.y + edge.h <= 540);
  // 左右颠倒自动换位
  assert.ok(clampBbox([300, 260, 100, 100], 960, 540));
  // 太小/非法拒绝
  assert.equal(clampBbox([10, 10, 20, 20], 960, 540), null);
  assert.equal(clampBbox([1, 2, 3], 960, 540), null);
  assert.equal(clampBbox("bad", 960, 540), null);
});

test("jpegSize 读 JPEG 宽高", () => {
  // 手工构造最小 SOF0 头：FFD8 + APP0 段 + SOF0(高 540 宽 960)
  const b = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 长度4
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x1c, 0x03, 0xc0, 0x01, 0x11, 0x00, // SOF0: h=540 w=960
  ]);
  assert.deepEqual(jpegSize(b), { height: 540, width: 960 });
  assert.equal(jpegSize(Buffer.from([0x00, 0x01])), null);
  assert.equal(jpegSize(null), null);
});

test("extractIngredientImages 并发裁剪保留成功结果且单个食材失败不影响整批", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-ing-test-"));
  const oldFetch = globalThis.fetch;
  const oldFfmpeg = process.env.PAODING_FFMPEG_BIN;
  const cropCalls = {};
  let activeCrops = 0, maxActiveCrops = 0;
  const respond = (content) => new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    process.env.PAODING_FFMPEG_BIN = FAKE_FFMPEG;
    globalThis.fetch = async (input, init = {}) => {
      assert.ok(String(input).endsWith("/chat/completions"));
      const body = JSON.parse(String(init.body || "{}"));
      const system = String(body.messages?.find((m) => m.role === "system")?.content || "");
      const userMsg = body.messages?.find((m) => m.role === "user")?.content;
      const userText = Array.isArray(userMsg)
        ? String(userMsg.find((item) => item.type === "text")?.text || "")
        : String(userMsg || "");

      if (system.includes("给食材清单配图")) {
        return respond(JSON.stringify({ 鸡蛋: 1, 番茄: 1, 小葱: 2, 盐: 0 }));
      }
      if (system.includes("视觉定位助手")) {
        const name = userText.match(/「([^」]+)」/)?.[1] || "";
        cropCalls[name] = (cropCalls[name] || 0) + 1;
        activeCrops++;
        maxActiveCrops = Math.max(maxActiveCrops, activeCrops);
        try {
          await new Promise((resolve) => setTimeout(resolve, 15));
        } finally {
          activeCrops--;
        }
        if (name === "小葱") return respond("不是 JSON");
        return respond(JSON.stringify({ found: true, bbox_2d: [10, 10, 120, 120] }));
      }
      return respond("{}");
    };

    const videoPath = path.join(root, "input.mp4");
    const imagesDir = path.join(root, "images");
    fs.writeFileSync(videoPath, "fake video\n");
    fs.mkdirSync(imagesDir);
    const recipe = {
      ingredients: [
        { name: "鸡蛋" },
        { name: "番茄" },
        { name: "小葱" },
        { name: "盐" },
      ],
    };

    const saved = await extractIngredientImages({
      baseUrl: "http://vision.test/v1",
      apiKey: "test-key",
      model: "vision-stub",
      ingredientConcurrency: 2,
    }, videoPath, recipe, { duration: 20, imagesDir });

    assert.equal(saved, 2);
    assert.equal(recipe.ingredients[0].image, "ing-1.jpg");
    assert.equal(recipe.ingredients[1].image, "ing-2.jpg");
    assert.equal(recipe.ingredients[2].image, undefined);
    assert.equal(recipe.ingredients[3].image, undefined);
    assert.equal(cropCalls["小葱"], 1);
    assert.ok(maxActiveCrops > 1, "定位阶段应并发执行");
    assert.ok(maxActiveCrops <= 2, "定位阶段并发不应超过配置值");
    assert.ok(fs.existsSync(path.join(imagesDir, "ing-1.jpg")));
    assert.ok(fs.existsSync(path.join(imagesDir, "ing-2.jpg")));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldFfmpeg === undefined) delete process.env.PAODING_FFMPEG_BIN;
    else process.env.PAODING_FFMPEG_BIN = oldFfmpeg;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("toMarkdown 带截图时嵌入图片", () => {
  const md = toMarkdown({
    title: "红烧肉",
    ingredients: [{ name: "五花肉", amount: "500克", image: "ing-1.jpg" }],
    steps: [{ index: 1, title: "煸炒", action: "下锅煸炒", image: "step-1.jpg" }],
  }, "http://src", "红烧肉");
  assert.ok(md.includes("![第1步画面](红烧肉/step-1.jpg)"));
  assert.ok(md.includes("![五花肉](红烧肉/ing-1.jpg)"));
  // 不传 imagesDir 时不嵌图（旧调用兼容）
  const md2 = toMarkdown({ title: "x", steps: [{ index: 1, action: "a", image: "step-1.jpg" }] }, "");
  assert.ok(!md2.includes("step-1.jpg"));
});

test("clampStepTimes 用转写最大时间戳硬校验", () => {
  const steps = [
    { index: 1, source_time: [0, 38] },
    { index: 2, source_time: [150, 200] },  // 部分越界 → 截断
    { index: 3, source_time: [301, 326] },  // 全部越界 → 丢弃
    { index: 4 },                            // 无时间 → 不动
  ];
  clampStepTimes(steps, 174.2);
  assert.deepEqual(steps[0].source_time, [0, 38]);
  assert.deepEqual(steps[1].source_time, [150, 175]);
  assert.equal(steps[2].source_time, undefined);
  assert.equal(steps[3].source_time, undefined);
  // 非法 maxEnd 不动任何东西
  const keep = [{ source_time: [500, 600] }];
  clampStepTimes(keep, null);
  assert.deepEqual(keep[0].source_time, [500, 600]);
});
