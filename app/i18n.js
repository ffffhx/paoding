/* 庖丁 i18n — classic script, no dependencies */
'use strict';

(function initI18n(global) {
  const zh = {
    'app.title': '庖丁 · 做菜跟做',
    'app.name': '庖丁',
    'app.subtitle': '解剖每一道菜的为什么',
    'home.url.placeholder': '粘贴 B站 / 抖音 / 小红书 / YouTube 链接',
    'home.parse': '解析',
    'home.depth.label': '讲解深度',
    'home.depth.beginner': '新手向',
    'home.depth.beginner.title': '每步讲得更细、更基础，适合厨房新手',
    'home.depth.balanced': '通俗（默认）',
    'home.depth.balanced.title': '通俗易懂、详略得当（推荐）',
    'home.depth.advanced': '进阶原理',
    'home.depth.advanced.title': '讲透火候/食材科学等原理，适合想深入的人',
    'home.vision.label': '🔎 读画面字幕',
    'home.vision.desc': '（视频没口播/字幕多时开，会下整段视频、较慢）',
    'home.images.label': '📸 提取画面截图',
    'home.images.desc': '（每步状态图 + 食材图，需服务端配视觉模型，会下整段视频、较慢）',
    'home.hint.prefix': '也可以 ',
    'home.hint.file': '上传本地视频',
    'home.hint.sep': '、',
    'home.hint.image': '拍照/图片导入',
    'home.hint.or': ' 或 ',
    'home.hint.text': '粘贴文字菜谱',
    'home.hint.suffix': '（菜谱书/手写菜谱/小红书图文适用）· 解析约 1–3 分钟',
    'tabs.recipes': '菜谱',
    'tabs.plan': '本周计划',
    'tabs.techniques': '技法',
    'tabs.shopping': '购物清单',
    'tabs.skills': '技巧收藏',
    'tabs.settings': '设置',
    'home.search.placeholder': '搜索菜名 / 食材 / 标签',
    'home.ingredient.placeholder': '食材：鸡蛋,番茄',
    'home.sort.aria': '菜谱排序',
    'home.sort.recent': '最近添加',
    'home.sort.rating': '评分',
    'home.sort.time': '总时长',
    'home.sort.name': '名称',
    'home.filter.all': '全部',
    'home.filter.favorite': '★ 已收藏',
    'home.filter.cooked': '✓ 做过',
    'home.filter.uncooked': '未做过',
    'home.filter.nutrition': '有营养信息',
    'recipe.empty.title': '还没有菜谱。',
    'recipe.empty.help': '粘贴一个做菜视频链接，或上传本地视频开始解析。',
    'recipe.noMatch': '没有匹配的菜谱。',
    'recipe.untitled': '未命名',
    'recipe.time.approxMin': '⏱ 约{min}分钟',
    'recipe.time.unknown': '⏱ 未知',
    'recipe.steps': '📋 {count}步',
    'recipe.cooked': '✓ 做过',
    'difficulty.easy': '简单',
    'difficulty.medium': '中等',
    'difficulty.hard': '有挑战',
    'jobs.header': '最近任务',
    'jobs.status.queued': '排队中',
    'jobs.status.running': '解析中',
    'jobs.status.done': '已完成',
    'jobs.status.error': '失败',
    'jobs.status.interrupted': '已中断',
    'jobs.status.unknown': '未知',
    'jobs.type.url': '链接',
    'jobs.type.text': '文字',
    'jobs.type.file': '文件',
    'jobs.type.images': '图片',
    'jobs.type.default': '任务',
    'jobs.title.pastedText': '粘贴文字',
    'parse.starting': '发起解析…',
    'parse.keepOpen': '解析约需 1–3 分钟，别关页面',
    'parse.background': '放到后台继续',
    'parse.running': '解析中',
    'settings.language.label': '语言 / Language',
    'settings.language.desc': '切换界面语言（日期与数字格式暂不本地化）',
    'settings.language.zh': '简体中文',
    'settings.language.en': 'English',
    'settings.language.saved': '已保存界面语言',
  };

  const en = {
    'app.title': 'Paoding · Cook Along',
    'app.name': 'Paoding',
    'app.subtitle': 'Understand why every cooking step works',
    'home.url.placeholder': 'Paste a Bilibili / Douyin / Xiaohongshu / YouTube link',
    'home.parse': 'Parse',
    'home.depth.label': 'Explanation depth',
    'home.depth.beginner': 'Beginner',
    'home.depth.beginner.title': 'More detailed and foundational explanations for newer cooks',
    'home.depth.balanced': 'Balanced (default)',
    'home.depth.balanced.title': 'Clear, practical, and balanced in detail (recommended)',
    'home.depth.advanced': 'Advanced principles',
    'home.depth.advanced.title': 'Go deeper into heat control, ingredient science, and technique',
    'home.vision.label': '🔎 Read on-screen captions',
    'home.vision.desc': '(Use when the video has little narration or many subtitles; slower because the full video is downloaded)',
    'home.images.label': '📸 Extract step images',
    'home.images.desc': '(Step state images + ingredient close-ups; requires a vision model on the server and downloads the full video)',
    'home.hint.prefix': 'You can also ',
    'home.hint.file': 'upload a local video',
    'home.hint.sep': ', ',
    'home.hint.image': 'import photos/images',
    'home.hint.or': ' or ',
    'home.hint.text': 'paste a text recipe',
    'home.hint.suffix': '(recipe books, handwritten recipes, and image posts work) · parsing takes about 1-3 minutes',
    'tabs.recipes': 'Recipes',
    'tabs.plan': 'Weekly Plan',
    'tabs.techniques': 'Techniques',
    'tabs.shopping': 'Shopping List',
    'tabs.skills': 'Saved Tips',
    'tabs.settings': 'Settings',
    'home.search.placeholder': 'Search dishes / ingredients / tags',
    'home.ingredient.placeholder': 'Ingredients: egg,tomato',
    'home.sort.aria': 'Recipe sort order',
    'home.sort.recent': 'Recently added',
    'home.sort.rating': 'Rating',
    'home.sort.time': 'Total time',
    'home.sort.name': 'Name',
    'home.filter.all': 'All',
    'home.filter.favorite': '★ Favorited',
    'home.filter.cooked': '✓ Cooked',
    'home.filter.uncooked': 'Not cooked',
    'home.filter.nutrition': 'Has nutrition',
    'recipe.empty.title': 'No recipes yet.',
    'recipe.empty.help': 'Paste a cooking video link or upload a local video to start parsing.',
    'recipe.noMatch': 'No matching recipes.',
    'recipe.untitled': 'Untitled',
    'recipe.time.approxMin': '⏱ about {min} min',
    'recipe.time.unknown': '⏱ unknown',
    'recipe.steps': '📋 {count} steps',
    'recipe.cooked': '✓ Cooked',
    'difficulty.easy': 'Easy',
    'difficulty.medium': 'Medium',
    'difficulty.hard': 'Challenging',
    'jobs.header': 'Recent Jobs',
    'jobs.status.queued': 'Queued',
    'jobs.status.running': 'Parsing',
    'jobs.status.done': 'Done',
    'jobs.status.error': 'Failed',
    'jobs.status.interrupted': 'Interrupted',
    'jobs.status.unknown': 'Unknown',
    'jobs.type.url': 'Link',
    'jobs.type.text': 'Text',
    'jobs.type.file': 'File',
    'jobs.type.images': 'Images',
    'jobs.type.default': 'Job',
    'jobs.title.pastedText': 'Pasted text',
    'parse.starting': 'Starting parse…',
    'parse.keepOpen': 'Parsing takes about 1-3 minutes. Keep this page open.',
    'parse.background': 'Continue in background',
    'parse.running': 'Parsing',
    'settings.language.label': 'Language',
    'settings.language.desc': 'Switch the interface language. Date and number formats are not localized yet.',
    'settings.language.zh': 'Chinese',
    'settings.language.en': 'English',
    'settings.language.saved': 'Interface language saved',
  };

  const dictionaries = { zh, en };
  const DEFAULT_LANG = 'zh';
  let currentLang = DEFAULT_LANG;

  function normalizeLang(value) {
    const lang = String(value || DEFAULT_LANG).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(dictionaries, lang) ? lang : DEFAULT_LANG;
  }

  function applyDocumentLang(lang) {
    const doc = global.document;
    if (!doc?.documentElement) return;
    doc.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    doc.documentElement.setAttribute('data-lang', lang);
  }

  function setLang(value) {
    currentLang = normalizeLang(value);
    applyDocumentLang(currentLang);
    return currentLang;
  }

  function interpolate(template, params) {
    const values = params && typeof params === 'object' ? params : {};
    return String(template).replace(/\{(\w+)\}/g, (m, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m
    ));
  }

  function t(key, params) {
    const lang = normalizeLang(currentLang);
    const value = dictionaries[lang]?.[key] ?? dictionaries.zh[key] ?? key;
    return interpolate(value, params);
  }

  setLang(DEFAULT_LANG);
  global.PaodingI18n = { DEFAULT_LANG, dictionaries, zh, en, normalizeLang, setLang, getLang: () => currentLang, t };
  global.t = t;
})(window);
