/* 庖丁 i18n — classic script, no dependencies */
'use strict';

(function initI18n(global) {
  const zh = {
    'settings.language.label': '语言 / Language',
    'settings.language.desc': '切换界面语言（日期与数字格式暂不本地化）',
    'settings.language.zh': '简体中文',
    'settings.language.en': 'English',
    'settings.language.saved': '已保存界面语言',
  };

  const en = {
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
