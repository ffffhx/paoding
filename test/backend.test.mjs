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
