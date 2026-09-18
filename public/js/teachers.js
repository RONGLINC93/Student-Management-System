// 教师管理 - 主界面逻辑
const TEA_API = '/api/teachers';
const CLASS_API = '/api/classes';
const GRADES_API = '/api/grades';
const HR_API = '/api/hr';
const PERM_API = '/api/position-perms';
let teachers = [];
let classList = [];
let gradeList = [];
// 职位权限矩阵（职务名 → 登录身份 + 可管理模块），用于职务提示与人事异动权限预警
let permRoles = [];
let permModules = [];
// 离岗状态：不计入在职教师、不担任班主任、不可登录教师端
const OFF_DUTY = ['离职', '退休'];
const isOffDuty = (t) => OFF_DUTY.indexOf(t.status || '在职') !== -1;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const IC_HEAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const IC_CARET = '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const IC_UNCHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';
const IC_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const IC_USER_MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
const IC_HR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// 身份证号脱敏（前 4 + 后 4），与 server 端 maskIdCard 保持一致
function maskIdCard(no) {
  const s = String(no || '').trim().toUpperCase();
  if (!s) return '';
  if (s.length <= 4) return '****';
  if (s.length <= 8) return s.slice(0, 2) + '****' + s.slice(-2);
  return s.slice(0, 4) + '**********' + s.slice(-4);
}

// ===== 职位权限矩阵（职务 → 后台权限）=====
async function loadPerms() {
  try {
    const res = await fetch(PERM_API);
    const json = await res.json();
    permRoles = (json.data && json.data.roles) || [];
    permModules = (json.data && json.data.modules) || [];
  } catch (e) {
    permRoles = [];
    permModules = [];
  }
  // 行政职务下拉与系统设置「职位权限」清单联动：直接复用职务名，保证教师档案填写与权限配置一致
  refreshPositionList();
}
// 用职位权限清单中的职务名刷新行政职务 datalist（清单为空时保留 HTML 里的默认选项）
function refreshPositionList() {
  const dl = document.getElementById('positionList');
  if (!dl) return;
  const names = Array.from(new Set((permRoles || []).map(r => r.name).filter(Boolean)));
  if (!names.length) return;
  dl.innerHTML = '';
  names.forEach(n => {
    const o = document.createElement('option');
    o.value = n;
    dl.appendChild(o);
  });
}
function moduleNames(keys) {
  const names = permModules.filter(m => (keys || []).indexOf(m.key) !== -1).map(m => m.name);
  return names.length ? names.join('、') : '无';
}
// 按职务名匹配权限条目（与服务端 resolveTeacherPerm 的精确匹配分支一致）
function matchPerm(position) {
  const pos = String(position || '').trim();
  if (!pos) return null;
  const key = pos.toLowerCase();
  return permRoles.find(r => String(r.name || '').trim().toLowerCase() === key) || null;
}
function permDesc(p) {
  if (!p) return '无后台权限（仅教师端）';
  return moduleNames(p.modules || []);
}
// 教师当前生效的权限描述（优先用服务端算好的 perm 命中结果）
function teacherPermDesc(t) {
  if (!t) return '无后台权限（仅教师端）';
  if (t.perm && t.perm.matched) {
    return moduleNames(t.perm.modules || [])
      + (t.perm.legacy ? '（遗留关键字匹配）' : '');
  }
  const hit = matchPerm(t.position);
  return hit ? permDesc(hit) : '无后台权限（仅教师端）';
}

// 给下拉赋值；值不在选项里时临时追加一个选项（兼容历史档案中的旧值）
function setSelectValue(sel, value) {
  const el = $(sel);
  if (!el) return;
  const v = String(value || '');
  if (v && !Array.from(el.options).some(o => o.value === v)) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }
  el.value = v;
}

function splitSubjects(subject) {
  if (!subject) return [];
  return String(subject).split(/[,，、;；\/\s]+/).map(s => s.trim()).filter(Boolean);
}

// ========== 任教学科 chip 多选输入 ==========
function addSubjectChip(value) {
  const v = String(value || '').trim();
  if (!v) return;
  const box = $('#fSubjectChips');
  if (!box) return;
  // 去重（忽略大小写）
  const norm = v.toLowerCase();
  const exist = Array.from(box.querySelectorAll('.chip-tag')).some(el => (el.dataset.value || '').toLowerCase() === norm);
  if (exist) return;
  const chip = document.createElement('span');
  chip.className = 'chip-tag';
  chip.dataset.value = v;
  chip.innerHTML = '<span>' + escapeHtml(v) + '</span><button type="button" aria-label="删除该学科">&times;</button>';
  chip.querySelector('button').onclick = () => chip.remove();
  box.appendChild(chip);
}
function renderSubjectChips(list) {
  const box = $('#fSubjectChips');
  if (!box) return;
  box.innerHTML = '';
  (list || []).forEach(s => addSubjectChip(s));
}
function getSubjectChips() {
  const box = $('#fSubjectChips');
  if (!box) return [];
  return Array.from(box.querySelectorAll('.chip-tag'))
    .map(el => (el.dataset.value || '').trim())
    .filter(Boolean);
}
function bindSubjectChipInput() {
  const input = $('#fSubjectInput');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  const commit = () => {
    // 取出输入，去掉末尾分隔符，然后作为单个学科加入
    const raw = (input.value || '').trim().replace(/[,，、;；\/\s]+$/, '');
    if (!raw) return;
    // 同一行多个学科：用分隔符拆开，逐个加
    raw.split(/[,，、;；\/]+/).map(s => s.trim()).filter(Boolean).forEach(addSubjectChip);
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value) {
      const chips = $('#fSubjectChips').querySelectorAll('.chip-tag');
      if (chips.length) chips[chips.length - 1].remove();
    }
  });
  // 中文输入法 / 粘贴场景：失焦时把残留值也提交
  input.addEventListener('blur', () => { if (input.value.trim()) commit(); });
}

async function loadClasses() {
  try {
    const res = await fetch(CLASS_API);
    const json = await res.json();
    classList = json.data || [];
    const dl = $('#subjectList');
    if (dl) {
      dl.innerHTML = '';
      (window.SUBJECTS || []).forEach(sj => {
        const opt = document.createElement('option');
        opt.value = sj.name;
        dl.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('加载班级失败', e);
  }
}

async function loadGrades() {
  try {
    const res = await fetch(GRADES_API);
    const json = await res.json();
    gradeList = json.data || [];
    renderGradeChecks([]);
  } catch (e) {
    const box = $('#fGrades');
    if (box) box.innerHTML = '<span class="empty-tip-inline">年级列表加载失败</span>';
  }
}

// 渲染弹窗内「任教年级」复选框组；checkedNames 为已勾选年级名数组
function renderGradeChecks(checkedNames) {
  const box = $('#fGrades');
  if (!box) return;
  if (!gradeList || !gradeList.length) {
    box.innerHTML = '<span class="empty-tip-inline">暂无可选年级，请先在「年级管理」中添加</span>';
    return;
  }
  const set = new Set((checkedNames || []).map(String));
  box.innerHTML = gradeList.map(g => {
    const ck = set.has(g) ? ' checked' : '';
    return `<label><input type="checkbox" value="${escapeHtml(g)}"${ck}/>${escapeHtml(g)}</label>`;
  }).join('');
}

// 职务筛选下拉：按现有教师职务动态重建（保留当前选中值）
function renderPosFilter() {
  const sel = $('#posFilter');
  if (!sel) return;
  const cur = sel.value;
  const set = new Set();
  teachers.forEach(t => { if (t.position) set.add(t.position); });
  sel.innerHTML = '<option value="">全部职务</option>'
    + Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (cur && Array.from(set).indexOf(cur) !== -1) sel.value = cur;
}

function renderTable() {
  const kw = ($('#searchInput').value || '').trim().toLowerCase();
  const gender = $('#genderFilter').value;
  const status = $('#statusFilter').value;
  const pos = $('#posFilter').value;
  const headState = $('#headFilter').value;
  let list = teachers.slice();
  if (kw) {
    list = list.filter(t =>
      (t.name || '').toLowerCase().includes(kw) ||
      (t.teacherNo || '').toLowerCase().includes(kw) ||
      (t.idCard || '').toLowerCase().includes(kw) ||
      (t.hometown || '').toLowerCase().includes(kw) ||
      (t.address || '').toLowerCase().includes(kw) ||
      (t.phone || '').toLowerCase().includes(kw) ||
      (t.subject || '').toLowerCase().includes(kw) ||
      (t.position || '').toLowerCase().includes(kw) ||
      (t.department || '').toLowerCase().includes(kw) ||
      (t.className || '').toLowerCase().includes(kw) ||
      (Array.isArray(t.grades) ? t.grades.join(' ') : '').toLowerCase().includes(kw));
  }
  if (gender) list = list.filter(t => t.gender === gender);
  if (status) list = list.filter(t => (t.status || '在职') === status);
  if (pos) list = list.filter(t => t.position === pos);
  if (headState === 'head') list = list.filter(t => !!t.classId);
  else if (headState === 'none') list = list.filter(t => !t.classId);

  $('#statTotal').textContent = teachers.length;
  $('#statOn').textContent = teachers.filter(t => !isOffDuty(t)).length;
  $('#statMale').textContent = teachers.filter(t => t.gender === '男').length;
  $('#statFemale').textContent = teachers.filter(t => t.gender === '女').length;
  $('#statHead').textContent = teachers.filter(t => !!t.classId).length;

  if (!list.length) {
    $('#tBody').innerHTML = '<tr><td colspan="10" class="empty-tip">暂无符合条件的教师，点击右上角「添加教师」开始</td></tr>';
    return;
  }

  $('#tBody').innerHTML = list.map(t => {
    const gen = t.gender === '女' ? 'f' : 'm';
    const first = (t.name || '').trim().charAt(0) || '师';
    const chips = splitSubjects(t.subject).map(s => `<span class="subj-chip">${escapeHtml(s)}</span>`).join('');
    const headCell = t.classId && t.className
      ? `<span class="head-tag">${IC_HEAD}${escapeHtml(t.className)}</span>`
      : '<span class="head-none">未担任</span>';
    const grades = Array.isArray(t.grades) ? t.grades : [];
    const gradeCell = grades.length
      ? grades.map(g => `<span class="grade-chip">${escapeHtml(g)}</span>`).join('')
      : '<span class="grade-empty">未指定</span>';
    const st = t.status || '在职';
    const stCls = isOffDuty(t) ? 'st-off' : (st === '在职' ? 'st-on' : 'st-warn');
    const sub = t.department || t.joinYear
      ? `<div class="dept-sub">${escapeHtml([t.department, t.joinYear ? t.joinYear + ' 年入职' : ''].filter(Boolean).join(' · '))}</div>`
      : '';
    const permBadge = t.perm && t.perm.matched
      ? `<span class="perm-badge${(t.perm && t.perm.legacy) ? ' legacy' : ''}" title="后台权限：${escapeHtml(teacherPermDesc(t))}">${escapeHtml(t.perm.matched)}</span>`
      : (matchPerm(t.position)
        ? `<span class="perm-badge" title="后台权限：${escapeHtml(teacherPermDesc(t))}">${escapeHtml(matchPerm(t.position).name)}</span>`
        : '');
    const posCell = t.position
      ? `<div>${escapeHtml(t.position)}${permBadge}</div>${sub}`
      : (sub ? `<div class="head-none">未设职务</div>${sub}` : '<span class="head-none">—</span>');
    return `<tr data-id="${escapeHtml(t.id)}">
      <td>
        <div class="teacher-cell">
          <span class="teacher-avatar ${gen}">${escapeHtml(first)}</span>
          <div class="teacher-meta">
            <span class="teacher-name">${escapeHtml(t.name)}</span>
            <span class="teacher-sub">${t.teacherNo ? '工号 ' + escapeHtml(t.teacherNo) : '未编工号'}${t.idCard ? ' · ' + escapeHtml(maskIdCard(t.idCard)) : ' · 未登记身份证'}${t.hometown ? ' · ' + escapeHtml(t.hometown) : ''}</span>
          </div>
        </div>
      </td>
      <td><span class="gender-tag ${t.gender === '女' ? 'gender-female' : 'gender-male'}">${escapeHtml(t.gender)}</span></td>
      <td>${chips || '<span class="head-none">—</span>'}</td>
      <td>${escapeHtml(t.title || '—')}</td>
      <td class="pos-cell">${posCell}</td>
      <td><span class="st-tag ${stCls}">${escapeHtml(st)}</span></td>
      <td class="t-phone">${escapeHtml(t.phone || '—')}</td>
      <td>${gradeCell}</td>
      <td>${headCell}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-sm btn-edit" data-act="edit">编辑</button>
          <button type="button" class="btn-sm head-btn${t.classId ? ' is-head' : ''}" data-act="head">${IC_HEAD}<span>${t.classId ? '班主任' : '任班主任'}</span>${IC_CARET}</button>
          <button type="button" class="btn-sm btn-hr" data-act="hr">人事</button>
          <button type="button" class="btn-sm btn-del" data-act="del">删除</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function loadTeachers() {
  try {
    const res = await fetch(TEA_API);
    const json = await res.json();
    teachers = json.data || [];
    renderPosFilter();
    renderHrTeacherSelect();
    renderTable();
  } catch (e) {
    toast('加载教师失败：' + e.message, 'error');
  }
}

// 编辑弹窗：按当前填写的职务实时提示其后台权限（职务即权限来源）
function updatePermHint(t) {
  const box = $('#fPermHint');
  if (!box) return;
  const pos = String($('#fPosition') ? $('#fPosition').value : '').trim();
  if (!pos) {
    box.textContent = '未填写行政职务：该教师仅有教师端权限，不能登录管理后台。';
    return;
  }
  const hit = matchPerm(pos);
  if (hit) {
    box.innerHTML = '职务「<b>' + escapeHtml(pos) + '</b>」命中职位权限清单：<b>' + escapeHtml(permDesc(hit))
      + '</b>。可在「系统设置 → 职位权限」调整该职务的可管理模块。';
    return;
  }
  const legacy = t && (String(t.title || '').indexOf('教务') !== -1
    || String(t.position || '').indexOf('教务') !== -1
    || String(t.title || '').indexOf('宿管') !== -1
    || String(t.position || '').indexOf('宿管') !== -1
    || String(t.position || '').indexOf('宿舍管理') !== -1);
  box.innerHTML = '职务「<b>' + escapeHtml(pos) + '</b>」不在职位权限清单中：'
    + (legacy
      ? '该教师当前由<b>遗留关键字</b>兜底授权，改为新职务后兜底失效，将不能登录管理后台。'
      : '该教师不能登录管理后台（仅教师端）。如需授权，请在「系统设置 → 职位权限」添加同名职务。');
}

function openModal(t) {
  $('#modalTitle').textContent = t ? '编辑教师' : '添加教师';
  $('#fId').value = t ? t.id : '';
  $('#fTeacherNo').value = t ? t.teacherNo : '';
  $('#fIdCard').value = t ? (t.idCard || '') : '';
  $('#fName').value = t ? t.name : '';
  $('#fGender').value = t ? t.gender : '男';
  // 任教学科 chip 多选
  renderSubjectChips(splitSubjects(t && t.subject));
  bindSubjectChipInput();
  // 职称：历史档案可能是「教务 / 宿管」等旧值，下拉里没有则临时补一个选项，避免误清空
  setSelectValue('#fTitle', t ? t.title : '');
  $('#fPosition').value = t ? (t.position || '') : '';
  updatePermHint(t);
  $('#fDepartment').value = t ? (t.department || '') : '';
  $('#fStatus').value = t ? (t.status || '在职') : '在职';
  $('#fJoinYear').value = t ? t.joinYear : '';
  $('#fPhone').value = t ? t.phone : '';
  $('#fEthnic').value = t ? (t.ethnic || '') : '';
  $('#fHometown').value = t ? (t.hometown || '') : '';
  $('#fPolitical').value = t ? (t.political || '') : '';
  $('#fEducation').value = t ? (t.education || '') : '';
  $('#fAddress').value = t ? (t.address || '') : '';
  $('#fEmergencyName').value = t ? (t.emergencyName || '') : '';
  $('#fEmergencyPhone').value = t ? (t.emergencyPhone || '') : '';
  $('#fRemark').value = t ? t.remark : '';
  // 任教年级复选框组
  const currentGrades = (t && Array.isArray(t.grades)) ? t.grades : [];
  renderGradeChecks(currentGrades);
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fName').focus(), 100);
}
function closeModal() { $('#modalMask').classList.remove('show'); }

async function saveTeacher(e) {
  e.preventDefault();
  const id = $('#fId').value;
  // 收集任教年级（勾选的复选框 value）
  const checkedGrades = Array.from(document.querySelectorAll('#fGrades input[type="checkbox"]:checked'))
    .map(cb => String(cb.value || '').trim())
    .filter(Boolean);
  const data = {
    teacherNo: $('#fTeacherNo').value.trim(),
    idCard: $('#fIdCard').value.trim(),
    name: $('#fName').value.trim(),
    gender: $('#fGender').value,
    subject: getSubjectChips().join('、'),
    title: $('#fTitle').value,
    position: $('#fPosition').value.trim(),
    department: $('#fDepartment').value.trim(),
    status: $('#fStatus').value,
    joinYear: $('#fJoinYear').value.trim(),
    phone: $('#fPhone').value.trim(),
    ethnic: $('#fEthnic').value.trim(),
    hometown: $('#fHometown').value.trim(),
    political: $('#fPolitical').value,
    education: $('#fEducation').value,
    address: $('#fAddress').value.trim(),
    emergencyName: $('#fEmergencyName').value.trim(),
    emergencyPhone: $('#fEmergencyPhone').value.trim(),
    grades: checkedGrades,
    remark: $('#fRemark').value.trim()
  };
  if (!data.name) { toast('请输入教师姓名', 'error'); return; }
  const done = busyBtn(e && e.submitter ? e.submitter : $('#teacherForm') && $('#teacherForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
  try {
    const res = await fetch(id ? `${TEA_API}/${id}` : TEA_API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return; }
    toast(json.msg || (id ? '保存成功' : '添加成功'), 'success');
    closeModal();
    await loadTeachers();
  } catch (err) {
    toast('保存失败：' + err.message, 'error');
  } finally {
    done();
  }
}

async function setHead(teacherId, classId) {
  try {
    const res = await fetch(`${TEA_API}/${teacherId}/head`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId })
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '操作失败', 'error'); return; }
    toast(json.msg || '已更新', 'success');
    await loadClasses();
    await loadTeachers();
  } catch (e) {
    toast('操作失败：' + e.message, 'error');
  }
}

async function delTeacher(id, name) {
  if (!(await confirmDlg(`确定删除教师「${name}」？若其为班主任将同步解除该班班主任。`, { title: '删除教师', okText: '删除', danger: true }))) return;
  try {
    const res = await fetch(`${TEA_API}/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '删除失败', 'error'); return; }
    toast('已删除', 'success');
    await loadClasses();
    await loadTeachers();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

/* ===== 人事异动登记（行内「人事」按钮） ===== */
const HR_TYPES = ['入职', '转正', '调岗', '晋升', '职称变动', '借调', '离职', '退休', '其他'];
const todayStr = () => {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

function renderHrTeacherSelect() {
  const sel = $('#hTeacher');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = teachers.map(t =>
    `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}${t.teacherNo ? '（' + escapeHtml(t.teacherNo) + '）' : ''}</option>`
  ).join('');
  if (cur && teachers.some(t => t.id === cur)) sel.value = cur;
  else if (cur) sel.value = cur;
}

// 人事异动：职务变化 → 后台权限变化预警（需勾选确认 + 二次确认）
function hrWritesPosition(type) {
  return ['调岗', '晋升', '入职', '转正', '其他'].indexOf(type) !== -1;
}
function updateHrPermWarn(t) {
  const warn = $('#hPermWarn');
  const ackBox = $('#hPermAckBox');
  const ack = $('#hPermAck');
  if (!warn || !ackBox) return;
  const type = $('#hType').value;
  const after = String($('#hAfter').value || '').trim();
  if (!t || !hrWritesPosition(type) || !after) {
    warn.hidden = true;
    ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  const before = teacherPermDesc(t);
  const hit = matchPerm(after);
  const now = hit ? permDesc(hit) : '无后台权限（仅教师端）';
  if (before === now) {
    warn.hidden = true;
    ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  warn.hidden = false;
  warn.innerHTML = '该异动会把「<b>' + escapeHtml(t.name) + '</b>」的行政职务改为「<b>' + escapeHtml(after)
    + '</b>」，其后台权限将由 <b>' + escapeHtml(before) + '</b> 变为 <b>' + escapeHtml(now)
    + '</b>。请确认这是本次调岗 / 晋升的真实授权意图。';
  ackBox.hidden = false;
}

function openHrModal(t) {
  renderHrTeacherSelect();
  $('#hTeacherId').value = '';
  $('#hType').value = '调岗';
  $('#hDate').value = todayStr();
  $('#hBefore').value = '';
  $('#hAfter').value = '';
  $('#hDept').value = '';
  $('#hReason').value = '';
  $('#hRemark').value = '';
  if (t) {
    setSelectValue('#hTeacher', t.id);
    $('#hBefore').value = [t.position, t.department].filter(Boolean).join(' / ');
    $('#hDept').value = t.department || '';
    $('#hrTitle').textContent = '登记人事异动 · ' + t.name;
  } else {
    $('#hrTitle').textContent = '登记人事异动';
  }
  updateHrPermWarn(t);
  $('#hrMask').classList.add('show');
}

function closeHrModal() { $('#hrMask').classList.remove('show'); }

async function saveHr(e) {
  e.preventDefault();
  const tid = $('#hTeacher').value;
  if (!tid) { toast('请选择要登记异动的教师', 'error'); return; }
  const data = {
    teacherId: tid,
    type: $('#hType').value,
    date: $('#hDate').value || todayStr(),
    before: $('#hBefore').value.trim(),
    after: $('#hAfter').value.trim(),
    department: $('#hDept').value.trim(),
    reason: $('#hReason').value.trim(),
    remark: $('#hRemark').value.trim()
  };
  if (HR_TYPES.indexOf(data.type) === -1) { toast('异动类型不合法', 'error'); return; }
  // 权限变更：必须勾选确认并二次确认后才允许提交
  const t = teachers.find(x => x.id === tid);
  updateHrPermWarn(t);
  const warn = $('#hPermWarn');
  if (warn && !warn.hidden) {
    if (!$('#hPermAck').checked) {
      toast('该异动会改变其后台权限，请先勾选确认', 'error');
      return;
    }
    const hit = matchPerm(data.after);
    const now = hit ? permDesc(hit) : '无后台权限（仅教师端）';
    const ok = await confirmDlg(
      `「${t ? t.name : ''}」的后台权限将由「${teacherPermDesc(t)}」变为「${now}」，确定继续登记该人事异动吗？`,
      { title: '权限变更确认', okText: '确认变更', danger: true }
    );
    if (!ok) return;
  }
  const btn = $('#hrForm').querySelector('button[type="submit"]');
  const done = busyBtn(btn, '登记中…');
  if (!done) return;
  try {
    const res = await fetch(HR_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '登记失败', 'error'); return; }
    toast(json.msg || '人事异动已登记', 'success');
    closeHrModal();
    await loadTeachers();
  } catch (err) {
    toast('登记失败：' + err.message, 'error');
  } finally {
    done();
  }
}

/* ===== 悬浮菜单（任 / 改任 / 解除班主任） ===== */
const ctx = $('#ctxMenu');
let ctxTeacher = null;

function closeCtxMenu() {
  if (!ctx) return;
  ctx.classList.remove('show');
  ctxTeacher = null;
}

function openCtxMenu(t, anchor) {
  if (!ctx) return;
  if (ctx.classList.contains('show') && ctxTeacher && ctxTeacher.id === t.id) { closeCtxMenu(); return; }
  if (!classList.length) { toast('暂无班级，请先在「班级管理」中添加班级', 'error'); return; }

  const isHead = !!t.classId;
  let classRows;
  if (!classList.length) {
    classRows = '<button type="button" class="ctx-item" disabled>暂无班级可选</button>';
  } else {
    classRows = classList.map(c => {
      const isCur = c.id === t.classId;
      const other = !isCur && c.headTeacher && c.headTeacher !== t.name ? c.headTeacher : '';
      const hint = isCur ? '担任中'
        : (other ? '现：' + escapeHtml(other) : '');
      const icon = isCur ? IC_CHECK : IC_UNCHECK;
      const curCls = isCur ? ' is-cur' : '';
      return `<button type="button" class="ctx-item${curCls}" data-kind="class" data-cid="${escapeHtml(c.id)}" data-cname="${escapeHtml(c.name)}" data-other="${escapeHtml(other)}" ${isCur ? 'disabled' : ''}>${icon}<span class="lbl">${escapeHtml(c.name)}</span><span class="hint">${hint}</span></button>`;
    }).join('');
  }

  const removeRow = isHead
    ? `<button type="button" class="ctx-item danger" data-kind="cancel">${IC_USER_MINUS}<span class="lbl">解除班主任（当前：${escapeHtml(t.className || '已设班级')}）</span></button>
       <div class="ctx-divider"></div>`
    : '';

  ctx.innerHTML =
    `<div class="ctx-caption">${IC_HEAD}<span>${isHead ? '改任班主任 · 选择班级' : '设为班主任 · 选择班级'}</span></div>
     ${removeRow}
     <div class="ctx-list">${classRows}</div>
     <div class="ctx-divider"></div>
     <button type="button" class="ctx-item" data-kind="hr">${IC_HR}<span class="lbl">登记人事异动</span></button>
     <button type="button" class="ctx-item" data-kind="edit">${IC_EDIT}<span class="lbl">编辑教师</span></button>
     <button type="button" class="ctx-item danger" data-kind="del">${IC_TRASH}<span class="lbl">删除教师</span></button>`;

  ctxTeacher = t;
  ctx.hidden = false;
  ctx.style.visibility = 'hidden';
  ctx.style.opacity = '0';

  const r = anchor.getBoundingClientRect();
  const mh = ctx.offsetHeight;
  const mw = ctx.offsetWidth;
  let top = r.bottom + 8;
  let left = r.right - mw;
  const placeAbove = top + mh > window.innerHeight - 8;
  if (placeAbove) top = Math.max(8, r.top - mh - 8);
  if (left < 8) left = Math.max(8, r.left);
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  ctx.classList.toggle('above', placeAbove);
  ctx.style.top = top + 'px';
  ctx.style.left = left + 'px';
  ctx.style.visibility = '';
  ctx.style.opacity = '';
  requestAnimationFrame(() => ctx.classList.add('show'));
}

async function ctxPick(t, kind, item) {
  if (kind === 'hr') { closeCtxMenu(); openHrModal(t); return; }
  if (kind === 'edit') { closeCtxMenu(); openModal(t); return; }
  if (kind === 'del') { closeCtxMenu(); delTeacher(t.id, t.name); return; }
  if (kind === 'cancel') {
    closeCtxMenu();
    if (!(await confirmDlg(`确定解除「${t.name}」的班主任职务吗？`, { title: '解除班主任', okText: '解除', danger: true }))) return;
    setHead(t.id, '');
    return;
  }
  if (kind === 'class') {
    const cid = item.dataset.cid;
    const cname = item.dataset.cname || '';
    const other = item.dataset.other || '';
    closeCtxMenu();
    if (other) {
      if (!(await confirmDlg(`「${cname}」现由「${other}」担任班主任，确定换由「${t.name}」担任吗？`, { title: '替换班主任', okText: '替换', danger: true }))) return;
    }
    setHead(t.id, cid);
  }
}

function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#teacherForm').onsubmit = saveTeacher;
  $('#searchInput').oninput = renderTable;
  $('#genderFilter').onchange = renderTable;
  $('#statusFilter').onchange = renderTable;
  $('#posFilter').onchange = renderTable;
  $('#headFilter').onchange = renderTable;
  // 人事异动弹窗
  $('#hrClose').onclick = closeHrModal;
  $('#hrCancel').onclick = closeHrModal;
  $('#hrForm').onsubmit = saveHr;
  // 职务即权限：填写时实时提示命中的后台权限 / 权限变更预警
  $('#fPosition').addEventListener('input', () => updatePermHint(teachers.find(x => x.id === $('#fId').value)));
  const hrWatch = () => updateHrPermWarn(teachers.find(x => x.id === $('#hTeacher').value));
  $('#hAfter').addEventListener('input', hrWatch);
  $('#hType').addEventListener('change', hrWatch);
  $('#hTeacher').addEventListener('change', hrWatch);

  // 悬浮菜单动作（事件委托，防止 re-render 丢失监听）
  document.addEventListener('click', (e) => {
    if (e.target.closest('#ctxMenu')) return;
    if (e.target.closest('[data-act="head"]')) return;
    closeCtxMenu();
  });
  ctx.onclick = async (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item || item.disabled || !ctxTeacher) return;
    const kind = item.dataset.kind;
    if (kind === 'class' || kind === 'cancel' || kind === 'hr' || kind === 'edit' || kind === 'del') ctxPick(ctxTeacher, kind, item);
  };

  $('#tBody').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const t = teachers.find(x => x.id === tr.dataset.id);
    if (!t) return;
    if (btn.dataset.act === 'edit') openModal(t);
    else if (btn.dataset.act === 'del') delTeacher(t.id, t.name);
    else if (btn.dataset.act === 'hr') openHrModal(t);
    else if (btn.dataset.act === 'head') openCtxMenu(t, btn);
  };

  window.addEventListener('resize', closeCtxMenu);
  window.addEventListener('scroll', closeCtxMenu, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });

  window.addEventListener('cb-site-ready', () => {
    if (window.SUBJECTS && window.SUBJECTS.length) {
      const dl = $('#subjectList');
      if (dl) dl.innerHTML = '';
    }
    loadTeachers();
  });
}

window.cbEmbedRefresh = function () { loadClasses().then(loadGrades).then(loadTeachers); };

loadPerms().then(loadClasses).then(() => loadGrades()).then(() => {
  bindEvents();
  loadTeachers();
});
