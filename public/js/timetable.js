/* ============================================================
   课程表 · 教务处排课（后台）
   功能：课表设置（学期 / 节次 / 上课日）、按班级排课、复制到其他班级、
        冲突检测（同一教师 / 同一教室同一时间排进多个班级）、导出 CSV、打印
   ============================================================ */
(function () {
  'use strict';

  var API = '/api/timetables';
  var state = { term: '', periods: [], days: [], weekdays: [], tables: {}, conflicts: [] };
  var classes = [];
  var teachers = [];
  var settingsSubjects = [];
  var curId = '';        // 当前排课班级
  var dirty = false;     // 是否有未保存的排课改动

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(url, method, body) {
    return fetch(url, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.code !== 0) throw new Error(j.msg || '请求失败');
      return j.data;
    });
  }
  // 按「职位权限设置」判定当前账号是否可排课（管理员全量；教务默认已授权课程表）
  function canWrite() {
    var a = window.AUTH;
    if (!a) return false;
    if (a.role === 'admin') return true;
    return Array.isArray(a.writable) && a.writable.indexOf('timetables') !== -1;
  }
  function markDirty(v) {
    dirty = !!v;
    var el = $('#ttDirty');
    if (el) el.hidden = !dirty;
  }
  function wd(day) { return state.weekdays[day - 1] || ('星期' + day); }

  // ===== 数据 =====
  function tableOf(classId) {
    if (!state.tables[classId]) state.tables[classId] = { classId: classId, slots: {} };
    return state.tables[classId];
  }
  function classLabel(c) { return (c.grade ? c.grade + ' ' : '') + c.name; }
  function sortedClasses() {
    return classes.slice().sort(function (a, b) {
      return String(a.grade || '').localeCompare(String(b.grade || ''), 'zh-Hans-CN', { numeric: true })
        || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { numeric: true });
    });
  }

  function loadAll() {
    return Promise.all([
      api(API),
      api('/api/classes').catch(function () { return []; }),
      api('/api/teachers').catch(function () { return []; })
    ]).then(function (res) {
      var d = res[0] || {};
      state.term = d.term || '';
      state.periods = Array.isArray(d.periods) ? d.periods : [];
      state.days = Array.isArray(d.days) ? d.days : [];
      state.weekdays = Array.isArray(d.weekdays) ? d.weekdays : [];
      state.conflicts = Array.isArray(d.conflicts) ? d.conflicts : [];
      state.tables = {};
      (Array.isArray(d.tables) ? d.tables : []).forEach(function (t) {
        state.tables[t.classId] = { classId: t.classId, className: t.className || '', grade: t.grade || '', exists: t.exists !== false, slots: t.slots || {} };
      });
      classes = res[1] || [];
      teachers = (res[2] || []).slice().sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { numeric: true });
      });
      if (!classes.some(function (c) { return c.id === curId; })) {
        var first = sortedClasses()[0];
        curId = first ? first.id : '';
      }
      markDirty(false);
      renderClassSelect();
      $('#termInput').value = state.term;
      render();
    });
  }

  // ===== 渲染 =====
  function renderClassSelect() {
    var sel = $('#classSel');
    var list = sortedClasses();
    if (!list.length) {
      sel.innerHTML = '<option value="">暂无班级</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    var groups = {};
    list.forEach(function (c) {
      var g = c.grade || '未标注年级';
      (groups[g] = groups[g] || []).push(c);
    });
    var html = list.length > 1 ? '<option value="">请选择班级…</option>' : '';
    Object.keys(groups).forEach(function (g) {
      html += '<optgroup label="' + esc(g) + '">' + groups[g].map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      }).join('') + '</optgroup>';
    });
    sel.innerHTML = html;
    if (curId) sel.value = curId;
  }

  function classConflictKeys(classId) {
    var set = {};
    (state.conflicts || []).forEach(function (c) {
      var hit = (c.classes || []).some(function (x) { return x.classId === classId; });
      if (hit) set[c.day + '-' + c.period] = true;
    });
    return set;
  }

  function cellHtml(cls, day, period, conflict) {
    var s = (cls.slots || {})[day + '-' + period];
    var cn = 'tt-cell' + (s ? '' : ' empty') + (conflict ? ' has-conflict' : '');
    if (!s) {
      return '<td class="' + cn + '" data-day="' + day + '" data-period="' + period + '"><span class="tt-add">＋</span></td>';
    }
    var meta = [s.teacher, s.room].filter(Boolean).join(' · ');
    var title = [s.subject, s.teacher, s.room].filter(Boolean).join(' · ') + (conflict ? '（该时段存在排课冲突）' : '');
    return '<td class="' + cn + '" data-day="' + day + '" data-period="' + period + '" title="' + esc(title) + '">'
      + '<div class="tt-it"><div class="s">' + esc(s.subject || '（未填科目）') + '</div>'
      + (meta ? '<div class="m">' + esc(meta) + '</div>' : '') + '</div></td>';
  }

  function render() {
    var host = $('#gridHost');
    var cls = curId ? classes.filter(function (c) { return c.id === curId; })[0] : null;

    $('#ttClassTitle').textContent = cls ? classLabel(cls) : '未选择班级';
    var t = cls ? tableOf(curId) : null;
    var count = t ? Object.keys(t.slots || {}).length : 0;
    $('#ttSub').textContent = (state.term ? state.term + ' · ' : '') + (cls ? ('已排 ' + count + ' 节' + (cls.headTeacher ? ' · 班主任 ' + cls.headTeacher : '')) : '');

    renderConflicts();

    if (!classes.length) {
      host.innerHTML = '<div class="tt-empty">还没有班级，请先在「班级管理」中创建班级，再回来排课。<br>'
        + '<button type="button" class="btn btn-primary btn-sm" style="margin-top:12px" onclick="window.goPage(\'/classes.html\')">去班级管理</button></div>';
      return;
    }
    if (!cls) {
      host.innerHTML = '<div class="tt-empty">请在上方选择要排课的班级。</div>';
      return;
    }
    if (!state.periods.length || !state.days.length) {
      host.innerHTML = '<div class="tt-empty">还没有配置节次与上课日，请先点击「节次设置」完成配置。</div>';
      return;
    }

    var cks = classConflictKeys(curId);
    var head = '<tr><th class="tt-corner">节次</th>' + state.days.map(function (d) {
      return '<th>' + esc(wd(d)) + '</th>';
    }).join('') + '</tr>';
    var body = '';
    state.periods.forEach(function (p, i) {
      var n = i + 1;
      body += '<tr><th class="tt-period"><b>' + esc(p.label || ('第' + n + '节')) + '</b>'
        + (p.time ? '<span>' + esc(p.time) + '</span>' : '') + '</th>';
      body += state.days.map(function (d) {
        return cellHtml(t, d, n, !!cks[d + '-' + n]);
      }).join('');
      body += '</tr>';
    });
    host.innerHTML = '<div class="tt-wrap"><table class="tt-tbl tt-edit"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderConflicts() {
    var box = $('#conflictBox');
    var list = state.conflicts || [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    var rows = list.slice(0, 6).map(function (c) {
      var names = (c.classes || []).map(function (x) {
        return x.className + (x.subject ? ' ' + x.subject : '');
      }).join('、');
      return '<div>· ' + esc(wd(c.day) + '第' + c.period + '节') + ' · <b>' + esc(c.type) + '</b>：'
        + esc(c.name) + ' → ' + esc(names) + '</div>';
    }).join('');
    box.innerHTML = '<div><b>检测到 ' + list.length + ' 处排课冲突</b>（同一教师 / 教室在同一时间被排进多个班级，请调整）</div>' + rows
      + (list.length > 6 ? '<div>…另有 ' + (list.length - 6) + ' 处</div>' : '');
    box.hidden = false;
  }

  // ===== 单元格排课 =====
  var editing = { day: 0, period: 0 };

  function subjectOptions() {
    var set = {};
    settingsSubjects.forEach(function (s) { if (s) set[s] = 1; });
    teachers.forEach(function (t) { if (t.subject) set[t.subject] = 1; });
    var t = curId ? tableOf(curId) : null;
    if (t) Object.keys(t.slots || {}).forEach(function (k) { if (t.slots[k].subject) set[t.slots[k].subject] = 1; });
    return Object.keys(set);
  }
  function fillSubjectList() {
    var dl = $('#subjectList');
    if (!dl) return;
    dl.innerHTML = subjectOptions().map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('');
  }
  function fillTeacherSelect(sel) {
    $('#cTeacher').innerHTML = '<option value="">— 未指定 —</option>' + teachers.map(function (t) {
      var label = t.name + (t.subject ? '（' + t.subject + '）' : '') + (t.teacherNo ? ' ' + t.teacherNo : '');
      return '<option value="' + esc(t.teacherNo || '') + '|' + esc(t.name || '') + '">' + esc(label) + '</option>';
    }).join('');
    if (sel && sel.teacherNo) $('#cTeacher').value = sel.teacherNo + '|' + (sel.teacher || '');
    else if (sel && sel.teacher) $('#cTeacher').value = '|' + sel.teacher;
  }
  function currentTeacher() {
    var v = $('#cTeacher').value || '';
    var i = v.indexOf('|');
    if (i === -1) return { teacherNo: '', teacher: '' };
    return { teacherNo: v.slice(0, i), teacher: v.slice(i + 1) };
  }
  // 冲突预判：把某个教师 / 教室放在「星期-节次」时，其它班级是否已占用
  function precheck(day, period, teacherNo, teacher, room) {
    var msgs = [];
    Object.keys(state.tables).forEach(function (cid) {
      if (cid === curId) return;
      var other = state.tables[cid];
      var s = (other.slots || {})[day + '-' + period];
      if (!s) return;
      var sameTeacher = (teacherNo && s.teacherNo === teacherNo) || (!teacherNo && teacher && s.teacher === teacher);
      if (sameTeacher) msgs.push('教师「' + (s.teacher || teacher) + '」在' + wd(day) + '第' + period + '节已排「' + (other.className || '') + (s.subject ? ' ' + s.subject : '') + '」');
      if (room && s.room === room) msgs.push('教室「' + room + '」在' + wd(day) + '第' + period + '节已被「' + (other.className || '') + '」占用');
    });
    return msgs;
  }
  function refreshCellWarn() {
    var warn = $('#cellWarn');
    var tn = currentTeacher();
    var msgs = precheck(editing.day, editing.period, tn.teacherNo, tn.teacher, $('#cRoom').value.trim());
    if (!msgs.length) { warn.hidden = true; warn.innerHTML = ''; return; }
    warn.innerHTML = '⚠ 可能产生冲突：' + msgs.map(esc).join('；') + '。保存后仍可在页面上看到冲突提示。';
    warn.hidden = false;
  }
  function fillQuick() {
    var t = curId ? tableOf(curId) : null;
    var seen = {};
    var items = [];
    if (t) Object.keys(t.slots || {}).forEach(function (k) {
      var s = t.slots[k];
      var key = (s.subject || '') + '|' + (s.teacherNo || '') + '|' + (s.teacher || '') + '|' + (s.room || '');
      if (seen[key]) return;
      seen[key] = 1;
      if (s.subject || s.teacher) items.push(s);
    });
    $('#cQuick').innerHTML = items.length
      ? items.slice(0, 14).map(function (s, i) {
        return '<button type="button" class="tt-chip" data-quick="' + i + '">'
          + esc([s.subject, s.teacher, s.room].filter(Boolean).join(' · ')) + '</button>';
      }).join('')
      : '<span style="font-size:12.5px;color:#9ca3af">本班还没有已排课程</span>';
    $('#cQuick').dataset.items = JSON.stringify(items.slice(0, 14));
  }

  function openCell(day, period) {
    if (!canWrite()) { toast('当前账号仅可查看课表，不能排课', 'error'); return; }
    editing.day = day;
    editing.period = period;
    var t = tableOf(curId);
    var s = (t.slots || {})[day + '-' + period] || {};
    $('#cellTitle').textContent = classLabel(classes.filter(function (c) { return c.id === curId; })[0] || { name: '' })
      + ' · ' + wd(day) + ' 第' + period + '节';
    $('#cSubject').value = s.subject || '';
    $('#cRoom').value = s.room || '';
    fillTeacherSelect(s);
    fillSubjectList();
    fillQuick();
    refreshCellWarn();
    $('#cellMask').classList.add('show');
    setTimeout(function () { $('#cSubject').focus(); }, 50);
  }
  function closeCell() { $('#cellMask').classList.remove('show'); }
  function saveCell(clear) {
    var t = tableOf(curId);
    var key = editing.day + '-' + editing.period;
    if (clear) {
      delete t.slots[key];
    } else {
      var subject = $('#cSubject').value.trim();
      var tn = currentTeacher();
      var room = $('#cRoom').value.trim();
      if (!subject && !tn.teacher && !room) { delete t.slots[key]; }
      else {
        if (!subject) { toast('请填写科目（或点击「清除本节」）', 'error'); return; }
        t.slots[key] = { subject: subject, teacherNo: tn.teacherNo, teacher: tn.teacher, room: room };
      }
    }
    markDirty(true);
    closeCell();
    render();
  }

  // ===== 课表设置 =====
  function openMeta() {
    if (!canWrite()) { toast('当前账号仅可查看课表，不能修改设置', 'error'); return; }
    $('#mTerm').value = state.term;
    $('#mDays').innerHTML = state.weekdays.map(function (w, i) {
      var d = i + 1;
      return '<label><input type="checkbox" data-day="' + d + '"' + (state.days.indexOf(d) !== -1 ? ' checked' : '') + '>' + esc(w) + '</label>';
    }).join('');
    renderPeriodInputs();
    $('#metaMask').classList.add('show');
  }
  function renderPeriodInputs() {
    $('#mPeriods').innerHTML = state.periods.map(function (p, i) {
      return '<div class="tt-period-row" data-i="' + i + '">'
        + '<span class="idx">' + (i + 1) + '</span>'
        + '<input type="text" class="p-label" maxlength="12" value="' + esc(p.label || ('第' + (i + 1) + '节')) + '" placeholder="第' + (i + 1) + '节" />'
        + '<input type="text" class="p-time" maxlength="20" value="' + esc(p.time || '') + '" placeholder="08:00-08:45" />'
        + '</div>';
    }).join('');
  }
  function collectMeta() {
    var days = [];
    $('#mDays').querySelectorAll('input[data-day]').forEach(function (el) {
      if (el.checked) days.push(Number(el.dataset.day));
    });
    var periods = [];
    $('#mPeriods').querySelectorAll('.tt-period-row').forEach(function (row, i) {
      periods.push({
        label: row.querySelector('.p-label').value.trim() || ('第' + (i + 1) + '节'),
        time: row.querySelector('.p-time').value.trim()
      });
    });
    return { term: $('#mTerm').value.trim(), days: days, periods: periods };
  }
  function saveMeta() {
    if (!canWrite()) return;
    var meta = collectMeta();
    if (!meta.days.length) { toast('请至少选择一个上课日', 'error'); return; }
    if (!meta.periods.length) { toast('请至少保留一个节次', 'error'); return; }
    if (meta.periods.length < state.periods.length || meta.days.length < state.days.length) {
      var reduce = '本次调整会减少节次或上课日，对应时段已排的课程将被删除，确定继续？';
      confirmDlg(reduce, { title: '调整课表设置', okText: '继续保存', danger: true }).then(function (ok) {
        if (ok) doSaveMeta(meta);
      });
      return;
    }
    doSaveMeta(meta);
  }
  function doSaveMeta(meta) {
    var btn = $('#metaSave');
    var done = busyBtn(btn, '保存中…');
    if (!done) return;
    state.term = meta.term;
    api(API + '/meta', 'PUT', meta)
      .then(function () {
        $('#metaMask').classList.remove('show');
        toast('课表设置已保存', 'success');
        return loadAll();
      })
      .catch(function (e) { toast(e.message, 'error'); })
      .then(function () { done(); });
  }

  // ===== 复制课表 =====
  function openCopy() {
    if (!canWrite()) { toast('当前账号仅可查看课表，不能复制', 'error'); return; }
    if (!curId) { toast('请先选择班级', 'error'); return; }
    var t = tableOf(curId);
    if (!Object.keys(t.slots || {}).length) { toast('本班还没有排课，无法复制', 'error'); return; }
    var cls = classes.filter(function (c) { return c.id === curId; })[0];
    $('#copyFrom').textContent = '来源：' + classLabel(cls) + '（共 ' + Object.keys(t.slots).length + ' 节）';
    $('#copyList').innerHTML = sortedClasses().filter(function (c) { return c.id !== curId; }).map(function (c) {
      var n = Object.keys(tableOf(c.id).slots || {}).length;
      return '<label><input type="checkbox" value="' + esc(c.id) + '">' + esc(classLabel(c))
        + (n ? '<span style="color:#9ca3af;font-size:12px">已排 ' + n + ' 节</span>' : '') + '</label>';
    }).join('');
    $('#copyOverwrite').checked = false;
    $('#copyMask').classList.add('show');
  }
  function doCopy() {
    var to = [];
    $('#copyList').querySelectorAll('input:checked').forEach(function (el) { to.push(el.value); });
    if (!to.length) { toast('请选择要复制到的班级', 'error'); return; }
    var btn = $('#copyOk');
    var done = busyBtn(btn, '复制中…');
    if (!done) return;
    api(API + '/copy', 'POST', { from: curId, to: to, overwrite: $('#copyOverwrite').checked })
      .then(function (data) {
        $('#copyMask').classList.remove('show');
        toast('已复制到 ' + to.length + ' 个班级', 'success');
        markDirty(false);
        return loadAll().then(function () {
          if (data && Array.isArray(data.conflicts)) { state.conflicts = data.conflicts; renderConflicts(); render(); }
        });
      })
      .catch(function (e) { toast(e.message, 'error'); })
      .then(function () { done(); });
  }

  // ===== 保存 / 清空 / 导出 =====
  function saveClass() {
    if (!canWrite()) return;
    if (!curId) { toast('请先选择班级', 'error'); return; }
    var btn = $('#btnSave');
    var done = busyBtn(btn, '保存中…');
    if (!done) return;
    api(API + '/class/' + encodeURIComponent(curId), 'PUT', { slots: tableOf(curId).slots })
      .then(function (data) {
        tableOf(curId).slots = (data && data.slots) || {};
        state.conflicts = (data && data.conflicts) || [];
        markDirty(false);
        render();
        saveTerm();
        toast((state.conflicts.length ? '课表已保存，但检测到 ' + state.conflicts.length + ' 处冲突' : '课表已保存'), state.conflicts.length ? 'warning' : 'success');
      })
      .catch(function (e) { toast(e.message, 'error'); })
      .then(function () { done(); });
  }
  // 学期名称随班级课表一并保存（写在课表设置里，全年级共用）
  function saveTerm() {
    var v = $('#termInput').value.trim();
    if (v === state.term) return Promise.resolve();
    state.term = v;
    return api(API + '/meta', 'PUT', { term: v }).catch(function () {});
  }
  function clearClass() {
    if (!canWrite()) return;
    var cls = classes.filter(function (c) { return c.id === curId; })[0];
    if (!cls) return;
    if (!Object.keys(tableOf(curId).slots || {}).length) { toast('本班还没有排课', 'error'); return; }
    confirmDlg('确定清空「' + classLabel(cls) + '」的全部课程安排？此操作不可恢复。', { title: '清空课表', okText: '清空', danger: true })
      .then(function (ok) {
        if (!ok) return;
        api(API + '/class/' + encodeURIComponent(curId), 'DELETE')
          .then(function () {
            state.tables[curId] = { classId: curId, slots: {} };
            markDirty(false);
            toast('该班级课表已清空', 'success');
            return loadAll();
          })
          .catch(function (e) { toast(e.message, 'error'); });
      });
  }
  function exportCsv() {
    if (!curId) { toast('请先选择班级', 'error'); return; }
    var cls = classes.filter(function (c) { return c.id === curId; })[0];
    var t = tableOf(curId);
    var lines = [[ '节次 / 时间' ].concat(state.days.map(wd))];
    state.periods.forEach(function (p, i) {
      var n = i + 1;
      var row = [(p.label || ('第' + n + '节')) + (p.time ? ' ' + p.time : '')];
      state.days.forEach(function (d) {
        var s = (t.slots || {})[d + '-' + n];
        row.push(s ? [s.subject, s.teacher, s.room].filter(Boolean).join(' ') : '');
      });
      lines.push(row);
    });
    var csv = '\ufeff' + lines.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.term ? state.term + '-' : '') + classLabel(cls) + '课程表.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  // ===== 事件绑定 =====
  function bind() {
    $('#classSel').addEventListener('change', function () {
      var next = this.value;
      if (!next || next === curId) { if (!next) this.value = curId; return; }
      var go = function () { curId = next; markDirty(false); render(); loadTermToInput(); };
      if (dirty) {
        confirmDlg('当前班级有未保存的排课改动，切换班级将丢弃这些改动。', { title: '放弃未保存的改动？', okText: '放弃并切换', danger: true })
          .then(function (ok) { if (ok) go(); else $('#classSel').value = curId; });
        return;
      }
      go();
    });

    $('#termInput').addEventListener('input', function () { markDirty(true); });
    $('#gridHost').addEventListener('click', function (e) {
      var td = e.target.closest ? e.target.closest('td.tt-cell') : null;
      if (!td) return;
      openCell(Number(td.dataset.day), Number(td.dataset.period));
    });

    // 单元格弹窗
    $('#cellX').onclick = closeCell;
    $('#cCancel').onclick = closeCell;
    $('#cOk').onclick = function () { saveCell(false); };
    $('#cClear').onclick = function () { saveCell(true); };
    $('#cTeacher').onchange = refreshCellWarn;
    $('#cRoom').oninput = refreshCellWarn;
    $('#cQuick').addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.tt-chip') : null;
      if (!chip) return;
      var items = JSON.parse(this.dataset.items || '[]');
      var s = items[Number(chip.dataset.quick)];
      if (!s) return;
      $('#cSubject').value = s.subject || '';
      $('#cRoom').value = s.room || '';
      fillTeacherSelect(s);
      refreshCellWarn();
    });

    // 设置弹窗
    $('#btnMeta').onclick = openMeta;
    $('#metaX').onclick = function () { $('#metaMask').classList.remove('show'); };
    $('#metaCancel').onclick = function () { $('#metaMask').classList.remove('show'); };
    $('#metaSave').onclick = saveMeta;
    $('#mAddPeriod').onclick = function () {
      var cur = collectMeta();
      if (cur.periods.length >= 12) { toast('最多支持 12 节课', 'error'); return; }
      state.periods = cur.periods.concat([{ label: '第' + (cur.periods.length + 1) + '节', time: '' }]);
      state.days = cur.days;
      renderPeriodInputs();
    };
    $('#mDelPeriod').onclick = function () {
      if (state.periods.length <= 1) { toast('至少保留一节课', 'error'); return; }
      var cur = collectMeta();
      state.periods = cur.periods.slice(0, -1);
      state.days = cur.days;
      renderPeriodInputs();
    };

    // 复制弹窗
    $('#btnCopy').onclick = openCopy;
    $('#copyX').onclick = function () { $('#copyMask').classList.remove('show'); };
    $('#copyCancel').onclick = function () { $('#copyMask').classList.remove('show'); };
    $('#copyOk').onclick = doCopy;

    $('#btnSave').onclick = saveClass;
    $('#btnClear').onclick = clearClass;
    $('#btnCsv').onclick = exportCsv;
    $('#btnPrint').onclick = function () { window.print(); };

    // 未保存提醒：工作台切换选项卡刷新时不丢改动
    window.addEventListener('beforeunload', function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });
  }

  function loadTermToInput() { $('#termInput').value = state.term; }

  // 工作台（iframe）切换到本页时触发：有未保存改动则保留页面内容
  window.cbEmbedRefresh = function () {
    if (dirty) { toast('本页有未保存的排课改动，已为您保留', 'warning'); return; }
    loadAll().catch(function (e) { toast(e.message, 'error'); });
  };

  (function init() {
    if (!window.AUTH) return; // 未登录时不做额外处理（服务端已守卫页面）
    var w = canWrite();
    ['#btnSave', '#btnClear', '#btnMeta', '#btnCopy', '#btnPrint'].forEach(function (sel) {
      var el = $(sel);
      if (el && !w && sel !== '#btnPrint') el.disabled = true;
    });
    if (!w) toast('当前账号仅可查看课表，排课请使用教务（staff）账号或管理员账号', 'warning');
    // 科目候选：优先取系统设置里的科目表，未配置时给一份常用科目兜底
    api('/api/settings').then(function (s) {
      var subs = (s && s.subjects && s.subjects.length) ? s.subjects : [];
      settingsSubjects = subs.map(function (x) { return String((x && x.name) || '').trim(); }).filter(Boolean);
      if (!settingsSubjects.length) settingsSubjects = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '体育', '音乐', '美术'];
      fillSubjectList();
    }).catch(function () {});
    bind();
    loadAll().catch(function (e) {
      $('#gridHost').innerHTML = '<div class="tt-empty">加载失败：' + esc(e.message) + '</div>';
    });
  })();
})();
