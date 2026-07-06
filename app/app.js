/* 庖丁 App — 单页逻辑（vanilla JS，无依赖） */
'use strict';

/* ---------- 存储 ---------- */
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('paoding.' + k)); return v ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('paoding.' + k, JSON.stringify(v)); },
};
const settings = Object.assign({ theme: 'light', fontScale: 1, tts: true, ttsRate: 1, apiBase: '', depth: 'balanced' }, store.get('settings', {}));
function saveSettings() { store.set('settings', settings); }

/* ---------- API ---------- */
// 自动推导当前页面所在的路径前缀：根部署("/","/index.html")→""；反代到子路径("/paoding/")→"/paoding"。
// 这样 App 从 https://域名:8443/paoding/ 加载时，/api 调用会自动带上 /paoding 前缀，无需手工配。
const BASE = location.pathname.replace(/\/[^/]*$/, '');
const api = (p) => (settings.apiBase || BASE) + p;
const API = {
  list: () => fetch(api('/api/recipes')).then(r => r.json()),
  del: (id) => fetch(api('/api/recipes/' + encodeURIComponent(id)), { method: 'DELETE' }),
  startUrl: (url, depth) => fetch(api('/api/parse-url'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, depth }) }).then(j),
  startFile: (file, depth) => fetch(api('/api/parse-file'), { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'X-Depth': depth }, body: file }).then(j),
  startText: (text, depth) => fetch(api('/api/parse-text'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, depth }) }).then(j),
  ask: (recipeId, stepIndex, question) => fetch(api('/api/ask'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, question }) }).then(j),
  substitute: (recipeId, ingredient) => fetch(api('/api/substitute'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, ingredient }) }).then(j),
  term: (term) => fetch(api('/api/term'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term }) }).then(j),
  troubleshoot: (recipeId, stepIndex, problem) => fetch(api('/api/troubleshoot'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, problem }) }).then(j),
  nutrition: (recipeId) => fetch(api('/api/nutrition'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
  overview: (recipeId) => fetch(api('/api/overview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
  userdataGet: () => fetch(api('/api/userdata')).then(r => r.json()).catch(() => ({})),
  userdataPut: (data) => fetch(api('/api/userdata'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => { }),
  importAll: (data) => fetch(api('/api/import'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(j),
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
async function j(r) { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }

/* ---------- 状态 ---------- */
let recipes = [];
let favRecipes = store.get('favRecipes', []);
let favSteps = store.get('favSteps', []);
let shopping = store.get('shopping', []);
let mealPlan = store.get('mealPlan', {}); // { 'YYYY-MM-DD': [recipeId,...] }
function saveMealPlan() { store.set('mealPlan', mealPlan); }
let meta = store.get('meta', {}); // {recipeId:{cooked,cooked_at,rating,notes,ingChecked:[]}}
let depth = settings.depth;
let curTab = 'recipes';
let filter = { q: '', tag: '' };
const rmeta = (id) => (meta[id] = meta[id] || {});
function saveMeta() { store.set('meta', meta); }
const stepKey = (id, i) => id + '#' + i;

/* ---------- 跨设备同步 ----------
   收藏/技巧/购物清单/笔记评分等原本只存在各设备的 localStorage，手机和电脑不通。
   这里拦截对这些键的写入 → 防抖后回传后端；启动时先从后端拉一份，实现多端共享。 */
const _storeSet = store.set.bind(store);
const SYNC_KEYS = new Set(['favRecipes', 'favSteps', 'shopping', 'meta', 'mealPlan']);
let syncT = null;
function syncUp() { clearTimeout(syncT); syncT = setTimeout(() => API.userdataPut({ favRecipes, favSteps, shopping, meta, mealPlan }), 800); }
store.set = (k, v) => { _storeSet(k, v); if (SYNC_KEYS.has(k)) syncUp(); };
async function loadUserData() {
  let d = null;
  try { d = await API.userdataGet(); } catch { }
  if (d && (d.favRecipes || d.favSteps || d.shopping || d.meta || d.mealPlan)) {
    if (Array.isArray(d.favRecipes)) { favRecipes = d.favRecipes; _storeSet('favRecipes', favRecipes); }
    if (Array.isArray(d.favSteps)) { favSteps = d.favSteps; _storeSet('favSteps', favSteps); }
    if (Array.isArray(d.shopping)) { shopping = d.shopping; _storeSet('shopping', shopping); }
    if (d.meta && typeof d.meta === 'object') { meta = d.meta; _storeSet('meta', meta); }
    if (d.mealPlan && typeof d.mealPlan === 'object') { mealPlan = d.mealPlan; _storeSet('mealPlan', mealPlan); }
  } else {
    syncUp(); // 后端还没有数据 → 用本设备现有数据播种
  }
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
function scaleAmount(amt, f) {
  if (!amt || f === 1) return amt;
  return String(amt).replace(/(\d+(?:\.\d+)?)/g, (n) => {
    let v = +n * f; v = Math.round(v * 10) / 10; return String(v);
  });
}
// 优先用结构化 qty/unit 精确缩放（新菜谱有）；没有就回退到对 amount 文本的数字缩放（旧菜谱兼容）
function scaledAmount(i, f) {
  if (i && Number.isFinite(i.qty)) return (Math.round(i.qty * f * 100) / 100) + (i.unit || '');
  return scaleAmount(i && i.amount, f);
}
function baseServings(r) { const m = String(r.servings || '').match(/(\d+)/); return m ? +m[1] : null; }
const DIFF = { easy: '简单', medium: '中等', hard: '有挑战' };
function highlightInfo(text) {
  // 高亮用量/时间/火候/成度等关键信息（在已转义文本上做）
  return text.replace(/(\d+(?:\.\d+)?\s*(?:成热|分钟|秒钟|秒|小时|度|℃|克|毫升|斤|两|片|勺|颗|个|瓣|大卡|kcal)|大火|中大火|中火|中小火|小火|微火|金黄|焦黄|微黄|七成热|冒烟)/g, '<b class="hl">$1</b>');
}
const richText = (t) => highlightInfo(linkifyTerms(t));

/* ---------- 全局多计时器（跨步骤/后台闹铃）---------- */
const Timers = {
  list: [], iv: null,
  ensureHUD() { let h = document.getElementById('timerhud'); if (!h) { h = el('<div id="timerhud"></div>'); document.body.appendChild(h); } return h; },
  add(label, seconds) {
    if (!seconds) return;
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { });
    this.list.push({ id: Date.now() + '' + Math.floor(performance.now()), label, endAt: Date.now() + seconds * 1000, done: false });
    this.render(); this.start(); toast('⏱ 已开始计时：' + label);
  },
  start() { if (this.iv) return; this.iv = setInterval(() => this.tick(), 500); },
  tick() {
    const now = Date.now(); let changed = false;
    for (const t of this.list) {
      if (!t.done && now >= t.endAt) { t.done = true; changed = true; this.ring(t); }
    }
    this.render();
    // 全部倒计时结束（或清空）后停掉空转的 interval；新加计时会在 add() 里重启
    if ((!this.list.length || this.list.every(t => t.done)) && this.iv) { clearInterval(this.iv); this.iv = null; }
  },
  ring(t) {
    beep(); try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch { }
    speak(t.label + ' 时间到'); toast('⏰ ' + t.label + ' 时间到！');
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification('⏰ 庖丁计时', { body: t.label + ' 时间到！', tag: t.id }); } catch { }
  },
  remove(id) { this.list = this.list.filter(x => x.id !== id); this.render(); },
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
  ttsVoice = vs.find(v => /zh|Chinese|Tingting|Ting-Ting/i.test(v.lang + v.name)) || vs[0] || null;
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
function matchFilter(r) {
  if (filter.tag === '__fav') return favRecipes.includes(r.id);
  if (filter.tag === '__cooked') return rmeta(r.id).cooked;
  if (filter.tag && !(r.tags || []).includes(filter.tag) && r.difficulty !== filter.tag && r.cuisine !== filter.tag) return false;
  if (filter.q) { const hay = (r.title + ' ' + (r.tags || []).join(' ') + ' ' + (r.ingredients || []).map(i => i.name).join(' ')); if (!hay.includes(filter.q)) return false; }
  return true;
}
function renderFilters() {
  const tags = new Set(); recipes.forEach(r => (r.tags || []).forEach(t => tags.add(t)));
  const chips = [['', '全部'], ['__fav', '★ 收藏'], ['__cooked', '✓ 做过'], ...[...tags].slice(0, 12).map(t => [t, t])];
  $('#filters').innerHTML = chips.map(([v, l]) => `<span class="chip ${filter.tag === v ? 'on' : ''}" data-f="${esc(v)}">${esc(l)}</span>`).join('');
  $('#filters').querySelectorAll('.chip').forEach(c => c.onclick = () => { filter.tag = c.dataset.f; renderFilters(); renderRecipes(); });
}
function renderRecipes() {
  const box = $('#view-recipes');
  const items = recipes.filter(matchFilter);
  if (!recipes.length) { box.innerHTML = '<div class="empty">还没有菜谱。<br>粘贴一个做菜视频链接，或上传本地视频开始解析。</div>'; return; }
  if (!items.length) { box.innerHTML = '<div class="empty">没有匹配的菜谱。</div>'; return; }
  box.innerHTML = '';
  items.forEach(r => {
    const m = rmeta(r.id), faved = favRecipes.includes(r.id);
    const card = el(`<div class="rcard">
      <div style="flex:1;min-width:0">
        <h3>${esc(r.title || '未命名')}</h3>
        <div class="meta">
          ${r.difficulty ? `<span class="tag diff-${esc(r.difficulty)}">${esc(DIFF[r.difficulty] || r.difficulty)}</span>` : ''}
          ${r.total_time_min ? `<span>⏱ 约${esc(r.total_time_min)}分钟</span>` : ''}
          <span>📋 ${(r.steps || []).length}步</span>
          ${m.cooked ? `<span class="cooked">✓ 做过</span>` : ''}
          ${m.rating ? `<span class="cooked">${'★'.repeat(m.rating)}</span>` : ''}
        </div>
        ${(r.tags || []).length ? `<div class="tags">${r.tags.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      <button class="star ${faved ? 'on' : ''}">${faved ? '★' : '☆'}</button></div>`);
    card.querySelector('div').onclick = () => openDetail(r);
    card.querySelector('.star').onclick = (e) => { e.stopPropagation(); toggleRecipe(r.id); renderRecipes(); renderFilters(); };
    box.appendChild(card);
  });
}
function toggleRecipe(id) { favRecipes = favRecipes.includes(id) ? favRecipes.filter(x => x !== id) : [...favRecipes, id]; store.set('favRecipes', favRecipes); }

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

/* ================= 购物清单（按品类归类 + 同名合并）================= */
const SHOP_CATS = [
  ['🥩 肉蛋水产', /猪|牛|羊|鸡|鸭|鹅|鱼|虾|蟹|肉|排骨|培根|香肠|腊肠|火腿|蛋|贝|鱿|蛤|蛏|海鲜|五花|里脊|通脊|牛腩|鸡胸|鸡腿/],
  ['🥬 蔬菜菌菇', /菜|葱|姜|蒜|辣椒|青椒|尖椒|瓜|茄|菇|笋|藕|萝卜|土豆|马铃薯|番茄|西红柿|洋葱|韭|芹|菠|生菜|白菜|菌|木耳|香菜|豆芽|苗|莲|玉米|山药|冬瓜|南瓜|豆角|豇豆|秋葵/],
  ['🍚 主食豆制', /米|面(?!酱)|粉丝|粉条|馒头|花卷|饼|包子|馄饨|饺|年糕|河粉|米线|豆腐|腐竹|豆皮|千张|素鸡|油条/],
  ['🧂 调料', /盐|糖|酱油|生抽|老抽|蚝油|耗油|醋|油|料酒|味精|鸡精|胡椒|八角|桂皮|花椒|孜然|五香|十三香|13香|芝麻|蜂蜜|淀粉|豆瓣|豆豉|番茄酱|香油|辣椒油|蒜蓉|调料|香料|盐巴|白糖|冰糖|生粉/],
];
function shopCat(name) { for (const [c, re] of SHOP_CATS) if (re.test(name)) return c; return '🧺 其他'; }
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
function renderShopping() {
  const box = $('#view-shopping');
  const head = `<div class="searchrow" style="padding:4px 0 12px"><button class="btn ghost sm" id="shopClear">清除已勾选</button><button class="btn ghost sm" id="shopAll">清空</button></div>`;
  if (!shopping.length) { box.innerHTML = '<div class="empty">购物清单是空的。<br>在菜谱详情里点「加入购物清单」，食材就会汇总到这里。</div>'; return; }
  // 同名合并：记录每个名字对应的原始下标（用于勾选/删除），累积用量与来源
  const groups = {};
  shopping.forEach((it, i) => {
    const g = groups[it.name] = groups[it.name] || { name: it.name, cat: shopCat(it.name), amounts: [], froms: new Set(), idxs: [] };
    if (it.amount) g.amounts.push(it.amount);
    if (it.from) g.froms.add(it.from);
    g.idxs.push(i);
  });
  const merged = Object.values(groups).map(g => ({
    name: g.name, cat: g.cat, idxs: g.idxs,
    amount: mergeAmounts(g.amounts), src: [...g.froms].join('、'),
    checked: g.idxs.every(i => shopping[i].checked),
  }));
  const byCat = {}; merged.forEach(m => (byCat[m.cat] = byCat[m.cat] || []).push(m));
  const order = ['🥩 肉蛋水产', '🥬 蔬菜菌菇', '🍚 主食豆制', '🧂 调料', '🧺 其他'];
  let html = head;
  for (const cat of order) {
    const items = byCat[cat]; if (!items || !items.length) continue;
    html += `<div class="sec-title" style="margin:14px 0 6px 0;padding:0">${cat}</div>`;
    html += items.map(m => `
      <div class="shop-item ${m.checked ? 'checked' : ''}" data-idxs="${m.idxs.join(',')}">
        <div class="ck ${m.checked ? 'on' : ''}">${m.checked ? '✓' : ''}</div>
        <div class="txt">${esc(m.name)}${m.amount ? ` · <span style="color:var(--muted)">${esc(m.amount)}</span>` : ''}<div class="sub">${esc(m.src)}${m.idxs.length > 1 ? ` · 合并自${m.idxs.length}处` : ''}</div></div>
      </div>`).join('');
  }
  box.innerHTML = html;
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
  const planned = days.reduce((n, d) => n + (mealPlan[d.key] || []).length, 0);
  let html = `<div class="searchrow" style="padding:4px 0 10px;gap:8px">
    <button class="btn sm" id="planToShop" ${planned ? '' : 'disabled'}>🛒 这周的菜加入购物清单</button>
    ${planned ? `<button class="btn ghost sm" id="planClear">清空计划</button>` : ''}</div>`;
  html += days.map(day => {
    const items = (mealPlan[day.key] || []).map(id => byId[id]).filter(Boolean);
    return `<div class="planday">
      <div class="planhd"><b>${day.label}</b> <span style="color:var(--muted);font-size:13px">${day.date}</span> <button class="act planadd" data-key="${day.key}">＋ 加菜</button></div>
      ${items.length ? items.map(r => `<div class="planitem" data-key="${day.key}" data-id="${esc(r.id)}"><span class="pmore">${esc(r.title)}</span><button class="prm" title="移除">✕</button></div>`).join('') : '<div style="color:var(--muted);font-size:13px;padding:6px 0 2px">还没排菜</div>'}
    </div>`;
  }).join('');
  box.innerHTML = html;
  box.querySelectorAll('.planadd').forEach(b => b.onclick = () => pickRecipeForDay(b.dataset.key));
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
    <div class="setrow" style="flex-direction:column;align-items:stretch"><div><div class="lbl">数据备份</div><div class="desc">把全部菜谱与收藏导出成一个文件；换设备或搬后端时可导入恢复</div></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost sm" id="btnExport">⬇ 导出备份</button>
        <button class="btn ghost sm" id="btnImport">⬆ 导入恢复</button>
        <input type="file" id="importFile" accept="application/json,.json" class="hidden"></div></div>
    <div style="text-align:center;color:var(--muted);font-size:12px;margin-top:14px">庖丁 · 解剖每一道菜的为什么</div>`;

  box.querySelectorAll('[data-k]').forEach(x => { x.previousElementSibling.onclick = () => { const k = x.dataset.k; settings[k] = k === 'theme' ? (settings.theme === 'dark' ? 'light' : 'dark') : !settings[k]; saveSettings(); applyTheme(); renderSettings(); }; });
  box.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { settings.fontScale = Math.min(1.5, Math.max(0.85, settings.fontScale + (b.dataset.fs === '+' ? 0.1 : -0.1))); saveSettings(); applyTheme(); renderSettings(); });
  box.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { settings.ttsRate = Math.min(1.6, Math.max(0.6, settings.ttsRate + (b.dataset.tr === '+' ? 0.1 : -0.1))); saveSettings(); renderSettings(); });
  $('#setDepth').querySelectorAll('.chip').forEach(c => c.onclick = () => { settings.depth = c.dataset.d; depth = c.dataset.d; saveSettings(); renderSettings(); syncDepthChips(); });
  $('#apiBase').onchange = (e) => { settings.apiBase = e.target.value.trim().replace(/\/$/, ''); saveSettings(); toast('已保存后端地址'); refresh(); };
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = (e) => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; };
}
function applyTheme() { document.documentElement.setAttribute('data-theme', settings.theme); document.documentElement.style.setProperty('--fs', (16 * settings.fontScale) + 'px'); }

/* ================= 详情页 ================= */
function openDetail(r) {
  const m = rmeta(r.id);
  const base = baseServings(r);
  let factor = m.servingsFactor || 1;
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
        <span>📋 ${(r.steps || []).length}步</span></div>
      ${(r.tags || []).length ? `<div class="tags" style="margin-top:8px">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    ${base ? `<div class="scaler"><span>份量</span><button class="st" data-s="-">－</button><b id="svVal">${base * factor}</b><button class="st" data-s="+">＋</button><span>人份</span></div>` : ''}
    <div style="display:flex;gap:8px;padding:8px 16px 0;flex-wrap:wrap">
      <button class="btn ghost sm" id="btnOverview">💡 为什么这样设计</button>
      <button class="btn ghost sm" id="btnNutri">🥗 营养估算</button>
      <button class="btn ghost sm" id="btnExport2">⬇ 导出</button>
    </div>
    <div id="aiBox" style="margin:8px 16px 0"></div>
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
  }
  renderIng();

  const stepsBox = p.querySelector('#steps');
  (r.steps || []).forEach(s => stepsBox.appendChild(el(`<div class="stepmini">
    <div class="t"><span class="n">${s.index}</span>${esc(s.title || '')}${riskBadge(s.risk_level)}</div>
    <div class="a">${esc(s.action || '')}</div></div>`)));

  const close = () => p.remove();
  p.querySelector('.back').onclick = close;
  p.querySelector('#btnBack2').onclick = close;
  p.querySelector('#dfav').onclick = (e) => { toggleRecipe(r.id); const on = favRecipes.includes(r.id); e.target.className = 'star ' + (on ? 'on' : ''); e.target.textContent = on ? '★' : '☆'; renderRecipes(); renderFilters(); };
  p.querySelector('#dDel').onclick = async () => { if (!(await confirmModal('删除这道菜？此操作不可撤销。', '删除'))) return; try { await API.del(r.id); } catch { } close(); refresh(); toast('已删除'); };
  p.querySelector('#dEdit').onclick = () => { close(); openEdit(r); };
  p.querySelector('#dShare').onclick = () => shareRecipe(r, factor);
  p.querySelector('#addShop').onclick = () => addToShopping(r, factor);
  const aiBox = p.querySelector('#aiBox');
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
  p.querySelector('#btnNutri').onclick = (e) => aiCall(e.currentTarget, () => API.nutrition(r.id), '🥗 每份营养估算（粗略）', 'nutri');
  p.querySelector('#btnExport2').onclick = () => openExport(r, factor);
  p.querySelector('#btnCook').onclick = () => { close(); openCook(r); };
  p.querySelector('#notes').oninput = (e) => { m.notes = e.target.value; saveMeta(); };
  p.querySelector('#cookedBtn').onclick = (e) => { m.cooked = !m.cooked; if (m.cooked) m.cooked_at = new Date().toISOString(); saveMeta(); e.target.className = 'btn sm ' + (m.cooked ? '' : 'ghost'); e.target.textContent = m.cooked ? '✓ 已做过' : '标记做过'; renderRecipes(); };
  p.querySelectorAll('#rating .rs').forEach(rs => rs.onclick = () => { m.rating = +rs.dataset.r; saveMeta(); p.querySelectorAll('#rating .rs').forEach(x => x.classList.toggle('on', +x.dataset.r <= m.rating)); renderRecipes(); });
  if (base) p.querySelectorAll('.st').forEach(b => b.onclick = () => { factor = Math.max(0.5, factor + (b.dataset.s === '+' ? 0.5 : -0.5)); m.servingsFactor = factor; saveMeta(); p.querySelector('#svVal').textContent = Math.round(base * factor * 10) / 10; renderIng(); });

  $('#app').appendChild(p);
}
function riskBadge(r) { return r === 'high' ? ' <span class="badge risk-high">🔴 新手雷区</span>' : r === 'medium' ? ' <span class="badge risk-medium">🟡 需留意</span>' : ''; }

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
        <button class="iconbtn fDel" title="删除">🗑</button>
      </div>`).join('') || '<div style="color:var(--muted);font-size:13px">还没有食材，点上面「加一行」</div>';
    box.querySelectorAll('[data-i]').forEach(row => {
      const idx = +row.dataset.i;
      row.querySelector('.fName').oninput = (e) => d.ingredients[idx].name = e.target.value;
      row.querySelector('.fAmt').oninput = (e) => { d.ingredients[idx].amount = e.target.value; delete d.ingredients[idx].qty; delete d.ingredients[idx].unit; };
      row.querySelector('.fDel').onclick = () => { d.ingredients.splice(idx, 1); renderIng(); };
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
      row.querySelector('.sDel').onclick = () => { d.steps.splice(idx, 1); renderSteps(); };
      row.querySelector('.sUp').onclick = () => { if (idx > 0) { [d.steps[idx - 1], d.steps[idx]] = [d.steps[idx], d.steps[idx - 1]]; renderSteps(); } };
      row.querySelector('.sDown').onclick = () => { if (idx < d.steps.length - 1) { [d.steps[idx + 1], d.steps[idx]] = [d.steps[idx], d.steps[idx + 1]]; renderSteps(); } };
    });
  }
  renderIng(); renderSteps();
  p.querySelector('#eAddIng').onclick = () => { d.ingredients.push({ name: '', amount: '', note: '' }); renderIng(); };
  p.querySelector('#eAddStep').onclick = () => { d.steps.push({ title: '', action: '', params: {}, why: {} }); renderSteps(); };

  const close = () => p.remove();
  p.querySelector('.back').onclick = () => { close(); openDetail(r); };
  p.querySelector('#eCancel').onclick = () => { close(); openDetail(r); };

  async function save() {
    d.title = p.querySelector('#eTitle').value.trim() || d.title;
    const sv = p.querySelector('#eServings').value.trim(); d.servings = sv || null;
    const tm = parseInt(p.querySelector('#eTime').value, 10); d.total_time_min = Number.isFinite(tm) ? tm : null;
    d.difficulty = p.querySelector('#eDiff').value;
    d.cuisine = p.querySelector('#eCuisine').value.trim() || null;
    d.tags = p.querySelector('#eTags').value.split(/[,，、\s]+/).map(t => t.trim()).filter(Boolean);
    d.ingredients = d.ingredients.filter(i => (i.name || '').trim());
    d.steps = d.steps.filter(s => (s.title || s.action || '').trim());
    d.steps.forEach((s, i) => s.index = i + 1);
    const patch = { title: d.title, servings: d.servings, total_time_min: d.total_time_min, difficulty: d.difficulty, cuisine: d.cuisine, tags: d.tags, ingredients: d.ingredients, steps: d.steps };
    try {
      const res = await fetch(api('/api/recipes/' + encodeURIComponent(r.id)), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
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
  return {
    '@context': 'https://schema.org', '@type': 'Recipe',
    name: r.title, recipeCuisine: undef(r.cuisine), keywords: undef((r.tags || []).join(', ')),
    recipeYield: undef(r.servings), totalTime: r.total_time_min ? `PT${r.total_time_min}M` : undefined,
    recipeIngredient: (r.ingredients || []).map(i => `${i.name} ${i.amount || ''}`.trim()),
    recipeInstructions: (r.steps || []).map(s => ({ '@type': 'HowToStep', name: undef(s.title), text: s.action || '' })),
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
  ov.querySelector('#xLink').onclick = () => { const url = location.origin + BASE + '/r/' + encodeURIComponent(r.id); (navigator.clipboard?.writeText(url)); toast('已复制分享链接'); };
  ov.querySelector('#xMd').onclick = () => { navigator.clipboard?.writeText(recipeToText(r, factor)); toast('已复制菜谱文字'); };
  ov.querySelector('#xCook').onclick = () => { downloadFile(safe + '.cook', recipeToCooklang(r), 'text/plain;charset=utf-8'); toast('已下载 .cook'); };
  ov.querySelector('#xJson').onclick = () => { downloadFile(safe + '.jsonld', JSON.stringify(recipeToSchemaOrg(r), null, 2), 'application/ld+json'); toast('已下载 JSON-LD'); };
  ov.querySelector('#xClose').onclick = () => ov.remove();
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
  function next() { stopSpeak(); if (cur === steps.length - 1) { exit(); toast('做好啦，开动！🍜'); return; } cur++; saveProg(cur); render(); }
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
function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); for (let i = 0; i < 3; i++) { const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .15; o.start(a.currentTime + i * .4); o.stop(a.currentTime + i * .4 + .2); } } catch { } }
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
      const es = new EventSource(api('/api/progress/' + jobId));
      let errs = 0;
      es.onmessage = (ev) => {
        errs = 0; // 收到任何消息就重置错误计数
        const d = JSON.parse(ev.data);
        if (d.type === 'progress') setP(d.pct || 0, stageLabel(d.stage, d.message));
        else if (d.type === 'done') { es.close(); resolve(d.recipe); }
        else if (d.type === 'error') { es.close(); reject(new Error(d.error)); }
      };
      // 瞬时断网时 EventSource 会自动重连、服务端会补发当前进度；只有确实关闭或连续多次
      // 失败(约 18s)才判失败，避免长解析(1~3 分钟)中一次网络抖动就误报「连接中断」。
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED || ++errs >= 6) { es.close(); reject(new Error('连接中断')); }
      };
    }).then(async (recipe) => {
      recipes = await API.list(); renderAll(); cleanup(); toast('解析完成：' + (recipe.title || ''));
      const found = recipes.find(x => x.title === recipe.title); if (found) openDetail(found);
    });
  } catch (e) { cleanup(); toast('解析失败：' + e.message); }
}
function stageLabel(stage, message) {
  const map = { acquire: '下载 & 抽取音频', transcribe: '语音转文字', structure: '整理成步骤', explain: '逐步生成「为什么」', done: '完成' };
  return map[stage] || message || '处理中…';
}

/* ================= PWA / 初始化 ================= */
function updateBadges() {
  const set = (sel, n) => { const b = $(sel); if (b) b.innerHTML = n ? `<span class="badge-count">${n}</span>` : ''; };
  set('#tabSkillsBadge', favSteps.length);
  set('#tabShopBadge', shopping.filter(x => !x.checked).length);
}
function renderAll() { renderFilters(); renderRecipes(); renderSkills(); renderShopping(); updateBadges(); }
function syncDepthChips() { document.querySelectorAll('#depth .chip').forEach(x => x.classList.toggle('on', x.dataset.d === depth)); }
async function refresh() { try { recipes = await API.list(); } catch { recipes = store.get('cacheRecipes', []); } store.set('cacheRecipes', recipes); renderAll(); }

function initTabs() {
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    curTab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
    ['recipes', 'plan', 'skills', 'shopping', 'settings'].forEach(v => $('#view-' + v).classList.toggle('hidden', v !== curTab));
    const showSearch = curTab === 'recipes';
    $('#searchrow').classList.toggle('hidden', !showSearch); $('#filters').classList.toggle('hidden', !showSearch);
    if (curTab === 'skills') renderSkills(); if (curTab === 'shopping') renderShopping(); if (curTab === 'settings') renderSettings(); if (curTab === 'plan') renderPlan();
  });
}
function init() {
  applyTheme(); syncDepthChips();
  initTabs();
  $('#depth').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; depth = c.dataset.d; syncDepthChips(); };
  $('#parseUrl').onclick = () => { const u = $('#url').value.trim(); if (!/^https?:\/\//.test(u)) { toast('请粘贴 http(s) 视频链接'); return; } doParse(() => API.startUrl(u, depth)); $('#url').value = ''; };
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#parseUrl').click(); } });
  $('#fileBtn').onclick = () => $('#file').click();
  $('#textBtn').onclick = async () => {
    const t = await promptModal('粘贴文字菜谱', '把小红书图文 / 公众号 / 任意帖子的做菜文字粘进来，AI 直接整理成分步骤 + 讲透为什么', '解析');
    if (t && t.length >= 10) doParse(() => API.startText(t, depth));
    else if (t) toast('文字太短了，多粘一点');
  };
  $('#file').onchange = (e) => { const f = e.target.files[0]; if (f) doParse(() => API.startFile(f, depth)); e.target.value = ''; };
  $('#search').oninput = (e) => { filter.q = e.target.value.trim(); renderRecipes(); };
  // 系统分享导入：从别的 App 分享 B站/YouTube 链接进庖丁 → 自动填入并解析
  try {
    const sp = new URLSearchParams(location.search);
    const shared = (sp.get('url') || sp.get('text') || sp.get('title') || '').match(/https?:\/\/[^\s]+/);
    if (shared) { $('#url').value = shared[0]; history.replaceState(null, '', location.pathname); setTimeout(() => $('#parseUrl').click(), 400); }
  } catch { }
  loadUserData().finally(refresh); // 先同步远端用户数据，再拉菜谱并渲染
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
