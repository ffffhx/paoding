/* 庖丁 App — 单页逻辑（vanilla JS，无依赖） */
'use strict';

/* ---------- 存储 ---------- */
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('paoding.' + k)); return v ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('paoding.' + k, JSON.stringify(v)); },
};
const I18N = window.PaodingI18n || {
  normalizeLang: (v) => (String(v || 'zh').toLowerCase() === 'en' ? 'en' : 'zh'),
  setLang: (v) => (String(v || 'zh').toLowerCase() === 'en' ? 'en' : 'zh'),
  t: (key) => key,
};
const normalizeUiLang = (v) => I18N.normalizeLang ? I18N.normalizeLang(v) : (String(v || 'zh').toLowerCase() === 'en' ? 'en' : 'zh');
const tr = (key, params) => I18N.t ? I18N.t(key, params) : key;
const settings = Object.assign({ theme: 'light', fontScale: 1, tts: true, ttsRate: 1, apiBase: '', apiToken: '', depth: 'balanced', lang: 'zh' }, store.get('settings', {}));
function setLanguage(lang) {
  settings.lang = normalizeUiLang(lang);
  if (I18N.setLang) I18N.setLang(settings.lang);
  return settings.lang;
}
setLanguage(settings.lang);
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
  list: () => F('/api/recipes').then(j).then(normalizeRecipeListPayload),
  techniques: () => F('/api/techniques').then(r => r.json()),
  techniqueSummary: (name) => F('/api/techniques/' + encodeURIComponent(name) + '/summary', { method: 'POST' }).then(j),
  del: (id) => F('/api/recipes/' + encodeURIComponent(id), { method: 'DELETE' }),
  startUrl: (url, depth, vision, images) => F('/api/parse-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, depth, vision: !!vision, images: !!images }) }).then(j),
  startFile: (file, depth, vision, images) => F('/api/parse-file', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'X-Depth': depth, 'X-Vision': vision ? '1' : '0', 'X-Images': images ? '1' : '0' }, body: file }).then(j),
  startText: (text, depth) => F('/api/parse-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, depth }) }).then(j),
  startImages: async (files, depth) => F('/api/parse-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ depth, images: await imageFilesPayload(files) }) }).then(j),
  jobs: () => F('/api/jobs?limit=8').then(r => r.json()).catch(() => []),
  ask: (recipeId, stepIndex, question) => F('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, question }) }).then(j),
  substitute: (recipeId, ingredient, opts = {}) => F('/api/substitute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, ingredient, force: !!opts.force }) }).then(j),
  term: (term, opts = {}) => F('/api/term', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term, force: !!opts.force }) }).then(j),
  troubleshoot: (recipeId, stepIndex, problem) => F('/api/troubleshoot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, problem }) }).then(j),
  nutrition: (recipeId) => F('/api/nutrition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
  tools: (recipeId) => F('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
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
function normalizeRecipeListPayload(data) {
  if (!Array.isArray(data)) throw new Error(data?.error || tr('error.recipeListFormat'));
  return data;
}
async function exportData() {
  try {
    const [recipes, userdata] = await Promise.all([API.list(), API.userdataGet()]);
    const blob = new Blob([JSON.stringify({ app: 'paoding', version: 1, exportedAt: new Date().toISOString(), recipes, userdata }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'paoding-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast(tr('backup.exported'));
  } catch (e) { toast(tr('backup.exportFailed', { message: e.message })); }
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let data; try { data = JSON.parse(reader.result); } catch { toast(tr('backup.invalid')); return; }
    if (!(await confirmModal(tr('backup.restore.confirm'), tr('backup.restore')))) return;
    try {
      const res = await API.importAll({ recipes: data.recipes, userdata: data.userdata });
      toast(tr('backup.restored', { count: res.count || 0 }));
      setTimeout(() => location.reload(), 900);
    } catch (e) { toast(tr('backup.importFailed', { message: e.message })); }
  };
  reader.readAsText(file);
}
async function importRecipeJsonLd(text) {
  const raw = String(text || '').trim();
  if (!raw) { toast(tr('importRecipe.empty')); return; }
  try {
    const res = await API.importRecipe(raw);
    toast(tr('importRecipe.done', { title: res.recipe?.title || res.id }));
    recipes = await API.list();
    renderAll();
    const found = recipes.find(x => x.id === res.id) || res.recipe;
    if (found) openDetail(found);
  } catch (e) {
    toast(tr('importRecipe.failed', { message: e.message }));
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
    reader.onerror = () => reject(new Error(tr('error.imageRead')));
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
let cookbooks = normalizeCookbooks(store.get('cookbooks', []));
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
const SYNC_KEYS = new Set(['favRecipes', 'favSteps', 'shopping', 'cookbooks', 'meta', 'mealPlan', 'settings']);
let syncT = null;
function revOf(d) { const n = Number(d && d.rev); return Number.isInteger(n) && n >= 0 ? n : 0; }
function syncSettingsFrom(value) {
  const out = {};
  if (value && typeof value === 'object' && !Array.isArray(value) && value.lang != null) out.lang = normalizeUiLang(value.lang);
  return out;
}
function currentSyncSettings() { return { lang: settings.lang }; }
function localUserData() { return { rev: userdataRev, favRecipes, favSteps, shopping, cookbooks, meta, mealPlan, settings: currentSyncSettings() }; }
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
function simpleHash(text) {
  let h = 2166136261;
  for (const ch of String(text || '')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function safeDataId(value, fallbackSeed = '') {
  const raw = String(value || '').trim();
  const clean = raw.replace(/[^\w-]/g, '').slice(0, 48);
  return clean || `cb-${simpleHash(fallbackSeed || Date.now())}`;
}
function normalizeCookbook(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = String(raw.name || '').trim().slice(0, 60);
  if (!name) return null;
  const recipeIds = uniqList(raw.recipeIds || raw.recipes || [], [], String).map(String).filter(Boolean);
  return {
    id: safeDataId(raw.id, name),
    name,
    recipeIds,
    created_at: String(raw.created_at || raw.createdAt || ''),
    updated_at: String(raw.updated_at || raw.updatedAt || ''),
  };
}
function normalizeCookbooks(list) {
  const out = [];
  const byKey = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const cb = normalizeCookbook(raw);
    if (!cb) continue;
    const key = cb.id || `name:${cb.name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.recipeIds = uniqList(existing.recipeIds, cb.recipeIds, String);
      if (cb.updated_at && (!existing.updated_at || cb.updated_at > existing.updated_at)) {
        existing.name = cb.name;
        existing.updated_at = cb.updated_at;
      }
    } else {
      byKey.set(key, cb);
      out.push(cb);
    }
  }
  return out.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) || a.name.localeCompare(b.name, 'zh-CN'));
}
function mergeCookbooks(remote, local) {
  const merged = new Map();
  const add = (book) => {
    const cb = normalizeCookbook(book);
    if (!cb) return;
    const key = cb.id;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, cb);
      return;
    }
    const preferNextName = cb.updated_at && (!prev.updated_at || cb.updated_at >= prev.updated_at);
    merged.set(key, {
      ...prev,
      name: preferNextName ? cb.name : prev.name,
      recipeIds: uniqList(prev.recipeIds, cb.recipeIds, String),
      created_at: prev.created_at || cb.created_at,
      updated_at: [prev.updated_at, cb.updated_at].filter(Boolean).sort().pop() || '',
    });
  };
  normalizeCookbooks(remote).forEach(add);
  normalizeCookbooks(local).forEach(add);
  return normalizeCookbooks([...merged.values()]);
}
function mergeSyncSettings(remote, local) {
  const r = syncSettingsFrom(remote);
  const l = syncSettingsFrom(local);
  return { ...r, ...l, lang: normalizeUiLang(l.lang || r.lang || settings.lang) };
}
function mergeUserDataConflict(remote, local) {
  return {
    rev: revOf(remote),
    favRecipes: uniqList(remote?.favRecipes, local?.favRecipes, String),
    favSteps: uniqList(remote?.favSteps, local?.favSteps, (x) => x?.key || JSON.stringify(x)),
    shopping: mergeShopping(remote?.shopping, local?.shopping),
    cookbooks: mergeCookbooks(remote?.cookbooks, local?.cookbooks),
    meta: mergeMeta(remote?.meta, local?.meta),
    mealPlan: mergeMealPlan(remote?.mealPlan, local?.mealPlan),
    settings: mergeSyncSettings(remote?.settings, local?.settings),
  };
}
function applyUserData(d) {
  userdataRev = revOf(d);
  favRecipes = Array.isArray(d.favRecipes) ? d.favRecipes : [];
  favSteps = Array.isArray(d.favSteps) ? d.favSteps : [];
  shopping = Array.isArray(d.shopping) ? d.shopping : [];
  cookbooks = normalizeCookbooks(d.cookbooks);
  meta = d.meta && typeof d.meta === 'object' && !Array.isArray(d.meta) ? d.meta : {};
  mealPlan = d.mealPlan && typeof d.mealPlan === 'object' && !Array.isArray(d.mealPlan) ? d.mealPlan : {};
  const syncedSettings = syncSettingsFrom(d.settings);
  if (syncedSettings.lang) { setLanguage(syncedSettings.lang); applyStaticI18n(); _storeSet('settings', settings); }
  _storeSet('favRecipes', favRecipes); _storeSet('favSteps', favSteps); _storeSet('shopping', shopping); _storeSet('cookbooks', cookbooks); _storeSet('meta', meta); _storeSet('mealPlan', mealPlan);
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
  cookbooks = normalizeCookbooks(merge(d.cookbooks, cookbooks)); _storeSet('cookbooks', cookbooks);
  meta = merge(d.meta, meta); _storeSet('meta', meta);
  mealPlan = merge(d.mealPlan, mealPlan); _storeSet('mealPlan', mealPlan);
  const remoteSettings = syncSettingsFrom(d.settings);
  if (remoteSettings.lang) {
    setLanguage(remoteSettings.lang);
    applyStaticI18n();
    _storeSet('settings', settings);
  } else if (settings.lang !== 'zh') {
    needPush = true;
  }
  if (needPush) syncUp(); // 把后端缺的本地数据推上去，避免下次又被空值覆盖
}

/* ---------- 工具 ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1800); }
function $(s, r = document) { return r.querySelector(s); }
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
function hasI18nKey(key) {
  return !!(I18N.dictionaries && (
    Object.prototype.hasOwnProperty.call(I18N.dictionaries.zh || {}, key) ||
    Object.prototype.hasOwnProperty.call(I18N.dictionaries.en || {}, key)
  ));
}
function trOr(key, fallback, params) { return hasI18nKey(key) ? tr(key, params) : fallback; }
function applyStaticI18n(root = document) {
  document.title = tr('app.title');
  root.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = tr(node.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.setAttribute('placeholder', tr(node.dataset.i18nPlaceholder)); });
  root.querySelectorAll('[data-i18n-title]').forEach(node => { node.setAttribute('title', tr(node.dataset.i18nTitle)); });
  root.querySelectorAll('[data-i18n-aria-label]').forEach(node => { node.setAttribute('aria-label', tr(node.dataset.i18nAriaLabel)); });
}

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
const VALID_RECIPE_PHASES = new Set(['batch', 'serving']);
function recipePhaseGroups(r) {
  const withIndex = (list) => (Array.isArray(list) ? list : []).map((item, idx) => ({ item, idx })).filter(x => x.item && typeof x.item === 'object');
  const ingredients = withIndex(r?.ingredients);
  const steps = withIndex(r?.steps);
  const all = [...ingredients, ...steps];
  const phases = new Set(all.map(x => x.item.phase).filter(p => VALID_RECIPE_PHASES.has(p)));
  const hasPhases = all.length > 0 && all.every(x => VALID_RECIPE_PHASES.has(x.item.phase)) && phases.has('batch') && phases.has('serving');
  return {
    hasPhases,
    ingredients: {
      batch: hasPhases ? ingredients.filter(x => x.item.phase === 'batch') : ingredients,
      serving: hasPhases ? ingredients.filter(x => x.item.phase === 'serving') : [],
    },
    steps: {
      batch: hasPhases ? steps.filter(x => x.item.phase === 'batch') : steps,
      serving: hasPhases ? steps.filter(x => x.item.phase === 'serving') : [],
    },
  };
}
function phaseFactor(phase, factors) {
  if (factors && typeof factors === 'object') {
    return normalizeFactor(phase === 'batch' ? factors.batchFactor : factors.servingFactor);
  }
  return normalizeFactor(factors);
}
function scaledIngredientAmount(i, factors) {
  return scaledAmount(i, phaseFactor(i?.phase, factors));
}
function batchInfoText(r, batchFactor = 1) {
  const info = r?.batch_info;
  if (!info || typeof info !== 'object') return '';
  const parts = [];
  if (info.yield) parts.push(String(info.yield));
  const makes = Number(info.makes_servings);
  if (Number.isFinite(makes) && makes > 0) {
    parts.push(tr('detail.phase.batchMakes', { count: Math.round(makes * normalizeFactor(batchFactor) * 10) / 10 }));
  }
  if (info.makes_note) parts.push(String(info.makes_note));
  return parts.join(' · ');
}
function shoppingItemsForRecipe(r, factors = 1) {
  return (r?.ingredients || []).filter(i => i?.name).map(i => ({
    name: i.name,
    amount: scaledIngredientAmount(i, factors),
    from: r.title,
    checked: false,
  }));
}
function shoppingFactorsForRecipeMeta(r, m = {}) {
  return recipePhaseGroups(r).hasPhases
    ? { batchFactor: m.batchFactor || 1, servingFactor: m.servingsFactor || 1 }
    : (m.servingsFactor || 1);
}
function recipeShoppingFactors(r) {
  return shoppingFactorsForRecipeMeta(r, rmeta(r.id));
}
const UNIT_REFERENCES = [
  { unit: '勺', aliases: ['勺', '瓷勺', '汤匙', '大勺', 'tbsp', 'tablespoon'], lines: ['1瓷勺/汤匙≈15毫升', '1茶匙/小勺≈5毫升', '3茶匙≈1汤匙'] },
  { unit: '克', aliases: ['克', 'g', 'gram'], lines: ['1两=50克', '1斤=500克', '100克≈2两'] },
  { unit: '两', aliases: ['两'], lines: ['1两=50克', '半斤=5两=250克', '2两=100克'] },
  { unit: '毫升', aliases: ['毫升', 'ml', 'milliliter'], lines: ['1毫升水≈1克', '15毫升≈1瓷勺', '240毫升≈1量杯'] },
  { unit: '杯', aliases: ['杯', '量杯', 'cup'], lines: ['1量杯≈240毫升', '1/2杯≈120毫升', '1/4杯≈60毫升'] },
];
function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function unitAliasInText(text, alias) {
  const a = String(alias || '').toLowerCase();
  if (!a) return false;
  if (/^[a-z]+$/.test(a)) return new RegExp(`(^|[^a-z])${reEsc(a)}([^a-z]|$)`).test(text);
  if (a === '两') return /(?:^|[\s,，;；]|[0-9０-９一二三四五六七八九十半]\s*)两(?!\s*(?:勺|匙|个|颗|片|瓣|根|只|块|杯|碗|盘|半|克|斤|g|毫升|毫|升|ml))/.test(text);
  return text.includes(a);
}
function unitReferencesFor(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return [];
  return UNIT_REFERENCES.filter(ref => ref.aliases.some(alias => unitAliasInText(s, alias)));
}
function unitLookupText(text) {
  return unitReferencesFor(text).map(ref => `${ref.unit}：${ref.lines.join('；')}`).join('\n');
}
function unitTipButtonHtml(query) {
  return unitReferencesFor(query).length ? `<button class="unit-tip" title="${esc(tr('detail.unitLookup'))}" data-unit-tip="${esc(query)}">≈</button>` : '';
}
function unitReferencePopHtml(query) {
  const refs = unitReferencesFor(query);
  if (!refs.length) return '';
  return `<div class="unit-pop" role="note">
    <button class="unit-pop-x" title="${esc(tr('common.close'))}">×</button>
    <h4>${esc(tr('detail.unitLookup'))}</h4>
    ${refs.map(ref => `<p><b>${esc(ref.unit)}</b>${ref.lines.map(line => `<span>${esc(line)}</span>`).join('')}</p>`).join('')}
  </div>`;
}
function closeUnitBubbles(root = document) {
  root.querySelectorAll('.unit-pop').forEach(node => node.remove());
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
  if (!summary || (!summary.counted && !summary.missing)) return `<div class="plan-nutri muted">${esc(tr('nutrition.none'))}</div>`;
  const div = normalizeFactor(averageBy);
  const parts = NUTRITION_FIELDS.map(([k, label, unit]) => {
    const v = Math.round((summary.totals[k] || 0) / div * 10) / 10;
    return `${trOr('nutrition.' + k, label)} ${v}${unit}`;
  });
  const missing = summary.missing ? ` · ${esc(tr('nutrition.missingRecipes', { count: summary.missing }))}` : '';
  return `<div class="plan-nutri">${prefix ? `<b>${esc(prefix)}</b> ` : ''}${parts.join(' · ')}${missing}</div>`;
}
function nutritionHtml(r, factor) {
  const n = r && r.nutrition;
  const p = n && n.per_serving;
  if (!p) return '';
  const item = (k, v, unit) => `<div class="nitem"><span>${esc(k)}</span><b>${v == null ? '—' : esc(v) + unit}</b></div>`;
  const f = factor || 1;
  return `<div class="nutrition-card">
    <div class="nutrition-title">${esc(tr('nutrition.title'))} <span>${esc(tr('nutrition.estimateNote'))}</span></div>
    <div class="nutrition-grid">
      ${item(tr('nutrition.calories_kcal'), scaledNutritionValue(p.calories_kcal, f), ' kcal')}
      ${item(tr('nutrition.protein_g'), scaledNutritionValue(p.protein_g, f), ' g')}
      ${item(tr('nutrition.fat_g'), scaledNutritionValue(p.fat_g, f), ' g')}
      ${item(tr('nutrition.carbs_g'), scaledNutritionValue(p.carbs_g, f), ' g')}
      ${item(tr('nutrition.sodium_mg'), scaledNutritionValue(p.sodium_mg, f), ' mg')}
    </div>
    ${n.disclaimer ? `<div class="nutrition-note">${esc(n.disclaimer)}</div>` : ''}</div>`;
}
function hasOwnToolsField(r) {
  return !!r && Object.prototype.hasOwnProperty.call(r, 'tools');
}
function cleanToolText(v, max = 240) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => cleanToolText(x, max)).filter(Boolean).join('、').slice(0, max);
  if (typeof v === 'object') return cleanToolText(v.text ?? v.name ?? v.description ?? v['@value'] ?? v.value, max);
  return String(v)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
function normalizeRecipeTool(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const name = cleanToolText(t.name, 80);
  if (!name) return null;
  const substitute = cleanToolText(t.substitute);
  return {
    name,
    purpose: cleanToolText(t.purpose),
    essential: t.essential === true || t.essential === 1 || ['true', '1'].includes(String(t.essential).trim().toLowerCase()),
    substitute: substitute || null,
    substitute_note: cleanToolText(t.substitute_note),
    inferred: t.inferred === true || t.inferred === 1 || ['true', '1'].includes(String(t.inferred).trim().toLowerCase()),
  };
}
function recipeTools(r) {
  return Array.isArray(r?.tools) ? r.tools.map(normalizeRecipeTool).filter(Boolean) : [];
}
function toolSubstituteHtml(t) {
  const note = String(t.substitute_note || '').trim();
  if (t.substitute) {
    return `<div class="tool-sub">${esc(tr('detail.tools.substitute', { substitute: t.substitute }))}${note ? ` · ${esc(tr('detail.tools.note', { note }))}` : ''}</div>`;
  }
  return `<div class="tool-sub no">${esc(tr('detail.tools.noSubstitute'))}${note ? ` · ${esc(tr('detail.tools.noSubstituteReason', { reason: note }))}` : ''}</div>`;
}
function toolsCardHtml(r) {
  if (!hasOwnToolsField(r)) return '';
  const tools = recipeTools(r);
  if (!tools.length) return '';
  return `<div class="tools-card">
    <div class="tools-title">${esc(tr('detail.tools.title'))}</div>
    ${tools.map(t => `<div class="tool-row">
      <div class="tool-main"><b>${esc(t.name)}</b>${t.purpose ? `<span class="tool-purpose">${esc(t.purpose)}</span>` : ''}
        ${t.essential ? `<span class="tool-badge need">${esc(tr('detail.tools.essential'))}</span>` : ''}
        ${t.inferred ? `<span class="tool-badge">${esc(tr('detail.tools.inferred'))}</span>` : ''}
      </div>
      ${toolSubstituteHtml(t)}
    </div>`).join('')}
  </div>`;
}
function schemaToolDescription(t) {
  const note = String(t.substitute_note || '').trim();
  const parts = [
    t.purpose,
    t.essential ? 'Essential' : '',
    t.inferred ? 'Inferred' : '',
    t.substitute ? `Alternative: ${t.substitute}${note ? ` (${note})` : ''}` : `No alternative${note ? `: ${note}` : ''}`,
  ].filter(Boolean);
  return parts.join('; ');
}
function hasRecipeWhy(r) {
  return (r.steps || []).some(s => s.why && (s.why.reason || s.why.if_not || s.why.cue));
}
function baseServings(r) { const m = String(r.servings || '').match(/(\d+)/); return m ? +m[1] : null; }
const DIFF = { easy: '简单', medium: '中等', hard: '有挑战' };
function difficultyLabel(value) { return trOr('difficulty.' + value, DIFF[value] || value); }
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
    this.save(); this.render(); this.start(); toast(tr('timer.started', { label }));
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
    speak(tr('timer.doneSpeech', { label: t.label })); toast(tr('timer.done', { label: t.label }));
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(tr('timer.notification.title'), { body: tr('timer.notification.body', { label: t.label }), tag: t.id }); } catch { }
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
  if (ttsVoice && settings.lang !== 'en') u.voice = ttsVoice; u.lang = settings.lang === 'en' ? 'en-US' : 'zh-CN'; u.rate = settings.ttsRate || 1;
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
function homeFilterChips(tagValues = []) {
  return [
    ['', tr('home.filter.all')],
    ['__fav', tr('home.filter.favorite')],
    ['__cooked', tr('home.filter.cooked')],
    ['__uncooked', tr('home.filter.uncooked')],
    ['__nutrition', tr('home.filter.nutrition')],
    ...tagValues.slice(0, 12).map(t => [t, t]),
  ];
}
function recipeListTimeText(totalMin, sort = filter.sort) {
  if (totalMin != null) return tr('recipe.time.approxMin', { min: totalMin });
  return sort === 'time' ? tr('recipe.time.unknown') : '';
}
function recentJobStatusLabel(j) {
  return trOr('jobs.status.' + (j?.status || 'unknown'), j?.status || tr('jobs.status.unknown'));
}
function recentJobTypeLabel(j) {
  return trOr('jobs.type.' + (j?.type || 'default'), tr('jobs.type.default'));
}
function recentJobTitle(j) {
  return j?.params?.filename || j?.params?.url || (j?.params?.input ? tr('jobs.title.pastedText') : recentJobTypeLabel(j));
}
function renderFilters() {
  const tags = new Set(); recipes.forEach(r => (r.tags || []).forEach(t => tags.add(t)));
  const chips = homeFilterChips([...tags]);
  $('#filters').innerHTML = chips.map(([v, l]) => `<span class="chip ${filter.tag === v ? 'on' : ''}" data-f="${esc(v)}">${esc(l)}</span>`).join('');
  $('#filters').querySelectorAll('.chip').forEach(c => c.onclick = () => { filter.tag = c.dataset.f; renderFilters(); renderRecipes(); });
}
function renderRecipes() {
  const box = $('#view-recipes');
  const items = filterAndSortRecipes(recipes, filter, { meta, favRecipes });
  box.innerHTML = '';
  renderRecentJobs(box);
  if (!recipes.length) { box.insertAdjacentHTML('beforeend', `<div class="empty">${esc(tr('recipe.empty.title'))}<br>${esc(tr('recipe.empty.help'))}</div>`); return; }
  if (!items.length) { box.insertAdjacentHTML('beforeend', `<div class="empty">${esc(tr('recipe.noMatch'))}</div>`); return; }
  items.forEach(r => {
    const m = rmeta(r.id), faved = favRecipes.includes(r.id);
    const totalMin = recipeTotalTimeMin(r);
    const timeText = recipeListTimeText(totalMin) ? `<span>${esc(recipeListTimeText(totalMin))}</span>` : '';
    // 封面：取最后一个有截图的步骤（通常是接近成品的状态图）
    const cover = (r.steps || []).slice().reverse().find(s => s.image);
    const card = el(`<div class="rcard">
      ${cover ? `<img class="rcover" src="${esc(recipeImg(r.id, cover.image))}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div style="flex:1;min-width:0">
        <h3>${esc(r.title || tr('recipe.untitled'))}</h3>
        <div class="meta">
          ${r.difficulty ? `<span class="tag diff-${esc(r.difficulty)}">${esc(difficultyLabel(r.difficulty))}</span>` : ''}
          ${timeText}
          <span>${esc(tr('recipe.steps', { count: (r.steps || []).length }))}</span>
          ${m.cooked ? `<span class="cooked">${esc(tr('recipe.cooked'))}</span>` : ''}
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
  const rows = list.map(j => `<div class="job-row ${esc(j.status || '')}">
    <div><b>${esc(recentJobTypeLabel(j))}</b><span>${esc(recentJobTitle(j))}</span></div>
    <em>${esc(j.progress?.message || j.error || recentJobStatusLabel(j))}</em>
  </div>`).join('');
  box.insertAdjacentHTML('beforeend', `<div class="jobs-lite"><div class="jobs-hd">${esc(tr('jobs.header'))}</div>${rows}</div>`);
}

/* ================= 技法库 ================= */
function whyExcerpt(w) {
  return [w?.reason, w?.if_not, w?.cue].filter(Boolean).join(' ');
}
function techCountText(count, full = false) {
  return tr(full ? 'tech.countFull' : 'tech.countShort', { count });
}
function techRecipeStepText(recipe, step) {
  return tr('tech.recipeStep', { recipe, step });
}
function techSamplesText(occurrences = []) {
  return occurrences.slice(0, 3).map(o => o.recipeTitle).filter(Boolean).join(settings.lang === 'en' ? ', ' : '、');
}
function techSummaryNoteText(cached) {
  return tr('tech.summary.note', { state: tr(cached ? 'tech.summary.cached' : 'tech.summary.generated') });
}
function renderTechniques() {
  const box = $('#view-techniques');
  if (!techniques.length) { box.innerHTML = `<div class="empty">${esc(tr('tech.empty.title'))}<br>${esc(tr('tech.empty.help'))}</div>`; return; }
  box.innerHTML = techniques.map(t => {
    const samples = techSamplesText(t.occurrences || []);
    return `<div class="tech-card" data-tech="${esc(t.technique)}">
      <div><h3>${esc(t.technique)}</h3><div class="meta">${esc(samples)}${(t.occurrences || []).length > 3 ? '…' : ''}</div></div>
      <span>${esc(techCountText(t.count))}</span>
    </div>`;
  }).join('');
  box.querySelectorAll('.tech-card').forEach(card => {
    const t = techniques.find(x => x.technique === card.dataset.tech);
    if (t) card.onclick = () => openTechnique(t);
  });
}
function openRecipeAtStep(recipeId, stepIndex) {
  const r = recipes.find(x => x.id === recipeId);
  if (!r) { toast(tr('error.recipeMissing')); return; }
  openDetail(r, stepIndex);
}
function openTechnique(t) {
  const p = el(`<div class="page">
    <div class="topbar"><button class="back">${esc(tr('detail.back'))}</button></div>
    <div class="detail-hd"><h2>${esc(t.technique)}</h2><div class="meta">${esc(techCountText(t.count, true))}</div></div>
    <div style="padding:4px 16px 80px">
      <div class="tech-ai">
        <button class="btn ghost" data-tech-summary>${esc(tr('tech.summary.button'))}</button>
        <div class="tech-summary-result hidden"></div>
      </div>
      ${(t.occurrences || []).map(o => {
        const why = whyExcerpt(o.why);
        return `<div class="tech-occ">
          <div class="src">${esc(techRecipeStepText(o.recipeTitle, o.stepIndex))}</div>
          <h4>${esc(o.stepTitle || tr('tech.untitledStep'))}</h4>
          ${o.action ? `<div class="a">${esc(o.action)}</div>` : ''}
          ${why ? `<p><span class="lbl">${esc(tr('why.reason'))}</span> ${esc(why)}</p>` : `<p>${esc(tr('tech.noWhy'))}</p>`}
          <button class="btn ghost sm" data-rid="${esc(o.recipeId)}" data-step="${esc(o.stepIndex)}">${esc(tr('tech.jumpToStep'))}</button>
        </div>`;
      }).join('')}
    </div></div>`);
  p.querySelector('.back').onclick = () => p.remove();
  const summaryBtn = p.querySelector('[data-tech-summary]');
  const summaryBox = p.querySelector('.tech-summary-result');
  summaryBtn.onclick = async () => {
    const oldText = summaryBtn.textContent;
    summaryBtn.disabled = true;
    summaryBtn.textContent = tr('tech.summary.loading');
    summaryBox.classList.remove('hidden');
    summaryBox.innerHTML = `<div class="muted">${esc(tr('tech.summary.loading'))}</div>`;
    try {
      const data = await API.techniqueSummary(t.technique);
      const s = data.summary || {};
      summaryBox.innerHTML = `
        <div><b>${esc(tr('tech.summary.when'))}</b><p>${esc(s.when || '')}</p></div>
        <div><b>${esc(tr('tech.summary.keys'))}</b><p>${esc(s.keys || '')}</p></div>
        <div><b>${esc(tr('tech.summary.pitfalls'))}</b><p>${esc(s.pitfalls || '')}</p></div>
        <div class="meta">${esc(techSummaryNoteText(data.cached))}</div>`;
    } catch (e) {
      summaryBox.classList.add('hidden');
      toast(tr('tech.summary.failed', { message: e.message }));
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
  if (!favSteps.length) { box.innerHTML = `<div class="empty">${esc(tr('skills.empty.title'))}<br>${esc(tr('skills.empty.help'))}</div>`; return; }
  box.innerHTML = '';
  favSteps.slice().reverse().forEach(s => {
    const w = s.why || {};
    const c = el(`<div class="skill">
      <div class="src">${esc(techRecipeStepText(s.recipeTitle, s.index))}</div>
      <h4><span>${esc(s.title || '')}</span><button class="star on">★</button></h4>
      <div style="font-size:14px;color:var(--muted);line-height:1.55">${esc(s.action || '')}</div>
      ${w.reason ? `<p><span class="lbl">${esc(tr('why.reason'))}</span> ${esc(w.reason)}</p>` : ''}
      ${w.if_not ? `<p><span class="lbl">${esc(tr('why.ifNot'))}</span> ${esc(w.if_not)}</p>` : ''}</div>`);
    c.querySelector('.star').onclick = () => { favSteps = favSteps.filter(x => x.key !== s.key); store.set('favSteps', favSteps); renderSkills(); updateBadges(); toast(tr('skills.removed')); };
    box.appendChild(c);
  });
}

/* ================= 菜谱集 ================= */
function cookbookRecipeIdsFor(recipeId, books = cookbooks) {
  const id = String(recipeId || '');
  return normalizeCookbooks(books).filter(cb => cb.recipeIds.includes(id)).map(cb => cb.id);
}
function recipesInCookbook(cb, list = recipes) {
  const byId = new Map((Array.isArray(list) ? list : []).map(r => [r.id, r]));
  return (cb?.recipeIds || []).map(id => byId.get(id)).filter(Boolean);
}
function recipeCoverStep(r) {
  return (r?.steps || []).slice().reverse().find(s => s.image) || null;
}
function cookbookCoverRecipe(cb, list = recipes) {
  return recipesInCookbook(cb, list)[0] || null;
}
function cookbookCountText(count) {
  return tr('cookbooks.count', { count });
}
function saveCookbooks() {
  cookbooks = normalizeCookbooks(cookbooks);
  store.set('cookbooks', cookbooks);
}
function uniqueCookbookId(name) {
  const seed = safeDataId(name, name);
  let id = seed.startsWith('cb-') ? seed : `cb-${seed}`;
  const used = new Set(cookbooks.map(cb => cb.id));
  for (let i = 2; used.has(id); i++) id = `${seed}-${i}`;
  return id;
}
function addCookbook(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const exists = cookbooks.find(cb => cb.name === clean);
  if (exists) return exists;
  const stamp = new Date().toISOString();
  const cb = { id: uniqueCookbookId(clean), name: clean.slice(0, 60), recipeIds: [], created_at: stamp, updated_at: stamp };
  cookbooks = normalizeCookbooks([cb, ...cookbooks]);
  saveCookbooks();
  return cb;
}
function renameCookbook(id, name) {
  const clean = String(name || '').trim();
  if (!clean) return false;
  const stamp = new Date().toISOString();
  let changed = false;
  cookbooks = cookbooks.map(cb => {
    if (cb.id !== id) return cb;
    changed = true;
    return { ...cb, name: clean.slice(0, 60), updated_at: stamp };
  });
  if (changed) saveCookbooks();
  return changed;
}
function deleteCookbook(id) {
  const next = cookbooks.filter(cb => cb.id !== id);
  if (next.length === cookbooks.length) return false;
  cookbooks = next;
  saveCookbooks();
  return true;
}
function setRecipeCookbookMembership(recipeId, cookbookId, enabled) {
  const rid = String(recipeId || '');
  if (!rid) return;
  const stamp = new Date().toISOString();
  cookbooks = cookbooks.map(cb => {
    if (cb.id !== cookbookId) return cb;
    const recipeIds = enabled ? uniqList(cb.recipeIds, [rid], String) : (cb.recipeIds || []).filter(id => id !== rid);
    return { ...cb, recipeIds, updated_at: stamp };
  });
  saveCookbooks();
}
function cookbookCoverHtml(cb) {
  const r = cookbookCoverRecipe(cb);
  const cover = recipeCoverStep(r);
  if (r && cover) return `<img src="${esc(recipeImg(r.id, cover.image))}" alt="" loading="lazy" onerror="this.remove()">`;
  const initial = (cb.name || '?').trim().slice(0, 1).toUpperCase();
  return `<span>${esc(initial)}</span>`;
}
function renderCookbooks() {
  const box = $('#view-cookbooks');
  if (!box) return;
  const head = `<div class="cookbook-create">
    <input type="text" id="cookbookName" placeholder="${esc(tr('cookbooks.create.placeholder'))}">
    <button class="btn sm" id="cookbookCreate">${esc(tr('cookbooks.create'))}</button>
  </div>`;
  if (!cookbooks.length) {
    box.innerHTML = head + `<div class="empty">${esc(tr('cookbooks.empty.title'))}<br>${esc(tr('cookbooks.empty.help'))}</div>`;
  } else {
    box.innerHTML = head + `<div class="cookbook-grid">${cookbooks.map(cb => `
      <div class="cookbook-card" data-id="${esc(cb.id)}">
        <div class="cookbook-cover">${cookbookCoverHtml(cb)}</div>
        <div class="cookbook-info">
          <h3>${esc(cb.name)}</h3>
          <p>${esc(cookbookCountText((cb.recipeIds || []).length))}</p>
        </div>
        <div class="cookbook-actions">
          <button class="iconbtn cb-rename" title="${esc(tr('cookbooks.rename'))}">✏️</button>
          <button class="iconbtn cb-delete" title="${esc(tr('cookbooks.delete'))}">🗑</button>
        </div>
      </div>`).join('')}</div>`;
  }
  const create = () => {
    const input = box.querySelector('#cookbookName');
    const cb = addCookbook(input?.value);
    if (!cb) return;
    toast(tr('cookbooks.created'));
    renderCookbooks();
  };
  box.querySelector('#cookbookCreate') && (box.querySelector('#cookbookCreate').onclick = create);
  box.querySelector('#cookbookName') && (box.querySelector('#cookbookName').onkeydown = (e) => { if (e.key === 'Enter') create(); });
  box.querySelectorAll('.cookbook-card').forEach(card => {
    const id = card.dataset.id;
    card.onclick = () => openCookbook(id);
    card.querySelector('.cb-rename').onclick = async (e) => {
      e.stopPropagation();
      const cb = cookbooks.find(x => x.id === id);
      const name = await promptModal(tr('cookbooks.rename.title'), cb?.name || '', tr('common.save'));
      if (name && renameCookbook(id, name)) { toast(tr('cookbooks.renamed')); renderCookbooks(); }
    };
    card.querySelector('.cb-delete').onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmModal(tr('cookbooks.delete.confirm'), tr('common.delete')))) return;
      if (deleteCookbook(id)) { toast(tr('cookbooks.deleted')); renderCookbooks(); }
    };
  });
}
function openCookbook(id) {
  const cb = cookbooks.find(x => x.id === id);
  if (!cb) return;
  const items = recipesInCookbook(cb);
  const p = el(`<div class="page">
    <div class="topbar"><button class="back">${esc(tr('detail.back'))}</button>
      <div style="display:flex;gap:4px">
        <button class="iconbtn" id="cbRename" title="${esc(tr('cookbooks.rename'))}">✏️</button>
        <button class="iconbtn" id="cbDelete" title="${esc(tr('cookbooks.delete'))}">🗑</button>
      </div></div>
    <div class="detail-hd"><h2>${esc(cb.name)}</h2><div class="meta">${esc(cookbookCountText(items.length))}</div></div>
    <div class="list cookbook-recipes">
      ${items.length ? items.map(r => `<div class="cookbook-recipe" data-id="${esc(r.id)}">
        <div><h3>${esc(r.title || tr('recipe.untitled'))}</h3><p>${esc(tr('recipe.steps', { count: (r.steps || []).length }))}</p></div>
        <button class="btn ghost sm cb-remove">${esc(tr('cookbooks.removeRecipe'))}</button>
      </div>`).join('') : `<div class="empty">${esc(tr('cookbooks.detail.empty'))}</div>`}
    </div></div>`);
  const close = () => p.remove();
  p.querySelector('.back').onclick = close;
  p.querySelector('#cbRename').onclick = async () => {
    const name = await promptModal(tr('cookbooks.rename.title'), cb.name, tr('common.save'));
    if (name && renameCookbook(cb.id, name)) { toast(tr('cookbooks.renamed')); close(); renderCookbooks(); openCookbook(cb.id); }
  };
  p.querySelector('#cbDelete').onclick = async () => {
    if (!(await confirmModal(tr('cookbooks.delete.confirm'), tr('common.delete')))) return;
    if (deleteCookbook(cb.id)) { toast(tr('cookbooks.deleted')); close(); renderCookbooks(); }
  };
  p.querySelectorAll('.cookbook-recipe').forEach(row => {
    const rid = row.dataset.id;
    row.onclick = () => { const r = recipes.find(x => x.id === rid); if (r) openDetail(r); };
    row.querySelector('.cb-remove').onclick = (e) => {
      e.stopPropagation();
      setRecipeCookbookMembership(rid, cb.id, false);
      toast(tr('cookbooks.saved'));
      close(); renderCookbooks(); openCookbook(cb.id);
    };
  });
  $('#app').appendChild(p);
}
function showCookbookPicker(r) {
  const ov = openModal(`<h3 style="text-align:left">${esc(tr('cookbooks.picker.title'))}</h3>
    <div id="cbPickList" class="cb-pick-list"></div>
    <div class="cookbook-create" style="padding:0;margin-top:10px">
      <input type="text" id="cbPickNew" placeholder="${esc(tr('cookbooks.create.placeholder'))}">
      <button class="btn ghost sm" id="cbPickCreate">${esc(tr('cookbooks.create'))}</button>
    </div>
    <div class="mrow"><button class="btn ghost" id="cbPickCancel">${esc(tr('common.cancel'))}</button><button class="btn" id="cbPickSave">${esc(tr('common.save'))}</button></div>`, 'left');
  const selected = new Set(cookbookRecipeIdsFor(r.id));
  const draw = () => {
    ov.querySelector('#cbPickList').innerHTML = cookbooks.length ? cookbooks.map(cb => `
      <label class="cb-check"><input type="checkbox" data-id="${esc(cb.id)}" ${selected.has(cb.id) ? 'checked' : ''}> <span>${esc(cb.name)}</span><em>${esc(cookbookCountText((cb.recipeIds || []).length))}</em></label>
    `).join('') : `<div class="empty" style="padding:20px 12px">${esc(tr('cookbooks.empty.title'))}</div>`;
    ov.querySelectorAll('#cbPickList input').forEach(input => {
      input.onchange = () => { input.checked ? selected.add(input.dataset.id) : selected.delete(input.dataset.id); };
    });
  };
  draw();
  ov.querySelector('#cbPickCreate').onclick = () => {
    const input = ov.querySelector('#cbPickNew');
    const cb = addCookbook(input.value);
    if (cb) { selected.add(cb.id); input.value = ''; draw(); }
  };
  ov.querySelector('#cbPickCancel').onclick = () => ov.remove();
  ov.querySelector('#cbPickSave').onclick = () => {
    cookbooks.forEach(cb => setRecipeCookbookMembership(r.id, cb.id, selected.has(cb.id)));
    ov.remove();
    renderCookbooks();
    toast(tr('cookbooks.saved'));
  };
}

/* ================= 购物清单（按货架分区 + 同名合并）================= */
const SHOP_SECTION_ORDER = ['蔬菜水果', '肉禽蛋', '水产', '调味干货', '粮油米面', '乳品豆制品', '冷冻', '其他'];
const SHOP_SECTION_I18N = {
  蔬菜水果: 'shopping.section.produce',
  肉禽蛋: 'shopping.section.meat',
  水产: 'shopping.section.seafood',
  调味干货: 'shopping.section.pantry',
  粮油米面: 'shopping.section.grains',
  乳品豆制品: 'shopping.section.dairy',
  冷冻: 'shopping.section.frozen',
  其他: 'shopping.section.other',
};
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
function shopSectionLabel(section) {
  const key = SHOP_SECTION_I18N[section];
  return key ? trOr(key, section) : section;
}
function shoppingSourceLabel(src) {
  return String(src || '').split('、').filter(Boolean).map(part => (
    part === '手动添加' ? tr('shopping.manualSource') : part
  )).join(settings.lang === 'en' ? ', ' : '、');
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
  return groupShoppingItems(list).map(g => `【${shopSectionLabel(g.section)}】\n` + g.items.map(it => `${it.checked ? '✓ ' : ''}${it.name}${it.amount ? ' ' + it.amount : ''}`).join('\n')).join('\n\n');
}
function shopManualAdd() {
  const inp = $('#shopAdd'); if (!inp) return;
  const v = inp.value.trim(); if (!v) return;
  shopping.push({ name: v, amount: '', from: '手动添加', checked: false });
  store.set('shopping', shopping); updateBadges(); renderShopping();
}
function renderShopping() {
  const box = $('#view-shopping');
  const head = `<div class="searchrow" style="padding:4px 0 8px;gap:8px"><input type="text" id="shopAdd" placeholder="${esc(tr('shopping.add.placeholder'))}" style="flex:1;min-width:0"><button class="btn sm" id="shopAddBtn">${esc(tr('shopping.add'))}</button></div>
    <div class="searchrow" style="padding:0 0 12px"><button class="btn ghost sm" id="shopCopy">${esc(tr('shopping.copy'))}</button><button class="btn ghost sm" id="shopClear">${esc(tr('shopping.clearChecked'))}</button><button class="btn ghost sm" id="shopAll">${esc(tr('shopping.clearAll'))}</button></div>`;
  const wireAdd = () => {
    $('#shopAddBtn') && ($('#shopAddBtn').onclick = shopManualAdd);
    $('#shopAdd') && ($('#shopAdd').onkeydown = (e) => { if (e.key === 'Enter') shopManualAdd(); });
    $('#shopCopy') && ($('#shopCopy').onclick = async () => {
      const text = shoppingTextBySection();
      try { if (!navigator.clipboard?.writeText) throw new Error('clipboard'); await navigator.clipboard.writeText(text); toast(tr('shopping.copy.done')); }
      catch { toast(tr('shopping.copy.failed')); }
    });
  };
  if (!shopping.length) { box.innerHTML = head + `<div class="empty">${esc(tr('shopping.empty.title'))}<br>${esc(tr('shopping.empty.help'))}</div>`; wireAdd(); return; }
  let html = head;
  for (const group of groupShoppingItems(shopping)) {
    html += `<div class="sec-title" style="margin:14px 0 6px 0;padding:0">${esc(shopSectionLabel(group.section))}</div>`;
    html += group.items.map(m => `
      <div class="shop-item ${m.checked ? 'checked' : ''}" data-idxs="${m.idxs.join(',')}">
        <div class="ck ${m.checked ? 'on' : ''}">${m.checked ? '✓' : ''}</div>
        <div class="txt">${esc(m.name)}${m.amount ? ` · <span style="color:var(--muted)">${esc(m.amount)}</span>` : ''}<div class="sub">${esc(shoppingSourceLabel(m.src))}${m.idxs.length > 1 ? ` · ${esc(tr('shopping.mergedFrom', { count: m.idxs.length }))}` : ''}</div></div>
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
  $('#shopAll') && ($('#shopAll').onclick = async () => { if (!(await confirmModal(tr('shopping.clearAll.confirm'), tr('shopping.clearAll')))) return; shopping = []; store.set('shopping', shopping); renderShopping(); updateBadges(); });
}
function addToShoppingItems(r, factor) {
  const names = new Set(shopping.map(x => x.name + '|' + x.from));
  shoppingItemsForRecipe(r, factor || 1).forEach(item => {
    const key = item.name + '|' + item.from;
    if (!names.has(key)) {
      shopping.push(item);
      names.add(key);
    }
  });
}
function addToShopping(r, factor) { addToShoppingItems(r, factor); store.set('shopping', shopping); updateBadges(); toast(tr('shopping.added')); }

/* ================= 本周计划（膳食计划）================= */
function weekDays() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const wd = ['plan.weekday.sun', 'plan.weekday.mon', 'plan.weekday.tue', 'plan.weekday.wed', 'plan.weekday.thu', 'plan.weekday.fri', 'plan.weekday.sat'];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(now); dt.setDate(now.getDate() + i);
    days.push({ key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`, label: i === 0 ? tr('plan.today') : i === 1 ? tr('plan.tomorrow') : tr(wd[dt.getDay()]), date: `${dt.getMonth() + 1}/${dt.getDate()}` });
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
    <button class="btn sm" id="planToShop" ${planned ? '' : 'disabled'}>${esc(tr('plan.toShopping'))}</button>
    ${planned ? `<button class="btn ghost sm" id="planClear">${esc(tr('plan.clear'))}</button>` : ''}</div>
    <div class="plan-week">${nutritionSummaryHtml(weeklySummary, { prefix: tr('plan.weekAverage'), averageBy: 7 })}</div>`;
  html += days.map(day => {
    const items = (mealPlan[day.key] || []).map(id => byId[id]).filter(Boolean);
    const summary = summarizeMealNutrition(items, factorFor);
    const timelineBtn = items.length >= 2 ? `<button class="act plantimeline" data-key="${day.key}">${esc(tr('plan.timeline'))}</button>` : '';
    return `<div class="planday">
      <div class="planhd"><b>${esc(day.label)}</b> <span style="color:var(--muted);font-size:13px">${day.date}</span> ${timelineBtn}<button class="act planadd" data-key="${day.key}">${esc(tr('plan.addRecipe'))}</button></div>
      ${items.length ? items.map(r => `<div class="planitem" data-key="${day.key}" data-id="${esc(r.id)}"><span class="pmore">${esc(r.title)}</span><button class="prm" title="${esc(tr('plan.remove'))}">✕</button></div>`).join('') : `<div style="color:var(--muted);font-size:13px;padding:6px 0 2px">${esc(tr('plan.emptyDay'))}</div>`}
      ${items.length ? nutritionSummaryHtml(summary, { prefix: tr('plan.dayTotal') }) : ''}
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
    let n = 0; ids.forEach(id => { const r = byId[id]; if (r) { addToShoppingItems(r, recipeShoppingFactors(r)); n++; } });
    if (n) { store.set('shopping', shopping); updateBadges(); toast(tr('plan.addedToShopping', { count: n })); } else toast(tr('plan.emptyWeek'));
  });
  $('#planClear') && ($('#planClear').onclick = async () => { if (!(await confirmModal(tr('plan.clear.confirm'), tr('shopping.clearAll')))) return; days.forEach(d => delete mealPlan[d.key]); saveMealPlan(); renderPlan(); });
}
function timelineOffsetText(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}
function showCookTimeline(key, dayRecipes) {
  const day = weekDays().find(d => d.key === key);
  const selected = new Set((dayRecipes || []).map(r => r.id));
  const ov = openModal(`<h3 style="text-align:left">${esc(tr('plan.timeline.title', { day: day?.label || '' }))}</h3>
    <div id="tlPick" class="tl-pick"></div>
    <div id="tlList" class="timeline-list"></div>
    <div class="mrow"><button class="btn" id="tlClose">${esc(tr('common.close'))}</button></div>`, 'left');
  const draw = () => {
    const chosen = (dayRecipes || []).filter(r => selected.has(r.id));
    ov.querySelector('#tlPick').innerHTML = (dayRecipes || []).map(r => `<label class="tl-check"><input type="checkbox" data-id="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''}> ${esc(r.title || '')}</label>`).join('');
    const actions = mergeCookTimeline(chosen);
    ov.querySelector('#tlList').innerHTML = actions.length ? actions.map(a => `
      <div class="tlitem ${a.passive ? 'passive' : ''}">
        <div><b>${esc(tr('plan.timeline.offset', { minute: timelineOffsetText(a.offsetMin) }))}</b><span>${a.passive ? '⏳ ' : ''}${esc(tr('plan.timeline.step', { recipe: a.recipeTitle, step: a.stepIndex }))}</span></div>
        <p>${esc(a.text)}${a.estimated ? `<em>${esc(tr('plan.timeline.estimated', { minutes: 3 }))}</em>` : ''}</p>
      </div>`).join('') : `<div class="empty" style="padding:20px 8px">${esc(tr('plan.timeline.empty'))}</div>`;
    ov.querySelectorAll('#tlPick input').forEach(input => {
      input.onchange = () => { input.checked ? selected.add(input.dataset.id) : selected.delete(input.dataset.id); draw(); };
    });
  };
  draw();
  ov.querySelector('#tlClose').onclick = () => ov.remove();
}
function pickRecipeForDay(key) {
  if (!recipes.length) { toast(tr('plan.noRecipes')); return; }
  const day = weekDays().find(d => d.key === key);
  const ov = openModal(`<h3 style="text-align:left">${esc(tr('plan.pick.title', { day: day ? day.label : '' }))}</h3>
    <input type="text" id="pickSearch" placeholder="${esc(tr('plan.pick.search'))}" style="margin:8px 0 0">
    <div id="pickList" style="max-height:46vh;overflow:auto;margin-top:8px"></div>
    <div class="mrow"><button class="btn" id="pkClose">${esc(tr('common.close'))}</button></div>`, 'left');
  const draw = (q) => {
    ov.querySelector('#pickList').innerHTML = recipes.filter(r => !q || (r.title || '').includes(q)).map(r =>
      `<div class="pickrow" data-id="${esc(r.id)}" style="padding:11px 6px;border-bottom:1px solid var(--line);cursor:pointer">${esc(r.title)}</div>`).join('') || `<div style="color:var(--muted);padding:10px 6px">${esc(tr('plan.pick.noMatch'))}</div>`;
    ov.querySelectorAll('.pickrow').forEach(row => row.onclick = () => {
      mealPlan[key] = mealPlan[key] || []; if (!mealPlan[key].includes(row.dataset.id)) mealPlan[key].push(row.dataset.id);
      saveMealPlan(); ov.remove(); renderPlan(); toast(tr('plan.added'));
    });
  };
  draw('');
  ov.querySelector('#pickSearch').oninput = (e) => draw(e.target.value.trim());
  ov.querySelector('#pkClose').onclick = () => ov.remove();
}

/* ================= 设置 ================= */
function settingsLanguageRowHtml() {
  return `<div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">${esc(tr('settings.language.label'))}</div><div class="desc">${esc(tr('settings.language.desc'))}</div></div>
      <select id="uiLang" aria-label="${esc(tr('settings.language.label'))}" style="margin-top:8px">
        <option value="zh" ${settings.lang === 'zh' ? 'selected' : ''}>${esc(tr('settings.language.zh'))}</option>
        <option value="en" ${settings.lang === 'en' ? 'selected' : ''}>${esc(tr('settings.language.en'))}</option>
      </select></div>`;
}
function renderSettings() {
  const box = $('#view-settings');
  const sw = (on) => `<div class="switch ${on ? 'on' : ''}"></div>`;
  box.innerHTML = `
    <div class="setrow"><div><div class="lbl">${esc(tr('settings.theme.label'))}</div><div class="desc">${esc(tr('settings.theme.desc'))}</div></div>${sw(settings.theme === 'dark')}<span class="hidden" data-k="theme"></span></div>
    <div class="setrow"><div><div class="lbl">${esc(tr('settings.tts.label'))}</div><div class="desc">${esc(tr('settings.tts.desc'))}</div></div>${sw(settings.tts)}<span class="hidden" data-k="tts"></span></div>
    ${settingsLanguageRowHtml()}
    <div class="setrow"><div style="flex:1"><div class="lbl">${esc(tr('settings.font.label'))}</div><div class="desc">${esc(tr('settings.font.current', { percent: Math.round(settings.fontScale * 100) }))}</div></div>
      <button class="iconbtn" data-fs="-">A－</button><button class="iconbtn" data-fs="+">A＋</button></div>
    <div class="setrow"><div style="flex:1"><div class="lbl">${esc(tr('settings.ttsRate.label'))}</div><div class="desc">${esc(tr('settings.ttsRate.current', { rate: settings.ttsRate.toFixed(1) }))}</div></div>
      <button class="iconbtn" data-tr="-">－</button><button class="iconbtn" data-tr="+">＋</button></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">${esc(tr('settings.depth.default'))}</div></div>
      <div class="depth" id="setDepth" style="margin-top:8px">
        <span class="chip ${settings.depth === 'beginner' ? 'on' : ''}" data-d="beginner">${esc(tr('home.depth.beginner'))}</span>
        <span class="chip ${settings.depth === 'balanced' ? 'on' : ''}" data-d="balanced">${esc(tr('settings.depth.balanced'))}</span>
        <span class="chip ${settings.depth === 'advanced' ? 'on' : ''}" data-d="advanced">${esc(tr('home.depth.advanced'))}</span></div></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">${esc(tr('settings.backend.label'))}</div><div class="desc">${esc(tr('settings.backend.desc'))}</div></div>
      <input type="text" id="apiBase" placeholder="${esc(tr('settings.backend.placeholder'))}" value="${esc(settings.apiBase)}" style="margin-top:8px"></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">${esc(tr('settings.token.label'))}</div><div class="desc">${esc(tr('settings.token.desc'))}</div></div>
      <input type="password" id="apiToken" placeholder="${esc(tr('settings.token.placeholder'))}" value="${esc(settings.apiToken)}" style="margin-top:8px"></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">${esc(tr('settings.backup.label'))}</div><div class="desc">${esc(tr('settings.backup.desc'))}</div></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost sm" id="btnExport">${esc(tr('settings.backup.export'))}</button>
        <button class="btn ghost sm" id="btnImport">${esc(tr('settings.backup.import'))}</button>
        <input type="file" id="importFile" accept="application/json,.json" class="hidden"></div></div>
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">${esc(tr('settings.importRecipe.label'))}</div><div class="desc">${esc(tr('settings.importRecipe.desc'))}</div></div>
      <textarea id="recipeImportText" placeholder="${esc(tr('settings.importRecipe.placeholder'))}" style="margin-top:8px;min-height:96px"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost sm" id="btnImportRecipeText">${esc(tr('settings.importRecipe.submit'))}</button>
        <button class="btn ghost sm" id="btnImportRecipeFile">${esc(tr('settings.importRecipe.file'))}</button>
        <input type="file" id="recipeImportFile" accept="application/json,.json" class="hidden"></div></div>
    <div style="text-align:center;color:var(--muted);font-size:12px;margin-top:14px">${esc(tr('settings.footer'))}</div>`;

  box.querySelectorAll('[data-k]').forEach(x => { x.previousElementSibling.onclick = () => { const k = x.dataset.k; settings[k] = k === 'theme' ? (settings.theme === 'dark' ? 'light' : 'dark') : !settings[k]; saveSettings(); applyTheme(); renderSettings(); }; });
  box.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { settings.fontScale = Math.min(1.5, Math.max(0.85, settings.fontScale + (b.dataset.fs === '+' ? 0.1 : -0.1))); saveSettings(); applyTheme(); renderSettings(); });
  box.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { settings.ttsRate = Math.min(1.6, Math.max(0.6, settings.ttsRate + (b.dataset.tr === '+' ? 0.1 : -0.1))); saveSettings(); renderSettings(); });
  $('#setDepth').querySelectorAll('.chip').forEach(c => c.onclick = () => { settings.depth = c.dataset.d; depth = c.dataset.d; saveSettings(); renderSettings(); syncDepthChips(); });
  $('#uiLang').onchange = (e) => { setLanguage(e.target.value); saveSettings(); applyStaticI18n(); renderAll(); renderSettings(); toast(tr('settings.language.saved')); };
  $('#apiBase').onchange = (e) => { settings.apiBase = e.target.value.trim().replace(/\/$/, ''); saveSettings(); toast(tr('settings.backend.saved')); refresh(); };
  $('#apiToken').onchange = (e) => { settings.apiToken = e.target.value.trim(); saveSettings(); toast(tr('settings.token.saved')); refresh(); };
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
  const ov = openModal(`<h3 style="text-align:left">${esc(tr('settings.backendSetup.title'))}</h3>
    <p style="color:var(--muted);text-align:left;margin-bottom:12px">${esc(tr('settings.backendSetup.desc'))}</p>
    <input type="text" id="setupApiBase" inputmode="url" placeholder="${esc(tr('settings.backend.placeholder'))}" style="margin-bottom:8px">
    <input type="password" id="setupApiToken" placeholder="${esc(tr('settings.token.label'))}">
    <div class="mrow"><button class="btn ghost" id="setupLater">${esc(tr('settings.backendSetup.later'))}</button><button class="btn" id="setupSave">${esc(tr('settings.backendSetup.connect'))}</button></div>`, 'left');
  ov.querySelector('#setupLater').onclick = () => ov.remove();
  ov.querySelector('#setupSave').onclick = () => {
    const base = ov.querySelector('#setupApiBase').value.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(base)) { toast(tr('error.backendUrl')); return; }
    settings.apiBase = base;
    settings.apiToken = ov.querySelector('#setupApiToken').value.trim();
    saveSettings();
    ov.remove();
    toast(tr('settings.backend.saved'));
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
  const ov = openModal(`<h3 style="text-align:left">${esc(tr('tag.edit.title'))}</h3>
    <input type="text" id="tagEditInput" placeholder="${esc(tr('tag.edit.placeholder'))}" value="${esc((r.tags || []).join(settings.lang === 'en' ? ', ' : '、'))}">
    <div id="tagEditPreview" class="tags" style="margin-top:10px"></div>
    <div class="mrow"><button class="btn ghost" id="tagCancel">${esc(tr('common.cancel'))}</button><button class="btn" id="tagSave">${esc(tr('tag.edit.save'))}</button></div>`, 'left');
  const draw = () => {
    const tags = parseTagsText(ov.querySelector('#tagEditInput').value);
    ov.querySelector('#tagEditPreview').innerHTML = tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') || `<span style="color:var(--muted);font-size:13px">${esc(tr('tag.edit.empty'))}</span>`;
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
      toast(tr('tag.saved'));
    } catch (e) { toast(tr('tag.saveFailed', { message: e.message })); }
  };
}
function openDetail(r, focusStepIndex = null) {
  const m = rmeta(r.id);
  const base = baseServings(r);
  let factor = m.servingsFactor || 1;
  let batchFactor = m.batchFactor || 1;
  const phaseGroups = recipePhaseGroups(r);
  const hasPhases = phaseGroups.hasPhases;
  const importedNeedsWhy = !!r.imported && !hasRecipeWhy(r);
  const p = el(`<div class="page">
    <div class="topbar">
      <button class="back">${esc(tr('detail.back'))}</button>
      <div style="display:flex;gap:4px">
        <button class="iconbtn" id="dPrint" title="${esc(tr('detail.print'))}">🖨</button>
        <button class="iconbtn" id="dEdit" title="${esc(tr('detail.edit'))}">✏️</button>
        <button class="iconbtn" id="dShare" title="${esc(tr('detail.share'))}">↗</button>
        <button class="iconbtn" id="dDel" title="${esc(tr('detail.delete'))}">🗑</button>
        <button class="star ${favRecipes.includes(r.id) ? 'on' : ''}" id="dfav">${favRecipes.includes(r.id) ? '★' : '☆'}</button>
      </div>
    </div>
    <div class="print-head"><h1>${esc(r.title || tr('recipe.untitled'))}</h1>${r.source ? `<p>${esc(tr('detail.source', { source: r.source }))}</p>` : ''}</div>
    <div class="detail-hd"><h2>${esc(r.title || tr('recipe.untitled'))}</h2>
      <div class="meta">
        ${r.difficulty ? `<span class="tag diff-${esc(r.difficulty)}">${esc(difficultyLabel(r.difficulty))}</span>` : ''}
        ${r.cuisine ? `<span>${esc(r.cuisine)}</span>` : ''}
        ${r.total_time_min ? `<span>${esc(tr('recipe.time.approxMin', { min: r.total_time_min }))}</span>` : ''}
        <span>${esc(tr('recipe.steps', { count: (r.steps || []).length }))}</span>
        ${/^https?:\/\//.test(r.source || '') ? `<a class="src-link" href="${esc(r.source)}" target="_blank" rel="noopener">${esc(tr('detail.watchOriginal'))}</a>` : ''}</div>
      ${(r.tags || []).length ? `<div class="tags" style="margin-top:8px">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    ${!hasPhases && base ? `<div class="scaler"><span>${esc(tr('detail.servings'))}</span><button class="st" data-s="-">－</button><b id="svVal">${base * factor}</b><button class="st" data-s="+">＋</button><span>${esc(tr('detail.servingsUnit'))}</span></div>` : ''}
    <div class="no-print" style="display:flex;gap:8px;padding:8px 16px 0;flex-wrap:wrap">
      <button class="btn ghost sm" id="btnOverview">${esc(tr('detail.overview'))}</button>
      <button class="btn ghost sm" id="btnNutri">${esc(tr('detail.nutrition'))}</button>
      ${!hasOwnToolsField(r) ? `<button class="btn ghost sm" id="btnTools">${esc(tr('detail.tools.addAi'))}</button>` : ''}
      <button class="btn ghost sm" id="btnCookbooks">${esc(tr('cookbooks.detail.button'))}</button>
      <button class="btn ghost sm" id="btnTags">${esc(tr('detail.tags'))}</button>
      <button class="btn ghost sm" id="btnExport2">${esc(tr('detail.export'))}</button>
    </div>
    ${r.imported ? `<div class="import-note"><span>${esc(tr(importedNeedsWhy ? 'detail.imported.noWhy' : 'detail.imported.withWhy'))}</span>${importedNeedsWhy ? `<button class="btn ghost sm" id="btnImportExplain">${esc(tr('detail.imported.explain'))}</button>` : ''}</div>` : ''}
    <div id="aiBox" style="margin:8px 16px 0"></div>
    <div id="nutritionBox"></div>
    ${hasPhases ? `<div id="toolsBox">${toolsCardHtml(r)}</div>
    <div class="phase-tabs no-print">
      <a href="#phase-batch">${esc(tr('detail.phase.batchTab'))}</a>
      <a href="#phase-serving">${esc(tr('detail.phase.servingTab'))}</a>
    </div>
    <div class="phase-head" id="phase-batch">
      <div><b>${esc(tr('detail.phase.batchTitle'))}</b>${batchInfoText(r, batchFactor) ? `<span>${esc(batchInfoText(r, batchFactor))}</span>` : ''}</div>
      <span class="act" id="addShop">${esc(tr('detail.addShopping'))}</span>
    </div>
    <div class="phase-scale"><span>${esc(tr('detail.phase.batchScale'))}</span><button class="bst" data-s="-">－</button><b id="batchVal">${Math.round(batchFactor * 10) / 10}</b><button class="bst" data-s="+">＋</button></div>
    <div class="ing" id="batchIngBox"></div>
    <div class="sec-title">${esc(tr('detail.stepsOverview'))}</div>
    <div id="batchSteps"></div>
    <div class="phase-head" id="phase-serving">
      <div><b>${esc(tr('detail.phase.servingTitle'))}</b>${r.batch_info?.serving_desc ? `<span>${esc(r.batch_info.serving_desc)}</span>` : ''}</div>
    </div>
    ${base ? `<div class="phase-scale"><span>${esc(tr('detail.phase.servingScale'))}</span><button class="st" data-s="-">－</button><b id="svVal">${Math.round(base * factor * 10) / 10}</b><button class="st" data-s="+">＋</button><span>${esc(tr('detail.phase.servingUnit'))}</span></div>` : ''}
    <div class="ing" id="servingIngBox"></div>
    <div class="sec-title">${esc(tr('detail.stepsOverview'))}</div>
    <div id="servingSteps"></div>` : `<div class="sec-title">${esc(tr('detail.ingredients'))} <span class="act" id="addShop">${esc(tr('detail.addShopping'))}</span></div>
    <div class="ing" id="ingBox"></div>
    <div id="toolsBox">${toolsCardHtml(r)}</div>
    <div class="sec-title">${esc(tr('detail.stepsOverview'))}</div>
    <div id="steps"></div>`}
    <div class="sec-title no-print">${esc(tr('detail.notes'))}</div>
    <div class="notes"><textarea id="notes" placeholder="${esc(tr('detail.notes.placeholder'))}">${esc(m.notes || '')}</textarea></div>
    <div class="sec-title no-print">${esc(tr('detail.cookedRating'))}</div>
    <div class="no-print" style="display:flex;align-items:center;gap:14px;margin:0 16px 4px">
      <button class="btn ${m.cooked ? '' : 'ghost'} sm" id="cookedBtn">${esc(m.cooked ? tr('detail.cooked') : tr('detail.markCooked'))}</button>
      <div class="rating" id="rating">${[1, 2, 3, 4, 5].map(n => `<span class="rs ${m.rating >= n ? 'on' : ''}" data-r="${n}">★</span>`).join('')}</div>
    </div>
    <div class="cta"><button class="btn ghost" id="btnBack2">${esc(tr('detail.back').replace(/^‹\s*/, ''))}</button><button class="btn" id="btnCook">${esc(tr('detail.startCook'))}</button></div>`);

  function renderIngList(entries, selector, scale) {
    const checked = new Set(m.ingChecked || []);
    const box = p.querySelector(selector);
    if (!box) return;
    box.innerHTML = entries.map(({ item: i, idx }) => {
      const amount = scaledAmount(i, scale) || tr('detail.amountUnknown');
      return `
      <div class="irow ${checked.has(idx) ? 'checked' : ''}" data-i="${idx}">
        <div class="ck ${checked.has(idx) ? 'on' : ''}">${checked.has(idx) ? '✓' : ''}</div>
        ${i.image ? `<img class="ingthumb" data-zoom src="${esc(recipeImg(r.id, i.image))}" alt="${esc(i.name)}" loading="lazy" onerror="this.remove()">` : ''}
        <span class="name">${esc(i.name)}${i.note ? `<span class="amt">（${esc(i.note)}）</span>` : ''}</span>
        <span class="amt">${esc(amount)}${unitTipButtonHtml(`${amount} ${i.unit || ''}`)}</span>
        <button class="btn ghost sm" data-sub="${esc(i.name)}">${esc(tr('detail.substitute'))}</button>
      </div>`;
    }).join('') || `<div class="irow"><span class="name">${esc(tr('detail.noIngredients'))}</span></div>`;
    box.querySelectorAll('.irow').forEach(row => {
      row.onclick = (e) => {
        if (e.target.dataset.sub !== undefined || e.target.closest('.unit-tip,.unit-pop')) return;
        const idx = +row.dataset.i; const set = new Set(m.ingChecked || []);
        set.has(idx) ? set.delete(idx) : set.add(idx); m.ingChecked = [...set]; saveMeta(); renderIng();
      };
    });
    p.querySelectorAll('[data-sub]').forEach(b => b.onclick = async (e) => { e.stopPropagation(); await showSubstitute(r, b.dataset.sub); });
    p.querySelectorAll('[data-unit-tip]').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const row = b.closest('.irow');
      const html = unitReferencePopHtml(b.dataset.unitTip);
      const existed = row && row.querySelector('.unit-pop');
      closeUnitBubbles(p);
      if (!row || existed || !html) return;
      row.appendChild(el(html));
      row.querySelector('.unit-pop-x').onclick = (ev) => { ev.stopPropagation(); closeUnitBubbles(p); };
    });
    wireZoom(box);
  }
  function renderIng() {
    if (hasPhases) {
      renderIngList(phaseGroups.ingredients.batch, '#batchIngBox', batchFactor);
      renderIngList(phaseGroups.ingredients.serving, '#servingIngBox', factor);
      const title = p.querySelector('#phase-batch div span');
      if (title) title.textContent = batchInfoText(r, batchFactor);
    } else {
      renderIngList(phaseGroups.ingredients.batch, '#ingBox', factor);
    }
  }
  renderIng();
  p.addEventListener('click', (e) => { if (!e.target.closest('.unit-tip,.unit-pop')) closeUnitBubbles(p); });

  function renderStepList(entries, selector) {
    const stepsBox = p.querySelector(selector);
    if (!stepsBox) return;
    stepsBox.innerHTML = '';
    entries.forEach(({ item: s }) => {
    const segUrl = sourceSegmentUrl(r.source, s.source_time);
    stepsBox.appendChild(el(`<div class="stepmini" data-step-index="${esc(s.index)}">
      ${s.image ? `<img class="mthumb" data-zoom src="${esc(recipeImg(r.id, s.image))}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div class="t"><span class="n">${s.index}</span>${esc(s.title || '')}${riskBadge(s.risk_level)}</div>
      <div class="a">${esc(s.action || '')}</div>
      ${stepWhyPrintHtml(s)}
      ${segUrl ? `<a class="step-video-link" href="${esc(segUrl)}" target="_blank" rel="noopener">${esc(tr('detail.watchSegment'))}</a>` : ''}</div>`));
    });
    wireZoom(stepsBox);
  }
  if (hasPhases) {
    renderStepList(phaseGroups.steps.batch, '#batchSteps');
    renderStepList(phaseGroups.steps.serving, '#servingSteps');
  } else {
    renderStepList(phaseGroups.steps.batch, '#steps');
  }

  const close = () => p.remove();
  p.querySelector('.back').onclick = close;
  p.querySelector('#btnBack2').onclick = close;
  p.querySelector('#dfav').onclick = (e) => { toggleRecipe(r.id); const on = favRecipes.includes(r.id); e.target.className = 'star ' + (on ? 'on' : ''); e.target.textContent = on ? '★' : '☆'; renderRecipes(); renderFilters(); };
  p.querySelector('#dDel').onclick = async () => { if (!(await confirmModal(tr('detail.delete.confirm'), tr('common.delete')))) return; try { await API.del(r.id); } catch { } close(); refresh(); toast(tr('detail.deleted')); };
  p.querySelector('#dPrint').onclick = () => window.print();
  p.querySelector('#dEdit').onclick = () => { close(); openEdit(r); };
  const currentFactors = () => hasPhases ? { batchFactor, servingFactor: factor } : factor;
  p.querySelector('#dShare').onclick = () => shareRecipe(r, currentFactors());
  p.querySelector('#addShop').onclick = () => addToShopping(r, currentFactors());
  const aiBox = p.querySelector('#aiBox');
  function renderNutrition() {
    p.querySelector('#nutritionBox').innerHTML = nutritionHtml(r, factor);
  }
  function renderTools() {
    p.querySelector('#toolsBox').innerHTML = toolsCardHtml(r);
  }
  renderNutrition();
  renderTools();
  const aiCall = async (btn, fn, title, key) => {
    btn.disabled = true;
    let node = aiBox.querySelector(`[data-ai="${key}"]`);
    if (!node) {
      node = el(`<div class="qa" data-ai="${key}" style="border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:8px;position:relative">
        <button class="ai-x" title="${esc(tr('common.close'))}" style="position:absolute;top:6px;right:8px;color:var(--muted);font-size:16px;padding:4px 6px">✕</button>
        <div class="q" style="font-weight:600;margin-bottom:6px;padding-right:22px">${title}</div>
        <div class="a" style="color:var(--muted);white-space:pre-wrap">${esc(tr('detail.ai.thinking'))}</div></div>`);
      node.querySelector('.ai-x').onclick = () => node.remove();
      aiBox.appendChild(node);
    } else { node.querySelector('.a').textContent = tr('detail.ai.thinking'); }
    try { const { answer } = await fn(); node.querySelector('.a').textContent = answer; }
    catch (e) { node.querySelector('.a').textContent = tr('detail.ai.failed', { message: e.message }); }
    btn.disabled = false;
  };
  p.querySelector('#btnOverview').onclick = (e) => aiCall(e.currentTarget, () => API.overview(r.id), tr('detail.overview'), 'overview');
  p.querySelector('#btnCookbooks').onclick = () => showCookbookPicker(r);
  p.querySelector('#btnTags').onclick = () => editRecipeTags(r, (nextTags) => {
    r.tags = nextTags;
    recipes = recipes.map(x => x.id === r.id ? { ...x, tags: nextTags } : x);
    renderRecipes(); renderFilters();
    close(); openDetail(r);
  });
  const importExplainBtn = p.querySelector('#btnImportExplain');
  if (importExplainBtn) importExplainBtn.onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = tr('detail.imported.explaining');
    try {
      const data = await API.explainRecipe(r.id, depth);
      Object.assign(r, data.recipe || {});
      recipes = recipes.map(x => x.id === r.id ? r : x);
      toast(tr('detail.explainDone'));
      close(); openDetail(r);
    } catch (err) {
      btn.disabled = false; btn.textContent = tr('detail.imported.explain');
      toast(tr('detail.explainFailed', { message: err.message }));
    }
  };
  const toolsBtn = p.querySelector('#btnTools');
  if (toolsBtn) toolsBtn.onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = tr('detail.tools.adding');
    try {
      const data = await API.tools(r.id);
      Object.assign(r, data.recipe || { tools: data.tools || [] });
      recipes = recipes.map(x => x.id === r.id ? r : x);
      renderTools();
      btn.remove();
      toast(data.cached ? tr('detail.toolsCached') : tr('detail.toolsGenerated'));
    } catch (err) {
      btn.disabled = false; btn.textContent = tr('detail.tools.addAi');
      toast(tr('detail.toolsFailed', { message: err.message }));
    }
  };
  p.querySelector('#btnNutri').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    p.querySelector('#nutritionBox').innerHTML = `<div class="nutrition-card"><div class="nutrition-title">${esc(tr('nutrition.title'))} <span>${esc(tr('detail.nutrition.loading'))}</span></div></div>`;
    try {
      const data = await API.nutrition(r.id);
      r.nutrition = data.nutrition;
      renderNutrition();
      toast(data.cached ? tr('detail.nutritionCached') : tr('detail.nutritionGenerated'));
    } catch (err) {
      p.querySelector('#nutritionBox').innerHTML = `<div class="nutrition-card"><div class="nutrition-note">${esc(tr('detail.nutritionFailed', { message: err.message }))}</div></div>`;
    }
    btn.disabled = false;
  };
  p.querySelector('#btnExport2').onclick = () => openExport(r, currentFactors());
  p.querySelector('#btnCook').onclick = () => { close(); openCook(r); };
  p.querySelector('#notes').oninput = (e) => { m.notes = e.target.value; saveMeta(); };
  p.querySelector('#cookedBtn').onclick = (e) => { m.cooked = !m.cooked; if (m.cooked) m.cooked_at = new Date().toISOString(); saveMeta(); e.target.className = 'btn sm ' + (m.cooked ? '' : 'ghost'); e.target.textContent = m.cooked ? tr('detail.cooked') : tr('detail.markCooked'); renderRecipes(); };
  p.querySelectorAll('#rating .rs').forEach(rs => rs.onclick = () => { m.rating = +rs.dataset.r; saveMeta(); p.querySelectorAll('#rating .rs').forEach(x => x.classList.toggle('on', +x.dataset.r <= m.rating)); renderRecipes(); });
  if (base) p.querySelectorAll('.st').forEach(b => b.onclick = () => { factor = Math.max(0.5, factor + (b.dataset.s === '+' ? 0.5 : -0.5)); m.servingsFactor = factor; saveMeta(); p.querySelector('#svVal').textContent = Math.round(base * factor * 10) / 10; renderIng(); renderNutrition(); });
  if (hasPhases) p.querySelectorAll('.bst').forEach(b => b.onclick = () => {
    batchFactor = Math.max(0.5, batchFactor + (b.dataset.s === '+' ? 0.5 : -0.5));
    m.batchFactor = batchFactor;
    saveMeta();
    p.querySelector('#batchVal').textContent = Math.round(batchFactor * 10) / 10;
    renderIng();
  });

  $('#app').appendChild(p);
  if (focusStepIndex != null) setTimeout(() => {
    const node = Array.from(p.querySelectorAll('[data-step-index]')).find(x => x.dataset.stepIndex === String(focusStepIndex));
    if (node) { node.classList.add('focus-step'); node.scrollIntoView({ block: 'center' }); }
  }, 30);
}
function riskBadge(r) { return r === 'high' ? ` <span class="badge risk-high">${esc(tr('risk.high'))}</span>` : r === 'medium' ? ` <span class="badge risk-medium">${esc(tr('risk.medium'))}</span>` : ''; }
function stepWhyPrintHtml(s) {
  const w = s?.why || {};
  const rows = [
    [tr('why.reason'), w.reason],
    [tr('why.ifNot'), w.if_not],
    [tr('why.cue'), w.cue],
  ].filter(([, value]) => String(value || '').trim());
  if (!rows.length) return '';
  return `<div class="print-why">${rows.map(([label, value]) => `<p><b>${label}：</b>${esc(value)}</p>`).join('')}</div>`;
}
// 跟做走到最后一步 → 闭环：自动记「做过」，顺手引导打分（做完正是最该沉淀的节点）。
function finishCook(r) {
  const m = rmeta(r.id);
  if (!m.cooked) { m.cooked = true; m.cooked_at = new Date().toISOString(); }
  saveMeta(); renderRecipes();
  const stars = [1, 2, 3, 4, 5].map(n => `<span class="rs ${m.rating >= n ? 'on' : ''}" data-r="${n}">★</span>`).join('');
  const ov = openModal(`<h3>${esc(tr('cook.finish.title'))}</h3>
    <p style="color:var(--muted)">${esc(tr('cook.finish.desc'))}</p>
    <div class="rating" style="justify-content:center;font-size:30px;margin:8px 0 2px">${stars}</div>
    <div class="mrow"><button class="btn ghost" id="finishSkip">${esc(tr('cook.finish.skip'))}</button></div>`, 'finish');
  ov.querySelectorAll('.rs').forEach(rs => rs.onclick = () => {
    m.rating = +rs.dataset.r; saveMeta(); renderRecipes();
    ov.querySelectorAll('.rs').forEach(x => x.classList.toggle('on', +x.dataset.r <= m.rating));
    toast(tr('detail.ratingSaved', { stars: '★'.repeat(m.rating) })); setTimeout(() => ov.remove(), 350);
  });
  ov.querySelector('#finishSkip').onclick = () => ov.remove();
}

/* ================= 编辑菜谱（修正 AI 的错误）================= */
function openEdit(r) {
  const d = JSON.parse(JSON.stringify(r)); // 深拷贝，取消即丢弃
  const hadTools = hasOwnToolsField(r);
  d.ingredients = Array.isArray(d.ingredients) ? d.ingredients : [];
  d.steps = Array.isArray(d.steps) ? d.steps : [];
  d.tags = Array.isArray(d.tags) ? d.tags : [];
  d.tools = Array.isArray(d.tools) ? d.tools : [];
  const fld = 'border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:10px 12px;font-size:15px;color:var(--ink);font-family:inherit;width:100%';
  const p = el(`<div class="page">
    <div class="topbar">
      <button class="back">${esc(tr('edit.cancel'))}</button>
      <button class="btn sm" id="eSave">${esc(tr('edit.save'))}</button>
    </div>
    <div class="detail-hd"><h2 style="font-size:22px">${esc(tr('edit.title'))}</h2>
      <div class="meta">${esc(tr('edit.desc'))}</div></div>

    <div class="sec-title">${esc(tr('edit.basicInfo'))}</div>
    <div style="padding:0 16px;display:flex;flex-direction:column;gap:8px">
      <input type="text" id="eTitle" placeholder="${esc(tr('edit.recipeTitle.placeholder'))}" value="${esc(d.title || '')}">
      <div style="display:flex;gap:8px">
        <input type="text" id="eServings" placeholder="${esc(tr('edit.servings.placeholder'))}" value="${esc(d.servings || '')}" style="flex:1;min-width:0">
        <input type="text" id="eTime" inputmode="numeric" placeholder="${esc(tr('edit.totalTime.placeholder'))}" value="${esc(d.total_time_min || '')}" style="width:130px">
      </div>
      <div style="display:flex;gap:8px">
        <select id="eDiff" style="${fld};flex:1">
          <option value="easy" ${d.difficulty === 'easy' ? 'selected' : ''}>${esc(tr('difficulty.easy'))}</option>
          <option value="medium" ${d.difficulty === 'medium' || !d.difficulty ? 'selected' : ''}>${esc(tr('difficulty.medium'))}</option>
          <option value="hard" ${d.difficulty === 'hard' ? 'selected' : ''}>${esc(tr('difficulty.hard'))}</option>
        </select>
        <input type="text" id="eCuisine" placeholder="${esc(tr('edit.cuisine.placeholder'))}" value="${esc(d.cuisine || '')}" style="flex:1;min-width:0">
      </div>
      <input type="text" id="eTags" placeholder="${esc(tr('edit.tags.placeholder'))}" value="${esc(d.tags.join('、'))}">
    </div>

    <div class="sec-title">${esc(tr('detail.ingredients'))} <span class="act" id="eAddIng">${esc(tr('edit.ingredients.add'))}</span></div>
    <div id="eIng" style="padding:0 16px;display:flex;flex-direction:column;gap:6px"></div>

    <div class="sec-title">${esc(tr('detail.tools.title'))} <span class="act" id="eAddTool">${esc(tr('edit.tools.add'))}</span></div>
    <div id="eTools" style="padding:0 16px;display:flex;flex-direction:column;gap:8px"></div>

    <div class="sec-title">${esc(tr('detail.stepsOverview'))} <span class="act" id="eAddStep">${esc(tr('edit.steps.add'))}</span></div>
    <div id="eSteps" style="padding:0 16px;display:flex;flex-direction:column;gap:14px"></div>

    <div class="cta"><button class="btn ghost" id="eCancel">${esc(tr('common.cancel'))}</button><button class="btn" id="eSave2">${esc(tr('common.save'))}</button></div>`);

  function renderIng() {
    const box = p.querySelector('#eIng');
    box.innerHTML = d.ingredients.map((i, idx) => `
      <div style="display:flex;gap:6px;align-items:center" data-i="${idx}">
        <input type="text" class="fName" placeholder="${esc(tr('edit.ingredient.placeholder'))}" value="${esc(i.name || '')}" style="${fld};flex:2">
        <input type="text" class="fAmt" placeholder="${esc(tr('edit.amount.placeholder'))}" value="${esc(i.amount || '')}" style="${fld};flex:1;min-width:0">
        <button class="iconbtn fUp" title="${esc(tr('common.moveUp'))}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="iconbtn fDown" title="${esc(tr('common.moveDown'))}" ${idx === d.ingredients.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="iconbtn fDel" title="${esc(tr('common.delete'))}">🗑</button>
      </div>`).join('') || `<div style="color:var(--muted);font-size:13px">${esc(tr('edit.noIngredients'))}</div>`;
    box.querySelectorAll('[data-i]').forEach(row => {
      const idx = +row.dataset.i;
      row.querySelector('.fName').oninput = (e) => d.ingredients[idx].name = e.target.value;
      row.querySelector('.fAmt').oninput = (e) => { d.ingredients[idx].amount = e.target.value; delete d.ingredients[idx].qty; delete d.ingredients[idx].unit; };
      row.querySelector('.fUp').onclick = () => { d.ingredients = moveItem(d.ingredients, idx, idx - 1); renderIng(); };
      row.querySelector('.fDown').onclick = () => { d.ingredients = moveItem(d.ingredients, idx, idx + 1); renderIng(); };
      row.querySelector('.fDel').onclick = async () => { if (!(await confirmModal(tr('edit.deleteIngredient.confirm'), tr('common.delete')))) return; d.ingredients = removeItem(d.ingredients, idx); renderIng(); };
    });
  }
  function renderToolsEdit() {
    const box = p.querySelector('#eTools');
    box.innerHTML = d.tools.map((t, idx) => `
      <div class="stepmini" style="padding:12px;margin:0" data-t="${idx}">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
          <input type="text" class="tName" placeholder="${esc(tr('edit.toolName.placeholder'))}" value="${esc(t.name || '')}" style="${fld};flex:2">
          <input type="text" class="tPurpose" placeholder="${esc(tr('edit.toolPurpose.placeholder'))}" value="${esc(t.purpose || '')}" style="${fld};flex:3;min-width:0">
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
          <input type="text" class="tSub" placeholder="${esc(tr('edit.toolSubstitute.placeholder'))}" value="${esc(t.substitute || '')}" style="${fld};flex:1;min-width:0">
          <input type="text" class="tNote" placeholder="${esc(tr('edit.toolNote.placeholder'))}" value="${esc(t.substitute_note || '')}" style="${fld};flex:1;min-width:0">
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="display:flex;gap:12px;color:var(--muted);font-size:13px;flex-wrap:wrap">
            <label><input type="checkbox" class="tEssential" ${t.essential ? 'checked' : ''}> ${esc(tr('edit.toolEssential'))}</label>
            <label><input type="checkbox" class="tInferred" ${t.inferred ? 'checked' : ''}> ${esc(tr('edit.toolInferred'))}</label>
          </span>
          <span style="display:flex;gap:2px">
            <button class="iconbtn tUp" title="${esc(tr('common.moveUp'))}" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="iconbtn tDown" title="${esc(tr('common.moveDown'))}" ${idx === d.tools.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="iconbtn tDel" title="${esc(tr('common.delete'))}">🗑</button>
          </span>
        </div>
      </div>`).join('') || `<div style="color:var(--muted);font-size:13px">${esc(tr('edit.noTools'))}</div>`;
    box.querySelectorAll('[data-t]').forEach(row => {
      const idx = +row.dataset.t, t = d.tools[idx];
      row.querySelector('.tName').oninput = (e) => t.name = e.target.value;
      row.querySelector('.tPurpose').oninput = (e) => t.purpose = e.target.value;
      row.querySelector('.tSub').oninput = (e) => t.substitute = e.target.value;
      row.querySelector('.tNote').oninput = (e) => t.substitute_note = e.target.value;
      row.querySelector('.tEssential').onchange = (e) => t.essential = e.target.checked;
      row.querySelector('.tInferred').onchange = (e) => t.inferred = e.target.checked;
      row.querySelector('.tDel').onclick = async () => { if (!(await confirmModal(tr('edit.deleteTool.confirm'), tr('common.delete')))) return; d.tools = removeItem(d.tools, idx); renderToolsEdit(); };
      row.querySelector('.tUp').onclick = () => { d.tools = moveItem(d.tools, idx, idx - 1); renderToolsEdit(); };
      row.querySelector('.tDown').onclick = () => { d.tools = moveItem(d.tools, idx, idx + 1); renderToolsEdit(); };
    });
  }
  function renderSteps() {
    const box = p.querySelector('#eSteps');
    box.innerHTML = d.steps.map((s, idx) => `
      <div class="stepmini" style="padding:12px" data-s="${idx}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>${esc(tr('edit.stepNo', { n: idx + 1 }))}</b>
          <span style="display:flex;gap:2px">
            <button class="iconbtn sUp" title="${esc(tr('common.moveUp'))}" ${idx === 0 ? 'disabled' : ''}>↑</button>
            <button class="iconbtn sDown" title="${esc(tr('common.moveDown'))}" ${idx === d.steps.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="iconbtn sDel" title="${esc(tr('common.delete'))}">🗑</button>
          </span>
        </div>
        <input type="text" class="sTitle" placeholder="${esc(tr('edit.stepTitle.placeholder'))}" value="${esc(s.title || '')}" style="${fld};margin-bottom:6px">
        <textarea class="sAction" placeholder="${esc(tr('edit.stepAction.placeholder'))}" style="${fld};min-height:56px;margin-bottom:6px">${esc(s.action || '')}</textarea>
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="text" class="sHeat" placeholder="${esc(tr('edit.heat.placeholder'))}" value="${esc(s.params?.heat || '')}" style="${fld};flex:1;min-width:0">
          <input type="text" class="sTime" placeholder="${esc(tr('edit.time.placeholder'))}" value="${esc(s.params?.time || '')}" style="${fld};flex:1;min-width:0">
        </div>
        <textarea class="sReason" placeholder="${esc(tr('edit.reason.placeholder'))}" style="${fld};min-height:56px">${esc(s.why?.reason || '')}</textarea>
      </div>`).join('') || `<div style="color:var(--muted);font-size:13px">${esc(tr('edit.noSteps'))}</div>`;
    box.querySelectorAll('[data-s]').forEach(row => {
      const idx = +row.dataset.s, s = d.steps[idx];
      row.querySelector('.sTitle').oninput = (e) => s.title = e.target.value;
      row.querySelector('.sAction').oninput = (e) => s.action = e.target.value;
      row.querySelector('.sHeat').oninput = (e) => (s.params = s.params || {}).heat = e.target.value;
      row.querySelector('.sTime').oninput = (e) => (s.params = s.params || {}).time = e.target.value;
      row.querySelector('.sReason').oninput = (e) => (s.why = s.why || {}).reason = e.target.value;
      row.querySelector('.sDel').onclick = async () => { if (!(await confirmModal(tr('edit.deleteStep.confirm'), tr('common.delete')))) return; d.steps = removeItem(d.steps, idx); renderSteps(); };
      row.querySelector('.sUp').onclick = () => { d.steps = moveItem(d.steps, idx, idx - 1); renderSteps(); };
      row.querySelector('.sDown').onclick = () => { d.steps = moveItem(d.steps, idx, idx + 1); renderSteps(); };
    });
  }
  renderIng(); renderToolsEdit(); renderSteps();
  p.querySelector('#eAddIng').onclick = () => { d.ingredients = insertItem(d.ingredients, d.ingredients.length, { name: '', amount: '', note: '' }); renderIng(); };
  p.querySelector('#eAddTool').onclick = () => { d.tools = insertItem(d.tools, d.tools.length, { name: '', purpose: '', essential: true, substitute: null, substitute_note: '', inferred: false }); renderToolsEdit(); };
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
    d.tools = d.tools.filter(t => (t.name || '').trim()).map(t => ({
      name: String(t.name || '').trim(),
      purpose: String(t.purpose || '').trim(),
      essential: !!t.essential,
      substitute: String(t.substitute || '').trim() || null,
      substitute_note: String(t.substitute_note || '').trim(),
      inferred: !!t.inferred,
    }));
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
    if (hadTools || d.tools.length) patch.tools = d.tools;
    try {
      const res = await F('/api/recipes/' + encodeURIComponent(r.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('HTTP ' + res.status));
      toast(tr('edit.saved')); close();
      recipes = await API.list(); renderAll();
      const found = recipes.find(x => x.id === r.id) || recipes.find(x => x.title === d.title);
      if (found) openDetail(found);
    } catch (e) { toast(tr('edit.saveFailed', { message: e.message })); }
  }
  p.querySelector('#eSave').onclick = save;
  p.querySelector('#eSave2').onclick = save;
  $('#app').appendChild(p);
}

async function showSubstitute(r, ingredient) {
  const title = tr('substitute.title', { ingredient });
  const ov = openModal(`<h3>${esc(title)}</h3><p style="color:var(--muted)">${esc(tr('substitute.thinking'))}</p>`);
  const setLoading = () => { ov.querySelector('.modal').innerHTML = `<h3>${esc(title)}</h3><p style="color:var(--muted)">${esc(tr('substitute.thinking'))}</p>`; };
  const render = ({ answer, cached }) => {
    ov.querySelector('.modal').innerHTML = `<h3>${esc(title)}</h3><p style="white-space:pre-wrap;text-align:left">${esc(answer)}</p>
      ${cached ? `<div style="color:var(--muted);font-size:12px;margin-top:12px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap"><span>${esc(tr('substitute.cached'))}</span><span>·</span><button class="btn ghost sm" id="regenSub">${esc(tr('substitute.regenerate'))}</button></div>` : ''}
      <div class="mrow"><button class="btn" id="ok">${esc(tr('substitute.ok'))}</button></div>`;
    ov.querySelector('#ok').onclick = () => ov.remove();
    const regen = ov.querySelector('#regenSub');
    if (regen) regen.onclick = () => load(true);
  };
  async function load(force = false) {
    if (force) setLoading();
    try { render(await API.substitute(r.id, ingredient, { force })); }
    catch (e) { ov.querySelector('.modal').innerHTML = `<p>${esc(tr('substitute.failed', { message: e.message }))}</p><div class="mrow"><button class="btn" id="ok">${esc(tr('common.close'))}</button></div>`; ov.querySelector('#ok').onclick = () => ov.remove(); }
  }
  await load(false);
}
function shareRecipe(r, factor) {
  const md = recipeToText(r, factor);
  if (navigator.share) navigator.share({ title: r.title, text: md }).catch(() => { });
  else { navigator.clipboard?.writeText(md); toast(tr('export.text.copied')); }
}
function recipeToText(r, f) {
  let s = tr('export.body.title', { title: r.title || '' });
  s += (r.ingredients || []).map(i => `· ${i.name} ${scaledIngredientAmount(i, f || 1) || ''}`).join('\n') + '\n\n';
  const tools = recipeTools(r);
  if (tools.length) {
    s += `${tr('detail.tools.title')}\n`;
    tools.forEach(t => {
      const badges = [t.essential && tr('detail.tools.essential'), t.inferred && tr('detail.tools.inferred')].filter(Boolean).join(' / ');
      s += `· ${t.name}${t.purpose ? `：${t.purpose}` : ''}${badges ? `（${badges}）` : ''}\n`;
      if (t.substitute) s += `   ${tr('detail.tools.substitute', { substitute: t.substitute })}${t.substitute_note ? `；${tr('detail.tools.note', { note: t.substitute_note })}` : ''}\n`;
      else s += `   ${tr('detail.tools.noSubstitute')}${t.substitute_note ? `；${tr('detail.tools.noSubstituteReason', { reason: t.substitute_note })}` : ''}\n`;
    });
    s += '\n';
  }
  (r.steps || []).forEach(x => {
    s += tr(x.title ? 'export.body.step' : 'export.body.stepNoTitle', { index: x.index, title: x.title || '', action: x.action || '' });
    if (x.why?.reason) s += tr('export.body.why', { reason: x.why.reason });
  });
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
  const stepSep = tr('export.body.cook.stepTitleSeparator');
  const steps = (r.steps || []).map((s, i) => `${i + 1}. ${s.title ? s.title + stepSep : ''}${s.action || ''}`).join('\n\n');
  return `${meta}\n\n-- ${tr('export.body.cook.ingredients')}\n${ings}\n\n-- ${tr('export.body.cook.steps')}\n${steps}\n`;
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
    tool: recipeTools(r).length ? recipeTools(r).map(t => ({ '@type': 'HowToTool', name: t.name, description: schemaToolDescription(t) })) : undefined,
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
  const ov = openModal(`<h3 style="text-align:left">${esc(tr('export.title', { title: r.title || '' }))}</h3>
    <p style="color:var(--muted);font-size:13px;text-align:left;margin:0 0 12px">${esc(tr('export.chooseFormat'))}</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn ghost" id="xLink">${esc(tr('export.link'))}</button>
      <button class="btn ghost" id="xMd">${esc(tr('export.text'))}</button>
      <button class="btn ghost" id="xCook">${esc(tr('export.cook'))}</button>
      <button class="btn ghost" id="xJson">${esc(tr('export.jsonld'))}</button>
    </div>
    <div class="mrow"><button class="btn" id="xClose">${esc(tr('common.close'))}</button></div>`, 'left');
  ov.querySelector('#xLink').onclick = () => { navigator.clipboard?.writeText(shareRecipeUrl(r.id)); toast(tr('export.link.copied')); };
  ov.querySelector('#xMd').onclick = () => { navigator.clipboard?.writeText(recipeToText(r, factor)); toast(tr('export.recipeText.copied')); };
  ov.querySelector('#xCook').onclick = () => { downloadFile(safe + '.cook', recipeToCooklang(r), 'text/plain;charset=utf-8'); toast(tr('export.cook.downloaded')); };
  ov.querySelector('#xJson').onclick = () => { downloadFile(safe + '.jsonld', JSON.stringify(recipeToSchemaOrg(r), null, 2), 'application/ld+json'); toast(tr('export.jsonld.downloaded')); };
  ov.querySelector('#xClose').onclick = () => ov.remove();
}
function shareRecipeUrl(recipeId, { apiBase = settings.apiBase, origin = location.origin, base = BASE } = {}) {
  const root = String(apiBase || origin || '').replace(/\/+$/, '');
  const prefix = apiBase ? '' : String(base || '').replace(/\/+$/, '');
  return `${root}${prefix}/r/${encodeURIComponent(recipeId)}`;
}

/* ================= 跟做模式 ================= */
let wakeLock = null, recog = null, voiceWant = false;
function cookStepsForRecipe(r) {
  const groups = recipePhaseGroups(r);
  if (!groups.hasPhases) return r.steps || [];
  return [
    ...groups.steps.batch.map(x => x.item),
    { divider: true, index: 'phase-serving', title: tr('cook.phase.divider.title'), action: tr('cook.phase.divider.desc') },
    ...groups.steps.serving.map(x => x.item),
  ];
}
async function openCook(r) {
  const steps = cookStepsForRecipe(r); if (!steps.length) { toast(tr('cook.noSteps')); return; }
  let cur = (store.get('progress', {})[r.id]) || 0; if (cur >= steps.length) cur = 0;
  let asks = {}; const stopTimer = () => { }; // 计时改为全局 HUD，跨步骤保留，翻页不清
  const box = el('<div id="cook"></div>'); document.body.appendChild(box);
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { }

  const saveProg = (i) => { const p = store.get('progress', {}); p[r.id] = i; store.set('progress', p); };
  function render() {
    const s = steps[cur];
    if (s.divider) {
      box.innerHTML = `
        <div class="cook-top"><button class="x">${esc(tr('cook.exit'))}</button>
          <span style="color:var(--muted);font-size:14px">${cur + 1} / ${steps.length}</span><div></div></div>
        <div class="progress">${steps.map((_, i) => `<span class="dot ${i < cur ? 'done' : i === cur ? 'cur' : ''}"></span>`).join('')}</div>
        <div class="cook-body cook-divider">
          <div class="stepno">${esc(tr('cook.phase.divider.kicker'))}</div>
          <h2>${esc(s.title)}</h2>
          <div class="action">${esc(s.action)}</div>
        </div>
        <div class="cook-nav">
          <button class="btn prev" ${cur === 0 ? 'disabled' : ''}>${esc(tr('cook.prev'))}</button>
          <button class="btn next">${esc(tr('cook.next'))}</button></div>`;
      box.querySelector('.x').onclick = exit;
      box.querySelector('.prev').onclick = () => { if (cur > 0) { stopTimer(); stopSpeak(); cur--; saveProg(cur); render(); } };
      box.querySelector('.next').onclick = next;
      if (settings.tts) speak(`${s.title}。${s.action}`);
      return;
    }
    const w = s.why || {}, key = stepKey(r.id, s.index), faved = favSteps.some(x => x.key === key);
    const warn = s.confidence === 'low' ? `<span class="warn">${esc(tr('cook.confidence.low'))}</span>` : s.confidence === 'medium' ? `<span class="warn">${esc(tr('cook.confidence.medium'))}</span>` : '';
    const segUrl = sourceSegmentUrl(r.source, s.source_time);
    box.innerHTML = `
      <div class="cook-top"><button class="x">${esc(tr('cook.exit'))}</button>
        <span style="color:var(--muted);font-size:14px">${cur + 1} / ${steps.length}</span>
        <div class="cook-tools">
          <button class="iconbtn" id="ttsBtn" title="${esc(tr('cook.read'))}">🔊</button>
          ${SR ? `<button class="iconbtn ${recog ? 'on' : ''}" id="voiceBtn" title="${esc(tr('cook.voiceControl'))}">🎙</button>` : ''}
          <button class="fav-step ${faved ? 'on' : ''}" title="${esc(tr('cook.favoriteStep'))}">${faved ? '★' : '☆'}</button>
        </div></div>
      <div class="progress">${steps.map((_, i) => `<span class="dot ${i < cur ? 'done' : i === cur ? 'cur' : ''}"></span>`).join('')}</div>
      <div class="cook-body">
        <div class="stepno">${esc(tr('cook.stepNo', { n: s.index }))}${riskBadge(s.risk_level)}</div>
        <h2>${esc(s.title || '')}</h2>
        <div class="action">${richText(s.action || '')}</div>
        ${s.image ? `<img class="stepimg" data-zoom src="${esc(recipeImg(r.id, s.image))}" alt="${esc(tr('cook.stepImageAlt'))}" loading="lazy" onerror="this.remove()">` : ''}
        ${segUrl ? `<a class="step-video-link cook-src" href="${esc(segUrl)}" target="_blank" rel="noopener">${esc(tr('detail.watchSegment'))}</a>` : ''}
        ${paramsHtml(s.params)}${usedIngsHtml(r, s)}${stepToolsHtml(r, s)}${timerHtml(s.params)}
        ${(w.reason || w.if_not || w.cue) ? `<div class="why"><div class="why-hd"><span>${esc(tr('cook.whyTitle'))}</span>${warn}</div>
          ${w.reason ? `<p><span class="lbl">${esc(tr('cook.principle'))}</span>${richText(w.reason)}</p>` : ''}
          ${w.if_not ? `<p><span class="lbl">${esc(tr('why.ifNot'))}</span>${esc(w.if_not)}</p>` : ''}
          ${w.cue ? `<p><span class="lbl g">${esc(tr('why.cue'))}</span>${esc(w.cue)}</p>` : ''}</div>` : ''}
        <div class="ask"><button class="btn ghost sm" id="askBtn">${esc(tr('cook.ask'))}</button> <button class="btn ghost sm" id="sosBtn">${esc(tr('cook.sos'))}</button><div id="qa"></div></div>
      </div>
      <div class="cook-nav">
        <button class="btn prev" ${cur === 0 ? 'disabled' : ''}>${esc(tr('cook.prev'))}</button>
        <button class="btn next">${esc(cur === steps.length - 1 ? tr('cook.finish') : tr('cook.next'))}</button></div>`;
    box.querySelector('.x').onclick = exit;
    box.querySelector('.fav-step').onclick = () => toggleStep(r, s);
    box.querySelector('.prev').onclick = () => { if (cur > 0) { stopTimer(); stopSpeak(); cur--; saveProg(cur); render(); } };
    box.querySelector('.next').onclick = next;
    box.querySelector('#ttsBtn').onclick = () => speak(tr('cook.speech.stepFull', { index: s.index, title: s.title || '', action: s.action || '', reason: w.reason ? tr('cook.speech.reason', { reason: w.reason }) : '' }));
    box.querySelector('#askBtn').onclick = () => askStep(r, s);
    box.querySelector('#sosBtn').onclick = () => sosStep(r, s);
    const tb = box.querySelector('#timerBtn'); if (tb) tb.onclick = () => Timers.add(s.title || tr('cook.stepNo', { n: s.index }), parseSeconds(s.params && s.params.time));
    if (SR) box.querySelector('#voiceBtn').onclick = toggleVoice;
    box.querySelectorAll('.term').forEach(t => t.onclick = () => showTerm(t.dataset.term));
    wireZoom(box);
    renderQA(s);
    if (settings.tts) speak(tr('cook.speech.stepTitle', { index: s.index, title: s.title || '' }));
  }
  function renderQA(s) {
    const box2 = box.querySelector('#qa'); const list = asks[s.index] || [];
    box2.innerHTML = list.map(qa => `<div class="qa"><div class="q">${esc(tr('cook.qa.question', { question: qa.q }))}</div><div class="a">${esc(qa.a)}</div></div>`).join('');
  }
  async function askStep(r, s) {
    const q = await promptModal(tr('cook.ask.title', { title: s.title || '' }), tr('cook.ask.placeholder')); if (!q) return;
    (asks[s.index] = asks[s.index] || []).push({ q, a: tr('cook.ask.thinking') }); renderQA(s);
    try { const { answer } = await API.ask(r.id, s.index, q); asks[s.index][asks[s.index].length - 1].a = answer; }
    catch (e) { asks[s.index][asks[s.index].length - 1].a = tr('cook.ask.failed', { message: e.message }); }
    renderQA(s);
  }
  function next() { stopSpeak(); if (cur === steps.length - 1) { exit(); finishCook(r); return; } cur++; saveProg(cur); render(); }
  async function sosStep(r, s) {
    const problem = await promptModal(tr('cook.sos.title'), tr('cook.sos.placeholder'), tr('cook.sos.ok')); if (!problem) return;
    (asks[s.index] = asks[s.index] || []).push({ q: '🆘 ' + problem, a: tr('cook.sos.thinking') }); renderQA(s);
    try { const { answer } = await API.troubleshoot(r.id, s.index, problem); asks[s.index][asks[s.index].length - 1].a = answer; }
    catch (e) { asks[s.index][asks[s.index].length - 1].a = tr('cook.sos.failed', { message: e.message }); }
    renderQA(s);
  }
  function toggleStep(r, s) {
    const key = stepKey(r.id, s.index);
    if (favSteps.some(x => x.key === key)) { favSteps = favSteps.filter(x => x.key !== key); toast(tr('cook.favorite.removed')); }
    else { favSteps.push({ key, recipeId: r.id, recipeTitle: r.title, index: s.index, title: s.title, action: s.action, params: s.params, why: s.why }); toast(tr('cook.favorite.added')); }
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
        voiceWant = false; recog = null; toast(tr('cook.voiceUnavailable', { message: ev.error })); render();
      }
    };
    recog.onend = () => { if (voiceWant && recog) { try { recog.start(); } catch { voiceWant = false; recog = null; } } };
    try { recog.start(); showVoiceHint(); render(); } catch { voiceWant = false; recog = null; toast(tr('cook.voiceStartFailed')); }
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
  const metaForRecipe = rmeta(r.id);
  const factors = recipePhaseGroups(r).hasPhases
    ? { batchFactor: metaForRecipe.batchFactor || 1, servingFactor: metaForRecipe.servingsFactor || 1 }
    : 1;
  return `<div class="used-ings">${esc(tr('cook.usedIngredients'))}${used.map(i =>
    `<span class="uing">${esc(i.name)}${i.amount && !['视频未明确', '适量'].includes(i.amount) ? ' <b>' + esc(scaledIngredientAmount(i, factors) || i.amount) + '</b>' : ''}</span>`).join('')}</div>`;
}
function stepToolsFor(tools, s) {
  const text = `${s?.title || ''} ${s?.action || ''}`;
  return recipeTools({ tools }).filter(t => text.includes(t.name));
}
function stepToolsHtml(r, s) {
  const used = stepToolsFor(r?.tools, s);
  if (!used.length) return '';
  return `<div class="used-tools">${esc(tr('cook.tools.used'))}${used.map(t => `<span class="utool">${esc(t.name)}</span>`).join('')}</div>`;
}
function paramsHtml(p) {
  if (!p) return '';
  const items = [p.heat && [tr('cook.param.heat'), p.heat], p.temp && [tr('cook.param.temp'), p.temp], p.time && [tr('cook.param.time'), p.time], p.cue && [tr('cook.param.cue'), p.cue]].filter(Boolean);
  return items.length ? `<div class="params">${items.map(([k, v]) => `<span class="param"><b>${esc(k)}</b> ${esc(v)}</span>`).join('')}</div>` : '';
}
function timerDurationText(seconds) {
  const min = Math.floor(seconds / 60), sec = seconds % 60;
  return `${min ? tr('cook.timer.minute', { n: min }) : ''}${sec ? tr('cook.timer.second', { n: sec }) : ''}`;
}
function timerHtml(p) { const s = parseSeconds(p && p.time); return s ? `<div class="timer"><button class="btn sm" id="timerBtn">${esc(tr('cook.timer.start', { duration: timerDurationText(s) }))}</button></div>` : ''; }
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
function showVoiceHint() { const h = el(`<div class="voice-hint">${esc(tr('cook.voiceHint'))}</div>`); document.body.appendChild(h); setTimeout(() => h.remove(), 3000); }
async function showTerm(term) {
  const ov = openModal(`<h3>${esc(term)}</h3><p style="color:var(--muted)">${esc(tr('term.loading'))}</p>`);
  const setLoading = () => { ov.querySelector('.modal').innerHTML = `<h3>${esc(term)}</h3><p style="color:var(--muted)">${esc(tr('term.loading'))}</p>`; };
  const render = ({ answer, cached }) => {
    ov.querySelector('.modal').innerHTML = `<h3>${esc(term)}</h3><p style="text-align:left">${esc(answer)}</p>
      ${cached ? `<div style="color:var(--muted);font-size:12px;margin-top:12px;display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap"><span>${esc(tr('term.cached'))}</span><span>·</span><button class="btn ghost sm" id="regenTerm">${esc(tr('term.regenerate'))}</button></div>` : ''}
      <div class="mrow"><button class="btn" id="ok">${esc(tr('term.ok'))}</button></div>`;
    ov.querySelector('#ok').onclick = () => ov.remove();
    const regen = ov.querySelector('#regenTerm');
    if (regen) regen.onclick = () => load(true);
  };
  async function load(force = false) {
    if (force) setLoading();
    try { render(await API.term(term, { force })); }
    catch (e) { ov.remove(); toast(tr('term.failed', { message: e.message })); }
  }
  await load(false);
}

/* ================= 解析（带进度）================= */
function openModal(inner, cls = '') { const ov = el(`<div class="overlay"><div class="modal ${cls}">${inner}</div></div>`); document.body.appendChild(ov); return ov; }
// 应用内输入框（替代原生 prompt，装成 App 后更稳、更好看）。返回 Promise<string|null>
function promptModal(title, placeholder = '', okText = null) {
  return new Promise((resolve) => {
    const okLabel = okText || tr('common.send');
    const ov = openModal(`<h3 style="text-align:left">${esc(title)}</h3>
      <textarea id="pmInput" placeholder="${esc(placeholder)}" style="min-height:88px;margin:8px 0 0"></textarea>
      <div class="mrow"><button class="btn ghost" id="pmCancel">${esc(tr('common.cancel'))}</button><button class="btn" id="pmOk">${esc(okLabel)}</button></div>`, 'left');
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
function confirmModal(title, okText = null) {
  return new Promise((resolve) => {
    const okLabel = okText || tr('common.ok');
    const ov = openModal(`<h3 style="text-align:left">${esc(title)}</h3>
      <div class="mrow"><button class="btn ghost" id="cmCancel">${esc(tr('common.cancel'))}</button><button class="btn" id="cmOk" style="background:var(--tomato-d)">${esc(okLabel)}</button></div>`, 'left');
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('#cmCancel').onclick = () => done(false);
    ov.querySelector('#cmOk').onclick = () => done(true);
  });
}
async function doParse(starter) {
  const ov = openModal(`<div class="pct" id="pct">0%</div><div class="stage" id="stage">${esc(tr('parse.starting'))}</div>
    <div class="pbar"><div id="bar"></div></div>
    <p style="color:var(--muted);font-size:12px">${esc(tr('parse.keepOpen'))}</p>
    <div class="mrow"><button class="btn ghost" id="pMin">${esc(tr('parse.background'))}</button></div>`);
  // 「放到后台」：把进度收成一个悬浮小药丸，先去浏览别的菜谱，点药丸再展开
  let pill = null, lastPct = 0, lastStage = tr('parse.running');
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
      es.onerror = () => { if (es.readyState === EventSource.CLOSED || ++errs >= 6) { es.close(); reject(new Error(tr('parse.connectionInterrupted'))); } };
    }).then(async (recipe) => {
      await refresh(); cleanup(); toast(tr('parse.done', { title: recipe.title || '' }));
      const found = recipes.find(x => x.title === recipe.title); if (found) openDetail(found);
    });
  } catch (e) { cleanup(); refresh(); toast(tr('parse.failed', { message: e.message })); }
}
function stageLabel(stage, message) {
  const key = stage ? 'parse.stage.' + stage : '';
  return hasI18nKey(key) ? tr(key) : message || tr('parse.stage.processing');
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
function renderAll() { renderFilters(); renderRecipes(); renderCookbooks(); renderTechniques(); renderSkills(); renderShopping(); updateBadges(); }
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
    ['recipes', 'cookbooks', 'plan', 'techniques', 'skills', 'shopping', 'settings'].forEach(v => $('#view-' + v).classList.toggle('hidden', v !== curTab));
    const showSearch = curTab === 'recipes';
    $('#searchrow').classList.toggle('hidden', !showSearch); $('#recipeTools').classList.toggle('hidden', !showSearch); $('#filters').classList.toggle('hidden', !showSearch);
    if (curTab === 'cookbooks') renderCookbooks(); if (curTab === 'techniques') renderTechniques(); if (curTab === 'skills') renderSkills(); if (curTab === 'shopping') renderShopping(); if (curTab === 'settings') renderSettings(); if (curTab === 'plan') renderPlan();
  });
  // 加载时同步一次 aria-selected，读屏用户一进来就知道当前在哪个标签
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x.classList.contains('on') ? 'true' : 'false'));
}
function init() {
  applyTheme(); applyStaticI18n(); syncDepthChips();
  Timers.restore(); // 恢复上次未结束的计时（刷新/被系统回收后不丢）
  // 无障碍：让 role=button/tab 的非原生控件(标签栏/深度选择等)支持键盘 Enter/Space 触发，而不只是鼠标/触屏点击。
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"],[role="tab"]')) { e.preventDefault(); e.target.click(); }
  });
  initTabs();
  $('#depth').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; depth = c.dataset.d; syncDepthChips(); };
  $('#parseUrl').onclick = () => { const u = $('#url').value.trim(); if (!/^https?:\/\//.test(u)) { toast(tr('parse.invalidUrl')); return; } const vision = $('#visChk')?.checked, images = $('#imgChk')?.checked; doParse(() => API.startUrl(u, depth, vision, images)); $('#url').value = ''; };
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#parseUrl').click(); } });
  $('#fileBtn').onclick = () => $('#file').click();
  $('#imageBtn').onclick = () => $('#imageFile').click();
  $('#textBtn').onclick = async () => {
    const t = await promptModal(tr('parse.text.title'), tr('parse.text.placeholder'), tr('home.parse'));
    if (t && t.length >= 10) doParse(() => API.startText(t, depth));
    else if (t) toast(tr('parse.text.tooShort'));
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
      if (document.getElementById('cook') || document.querySelector('.overlay')) { toast(tr('parse.updateReady')); return; }
      refreshing = true; toast(tr('parse.updating')); location.reload();
    });
  }
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; showInstall(deferred); });
}
function showInstall(deferred) {
  if ($('#installBanner') || store.get('installDismiss')) return;
  const b = el(`<div class="install-banner" id="installBanner"><span>${esc(tr('install.prompt'))}</span><span><button class="btn sm" id="doInstall">${esc(tr('install.action'))}</button> <button class="iconbtn" id="noInstall">✕</button></span></div>`);
  $('header').after(b);
  $('#doInstall').onclick = async () => { b.remove(); deferred.prompt(); };
  $('#noInstall').onclick = () => { b.remove(); store.set('installDismiss', true); };
}
document.addEventListener('DOMContentLoaded', init);
