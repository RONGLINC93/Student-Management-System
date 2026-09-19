/* ============================================================
   后台工作台 - 页面嵌入桥接
   功能页（数据总览/学生/班级/年级/教师/成绩/考勤/宿舍/分班）
   被 index.html 工作台以 iframe 打开后：
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
        '/teachers.html': 1, '/hr.html': 1, '/exams.html': 1, '/conduct.html': 1,
        '/dorm.html': 1, '/allocate.html': 1, '/settings.html': 1,
        '/leaves.html': 1, '/announcements.html': 1, '/timetable.html': 1,
        '/courses.html': 1
      };
      if (KNOWN[path]) {
        e.preventDefault();
        try { window.parent.postMessage({ type: 'icst-nav', url: href }, location.origin); }
        catch (err) {}
      }
    });
  }

  // 向父窗口回执刷新结果，便于顶栏给出可见反馈（停止旋转 + 轻提示）
  function report(res) {
    if (!embedded) return;
    try {
      window.parent.postMessage({
        type: 'icst-refreshed', ok: res.ok !== false, skipped: res.skipped || ''
      }, location.origin);
    } catch (e) {}
  }

  // 静默刷新：页内已有模态框 / 对话框打开时不打扰。
  // withReport=true 表示本次是用户点顶栏 / 页签菜单触发的手动刷新，需要回执；
  // 切回页签时的自动刷新（icst-active）不回执，避免误弹提示。
  function refresh(withReport) {
    try {
      if (document.querySelector('.modal-mask.show, .dialog-mask.show')) {
        if (withReport) report({ ok: false, skipped: 'modal' });
        return;
      }
    } catch (e) {}
    try {
      if (typeof window.cbEmbedRefresh === 'function') { window.cbEmbedRefresh(); if (withReport) report({ ok: true }); return; }
      if (typeof window.loadData === 'function') { window.loadData(); if (withReport) report({ ok: true }); return; }
      if (typeof window.loadStudents === 'function') { window.loadStudents(); if (withReport) report({ ok: true }); return; }
    } catch (err) {
      if (withReport) report({ ok: false, skipped: 'error' });
      return;
    }
    if (!withReport) return;
    // 兜底：页面未暴露刷新钩子（如自建页）时整页重载，保证“刷新”一定有效果
    report({ ok: true, skipped: 'reload' });
    try { location.reload(); } catch (e) {}
  }

  window.addEventListener('message', function (ev) {
    if (!ev.data) return;
    if (ev.data.type === 'icst-active') refresh(false);
    else if (ev.data.type === 'icst-refresh') refresh(true);
    // 父窗口要求重新执行页内深链（如人事管理「查看」重复查看同一人，地址未变不重载页面）
    else if (ev.data.type === 'icst-deeplink') {
      try { if (typeof window.cbEmbedDeepLink === 'function') window.cbEmbedDeepLink(); } catch (e) {}
    }
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
