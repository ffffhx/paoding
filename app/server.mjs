import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { processVideo } from "../src/pipeline.mjs";
import { chatText } from "../src/llm.mjs";
import { DEPTHS } from "../src/explain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECIPES_DIR = path.join(HERE, "recipes");
const PORT = process.env.PAODING_PORT ? Number(process.env.PAODING_PORT) : 4177;
const HOST = process.env.PAODING_HOST || "0.0.0.0"; // 默认局域网可达(手机用)；设 127.0.0.1 可锁本机
const MAX_RUNNING = Number(process.env.PAODING_MAX_JOBS || 2); // 同时解析上限，防资源耗尽
fs.mkdirSync(RECIPES_DIR, { recursive: true });

let config;
try {
  config = loadConfig();
  config.outDir = RECIPES_DIR;
} catch (e) {
  console.error(`\x1b[31m配置错误：\x1b[0m ${e.message}`);
  process.exit(1);
}

const slug = (s) => (s || "recipe").replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, "-").slice(0, 40);

function listRecipes() {
  return fs
    .readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, f), "utf8"));
        r.id = f.replace(/\.json$/, "");
        return r;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}
function loadRecipe(id) {
  const p = path.join(RECIPES_DIR, `${path.basename(id)}.json`);
  if (!fs.existsSync(p)) return null;
  const r = JSON.parse(fs.readFileSync(p, "utf8"));
  r.id = id;
  return r;
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req, limitMB = 800) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitMB * 1024 * 1024) { reject(new Error("文件过大")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------- 解析任务（带进度）----------
const jobs = new Map(); // id -> {status, progress, recipe, error, listeners:Set}
const runningCount = () => [...jobs.values()].filter((j) => j.status === "running").length;
function newJob() {
  const id = crypto.randomUUID();
  jobs.set(id, { status: "running", progress: { pct: 0, stage: "start", message: "排队中…" }, listeners: new Set() });
  return id;
}
function pushJob(id, ev) {
  const j = jobs.get(id);
  if (!j) return;
  for (const res of j.listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}
function runJob(id, input, depth) {
  const j = jobs.get(id);
  // 非法/缺省的 depth 归一到配置默认值，避免前端传错值时静默按 balanced 生成。
  const cfg = { ...config, depth: DEPTHS.includes(depth) ? depth : config.depth };
  processVideo(input, cfg, {
    onProgress: (p) => { j.progress = p; pushJob(id, { type: "progress", ...p }); },
  })
    .then(({ recipe }) => {
      j.status = "done"; j.recipe = recipe;
      pushJob(id, { type: "done", recipe });
      for (const res of j.listeners) res.end();
      setTimeout(() => jobs.delete(id), 5 * 60 * 1000);
    })
    .catch((e) => {
      j.status = "error"; j.error = e.message;
      pushJob(id, { type: "error", error: e.message });
      for (const res of j.listeners) res.end();
      setTimeout(() => jobs.delete(id), 5 * 60 * 1000);
    });
}

// ---------- 静态资源 ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon",
};
function serveStatic(res, pathname) {
  let rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const abs = path.join(HERE, rel);
  if (!abs.startsWith(HERE) || rel.startsWith("recipes/") || rel === "server.mjs") { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  const ext = path.extname(abs).toLowerCase();
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
  if (rel === "sw.js" || ext === ".webmanifest") headers["Cache-Control"] = "no-cache";
  res.writeHead(200, headers);
  res.end(fs.readFileSync(abs));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  // CORS：App(Capacitor WebView，源为 capacitor://localhost / http://localhost)跨域访问本机后端时放行
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Filename,X-Depth");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  try {
    // ---- 列表 ----
    if (req.method === "GET" && p === "/api/recipes") return sendJSON(res, 200, listRecipes());

    // ---- 删除 ----
    if (req.method === "DELETE" && p.startsWith("/api/recipes/")) {
      const id = decodeURIComponent(p.slice("/api/recipes/".length));
      const fp = path.join(RECIPES_DIR, `${path.basename(id)}.json`);
      const mp = path.join(RECIPES_DIR, `${path.basename(id)}.md`);
      fs.rmSync(fp, { force: true }); fs.rmSync(mp, { force: true });
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 覆盖保存（笔记/评分/做过 等本地增改回写到菜谱）----
    if (req.method === "PUT" && p.startsWith("/api/recipes/")) {
      const id = decodeURIComponent(p.slice("/api/recipes/".length));
      const fp = path.join(RECIPES_DIR, `${path.basename(id)}.json`);
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: "菜谱不存在" });
      const patch = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
      const next = { ...cur, ...patch };
      delete next.id;
      fs.writeFileSync(fp, JSON.stringify(next, null, 2));
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 发起解析（返回 jobId）----
    if (req.method === "POST" && p === "/api/parse-url") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!/^https?:\/\//.test(body.url || "")) return sendJSON(res, 400, { error: "请提供 http(s) 链接" });
      if (runningCount() >= MAX_RUNNING) return sendJSON(res, 429, { error: "解析任务繁忙，请等前一个完成再试" });
      const id = newJob();
      runJob(id, body.url, body.depth);
      return sendJSON(res, 200, { jobId: id });
    }
    if (req.method === "POST" && p === "/api/parse-file") {
      const filename = decodeURIComponent(req.headers["x-filename"] || "video.mp4");
      const depth = req.headers["x-depth"];
      if (runningCount() >= MAX_RUNNING) return sendJSON(res, 429, { error: "解析任务繁忙，请等前一个完成再试" });
      const buf = await readBody(req);
      if (!buf.length) return sendJSON(res, 400, { error: "空文件" });
      const tmp = path.join(os.tmpdir(), `paoding-up-${Date.now()}-${slug(filename)}`);
      fs.writeFileSync(tmp, buf);
      const id = newJob();
      runJob(id, tmp, depth);
      const j = jobs.get(id);
      // 任务结束(或超 1 小时兜底)后清理临时文件，避免卡死时泄漏
      let ticks = 0;
      const iv = setInterval(() => { if (j.status !== "running" || ++ticks > 1200) { fs.rmSync(tmp, { force: true }); clearInterval(iv); } }, 3000);
      return sendJSON(res, 200, { jobId: id });
    }

    // ---- 进度 SSE ----
    if (req.method === "GET" && p.startsWith("/api/progress/")) {
      const id = p.slice("/api/progress/".length);
      const j = jobs.get(id);
      res.writeHead(200, {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive",
      });
      if (!j) { res.write(`data: ${JSON.stringify({ type: "error", error: "任务不存在或已过期" })}\n\n`); return res.end(); }
      // 先补发当前状态
      res.write(`data: ${JSON.stringify({ type: "progress", ...j.progress })}\n\n`);
      if (j.status === "done") { res.write(`data: ${JSON.stringify({ type: "done", recipe: j.recipe })}\n\n`); return res.end(); }
      if (j.status === "error") { res.write(`data: ${JSON.stringify({ type: "error", error: j.error })}\n\n`); return res.end(); }
      j.listeners.add(res);
      req.on("close", () => j.listeners.delete(res));
      return;
    }

    // ---- AI：对某步追问 ----
    if (req.method === "POST" && p === "/api/ask") {
      const { recipeId, stepIndex, question } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const r = loadRecipe(recipeId);
      if (!r) return sendJSON(res, 404, { error: "菜谱不存在" });
      const s = (r.steps || []).find((x) => x.index === stepIndex);
      const ctx = `菜名：${r.title}\n当前步骤：${s ? s.title + " — " + s.action : "（整体）"}\n` +
        `食材：${(r.ingredients || []).map((i) => i.name + i.amount).join("、")}`;
      const answer = await chatText(config.llm, {
        system: "你是一位耐心的中餐老师，正在指导用户做这道菜。用简洁、通俗、可操作的中文回答用户对当前步骤的疑问。不确定就说不确定，别编造具体数字。",
        user: `${ctx}\n\n用户的问题：${question}`,
      });
      return sendJSON(res, 200, { answer });
    }

    // ---- AI：食材替代 ----
    if (req.method === "POST" && p === "/api/substitute") {
      const { recipeId, ingredient } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const r = loadRecipe(recipeId);
      const answer = await chatText(config.llm, {
        system: "你是经验丰富的中餐厨师，实话实说、不糊弄。用户做某道菜时缺了某种食材/调料，针对性判断：\n" +
          "- 大多数食材都有可接受的替代——只要有靠谱替代就给1~3个，标出最推荐的，说明用量换算和风味差异（例：白糖可用冰糖或红糖、老抽可用生抽加少量糖色、香醋可用米醋、生粉可用玉米淀粉）。\n" +
          "- 只有当它是这道菜的灵魂、任何替代都会明显翻车或跑味时，才说「不建议替代」，讲清为什么、硬替会怎样、给务实建议（例：用醋替料酒去腥、用清水替高汤——这类才算不能替）。\n" +
          "- 别为了凑数硬编烂替代，也别把「有点影响」当成「不能替代」。简洁中文，分点。",
        user: `菜名：${r ? r.title : "某道菜"}。用户缺的是「${ingredient}」，有什么可以替代？若确实没有好替代就直说。`,
      });
      return sendJSON(res, 200, { answer });
    }

    // ---- AI：术语微科普 ----
    if (req.method === "POST" && p === "/api/term") {
      const { term } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const answer = await chatText(config.llm, {
        system: "你是食品科学科普作者。用3~4句通俗中文解释这个烹饪术语/原理是什么、为什么重要。",
        user: `解释一下烹饪里的「${term}」。`,
      });
      return sendJSON(res, 200, { answer });
    }

    // ---- AI：翻车补救 ----
    if (req.method === "POST" && p === "/api/troubleshoot") {
      const { recipeId, stepIndex, problem } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const r = loadRecipe(recipeId);
      const s = r && (r.steps || []).find((x) => x.index === stepIndex);
      const answer = await chatText(config.llm, {
        system: "你是经验丰富的中餐师傅。用户做菜翻车了，请冷静给出：1)可能的原因 2)现在还能怎么补救 3)下次怎么避免。简洁中文分点，务实。",
        user: `菜：${r ? r.title : ""}。当前步骤：${s ? s.title + "—" + s.action : ""}。出现的问题：${problem}`,
      });
      return sendJSON(res, 200, { answer });
    }

    // ---- AI：每份营养估算 ----
    if (req.method === "POST" && p === "/api/nutrition") {
      const { recipeId } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const r = loadRecipe(recipeId);
      if (!r) return sendJSON(res, 404, { error: "菜谱不存在" });
      const answer = await chatText(config.llm, {
        system: "你是营养师。根据食材给出这道菜「每份」的粗略营养估算（热量kcal、蛋白质、脂肪、碳水，各给个大致数值区间），并一句话点评。声明是粗略估算。简洁中文。",
        user: `菜名：${r.title}，份量：${r.servings || "未知"}。食材：${(r.ingredients || []).map((i) => i.name + i.amount).join("、")}`,
      });
      return sendJSON(res, 200, { answer });
    }

    // ---- AI：这道菜为什么这样设计（总览）----
    if (req.method === "POST" && p === "/api/overview") {
      const { recipeId } = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const r = loadRecipe(recipeId);
      if (!r) return sendJSON(res, 404, { error: "菜谱不存在" });
      const answer = await chatText(config.llm, {
        system: "你是中餐大厨。用3~5句话讲清这道菜整体「为什么这样设计」：关键在哪、几个决定成败的点、新手最该注意什么。通俗、有洞见。",
        user: `菜名：${r.title}。步骤概要：${(r.steps || []).map((s) => s.index + "." + s.title).join(" ")}`,
      });
      return sendJSON(res, 200, { answer });
    }

    // ---- APK 下载（从项目根目录发，不放进 app/ 以免被 Capacitor 打进包里自我膨胀）----
    if (req.method === "GET" && p === "/paoding-debug.apk") {
      const apk = path.join(HERE, "..", "paoding-debug.apk");
      if (!fs.existsSync(apk)) { res.writeHead(404); return res.end("APK 未构建"); }
      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": "attachment; filename=paoding.apk",
      });
      return res.end(fs.readFileSync(apk));
    }

    // ---- 静态 ----
    if (req.method === "GET") return serveStatic(res, p);

    res.writeHead(404); res.end("Not found");
  } catch (e) {
    console.error(`[${p}]`, e.message);
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;
  console.log(`\x1b[32m庖丁 App 已启动\x1b[0m`);
  console.log(`  本机:  http://localhost:${PORT}`);
  if (lan) console.log(`  局域网(手机同WiFi): http://${lan}:${PORT}`);
  console.log(`  LLM: ${config.llm.model} @ ${config.llm.baseUrl}`);
  console.log(`  ASR: ${config.asr.provider === "local" ? "本地 whisper.cpp" : config.asr.model}`);
});
