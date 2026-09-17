/* ============================================================
   课程表 · 只读周课表渲染（教师端「我的课表」/ 学生端「我的课表」共用）

   renderTimetableGrid(host, data, opts)
     host : 容器元素
     data : 后端返回的课表视图，支持两种形态
            · 学生端：{ term, periods, days, weekdays, className, slots: { 'd-p': slot } }
            · 教师端：{ term, periods, days, weekdays, entries: [{ className, slots }] }
            其中 slot = { subject, teacher, room }
     opts :
       showClass  是否在单元格显示班级（教师端 true，学生端 false）
       showTeacher 是否显示任课教师
       showRoom   是否显示教室
       emptyText  无课/未排课时的占位文案
   ============================================================ */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 把（可能来自多个班级的）课表合并成 「星期-节次」→ 课程条目列表
  function collect(data) {
    var cells = {};
    var sources = [];
    if (data && Array.isArray(data.entries)) {
      data.entries.forEach(function (e) { sources.push(e); });
    } else if (data) {
      sources.push(data);
    }
    sources.forEach(function (src) {
      var slots = (src && src.slots) || {};
      Object.keys(slots).forEach(function (k) {
        if (!/^[1-7]-\d{1,2}$/.test(k)) return;
        var s = slots[k] || {};
        if (!s.subject && !s.teacher && !s.room) return;
        if (!cells[k]) cells[k] = [];
        cells[k].push({
          className: src.className || '',
          grade: src.grade || '',
          subject: s.subject || '',
          teacher: s.teacher || '',
          room: s.room || ''
        });
      });
    });
    Object.keys(cells).forEach(function (k) {
      cells[k].sort(function (a, b) {
        return String(a.className + a.subject).localeCompare(String(b.className + b.subject), 'zh-Hans-CN', { numeric: true });
      });
    });
    return cells;
  }

  function itemHtml(it, opts) {
    var meta = [];
    if (opts.showClass && it.className) meta.push(it.className);
    if (opts.showTeacher && it.teacher) meta.push(it.teacher);
    if (opts.showRoom && it.room) meta.push(it.room);
    var title = [it.className, it.subject, it.teacher, it.room].filter(Boolean).join(' · ');
    return '<div class="tt-it" title="' + esc(title) + '">'
      + '<div class="s">' + esc(it.subject || '（未填科目）') + '</div>'
      + (meta.length ? '<div class="m">' + esc(meta.join(' · ')) + '</div>' : '')
      + '</div>';
  }

  // 渲染整张周课表；返回实际排课时段数（0 表示还没有任何课程）
  window.renderTimetableGrid = function (host, data, opts) {
    if (!host) return 0;
    opts = opts || {};
    data = data || {};
    var periods = Array.isArray(data.periods) ? data.periods : [];
    var days = Array.isArray(data.days) ? data.days : [];
    var weekdays = Array.isArray(data.weekdays) ? data.weekdays : [];
    var cells = collect(data);
    var filled = Object.keys(cells).length;

    if (!periods.length || !days.length) {
      host.innerHTML = '<div class="tt-empty">学校还没有配置课表节次与上课日，请联系教务处。</div>';
      return 0;
    }
    if (!filled) {
      host.innerHTML = '<div class="tt-empty">' + esc(opts.emptyText || '暂无课表安排') + '</div>';
      return 0;
    }

    var head = '<tr><th class="tt-corner">节次</th>' + days.map(function (d) {
      return '<th>' + esc(weekdays[d - 1] || ('星期' + d)) + '</th>';
    }).join('') + '</tr>';

    var body = '';
    periods.forEach(function (p, i) {
      var n = i + 1;
      body += '<tr><th class="tt-period"><b>' + esc(p.label || ('第' + n + '节')) + '</b>'
        + (p.time ? '<span>' + esc(p.time) + '</span>' : '') + '</th>';
      days.forEach(function (d) {
        var items = cells[d + '-' + n] || [];
        body += '<td class="tt-cell' + (items.length ? '' : ' empty') + '">'
          + items.map(function (it) { return itemHtml(it, opts); }).join('')
          + '</td>';
      });
      body += '</tr>';
    });

    host.innerHTML = '<div class="tt-wrap"><table class="tt-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    return filled;
  };
})();
