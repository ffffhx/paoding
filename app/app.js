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
const api = (p) => (settings.apiBase || '') + p;
const API = {
  list: () => fetch(api('/api/recipes')).then(r => r.json()),
  del: (id) => fetch(api('/api/recipes/' + encodeURIComponent(id)), { method: 'DELETE' }),
  startUrl: (url, depth) => fetch(api('/api/parse-url'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, depth }) }).then(j),
  startFile: (file, depth) => fetch(api('/api/parse-file'), { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'X-Depth': depth }, body: file }).then(j),
  ask: (recipeId, stepIndex, question) => fetch(api('/api/ask'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, question }) }).then(j),
  substitute: (recipeId, ingredient) => fetch(api('/api/substitute'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, ingredient }) }).then(j),
  term: (term) => fetch(api('/api/term'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term }) }).then(j),
  troubleshoot: (recipeId, stepIndex, problem) => fetch(api('/api/troubleshoot'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId, stepIndex, problem }) }).then(j),
  nutrition: (recipeId) => fetch(api('/api/nutrition'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
  overview: (recipeId) => fetch(api('/api/overview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipeId }) }).then(j),
};
async function j(r) { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }

/* ---------- 状态 ---------- */
let recipes = [];
let favRecipes = store.get('favRecipes', []);
let favSteps = store.get('favSteps', []);
let shopping = store.get('shopping', []);
let meta = store.get('meta', {}); // {recipeId:{cooked,cooked_at,rating,notes,ingChecked:[]}}
let depth = settings.depth;
let curTab = 'recipes';
let filter = { q: '', tag: '' };
const rmeta = (id) => (meta[id] = meta[id] || {});
function saveMeta() { store.set('meta', meta); }
const stepKey = (id, i) => id + '#' + i;

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

/* ================= 购物清单 ================= */
function renderShopping() {
  const box = $('#view-shopping');
  const head = `<div class="searchrow" style="padding:4px 0 12px"><button class="btn ghost sm" id="shopClear">清除已勾选</button><button class="btn ghost sm" id="shopAll">清空</button></div>`;
  if (!shopping.length) { box.innerHTML = '<div class="empty">购物清单是空的。<br>在菜谱详情里点「加入购物清单」，食材就会汇总到这里。</div>'; return; }
  box.innerHTML = head + shopping.map((it, i) => `
    <div class="shop-item ${it.checked ? 'checked' : ''}" data-i="${i}">
      <div class="ck ${it.checked ? 'on' : ''}">${it.checked ? '✓' : ''}</div>
      <div class="txt">${esc(it.name)}${it.amount ? ` · <span class="amt" style="color:var(--muted)">${esc(it.amount)}</span>` : ''}<div class="sub">${esc(it.from || '')}</div></div>
    </div>`).join('');
  box.querySelectorAll('.shop-item').forEach(node => node.onclick = () => { const i = +node.dataset.i; shopping[i].checked = !shopping[i].checked; store.set('shopping', shopping); renderShopping(); });
  $('#shopClear') && ($('#shopClear').onclick = () => { shopping = shopping.filter(x => !x.checked); store.set('shopping', shopping); renderShopping(); updateBadges(); });
  $('#shopAll') && ($('#shopAll').onclick = () => { shopping = []; store.set('shopping', shopping); renderShopping(); updateBadges(); });
}
function addToShopping(r, factor) {
  const names = new Set(shopping.map(x => x.name + '|' + x.from));
  (r.ingredients || []).forEach(i => {
    const key = i.name + '|' + r.title;
    if (!names.has(key)) shopping.push({ name: i.name, amount: scaleAmount(i.amount, factor || 1), from: r.title, checked: false });
  });
  store.set('shopping', shopping); updateBadges(); toast('已加入购物清单');
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
    <div style="text-align:center;color:var(--muted);font-size:12px;margin-top:14px">庖丁 · 解剖每一道菜的为什么</div>`;

  box.querySelectorAll('[data-k]').forEach(x => { x.previousElementSibling.onclick = () => { const k = x.dataset.k; settings[k] = k === 'theme' ? (settings.theme === 'dark' ? 'light' : 'dark') : !settings[k]; saveSettings(); applyTheme(); renderSettings(); }; });
  box.querySelectorAll('[data-fs]').forEach(b => b.onclick = () => { settings.fontScale = Math.min(1.5, Math.max(0.85, settings.fontScale + (b.dataset.fs === '+' ? 0.1 : -0.1))); saveSettings(); applyTheme(); renderSettings(); });
  box.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => { settings.ttsRate = Math.min(1.6, Math.max(0.6, settings.ttsRate + (b.dataset.tr === '+' ? 0.1 : -0.1))); saveSettings(); renderSettings(); });
  $('#setDepth').querySelectorAll('.chip').forEach(c => c.onclick = () => { settings.depth = c.dataset.d; depth = c.dataset.d; saveSettings(); renderSettings(); syncDepthChips(); });
  $('#apiBase').onchange = (e) => { settings.apiBase = e.target.value.trim().replace(/\/$/, ''); saveSettings(); toast('已保存后端地址'); refresh(); };
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
        <span class="amt">${esc(scaleAmount(i.amount, factor) || '视频未明确')}</span>
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
  p.querySelector('#dDel').onclick = async () => { if (!confirm('删除这道菜？')) return; try { await API.del(r.id); } catch { } close(); refresh(); toast('已删除'); };
  p.querySelector('#dShare').onclick = () => shareRecipe(r, factor);
  p.querySelector('#addShop').onclick = () => addToShopping(r, factor);
  const aiBox = p.querySelector('#aiBox');
  const aiCall = async (btn, fn, title) => {
    btn.disabled = true;
    const node = el(`<div class="qa" style="border:1px solid var(--line);border-radius:14px;padding:12px 14px"><div class="q" style="font-weight:600;margin-bottom:6px">${title}</div><div class="a" style="color:var(--muted);white-space:pre-wrap">思考中…</div></div>`);
    aiBox.innerHTML = ''; aiBox.appendChild(node);
    try { const { answer } = await fn(); node.querySelector('.a').textContent = answer; }
    catch (e) { node.querySelector('.a').textContent = '失败：' + e.message; }
    btn.disabled = false;
  };
  p.querySelector('#btnOverview').onclick = (e) => aiCall(e.target, () => API.overview(r.id), '💡 为什么这样设计');
  p.querySelector('#btnNutri').onclick = (e) => aiCall(e.target, () => API.nutrition(r.id), '🥗 每份营养估算（粗略）');
  p.querySelector('#btnCook').onclick = () => { close(); openCook(r); };
  p.querySelector('#notes').onchange = (e) => { m.notes = e.target.value; saveMeta(); };
  p.querySelector('#cookedBtn').onclick = (e) => { m.cooked = !m.cooked; if (m.cooked) m.cooked_at = new Date().toISOString(); saveMeta(); e.target.className = 'btn sm ' + (m.cooked ? '' : 'ghost'); e.target.textContent = m.cooked ? '✓ 已做过' : '标记做过'; renderRecipes(); };
  p.querySelectorAll('#rating .rs').forEach(rs => rs.onclick = () => { m.rating = +rs.dataset.r; saveMeta(); p.querySelectorAll('#rating .rs').forEach(x => x.classList.toggle('on', +x.dataset.r <= m.rating)); renderRecipes(); });
  if (base) p.querySelectorAll('.st').forEach(b => b.onclick = () => { factor = Math.max(0.5, factor + (b.dataset.s === '+' ? 0.5 : -0.5)); m.servingsFactor = factor; saveMeta(); p.querySelector('#svVal').textContent = Math.round(base * factor * 10) / 10; renderIng(); });

  $('#app').appendChild(p);
}
function riskBadge(r) { return r === 'high' ? ' <span class="badge risk-high">🔴 新手雷区</span>' : r === 'medium' ? ' <span class="badge risk-medium">🟡 需留意</span>' : ''; }

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
  s += (r.ingredients || []).map(i => `· ${i.name} ${scaleAmount(i.amount, f || 1) || ''}`).join('\n') + '\n\n';
  (r.steps || []).forEach(x => { s += `${x.index}. ${x.title}：${x.action}\n`; if (x.why?.reason) s += `   为什么：${x.why.reason}\n`; });
  return s;
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
        ${paramsHtml(s.params)}${timerHtml(s.params)}
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
    const q = prompt('对「' + s.title + '」这步有什么疑问？'); if (!q) return;
    (asks[s.index] = asks[s.index] || []).push({ q, a: '思考中…' }); renderQA(s);
    try { const { answer } = await API.ask(r.id, s.index, q); asks[s.index][asks[s.index].length - 1].a = answer; }
    catch (e) { asks[s.index][asks[s.index].length - 1].a = '没问出来：' + e.message; }
    renderQA(s);
  }
  function next() { stopSpeak(); if (cur === steps.length - 1) { exit(); toast('做好啦，开动！🍜'); return; } cur++; saveProg(cur); render(); }
  async function sosStep(r, s) {
    const problem = prompt('哪里翻车了？描述一下现象（如「粘锅了」「太咸」「不熟」）'); if (!problem) return;
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
async function doParse(starter) {
  const ov = openModal(`<div class="pct" id="pct">0%</div><div class="stage" id="stage">发起解析…</div>
    <div class="pbar"><div id="bar"></div></div>
    <p style="color:var(--muted);font-size:12px">别关页面，解析中可放一边</p>`);
  const setP = (pct, stage) => { $('#pct', ov).textContent = Math.round(pct) + '%'; $('#bar', ov).style.width = pct + '%'; if (stage) $('#stage', ov).textContent = stage; };
  try {
    const { jobId } = await starter();
    await new Promise((resolve, reject) => {
      const es = new EventSource(api('/api/progress/' + jobId));
      es.onmessage = (ev) => {
        const d = JSON.parse(ev.data);
        if (d.type === 'progress') setP(d.pct || 0, stageLabel(d.stage, d.message));
        else if (d.type === 'done') { es.close(); resolve(d.recipe); }
        else if (d.type === 'error') { es.close(); reject(new Error(d.error)); }
      };
      es.onerror = () => { es.close(); reject(new Error('连接中断')); };
    }).then(async (recipe) => {
      recipes = await API.list(); renderAll(); ov.remove(); toast('解析完成：' + (recipe.title || ''));
      const found = recipes.find(x => x.title === recipe.title); if (found) openDetail(found);
    });
  } catch (e) { ov.remove(); toast('解析失败：' + e.message); }
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
    ['recipes', 'skills', 'shopping', 'settings'].forEach(v => $('#view-' + v).classList.toggle('hidden', v !== curTab));
    const showSearch = curTab === 'recipes';
    $('#searchrow').classList.toggle('hidden', !showSearch); $('#filters').classList.toggle('hidden', !showSearch);
    if (curTab === 'skills') renderSkills(); if (curTab === 'shopping') renderShopping(); if (curTab === 'settings') renderSettings();
  });
}
function init() {
  applyTheme(); syncDepthChips();
  initTabs();
  $('#depth').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; depth = c.dataset.d; syncDepthChips(); };
  $('#parseUrl').onclick = () => { const u = $('#url').value.trim(); if (!/^https?:\/\//.test(u)) { toast('请粘贴 http(s) 视频链接'); return; } doParse(() => API.startUrl(u, depth)); $('#url').value = ''; };
  $('#fileBtn').onclick = () => $('#file').click();
  $('#file').onchange = (e) => { const f = e.target.files[0]; if (f) doParse(() => API.startFile(f, depth)); e.target.value = ''; };
  $('#search').oninput = (e) => { filter.q = e.target.value.trim(); renderRecipes(); };
  // 系统分享导入：从别的 App 分享 B站/YouTube 链接进庖丁 → 自动填入并解析
  try {
    const sp = new URLSearchParams(location.search);
    const shared = (sp.get('url') || sp.get('text') || sp.get('title') || '').match(/https?:\/\/[^\s]+/);
    if (shared) { $('#url').value = shared[0]; history.replaceState(null, '', location.pathname); setTimeout(() => $('#parseUrl').click(), 400); }
  } catch { }
  refresh();
  // PWA
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
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
