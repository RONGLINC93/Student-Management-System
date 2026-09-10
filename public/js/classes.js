// 班级管理逻辑
const API = '/api/classes';
const STU_API = '/api/students';
const GRADES_API = '/api/grades';
const FILTERS_API = '/api/filters';
const TEA_API = '/api/teachers';
let classes = [];
let teacherList = []; // 教师列表，班主任下拉选项引用该列表
let poolCount = 0;
let rosterClassId = ''; // 当前打开花名册的班级 id（导出/退生以 id 精确对应，避免按班级名匹配出错）
let gradesList = [];
let poolStudents = []; // 学生池明细（批量入班弹窗候选）
let batchClass = null;  // 批量入班的目标班级
let batchSelected = new Set(); // 已勾选的学生 id
let batchEligible = 0;  // 学生池中可加入当前班级的人数（不含关键字过滤）
let batchHidden = 0;    // 学生池中因不符合条件（年级不符等）被隐藏的人数
let batchStartTouched = false; // 添加班级-批量模式：用户是否手动改过起始序号（改过则不再自动推荐）
let selectedIds = new Set();   // 批量删除：已勾选的班级 id

const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 拖拽排序：无手柄图标，整行即可拖拽调整顺序
// 学生当前总分：按生效科目配置求和（site.js 注入 window.subjTotal）
function totalScore(s) {
  const r = window.subjTotal(s);
  return r.total;
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
    const [clsRes, stuRes, teaRes] = await Promise.all([
      fetch(API), fetch(STU_API), fetch(TEA_API).catch(() => null)
    ]);
    const clsJson = await clsRes.json();
    const stuJson = await stuRes.json();
    if (teaRes && teaRes.ok) {
      const teaJson = await teaRes.json();
      teacherList = teaJson.data || [];
    } else {
      teacherList = [];
    }
    classes = clsJson.data || [];
    poolStudents = stuJson.data || [];
    poolCount = poolStudents.length;
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
  const tbody = $('#classesTbody');
  // 清掉已不存在的勾选（班级可能已在别处被删除）
  if (selectedIds.size) {
    const valid = new Set(classes.map(c => c.id));
    [...selectedIds].forEach(id => { if (!valid.has(id)) selectedIds.delete(id); });
  }
  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-tip">
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;">暂无班级</p>
          <small>点击右上角「添加班级」创建班级，或前往「智能分班」一键分班</small>
        </td>
      </tr>`;
    syncBatchUI();
    return;
  }
  tbody.innerHTML = list.map(c => {
    const count = c.students?.length || 0;
    const cap = Number(c.capacity) || 50;
    const pct = cap ? Math.min(100, Math.round(count / cap * 100)) : 0;
    const male = (c.students || []).filter(s => s.gender === '男').length;
    const female = count - male;
    const avg = count ? (c.students.reduce((a, s) => a + totalScore(s), 0) / count).toFixed(1) : '—';
    return `
      <tr class="data-row" data-id="${c.id}" draggable="true" title="拖拽行可调整顺序">
        <td class="td-check"><input type="checkbox" class="row-cbox" data-id="${c.id}" title="勾选后可批量删除"${selectedIds.has(c.id) ? ' checked' : ''} /></td>
        <td>
          <div class="tb-name">
            <span class="tb-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/></svg></span>
            <span class="tb-name-main" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
          </div>
        </td>
        <td class="tb-grade">${c.grade ? `<span class="roster-tag">${escapeHtml(c.grade)}</span>` : '<span class="dim-text">未分年级</span>'}</td>
        <td class="tb-teacher">${c.headTeacher ? escapeHtml(c.headTeacher) : '<span class="dim-text">未设置</span>'}</td>
        <td class="tb-num">${count}</td>
        <td>
          <span class="g-tag g-male">男 ${male}</span>
          <span class="g-tag g-female">女 ${female}</span>
        </td>
        <td class="tb-score">${avg}</td>
        <td>
          <div class="cap-wrap">
            <div class="cc-bar"><div class="cc-bar-fill" style="width:${pct}%"></div></div>
            <span class="cc-cap-text">${count}/${cap}</span>
          </div>
        </td>
        <td>
          <div class="row-actions">
            <button class="btn-sm btn-view" data-act="view">花名册</button>
            <button class="btn-sm btn-assign" data-act="batchadd" title="从学生池多选学生一次加入本班">批量入班</button>
            <button class="btn-sm btn-edit" data-act="edit">编辑</button>
            <button class="btn-sm btn-del" data-act="del">删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  syncBatchUI();
}

// 班主任下拉：引用教师列表中的教师（以教师档案的班主任归属 classId 为准）
// - 当前班级在任的班主任教师可被重新选中
// - 已担任其他班级班主任的教师置灰不可选，避免一位教师兼任多班
function renderHeadTeacherOptions(cls) {
  const sel = $('#fHeadTeacher');
  if (!sel) return;
  const curId = cls ? cls.id : '';
  const nameOf = {};
  classes.forEach(c => { nameOf[c.id] = c.name; });
  const curHead = teacherList.find(t => t.classId === curId);
  let html = '<option value="">未设置</option>';
  teacherList.forEach(t => {
    if (t.classId === curId) return; // 当前在任班主任放在下拉首项
    const subject = (t.subject || '').trim();
    const label = t.name + (subject ? ' · ' + subject : '') + (t.classId ? '（现任' + (nameOf[t.classId] || '其他班') + '班主任）' : '');
    html += `<option value="${escapeHtml(t.name)}" ${t.classId ? 'disabled' : ''}>${escapeHtml(label)}</option>`;
  });
  if (curHead) {
    const subject = (curHead.subject || '').trim();
    const label = curHead.name + (subject ? ' · ' + subject : '') + '（在任）';
    html = `<option value="${escapeHtml(curHead.name)}">${escapeHtml(label)}</option>` + html;
  }
  sel.innerHTML = html;
  sel.value = curHead ? curHead.name : '';
}

// ===== 班级编辑弹窗 =====
function openModal(cls) {
  const isEdit = !!cls;
  $('#modalTitle').textContent = isEdit ? '编辑班级' : '添加班级';
  $('#fId').value = isEdit ? cls.id : '';
  $('#fName').value = isEdit ? cls.name : '';
  $('#fName').required = isEdit;         // 新增时名称可留空（留空即批量生成）
  $('#fGrade').value = isEdit ? cls.grade : (gradesList[0] || '');
  renderHeadTeacherOptions(cls);
  $('#fCapacity').value = isEdit ? cls.capacity : 50;
  // 新增：数量默认 6，起始序号按当前年级已有班级推荐
  batchStartTouched = false;
  $('#fCount').value = 6;
  syncAddForm();
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fName').focus(), 100);
}
function closeModal() { $('#modalMask').classList.remove('show'); }

async function saveClass(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const name = $('#fName').value.trim();
  // 新增且未填名称 → 按「年级 + 起始序号 + 数量」批量生成
  if (!id && !name) { await saveBatchClasses(e); return; }
  const data = {
    name,
    grade: $('#fGrade').value,
    headTeacher: $('#fHeadTeacher').value.trim(),
    capacity: $('#fCapacity').value
  };
  if (!data.name) { toast('请输入班级名称', 'error'); return; }
  const done = busyBtn(e && e.submitter ? e.submitter : $('#clsForm') && $('#clsForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
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
  } finally {
    done();
  }
}

// ===== 批量添加班级（年级 + 序号 + 班，一次生成多个） =====
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 名称留空 → 按「年级 + 起始序号 + 数量」批量生成；填了名称 → 只创建这一个自定义班级
function syncAddForm() {
  const isEdit = !!$('#fId').value;
  const name = $('#fName').value.trim();
  const batch = !isEdit && !name;
  $('#rowStartNo').hidden = isEdit;   // 编辑班级时只有名称/年级/班主任/容量
  $('#rowCount').hidden = isEdit;
  $('#rowPreview').hidden = isEdit;
  $('#fStartNo').disabled = !batch;   // 自定义名称时序号/数量不生效，置灰避免误解
  $('#fCount').disabled = !batch;
  const submitBtn = $('#clsForm').querySelector('button[type="submit"]');
  if (submitBtn && !submitBtn.querySelector('svg')) submitBtn.textContent = batch ? '批量创建' : '保存';
  if (isEdit) return;
  if (batch) {
    if (!batchStartTouched) $('#fStartNo').value = suggestStartNo($('#fGrade').value);
    renderBatchPreview();
  } else {
    renderSinglePreview(name);
  }
}

// 自定义名称时的预览（只创建这一个班级）
function renderSinglePreview(name) {
  const box = $('#batchPreview');
  if (!box) return;
  box.innerHTML = `
    <div class="bp-names"><span class="bp-chip">${escapeHtml(name)}</span></div>
    <div class="bp-tip">将新建 <b>1</b> 个自定义班级（可设置班主任）；若要一次建多个，清空班级名称即可按序号批量生成</div>
  `;
}

// 按已有班级名（年级+序号+班）推荐下一个可用序号，方便接着往后编号
function suggestStartNo(grade) {
  const g = String(grade || '').trim();
  if (!g) return 1;
  const re = new RegExp('^' + escapeRegExp(g) + '(\\d+)班$');
  let max = 0;
  classes.forEach(c => {
    const m = String(c.name || '').trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  });
  return max + 1;
}

// 待生成的班级名称列表
function batchNames() {
  const grade = String($('#fGrade').value || '').trim();
  const start = Math.max(1, parseInt($('#fStartNo').value, 10) || 1);
  const count = Math.min(60, Math.max(1, parseInt($('#fCount').value, 10) || 1));
  const names = [];
  for (let i = 0; i < count; i++) names.push(`${grade}${start + i}班`);
  return names;
}

// 预览将创建的班级名，同名班级标红提示会自动跳过
function renderBatchPreview() {
  const box = $('#batchPreview');
  if (!box) return;
  const grade = String($('#fGrade').value || '').trim();
  if (!grade) { box.innerHTML = '<div class="bp-tip">请先选择年级</div>'; return; }
  const exist = new Set(classes.map(c => String(c.name || '').trim()));
  const names = batchNames();
  const dup = names.filter(n => exist.has(n)).length;
  box.innerHTML = `
    <div class="bp-names">${names.map(n => `<span class="bp-chip${exist.has(n) ? ' dup' : ''}">${escapeHtml(n)}</span>`).join('')}</div>
    <div class="bp-tip">共 ${names.length} 个，将新建 <b>${names.length - dup}</b> 个${dup ? `，${dup} 个已存在会自动跳过` : ''}（命名规则：年级 + 序号 + 班）</div>
  `;
}

// 提交批量添加
async function saveBatchClasses(e) {
  const grade = String($('#fGrade').value || '').trim();
  if (!grade) { toast('请选择年级', 'error'); return; }
  const start = Math.max(1, parseInt($('#fStartNo').value, 10) || 1);
  const count = Math.min(60, Math.max(1, parseInt($('#fCount').value, 10) || 1));
  const exist = new Set(classes.map(c => String(c.name || '').trim()));
  if (!batchNames().some(n => !exist.has(n))) {
    toast('这些班级都已存在，无需重复创建', 'error');
    return;
  }
  const submitBtn = (e && e.submitter) || $('#clsForm').querySelector('button[type="submit"]');
  const done = busyBtn(submitBtn, '创建中…');
  if (!done) return;
  try {
    const res = await fetch(`${API}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade, start, count, capacity: $('#fCapacity').value })
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '批量添加失败', 'error'); return; }
    const created = (json.data && json.data.created ? json.data.created.length : 0);
    const skipped = (json.data && json.data.skipped ? json.data.skipped.length : 0);
    toast(`已添加 ${created} 个班级${skipped ? `，${skipped} 个同名班级已跳过` : ''}`, 'success');
    closeModal();
    await loadData();
  } catch (err) {
    toast('批量添加失败：' + err.message, 'error');
  } finally {
    done();
  }
}

async function deleteClass(id) {
  const cls = classes.find(c => c.id === id);
  if (!cls) return;
  const cnt = cls.students?.length || 0;
  // 班级内仍有学生时不允许删除：先引导去花名册把学生全部退回学生池
  if (cnt) {
    const go = await confirmDlg(
      `「${cls.name}」内还有 ${cnt} 名学生，请先在花名册中「全部退回」学生池，再删除班级。\n是否现在打开花名册？`,
      { title: '无法删除班级', okText: '打开花名册' }
    );
    if (go) openRoster(cls);
    return;
  }
  if (!(await confirmDlg(`确定删除班级「${cls.name}」？`, { title: '删除班级', okText: '删除', danger: true }))) return;
  try {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (json.code !== 0) { toast(json.msg || '删除失败', 'error'); return; }
    toast(json.msg || '已删除', 'success');
    await loadData();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

// ===== 批量删除 =====
// 同步「批量删除」按钮与表头全选框的状态（数量、可用性、半选）
function syncBatchUI() {
  const btn = $('#btnBatchDel');
  const n = selectedIds.size;
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n ? `批量删除（${n}）` : '批量删除';
  }
  const all = $('#ckAll');
  if (!all) return;
  const boxes = [...document.querySelectorAll('#classesTbody tr.data-row .row-cbox')];
  const sel = boxes.filter(b => b.checked).length;
  all.disabled = boxes.length === 0;
  all.checked = boxes.length > 0 && sel === boxes.length;
  all.indeterminate = sel > 0 && sel < boxes.length;
}

// 行首勾选变化
function onRowCheckChange(e) {
  const cb = e.target;
  if (!cb.classList || !cb.classList.contains('row-cbox')) return;
  const id = cb.dataset.id;
  if (!id) return;
  if (cb.checked) selectedIds.add(id);
  else selectedIds.delete(id);
  syncBatchUI();
}

// 表头全选：仅作用于当前列表（搜索/筛选后即可见行）
function onCheckAllChange() {
  const all = $('#ckAll');
  if (!all) return;
  const on = all.checked;
  document.querySelectorAll('#classesTbody tr.data-row').forEach(tr => {
    const cb = tr.querySelector('.row-cbox');
    if (!cb) return;
    cb.checked = on;
    if (on) selectedIds.add(tr.dataset.id);
    else selectedIds.delete(tr.dataset.id);
  });
  syncBatchUI();
}

// 批量删除：仅允许删除已清空学生的班级，并解除相关班主任归属
async function batchDeleteClasses() {
  const ids = [...selectedIds];
  if (!ids.length) { toast('请先勾选要删除的班级', 'error'); return; }
  const list = ids.map(id => classes.find(c => c.id === id)).filter(Boolean);
  if (!list.length) { toast('所选班级已不存在，请刷新后重试', 'error'); return; }
  // 班级内仍有学生时不允许删除：先引导去花名册退回学生
  const blocked = list.filter(c => (c.students?.length || 0) > 0);
  if (blocked.length) {
    const detail = blocked.slice(0, 3).map(c => `「${c.name}」（${c.students.length} 人）`).join('、')
      + (blocked.length > 3 ? ` 等 ${blocked.length} 个班级` : '');
    const go = await confirmDlg(
      `${detail}内还有学生，请先在花名册中「全部退回」学生池，再删除班级。\n是否现在打开花名册？`,
      { title: '无法删除班级', okText: '打开花名册' }
    );
    if (go) openRoster(blocked[0]);
    return;
  }
  const names = list.slice(0, 3).map(c => `「${c.name}」`).join('、')
    + (list.length > 3 ? ` 等 ${list.length} 个班级` : '');
  if (!(await confirmDlg(`确定删除 ${names}？`, { title: '批量删除班级', okText: '删除', danger: true }))) return;
  const done = busyBtn($('#btnBatchDel'), '删除中…');
  if (!done) return;
  try {
    const res = await fetch(`${API}/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '删除失败', 'error'); return; }
    toast(json.msg || '已删除', 'success');
    selectedIds.clear();
    await loadData();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  } finally {
    done();
  }
}

// ===== 花名册弹窗 =====
function openRoster(cls) {
  rosterClassId = cls.id;
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
    tbody.innerHTML = `<tr><td colspan="7" class="empty-tip">该班级暂无学生，可在班级列表点击「批量入班」从学生池一次加入多名学生，或前往「智能分班」自动分配</td></tr>`;
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
function closeRoster() {
  rosterClassId = '';
  $('#rosterMask').classList.remove('show');
}

// 导出花名册为 CSV
function exportRoster() {
  const cls = classes.find(c => c.id === rosterClassId);
  if (!cls || !cls.students?.length) {
    toast('暂无学生数据可导出', 'error');
    return;
  }

  // CSV 表头（科目列动态）
  const subs = window.SUBJECTS || [];
  const headers = ['学号', '姓名', '性别', ...subs.map(sj => sj.name), '总分', '特长'];
  const rows = cls.students.map(s => [
    s.studentId || '',
    s.name || '',
    s.gender || '',
    ...subs.map(sj => {
      const v = window.stuScore(s, sj.key);
      return v === null ? '' : v;
    }),
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

// 整班退回：将该班所有学生退回学生池（班级保留，便于重新分班）
async function returnAllStudents() {
  const cls = classes.find(c => c.id === rosterClassId);
  if (!cls) return;
  const cnt = cls.students?.length || 0;
  if (!cnt) { toast('该班暂无学生', 'error'); return; }
  if (!(await confirmDlg(`确定将「${cls.name}」的 ${cnt} 名学生全部退回学生池吗？`, { title: '整班退回', okText: '退回', danger: true }))) return;
  const done = busyBtn($('#btnReturnAll'), '退回中…');
  if (!done) return;
  try {
    await fetch(`${API}/${cls.id}/return-all`, { method: 'POST' });
    toast('已全部退回学生池', 'success');
    await loadData();
    const fresh = classes.find(c => c.id === cls.id);
    if (fresh) openRoster(fresh);
    else closeRoster();
  } catch (e) {
    toast('操作失败：' + e.message, 'error');
  } finally { done(); }
}

// ===== 批量入班（学生池多选加入本班） =====
// 学生能否加入当前班级：班级未设年级 → 均可；否则学生未设年级或与本班同年级 → 可加入
function batchCanAdd(stu) {
  const clsGrade = String(batchClass?.grade || '').trim();
  if (!clsGrade) return true;
  const g = String(stu.grade || '').trim();
  return !g || g === clsGrade;
}
function batchRemain() {
  const cap = Number(batchClass?.capacity) || 0;
  const cur = (batchClass?.students || []).length;
  return cap > 0 ? Math.max(0, cap - cur) : Infinity;
}
async function openBatchDlg(clsId) {
  const cls = classes.find(c => c.id === clsId);
  if (!cls) return;
  // 打开前刷新学生池，保证候选是最新的
  try {
    const res = await fetch(STU_API);
    const j = await res.json();
    poolStudents = (j && j.data) || [];
  } catch (e) {
    toast('加载学生池失败：' + e.message, 'error');
    return;
  }
  batchClass = cls;
  batchSelected.clear();
  $('#batchTitle').textContent = `批量入班：「${cls.name}」`;
  const cap = Number(cls.capacity) || 0;
  const cur = (cls.students || []).length;
  const remain = cap > 0 ? Math.max(0, cap - cur) : Infinity;
  $('#batchInfo').innerHTML = [
    `<span class="roster-tag">${escapeHtml(cls.grade || '未设年级')}</span>`,
    `<span class="roster-tag">当前 ${cur} / ${cap || '不限'}</span>`,
    cap > 0 && remain === 0 ? '<span class="roster-tag" style="background:#fee2e2;color:#991b1b;">已满员</span>' : ''
  ].join('');
  $('#batchSearch').value = '';
  const allCk = $('#batchAll');
  if (allCk) allCk.checked = false;
  renderBatchList();
  $('#batchMask').classList.add('show');
  setTimeout(() => { const inp = $('#batchSearch'); if (inp) inp.focus(); }, 120);
}
function closeBatchDlg() {
  batchClass = null;
  batchSelected.clear();
  $('#batchMask').classList.remove('show');
}
function renderBatchList() {
  const tbody = $('#batchTbody');
  if (!batchClass || !tbody) return;
  const kw = ($('#batchSearch').value || '').trim().toLowerCase();
  const inCls = new Set((batchClass.students || []).map(s => s.id));
  const poolAvail = poolStudents.filter(s => !inCls.has(s.id)); // 未分班候选
  // 仅展示符合入班条件的学生；年级不符等不符合条件的一律隐藏
  batchHidden = poolAvail.filter(s => !batchCanAdd(s)).length;
  batchEligible = poolAvail.length - batchHidden;
  const list = poolAvail.filter(s => {
    if (!batchCanAdd(s)) return false;
    if (!kw) return true;
    return (s.studentId || '').toLowerCase().includes(kw) || (s.name || '').toLowerCase().includes(kw);
  });
  if (!poolAvail.length || !list.length) {
    let tipTxt;
    if (!poolAvail.length) {
      tipTxt = '学生池暂无未分班学生，请先在「学生档案」添加学生或把学生退回学生池';
    } else if (batchEligible === 0) {
      tipTxt = `学生池中没有符合「${batchClass.name}」入班条件的未分班学生${batchHidden ? `（另有 ${batchHidden} 名因年级不符已隐藏）` : ''}`;
    } else {
      tipTxt = '没有匹配搜索的可加入学生';
    }
    tbody.innerHTML = `<tr><td colspan="7" class="empty-tip">${tipTxt}</td></tr>`;
    updateBatchSave();
    return;
  }
  const clsGrade = String(batchClass.grade || '').trim();
  tbody.innerHTML = list.map(s => {
    const gradeTxt = String(s.grade || '').trim();
    // 学生原本未设年级且班级已设年级 → 入班时按本班年级补填
    const note = (!gradeTxt && clsGrade) ? '入班按本班年级' : '学生池';
    return `
      <tr class="batch-row" data-id="${escapeHtml(s.id)}">
        <td><input type="checkbox" class="batch-cbox" data-id="${escapeHtml(s.id)}" ${batchSelected.has(s.id) ? 'checked' : ''} /></td>
        <td><div class="avatar">${photoHtml(s)}</div></td>
        <td class="stu-id">${escapeHtml(s.studentId || '—')}</td>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td><span class="gender-tag ${s.gender === '男' ? 'gender-male' : 'gender-female'}">${escapeHtml(s.gender || '—')}</span></td>
        <td>${gradeTxt ? `<span class="roster-tag">${escapeHtml(gradeTxt)}</span>` : '<span class="dim-text">未设年级</span>'}</td>
        <td>${note}</td>
      </tr>`;
  }).join('');
  updateBatchSave();
}
// 勾选变化：限制不超过剩余名额
function onBatchTbodyChange(e) {
  const cb = e.target;
  if (!cb.classList || !cb.classList.contains('batch-cbox') || cb.disabled) return;
  const id = cb.dataset.id;
  if (!id || !batchClass) return;
  if (cb.checked) {
    const remain = batchRemain();
    if (batchSelected.size >= remain) {
      cb.checked = false;
      toast(`「${batchClass.name}」仅剩 ${remain} 个名额`, 'error');
      return;
    }
    batchSelected.add(id);
  } else {
    batchSelected.delete(id);
  }
  updateBatchSave();
}
function onBatchAllChange() {
  const ck = $('#batchAll');
  if (!ck || !batchClass) return;
  const boxes = [...document.querySelectorAll('#batchTbody input.batch-cbox:not(:disabled)')];
  const remain = batchRemain();
  if (ck.checked) {
    for (const box of boxes) {
      if (batchSelected.size >= remain) { box.checked = false; continue; }
      if (!box.checked) {
        box.checked = true;
        batchSelected.add(box.dataset.id);
      }
    }
  } else {
    boxes.forEach(box => {
      box.checked = false;
      batchSelected.delete(box.dataset.id);
    });
  }
  updateBatchSave();
}
function updateBatchSave() {
  const save = $('#batchSave');
  const tip = $('#batchTip');
  const n = batchSelected.size;
  if (!save) return;
  save.disabled = n === 0;
  save.textContent = n > 0 ? `确认入班（已选 ${n} 人）` : '确认入班';
  if (!batchClass) return;
  const remain = batchRemain();
  let msg = '';
  const clsGrade = String(batchClass.grade || '').trim();
  if (remain === 0) {
    msg = `「${batchClass.name}」已满员，不能再加入学生。`;
  } else if (batchEligible === 0) {
    msg = `学生池中没有可加入「${batchClass.name}」的未分班学生${clsGrade ? `（仅限「${clsGrade}」年级或未设年级）` : ''}。`;
  } else {
    msg = `可从学生池勾选学生加入，本次最多可加入 ${remain} 人${clsGrade ? `（仅限「${clsGrade}」年级或未设年级）` : ''}。`;
  }
  if (batchHidden > 0 && batchEligible > 0) msg += `另有 ${batchHidden} 名因年级不符已隐藏。`;
  if (n > 0) msg = `已选 ${n} 人。` + msg;
  if (tip) tip.textContent = msg;
}
async function doBatchAdd() {
  const cls = batchClass;
  if (!cls) return;
  const ids = [...batchSelected];
  if (!ids.length) { toast('请先勾选要加入的学生', 'error'); return; }
  const save = $('#batchSave');
  if (save) save.disabled = true;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(cls.id)}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: ids })
    });
    const j = await res.json();
    if (j.code !== 0) { toast(j.msg || '入班失败', 'error'); closeBatchDlg(); return; }
    toast(j.msg || '已入班', 'success');
    closeBatchDlg();
    await loadData();
  } catch (e) {
    toast('操作失败：' + e.message, 'error');
    if (save) save.disabled = false;
  }
}

// ===== 拖拽排序 =====
let dragEl = null;

function bindDragSort() {
  const tbody = $('#classesTbody');

  tbody.addEventListener('dragstart', (e) => {
    const row = e.target.closest('tr.data-row');
    if (!row) return;
    // 有筛选/搜索时只展示了部分班级，禁止拖拽排序
    if (($('#searchInput').value || '').trim() || $('#gradeFilter')?.value) {
      toast('请先清除筛选/搜索条件，再拖拽排序', 'error');
      e.preventDefault();
      return;
    }
    dragEl = row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', row.dataset.id); } catch (_) {}
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
    persistClassOrder();
  });
}

// 保存排序到服务端（顺序有变化才请求）
async function persistClassOrder() {
  const tbody = $('#classesTbody');
  const ids = [...tbody.querySelectorAll('tr.data-row')].map(r => r.dataset.id);
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
  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#clsForm').onsubmit = saveClass;
  // 添加班级弹窗：名称留空即按序号批量生成，输入时实时预览
  $('#fName').oninput = syncAddForm;
  $('#fStartNo').oninput = () => { batchStartTouched = true; syncAddForm(); };
  $('#fCount').oninput = syncAddForm;
  $('#fGrade').onchange = syncAddForm;
  $('#searchInput').oninput = () => { renderClasses(); saveFilters(); };
  $('#gradeFilter').onchange = () => { renderClasses(); saveFilters(); };
  // 批量删除：表头全选 / 行首勾选 / 工具栏按钮
  $('#ckAll').onchange = onCheckAllChange;
  $('#classesTbody').onchange = onRowCheckChange;
  $('#btnBatchDel').onclick = batchDeleteClasses;
  $('#rosterClose').onclick = closeRoster;
  $('#btnExportRoster').onclick = exportRoster;
  $('#btnReturnAll').onclick = returnAllStudents;

  // 批量入班弹窗
  $('#batchClose').onclick = closeBatchDlg;
  $('#batchCancel').onclick = closeBatchDlg;
  $('#batchSearch').oninput = renderBatchList;
  $('#batchAll').onchange = onBatchAllChange;
  $('#batchTbody').onchange = onBatchTbodyChange;
  $('#batchSave').onclick = doBatchAdd;

  $('#classesTbody').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('tr.data-row');
    if (!row) return;
    const id = row.dataset.id;
    const cls = classes.find(c => c.id === id);
    const act = btn.dataset.act;
    if (act === 'edit') openModal(cls);
    if (act === 'del') deleteClass(id);
    if (act === 'view') openRoster(cls);
    if (act === 'batchadd') openBatchDlg(id);
  };

  $('#rosterTbody').onclick = async (e) => {
    const btn = e.target.closest('[data-act="remove"]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const stuId = tr.dataset.id;
    if (!rosterClassId) return;
    const done = busyBtn(btn, '处理中…');
    if (!done) return;
    try { await removeStudentFromClass(rosterClassId, stuId); }
    finally { done(); }
  };
}

bindEvents();
bindDragSort();
Promise.all([loadGradeOptions(), loadFilters()]).then(() => {
  loadData();
});

// 工作台切回本页时的静默刷新（embed.js 优先调用本回调）
// 先重建年级下拉（可能在其他选项卡中增删/改名），再刷新班级数据；拖拽排序过程中不打断
window.cbEmbedRefresh = function () {
  if (dragEl) return;
  Promise.resolve(typeof loadGradeOptions === 'function' ? loadGradeOptions() : null)
    .then(() => { loadData(); });
};
