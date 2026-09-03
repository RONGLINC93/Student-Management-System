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
  const grid = $('#gradesGrid');

  if (!grades.length) {
    grid.innerHTML = `
      <div class="empty-tip-card" id="emptyTip">
        <svg class="stage-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1 2 3 6 3s6-2 6-3v-5"/></svg>
        <p>暂无年级</p>
        <small>点击右上角「添加年级」创建年级</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = grades.map(g => {
    const unallocated = allStudents.filter(s => s.grade === g).length;
    const allocated = allClasses.filter(c => c.grade === g).reduce((sum, c) => sum + (c.students || []).length, 0);
    const total = unallocated + allocated;
    const classCount = allClasses.filter(c => c.grade === g).length;

    return `
      <div class="class-card" data-grade="${escapeHtml(g)}" draggable="true" title="拖拽调整顺序">
        <div class="class-card-header">
          <div>
            <h3 class="class-card-name">${escapeHtml(g)}</h3>
            <span class="class-card-meta">${total} 名学生 · ${classCount} 个班级</span>
          </div>
          <div class="class-card-actions">
            <button class="btn-sm btn-edit" data-act="edit" title="编辑"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
            <button class="btn-sm btn-del" data-act="del" title="删除"><svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
        <div class="class-card-stats">
          <div class="cc-stat"><span class="cc-num">${unallocated}</span><span class="cc-label">未分班</span></div>
          <div class="cc-stat"><span class="cc-num">${allocated}</span><span class="cc-label">已分班</span></div>
          <div class="cc-stat"><span class="cc-num">${classCount}</span><span class="cc-label">班级</span></div>
        </div>
      </div>
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

  if (!confirm(msg)) return;

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
  const grid = $('#gradesGrid');

  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.class-card');
    if (!card) return;
    dragEl = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', card.dataset.grade); } catch (_) {}
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
    persistGradeOrder();
  });
}

// 保存排序到服务端（顺序有变化才请求）
async function persistGradeOrder() {
  const grid = $('#gradesGrid');
  const order = [...grid.querySelectorAll('.class-card')].map(c => c.dataset.grade);
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

  $('#gradesGrid').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.class-card');
    const gradeName = card.dataset.grade;
    const act = btn.dataset.act;
    if (act === 'edit') openModal(gradeName);
    if (act === 'del') deleteGrade(gradeName);
  };
}

bindEvents();
bindDragSort();
loadData();
