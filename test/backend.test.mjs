import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromHtml } from "../src/fetchText.mjs";
import { toMarkdown } from "../src/render.mjs";
import { isUrl, ytdlpArgs } from "../src/download.mjs";
import { loadConfig } from "../src/config.mjs";
import { DEPTHS } from "../src/explain.mjs";
import { assertPublicUrl, isPrivateAddress } from "../src/urlSafety.mjs";
import { createSlidingWindowRateLimiter } from "../src/rateLimit.mjs";
import { createJobQueue } from "../src/jobs.mjs";
import { fetchWithRetry } from "../src/fetchRetry.mjs";
import { outputLanguageInstruction, withOutputLanguage } from "../src/outputLanguage.mjs";
import { applyIngredientFixes, fixIngredientName, replaceIngredientTypos } from "../src/ingredientFix.mjs";

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
import { normalizeSourceTime, clampStepTimes, normalizeTools, extractRecipeCardTranscript } from "../src/chef.mjs";
import { candidateTimes, clampBbox, jpegSize, recipeCardCapturePoints } from "../src/vision.mjs";

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
  assert.deepEqual(points.map((p) => p.kind), ["head", "head", "tail", "tail", "tail", "tail", "tail", "tail"]);
  assert.ok(points.slice(0, 2).every((p) => p.time >= 0.5 && p.time <= 5));
  assert.ok(points.slice(2).every((p) => p.time >= 90 && p.time <= 119.5));
  for (let i = 1; i < points.length; i++) assert.ok(points[i].time > points[i - 1].time);

  const short = recipeCardCapturePoints(20, { max: 4 });
  assert.ok(short.some((p) => p.kind === "tail" && p.time >= 16 && p.time <= 19.5));
  assert.equal(recipeCardCapturePoints(null, { max: 8 }).length, 0);
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
