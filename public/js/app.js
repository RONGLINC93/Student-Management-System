// 学生信息管理 - 主界面逻辑（动态科目 + 学籍档案）
const API = '/api/students';
const ALL_STUDENTS_API = '/api/all-students';
const GRADES_API = '/api/grades';
const FILTERS_API = '/api/filters';
const DORMS_API = '/api/dorms';
let students = [];
let allStudents = []; // 包含已分班的所有学生
let gradesList = [];
let savedFilters = {}; // 保存的筛选设置
let lastSubjectSeq = -1;

// 宿舍状态：dorms 缓存房间列表；学生行通过 _roomId/_dormTxt 标注入住信息
let dorms = [];
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

// ===== 动态表头 =====
function renderHeader() {
  const thead = $('#stuThead');
  if (!thead) return;
  const fixed = [
    ['photo', '照片', false], ['studentId', '学号', true], ['grade', '年级', true],
    ['className', '班级', true], ['name', '姓名', true], ['gender', '性别', true]
  ];
  const subs = (window.SUBJECTS || []).map(sj => ['score:' + sj.key, sj.name, true]);
  const tail = [
    ['total', '总分', true], ['specialty', '特长', true], ['allocated', '分班状态', true], ['', '宿舍', false], ['', '操作', false]
  ];
  const cols = [...fixed, ...subs, ...tail];
  let html = '<tr>';
  cols.forEach(([key, label, sortable]) => {
    if (sortable) {
      html += `<th class="sortable" data-sort="${key}">${escapeHtml(label)}</th>`;
    } else if (key === 'photo') {
      html += '<th style="width:56px">照片</th>';
    } else if (label === '宿舍') {
      html += '<th style="width:196px">宿舍</th>';
    } else {
      html += `<th style="width:150px">${escapeHtml(label)}</th>`;
    }
  });
  html += '</tr>';
  thead.innerHTML = html;
  updateSortHeader();
}
function colSpanCount() {
  return 6 + (window.SUBJECTS || []).length + 5;
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

async function saveFilters() {
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

  const subjects = window.SUBJECTS || [];
  tbody.innerHTML = pageList.map(s => {
    const statusTag = s.allocated
      ? '<span class="status-tag status-allocated">已分班</span>'
      : '<span class="status-tag status-unallocated">未分班</span>';
    const actions = s.allocated
      ? '<div class="row-actions"><button class="btn-sm btn-edit" data-act="edit">编辑</button></div>'
      : '<div class="row-actions"><button class="btn-sm btn-edit" data-act="edit">编辑</button><button class="btn-sm btn-del" data-act="del">删除</button></div>';
    const dormCell = dormCellHtml(s);
    const scoreCells = subjects.map(sj => {
      const v = stuScoreOf(s, sj.key);
      return `<td class="score">${v === null ? '—' : v}</td>`;
    }).join('');
    return `
    <tr data-id="${escapeHtml(s.id)}">
      <td><div class="avatar">${photoHtml(s)}</div></td>
      <td class="stu-id">${escapeHtml(s.studentId || '—')}</td>
      <td>${escapeHtml(s.grade || '—')}</td>
      <td>${escapeHtml(s.className || '—')}</td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td><span class="gender-tag ${s.gender === '男' ? 'gender-male' : 'gender-female'}">${s.gender}</span></td>
      ${scoreCells}
      <td class="total-score">${totalOfStu(s)}</td>
      <td>${s.specialty ? `<span class="specialty-tag">${escapeHtml(s.specialty)}</span>` : '—'}</td>
      <td>${statusTag}</td>
      <td class="dorm-cell">${dormCell}</td>
      <td>${actions}</td>
    </tr>
  `;
  }).join('');
  pagination.innerHTML = renderPaginationHtml(total, totalPages);
  updateStats();
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
  $('#fGrade').title = inClass ? '已分班学生的年级由所属班级决定，如需调整请退回学生池' : '';
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
  }
}

async function deleteStudent(id) {
  if (!(await confirmDlg('确定删除该学生？相关入住宿舍会自动退宿。', { title: '删除学生', okText: '删除', danger: true }))) return;
  try {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    toast('已删除', 'success');
    await loadStudents();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
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
  if (await leaveStudent(dormTarget)) {
    closeDormDlg();
    await loadStudents();
    renderStuDormBox();
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

async function clearAll() {
  const allocated = allStudents.filter(s => s.allocated).length;
  const tip = `确定清空所有学生？\n将清空学生池（${allStudents.length - allocated} 人）与各班花名册（${allocated} 人），班级本身会保留。\n此操作不可恢复！`;
  if (!(await confirmDlg(tip, { title: '清空学生', okText: '清空', danger: true }))) return;
  try {
    await fetch(API, { method: 'DELETE' });
    toast('已清空（学生池与班级名单）', 'success');
    await loadStudents();
  } catch (e) {
    toast('清空失败：' + e.message, 'error');
  }
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
  currentPage = 1;
  renderTable();
}

// ===== 事件绑定 =====
function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#btnBoard').onclick = () => window.open('/result.html', '_blank');
  $('#btnAllocate').onclick = () => goPage('/allocate.html');
  $('#btnClear').onclick = clearAll;
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
  $('#btnMore').onclick = (e) => {
    e.stopPropagation();
    const show = !moreMenu.classList.contains('show');
    moreMenu.classList.toggle('show', show);
    moreDropdown.classList.toggle('open', show);
  };
  document.addEventListener('click', (e) => {
    if (moreDropdown.contains(e.target) && !e.target.closest('.dropdown-item')) return;
    moreMenu.classList.remove('show');
    moreDropdown.classList.remove('open');
  });

  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#modalMask').onclick = (e) => { if (e.target.id === 'modalMask') closeModal(); };
  $('#stuForm').onsubmit = saveStudent;
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
    if (btn.dataset.act === 'edit') openModal(stu);
    if (btn.dataset.act === 'del') deleteStudent(id);
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
        if (await leaveStudent(stu)) { await loadStudents(); renderStuDormBox(); }
      } else if (act === 'sdb-view') {
        const r = dormRoomOfStudent(stu);
        if (r) openRoomPage(r.id, stu.id);
      } else if (act === 'sdb-godorm') {
        openDormTab();
      }
    };
  }

  // 宿舍弹窗
  $('#dormMask').onclick = (e) => { if (e.target.id === 'dormMask') closeDormDlg(); };
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

// 初始化
renderHeader();
bindEvents();
Promise.all([loadGradeOptions(), loadFilters()]).then(() => {
  loadStudents();
});
