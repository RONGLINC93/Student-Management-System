// 学生信息管理 - 主界面逻辑（动态科目 + 学籍档案）
const API = '/api/students';
const ALL_STUDENTS_API = '/api/all-students';
const GRADES_API = '/api/grades';
const FILTERS_API = '/api/filters';
const DORMS_API = '/api/dorms';
const CLASSES_API = '/api/classes';
let students = [];
let allStudents = []; // 包含已分班的所有学生
let gradesList = [];
let savedFilters = {}; // 保存的筛选设置
let lastSubjectSeq = -1;

// 宿舍状态：dorms 缓存房间列表；学生行通过 _roomId/_dormTxt 标注入住信息
let dorms = [];
// 安排入班 / 转班弹窗状态
let assignTarget = null;           // 正在设置班级的学生
let assignCurrentClassId = '';     // 该生当前所在班级 id（'' = 未分班）
let assignClassList = [];          // 可选的班级列表（弹窗打开时拉取）
// 宿舍弹窗状态
let dormTarget = null;   // 正在操作的学生
let dormCurrentId = '';  // 该生当前所在房间 id（'' = 未入住）
let dormSelectedId = ''; // 弹窗中选中的房间 id
let stuIndex = {};       // 学生 id -> 学生对象（床位点阵着色用）

// 分页设置
let pageSize = 10;
let currentPage = 1;

// 排序状态（点击表头设置）
let sortKey = 'studentId';
let sortDir = 1;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// 学籍档案扩展字段 id -> 档案 key
const ARCH_FIELDS = [
  ['fArchNo', 'archNo'], ['fIdCard', 'idCard'], ['fBirthday', 'birthday'], ['fNation', 'nation'],
  ['fNativePlace', 'nativePlace'], ['fAddress', 'address'], ['fGuardian', 'guardian'],
  ['fGuardianPhone', 'guardianPhone'], ['fGuardianRel', 'guardianRel'],
  ['fEnrollDate', 'enrollDate'], ['fRemark', 'remark']
];
const ARCH_COL_NAMES = {
  archNo: ['学籍号'], idCard: ['身份证号'], birthday: ['出生日期'], nation: ['民族'],
  nativePlace: ['户籍所在地'], address: ['家庭住址'], guardian: ['监护人'],
  guardianPhone: ['监护人电话'], guardianRel: ['与监护人关系'], enrollDate: ['入学日期'], remark: ['备注']
};

// 表单成绩输入构造（科目动态）
function rebuildScoreGrid() {
  const grid = $('#scoreGrid');
  if (!grid) return;
  grid.innerHTML = '';
  (window.SUBJECTS || []).forEach(sj => {
    const row = document.createElement('div');
    row.className = 'form-row';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = sj.name;
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'fScore_' + sj.key;
    input.min = '0';
    input.max = String(sj.max || 150);
    input.value = '0';
    row.appendChild(label);
    row.appendChild(input);
    grid.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// 注意：不要声明名为 stuScore 的全局函数，否则会覆盖 site.js 写入 window.stuScore 的成绩读取函数（自递归崩溃）
function stuScoreOf(s, key) { return window.stuScore(s, key); }
function totalOf(s) {
  const r = window.subjTotal(s);
  return r.total;
}
function totalOfStu(s) { return totalOf(s); }

// ===== 宿舍标注：把 dorms 里的入住关系映射到学生行 =====
function annotateDorms() {
  const map = {};
  dorms.forEach(r => (r.students || []).forEach(id => {
    if (!map[String(id)]) map[String(id)] = r;
  }));
  stuIndex = {};
  allStudents.forEach(s => { stuIndex[String(s.id)] = s; });
  allStudents.forEach(s => {
    const r = map[String(s.id)];
    if (r) {
      s._roomId = r.id;
      s._dormTxt = (String(r.building) + ' ' + String(r.roomNo)).trim();
    } else {
      s._roomId = '';
      s._dormTxt = '';
    }
  });
}
function dormTextOf(s) { return s._dormTxt || ''; }
function dormRoomOfStudent(stu) {
  return dorms.find(r => (r.students || []).some(id => String(id) === String(stu.id))) || null;
}

// 房间房态等级（与宿舍管理页配色一致：空房绿 / 部分橙 / 满房紫）
function dormStateKey(room) {
  const o = (room.students || []).length;
  const c = Number(room.capacity) || 1;
  if (o <= 0) return 'empty';
  if (o >= c) return 'full';
  return 'part';
}
const DORM_STATE_LBL = { empty: '空房', part: '部分入住', full: '满房' };

// 床位小床图标（颜色由外层 .bed-dots i 的 color 决定）
const DORM_BED_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>';

// 床位点阵 HTML：房间入住顺序即床位号，meId 命中时高亮该床位
function dormBedsHtml(room, meId, size) {
  const cap = Number(room.capacity) || 1;
  const list = room.students || [];
  const dots = [];
  for (let i = 0; i < cap; i++) {
    const sid = list[i];
    const stu = sid !== undefined ? stuIndex[String(sid)] : null;
    let cls = '';
    if (sid !== undefined) {
      if (stu) cls = 'on on-' + (stu.gender === '男' ? 'male' : 'female');
      else cls = 'on on-u';
      if (meId !== undefined && String(sid) === String(meId)) cls += ' me';
    }
    dots.push(`<i class="${cls}">${DORM_BED_SVG}</i>`);
  }
  return `<span class="bed-dots ${size === 'mini' ? 'mini' : ''}">${dots.join('')}</span>`;
}

// 宿舍列表格单元：入住 → 房态小卡；未入住 → 「＋ 分配宿舍」
function dormCellHtml(s) {
  if (!s._roomId) {
    return '<button class="dorm-chip dorm-empty" data-act="dorm" title="点击分配宿舍">＋ 分配宿舍</button>';
  }
  const r = dorms.find(x => String(x.id) === String(s._roomId));
  if (!r) return '<span class="dim-text">—</span>';
  const sk = dormStateKey(r);
  const occC = (r.students || []).length;
  const cap = Number(r.capacity) || 1;
  const free = Math.max(0, cap - occC);
  const freeLine = sk === 'full' ? '<span class="dm-fulltxt">满房</span>' : `<span class="dm-free">空 ${free} 床</span>`;
  return `<div class="dorm-mini dm-${sk}" data-act="dorm-view" title="${escapeHtml(s._dormTxt)}（${DORM_STATE_LBL[sk]}），点击查看该房间房态">
    <div class="dm-head">
      <span class="dm-bld">${escapeHtml(String(r.building))}</span><b class="dm-no">${escapeHtml(String(r.roomNo))}</b>
      <span class="dm-st"><i></i>${DORM_STATE_LBL[sk]}</span>
    </div>
    ${dormBedsHtml(r, s.id, 'mini')}
    <div class="dm-foot">${freeLine}
      <button type="button" class="dm-act" data-act="dorm" title="为「${escapeHtml(s.name)}」更换宿舍">换宿</button>
    </div>
  </div>`;
}

// 判断当前是否嵌在工作台（index.html 的 iframe）内
function isEmbedded() {
  try { return window.self !== window.top; } catch (e) { return true; }
}

// 跳转到宿舍管理：工作台内切选项卡；独立打开页面时进入工作台并定位宿舍选项卡
function openDormTab() {
  if (isEmbedded() && typeof goPage === 'function') goPage('/dorm.html');
  else location.href = '/index.html?mod=dorm';
}

// 跳转到宿舍管理页并自动打开对应房间详情（工作台内=切选项卡，独立页=进工作台深链）
function openRoomPage(roomId, focusId) {
  let qs = 'room=' + encodeURIComponent(roomId);
  if (focusId) qs += '&focus=' + encodeURIComponent(focusId);
  if (isEmbedded() && typeof goPage === 'function') goPage('/dorm.html?' + qs);
  else location.href = '/index.html?mod=dorm&' + qs;
}

window.__phErr = function (img) {
  const sp = document.createElement('span');
  sp.textContent = img.dataset.ini || '?';
  img.replaceWith(sp);
};
function photoHtml(s) {
  const ini = escapeHtml((s.name || '?').slice(0, 1));
  if (s.photo) return `<img src="${escapeHtml(s.photo)}" data-ini="${ini}" alt="" onerror="window.__phErr(this)" />`;
  return ini;
}

// ===== 列定义 + 列显隐（表头 / 行 / 列设置共用一份配置） =====
const COLS_STORE_KEY = 'sms_students_visible_cols_v1';
// 「精简视图」保留的列（不含各科成绩与特长）
const CORE_KEYS = ['photo', 'studentId', 'grade', 'className', 'name', 'gender', 'total', 'allocated', 'dorm', 'actions'];

function columnDefs() {
  const subs = (window.SUBJECTS || []).map(sj => ({ key: 'score:' + sj.key, label: sj.name, sortable: true }));
  return [
    { key: 'photo', label: '照片', fixed: 58 },
    { key: 'studentId', label: '学号', sortable: true },
    { key: 'grade', label: '年级', sortable: true },
    { key: 'className', label: '班级', sortable: true },
    { key: 'name', label: '姓名', sortable: true },
    { key: 'gender', label: '性别', sortable: true },
    ...subs,
    { key: 'total', label: '总分', sortable: true },
    { key: 'specialty', label: '特长', sortable: true },
    { key: 'allocated', label: '分班状态', sortable: true },
    { key: 'dorm', label: '宿舍', fixed: 200 },
    { key: 'actions', label: '操作', fixed: 96 }
  ];
}

function loadColFlags() {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_STORE_KEY) || 'null');
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}
function saveColFlags(f) {
  try { localStorage.setItem(COLS_STORE_KEY, JSON.stringify(f)); } catch (e) {}
}
function colVisible(key, flags) {
  if (key === 'name') return true; // 姓名列锁定，保证列表始终可辨识
  return (flags || {})[key] !== false;
}
function visibleColumns() {
  const f = loadColFlags();
  return columnDefs().filter(c => colVisible(c.key, f));
}
function setColVisible(key, on) {
  const f = loadColFlags();
  f[key] = !!on;
  saveColFlags(f);
}
function applyCoreCols() {
  const f = {};
  columnDefs().forEach(c => { if (c.key !== 'name') f[c.key] = CORE_KEYS.includes(c.key); });
  saveColFlags(f);
}
function resetColFlags() {
  try { localStorage.removeItem(COLS_STORE_KEY); } catch (e) {}
}

// 勾选/恢复列后刷新列表视图
function refreshListView() {
  const cur = columnDefs().find(c => c.key === sortKey);
  if (cur && cur.sortable && !colVisible(sortKey, loadColFlags())) sortKey = 'studentId';
  renderHeader();
  renderTable();
}

// ===== 动态表头 =====
function renderHeader() {
  const thead = $('#stuThead');
  if (!thead) return;
  const cols = visibleColumns();
  let html = '<tr>';
  cols.forEach(c => {
    const label = escapeHtml(c.label);
    if (c.sortable) {
      html += `<th class="sortable" data-sort="${escapeHtml(c.key)}">${label}</th>`;
    } else if (c.fixed) {
      html += `<th style="width:${c.fixed}px">${label}</th>`;
    } else {
      html += `<th>${label}</th>`;
    }
  });
  html += '</tr>';
  thead.innerHTML = html;
  updateSortHeader();
}
function colSpanCount() {
  return Math.max(1, visibleColumns().length);
}

// 数字列判断
function isNumericSort(key) {
  if (key === 'total' || key === 'allocated') return true;
  if (key.startsWith('score:')) return true;
  return false;
}
function sortValue(s, key) {
  if (key === 'total') return totalOfStu(s);
  if (key === 'allocated') return s.allocated ? 1 : 0;
  if (key.startsWith('score:')) return stuScoreOf(s, key.slice(6));
  return s[key] == null ? '' : String(s[key]);
}
function compareSort(a, b) {
  const av = sortValue(a, sortKey);
  const bv = sortValue(b, sortKey);
  let r;
  if (isNumericSort(sortKey)) {
    const an = av === null ? Number.NEGATIVE_INFINITY : Number(av);
    const bn = bv === null ? Number.NEGATIVE_INFINITY : Number(bv);
    r = (an || 0) - (bn || 0);
  } else {
    if (av === '' && bv === '') r = 0;
    else if (av === '') r = 1;
    else if (bv === '') r = -1;
    else r = av.localeCompare(bv, 'zh-Hans-CN', { numeric: true });
  }
  return r * sortDir;
}

// 加载年级选项到下拉框
async function loadGradeOptions() {
  try {
    const res = await fetch(GRADES_API);
    const json = await res.json();
    gradesList = json.data || [];

    const filterSel = $('#gradeFilter');
    if (filterSel) {
      const curVal = filterSel.value;
      filterSel.innerHTML = '<option value="">全部年级</option>';
      gradesList.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        filterSel.appendChild(opt);
      });
      filterSel.value = curVal;
    }

    const formSel = $('#fGrade');
    if (formSel) {
      const curVal = formSel.value;
      formSel.innerHTML = '';
      gradesList.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        formSel.appendChild(opt);
      });
      formSel.value = curVal && gradesList.includes(curVal) ? curVal : (gradesList[0] || '');
    }
  } catch (e) {
    console.error('加载年级失败:', e);
  }
}

let _filterTimer = null;
// 搜索框逐字输入会高频触发，合并为一次保存，避免请求风暴
function saveFilters() {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(doSaveFilters, 300);
}
async function doSaveFilters() {
  try {
    const filters = {
      'students:grade': $('#gradeFilter')?.value || '',
      'students:status': $('#statusFilter')?.value || '',
      'students:dorm': $('#dormFilter')?.value || '',
      'students:search': $('#searchInput')?.value || '',
      'students:pageSize': String(pageSize)
    };
    await fetch(FILTERS_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters)
    });
  } catch (e) {
    console.error('保存筛选失败:', e);
  }
}

async function loadFilters() {
  try {
    const res = await fetch(FILTERS_API);
    const json = await res.json();
    savedFilters = json.data || {};

    const gradeFilter = $('#gradeFilter');
    if (gradeFilter && savedFilters['students:grade']) gradeFilter.value = savedFilters['students:grade'];
    const statusFilter = $('#statusFilter');
    if (statusFilter && savedFilters['students:status']) statusFilter.value = savedFilters['students:status'];
    const dormFilter = $('#dormFilter');
    if (dormFilter && savedFilters['students:dorm']) dormFilter.value = savedFilters['students:dorm'];
    const searchInput = $('#searchInput');
    if (searchInput && savedFilters['students:search']) searchInput.value = savedFilters['students:search'];
    const savedPageSize = Number(savedFilters['students:pageSize']);
    if ([10, 20, 50, 100].includes(savedPageSize)) pageSize = savedPageSize;
  } catch (e) {
    console.error('加载筛选失败:', e);
  }
}

function renderTable() {
  const kw = ($('#searchInput').value || '').trim().toLowerCase();
  const tbody = $('#studentTbody');
  const pagination = $('#pagination');
  let list = allStudents.slice();
  if (kw) {
    list = list.filter(s =>
      (s.name || '').toLowerCase().includes(kw) ||
      (s.studentId || '').toLowerCase().includes(kw) ||
      (s.specialty || '').toLowerCase().includes(kw) ||
      (s.archNo || '').toLowerCase().includes(kw) ||
      (s.idCard || '').toLowerCase().includes(kw) ||
      (s.guardian || '').toLowerCase().includes(kw) ||
      (s.guardianPhone || '').toLowerCase().includes(kw) ||
      dormTextOf(s).toLowerCase().includes(kw)
    );
  }
  const gradeFilter = $('#gradeFilter')?.value || '';
  if (gradeFilter) list = list.filter(s => s.grade === gradeFilter);
  const statusFilter = $('#statusFilter')?.value || '';
  if (statusFilter === 'allocated') list = list.filter(s => s.allocated === true);
  else if (statusFilter === 'unallocated') list = list.filter(s => s.allocated === false);
  const dormFilter = $('#dormFilter')?.value || '';
  if (dormFilter === 'in') list = list.filter(s => !!s._roomId);
  else if (dormFilter === 'out') list = list.filter(s => !s._roomId);

  if (sortKey) list.sort(compareSort);
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpanCount()}" class="empty-tip">暂无学生数据，点击右上角「添加学生」开始</td></tr>`;
    pagination.innerHTML = '';
    updateStats();
    return;
  }

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * pageSize;
  const pageList = list.slice(start, start + pageSize);

  const cols = visibleColumns();
  tbody.innerHTML = pageList.map(s => {
    const cells = cols.map(c => studentCellHtml(s, c)).join('');
    return `<tr data-id="${escapeHtml(s.id)}">${cells}</tr>`;
  }).join('');
  pagination.innerHTML = renderPaginationHtml(total, totalPages);
  updateStats();
}

// ===== 学生行单元格渲染（列顺序与可见性由 visibleColumns 统一驱动） =====
const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_EDIT = `<svg ${SVG_ATTRS}><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;
const ICON_SWAP = `<svg ${SVG_ATTRS}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
const ICON_ASSIGN = `<svg ${SVG_ATTRS}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;
const ICON_KEY = `<svg ${SVG_ATTRS}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
const ICON_TRASH = `<svg ${SVG_ATTRS}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const ICON_MORE = `<svg ${SVG_ATTRS}><circle cx="12" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.7" fill="currentColor" stroke="none"/></svg>`;

// 操作列：单颗「⋯」按钮，点击展开该行操作菜单
function rowActionsHtml() {
  return `<button type="button" class="act-more" data-act="rowmenu" aria-label="更多操作" title="更多操作">${ICON_MORE}</button>`;
}

// 行操作菜单：悬停在页面层，避免被表格横向滚动容器裁剪
function renderRowMenuItems(s) {
  const alloc = !!s.allocated;
  const assignTxt = alloc ? '转班到其他班级' : '安排入班';
  const delBlock = alloc ? '' :
    `<div class="menu-sep"></div>
     <button type="button" class="row-menu-item danger" data-mact="del"><span class="menu-ico">${ICON_TRASH}</span>删除该生</button>`;
  return `
    <button type="button" class="row-menu-item" data-mact="edit"><span class="menu-ico">${ICON_EDIT}</span>编辑档案</button>
    <button type="button" class="row-menu-item" data-mact="assign"><span class="menu-ico">${alloc ? ICON_SWAP : ICON_ASSIGN}</span>${assignTxt}</button>
    <button type="button" class="row-menu-item" data-mact="resetpwd"><span class="menu-ico">${ICON_KEY}</span>重置登录密码</button>
    <button type="button" class="row-menu-item" data-mact="enroll"><span class="menu-ico">${ICON_EDIT}</span>学籍异动…</button>
    ${delBlock}`;
}

// 按列渲染单元格（与表头严格同序）
function studentCellHtml(s, col) {
  const k = col.key;
  if (k === 'photo') return `<td><div class="avatar">${photoHtml(s)}</div></td>`;
  if (k === 'studentId') return `<td class="stu-id">${escapeHtml(s.studentId || '—')}</td>`;
  if (k === 'grade') return `<td><span class="grade-text">${escapeHtml(s.grade || '—')}</span></td>`;
  if (k === 'className') return `<td>${s.className ? `<span class="class-chip">${escapeHtml(s.className)}</span>` : '<span class="empty-cell">—</span>'}</td>`;
  if (k === 'name') {
    const st = s.status && s.status !== 'active' ? s.status : '';
    return `<td><strong class="stu-name">${escapeHtml(s.name)}</strong>${st ? enrollChipHtml(st) : ''}</td>`;
  }
  if (k === 'gender') return `<td><span class="gender-tag ${s.gender === '男' ? 'gender-male' : 'gender-female'}">${escapeHtml(s.gender || '—')}</span></td>`;
  if (k.startsWith('score:')) {
    const v = stuScoreOf(s, k.slice(6));
    return `<td class="score">${v === null ? '<span class="no-score">—</span>' : v}</td>`;
  }
  if (k === 'total') return `<td class="total-score">${totalOfStu(s)}</td>`;
  if (k === 'specialty') {
    const sp = (s.specialty || '').trim();
    return sp ? `<td><span class="specialty-tag" title="${escapeHtml(sp)}">${escapeHtml(sp)}</span></td>` : '<td><span class="empty-cell">—</span></td>';
  }
  if (k === 'allocated') {
    return `<td><span class="status-tag ${s.allocated ? 'status-allocated' : 'status-unallocated'}"><i></i>${s.allocated ? '已分班' : '未分班'}</span></td>`;
  }
  if (k === 'dorm') return `<td class="dorm-cell">${dormCellHtml(s)}</td>`;
  if (k === 'actions') return `<td><div class="row-actions">${rowActionsHtml(s)}</div></td>`;
  return '<td>—</td>';
}

function renderPaginationHtml(total, totalPages) {
  const btn = (p, label, cls = '', disabled = false) =>
    `<button class="page-btn ${cls}" data-page="${p}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages <= 7 || i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }
  return `
    <div class="page-left">
      <span class="page-info">共 ${total} 条</span>
      <select id="pageSizeSel" class="page-size-select" title="每页条数">
        ${[10, 20, 50, 100].map(n => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n} 条/页</option>`).join('')}
      </select>
      <span class="page-info">第 ${currentPage}/${totalPages} 页</span>
    </div>
    <div class="page-btns">
      ${btn(currentPage - 1, '‹', 'page-nav', currentPage === 1)}
      ${pages.map(p => p === '...' ? '<span class="page-ellipsis">…</span>' : btn(p, p, p === currentPage ? 'active' : '')).join('')}
      ${btn(currentPage + 1, '›', 'page-nav', currentPage === totalPages)}
    </div>`;
}

function updateSortHeader() {
  const ths = document.querySelectorAll('.student-table thead th.sortable');
  ths.forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (sortKey && th.dataset.sort === sortKey) {
      th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function updateStats() {
  $('#statTotal').textContent = allStudents.length;
  $('#statMale').textContent = allStudents.filter(s => s.gender === '男').length;
  $('#statFemale').textContent = allStudents.filter(s => s.gender === '女').length;
  if (!allStudents.length) {
    $('#statAvg').textContent = '0';
  } else {
    const sum = allStudents.reduce((a, s) => a + totalOfStu(s), 0);
    $('#statAvg').textContent = (sum / allStudents.length).toFixed(1);
  }
}

async function loadStudents() {
  try {
    const [sRes, dRes] = await Promise.all([
      fetch(ALL_STUDENTS_API),
      fetch(DORMS_API)
    ]);
    const sj = await sRes.json();
    const dj = await dRes.json();
    allStudents = sj.data || [];
    students = allStudents.filter(s => !s.allocated);
    dorms = dj.data || [];
    annotateDorms();
    renderTable();
  } catch (e) {
    toast('加载失败：' + e.message, 'error');
  }
}

// ===== 弹窗 =====
function openModal(stu) {
  const inClass = !!(stu && stu.allocated);
  $('#modalTitle').textContent = inClass ? '编辑学生（班级名单）' : (stu ? '编辑学生' : '添加学生');
  $('#fId').value = stu ? stu.id : '';
  $('#fStudentId').value = stu ? stu.studentId : '';
  $('#fGrade').value = stu ? stu.grade : (gradesList[0] || '');
  $('#fGrade').disabled = inClass;
  $('#fGrade').title = inClass ? '已分班学生的年级由所属班级决定，如需调整请先退回未分班' : '';
  $('#fPhoto').value = stu ? stu.photo : '';
  $('#fName').value = stu ? stu.name : '';
  $('#fGender').value = stu ? stu.gender : '男';
  // 科目动态输入
  rebuildScoreGrid();
  (window.SUBJECTS || []).forEach(sj => {
    const el = $('#fScore_' + sj.key);
    if (!el) return;
    const v = stu ? stuScoreOf(stu, sj.key) : null;
    el.value = v === null ? '' : v;
  });
  // 档案扩展字段
  ARCH_FIELDS.forEach(([fid]) => {
    const el = $('#' + fid);
    if (!el) return;
    const key = ARCH_FIELDS.find(x => x[0] === fid)[1];
    el.value = stu ? (stu[key] || '') : '';
  });
  $('#fSpecialty').value = stu ? stu.specialty : '';
  renderStuDormBox();
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fStudentId').focus(), 100);
}

function closeModal() {
  $('#fGrade').disabled = false;
  $('#modalMask').classList.remove('show');
}

async function saveStudent(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const cur = id ? (allStudents.find(s => s.id === id) || null) : null;
  const inClass = !!(cur && cur.allocated);
  const scores = {};
  (window.SUBJECTS || []).forEach(sj => {
    const el = $('#fScore_' + sj.key);
    const v = el ? el.value.trim() : '';
    if (v !== '') scores[sj.key] = Number(v);
  });
  const data = {
    studentId: $('#fStudentId').value.trim(),
    photo: $('#fPhoto').value.trim(),
    name: $('#fName').value.trim(),
    gender: $('#fGender').value,
    scores,
    specialty: $('#fSpecialty').value.trim()
  };
  ARCH_FIELDS.forEach(([fid, key]) => {
    const el = $('#' + fid);
    if (el) data[key] = el.value.trim();
  });
  if (!inClass) data.grade = $('#fGrade').value;
  if (!data.studentId) { toast('请输入学号', 'error'); return; }
  if (!data.name) { toast('请输入姓名', 'error'); return; }
  const done = busyBtn(e && e.submitter ? e.submitter : $('#stuForm') && $('#stuForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
  try {
    const url = inClass
      ? `/api/classes/${encodeURIComponent(cur.classId)}/students/${encodeURIComponent(id)}`
      : (id ? `${API}/${id}` : API);
    const res = await fetch(url, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return; }
    toast(id ? '保存成功' : '添加成功', 'success');
    closeModal();
    await loadStudents();
  } catch (err) {
    toast('保存失败：' + err.message, 'error');
  } finally {
    done();
  }
}

async function deleteStudent(id) {
  if (!(await confirmDlg('删除后将移入「回收站」可恢复（已入住宿舍会自动退宿）。确定删除？', { title: '删除学生', okText: '删除', danger: true }))) return;
  try {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (json.code !== 0) throw new Error(json.msg || '删除失败');
    toast(json.msg || '已移入回收站', 'success');
    await loadStudents();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

// 重置学生登录密码：恢复为学号初始密码并进入强制改密（需管理员权限，服务端校验）
async function resetStudentPassword(id, stu) {
  const name = stu ? (stu.name || stu.studentId || id) : id;
  const noTxt = stu && stu.studentId ? `（${stu.studentId}）` : '';
  if (!(await confirmDlg(
    `确定将「${name}」${noTxt}的登录密码重置为学号？\n重置后该生下次登录需使用学号作为密码，并重新设置个人密码。`,
    { title: '重置密码', okText: '重置' }
  ))) return;
  try {
    const res = await fetch(`${API}/${id}/password-reset`, { method: 'PUT' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.code !== 0) throw new Error(json.msg || '重置失败，请重试');
    toast(json.msg || '已重置为学号初始密码', 'success');
  } catch (e) {
    toast('重置失败：' + e.message, 'error');
  }
}

// ===== 手动安排入班 / 转班 =====
function assignInfoHtml(stu) {
  const curTxt = stu.allocated
    ? `${escapeHtml(stu.grade || '')} · ${escapeHtml(stu.className || '')}`
    : '未分班';
  return `
    <div class="dorm-stu-avatar">${photoHtml(stu)}</div>
    <div class="di-main">
      <div class="di-name"><strong>${escapeHtml(stu.name)}</strong>
        <span class="dgender ${stu.gender === '男' ? 'g-male' : 'g-female'}">${stu.gender}</span>
      </div>
      <div class="di-sub">${escapeHtml(stu.studentId || '')} · 当前：${curTxt}</div>
    </div>`;
}
async function openAssignDlg(stu) {
  if (!stu) return;
  assignTarget = stu;
  assignCurrentClassId = stu.classId || '';
  assignClassList = [];
  $('#assignTitle').textContent = stu.allocated ? '转班调整' : '安排入班';
  $('#assignStuInfo').innerHTML = assignInfoHtml(stu);
  const sel = $('#assignSelect');
  if (sel) sel.innerHTML = '<option value="">正在加载班级…</option>';
  $('#assignSave').disabled = true;
  $('#assignTip').textContent = '';
  $('#assignMask').classList.add('show');
  try {
    const res = await fetch(CLASSES_API);
    const j = await res.json();
    if (j.code !== 0) throw new Error(j.msg || '加载班级失败');
    assignClassList = j.data || [];
    renderAssignOptions();
  } catch (e) {
    $('#assignTip').textContent = '班级加载失败：' + e.message;
  }
}
function closeAssignDlg() {
  $('#assignMask').classList.remove('show');
  assignTarget = null;
  assignCurrentClassId = '';
  assignClassList = [];
}
function renderAssignOptions() {
  const stu = assignTarget;
  if (!stu) return;
  const sel = $('#assignSelect');
  if (!sel) return;
  const myGrade = String(stu.grade || '').trim();
  // 学生已设年级 → 仅列出同年级班级；未设年级 → 列出全部并按班级年级确定
  const list = assignClassList.filter(c => !myGrade || String(c.grade || '').trim() === myGrade);
  if (!list.length) {
    sel.innerHTML = '';
    $('#assignTip').textContent = myGrade
      ? `当前还没有「${myGrade}」的班级，请先到「班级管理」添加对应班级，或先编辑该生修改年级。`
      : '系统中还没有班级，请先到「班级管理」添加班级，再为学生安排入班。';
    $('#assignSave').disabled = true;
    return;
  }
  const opts = ['<option value="">— 请选择班级 —</option>'].concat(list.map(c => {
    const count = (c.students || []).length;
    const cap = Number(c.capacity) || count;
    const inCur = c.id === assignCurrentClassId;
    const full = !inCur && count >= cap;
    const label = (myGrade ? '' : String(c.grade || '') + ' · ') +
      c.name + `（${count}/${cap}${full ? ' · 已满' : ''}）`;
    return `<option value="${escapeHtml(c.id)}" ${full ? 'disabled' : ''}>${escapeHtml(label)}</option>`;
  })).join('');
  sel.innerHTML = opts;
  if (assignCurrentClassId && list.some(c => c.id === assignCurrentClassId)) sel.value = assignCurrentClassId;
  $('#assignTip').textContent = myGrade
    ? `该生年级为「${myGrade}」，只能分入同年级班级。`
    : '该生暂未填写年级，将按所选班级的年级安排入班。';
  updateAssignSave();
}
function updateAssignSave() {
  const sel = $('#assignSelect');
  const tip = $('#assignTip');
  const save = $('#assignSave');
  if (!save) return;
  save.disabled = !sel.value;
  const c = sel.value ? assignClassList.find(x => x.id === sel.value) : null;
  if (!c) return;
  if (c.id === assignCurrentClassId) {
    tip.textContent = '该生当前已在此班级，无需调整。';
    return;
  }
  const gradeTxt = String(c.grade || '').trim();
  tip.textContent = `确认后将把「${assignTarget ? assignTarget.name : ''}」安排到「${c.name}」` +
    (!assignTarget || !String(assignTarget.grade || '').trim() && gradeTxt ? `（年级按 ${gradeTxt} 计）` : '');
}
async function doAssignSave() {
  const stu = assignTarget;
  if (!stu) return;
  const classId = $('#assignSelect').value;
  if (!classId) { toast('请先选择目标班级', 'error'); return; }
  const done = busyBtn($('#assignSave'), '处理中…');
  if (!done) return;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(stu.id)}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId })
    });
    const j = await res.json();
    if (j.code !== 0) { toast(j.msg || '入班失败', 'error'); renderAssignOptions(); return; }
    toast(j.msg || '已安排入班', 'success');
    closeAssignDlg();
    await loadStudents();
  } catch (e) {
    toast('入班失败：' + e.message, 'error');
  } finally {
    done();
  }
}

// ===== 宿舍分配 / 更换 / 退宿 =====
function dormGenderOk(room, stu) {
  if (room.gender === 'male') return stu.gender === '男';
  if (room.gender === 'female') return stu.gender === '女';
  return true; // 'any' 混合宿舍
}
const DORM_GENDER_LBL = { any: '混合', male: '男生', female: '女生' };

function openDormDlg(stu) {
  if (!stu) return;
  dormTarget = stu;
  const cur = dormRoomOfStudent(stu);
  dormCurrentId = cur ? cur.id : '';
  dormSelectedId = dormCurrentId;
  const search = $('#dormSearch');
  if (search) search.value = '';
  const curTxt = cur ? (String(cur.building) + ' ' + String(cur.roomNo)).trim() : '未入住';
  const infoBox = $('#dormStuInfo');
  if (infoBox) {
    infoBox.innerHTML = `
      <div class="dorm-stu-avatar">${photoHtml(stu)}</div>
      <div class="di-main">
        <div class="di-name"><strong>${escapeHtml(stu.name)}</strong>
          <span class="dgender ${stu.gender === '男' ? 'g-male' : 'g-female'}">${stu.gender}</span>
          <span class="status-tag ${stu.allocated ? 'status-allocated' : 'status-unallocated'}">${stu.allocated ? '已分班' : '未分班'}</span>
        </div>
        <div class="di-sub">${escapeHtml(stu.studentId || '')}${stu.className ? ' · ' + escapeHtml(stu.className) : ''}${stu.grade ? ' · ' + escapeHtml(stu.grade) : ''}</div>
      </div>
      <div class="di-cur">当前宿舍：<b>${escapeHtml(curTxt)}</b></div>`;
  }
  const title = $('#dormTitle');
  if (title) title.textContent = cur ? '更换宿舍' : '分配宿舍';
  renderDormList();
  const mask = $('#dormMask');
  if (mask) mask.classList.add('show');
}

function closeDormDlg() {
  const mask = $('#dormMask');
  if (mask) mask.classList.remove('show');
  dormTarget = null;
}

function updateDormSave() {
  const saveBtn = $('#btnDormSave');
  if (!saveBtn) return;
  if (!dorms.length) {
    saveBtn.disabled = true;
    saveBtn.textContent = '确认入住';
    return;
  }
  const same = !!dormCurrentId && dormCurrentId === dormSelectedId;
  saveBtn.disabled = !dormSelectedId || same;
  saveBtn.textContent = dormCurrentId ? '确认更换' : '确认入住';
  const tip = $('#dormTip');
  if (tip) tip.textContent = same ? '该生当前已在此房间' : (dormSelectedId ? '' : '请选择一间宿舍');
}

function renderDormList() {
  const box = $('#dormList');
  const stu = dormTarget;
  if (!stu) return;
  const leaveBtn = $('#btnDormLeave');
  if (leaveBtn) leaveBtn.hidden = !dormCurrentId;
  if (!dorms.length) {
    if (box) box.innerHTML = `<div class="dorm-empty-tip">
        <p>还没有添加任何宿舍房间，请先到「宿舍管理」页添加房间。</p>
        <a class="btn btn-primary btn-sm" href="/dorm.html" target="_blank" rel="noopener">前往宿舍管理添加房间</a>
      </div>`;
    updateDormSave();
    return;
  }
  const kw = ($('#dormSearch').value || '').trim().toLowerCase();
  const list = dorms.filter(r => dormGenderOk(r, stu) &&
    (!kw || (`${String(r.building)} ${String(r.roomNo)}`).toLowerCase().includes(kw)));
  if (!list.length) {
    if (box) box.innerHTML = '<div class="dorm-empty-tip">没有可入住的房间（请检查性别匹配 / 搜索关键词）</div>';
    dormSelectedId = dormSelectedId && list.some(r => r.id === dormSelectedId) ? dormSelectedId : (dormCurrentId || '');
    updateDormSave();
    return;
  }
  if (box) {
    box.innerHTML = list.map(r => {
      const occC = (r.students || []).length;
      const cap = Number(r.capacity) || 1;
      const sk = dormStateKey(r);
      const isCur = r.id === dormCurrentId;
      const canUse = isCur || occC < cap;
      const isSel = r.id === dormSelectedId && canUse;
      const free = Math.max(0, cap - occC);
      const tagHtml = isCur
        ? '<span class="dr-tag dr-cur">当前</span>'
        : `<span class="dr-tag dr-${sk === 'empty' ? 'empty' : (sk === 'full' ? 'full' : 'part')}">${sk === 'empty' ? '空房' : (sk === 'full' ? '已满' : '部分')}</span>`;
      const freeLine = sk === 'full'
        ? '<span class="dr-free-full">已满房 · 不可再安排</span>'
        : `<span class="dr-free">${sk === 'empty' ? '空房，可入住 ' + cap + ' 人' : '空余 ' + free + ' 床可入住'}</span>`;
      return `<div class="dorm-room lv-${sk} ${isSel ? 'selected' : ''} ${canUse ? '' : 'disabled'}" data-id="${escapeHtml(r.id)}" data-full="${canUse ? '' : '1'}">
        <div class="dr-top">
          <div class="dr-name"><b>${escapeHtml(String(r.building))}</b><span class="dr-no">${escapeHtml(String(r.roomNo))}</span></div>
          <span class="dgender g-${escapeHtml(r.gender)}">${DORM_GENDER_LBL[r.gender] || '混合'}</span>
        </div>
        <div class="dr-cap"><span>已住 <b>${occC}</b>/${cap} 人</span><span class="dr-tags">${tagHtml}</span></div>
        ${dormBedsHtml(r, dormTarget && dormTarget.id, '')}
        <div>${freeLine}</div>
        <span class="dr-check">✓</span>
      </div>`;
    }).join('');
  }
  updateDormSave();
}

async function doDormSave() {
  if (!dormTarget) return;
  if (!dormSelectedId) { toast('请先选择要入住的宿舍房间', 'error'); return; }
  const room = dorms.find(r => r.id === dormSelectedId);
  if (!room) { toast('所选房间不存在，请刷新后重试', 'error'); return; }
  if (dormCurrentId && dormCurrentId === dormSelectedId) { toast('该生当前已在此房间，无需更换', 'error'); return; }
  const done = busyBtn($('#btnDormSave'), '处理中…');
  if (!done) return;
  try {
    const res = await fetch(`${DORMS_API}/${encodeURIComponent(dormSelectedId)}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: [dormTarget.id] })
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '分配失败', 'error'); return; }
    toast(dormCurrentId ? '已更换宿舍' : '已分配宿舍', 'success');
    closeDormDlg();
    await loadStudents();
    renderStuDormBox();
  } catch (e) {
    toast('分配失败：' + e.message, 'error');
  } finally {
    done();
  }
}

// 退宿（可复用：宿舍弹窗 / 档案住宿区块）
async function leaveStudent(stu) {
  if (!stu) return false;
  const cur = dormRoomOfStudent(stu);
  if (!cur) return false;
  const label = (String(cur.building) + ' ' + String(cur.roomNo)).trim();
  const ok = await confirmDlg(`确定让「${stu.name}」退宿（${label}）吗？床位将被释放。`, { title: '退宿', okText: '退宿' });
  if (!ok) return false;
  try {
    const res = await fetch(`${DORMS_API}/${encodeURIComponent(cur.id)}/remove/${encodeURIComponent(stu.id)}`, { method: 'POST' });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '退宿失败', 'error'); return false; }
    toast('已退宿', 'success');
    return true;
  } catch (e) {
    toast('退宿失败：' + e.message, 'error');
    return false;
  }
}
async function doDormLeave() {
  if (!dormTarget || !dormCurrentId) return;
  const done = busyBtn($('#btnDormLeave'), '处理中…');
  if (!done) return;
  try {
    if (await leaveStudent(dormTarget)) {
      closeDormDlg();
      await loadStudents();
      renderStuDormBox();
    }
  } finally {
    done();
  }
}

// ===== 学生编辑档案里的「住宿信息」区块 =====
function renderStuDormBox() {
  const box = $('#stuDormBox');
  if (!box) return;
  const id = $('#fId').value;
  const stu = id ? (allStudents.find(s => String(s.id) === String(id)) || null) : null;
  if (!stu) { box.hidden = true; return; }
  box.hidden = false;

  if (!dorms.length) {
    box.innerHTML = `
      <div class="sdb-card">
        <div class="sdb-top">
          <span class="sdb-title">住宿信息</span>
          <span class="sdb-state st-none">暂无宿舍房间</span>
        </div>
        <div class="sdb-hint">系统还没有任何宿舍房间，请先到「宿舍管理」页添加房间。</div>
        <div class="sdb-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="sdb-godorm">前往宿舍管理添加房间</button>
        </div>
      </div>`;
    return;
  }

  const cur = dormRoomOfStudent(stu);
  if (!cur) {
    box.innerHTML = `
      <div class="sdb-card">
        <div class="sdb-top">
          <span class="sdb-title">住宿信息</span>
          <span class="dgender ${stu.gender === '男' ? 'g-male' : 'g-female'}">${stu.gender}</span>
          <span class="sdb-state st-none">未入住</span>
        </div>
        <div class="sdb-hint">该生当前未入住宿舍，可按性别为其分配房间。</div>
        <div class="sdb-actions">
          <button type="button" class="btn btn-primary btn-sm" data-act="sdb-assign">＋ 分配宿舍</button>
          <button type="button" class="btn btn-default btn-sm" data-act="sdb-godorm">查看宿舍房态</button>
        </div>
      </div>`;
    return;
  }

  const sk = dormStateKey(cur);
  const cap = Number(cur.capacity) || 1;
  const occC = (cur.students || []).length;
  const free = Math.max(0, cap - occC);
  const meIdx = (cur.students || []).findIndex(x => String(x) === String(stu.id));
  const roomiesHtml = (cur.students || []).map((sid, i) => {
    const r = stuIndex[String(sid)];
    const isMe = String(sid) === String(stu.id);
    const g = r ? (r.gender === '男' ? 'male' : 'female') : 'u';
    const nm = r ? r.name : '（已删除学生）';
    const sub = r ? (r.className ? r.grade + ' ' + r.className : (r.grade || '')) : '';
    return `<span class="sdb-rm ${isMe ? 'me' : ''}">
      <span class="ava ${g}">${escapeHtml(String(nm).charAt(0))}</span>
      ${escapeHtml(nm)}${isMe ? '（本人）' : ''}
      ${sub ? `<span class="rm-sub">${escapeHtml(sub)}</span>` : ''}
      <span class="rm-sub">床 ${i + 1}</span>
    </span>`;
  }).join('') || '<span class="dim-text">暂无室友</span>';

  box.innerHTML = `
    <div class="sdb-card lv-${sk}">
      <div class="sdb-top">
        <span class="sdb-title">住宿信息</span>
        <span class="dgender g-${cur.gender === 'male' ? 'male' : (cur.gender === 'female' ? 'female' : 'any')}">${DORM_GENDER_LBL[cur.gender] || '混合'}</span>
        <span class="sdb-state st-${sk}">${DORM_STATE_LBL[sk]}</span>
      </div>
      <div class="sdb-room">
        <div class="sdb-name">
          <b>${escapeHtml(String(cur.building))}</b><em>${escapeHtml(String(cur.roomNo))}</em>
          <span class="sdb-bedno">${cap} 人间${meIdx >= 0 ? ' · 你的床位 ' + (meIdx + 1) : ''}</span>
        </div>
        <div>${dormBedsHtml(cur, stu.id, 'mini')}</div>
        <div class="sdb-occ">已住 ${occC}/${cap} 人${free > 0 ? ` · 空余 ${free} 床` : ' · 已满'}</div>
      </div>
      <div>
        <div class="sdb-roomies-title">同住室友（${occC} 人）</div>
        <div>${roomiesHtml}</div>
      </div>
      <div class="sdb-actions">
        <button type="button" class="btn btn-default btn-sm" data-act="sdb-view" title="在「宿舍管理」页打开该房间房态">查看房态</button>
        <button type="button" class="btn btn-outline btn-sm" data-act="sdb-swap" title="为该生选择新房间，原床位自动空出">更换宿舍</button>
        <button type="button" class="btn btn-leave btn-sm" data-act="sdb-leave">退宿</button>
      </div>
    </div>`;
}

async function batchImport() {
  const subs = window.SUBJECTS || [];
  const subDemo = (subs[0] && subs[1] && subs[2] && subs[3])
    ? { [subs[0].key]: 88, [subs[1].key]: 92, [subs[2].key]: 85, [subs[3].key]: 90 }
    : {};
  const demo = [];
  const mk = (no, name, gender, grade, scores, specialty) => ({
    studentId: no, grade, name, gender, scores: Object.assign({}, scores || {}), specialty
  });
  [['2024001', '张伟', '男', '高一'], ['2024002', '李娜', '女', '高一'], ['2024003', '王强', '男', '高一'],
   ['2024004', '赵敏', '女', '高一'], ['2024005', '刘洋', '男', '高一'], ['2024006', '陈静', '女', '高一'],
   ['2024011', '徐鹏', '男', '高二'], ['2024012', '孙芳', '女', '高二'], ['2024013', '马超', '男', '高二'],
   ['2024021', '唐明', '男', '高三'], ['2024022', '许婷', '女', '高三'], ['2024030', '姜媛', '女', '高三']
  ].forEach(([no, nm, gd, grade], i) => {
    demo.push(mk(no, nm, gd, grade, {
      chinese: 70 + ((i * 17) % 30), math: 70 + ((i * 13) % 30),
      english: 70 + ((i * 11) % 30), science: 70 + ((i * 19) % 30)
    }, ['篮球', '舞蹈', '', '钢琴', '编程', '绘画'][i % 6]));
  });
  demo.forEach(d => {
    if (window.SUBJECTS && window.SUBJECTS.length >= 4) d.scores = { ...subDemo };
    else d.scores = { chinese: 85, math: 88, english: 82, science: 86 };
  });
  const done = busyBtn($('#btnImport'), '导入中…');
  if (!done) return;
  try {
    const res = await fetch(`${API}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(demo)
    });
    const json = await res.json();
    toast(`已导入 ${json.count} 名学生`, 'success');
    await loadStudents();
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
  } finally {
    done();
  }
}

// CSV 模板 / 导入（成绩按当前科目，额外支持学籍档案列）
function csvBaseHeader() {
  const subNames = (window.SUBJECTS || []).map(sj => sj.name);
  return ['学号', '年级', '姓名', '性别', ...subNames, '特长'];
}
function csvFullHeader() {
  return [...csvBaseHeader(),
    '学籍号', '身份证号', '出生日期', '民族', '户籍所在地', '家庭住址',
    '监护人', '监护人电话', '与监护人关系', '入学日期', '备注'];
}
function csvRow(student) {
  const subCells = (window.SUBJECTS || []).map(sj => {
    const v = stuScoreOf(student, sj.key);
    return v === null ? '' : v;
  });
  return [student.studentId || '', student.grade || '', student.name || '', student.gender || '', ...subCells,
    student.specialty || '', student.archNo || '', student.idCard || '', student.birthday || '', student.nation || '',
    student.nativePlace || '', student.address || '', student.guardian || '', student.guardianPhone || '',
    student.guardianRel || '', student.enrollDate || '', student.remark || ''];
}
function downloadTemplate() {
  const header = csvFullHeader();
  const rows = [];
  const sample = {
    studentId: '2024001', grade: '高一', name: '张伟', gender: '男',
    scores: {}, specialty: '篮球', archNo: 'G2024001', idCard: '110101201001010011',
    birthday: '2010-01-01', nation: '汉族', nativePlace: '北京市', address: '北京市XX区XX路1号',
    guardian: '张建国', guardianPhone: '13800000001', guardianRel: '父亲',
    enrollDate: '2023-09-01', remark: ''
  };
  (window.SUBJECTS || []).forEach((sj, i) => { sample.scores[sj.key] = [88, 92, 85, 90, 87, 93][i % 6]; });
  rows.push(csvRow(sample));
  const sample2 = {
    studentId: '2024002', grade: '高一', name: '李娜', gender: '女',
    scores: {}, specialty: '舞蹈', archNo: 'G2024002', idCard: '', birthday: '',
    nation: '汉族', nativePlace: '上海市', address: '', guardian: '李秀英',
    guardianPhone: '13800000002', guardianRel: '母亲', enrollDate: '2023-09-01', remark: ''
  };
  (window.SUBJECTS || []).forEach((sj, i) => { sample2.scores[sj.key] = [95, 87, 93, 86, 91, 80][i % 6]; });
  rows.push(csvRow(sample2));
  const csv = '\uFEFF' + [header, ...rows].map(r => r.map(v => {
    const s = String(v === undefined || v === null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '学生导入模板.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast('示例表格已下载，编辑后可点击「导入表格数据」', 'success');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

async function importTableData(file) {
  try {
    let text = await file.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = parseCsv(text);
    if (rows.length < 2) return toast('表格内容为空或缺少数据行', 'error');

    const header = rows[0].map(h => h.trim());
    const col = (names) => header.findIndex(h => names.includes(h));
    const subs = window.SUBJECTS || [];
    const c = {
      studentId: col(['学号']), grade: col(['年级']), name: col(['姓名']), gender: col(['性别']),
      specialty: col(['特长']),
      archNo: col(['学籍号']), idCard: col(['身份证号']), birthday: col(['出生日期']),
      nation: col(['民族']), nativePlace: col(['户籍所在地']), address: col(['家庭住址']),
      guardian: col(['监护人']), guardianPhone: col(['监护人电话']), guardianRel: col(['与监护人关系']),
      enrollDate: col(['入学日期']), remark: col(['备注'])
    };
    c.subjects = {};
    subs.forEach(sj => { c.subjects[sj.key] = col([sj.name]); });
    if (c.name === -1) return toast('缺少「姓名」列，请按下载的示例表格格式填写', 'error');

    const list = [];
    const skipped = [];
    rows.slice(1).forEach((r, i) => {
      const get = (idx) => (idx >= 0 && r[idx] !== undefined ? String(r[idx]).trim() : '');
      const name = get(c.name);
      if (!name) { skipped.push(i + 2); return; }
      const scores = {};
      subs.forEach(sj => {
        const v = get(c.subjects[sj.key]);
        if (v !== '') scores[sj.key] = Number(v) || 0;
      });
      list.push({
        studentId: get(c.studentId),
        grade: get(c.grade),
        name,
        gender: get(c.gender) === '女' ? '女' : '男',
        scores,
        specialty: get(c.specialty),
        archNo: get(c.archNo), idCard: get(c.idCard), birthday: get(c.birthday),
        nation: get(c.nation), nativePlace: get(c.nativePlace), address: get(c.address),
        guardian: get(c.guardian), guardianPhone: get(c.guardianPhone), guardianRel: get(c.guardianRel),
        enrollDate: get(c.enrollDate), remark: get(c.remark)
      });
    });
    if (!list.length) return toast('未解析到有效学生数据（姓名列不能为空）', 'error');

    const done = busyBtn(document.getElementById('btnImportFile'), '导入中…');
    if (!done) return;
    try {
      const res = await fetch(`${API}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(list)
      });
      const json = await res.json();
      let msg = `成功导入 ${json.count} 名学生`;
      if (skipped.length) msg += `，${skipped.length} 行姓名为空已跳过（第 ${skipped.join('、')} 行）`;
      toast(msg, 'success');
      await loadStudents();
    } finally {
      done();
    }
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
  }
}

// 科目变化（设置页增删）后重建表头
function ensureSubjectsTable() {
  const seq = window.__subjectSeq || 0;
  if (seq === lastSubjectSeq) return;
  lastSubjectSeq = seq;
  renderHeader();
  renderColMenu();
  currentPage = 1;
  renderTable();
}

// ===== 「列设置」下拉菜单 =====
function renderColMenu() {
  const menu = $('#colMenu');
  if (!menu) return;
  const flags = loadColFlags();
  const defs = columnDefs();
  const items = defs.map(c => {
    const locked = c.key === 'name';
    const on = colVisible(c.key, flags);
    const isScore = c.key.startsWith('score:');
    return `<label class="col-item ${isScore ? 'col-subject' : ''} ${locked ? 'is-locked' : ''}">
      <input type="checkbox" data-colkey="${escapeHtml(c.key)}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} />
      <span>${escapeHtml(c.label)}</span>
    </label>`;
  }).join('');
  menu.innerHTML = `
    <div class="col-head">
      <button type="button" class="col-btn col-core" data-cols="core" title="仅保留高频使用的列">精简视图</button>
      <button type="button" class="col-btn" data-cols="all">显示全部</button>
    </div>
    <div class="col-list">${items}</div>`;
}

// ===== 事件绑定 =====
function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#btnImport').onclick = batchImport;
  $('#btnDownloadTpl').onclick = downloadTemplate;
  $('#btnImportFile').onclick = () => $('#importFileInput').click();
  $('#importFileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (file) importTableData(file);
    e.target.value = '';
  };

  const moreDropdown = $('#moreDropdown');
  const moreMenu = $('#moreMenu');
  const colDropdown = $('#colDropdown');
  const colMenu = $('#colMenu');

  // 行操作下拉菜单：挂在页面层（body）上，避免被表格横向滚动容器裁剪
  const rowMenu = document.createElement('div');
  rowMenu.className = 'row-menu';
  document.body.appendChild(rowMenu);
  let rowMenuStuId = null;
  const onScrollCloseRow = () => closeRowMenu();
  const closeRowMenu = () => {
    rowMenu.classList.remove('show');
    rowMenuStuId = null;
    document.removeEventListener('scroll', onScrollCloseRow, true);
  };
  function openRowMenu(btn, stu) {
    if (!stu) return;
    rowMenu.innerHTML = renderRowMenuItems(stu);
    rowMenuStuId = String(stu.id);
    document.addEventListener('scroll', onScrollCloseRow, true);
    rowMenu.style.visibility = 'hidden';
    rowMenu.classList.add('show');
    const mw = rowMenu.offsetWidth || 176;
    const mh = rowMenu.offsetHeight || 210;
    const r = btn.getBoundingClientRect();
    let left = r.right - mw;
    if (left < 8) left = Math.max(8, r.left + 8);
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    rowMenu.style.left = left + 'px';
    rowMenu.style.top = top + 'px';
    rowMenu.style.visibility = '';
  }
  // 行操作菜单项点击
  rowMenu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-mact]');
    if (!item) return;
    const stu = allStudents.find(s => String(s.id) === rowMenuStuId) || null;
    const act = item.dataset.mact;
    closeRowMenu();
    if (!stu) return;
    if (act === 'edit') openModal(stu);
    else if (act === 'assign') openAssignDlg(stu);
    else if (act === 'resetpwd') resetStudentPassword(stu.id, stu);
    else if (act === 'enroll') openEnrollDlg(stu);
    else if (act === 'del') deleteStudent(stu.id);
  });

  const hideDropdowns = () => {
    moreMenu.classList.remove('show');
    moreDropdown.classList.remove('open');
    if (colDropdown && colMenu) {
      colMenu.classList.remove('show');
      colDropdown.classList.remove('open');
    }
    closeRowMenu();
  };
  $('#btnMore').onclick = (e) => {
    e.stopPropagation();
    if (colMenu) colMenu.classList.remove('show');
    if (colDropdown) colDropdown.classList.remove('open');
    const show = !moreMenu.classList.contains('show');
    moreMenu.classList.toggle('show', show);
    moreDropdown.classList.toggle('open', show);
  };
  if (colDropdown && colMenu) {
    const btnCols = $('#btnCols');
    if (btnCols) {
      renderColMenu();
      btnCols.onclick = (e) => {
        e.stopPropagation();
        moreMenu.classList.remove('show');
        moreDropdown.classList.remove('open');
        const show = !colMenu.classList.contains('show');
        colMenu.classList.toggle('show', show);
        colDropdown.classList.toggle('open', show);
      };
    }
    // 勾选 / 取消勾选列
    colMenu.addEventListener('change', (e) => {
      const box = e.target.closest('input[data-colkey]');
      if (!box) return;
      setColVisible(box.dataset.colkey, box.checked);
      refreshListView();
    });
    // 「精简视图 / 显示全部」
    colMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cols]');
      if (!btn) return;
      if (btn.dataset.cols === 'core') applyCoreCols();
      else resetColFlags();
      renderColMenu();
      refreshListView();
    });
  }
  document.addEventListener('click', (e) => {
    if (colDropdown && colDropdown.contains(e.target)) return; // 列菜单内点击保持展开，便于连续勾选
    if (moreDropdown.contains(e.target) && !e.target.closest('.dropdown-item')) return;
    hideDropdowns();
  });

  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#stuForm').onsubmit = saveStudent;
  // 安排入班 / 转班弹窗
  $('#assignClose').onclick = closeAssignDlg;
  $('#assignCancel').onclick = closeAssignDlg;
  $('#assignSelect').onchange = updateAssignSave;
  $('#assignSave').onclick = doAssignSave;
  $('#searchInput').oninput = () => { currentPage = 1; renderTable(); saveFilters(); };
  $('#gradeFilter').onchange = () => { currentPage = 1; renderTable(); saveFilters(); };
  $('#statusFilter').onchange = () => { currentPage = 1; renderTable(); saveFilters(); };
  $('#dormFilter').onchange = () => { currentPage = 1; renderTable(); saveFilters(); };

  $('#pagination').onclick = (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    const p = Number(btn.dataset.page);
    if (!p || p === currentPage) return;
    currentPage = p;
    renderTable();
  };
  $('#pagination').addEventListener('change', (e) => {
    if (e.target.id !== 'pageSizeSel') return;
    const n = Number(e.target.value);
    if (![10, 20, 50, 100].includes(n)) return;
    pageSize = n;
    currentPage = 1;
    renderTable();
    saveFilters();
  });

  $('#studentTbody').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr.dataset.id;
    const stu = allStudents.find(s => s.id === id) || null;
    if (btn.dataset.act === 'rowmenu') {
      e.stopPropagation();
      if (rowMenu.classList.contains('show') && rowMenuStuId === String(id)) closeRowMenu();
      else openRowMenu(btn, stu);
      return;
    }
    if (btn.dataset.act === 'dorm') openDormDlg(stu);
    if (btn.dataset.act === 'dorm-view' && stu && stu._roomId) openRoomPage(stu._roomId, stu.id);
  };

  // 编辑档案里的「住宿信息」区块操作
  const stuDormBox = $('#stuDormBox');
  if (stuDormBox) {
    stuDormBox.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = $('#fId').value;
      const stu = id ? (allStudents.find(s => String(s.id) === String(id)) || null) : null;
      if (!stu) return;
      const act = b.dataset.act;
      if (act === 'sdb-assign' || act === 'sdb-swap') {
        openDormDlg(stu);
      } else if (act === 'sdb-leave') {
        const done = busyBtn(b, '处理中…');
        if (!done) return;
        try {
          if (await leaveStudent(stu)) { await loadStudents(); renderStuDormBox(); }
        } finally { done(); }
      } else if (act === 'sdb-view') {
        const r = dormRoomOfStudent(stu);
        if (r) openRoomPage(r.id, stu.id);
      } else if (act === 'sdb-godorm') {
        openDormTab();
      }
    };
  }

  // 宿舍弹窗
  $('#dormClose').onclick = closeDormDlg;
  $('#dormCancel').onclick = closeDormDlg;
  $('#dormSearch').oninput = renderDormList;
  $('#dormList').onclick = (e) => {
    const item = e.target.closest('.dorm-room');
    if (!item || item.dataset.full) return;
    dormSelectedId = item.dataset.id;
    renderDormList();
  };
  $('#btnDormSave').onclick = doDormSave;
  $('#btnDormLeave').onclick = doDormLeave;

  const thead = document.querySelector('.student-table thead');
  if (thead) {
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (!th) return;
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = -sortDir;
      else { sortKey = key; sortDir = 1; }
      currentPage = 1;
      updateSortHeader();
      renderTable();
    });
  }

  window.addEventListener('cb-site-ready', () => {
    ensureSubjectsTable();
    if (typeof loadGradeOptions === 'function') {
      loadGradeOptions().then(() => loadStudents());
    }
  });
}

// 工作台切回本页时的静默刷新
window.cbEmbedRefresh = function () {
  const p = typeof loadGradeOptions === 'function' ? loadGradeOptions() : Promise.resolve();
  p.then(() => { loadStudents(); });
};

// ===== 学籍异动 / 回收站（学生档案增强，仅 students.html 含相关元素）=====
const ENROLL_STATUS = { active: '在籍', leave: '休学', quit: '退学', transfer: '转出', graduate: '毕业' };
function enrollLabel(st) { return ENROLL_STATUS[st] || st || '在籍'; }
function enrollChipHtml(st) {
  if (!st || st === 'active') return '';
  const cls = { leave: 'enroll-leave', quit: 'enroll-quit', transfer: 'enroll-transfer', graduate: 'enroll-graduate' }[st] || '';
  return ` <span class="enroll-chip ${cls}">${enrollLabel(st)}</span>`;
}
let enrollStu = null;
function openEnrollDlg(stu) {
  if (!document.getElementById('enrollMask')) {
    toast('学籍异动需在「学生档案」页面操作', 'error');
    return;
  }
  enrollStu = stu;
  const st = ENROLL_STATUS[stu.status] ? stu.status : 'active';
  const info = document.getElementById('enrollInfo');
  if (info) {
    info.innerHTML = `<strong>${escapeHtml(stu.name || '')}</strong> ${stu.className ? `（${escapeHtml(stu.className)}）` : '（待分班）'} · 现状态：${enrollLabel(st)}`;
  }
  document.getElementById('enrollStatus').innerHTML = Object.keys(ENROLL_STATUS)
    .map(k => `<option value="${k}" ${k === st ? 'selected' : ''}>${ENROLL_STATUS[k]}</option>`).join('');
  document.getElementById('enrollNote').value = '';
  renderEnrollHistory(stu);
  document.getElementById('enrollMask').classList.add('show');
}
function renderEnrollHistory(stu) {
  const box = document.getElementById('enrollHistory');
  if (!box) return;
  const arr = (stu.history || []).slice().reverse();
  if (!arr.length) {
    box.innerHTML = '<div class="enroll-empty">暂无学籍异动记录（学籍档案的增删改不会自动记录）</div>';
    return;
  }
  box.innerHTML = arr.map(h => {
    const t = h.at ? new Date(h.at).toLocaleString('zh-CN', { hour12: false }) : '';
    const who = h.op ? ` · ${escapeHtml(h.op)}` : '';
    const note = h.note ? ` · ${escapeHtml(h.note)}` : '';
    return `<div class="enroll-item"><div class="enroll-flow">${escapeHtml(h.from || '—')} → ${escapeHtml(h.to || '—')}</div><div class="enroll-meta">${escapeHtml(t)}${who}${note}</div></div>`;
  }).join('');
}
async function doEnrollSave() {
  if (!enrollStu) return;
  const st = document.getElementById('enrollStatus').value;
  const note = document.getElementById('enrollNote').value.trim();
  const done = busyBtn(document.getElementById('btnEnrollSave'), '保存中…');
  if (!done) return;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(enrollStu.id)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: st, note })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.code !== 0) throw new Error(json.msg || '保存失败');
    toast(json.msg || '学籍状态已更新', 'success');
    document.getElementById('enrollMask').classList.remove('show');
    await loadStudents();
  } catch (e) {
    toast(e.message || '保存失败', 'error');
  } finally {
    done();
  }
}

let trashListCache = [];
function renderTrashList() {
  const box = document.getElementById('trashList');
  if (!box) return;
  const kw = (document.getElementById('trashKw').value || '').trim().toLowerCase();
  const list = trashListCache.filter(t => !kw || [t.name, t.studentId, t.grade, t.className, t.sourceClassName]
    .some(v => String(v || '').toLowerCase().includes(kw)));
  if (!list.length) {
    box.innerHTML = `<div class="empty-tip">回收站是空的${kw ? '，或没有匹配的结果' : ''}</div>`;
    return;
  }
  box.innerHTML = list.map(t => {
    const when = t.deletedAt ? new Date(t.deletedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    const from = t.sourceClassName || (t.deletedFrom === 'pool' ? '未分班' : '—');
    return `<div class="trash-item">
      <div><div class="trash-main"><strong>${escapeHtml(t.name || '')}</strong> <span class="dim">${escapeHtml(t.studentId || '')}</span>${escapeHtml(t.gender ? ' · ' + t.gender : '')}</div>
      <div class="trash-sub">删除于 ${escapeHtml(when)} · 原在：${escapeHtml(from)} · ${escapeHtml(t.grade || '—')}</div></div>
      <div class="trash-actions">
        <button type="button" class="btn btn-sm btn-primary" data-act="restore" data-id="${escapeHtml(t.id)}">恢复</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="purge" data-id="${escapeHtml(t.id)}">彻底删除</button>
      </div>
    </div>`;
  }).join('');
}
async function openTrashDlg() {
  try {
    const res = await fetch('/api/trash');
    const json = await res.json().catch(() => ({}));
    if (json.code !== 0) throw new Error(json.msg || '加载失败');
    trashListCache = json.data || [];
    document.getElementById('trashCount').textContent = trashListCache.length;
    renderTrashList();
    document.getElementById('trashMask').classList.add('show');
  } catch (e) {
    toast(e.message || '加载失败', 'error');
  }
}
async function onTrashBody(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'restore') {
    if (!(await confirmDlg('恢复后学生将回到未分班；若原班级仍存在且有容量，会尽量放回原班。确定恢复？', { title: '恢复学生', okText: '恢复' }))) return;
    const done = busyBtn(btn);
    if (!done) return;
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(id)}/restore`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (json.code !== 0) throw new Error(json.msg || '恢复失败');
      toast(json.msg || '已恢复', 'success');
      trashListCache = trashListCache.filter(x => x.id !== id);
      document.getElementById('trashCount').textContent = trashListCache.length;
      renderTrashList();
      await loadStudents();
    } catch (err) { toast(err.message || '恢复失败', 'error'); } finally { done(); }
  } else if (btn.dataset.act === 'purge') {
    if (!(await confirmDlg('彻底删除后不可恢复（不会自动删除该生的学生账号）。确定彻底删除？', { title: '彻底删除', okText: '彻底删除', danger: true }))) return;
    const done = busyBtn(btn);
    if (!done) return;
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(id)}/purge`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (json.code !== 0) throw new Error(json.msg || '操作失败');
      toast(json.msg || '已彻底删除', 'success');
      trashListCache = trashListCache.filter(x => x.id !== id);
      document.getElementById('trashCount').textContent = trashListCache.length;
      renderTrashList();
    } catch (err) { toast(err.message || '操作失败', 'error'); } finally { done(); }
  }
}
async function clearTrash() {
  if (!trashListCache.length) return;
  if (!(await confirmDlg(`回收站中共 ${trashListCache.length} 条记录，清空后不可恢复。确定清空？`, { title: '清空回收站', okText: '清空', danger: true }))) return;
  const done = busyBtn(document.getElementById('btnTrashClear'), '清空中…');
  if (!done) return;
  try {
    const res = await fetch('/api/trash/clear', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (json.code !== 0) throw new Error(json.msg || '操作失败');
    toast(json.msg || '回收站已清空', 'success');
    trashListCache = [];
    document.getElementById('trashCount').textContent = '0';
    renderTrashList();
  } catch (err) { toast(err.message || '操作失败', 'error'); } finally { done(); }
}
function initEnrollTrashUI() {
  const enrollMask = document.getElementById('enrollMask');
  const trashMask = document.getElementById('trashMask');
  if (enrollMask) {
    const hide = () => enrollMask.classList.remove('show');
    $('#enrollX').onclick = hide;
    $('#enrollCancel').onclick = hide;
    $('#btnEnrollSave').onclick = doEnrollSave;
  }
  const btnTrash = document.getElementById('btnTrash');
  if (btnTrash && trashMask) {
    const hideT = () => trashMask.classList.remove('show');
    btnTrash.onclick = openTrashDlg;
    $('#trashClose').onclick = hideT;
    $('#trashMaskCancel').onclick = hideT;
    $('#btnTrashClear').onclick = clearTrash;
    $('#trashKw').oninput = renderTrashList;
    $('#trashList').addEventListener('click', onTrashBody);
  }
}

// 初始化
renderHeader();
bindEvents();
renderColMenu();
Promise.all([loadGradeOptions(), loadFilters()]).then(() => {
  loadStudents();
});
initEnrollTrashUI();
