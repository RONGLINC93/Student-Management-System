/* ============================================================
   后台工作台 - 页面嵌入桥接
   功能页（学生/班级/年级/分班）被 index.html 工作台以 iframe
   打开后：
   1. 隐藏页面自己的站点头部，避免重复导航；
   2. 页内指向其他功能页的跳转转发给父窗口，作为选项卡切换；
   3. 接收父窗口「激活 / 刷新」指令，静默刷新当前数据。
   ============================================================ */
(function () {
  'use strict';

  function inFrame() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }
  var embedded = inFrame();

  if (embedded) {
    // 页面自身头部（logo + 导航）在工作台内隐藏
    document.documentElement.classList.add('cb-embedded');
  }

  // 页面内“打开功能页”的统一出口：嵌入式交给父级选项卡，否则整页跳转
  window.goPage = function (url) {
    if (embedded) {
      try { window.parent.postMessage({ type: 'icst-nav', url: String(url) }, location.origin); }
      catch (e) { location.href = url; }
    } else {
      location.href = url;
    }
  };

  // 拦截页内指向其他功能页的普通链接（如分班页“去班级管理”提示）
  if (embedded) {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) !== '/') return;
      var path = href.split('#')[0].split('?')[0];
      var KNOWN = {
        '/': 1, '/index.html': 1, '/dashboard.html': 1,
        '/students.html': 1, '/classes.html': 1, '/grades.html': 1,
        '/allocate.html': 1
      };
      if (KNOWN[path]) {
        e.preventDefault();
        try { window.parent.postMessage({ type: 'icst-nav', url: href }, location.origin); }
        catch (err) {}
      }
    });
  }

  // 静默刷新：页内已有模态框 / 对话框打开时不打扰
  function refresh() {
    try {
      if (document.querySelector('.modal-mask.show, .dialog-mask.show')) return;
    } catch (e) {}
    try {
      if (typeof window.cbEmbedRefresh === 'function') { window.cbEmbedRefresh(); return; }
      if (typeof window.loadData === 'function') { window.loadData(); return; }
      if (typeof window.loadStudents === 'function') { window.loadStudents(); }
    } catch (err) {}
  }

  window.addEventListener('message', function (ev) {
    if (!ev.data) return;
    if (ev.data.type === 'icst-active' || ev.data.type === 'icst-refresh') refresh();
  });

  // 页面加载完成后通知父窗口，父窗口随即下发“激活”刷新指令
  if (embedded) {
    var sendReady = function () {
      try { window.parent.postMessage({ type: 'icst-ready', url: location.pathname }, location.origin); }
      catch (e) {}
    };
    if (document.readyState === 'complete') sendReady();
    else window.addEventListener('load', sendReady);
  }
})();
