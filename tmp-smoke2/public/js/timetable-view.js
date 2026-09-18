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

  // 按节次开始时间划分「上午 / 下午 / 晚上」；未填写时间的节次返回 null（沿用上一分组）
  function periodSection(p) {
    var m = String((p && p.time) || '').match(/(\d{1,2})\s*[:：]/);
    if (!m) return null;
    var h = Number(m[1]);
    if (!(h >= 0 && h <= 23)) return null;
    if (h < 12) return { key: 'am', label: '上午', cls: 'tt-sec-am' };
    if (h < 18) return { key: 'pm', label: '下午', cls: 'tt-sec-pm' };
    return { key: 'nt', label: '晚上', cls: 'tt-sec-nt' };
  }

  function itemHtml(it, opts, tone) {
    var meta = [];
    if (opts.showClass && it.className) meta.push(it.className);
    if (opts.showTeacher && it.teacher) meta.push(it.teacher);
    if (opts.showRoom && it.room) meta.push(it.room);
    var title = [it.className, it.subject, it.teacher, it.room].filter(Boolean).join(' · ');
    return '<div class="tt-it tt-c' + (tone || 0) + '" title="' + esc(title) + '">'
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

    // 科目配色：按科目名排序后顺序分配，保证同一张表里科目尽量不撞色且多次渲染结果一致
    var toneMap = {};
    Object.keys(cells).forEach(function (k) {
      cells[k].forEach(function (it) {
        var n = String(it.subject || '');
        if (n) toneMap[n] = 0;
      });
    });
    Object.keys(toneMap).sort(function (a, b) {
      return a.localeCompare(b, 'zh-Hans-CN', { numeric: true });
    }).forEach(function (n, i) { toneMap[n] = i % 8; });

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
    var lastSec = '';
    periods.forEach(function (p, i) {
      var n = i + 1;
      // 节次跨越上/下午时插入分组标题行
      var sec = periodSection(p);
      if (sec && sec.key !== lastSec) {
        lastSec = sec.key;
        body += '<tr class="tt-sec ' + sec.cls + '"><th colspan="' + (days.length + 1) + '">'
          + esc(sec.label) + '</th></tr>';
      }
      body += '<tr><th class="tt-period"><b>' + esc(p.label || ('第' + n + '节')) + '</b>'
        + (p.time ? '<span>' + esc(p.time) + '</span>' : '') + '</th>';
      days.forEach(function (d) {
        var items = cells[d + '-' + n] || [];
        body += '<td class="tt-cell' + (items.length ? '' : ' empty') + '">'
          + items.map(function (it) { return itemHtml(it, opts, toneMap[String(it.subject || '')]); }).join('')
          + '</td>';
      });
      body += '</tr>';
    });

    host.innerHTML = '<div class="tt-wrap"><table class="tt-tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    return filled;
  };
})();
