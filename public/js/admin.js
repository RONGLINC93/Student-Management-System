/* ============================================================
   智能分班系统 · 后台工作台主逻辑
   左侧菜单 -> 打开功能页选项卡；iframe 独立加载各功能页；
   选项卡切换/关闭；切回时静默刷新，保证数据最新。
   ============================================================ */
(function () {
  'use strict';

  function $(s) { return document.querySelector(s); }

  var IC = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    classes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>',
    grades: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>',
    allocate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  var MODULES = {
    dashboard: { key: 'dashboard', title: '数据总览', icon: IC.chart, src: '/dashboard.html', pinned: true },
    students: { key: 'students', title: '学生列表', icon: IC.user, src: '/students.html', pinned: false },
    classes:  { key: 'classes',  title: '班级管理', icon: IC.classes, src: '/classes.html', pinned: false },
    grades:   { key: 'grades',   title: '年级管理', icon: IC.grades, src: '/grades.html', pinned: false },
    allocate: { key: 'allocate', title: '智能分班', icon: IC.allocate, src: '/allocate.html', pinned: false },
    settings: { key: 'settings', title: '系统设置', icon: IC.settings, src: '/settings.html', pinned: false }
  };

  var tabs = [];          // 已打开的选项卡
  var activeKey = null;

  var tabScroll = $('#tabScroll');
  var workbench = $('#workbench');
  var currentTitle = $('#currentTitle');
  var btnRefresh = $('#btnRefresh');
  var btnNewWin = $('#btnNewWin');

  function sendTo(t, type) {
    try {
      if (t && t.frame && t.frame.contentWindow) {
        t.frame.contentWindow.postMessage({ type: type }, location.origin);
      }
    } catch (e) {}
  }

  function getTab(key) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].key === key) return tabs[i];
    return null;
  }

  function closeTab(key) {
    var t = getTab(key);
    if (!t || t.pinned) return;
    var idx = tabs.indexOf(t);
    tabs.splice(idx, 1);
    if (t.tabEl && t.tabEl.parentNode) t.tabEl.parentNode.removeChild(t.tabEl);
    if (t.frame && t.frame.parentNode) t.frame.parentNode.removeChild(t.frame);
    if (activeKey === key) {
      var next = tabs[idx] || tabs[idx - 1] || tabs[0];
      if (next) activate(next.key);
      else openTab('dashboard');
    }
  }

  function activate(key) {
    var t = getTab(key);
    if (!t) return;
    var prev = activeKey ? getTab(activeKey) : null;
    if (prev && prev !== t) {
      prev.tabEl.classList.remove('active');
      prev.frame.classList.remove('active');
    }
    t.tabEl.classList.add('active');
    t.frame.classList.add('active');
    activeKey = key;

    var m = MODULES[key];
    currentTitle.textContent = m.title;
    btnNewWin.href = m.src;
    setTopTitle();
    updateMenu();

    // 已有内容的选项卡在切回时静默刷新数据
    if (t.loaded) sendTo(t, 'icst-active');
    else t.pendingActive = true;
  }

  function buildTab(m, t) {
    var el = document.createElement('div');
    el.className = 'worktab' + (m.pinned ? ' pinned' : '');
    el.dataset.key = m.key;
    el.title = m.title;

    var closeHtml = m.pinned ? '' :
      '<button class="wt-close" title="关闭选项卡">' + IC.close + '</button>';
    el.innerHTML = '<span class="wt-icon">' + m.icon + '</span>' +
      '<span class="wt-label"></span>' + closeHtml;
    el.querySelector('.wt-label').textContent = m.title;
    t.tabEl = el;

    if (!m.pinned) {
      el.querySelector('.wt-close').addEventListener('click', function (e) {
        e.stopPropagation();
        closeTab(m.key);
      });
    }
    el.addEventListener('click', function () { activate(m.key); });
    el.addEventListener('auxclick', function (e) {
      if (e.button === 1) { e.preventDefault(); if (!m.pinned) closeTab(m.key); }
    });
    return el;
  }

  function openTab(key) {
    var exist = getTab(key);
    if (exist) { activate(key); return; }
    var m = MODULES[key];
    if (!m) return;

    var t = { key: m.key, pinned: !!m.pinned, loaded: false, pendingActive: false, tabEl: null, frame: null };
    tabs.push(t);
    tabScroll.appendChild(buildTab(m, t));

    var frame = document.createElement('iframe');
    frame.className = 'work-frame';
    frame.src = m.src;
    frame.title = m.title;
    frame.addEventListener('load', function () {
      t.loaded = true;
      if (t.pendingActive) {
        t.pendingActive = false;
        sendTo(t, 'icst-active');
      }
    });
    t.frame = frame;
    workbench.appendChild(frame);
    activate(key);
  }

  function updateMenu() {
    var items = document.querySelectorAll('.menu-item[data-mod]');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].getAttribute('data-mod') === activeKey);
    }
  }

  // 标题中的系统名：使用设置中的学校名称（默认仍为“智能分班系统”）
  function siteBase() {
    var n = window.SITE && window.SITE.schoolName ? String(window.SITE.schoolName).trim() : '';
    return (n && n !== '智能分班系统') ? n : '智能分班系统';
  }

  function setTopTitle() {
    var m = activeKey ? MODULES[activeKey] : null;
    if (m) document.title = m.title + ' · ' + siteBase() + '后台';
  }

  function moduleByUrl(href) {
    var path = '';
    var query = '';
    try {
      var u = new URL(href, location.origin);
      path = u.pathname;
      query = u.search;
    } catch (e) {
      var parts = String(href).split('?');
      path = parts[0].split('#')[0];
      query = parts[1] ? '?' + parts[1] : '';
    }
    // 优先支持 /index.html?mod=settings 这类深链参数定位
    var modMatch = query.match(/[?&]mod=([^&]+)/);
    if (modMatch) {
      var mod = decodeURIComponent(modMatch[1]);
      if (MODULES[mod]) return mod;
    }
    switch (path) {
      case '/dashboard.html':
      case '/': return 'dashboard';
      case '/index.html':
      case '/students.html': return 'students';
      case '/classes.html': return 'classes';
      case '/grades.html': return 'grades';
      case '/allocate.html': return 'allocate';
      case '/settings.html': return 'settings';
      default: return null;
    }
  }

  // 接收子页面消息：点击了其他功能页链接 / 页面就绪
  window.addEventListener('message', function (ev) {
    if (!ev.data) return;
    var d = ev.data;
    if (d.type === 'icst-nav' && d.url) {
      var key = moduleByUrl(d.url);
      if (key) openTab(key);
    }
  });

  // 左侧菜单点击
  document.querySelectorAll('.menu-item[data-mod]').forEach(function (item) {
    item.addEventListener('click', function () { openTab(item.getAttribute('data-mod')); });
  });

  // 顶栏：刷新当前页
  btnRefresh.addEventListener('click', function () {
    var t = activeKey ? getTab(activeKey) : null;
    if (t && t.loaded) sendTo(t, 'icst-refresh');
    else if (t) t.pendingActive = true;
  });

  // 站点配置加载完成（如学校名称变更）后刷新顶部标题
  window.addEventListener('cb-site-ready', setTopTitle);

  // 启动：默认打开「数据总览」常驻选项卡；
  // 学生列表等其它模块不再常驻，需要时从左侧菜单打开。
  // 支持 /index.html?mod=students 这类地址，直接定位到指定功能选项卡。
  function urlMod() {
    var m = location.search.match(/[?&]mod=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  var want = urlMod();
  if (!MODULES[want]) want = 'dashboard';
  openTab(want);
})();

