import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, loadEnvFiles } from "../src/config.mjs";
import { processVideo, processText } from "../src/pipeline.mjs";
import { chatJSON, chatText } from "../src/llm.mjs";
import { DEPTHS, explainSteps } from "../src/explain.mjs";
import { assertPublicUrl } from "../src/urlSafety.mjs";
import { createSlidingWindowRateLimiter } from "../src/rateLimit.mjs";
import { FileJobStore, createJobQueue, createJobRecord, publicJob, TERMINAL_JOB_STATUSES } from "../src/jobs.mjs";
import { mapSchemaRecipeToPaoding } from "../src/importRecipe.mjs";
import { extractTechniques } from "../src/techniques.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnvFiles();
// 数据目录可被环境变量覆盖（测试用隔离目录，避免污染真实数据）
const RECIPES_DIR = process.env.PAODING_RECIPES_DIR || path.join(HERE, "recipes");
const JOBS_DIR = path.join(path.dirname(RECIPES_DIR), "jobs");
// 用户数据（收藏/笔记/评分/购物清单等）跨设备同步用；放项目根、不在 webDir 内，避免被静态服务或打包暴露
const USERDATA_FILE = process.env.PAODING_USERDATA_FILE || path.join(HERE, "..", "paoding-userdata.json");
const PORT = process.env.PAODING_PORT ? Number(process.env.PAODING_PORT) : 4177;
const HOST = process.env.PAODING_HOST || "0.0.0.0"; // 默认局域网可达(手机用)；设 127.0.0.1 可锁本机
const BASE_PATH = normalizeBasePath(process.env.PAODING_BASE_PATH || "/paoding"); // 兼容 Caddy/Capacitor 挂在 /paoding 子路径
const MAX_RUNNING = Number(process.env.PAODING_MAX_JOBS || 2); // 同时解析上限，防资源耗尽
const MAX_QUEUE = Math.max(0, Number(process.env.PAODING_MAX_QUEUE || 10)); // 等待队列上限，超出才返回 429
const MAX_IMPORT_RECIPES = Number(process.env.PAODING_MAX_IMPORT || 5000); // 单次导入菜谱上限，防脏/超大备份写爆磁盘
// 可选 API token：设了 PAODING_API_TOKEN 就要求 /api/* 带上正确 token。
// 非回环地址监听时强制配置 token，除非显式 PAODING_ALLOW_INSECURE=1。
const API_TOKEN = process.env.PAODING_API_TOKEN || "";
const CORS_ORIGINS = new Set((process.env.PAODING_CORS_ORIGINS || "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean));
const LLM_RATE_LIMIT_PER_MIN = Number(process.env.PAODING_LLM_RATE_LIMIT_PER_MIN || 20);
const LLM_RATE_LIMIT_WINDOW_MS = Number(process.env.PAODING_LLM_RATE_LIMIT_WINDOW_MS || 60_000);
fs.mkdirSync(RECIPES_DIR, { recursive: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });

function normalizeBasePath(value) {
  const p = String(value || "").trim().replace(/\/+$/, "");
  if (!p || p === "/") return "";
  return p.startsWith("/") ? p : `/${p}`;
}
function stripBasePath(pathname) {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(`${BASE_PATH}/`)) return pathname.slice(BASE_PATH.length) || "/";
  return pathname;
}
function isLoopbackHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}
if (!API_TOKEN && !isLoopbackHost(HOST) && process.env.PAODING_ALLOW_INSECURE !== "1") {
  console.error("\x1b[31m安全配置错误：\x1b[0m 当前监听地址不是 127.0.0.1/localhost，但未设置 PAODING_API_TOKEN。");
  console.error("出路 1：设置 PAODING_API_TOKEN，并在 App 设置页填同一个 token。");
  console.error("出路 2：若确认只在可信网络裸奔，显式设置 PAODING_ALLOW_INSECURE=1。");
  process.exit(1);
}

let config;
try {
  config = loadConfig();
  config.outDir = RECIPES_DIR;
} catch (e) {
  console.error(`\x1b[31m配置错误：\x1b[0m ${e.message}`);
  process.exit(1);
}

const slug = (s) => (s || "recipe").replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, "-").slice(0, 40) || "recipe";
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 只读分享页：任何人打开链接即可看整份菜谱（含每步为什么），无需 App。自包含 HTML。
function shareHTML(r) {
  const DIFF = { easy: "简单", medium: "中等", hard: "有挑战" };
  // 图片走公开的图片路由（onerror 移除：备份导入的菜谱可能没带图）
  const imgSrc = (file) => `${BASE_PATH}/api/recipes/${encodeURIComponent(r.id)}/images/${encodeURIComponent(file)}`;
  const meta = [r.difficulty && DIFF[r.difficulty], r.cuisine, r.total_time_min && `约${r.total_time_min}分钟`, `${(r.steps || []).length}步`].filter(Boolean).join(" · ");
  const ings = (r.ingredients || []).map((i) => `<li><span>${i.image ? `<img class="ith" src="${imgSrc(i.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${escHtml(i.name)}${i.note ? `（${escHtml(i.note)}）` : ""}</span><span class="amt">${escHtml(i.amount || "")}</span></li>`).join("");
  const steps = (r.steps || []).map((s) => {
    const w = s.why || {};
    const why = [w.reason && `<p><b>为什么</b> ${escHtml(w.reason)}</p>`, w.if_not && `<p><b>不这么做</b> ${escHtml(w.if_not)}</p>`, w.cue && `<p class="g"><b>判断到位</b> ${escHtml(w.cue)}</p>`].filter(Boolean).join("");
    const pic = s.image ? `<img class="simg" src="${imgSrc(s.image)}" alt="" loading="lazy" onerror="this.remove()">` : "";
    return `<li><div class="st">${escHtml(s.title || "")}</div><div class="ac">${escHtml(s.action || "")}</div>${pic}${why ? `<div class="why">${why}</div>` : ""}</li>`;
  }).join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(r.title)} · 庖丁</title>
<style>
:root{--bg:#FBF7F0;--card:#fff;--ink:#2A2724;--muted:#8A817A;--line:#EAE2D6;--tomato:#E4572E;--herb:#6A8D3F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}
.wrap{max-width:680px;margin:0 auto;padding:28px 18px 60px}
h1{font-family:Georgia,"Songti SC",serif;font-size:30px;margin:0 0 6px}.meta{color:var(--muted);font-size:14px;margin-bottom:18px}
h2{font-size:14px;color:var(--muted);letter-spacing:1px;margin:26px 0 10px}
ul.ings{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
ul.ings li{display:flex;justify-content:space-between;gap:12px;padding:11px 15px;border-bottom:1px solid var(--line)}ul.ings li:last-child{border:none}.amt{color:var(--muted)}
ol.steps{list-style:none;counter-reset:s;padding:0;margin:0}
ol.steps li{counter-increment:s;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 16px 14px 46px;margin-bottom:12px;position:relative}
ol.steps li::before{content:counter(s);position:absolute;left:14px;top:15px;width:24px;height:24px;border-radius:50%;background:var(--ink);color:var(--bg);display:flex;align-items:center;justify-content:center;font-size:14px}
.st{font-weight:600;font-size:17px}.ac{margin-top:5px}
.why{margin-top:12px;background:var(--bg);border-radius:10px;padding:11px 13px;font-size:14px}.why p{margin:6px 0}.why b{color:var(--tomato)}.why .g b{color:var(--herb)}
.simg{display:block;max-width:100%;border-radius:10px;margin-top:10px}
.ith{width:30px;height:30px;object-fit:cover;border-radius:7px;vertical-align:-9px;margin-right:8px}
footer{margin-top:30px;text-align:center;color:var(--muted);font-size:13px}footer a{color:var(--tomato);text-decoration:none}
</style></head><body><div class="wrap">
<h1>${escHtml(r.title)}</h1><div class="meta">${escHtml(meta)}</div>
${ings ? `<h2>食材</h2><ul class="ings">${ings}</ul>` : ""}
<h2>步骤</h2><ol class="steps">${steps}</ol>
<footer>由 <b>庖丁</b> 解析 · 把每道菜讲透「为什么」</footer>
</div></body></html>`;
}

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
  if (!id || typeof id !== "string") return null; // 缺 recipeId 时返回 null，避免 path.basename(undefined) 抛错→500
  const p = recipePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(p, "utf8")); // 损坏文件也容错
    r.id = id;
    return r;
  } catch { return null; }
}
function recipePath(id) {
  return path.join(RECIPES_DIR, `${path.basename(id)}.json`);
}
function uniqueRecipeId(seed) {
  const base = slug(seed || "recipe") || "recipe";
  let id = base;
  for (let i = 2; fs.existsSync(recipePath(id)); i++) id = `${base}-${i}`;
  return id;
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
function streamBodyToFile(req, filePath, limitMB = 800) {
  return new Promise((resolve, reject) => {
    const limit = limitMB * 1024 * 1024;
    const out = fs.createWriteStream(filePath);
    let size = 0;
    let settled = false;
    const cleanup = () => {
      req.off?.("data", onData);
      req.off?.("error", onError);
      req.off?.("aborted", onAborted);
      out.off("error", onError);
      out.off("finish", onFinish);
    };
    const fail = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { req.unpipe?.(out); } catch {}
      out.destroy();
      fs.rmSync(filePath, { force: true });
      reject(e);
    };
    const onData = (c) => {
      size += c.length;
      if (size > limit) {
        const e = Object.assign(new Error("文件过大"), { statusCode: 413 });
        try { req.destroy(); } catch {}
        fail(e);
      }
    };
    const onError = (e) => fail(e);
    const onAborted = () => fail(Object.assign(new Error("上传中断"), { statusCode: 400 }));
    const onFinish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(size);
    };
    req.on("data", onData);
    req.on("error", onError);
    req.on("aborted", onAborted);
    out.on("error", onError);
    out.on("finish", onFinish);
    req.pipe(out);
  });
}
// 校验请求 token：可来自 Authorization: Bearer / X-Paoding-Token 头，或 ?token=（SSE 无法自定义头）。
function authOk(req, url) {
  if (!API_TOKEN) return true; // 未配置 = 不鉴权
  const auth = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const provided = req.headers["x-paoding-token"] || bearer || url.searchParams.get("token") || "";
  const a = Buffer.from(String(provided)), b = Buffer.from(API_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b); // 常量时间比较，避免时序侧信道
}
const DEFAULT_CORS_ORIGINS = new Set(["capacitor://localhost", "https://localhost"]);
function requestOrigin(req) {
  const origin = req.headers.origin || "";
  return typeof origin === "string" ? origin.replace(/\/+$/, "") : "";
}
function sameOrigin(req, origin) {
  if (!origin || !req.headers.host) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  return origin === `${proto}://${req.headers.host}`;
}
function corsAllowOrigin(req) {
  const origin = requestOrigin(req);
  if (!origin) return "";
  if (sameOrigin(req, origin) || DEFAULT_CORS_ORIGINS.has(origin) || CORS_ORIGINS.has(origin)) return origin;
  return "";
}
const llmLimiter = createSlidingWindowRateLimiter({
  limit: LLM_RATE_LIMIT_PER_MIN,
  windowMs: LLM_RATE_LIMIT_WINDOW_MS,
});
const LLM_ENDPOINTS = new Set([
  "/api/parse-url", "/api/parse-text", "/api/parse-file",
  "/api/ask", "/api/substitute", "/api/term", "/api/troubleshoot", "/api/nutrition", "/api/overview", "/api/explain-recipe", "/api/import-recipe",
]);
function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}
function rateLimitOk(req, res, p) {
  if (req.method !== "POST" || !LLM_ENDPOINTS.has(p)) return true;
  const hit = llmLimiter.take(clientIp(req));
  if (hit.allowed) return true;
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(hit.resetMs / 1000))));
  sendJSON(res, 429, { error: "请求太频繁，请稍后再试" });
  return false;
}
// 读并解析 JSON 请求体；畸形 JSON 抛 400（而非落到外层 catch 变 500）。
async function readJson(req) {
  const text = (await readBody(req)).toString("utf8") || "{}";
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Error("请求体不是合法 JSON"), { statusCode: 400 }); }
}
function normalizeRev(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
function normalizeUserData(data) {
  const obj = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
  obj.rev = normalizeRev(obj.rev);
  return obj;
}
function readUserData() {
  try { return normalizeUserData(JSON.parse(fs.readFileSync(USERDATA_FILE, "utf8"))); }
  catch { return { rev: 0 }; }
}
function writeUserData(data) {
  fs.mkdirSync(path.dirname(USERDATA_FILE), { recursive: true });
  fs.writeFileSync(USERDATA_FILE, JSON.stringify(normalizeUserData(data), null, 2));
}
function normalizeNutrition(raw) {
  const src = raw?.nutrition || raw || {};
  const per = src.per_serving || src;
  const num = (v) => {
    if (Number.isFinite(v)) return Math.round(v * 10) / 10;
    const m = String(v ?? "").match(/-?\d+(?:\.\d+)?/);
    return m ? Math.round(Number(m[0]) * 10) / 10 : null;
  };
  return {
    per_serving: {
      calories_kcal: num(per.calories_kcal ?? per.calories ?? per.kcal),
      protein_g: num(per.protein_g ?? per.protein),
      fat_g: num(per.fat_g ?? per.fat),
      carbs_g: num(per.carbs_g ?? per.carbs ?? per.carbohydrate_g),
      sodium_mg: num(per.sodium_mg ?? per.sodium),
    },
    disclaimer: String(src.disclaimer || "AI 根据菜谱食材和份量粗略估算，仅供参考。"),
    estimated: true,
  };
}
function nutritionText(n) {
  const p = n?.per_serving || {};
  return [
    `每份约 ${p.calories_kcal ?? "未知"} kcal`,
    `蛋白质 ${p.protein_g ?? "未知"} g`,
    `脂肪 ${p.fat_g ?? "未知"} g`,
    `碳水 ${p.carbs_g ?? "未知"} g`,
    `钠 ${p.sodium_mg ?? "未知"} mg`,
    n?.disclaimer || "AI 估算，仅供参考。",
  ].join("\n");
}
async function estimateNutrition(r) {
  const raw = await chatJSON(config.llm, {
    temperature: 0.2,
    system: "你是营养师。只输出 JSON 对象，按 schema 给出这道菜每份的粗略营养估算。字段必须是数字，不要区间，不确定也给合理近似值。",
    user: `schema:
{
  "nutrition": {
    "per_serving": {
      "calories_kcal": 0,
      "protein_g": 0,
      "fat_g": 0,
      "carbs_g": 0,
      "sodium_mg": 0
    },
    "disclaimer": "AI 根据菜谱食材和份量粗略估算，仅供参考。",
    "estimated": true
  }
}

菜名：${r.title}
份量：${r.servings || "未知"}
食材：${(r.ingredients || []).map((i) => `${i.name || ""}${i.amount || ""}${i.note ? `（${i.note}）` : ""}`).join("、")}
步骤概要：${(r.steps || []).map((s) => `${s.index || ""}.${s.title || ""}${s.action || ""}`).join(" ")}`,
  });
  return normalizeNutrition(raw);
}
function aggregateTechniques() {
  const groups = new Map();
  for (const r of listRecipes()) {
    const byIndex = new Map((r.steps || []).map((s, i) => [Number(s.index) || i + 1, s]));
    for (const hit of extractTechniques(r)) {
      const s = byIndex.get(hit.stepIndex) || {};
      const item = {
        recipeId: hit.recipeId,
        recipeTitle: r.title || "",
        stepIndex: hit.stepIndex,
        stepTitle: s.title || "",
        action: s.action || "",
        why: s.why || {},
      };
      if (!groups.has(hit.technique)) groups.set(hit.technique, []);
      groups.get(hit.technique).push(item);
    }
  }
  return [...groups.entries()]
    .map(([technique, occurrences]) => ({ technique, count: occurrences.length, occurrences }))
    .sort((a, b) => b.count - a.count || a.technique.localeCompare(b.technique, "zh-CN"));
}

// ---------- 解析任务（持久化 + 排队 + 进度）----------
const jobStore = new FileJobStore(JOBS_DIR, { keep: 50 });
const jobs = new Map(jobStore.init().map((j) => [j.id, { ...j, listeners: new Set() }]));
const jobQueue = createJobQueue(MAX_QUEUE);
const runningCount = () => [...jobs.values()].filter((j) => j.status === "running").length;
const nowISO = () => new Date().toISOString();

function persistJob(job, opts) {
  if (!job) return;
  job.updated_at = nowISO();
  jobStore.write(job, opts);
}
function createServerJob(type, params, { status = "queued", progress } = {}) {
  const j = {
    ...createJobRecord({ id: crypto.randomUUID(), type, params, status, progress, now: nowISO() }),
    listeners: new Set(),
  };
  jobs.set(j.id, j);
  persistJob(j, { cleanup: false });
  return j;
}
function pushJob(id, ev) {
  const j = jobs.get(id);
  if (!j) return;
  for (const res of j.listeners) res.write(`data: ${JSON.stringify(ev)}\n\n`);
}
function setJobProgress(id, progress) {
  const j = jobs.get(id);
  if (!j) return;
  j.progress = progress;
  persistJob(j, { cleanup: false });
  pushJob(id, { type: "progress", ...progress });
}
function updateQueuePositions() {
  for (const item of jobQueue.snapshot()) {
    const j = jobs.get(item.id);
    if (!j || j.status !== "queued") continue;
    const progress = { pct: 0, stage: "queued", message: `排队中，第 ${item.position} 位` };
    j.progress = progress;
    persistJob(j, { cleanup: false });
    pushJob(j.id, { type: "progress", ...progress });
  }
}
function startQueuedJob(id, start) {
  const j = jobs.get(id);
  if (!j || TERMINAL_JOB_STATUSES.has(j.status)) return;
  j.status = "running";
  j.started_at = j.started_at || nowISO();
  j.progress = { pct: 0, stage: "start", message: "开始解析…" };
  persistJob(j, { cleanup: false });
  pushJob(id, { type: "progress", ...j.progress });
  try { start(); }
  catch (e) { finishJob(id, { type: "error", error: e.message }); }
}
function drainQueue() {
  while (runningCount() < MAX_RUNNING) {
    const item = jobQueue.dequeueReady();
    if (!item) break;
    startQueuedJob(item.id, item.start);
  }
  updateQueuePositions();
}
function submitParseJob(type, params, start) {
  const shouldQueue = jobQueue.length > 0 || runningCount() >= MAX_RUNNING;
  if (shouldQueue && jobQueue.isFull()) return { ok: false };
  const j = createServerJob(type, params, {
    status: shouldQueue ? "queued" : "running",
    progress: shouldQueue ? { pct: 0, stage: "queued", message: "排队中，第 1 位" } : { pct: 0, stage: "start", message: "开始解析…" },
  });
  if (shouldQueue) {
    const enq = jobQueue.enqueue({ id: j.id, start: () => start(j.id), ready: true });
    if (!enq.ok) { jobs.delete(j.id); jobStore.remove(j.id); return { ok: false }; }
    updateQueuePositions();
  } else {
    j.started_at = nowISO();
    persistJob(j, { cleanup: false });
    start(j.id);
  }
  return { ok: true, id: j.id };
}
function reserveUploadJob(params) {
  const shouldQueue = jobQueue.length > 0 || runningCount() >= MAX_RUNNING;
  if (shouldQueue && jobQueue.isFull()) return { ok: false };
  const j = createServerJob("file", params, {
    status: shouldQueue ? "queued" : "running",
    progress: shouldQueue ? { pct: 0, stage: "queued", message: "排队中，第 1 位" } : { pct: 0, stage: "upload", message: "接收上传中…" },
  });
  if (shouldQueue) {
    const enq = jobQueue.enqueue({ id: j.id, ready: false });
    if (!enq.ok) { jobs.delete(j.id); jobStore.remove(j.id); return { ok: false }; }
    updateQueuePositions();
  } else {
    j.started_at = nowISO();
    persistJob(j, { cleanup: false });
  }
  return { ok: true, id: j.id, queued: shouldQueue };
}
function cancelReservedJob(id) {
  jobQueue.remove(id);
  jobs.delete(id);
  jobStore.remove(id);
  updateQueuePositions();
  drainQueue();
}
function markUploadReady(id, paramsPatch, start) {
  const j = jobs.get(id);
  if (!j) return;
  j.params = { ...(j.params || {}), ...paramsPatch };
  persistJob(j, { cleanup: false });
  if (j.status === "queued") {
    jobQueue.markReady(id, { start });
    updateQueuePositions();
    drainQueue();
  } else {
    start();
  }
}
function scheduleTmpCleanup(id, tmp) {
  const j = jobs.get(id);
  let ticks = 0;
  const iv = setInterval(() => {
    const cur = jobs.get(id) || j;
    if (!cur || cur.status !== "running" || ++ticks > 1200) {
      fs.rmSync(tmp, { force: true });
      clearInterval(iv);
    }
  }, 3000);
}
function recipeResultId(recipe) {
  return recipe?.id || slug(recipe?.title || "");
}
function finishJob(id, ev) {
  const j = jobs.get(id);
  if (!j || TERMINAL_JOB_STATUSES.has(j.status)) return;
  if (ev.type === "done") {
    j.status = "done";
    j.recipe = ev.recipe;
    j.result_recipe_id = recipeResultId(ev.recipe);
    j.error = null;
  } else {
    j.status = "error";
    j.error = ev.error;
  }
  j.finished_at = nowISO();
  j.progress = ev.type === "done"
    ? { pct: 100, stage: "done", message: "完成" }
    : { pct: j.progress?.pct || 0, stage: "error", message: ev.error };
  persistJob(j);
  pushJob(id, ev);
  for (const res of j.listeners) res.end();
  j.listeners.clear();
  setTimeout(() => jobs.delete(id), 5 * 60 * 1000);
  drainQueue();
}
function getJob(id) {
  const j = jobs.get(id);
  if (j) return j;
  const saved = jobStore.read(id);
  if (!saved) return null;
  const hydrated = { ...saved, listeners: new Set() };
  jobs.set(id, hydrated);
  return hydrated;
}
function runJob(id, input, depth, kind = "video", wantVision = false, wantImages = false) {
  const j = jobs.get(id);
  if (!j) return;
  // 非法/缺省的 depth 归一到配置默认值，避免前端传错值时静默按 balanced 生成。
  // 视觉/截图按次开关：仅当本次请求要且服务端配置了视觉模型时才启用（截图挑帧也靠视觉模型）。
  const cfg = {
    ...config,
    depth: DEPTHS.includes(depth) ? depth : config.depth,
    vision: wantVision ? config.vision : null,
    images: wantImages ? config.vision : null,
  };
  const onProgress = (p) => setJobProgress(id, p);
  // 超时时用它强杀底层卡死的 yt-dlp/ffmpeg/whisper 子进程与 LLM/ASR 请求，而不只是释放槽位。
  const ac = new AbortController();
  const signal = ac.signal;
  let run;
  if (kind === "text") {
    run = processText(input, cfg, { onProgress, signal });
  } else {
    // 视频路径；URL 视频抓不到（如小红书无抽取器）时自动改按文字帖尝试
    run = processVideo(input, cfg, { onProgress, signal }).catch((e) => {
      if (!signal.aborted && /^https?:\/\//i.test(input)) {
        onProgress({ stage: "acquire", pct: 4, message: "视频抓取失败，改按文字帖尝试…" });
        return processText(input, cfg, { onProgress, signal });
      }
      throw e;
    });
  }
  // 超时兜底：卡死的 yt-dlp/ffmpeg/whisper 不再永久占住 MAX_RUNNING slot（否则卡满就整体瘫）。
  // 可用 PAODING_JOB_TIMEOUT_MIN 调整（默认 20 分钟）。超时与真实结果竞速，先到者结算，另一个丢弃。
  const TIMEOUT_MS = Math.max(1000, (Number(process.env.PAODING_JOB_TIMEOUT_MIN) || 20) * 60 * 1000);
  let settled = false, timer;
  const finish = (ev) => {
    if (settled) return; // 只结算一次
    settled = true;
    clearTimeout(timer);
    finishJob(id, ev);
  };
  timer = setTimeout(() => {
    try { ac.abort(); } catch {} // 强杀在跑的子进程/请求
    finish({ type: "error", error: `解析超时（超过 ${Math.round(TIMEOUT_MS / 60000)} 分钟无结果），已释放，请重试` });
  }, TIMEOUT_MS);
  run
    .then(({ recipe }) => finish({ type: "done", recipe }))
    .catch((e) => finish({ type: "error", error: e.message }));
}

const AI_ENDPOINTS = {
  "/api/ask": {
    recipe: { required: true },
    prompt: ({ body, r }) => {
      const { stepIndex, question } = body;
      const s = (r.steps || []).find((x) => x.index === stepIndex);
      const ctx = `菜名：${r.title}\n当前步骤：${s ? s.title + " — " + s.action : "（整体）"}\n` +
        `食材：${(r.ingredients || []).map((i) => i.name + i.amount).join("、")}`;
      return {
        system: "你是一位耐心的中餐老师，正在指导用户做这道菜。用简洁、通俗、可操作的中文回答用户对当前步骤的疑问。不确定就说不确定，别编造具体数字。",
        user: `${ctx}\n\n用户的问题：${question}`,
      };
    },
  },
  "/api/substitute": {
    recipe: { required: false },
    prompt: ({ body, r }) => ({
      system: "你是经验丰富的中餐厨师，实话实说、不糊弄。用户做某道菜时缺了某种食材/调料，针对性判断：\n" +
        "- 大多数食材都有可接受的替代——只要有靠谱替代就给1~3个，标出最推荐的，说明用量换算和风味差异（例：白糖可用冰糖或红糖、老抽可用生抽加少量糖色、香醋可用米醋、生粉可用玉米淀粉）。\n" +
        "- 只有当它是这道菜的灵魂、任何替代都会明显翻车或跑味时，才说「不建议替代」，讲清为什么、硬替会怎样、给务实建议（例：用醋替料酒去腥、用清水替高汤——这类才算不能替）。\n" +
        "- 别为了凑数硬编烂替代，也别把「有点影响」当成「不能替代」。简洁中文，分点。",
      user: `菜名：${r ? r.title : "某道菜"}。用户缺的是「${body.ingredient}」，有什么可以替代？若确实没有好替代就直说。`,
    }),
  },
  "/api/term": {
    prompt: ({ body }) => ({
      system: "你是食品科学科普作者。用3~4句通俗中文解释这个烹饪术语/原理是什么、为什么重要。",
      user: `解释一下烹饪里的「${body.term}」。`,
    }),
  },
  "/api/troubleshoot": {
    recipe: { required: false },
    prompt: ({ body, r }) => {
      const s = r && (r.steps || []).find((x) => x.index === body.stepIndex);
      return {
        system: "你是经验丰富的中餐师傅。用户做菜翻车了，请冷静给出：1)可能的原因 2)现在还能怎么补救 3)下次怎么避免。简洁中文分点，务实。",
        user: `菜：${r ? r.title : ""}。当前步骤：${s ? s.title + "—" + s.action : ""}。出现的问题：${body.problem}`,
      };
    },
  },
  "/api/nutrition": {
    handle: async ({ recipeId }) => {
      const r = loadRecipe(recipeId);
      if (!r) return { code: 404, body: { error: "菜谱不存在" } };
      if (r.nutrition?.per_serving) return { body: { nutrition: r.nutrition, answer: nutritionText(r.nutrition), cached: true } };
      const nutrition = await estimateNutrition(r);
      const fp = recipePath(recipeId);
      const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
      cur.nutrition = nutrition;
      delete cur.id;
      fs.writeFileSync(fp, JSON.stringify(cur, null, 2));
      return { body: { nutrition, answer: nutritionText(nutrition), cached: false } };
    },
  },
  "/api/overview": {
    recipe: { required: true },
    prompt: ({ r }) => ({
      system: "你是中餐大厨。用3~5句话讲清这道菜整体「为什么这样设计」：关键在哪、几个决定成败的点、新手最该注意什么。通俗、有洞见。",
      user: `菜名：${r.title}。步骤概要：${(r.steps || []).map((s) => s.index + "." + s.title).join(" ")}`,
    }),
  },
  "/api/explain-recipe": {
    handle: async ({ recipeId, depth }) => {
      const r = loadRecipe(recipeId);
      if (!r) return { code: 404, body: { error: "菜谱不存在" } };
      if (!Array.isArray(r.steps) || !r.steps.length) return { code: 400, body: { error: "这道菜没有步骤，无法补讲解" } };
      const next = JSON.parse(JSON.stringify(r));
      await explainSteps(config.llm, next, DEPTHS.includes(depth) ? depth : config.depth);
      const id = path.basename(recipeId);
      const saved = { ...next };
      delete saved.id;
      fs.writeFileSync(recipePath(id), JSON.stringify(saved, null, 2));
      return { body: { ok: true, recipe: { ...saved, id }, answer: "已补齐每步原理讲解" } };
    },
  },
};

async function handleAiEndpoint(p, req, res) {
  const def = AI_ENDPOINTS[p];
  if (req.method !== "POST" || !def) return false;
  const body = await readJson(req);
  if (def.handle) {
    const out = await def.handle(body);
    sendJSON(res, out.code || 200, out.body);
    return true;
  }
  let r = null;
  if (def.recipe) {
    r = loadRecipe(body.recipeId);
    if (!r && def.recipe.required) {
      sendJSON(res, 404, { error: "菜谱不存在" });
      return true;
    }
  }
  const prompt = def.prompt({ body, r });
  const answer = await chatText(config.llm, prompt);
  sendJSON(res, 200, { answer });
  return true;
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
  if (!(abs === HERE || abs.startsWith(HERE + path.sep)) || rel.startsWith("recipes/") || rel === "server.mjs") { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  const ext = path.extname(abs).toLowerCase();
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
  if (rel === "sw.js" || ext === ".webmanifest") headers["Cache-Control"] = "no-cache";
  res.writeHead(200, headers);
  res.end(fs.readFileSync(abs));
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = stripBasePath(url.pathname);

  // CORS：默认只放行同源请求与 Capacitor WebView；更多来源用 PAODING_CORS_ORIGINS 显式列出。
  const allowedOrigin = corsAllowOrigin(req);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Filename,X-Depth,X-Vision,X-Images,X-Paoding-Token,Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // 菜谱图片 GET 豁免鉴权：<img> 标签带不了自定义头，且分享页 /r/ 本就无鉴权可见整份菜谱，图片同级公开。
  const isRecipeImage = req.method === "GET" && /^\/api\/recipes\/[^/]+\/images\/[^/]+$/.test(p);
  // 鉴权：所有 /api/* 都要过（分享页 /r/、静态资源、APK 不拦，PWA 外壳才能加载）。未配 token 时直接放行。
  if (p.startsWith("/api/") && !isRecipeImage && !authOk(req, url)) return sendJSON(res, 401, { error: "未授权：缺少或错误的 API token" });
  if (!rateLimitOk(req, res, p)) return;

  try {
    // ---- 列表 ----
    if (req.method === "GET" && p === "/api/recipes") return sendJSON(res, 200, listRecipes());
    if (req.method === "GET" && p === "/api/techniques") return sendJSON(res, 200, aggregateTechniques());
    if (req.method === "GET" && p === "/api/jobs") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20) || 20));
      return sendJSON(res, 200, jobStore.recent(limit).map(publicJob));
    }

    // ---- 用户数据同步（收藏/笔记/评分/购物清单跨设备共享）----
    if (req.method === "GET" && p === "/api/userdata") {
      return sendJSON(res, 200, readUserData());
    }
    if (req.method === "PUT" && p === "/api/userdata") {
      const body = (await readBody(req)).toString("utf8") || "{}";
      let incoming;
      try { incoming = JSON.parse(body); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
      const cur = readUserData();
      const clientRev = normalizeRev(incoming?.rev);
      if (clientRev !== cur.rev) return sendJSON(res, 409, { error: "用户数据已被其他设备更新", userdata: cur });
      const next = normalizeUserData({ ...incoming, rev: cur.rev + 1 });
      writeUserData(next);
      return sendJSON(res, 200, { ok: true, rev: next.rev, userdata: next });
    }

    // ---- 单菜谱导入：schema.org Recipe JSON-LD（Mealie/Tandoor 等通用交换格式）----
    if (req.method === "POST" && p === "/api/import-recipe") {
      let text;
      try { text = (await readBody(req, 5)).toString("utf8") || "{}"; }
      catch (e) { return sendJSON(res, 413, { error: e.message }); }
      let data;
      try { data = JSON.parse(text); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
      let jsonld = data;
      try {
        if (typeof data === "string") jsonld = JSON.parse(data);
        else if (typeof data?.jsonld === "string") jsonld = JSON.parse(data.jsonld);
        else if (data?.jsonld && typeof data.jsonld === "object") jsonld = data.jsonld;
      } catch { return sendJSON(res, 400, { error: "JSON-LD 内容不是合法 JSON" }); }
      let recipe;
      try { recipe = mapSchemaRecipeToPaoding(jsonld); }
      catch (e) { return sendJSON(res, e.statusCode || 400, { error: e.message }); }
      const id = uniqueRecipeId(recipe.title);
      const saved = { ...recipe };
      delete saved.id;
      fs.writeFileSync(recipePath(id), JSON.stringify(saved, null, 2));
      return sendJSON(res, 200, { ok: true, id, recipe: { ...saved, id } });
    }

    // ---- 备份恢复：把导出的 {recipes,userdata} 写回（换设备/搬后端/防丢数据）----
    if (req.method === "POST" && p === "/api/import") {
      let data; try { data = await readJson(req); }
      catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
      const list = Array.isArray(data.recipes) ? data.recipes : [];
      if (list.length > MAX_IMPORT_RECIPES) return sendJSON(res, 400, { error: `菜谱数量过多（${list.length}），单次最多导入 ${MAX_IMPORT_RECIPES} 道` });
      let n = 0, skipped = 0;
      for (const r of list) {
        // 只接受带字符串标题的对象，跳过脏数据，避免把垃圾写进 recipes/。
        if (!r || typeof r !== "object" || typeof r.title !== "string" || !r.title.trim()) { skipped++; continue; }
        const id = slug(r.id || r.title); const rr = { ...r }; delete rr.id;
        fs.writeFileSync(path.join(RECIPES_DIR, `${id}.json`), JSON.stringify(rr, null, 2)); n++;
      }
      if (data.userdata && typeof data.userdata === "object" && !Array.isArray(data.userdata)) writeUserData(data.userdata);
      return sendJSON(res, 200, { ok: true, count: n, skipped });
    }

    // ---- 菜谱图片（步骤状态图/食材图，解析时截自原视频）----
    if (isRecipeImage) {
      const m = p.match(/^\/api\/recipes\/([^/]+)\/images\/([^/]+)$/);
      const id = path.basename(decodeURIComponent(m[1]));
      const file = path.basename(decodeURIComponent(m[2]));
      // 文件名只可能是解析器写出的 step-N.jpg / ing-N.jpg，白名单校验兼防穿越
      const fp = /^[\w-]+\.jpg$/.test(file) ? path.join(RECIPES_DIR, id, file) : "";
      if (!fp || !fs.existsSync(fp)) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
      return res.end(fs.readFileSync(fp));
    }

    // ---- 删除 ----
    if (req.method === "DELETE" && p.startsWith("/api/recipes/")) {
      const id = decodeURIComponent(p.slice("/api/recipes/".length));
      const bid = path.basename(id);
      const fp = path.join(RECIPES_DIR, `${bid}.json`);
      const mp = path.join(RECIPES_DIR, `${bid}.md`);
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: "菜谱不存在" }); // 不存在别谎报成功
      fs.rmSync(fp, { force: true }); fs.rmSync(mp, { force: true });
      // 连图片目录一起删（bid 非空且不等于 RECIPES_DIR 本身，防误删整个库）
      const dir = path.join(RECIPES_DIR, bid);
      if (bid && dir !== RECIPES_DIR) fs.rmSync(dir, { recursive: true, force: true });
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 覆盖保存（笔记/评分/做过 等本地增改回写到菜谱）----
    if (req.method === "PUT" && p.startsWith("/api/recipes/")) {
      const id = decodeURIComponent(p.slice("/api/recipes/".length));
      const fp = path.join(RECIPES_DIR, `${path.basename(id)}.json`);
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: "菜谱不存在" });
      const patch = await readJson(req);
      const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
      const next = { ...cur, ...patch };
      const nutritionTouched = ("ingredients" in patch && JSON.stringify(patch.ingredients) !== JSON.stringify(cur.ingredients))
        || ("servings" in patch && patch.servings !== cur.servings);
      if (nutritionTouched) delete next.nutrition;
      delete next.id;
      fs.writeFileSync(fp, JSON.stringify(next, null, 2));
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 发起解析（返回 jobId）----
    if (req.method === "POST" && p === "/api/parse-url") {
      const body = await readJson(req);
      if (!/^https?:\/\//.test(body.url || "")) return sendJSON(res, 400, { error: "请提供 http(s) 链接" });
      await assertPublicUrl(body.url);
      const queued = submitParseJob("url", {
        url: body.url,
        depth: body.depth || null,
        vision: !!body.vision,
        images: !!body.images,
      }, (id) => runJob(id, body.url, body.depth, "video", !!body.vision, !!body.images));
      if (!queued.ok) return sendJSON(res, 429, { error: "解析任务繁忙，队列已满，请稍后再试" });
      return sendJSON(res, 200, { jobId: queued.id });
    }
    // ---- 文字解析：粘贴的文字，或图文/文字帖链接（小红书/公众号/下厨房等无音频来源）----
    if (req.method === "POST" && p === "/api/parse-text") {
      const body = await readJson(req);
      const url = (body.url || "").trim();
      if (/^https?:\/\//.test(url)) await assertPublicUrl(url);
      const input = /^https?:\/\//.test(url) ? url : (body.text || "").trim();
      if (!input || input.length < 10) return sendJSON(res, 400, { error: "请粘贴菜谱文字，或提供文字帖链接" });
      const queued = submitParseJob("text", {
        input,
        depth: body.depth || null,
      }, (id) => runJob(id, input, body.depth, "text"));
      if (!queued.ok) return sendJSON(res, 429, { error: "解析任务繁忙，队列已满，请稍后再试" });
      return sendJSON(res, 200, { jobId: queued.id });
    }
    if (req.method === "POST" && p === "/api/parse-file") {
      const filename = decodeURIComponent(req.headers["x-filename"] || "video.mp4");
      const depth = req.headers["x-depth"];
      const wantVision = req.headers["x-vision"] === "1";
      const wantImages = req.headers["x-images"] === "1";
      // 先同步占住并发 slot，再读上传体：否则「检查→await readBody→newJob」之间的事件循环让步会让
      // 多个并发上传同时通过 runningCount 检查，绕过 MAX_RUNNING、并发拉起过多 ffmpeg/whisper。
      const reserved = reserveUploadJob({ filename, depth: depth || null, vision: wantVision, images: wantImages });
      if (!reserved.ok) return sendJSON(res, 429, { error: "解析任务繁忙，队列已满，请稍后再试" });
      const id = reserved.id;
      const tmp = path.join(os.tmpdir(), `paoding-up-${Date.now()}-${slug(filename)}`);
      let size = 0;
      try { size = await streamBodyToFile(req, tmp); }
      catch (e) { cancelReservedJob(id); return sendJSON(res, e.statusCode || 400, { error: e.message }); }
      if (!size) { cancelReservedJob(id); fs.rmSync(tmp, { force: true }); return sendJSON(res, 400, { error: "空文件" }); }
      markUploadReady(id, { tmp }, () => {
        runJob(id, tmp, depth, "video", wantVision, wantImages);
        // 任务结束(或超 1 小时兜底)后清理临时文件，避免卡死时泄漏
        scheduleTmpCleanup(id, tmp);
      });
      return sendJSON(res, 200, { jobId: id });
    }

    // ---- 进度 SSE ----
    if (req.method === "GET" && p.startsWith("/api/progress/")) {
      const id = p.slice("/api/progress/".length);
      const j = getJob(id);
      res.writeHead(200, {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive",
      });
      if (!j) { res.write(`data: ${JSON.stringify({ type: "error", error: "任务不存在或已过期" })}\n\n`); return res.end(); }
      // 先补发当前状态
      res.write(`data: ${JSON.stringify({ type: "progress", ...j.progress })}\n\n`);
      if (j.status === "done") {
        const recipe = j.recipe || loadRecipe(j.result_recipe_id);
        res.write(`data: ${JSON.stringify({ type: "done", recipe })}\n\n`);
        return res.end();
      }
      if (j.status === "error" || j.status === "interrupted") { res.write(`data: ${JSON.stringify({ type: "error", error: j.error })}\n\n`); return res.end(); }
      j.listeners.add(res);
      req.on("close", () => j.listeners.delete(res));
      return;
    }

    // ---- AI 端点（表驱动：读 JSON → 校验/加载菜谱 → LLM/缓存处理 → 统一返回）----
    if (await handleAiEndpoint(p, req, res)) return;

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

    // ---- 只读分享页：/r/<菜谱id> 任何人可看，无需 App ----
    if (req.method === "GET" && p.startsWith("/r/")) {
      const id = decodeURIComponent(p.slice("/r/".length));
      const r = loadRecipe(id);
      if (!r) { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); return res.end("<meta charset=utf-8><p style='font-family:sans-serif;text-align:center;margin-top:40px;color:#8A817A'>菜谱不存在或已删除</p>"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(shareHTML(r));
    }

    // ---- 静态 ----
    if (req.method === "GET") return serveStatic(res, p);

    res.writeHead(404); res.end("Not found");
  } catch (e) {
    console.error(`[${p}]`, e.message);
    if (!res.headersSent) sendJSON(res, e.statusCode || 500, { error: e.message });
  }
}

export const server = http.createServer(handleRequest);

function startServer() {
  server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;
  console.log(`\x1b[32m庖丁 App 已启动\x1b[0m`);
  console.log(`  本机:  http://localhost:${PORT}`);
  if (lan) console.log(`  局域网(手机同WiFi): http://${lan}:${PORT}`);
  console.log(`  LLM: ${config.llm.model} @ ${config.llm.baseUrl}`);
  console.log(`  ASR: ${config.asr.provider === "local" ? "本地 whisper.cpp" : config.asr.model}`);
  console.log(`  API 鉴权: ${API_TOKEN ? "\x1b[32m已开启\x1b[0m（客户端需在设置里填同一 token）" : "\x1b[33m未开启\x1b[0m（公网/隧道暴露时请设 PAODING_API_TOKEN）"}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
