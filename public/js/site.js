/* ============================================================
   全局站点配置注入
   所有页面引入本脚本后：
   1. 拉取 /api/settings 并缓存到 window.SITE（{ schoolName,
      balanceGender, balanceSpecialty, ... }）；
   2. 若配置了「学校名称」（且与系统默认占位名不同），将页面上
      [data-site-name] 元素与 document.title 中的“智能分班系统”
      替换为学校名称；
   3. 完成后广播 cb-site-ready 事件，供工作台刷新标题等；
   4. 收到 icst-active / icst-refresh / icst-settings 时静默重拉，
      保证设置变更后在已打开的功能页中即时生效。
   ============================================================ */
(function () {
  'use strict';

  var DEFAULT_BRAND = '智能分班系统';

  window.SITE = null;

  function load() {
    return fetch('/api/settings')
      .then(function (r) { return r.json(); })
      .then(function (json) { window.SITE = json && json.data ? json.data : {}; })
      .catch(function () { window.SITE = window.SITE || {}; });
  }

  function apply() {
    var name = window.SITE && window.SITE.schoolName ? String(window.SITE.schoolName).trim() : '';
    // 未配置或仍为系统默认占位名：保持页面原有文案，避免闪烁
    if (!name || name === DEFAULT_BRAND) return;

    var els = document.querySelectorAll('[data-site-name]');
    for (var i = 0; i < els.length; i++) els[i].textContent = name;

    if (document.title.indexOf(DEFAULT_BRAND) !== -1) {
      document.title = document.title.split(DEFAULT_BRAND).join(name);
    }
  }

  function broadcast() {
    try {
      window.dispatchEvent(new CustomEvent('cb-site-ready', { detail: { settings: window.SITE || {} } }));
    } catch (e) {}
  }

  window.siteApply = apply;
  window.siteLoadSettings = function () {
    return load().then(function () { apply(); broadcast(); });
  };

  // 工作台切换选项卡 / 手动刷新 / 系统设置保存后：静默重拉并应用
  window.addEventListener('message', function (ev) {
    if (!ev.data) return;
    var t = ev.data.type;
    if (t === 'icst-active' || t === 'icst-refresh' || t === 'icst-settings') {
      window.siteLoadSettings();
    }
  });

  // 启动加载
  window.siteLoadSettings();
})();
