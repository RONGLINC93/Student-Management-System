/* ============================================================
   全局站点配置注入
   所有页面引入本脚本后：
   1. 拉取 /api/settings 并缓存到 window.SITE（{ schoolName,
       logoDataUrl, schoolYear, slogan, schoolAddress, schoolPhone,
       schoolWebsite, balanceGender, balanceSpecialty, ... }）；
   2. 按配置应用到页面：
      - 学校名称：替换 [data-site-name] 文本与标题中的“智能分班系统”
      - 校徽：将 [data-site-logo] 处的默认图标替换为校徽图片
      - 学年标签：写入 [data-site-year]（大屏副标题行胶囊）
      - 校训/地址/电话/官网：写入 [data-site-meta]（大屏页脚）
      - 官网：配置后显示 [data-site-web] 顶栏入口，指向学校官网
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

  // 学校名称：与默认占位名相同时保持页面原有文案，避免闪烁
  function applyBrand(name) {
    if (!name || name === DEFAULT_BRAND) return;
    var els = document.querySelectorAll('[data-site-name]');
    for (var i = 0; i < els.length; i++) els[i].textContent = name;
    if (document.title.indexOf(DEFAULT_BRAND) !== -1) {
      document.title = document.title.split(DEFAULT_BRAND).join(name);
    }
  }

  // 校徽：替换页面上所有 [data-site-logo] 处的图标
  function applyLogo(url) {
    var hosts = document.querySelectorAll('svg[data-site-logo]');
    for (var i = 0; i < hosts.length; i++) {
      var svg = hosts[i];
      var host = svg.parentElement;
      if (!host) continue;
      var img = null;
      for (var c = 0; c < host.children.length; c++) {
        var node = host.children[c];
        if (node !== svg && String(node.className || '').indexOf('site-logo-img') !== -1) {
          img = node;
          break;
        }
      }
      if (url) {
        if (!img) {
          img = document.createElement('img');
          img.className = 'site-logo-img';
          img.alt = '校徽';
          host.insertBefore(img, svg);
        }
        img.src = url;
        svg.style.display = 'none';
      } else {
        if (img && img.parentNode) img.parentNode.removeChild(img);
        svg.style.display = '';
      }
    }
  }

  // 学年标签
  function applyYear(str) {
    var els = document.querySelectorAll('[data-site-year]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = str || '';
      els[i].style.display = str ? '' : 'none';
    }
  }

  // HTML 转义（大屏页脚文本来自设置，避免特殊字符破坏结构）
  function escHtml(t) {
    var d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  // 大屏页脚：校训 / 地址 / 电话 / 官网入口
  function applyMeta(s) {
    var parts = [];
    if (s.slogan) parts.push(escHtml(s.slogan));
    if (s.schoolAddress) parts.push(escHtml('地址：' + s.schoolAddress));
    if (s.schoolPhone) parts.push(escHtml('联系电话：' + s.schoolPhone));
    var web = String(s.schoolWebsite || '').trim();
    var meta = document.querySelector('[data-site-meta]');
    if (meta) {
      meta.innerHTML = parts.join('　·　');
      if (web) {
        meta.appendChild(document.createTextNode('　·　'));
        var a = document.createElement('a');
        a.href = web;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'board-site-link';
        a.textContent = '官网 ↗';
        meta.appendChild(a);
      }
    }
    var host = document.querySelector('[data-site-meta-host]');
    if (host) host.style.display = (parts.length || web) ? '' : 'none';
  }

  // 官网入口：配置学校官网后显示（各功能页顶栏 / 后台工作台右上角）
  function applyWeb(url) {
    var els = document.querySelectorAll('[data-site-web]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (url) {
        el.setAttribute('href', url);
        el.removeAttribute('hidden');
      } else {
        el.removeAttribute('href');
        el.setAttribute('hidden', '');
      }
    }
  }

  function apply() {
    var s = window.SITE || {};
    applyBrand(String(s.schoolName || '').trim());
    applyLogo(s.logoDataUrl || '');
    applyYear(String(s.schoolYear || '').trim());
    applyMeta(s);
    applyWeb(String(s.schoolWebsite || '').trim());
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
