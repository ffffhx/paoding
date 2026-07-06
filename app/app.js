/* 庖丁 App — 单页逻辑（vanilla JS，无依赖） */
'use strict';

/* ---------- 存储 ---------- */
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('paoding.' + k)); return v ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('paoding.' + k, JSON.stringify(v)); },
};
const settings = Object.assign({ theme: 'light', fontScale: 1, tts: true, ttsRate: 1, apiBase: '', apiToken: '', depth: 'balanced' }, store.get('settings', {}));
function saveSettings() { store.set('settings', settings); }

/* ---------- API ---------- */
// 自动推导当前页面所在的路径前缀：根部署("/","/index.html")→""；反代到子路径("/paoding/")→"/paoding"。
// 这样 App 从 https://域名:8443/paoding/ 加载时，/api 调用会自动带上 /paoding 前缀，无需手工配。
const BASE = location.pathname.replace(/\/[^/]*$/, '');
const api = (p) => (settings.apiBase || BASE) + p;
// 可选 API token：服务端设了 PAODING_API_TOKEN 时，所有 /api/* 都要带上（走 X-Paoding-Token 头）。
const authHeaders = () => settings.apiToken ? { 'X-Paoding-Token': settings.apiToken } : {};
// 统一 fetch 包装：自动注入 token 头，与调用方自带 headers 合并。
const F = (p, opts = {}) => fetch(api(p), { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() } });
const API = {
  list: () => F('/api/recipes').then(r => r.json()),
  techniques: () => F('/api/techniques').then(r => r.json()),
  techniqueSummary: (name) => F('/api/techniques/' + encodeURIComponent(name) + '/summary', { method: 'POST' }).then(j),
  del: (id) => F('/api/recipes/' + encodeURIComponent(id), { method: 'DELETE' }),
  startUrl: (url, depth, vision, images) => F('/api/parse-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, depth, vision: !!vision, images: !!images }) }).then(j),
  startFile: (file, depth, vision, images) => F('/api/parse-file', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'X-Depth': depth, 'X-Vision': vision ? '1' : '0', 'X-Images': images ? '1' : '0' }, body: file }).then(j),
  startText: (text, depth) => F('/api/parse-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, depth }) }).then(j),
  startImages: async (files, depth) => F('/api/parse-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ depth, images: await imageFilesPayload(files) }) }).then(j),
  jobs: () => F('/api/jobs?limit=8').then(r => r.json()).catch(() => []),
  ask: (recipeId, stepIndex, question) => F('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, question }) }).then(j),
  substitute: (recipeId, ingredient) => F('/api/substitute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, ingredient }) }).then(j),
  term: (term) => F('/api/term', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term }) }).then(j),
  troubleshoot: (recipeId, stepIndex, problem) => F('/api/troubleshoot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, problem }) }).then(j),
  nutrition: (recipeId) => F('/api/nutrition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
  overview: (recipeId) => F('/api/overview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
  explainRecipe: (recipeId, depth) => F('/api/explain-recipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, depth }) }).then(j),
  userdataGet: () => F('/api/userdata').then(r => r.json()).catch(() => ({ rev: 0 })),
  userdataPut: async (data) => {
    const r = await F('/api/userdata', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || ('HTTP ' + r.status)); e.status = r.status; e.data = d; throw e; }
    return d;
  },
  importAll: (data) => F('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(j),
  importRecipe: (jsonld) => F('/api/import-recipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonld }) }).then(j),
};
async function exportData() {
  try {
    const [recipes, userdata] = await Promise.all([API.list(), API.userdataGet()]);
    const blob = new Blob([JSON.stringify({ app: 'paoding', version: 1, exportedAt: new Date().toISOString(), recipes, userdata }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'paoding-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('已导出备份文件');
  } catch (e) { toast('导出失败：' + e.message); }
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let data; try { data = JSON.parse(reader.result); } catch { toast('不是有效的备份文件'); return; }
    if (!(await confirmModal('用这个备份覆盖当前数据？现有菜谱与收藏会被替换。', '恢复'))) return;
    try {
      const res = await API.importAll({ recipes: data.recipes, userdata: data.userdata });
      toast('已恢复 ' + (res.count || 0) + ' 道菜，刷新中…');
      setTimeout(() => location.reload(), 900);
    } catch (e) { toast('导入失败：' + e.message); }
  };
  reader.readAsText(file);
}
async function importRecipeJsonLd(text) {
  const raw = String(text || '').trim();
  if (!raw) { toast('先粘贴 JSON-LD'); return; }
  try {
    const res = await API.importRecipe(raw);
    toast('已导入：' + (res.recipe?.title || res.id));
    recipes = await API.list();
    renderAll();
    const found = recipes.find(x => x.id === res.id) || res.recipe;
    if (found) openDetail(found);
  } catch (e) {
    toast('导入失败：' + e.message);
  }
}
function importRecipeJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => importRecipeJsonLd(reader.result);
  reader.readAsText(file);
}
async function j(r) { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}
async function imageFilesPayload(files) {
  return Promise.all(Array.from(files || []).map(async (file) => ({
    name: file.name || 'image',
    type: file.type || 'image/jpeg',
    data: await readAsDataUrl(file),
  })));
}

/* ---------- 状态 ---------- */
let recipes = [];
let techniques = [];
let recentJobs = [];
let userdataRev = 0;
let favRecipes = store.get('favRecipes', []);
let favSteps = store.get('favSteps', []);
let shopping = store.get('shopping', []);
let mealPlan = store.get('mealPlan', {}); // { 'YYYY-MM-DD': [recipeId,...] }
function saveMealPlan() { store.set('mealPlan', mealPlan); }
let meta = store.get('meta', {}); // {recipeId:{cooked,cooked_at,rating,notes,ingChecked:[]}}
let depth = settings.depth;
let curTab = 'recipes';
let filter = { q: '', tag: '', ingredients: '', sort: 'recent' };
const rmeta = (id) => (meta[id] = meta[id] || {});
function saveMeta() { store.set('meta', meta); }
const stepKey = (id, i) => id + '#' + i;

/* ---------- 跨设备同步 ----------
   收藏/技巧/购物清单/笔记评分等原本只存在各设备的 localStorage，手机和电脑不通。
   这里拦截对这些键的写入 → 防抖后回传后端；启动时先从后端拉一份，实现多端共享。 */
const _storeSet = store.set.bind(store);
const SYNC_KEYS = new Set(['favRecipes', 'favSteps', 'shopping', 'meta', 'mealPlan']);
let syncT = null;
function revOf(d) { const n = Number(d && d.rev); return Number.isInteger(n) && n >= 0 ? n : 0; }
function localUserData() { return { rev: userdataRev, favRecipes, favSteps, shopping, meta, mealPlan }; }
function uniqList(a, b, keyFn = (x) => JSON.stringify(x)) {
  const out = [], seen = new Set();
  for (const x of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k); out.push(x);
  }
  return out;
}
function mergeShopping(remote, local) {
  const map = new Map();
  const key = (x) => [x?.name || '', x?.amount || '', x?.from || ''].join('|');
  for (const it of [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]) {
    const k = key(it);
    const prev = map.get(k);
    map.set(k, prev ? { ...prev, ...it, checked: !!prev.checked || !!it.checked } : { ...it });
  }
  return [...map.values()];
}
function mergeMeta(remote, local) {
  const out = { ...(remote && typeof remote === 'object' && !Array.isArray(remote) ? remote : {}) };
  const loc = local && typeof local === 'object' && !Array.isArray(local) ? local : {};
  for (const [id, l] of Object.entries(loc)) {
    const r = out[id] && typeof out[id] === 'object' ? out[id] : {};
    const next = { ...r, ...(l && typeof l === 'object' ? l : {}) };
    next.ingChecked = uniqList(r.ingChecked, l?.ingChecked, String);
    if (r.cooked || l?.cooked) next.cooked = true;
    if (r.cooked_at && l?.cooked_at) next.cooked_at = String(r.cooked_at) > String(l.cooked_at) ? r.cooked_at : l.cooked_at;
    out[id] = next;
  }
  return out;
}
function mergeMealPlan(remote, local) {
  const out = { ...(remote && typeof remote === 'object' && !Array.isArray(remote) ? remote : {}) };
  const loc = local && typeof local === 'object' && !Array.isArray(local) ? local : {};
  for (const [day, ids] of Object.entries(loc)) out[day] = uniqList(out[day], ids, String);
  return out;
}
function mergeUserDataConflict(remote, local) {
  return {
    rev: revOf(remote),
    favRecipes: uniqList(remote?.favRecipes, local?.favRecipes, String),
    favSteps: uniqList(remote?.favSteps, local?.favSteps, (x) => x?.key || JSON.stringify(x)),
    shopping: mergeShopping(remote?.shopping, local?.shopping),
    meta: mergeMeta(remote?.meta, local?.meta),
    mealPlan: mergeMealPlan(remote?.mealPlan, local?.mealPlan),
  };
}
function applyUserData(d) {
  userdataRev = revOf(d);
  favRecipes = Array.isArray(d.favRecipes) ? d.favRecipes : [];
  favSteps = Array.isArray(d.favSteps) ? d.favSteps : [];
  shopping = Array.isArray(d.shopping) ? d.shopping : [];
  meta = d.meta && typeof d.meta === 'object' && !Array.isArray(d.meta) ? d.meta : {};
  mealPlan = d.mealPlan && typeof d.mealPlan === 'object' && !Array.isArray(d.mealPlan) ? d.mealPlan : {};
  _storeSet('favRecipes', favRecipes); _storeSet('favSteps', favSteps); _storeSet('shopping', shopping); _storeSet('meta', meta); _storeSet('mealPlan', mealPlan);
}
async function syncUserDataNow(retry = true) {
  try {
    const res = await API.userdataPut(localUserData());
    userdataRev = revOf(res.userdata || res);
  } catch (e) {
    if (e.status === 409 && retry && e.data?.userdata) {
      const merged = mergeUserDataConflict(e.data.userdata, localUserData());
      applyUserData(merged);
      await syncUserDataNow(false);
    } else {
      console.warn('用户数据同步失败：', e.message);
    }
  }
}
function syncUp() { clearTimeout(syncT); syncT = setTimeout(() => syncUserDataNow(true), 800); }
store.set = (k, v) => { _storeSet(k, v); if (SYNC_KEYS.has(k)) syncUp(); };
async function loadUserData() {
  let d = null;
  try { d = await API.userdataGet(); } catch { }
  d = d || {};
  userdataRev = revOf(d);
  const nonEmpty = (v) => Array.isArray(v) ? v.length > 0 : !!(v && typeof v === 'object' && Object.keys(v).length > 0);
  let needPush = false;
  // 每个键：后端有非空数据才采用；后端空/缺而本地有数据时保留本地并回推。
  // 否则某台设备首启播种的空 {favRecipes:[],meta:{}…}（[]/{} 都是 truthy）会把另一台离线攒的收藏/清单/排菜静默清空。
  const merge = (remote, local) => { if (nonEmpty(remote)) return remote; if (nonEmpty(local)) needPush = true; return local; };
  favRecipes = merge(d.favRecipes, favRecipes); _storeSet('favRecipes', favRecipes);
  favSteps = merge(d.favSteps, favSteps); _storeSet('favSteps', favSteps);
  shopping = merge(d.shopping, shopping); _storeSet('shopping', shopping);
  meta = merge(d.meta, meta); _storeSet('meta', meta);
  mealPlan = merge(d.mealPlan, mealPlan); _storeSet('mealPlan', mealPlan);
  if (needPush) syncUp(); // 把后端缺的本地数据推上去，避免下次又被空值覆盖
}

/* ---------- 工具 ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800); }
function $(s, r = document) { return r.querySelector(s); }
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

const TERMS = ['美拉德反应', '焦糖化', '焯水', '飞水', '滑油', '过油', '糖色', '勾芡', '断生', '锁水', '乳化', '收汁', '爆香', '腌制', '上浆', '挂糊', '养锅', '汆烫', '走油', '回锅', '醒面', '拉丝'];
function linkifyTerms(text) {
  let out = esc(text);
  for (const t of TERMS) {
    if (out.includes(t)) out = out.split(t).join(`<span class="term" data-term="${t}">${t}</span>`);
  }
  return out;
}
function parseSeconds(t) {
  if (!t) return 0; t = String(t);
  const m = t.match(/(\d+)\s*分钟?/), s = t.match(/(\d+)\s*秒/), h = t.match(/(\d+)\s*小时/);
  return (h ? +h[1] * 3600 : 0) + (m ? +m[1] * 60 : 0) + (s ? +s[1] : 0);
}
function parseDurationMinutes(v) {
  if (v == null || v === '') return null;
  if (Number.isFinite(Number(v))) return Math.max(0, Number(v));
  const s = String(v).trim();
  const iso = s.match(/^P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso && (iso[1] || iso[2] || iso[3] || iso[4])) {
    return Math.round(((Number(iso[1] || 0) * 24 * 60) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0) + (Number(iso[4] || 0) / 60)) * 10) / 10;
  }
  const sec = parseSeconds(s);
  return sec ? Math.round(sec / 6) / 10 : null;
}
const PASSIVE_STEP_RE = /炖|焖|腌|腌制|烤|蒸|煮|静置|发酵|晾|浸泡/;
function stepText(s) {
  return [s?.title, s?.action, s?.params?.time, s?.params?.cue, s?.why?.reason, s?.why?.cue].filter(Boolean).join(' ');
}
function stepDurationInfo(s, fallbackMin = 3) {
  const candidates = [
    s?.duration_min,
    s?.durationMin,
    s?.duration,
    s?.params?.duration,
    s?.params?.time,
    s?.time,
    s?.why?.cue,
    s?.action,
  ];
  for (const v of candidates) {
    const min = parseDurationMinutes(v);
    if (min && min > 0) return { minutes: min, estimated: false };
  }
  return { minutes: fallbackMin, estimated: true };
}
function normalizeTimelineStep(recipe, step, idx, fallbackMin) {
  const dur = stepDurationInfo(step, fallbackMin);
  const text = `${step?.title ? step.title + '：' : ''}${step?.action || ''}`.trim() || `第 ${idx + 1} 步`;
  return {
    recipeTitle: recipe?.title || '未命名',
    stepIndex: Number.isFinite(Number(step?.index)) ? Number(step.index) : idx + 1,
    text,
    durationMin: dur.minutes,
    estimated: dur.estimated,
    passive: PASSIVE_STEP_RE.test(stepText(step)),
  };
}
function mergeCookTimeline(recipes, opts = {}) {
  const fallbackMin = Number.isFinite(Number(opts.fallbackMin)) && Number(opts.fallbackMin) > 0 ? Number(opts.fallbackMin) : 3;
  const states = (Array.isArray(recipes) ? recipes : [])
    .map((recipe, recipeOrder) => ({
      recipeOrder,
      cursor: 0,
      idx: Array.isArray(recipe?.steps) ? recipe.steps.length - 1 : -1,
      steps: (Array.isArray(recipe?.steps) ? recipe.steps : []).map((s, i) => normalizeTimelineStep(recipe, s, i, fallbackMin)),
    }))
    .filter(s => s.idx >= 0);
  const actions = [];
  let handCursor = 0;
  const remainingDuration = (st) => st.steps.slice(0, st.idx + 1).reduce((n, x) => n + x.durationMin, 0);
  const pushAction = (st, step, start) => actions.push({
    offsetMin: start,
    recipeTitle: step.recipeTitle,
    stepIndex: step.stepIndex,
    text: step.text,
    passive: step.passive,
    estimated: step.estimated,
    durationMin: step.durationMin,
    recipeOrder: st.recipeOrder,
  });
  while (states.some(st => st.idx >= 0)) {
    let movedPassive = false;
    for (const st of states.slice().sort((a, b) => b.cursor - a.cursor || a.recipeOrder - b.recipeOrder)) {
      while (st.idx >= 0 && st.steps[st.idx].passive) {
        const step = st.steps[st.idx];
        const start = st.cursor - step.durationMin;
        pushAction(st, step, start);
        st.cursor = start;
        st.idx -= 1;
        movedPassive = true;
      }
    }
    if (movedPassive) continue;
    const candidates = states.filter(st => st.idx >= 0);
    if (!candidates.length) break;
    candidates.sort((a, b) => {
      const ae = Math.min(a.cursor, handCursor), be = Math.min(b.cursor, handCursor);
      if (be !== ae) return be - ae;
      const br = remainingDuration(b), ar = remainingDuration(a);
      return br - ar || a.recipeOrder - b.recipeOrder;
    });
    const st = candidates[0], step = st.steps[st.idx];
    const end = Math.min(st.cursor, handCursor);
    const start = end - step.durationMin;
    pushAction(st, step, start);
    st.cursor = start;
    st.idx -= 1;
    handCursor = start;
  }
  const minStart = actions.reduce((m, a) => Math.min(m, a.offsetMin), 0);
  return actions
    .map(({ recipeOrder, ...a }) => ({ ...a, offsetMin: Math.round((a.offsetMin - minStart) * 10) / 10 }))
    .sort((a, b) => a.offsetMin - b.offsetMin || a.recipeTitle.localeCompare(b.recipeTitle, 'zh-Hans-CN') || a.stepIndex - b.stepIndex);
}
function moveItem(list, from, to) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const a = Number(from), b = Number(to);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a >= arr.length || b < 0 || b >= arr.length || a === b) return arr;
  const [item] = arr.splice(a, 1);
  arr.splice(b, 0, item);
  return arr;
}
function insertItem(list, index, item) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const at = Math.max(0, Math.min(arr.length, Number.isInteger(Number(index)) ? Number(index) : arr.length));
  arr.splice(at, 0, item);
  return arr;
}
function removeItem(list, index) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0 || at >= arr.length) return arr;
  arr.splice(at, 1);
  return arr;
}
function scaleAmount(amt, f) {
  if (!amt || f === 1) return amt;
  const fmt = (v) => String(Math.round(v * 100) / 100); // 最多两位小数
  // 先整体处理分数 a/b（否则 1/2 会被拆成 1 和 2 各自缩放，得到荒谬的 2/4）；再处理独立数字。
  return String(amt).replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)/g,
    (m, fnum, fden, whole) => fden !== undefined ? fmt((+fnum / +fden) * f) : fmt(+whole * f));
}
// 优先用结构化 qty/unit 精确缩放（新菜谱有）；没有就回退到对 amount 文本的数字缩放（旧菜谱兼容）
function scaledAmount(i, f) {
  if (i && Number.isFinite(i.qty)) return (Math.round(i.qty * f * 100) / 100) + (i.unit || '');
  return scaleAmount(i && i.amount, f);
}
function scaledNutritionValue(v, f) {
  return Number.isFinite(v) ? Math.round(v * (f || 1) * 10) / 10 : null;
}
const NUTRITION_FIELDS = [
  ['calories_kcal', '热量', 'kcal'],
  ['protein_g', '蛋白质', 'g'],
  ['fat_g', '脂肪', 'g'],
  ['carbs_g', '碳水', 'g'],
  ['sodium_mg', '钠', 'mg'],
];
function normalizeFactor(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function summarizeMealNutrition(list, factors = 1) {
  const totals = Object.fromEntries(NUTRITION_FIELDS.map(([k]) => [k, 0]));
  let counted = 0, missing = 0;
  for (const r of Array.isArray(list) ? list : []) {
    const p = r && r.nutrition && r.nutrition.per_serving;
    if (!p) { missing++; continue; }
    const factor = typeof factors === 'function' ? normalizeFactor(factors(r)) : normalizeFactor((factors && typeof factors === 'object') ? factors[r.id] : factors);
    counted++;
    for (const [k] of NUTRITION_FIELDS) {
      const n = Number(p[k]);
      if (Number.isFinite(n)) totals[k] += n * factor;
    }
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 10) / 10;
  return { totals, counted, missing, total: (Array.isArray(list) ? list.length : 0) };
}
function nutritionSummaryHtml(summary, { prefix = '', averageBy = 1 } = {}) {
  if (!summary || (!summary.counted && !summary.missing)) return '<div class="plan-nutri muted">暂无营养信息</div>';
  const div = normalizeFactor(averageBy);
  const parts = NUTRITION_FIELDS.map(([k, label, unit]) => {
    const v = Math.round((summary.totals[k] || 0) / div * 10) / 10;
    return `${label} ${v}${unit}`;
  });
  const missing = summary.missing ? ` · ${summary.missing} 道菜未估算` : '';
  return `<div class="plan-nutri">${prefix ? `<b>${esc(prefix)}</b> ` : ''}${parts.join(' · ')}${missing}</div>`;
}
function nutritionHtml(r, factor) {
  const n = r && r.nutrition;
  const p = n && n.per_serving;
  if (!p) return '';
  const item = (k, v, unit) => `<div class="nitem"><span>${k}</span><b>${v == null ? '—' : esc(v) + unit}</b></div>`;
  const f = factor || 1;
  return `<div class="nutrition-card">
    <div class="nutrition-title">每份营养 <span>AI 估算，仅供参考</span></div>
    <div class="nutrition-grid">
      ${item('热量', scaledNutritionValue(p.calories_kcal, f), ' kcal')}
      ${item('蛋白质', scaledNutritionValue(p.protein_g, f), ' g')}
      ${item('脂肪', scaledNutritionValue(p.fat_g, f), ' g')}
      ${item('碳水', scaledNutritionValue(p.carbs_g, f), ' g')}
      ${item('钠', scaledNutritionValue(p.sodium_mg, f), ' mg')}
    </div>
    ${n.disclaimer ? `<div class="nutrition-note">${esc(n.disclaimer)}</div>` : ''}</div>`;
}
function hasRecipeWhy(r) {
  return (r.steps || []).some(s => s.why && (s.why.reason || s.why.if_not || s.why.cue));
}
function baseServings(r) { const m = String(r.servings || '').match(/(\d+)/); return m ? +m[1] : null; }
const DIFF = { easy: '简单', medium: '中等', hard: '有挑战' };
function highlightInfo(text) {
  // 高亮用量/时间/火候/成度等关键信息（在已转义文本上做）
  return text.replace(/(\d+(?:\.\d+)?\s*(?:成热|分钟|秒钟|秒|小时|度|℃|克|毫升|斤|两|片|勺|颗|个|瓣|大卡|kcal)|大火|中大火|中火|中小火|小火|微火|金黄|焦黄|微黄|七成热|冒烟)/g, '<b class="hl">$1</b>');
}
const richText = (t) => highlightInfo(linkifyTerms(t));
/* 解析时截取的步骤/食材图片：走公开图片路由（服务端对图片 GET 豁免 token，<img> 无需带头） */
const recipeImg = (rid, file) => api('/api/recipes/' + encodeURIComponent(rid) + '/images/' + encodeURIComponent(file));
function sourceSegmentUrl(source, sourceTime) {
  if (!/^https?:\/\//.test(source || '') || !Array.isArray(sourceTime) || sourceTime.length < 1) return '';
  const start = Math.floor(Number(sourceTime[0]));
  if (!Number.isFinite(start) || start < 0) return '';
  try {
    const u = new URL(source);
    const host = u.hostname.toLowerCase();
    if (/(^|\.)bilibili\.com$/.test(host)) {
      u.searchParams.set('t', String(start));
      return u.href;
    }
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
      u.searchParams.set('t', start + 's');
      return u.href;
    }
  } catch { }
  return source;
}
// 点图放大；onerror 时图会自行移除（备份导入的菜谱可能没带图片文件）
function showLightbox(src) {
  const ov = el(`<div class="lightbox"><img src="${esc(src)}" alt=""></div>`);
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}
// 给容器里所有带 data-zoom 的图挂点击放大
function wireZoom(root) {
  root.querySelectorAll('img[data-zoom]').forEach(im => im.onclick = (e) => { e.stopPropagation(); showLightbox(im.src); });
}

/* ---------- 全局多计时器（跨步骤/后台闹铃）---------- */
const Timers = {
  list: [], iv: null,
  // 计时是本机状态，用 _storeSet 存 localStorage、不触发跨设备同步。
  save() { _storeSet('timers', this.list); },
  // 启动时恢复：刷新 / PWA 被系统回收 / 自动更新后，计时不再丢失。
  // 已过期的直接标 done（不补响铃，避免回来时突然乱响），仍在跑的重启 interval。
  restore() {
    const saved = store.get('timers', []);
    if (!Array.isArray(saved) || !saved.length) return;
    const now = Date.now();
    this.list = saved.map(t => ({ ...t, done: t.done || now >= t.endAt })).filter(t => !t.done || now - t.endAt < 10 * 60 * 1000);
    this.save(); this.render();
    if (this.list.some(t => !t.done)) this.start();
  },
  ensureHUD() { let h = document.getElementById('timerhud'); if (!h) { h = el('<div id="timerhud"></div>'); document.body.appendChild(h); } return h; },
  add(label, seconds) {
    if (!seconds) return;
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { });
    this.list.push({ id: Date.now() + '' + Math.floor(performance.now()), label, endAt: Date.now() + seconds * 1000, done: false });
    this.save(); this.render(); this.start(); toast('⏱ 已开始计时：' + label);
  },
  start() { if (this.iv) return; this.iv = setInterval(() => this.tick(), 500); },
  tick() {
    const now = Date.now(); let changed = false;
    for (const t of this.list) {
      if (!t.done && now >= t.endAt) { t.done = true; changed = true; this.ring(t); }
    }
    if (changed) this.save(); // 有计时到点才落盘，避免每 500ms 写一次
    this.render();
    // 全部倒计时结束（或清空）后停掉空转的 interval；新加计时会在 add() 里重启
    if ((!this.list.length || this.list.every(t => t.done)) && this.iv) { clearInterval(this.iv); this.iv = null; }
  },
  ring(t) {
    beep(); try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch { }
    speak(t.label + ' 时间到'); toast('⏰ ' + t.label + ' 时间到！');
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('⏰ 庖丁计时', { body: t.label + ' 时间到！', tag: t.id }); } catch { }
  },
  remove(id) { this.list = this.list.filter(x => x.id !== id); this.save(); this.render(); },
  render() {
    const h = this.ensureHUD(); const now = Date.now();
    if (!this.list.length) { h.innerHTML = ''; return; }
    h.innerHTML = this.list.map(t => {
      const left = Math.max(0, Math.round((t.endAt - now) / 1000));
      const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
      return `<div class="tchip ${t.done ? 'ring' : ''}" data-id="${t.id}"><span class="tl">⏱ ${esc(t.label)}</span><span class="tc">${t.done ? '00:00 ✓' : mm + ':' + ss}</span><button class="tx">✕</button></div>`;
    }).join('');
    h.querySelectorAll('.tchip').forEach(c => c.querySelector('.tx').onclick = () => this.remove(c.dataset.id));
  },
};

/* ---------- 语音朗读 & 识别 ---------- */
let ttsVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  // 只认中文音色；挑不到就留 null，让 speak() 靠 lang='zh-CN' 交给引擎自动选，而不是退回 vs[0]（常是英文音色）硬念中文。
  ttsVoice = vs.find(v => /zh|Chinese|Tingting|Ting-Ting/i.test(v.lang + v.name)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text) {
  if (!settings.tts || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (ttsVoice) u.voice = ttsVoice; u.lang = 'zh-CN'; u.rate = settings.ttsRate || 1;
  speechSynthesis.speak(u);
}
function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ================= 首页 ================= */
function splitFilterKeywords(q) {
  return String(q || '').split(/[,，、]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
function recipeIngredientText(r) {
  return (r.ingredients || []).map(i => `${i.name || ''} ${i.amount || ''} ${i.note || ''}`).join(' ').toLowerCase();
}
function recipeTotalTimeMin(r) {
  const direct = parseDurationMinutes(r.total_time_min ?? r.total_time ?? r.totalTime ?? r.duration);
  if (direct != null) return direct;
  let sum = 0, found = false;
  for (const s of (r.steps || [])) {
    const v = parseDurationMinutes(s.duration ?? s.time ?? s.params?.time);
    if (v != null) { sum += v; found = true; }
  }
  return found ? Math.round(sum * 10) / 10 : null;
}
function recipeCreatedMs(r) {
  const ts = Date.parse(r.created_at || r.createdAt || '');
  return Number.isFinite(ts) ? ts : null;
}
function recipeMeta(ctx, id) {
  const m = ctx && ctx.meta && ctx.meta[id];
  return m && typeof m === 'object' ? m : {};
}
function compareNumber(a, b, dir = 'asc') {
  const ak = Number.isFinite(a), bk = Number.isFinite(b);
  if (!ak && !bk) return 0;
  if (!ak) return 1;
  if (!bk) return -1;
  return dir === 'desc' ? b - a : a - b;
}
function compareRecent(a, b) {
  const c = compareNumber(recipeCreatedMs(a), recipeCreatedMs(b), 'desc');
  return c || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
}
function matchRecipeFilter(r, opts = {}, ctx = {}) {
  const tag = opts.tag || '';
  const m = recipeMeta(ctx, r.id);
  const faved = Array.isArray(ctx.favRecipes) && ctx.favRecipes.includes(r.id);
  if (tag === '__fav') { if (!faved) return false; }
  else if (tag === '__cooked') { if (!m.cooked) return false; }
  else if (tag === '__uncooked') { if (m.cooked) return false; }
  else if (tag === '__nutrition') { if (!r.nutrition?.per_serving) return false; }
  else if (tag && !(r.tags || []).includes(tag) && r.difficulty !== tag && r.cuisine !== tag) return false;

  const q = String(opts.q || '').trim().toLowerCase();
  if (q) {
    const hay = `${r.title || ''} ${(r.tags || []).join(' ')} ${recipeIngredientText(r)} ${r.cuisine || ''} ${r.difficulty || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  const ingredientKeys = splitFilterKeywords(opts.ingredients);
  if (ingredientKeys.length) {
    const ingredients = recipeIngredientText(r);
    if (!ingredientKeys.every(k => ingredients.includes(k))) return false;
  }
  return true;
}
function filterAndSortRecipes(list, opts = {}, ctx = {}) {
  const items = (Array.isArray(list) ? list : []).filter(r => matchRecipeFilter(r, opts, ctx));
  const sort = opts.sort || 'recent';
  return items.sort((a, b) => {
    if (sort === 'rating') {
      const c = compareNumber(Number(recipeMeta(ctx, a.id).rating), Number(recipeMeta(ctx, b.id).rating), 'desc');
      return c || compareRecent(a, b);
    }
    if (sort === 'time') {
      const c = compareNumber(recipeTotalTimeMin(a), recipeTotalTimeMin(b), 'asc');
      return c || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
    }
    if (sort === 'name') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN') || compareRecent(a, b);
    return compareRecent(a, b);
  });
}
function renderFilters() {
  const tags = new Set(); recipes.forEach(r => (r.tags || []).forEach(t => tags.add(t)));
  const chips = [['', '全部'], ['__fav', '★ 已收藏'], ['__cooked', '✓ 做过'], ['__uncooked', '未做过'], ['__nutrition', '有营养信息'], ...[...tags].slice(0, 12).map(t => [t, t])];
  $('#filters').innerHTML = chips.map(([v, l]) => `<span class="chip ${filter.tag === v ? 'on' : ''}" data-f="${esc(v)}">${esc(l)}</span>`).join('');
  $('#filters').querySelectorAll('.chip').forEach(c => c.onclick = () => { filter.tag = c.dataset.f; renderFilters(); renderRecipes(); });
}
function renderRecipes() {
  const box = $('#view-recipes');
  const items = filterAndSortRecipes(recipes, filter, { meta, favRecipes });
  box.innerHTML = '';
  renderRecentJobs(box);
  if (!recipes.length) { box.insertAdjacentHTML('beforeend', '<div class="empty">还没有菜谱。<br>粘贴一个做菜视频链接，或上传本地视频开始解析。</div>'); return; }
  if (!items.length) { box.insertAdjacentHTML('beforeend', '<div class="empty">没有匹配的菜谱。</div>'); return; }
  items.forEach(r => {
    const m = rmeta(r.id), faved = favRecipes.includes(r.id);
    const totalMin = recipeTotalTimeMin(r);
    const timeText = totalMin != null ? `<span>⏱ 约${esc(totalMin)}分钟</span>` : (filter.sort === 'time' ? '<span>⏱ 未知</span>' : '');
    // 封面：取最后一个有截图的步骤（通常是接近成品的状态图）
    const cover = (r.steps || []).slice().reverse().find(s => s.image);
    const card = el(`<div class="rcard">
      ${cover ? `<img class="rcover" src="${esc(recipeImg(r.id, cover.image))}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div style="flex:1;min-width:0">
        <h3>${esc(r.title || '未命名')}</h3>
        <div class="meta">
          ${r.difficulty ? `<span class="tag diff-${esc(r.difficulty)}">${esc(DIFF[r.difficulty] || r.difficulty)}</span>` : ''}
          ${timeText}
          <span>📋 ${(r.steps || []).length}步</span>
          ${m.cooked ? `<span class="cooked">✓ 做过</span>` : ''}
          ${m.rating ? `<span class="cooked">${'★'.repeat(m.rating)}</span>` : ''}
        </div>
        ${(r.tags || []).length ? `<div class="tags">${r.tags.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      <button class="star ${faved ? 'on' : ''}">${faved ? '★' : '☆'}</button></div>`);
    card.querySelector('div').onclick = () => openDetail(r);
    const cv = card.querySelector('.rcover'); if (cv) cv.onclick = () => openDetail(r);
    card.querySelector('.star').onclick = (e) => { e.stopPropagation(); toggleRecipe(r.id); renderRecipes(); renderFilters(); };
    box.appendChild(card);
  });
}
function toggleRecipe(id) { favRecipes = favRecipes.includes(id) ? favRecipes.filter(x => x !== id) : [...favRecipes, id]; store.set('favRecipes', favRecipes); }
function renderRecentJobs(box) {
  const list = (recentJobs || []).filter(Boolean).slice(0, 5);
  if (!list.length) return;
  const label = (j) => {
    const map = { queued: '排队中', running: '解析中', done: '已完成', error: '失败', interrupted: '已中断' };
    return map[j.status] || j.status || '未知';
  };
  const type = (j) => ({ url: '链接', text: '文字', file: '文件', images: '图片' }[j.type] || '任务');
  const title = (j) => j.params?.filename || j.params?.url || (j.params?.input ? '粘贴文字' : type(j));
  const rows = list.map(j => `<div class="job-row ${esc(j.status || '')}">
    <div><b>${esc(type(j))}</b><span>${esc(title(j))}</span></div>
    <em>${esc(j.progress?.message || j.error || label(j))}</em>
  </div>`).join('');
  box.insertAdjacentHTML('beforeend', `<div class="jobs-lite"><div class="jobs-hd">最近任务</div>${rows}</div>`);
}

/* ================= 技法库 ================= */
function whyExcerpt(w) {
  return [w?.reason, w?.if_not, w?.cue].filter(Boolean).join(' ');
}
function renderTechniques() {
  const box = $('#view-techniques');
  if (!techniques.length) { box.innerHTML = '<div class="empty">还没有识别到技法。<br>解析或导入更多带步骤的菜谱后，这里会自动聚合。</div>'; return; }
  box.innerHTML = techniques.map(t => {
    const samples = (t.occurrences || []).slice(0, 3).map(o => o.recipeTitle).filter(Boolean).join('、');
    return `<div class="tech-card" data-tech="${esc(t.technique)}">
      <div><h3>${esc(t.technique)}</h3><div class="meta">${esc(samples)}${(t.occurrences || []).length > 3 ? '…' : ''}</div></div>
      <span>${t.count} 次</span>
    </div>`;
  }).join('');
  box.querySelectorAll('.tech-card').forEach(card => {
    const t = techniques.find(x => x.technique === card.dataset.tech);
    if (t) card.onclick = () => openTechnique(t);
  });
}
function openRecipeAtStep(recipeId, stepIndex) {
  const r = recipes.find(x => x.id === recipeId);
  if (!r) { toast('菜谱不存在或尚未加载'); return; }
  openDetail(r, stepIndex);
}
function openTechnique(t) {
  const p = el(`<div class="page">
    <div class="topbar"><button class="back">‹ 返回</button></div>
    <div class="detail-hd"><h2>${esc(t.technique)}</h2><div class="meta">${t.count} 次出现</div></div>
    <div style="padding:4px 16px 80px">
      <div class="tech-ai">
        <button class="btn ghost" data-tech-summary>AI 归纳要点</button>
        <div class="tech-summary-result hidden"></div>
      </div>
      ${(t.occurrences || []).map(o => {
        const why = whyExcerpt(o.why);
        return `<div class="tech-occ">
          <div class="src">${esc(o.recipeTitle)} · 第${esc(o.stepIndex)}步</div>
          <h4>${esc(o.stepTitle || '未命名步骤')}</h4>
          ${o.action ? `<div class="a">${esc(o.action)}</div>` : ''}
          ${why ? `<p><span class="lbl">为什么</span> ${esc(why)}</p>` : '<p>这一步还没有原理讲解。</p>'}
          <button class="btn ghost sm" data-rid="${esc(o.recipeId)}" data-step="${esc(o.stepIndex)}">跳到步骤</button>
        </div>`;
      }).join('')}
    </div></div>`);
  p.querySelector('.back').onclick = () => p.remove();
  const summaryBtn = p.querySelector('[data-tech-summary]');
  const summaryBox = p.querySelector('.tech-summary-result');
  summaryBtn.onclick = async () => {
    const oldText = summaryBtn.textContent;
    summaryBtn.disabled = true;
    summaryBtn.textContent = '归纳中…';
    summaryBox.classList.remove('hidden');
    summaryBox.innerHTML = '<div class="muted">归纳中…</div>';
    try {
      const data = await API.techniqueSummary(t.technique);
      const s = data.summary || {};
      summaryBox.innerHTML = `
        <div><b>什么时候用</b><p>${esc(s.when || '')}</p></div>
        <div><b>关键判断</b><p>${esc(s.keys || '')}</p></div>
        <div><b>常见翻车点</b><p>${esc(s.pitfalls || '')}</p></div>
        <div class="meta">AI 归纳，仅供参考 · ${data.cached ? '已读取缓存' : '已生成归纳'}</div>`;
    } catch (e) {
      summaryBox.classList.add('hidden');
      toast('技法归纳失败：' + e.message);
    } finally {
      summaryBtn.disabled = false;
      summaryBtn.textContent = oldText;
    }
  };
  p.querySelectorAll('[data-rid]').forEach(b => b.onclick = () => openRecipeAtStep(b.dataset.rid, Number(b.dataset.step)));
  $('#app').appendChild(p);
}

/* ================= 技巧收藏 ================= */
function renderSkills() {
  const box = $('#view-skills');
  if (!favSteps.length) { box.innerHTML = '<div class="empty">技巧收藏夹是空的。<br>在跟做模式里点某一步的 ⭐️，把技巧和它的原理收藏到这里。</div>'; return; }
  box.innerHTML = '';
  favSteps.slice().reverse().forEach(s => {
    const w = s.why || {};
    const c = el(`<div class="skill">
      <div class="src">${esc(s.recipeTitle)} · 第${s.index}步</div>
      <h4><span>${esc(s.title || '')}</span><button class="star on">★</button></h4>
      <div style="font-size:14px;color:var(--muted);line-height:1.55">${esc(s.action || '')}</div>
      ${w.reason ? `<p><span class="lbl">为什么</span> ${esc(w.reason)}</p>` : ''}
      ${w.if_not ? `<p><span class="lbl">不这么做</span> ${esc(w.if_not)}</p>` : ''}</div>`);
    c.querySelector('.star').onclick = () => { favSteps = favSteps.filter(x => x.key !== s.key); store.set('favSteps', favSteps); renderSkills(); updateBadges(); toast('已移出收藏'); };
    box.appendChild(c);
  });
}

/* ================= 购物清单（按货架分区 + 同名合并）================= */
const SHOP_SECTION_ORDER = ['蔬菜水果', '肉禽蛋', '水产', '调味干货', '粮油米面', '乳品豆制品', '冷冻', '其他'];
const SHOP_SECTION_KEYWORDS = {
  蔬菜水果: ['青菜', '白菜', '菠菜', '生菜', '芹菜', '香菜', '韭菜', '葱', '姜', '蒜', '辣椒', '青椒', '尖椒', '番茄', '西红柿', '土豆', '马铃薯', '萝卜', '胡萝卜', '洋葱', '黄瓜', '冬瓜', '南瓜', '丝瓜', '苦瓜', '茄子', '蘑菇', '香菇', '金针菇', '木耳', '笋', '藕', '玉米', '山药', '豆芽', '豆角', '豇豆', '秋葵', '苹果', '香蕉', '柠檬', '橙', '梨', '水果'],
  肉禽蛋: ['猪肉', '牛肉', '羊肉', '鸡肉', '鸡翅', '鸡腿', '鸡胸', '鸭', '鹅', '排骨', '五花', '里脊', '牛腩', '培根', '香肠', '腊肠', '火腿', '午餐肉', '肉末', '肉馅', '鸡蛋', '鸭蛋', '鹌鹑蛋', '蛋'],
  水产: ['鱼', '虾', '蟹', '贝', '蛤', '蛏', '鱿鱼', '海鲜', '水产', '三文鱼', '鳕鱼', '鲈鱼', '带鱼', '黄鱼', '鲫鱼', '鲤鱼'],
  调味干货: ['盐', '糖', '白糖', '冰糖', '酱油', '生抽', '老抽', '蚝油', '耗油', '醋', '料酒', '味精', '鸡精', '胡椒', '八角', '桂皮', '花椒', '孜然', '五香', '十三香', '13香', '芝麻', '蜂蜜', '淀粉', '生粉', '豆瓣', '豆豉', '番茄酱', '香油', '辣椒油', '干辣椒', '辣椒面', '香叶', '陈皮', '调料', '香料', '酱'],
  粮油米面: ['大米', '米饭', '糯米', '小米', '面粉', '面条', '挂面', '意面', '米线', '河粉', '粉丝', '粉条', '年糕', '馒头', '花卷', '饼', '包子', '饺子', '馄饨', '面包糠', '食用油', '花生油', '菜籽油', '玉米油', '橄榄油'],
  乳品豆制品: ['牛奶', '奶油', '黄油', '芝士', '奶酪', '酸奶', '炼乳', '豆腐', '腐竹', '豆皮', '千张', '豆干', '香干', '素鸡', '豆浆'],
  冷冻: ['冷冻', '速冻', '冻', '冰鲜', '丸子', '汤圆'],
};
function shopCat(name) {
  const n = String(name || '');
  if (SHOP_SECTION_KEYWORDS.冷冻.some(k => n.includes(k))) return '冷冻';
  for (const section of SHOP_SECTION_ORDER) {
    if (section === '冷冻' || section === '其他') continue;
    if ((SHOP_SECTION_KEYWORDS[section] || []).some(k => n.includes(k))) return section;
  }
  return '其他';
}
// 合并同名食材的多个用量：能识别「数字+单位」的按单位求和，其余原样并列
function mergeAmounts(amts) {
  const byUnit = {}, others = [];
  for (const a of amts.filter(Boolean)) {
    const m = String(a).match(/^\s*(\d+(?:\.\d+)?)\s*(.*)$/);
    if (m) { const u = m[2].trim(); byUnit[u] = (byUnit[u] || 0) + parseFloat(m[1]); }
    else if (!others.includes(a)) others.push(a);
  }
  const parts = Object.entries(byUnit).map(([u, v]) => (Math.round(v * 100) / 100) + u);
  return [...parts, ...others].join(' + ');
}
function groupShoppingItems(list) {
  const groups = {};
  (Array.isArray(list) ? list : []).forEach((it, i) => {
    if (!it || !it.name) return;
    const g = groups[it.name] = groups[it.name] || { name: it.name, section: shopCat(it.name), amounts: [], froms: new Set(), idxs: [] };
    if (it.amount) g.amounts.push(it.amount);
    if (it.from) g.froms.add(it.from);
    g.idxs.push(i);
  });
  const bySection = {};
  Object.values(groups).forEach(g => {
    const item = {
      name: g.name, section: g.section, idxs: g.idxs,
      amount: mergeAmounts(g.amounts), src: [...g.froms].join('、'),
      checked: g.idxs.every(i => list[i].checked),
    };
    (bySection[g.section] = bySection[g.section] || []).push(item);
  });
  return SHOP_SECTION_ORDER.map(section => ({
    section,
    items: (bySection[section] || []).sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'zh-CN')),
  })).filter(g => g.items.length);
}
function shoppingTextBySection(list = shopping) {
  return groupShoppingItems(list).map(g => `【${g.section}】\n` + g.items.map(it => `${it.checked ? '✓ ' : ''}${it.name}${it.amount ? ' ' + it.amount : ''}`).join('\n')).join('\n\n');
}
function shopManualAdd() {
  const inp = $('#shopAdd'); if (!inp) return;
  const v = inp.value.trim(); if (!v) return;
  shopping.push({ name: v, amount: '', from: '手动添加', checked: false });
  store.set('shopping', shopping); updateBadges(); renderShopping();
}
function renderShopping() {
  const box = $('#view-shopping');
  const head = `<div class="searchrow" style="padding:4px 0 8px;gap:8px"><input type="text" id="shopAdd" placeholder="手动加一项，如 酱油" style="flex:1;min-width:0"><button class="btn sm" id="shopAddBtn">加入</button></div>
    <div class="searchrow" style="padding:0 0 12px"><button class="btn ghost sm" id="shopCopy">复制文本</button><button class="btn ghost sm" id="shopClear">清除已勾选</button><button class="btn ghost sm" id="shopAll">清空</button></div>`;
  const wireAdd = () => {
    $('#shopAddBtn') && ($('#shopAddBtn').onclick = shopManualAdd);
    $('#shopAdd') && ($('#shopAdd').onkeydown = (e) => { if (e.key === 'Enter') shopManualAdd(); });
    $('#shopCopy') && ($('#shopCopy').onclick = async () => {
      const text = shoppingTextBySection();
      try { if (!navigator.clipboard?.writeText) throw new Error('clipboard'); await navigator.clipboard.writeText(text); toast('已复制购物清单'); }
      catch { toast('复制失败'); }
    });
  };
  if (!shopping.length) { box.innerHTML = head + '<div class="empty">购物清单是空的。<br>在菜谱详情里点「加入购物清单」，或上面手动加一项。</div>'; wireAdd(); return; }
  let html = head;
  for (const group of groupShoppingItems(shopping)) {
    html += `<div class="sec-title" style="margin:14px 0 6px 0;padding:0">${esc(group.section)}</div>`;
    html += group.items.map(m => `
      <div class="shop-item ${m.checked ? 'checked' : ''}" data-idxs="${m.idxs.join(',')}">
        <div class="ck ${m.checked ? 'on' : ''}">${m.checked ? '✓' : ''}</div>
        <div class="txt">${esc(m.name)}${m.amount ? ` · <span style="color:var(--muted)">${esc(m.amount)}</span>` : ''}<div class="sub">${esc(m.src)}${m.idxs.length > 1 ? ` · 合并自${m.idxs.length}处` : ''}</div></div>
      </div>`).join('');
  }
  box.innerHTML = html;
  wireAdd();
  box.querySelectorAll('.shop-item').forEach(node => node.onclick = () => {
    const idxs = node.dataset.idxs.split(',').map(Number);
    const target = !idxs.every(i => shopping[i].checked); // 未全勾→全勾；已全勾→全取消
    idxs.forEach(i => shopping[i].checked = target);
    store.set('shopping', shopping); renderShopping();
  });
  $('#shopClear') && ($('#shopClear').onclick = () => { shopping = shopping.filter(x => !x.checked); store.set('shopping', shopping); renderShopping(); updateBadges(); });
  $('#shopAll') && ($('#shopAll').onclick = async () => { if (!(await confirmModal('清空整个购物清单？', '清空'))) return; shopping = []; store.set('shopping', shopping); renderShopping(); updateBadges(); });
}
function addToShoppingItems(r, factor) {
  const names = new Set(shopping.map(x => x.name + '|' + x.from));
  (r.ingredients || []).forEach(i => {
    const key = i.name + '|' + r.title;
    if (!names.has(key)) shopping.push({ name: i.name, amount: scaledAmount(i, factor || 1), from: r.title, checked: false });
  });
}
function addToShopping(r, factor) { addToShoppingItems(r, factor); store.set('shopping', shopping); updateBadges(); toast('已加入购物清单'); }

/* ================= 本周计划（膳食计划）================= */
function weekDays() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(now); dt.setDate(now.getDate() + i);
    days.push({ key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`, label: i === 0 ? '今天' : i === 1 ? '明天' : wd[dt.getDay()], date: `${dt.getMonth() + 1}/${dt.getDate()}` });
  }
  return days;
}
function renderPlan() {
  const box = $('#view-plan');
  const days = weekDays();
  const byId = Object.fromEntries(recipes.map(r => [r.id, r]));
  const factorFor = (r) => rmeta(r.id).servingsFactor || 1;
  const planned = days.reduce((n, d) => n + (mealPlan[d.key] || []).length, 0);
  const weeklySummary = summarizeMealNutrition(days.flatMap(d => (mealPlan[d.key] || []).map(id => byId[id]).filter(Boolean)), factorFor);
  let html = `<div class="searchrow" style="padding:4px 0 10px;gap:8px">
    <button class="btn sm" id="planToShop" ${planned ? '' : 'disabled'}>🛒 这周的菜加入购物清单</button>
    ${planned ? `<button class="btn ghost sm" id="planClear">清空计划</button>` : ''}</div>
    <div class="plan-week">${nutritionSummaryHtml(weeklySummary, { prefix: '本周日均', averageBy: 7 })}</div>`;
  html += days.map(day => {
    const items = (mealPlan[day.key] || []).map(id => byId[id]).filter(Boolean);
    const summary = summarizeMealNutrition(items, factorFor);
    const timelineBtn = items.length >= 2 ? `<button class="act plantimeline" data-key="${day.key}">同做时间线</button>` : '';
    return `<div class="planday">
      <div class="planhd"><b>${day.label}</b> <span style="color:var(--muted);font-size:13px">${day.date}</span> ${timelineBtn}<button class="act planadd" data-key="${day.key}">＋ 加菜</button></div>
      ${items.length ? items.map(r => `<div class="planitem" data-key="${day.key}" data-id="${esc(r.id)}"><span class="pmore">${esc(r.title)}</span><button class="prm" title="移除">✕</button></div>`).join('') : '<div style="color:var(--muted);font-size:13px;padding:6px 0 2px">还没排菜</div>'}
      ${items.length ? nutritionSummaryHtml(summary, { prefix: '当日合计' }) : ''}
    </div>`;
  }).join('');
  box.innerHTML = html;
  box.querySelectorAll('.planadd').forEach(b => b.onclick = () => pickRecipeForDay(b.dataset.key));
  box.querySelectorAll('.plantimeline').forEach(b => b.onclick = () => {
    const items = (mealPlan[b.dataset.key] || []).map(id => byId[id]).filter(Boolean);
    showCookTimeline(b.dataset.key, items);
  });
  box.querySelectorAll('.planitem').forEach(it => {
    it.querySelector('.pmore').onclick = () => { const r = byId[it.dataset.id]; if (r) openDetail(r); };
    it.querySelector('.prm').onclick = () => { mealPlan[it.dataset.key] = (mealPlan[it.dataset.key] || []).filter(x => x !== it.dataset.id); saveMealPlan(); renderPlan(); };
  });
  $('#planToShop') && ($('#planToShop').onclick = () => {
    const ids = new Set(); days.forEach(d => (mealPlan[d.key] || []).forEach(id => ids.add(id)));
    let n = 0; ids.forEach(id => { const r = byId[id]; if (r) { addToShoppingItems(r, 1); n++; } });
    if (n) { store.set('shopping', shopping); updateBadges(); toast(`已把 ${n} 道菜的食材加入购物清单`); } else toast('这周还没排菜');
  });
  $('#planClear') && ($('#planClear').onclick = async () => { if (!(await confirmModal('清空本周计划？', '清空'))) return; days.forEach(d => delete mealPlan[d.key]); saveMealPlan(); renderPlan(); });
}
function timelineOffsetText(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}
function showCookTimeline(key, dayRecipes) {
  const day = weekDays().find(d => d.key === key);
  const selected = new Set((dayRecipes || []).map(r => r.id));
  const ov = openModal(`<h3 style="text-align:left">${esc(day?.label || '')}同做时间线</h3>
    <div id="tlPick" class="tl-pick"></div>
    <div id="tlList" class="timeline-list"></div>
    <div class="mrow"><button class="btn" id="tlClose">关闭</button></div>`, 'left');
  const draw = () => {
    const chosen = (dayRecipes || []).filter(r => selected.has(r.id));
    ov.querySelector('#tlPick').innerHTML = (dayRecipes || []).map(r => `<label class="tl-check"><input type="checkbox" data-id="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''}> ${esc(r.title || '')}</label>`).join('');
    const actions = mergeCookTimeline(chosen);
    ov.querySelector('#tlList').innerHTML = actions.length ? actions.map(a => `
      <div class="tlitem ${a.passive ? 'passive' : ''}">
        <div><b>第 ${timelineOffsetText(a.offsetMin)} 分钟</b><span>${a.passive ? '⏳ ' : ''}${esc(a.recipeTitle)} · 第 ${esc(a.stepIndex)} 步</span></div>
        <p>${esc(a.text)}${a.estimated ? '<em>约 3 分钟</em>' : ''}</p>
      </div>`).join('') : '<div class="empty" style="padding:20px 8px">至少选择一道菜</div>';
    ov.querySelectorAll('#tlPick input').forEach(input => {
      input.onchange = () => { input.checked ? selected.add(input.dataset.id) : selected.delete(input.dataset.id); draw(); };
    });
  };
  draw();
  ov.querySelector('#tlClose').onclick = () => ov.remove();
}
function pickRecipeForDay(key) {
  if (!recipes.length) { toast('还没有菜谱，先解析一道'); return; }
  const day = weekDays().find(d => d.key === key);
  const ov = openModal(`<h3 style="text-align:left">排到「${day ? day.label : ''}」</h3>
    <input type="text" id="pickSearch" placeholder="搜菜名" style="margin:8px 0 0">
    <div id="pickList" style="max-height:46vh;overflow:auto;margin-top:8px"></div>
    <div class="mrow"><button class="btn" id="pkClose">关闭</button></div>`, 'left');
  const draw = (q) => {
    ov.querySelector('#pickList').innerHTML = recipes.filter(r => !q || (r.title || '').includes(q)).map(r =>
      `<div class="pickrow" data-id="${esc(r.id)}" style="padding:11px 6px;border-bottom:1px solid var(--line);cursor:pointer">${esc(r.title)}</div>`).join('') || '<div style="color:var(--muted);padding:10px 6px">没有匹配的菜</div>';
    ov.querySelectorAll('.pickrow').forEach(row => row.onclick = () => {
      mealPlan[key] = mealPlan[key] || []; if (!mealPlan[key].includes(row.dataset.id)) mealPlan[key].push(row.dataset.id);
      saveMealPlan(); ov.remove(); renderPlan(); toast('已排入');
    });
  };
  draw('');
  ov.querySelector('#pickSearch').oninput = (e) => draw(e.target.value.trim());
  ov.querySelector('#pkClose').onclick = () => ov.remove();
}

/* ================= 设置 ================= */
function renderSettings() {
  const box = $('#view-settings');
  const sw = (on) => `<div class="switch ${on ? 'on' : ''}"></div>`;
  box.innerHTML = `
    <div class="setrow"><div><div class="lbl">暗色模式</div><div class="desc">厨房夜间/护眼</div></div>${sw(settings.theme === 'dark')}<span class="hidden" data-k="theme"></span></div>
    <div class="setrow"><div><div class="lbl">朗读步骤（TTS）</div><div class="desc">跟做时可语音念出当前步骤</div></div>${sw(settings.tts)}<span class="hidden" data-k="tts"></span></div>
    <div class="setrow"><div style="flex:1"><div class="lbl">字号</div><div class="desc">当前 ${Math.round(settings.fontScale * 100)}%</div></div>
      <button class="iconbtn" data-fs="-">A－</button><button class="iconbtn" data-fs="+">A＋</button></div>
    <div class="setrow"><div style="flex:1"><div class="lbl">朗读语速</div><div class="desc">${settings.ttsRate.toFixed(1)}×</div></div>
      <button class="iconbtn" data-tr="-">－</button><button class="iconbtn" data-tr="+">＋</button></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">默认讲解深度</div></div>
      <div class="depth" id="setDepth" style="margin-top:8px">
        <span class="chip ${settings.depth === 'beginner' ? 'on' : ''}" data-d="beginner">新手向</span>
        <span class="chip ${settings.depth === 'balanced' ? 'on' : ''}" data-d="balanced">通俗</span>
        <span class="chip ${settings.depth === 'advanced' ? 'on' : ''}" data-d="advanced">进阶原理</span></div></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">后端地址</div><div class="desc">手机端填电脑的「局域网地址」（启动服务器时会打印）；本机留空即可</div></div>
      <input type="text" id="apiBase" placeholder="如 http://192.168.1.5:4177" value="${esc(settings.apiBase)}" style="margin-top:8px"></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">API Token</div><div class="desc">后端设了 PAODING_API_TOKEN 才需填（公网/隧道暴露时建议开启）；本机局域网可留空</div></div>
      <input type="password" id="apiToken" placeholder="与服务端 PAODING_API_TOKEN 一致" value="${esc(settings.apiToken)}" style="margin-top:8px"></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">数据备份</div><div class="desc">把全部菜谱与收藏导出成一个文件；换设备或搬后端时可导入恢复</div></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost sm" id="btnExport">⬇ 导出备份</button>
        <button class="btn ghost sm" id="btnImport">⬆ 导入恢复</button>
        <input type="file" id="importFile" accept="application/json,.json" class="hidden"></div></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">导入外部菜谱</div><div class="desc">支持单个 schema.org Recipe JSON-LD；Cooklang 导入暂未支持</div></div>
      <textarea id="recipeImportText" placeholder="粘贴 JSON-LD" style="margin-top:8px;min-height:96px"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost sm" id="btnImportRecipeText">导入菜谱</button>
        <button class="btn ghost sm" id="btnImportRecipeFile">选择 JSON</button>
        <input type="file" id="recipeImportFile" accept="application/json,.json" class="hidden"></div></div>
    <div style="text-align:center;color:var(--muted);font-size:12px;margin-top:14px">庖丁 · 解剖每一道菜的为什么</div>`;

  box.querySelectorAll('[data-k]').forEach(x => { x.previousElementSibling.onclick = () => { const k = x.dataset.k; settings[k] = k === 'theme' ? (settings.theme === 'dark' ? 'light' : 'dark') : !settings[k]; saveSettings(); applyTheme(); renderSettings(); }; });
  box.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { settings.fontScale = Math.min(1.5, Math.max(0.85, settings.fontScale + (b.dataset.fs === '+' ? 0.1 : -0.1))); saveSettings(); applyTheme(); renderSettings(); });
  box.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { settings.ttsRate = Math.min(1.6, Math.max(0.6, settings.ttsRate + (b.dataset.tr === '+' ? 0.1 : -0.1))); saveSettings(); renderSettings(); });
  $('#setDepth').querySelectorAll('.chip').forEach(c => c.onclick = () => { settings.depth = c.dataset.d; depth = c.dataset.d; saveSettings(); renderSettings(); syncDepthChips(); });
  $('#apiBase').onchange = (e) => { settings.apiBase = e.target.value.trim().replace(/\/$/, ''); saveSettings(); toast('已保存后端地址'); refresh(); };
  $('#apiToken').onchange = (e) => { settings.apiToken = e.target.value.trim(); saveSettings(); toast('已保存 API Token'); refresh(); };
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = (e) => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; };
  $('#btnImportRecipeText').onclick = () => importRecipeJsonLd($('#recipeImportText').value);
  $('#btnImportRecipeFile').onclick = () => $('#recipeImportFile').click();
  $('#recipeImportFile').onchange = (e) => { const f = e.target.files[0]; if (f) importRecipeJsonFile(f); e.target.value = ''; };
}
function applyTheme() { document.documentElement.setAttribute('data-theme', settings.theme); document.documentElement.style.setProperty('--fs', (16 * settings.fontScale) + 'px'); }
function needsBackendSetup() {
  if (settings.apiBase) return false;
  return location.protocol === 'capacitor:' || location.origin === 'https://localhost';
}
function showBackendSetupIfNeeded() {
  if (!needsBackendSetup()) return false;
  const ov = openModal(`<h3 style="text-align:left">连接后端</h3>
    <p style="color:var(--muted);text-align:left;margin-bottom:12px">填写自己的庖丁服务地址和 API Token。</p>
    <input type="text" id="setupApiBase" inputmode="url" placeholder="如 http://192.168.1.5:4177" style="margin-bottom:8px">
    <input type="password" id="setupApiToken" placeholder="PAODING_API_TOKEN">
    <div class="mrow"><button class="btn ghost" id="setupLater">稍后</button><button class="btn" id="setupSave">连接</button></div>`, 'left');
  ov.querySelector('#setupLater').onclick = () => ov.remove();
  ov.querySelector('#setupSave').onclick = () => {
    const base = ov.querySelector('#setupApiBase').value.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(base)) { toast('请输入 http(s) 后端地址'); return; }
    settings.apiBase = base;
    settings.apiToken = ov.querySelector('#setupApiToken').value.trim();
    saveSettings();
    ov.remove();
    toast('已保存后端地址');
    loadUserData().finally(refresh);
  };
  setTimeout(() => ov.querySelector('#setupApiBase').focus(), 30);
  return true;
}

/* ================= 详情页 ================= */
function parseTagsText(text) {
  return String(text || '').split(/[,，、\s]+/).map(t => t.trim()).filter(Boolean);
}
async function editRecipeTags(r, onSaved) {
  const ov = openModal(`<h3 style="text-align:left">编辑标签</h3>
    <input type="text" id="tagEditInput" placeholder="家常, 快手, 下饭" value="${esc((r.tags || []).join('、'))}">
    <div id="tagEditPreview" class="tags" style="margin-top:10px"></div>
    <div class="mrow"><button class="btn ghost" id="tagCancel">取消</button><button class="btn" id="tagSave">保存</button></div>`, 'left');
  const draw = () => {
    const tags = parseTagsText(ov.querySelector('#tagEditInput').value);
    ov.querySelector('#tagEditPreview').innerHTML = tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') || '<span style="color:var(--muted);font-size:13px">无标签</span>';
  };
  ov.querySelector('#tagEditInput').oninput = draw;
  draw();
  ov.querySelector('#tagCancel').onclick = () => ov.remove();
  ov.querySelector('#tagSave').onclick = async () => {
    const tags = parseTagsText(ov.querySelector('#tagEditInput').value);
    try {
      const res = await F('/api/recipes/' + encodeURIComponent(r.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
      ov.remove();
      onSaved && onSaved(tags);
      toast('标签已保存');
    } catch (e) { toast('保存失败：' + e.message); }
  };
}
function openDetail(r, focusStepIndex = null) {
  const m = rmeta(r.id);
  const base = baseServings(r);
  let factor = m.servingsFactor || 1;
  const importedNeedsWhy = !!r.imported && !hasRecipeWhy(r);
  const p = el(`<div class="page">
    <div class="topbar">
      <button class="back">‹ 返回</button>
      <div style="display:flex;gap:4px">
        <button class="iconbtn" id="dEdit" title="编辑">✏️</button>
        <button class="iconbtn" id="dShare" title="分享">↗</button>
        <button class="iconbtn" id="dDel" title="删除">🗑</button>
        <button class="star ${favRecipes.includes(r.id) ? 'on' : ''}" id="dfav">${favRecipes.includes(r.id) ? '★' : '☆'}</button>
      </div>
    </div>
    <div class="detail-hd"><h2>${esc(r.title || '未命名')}</h2>
      <div class="meta">
        ${r.difficulty ? `<span class="tag diff-${esc(r.difficulty)}">${esc(DIFF[r.difficulty] || r.difficulty)}</span>` : ''}
        ${r.cuisine ? `<span>${esc(r.cuisine)}</span>` : ''}
        ${r.total_time_min ? `<span>⏱ 约${esc(r.total_time_min)}分钟</span>` : ''}
        <span>📋 ${(r.steps || []).length}步</span>
        ${/^https?:\/\//.test(r.source || '') ? `<a class="src-link" href="${esc(r.source)}" target="_blank" rel="noopener">▶ 看原视频</a>` : ''}</div>
      ${(r.tags || []).length ? `<div class="tags" style="margin-top:8px">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    ${base ? `<div class="scaler"><span>份量</span><button class="st" data-s="-">－</button><b id="svVal">${base * factor}</b><button class="st" data-s="+">＋</button><span>人份</span></div>` : ''}
    <div style="display:flex;gap:8px;padding:8px 16px 0;flex-wrap:wrap">
      <button class="btn ghost sm" id="btnOverview">💡 为什么这样设计</button>
      <button class="btn ghost sm" id="btnNutri">🥗 营养估算</button>
      <button class="btn ghost sm" id="btnTags">🏷 标签</button>
      <button class="btn ghost sm" id="btnExport2">⬇ 导出</button>
    </div>
    ${r.imported ? `<div class="import-note"><span>${importedNeedsWhy ? '外部导入，无原理讲解' : '外部导入，原理讲解已补齐'}</span>${importedNeedsWhy ? '<button class="btn ghost sm" id="btnImportExplain">AI 补讲解</button>' : ''}</div>` : ''}
    <div id="aiBox" style="margin:8px 16px 0"></div>
    <div id="nutritionBox"></div>
    <div class="sec-title">食材 <span class="act" id="addShop">＋ 加入购物清单</span></div>
    <div class="ing" id="ingBox"></div>
    <div class="sec-title">步骤总览</div>
    <div id="steps"></div>
    <div class="sec-title">我的笔记</div>
    <div class="notes"><textarea id="notes" placeholder="记点心得，比如「盐减半更合口」…">${esc(m.notes || '')}</textarea></div>
    <div class="sec-title">做过 & 评分</div>
    <div style="display:flex;align-items:center;gap:14px;margin:0 16px 4px">
      <button class="btn ${m.cooked ? '' : 'ghost'} sm" id="cookedBtn">${m.cooked ? '✓ 已做过' : '标记做过'}</button>
      <div class="rating" id="rating">${[1, 2, 3, 4, 5].map(n => `<span class="rs ${m.rating >= n ? 'on' : ''}" data-r="${n}">★</span>`).join('')}</div>
    </div>
    <div class="cta"><button class="btn ghost" id="btnBack2">返回</button><button class="btn" id="btnCook">▶ 开始跟做</button></div>`);

  function renderIng() {
    const checked = new Set(m.ingChecked || []);
    p.querySelector('#ingBox').innerHTML = (r.ingredients || []).map((i, idx) => `
      <div class="irow ${checked.has(idx) ? 'checked' : ''}" data-i="${idx}">
        <div class="ck ${checked.has(idx) ? 'on' : ''}">${checked.has(idx) ? '✓' : ''}</div>
        ${i.image ? `<img class="ingthumb" data-zoom src="${esc(recipeImg(r.id, i.image))}" alt="${esc(i.name)}" loading="lazy" onerror="this.remove()">` : ''}
        <span class="name">${esc(i.name)}${i.note ? `<span class="amt">（${esc(i.note)}）</span>` : ''}</span>
        <span class="amt">${esc(scaledAmount(i, factor) || '视频未明确')}</span>
        <button class="btn ghost sm" data-sub="${esc(i.name)}">替代</button>
      </div>`).join('') || '<div class="irow"><span class="name">视频未列出食材</span></div>';
    p.querySelectorAll('#ingBox .irow').forEach(row => {
      row.onclick = (e) => {
        if (e.target.dataset.sub !== undefined) return;
        const idx = +row.dataset.i; const set = new Set(m.ingChecked || []);
        set.has(idx) ? set.delete(idx) : set.add(idx); m.ingChecked = [...set]; saveMeta(); renderIng();
      };
    });
    p.querySelectorAll('[data-sub]').forEach(b => b.onclick = async (e) => { e.stopPropagation(); await showSubstitute(r, b.dataset.sub); });
    wireZoom(p.querySelector('#ingBox'));
  }
  renderIng();

  const stepsBox = p.querySelector('#steps');
  (r.steps || []).forEach(s => {
    const segUrl = sourceSegmentUrl(r.source, s.source_time);
    stepsBox.appendChild(el(`<div class="stepmini" data-step-index="${esc(s.index)}">
      ${s.image ? `<img class="mthumb" data-zoom src="${esc(recipeImg(r.id, s.image))}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div class="t"><span class="n">${s.index}</span>${esc(s.title || '')}${riskBadge(s.risk_level)}</div>
      <div class="a">${esc(s.action || '')}</div>
      ${segUrl ? `<a class="step-video-link" href="${esc(segUrl)}" target="_blank" rel="noopener">▶ 看原视频这一段</a>` : ''}</div>`));
  });
  wireZoom(stepsBox);

  const close = () => p.remove();
  p.querySelector('.back').onclick = close;
  p.querySelector('#btnBack2').onclick = close;
  p.querySelector('#dfav').onclick = (e) => { toggleRecipe(r.id); const on = favRecipes.includes(r.id); e.target.className = 'star ' + (on ? 'on' : ''); e.target.textContent = on ? '★' : '☆'; renderRecipes(); renderFilters(); };
  p.querySelector('#dDel').onclick = async () => { if (!(await confirmModal('删除这道菜？此操作不可撤销。', '删除'))) return; try { await API.del(r.id); } catch { } close(); refresh(); toast('已删除'); };
  p.querySelector('#dEdit').onclick = () => { close(); openEdit(r); };
  p.querySelector('#dShare').onclick = () => shareRecipe(r, factor);
  p.querySelector('#addShop').onclick = () => addToShopping(r, factor);
  const aiBox = p.querySelector('#aiBox');
  function renderNutrition() {
    p.querySelector('#nutritionBox').innerHTML = nutritionHtml(r, factor);
  }
  renderNutrition();
  const aiCall = async (btn, fn, title, key) => {
    btn.disabled = true;
    let node = aiBox.querySelector(`[data-ai="${key}"]`);
    if (!node) {
      node = el(`<div class="qa" data-ai="${key}" style="border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:8px;position:relative">
        <button class="ai-x" title="收起" style="position:absolute;top:6px;right:8px;color:var(--muted);font-size:16px;padding:4px 6px">✕</button>
        <div class="q" style="font-weight:600;margin-bottom:6px;padding-right:22px">${title}</div>
        <div class="a" style="color:var(--muted);white-space:pre-wrap">思考中…</div></div>`);
      node.querySelector('.ai-x').onclick = () => node.remove();
      aiBox.appendChild(node);
    } else { node.querySelector('.a').textContent = '思考中…'; }
    try { const { answer } = await fn(); node.querySelector('.a').textContent = answer; }
    catch (e) { node.querySelector('.a').textContent = '失败：' + e.message; }
    btn.disabled = false;
  };
  p.querySelector('#btnOverview').onclick = (e) => aiCall(e.currentTarget, () => API.overview(r.id), '💡 为什么这样设计', 'overview');
  p.querySelector('#btnTags').onclick = () => editRecipeTags(r, (nextTags) => {
    r.tags = nextTags;
    recipes = recipes.map(x => x.id === r.id ? { ...x, tags: nextTags } : x);
    renderRecipes(); renderFilters();
    close(); openDetail(r);
  });
  const importExplainBtn = p.querySelector('#btnImportExplain');
  if (importExplainBtn) importExplainBtn.onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '补讲解中…';
    try {
      const data = await API.explainRecipe(r.id, depth);
      Object.assign(r, data.recipe || {});
      recipes = recipes.map(x => x.id === r.id ? r : x);
      toast('已补齐原理讲解');
      close(); openDetail(r);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'AI 补讲解';
      toast('补讲解失败：' + err.message);
    }
  };
  p.querySelector('#btnNutri').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    p.querySelector('#nutritionBox').innerHTML = '<div class="nutrition-card"><div class="nutrition-title">每份营养 <span>估算中…</span></div></div>';
    try {
      const data = await API.nutrition(r.id);
      r.nutrition = data.nutrition;
      renderNutrition();
      toast(data.cached ? '已读取营养缓存' : '已生成营养估算');
    } catch (err) {
      p.querySelector('#nutritionBox').innerHTML = `<div class="nutrition-card"><div class="nutrition-note">估算失败：${esc(err.message)}</div></div>`;
    }
    btn.disabled = false;
  };
  p.querySelector('#btnExport2').onclick = () => openExport(r, factor);
  p.querySelector('#btnCook').onclick = () => { close(); openCook(r); };
  p.querySelector('#notes').oninput = (e) => { m.notes = e.target.value; saveMeta(); };
  p.querySelector('#cookedBtn').onclick = (e) => { m.cooked = !m.cooked; if (m.cooked) m.cooked_at = new Date().toISOString(); saveMeta(); e.target.className = 'btn sm ' + (m.cooked ? '' : 'ghost'); e.target.textContent = m.cooked ? '✓ 已做过' : '标记做过'; renderRecipes(); };
  p.querySelectorAll('#rating .rs').forEach(rs => rs.onclick = () => { m.rating = +rs.dataset.r; saveMeta(); p.querySelectorAll('#rating .rs').forEach(x => x.classList.toggle('on', +x.dataset.r <= m.rating)); renderRecipes(); });
  if (base) p.querySelectorAll('.st').forEach(b => b.onclick = () => { factor = Math.max(0.5, factor + (b.dataset.s === '+' ? 0.5 : -0.5)); m.servingsFactor = factor; saveMeta(); p.querySelector('#svVal').textContent = Math.round(base * factor * 10) / 10; renderIng(); renderNutrition(); });

  $('#app').appendChild(p);
  if (focusStepIndex != null) setTimeout(() => {
    const node = Array.from(p.querySelectorAll('[data-step-index]')).find(x => x.dataset.stepIndex === String(focusStepIndex));
    if (node) { node.classList.add('focus-step'); node.scrollIntoView({ block: 'center' }); }
  }, 30);
}
function riskBadge(r) { return r === 'high' ? ' <span class="badge risk-high">🔴 新手雷区</span>' : r === 'medium' ? ' <span class="badge risk-medium">🟡 需留意</span>' : ''; }
// 跟做走到最后一步 → 闭环：自动记「做过」，顺手引导打分（做完正是最该沉淀的节点）。
function finishCook(r) {
  const m = rmeta(r.id);
  if (!m.cooked) { m.cooked = true; m.cooked_at = new Date().toISOString(); }
  saveMeta(); renderRecipes();
  const stars = [1, 2, 3, 4, 5].map(n => `<span class="rs ${m.rating >= n ? 'on' : ''}" data-r="${n}">★</span>`).join('');
  const ov = openModal(`<h3>🍜 做好啦，开动！</h3>
    <p style="color:var(--muted)">已记为「做过」。给这道菜打个分？</p>
    <div class="rating" style="justify-content:center;font-size:30px;margin:8px 0 2px">${stars}</div>
    <div class="mrow"><button class="btn ghost" id="finishSkip">先不打分</button></div>`, 'finish');
  ov.querySelectorAll('.rs').forEach(rs => rs.onclick = () => {
    m.rating = +rs.dataset.r; saveMeta(); renderRecipes();
    ov.querySelectorAll('.rs').forEach(x => x.classList.toggle('on', +x.dataset.r <= m.rating));
    toast('已记录：' + '★'.repeat(m.rating)); setTimeout(() => ov.remove(), 350);
  });
  ov.querySelector('#finishSkip').onclick = () => ov.remove();
}

/* ================= 编辑菜谱（修正 AI 的错误）================= */
function openEdit(r) {
  const d = JSON.parse(JSON.stringify(r)); // 深拷贝，取消即丢弃
  d.ingredients = Array.isArray(d.ingredients) ? d.ingredients : [];
  d.steps = Array.isArray(d.steps) ? d.steps : [];
  d.tags = Array.isArray(d.tags) ? d.tags : [];
  const fld = 'border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:10px 12px;font-size:15px;color:var(--ink);font-family:inherit;width:100%';
  const p = el(`<div class="page">
    <div class="topbar">
      <button class="back">‹ 取消</button>
      <button class="btn sm" id="eSave">✓ 保存</button>
    </div>
    <div class="detail-hd"><h2 style="font-size:22px">编辑菜谱</h2>
      <div class="meta">改错的用量 / 步骤 / 讲解，保存后同步到所有设备</div></div>

    <div class="sec-title">基本信息</div>
    <div style="padding:0 16px;display:flex;flex-direction:column;gap:8px">
      <input type="text" id="eTitle" placeholder="菜名" value="${esc(d.title || '')}">
      <div style="display:flex;gap:8px">
        <input type="text" id="eServings" placeholder="份量，如 2人份" value="${esc(d.servings || '')}" style="flex:1;min-width:0">
        <input type="text" id="eTime" inputmode="numeric" placeholder="总时长(分钟)" value="${esc(d.total_time_min || '')}" style="width:130px">
      </div>
      <div style="display:flex;gap:8px">
        <select id="eDiff" style="${fld};flex:1">
          <option value="easy" ${d.difficulty === 'easy' ? 'selected' : ''}>简单</option>
          <option value="medium" ${d.difficulty === 'medium' || !d.difficulty ? 'selected' : ''}>中等</option>
          <option value="hard" ${d.difficulty === 'hard' ? 'selected' : ''}>有挑战</option>
        </select>
        <input type="text" id="eCuisine" placeholder="菜系" value="${esc(d.cuisine || '')}" style="flex:1;min-width:0">
      </div>
      <input type="text" id="eTags" placeholder="标签，用逗号分隔" value="${esc(d.tags.join('、'))}">
    </div>

    <div class="sec-title">食材 <span class="act" id="eAddIng">＋ 加一行</span></div>
    <div id="eIng" style="padding:0 16px;display:flex;flex-direction:column;gap:6px"></div>

    <div class="sec-title">步骤 <span class="act" id="eAddStep">＋ 加一步</span></div>
    <div id="eSteps" style="padding:0 16px;display:flex;flex-direction:column;gap:14px"></div>

    <div class="cta"><button class="btn ghost" id="eCancel">取消</button><button class="btn" id="eSave2">✓ 保存</button></div>`);

  function renderIng() {
    const box = p.querySelector('#eIng');
    box.innerHTML = d.ingredients.map((i, idx) => `
      <div style="display:flex;gap:6px;align-items:center" data-i="${idx}">
        <input type="text" class="fName" placeholder="食材" value="${esc(i.name || '')}" style="${fld};flex:2">
        <input type="text" class="fAmt" placeholder="用量" value="${esc(i.amount || '')}" style="${fld};flex:1;min-width:0">
        <button class="iconbtn fUp" title="上移" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="iconbtn fDown" title="下移" ${idx === d.ingredients.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="iconbtn fDel" title="删除">🗑</button>
      </div>`).join('') || '<div style="color:var(--muted);font-size:13px">还没有食材，点上面「加一行」</div>';
    box.querySelectorAll('[data-i]').forEach(row => {
      const idx = +row.dataset.i;
      row.querySelector('.fName').oninput = (e) => d.ingredients[idx].name = e.target.value;
      row.querySelector('.fAmt').oninput = (e) => { d.ingredients[idx].amount = e.target.value; delete d.ingredients[idx].qty; delete d.ingredients[idx].unit; };
      row.querySelector('.fUp').onclick = () => { d.ingredients = moveItem(d.ingredients, idx, idx - 1); renderIng(); };
      row.querySelector('.fDown').onclick = () => { d.ingredients = moveItem(d.ingredients, idx, idx + 1); renderIng(); };
      row.querySelector('.fDel').onclick = async () => { if (!(await confirmModal('删除这个食材？', '删除'))) return; d.ingredients = removeItem(d.ingredients, idx); renderIng(); };
    });
  }
  function renderSteps() {
    const box = p.querySelector('#eSteps');
    box.innerHTML = d.steps.map((s, idx) => `
      <div class="stepmini" style="padding:12px" data-s="${idx}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>第 ${idx + 1} 步</b>
          <span style="display:flex;gap:2px">
            <button class="iconbtn sUp" title="上移" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="iconbtn sDown" title="下移" ${idx === d.steps.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="iconbtn sDel" title="删除">🗑</button>
          </span>
        </div>
        <input type="text" class="sTitle" placeholder="步骤标题" value="${esc(s.title || '')}" style="${fld};margin-bottom:6px">
        <textarea class="sAction" placeholder="具体怎么做" style="${fld};min-height:56px;margin-bottom:6px">${esc(s.action || '')}</textarea>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="text" class="sHeat" placeholder="火候" value="${esc(s.params?.heat || '')}" style="${fld};flex:1;min-width:0">
          <input type="text" class="sTime" placeholder="时间(如3分钟)" value="${esc(s.params?.time || '')}" style="${fld};flex:1;min-width:0">
        </div>
        <textarea class="sReason" placeholder="为什么这么做（讲解）" style="${fld};min-height:56px">${esc(s.why?.reason || '')}</textarea>
      </div>`).join('') || '<div style="color:var(--muted);font-size:13px">还没有步骤，点上面「加一步」</div>';
    box.querySelectorAll('[data-s]').forEach(row => {
      const idx = +row.dataset.s, s = d.steps[idx];
      row.querySelector('.sTitle').oninput = (e) => s.title = e.target.value;
      row.querySelector('.sAction').oninput = (e) => s.action = e.target.value;
      row.querySelector('.sHeat').oninput = (e) => (s.params = s.params || {}).heat = e.target.value;
      row.querySelector('.sTime').oninput = (e) => (s.params = s.params || {}).time = e.target.value;
      row.querySelector('.sReason').oninput = (e) => (s.why = s.why || {}).reason = e.target.value;
      row.querySelector('.sDel').onclick = async () => { if (!(await confirmModal('删除这一步？', '删除'))) return; d.steps = removeItem(d.steps, idx); renderSteps(); };
      row.querySelector('.sUp').onclick = () => { d.steps = moveItem(d.steps, idx, idx - 1); renderSteps(); };
      row.querySelector('.sDown').onclick = () => { d.steps = moveItem(d.steps, idx, idx + 1); renderSteps(); };
    });
  }
  renderIng(); renderSteps();
  p.querySelector('#eAddIng').onclick = () => { d.ingredients = insertItem(d.ingredients, d.ingredients.length, { name: '', amount: '', note: '' }); renderIng(); };
  p.querySelector('#eAddStep').onclick = () => { d.steps = insertItem(d.steps, d.steps.length, { title: '', action: '', params: {}, why: {} }); renderSteps(); };

  const close = () => p.remove();
  p.querySelector('.back').onclick = () => { close(); openDetail(r); };
  p.querySelector('#eCancel').onclick = () => { close(); openDetail(r); };

  async function save() {
    d.title = p.querySelector('#eTitle').value.trim() || d.title;
    const sv = p.querySelector('#eServings').value.trim(); d.servings = sv || null;
    const tm = parseInt(p.querySelector('#eTime').value, 10); d.total_time_min = Number.isFinite(tm) ? tm : null;
    d.difficulty = p.querySelector('#eDiff').value;
    d.cuisine = p.querySelector('#eCuisine').value.trim() || null;
    d.tags = parseTagsText(p.querySelector('#eTags').value);
    d.ingredients = d.ingredients.filter(i => (i.name || '').trim());
    // 只填了「为什么」而没写标题/做法的步骤也保留，别把用户输入的讲解静默丢掉
    d.steps = d.steps.filter(s => (s.title || s.action || s.why?.reason || s.why?.if_not || s.why?.cue || '').trim());
    d.steps.forEach((s, i) => s.index = i + 1);
    // 食材增删/重排后，勾选态(ingChecked 存下标)按名字重映射到新下标，否则勾中的是错误的食材。
    const em = rmeta(r.id);
    if (Array.isArray(em.ingChecked) && em.ingChecked.length) {
      const checkedNames = new Set(em.ingChecked.map(i => r.ingredients?.[i]?.name).filter(Boolean));
      em.ingChecked = d.ingredients.reduce((acc, ing, idx) => (checkedNames.has(ing.name) && acc.push(idx), acc), []);
      saveMeta();
    }
    const patch = { title: d.title, servings: d.servings, total_time_min: d.total_time_min, difficulty: d.difficulty, cuisine: d.cuisine, tags: d.tags, ingredients: d.ingredients, steps: d.steps };
    try {
      const res = await F('/api/recipes/' + encodeURIComponent(r.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
      toast('已保存'); close();
      recipes = await API.list(); renderAll();
      const found = recipes.find(x => x.id === r.id) || recipes.find(x => x.title === d.title);
      if (found) openDetail(found);
    } catch (e) { toast('保存失败：' + e.message); }
  }
  p.querySelector('#eSave').onclick = save;
  p.querySelector('#eSave2').onclick = save;
  $('#app').appendChild(p);
}

async function showSubstitute(r, ingredient) {
  const ov = openModal(`<h3>${esc(ingredient)} 的替代</h3><p style="color:var(--muted)">思考中…</p>`);
  try { const { answer } = await API.substitute(r.id, ingredient); ov.querySelector('.modal').innerHTML = `<h3>${esc(ingredient)} 的替代</h3><p style="white-space:pre-wrap;text-align:left">${esc(answer)}</p><div class="mrow"><button class="btn" id="ok">知道了</button></div>`; ov.querySelector('#ok').onclick = () => ov.remove(); }
  catch (e) { ov.querySelector('.modal').innerHTML = `<p>没问出来：${esc(e.message)}</p><div class="mrow"><button class="btn" id="ok">关闭</button></div>`; ov.querySelector('#ok').onclick = () => ov.remove(); }
}
function shareRecipe(r, factor) {
  const md = recipeToText(r, factor);
  if (navigator.share) navigator.share({ title: r.title, text: md }).catch(() => { });
  else { navigator.clipboard?.writeText(md); toast('已复制菜谱文本'); }
}
function recipeToText(r, f) {
  let s = `【${r.title}】\n`;
  s += (r.ingredients || []).map(i => `· ${i.name} ${scaledAmount(i, f || 1) || ''}`).join('\n') + '\n\n';
  (r.steps || []).forEach(x => { s += `${x.index}. ${x.title}：${x.action}\n`; if (x.why?.reason) s += `   为什么：${x.why.reason}\n`; });
  return s;
}
// 导出为 Cooklang（.cook，开放的纯文本菜谱标准，可被整个生态消费）
function recipeToCooklang(r) {
  const meta = [
    `>> title: ${r.title || ''}`,
    r.servings ? `>> servings: ${r.servings}` : '',
    r.total_time_min ? `>> time: ${r.total_time_min} min` : '',
    r.cuisine ? `>> cuisine: ${r.cuisine}` : '',
    (r.tags && r.tags.length) ? `>> tags: ${r.tags.join(', ')}` : '',
    r.source ? `>> source: ${r.source}` : '',
  ].filter(Boolean).join('\n');
  const ings = (r.ingredients || []).map(i =>
    Number.isFinite(i.qty) ? `@${i.name}{${i.qty}%${i.unit || ''}}`
      : (i.amount && !['视频未明确', '适量'].includes(i.amount)) ? `@${i.name}{${i.amount}}` : `@${i.name}{}`
  ).join(', ');
  const steps = (r.steps || []).map((s, i) => `${i + 1}. ${s.title ? s.title + '：' : ''}${s.action || ''}`).join('\n\n');
  return `${meta}\n\n-- 食材\n${ings}\n\n-- 做法\n${steps}\n`;
}
// 导出为 schema.org Recipe（JSON-LD，搜索引擎/菜谱工具通用结构化格式）
function recipeToSchemaOrg(r) {
  const undef = (v) => (v == null || v === '' ? undefined : v);
  const n = r.nutrition && r.nutrition.per_serving;
  return {
    '@context': 'https://schema.org', '@type': 'Recipe',
    name: r.title, recipeCuisine: undef(r.cuisine), keywords: undef((r.tags || []).join(', ')),
    recipeYield: undef(r.servings), totalTime: r.total_time_min ? `PT${r.total_time_min}M` : undefined,
    recipeIngredient: (r.ingredients || []).map(i => `${i.name} ${i.amount || ''}`.trim()),
    recipeInstructions: (r.steps || []).map(s => ({ '@type': 'HowToStep', name: undef(s.title), text: s.action || '' })),
    nutrition: n ? {
      '@type': 'NutritionInformation',
      calories: Number.isFinite(n.calories_kcal) ? `${n.calories_kcal} kcal` : undefined,
      proteinContent: Number.isFinite(n.protein_g) ? `${n.protein_g} g` : undefined,
      fatContent: Number.isFinite(n.fat_g) ? `${n.fat_g} g` : undefined,
      carbohydrateContent: Number.isFinite(n.carbs_g) ? `${n.carbs_g} g` : undefined,
      sodiumContent: Number.isFinite(n.sodium_mg) ? `${n.sodium_mg} mg` : undefined,
    } : undefined,
    url: r.source && /^https?:/.test(r.source) ? r.source : undefined,
  };
}
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function openExport(r, factor) {
  const safe = (r.title || 'recipe').replace(/[\/\\:*?"<>|]/g, '');
  const ov = openModal(`<h3 style="text-align:left">导出「${esc(r.title || '')}」</h3>
    <p style="color:var(--muted);font-size:13px;text-align:left;margin:0 0 12px">选一种格式</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn ghost" id="xLink">🔗 复制分享链接（任何人可看）</button>
      <button class="btn ghost" id="xMd">📋 复制文字（含每步为什么）</button>
      <button class="btn ghost" id="xCook">⬇ 下载 .cook（Cooklang 标准）</button>
      <button class="btn ghost" id="xJson">⬇ 下载 schema.org JSON-LD</button>
    </div>
    <div class="mrow"><button class="btn" id="xClose">关闭</button></div>`, 'left');
  ov.querySelector('#xLink').onclick = () => { navigator.clipboard?.writeText(shareRecipeUrl(r.id)); toast('已复制分享链接'); };
  ov.querySelector('#xMd').onclick = () => { navigator.clipboard?.writeText(recipeToText(r, factor)); toast('已复制菜谱文字'); };
  ov.querySelector('#xCook').onclick = () => { downloadFile(safe + '.cook', recipeToCooklang(r), 'text/plain;charset=utf-8'); toast('已下载 .cook'); };
  ov.querySelector('#xJson').onclick = () => { downloadFile(safe + '.jsonld', JSON.stringify(recipeToSchemaOrg(r), null, 2), 'application/ld+json'); toast('已下载 JSON-LD'); };
  ov.querySelector('#xClose').onclick = () => ov.remove();
}
function shareRecipeUrl(recipeId, { apiBase = settings.apiBase, origin = location.origin, base = BASE } = {}) {
  const root = String(apiBase || origin || '').replace(/\/+$/, '');
  const prefix = apiBase ? '' : String(base || '').replace(/\/+$/, '');
  return `${root}${prefix}/r/${encodeURIComponent(recipeId)}`;
}

/* ================= 跟做模式 ================= */
let wakeLock = null, recog = null, voiceWant = false;
async function openCook(r) {
  const steps = r.steps || []; if (!steps.length) { toast('这道菜没有步骤'); return; }
  let cur = (store.get('progress', {})[r.id]) || 0; if (cur >= steps.length) cur = 0;
  let asks = {}; const stopTimer = () => { }; // 计时改为全局 HUD，跨步骤保留，翻页不清
  const box = el('<div id="cook"></div>'); document.body.appendChild(box);
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { }

  const saveProg = (i) => { const p = store.get('progress', {}); p[r.id] = i; store.set('progress', p); };
  function render() {
    const s = steps[cur], w = s.why || {}, key = stepKey(r.id, s.index), faved = favSteps.some(x => x.key === key);
    const warn = s.confidence === 'low' ? '<span class="warn">⚠️ 原视频信息有限，以下为推测</span>' : s.confidence === 'medium' ? '<span class="warn">⚠️ 置信度中</span>' : '';
    const segUrl = sourceSegmentUrl(r.source, s.source_time);
    box.innerHTML = `
      <div class="cook-top"><button class="x">✕ 退出</button>
        <span style="color:var(--muted);font-size:14px">${cur + 1} / ${steps.length}</span>
        <div class="cook-tools">
          <button class="iconbtn" id="ttsBtn" title="朗读">🔊</button>
          ${SR ? `<button class="iconbtn ${recog ? 'on' : ''}" id="voiceBtn" title="语音控制">🎙</button>` : ''}
          <button class="fav-step ${faved ? 'on' : ''}" title="收藏这一步">${faved ? '★' : '☆'}</button>
        </div></div>
      <div class="progress">${steps.map((_, i) => `<span class="dot ${i < cur ? 'done' : i === cur ? 'cur' : ''}"></span>`).join('')}</div>
      <div class="cook-body">
        <div class="stepno">第 ${s.index} 步${riskBadge(s.risk_level)}</div>
        <h2>${esc(s.title || '')}</h2>
        <div class="action">${richText(s.action || '')}</div>
        ${s.image ? `<img class="stepimg" data-zoom src="${esc(recipeImg(r.id, s.image))}" alt="本步画面" loading="lazy" onerror="this.remove()">` : ''}
        ${segUrl ? `<a class="step-video-link cook-src" href="${esc(segUrl)}" target="_blank" rel="noopener">▶ 看原视频这一段</a>` : ''}
        ${paramsHtml(s.params)}${usedIngsHtml(r, s)}${timerHtml(s.params)}
        ${(w.reason || w.if_not || w.cue) ? `<div class="why"><div class="why-hd"><span>🤔 为什么这么做</span>${warn}</div>
          ${w.reason ? `<p><span class="lbl">原理　　</span>${richText(w.reason)}</p>` : ''}
          ${w.if_not ? `<p><span class="lbl">不这么做</span>${esc(w.if_not)}</p>` : ''}
          ${w.cue ? `<p><span class="lbl g">判断到位</span>${esc(w.cue)}</p>` : ''}</div>` : ''}
        <div class="ask"><button class="btn ghost sm" id="askBtn">💬 对这步问一句</button> <button class="btn ghost sm" id="sosBtn">🆘 翻车补救</button><div id="qa"></div></div>
      </div>
      <div class="cook-nav">
        <button class="btn prev" ${cur === 0 ? 'disabled' : ''}>‹ 上一步</button>
        <button class="btn next">${cur === steps.length - 1 ? '✓ 完成' : '下一步 ›'}</button></div>`;
    box.querySelector('.x').onclick = exit;
    box.querySelector('.fav-step').onclick = () => toggleStep(r, s);
    box.querySelector('.prev').onclick = () => { if (cur > 0) { stopTimer(); stopSpeak(); cur--; saveProg(cur); render(); } };
    box.querySelector('.next').onclick = next;
    box.querySelector('#ttsBtn').onclick = () => speak(`第${s.index}步，${s.title}。${s.action}。${w.reason ? '原理：' + w.reason : ''}`);
    box.querySelector('#askBtn').onclick = () => askStep(r, s);
    box.querySelector('#sosBtn').onclick = () => sosStep(r, s);
    const tb = box.querySelector('#timerBtn'); if (tb) tb.onclick = () => Timers.add(s.title || ('第' + s.index + '步'), parseSeconds(s.params && s.params.time));
    if (SR) box.querySelector('#voiceBtn').onclick = toggleVoice;
    box.querySelectorAll('.term').forEach(t => t.onclick = () => showTerm(t.dataset.term));
    wireZoom(box);
    renderQA(s);
    if (settings.tts) speak(`第${s.index}步，${s.title}`);
  }
  function renderQA(s) {
    const box2 = box.querySelector('#qa'); const list = asks[s.index] || [];
    box2.innerHTML = list.map(qa => `<div class="qa"><div class="q">问：${esc(qa.q)}</div><div class="a">${esc(qa.a)}</div></div>`).join('');
  }
  async function askStep(r, s) {
    const q = await promptModal('对「' + s.title + '」这步问一句', '比如：可以不放糖吗？火太大了怎么补救？'); if (!q) return;
    (asks[s.index] = asks[s.index] || []).push({ q, a: '思考中…' }); renderQA(s);
    try { const { answer } = await API.ask(r.id, s.index, q); asks[s.index][asks[s.index].length - 1].a = answer; }
    catch (e) { asks[s.index][asks[s.index].length - 1].a = '没问出来：' + e.message; }
    renderQA(s);
  }
  function next() { stopSpeak(); if (cur === steps.length - 1) { exit(); finishCook(r); return; } cur++; saveProg(cur); render(); }
  async function sosStep(r, s) {
    const problem = await promptModal('🆘 哪里翻车了？', '描述现象，如：粘锅了 / 太咸 / 没熟 / 糊了', '求救'); if (!problem) return;
    (asks[s.index] = asks[s.index] || []).push({ q: '🆘 ' + problem, a: '想办法…' }); renderQA(s);
    try { const { answer } = await API.troubleshoot(r.id, s.index, problem); asks[s.index][asks[s.index].length - 1].a = answer; }
    catch (e) { asks[s.index][asks[s.index].length - 1].a = '没能给出建议：' + e.message; }
    renderQA(s);
  }
  function toggleStep(r, s) {
    const key = stepKey(r.id, s.index);
    if (favSteps.some(x => x.key === key)) { favSteps = favSteps.filter(x => x.key !== key); toast('已移出技巧收藏'); }
    else { favSteps.push({ key, recipeId: r.id, recipeTitle: r.title, index: s.index, title: s.title, action: s.action, params: s.params, why: s.why }); toast('已收藏到「技巧收藏」⭐️'); }
    store.set('favSteps', favSteps); render(); updateBadges();
  }
  function toggleVoice() {
    if (recog) { voiceWant = false; try { recog.stop(); } catch { } recog = null; render(); return; }
    voiceWant = true;
    recog = new SR(); recog.lang = 'zh-CN'; recog.continuous = true; recog.interimResults = false;
    recog.onresult = (e) => {
      const t = e.results[e.results.length - 1][0].transcript;
      if (/下一步|下一个|next|继续|好了|完成/.test(t)) next();
      else if (/上一步|返回|back|退回/.test(t)) box.querySelector('.prev').click();
      else if (/朗读|读一下|念/.test(t)) box.querySelector('#ttsBtn').click();
      else if (/计时|开始计时/.test(t)) { const tb = box.querySelector('#timerBtn'); tb && tb.click(); }
    };
    recog.onerror = (ev) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(ev.error)) {
        voiceWant = false; recog = null; toast('语音识别不可用（' + ev.error + '）'); render();
      }
    };
    recog.onend = () => { if (voiceWant && recog) { try { recog.start(); } catch { voiceWant = false; recog = null; } } };
    try { recog.start(); showVoiceHint(); render(); } catch { voiceWant = false; recog = null; toast('语音识别启动失败'); }
  }
  function exit() { stopTimer(); stopSpeak(); voiceWant = false; if (recog) { try { recog.stop(); } catch { } recog = null; } if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; } box.remove(); }
  // 左右滑动翻步
  let x0 = null;
  box.addEventListener('touchstart', e => x0 = e.touches[0].clientX);
  box.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (dx < -60) next(); else if (dx > 60) box.querySelector('.prev').click(); x0 = null; });
  render();
}
// 跟做时高亮本步用到的食材（在这一步 action 文本里出现的食材）
function usedIngsHtml(r, s) {
  const used = (r.ingredients || []).filter(i => i.name && String(s.action || '').includes(i.name));
  if (!used.length) return '';
  return `<div class="used-ings">🧺 本步用到：${used.map(i =>
    `<span class="uing">${esc(i.name)}${i.amount && !['视频未明确', '适量'].includes(i.amount) ? ' <b>' + esc(i.amount) + '</b>' : ''}</span>`).join('')}</div>`;
}
function paramsHtml(p) {
  if (!p) return '';
  const items = [p.heat && ['火候', p.heat], p.temp && ['油温', p.temp], p.time && ['时间', p.time], p.cue && ['到位', p.cue]].filter(Boolean);
  return items.length ? `<div class="params">${items.map(([k, v]) => `<span class="param"><b>${k}</b> ${esc(v)}</span>`).join('')}</div>` : '';
}
function timerHtml(p) { const s = parseSeconds(p && p.time); return s ? `<div class="timer"><button class="btn sm" id="timerBtn">⏱ 开始计时（${Math.floor(s / 60) ? Math.floor(s / 60) + '分' : ''}${s % 60 ? (s % 60) + '秒' : ''}）</button></div>` : ''; }
// 复用同一个 AudioContext：浏览器对 AudioContext 数量有上限(~6)且不及时回收，每次响铃 new 一个响几次后就抛异常静默失败。
let _actx = null;
function beep() {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    const a = _actx;
    for (let i = 0; i < 3; i++) { const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .15; o.start(a.currentTime + i * .4); o.stop(a.currentTime + i * .4 + .2); }
  } catch { }
}
function showVoiceHint() { const h = el('<div class="voice-hint">🎙 说「下一步 / 上一步 / 朗读」</div>'); document.body.appendChild(h); setTimeout(() => h.remove(), 3000); }
async function showTerm(term) {
  const ov = openModal(`<h3>${esc(term)}</h3><p style="color:var(--muted)">查询中…</p>`);
  try { const { answer } = await API.term(term); ov.querySelector('.modal').innerHTML = `<h3>${esc(term)}</h3><p style="text-align:left">${esc(answer)}</p><div class="mrow"><button class="btn" id="ok">明白了</button></div>`; ov.querySelector('#ok').onclick = () => ov.remove(); }
  catch (e) { ov.remove(); toast('查询失败：' + e.message); }
}

/* ================= 解析（带进度）================= */
function openModal(inner, cls = '') { const ov = el(`<div class="overlay"><div class="modal ${cls}">${inner}</div></div>`); document.body.appendChild(ov); return ov; }
// 应用内输入框（替代原生 prompt，装成 App 后更稳、更好看）。返回 Promise<string|null>
function promptModal(title, placeholder = '', okText = '发送') {
  return new Promise((resolve) => {
    const ov = openModal(`<h3 style="text-align:left">${esc(title)}</h3>
      <textarea id="pmInput" placeholder="${esc(placeholder)}" style="min-height:88px;margin:8px 0 0"></textarea>
      <div class="mrow"><button class="btn ghost" id="pmCancel">取消</button><button class="btn" id="pmOk">${esc(okText)}</button></div>`, 'left');
    const input = ov.querySelector('#pmInput');
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('#pmCancel').onclick = () => done(null);
    ov.querySelector('#pmOk').onclick = () => done(input.value.trim() || null);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(input.value.trim() || null); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
    });
    setTimeout(() => input.focus(), 30);
  });
}
// 应用内确认框（替代原生 confirm，用于删除/清空等破坏性操作）。返回 Promise<boolean>
function confirmModal(title, okText = '确定') {
  return new Promise((resolve) => {
    const ov = openModal(`<h3 style="text-align:left">${esc(title)}</h3>
      <div class="mrow"><button class="btn ghost" id="cmCancel">取消</button><button class="btn" id="cmOk" style="background:var(--tomato-d)">${esc(okText)}</button></div>`, 'left');
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('#cmCancel').onclick = () => done(false);
    ov.querySelector('#cmOk').onclick = () => done(true);
  });
}
async function doParse(starter) {
  const ov = openModal(`<div class="pct" id="pct">0%</div><div class="stage" id="stage">发起解析…</div>
    <div class="pbar"><div id="bar"></div></div>
    <p style="color:var(--muted);font-size:12px">解析约需 1–3 分钟，别关页面</p>
    <div class="mrow"><button class="btn ghost" id="pMin">放到后台继续</button></div>`);
  // 「放到后台」：把进度收成一个悬浮小药丸，先去浏览别的菜谱，点药丸再展开
  let pill = null, lastPct = 0, lastStage = '解析中';
  const showPill = () => {
    if (pill) return;
    pill = el(`<div class="parse-pill">🍳 <span class="ps">${esc(lastStage)}</span> <b>${lastPct}%</b></div>`);
    pill.onclick = () => { ov.style.display = 'flex'; pill.remove(); pill = null; };
    document.body.appendChild(pill);
  };
  ov.querySelector('#pMin').onclick = () => { ov.style.display = 'none'; showPill(); };
  const setP = (pct, stage) => {
    lastPct = Math.round(pct); if (stage) lastStage = stage;
    $('#pct', ov).textContent = lastPct + '%'; $('#bar', ov).style.width = pct + '%';
    if (stage) $('#stage', ov).textContent = stage;
    if (pill) { pill.querySelector('b').textContent = lastPct + '%'; pill.querySelector('.ps').textContent = lastStage; }
  };
  const cleanup = () => { ov.remove(); if (pill) { pill.remove(); pill = null; } };
  try {
    const { jobId } = await starter();
    await new Promise((resolve, reject) => {
      const es = new EventSource(api('/api/progress/' + jobId) + (settings.apiToken ? '?token=' + encodeURIComponent(settings.apiToken) : ''));
      let errs = 0;
      es.onmessage = (ev) => {
        errs = 0; // 收到任何消息就重置错误计数
        const d = JSON.parse(ev.data);
        if (d.type === 'progress') setP(d.pct || 0, stageLabel(d.stage, d.message));
        else if (d.type === 'done') { es.close(); resolve(d.recipe); }
        else if (d.type === 'error') { es.close(); reject(new Error(d.error)); }
      };
      // 瞬时断网时 EventSource 会自动重连、服务端补发当前进度；只有确实关闭或连续多次失败(约18s)才判失败，
      // 避免长解析(1~3分钟)中一次网络抖动就误报「连接中断」。
      es.onerror = () => { if (es.readyState === EventSource.CLOSED || ++errs >= 6) { es.close(); reject(new Error('连接中断')); } };
    }).then(async (recipe) => {
      await refresh(); cleanup(); toast('解析完成：' + (recipe.title || ''));
      const found = recipes.find(x => x.title === recipe.title); if (found) openDetail(found);
    });
  } catch (e) { cleanup(); refresh(); toast('解析失败：' + e.message); }
}
function stageLabel(stage, message) {
  const map = { acquire: '下载 & 抽取音频', transcribe: '语音转文字', vision: '识别图片/画面', structure: '整理成步骤', explain: '逐步生成「为什么」', images: '截取步骤/食材画面', done: '完成' };
  return map[stage] || message || '处理中…';
}

/* ================= PWA / 初始化 ================= */
// 与购物清单页一致：按名字合并后、未全部勾选的组数（列表显示合并项，角标也该数合并组）
function shoppingUnchecked() {
  const byName = {};
  shopping.forEach(it => { (byName[it.name] = byName[it.name] || []).push(it); });
  return Object.values(byName).filter(items => !items.every(it => it.checked)).length;
}
function updateBadges() {
  const set = (sel, n) => { const b = $(sel); if (b) b.innerHTML = n ? `<span class="badge-count">${n}</span>` : ''; };
  set('#tabSkillsBadge', favSteps.length);
  set('#tabShopBadge', shoppingUnchecked());
}
function renderAll() { renderFilters(); renderRecipes(); renderTechniques(); renderSkills(); renderShopping(); updateBadges(); }
function syncDepthChips() { document.querySelectorAll('#depth .chip').forEach(x => x.classList.toggle('on', x.dataset.d === depth)); }
async function refresh() {
  try { recipes = await API.list(); } catch { recipes = store.get('cacheRecipes', []); }
  try { const data = await API.techniques(); techniques = Array.isArray(data) ? data : []; } catch { techniques = []; }
  try { const jobs = await API.jobs(); recentJobs = Array.isArray(jobs) ? jobs : []; } catch { recentJobs = []; }
  store.set('cacheRecipes', recipes);
  renderAll();
}

function initTabs() {
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    curTab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => { const on = x === t; x.classList.toggle('on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
    ['recipes', 'plan', 'techniques', 'skills', 'shopping', 'settings'].forEach(v => $('#view-' + v).classList.toggle('hidden', v !== curTab));
    const showSearch = curTab === 'recipes';
    $('#searchrow').classList.toggle('hidden', !showSearch); $('#recipeTools').classList.toggle('hidden', !showSearch); $('#filters').classList.toggle('hidden', !showSearch);
    if (curTab === 'techniques') renderTechniques(); if (curTab === 'skills') renderSkills(); if (curTab === 'shopping') renderShopping(); if (curTab === 'settings') renderSettings(); if (curTab === 'plan') renderPlan();
  });
  // 加载时同步一次 aria-selected，读屏用户一进来就知道当前在哪个标签
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x.classList.contains('on') ? 'true' : 'false'));
}
function init() {
  applyTheme(); syncDepthChips();
  Timers.restore(); // 恢复上次未结束的计时（刷新/被系统回收后不丢）
  // 无障碍：让 role=button/tab 的非原生控件(标签栏/深度选择等)支持键盘 Enter/Space 触发，而不只是鼠标/触屏点击。
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"],[role="tab"]')) { e.preventDefault(); e.target.click(); }
  });
  initTabs();
  $('#depth').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; depth = c.dataset.d; syncDepthChips(); };
  $('#parseUrl').onclick = () => { const u = $('#url').value.trim(); if (!/^https?:\/\//.test(u)) { toast('请粘贴 http(s) 视频链接'); return; } const vision = $('#visChk')?.checked, images = $('#imgChk')?.checked; doParse(() => API.startUrl(u, depth, vision, images)); $('#url').value = ''; };
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#parseUrl').click(); } });
  $('#fileBtn').onclick = () => $('#file').click();
  $('#imageBtn').onclick = () => $('#imageFile').click();
  $('#textBtn').onclick = async () => {
    const t = await promptModal('粘贴文字菜谱', '把小红书图文 / 公众号 / 任意帖子的做菜文字粘进来，AI 直接整理成分步骤 + 讲透为什么', '解析');
    if (t && t.length >= 10) doParse(() => API.startText(t, depth));
    else if (t) toast('文字太短了，多粘一点');
  };
  $('#file').onchange = (e) => { const f = e.target.files[0]; if (f) doParse(() => API.startFile(f, depth, $('#visChk')?.checked, $('#imgChk')?.checked)); e.target.value = ''; };
  $('#imageFile').onchange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) doParse(() => API.startImages(files, depth));
    e.target.value = '';
  };
  $('#search').oninput = (e) => { filter.q = e.target.value.trim(); renderRecipes(); };
  $('#ingredientFilter').oninput = (e) => { filter.ingredients = e.target.value.trim(); renderRecipes(); };
  $('#sortRecipe').onchange = (e) => { filter.sort = e.target.value || 'recent'; renderRecipes(); };
  // 系统分享导入：从别的 App 分享 B站/YouTube 链接进庖丁 → 自动填入并解析
  try {
    const sp = new URLSearchParams(location.search);
    const shared = (sp.get('url') || sp.get('text') || sp.get('title') || '').match(/https?:\/\/[^\s]+/);
    if (shared) { $('#url').value = shared[0]; history.replaceState(null, '', location.pathname); setTimeout(() => $('#parseUrl').click(), 400); }
  } catch { }
  if (showBackendSetupIfNeeded()) renderAll();
  else loadUserData().finally(refresh); // 先同步远端用户数据，再拉菜谱并渲染
  // PWA + 自动更新：检测到新版本就自动刷新（跟做/弹窗中途不打断，等忙完或下次打开）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const check = () => { try { reg.update(); } catch { } };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); }); // 回到前台时查更新
      setInterval(check, 60 * 60 * 1000); // 每小时兜底查一次
    }).catch(() => { });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      // 正在跟做或有弹窗时别硬刷，避免打断；等下次打开自然生效
      if (document.getElementById('cook') || document.querySelector('.overlay')) { toast('🆕 新版本已就绪，下次打开生效'); return; }
      refreshing = true; toast('更新到新版本…'); location.reload();
    });
  }
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; showInstall(deferred); });
}
function showInstall(deferred) {
  if ($('#installBanner') || store.get('installDismiss')) return;
  const b = el(`<div class="install-banner" id="installBanner"><span>把庖丁装到主屏，像 App 一样用</span><span><button class="btn sm" id="doInstall">安装</button> <button class="iconbtn" id="noInstall">✕</button></span></div>`);
  $('header').after(b);
  $('#doInstall').onclick = async () => { b.remove(); deferred.prompt(); };
  $('#noInstall').onclick = () => { b.remove(); store.set('installDismiss', true); };
}
document.addEventListener('DOMContentLoaded', init);
