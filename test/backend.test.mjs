import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFromHtml } from "../src/fetchText.mjs";
import { toMarkdown } from "../src/render.mjs";
import { isUrl, ytdlpArgs } from "../src/download.mjs";
import { loadConfig } from "../src/config.mjs";
import { DEPTHS } from "../src/explain.mjs";

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

test("DEPTHS 是三个合法深度", () => {
  assert.deepEqual([...DEPTHS].sort(), ["advanced", "balanced", "beginner"]);
});

/* ===== 画面截图（步骤状态图/食材图）相关纯函数 ===== */
import { parseWhisperJson, offsetSegments, formatTimedTranscript } from "../src/transcribe.mjs";
import { normalizeSourceTime, clampStepTimes } from "../src/chef.mjs";
import { candidateTimes, clampBbox, jpegSize } from "../src/vision.mjs";

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
