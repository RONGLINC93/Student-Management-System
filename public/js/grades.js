// 年级管理逻辑
const API = '/api/grades';
const STU_API = '/api/students';
const CLS_API = '/api/classes';
let grades = [];
let allStudents = [];
let allClasses = [];
let allStudentsWithAllocated = []; // 包含已分班学生的完整列表
let selectedGrades = new Set();   // 批量删除：已勾选的年级名称

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 拖拽排序：无手柄图标，整行即可拖拽调整顺序

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
  // 清掉已不存在的勾选（年级可能已在别处被删除/改名）
  if (selectedGrades.size) {
    const valid = new Set(grades);
    [...selectedGrades].forEach(g => { if (!valid.has(g)) selectedGrades.delete(g); });
  }

  if (!grades.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-tip">
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;">暂无年级</p>
          <small>点击右上角「添加年级」创建年级</small>
        </td>
      </tr>
    `;
    syncBatchUI();
    return;
  }

  tbody.innerHTML = grades.map(g => {
    const unallocated = allStudents.filter(s => s.grade === g).length;
    const allocated = allClasses.filter(c => c.grade === g).reduce((sum, c) => sum + (c.students || []).length, 0);
    const total = unallocated + allocated;
    const classCount = allClasses.filter(c => c.grade === g).length;
    const pct = total ? Math.min(100, Math.round(allocated / total * 100)) : 0;

    return `
      <tr class="data-row" data-grade="${escapeHtml(g)}" draggable="true" title="拖拽行可调整顺序">
        <td class="td-check"><input type="checkbox" class="row-cbox" data-grade="${escapeHtml(g)}" title="勾选后可批量删除"${selectedGrades.has(g) ? ' checked' : ''} /></td>
        <td>
          <div class="tb-name">
            <span class="tb-icon tb-icon-grade" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1 2 3 6 3s6-2 6-3v-5"/></svg></span>
            <span class="tb-name-main" title="${escapeHtml(g)}">${escapeHtml(g)}</span>
          </div>
        </td>
        <td class="tb-num">${total}</td>
        <td><span class="st-tag st-unalloc">${unallocated}</span></td>
        <td><span class="st-tag st-alloc">${allocated}</span></td>
        <td class="tb-cls">${classCount}</td>
        <td>
          <div class="gp-wrap">
            <div class="gp-bar"><div class="gp-bar-fill" style="width:${pct}%"></div></div>
            <span class="gp-text">${allocated}/${total}</span>
          </div>
        </td>
        <td>
          <div class="row-actions">
            <button class="btn-sm btn-edit" data-act="edit">编辑</button>
            <button class="btn-sm btn-del" data-act="del">删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  syncBatchUI();
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

  const done = busyBtn(e && e.submitter ? e.submitter : $('#gradeForm') && $('#gradeForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
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
  } finally {
    done();
  }
}

// 删除年级（要求该年级下已无班级）
async function deleteGrade(name) {
  const classCount = allClasses.filter(c => c.grade === name).length;
  // 年级下仍有班级时不允许删除：先引导去班级管理删除班级
  if (classCount > 0) {
    const go = await confirmDlg(
      `「${name}」下还有 ${classCount} 个班级，请先在班级管理中删除这些班级，再删除年级。\n是否现在前往班级管理？`,
      { title: '无法删除年级', okText: '前往班级管理' }
    );
    if (go) location.href = 'classes.html';
    return;
  }
  const unallocated = allStudents.filter(s => s.grade === name).length;

  let msg = `确定删除年级「${name}」？`;
  if (unallocated) {
    msg += `\n该年级下还有 ${unallocated} 名未分班学生，删除后他们的年级信息将被清空。`;
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

// ===== 批量删除 =====
// 同步「批量删除」按钮与表头全选框的状态（数量、可用性、半选）
function syncBatchUI() {
  const btn = $('#btnBatchDel');
  const n = selectedGrades.size;
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n ? `批量删除（${n}）` : '批量删除';
  }
  const all = $('#ckAll');
  if (!all) return;
  const boxes = [...$$('#gradesTbody tr.data-row .row-cbox')];
  const sel = boxes.filter(b => b.checked).length;
  all.disabled = boxes.length === 0;
  all.checked = boxes.length > 0 && sel === boxes.length;
  all.indeterminate = sel > 0 && sel < boxes.length;
}

// 行首勾选变化
function onRowCheckChange(e) {
  const cb = e.target;
  if (!cb.classList || !cb.classList.contains('row-cbox')) return;
  const name = cb.dataset.grade;
  if (!name) return;
  if (cb.checked) selectedGrades.add(name);
  else selectedGrades.delete(name);
  syncBatchUI();
}

// 表头全选：仅作用于当前列表中的行
function onCheckAllChange() {
  const all = $('#ckAll');
  if (!all) return;
  const on = all.checked;
  $$('#gradesTbody tr.data-row').forEach(tr => {
    const cb = tr.querySelector('.row-cbox');
    if (!cb) return;
    cb.checked = on;
    if (on) selectedGrades.add(tr.dataset.grade);
    else selectedGrades.delete(tr.dataset.grade);
  });
  syncBatchUI();
}

// 批量删除：所选年级下学生 / 班级 / 考试 / 考勤的年级字段一并清空
async function batchDeleteGrades() {
  const names = [...selectedGrades];
  if (!names.length) { toast('请先勾选要删除的年级', 'error'); return; }
  const list = names.filter(g => grades.includes(g));
  if (!list.length) { toast('所选年级已不存在，请刷新后重试', 'error'); return; }
  // 年级下仍有班级时不允许删除：先引导去班级管理
  const blocked = list.filter(g => allClasses.some(c => c.grade === g));
  if (blocked.length) {
    const detail = blocked.slice(0, 3)
      .map(g => `「${g}」（${allClasses.filter(c => c.grade === g).length} 个班级）`).join('、')
      + (blocked.length > 3 ? ` 等 ${blocked.length} 个年级` : '');
    const go = await confirmDlg(
      `${detail}下还有班级，请先在班级管理中删除这些班级，再删除年级。\n是否现在前往班级管理？`,
      { title: '无法删除年级', okText: '前往班级管理' }
    );
    if (go) location.href = 'classes.html';
    return;
  }
  const stuCount = list.reduce((sum, g) => sum + allStudents.filter(s => s.grade === g).length, 0);
  const label = list.slice(0, 3).map(g => `「${g}」`).join('、')
    + (list.length > 3 ? ` 等 ${list.length} 个年级` : '');
  let msg = `确定删除 ${label}？`;
  if (stuCount) {
    msg += `\n该范围下还有 ${stuCount} 名未分班学生，删除后他们的年级信息将被清空。`;
  }
  if (!(await confirmDlg(msg, { title: '批量删除年级', okText: '删除', danger: true }))) return;
  const done = busyBtn($('#btnBatchDel'), '删除中…');
  if (!done) return;
  try {
    const res = await fetch(`${API}/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: list })
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '删除失败', 'error'); return; }
    toast(json.msg || '已删除', 'success');
    selectedGrades.clear();
    await loadData();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  } finally { done(); }
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
  $('#gradeForm').onsubmit = saveGrade;

  // 批量删除：表头全选 / 行首勾选 / 工具栏按钮
  $('#ckAll').onchange = onCheckAllChange;
  $('#gradesTbody').onchange = onRowCheckChange;
  $('#btnBatchDel').onclick = batchDeleteGrades;

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

// 工作台切回本页时的静默刷新（embed.js 优先调用本回调）；拖拽排序过程中不打断
window.cbEmbedRefresh = function () {
  if (dragEl) return;
  loadData();
};
