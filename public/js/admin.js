/* ============================================================
   学生管理系统 · 后台工作台主逻辑
   左侧菜单 -> 打开功能页选项卡；iframe 独立加载各功能页；
   选项卡切换/关闭（切回时静默刷新保证数据最新）；
   选项卡支持鼠标拖拽排序；新开页签一律按点开顺序追加在末尾；
   页签超过条宽放不下时，把非当前页签收进最右端“更多”下拉（点击切换/关闭），
   固定页“数据总览”与当前页始终保留在条上；
   页签顺序与工作台状态（分屏/当前页等）按登录账号记入服务端，
   换电脑或重新登录后自动恢复上次的版式；
   选项卡条最右端的独立“并列”按钮：把“当前功能页”移到右侧副窗格固定保留，
   上一次访问的功能页留在左侧主窗格左右同屏对比（再次点击退出）；
   数据总览（固定页）不参与分屏；
   分屏时选项卡条也随窗格分为左右两栏：固定页与其余页签在主栏（顺序即
   用户拖拽排好的顺序，切换页签不重排），副窗格页签单独进副栏；
   版式随视口自适应：宽屏左右分屏、中屏上下分屏、窄屏退化为单窗格。
   ============================================================ */
(function () {
  'use strict';

  function $(s) { return document.querySelector(s); }

  var IC = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    teacher: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    exam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/></svg>',
    conduct: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    dorm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14"/><path d="M7 21v-5h10v5"/><path d="M10 6h4M10 9h4M10 12h4"/></svg>',
    classes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>',
    grades: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>',
    allocate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    leave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>',
    notice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  var MODULES = {
    dashboard: { key: 'dashboard', title: '数据总览', icon: IC.chart, src: '/dashboard.html', pinned: true },
    students: { key: 'students', title: '学生档案', icon: IC.user, src: '/students.html', pinned: false },
    classes:  { key: 'classes',  title: '班级管理', icon: IC.classes, src: '/classes.html', pinned: false },
    grades:   { key: 'grades',   title: '年级管理', icon: IC.grades, src: '/grades.html', pinned: false },
    teachers: { key: 'teachers', title: '教师管理', icon: IC.teacher, src: '/teachers.html', pinned: false },
    exams:    { key: 'exams',    title: '成绩管理', icon: IC.exam, src: '/exams.html', pinned: false },
    analysis: { key: 'analysis', title: '成绩分析', icon: IC.trend, src: '/analysis.html', pinned: false },
    conduct:  { key: 'conduct',  title: '考勤操行', icon: IC.conduct, src: '/conduct.html', pinned: false },
    leaves:   { key: 'leaves',   title: '请假管理', icon: IC.leave, src: '/leaves.html', pinned: false },
    notice:   { key: 'notice',   title: '通知公告', icon: IC.notice, src: '/announcements.html', pinned: false },
    dorm:     { key: 'dorm',     title: '宿舍管理', icon: IC.dorm, src: '/dorm.html', pinned: false },
    allocate: { key: 'allocate', title: '智能分班', icon: IC.allocate, src: '/allocate.html', pinned: false },
    settings: { key: 'settings', title: '系统设置', icon: IC.settings, src: '/settings.html', pinned: false }
  };

  var tabs = [];          // 已打开的选项卡（固定页在最前；其余按打开顺序，拖拽可调）
  var splitOn = false;    // 是否处于并列（分屏）状态
  var activeKey = null;   // 当前操作目标（焦点）：顶栏标题/刷新/新窗口跟随它；单窗格即整屏页
  var leftKey = null;     // 分屏时左侧主窗格当前页签（主栏高亮跟随它）
  var rightKey = null;    // 分屏时右侧副窗格当前页签（副栏高亮跟随它）
  var lastFocusKey = null; // 上一次访问的功能页选项卡（数据总览等固定页不参与分屏）
  var splitRatio = 0.5;   // 分屏时主窗格占比（拖动分隔条调整；左右=宽占比，上下=高占比）
  var SPLIT_MIN = 0.25;   // 分隔条拖动的下限（主窗格最小占比）
  var SPLIT_MAX = 0.75;   // 分隔条拖动的上限（副窗格最小占比）
  var dividerDrag = null; // 内容区分隔条的拖拽状态（水平拖动调宽 / 垂直拖动调高）

  var tabBar = $('#tabBar');
  var tabScroll = $('#tabScroll');
  var tabSide = $('#tabSide');
  var workbench = $('#workbench');
  var wbDivider = $('#wbDivider');   // 两窗格之间的可拖拽分隔条
  var currentTitle = $('#currentTitle');
  var btnRefresh = $('#btnRefresh');
  var btnNewWin = $('#btnNewWin');
  var btnExitSplit = $('#btnExitSplit');
  var btnSplit = $('#btnSplit');
  var btnTabMenu = $('#btnTabMenu');   // 选项卡条右端“三个点”按钮
  var tabMenu = $('#tabMenu');         // 该按钮弹开的页签操作下拉

  // 侧边栏「宿舍管理」菜单项及其待审核角标
  var dormItem = document.querySelector('.menu-item[data-mod="dorm"]');
  var dormBadge = document.getElementById('menuDormBadge');

  // “更多”溢出下拉：主/副两个栏各建一个，页签放不下时收起部分页签到按钮里
  //（菜单挂到 body；按钮恒为所在栏的最后一个子元素，避免影响顺序类逻辑）
  var overflowCtrls = [];
  var moreDrag = null;    // “更多”菜单行拖拽状态（菜单内排序 / 拖到条上放置）
  var moreDropTime = 0;   // 菜单行拖完释放时刻，用于吞掉拖完那次 click
  var moreMain = createOverflowCtl(tabScroll, false);
  var moreSide = createOverflowCtl(tabSide, true);
  for (var oi = 0; oi < overflowCtrls.length; oi++) {
    (function (ctl) {
      ctl.btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (ctl.menu.hidden) ctl.openMenu(); else ctl.closeMenu();
      });
      // 菜单行按下（排除行尾关闭按钮）：记录拖动起点，供上下拖拽排序
      ctl.menu.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.tmi-close')) return;
        var row = e.target && e.target.closest ? e.target.closest('.tab-more-item') : null;
        if (!row) return;
        moreDrag = { ctl: ctl, row: row, key: row.dataset.key || '', startY: e.clientY,
          moved: false, mode: 'menu', slot: null, barContainer: null };
      });
    })(overflowCtrls[oi]);
  }
  // 点击按钮/菜单外部、按 Esc：收起所有下拉菜单（含“更多”溢出菜单与“三个点”页签操作菜单）
  document.addEventListener('pointerdown', function (e) {
    // 页签操作“三个点”下拉：点按钮/菜单内部不收起，其余一律收起
    if (tabMenu && !tabMenu.hidden) {
      var inBtn = btnTabMenu && (btnTabMenu === e.target || (btnTabMenu.contains && btnTabMenu.contains(e.target)));
      var inMenu = e.target && tabMenu.contains && tabMenu.contains(e.target);
      if (!inBtn && !inMenu) closeTabMenu();
    }
    for (var j = 0; j < overflowCtrls.length; j++) {
      var c = overflowCtrls[j];
      if (e.target && c.btn && (c.btn === e.target || (c.btn.contains && c.btn.contains(e.target)))) continue;
      if (e.target && c.menu && (c.menu === e.target || (c.menu.contains && c.menu.contains(e.target)))) continue;
      c.closeMenu();
    }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeTabMenu();
      for (var k = 0; k < overflowCtrls.length; k++) overflowCtrls[k].closeMenu();
    }
  });

  // 拖拽状态（数据总览为固定页，不可拖）
  var dragState = null;             // 当前拖拽中的选项卡
  var lastDropTime = 0;             // 拖拽落点时间，用于吞掉拖拽产生的那次 click

  // 服务端记忆选项卡状态：按登录账号保存在 data/workbench.json，
  // 刷新/换台电脑/重新登录后恢复上次打开的选项卡、顺序与分屏版式
  var WB_API = '/api/workbench';  // 工作台状态读写接口
  var wbSaveTimer = null;         // 保存防抖定时器
  var wbDirty = false;            // 是否有待保存的变更
  var wbBusy = false;             // 正在写入服务端（避免并发旧快照覆盖）
  var wbSuspended = false;        // 初始化恢复阶段不触发保存

  // ===== 服务端状态记忆 =====
  // 汇总当前工作台状态：打开的页签及归属、当前操作页、分屏与两窗格当前页
  function collectWbState() {
    var st = {
      ts: Date.now(),
      tabs: [],
      activeKey: activeKey,
      splitOn: !!splitOn,
      splitRatio: Math.round(splitRatio * 100) / 100,  // 分屏主窗格占比（拖动分隔条调整）
      leftKey: splitOn ? leftKey : null,
      rightKey: splitOn ? rightKey : null
    };
    for (var i = 0; i < tabs.length; i++) {
      st.tabs.push({ key: tabs[i].key, side: !!tabs[i].side });
    }
    return st;
  }

  // 查看模式账号只读（服务端同样拒绝其写请求），无需反复尝试保存
  function canSaveWb() {
    return !(window.AUTH && window.AUTH.role === 'viewer');
  }

  // 立即把当前状态写入服务端（失败静默，保留脏标记等下次变更再试）
  function saveWbNow() {
    if (wbSuspended || wbBusy || !canSaveWb()) return;
    if (wbSaveTimer) { clearTimeout(wbSaveTimer); wbSaveTimer = null; }
    if (!wbDirty) return;
    wbDirty = false;
    wbBusy = true;
    fetch(WB_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectWbState()),
      keepalive: true
    }).then(function (r) { return r.json(); })
      .catch(function () { return { code: 1 }; })
      .then(function (j) {
        if (!j || j.code !== 0) wbDirty = true; // 保存失败：保留脏标记，下次变更时重试
        wbBusy = false;
      });
  }

  // 变更后防抖保存（600ms 内多次操作合并为一次，取最终状态）
  function scheduleWbSave() {
    if (wbSuspended || !canSaveWb()) return;
    wbDirty = true;
    if (wbSaveTimer) return;
    wbSaveTimer = setTimeout(function () {
      wbSaveTimer = null;
      saveWbNow();
    }, 600);
  }

  // 把分屏比例写入根 CSS 变量（内容窗格与选项卡条分栏共用，保证彼此对齐）
  function applySplitRatio() {
    var pct = Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, splitRatio)) * 10000) / 100;
    document.documentElement.style.setProperty('--split-ratio', pct + '%');
  }

  // 按服务端记忆恢复工作台：依次打开页签 → 应用左右归属 → 应用分屏/当前页
  function restoreWbState(st) {
    if (!st || !st.tabs || !st.tabs.length) return false;
    wbSuspended = true;
    try {
      // 恢复记忆的分割比例（旧快照无此字段时维持默认 50%）
      if (typeof st.splitRatio === 'number' && isFinite(st.splitRatio)) {
        splitRatio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, st.splitRatio));
      } else {
        splitRatio = 0.5;
      }
      var keys = [];
      var sides = {};
      var seen = {};
      for (var i = 0; i < st.tabs.length; i++) {
        var it = st.tabs[i];
        if (!it || !MODULES[it.key] || seen[it.key]) continue;
        seen[it.key] = 1;
        keys.push(it.key);
        sides[it.key] = !!it.side;
      }
      if (!keys.length) return false;
      // 「数据总览」为常驻固定页，始终在数组最前（旧记忆里可能缺失，补上）
      var di = keys.indexOf('dashboard');
      if (di < 0) keys.unshift('dashboard');
      else if (di > 0) { keys.splice(di, 1); keys.unshift('dashboard'); }
      // 按记忆顺序逐个打开（新页签按打开顺序追加，整体顺序即与记忆一致）
      for (i = 0; i < keys.length; i++) {
        if (!getTab(keys[i])) openTab(keys[i]);
      }
      // 应用各页签左右归属（固定页恒在主栏）
      for (i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        t.side = (sides[t.key] && !t.pinned) ? true : false;
      }
      var lg = leftTabs();
      var rg = rightTabs();
      var wantSplit = !!st.splitOn && lg.length > 0 && rg.length > 0;
      if (!wantSplit) {
        splitOn = false;
        rightKey = null;
        for (i = 0; i < tabs.length; i++) tabs[i].side = false;
        var act = getTab(st.activeKey) || tabs[0];
        activeKey = act ? act.key : null;
        leftKey = activeKey;
      } else {
        splitOn = true;
        var lk = getTab(st.leftKey);
        if (!lk || lk.side) lk = lg[0];
        var rk = getTab(st.rightKey);
        if (!rk || !rk.side) rk = rg[0];
        leftKey = lk ? lk.key : null;
        rightKey = rk ? rk.key : null;
        var ak = getTab(st.activeKey);
        if (!ak || (ak.key !== leftKey && ak.key !== rightKey)) ak = lk;
        activeKey = ak ? ak.key : leftKey;
      }
      barSplitOn = false;   // 强制按记忆的分屏/单栏重建一次选项卡条
      applySplitRatio();    // 恢复后应用记忆的分割比例
      layoutPanes();
      return true;
    } finally {
      wbSuspended = false;
    }
  }

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

  // 左侧主窗格组 / 右侧副窗格组（分屏时按页签 side 归属划分）
  function leftTabs() {
    var out = [];
    for (var i = 0; i < tabs.length; i++) if (!tabs[i].side) out.push(tabs[i]);
    return out;
  }
  function rightTabs() {
    var out = [];
    for (var i = 0; i < tabs.length; i++) if (tabs[i].side) out.push(tabs[i]);
    return out;
  }

  /* ---------- 并列显示（左右/上下分屏） ----------
     并列 = 两个窗格各自带一组页签：
       - 页签对象上的 side=true 表示它属于右侧副窗格组；否则属于左侧主窗格组；
       - leftKey / rightKey 分别是左/右窗格当前的页签；
       - activeKey 是“操作目标”：顶栏标题/刷新等跟随它，落点在哪个窗格都行。
     内容 iframe 都叠放在 .workbench 内，靠 .active 决定可见性：
       - 单窗格：仅操作目标页可见，铺满内容区；
       - 并列（宽屏左右、中屏上下）：左窗格与右窗格各显示一页；
       - 窄屏：仅显示当前操作目标页（并列状态保留，窗口拉宽后自动恢复）。
     两栏页签高亮互不干预：主栏始终高亮左窗格当前页，副栏始终高亮右窗格当前页；
     点击副栏页签只切换右窗格当前页/操作目标，页面位置不会互换跳动。 */
  function layoutPanes() {
    // 防御性自愈：分屏时任一窗格缺页签即退出；窗格当前页失效时补组内最前页
    if (splitOn) {
      var lg = leftTabs();
      var rg = rightTabs();
      if (!lg.length || !rg.length) { exitSplit(); return; }
      if (!leftKey || !getTab(leftKey) || getTab(leftKey).side) leftKey = lg[0].key;
      if (!rightKey || !getTab(rightKey) || !getTab(rightKey).side) rightKey = rg[0].key;
    }
    var act = getTab(activeKey) || tabs[0] || null;
    var left = splitOn ? getTab(leftKey) : null;
    var right = splitOn ? getTab(rightKey) : null;
    var two = splitOn && !!left && !!right && window.innerWidth >= 760;
    for (var i = 0; i < tabs.length; i++) {
      var x = tabs[i];
      if (x.frame) {
        x.frame.classList.remove('split-main', 'split-ref');
        var vis = two ? (x === left || x === right) : (x === act);
        x.frame.classList.toggle('active', vis);
      }
      if (x.tabEl) {
        x.tabEl.classList.toggle('active',
          two ? (x.key === leftKey || x.key === rightKey) : x.key === activeKey);
        x.tabEl.classList.toggle('in-side', !!x.side);
      }
    }
    if (two) {
      left.frame.classList.add('split-main');
      right.frame.classList.add('split-ref');
    }
    workbench.classList.toggle('split', two);
    if (btnExitSplit) btnExitSplit.hidden = !splitOn;
    updateSplitBtn();
    arrangeTabBar();
    recalcOverflowAll();   // 页签增删/切换/分屏/改窗口宽度后重算“更多”收拢
  }

  // 内容区分屏只发生在左右分屏版式（>=1100px）；中/窄屏为上下堆叠/单窗格
  function isSideBySide() {
    return window.innerWidth >= 1100;
  }

  // 把选项卡条还原为单条横栏，并恢复 tabs 数组记录的原始顺序
  //（栏末尾的“更多”按钮保持最后位置）
  function restoreTabOrder() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].tabEl) frag.appendChild(tabs[i].tabEl);
    }
    if (tabScroll) insertBarChild(tabScroll, frag);
    if (tabScroll) tabScroll.scrollLeft = 0;
  }

  // 记录当前选项卡条实际编排状态，避免反复重建 DOM
  var barSplitOn = false;   // 选项卡条是否处于分栏状态（仅左右分屏版式时成立）

  // 根据并列状态编排选项卡条：左右分屏时主栏放左窗格组页签、副栏放右窗格组页签，
  // 均按 tabs 数组顺序；只在进入/退出分栏的瞬间重建一次 DOM。
  function arrangeTabBar() {
    if (!tabBar || !tabSide || !tabScroll) return;
    var want = splitOn && isSideBySide() &&
      leftTabs().length > 0 && rightTabs().length > 0;
    if (want === barSplitOn) return;
    barSplitOn = want;
    tabBar.classList.toggle('split', want);
    if (!want) {
      // 未并列、或内容为上下堆叠：副栏收起，还原单条横栏（数组）顺序
      restoreTabOrder();
      return;
    }
    // 主栏放左窗格组页签，副栏放右窗格组页签（均按数组顺序）
    var fragMain = document.createDocumentFragment();
    var fragSide = document.createDocumentFragment();
    for (var i = 0; i < tabs.length; i++) {
      var x = tabs[i];
      if (!x.side) fragMain.appendChild(x.tabEl);
      else fragSide.appendChild(x.tabEl);
    }
    insertBarChild(tabScroll, fragMain);
    insertBarChild(tabSide, fragSide);
    tabScroll.scrollLeft = 0;
    tabSide.scrollLeft = 0;
  }

  /* ===== 选项卡溢出收拢（页签放不下时收起部分到“更多”下拉） =====
     主/副两个栏末尾各有一个动态创建的“更多”按钮：
       - 栏内页签总宽在可用宽度内时不显示按钮；
       - 超出时自右向左收起“非固定、非当前”的页签（.collapsed 隐藏，仍留在
         DOM 中，顺序/拖拽归属不受影响），被收起页签镜像成下拉菜单行：
         点击行切换到该页，行尾按钮可关闭；按住行在菜单内上下拖动可调整
         这些被收起页签的相对顺序，也可把行拖到条上任意两个可见页签之间
         直接展开放置（跨主/副栏拖动会同步改变分屏归属）；
         - 条上拖拽排序开始前临时展开全部页签，结束后再按条宽重新收拢。 */
  var TAB_GAP = 6;   // 与 CSS .tab-scroll / .tab-bar.split .tab-side 的 gap 一致

  function realTabsIn(c) {
    var out = [];
    if (!c || !c.children) return out;
    for (var i = 0; i < c.children.length; i++) {
      var el = c.children[i];
      if (el.classList && el.classList.contains('worktab')) out.push(el);
    }
    return out;
  }
  function overflowBtnOf(c) {
    return (c && c.querySelector) ? c.querySelector('.tab-more-btn') : null;
  }
  // 往栏里追加页签/碎片：恒插到该栏末尾的“更多”按钮之前
  function insertBarChild(c, node) {
    var b = overflowBtnOf(c);
    if (b) c.insertBefore(node, b); else c.appendChild(node);
  }

  function createOverflowCtl(container, isSide) {
    var ctl = { container: container, isSide: isSide, folded: [], btn: null, menu: null, count: null };
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab-more-btn';
    btn.innerHTML = IC.more + '<span class="tab-more-count"></span>';
    ctl.btn = btn;
    ctl.count = btn.querySelector('.tab-more-count');
    var menu = document.createElement('div');
    menu.className = 'tab-more-menu';
    menu.hidden = true;
    document.body.appendChild(menu);
    ctl.menu = menu;
    container.appendChild(btn);   // 按钮恒为该栏最后一个元素

    // 该栏此刻的“高亮页”保护键：单条横栏看 activeKey；分栏时各栏看自己的当前页
    ctl.curKey = function () {
      var unified = !(splitOn && tabSide && tabSide.offsetParent !== null);
      if (unified) return activeKey;
      return isSide ? rightKey : leftKey;
    };
    ctl.protected = function (el) {
      if (el.classList.contains('pinned')) return true;
      return el.dataset.key === ctl.curKey();
    };
    ctl.expand = function () {
      var els = realTabsIn(ctl.container);
      for (var i = 0; i < els.length; i++) els[i].classList.remove('collapsed');
      ctl.hide();
    };
    ctl.recalc = function () {
      var c = ctl.container;
      var els = realTabsIn(c);
      for (var i = 0; i < els.length; i++) els[i].classList.remove('collapsed');
      ctl.closeMenu();
      if (!els.length || c.offsetParent === null) { ctl.hide(); return; }
      // 可用宽度 = clientWidth 减去左右内边距
      var cs = getComputedStyle(c);
      var padL = parseFloat(cs.paddingLeft) || 0;
      var padR = parseFloat(cs.paddingRight) || 0;
      var avail = c.clientWidth - padL - padR;
      if (visibleTabsWidth(els) <= avail) { ctl.hide(); return; }
      ctl.btn.classList.add('show');   // 先显示出来才能量到按钮宽度
      var limit = avail - ctl.btn.offsetWidth - TAB_GAP;
      for (var i = els.length - 1; i >= 0; i--) {
        if (visibleTabsWidth(els) <= limit) break;
        if (!ctl.protected(els[i])) els[i].classList.add('collapsed');
      }
      var folded = [];
      for (i = 0; i < els.length; i++) {
        if (els[i].classList.contains('collapsed')) folded.push(els[i]);
      }
      if (!folded.length) { ctl.hide(); return; }  // 极窄时全是保护页签，退回横向滚动
      ctl.folded = folded;
      ctl.count.textContent = folded.length;
      ctl.btn.title = '收起 ' + folded.length + ' 个页签，点击查看';
      ctl.buildMenu();
    };
    ctl.buildMenu = function () {
      menu.textContent = '';
      var folded = ctl.folded || [];
      for (var i = 0; i < folded.length; i++) {
        var key = folded[i].dataset.key;
        var m = MODULES[key];
        if (!m) continue;
        (function (mKey, mMod) {
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'tab-more-item';
          row.title = mMod.title;
          row.dataset.key = mKey;
          row.innerHTML = '<span class="tmi-icon">' + mMod.icon +
            '</span><span class="tmi-label"></span><span class="tmi-close">' + IC.close + '</span>';
          row.querySelector('.tmi-label').textContent = mMod.title;
          row.querySelector('.tmi-close').addEventListener('click', function (e) {
            e.stopPropagation();
            closeTab(mKey);
          });
          row.addEventListener('click', function () {
            if (Date.now() - moreDropTime < 350) return; // 刚拖完的释放不算“切换页”
            ctl.closeMenu();
            activate(mKey);
          });
          menu.appendChild(row);
        })(key, m);
      }
    };
    ctl.openMenu = function () {
      var folded = [];
      var els = realTabsIn(ctl.container);
      for (var i = 0; i < els.length; i++) {
        if (els[i].classList.contains('collapsed')) folded.push(els[i]);
      }
      if (!folded.length) return;
      ctl.folded = folded;
      ctl.buildMenu();
      menu.hidden = false;
      var cur = ctl.curKey();   // 当前高亮页行加粗
      for (i = 0; i < menu.children.length; i++) {
        menu.children[i].classList.toggle('cur', menu.children[i].dataset.key === cur);
      }
      var r = ctl.btn.getBoundingClientRect();
      menu.style.visibility = 'hidden';
      var mw = menu.offsetWidth;
      var mh = menu.offsetHeight;
      var left = Math.min(r.right - mw, window.innerWidth - mw - 8);
      left = Math.max(8, left);
      var top = r.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.style.visibility = '';
    };
    ctl.closeMenu = function () { if (menu) menu.hidden = true; };
    ctl.hide = function () {
      ctl.btn.classList.remove('show');
      ctl.closeMenu();
      ctl.folded = [];
    };
    overflowCtrls.push(ctl);
    return ctl;
  }
  function visibleTabsWidth(els) {
    var w = 0, n = 0;
    for (var i = 0; i < els.length; i++) {
      if (!els[i].classList.contains('collapsed')) { w += els[i].offsetWidth; n++; }
    }
    return w + (n > 1 ? TAB_GAP * (n - 1) : 0);
  }
  function expandAllForDrag() {
    for (var i = 0; i < overflowCtrls.length; i++) overflowCtrls[i].expand();
  }
  function recalcOverflowAll() {
    for (var i = 0; i < overflowCtrls.length; i++) overflowCtrls[i].recalc();
  }

  /* ---------- “更多”菜单行拖拽 ----------
     被收起页签在“更多”下拉里按住行拖动：
       - 指针停留在下拉内：上下拖动调整这些被收起页签的相对顺序
         （只重排该栏被折叠的页签，条上可见页签保持原位）；
       - 指针离开下拉进入选项卡条区域：可在条上任意两个可见页签之间放置，
         该页签随即从折叠集合展开到对应槽位（跨主/副栏拖动会同步改变分屏归属）；
       - 拖完按栏内 DOM 顺序回写 tabs 数组并保存服务端（与条上拖拽同一链路）；
       - 与点击切换互斥：位移超过阈值才算拖，未拖动仍是普通点击。 */
  function inRectP(x, y, r, pad) {
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  }
  // 命中某条可见的选项卡栏（主栏 / 副栏），返回该容器或 null
  function pickBarAt(x, y) {
    var cs = [];
    if (tabScroll && tabScroll.offsetParent !== null) cs.push(tabScroll);
    if (tabSide && barSplitOn && tabSide.offsetParent !== null) cs.push(tabSide);
    for (var i = 0; i < cs.length; i++) {
      var r = cs[i].getBoundingClientRect();
      if (r.width > 0 && inRectP(x, y, r, 10)) return cs[i];
    }
    return null;
  }
  // 在栏内找“可见页签之间”的虚拟落点（忽略收拢中的页签与“更多”按钮）
  function barDropIn(container, x) {
    var kids = container.children;
    var valid = [];
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (!el.classList || !el.classList.contains('worktab')) continue;
      if (el.classList.contains('dragging') || el.classList.contains('worktab-slot') ||
          el.classList.contains('collapsed') || el.classList.contains('pinned')) continue;
      valid.push(el);
    }
    var pos = valid.length;   // 默认拖到可见页签之后
    for (var j = 0; j < valid.length; j++) {
      var r = valid[j].getBoundingClientRect();
      if (x < r.left + r.width / 2) { pos = j; break; }
    }
    return valid[pos] || null;
  }

  document.addEventListener('pointermove', function (e) {
    var m = moreDrag;
    if (!m) return;
    if (!m.moved) {
      if (Math.abs(e.clientY - m.startY) < 5) return;
      m.moved = true;
      m.row.classList.add('dragging');
    }
    var menu = m.ctl.menu;
    var mr = menu.getBoundingClientRect();
    // —— 指针仍在下拉菜单内：菜单内上下排序（拖到上下边缘附近自动滚动） ——
    if (inRectP(e.clientX, e.clientY, mr, 2)) {
      if (m.mode !== 'menu') exitMoreBarMode(m);
      if (e.clientY < mr.top + 26) menu.scrollTop -= 8;
      else if (e.clientY > mr.bottom - 26) menu.scrollTop += 8;
      var rows = [];
      for (var i = 0; i < menu.children.length; i++) {
        var r = menu.children[i];
        if (r !== m.row) rows.push(r);
      }
      var ins = rows.length;   // 默认插到菜单末尾
      for (var j = 0; j < rows.length; j++) {
        var rc = rows[j].getBoundingClientRect();
        if (e.clientY < rc.top + rc.height / 2) { ins = j; break; }
      }
      var before = rows[ins] || null;
      if (before) { if (m.row.nextElementSibling !== before) menu.insertBefore(m.row, before); }
      else if (menu.lastElementChild !== m.row) menu.appendChild(m.row);
      return;
    }
    // —— 已离开菜单：若命中选项卡条，进入“拖到条上”模式并让虚线占位随指针移动 ——
    var bc = pickBarAt(e.clientX, e.clientY);
    if (!bc) { if (m.mode !== 'menu') exitMoreBarMode(m); return; }
    if (m.mode !== 'bar') enterMoreBarMode(m, bc);
    rollTabBar(e.clientX);
    setSideHl(bc === tabSide);
    var target = barDropIn(bc, e.clientX);
    if (m.slot.parentNode !== bc || m.slot.nextElementSibling !== target) {
      if (target) bc.insertBefore(m.slot, target);
      else {
        var mb = overflowBtnOf(bc);
        if (mb) bc.insertBefore(m.slot, mb); else bc.appendChild(m.slot);
      }
    }
  });

  // 进入“拖到条上”状态：在目标栏放一个虚线占位，随后随指针在可见页签间移动
  function enterMoreBarMode(m, bc) {
    m.mode = 'bar';
    m.barContainer = bc;
    m.slot = document.createElement('div');
    m.slot.className = 'worktab-slot';
    var t = m.key ? getTab(m.key) : null;
    var el = t && t.tabEl ? t.tabEl : m.row;
    var w = (el && el.offsetWidth > 0) ? el.offsetWidth : Math.min(m.row.offsetWidth || 132, 132);
    m.slot.style.width = Math.round(w) + 'px';
    bc.appendChild(m.slot);
  }
  function exitMoreBarMode(m) {
    m.mode = 'menu';
    m.barContainer = null;
    if (m.slot && m.slot.parentNode) m.slot.parentNode.removeChild(m.slot);
    m.slot = null;
    clearSideHl();
  }

  // 释放：指针落在条上时，把被拖页签从折叠集合展开到目标栏对应槽位
  function dropMoreToBar(m) {
    var slot = m.slot;
    var parent = slot && slot.parentNode;
    var ref = slot ? slot.nextElementSibling || null : null;
    if (!parent || !m.key) { exitMoreBarMode(m); return; }
    exitMoreBarMode(m);   // 移除占位、清空副栏高亮
    var t = getTab(m.key);
    if (!t || !t.tabEl) return;
    var el = t.tabEl;
    el.classList.remove('collapsed');
    var toSide = parent === tabSide;
    var movedCross = barSplitOn && !!t.side !== toSide;
    t.side = toSide;
    parent.insertBefore(el, ref);
    commitOrder();               // DOM 顺序 → tabs 数组
    m.ctl.closeMenu();
    if (movedCross) finishCrossMove(t);   // 跨栏：修正窗格当前页/空栏还原并触发布局
    else layoutPanes();
    scheduleWbSave();            // 顺序/归属变化后回写服务端
  }

  function moreDragUp() {
    var m = moreDrag;
    if (!m) return;
    moreDrag = null;
    m.row.classList.remove('dragging');
    if (!m.moved) return;      // 未拖出阈值＝普通点击，交给行 click 切换
    moreDropTime = Date.now(); // 吞掉拖完的 release click
    if (m.mode === 'bar') { dropMoreToBar(m); return; }
    applyMenuDragOrder(m.ctl);
  }
  document.addEventListener('pointerup', moreDragUp);
  document.addEventListener('pointercancel', moreDragUp);

  // 菜单拖完排序：把菜单行顺序填回该栏的折叠槽位（可见页签原位不动），
  // 再回写 tabs 数组并保存服务端；折叠集合不变，无需重算收拢。
  function applyMenuDragOrder(ctl) {
    var keys = [];
    for (var i = 0; i < ctl.menu.children.length; i++) {
      var k = ctl.menu.children[i].dataset && ctl.menu.children[i].dataset.key;
      if (k) keys.push(k);
    }
    if (keys.length < 2) return;
    var els = realTabsIn(ctl.container);
    var elByKey = {};
    for (i = 0; i < els.length; i++) elByKey[els[i].dataset.key] = els[i];
    var ordered = [];
    for (i = 0; i < keys.length; i++) {
      var e = elByKey[keys[i]];
      if (!e || !e.classList.contains('collapsed')) return; // 行与折叠页签不一一对应：放弃本次
      ordered.push(e);
    }
    var fi = 0, seq = [];
    for (i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.classList.contains('collapsed')) seq.push(ordered[fi++]);
      else seq.push(el);
    }
    var frag = document.createDocumentFragment();
    for (i = 0; i < seq.length; i++) frag.appendChild(seq[i]);
    insertBarChild(ctl.container, frag);
    ctl.folded = ordered; // 供下次重建菜单复用（openMenu 也会重新收集当前折叠项）
    commitOrder();        // DOM 顺序 → tabs 数组
    scheduleWbSave();     // 顺序变更持久化到服务端
  }

  // 拖放/跨栏移动后，按“主栏 DOM 顺序 + 副栏 DOM 顺序”回写 tabs 数组，
  // 保证关闭/刷新/退出分屏后顺序稳定。
  function commitOrder() {
    var seq = [];
    function pushEls(container) {
      if (!container) return;
      for (var i = 0; i < container.children.length; i++) {
        var k = container.children[i].dataset && container.children[i].dataset.key;
        if (k) seq.push(k);
      }
    }
    pushEls(tabScroll);
    pushEls(tabSide);
    var seen = {};
    var out = [];
    for (var i = 0; i < seq.length; i++) {
      var t = getTab(seq[i]);
      if (t && !seen[t.key]) { out.push(t); seen[t.key] = 1; }
    }
    for (var i = 0; i < tabs.length; i++) {  // 兜底：未出现在栏里的页签保留
      if (!seen[tabs[i].key]) out.push(tabs[i]);
    }
    tabs = out;
  }

  // 设置“当前操作目标”并把它设为所在窗格的当前页：
  //   单窗格时它即整屏显示页；分屏时页面留在所在窗格原位置（左右不互换、不跳动），
  //   只会让所在栏的页签高亮/顶栏标题跟随变化；两栏各高亮各的，互不干预。
  function focusTab(key) {
    var t = getTab(key);
    if (!t) return;
    // 单窗格模式下记录“上一次访问的功能页”，供独立“并列”按钮选左窗格对照页
    var prev = activeKey ? getTab(activeKey) : null;
    if (!splitOn && prev && prev.key !== key &&
        MODULES[prev.key] && !MODULES[prev.key].pinned) {
      lastFocusKey = prev.key;
    }
    activeKey = key;
    if (splitOn) {
      if (t.side) rightKey = key;   // 副栏页签：切换右窗格当前页
      else leftKey = key;           // 主栏页签：切换左窗格当前页
    } else {
      leftKey = key;
    }

    var m = MODULES[key];
    if (currentTitle) currentTitle.textContent = m.title;
    if (btnNewWin) btnNewWin.href = m.src;
    setTopTitle();

    // 已有内容的选项卡在切回时静默刷新数据
    if (t.loaded) sendTo(t, 'icst-active');
    else t.pendingActive = true;
    layoutPanes();
    scheduleWbSave();   // 记忆当前操作页/窗格当前页
  }

  // 点击页签 / 打开模块。分屏时右侧副栏页签属于右窗格组：点它只切换右窗格当前页
  // 与操作目标，主栏/左窗格原样保留；点主栏页签同理，两栏互不干预。
  function activate(key) {
    var t = getTab(key);
    if (!t) return;
    if (activeKey === key) {
      if (t.loaded) sendTo(t, 'icst-active');
      layoutPanes();
      return;
    }
    focusTab(key);
  }

  // 可进入并列时“左窗格对照页”候选：上一次访问的功能页（不含当前页；数据总览为固定页，
  // 它只能作左窗格内容，不作为入口/右侧页）
  function splitRefCandidate() {
    var act = activeKey ? getTab(activeKey) : null;
    if (!act || act.pinned) return null;
    if (lastFocusKey && lastFocusKey !== activeKey &&
        MODULES[lastFocusKey] && !MODULES[lastFocusKey].pinned &&
        getTab(lastFocusKey)) {
      return lastFocusKey;
    }
    // 备用：倒序找其它已打开的功能页签
    for (var i = tabs.length - 1; i >= 0; i--) {
      var x = tabs[i];
      if (x.key !== activeKey && !MODULES[x.key].pinned) return x.key;
    }
    return null;
  }

  // 独立“并列”按钮状态：未并列且当前页不可分/无可用对照页时禁用
  function updateSplitBtn() {
    if (!btnSplit) return;
    var on = splitOn;
    btnSplit.classList.toggle('on', on);
    btnSplit.disabled = !on && !splitRefCandidate();
    btnSplit.title = on
      ? '退出并列显示（还原单窗格）'
      : '并列显示：把当前页移到右侧副栏，最近访问的页留在左侧对比';
  }

  // 独立“并列”按钮：把“当前页”移入右侧副窗格组（右窗格当前页），最近访问的
  // 功能页留在左侧主窗格（左窗格当前页）；再次点击退出。进入后两侧各可继续在
  // 本栏加/切页签、拖拽调整，右侧可多页签共存。
  function toggleSplitStandalone() {
    if (splitOn) {
      exitSplit();
      return;
    }
    var cur = getTab(activeKey);
    if (!cur || cur.pinned) return;
    var partner = splitRefCandidate();
    if (!partner || partner === cur.key) return;
    splitOn = true;
    cur.side = true;          // 当前页 → 右侧副窗格组
    rightKey = cur.key;       // 右窗格当前页
    focusTab(partner);        // 对照页成为左窗格当前页/操作目标并触发布局
  }

  // 取消并列显示，还原为单窗格：所有页签回到主栏，整页显示 preferKey
  //（缺省用左窗格当前页）。
  function exitSplit(preferKey) {
    if (!splitOn) return;
    splitOn = false;
    for (var i = 0; i < tabs.length; i++) tabs[i].side = false;
    rightKey = null;
    var keep = getTab(preferKey) || getTab(leftKey) || tabs[0] || null;
    if (keep) {
      focusTab(keep.key);
    } else {
      openTab('dashboard');
    }
  }

  function closeTab(key) {
    var t = getTab(key);
    if (!t || t.pinned) return;
    scheduleWbSave();   // 关闭后回写（防抖取最终状态）
    var wasFocus = activeKey === key;
    var wasLeftCur = splitOn && leftKey === key;
    var wasRightCur = splitOn && rightKey === key;
    var idx = tabs.indexOf(t);
    tabs.splice(idx, 1);
    if (t.tabEl && t.tabEl.parentNode) t.tabEl.parentNode.removeChild(t.tabEl);
    if (t.frame && t.frame.parentNode) t.frame.parentNode.removeChild(t.frame);
    if (!tabs.length) {
      openTab('dashboard');
      return;
    }
    if (splitOn) {
      var l = leftTabs();
      var r = rightTabs();
      // 任一窗格没有页签了：退出分屏
      if (!l.length || !r.length) {
        exitSplit();
        return;
      }
      if (wasLeftCur) leftKey = l[0].key;    // 同组最前页签顶上
      if (wasRightCur) rightKey = r[0].key;
      if (wasFocus) {
        focusTab(wasRightCur ? rightKey : leftKey);
        return;
      }
      layoutPanes();
      return;
    }
    if (wasFocus) {
      // 关闭的是当前操作页（单窗格场景）：切到相邻选项卡
      var next = tabs[idx] || tabs[idx - 1] || tabs[0];
      if (next) focusTab(next.key);
      else openTab('dashboard');
      return;
    }
    layoutPanes();
  }

  // 关闭全部页签：仅保留固定页（“数据总览”），同时退出并列显示回到单窗格
  function closeAllTabs() {
    var keep = [];
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (t.pinned) {
        t.side = false;       // 固定页回到主窗格组
        keep.push(t);
        continue;
      }
      if (t.tabEl && t.tabEl.parentNode) t.tabEl.parentNode.removeChild(t.tabEl);
      if (t.frame && t.frame.parentNode) t.frame.parentNode.removeChild(t.frame);
    }
    if (!keep.length) {       // 兜底：无固定页时重新打开“数据总览”
      tabs = [];
      splitOn = false;
      rightKey = null;
      leftKey = null;
      openTab('dashboard');
      return;
    }
    tabs = keep;
    splitOn = false;          // 只剩单窗格内容，退出分屏
    rightKey = null;
    lastFocusKey = null;
    focusTab(keep[0].key);    // 切回“数据总览”（内部会刷新标题/布局并保存状态）
  }

  // ===== 页签操作下拉（选项卡条右端“三个点”） =====
  // 菜单项按当前页签状态启用/禁用：固定页“数据总览”不可关；
  // 打开时贴近按钮右下角定位，超出视口自动翻到按钮上方。
  function hasCloseableTabs() {
    for (var i = 0; i < tabs.length; i++) {
      if (!tabs[i].pinned) return true;
    }
    return false;
  }

  // 刷新当前操作页（顶栏刷新按钮与下拉菜单“刷新当前页”共用）
  function refreshActiveTab() {
    var t = activeKey ? getTab(activeKey) : null;
    if (!t) return;
    if (t.loaded) sendTo(t, 'icst-refresh');
    else t.pendingActive = true;
  }

  function syncTabMenuStates() {
    if (!tabMenu) return;
    var cur = activeKey ? getTab(activeKey) : null;
    var it = tabMenu.querySelector('[data-act="refresh"]');
    if (it) it.disabled = !cur;
    it = tabMenu.querySelector('[data-act="close-current"]');
    if (it) it.disabled = !cur || !!cur.pinned;
    it = tabMenu.querySelector('[data-act="close-all"]');
    if (it) it.disabled = !hasCloseableTabs();
  }

  function openTabMenu() {
    if (!tabMenu || !btnTabMenu || !tabMenu.hidden) return;
    syncTabMenuStates();
    tabMenu.hidden = false;
    btnTabMenu.classList.add('on');
    var r = btnTabMenu.getBoundingClientRect();
    tabMenu.style.visibility = 'hidden';
    var mw = tabMenu.offsetWidth;
    var mh = tabMenu.offsetHeight;
    var left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    left = Math.max(8, left);
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    tabMenu.style.left = left + 'px';
    tabMenu.style.top = top + 'px';
    tabMenu.style.visibility = '';
  }

  function closeTabMenu() {
    if (tabMenu) tabMenu.hidden = true;
    if (btnTabMenu) btnTabMenu.classList.remove('on');
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
      // 按住选项卡左键横向拖动 = 拖拽排序/跨两栏移动（关闭按钮上不触发；固定页不可拖）。
      // 左右分屏分栏时两栏各有自己的页签，可在本栏内排序，也可拖到另一栏：
      //   主栏页签拖进右侧副栏 → 移入右窗格组（多页签可先后拖入共存）；
      //   副栏页签拖回主栏 → 回到左窗格组；仅在同一栏内拖动仍是普通排序。
      el.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.wt-close')) return;
        var r = el.getBoundingClientRect();
        dragState = {
          el: el,
          wasInSide: !!t.side,       // 拖拽开始时所在窗格组
          startX: e.clientX,
          startY: e.clientY,
          grabX: e.clientX - r.left,
          grabY: e.clientY - r.top,
          moved: false,
          overSide: false
        };
      });
    }
    el.addEventListener('click', function () {
      if (Date.now() - lastDropTime < 350) return; // 刚拖完的释放不算“点击切换”
      activate(m.key);
    });
    el.addEventListener('auxclick', function (e) {
      if (e.button === 1) { e.preventDefault(); if (!m.pinned) closeTab(m.key); }
    });
    return el;
  }

  // 新打开的选项卡插入位置：一律追加到“末尾”，页签严格按本次点开顺序排列
  //（数据总览为固定页恒在数组最前；拖拽排好的顺序由服务端记忆保存）。
  // 左右分屏分栏时新页签归属左侧主窗格组，应插在主栏组之后（副栏页签位于
  // tabs 数组尾部，故插槽取主栏页签数而非全量长度）。
  function openSlot(key) {
    return barSplitOn ? leftTabs().length : tabs.length;
  }

  function openTab(key, urlOpt) {
    // 查看模式账号不能进入「系统设置」（服务端同样拦截 settings.html 与写接口）
    if (key === 'settings' && window.AUTH && window.AUTH.role !== 'admin') return;
    var exist = getTab(key);
    if (exist) {
      // 子页面携带 URL（如宿舍深链 ?room=..）跳转时，重载已有标签页以应用新地址
      if (urlOpt) {
        try {
          var target = new URL(urlOpt, location.origin).href;
          if (exist.frame.src !== target) exist.frame.src = target;
        } catch (e) {}
      }
      activate(key);
      return;
    }
    var m = MODULES[key];
    if (!m) return;

    // 新打开的页签归属左侧主窗格组；若已在右侧副窗格组中打开过，则直接激活它
    var t = { key: m.key, pinned: !!m.pinned, side: false, loaded: false, pendingActive: false, tabEl: null, frame: null };
    t.tabEl = buildTab(m, t);
    // 按点开顺序追加到末尾（具体插入点见 openSlot；栏末尾“更多”按钮前插入）
    var slot = openSlot(key);
    insertBarChild(tabScroll, t.tabEl);
    tabs.splice(slot, 0, t);

    var frame = document.createElement('iframe');
    frame.className = 'work-frame';
    frame.src = urlOpt || m.src;
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
    // 分屏中新增页签：让选项卡条按数组顺序重建一次，使新页签落在主栏组末尾
    if (splitOn) barSplitOn = false;
    activate(key);
    scheduleWbSave();   // 记忆新增的页签
  }

  // 标题中的系统名：使用设置中的学校名称（默认仍为“学生管理系统”）
  function siteBase() {
    var n = window.SITE && window.SITE.schoolName ? String(window.SITE.schoolName).trim() : '';
    return (n && n !== '学生管理系统') ? n : '学生管理系统';
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
      case '/':
      case '/index.html': return 'dashboard';
      case '/students.html': return 'students';
      case '/classes.html': return 'classes';
      case '/grades.html': return 'grades';
      case '/teachers.html': return 'teachers';
      case '/exams.html': return 'exams';
      case '/analysis.html': return 'analysis';
      case '/conduct.html': return 'conduct';
      case '/leaves.html': return 'leaves';
      case '/announcements.html': return 'notice';
      case '/dorm.html': return 'dorm';
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
      if (key) openTab(key, d.url);
    } else if (d.type === 'icst-dorm-apps') {
      refreshDormBadge();
    }
  });

  // 左侧菜单点击
  document.querySelectorAll('.menu-item[data-mod]').forEach(function (item) {
    item.addEventListener('click', function () { openTab(item.getAttribute('data-mod')); });
  });

  // 顶栏：刷新当前页
  btnRefresh.addEventListener('click', refreshActiveTab);

  // 顶栏：退出并列显示（还原单窗格）
  if (btnExitSplit) btnExitSplit.addEventListener('click', function () { exitSplit(); });

  // 选项卡条最右端：独立“并列”按钮（数据总览等固定页不参与分屏）
  if (btnSplit) btnSplit.addEventListener('click', toggleSplitStandalone);

  // 选项卡条最右端：页签操作“三个点”按钮 —— 点击展开/收起下拉
  if (btnTabMenu) {
    btnTabMenu.addEventListener('click', function (e) {
      e.stopPropagation();
      if (tabMenu && tabMenu.hidden) openTabMenu(); else closeTabMenu();
    });
  }
  // 下拉菜单项：刷新当前页 / 关闭当前页签 / 关闭全部页签
  if (tabMenu) {
    tabMenu.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.tab-menu-item') : null;
      if (!item || item.disabled) return;
      closeTabMenu();
      var act = item.getAttribute('data-act');
      if (act === 'refresh') {
        refreshActiveTab();
      } else if (act === 'close-current') {
        var cur = activeKey ? getTab(activeKey) : null;
        if (cur && !cur.pinned) closeTab(cur.key);
      } else if (act === 'close-all') {
        closeAllTabs();
      }
    });
  }

  // 站点配置加载完成（如学校名称变更）后刷新顶部标题
  window.addEventListener('cb-site-ready', setTopTitle);

  // ===== 侧边栏「宿舍管理」待审核角标 =====
  function refreshDormBadge() {
    if (!dormItem) return;
    fetch('/api/dorm-apps?status=pending')
      .then(function (r) { return r.json(); })
      .catch(function () { return { code: 1 }; })
      .then(function (j) {
        if (!j || j.code !== 0 || !j.counts) return; // 未登录/接口异常：保持现状
        var n = Number(j.counts.pending) || 0;
        if (dormBadge) {
          dormBadge.textContent = n > 99 ? '99+' : String(n);
          dormBadge.hidden = n <= 0;
        }
        dormItem.title = n > 0 ? ('宿舍管理 · 待审核住宿申请 ' + n + ' 条') : '宿舍管理';
      });
  }

  // 登录角色：查看模式账号隐藏「系统设置」菜单；登录就绪后刷新角标并定时轮询
  window.addEventListener('cb-auth-ready', function () {
    if (!window.AUTH) return;
    if (window.AUTH.role !== 'admin') {
      var it = document.querySelector('.menu-item[data-mod="settings"]');
      if (it) it.style.display = 'none';
    }
    refreshDormBadge();
    setInterval(refreshDormBadge, 20000);
  });

  // 从别处切回工作台窗口时立即刷新（学生在学生中心提交/撤销申请后回到后台即可看到）
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && window.AUTH) refreshDormBadge();
  });

  // ---------- 选项卡拖拽：栏内排序 / 跨两栏移动 ----------
  // 单条横栏（未分屏、上下堆叠版式）：仅横拖排序（数据总览固定，不可拖、不可被越过）；
  // 左右分屏分栏时，主栏（#tabScroll）与副栏（#tabSide）各有自己的页签组，
  //   可在本栏内排序，也可拖到另一栏：进副栏=移入右窗格组并成为右窗格当前页，
  //   回主栏=移入左窗格组并成为左窗格当前页（右窗格可容纳多个页签并存）。
  // dropTargetIn 在指定栏内找“虚拟落点”：应在它之前插入的页签；null 表示拖到末尾
  function dropTargetIn(container, x) {
    var valid = [];
    var pinned = 0;
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.classList.contains('dragging') || el.classList.contains('worktab-slot') ||
          el.classList.contains('tab-more-btn')) continue;
      if (el.classList.contains('pinned')) pinned++;
      valid.push(el);
    }
    var pos = valid.length;
    for (var j = 0; j < valid.length; j++) {
      var r = valid[j].getBoundingClientRect();
      if (x < r.left + r.width / 2) { pos = j; break; }
    }
    // 主栏中数据总览固定排最前，不可被越过
    if (container === tabScroll && pos < pinned) pos = pinned;
    return valid[pos] || null;
  }

  // 拖到左右边缘时自动横向滚动所在栏
  function rollTabBar(x) {
    var containers = tabSide && barSplitOn ? [tabScroll, tabSide] : [tabScroll];
    for (var c = 0; c < containers.length; c++) {
      var sr = containers[c].getBoundingClientRect();
      if (x < sr.left + 30) containers[c].scrollLeft -= 12;
      else if (x > sr.right - 30) containers[c].scrollLeft += 12;
    }
  }

  // 指针是否已进入右侧副栏（#tabSide）范围；仅在分屏分栏（barSplitOn）时有效
  function overSideCol(x, y) {
    if (!tabSide || !barSplitOn) return false;
    var r = tabSide.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var tb = tabBar.getBoundingClientRect();
    if (y < tb.top - 6 || y > tb.bottom + 6) return false;
    return x >= r.left - 6;
  }

  // 副栏整条高亮提示：主栏页签可拖入此处加入右窗格组
  function setSideHl(on) {
    if (tabSide) tabSide.classList.toggle('drag-hl', !!on);
  }
  function clearSideHl() {
    if (tabSide) tabSide.classList.remove('drag-hl');
  }

  // 跨栏移动后的窗格修正：拖入的页签成为目标窗格当前页；若原窗格因此空掉，
  // 交还原为单窗格；焦点跟随拖动页签（避免指向不可见页）
  function finishCrossMove(t) {
    if (!splitOn) return;
    var l = leftTabs();
    var r = rightTabs();
    if (!l.length || !r.length) { exitSplit(t.key); return; }
    if (t.side) {
      if (rightKey !== t.key) rightKey = t.key;     // 进副栏 → 成为右窗格当前页
      if (leftKey === t.key) leftKey = l[0].key;    // 原左当前页被拖走 → 组内最前顶上
    } else {
      if (leftKey !== t.key) leftKey = t.key;       // 回主栏 → 成为左窗格当前页
      if (rightKey === t.key) rightKey = r[0].key;
    }
    var cur = getTab(activeKey);
    if (!cur || (splitOn && activeKey !== leftKey && activeKey !== rightKey)) {
      activeKey = t.key;   // 焦点跟随被拖动页签（它已是目标窗格当前页）
    }
    layoutPanes();
  }

  function endDrag() {
    var d = dragState;
    if (!d) return;
    var el = d.el;
    var slot = d.slot;
    if (!d.moved) {
      clearSideHl();
      dragState = null;
      return;
    }
    var ref = slot ? slot.nextElementSibling || null : null;
    var parent = slot ? slot.parentNode : null;
    if (slot && slot.parentNode) slot.parentNode.removeChild(slot);
    el.classList.remove('dragging');
    el.style.left = '';
    el.style.top = '';
    el.style.width = '';
    el.style.height = '';
    document.body.style.cursor = '';
    clearSideHl();

    var t = getTab(el.dataset.key);
    if (t) {
      var movedCross = false;
      if (barSplitOn) {
        // 分屏分栏：以释放时所在的栏决定归属（放回自身原来那栏 = 栏内排序）
        var toSide = parent === tabSide;
        if (!!t.side !== toSide) movedCross = true;
        t.side = toSide;
      }
      (parent || tabScroll).insertBefore(el, ref);
      commitOrder();      // 回写两栏的新顺序到 tabs 数组
      if (movedCross) {
        finishCrossMove(t);   // 内部会处理空栏还原/当前页修正并触发布局
      } else {
        layoutPanes();
      }
      scheduleWbSave();   // 顺序/归属变化后回写服务端
    }
    lastDropTime = Date.now();
    dragState = null;
  }

  document.addEventListener('pointermove', function (e) {
    var d = dragState;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < 4 && Math.abs(e.clientY - d.startY) < 4) return;
      d.moved = true;
      expandAllForDrag();   // 拖拽时临时展开被收起的页签，结束后重新收拢
      var w = d.el.getBoundingClientRect();
      // 在自身原位留下“虚拟目标”占位，随后随指针在选项卡之间移动
      d.slot = document.createElement('div');
      d.slot.className = 'worktab-slot';
      d.slot.style.width = Math.round(w.width) + 'px';
      d.slot.style.height = Math.round(w.height) + 'px';
      d.el.parentNode.insertBefore(d.slot, d.el);
      d.el.classList.add('dragging');   // position:fixed，跟手移动
      d.el.style.width = w.width + 'px';
      d.el.style.height = w.height + 'px';
      document.body.style.cursor = 'grabbing';
    }
    rollTabBar(e.clientX);
    d.el.style.left = (e.clientX - d.grabX) + 'px';
    d.el.style.top = (e.clientY - d.grabY) + 'px';
    // 占位跟指针在“主栏/副栏”之间移动，落点决定最终插入位置
    d.overSide = overSideCol(e.clientX, e.clientY);
    setSideHl(d.overSide);
    var container = (barSplitOn && d.overSide) ? tabSide : tabScroll;
    var target = dropTargetIn(container, e.clientX);
    if (d.slot.parentNode !== container || d.slot.nextElementSibling !== target) {
      if (target) container.insertBefore(d.slot, target);
      else {
        var mb = overflowBtnOf(container);   // 拖到栏末尾：停在“更多”按钮之前
        if (mb) container.insertBefore(d.slot, mb); else container.appendChild(d.slot);
      }
    }
  });
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // 视口宽度在“左右分屏/上下堆叠”断点间切换时，重排选项卡条分栏
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutPanes, 120);
  });

  /* ===== 两窗格之间可拖拽分隔条 =====
     拖动分隔条实时改写根变量 --split-ratio：
       - 左右分屏（>=1100px）水平拖动调节左右窗格宽度；
       - 上下分屏（760-1099px）垂直拖动调节上下窗格高度；
     释放后防抖保存到服务端。窄屏（<760px）分隔条隐藏，不会触发本拖拽。 */
  if (wbDivider) {
    wbDivider.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !splitOn) return;
      var r = workbench.getBoundingClientRect();
      dividerDrag = {
        l: r.left, t: r.top, w: r.width || 1, h: r.height || 1
      };
      wbDivider.classList.add('dragging');
      document.body.style.cursor = isSideBySide() ? 'col-resize' : 'row-resize';
      try { wbDivider.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
  }
  // 拖动分隔条时按帧节流重算两栏溢出收拢：栏随比例变宽/变窄后，
  // 放得下的页签即时展开、放不下的即时收起进“更多”，与内容窗格保持同步观感
  var dividerRecalcQueued = false;
  function recalcOverflowSoon() {
    if (dividerRecalcQueued) return;
    dividerRecalcQueued = true;
    requestAnimationFrame(function () {
      dividerRecalcQueued = false;
      recalcOverflowAll();
    });
  }
  function stopDividerDrag() {
    if (!dividerDrag) return;
    dividerDrag = null;
    if (wbDivider) wbDivider.classList.remove('dragging');
    document.body.style.cursor = '';
    recalcOverflowAll();    // 松手后按最终栏宽收尾一次（同时清掉排队的 rAF 结果）
    scheduleWbSave();       // 拖动结束，保存新比例
  }
  document.addEventListener('pointermove', function (e) {
    var dd = dividerDrag;
    if (!dd) return;
    var p = isSideBySide()
      ? (e.clientX - dd.l) / dd.w   // 左右分屏：按横向位置换算主窗格宽占比
      : (e.clientY - dd.t) / dd.h;  // 上下分屏：按纵向位置换算上窗格高占比
    p = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, p));
    if (Math.abs(p - splitRatio) < 0.001) return;
    splitRatio = p;
    applySplitRatio();
    recalcOverflowSoon();   // 拖动中：让放不下/放得下的页签即时收拢/展开
  });
  document.addEventListener('pointerup', stopDividerDrag);
  document.addEventListener('pointercancel', stopDividerDrag);

  // 关闭/刷新页面时确保工作台状态已写入服务端（keepalive 保证请求送达）
  window.addEventListener('pagehide', saveWbNow);

  // 深链定位：/index.html?mod=dorm&room=..&focus=.. 时把 mod 之外的参数透传给功能页，
  // 使打开的选项卡直接定位到指定房间（宿舍管理 - 房态详情）
  function urlMod() {
    var m = location.search.match(/[?&]mod=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function deepUrlOpt(want) {
    var rest = location.search.replace(/[?&]mod=[^&]*/, '');
    if (!rest) return MODULES[want].src;
    return MODULES[want].src + (rest.charAt(0) === '&' ? '?' + rest.slice(1) : rest);
  }

  // 启动：深链优先直接打开指定页；
  // 否则等登录信息就绪后，从服务端恢复上次的工作台状态（无记忆则打开「数据总览」）。
  function startWorkbench() {
    var want = urlMod();
    if (MODULES[want]) {
      openTab(want, deepUrlOpt(want));
      return;
    }
    fetch(WB_API)
      .then(function (r) { return r.json(); })
      .catch(function () { return { code: 1 }; })
      .then(function (j) {
        var ok = !!(j && j.code === 0) && restoreWbState(j.data);
        if (!ok) openTab('dashboard');
      });
  }

  // 登录信息（window.AUTH）就绪后再启动，确保「查看模式」与固定页限制判断正确
  if (window.AUTH) startWorkbench();
  else window.addEventListener('cb-auth-ready', startWorkbench);
})();

