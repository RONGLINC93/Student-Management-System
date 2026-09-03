// 班级管理逻辑
const API = '/api/classes';
const STU_API = '/api/students';
const GRADES_API = '/api/grades';
const FILTERS_API = '/api/filters';
let classes = [];
let poolCount = 0;
let gradesList = [];

const $ = (s) => document.querySelector(s);

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function totalScore(s) {
  return Number(s.chinese) + Number(s.math) + Number(s.english) + Number(s.science);
}

function photoHtml(s) {
  if (s.photo) return `<img src="${escapeHtml(s.photo)}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${escapeHtml((s.name||'?').slice(0,1))}'" />`;
  return escapeHtml((s.name || '?').slice(0, 1));
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
      'classes:grade': $('#gradeFilter')?.value || '',
      'classes:search': $('#searchInput')?.value || ''
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
    const savedFilters = json.data || {};

    // 恢复筛选设置
    const gradeFilter = $('#gradeFilter');
    if (gradeFilter && savedFilters['classes:grade']) {
      gradeFilter.value = savedFilters['classes:grade'];
    }
    const searchInput = $('#searchInput');
    if (searchInput && savedFilters['classes:search']) {
      searchInput.value = savedFilters['classes:search'];
    }
  } catch (e) {
    console.error('加载筛选失败:', e);
  }
}

async function loadData() {
  try {
    const [clsRes, stuRes] = await Promise.all([
      fetch(API), fetch(STU_API)
    ]);
    const clsJson = await clsRes.json();
    const stuJson = await stuRes.json();
    classes = clsJson.data || [];
    poolCount = (stuJson.data || []).length;
    renderClasses();
    updateStats();
  } catch (e) {
    toast('加载失败：' + e.message, 'error');
  }
}

function updateStats() {
  $('#statClasses').textContent = classes.length;
  const assigned = classes.reduce((a, c) => a + (c.students?.length || 0), 0);
  $('#statAssigned').textContent = assigned;
  $('#statPool').textContent = poolCount;
  $('#statCapacity').textContent = classes.reduce((a, c) => a + (Number(c.capacity) || 0), 0);
}

function renderClasses() {
  const kw = ($('#searchInput').value || '').trim().toLowerCase();
  const gradeFilter = $('#gradeFilter')?.value || '';
  let list = classes.slice();
  if (gradeFilter) {
    list = list.filter(c => c.grade === gradeFilter);
  }
  if (kw) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(kw) ||
      (c.headTeacher || '').toLowerCase().includes(kw)
    );
  }
  const grid = $('#classesGrid');
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-tip-card">
        <svg class="stage-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>
        <p>暂无班级</p>
        <small>点击「添加班级」创建班级，或前往「智能分班」一键分班</small>
      </div>`;
    return;
  }
  grid.innerHTML = list.map(c => {
    const count = c.students?.length || 0;
    const cap = Number(c.capacity) || 50;
    const pct = cap ? Math.min(100, Math.round(count / cap * 100)) : 0;
    const male = (c.students || []).filter(s => s.gender === '男').length;
    const female = count - male;
    const avg = count ? (c.students.reduce((a, s) => a + totalScore(s), 0) / count).toFixed(1) : '—';
    return `
      <div class="class-card" data-id="${c.id}" draggable="true" title="拖拽调整顺序">
        <div class="class-card-header">
          <div>
            <h3 class="class-card-name">${escapeHtml(c.name)} <span class="grade-tag">${escapeHtml(c.grade || '—')}</span></h3>
            <span class="class-card-meta">班主任：${c.headTeacher ? escapeHtml(c.headTeacher) : '未设置'}</span>
          </div>
          <div class="class-card-actions">
            <button class="btn-sm btn-edit" data-act="edit" title="编辑"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
            <button class="btn-sm btn-del" data-act="del" title="删除"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
        <div class="class-card-stats">
          <div class="cc-stat"><span class="cc-num">${count}</span><span class="cc-label">人数</span></div>
          <div class="cc-stat"><span class="cc-num">${male}</span><span class="cc-label">男生</span></div>
          <div class="cc-stat"><span class="cc-num">${female}</span><span class="cc-label">女生</span></div>
          <div class="cc-stat"><span class="cc-num">${avg}</span><span class="cc-label">均分</span></div>
        </div>
        <div class="class-card-progress">
          <div class="cc-bar"><div class="cc-bar-fill" style="width:${pct}%"></div></div>
          <span class="cc-cap-text">${count}/${cap}</span>
        </div>
        <button class="btn btn-default class-view-btn" data-act="view">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          查看花名册
        </button>
      </div>
    `;
  }).join('');
}

// ===== 班级编辑弹窗 =====
function openModal(cls) {
  $('#modalTitle').textContent = cls ? '编辑班级' : '添加班级';
  $('#fId').value = cls ? cls.id : '';
  $('#fName').value = cls ? cls.name : '';
  $('#fGrade').value = cls ? cls.grade : (gradesList[0] || '');
  $('#fHeadTeacher').value = cls ? cls.headTeacher : '';
  $('#fCapacity').value = cls ? cls.capacity : 50;
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fName').focus(), 100);
}
function closeModal() { $('#modalMask').classList.remove('show'); }

async function saveClass(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const data = {
    name: $('#fName').value.trim(),
    grade: $('#fGrade').value,
    headTeacher: $('#fHeadTeacher').value.trim(),
    capacity: $('#fCapacity').value
  };
  if (!data.name) { toast('请输入班级名称', 'error'); return; }
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
    await loadData();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
}

async function deleteClass(id) {
  const cls = classes.find(c => c.id === id);
  const cnt = cls?.students?.length || 0;
  if (!confirm(`确定删除班级「${cls?.name}」？${cnt ? `其中 ${cnt} 名学生将退回学生池。` : ''}`)) return;
  try {
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    toast('已删除', 'success');
    await loadData();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

async function clearAll() {
  if (!confirm('确定清空所有班级？所有学生将退回学生池。')) return;
  try {
    await fetch(API, { method: 'DELETE' });
    toast('已清空所有班级', 'success');
    await loadData();
  } catch (e) {
    toast('清空失败：' + e.message, 'error');
  }
}

// ===== 花名册弹窗 =====
function openRoster(cls) {
  $('#rosterTitle').textContent = `${cls.name} - 花名册`;
  const male = (cls.students || []).filter(s => s.gender === '男').length;
  const female = (cls.students || []).length - male;
  const avg = (cls.students || []).length
    ? ((cls.students || []).reduce((a, s) => a + totalScore(s), 0) / (cls.students || []).length).toFixed(1)
    : '—';
  $('#rosterInfo').innerHTML = `
    <span class="roster-tag">班主任：${cls.headTeacher ? escapeHtml(cls.headTeacher) : '未设置'}</span>
    <span class="roster-tag">人数：${(cls.students || []).length}</span>
    <span class="roster-tag">男 ${male} / 女 ${female}</span>
    <span class="roster-tag">平均总分：${avg}</span>
  `;
  const tbody = $('#rosterTbody');
  if (!(cls.students || []).length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-tip">该班级暂无学生，请前往「智能分班」进行分配</td></tr>`;
  } else {
    tbody.innerHTML = cls.students.map(s => `
      <tr data-id="${s.id}">
        <td><div class="avatar">${photoHtml(s)}</div></td>
        <td class="stu-id">${escapeHtml(s.studentId || '—')}</td>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td><span class="gender-tag ${s.gender === '男' ? 'gender-male' : 'gender-female'}">${s.gender}</span></td>
        <td class="total-score">${totalScore(s)}</td>
        <td>${s.specialty ? `<span class="specialty-tag">${escapeHtml(s.specialty)}</span>` : '—'}</td>
        <td><button class="btn-sm btn-del" data-act="remove">退回池</button></td>
      </tr>
    `).join('');
  }
  $('#rosterMask').classList.add('show');
}
function closeRoster() { $('#rosterMask').classList.remove('show'); }

// 导出花名册为 CSV
function exportRoster() {
  const title = $('#rosterTitle').textContent;
  const cls = classes.find(c => title.startsWith(c.name));
  if (!cls || !cls.students?.length) {
    toast('暂无学生数据可导出', 'error');
    return;
  }

  // CSV 表头
  const headers = ['学号', '姓名', '性别', '语文', '数学', '英语', '理综', '总分', '特长'];
  const rows = cls.students.map(s => [
    s.studentId || '',
    s.name || '',
    s.gender || '',
    s.chinese || 0,
    s.math || 0,
    s.english || 0,
    s.science || 0,
    totalScore(s),
    s.specialty || ''
  ]);

  // 生成 CSV 内容（带 BOM 以支持 Excel 打开中文）
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');
  const csv = '\uFEFF' + csvContent;

  // 下载文件
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cls.name}_花名册_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('导出成功', 'success');
}

async function removeStudentFromClass(classId, stuId) {
  try {
    await fetch(`${API}/${classId}/remove/${stuId}`, { method: 'POST' });
    toast('已退回学生池', 'success');
    // 刷新数据并重开花名册
    await loadData();
    const cls = classes.find(c => c.id === classId);
    if (cls) openRoster(cls);
    else closeRoster();
  } catch (e) {
    toast('操作失败：' + e.message, 'error');
  }
}

// ===== 拖拽排序 =====
let dragEl = null;

function bindDragSort() {
  const grid = $('#classesGrid');

  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.class-card');
    if (!card) return;
    // 有筛选/搜索时只展示了部分班级，禁止拖拽排序
    if (($('#searchInput').value || '').trim() || $('#gradeFilter')?.value) {
      toast('请先清除筛选/搜索条件，再拖拽排序', 'error');
      e.preventDefault();
      return;
    }
    dragEl = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (_) {}
  });

  grid.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.class-card');
    if (!card || card === dragEl) return;
    // 网格布局：以鼠标相对卡片中点的水平位置判断插入到前方还是后方
    const rect = card.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    grid.insertBefore(dragEl, before ? card : card.nextSibling);
  });

  grid.addEventListener('drop', (e) => e.preventDefault());

  grid.addEventListener('dragend', () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl = null;
    persistClassOrder();
  });
}

// 保存排序到服务端（顺序有变化才请求）
async function persistClassOrder() {
  const grid = $('#classesGrid');
  const ids = [...grid.querySelectorAll('.class-card')].map(c => c.dataset.id);
  if (ids.join('|') === classes.map(c => c.id).join('|')) return;
  classes = ids.map(id => classes.find(c => c.id === id)).filter(Boolean);
  try {
    const res = await fetch(`${API}/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const json = await res.json();
    if (json.code !== 0) {
      toast(json.msg || '排序保存失败', 'error');
      await loadData();
      return;
    }
    toast('排序已保存', 'success');
  } catch (e) {
    toast('排序保存失败：' + e.message, 'error');
    await loadData();
  }
}

// ===== 事件绑定 =====
function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#btnClearAll').onclick = clearAll;
  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#modalMask').onclick = (e) => { if (e.target.id === 'modalMask') closeModal(); };
  $('#clsForm').onsubmit = saveClass;
  $('#searchInput').oninput = () => { renderClasses(); saveFilters(); };
  $('#gradeFilter').onchange = () => { renderClasses(); saveFilters(); };
  $('#rosterClose').onclick = closeRoster;
  $('#rosterMask').onclick = (e) => { if (e.target.id === 'rosterMask') closeRoster(); };
  $('#btnExportRoster').onclick = exportRoster;

  $('#classesGrid').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.class-card');
    const id = card.dataset.id;
    const cls = classes.find(c => c.id === id);
    const act = btn.dataset.act;
    if (act === 'edit') openModal(cls);
    if (act === 'del') deleteClass(id);
    if (act === 'view') openRoster(cls);
  };

  $('#rosterTbody').onclick = (e) => {
    const btn = e.target.closest('[data-act="remove"]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const stuId = tr.dataset.id;
    const card = document.querySelector('.class-card');
    // 找到当前花名册对应的班级
    const title = $('#rosterTitle').textContent;
    const cls = classes.find(c => title.startsWith(c.name));
    if (cls) removeStudentFromClass(cls.id, stuId);
  };
}

bindEvents();
bindDragSort();
Promise.all([loadGradeOptions(), loadFilters()]).then(() => {
  loadData();
});
