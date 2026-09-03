// 学生信息管理 - 主界面逻辑
const API = '/api/students';
const ALL_STUDENTS_API = '/api/all-students';
const GRADES_API = '/api/grades';
const FILTERS_API = '/api/filters';
let students = [];
let allStudents = []; // 包含已分班的所有学生
let gradesList = [];
let savedFilters = {}; // 保存的筛选设置

// 分页设置
let pageSize = 10;
let currentPage = 1;

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

function totalScore(s) {
  return Number(s.chinese) + Number(s.math) + Number(s.english) + Number(s.science);
}

function photoHtml(s) {
  if (s.photo) return `<img src="${escapeHtml(s.photo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:s.name.slice(0,1)}))" />`;
  return escapeHtml((s.name || '?').slice(0, 1));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 加载年级选项到下拉框
async function loadGradeOptions() {
  try {
    const res = await fetch(GRADES_API);
    const json = await res.json();
    gradesList = json.data || [];

    // 填充筛选下拉框
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

    // 填充表单下拉框
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

// 保存筛选设置到服务端
async function saveFilters() {
  try {
    const filters = {
      'students:grade': $('#gradeFilter')?.value || '',
      'students:status': $('#statusFilter')?.value || '',
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

// 从服务端加载筛选设置
async function loadFilters() {
  try {
    const res = await fetch(FILTERS_API);
    const json = await res.json();
    savedFilters = json.data || {};

    // 恢复筛选设置
    const gradeFilter = $('#gradeFilter');
    if (gradeFilter && savedFilters['students:grade']) {
      gradeFilter.value = savedFilters['students:grade'];
    }
    const statusFilter = $('#statusFilter');
    if (statusFilter && savedFilters['students:status']) {
      statusFilter.value = savedFilters['students:status'];
    }
    const searchInput = $('#searchInput');
    if (searchInput && savedFilters['students:search']) {
      searchInput.value = savedFilters['students:search'];
    }
    // 恢复每页条数
    const savedPageSize = Number(savedFilters['students:pageSize']);
    if ([10, 20, 50, 100].includes(savedPageSize)) {
      pageSize = savedPageSize;
    }
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
      (s.specialty || '').toLowerCase().includes(kw) ||
      (s.studentId || '').toLowerCase().includes(kw)
    );
  }
  const gradeFilter = $('#gradeFilter')?.value || '';
  if (gradeFilter) {
    list = list.filter(s => s.grade === gradeFilter);
  }
  const statusFilter = $('#statusFilter')?.value || '';
  if (statusFilter === 'allocated') {
    list = list.filter(s => s.allocated === true);
  } else if (statusFilter === 'unallocated') {
    list = list.filter(s => s.allocated === false);
  }
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="13" class="empty-tip">暂无学生数据，点击右上角「添加学生」开始</td></tr>`;
    pagination.innerHTML = '';
    updateStats();
    return;
  }

  // 分页裁剪
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * pageSize;
  const pageList = list.slice(start, start + pageSize);

  tbody.innerHTML = pageList.map(s => {
    const statusTag = s.allocated
      ? `<span class="status-tag status-allocated">已分班</span><br/><small>${escapeHtml(s.className || '')}</small>`
      : `<span class="status-tag status-unallocated">未分班</span>`;
    const actions = s.allocated
      ? `<span style="color:#999;font-size:12px">已分入班级</span>`
      : `<div class="row-actions">
          <button class="btn-sm btn-edit" data-act="edit"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> 编辑</button>
          <button class="btn-sm btn-del" data-act="del"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> 删除</button>
        </div>`;
    return `
    <tr data-id="${s.id}">
      <td><div class="avatar">${photoHtml(s)}</div></td>
      <td class="stu-id">${escapeHtml(s.studentId || '—')}</td>
      <td><span class="grade-tag">${escapeHtml(s.grade || '—')}</span></td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td><span class="gender-tag ${s.gender === '男' ? 'gender-male' : 'gender-female'}">${s.gender}</span></td>
      <td class="score">${s.chinese}</td>
      <td class="score">${s.math}</td>
      <td class="score">${s.english}</td>
      <td class="score">${s.science}</td>
      <td class="total-score">${totalScore(s)}</td>
      <td>${s.specialty ? `<span class="specialty-tag">${escapeHtml(s.specialty)}</span>` : '—'}</td>
      <td>${statusTag}</td>
      <td>${actions}</td>
    </tr>
  `;
  }).join('');
  pagination.innerHTML = renderPaginationHtml(total, totalPages);
  updateStats();
}

// 生成分页控件 HTML（页码过多时用省略号折叠）
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
      ${pages.map(p => p === '...'
        ? `<span class="page-ellipsis">…</span>`
        : btn(p, p, p === currentPage ? 'active' : '')).join('')}
      ${btn(currentPage + 1, '›', 'page-nav', currentPage === totalPages)}
    </div>`;
}

function updateStats() {
  $('#statTotal').textContent = allStudents.length;
  $('#statMale').textContent = allStudents.filter(s => s.gender === '男').length;
  $('#statFemale').textContent = allStudents.filter(s => s.gender === '女').length;
  if (!allStudents.length) {
    $('#statAvg').textContent = '0';
  } else {
    const sum = allStudents.reduce((a, s) => a + totalScore(s), 0);
    $('#statAvg').textContent = (sum / allStudents.length).toFixed(1);
  }
}

async function loadStudents() {
  try {
    const res = await fetch(ALL_STUDENTS_API);
    const json = await res.json();
    allStudents = json.data || [];
    students = allStudents.filter(s => !s.allocated);
    renderTable();
  } catch (e) {
    toast('加载失败：' + e.message, 'error');
  }
}

// ===== 弹窗 =====
function openModal(stu) {
  $('#modalTitle').textContent = stu ? '编辑学生' : '添加学生';
  $('#fId').value = stu ? stu.id : '';
  $('#fStudentId').value = stu ? stu.studentId : '';
  $('#fGrade').value = stu ? stu.grade : (gradesList[0] || '');
  $('#fPhoto').value = stu ? stu.photo : '';
  $('#fName').value = stu ? stu.name : '';
  $('#fGender').value = stu ? stu.gender : '男';
  $('#fChinese').value = stu ? stu.chinese : 0;
  $('#fMath').value = stu ? stu.math : 0;
  $('#fEnglish').value = stu ? stu.english : 0;
  $('#fScience').value = stu ? stu.science : 0;
  $('#fSpecialty').value = stu ? stu.specialty : '';
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fStudentId').focus(), 100);
}
function closeModal() { $('#modalMask').classList.remove('show'); }

async function saveStudent(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const data = {
    studentId: $('#fStudentId').value.trim(),
    grade: $('#fGrade').value,
    photo: $('#fPhoto').value.trim(),
    name: $('#fName').value.trim(),
    gender: $('#fGender').value,
    chinese: $('#fChinese').value,
    math: $('#fMath').value,
    english: $('#fEnglish').value,
    science: $('#fScience').value,
    specialty: $('#fSpecialty').value.trim()
  };
  if (!data.studentId) { toast('请输入学号', 'error'); return; }
  if (!data.name) { toast('请输入姓名', 'error'); return; }
  try {
    const res = await fetch(id ? `${API}/${id}` : API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return; }
    toast(id ? '修改成功' : '添加成功', 'success');
    closeModal();
    await loadStudents();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
}

async function deleteStudent(id) {
  if (!confirm('确定删除该学生？')) return;
  try {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    toast('已删除', 'success');
    await loadStudents();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

async function clearAll() {
  if (!confirm('确定清空所有学生数据？此操作不可恢复！')) return;
  try {
    await fetch(API, { method: 'DELETE' });
    toast('已清空', 'success');
    await loadStudents();
  } catch (e) {
    toast('清空失败：' + e.message, 'error');
  }
}

async function batchImport() {
  const demo = [
    { studentId: '2024001', grade: '高一', name: '张伟', gender: '男', chinese: 88, math: 92, english: 85, science: 90, specialty: '篮球' },
    { studentId: '2024002', grade: '高一', name: '李娜', gender: '女', chinese: 95, math: 87, english: 93, science: 86, specialty: '舞蹈' },
    { studentId: '2024003', grade: '高一', name: '王强', gender: '男', chinese: 78, math: 85, english: 72, science: 80, specialty: '' },
    { studentId: '2024004', grade: '高一', name: '赵敏', gender: '女', chinese: 90, math: 78, english: 88, science: 82, specialty: '钢琴' },
    { studentId: '2024005', grade: '高一', name: '刘洋', gender: '男', chinese: 82, math: 95, english: 80, science: 88, specialty: '编程' },
    { studentId: '2024006', grade: '高一', name: '陈静', gender: '女', chinese: 86, math: 80, english: 91, science: 79, specialty: '绘画' },
    { studentId: '2024007', grade: '高一', name: '杨帆', gender: '男', chinese: 73, math: 68, english: 75, science: 71, specialty: '足球' },
    { studentId: '2024008', grade: '高一', name: '黄丽', gender: '女', chinese: 91, math: 84, english: 89, science: 87, specialty: '声乐' },
    { studentId: '2024009', grade: '高一', name: '周磊', gender: '男', chinese: 79, math: 88, english: 76, science: 83, specialty: '' },
    { studentId: '2024010', grade: '高一', name: '吴婷', gender: '女', chinese: 94, math: 90, english: 96, science: 92, specialty: '古筝' },
    { studentId: '2024011', grade: '高二', name: '徐鹏', gender: '男', chinese: 85, math: 91, english: 82, science: 88, specialty: '游泳' },
    { studentId: '2024012', grade: '高二', name: '孙芳', gender: '女', chinese: 88, math: 76, english: 90, science: 81, specialty: '书法' },
    { studentId: '2024013', grade: '高二', name: '马超', gender: '男', chinese: 72, math: 80, english: 68, science: 75, specialty: '篮球' },
    { studentId: '2024014', grade: '高二', name: '朱琳', gender: '女', chinese: 93, math: 89, english: 94, science: 91, specialty: '舞蹈' },
    { studentId: '2024015', grade: '高二', name: '胡杰', gender: '男', chinese: 80, math: 75, english: 82, science: 78, specialty: '吉他' },
    { studentId: '2024016', grade: '高二', name: '郭敏', gender: '女', chinese: 92, math: 88, english: 95, science: 90, specialty: '声乐' },
    { studentId: '2024017', grade: '高二', name: '郑涛', gender: '男', chinese: 68, math: 72, english: 65, science: 70, specialty: '' },
    { studentId: '2024018', grade: '高二', name: '冯雪', gender: '女', chinese: 85, math: 91, english: 80, science: 88, specialty: '古筝' },
    { studentId: '2024019', grade: '高二', name: '蒋伟', gender: '男', chinese: 76, math: 83, english: 78, science: 85, specialty: '编程' },
    { studentId: '2024020', grade: '高二', name: '韩梅', gender: '女', chinese: 96, math: 90, english: 93, science: 89, specialty: '绘画' },
    { studentId: '2024021', grade: '高三', name: '唐明', gender: '男', chinese: 87, math: 93, english: 84, science: 91, specialty: '足球' },
    { studentId: '2024022', grade: '高三', name: '许婷', gender: '女', chinese: 91, math: 85, english: 92, science: 87, specialty: '钢琴' },
    { studentId: '2024023', grade: '高三', name: '邓强', gender: '男', chinese: 75, math: 79, english: 70, science: 76, specialty: '' },
    { studentId: '2024024', grade: '高三', name: '萧丽', gender: '女', chinese: 89, math: 82, english: 90, science: 85, specialty: '书法' },
    { studentId: '2024025', grade: '高三', name: '任飞', gender: '男', chinese: 83, math: 96, english: 79, science: 92, specialty: '编程' },
    { studentId: '2024026', grade: '高三', name: '姚静', gender: '女', chinese: 94, math: 88, english: 95, science: 90, specialty: '舞蹈' },
    { studentId: '2024027', grade: '高三', name: '潘磊', gender: '男', chinese: 70, math: 65, english: 72, science: 68, specialty: '篮球' },
    { studentId: '2024028', grade: '高三', name: '张颖', gender: '女', chinese: 90, math: 86, english: 88, science: 84, specialty: '声乐' },
    { studentId: '2024029', grade: '高三', name: '钟伟', gender: '男', chinese: 81, math: 77, english: 83, science: 79, specialty: '' },
    { studentId: '2024030', grade: '高三', name: '姜媛', gender: '女', chinese: 97, math: 94, english: 96, science: 95, specialty: '绘画' }
  ];
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

// 下载示例表格（CSV，带 BOM 保证 Excel 打开中文不乱码）
function downloadTemplate() {
  const header = '学号,年级,姓名,性别,语文,数学,英语,理综,特长';
  const rows = [
    '2024001,高一,张伟,男,88,92,85,90,篮球',
    '2024002,高一,李娜,女,95,87,93,86,舞蹈',
    '2024003,高二,王强,男,78,85,72,80,'
  ];
  const csv = '\uFEFF' + [header, ...rows].join('\r\n');
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

// 解析 CSV 文本（支持引号包裹、字段内逗号、双引号转义）
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

// 导入表格数据（CSV）
async function importTableData(file) {
  try {
    let text = await file.text();
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // 去掉 BOM
    const rows = parseCsv(text);
    if (rows.length < 2) return toast('表格内容为空或缺少数据行', 'error');

    // 按表头名称定位列
    const header = rows[0].map(h => h.trim());
    const col = (names) => header.findIndex(h => names.includes(h));
    const c = {
      studentId: col(['学号']),
      grade: col(['年级']),
      name: col(['姓名']),
      gender: col(['性别']),
      chinese: col(['语文']),
      math: col(['数学']),
      english: col(['英语']),
      science: col(['理综', '理科综合']),
      specialty: col(['特长'])
    };
    if (c.name === -1) return toast('缺少「姓名」列，请按下载的示例表格格式填写', 'error');

    const list = [];
    const skipped = [];
    rows.slice(1).forEach((r, i) => {
      const get = (idx) => (idx >= 0 && r[idx] !== undefined ? String(r[idx]).trim() : '');
      const name = get(c.name);
      if (!name) { skipped.push(i + 2); return; } // i+2 = Excel 中的行号
      list.push({
        studentId: get(c.studentId),
        grade: get(c.grade),
        name,
        gender: get(c.gender) === '女' ? '女' : '男',
        chinese: Number(get(c.chinese)) || 0,
        math: Number(get(c.math)) || 0,
        english: Number(get(c.english)) || 0,
        science: Number(get(c.science)) || 0,
        specialty: get(c.specialty)
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

// ===== 事件绑定 =====
function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#btnClear').onclick = clearAll;
  $('#btnImport').onclick = batchImport;
  $('#btnDownloadTpl').onclick = downloadTemplate;
  $('#btnImportFile').onclick = () => $('#importFileInput').click();
  $('#importFileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (file) importTableData(file);
    e.target.value = ''; // 允许重复选择同一文件
  };
  // 更多下拉菜单：点击按钮切换，点击菜单项或外部区域关闭
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

  // 分页点击（事件委托）
  $('#pagination').onclick = (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    const p = Number(btn.dataset.page);
    if (!p || p === currentPage) return;
    currentPage = p;
    renderTable();
  };

  // 每页条数切换（分页栏会重渲染，用事件委托）
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
    const stu = students.find(s => s.id === id);
    if (btn.dataset.act === 'edit') openModal(stu);
    if (btn.dataset.act === 'del') deleteStudent(id);
  };
}

// 初始化
bindEvents();
Promise.all([loadGradeOptions(), loadFilters()]).then(() => {
  loadStudents();
});
