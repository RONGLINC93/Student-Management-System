/* ============================================================
   统一提示 / 对话框组件
   - toast():      轻提示（非模态、自动消失）。成功/失败/校验/
                   导入导出/分班动画等一切操作反馈均用它
   - confirmDlg(): 确认类模态框（确定/取消），仅用于删除、清空等
                   不可逆危险操作，需用户明确选择确认/取消
   - notice():     强提示模态框（单确定按钮）。目前页面未使用，
                   保留以备「必须点击确认才可继续」的强提示场景
   - showStatus(): 过程性轻提示（非模态、自动消失），供动画进行中
                   短暂提示使用（正在随机排位 / 正在依次分班）
   ============================================================ */
(function () {
  'use strict';

  const ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  const SOFT_BG = { success: '#dcfce7', error: '#fee2e2', warning: '#fef3c7', info: '#e0e7ff' };
  const STRONG = { success: '#16a34a', error: '#dc2626', warning: '#d97706', info: '#4f6df5' };

  let mask = null;
  let resolver = null;
  let hasCancel = false;

  function ensureDom() {
    if (mask) return;
    mask = document.createElement('div');
    mask.className = 'modal-mask dialog-mask';
    mask.innerHTML = `
      <div class="modal dialog-panel" role="dialog" aria-modal="true">
        <div class="dialog-icon-circle" aria-hidden="true"></div>
        <h3 class="dialog-title" hidden></h3>
        <p class="dialog-msg"></p>
        <div class="dialog-btns">
          <button class="btn btn-default dialog-cancel" type="button">取消</button>
          <button class="btn btn-primary dialog-ok" type="button">确定</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('.dialog-cancel').addEventListener('click', () => closeDialog(false));
    mask.querySelector('.dialog-ok').addEventListener('click', () => closeDialog(true));
    mask.addEventListener('click', (e) => {
      if (e.target === mask && hasCancel) closeDialog(false);
    });
  }

  function closeDialog(value) {
    if (!mask) return;
    if (mask._keyHandler) {
      document.removeEventListener('keydown', mask._keyHandler);
      mask._keyHandler = null;
    }
    mask.classList.remove('show');
    const done = resolver;
    resolver = null;
    if (done) done(value);
  }

  function openDialog(opts) {
    ensureDom();
    if (resolver) closeDialog(false); // 同屏只保留一个对话框

    const type = (opts.type || 'info').toLowerCase();
    const icon = mask.querySelector('.dialog-icon-circle');
    const title = mask.querySelector('.dialog-title');
    const msg = mask.querySelector('.dialog-msg');
    const cancel = mask.querySelector('.dialog-cancel');
    const ok = mask.querySelector('.dialog-ok');

    icon.innerHTML = ICONS[type] || ICONS.info;
    icon.style.background = SOFT_BG[type] || SOFT_BG.info;
    icon.style.color = STRONG[type] || STRONG.info;

    title.hidden = !opts.title;
    title.textContent = opts.title || '';
    msg.textContent = opts.message || '';

    hasCancel = !!opts.showCancel;
    cancel.style.display = hasCancel ? '' : 'none';
    cancel.textContent = opts.cancelText || '取消';
    ok.textContent = opts.okText || '确定';
    ok.classList.toggle('btn-danger', !!opts.danger);
    ok.classList.toggle('btn-primary', !opts.danger);

    mask.classList.add('show');
    setTimeout(() => ok.focus(), 50);

    const onKey = (e) => {
      if (e.key === 'Escape' && hasCancel) closeDialog(false);
      else if (e.key === 'Enter') closeDialog(true);
    };
    document.addEventListener('keydown', onKey);
    mask._keyHandler = onKey;

    return new Promise(resolve => { resolver = resolve; });
  }

  // 提示类：需用户点击「确定」后关闭
  window.notice = function (message, typeOrOpts) {
    let opts;
    if (typeOrOpts && typeof typeOrOpts === 'object') {
      opts = typeOrOpts;
    } else {
      opts = { type: typeOrOpts || 'info' };
    }
    return openDialog(Object.assign({}, opts, { message }));
  };

  // 确认类：确定 / 取消
  window.confirmDlg = function (message, opts = {}) {
    return openDialog(Object.assign({
      type: opts.type || 'warning',
      showCancel: true,
      okText: opts.okText || '确定',
      cancelText: opts.cancelText || '取消',
      title: opts.title || '操作确认'
    }, opts, { message }));
  };

  // 轻提示核心：写入 #toast 元素，自动消失，后到提示会顶替前一个
  function showToast(msg, type = '', keepMs) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(t._tm);
    const ms = keepMs || Math.min(5000, 2400 + (msg || '').length * 26);
    t._tm = setTimeout(() => t.classList.remove('show'), ms);
  }

  // 轻提示：成功/失败/校验/导入导出等一切操作反馈（非模态、自动消失）
  window.toast = function (msg, type = '') {
    showToast(msg, type);
  };

  // 过程性状态轻提示：动画进行中短暂提示
  window.showStatus = function (msg, type = '') {
    showToast(msg, type, 2200);
  };
})();
