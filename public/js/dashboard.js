/* ============================================================
   数据总览模块页（工作台选项卡 /dashboard.html，也可独立整页访问）
   数据来源：/api/board（学生池 + 班级 + 年级 + 实时快照）
   统计项：学生总数、分班进度、性别、年级概况、
          学科均分、班级容量占用、特长分布、实时分班横幅
   ============================================================ */
(function () {
  'use strict';

  var REFRESH_MS = 15000;
  var busy = false;

  function $(s) { return document.querySelector(s); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dec(v) {
    var n = Number(v) || 0;
    return Math.round(n * 10) / 10;
  }
  function fmtTime(ts) {
    var d = ts ? new Date(ts) : new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function timeStr(label, ts) {
    return label + ' · 更新于 ' + fmtTime(ts) + ' · 每 ' + (REFRESH_MS / 1000) + ' 秒自动刷新';
  }

  // 生效科目（默认由 /js/site.js 注入）
  function subs() { return window.SUBJECTS || []; }
  function stuSc(s, key) {
    var sc = (s && s.scores) || {};
    var v = sc[key];
    return (v === null || v === undefined || v === '') ? 0 : Number(v) || 0;
  }
  function fullMark() {
    var m = 0;
    subs().forEach(function (sj) { m += Number(sj.max) || 100; });
    return m || 100;
  }

  // 某批学生的成绩统计：仅统计有成绩（总分>0）的学生
  function scoreStat(list) {
    var sums = {}, n = 0;
    subs().forEach(function (sj) { sums[sj.key] = 0; });
    sums.total = 0;
    (list || []).forEach(function (s) {
      var t = 0, any = false;
      subs().forEach(function (sj) {
        var v = stuSc(s, sj.key);
        sums[sj.key] += v; t += v;
        if (v > 0) any = true;
      });
      if (!any) return;
      n++;
      sums.total += t;
    });
    return { n: n, sums: sums };
  }

  function render(data) {
    var pool = data.students || [];
    var classes = data.classes || [];
    var gradeList = data.grades || [];
    var live = data.live || null;
    var now = Date.now();

    // 汇总全量学生：池 + 各班名单（保留 scores 等完整档案）
    var allocated = [];
    classes.forEach(function (c) {
      (c.students || []).forEach(function (s) {
        allocated.push(Object.assign({}, s, {
          grade: s.grade || c.grade || '',
          allocated: true, className: c.name, classId: c.id
        }));
      });
    });
    var all = pool.map(function (s) {
      return Object.assign({}, s, { allocated: false, className: '' });
    }).concat(allocated);

    var total = all.length;
    var assigned = allocated.length;
    var waiting = total - assigned;
    var male = 0, female = 0;
    all.forEach(function (s) {
      if (s.gender === '男') male++;
      else if (s.gender === '女') female++;
    });

    // 全校学科均分
    var st = scoreStat(all);
    var avgTotal = st.n ? dec(st.sums.total / st.n) : 0;

    // ---- 概览卡片 ----
    var specMap = {};
    var specCount = 0;
    all.forEach(function (s) {
      var k = (s.specialty || '').trim();
      if (!k) return;
      specCount++;
      specMap[k] = (specMap[k] || 0) + 1;
    });
    var capTotal = 0;
    classes.forEach(function (c) { capTotal += Number(c.capacity) || 0; });
    var teacherCount = classes.filter(function (c) { return (c.headTeacher || '').trim(); }).length;
    var gradeLabel = gradeList.length ? gradeList.join(' / ') : '未设置';

    $('#dashCards').innerHTML =
      statCard(total, '学生总数', male + ' 男 · ' + female + ' 女', 'c-blue') +
      statCard(assigned, '已分班人数', waiting + ' 人待分', 'c-green') +
      statCard(waiting, '学生池待分', '待编入 ' + gradeLabel + ' 等班级', 'c-orange') +
      statCard(classes.length, '班级总数', teacherCount + ' 个班级有班主任', 'c-purple') +
      statCard(gradeList.length, '年级总数', '共 ' + gradeList.length + ' 个年级设置', 'c-rose') +
      statCard(avgTotal, '平均总分', '(满分 ' + fullMark() + (st.n ? ' · ' + st.n + ' 人有成绩' : '') + ')', 'c-teal') +
      statCard(capTotal, '班级总容量', '还可容纳 ' + Math.max(capTotal - assigned, 0) + ' 人', 'c-indigo') +
      statCard(specCount, '特长记录', topSpec(specMap) || '暂无特长', 'c-amber');

    // ---- 分班进度环形图 ----
    var allotPct = total ? assigned / total * 100 : 0;
    setRing($('#ringAllot'), allotPct, allotPct >= 100 ? '#22c55e' : (total && waiting ? '#4f6df5' : '#cbd5e1'));
    $('#allotRingNum').textContent = Math.round(allotPct) + '%';
    $('#allotNote').textContent = total
      ? '已分班 ' + assigned + ' 人 · 学生池待分 ' + waiting + ' 人 · 共 ' + total + ' 人'
      : '系统中暂无学生，请先到「学生档案」添加或批量导入';

    var malePct = total ? male / total * 100 : 0;
    setRing($('#ringGender'), malePct, '#2563eb');
    $('#genderRingNum').textContent = Math.round(malePct) + '%';
    $('#genderNote').textContent = '男 ' + male + ' · 女 ' + female + (male + female < total ? ' · 其他 ' + (total - male - female) : '');

    // ---- 各年级分组 ----
    var groups = {};
    function group(key) {
      if (!groups[key]) groups[key] = { key: key, label: key || '未分年级', total: 0, alloc: 0, male: 0, female: 0, students: [], classList: [] };
      return groups[key];
    }
    gradeList.forEach(function (g) { group(g); });
    classes.forEach(function (c) { group(c.grade || '').classList.push(c); });
    all.forEach(function (s) {
      var g = group(s.grade || '');
      g.total++;
      if (s.allocated) g.alloc++;
      if (s.gender === '男') g.male++;
      else if (s.gender === '女') g.female++;
      g.students.push(s);
    });
    var keys = gradeList.filter(function (k) { return groups[k]; });
    Object.keys(groups).forEach(function (k) {
      if (k !== '' && keys.indexOf(k) === -1) keys.push(k);
    });
    if (groups['']) keys.push('');

    // ---- 各年级概况表 ----
    $('#gradeBody').innerHTML = keys.map(function (k) {
      var g = groups[k];
      var aW = g.total ? g.alloc / g.total * 100 : 0;
      return '<tr>' +
        '<td><span class="roster-tag">' + esc(g.label) + '</span></td>' +
        '<td class="tc b">' + g.total + '</td>' +
        '<td class="tc dim">' + g.male + ' / ' + g.female + '</td>' +
        '<td class="tc dim">' + (g.classList.length ? g.classList.length + ' 个' : '—') + '</td>' +
        '<td>' +
        '<div class="mseg" title="已分 ' + g.alloc + ' · 待分 ' + (g.total - g.alloc) + '">' +
        '<i class="mseg-ok" style="width:' + dec(aW) + '%"></i>' +
        '<i class="mseg-wait" style="width:' + dec(Math.max(100 - aW, 0)) + '%"></i>' +
        '</div>' +
        '<div class="mseg-text">' + g.alloc + ' / ' + (g.total - g.alloc) + '</div>' +
        '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="dash-empty">暂无学生</td></tr>';

    // ---- 全校学科均分（按科目配置动态渲染）----
    $('#scoreMeta').textContent = st.n ? '（基于 ' + st.n + ' 名有成绩学生）' : '（暂无成绩数据）';
    var colorCycle = ['sb-blue', 'sb-green', 'sb-amber', 'sb-purple', 'sb-teal'];
    if (st.n) {
      var sbHtml = '';
      subs().forEach(function (sj, i) {
        var avg = st.sums[sj.key] / st.n;
        sbHtml += sbjRow(sj.name, avg, Number(sj.max) || 100, colorCycle[i % colorCycle.length]);
      });
      $('#sbjList').innerHTML = sbHtml;
    } else {
      $('#sbjList').innerHTML = '<p class="dash-empty">暂无成绩数据</p>';
    }

    // ---- 各年级学科均分表（列随科目配置动态生成）----
    var gsHead = $('#gradeScoreHead');
    if (gsHead) {
      gsHead.innerHTML = '<tr><th>年级</th>' + subs().map(function (sj) {
        return '<th>' + esc(sj.name) + '</th>';
      }).join('') + '<th>总分均分</th></tr>';
    }
    var gsSpan = 1 + subs().length + 1;
    $('#gradeScoreBody').innerHTML = keys.map(function (k) {
      var g = groups[k];
      var gs = scoreStat(g.students);
      if (!gs.n) {
        return '<tr><td><span class="roster-tag">' + esc(g.label) + '</span></td>' +
          '<td colspan="' + gsSpan + '" class="dim">暂无成绩</td></tr>';
      }
      var cells = subs().map(function (sj) {
        return '<td class="tc">' + dec(gs.sums[sj.key] / gs.n) + '</td>';
      }).join('');
      return '<tr><td><span class="roster-tag">' + esc(g.label) + '</span></td>' + cells +
        '<td class="tc b c-blue2">' + dec(gs.sums.total / gs.n) + '</td></tr>';
    }).join('') || '<tr><td colspan="' + gsSpan + '" class="dash-empty">暂无学生</td></tr>';

    // ---- 各班人数与容量 ----
    renderCap(keys, groups);

    // ---- 特长分布 ----
    var specs = Object.keys(specMap).map(function (k) {
      return { name: k, count: specMap[k] };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 8);
    var maxSpec = specs.length ? specs[0].count : 1;
    var specEl = $('#specList');
    var specEmpty = $('#specEmpty');
    if (specs.length) {
      specEmpty.classList.add('hidden');
      specEl.innerHTML = specs.map(function (s) {
        var w = dec(s.count / maxSpec * 100);
        return '<div class="spec-row">' +
          '<span class="spec-name">' + esc(s.name) + '</span>' +
          '<div class="spec-bar"><i class="spec-fill" style="width:' + w + '%"></i></div>' +
          '<span class="spec-count">' + s.count + ' 人</span></div>';
      }).join('');
    } else {
      specEl.innerHTML = '';
      specEmpty.classList.remove('hidden');
    }

    // ---- 实时分班横幅 ----
    renderLive(live);

    $('#dashMeta').textContent = timeStr('数据统计主页', now);
  }

  function topSpec(map) {
    var name = null, max = 0;
    Object.keys(map).forEach(function (k) { if (map[k] > max) { max = map[k]; name = k; } });
    return name ? esc(name) + ' ' + max + ' 人' : '';
  }

  function statCard(num, label, sub, color) {
    return '<div class="dash-card ' + color + '">' +
      '<div class="dc-num">' + num + '</div>' +
      '<div class="dc-label">' + label + '</div>' +
      (sub ? '<div class="dc-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function sbjRow(name, val, max, color) {
    max = Number(max) || 100;
    var w = Math.max(Math.min((Number(val) || 0) / max * 100, 100), 0);
    return '<div class="sbj-row">' +
      '<div class="sbj-head"><span class="sbj-name">' + name + '</span>' +
      '<span class="sbj-val">' + dec(val) + ' 分</span></div>' +
      '<div class="sbj-bar"><i class="sbj-fill ' + color + '" style="width:' + dec(w) + '%"></i></div>' +
      '</div>';
  }

  function setRing(el, pct, color) {
    el.style.setProperty('--p', dec(pct) + '%');
    el.style.setProperty('--c', color);
  }

  function renderCap(keys, groups) {
    var wrap = $('#capList');
    var anyClass = false;
    var html = '';
    keys.forEach(function (k) {
      var g = groups[k];
      var list = g.classList || [];
      if (!list.length) return;
      anyClass = true;
      var occ = 0, cap = 0;
      list.forEach(function (c) { occ += (c.students || []).length; cap += Number(c.capacity) || 0; });
      html += '<div class="cap-group-title"><span class="roster-tag">' + esc(g.label) + '</span>' +
        '<span class="dim">已占 ' + occ + ' / ' + cap + '</span></div>';
      list.forEach(function (c) {
        var o = (c.students || []).length;
        var ca = Number(c.capacity) || (o || 50);
        var pct = ca ? o / ca * 100 : 0;
        var over = o > ca;
        var teacher = (c.headTeacher || '').trim();
        html += '<div class="cap-row">' +
          '<span class="cap-name"><b>' + esc(c.name) + '</b>' +
          (teacher ? '<i class="cap-teacher">' + esc(teacher) + '</i>' : '') + '</span>' +
          '<div class="cap-bar"><i class="cap-fill' + (over ? ' over' : '') + '" style="width:' + Math.min(pct, 100) + '%"></i></div>' +
          '<span class="cap-num' + (over ? ' over-text' : '') + '">' + o + ' / ' + ca +
          (over ? ' 超出' : '') + '</span></div>';
      });
    });
    wrap.innerHTML = html ||
      '<p class="dash-empty">还没有创建班级，可到「班级管理」中创建</p>';
  }

  var PHASE_TEXT = { countdown: '分班倒计时中', shuffle: '正在随机排位', ready: '排位完成 · 准备分班', deal: '分班进行中' };

  function renderLive(live) {
    var banner = $('#liveBanner');
    if (!live || !live.phase || live.phase === '' || !(live.classes && live.classes.length)) {
      banner.classList.add('hidden');
      return;
    }
    var grade = live.grade || '本年级';
    var clsNum = (live.classes || []).length;
    var text = '正在为「' + esc(grade) + '」分班 · ' + (PHASE_TEXT[live.phase] || live.phase) +
      ' · ' + clsNum + ' 个班级';
    if (live.phase === 'countdown' && live.cd) text += ' · ' + live.cd + ' 秒后开始';
    $('#liveText').textContent = text;
    banner.classList.remove('hidden');
  }

  function load() {
    if (busy) return;
    busy = true;
    fetch('/api/board')
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json.code === 0) render(json.data || {});
        else $('#dashMeta').textContent = '读取失败：' + (json.msg || '未知错误');
      })
      .catch(function (e) {
        $('#dashMeta').textContent = '刷新失败，请确认服务已启动';
      })
      .finally(function () { busy = false; });
  }

  function init() {
    $('#btnRefreshDash').addEventListener('click', function () {
      $('#dashMeta').textContent = '正在刷新…';
      load();
    });
    window.loadData = load;
    window.cbEmbedRefresh = load;
    load();
    setInterval(function () {
      if (document.hidden) return;
      load();
    }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
