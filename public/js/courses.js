/* ============================================================
   课程管理 · 各年级课程清单
   每个年级的「课程计划」：{ name, type, weeklyHours, examType, remark }
   决定了课程表（按班级排课）可以排什么课。同名课程仅保留一个。
   ============================================================ */
(function () {
  'use strict';

  const API = '/api/course-plans';

  // 模块授权判断：管理员全量；教务/宿管/查看模式按岗位权限（与课程表一致）
  function canWrite() {
    const a = window.AUTH;
    if (!a) return false;
    if (a.role === 'admin') return true;
    return Array.isArray(a.writable) && a.writable.indexOf('courses') !== -1;
  }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  let grades = [];                       // 所有年级（来自 grades.json）
  let plans = {};                        // { 高一: { courses: [...] } }
  let currentGrade = '';                 // 当前选中的年级
  let workingCourses = [];               // 当前年级的编辑缓冲（未保存改动）
  let subjectsFromSettings = [];         // 全校科目候选（来自各年级课程计划汇总）
  let subjectMax = {};                   // 科目满分：{ [科目名]: 满分 }

  function toast(msg, type) {
    const el = $('#toast');
    if (!el) return;
    el.className = 'toast show ' + (type || '');
    el.textContent = msg;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, 2400);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ===== 数据加载 =====
  function load() {
    return Promise.all([
      fetch(API).then(r => r.json()),
      fetch('/api/grades').then(r => r.json()),
      fetch('/api/subject-max').then(r => r.json()).catch(() => ({ data: {} }))
    ]).then(([planRes, gradeRes, maxRes]) => {
      grades = (gradeRes && gradeRes.data) || [];
      plans = (planRes && planRes.data && planRes.data.plans) || {};

      subjectMax = (maxRes && maxRes.data && typeof maxRes.data === 'object') ? maxRes.data : {};
      // 科目候选 = 各年级课程计划中出现的全部课程（课程即考试科目）
      subjectsFromSettings = allSubjectNames();

      // 默认选中第一个年级
      if (!grades.length) {
        currentGrade = '';
        workingCourses = [];
      } else {
        if (!currentGrade || grades.indexOf(currentGrade) === -1) currentGrade = grades[0];
        workingCourses = clonePlan(plans[currentGrade] && plans[currentGrade].courses || []);
      }
      renderGradeBar();
      renderActive();
      renderMax();
    }).catch((e) => {
      toast('加载失败：' + (e && e.message ? e.message : '网络异常'), 'error');
    });
  }

  // 汇总各年级课程计划中出现过的全部科目名（去重）。课程即考试科目，故这也是全校科目清单
  function allSubjectNames() {
    const out = [];
    const seen = {};
    grades.forEach(g => {
      ((plans[g] && plans[g].courses) || []).forEach(c => {
        const n = String((c && c.name) || '').trim();
        if (n && !seen[n]) { seen[n] = 1; out.push(n); }
      });
    });
    return out;
  }

  function clonePlan(list) {
    return (list || []).map(c => ({
      name: c.name || '',
      type: c.type || '必修',
      weeklyHours: Number(c.weeklyHours) || 0,
      examType: c.examType || '考试',
      remark: c.remark || ''
    }));
  }

  // ===== 年级选择条 =====
  function renderGradeBar() {
    const bar = $('#gradeBar');
    if (!bar) return;
    if (!grades.length) {
      bar.innerHTML = '<span style="font-size:13px;color:#9ca3af">暂无年级，请先到「<a href="/grades.html">年级管理</a>」创建</span>';
      return;
    }
    bar.innerHTML = '<span style="font-size:13px;color:#6b7280">年级：</span>' + grades.map(g => {
      const empty = !(plans[g] && plans[g].courses && plans[g].courses.length);
      const cls = 'cs-grade-pill' + (g === currentGrade ? ' active' : '') + (empty ? ' empty' : '');
      return '<button type="button" class="' + cls + '" data-grade="' + esc(g) + '">' + esc(g) + '</button>';
    }).join('');
    bar.querySelectorAll('.cs-grade-pill').forEach(el => {
      el.addEventListener('click', () => {
        const next = el.dataset.grade;
        if (!next || next === currentGrade) return;
        const go = () => {
          currentGrade = next;
          workingCourses = clonePlan(plans[currentGrade] && plans[currentGrade].courses || []);
          renderGradeBar();
          renderActive();
        };
        if (isDirty()) {
          confirmDlg('当前年级「' + currentGrade + '」有未保存的改动，切换年级将丢弃。', {
            title: '放弃未保存的改动？', okText: '放弃并切换', danger: true
          }).then(ok => { if (ok) go(); });
          return;
        }
        go();
      });
    });
  }

  function isDirty() {
    const saved = (plans[currentGrade] && plans[currentGrade].courses) || [];
    if (saved.length !== workingCourses.length) return true;
    const key = c => c.name + '|' + c.type + '|' + c.weeklyHours + '|' + c.examType + '|' + c.remark;
    const a = saved.map(key).join('#');
    const b = workingCourses.map(key).join('#');
    return a !== b;
  }

  // ===== 当前年级视图：标题 / 汇总 / 课程表 =====
  function renderActive() {
    const isW = canWrite();
    const titleEl = $('#curTitle');
    const subEl = $('#curSub');
    const sumEl = $('#summary');
    const tbody = $('#tbody');

    $('#btnAdd').disabled = !isW || !currentGrade;
    $('#btnSave').disabled = !isW || !currentGrade;
    $('#btnReset').disabled = !isW || !currentGrade;
    $('#btnImport').disabled = !isW || !currentGrade;

    if (!currentGrade) {
      titleEl.textContent = '请选择年级';
      subEl.textContent = '';
      sumEl.hidden = true;
      tbody.innerHTML = '<tr><td colspan="7" class="empty-tip">尚无年级，请先到「年级管理」创建，再返回此处配置课程</td></tr>';
      return;
    }

    titleEl.textContent = currentGrade + ' · 课程清单';
    const totalHours = workingCourses.reduce((s, c) => s + (Number(c.weeklyHours) || 0), 0);
    subEl.textContent = '共 ' + workingCourses.length + ' 门课程 · 合计周课时 ' + totalHours;
    subEl.style.color = isDirty() ? '#b45309' : '#94a3b8';

    // 汇总卡片
    const byType = { 必修: 0, 选修: 0, 校本: 0, 实践: 0 };
    const byExam = { 考试: 0, 考查: 0, '无': 0 };
    workingCourses.forEach(c => {
      if (byType[c.type] != null) byType[c.type] += 1;
      if (byExam[c.examType] != null) byExam[c.examType] += 1;
    });
    sumEl.hidden = false;
    $('#sumTotal').textContent = workingCourses.length;
    $('#sumHours').textContent = totalHours;
    $('#sumReq').textContent = '必修 ' + byType['必修'];
    $('#sumOpt').textContent = '选修 ' + byType['选修'] + ' · 校本 ' + byType['校本'] + ' · 实践 ' + byType['实践'];
    $('#sumExam').textContent = '考试 ' + byExam['考试'];
    $('#sumCheck').textContent = '考查 ' + byExam['考查'] + ' · 无 ' + byExam['无'];
    const cap = Math.min(40, totalHours); // 上限 40 节
    $('#sumBar').style.width = cap ? (Math.min(100, totalHours / 40 * 100)) + '%' : '0%';
    $('#sumWarn').hidden = workingCourses.length > 0;

    if (!workingCourses.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-tip">还没有课程，点击右上「+ 添加课程」开始配置；或使用「从系统科目导入」/「恢复默认」一键填充</td></tr>';
      return;
    }

    tbody.innerHTML = workingCourses.map((c, i) => renderRow(c, i, isW)).join('');
    tbody.querySelectorAll('.cs-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (isNaN(idx)) return;
        workingCourses.splice(idx, 1);
        renderActive();
      });
    });
    tbody.querySelectorAll('.cs-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (isNaN(idx)) return;
        openEdit(idx);
      });
    });
    // 行内修改：name / hours / remark 实时回写到 workingCourses
    tbody.querySelectorAll('input[data-fld], select[data-fld]').forEach(el => {
      el.addEventListener('input', () => onFieldInput(el));
      el.addEventListener('change', () => onFieldInput(el));
    });
  }

  function onFieldInput(el) {
    const idx = Number(el.dataset.idx);
    const fld = el.dataset.fld;
    if (!workingCourses[idx]) return;
    let v = el.value;
    if (fld === 'weeklyHours') v = Math.max(0, Math.min(20, Math.floor(Number(v) || 0)));
    workingCourses[idx][fld] = v;
    // 周课时变化时实时刷新标题与汇总
    if (fld === 'weeklyHours') {
      const totalHours = workingCourses.reduce((s, c) => s + (Number(c.weeklyHours) || 0), 0);
      $('#curSub').textContent = '共 ' + workingCourses.length + ' 门课程 · 合计周课时 ' + totalHours;
      $('#sumHours').textContent = totalHours;
      $('#sumBar').style.width = Math.min(100, totalHours / 40 * 100) + '%';
    }
    subDirtyColor();
  }

  function subDirtyColor() {
    const el = $('#curSub');
    if (!el) return;
    el.style.color = isDirty() ? '#b45309' : '#94a3b8';
  }

  function renderRow(c, i, isW) {
    const name = esc(c.name);
    const remark = esc(c.remark);
    const disabled = isW ? '' : 'disabled title="仅管理员 / 教务可编辑"';
    return `
      <tr data-idx="${i}"${isDirty() && i === 0 ? '' : ''}>
        <td class="td-center">${i + 1}</td>
        <td><input class="cs-name" data-idx="${i}" data-fld="name" maxlength="20" value="${name}" ${disabled} /></td>
        <td>
          <select data-idx="${i}" data-fld="type" ${disabled}>
            ${['必修', '选修', '校本', '实践'].map(t => `<option value="${t}"${t === c.type ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </td>
        <td><input class="cs-hours" data-idx="${i}" data-fld="weeklyHours" type="number" min="0" max="20" step="1" value="${c.weeklyHours || 0}" ${disabled} /></td>
        <td>
          <select data-idx="${i}" data-fld="examType" ${disabled}>
            ${['考试', '考查', '无'].map(t => `<option value="${t}"${t === c.examType ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </td>
        <td><input class="cs-remark" data-idx="${i}" data-fld="remark" maxlength="100" value="${remark}" placeholder="选填" ${disabled} /></td>
        <td>
          <div class="row-actions">
            <button class="btn-sm cs-edit" data-idx="${i}" type="button" ${disabled ? 'disabled' : ''}>编辑</button>
            <button class="btn-sm btn-del cs-del" data-idx="${i}" type="button" ${disabled ? 'disabled' : ''}>删除</button>
          </div>
        </td>
      </tr>
    `;
  }

  // ===== 编辑弹窗 =====
  function openEdit(idx) {
    const isNew = idx < 0 || idx >= workingCourses.length;
    const c = isNew ? { name: '', type: '必修', weeklyHours: 2, examType: '考试', remark: '' } : workingCourses[idx];
    $('#editTitle').textContent = isNew ? '添加课程' : '编辑课程';
    $('#eIdx').value = isNew ? '' : String(idx);
    $('#eName').value = c.name || '';
    $('#eType').value = c.type || '必修';
    $('#eHours').value = c.weeklyHours == null ? 0 : c.weeklyHours;
    $('#eExam').value = c.examType || '考试';
    $('#eRemark').value = c.remark || '';
    $('#editMask').classList.add('show');
    setTimeout(() => $('#eName').focus(), 50);
  }
  function closeEdit() { $('#editMask').classList.remove('show'); }

  $('#editClose').addEventListener('click', closeEdit);
  $('#editCancel').addEventListener('click', closeEdit);
  $('#editForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const idxStr = $('#eIdx').value;
    const name = $('#eName').value.trim();
    if (!name) { toast('请输入课程名称', 'error'); $('#eName').focus(); return; }
    // 同名校验（在当前缓冲内去重）
    const dup = workingCourses.findIndex((c, i) => c.name === name && String(i) !== idxStr);
    if (dup !== -1) { toast('已存在同名课程「' + name + '」，请勿重复添加', 'error'); return; }
    const item = {
      name,
      type: $('#eType').value || '必修',
      weeklyHours: Math.max(0, Math.min(20, Math.floor(Number($('#eHours').value) || 0))),
      examType: $('#eExam').value || '考试',
      remark: $('#eRemark').value.trim().slice(0, 100)
    };
    if (idxStr === '') {
      workingCourses.push(item);
    } else {
      const i = Number(idxStr);
      if (workingCourses[i]) workingCourses[i] = item;
    }
    closeEdit();
    renderActive();
  });

  // ===== 工具栏按钮 =====
  $('#btnAdd').addEventListener('click', () => { if (currentGrade && canWrite()) openEdit(-1); });
  $('#btnSave').addEventListener('click', saveCurrent);
  $('#btnReset').addEventListener('click', resetCurrent);
  $('#btnImport').addEventListener('click', importFromSubjects);

  function saveCurrent() {
    if (!canWrite() || !currentGrade) return;
    // 后端会再做去重，这里再做一次去重防止保存无效请求
    const seen = {};
    const cleaned = [];
    workingCourses.forEach(c => {
      const name = (c.name || '').trim();
      if (!name || seen[name]) return;
      seen[name] = 1;
      cleaned.push({
        name: name.slice(0, 20),
        type: c.type || '必修',
        weeklyHours: Math.max(0, Math.min(20, Math.floor(Number(c.weeklyHours) || 0))),
        examType: c.examType || '考试',
        remark: String(c.remark || '').trim().slice(0, 100)
      });
    });
    const btn = $('#btnSave');
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';
    fetch(API + '/' + encodeURIComponent(currentGrade), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses: cleaned })
    })
      .then(r => r.json())
      .then(j => {
        if (j.code !== 0) throw new Error(j.msg || '保存失败');
        plans[currentGrade] = { courses: cleaned };
        workingCourses = clonePlan(cleaned);
        toast('「' + currentGrade + '」的课程计划已保存', 'success');
        // 课程变动会改变全校科目清单，同步刷新满分设置区
        subjectsFromSettings = allSubjectNames();
        renderGradeBar();
        renderActive();
        renderMax();
      })
      .catch(e => toast(e.message, 'error'))
      .then(() => { btn.textContent = oldText; btn.disabled = false; });
  }

  function resetCurrent() {
    if (!canWrite() || !currentGrade) return;
    confirmDlg('确定要把「' + currentGrade + '」的课程计划恢复为内置默认吗？当前列表将被覆盖（已保存的内容会丢失）。', {
      title: '恢复默认', okText: '恢复默认', danger: true
    }).then(ok => {
      if (!ok) return;
      fetch(API + '/' + encodeURIComponent(currentGrade) + '/reset', { method: 'POST' })
        .then(r => r.json())
        .then(j => {
          if (j.code !== 0) throw new Error(j.msg || '重置失败');
          plans[currentGrade] = (j.data && j.data.plan) || { courses: [] };
          workingCourses = clonePlan(plans[currentGrade].courses);
          toast('「' + currentGrade + '」已恢复默认课程', 'success');
          renderGradeBar();
          renderActive();
        })
        .catch(e => toast(e.message, 'error'));
    });
  }

  function importFromSubjects() {
    if (!canWrite() || !currentGrade) return;
    if (!subjectsFromSettings.length) {
      // 没有系统科目配置时，给一份常见科目兜底
      subjectsFromSettings = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '体育', '音乐', '美术', '信息技术', '综合实践'];
    }
    const existing = new Set(workingCourses.map(c => c.name));
    const merged = workingCourses.slice();
    let added = 0;
    subjectsFromSettings.forEach(name => {
      if (!existing.has(name)) {
        merged.push({ name, type: '必修', weeklyHours: 2, examType: '考试', remark: '' });
        existing.add(name);
        added += 1;
      }
    });
    if (!added) {
      toast('系统科目表中没有比当前清单多出的科目', 'info');
      return;
    }
    workingCourses = merged;
    renderActive();
    subDirtyColor();
    toast('已添加 ' + added + ' 门新课程，点击「保存课程计划」后生效', 'success');
  }

  // ===== 考试科目满分 =====
  function renderMax() {
    const box = $('#maxBox');
    const grid = $('#maxGrid');
    if (!box || !grid) return;
    const names = allSubjectNames();
    const isW = canWrite();
    $('#btnSaveMax').disabled = !isW || !names.length;
    if (!names.length) {
      grid.innerHTML = '<span class="cs-max-empty">尚未配置任何课程。保存课程计划后，可在此为各科设置满分。</span>';
      box.hidden = false;
      return;
    }
    grid.innerHTML = names.map(n => (
      '<div class="cs-max-item">'
      + '<span class="nm" title="' + esc(n) + '">' + esc(n) + '</span>'
      + '<input type="number" min="10" max="1000" step="1" data-subj="' + esc(n) + '"'
      + ' value="' + (Number(subjectMax[n]) || 100) + '"' + (isW ? '' : ' disabled') + ' />'
      + '<span class="un">分</span>'
      + '</div>'
    )).join('');
    box.hidden = false;
  }

  function saveMax() {
    if (!canWrite()) return;
    const next = {};
    $$('#maxGrid input[data-subj]').forEach(el => {
      const n = el.dataset.subj;
      const v = Math.min(1000, Math.max(10, Math.floor(Number(el.value) || 100)));
      next[n] = v;
      el.value = v;
    });
    const btn = $('#btnSaveMax');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';
    fetch('/api/subject-max', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectMax: next })
    })
      .then(r => r.json())
      .then(j => {
        if (j.code !== 0) throw new Error(j.msg || '保存失败');
        subjectMax = j.data || next;
        toast('科目满分已保存', 'success');
      })
      .catch(e => toast(e.message, 'error'))
      .then(() => { btn.textContent = old; btn.disabled = false; });
  }
  $('#btnSaveMax').addEventListener('click', saveMax);

  // ===== 启动 =====
  function start() {
    if (!canWrite()) {
      toast('当前账号仅可查看课程计划，无法编辑', 'warning');
    }
    if (!grades.length) {
      renderGradeBar();
      renderActive();
    }
  }

  if (window.AUTH) {
    start();
    load();
  } else {
    window.addEventListener('cb-auth-ready', function onAuth() {
      window.removeEventListener('cb-auth-ready', onAuth);
      start();
      load();
    });
    setTimeout(() => { if (!window.AUTH) { start(); load(); } }, 1500);
  }
})();
