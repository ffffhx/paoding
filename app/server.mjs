import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, loadEnvFiles } from "../src/config.mjs";
import { processVideo, processText, processImages } from "../src/pipeline.mjs";
import { chatJSON, chatText } from "../src/llm.mjs";
import { DEPTHS, explainSteps } from "../src/explain.mjs";
import { normalizeRecipePhases, normalizeTools } from "../src/chef.mjs";
import { assertPublicUrl } from "../src/urlSafety.mjs";
import { createSlidingWindowRateLimiter } from "../src/rateLimit.mjs";
import { FileJobStore, createJobQueue, createJobRecord, publicJob, TERMINAL_JOB_STATUSES } from "../src/jobs.mjs";
import { mapSchemaRecipeToPaoding } from "../src/importRecipe.mjs";
import { extractTechniques } from "../src/techniques.mjs";
import { withOutputLanguage } from "../src/outputLanguage.mjs";
import {
  isTechniqueSummaryCacheFresh,
  normalizeTechniqueSummary,
  techniqueCacheFileName,
  techniqueOccurrenceSignature,
} from "../src/techniqueSummary.mjs";
import { backupFilename, packBackup, parseBackupTime, planBackupRotation, shouldRunBackup } from "../src/backups.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnvFiles();
// 数据目录可被环境变量覆盖（测试用隔离目录，避免污染真实数据）
const RECIPES_DIR = process.env.PAODING_RECIPES_DIR || path.join(HERE, "recipes");
const JOBS_DIR = path.join(path.dirname(RECIPES_DIR), "jobs");
const BACKUPS_DIR = path.join(path.dirname(RECIPES_DIR), "backups");
const TECHNIQUES_CACHE_DIR = path.join(path.dirname(RECIPES_DIR), "techniques-cache");
const TERM_CACHE_FILE = path.join(path.dirname(RECIPES_DIR), "term-cache.json");
// 用户数据（收藏/笔记/评分/购物清单等）跨设备同步用；放项目根、不在 webDir 内，避免被静态服务或打包暴露
const USERDATA_FILE = process.env.PAODING_USERDATA_FILE || path.join(HERE, "..", "paoding-userdata.json");
const PORT = process.env.PAODING_PORT ? Number(process.env.PAODING_PORT) : 4177;
const HOST = process.env.PAODING_HOST || "0.0.0.0"; // 默认局域网可达(手机用)；设 127.0.0.1 可锁本机
const BASE_PATH = normalizeBasePath(process.env.PAODING_BASE_PATH || "/paoding"); // 兼容 Caddy/Capacitor 挂在 /paoding 子路径
const MAX_RUNNING = Number(process.env.PAODING_MAX_JOBS || 2); // 同时解析上限，防资源耗尽
const MAX_QUEUE = Math.max(0, Number(process.env.PAODING_MAX_QUEUE || 10)); // 等待队列上限，超出才返回 429
const MAX_IMPORT_RECIPES = Number(process.env.PAODING_MAX_IMPORT || 5000); // 单次导入菜谱上限，防脏/超大备份写爆磁盘
const MAX_IMPORT_IMAGES = Math.max(1, Math.floor(Number(process.env.PAODING_IMAGE_MAX_COUNT || 6)));
const MAX_IMPORT_IMAGE_MB = Math.max(1, Number(process.env.PAODING_IMAGE_MAX_MB || 8));
const BACKUP_INTERVAL_H = Number.isFinite(Number(process.env.PAODING_BACKUP_INTERVAL_H))
  ? Number(process.env.PAODING_BACKUP_INTERVAL_H)
  : 24;
const BACKUP_KEEP = Math.max(1, Math.floor(Number(process.env.PAODING_BACKUP_KEEP) || 7));
// 可选 API token：设了 PAODING_API_TOKEN 就要求 /api/* 带上正确 token。
// 非回环地址监听时强制配置 token，除非显式 PAODING_ALLOW_INSECURE=1。
const API_TOKEN = process.env.PAODING_API_TOKEN || "";
const API_TOKENS = process.env.PAODING_API_TOKENS || "";
const DEFAULT_USER = "default";
const USER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CORS_ORIGINS = new Set((process.env.PAODING_CORS_ORIGINS || "")
  .split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean));
const LLM_RATE_LIMIT_PER_MIN = Number(process.env.PAODING_LLM_RATE_LIMIT_PER_MIN || 20);
const LLM_RATE_LIMIT_WINDOW_MS = Number(process.env.PAODING_LLM_RATE_LIMIT_WINDOW_MS || 60_000);
fs.mkdirSync(RECIPES_DIR, { recursive: true });
fs.mkdirSync(JOBS_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });
fs.mkdirSync(TECHNIQUES_CACHE_DIR, { recursive: true });

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
function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest();
}
function parseApiCredentials() {
  const creds = [];
  const seen = new Set();
  const add = (user, token, source) => {
    if (!USER_NAME_RE.test(user)) throw new Error(`${source} 含非法用户 "${user}"，只允许字母、数字、下划线和连字符`);
    if (!token) throw new Error(`${source} 的用户 "${user}" 缺少 token`);
    if (seen.has(user)) throw new Error(`${source} 重复定义用户 "${user}"`);
    seen.add(user);
    creds.push({ user, hash: tokenHash(token) });
  };
  if (API_TOKENS.trim()) {
    for (const part of API_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)) {
      const i = part.indexOf(":");
      if (i <= 0) throw new Error("PAODING_API_TOKENS 格式应为 alice:token1,bob:token2");
      add(part.slice(0, i).trim(), part.slice(i + 1).trim(), "PAODING_API_TOKENS");
    }
  }
  if (API_TOKEN && !seen.has(DEFAULT_USER)) add(DEFAULT_USER, API_TOKEN, "PAODING_API_TOKEN");
  return creds;
}
let API_CREDENTIALS;
try {
  API_CREDENTIALS = parseApiCredentials();
} catch (e) {
  console.error(`\x1b[31m安全配置错误：\x1b[0m ${e.message}`);
  process.exit(1);
}
if (!API_CREDENTIALS.length && !isLoopbackHost(HOST) && process.env.PAODING_ALLOW_INSECURE !== "1") {
  console.error("\x1b[31m安全配置错误：\x1b[0m 当前监听地址不是 127.0.0.1/localhost，但未设置 PAODING_API_TOKEN。");
  console.error("出路 1：设置 PAODING_API_TOKEN，或用 PAODING_API_TOKENS 配置多用户 token。");
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
const llmSystem = (system) => withOutputLanguage(system, config.llm.outputLang);
function schemaToolDescription(t) {
  const note = String(t.substitute_note || "").trim();
  return [
    t.purpose,
    t.essential ? "Essential" : "",
    t.inferred ? "Inferred" : "",
    t.substitute ? `Alternative: ${t.substitute}${note ? ` (${note})` : ""}` : `No alternative${note ? `: ${note}` : ""}`,
  ].filter(Boolean).join("; ");
}
function schemaOrgRecipe(r) {
  const undef = (v) => (v == null || v === "" ? undefined : v);
  const n = r.nutrition?.per_serving;
  const tools = normalizeTools(r.tools);
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: r.title,
    recipeCuisine: undef(r.cuisine),
    keywords: undef((r.tags || []).join(", ")),
    recipeYield: undef(r.servings),
    totalTime: r.total_time_min ? `PT${r.total_time_min}M` : undefined,
    recipeIngredient: (r.ingredients || []).map((i) => `${i.name || ""} ${i.amount || ""}`.trim()).filter(Boolean),
    recipeInstructions: (r.steps || []).map((s) => ({ "@type": "HowToStep", name: undef(s.title), text: s.action || "" })),
    tool: tools.length ? tools.map((t) => ({ "@type": "HowToTool", name: t.name, description: schemaToolDescription(t) })) : undefined,
    nutrition: n ? {
      "@type": "NutritionInformation",
      calories: Number.isFinite(n.calories_kcal) ? `${n.calories_kcal} kcal` : undefined,
      proteinContent: Number.isFinite(n.protein_g) ? `${n.protein_g} g` : undefined,
      fatContent: Number.isFinite(n.fat_g) ? `${n.fat_g} g` : undefined,
      carbohydrateContent: Number.isFinite(n.carbs_g) ? `${n.carbs_g} g` : undefined,
      sodiumContent: Number.isFinite(n.sodium_mg) ? `${n.sodium_mg} mg` : undefined,
    } : undefined,
    url: r.source && /^https?:/.test(r.source) ? r.source : undefined,
  };
}
function scriptJSON(obj) {
  return JSON.stringify(obj, null, 2).replace(/<\//g, "<\\/");
}

// 只读分享页：任何人打开链接即可看整份菜谱（含每步为什么），无需 App。自包含 HTML。
function shareHTML(r) {
  const DIFF = { easy: "简单", medium: "中等", hard: "有挑战" };
  // 图片走公开的图片路由（onerror 移除：备份导入的菜谱可能没带图）
  const imgSrc = (file) => `${BASE_PATH}/api/recipes/${encodeURIComponent(r.id)}/images/${encodeURIComponent(file)}`;
  const meta = [r.difficulty && DIFF[r.difficulty], r.cuisine, r.total_time_min && `约${r.total_time_min}分钟`, `${(r.steps || []).length}步`].filter(Boolean).join(" · ");
  const jsonld = schemaOrgRecipe(r);
  const techHits = extractTechniques(r);
  const techByStep = new Map();
  for (const hit of techHits) {
    if (!techByStep.has(hit.stepIndex)) techByStep.set(hit.stepIndex, []);
    if (!techByStep.get(hit.stepIndex).includes(hit.technique)) techByStep.get(hit.stepIndex).push(hit.technique);
  }
  const techList = [...new Set(techHits.map((h) => h.technique))];
  const n = r.nutrition?.per_serving;
  const nutrition = n ? `<div class="nutrition"><div class="nt">每份营养 <span>AI 估算，仅供参考</span></div><div class="ng">
    ${Number.isFinite(n.calories_kcal) ? `<div><span>热量</span><b>${escHtml(n.calories_kcal)} kcal</b></div>` : ""}
    ${Number.isFinite(n.protein_g) ? `<div><span>蛋白质</span><b>${escHtml(n.protein_g)} g</b></div>` : ""}
    ${Number.isFinite(n.fat_g) ? `<div><span>脂肪</span><b>${escHtml(n.fat_g)} g</b></div>` : ""}
    ${Number.isFinite(n.carbs_g) ? `<div><span>碳水</span><b>${escHtml(n.carbs_g)} g</b></div>` : ""}
    ${Number.isFinite(n.sodium_mg) ? `<div><span>钠</span><b>${escHtml(n.sodium_mg)} mg</b></div>` : ""}
  </div>${r.nutrition?.disclaimer ? `<p>${escHtml(r.nutrition.disclaimer)}</p>` : ""}</div>` : "";
  const ings = (r.ingredients || []).map((i) => `<li><span>${i.image ? `<img class="ith" src="${imgSrc(i.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${escHtml(i.name)}${i.note ? `（${escHtml(i.note)}）` : ""}</span><span class="amt">${escHtml(i.amount || "")}</span></li>`).join("");
  const steps = (r.steps || []).map((s) => {
    const w = s.why || {};
    const why = [w.reason && `<p><b>为什么</b> ${escHtml(w.reason)}</p>`, w.if_not && `<p><b>不这么做</b> ${escHtml(w.if_not)}</p>`, w.cue && `<p class="g"><b>判断到位</b> ${escHtml(w.cue)}</p>`].filter(Boolean).join("");
    const pic = s.image ? `<img class="simg" src="${imgSrc(s.image)}" alt="" loading="lazy" onerror="this.remove()">` : "";
    const techs = (techByStep.get(Number(s.index)) || []).map((t) => `<span class="tech">${escHtml(t)}</span>`).join("");
    return `<li><div class="st">${escHtml(s.title || "")}</div>${techs ? `<div class="techs">${techs}</div>` : ""}<div class="ac">${escHtml(s.action || "")}</div>${pic}${why ? `<div class="why">${why}</div>` : ""}</li>`;
  }).join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(r.title)} · 庖丁</title>
<script type="application/ld+json" id="jsonld">${scriptJSON(jsonld)}</script>
<style>
:root{--bg:#FBF7F0;--card:#fff;--ink:#2A2724;--muted:#8A817A;--line:#EAE2D6;--tomato:#E4572E;--herb:#6A8D3F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}
.wrap{max-width:680px;margin:0 auto;padding:28px 18px 60px}
h1{font-family:Georgia,"Songti SC",serif;font-size:30px;margin:0 0 6px}.meta{color:var(--muted);font-size:14px;margin-bottom:18px}
.sharebar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0}.sharebar button{border:0;border-radius:10px;background:var(--tomato);color:#fff;font-weight:700;padding:9px 12px}.sharebar span{color:var(--muted);font-size:13px}
h2{font-size:14px;color:var(--muted);letter-spacing:1px;margin:26px 0 10px}
ul.ings{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
ul.ings li{display:flex;justify-content:space-between;gap:12px;padding:11px 15px;border-bottom:1px solid var(--line)}ul.ings li:last-child{border:none}.amt{color:var(--muted)}
.nutrition{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-top:16px}.nt{font-weight:700}.nt span,.nutrition p{color:var(--muted);font-size:12px;font-weight:400}.ng{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px;margin-top:10px}.ng div{background:var(--bg);border-radius:10px;padding:9px}.ng span{display:block;color:var(--muted);font-size:12px}.ng b{font-size:15px}.nutrition p{margin:10px 0 0}
.tech-summary{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 0}.tech,.tech-summary span{display:inline-flex;background:#EEF4E8;color:var(--herb);border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700}.techs{display:flex;gap:6px;flex-wrap:wrap;margin:3px 0 5px}
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
<div class="sharebar"><button id="exportJsonld">导出 JSON-LD</button><span>复制到自己的庖丁：下载后，在自己实例的设置页导入外部菜谱。</span></div>
${nutrition}
${techList.length ? `<h2>技法标注</h2><div class="tech-summary">${techList.map((t) => `<span>${escHtml(t)}</span>`).join("")}</div>` : ""}
${ings ? `<h2>食材</h2><ul class="ings">${ings}</ul>` : ""}
<h2>步骤</h2><ol class="steps">${steps}</ol>
<footer>由 <b>庖丁</b> 解析 · 把每道菜讲透「为什么」</footer>
<script>
document.getElementById('exportJsonld').onclick = function () {
  var text = document.getElementById('jsonld').textContent;
  var blob = new Blob([text], { type: 'application/ld+json;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ${JSON.stringify(`${slug(r.title || "recipe")}.jsonld`)};
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
};
</script></div></body></html>`;
}

let recipeListCache = { signature: "", recipes: null };
function recipeListIndex() {
  const files = fs
    .readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const signature = files.map((f) => {
    try {
      const st = fs.statSync(path.join(RECIPES_DIR, f));
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${f}:missing`;
    }
  }).join("|");
  return { files, signature };
}
function invalidateRecipeListCache() {
  recipeListCache = { signature: "", recipes: null };
}
function normalizeRecipeToolsField(recipe) {
  if (!recipe || typeof recipe !== "object") return recipe;
  if (!Object.prototype.hasOwnProperty.call(recipe, "tools")) return recipe;
  if (Array.isArray(recipe.tools)) recipe.tools = normalizeTools(recipe.tools);
  else delete recipe.tools;
  return recipe;
}
function normalizeRecipeFields(recipe) {
  normalizeRecipeToolsField(recipe);
  normalizeRecipePhases(recipe);
  return recipe;
}
function writeRecipeFile(id, recipe) {
  const saved = { ...recipe };
  delete saved.id;
  normalizeRecipeFields(saved);
  fs.writeFileSync(recipePath(id), JSON.stringify(saved, null, 2));
  invalidateRecipeListCache();
}
function ingredientNameSet(ingredients) {
  return new Set((Array.isArray(ingredients) ? ingredients : [])
    .map((i) => String(i?.name || "").trim())
    .filter(Boolean));
}
function sameIngredientNameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const name of a) if (!b.has(name)) return false;
  return true;
}
function pruneSubstituteCache(substitutes, ingredients) {
  if (!substitutes || typeof substitutes !== "object" || Array.isArray(substitutes)) return undefined;
  const names = ingredientNameSet(ingredients);
  const kept = {};
  for (const [name, value] of Object.entries(substitutes)) {
    if (names.has(name)) kept[name] = value;
  }
  return Object.keys(kept).length ? kept : undefined;
}
function listRecipes() {
  const { files, signature } = recipeListIndex();
  if (recipeListCache.recipes && recipeListCache.signature === signature) return recipeListCache.recipes;
  const recipes = files
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, f), "utf8"));
        r.id = f.replace(/\.json$/, "");
        return normalizeRecipeFields(r);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  recipeListCache = { signature, recipes };
  return recipes;
}
function loadRecipe(id) {
  if (!isSafeStorageId(id)) return null; // 缺/非法 recipeId 时返回 null，避免路径别名或 path.basename(undefined) 抛错→500
  const p = recipePath(id);
  if (!fs.existsSync(p)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(p, "utf8")); // 损坏文件也容错
    r.id = id;
    return normalizeRecipeFields(r);
  } catch { return null; }
}
function recipePath(id) {
  return path.join(RECIPES_DIR, `${path.basename(id)}.json`);
}
function isSafeStorageId(id) {
  return typeof id === "string" && Boolean(id) && id !== "." && id !== ".." && !/[\\/]/.test(id);
}
function decodeSafeRouteSegment(raw) {
  try {
    const value = decodeURIComponent(String(raw || ""));
    return isSafeStorageId(value) ? value : "";
  } catch {
    return "";
  }
}
function singleRouteSegmentAfter(prefix, p) {
  if (!p.startsWith(prefix)) return null;
  const raw = p.slice(prefix.length);
  if (!raw || raw.includes("/")) return null;
  return decodeSafeRouteSegment(raw) || null;
}
function uniqueRecipeId(seed) {
  const base = slug(seed || "recipe") || "recipe";
  let id = base;
  for (let i = 2; fs.existsSync(recipePath(id)); i++) id = `${base}-${i}`;
  return id;
}

function userDataFileNames() {
  const dir = path.dirname(USERDATA_FILE);
  const ext = path.extname(USERDATA_FILE) || ".json";
  const base = path.basename(USERDATA_FILE, ext);
  const names = new Set();
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === `${base}${ext}` || (f.startsWith(`${base}-`) && f.endsWith(ext))) names.add(f);
    }
  } catch {}
  return [...names].sort();
}
function collectUserFiles() {
  const dir = path.dirname(USERDATA_FILE);
  return userDataFileNames().map((name) => {
    const fp = path.join(dir, name);
    const raw = fs.readFileSync(fp, "utf8");
    try {
      return { name, data: JSON.parse(raw) };
    } catch {
      return { name, raw, error: "invalid_json" };
    }
  });
}
function listBackups() {
  return fs
    .readdirSync(BACKUPS_DIR)
    .map((name) => {
      const time = parseBackupTime(name);
      if (time === null) return null;
      const st = fs.statSync(path.join(BACKUPS_DIR, name));
      return { name, created_at: new Date(time).toISOString(), size: st.size };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.name.localeCompare(a.name));
}
function latestBackupMs() {
  const times = listBackups().map((b) => Date.parse(b.created_at)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}
function rotateBackups() {
  for (const name of planBackupRotation(fs.readdirSync(BACKUPS_DIR), BACKUP_KEEP)) {
    fs.rmSync(path.join(BACKUPS_DIR, name), { force: true });
  }
}
function createBackup(now = new Date()) {
  const createdAt = now.toISOString();
  const file = backupFilename(now);
  const payload = packBackup({
    createdAt,
    recipes: listRecipes(),
    userFiles: collectUserFiles(),
  });
  const fp = path.join(BACKUPS_DIR, file);
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2));
  rotateBackups();
  return { name: file, created_at: createdAt, size: fs.statSync(fp).size };
}
function startBackupScheduler() {
  if (BACKUP_INTERVAL_H <= 0) return;
  try {
    if (shouldRunBackup({ latestBackupMs: latestBackupMs(), intervalHours: BACKUP_INTERVAL_H })) createBackup();
  } catch (e) {
    console.warn(`  · 自动备份失败（跳过）：${e.message}`);
  }
  const timer = setInterval(() => {
    try { createBackup(); }
    catch (e) { console.warn(`  · 自动备份失败（跳过）：${e.message}`); }
  }, BACKUP_INTERVAL_H * 60 * 60 * 1000);
  timer.unref?.();
}
startBackupScheduler();

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
function authenticate(req, url) {
  if (!API_CREDENTIALS.length) return { ok: true, user: DEFAULT_USER }; // 未配置 = 不鉴权，归到默认用户
  const auth = req.headers["authorization"] || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const provided = req.headers["x-paoding-token"] || bearer || url.searchParams.get("token") || "";
  const hash = tokenHash(provided);
  let user = DEFAULT_USER;
  let ok = false;
  for (const cred of API_CREDENTIALS) {
    const same = crypto.timingSafeEqual(hash, cred.hash);
    if (same && !ok) user = cred.user;
    ok = ok || same;
  }
  return { ok, user };
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
  "/api/parse-images",
  "/api/ask", "/api/troubleshoot", "/api/nutrition", "/api/tools", "/api/pantry-ideas", "/api/overview", "/api/explain-recipe", "/api/import-recipe",
]);
const LIMITED_READ_ENDPOINTS = new Set([
  "/api/techniques",
]);
function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}
function currentUser(req) {
  return req.paodingUser || DEFAULT_USER;
}
function rateLimitPayload(req) {
  const hit = llmLimiter.take(`${clientIp(req)}:${currentUser(req)}`);
  if (hit.allowed) return null;
  return {
    code: 429,
    headers: { "Retry-After": String(Math.max(1, Math.ceil(hit.resetMs / 1000))) },
    body: { error: "请求太频繁，请稍后再试" },
  };
}
function sendEndpointResult(res, out) {
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  sendJSON(res, out.code || 200, out.body);
}
function rateLimitOk(req, res, p) {
  const isTechniqueSummary = req.method === "POST" && /^\/api\/techniques\/[^/]+\/summary$/.test(p);
  const shouldLimit = (req.method === "POST" && LLM_ENDPOINTS.has(p)) || isTechniqueSummary || (req.method === "GET" && LIMITED_READ_ENDPOINTS.has(p));
  if (!shouldLimit) return true;
  const blocked = rateLimitPayload(req);
  if (!blocked) return true;
  sendEndpointResult(res, blocked);
  return false;
}
// 读并解析 JSON 请求体；畸形 JSON 抛 400（而非落到外层 catch 变 500）。
async function readJson(req, limitMB = 800) {
  const text = (await readBody(req, limitMB)).toString("utf8") || "{}";
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
function userDataFile(user = DEFAULT_USER) {
  const name = String(user || DEFAULT_USER);
  if (!USER_NAME_RE.test(name)) throw Object.assign(new Error("非法用户"), { statusCode: 400 });
  if (name === DEFAULT_USER) return USERDATA_FILE;
  const ext = path.extname(USERDATA_FILE) || ".json";
  const base = path.basename(USERDATA_FILE, ext);
  return path.join(path.dirname(USERDATA_FILE), `${base}-${name}${ext}`);
}
function readUserData(user = DEFAULT_USER) {
  const file = userDataFile(user);
  try { return normalizeUserData(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch { return { rev: 0 }; }
}
function writeUserData(data, user = DEFAULT_USER) {
  const file = userDataFile(user);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(normalizeUserData(data), null, 2));
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
    system: llmSystem("你是营养师。只输出 JSON 对象，按 schema 给出这道菜每份的粗略营养估算。字段必须是数字，不要区间，不确定也给合理近似值。"),
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
function recipeToolContext(r) {
  return [
    `菜名：${r.title || "未知"}`,
    `标签：${(r.tags || []).join("、") || "无"}`,
    `菜系：${r.cuisine || "未知"}`,
    `食材：${(r.ingredients || []).map((i) => `${i.name || ""}${i.amount || ""}${i.note ? `（${i.note}）` : ""}`).filter(Boolean).join("、") || "未列出"}`,
    `步骤：${(r.steps || []).map((s) => `${s.index || ""}.${s.title || ""} ${s.action || ""}`).join("\n")}`,
  ].join("\n");
}
async function inferRecipeTools(r) {
  const raw = await chatJSON(config.llm, {
    temperature: 0.2,
    system: llmSystem(`你是严谨的烘焙/烹饪工具审核员。请只输出 JSON 对象，按 schema 为菜谱补齐工具/器具清单。
规则：
- 所有条目的 inferred 必须为 true，因为这是基于已保存菜谱的后补推断。
- 甜品/烘焙类（蛋糕、饼干、慕斯、塔派、面包、裱花、巧克力、糖艺等）必须完整列出关键工具：打发器/打蛋器、裱花袋和裱花嘴、抹刀/刮刀、模具（若材料中有尺寸就写进 name 或 purpose）、油纸、厨房秤、温度计、烤箱等。
- 有替代品时 substitute 写替代方案，substitute_note 写代价/注意点；没有替代品时 substitute 必须为 null，substitute_note 必须写清楚不能替代的原因。
- 非甜品只列非常规厨具，常见锅碗瓢盆不要列。
- 拿不准宁可不列，不要编造视频/菜谱里没有依据的具体尺寸或型号。`),
    user: `schema:
{
  "tools": [
    {
      "name": "工具名",
      "purpose": "用途",
      "essential": true,
      "substitute": "替代方案；无替代为 null",
      "substitute_note": "替代代价/注意点；无替代则写原因",
      "inferred": true
    }
  ]
}

${recipeToolContext(r)}`,
  });
  return normalizeTools(raw?.tools || raw).map((tool) => ({ ...tool, inferred: true }));
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
function techniqueSummaryCachePath(name) {
  return path.join(TECHNIQUES_CACHE_DIR, techniqueCacheFileName(name));
}
function readTechniqueSummaryCache(name, signature) {
  try {
    const cache = JSON.parse(fs.readFileSync(techniqueSummaryCachePath(name), "utf8"));
    return isTechniqueSummaryCacheFresh(cache, signature) ? cache : null;
  } catch {
    return null;
  }
}
function writeTechniqueSummaryCache(name, payload) {
  fs.mkdirSync(TECHNIQUES_CACHE_DIR, { recursive: true });
  fs.writeFileSync(techniqueSummaryCachePath(name), JSON.stringify(payload, null, 2));
}
function techniqueSummarySamples(occurrences) {
  return (occurrences || []).slice(0, 30).map((o, i) => {
    const why = [o.why?.reason, o.why?.if_not, o.why?.cue].filter(Boolean).join(" / ");
    return `${i + 1}. ${o.recipeTitle || o.recipeId} 第${o.stepIndex}步：${o.stepTitle || "未命名"}。做法：${o.action || "无"}。原理：${why || "无"}`;
  }).join("\n");
}
async function summarizeTechnique(name) {
  const technique = String(name || "").trim();
  if (!technique) return { code: 400, body: { error: "技法名称为空" } };
  const group = aggregateTechniques().find((g) => g.technique === technique);
  if (!group) return { code: 404, body: { error: "还没有找到这个技法的样本" } };
  const signature = techniqueOccurrenceSignature(group.occurrences);
  const cached = readTechniqueSummaryCache(technique, signature);
  if (cached) {
    return { body: { technique, summary: cached.summary, cached: true, count: group.count } };
  }

  const raw = await chatJSON(config.llm, {
    temperature: 0.2,
    system: llmSystem("你是中餐技法教练。只输出 JSON 对象，不要 markdown。请根据多个菜谱中同一技法的出现样本，归纳成短而实用的学习卡。"),
    user: `输出 schema:
{
  "when": "什么时候用：1-3句话",
  "keys": "关键判断：1-3条，写成一句话或短句",
  "pitfalls": "常见翻车点：1-3条，写成一句话或短句"
}

技法：${technique}
样本：
${techniqueSummarySamples(group.occurrences)}`,
  });
  const summary = normalizeTechniqueSummary(raw);
  writeTechniqueSummaryCache(technique, {
    technique,
    signature,
    count: group.count,
    summary,
    created_at: nowISO(),
  });
  return { body: { technique, summary, cached: false, count: group.count } };
}
function techniqueSummaryNameFromPath(p) {
  const m = p.match(/^\/api\/techniques\/([^/]+)\/summary$/);
  return m ? decodeURIComponent(m[1]) : "";
}

// ---------- 解析任务（持久化 + 排队 + 进度）----------
const jobStore = new FileJobStore(JOBS_DIR, { keep: 50 });
const jobs = new Map(jobStore.init().map((j) => [j.id, { ...j, listeners: new Set() }]));
const jobQueue = createJobQueue(MAX_QUEUE);
const runningCount = () => [...jobs.values()].filter((j) => j.status === "running").length;
const nowISO = () => new Date().toISOString();
function withJobUser(req, params = {}) {
  return { ...params, _user: currentUser(req) };
}
function jobOwner(job) {
  return job?.params?._user || DEFAULT_USER;
}
function publicJobForUser(job) {
  const out = publicJob(job);
  if (out?.params && typeof out.params === "object") {
    out.params = { ...out.params };
    delete out.params._user;
  }
  return out;
}

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
  iv.unref?.();
}
function scheduleTmpDirCleanup(id, dir) {
  const j = jobs.get(id);
  let ticks = 0;
  const iv = setInterval(() => {
    const cur = jobs.get(id) || j;
    if (!cur || cur.status !== "running" || ++ticks > 1200) {
      fs.rmSync(dir, { recursive: true, force: true });
      clearInterval(iv);
    }
  }, 3000);
  iv.unref?.();
}
function recipeResultId(recipe) {
  return recipe?.id || slug(recipe?.title || "");
}
function finishJob(id, ev) {
  const j = jobs.get(id);
  if (!j || TERMINAL_JOB_STATUSES.has(j.status)) return;
  if (ev.type === "done") {
    invalidateRecipeListCache();
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
  } else if (kind === "images") {
    run = processImages(input, cfg, { onProgress, signal });
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

function cacheTextKey(value) {
  return String(value || "").trim();
}
function cachedAnswer(cache, key) {
  const entry = cache && typeof cache === "object" ? cache[key] : null;
  return entry && typeof entry.answer === "string" && entry.answer.trim() ? entry : null;
}
function readTermCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(TERM_CACHE_FILE, "utf8"));
    return cache && typeof cache === "object" && !Array.isArray(cache) ? cache : {};
  } catch {
    return {};
  }
}
function writeTermCache(cache) {
  fs.writeFileSync(TERM_CACHE_FILE, JSON.stringify(cache, null, 2));
}
function substitutePrompt(body, r) {
  return {
    system: "你是经验丰富的中餐厨师，实话实说、不糊弄。用户做某道菜时缺了某种食材/调料，针对性判断：\n" +
      "- 大多数食材都有可接受的替代——只要有靠谱替代就给1~3个，标出最推荐的，说明用量换算和风味差异（例：白糖可用冰糖或红糖、老抽可用生抽加少量糖色、香醋可用米醋、生粉可用玉米淀粉）。\n" +
      "- 只有当它是这道菜的灵魂、任何替代都会明显翻车或跑味时，才说「不建议替代」，讲清为什么、硬替会怎样、给务实建议（例：用醋替料酒去腥、用清水替高汤——这类才算不能替）。\n" +
      "- 别为了凑数硬编烂替代，也别把「有点影响」当成「不能替代」。简洁中文，分点。\n" +
      AI_ENDPOINTS._ingredientAsrDefense,
    user: `菜名：${r ? r.title : "某道菜"}。用户缺的是「${body.ingredient}」，有什么可以替代？若确实没有好替代就直说。`,
  };
}
function termPrompt(body) {
  return {
    system: "你是食品科学科普作者。用3~4句通俗中文解释这个烹饪术语/原理是什么、为什么重要。\n" + AI_ENDPOINTS._ingredientAsrDefense,
    user: `解释一下烹饪里的「${body.term}」。`,
  };
}
async function answerSubstitute({ recipeId, ingredient, force }, { req } = {}) {
  const key = cacheTextKey(ingredient);
  if (!key) return { code: 400, body: { error: "缺少食材名" } };
  const r = loadRecipe(recipeId);
  const cache = r?.substitutes && typeof r.substitutes === "object" && !Array.isArray(r.substitutes)
    ? r.substitutes
    : {};
  const hit = !force ? cachedAnswer(cache, key) : null;
  if (hit) return { body: { answer: hit.answer, cached: true, created_at: hit.created_at || null } };

  const blocked = req ? rateLimitPayload(req) : null;
  if (blocked) return blocked;
  const prompt = substitutePrompt({ ingredient: key }, r);
  prompt.system = llmSystem(prompt.system);
  const answer = await chatText(config.llm, prompt);
  const createdAt = nowISO();
  if (r && isSafeStorageId(recipeId)) {
    const fp = recipePath(recipeId);
    const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
    cur.substitutes = {
      ...(cur.substitutes && typeof cur.substitutes === "object" && !Array.isArray(cur.substitutes) ? cur.substitutes : {}),
      [key]: { answer, created_at: createdAt },
    };
    writeRecipeFile(recipeId, cur);
  }
  return { body: { answer, cached: false, created_at: createdAt } };
}
async function answerTerm({ term, force }, { req } = {}) {
  const key = cacheTextKey(term);
  if (!key) return { code: 400, body: { error: "缺少术语" } };
  const cache = readTermCache();
  const hit = !force ? cachedAnswer(cache, key) : null;
  if (hit) return { body: { answer: hit.answer, cached: true, created_at: hit.created_at || null } };

  const blocked = req ? rateLimitPayload(req) : null;
  if (blocked) return blocked;
  const prompt = termPrompt({ term: key });
  prompt.system = llmSystem(prompt.system);
  const answer = await chatText(config.llm, prompt);
  const createdAt = nowISO();
  cache[key] = { answer, created_at: createdAt };
  writeTermCache(cache);
  return { body: { answer, cached: false, created_at: createdAt } };
}

function normalizePantryPayload(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String(raw?.name || raw || "").trim().slice(0, 48);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const note = String(raw?.note || raw?.amount || "").trim().slice(0, 80);
    out.push({ name, note });
  }
  return out.slice(0, 80);
}
async function answerPantryIdeas({ pantry }) {
  const items = normalizePantryPayload(pantry);
  if (!items.length) return { code: 400, body: { error: "请先提供食材库存" } };
  const prompt = {
    system: llmSystem("你是务实的家庭厨房助手。根据用户已有食材，给 3 个可做菜思路。每个思路包含菜名、会用到的已有食材、最多 2 个建议补买项、关键做法。不要声称一定完全齐料。"),
    user: `已有食材：\n${items.map((x) => `- ${x.name}${x.note ? `（${x.note}）` : ""}`).join("\n")}`,
  };
  const answer = await chatText(config.llm, prompt);
  return { body: { answer, ai: true } };
}

const AI_ENDPOINTS = {
  _ingredientAsrDefense: "食材名可能包含语音识别的同音错别字（如 白纸 实为 白芷、肉豆扣 实为 肉豆蔻）。先判断名字是否为误写：若是，回答开头先指出正确名称，再按正确食材给替代建议；若名字本身不是食材也无法推断，直说无法识别，不要硬编。",
  "/api/ask": {
    recipe: { required: true },
    prompt: ({ body, r }) => {
      const { stepIndex, question } = body;
      const s = (r.steps || []).find((x) => x.index === stepIndex);
      const ctx = `菜名：${r.title}\n当前步骤：${s ? s.title + " — " + s.action : "（整体）"}\n` +
        `食材：${(r.ingredients || []).map((i) => i.name + i.amount).join("、")}`;
      return {
        system: "你是一位耐心的中餐老师，正在指导用户做这道菜。用简洁、通俗、可操作的中文回答用户对当前步骤的疑问。不确定就说不确定，别编造具体数字。\n" + AI_ENDPOINTS._ingredientAsrDefense,
        user: `${ctx}\n\n用户的问题：${question}`,
      };
    },
  },
  "/api/substitute": {
    handle: answerSubstitute,
  },
  "/api/term": {
    handle: answerTerm,
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
      writeRecipeFile(recipeId, cur);
      return { body: { nutrition, answer: nutritionText(nutrition), cached: false } };
    },
  },
  "/api/tools": {
    handle: async ({ recipeId }) => {
      const r = loadRecipe(recipeId);
      if (!r) return { code: 404, body: { error: "菜谱不存在" } };
      if (Array.isArray(r.tools)) return { body: { ok: true, tools: r.tools, recipe: r, cached: true } };
      if (!Array.isArray(r.steps) || !r.steps.length) return { code: 400, body: { error: "这道菜没有步骤，无法补工具清单" } };
      const tools = await inferRecipeTools(r);
      const id = path.basename(recipeId);
      const saved = { ...r, tools };
      writeRecipeFile(id, saved);
      return { body: { ok: true, tools, recipe: { ...saved, id }, cached: false } };
    },
  },
  "/api/pantry-ideas": {
    handle: answerPantryIdeas,
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
      writeRecipeFile(id, saved);
      return { body: { ok: true, recipe: { ...saved, id }, answer: "已补齐每步原理讲解" } };
    },
  },
};

async function handleAiEndpoint(p, req, res) {
  const def = AI_ENDPOINTS[p];
  if (req.method !== "POST" || !def) return false;
  const body = await readJson(req);
  if (def.handle) {
    const out = await def.handle(body, { req });
    sendEndpointResult(res, out);
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
  prompt.system = llmSystem(prompt.system);
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

function imageExt(name = "", type = "") {
  const t = String(type || "").toLowerCase();
  if (t === "image/png") return ".png";
  if (t === "image/webp") return ".webp";
  if (t === "image/jpeg" || t === "image/jpg") return ".jpg";
  const ext = path.extname(String(name || "")).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? (ext === ".jpeg" ? ".jpg" : ext) : "";
}
function decodeImageUpload(item, index) {
  const data = typeof item === "string" ? item : (item?.data || item?.base64 || "");
  const name = typeof item === "object" ? String(item.name || `image-${index + 1}`) : `image-${index + 1}`;
  const type = typeof item === "object" ? String(item.type || "") : "";
  const m = String(data || "").match(/^data:([^;,]+);base64,(.*)$/s);
  const mime = (m ? m[1] : type).toLowerCase();
  const ext = imageExt(name, mime);
  if (!ext || (mime && !mime.startsWith("image/"))) throw Object.assign(new Error("只支持 JPEG/PNG/WebP 图片"), { statusCode: 400 });
  const raw = (m ? m[2] : String(data || "")).replace(/\s+/g, "");
  if (!raw) throw Object.assign(new Error("图片数据为空"), { statusCode: 400 });
  const buf = Buffer.from(raw, "base64");
  if (!buf.length) throw Object.assign(new Error("图片数据为空"), { statusCode: 400 });
  const maxBytes = MAX_IMPORT_IMAGE_MB * 1024 * 1024;
  if (buf.length > maxBytes) throw Object.assign(new Error(`单张图片不能超过 ${MAX_IMPORT_IMAGE_MB}MB`), { statusCode: 413 });
  return { name, ext, buf };
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
  const auth = authenticate(req, url);
  req.paodingUser = auth.user;
  if (p.startsWith("/api/") && !isRecipeImage && !auth.ok) return sendJSON(res, 401, { error: "未授权：缺少或错误的 API token" });
  if (!rateLimitOk(req, res, p)) return;

  try {
    // ---- 列表 ----
    if (req.method === "GET" && p === "/api/recipes") return sendJSON(res, 200, listRecipes());
    if (req.method === "GET" && p === "/api/backups") return sendJSON(res, 200, listBackups());
    if (req.method === "GET" && p === "/api/techniques") return sendJSON(res, 200, aggregateTechniques());
    if (req.method === "POST" && /^\/api\/techniques\/[^/]+\/summary$/.test(p)) {
      const out = await summarizeTechnique(techniqueSummaryNameFromPath(p));
      return sendJSON(res, out.code || 200, out.body);
    }
    if (req.method === "GET" && p === "/api/jobs") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20) || 20));
      const jobTime = (j) => Date.parse(j.updated_at || j.finished_at || j.started_at || j.queued_at || j.created_at || "") || 0;
      return sendJSON(res, 200, jobStore.readAll()
        .filter((j) => jobOwner(j) === currentUser(req))
        .sort((a, b) => jobTime(b) - jobTime(a))
        .slice(0, limit)
        .map(publicJobForUser));
    }

    // ---- 用户数据同步（收藏/笔记/评分/购物清单跨设备共享）----
    if (req.method === "GET" && p === "/api/userdata") {
      return sendJSON(res, 200, readUserData(currentUser(req)));
    }
    if (req.method === "PUT" && p === "/api/userdata") {
      const body = (await readBody(req)).toString("utf8") || "{}";
      let incoming;
      try { incoming = JSON.parse(body); } catch { return sendJSON(res, 400, { error: "无效 JSON" }); }
      const cur = readUserData(currentUser(req));
      const clientRev = normalizeRev(incoming?.rev);
      if (clientRev !== cur.rev) return sendJSON(res, 409, { error: "用户数据已被其他设备更新", userdata: cur });
      const next = normalizeUserData({ ...incoming, rev: cur.rev + 1 });
      writeUserData(next, currentUser(req));
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
      writeRecipeFile(id, saved);
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
        writeRecipeFile(id, rr); n++;
      }
      if (data.userdata && typeof data.userdata === "object" && !Array.isArray(data.userdata)) writeUserData(data.userdata, currentUser(req));
      return sendJSON(res, 200, { ok: true, count: n, skipped });
    }

    // ---- 菜谱图片（步骤状态图/食材图，解析时截自原视频）----
    if (isRecipeImage) {
      const m = p.match(/^\/api\/recipes\/([^/]+)\/images\/([^/]+)$/);
      const id = decodeSafeRouteSegment(m[1]);
      const file = decodeSafeRouteSegment(m[2]);
      // 文件名只可能是解析器写出的 step-N.jpg / ing-N.jpg，白名单校验兼防穿越
      const fp = /^[\w-]+\.jpg$/.test(file) ? path.join(RECIPES_DIR, id, file) : "";
      if (!fp || !fs.existsSync(fp)) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
      return res.end(fs.readFileSync(fp));
    }

    // ---- 删除 ----
    const recipeIdForMutation = singleRouteSegmentAfter("/api/recipes/", p);
    if (req.method === "DELETE" && recipeIdForMutation) {
      const fp = path.join(RECIPES_DIR, `${recipeIdForMutation}.json`);
      const mp = path.join(RECIPES_DIR, `${recipeIdForMutation}.md`);
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: "菜谱不存在" }); // 不存在别谎报成功
      fs.rmSync(fp, { force: true }); fs.rmSync(mp, { force: true });
      // 连图片目录一起删（recipeIdForMutation 非空且不等于 RECIPES_DIR 本身，防误删整个库）
      const dir = path.join(RECIPES_DIR, recipeIdForMutation);
      if (dir !== RECIPES_DIR) fs.rmSync(dir, { recursive: true, force: true });
      invalidateRecipeListCache();
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 覆盖保存（笔记/评分/做过 等本地增改回写到菜谱）----
    if (req.method === "PUT" && recipeIdForMutation) {
      const fp = path.join(RECIPES_DIR, `${recipeIdForMutation}.json`);
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: "菜谱不存在" });
      const patch = await readJson(req);
      const cur = JSON.parse(fs.readFileSync(fp, "utf8"));
      const next = { ...cur, ...patch };
      const nutritionTouched = ("ingredients" in patch && JSON.stringify(patch.ingredients) !== JSON.stringify(cur.ingredients))
        || ("servings" in patch && patch.servings !== cur.servings);
      if (nutritionTouched) delete next.nutrition;
      const recipeTitleChanged = "title" in patch && String(patch.title || "") !== String(cur.title || "");
      const ingredientNamesChanged = "ingredients" in patch
        && !sameIngredientNameSet(ingredientNameSet(cur.ingredients), ingredientNameSet(next.ingredients));
      if (recipeTitleChanged && next.substitutes) {
        delete next.substitutes;
      } else if (ingredientNamesChanged && next.substitutes) {
        const pruned = pruneSubstituteCache(next.substitutes, next.ingredients);
        if (pruned) next.substitutes = pruned;
        else delete next.substitutes;
      }
      writeRecipeFile(recipeIdForMutation, next);
      return sendJSON(res, 200, { ok: true });
    }

    // ---- 发起解析（返回 jobId）----
    if (req.method === "POST" && p === "/api/parse-url") {
      const body = await readJson(req);
      if (!/^https?:\/\//.test(body.url || "")) return sendJSON(res, 400, { error: "请提供 http(s) 链接" });
      await assertPublicUrl(body.url);
      const queued = submitParseJob("url", withJobUser(req, {
        url: body.url,
        depth: body.depth || null,
        vision: !!body.vision,
        images: !!body.images,
      }), (id) => runJob(id, body.url, body.depth, "video", !!body.vision, !!body.images));
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
      const queued = submitParseJob("text", withJobUser(req, {
        input,
        depth: body.depth || null,
      }), (id) => runJob(id, input, body.depth, "text"));
      if (!queued.ok) return sendJSON(res, 429, { error: "解析任务繁忙，队列已满，请稍后再试" });
      return sendJSON(res, 200, { jobId: queued.id });
    }
    // ---- 图片解析：拍菜谱书/手写菜谱/截图 → 视觉转录 → 结构化菜谱 ----
    if (req.method === "POST" && p === "/api/parse-images") {
      if (!config.vision) return sendJSON(res, 400, { error: "需配置视觉模型后才能拍照/图片导入。" });
      let body;
      try { body = await readJson(req, Math.ceil(MAX_IMPORT_IMAGES * MAX_IMPORT_IMAGE_MB * 1.5 + 1)); }
      catch (e) { return sendJSON(res, e.statusCode || 400, { error: e.message }); }
      const images = Array.isArray(body.images) ? body.images : [];
      if (!images.length) return sendJSON(res, 400, { error: "请至少上传一张菜谱图片" });
      if (images.length > MAX_IMPORT_IMAGES) return sendJSON(res, 400, { error: `一次最多上传 ${MAX_IMPORT_IMAGES} 张图片` });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paoding-img-"));
      const paths = [];
      try {
        images.forEach((img, i) => {
          const decoded = decodeImageUpload(img, i);
          const fp = path.join(dir, `${String(i + 1).padStart(2, "0")}-${slug(decoded.name)}${decoded.ext}`);
          fs.writeFileSync(fp, decoded.buf);
          paths.push(fp);
        });
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        return sendJSON(res, e.statusCode || 400, { error: e.message });
      }

      const queued = submitParseJob("images", withJobUser(req, {
        count: paths.length,
        depth: body.depth || null,
        filenames: images.map((img, i) => typeof img === "object" ? String(img.name || `image-${i + 1}`) : `image-${i + 1}`),
      }), (id) => {
        runJob(id, paths, body.depth, "images");
        scheduleTmpDirCleanup(id, dir);
      });
      if (!queued.ok) {
        fs.rmSync(dir, { recursive: true, force: true });
        return sendJSON(res, 429, { error: "解析任务繁忙，队列已满，请稍后再试" });
      }
      return sendJSON(res, 200, { jobId: queued.id });
    }
    if (req.method === "POST" && p === "/api/parse-file") {
      const filename = decodeURIComponent(req.headers["x-filename"] || "video.mp4");
      const depth = req.headers["x-depth"];
      const wantVision = req.headers["x-vision"] === "1";
      const wantImages = req.headers["x-images"] === "1";
      // 先同步占住并发 slot，再读上传体：否则「检查→await readBody→newJob」之间的事件循环让步会让
      // 多个并发上传同时通过 runningCount 检查，绕过 MAX_RUNNING、并发拉起过多 ffmpeg/whisper。
      const reserved = reserveUploadJob(withJobUser(req, { filename, depth: depth || null, vision: wantVision, images: wantImages }));
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
      if (jobOwner(j) !== currentUser(req)) { res.write(`data: ${JSON.stringify({ type: "error", error: "任务不存在或已过期" })}\n\n`); return res.end(); }
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
      const id = singleRouteSegmentAfter("/r/", p);
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
  const authText = API_CREDENTIALS.length > 1
    ? `\x1b[32m已开启\x1b[0m（${API_CREDENTIALS.length} 个用户 token）`
    : API_CREDENTIALS.length === 1
      ? "\x1b[32m已开启\x1b[0m（客户端需在设置里填同一 token）"
      : "\x1b[33m未开启\x1b[0m（公网/隧道暴露时请设 PAODING_API_TOKEN）";
  console.log(`  API 鉴权: ${authText}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
