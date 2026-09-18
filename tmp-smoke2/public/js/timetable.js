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
  var gradePlans = {};   // 各年级课程计划（来自「课程管理」页）：{ [grade]: { courses: [course] } }
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
  // ===== 班级记忆：记住上次排课的班级，下次打开课程表自动选中 =====
  // 用本地存储而非 /api/filters，避免教务等职位账号写偏好被权限闸门拦截
  var REMEMBER_KEY = 'icbs:timetable:classId';
  function rememberClass(id) {
    try {
      if (id) localStorage.setItem(REMEMBER_KEY, String(id));
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* 隐私模式 / 存储禁用时忽略 */ }
  }
  function rememberedClass() {
    try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch (e) { return ''; }
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
      api('/api/teachers').catch(function () { return []; }),
      api('/api/course-plans').catch(function () { return { plans: {} }; })
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
      // 各年级课程计划：{ [grade]: { courses: [ { name, type, weeklyHours, examType } ] } }
      // 注意：api() 内部已 return j.data，此处 res[3] 就是 { grades, plans }，不能再取 .data（会恒为 undefined）
      var planRes = res[3] || {};
      gradePlans = (planRes && planRes.plans) || {};
      if (!classes.some(function (c) { return c.id === curId; })) {
        // 恢复上次记忆的班级；该班已被删除/不在列表时退回第一个
        var saved = rememberedClass();
        var hit = saved && classes.filter(function (c) { return c.id === saved; })[0];
        var first = sortedClasses()[0];
        curId = hit ? hit.id : (first ? first.id : '');
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

  // 科目配色：优先按科目在「本年级课程计划」中的序号取色，
  // 保证同一张课表里前 8 门科目颜色互不相同（不会语数英撞同色）；
  // 不在计划内的科目（如班会）按名称哈希取色，保证跨班级稳定同色
  function subjectTone(name) {
    var i = subjectOptions().indexOf(name);
    if (i !== -1) return i % 8;
    var s = String(name || '');
    var h = 0;
    for (var k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) % 100003;
    return h % 8;
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
      + '<div class="tt-it tt-c' + subjectTone(s.subject) + '"><div class="s">' + esc(s.subject || '（未填科目）') + '</div>'
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
    var lastSec = '';
    state.periods.forEach(function (p, i) {
      var n = i + 1;
      // 节次跨越上/下午时插入分组标题行
      var sec = periodSection(p);
      if (sec && sec.key !== lastSec) {
        lastSec = sec.key;
        body += '<tr class="tt-sec ' + sec.cls + '"><th colspan="' + (state.days.length + 1) + '">'
          + esc(sec.label) + '</th></tr>';
      }
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

  // 内置通用科目：不需要在「课程管理」中配置，每个年级都可以直接选
  var BUILTIN_SUBJECTS = ['班会'];

  // 严格按「当前班级所在年级的课程计划」出科目，不做任何兜底
  function subjectOptions() {
    var cur = curId ? classes.filter(function (c) { return c.id === curId; })[0] : null;
    if (!cur || !cur.grade) return [];
    var plan = gradePlans[cur.grade];
    if (!plan) return [];
    var list = Array.isArray(plan) ? plan : (plan.courses || []);
    var seen = {};
    var out = [];
    list.forEach(function (c) {
      var n = c && String(c.name || '').trim();
      if (n && !seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out;
  }
  // 读取当前最终科目值（仅取 select 选项）
  function getSubjectValue() {
    var sel = $('#cSubjectSel');
    return sel ? sel.value.trim() : '';
  }
  // 取当前选中教师「任教学科」列表（空数组 = 未指定 / 未配置任教年级）
  function currentTeacherSubjects() {
    var v = $('#cTeacher');
    if (!v) return [];
    var raw = v.value || '';
    var i = raw.indexOf('|');
    if (i === -1) return [];
    var teacherNo = raw.slice(0, i).trim();
    var teacherName = raw.slice(i + 1).trim();
    var t = teachers.filter(function (x) {
      return (teacherNo && String(x.teacherNo || '').trim() === teacherNo)
          || (teacherName && String(x.name || '').trim() === teacherName);
    })[0];
    if (!t || !t.subject) return [];
    return String(t.subject).split(/[,，、;；\/\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  // 应用科目值：若不在计划内则插入一条「已不在当前年级课程计划」的临时项保留展示，避免编辑历史数据时被静默改掉
  function applySubjectValue(value) {
    var sel = $('#cSubjectSel');
    if (!sel) return;
    if (value) {
      var inPlan = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === value && !sel.options[i].dataset.outdated) { inPlan = true; break; }
      }
      if (!inPlan) {
        // 移除同名的旧临时项，避免重复
        for (var j = sel.options.length - 1; j >= 0; j--) {
          if (sel.options[j].value === value && sel.options[j].dataset.outdated === '1') sel.remove(j);
        }
        var opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value + '（已不在当前年级课程计划）';
        opt.dataset.outdated = '1';
        // 插到「请选择」之后
        if (sel.children.length > 0) sel.insertBefore(opt, sel.children[1]);
        else sel.appendChild(opt);
      }
    }
    sel.value = value || '';
  }
  // 联动核心：
  //   第一层 —— 任教年级（教师任教该年级的过滤已在 fillTeacherSelect 里做完）
  //   第二层 —— 对应学科（已选教师时，科目下拉只显示该教师任教的学科 ∩ 当前年级课程计划）
  function fillSubjectList(savedSubject) {
    var sel = $('#cSubjectSel');
    if (!sel) return;
    var opts = subjectOptions();
    var teacherSubs = currentTeacherSubjects();
    var teacherSet = {}; teacherSubs.forEach(function (s) { teacherSet[s] = 1; });

    var html = '<option value="">— 请选择科目 —</option>';

    // 1) 通用科目（始终展示）
    if (BUILTIN_SUBJECTS.length > 0) {
      html += '<optgroup label="通用科目">';
      BUILTIN_SUBJECTS.forEach(function (s) {
        html += '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      });
      html += '</optgroup>';
    }

    // 2) 当前年级课程计划中的科目
    if (opts.length === 0) {
      html += '<option value="" disabled>（当前年级尚未配置课程计划，请先在「课程管理」中添加）</option>';
    } else if (teacherSubs.length > 0) {
      // 已选教师：拆成「教师任教（∩）」「其他计划科目」两组，优先显示匹配的
      var mine = opts.filter(function (s) { return teacherSet[s]; });
      var other = opts.filter(function (s) { return !teacherSet[s]; });
      if (mine.length) {
        html += '<optgroup label="本班教师任教">';
        html += mine.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        html += '</optgroup>';
      }
      if (other.length) {
        html += '<optgroup label="其他计划科目（不在该教师任教范围）">';
        html += other.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        html += '</optgroup>';
      }
    } else {
      // 未指定教师：原样展示
      html += '<optgroup label="课程计划">';
      html += opts.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
      html += '</optgroup>';
    }
    sel.innerHTML = html;
    applySubjectValue(savedSubject || '');
  }
  // 取某教师的任教学科列表（空数组 = 该教师未登记任教学科）
  function teacherSubjectsOf(t) {
    if (!t || !t.subject) return [];
    return String(t.subject).split(/[,，、;；\/\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  // 生成单个教师 option
  function teacherOption(t, curGrade, subject, dim) {
    var subs = teacherSubjectsOf(t);
    var subjStr = subs.length ? '（' + (subs.length > 2 ? subs.slice(0, 2).join('、') + '…' : subs.join('、')) + '）' : '';
    var gOk = !curGrade || (Array.isArray(t.grades) && t.grades.indexOf(curGrade) !== -1);
    var suffix = '';
    if (!gOk) suffix += '  （未任教' + curGrade + '）';
    // 已选科目且该教师有登记任教学科，但不含本科目 → 明确标注，避免误选
    if (subject && subs.length && subs.indexOf(subject) === -1) suffix += '  （不教' + subject + '）';
    var label = t.name + subjStr + (t.teacherNo ? ' ' + t.teacherNo : '') + suffix;
    var grey = dim || !gOk;
    return '<option value="' + esc(t.teacherNo || '') + '|' + esc(t.name || '') + '"'
      + (grey ? ' style="color:#94a3b8"' : '') + '>' + esc(label) + '</option>';
  }
  // 科目 → 教师 联动：
  // 严格级联：科目（第一级）→ 教师（第二级）
  //   未选科目：不加载任何教师，下拉禁用并提示「请先选择科目」
  //   已选科目：只加载有资质（任教学科含本科目）的教师，不适合的不再显示
  //   例外：当前已选中的教师即使不匹配也强制保留，避免历史排课数据被静默清空
  function fillTeacherSelect(sel) {
    var cur = curId ? classes.filter(function (c) { return c.id === curId; })[0] : null;
    var curGrade = cur && cur.grade;
    var subject = getSubjectValue();
    var keep = sel || currentTeacher(); // 重建后恢复原选中项

    function keyOf(t) { return String(t.teacherNo || '') + '|' + String(t.name || ''); }
    // 当前选中项对应的 value
    var keepVal = '';
    if (keep && keep.teacherNo) keepVal = keep.teacherNo + '|' + (keep.teacher || '');
    else if (keep && keep.teacher) keepVal = '|' + keep.teacher;

    var html = '';
    // ---- 第一级未选：教师不可选 ----
    if (!subject) {
      var keepHit0 = keepVal ? teachers.filter(function (t) { return keyOf(t) === keepVal; })[0] : null;
      if (keepHit0) {
        html += '<optgroup label="当前已选">';
        html += teacherOption(keepHit0, curGrade, '', false);
        html += '</optgroup>';
      }
      html += '<option value="">— 请先选择科目 —</option>';
      $('#cTeacher').innerHTML = html;
      $('#cTeacher').disabled = true;
      if (keepVal) $('#cTeacher').value = keepVal;
      return;
    }

    // ---- 已选科目：加载有资质的教师 ----
    $('#cTeacher').disabled = false;

    // 班会等通用科目：由本班班主任主持，直接加载班主任（不受学科 / 年级资质限制）
    if (BUILTIN_SUBJECTS.indexOf(subject) !== -1) {
      var htName = String((cur && cur.headTeacher) || '').trim();
      var ht = htName ? teachers.filter(function (t) { return String(t.name || '').trim() === htName; })[0] : null;
      html = '<option value="">— 未指定 —</option>';
      if (ht) {
        html += '<optgroup label="本班班主任">';
        html += teacherOption(ht, curGrade, '', false);
        html += '</optgroup>';
      } else if (htName) {
        // 班主任未建立教师档案：按姓名生成选项，保证仍可选可保存
        html += '<optgroup label="本班班主任">';
        html += '<option value="|' + esc(htName) + '">' + esc(htName) + '</option>';
        html += '</optgroup>';
      } else {
        html += '<option value="" disabled>（该班级尚未设置班主任，请先在「班级管理」中设置）</option>';
      }
      $('#cTeacher').innerHTML = html;
      // 优先选中班主任；班主任缺失时才保留原选中值
      $('#cTeacher').value = ht ? keyOf(ht) : (htName ? '|' + htName : (keepVal || ''));
      return;
    }

    function subOk(t) { return teacherSubjectsOf(t).indexOf(subject) !== -1; }
    // 任教年级严格判定：必须登记了任教年级且包含本班年级，否则视为无资质
    function gradeOk(t) { return !!curGrade && Array.isArray(t.grades) && t.grades.indexOf(curGrade) !== -1; }
    function qualified(t) { return subOk(t) && gradeOk(t); }
    var list = teachers.slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN', { numeric: true });
    });
    var matched = list.filter(qualified);
    // 已选教师若不在资质名单内，强制保留，防止选中值被清空
    var keepHit = keepVal && !matched.some(function (t) { return keyOf(t) === keepVal; })
      ? teachers.filter(function (t) { return keyOf(t) === keepVal; })[0]
      : null;

    html = '<option value="">— 未指定 —</option>';
    if (matched.length) {
      html += '<optgroup label="可教「' + esc(subject) + '」且任教' + esc(curGrade) + '">';
      html += matched.map(function (t) { return teacherOption(t, curGrade, subject, false); }).join('');
      html += '</optgroup>';
    } else {
      html += '<option value="" disabled>（暂无同时任教「' + esc(subject) + '」与' + esc(curGrade) + '的教师）</option>';
    }
    if (keepHit) {
      html += '<optgroup label="当前已选（无本科目资质）">';
      html += teacherOption(keepHit, curGrade, subject, true);
      html += '</optgroup>';
    }
    $('#cTeacher').innerHTML = html;
    if (keepVal) $('#cTeacher').value = keepVal;
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
    // 前置检查：班级未设置年级 / 年级未配置课程计划时，先行提示再去排课（避免下拉只有「班会」让人困惑）
    var cur = curId ? classes.filter(function (c) { return c.id === curId; })[0] : null;
    if (!cur) return;
    if (!cur.grade) {
      toast('该班级尚未设置年级，请先在「班级管理」中给「' + (cur.name || '该班级') + '」指定年级后再排课', 'error');
      return;
    }
    // 课程计划存在两种存储形态：数组 [course,...] 或对象 { courses: [...] }
    var _plan = gradePlans[cur.grade];
    var _planCourses = Array.isArray(_plan) ? _plan : (_plan && _plan.courses) || [];
    if (!_planCourses.length) {
      toast('「' + cur.grade + '」尚未配置课程计划，请先在「课程管理」中添加科目后再排课', 'error');
      return;
    }
    editing.day = day;
    editing.period = period;
    var t = tableOf(curId);
    var s = (t.slots || {})[day + '-' + period] || {};
    $('#cellTitle').textContent = classLabel(classes.filter(function (c) { return c.id === curId; })[0] || { name: '' })
      + ' · ' + wd(day) + ' 第' + period + '节';
    $('#cRoom').value = s.room || '';
    // 顺序固定：先建科目下拉并定值 → 再按科目建教师下拉（教师分组依赖科目值）
    fillSubjectList(s.subject || '');
    fillTeacherSelect(s);
    fillQuick();
    refreshCellWarn();
    $('#cellMask').classList.add('show');
    setTimeout(function () { var s2 = $('#cSubjectSel'); if (s2) s2.focus(); }, 50);
  }
  function closeCell() { $('#cellMask').classList.remove('show'); }
  function saveCell(clear) {
    var t = tableOf(curId);
    var key = editing.day + '-' + editing.period;
    if (clear) {
      delete t.slots[key];
    } else {
      var subject = getSubjectValue();
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
      var go = function () { curId = next; rememberClass(next); markDirty(false); render(); loadTermToInput(); fillSubjectList(); };
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
    $('#cTeacher').onchange = function () {
      // 教师变更 → 联动刷新「对应学科」下拉（保留原科目若仍在列表中）
      var prevSubject = getSubjectValue();
      fillSubjectList(prevSubject);
      refreshCellWarn();
    };
    $('#cSubjectSel').onchange = function () {
      // 科目变更 → 反向联动刷新「教师」下拉（只列出能教本科目的教师）
      var prev = currentTeacher();
      var subject = getSubjectValue();
      // 已选教师若明确不能教新科目，直接清空，避免残留不匹配的值
      // （未登记任教学科的教师无法判定，予以保留）
      if (subject && (prev.teacherNo || prev.teacher)) {
        var t = teachers.filter(function (x) {
          return (prev.teacherNo && String(x.teacherNo || '').trim() === prev.teacherNo)
              || (prev.teacher && String(x.name || '').trim() === prev.teacher);
        })[0];
        if (t) {
          var subs = teacherSubjectsOf(t);
          if (subs.length && subs.indexOf(subject) === -1) prev = { teacherNo: '', teacher: '' };
        }
      }
      fillTeacherSelect(prev);
      refreshCellWarn();
    };
    $('#cRoom').oninput = refreshCellWarn;
    $('#cQuick').addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.tt-chip') : null;
      if (!chip) return;
      var items = JSON.parse(this.dataset.items || '[]');
      var s = items[Number(chip.dataset.quick)];
      if (!s) return;
      applySubjectValue(s.subject || '');
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

  // 等 site.js 拉取 AUTH 就绪后再启动（loadAuth 是异步 fetch，同步执行时 AUTH 仍为 null）
  function start() {
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
  }
  (function init() {
    if (window.AUTH) {
      start();
      return;
    }
    // site.js 加载完 AUTH 后会派发 cb-auth-ready；事件可被多处订阅，无需 once
    window.addEventListener('cb-auth-ready', function onAuth() {
      window.removeEventListener('cb-auth-ready', onAuth);
      start();
    });
    // 兜底：1.5s 内 AUTH 仍未就绪（未登录 / 接口异常）也尝试启动一次，
    // 让写接口以外的部分（读取网格、查看冲突、导出 CSV）仍能用，避免空白页
    setTimeout(function () { if (!window.AUTH) start(); }, 1500);
  })();
})();
