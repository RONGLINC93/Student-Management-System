// 教师管理 - 主界面逻辑
const TEA_API = '/api/teachers';
const CLASS_API = '/api/classes';
const GRADES_API = '/api/grades';
const COURSE_API = '/api/course-plans';
const HR_API = '/api/hr';
const PERM_API = '/api/dept-perms';
let teachers = [];
let classList = [];
let gradeList = [];
// 各年级课程计划（课程管理维护）：年级名 → 该年级课程名数组，供「任教年级 → 任教学科」联动
let coursePlanMap = {};
let coursePlanOk = false;
// 左侧年级树筛选：kind = all（全部）/ grade（任教年级）/ class（班级班主任）/ none（未指定年级）
let treeSel = { kind: 'all', value: '' };
// 年级树折叠状态（键：'__root__' / 'g:年级名'），默认展开
const gradeCollapsed = new Set();
// 组织架构权限（部门 → 可管理模块，服务端已按层级算好继承），用于部门提示与人事异动权限预警
let deptPermMap = {};
let permModules = [];
// 组织架构部门 / 职位（行政职位级联来源：教师也可能担任后勤等部门的职位）
const DEPT_API = '/api/departments';
const POS_API = '/api/positions';
let deptCache = [];
let posCache = [];
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
// 左侧年级树图标：学校（全部）/ 年级 / 班级
const G_ICONS = {
  school: '<svg class="gico school" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-5h4v5"/></svg>',
  grade: '<svg class="gico grade" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 14l9 5 9-5"/></svg>',
  cls: '<svg class="gico cls" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16"/><path d="M16 10h.01"/><path d="M16 14h.01"/></svg>'
};

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

// 教师照片：上传 / 摄像头拍照由公共模块 /js/photo.js 提供（学生档案、后勤职工共用同一套交互）
let photoField = null;

// ===== 组织架构权限（所属部门 → 后台权限）=====
async function loadPerms() {
  try {
    const res = await fetch(PERM_API);
    const json = await res.json();
    deptPermMap = (json.data && json.data.effective) || {};
    permModules = (json.data && json.data.modules) || [];
  } catch (e) {
    deptPermMap = {};
    permModules = [];
  }
  // 行政职位下拉来源为组织架构职位（/api/positions），与权限配置相互独立
  refreshPositionList($('#fPosDept') ? $('#fPosDept').value : '');
}
// 拉取组织架构部门（与人事管理共用 /api/departments），供行政职位「部门」级联下拉
async function loadDept() {
  try {
    const res = await fetch(DEPT_API);
    const json = await res.json();
    deptCache = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
  } catch (e) { deptCache = []; }
}
// 拉取组织架构职位（人事管理 → 组织架构 → 职位管理），供行政职位级联（含后勤等部门的职位）
async function loadPositions() {
  try {
    const res = await fetch(POS_API);
    const json = await res.json();
    posCache = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
  } catch (e) { posCache = []; }
}
// 职位归属部门名：优先取冗余的 department，缺省时按 departmentId 回查部门表（避免只存 id 时联动不上）
function posDeptName(p) {
  if (!p) return '';
  if (String(p.department || '').trim()) return String(p.department).trim();
  if (p.departmentId) {
    const d = (deptCache || []).find(x => x.id === p.departmentId);
    if (d && d.name) return String(d.name).trim();
  }
  return '';
}
// 行政职位的「部门」级联下拉（组织架构部门，树形缩进；空值表示未分配部门）
function fillPosDeptSelect() {
  const sel = document.getElementById('fPosDept');
  if (!sel) return;
  const kidsOf = pid => deptCache.filter(d => (d.parentId || '') === pid);
  let html = '<option value="">（未分配部门）</option>';
  (function walk(pid, prefix) {
    kidsOf(pid).forEach(d => {
      html += '<option value="' + escapeHtml(d.name) + '">' + escapeHtml(prefix + d.name) + '</option>';
      walk(d.id, prefix + '　');
    });
  })('', '');
  sel.innerHTML = html;
}
// 行政职位下拉：来源 = 组织架构职位（按部门级联收窄）。
// 不再使用已废弃的「职务权限」清单作为选项来源；仅以组织架构（人事 → 组织架构 → 职位管理）中定义的职位为准。
// opts.keep：需要保留的职务（编辑回填时的历史值）；opts.keepLegacy：true 时允许保留不在清单中的旧职务。
// 未选部门时禁用行政职位，仅显示「请先选择所属部门」。
function refreshPositionList(dept, opts) {
  const o = opts || {};
  const sel = document.getElementById('fPosition');
  if (!sel) return;
  const cur = String(o.keep || sel.value || '').trim();
  // 未选择所属部门：行政职位不可选
  if (!dept && !cur) {
    sel.innerHTML = '<option value="">（请先选择所属部门）</option>';
    sel.disabled = true;
    return;
  }
  // 仅以组织架构职位为来源（按所选部门收窄）
  let names = (posCache || []).map(p => p.name).filter(Boolean);
  if (dept) {
    const set = new Set((posCache || []).filter(p => posDeptName(p) === dept).map(p => p.name));
    names = names.filter(n => set.has(n));
  }
  names = Array.from(new Set(names));
  const keepCur = cur && (names.indexOf(cur) !== -1 || !!o.keepLegacy);
  sel.disabled = false;
  sel.innerHTML = '<option value="">' + (names.length ? '（未设置行政职位）' : '（该部门暂无职位，请先到组织架构添加）') + '</option>';
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
  // 保留的职务不在清单内时补回（仅编辑回填的历史值允许），否则清空以保持与部门一致
  if (keepCur && names.indexOf(cur) === -1) {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = cur;
    sel.appendChild(opt);
  }
  sel.value = keepCur ? cur : '';
  sel.disabled = !names.length && !keepCur;
}
// 反向联动：选中行政职位后，把所属部门校正为该职位在组织架构中登记的部门，二者始终一致
function syncDeptFromPosition() {
  const deptSel = document.getElementById('fPosDept');
  const posSel = document.getElementById('fPosition');
  if (!deptSel || !posSel) return;
  const pos = String(posSel.value || '').trim();
  if (!pos) return;
  const hit = (posCache || []).find(p => p.name === pos);
  const dept = posDeptName(hit);
  if (!dept || deptSel.value === dept) return;
  // 该部门不在下拉选项中则不改（避免把部门清空）
  if (!Array.from(deptSel.options).some(op => op.value === dept)) return;
  deptSel.value = dept;
}
function moduleNames(keys) {
  const names = permModules.filter(m => (keys || []).indexOf(m.key) !== -1).map(m => m.name);
  return names.length ? names.join('、') : '无';
}
// 按部门名匹配权限条目（服务端下发的 effective 已含上级部门继承，与 resolveTeacherPerm 一致）
function matchPerm(dept) {
  const n = String(dept || '').trim();
  if (!n) return null;
  const mods = deptPermMap[n];
  return Array.isArray(mods) ? { name: n, modules: mods } : null;
}
function permDesc(p) {
  if (!p) return '无后台权限（仅教师端）';
  return moduleNames(p.modules || []);
}
// 有所属部门但未配置任何可管理模块：仍可登录管理后台（身份即部门），只是全部模块仅可查看
const UNCONFIGURED_PERM = '可登录后台，未配置可管理模块（全部仅可查看）';
// 教师当前生效的权限描述（优先用服务端算好的 perm 命中结果）
function teacherPermDesc(t) {
  if (!t) return '无后台权限（仅教师端）';
  if (t.perm && t.perm.matched) {
    const mods = t.perm.modules || [];
    return mods.length ? moduleNames(mods) : UNCONFIGURED_PERM;
  }
  const hit = matchPerm(t.department);
  if (hit) return permDesc(hit);
  return t.department ? UNCONFIGURED_PERM : '无后台权限（仅教师端）';
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

// ========== 任教学科：一个标签 = 一门学科 + 一个年级 ==========
// 标签固定写作「学科（年级）」，同一学科在多个年级任教时各占一个标签（如「语文（一年级）」「语文（二年级）」）。
// dataset.value 存学科名、dataset.grade 存年级；保存到档案时按学科名去重，年级不写入学科字段。
function chipText(subject, grade) {
  const g = String(grade || '').trim();
  return g ? subject + '（' + g + '）' : subject;
}
// 标签唯一键：学科 + 年级（忽略大小写）
function chipKey(subject, grade) {
  return String(subject || '').trim().toLowerCase() + '|' + String(grade || '').trim().toLowerCase();
}
function addSubjectChip(value, grade) {
  const v = String(value || '').trim();
  if (!v) return;
  const box = $('#fSubjectChips');
  if (!box) return;
  const g = String(grade || '').trim();
  const key = chipKey(v, g);
  const exist = Array.from(box.querySelectorAll('.chip-tag'))
    .some(el => chipKey(el.dataset.value, el.dataset.grade) === key);
  if (exist) return;
  const chip = document.createElement('span');
  chip.className = 'chip-tag';
  chip.dataset.value = v;
  chip.dataset.grade = g;
  chip.innerHTML = '<span>' + escapeHtml(chipText(v, g)) + '</span><button type="button" aria-label="删除该学科">&times;</button>';
  chip.querySelector('button').onclick = () => { chip.remove(); refreshSubjectOptions(); };
  box.appendChild(chip);
}
// 回填：items 为 [{ name, grade }]（新档案）；也兼容旧的学科名数组
function renderSubjectChips(items) {
  const box = $('#fSubjectChips');
  if (!box) return;
  box.innerHTML = '';
  (items || []).forEach(it => {
    if (typeof it === 'string') addSubjectChip(it, '');
    else addSubjectChip(it && it.name, it && it.grade);
  });
}
// 当前标签的「学科 + 年级」明细：提交给服务端存为 subjects
function getSubjectItems() {
  const box = $('#fSubjectChips');
  if (!box) return [];
  return Array.from(box.querySelectorAll('.chip-tag'))
    .map(el => ({ name: String(el.dataset.value || '').trim(), grade: String(el.dataset.grade || '').trim() }))
    .filter(x => x.name);
}
// 已选学科名（去重，忽略大小写，保持添加顺序）——写入档案的任教学科
function getSubjectChips() {
  const box = $('#fSubjectChips');
  if (!box) return [];
  const out = [];
  const seen = {};
  Array.from(box.querySelectorAll('.chip-tag')).forEach(el => {
    const v = String(el.dataset.value || '').trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(v);
  });
  return out;
}
// 已选「学科 + 年级」组合的键集合，用于从下拉中剔除已添加项
function chosenChipKeys() {
  const box = $('#fSubjectChips');
  if (!box) return new Set();
  return new Set(Array.from(box.querySelectorAll('.chip-tag'))
    .map(el => chipKey(el.dataset.value, el.dataset.grade)));
}
// 学科下拉：选中一项即加入已选学科（chip），随后复位到占位项，可继续添加下一门
function bindSubjectSelect() {
  const sel = $('#fSubjectInput');
  if (!sel || sel.dataset.bound) return;
  sel.dataset.bound = '1';
  sel.addEventListener('change', () => {
    const v = String(sel.value || '').trim();
    if (!v) return;
    // 带上选项所属年级，chip 显示成「学科（年级）」
    const opt = sel.selectedOptions && sel.selectedOptions[0];
    addSubjectChip(v, opt ? (opt.dataset.grade || '') : '');
    refreshSubjectOptions(); // 已选的从下拉中移除，避免重复添加
  });
}

async function loadClasses() {
  try {
    const res = await fetch(CLASS_API);
    const json = await res.json();
    classList = json.data || [];
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

// 各年级课程计划：由「课程管理」维护（/api/course-plans），是任教学科候选的唯一来源
async function loadCoursePlans() {
  try {
    const res = await fetch(COURSE_API);
    const json = await res.json();
    const data = (json && json.data) || {};
    const plans = data.plans || {};
    coursePlanMap = {};
    Object.keys(plans).forEach(g => {
      const courses = (plans[g] && Array.isArray(plans[g].courses)) ? plans[g].courses : [];
      coursePlanMap[g] = courses.map(c => String((c && c.name) || '').trim()).filter(Boolean);
    });
    coursePlanOk = true;
  } catch (e) {
    coursePlanMap = {};
    coursePlanOk = false;
  }
  refreshSubjectOptions();
}

// 当前勾选的任教年级（弹窗内复选框）
function selectedGrades() {
  return Array.from(document.querySelectorAll('#fGrades input[type="checkbox"]:checked'))
    .map(cb => String(cb.value || '').trim())
    .filter(Boolean);
}
// 所选任教年级的全部课程（并集，按年级与课程计划顺序去重）
// 未勾选任教年级时返回空：学科只能来自所选年级的课程计划，避免给出与任教年级无关的选项
function subjectsOfGrades(grades) {
  const gs = (grades || []).filter(Boolean);
  if (!gs.length) return [];
  const out = [];
  gs.forEach(g => {
    (coursePlanMap[g] || []).forEach(s => { if (out.indexOf(s) === -1) out.push(s); });
  });
  return out;
}
// 任教年级 → 任教学科：按所选年级重建学科下拉与提示文案；
// 标签所属年级若被取消勾选则标黄保留（不静默删除用户已填内容）
function refreshSubjectOptions() {
  const sel = $('#fSubjectInput');
  const hint = $('#fSubjectHint');
  const grades = selectedGrades();
  const scoped = grades.length > 0;
  const list = subjectsOfGrades(grades);

  // 已选标签的两类异常（均只标黄提示、不静默删除，鼠标悬停说明原因）：
  //   1) 所属年级已被取消勾选；2) 该学科已不在所选年级的课程计划（课程改名 / 删除）
  const box = $('#fSubjectChips');
  if (box) {
    const planSet = new Set(list.map(s => String(s).toLowerCase()));
    Array.from(box.querySelectorAll('.chip-tag')).forEach(el => {
      const v = String(el.dataset.value || '').trim();
      const g = String(el.dataset.grade || '').trim();
      const gradeOk = !scoped || !g || grades.indexOf(g) !== -1;
      const planOk = !scoped || !list.length || planSet.has(v.toLowerCase());
      const ok = gradeOk && planOk;
      el.classList.toggle('off', !ok);
      if (ok) el.removeAttribute('title');
      else if (!gradeOk) el.setAttribute('title', '「' + g + '」已不在任教年级中（已保留，可手动删除）');
      else el.setAttribute('title', '该学科已不在所选年级的课程计划中（已保留，可手动删除）');
    });
  }
  // 下拉：按任教年级分组，选项写作「学科（年级）」；已添加的「学科 + 年级」组合不再列出
  const chosen = chosenChipKeys();
  let html = '';
  let left = 0;
  grades.forEach(g => {
    const rest = (coursePlanMap[g] || []).filter(s => !chosen.has(chipKey(s, g)));
    if (!rest.length) return; // 该年级课程已全部添加
    left += rest.length;
    html += '<optgroup label="' + escapeHtml(g) + '">'
      + rest.map(s => '<option value="' + escapeHtml(s) + '" data-grade="' + escapeHtml(g) + '">'
        + escapeHtml(chipText(s, g)) + '</option>').join('')
      + '</optgroup>';
  });
  if (sel) {
    bindSubjectSelect();
    // 未选年级：下拉置空并禁用，先选任教年级才有候选学科
    const ph = left ? '＋ 选择学科添加' : (scoped ? '（已全部添加）' : '（请先选择任教年级）');
    sel.innerHTML = '<option value="">' + ph + '</option>' + html;
    sel.value = '';
    sel.disabled = !left;
  }
  if (!hint) return;
  if (!scoped) {
    hint.className = 'subj-hint warn';
    hint.textContent = !(gradeList || []).length
      ? '暂无年级，请先在「年级管理」中添加年级。'
      : '请先勾选上方「任教年级」，学科下拉将按所选年级的课程计划加载。';
    return;
  }
  if (!list.length) {
    hint.className = 'subj-hint warn';
    hint.textContent = coursePlanOk
      ? '「' + grades.join('、') + '」尚未在「课程管理」中配置课程计划，请先去配置该年级课程。'
      : '课程计划加载失败，请刷新页面重试或先在「课程管理」中维护各年级课程。';
    return;
  }
  hint.className = 'subj-hint';
  hint.textContent = '已加载 ' + grades.length + ' 个年级共 ' + list.length + ' 门学科'
    + (left ? '，可添加 ' + left + ' 项' : '（已全部添加）') + '：选择后按「学科（年级）」加入标签。';
}


// 渲染弹窗内「任教年级」复选框组；checkedNames 为已勾选年级名数组
function renderGradeChecks(checkedNames) {
  const box = $('#fGrades');
  if (!box) return;
  if (!gradeList || !gradeList.length) {
    box.innerHTML = '<span class="empty-tip-inline">暂无可选年级，请先在「年级管理」中添加</span>';
    refreshSubjectOptions();
    return;
  }
  const set = new Set((checkedNames || []).map(String));
  box.innerHTML = gradeList.map(g => {
    const ck = set.has(g) ? ' checked' : '';
    return `<label><input type="checkbox" value="${escapeHtml(g)}"${ck}/>${escapeHtml(g)}</label>`;
  }).join('');
  refreshSubjectOptions(); // 勾选变化 → 任教学科候选随之联动
}

// ===== 左侧「任教年级」树：点击节点筛选教师 =====
// 年级 ↔ 教师：档案中的「任教年级 grades」；班级 ↔ 教师：担任班主任（classId）
function matchTree(t, sel) {
  if (!sel || sel.kind === 'all') return true;
  if (sel.kind === 'none') return !(Array.isArray(t.grades) && t.grades.length);
  if (sel.kind === 'grade') return Array.isArray(t.grades) && t.grades.indexOf(sel.value) !== -1;
  if (sel.kind === 'class') return String(t.classId || '') === String(sel.value || '');
  return true;
}
// 年级清单：以「年级管理」为准，补进班级已使用但年级管理中缺失的年级，避免班级无处挂载
function gradeNamesOf() {
  const names = [];
  (gradeList || []).forEach(g => { const n = String(g || '').trim(); if (n && names.indexOf(n) === -1) names.push(n); });
  (classList || []).forEach(c => { const n = String((c && c.grade) || '').trim(); if (n && names.indexOf(n) === -1) names.push(n); });
  return names;
}
// 班级班主任：优先取教师档案（classId 关联），回退班级档案中登记的班主任姓名
function headNameOfClass(c) {
  const t = teachers.find(x => String(x.classId || '') === String(c.id));
  if (t && t.name) return String(t.name);
  return String((c && c.headTeacher) || '').trim();
}
function treeRow(o) {
  const toggle = o.hasKids
    ? '<button type="button" class="gtree-toggle' + (o.collapsed ? ' collapsed' : '') + '" data-toggle="' + escapeHtml(o.nodeId || '') + '" aria-label="展开 / 收起"></button>'
    : '<span class="gtree-toggle leaf"></span>';
  return '<div class="gtree-row' + (o.selected ? ' selected' : '') + '" data-kind="' + escapeHtml(o.kind) + '" data-value="' + escapeHtml(o.value || '') + '"'
    + (o.title ? ' title="' + escapeHtml(o.title) + '"' : '') + '>'
    + toggle + o.icon
    + '<span class="gname">' + escapeHtml(o.name) + '</span>'
    + (o.meta ? '<span class="gmeta">' + escapeHtml(o.meta) + '</span>' : '')
    + '</div>';
}
function renderGradeTree() {
  const host = $('#gradeTree');
  if (!host) return;
  const gnames = gradeNamesOf();
  const isSel = (kind, value) => treeSel.kind === kind && String(treeSel.value || '') === String(value || '');
  const rootCollapsed = gradeCollapsed.has('__root__');
  let kids = '<div class="gnode">' + treeRow({
    icon: G_ICONS.cls, name: '未指定年级', kind: 'none', value: '',
    meta: teachers.filter(t => matchTree(t, { kind: 'none' })).length + ' 人',
    selected: isSel('none', ''), title: '任教年级为空的教师'
  }) + '</div>';
  gnames.forEach(g => {
    const cls = classList.filter(c => String((c && c.grade) || '').trim() === g);
    const collapsed = gradeCollapsed.has('g:' + g);
    let node = '<div class="gnode' + (collapsed ? ' collapsed' : '') + '">' + treeRow({
      icon: G_ICONS.grade, name: g, kind: 'grade', value: g,
      meta: teachers.filter(t => matchTree(t, { kind: 'grade', value: g })).length + ' 人',
      selected: isSel('grade', g), hasKids: cls.length > 0, collapsed, nodeId: 'g:' + g,
      title: '只看任教年级包含「' + g + '」的教师'
    });
    if (cls.length) {
      node += '<div class="gchildren">' + cls.map(c => {
        const hn = headNameOfClass(c);
        return '<div class="gnode">' + treeRow({
          icon: G_ICONS.cls, name: c.name, kind: 'class', value: String(c.id),
          meta: hn || '未设班主任', selected: isSel('class', c.id),
          title: hn ? '班主任：' + hn : '该班暂未设置班主任'
        }) + '</div>';
      }).join('') + '</div>';
    }
    node += '</div>';
    kids += node;
  });
  host.innerHTML = '<div class="gnode gnode-root' + (rootCollapsed ? ' collapsed' : '') + '">'
    + treeRow({
      icon: G_ICONS.school, name: '全部教师', kind: 'all', value: '',
      meta: teachers.length + ' 人', selected: isSel('all', ''),
      hasKids: gnames.length > 0, collapsed: rootCollapsed, nodeId: '__root__', title: '显示全部教师'
    })
    + '<div class="gchildren">' + kids + '</div></div>'
    + (gnames.length ? '' : '<p class="sidebar-tip" style="margin-top:8px">暂无年级，请先在「年级管理」中添加年级。</p>');
}
function bindGradeTree() {
  const host = $('#gradeTree');
  if (!host || host.dataset.bound) return;
  host.dataset.bound = '1';
  host.addEventListener('click', (e) => {
    const tg = e.target.closest('.gtree-toggle');
    if (tg && !tg.classList.contains('leaf')) {
      const id = tg.dataset.toggle || '';
      if (gradeCollapsed.has(id)) gradeCollapsed.delete(id);
      else gradeCollapsed.add(id);
      renderGradeTree();
      return;
    }
    const row = e.target.closest('.gtree-row');
    if (!row) return;
    const kind = row.dataset.kind || 'all';
    const value = row.dataset.value || '';
    // 已选中则保持不变（避免重复刷新）；切换其它节点或点「全部教师」即恢复
    if (treeSel.kind === kind && String(treeSel.value || '') === String(value)) return;
    treeSel = { kind, value };
    renderGradeTree();
    renderTable();
  });
}
// 工具栏中的筛选提示 chip（显示当前年级 / 班级筛选与命中人数，可一键清除）
function updateTreeChip(count) {
  const chip = $('#treeChip');
  if (!chip) return;
  const txt = $('#treeChipText');
  // 未筛选时隐藏并清空文本，避免残留上一次的筛选提示
  if (treeSel.kind === 'all') { chip.hidden = true; if (txt) txt.textContent = ''; return; }
  let label = '';
  if (treeSel.kind === 'none') label = '未指定年级';
  else if (treeSel.kind === 'grade') label = '任教年级：' + treeSel.value;
  else if (treeSel.kind === 'class') {
    const c = classList.find(x => String(x.id) === String(treeSel.value));
    label = '班级：' + (c ? c.name : '—') + '（班主任）';
  }
  chip.hidden = false;
  if (txt) txt.textContent = label + ' · ' + count + ' 人';
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
  // 左侧年级树筛选（与工具栏其它条件为「且」关系）
  let list = teachers.slice().filter(t => matchTree(t, treeSel));
  if (kw) {
    list = list.filter(t =>
      (t.name || '').toLowerCase().includes(kw) ||
      (t.teacherNo || '').toLowerCase().includes(kw) ||
      (t.idCard || '').toLowerCase().includes(kw) ||
      (t.hometown || '').toLowerCase().includes(kw) ||
      (t.address || '').toLowerCase().includes(kw) ||
      (t.phone || '').toLowerCase().includes(kw) ||
      (t.position || '').toLowerCase().includes(kw) ||
      (t.department || '').toLowerCase().includes(kw) ||
      (t.className || '').toLowerCase().includes(kw) ||
      (Array.isArray(t.grades) ? t.grades.join(' ') : '').toLowerCase().includes(kw) ||
      (Array.isArray(t.subjects) ? t.subjects.map(x => (x.name || '') + ' ' + (x.grade || '')).join(' ') : '').toLowerCase().includes(kw));
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
  updateTreeChip(list.length);

  if (!list.length) {
    $('#tBody').innerHTML = '<tr><td colspan="10" class="empty-tip">'
      + (treeSel.kind === 'all'
        ? '暂无符合条件的教师，点击右上角「添加教师」开始'
        : '当前年级 / 班级下没有符合条件的教师，点击左侧「全部教师」查看全部')
      + '</td></tr>';
    return;
  }

  $('#tBody').innerHTML = list.map(t => {
    const gen = t.gender === '女' ? 'f' : 'm';
    const first = (t.name || '').trim().charAt(0) || '师';
    // 教师头像：有照片用照片，否则退回首字色块
    const avatar = (window.PhotoField && window.PhotoField.isSrc(t.photo))
      ? `<img class="teacher-avatar photo" src="${escapeHtml(t.photo)}" alt="" />`
      : `<span class="teacher-avatar ${gen}">${escapeHtml(first)}</span>`;
    // 学科所属年级已不在该教师任教年级中（如取消勾选后未同步清理）→ 标黄提示，不静默删除
    const tGrades = Array.isArray(t.grades) ? t.grades : [];
    const chips = window.teaSubjectItems(t).map(x => {
      const off = !!x.grade && tGrades.length > 0 && tGrades.indexOf(x.grade) === -1;
      const txt = x.grade ? x.name + '（' + x.grade + '）' : x.name;
      return `<span class="subj-chip${off ? ' off' : ''}"${off ? ' title="「' + escapeHtml(x.grade) + '」已不在该教师的任教年级中"' : ''}>${escapeHtml(txt)}</span>`;
    }).join('');
    const subjCell = chips ? `<div class="subj-chips">${chips}</div>` : '<span class="head-none">—</span>';
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
      ? `<span class="perm-badge${(!t.perm.modules || !t.perm.modules.length) ? ' unconf' : ''}" title="后台权限：${escapeHtml(teacherPermDesc(t))}">${escapeHtml(t.perm.matched)}</span>`
      : (matchPerm(t.department)
        ? `<span class="perm-badge" title="后台权限：${escapeHtml(teacherPermDesc(t))}">${escapeHtml(matchPerm(t.department).name)}</span>`
        : '');
    const posCell = t.position
      ? `<div>${escapeHtml(t.position)}${permBadge}</div>${sub}`
      : (sub ? `<div class="head-none">未设职务</div>${sub}` : '<span class="head-none">—</span>');
    return `<tr data-id="${escapeHtml(t.id)}">
      <td>
        <div class="teacher-cell">
          ${avatar}
          <div class="teacher-meta">
            <span class="teacher-name">${escapeHtml(t.name)}</span>
            <span class="teacher-sub">${t.teacherNo ? '工号 ' + escapeHtml(t.teacherNo) : '未编工号'}${t.idCard ? ' · ' + escapeHtml(maskIdCard(t.idCard)) : ' · 未登记身份证'}${t.hometown ? ' · ' + escapeHtml(t.hometown) : ''}</span>
          </div>
        </div>
      </td>
      <td><span class="gender-tag ${t.gender === '女' ? 'gender-female' : 'gender-male'}">${escapeHtml(t.gender)}</span></td>
      <td>${subjCell}</td>
      <td>${escapeHtml(t.title || '—')}</td>
      <td class="pos-cell">${posCell}</td>
      <td><span class="st-tag ${stCls}">${escapeHtml(st)}</span></td>
      <td class="t-phone">${escapeHtml(t.phone || '—')}</td>
      <td>${gradeCell}</td>
      <td>${headCell}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-sm more-btn" data-act="more" title="编辑 / 人事异动 / 班主任 / 删除">操作${IC_CARET}</button>
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
    renderGradeTree(); // 年级树人数随教师档案变化（新增 / 编辑 / 班主任变动后同步）
    applyTeacherDeepLink();
  } catch (e) {
    toast('加载教师失败：' + e.message, 'error');
  }
}
// 深链：人事管理「人员名单 → 查看」跳转（?teacher=id）时直接打开该教师详情
let teacherDeepLinkDone = false;
let teacherDeepLinkBack = false;   // 该详情是否由人事管理深链打开（关闭时回跳）
function applyTeacherDeepLink() {
  if (teacherDeepLinkDone) return;
  const id = new URLSearchParams(location.search).get('teacher');
  if (!id) return;
  const t = teachers.find(x => String(x.id) === String(id));
  if (!t) return;
  teacherDeepLinkDone = true;
  teacherDeepLinkBack = true;   // 关闭详情后回跳人事管理
  openModal(t);
}
// 页签已打开且地址未变时（重复查看同一人），由工作台下发指令重新执行深链
window.cbEmbedDeepLink = function () {
  teacherDeepLinkDone = false;
  applyTeacherDeepLink();
};

// 编辑弹窗：按当前填写的所属部门实时提示其后台权限（部门即权限来源）
function updatePermHint(t) {
  const box = $('#fPermHint');
  if (!box) return;
  const dept = String($('#fPosDept') ? $('#fPosDept').value : '').trim();
  if (!dept) {
    box.textContent = '未填写所属部门：该教师仅有教师端权限，不能登录管理后台。';
    return;
  }
  const hit = matchPerm(dept);
  const mods = hit ? (hit.modules || []) : [];
  if (mods.length) {
    box.innerHTML = '部门「<b>' + escapeHtml(dept) + '</b>」命中组织架构权限：<b>' + escapeHtml(permDesc(hit))
      + '</b>（含继承的上级部门）。可在「系统设置 → 组织架构权限」调整该部门的可管理模块。';
    return;
  }
  box.innerHTML = '部门「<b>' + escapeHtml(dept) + '</b>」尚未在「系统设置 → 组织架构权限」中配置：'
    + '该教师<b>仍可登录管理后台</b>（身份即部门），但没有任何可管理模块，全部模块仅可查看。'
    + '如需其管理具体模块，请在「系统设置 → 组织架构权限」为该部门勾选模块。';
}

function openModal(t) {
  $('#modalTitle').textContent = t ? '编辑教师' : '添加教师';
  $('#fId').value = t ? t.id : '';
  $('#fTeacherNo').value = t ? t.teacherNo : '';
  $('#fIdCard').value = t ? (t.idCard || '') : '';
  $('#fName').value = t ? t.name : '';
  $('#fGender').value = t ? t.gender : '男';
  if (photoField) photoField.set(t ? t.photo : '');   // 照片：编辑时回填，新增时清空
  // 任教学科：标签写作「学科（年级）」，直接取自档案的 subjects 明细
  // （服务端读取时已规范化：旧档案自动补出明细，年级留空；下拉选项由下方「任教年级」联动重建）
  const currentGrades = (t && Array.isArray(t.grades)) ? t.grades : [];
  renderSubjectChips(window.teaSubjectItems(t));
  bindSubjectSelect();
  // 职称：历史档案可能是「教务 / 宿管」等旧值，下拉里没有则临时补一个选项，避免误清空
  setSelectValue('#fTitle', t ? t.title : '');
  // 行政职位：按该职位所属部门预置级联，再回填职位（保留历史值）；无职位时沿用档案已存的所属部门
  const posDept = (t && t.position)
    ? posDeptName((posCache || []).find(p => p.name === t.position))
    : (t ? (t.department || '') : '');
  const pd = document.getElementById('fPosDept');
  if (pd) pd.value = posDept || '';
  const posSel = document.getElementById('fPosition');
  if (posSel) posSel.value = '';
  refreshPositionList(posDept, { keep: t ? t.position : '', keepLegacy: true });
  updatePermHint(t);
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
  // 任教年级复选框组（勾选后联动重建上方任教学科下拉）
  renderGradeChecks(currentGrades);
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fName').focus(), 100);
}
function closeModal() {
  $('#modalMask').classList.remove('show');
  // 由人事管理「查看」深链打开的详情：关闭后回到人事管理（页签已开则直接切回）
  if (teacherDeepLinkBack) {
    teacherDeepLinkBack = false;
    if (typeof window.goPage === 'function') window.goPage('/hr.html');
    else location.href = '/hr.html';
  }
}

async function saveTeacher(e) {
  e.preventDefault();
  const id = $('#fId').value;
  // 收集任教年级（勾选的复选框 value）
  const checkedGrades = selectedGrades();
  // 所属部门随行政职位联动：优先取级联中选中的部门，其次取该职位在组织架构登记的部门，最后保留档案原值
  const posDeptVal = String(($('#fPosDept') || {}).value || '').trim();
  const posVal = String(($('#fPosition') || {}).value || '').trim();
  const posHit = posVal ? (posCache || []).find(p => p.name === posVal) : null;
  const oldTea = teachers.find(x => x.id === id);
  const data = {
    teacherNo: $('#fTeacherNo').value.trim(),
    idCard: $('#fIdCard').value.trim(),
    photo: photoField ? photoField.get() : '',   // 教师照片（弹窗内上传 / 拍照后的 data:image；空串表示移除）
    name: $('#fName').value.trim(),
    gender: $('#fGender').value,
    subject: getSubjectChips().join('、'),
    subjects: getSubjectItems(),   // 学科 + 任教年级明细（列表与编辑回填按「学科（年级）」展示）
    title: $('#fTitle').value,
    position: $('#fPosition').value.trim(),
    department: posDeptVal || posDeptName(posHit) || (oldTea && oldTea.department) || '',
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

// 人事异动：所属部门变化 → 后台权限变化预警（需勾选确认 + 二次确认）
function hrWritesDept(type) {
  return ['调岗', '晋升', '入职', '转正', '借调', '其他'].indexOf(type) !== -1;
}
function updateHrPermWarn(t) {
  const warn = $('#hPermWarn');
  const ackBox = $('#hPermAckBox');
  const ack = $('#hPermAck');
  if (!warn || !ackBox) return;
  const type = $('#hType').value;
  const dept = String($('#hDept').value || '').trim();
  if (!t || !hrWritesDept(type) || !dept) {
    warn.hidden = true;
    ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  const before = teacherPermDesc(t);
  const hit = matchPerm(dept);
  const now = hit ? permDesc(hit) : UNCONFIGURED_PERM;
  if (before === now) {
    warn.hidden = true;
    ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  warn.hidden = false;
  warn.innerHTML = '该异动会把「<b>' + escapeHtml(t.name) + '</b>」的所属部门改为「<b>' + escapeHtml(dept)
    + '</b>」，其后台权限将由 <b>' + escapeHtml(before) + '</b> 变为 <b>' + escapeHtml(now)
    + '</b>。请确认这是本次调岗 / 借调的真实授权意图。';
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
    const hit = matchPerm(data.department);
    const now = hit ? permDesc(hit) : (data.department ? UNCONFIGURED_PERM : '无后台权限（仅教师端）');
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

/* ===== 行操作下拉菜单：操作 ▾ → 编辑 / 人事异动 / 班主任 / 删除 ===== */
// 菜单容器与定位由 /js/rowmenu.js（教师管理、后勤管理共用）负责，这里只定义菜单项与后续动作
let ctxAnchor = null; // 最近一次打开菜单的触发按钮，二级菜单（班级列表）沿用其位置

function closeCtxMenu() {
  if (window.RowMenu) window.RowMenu.close();
}

// 一级菜单：编辑 / 人事异动 / 班主任（进入班级列表）/ 删除
function openActionMenu(t, anchor) {
  if (!window.RowMenu) return;
  ctxAnchor = anchor;
  const isHead = !!t.classId;
  window.RowMenu.open(anchor, {
    caption: '操作 · ' + (t.name || ''),
    tail: [
      { kind: 'edit', label: '编辑教师', icon: IC_EDIT },
      { kind: 'hr', label: '登记人事异动', icon: IC_HR },
      {
        kind: 'head',
        label: isHead ? '改任班主任（当前：' + (t.className || '已设班级') + '）' : '设为班主任',
        icon: IC_HEAD
      },
      { kind: 'del', label: '删除教师', icon: IC_TRASH, danger: true }
    ],
    onPick: (ds) => ctxPick(t, ds.kind, ds)
  });
}

// 二级菜单：选择班级（设为 / 改任班主任），已任班主任时附带「解除」
// 只列出该教师「任教年级」下的班级，避免把班主任派到未任教的年级
function openHeadMenu(t, anchor) {
  if (!window.RowMenu) return;
  if (!classList.length) { toast('暂无班级，请先在「班级管理」中添加班级', 'error'); return; }
  const grades = (Array.isArray(t.grades) ? t.grades : []).map(g => String(g || '').trim()).filter(Boolean);
  const scoped = grades.length
    ? classList.filter(c => grades.indexOf(String((c && c.grade) || '').trim()) !== -1)
    : classList.slice();
  // 任教年级已设置却查不到班级：多半是该年级尚未建班，提示而非给出全校列表
  if (grades.length && !scoped.length) {
    toast('「' + grades.join('、') + '」下暂无班级，请先在「班级管理」中添加', 'error');
    return;
  }
  ctxAnchor = anchor;
  const classRows = scoped.map(c => {
    const isCur = c.id === t.classId;
    const other = !isCur && c.headTeacher && c.headTeacher !== t.name ? c.headTeacher : '';
    const grade = String((c && c.grade) || '').trim();
    return {
      kind: 'class',
      label: grade ? grade + ' · ' + c.name : c.name,
      icon: isCur ? IC_CHECK : IC_UNCHECK,
      hint: isCur ? '担任中' : (other ? '现：' + other : ''),
      cur: isCur,
      disabled: isCur, // 当前班级即已担任，无需重复设置
      data: { cid: c.id, cname: c.name, other: other }
    };
  });
  const scopeText = grades.length ? grades.join('、') : '全部班级（未设置任教年级）';
  const head = t.classId
    ? [{ kind: 'cancel', label: '解除班主任（当前：' + (t.className || '已设班级') + '）', icon: IC_USER_MINUS, danger: true }]
    : [];
  window.RowMenu.open(anchor, {
    caption: (t.classId ? '改任班主任' : '设为班主任') + ' · ' + scopeText,
    captionIcon: IC_HEAD,
    head,
    list: classRows,
    onPick: (ds) => ctxPick(t, ds.kind, ds)
  });
}

async function ctxPick(t, kind, ds) {
  if (kind === 'head') { openHeadMenu(t, ctxAnchor); return; }
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
    const cid = ds.cid;
    const cname = ds.cname || '';
    const other = ds.other || '';
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
  // 教师照片：上传 / 摄像头拍照（公共模块 /js/photo.js，学生档案、后勤职工共用同一套交互）
  if (window.PhotoField) {
    photoField = window.PhotoField.create({
      preview: '#fPhotoPreview', pick: '#fPhotoPick', cam: '#fPhotoCam',
      clear: '#fPhotoClear', input: '#fPhotoInput'
    });
  }
  $('#searchInput').oninput = renderTable;
  $('#genderFilter').onchange = renderTable;
  $('#statusFilter').onchange = renderTable;
  $('#posFilter').onchange = renderTable;
  $('#headFilter').onchange = renderTable;
  // 左侧年级树：点击节点筛选教师；chip 上的 × 与侧栏「全部教师」按钮清除筛选
  bindGradeTree();
  const clearTree = () => {
    if (treeSel.kind === 'all') return;
    treeSel = { kind: 'all', value: '' };
    renderGradeTree();
    renderTable();
  };
  if ($('#btnTreeAll')) $('#btnTreeAll').onclick = clearTree;
  if ($('#treeChipClear')) $('#treeChipClear').onclick = clearTree;
  // 人事异动弹窗
  $('#hrClose').onclick = closeHrModal;
  $('#hrCancel').onclick = closeHrModal;
  $('#hrForm').onsubmit = saveHr;
  // 职务即权限：填写时实时提示命中的后台权限 / 权限变更预警；
  // 同时反向校正所属部门，保证「所属部门 ↔ 行政职位」始终一致
  $('#fPosition').addEventListener('change', () => {
    syncDeptFromPosition();
    updatePermHint(teachers.find(x => x.id === $('#fId').value));
  });
  // 行政职位「部门」级联：切换部门收窄职位选项（旧职位不属于新部门时清空），并刷新权限提示
  const posDeptEl = document.getElementById('fPosDept');
  if (posDeptEl) posDeptEl.addEventListener('change', () => {
    refreshPositionList(posDeptEl.value);
    updatePermHint(teachers.find(x => x.id === $('#fId').value));
  });
  // 任教年级勾选变化 → 联动重建「任教学科」下拉（取所选年级课程计划的并集）
  const gradeBox = document.getElementById('fGrades');
  if (gradeBox) gradeBox.addEventListener('change', (e) => {
    if (e.target && e.target.type === 'checkbox') refreshSubjectOptions();
  });
  const hrWatch = () => updateHrPermWarn(teachers.find(x => x.id === $('#hTeacher').value));
  $('#hDept').addEventListener('input', hrWatch);
  $('#hDept').addEventListener('change', hrWatch);
  $('#hType').addEventListener('change', hrWatch);
  $('#hTeacher').addEventListener('change', hrWatch);

  // 「操作 ▾」下拉菜单：点击行内按钮打开（菜单项点击、外部点击、Esc、滚动关闭由 rowmenu.js 统一处理）
  $('#tBody').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const t = teachers.find(x => x.id === tr.dataset.id);
    if (!t) return;
    if (btn.dataset.act === 'more') openActionMenu(t, btn);
  };

  window.addEventListener('cb-site-ready', () => {
    refreshSubjectOptions(); // 科目（课程计划）变化后重建任教学科下拉
    loadTeachers();
  });
}

window.cbEmbedRefresh = function () { loadClasses().then(loadGrades).then(loadCoursePlans).then(loadTeachers); };

loadPerms()
  .then(loadDept)
  .then(loadPositions)
  .then(() => { fillPosDeptSelect(); refreshPositionList($('#fPosDept') ? $('#fPosDept').value : ''); })
  .then(loadClasses)
  .then(() => loadGrades())
  .then(loadCoursePlans)
  .then(() => {
    bindEvents();
    loadTeachers();
  });
