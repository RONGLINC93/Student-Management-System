/* ============================================================
   全局站点配置注入
   所有页面引入本脚本后：
   1. 拉取 /api/settings 并缓存到 window.SITE（{ schoolName,
       logoDataUrl, schoolYear, slogan, schoolAddress, schoolPhone,
       schoolWebsite, balanceGender, balanceSpecialty, ... }）；
   2. 按配置应用到页面：
      - 学校名称：替换 [data-site-name] 文本与标题中的“学生管理系统”
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

  var DEFAULT_BRAND = '学生管理系统';

  window.SITE = null;

  // ===== 科目配置与成绩辅助（全站统一） =====
  var DEFAULT_SUBJECTS = [
    { key: 'chinese', name: '语文', max: 150 },
    { key: 'math', name: '数学', max: 150 },
    { key: 'english', name: '英语', max: 150 },
    { key: 'science', name: '理综', max: 300 }
  ];
  window.SUBJECTS = DEFAULT_SUBJECTS.map(function (s) { return Object.assign({}, s); });

  // 科目增删后供页面重建表格使用（订阅 cb-site-ready）
  window.__subjectSeq = 0;

  function refreshSubjects(s) {
    var arr = (s && s.subjects && s.subjects.length) ? s.subjects : DEFAULT_SUBJECTS;
    var list = arr.map(function (x) {
      return {
        key: String((x && x.key) || '').replace(/[^a-zA-Z0-9_]/g, '') || 'subject',
        name: String((x && x.name) || '').trim() || '科目',
        max: Math.max(10, Math.min(1000, Number(x && x.max) || 100))
      };
    }).filter(function (x) {
      return !!x.key;
    });
    var seen = {};
    list = list.filter(function (x) { if (seen[x.key]) return false; seen[x.key] = 1; return true; });
    window.SUBJECTS = list;
    window.__subjectSeq++;
  }

  // 读取学生某科成绩（无则返回 null）
  function subjScore(stu, key) {
    if (!stu || !stu.scores) return null;
    var v = stu.scores[key];
    return (v === '' || v === null || v === undefined) ? null : Number(v);
  }
  window.stuScore = subjScore;

  // 总分（缺科按 0 计，兼容分班均衡；空白科不算入已考科数）
  function subjTotal(stu) {
    var sum = 0, hit = 0;
    var list = window.SUBJECTS || [];
    for (var i = 0; i < list.length; i++) {
      var v = subjScore(stu, list[i].key);
      if (v === null) continue;
      sum += v;
      hit++;
    }
    return { total: sum, count: hit };
  }
  window.subjTotal = subjTotal;

  // 平均分（已考科目平均，无成绩科不计）
  function subjAvgScore(stu) {
    var r = subjTotal(stu);
    return r.count ? r.total / r.count : 0;
  }
  window.subjAvg = subjAvgScore;

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
    refreshSubjects(s);
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

  // ===== 登录用户：顶栏账号展示 / 查看模式隐藏管理入口 =====
  window.AUTH = null;

  var IC_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  var IC_LOGOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

  function renderAuthUI() {
    var a = window.AUTH;
    if (!a) return;

    // 查看模式：隐藏「系统设置 / 智能分班」等管理与写操作入口
    if (a.role === 'viewer') {
      var hid = document.querySelectorAll(
        'a[href*="settings"], a[href*="allocate"], .menu-item[data-mod="settings"], .dq-item[href*="settings"]'
      );
      for (var i = 0; i < hid.length; i++) hid[i].style.display = 'none';
    }

    // 顶栏（后台工作台右侧 / 单页顶部导航）插入账号胶囊
    var host = document.querySelector('.tb-actions');
    if (!host) host = document.querySelector('.nav');
    if (!host) return;

    var chip = document.createElement('span');
    chip.className = 'auth-chip';
    chip.title = '当前账号：' + a.username + '（' + (a.label || (a.role === 'viewer' ? '查看模式' : '管理员')) + '）';
    chip.innerHTML =
      IC_USER +
      '<em class="auth-name"></em>' +
      '<i class="auth-role">' + escHtml(a.role === 'viewer' ? '查看' : '管理') + '</i>' +
      '<a class="auth-exit" href="/api/logout" title="退出登录">' + IC_LOGOUT + '</a>';
    chip.querySelector('.auth-name').textContent = a.nickname || a.username;
    host.appendChild(chip);
  }

  function loadAuth() {
    return fetch('/api/auth/me')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        window.AUTH = (j && j.code === 0 && j.data) ? j.data : null;
      })
      .catch(function () { window.AUTH = null; })
      .then(function () {
        renderAuthUI();
        try {
          window.dispatchEvent(new CustomEvent('cb-auth-ready', { detail: { auth: window.AUTH } }));
        } catch (e) {}
      });
  }
  window.siteLoadAuth = loadAuth;

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
  window.siteLoadAuth();
})();
