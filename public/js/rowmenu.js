/* 通用「行操作」下拉菜单：教师管理、后勤管理等列表页共用（替代行内平铺的多个按钮）
 *
 * 用法：
 *   RowMenu.open(anchorEl, {
 *     caption: '操作 · 张三',      // 可选：菜单顶部说明
 *     captionIcon: '<svg .../>',   // 可选：说明前的图标
 *     head: [item, ...],           // 可选：可滚动区之前的菜单项
 *     list: [item, ...],           // 可选：可滚动菜单区（如班级列表）
 *     tail: [item, ...],           // 可选：可滚动区之后的菜单项（编辑 / 删除等）
 *     onPick: (data, el) => {}     // 点击回调；data = { kind, ...data-* }
 *   });
 *   RowMenu.close();
 *
 * 菜单项 item：{ kind, label, icon, hint, danger, cur, disabled, data }
 * - kind 写入 data-kind，点击时回填回调的 data.kind
 * - data 的键值写成 data-* 属性，并在回调中原样返回
 * - danger 危险操作标红；cur 当前项标绿；disabled 禁用
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  window.ROW_ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    head: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    userMinus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    uncheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    arch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    caret: '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
  };

  var menu = null;
  var pick = null;
  var anchorEl = null;

  function itemHtml(it) {
    var cls = ['rm-item'];
    if (it.danger) cls.push('danger');
    if (it.cur) cls.push('is-cur');
    var attrs = ['type="button"', 'class="' + cls.join(' ') + '"'];
    if (it.disabled) attrs.push('disabled');
    var data = Object.assign({ kind: it.kind || '' }, it.data || {});
    Object.keys(data).forEach(function (k) {
      if (data[k] === undefined || data[k] === null) return;
      attrs.push('data-' + esc(k) + '="' + esc(data[k]) + '"');
    });
    return '<button ' + attrs.join(' ') + '>'
      + (it.icon || '')
      + '<span class="lbl">' + esc(it.label || '') + '</span>'
      + (it.hint ? '<span class="hint">' + esc(it.hint) + '</span>' : '')
      + '</button>';
  }

  function close() {
    if (!menu) return;
    menu.classList.remove('show');
    menu.hidden = true;
    menu.innerHTML = '';
    pick = null;
    anchorEl = null;
  }

  function ensure() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'row-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    menu.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('.rm-item') : null;
      if (!item || item.disabled || !pick) return;
      // 阻止冒泡到 document 的「点击外部关闭」：否则回调里再打开的二级菜单会被立刻关掉
      e.stopPropagation();
      var fn = pick;
      var data = {};
      Object.keys(item.dataset).forEach(function (k) { data[k] = item.dataset[k]; });
      close();
      fn(data, item);
    });
    document.addEventListener('click', function (e) {
      if (!menu || menu.hidden) return;
      if (e.target.closest('.row-menu')) return;
      if (e.target.closest('[data-act="more"]')) return; // 触发按钮交给页面处理（再次点击 = 收起）
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') close();
    });
    // 页面 / 表格滚动、窗口缩放时关闭，避免菜单脱离锚点
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return menu;
  }

  function open(anchor, opts) {
    var el = ensure();
    if (!anchor || !opts) return false;
    // 同一个按钮再次点击 → 收起
    if (anchorEl === anchor && !el.hidden) { close(); return false; }
    var head = opts.head || [];
    var list = opts.list || [];
    var tail = opts.tail || [];
    if (!head.length && !list.length && !tail.length) return false;

    var html = opts.caption
      ? '<div class="rm-caption">' + (opts.captionIcon || '') + '<span>' + esc(opts.caption) + '</span></div>'
      : '';
    html += head.map(itemHtml).join('');
    if (head.length && list.length) html += '<div class="rm-divider"></div>';
    if (list.length) html += '<div class="rm-list">' + list.map(itemHtml).join('') + '</div>';
    if (list.length && tail.length) html += '<div class="rm-divider"></div>';
    html += tail.map(itemHtml).join('');

    el.innerHTML = html;
    pick = typeof opts.onPick === 'function' ? opts.onPick : null;
    anchorEl = anchor;
    el.hidden = false;
    el.style.visibility = 'hidden';
    el.style.opacity = '0';

    var r = anchor.getBoundingClientRect();
    var mh = el.offsetHeight;
    var mw = el.offsetWidth;
    var top = r.bottom + 6;
    var left = r.right - mw;
    var above = top + mh > window.innerHeight - 8;
    if (above) top = Math.max(8, r.top - mh - 6);
    if (left < 8) left = Math.max(8, r.left);
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    el.classList.toggle('above', above);
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.visibility = '';
    el.style.opacity = '';
    requestAnimationFrame(function () { el.classList.add('show'); });
    return true;
  }

  window.RowMenu = { open: open, close: close };
})();
