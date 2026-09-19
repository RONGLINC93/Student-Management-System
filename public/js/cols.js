// 列表「列设置」通用模块（教师管理 / 后勤职工 / 学生档案共用）
// 提供：列显隐记忆（localStorage）、精简视图 / 显示全部、下拉菜单渲染与开合。
// 用法：
//   const cols = Cols.create({ storeKey, defs, core, locked, onChange });
//   cols.bindDropdown(btnEl, wrapEl, menuEl); cols.visible();
(function () {
  'use strict';

  function create(opts) {
    const o = opts || {};
    const storeKey = o.storeKey || '';
    const defsOf = () => (typeof o.defs === 'function' ? o.defs() : (o.defs || []));
    const locked = o.locked || [];   // 固定显示的列（不可隐藏，如姓名 / 操作）
    const core = o.core || [];       // 「精简视图」保留的列

    function load() {
      try {
        const v = JSON.parse(localStorage.getItem(storeKey) || 'null');
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
      } catch (e) { return {}; }
    }
    function save(f) {
      try { localStorage.setItem(storeKey, JSON.stringify(f)); } catch (e) {}
    }
    // 未配置过的列按 def.off 决定：off=true 的列（如照片）默认隐藏
    function visibleOf(def, f) {
      if (locked.indexOf(def.key) !== -1) return true;
      if (Object.prototype.hasOwnProperty.call(f, def.key)) return !!f[def.key];
      return !def.off;
    }
    function fire() { if (typeof o.onChange === 'function') o.onChange(); }

    const api = {
      visible() {
        const f = load();
        return defsOf().filter(d => visibleOf(d, f));
      },
      toggle(key) {
        const f = load();
        const d = defsOf().find(x => x.key === key);
        if (!d || locked.indexOf(key) !== -1) return;
        f[key] = !visibleOf(d, f);
        save(f);
        fire();
      },
      // 精简视图：只保留 core 中的列（锁定列恒显示）
      applyCore() {
        const f = {};
        defsOf().forEach(d => { if (locked.indexOf(d.key) === -1) f[d.key] = core.indexOf(d.key) !== -1; });
        save(f);
        fire();
      },
      // 显示全部：含照片等默认隐藏的列
      showAll() {
        const f = {};
        defsOf().forEach(d => { if (locked.indexOf(d.key) === -1) f[d.key] = true; });
        save(f);
        fire();
      },
      renderMenu(menuEl) {
        if (!menuEl) return;
        const f = load();
        const items = defsOf().map(d => {
          const on = visibleOf(d, f);
          const isLock = locked.indexOf(d.key) !== -1;
          return '<label class="col-item' + (isLock ? ' locked' : '') + '"'
            + (isLock ? ' title="该列固定显示"' : '') + '>'
            + '<input type="checkbox" data-col="' + d.key + '"' + (on ? ' checked' : '')
            + (isLock ? ' disabled' : '') + ' />'
            + '<span>' + String(d.label || '') + '</span></label>';
        }).join('');
        menuEl.innerHTML = '<div class="col-head">'
          + '<button type="button" class="col-btn" data-cols="core">精简视图</button>'
          + '<button type="button" class="col-btn" data-cols="all">显示全部</button>'
          + '</div><div class="col-list">' + items + '</div>';
        if (menuEl.dataset.colBound) return;
        menuEl.dataset.colBound = '1';
        menuEl.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-cols]');
          if (btn) {
            if (btn.dataset.cols === 'core') api.applyCore();
            else api.showAll();
            api.renderMenu(menuEl);
            return;
          }
          const item = e.target.closest('.col-item');
          if (!item) return;
          const cb = item.querySelector('input[data-col]');
          if (!cb || cb.disabled) return;
          api.toggle(cb.dataset.col);
          api.renderMenu(menuEl);
        });
      },
      // 下拉开合：点按钮开 / 关，点击外部或 Esc 关闭
      bindDropdown(btnEl, wrapEl, menuEl) {
        if (!btnEl || !menuEl) return;
        const close = () => {
          if (wrapEl) wrapEl.classList.remove('open');
          menuEl.classList.remove('show');
        };
        btnEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (menuEl.classList.contains('show')) { close(); return; }
          api.renderMenu(menuEl);
          if (wrapEl) wrapEl.classList.add('open');
          menuEl.classList.add('show');
        });
        document.addEventListener('click', (e) => {
          if (!menuEl.classList.contains('show')) return;
          if (menuEl.contains(e.target) || btnEl.contains(e.target)) return;
          close();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      }
    };
    return api;
  }

  window.Cols = { create: create };
})();
