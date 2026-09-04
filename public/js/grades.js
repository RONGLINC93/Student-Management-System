// 年级管理逻辑
const API = '/api/grades';
const STU_API = '/api/students';
const CLS_API = '/api/classes';
let grades = [];
let allStudents = [];
let allClasses = [];
let allStudentsWithAllocated = []; // 包含已分班学生的完整列表

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 拖拽排序手柄图标
const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="19" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="19" r="1.4" fill="currentColor" stroke="none"/></svg>';

// 加载数据
async function loadData() {
  try {
    const [gradesRes, stuRes, clsRes] = await Promise.all([
      fetch(API),
      fetch(STU_API),
      fetch(CLS_API)
    ]);
    const gradesJson = await gradesRes.json();
    const stuJson = await stuRes.json();
    const clsJson = await clsRes.json();

    grades = gradesJson.data || [];
    allStudents = stuJson.data || [];
    allClasses = clsJson.data || [];

    // 合并班级中已分班的学生，用于统计各年级学生总数
    allStudentsWithAllocated = [...allStudents];
    allClasses.forEach(c => {
      (c.students || []).forEach(s => {
        allStudentsWithAllocated.push({ ...s, grade: c.grade });
      });
    });

    renderGrades();
    updateStats();
  } catch (e) {
    toast('加载失败：' + e.message, 'error');
  }
}

// 更新统计
function updateStats() {
  const unallocated = allStudents.length;
  const allocated = allClasses.reduce((sum, c) => sum + (c.students || []).length, 0);
  $('#statTotal').textContent = grades.length;
  $('#statStudents').textContent = unallocated + allocated;
  $('#statUnallocated').textContent = unallocated;
  $('#statAllocated').textContent = allocated;
  $('#statClasses').textContent = allClasses.length;
}

// 渲染年级列表
function renderGrades() {
  const tbody = $('#gradesTbody');

  if (!grades.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-tip">
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;">暂无年级</p>
          <small>点击右上角「添加年级」创建年级</small>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = grades.map(g => {
    const unallocated = allStudents.filter(s => s.grade === g).length;
    const allocated = allClasses.filter(c => c.grade === g).reduce((sum, c) => sum + (c.students || []).length, 0);
    const total = unallocated + allocated;
    const classCount = allClasses.filter(c => c.grade === g).length;

    return `
      <tr class="data-row" data-grade="${escapeHtml(g)}" draggable="true" title="拖拽行可调整顺序">
        <td class="drag-cell">${GRIP_ICON}</td>
        <td>
          <div class="tb-name">
            <span class="tb-name-main">${escapeHtml(g)}</span>
          </div>
        </td>
        <td class="tb-num">${total}</td>
        <td><span class="st-tag st-unalloc">${unallocated}</span></td>
        <td><span class="st-tag st-alloc">${allocated}</span></td>
        <td class="tb-cls">${classCount}</td>
        <td>
          <div class="row-actions">
            <button class="btn-sm btn-edit" data-act="edit">编辑</button>
            <button class="btn-sm btn-del" data-act="del">删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 打开弹窗
function openModal(gradeName = '') {
  $('#modalTitle').textContent = gradeName ? '编辑年级' : '添加年级';
  $('#fOldName').value = gradeName;
  $('#fName').value = gradeName;
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fName').focus(), 100);
}

function closeModal() {
  $('#modalMask').classList.remove('show');
}

// 保存年级
async function saveGrade(e) {
  e.preventDefault();
  const oldName = $('#fOldName').value;
  const newName = $('#fName').value.trim();

  if (!newName) {
    toast('请输入年级名称', 'error');
    return;
  }

  try {
    const url = oldName ? `${API}/${encodeURIComponent(oldName)}` : API;
    const method = oldName ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });

    const json = await res.json();
    if (json.code !== 0) {
      toast(json.msg || '保存失败', 'error');
      return;
    }

    toast(oldName ? '修改成功' : '添加成功', 'success');
    closeModal();
    await loadData();
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
}

// 删除年级
async function deleteGrade(name) {
  const unallocated = allStudents.filter(s => s.grade === name).length;
  const allocated = allClasses.filter(c => c.grade === name).reduce((sum, c) => sum + (c.students || []).length, 0);
  const studentCount = unallocated + allocated;
  const classCount = allClasses.filter(c => c.grade === name).length;

  let msg = `确定删除年级「${name}」？`;
  if (studentCount > 0 || classCount > 0) {
    msg += `\n该年级下有 ${studentCount} 名学生（${unallocated} 名未分班，${allocated} 名已分班）和 ${classCount} 个班级，删除后他们的年级信息将被清空。`;
  }

  if (!(await confirmDlg(msg, { title: '删除年级', okText: '删除', danger: true }))) return;

  try {
    const res = await fetch(`${API}/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    const json = await res.json();
    if (json.code !== 0) {
      toast(json.msg || '删除失败', 'error');
      return;
    }
    toast('已删除', 'success');
    await loadData();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

// ===== 拖拽排序 =====
let dragEl = null;

function bindDragSort() {
  const tbody = $('#gradesTbody');

  tbody.addEventListener('dragstart', (e) => {
    const row = e.target.closest('tr.data-row');
    if (!row) return;
    dragEl = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', row.dataset.grade); } catch (_) {}
  });

  tbody.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('tr.data-row');
    if (!row || row === dragEl) return;
    // 表格布局：以鼠标相对行纵向位置判断插入到上方还是下方
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    tbody.insertBefore(dragEl, before ? row : row.nextSibling);
  });

  tbody.addEventListener('drop', (e) => e.preventDefault());

  tbody.addEventListener('dragend', () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl = null;
    persistGradeOrder();
  });
}

// 保存排序到服务端（顺序有变化才请求）
async function persistGradeOrder() {
  const tbody = $('#gradesTbody');
  const order = [...tbody.querySelectorAll('tr.data-row')].map(r => r.dataset.grade);
  if (order.join('|') === grades.join('|')) return;
  grades = order;
  try {
    const res = await fetch(`${API}/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grades: order })
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

// 事件绑定
function bindEvents() {
  $('#btnAdd').onclick = () => openModal();
  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#modalMask').onclick = (e) => { if (e.target.id === 'modalMask') closeModal(); };
  $('#gradeForm').onsubmit = saveGrade;

  $('#gradesTbody').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('tr.data-row');
    if (!row) return;
    const gradeName = row.dataset.grade;
    const act = btn.dataset.act;
    if (act === 'edit') openModal(gradeName);
    if (act === 'del') deleteGrade(gradeName);
  };
}

bindEvents();
bindDragSort();
loadData();
