// 人事管理 - 教师人事异动台账
const HR_API = '/api/hr';
const TEA_API = '/api/teachers';
const LOG_API = '/api/logistics';
const PERM_API = '/api/position-perms';
let records = [];
let teachers = [];
// 职位权限矩阵（职务名 → 登录身份 + 可管理模块）
let permRoles = [];
let permModules = [];
const OFF_DUTY = ['离职', '退休'];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function todayStr() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function fmtTime(iso) {
  const s = String(iso || '');
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// 按「职位权限设置」判定是否可登记 / 编辑人事异动：管理员全量；职务账号需被授权 hr 模块
// （服务端同样按模块拦截写接口，此处仅为前端提示与隐藏）
function canWrite() {
  const a = window.AUTH;
  if (!a) return true;
  if (a.role === 'admin') return true;
  return Array.isArray(a.writable) && a.writable.includes('hr');
}
// 未授权时页面只读：隐藏「登记异动」与行内编辑 / 删除，并给出说明
function applyWriteScope() {
  if (canWrite()) return;
  const add = $('#btnAdd');
  if (add) add.style.display = 'none';
  const deptBtn = $('#btnAddDept');
  if (deptBtn) deptBtn.style.display = 'none';
  document.querySelectorAll('.row-actions').forEach(el => { el.remove(); });
  const main = document.querySelector('main.container');
  if (main && !$('#hrReadonly')) {
    const tip = document.createElement('div');
    tip.id = 'hrReadonly';
    tip.className = 'hr-tip warn';
    tip.style.marginBottom = '12px';
    tip.textContent = '当前账号仅可查看人事异动台账；登记 / 修改需管理员在「系统设置 → 职位权限」中为该职务勾选「人事管理」模块。';
    main.insertBefore(tip, main.firstChild);
  }
}
function typeClass(type) {
  if (type === '入职' || type === '转正') return 'type-in';
  if (type === '离职' || type === '退休') return 'type-out';
  if (type === '调岗' || type === '晋升' || type === '职称变动' || type === '借调') return 'type-move';
  return 'type-other';
}
function statusClass(st) {
  if (OFF_DUTY.indexOf(st) !== -1) return 'st-off';
  return st === '在职' ? 'st-on' : 'st-warn';
}

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
}
function moduleNames(keys) {
  const names = permModules.filter(m => (keys || []).indexOf(m.key) !== -1).map(m => m.name);
  return names.length ? names.join('、') : '无';
}
// 按职务名匹配权限条目（与服务端精确匹配分支一致）
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
// 教师当前生效的权限描述（服务端已在 /api/hr 下发 curPosition 等快照，此处按职务实时计算）
function teacherPermDesc(t) {
  if (!t) return '无后台权限（仅教师端）';
  if (OFF_DUTY.indexOf(t.status || '在职') !== -1) return '无后台权限（已离岗）';
  return permDesc(matchPerm(t.position));
}
function hrWritesPosition(type) {
  return ['调岗', '晋升', '入职', '转正', '其他'].indexOf(type) !== -1;
}
// 权限变更预警：职务变化会同步改变后台身份与可管理范围
function updatePermWarn(t) {
  const warn = $('#permWarn');
  const ackBox = $('#permAckBox');
  const ack = $('#permAck');
  if (!warn || !ackBox) return;
  const type = $('#fType').value;
  const after = String($('#fAfter').value || '').trim();
  if (!t || !hrWritesPosition(type) || !after) {
    warn.hidden = true; ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  const before = teacherPermDesc(t);
  const now = permDesc(matchPerm(after));
  if (before === now) {
    warn.hidden = true; ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  warn.hidden = false;
  warn.innerHTML = '该异动会把「<b>' + escapeHtml(t.name) + '</b>」的行政职务改为「<b>' + escapeHtml(after)
    + '</b>」，其后台权限将由 <b>' + escapeHtml(before) + '</b> 变为 <b>' + escapeHtml(now)
    + '</b>。请确认这是本次调岗 / 晋升的真实授权意图。';
  ackBox.hidden = false;
}

function renderTeacherSelect(keep) {
  const sel = $('#fTeacher');
  if (!sel) return;
  sel.innerHTML = teachers.map(t =>
    `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}${t.teacherNo ? '（' + escapeHtml(t.teacherNo) + '）' : ''}</option>`
  ).join('');
  if (keep && teachers.some(t => t.id === keep)) sel.value = keep;
}

// 年份筛选：按已有记录的生效年份重建
function renderYearFilter() {
  const sel = $('#yearFilter');
  if (!sel) return;
  const cur = sel.value;
  const years = [...new Set(records.map(r => String(r.date || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  sel.innerHTML = '<option value="">全部年份</option>'
    + years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)} 年</option>`).join('');
  if (cur && years.indexOf(cur) !== -1) sel.value = cur;
}

function renderTable() {
  const kw = ($('#kw').value || '').trim().toLowerCase();
  const type = $('#typeFilter').value;
  const year = $('#yearFilter').value;
  let list = records.slice();
  if (kw) {
    list = list.filter(r =>
      [r.teacherName, r.teacherNo, r.before, r.after, r.department, r.reason, r.remark, r.operator]
        .some(v => String(v || '').toLowerCase().indexOf(kw) !== -1));
  }
  if (type) list = list.filter(r => r.type === type);
  if (year) list = list.filter(r => String(r.date || '').slice(0, 4) === year);

  const yearNow = String(new Date().getFullYear());
  $('#statAll').textContent = records.length;
  $('#statYear').textContent = records.filter(r => String(r.date || '').slice(0, 4) === yearNow).length;
  $('#statIn').textContent = records.filter(r => r.type === '入职' || r.type === '转正').length;
  $('#statOut').textContent = records.filter(r => r.type === '离职' || r.type === '退休').length;

  if (!list.length) {
    $('#hrBody').innerHTML = '<tr><td colspan="8" class="empty-tip">暂无人事异动记录，点击右上角「登记异动」开始</td></tr>';
    return;
  }

  $('#hrBody').innerHTML = list.map(r => {
    const tea = teachers.find(t => t.id === r.teacherId) || null;
    const pHit = tea ? matchPerm(tea.position) : null;
    const cur = tea
      ? `<span class="hr-sub">现：${escapeHtml([tea.position, tea.department, tea.status || '在职'].filter(Boolean).join(' · ')) || '未填写'}${pHit ? ' · 后台' + escapeHtml(moduleNames(pHit.modules)) : ''}</span>`
      : '<span class="hr-sub">档案已删除</span>';
    const change = ((r.before || r.after)
      ? `${escapeHtml(r.before || '—')} <span class="arrow">→</span> ${escapeHtml(r.after || '—')}`
      : '<span class="hr-cell-sub">—</span>')
      + (r.effect ? `<span class="eff-line">${escapeHtml(r.effect)}</span>` : '');
    const st = String(r.curStatus || '');
    return `<tr data-id="${escapeHtml(r.id)}">
      <td>
        <span class="hr-name">${escapeHtml(r.teacherName || '—')}${r.teacherNo ? ' <span class="hr-cell-sub">' + escapeHtml(r.teacherNo) + '</span>' : ''}</span>
        ${cur}
      </td>
      <td><span class="type-tag ${typeClass(r.type)}">${escapeHtml(r.type)}</span></td>
      <td class="hr-date">${escapeHtml(r.date || '—')}</td>
      <td>${change}</td>
      <td>${escapeHtml(r.department || '—')}</td>
      <td>${escapeHtml(r.reason || '—')}</td>
      <td>
        <span class="hr-name" style="font-weight:500">${escapeHtml(r.operator || '—')}</span>
        <span class="hr-sub">${escapeHtml(fmtTime(r.createdAt))}${st ? ' · <span class="st-tag ' + statusClass(st) + '">' + escapeHtml(st) + '</span>' : ''}</span>
      </td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-sm btn-edit" data-act="edit">编辑</button>
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
    renderTeacherSelect($('#fTeacher') ? $('#fTeacher').value : '');
  } catch (e) {
    console.error('加载教师失败', e);
  }
}

async function loadHR() {
  try {
    const res = await fetch(HR_API);
    const json = await res.json();
    records = json.data || [];
    renderYearFilter();
    renderTable();
  } catch (e) {
    toast('加载人事异动失败：' + e.message, 'error');
  }
}

function openModal(rec) {
  renderTeacherSelect(rec ? rec.teacherId : ($('#fTeacher') ? $('#fTeacher').value : ''));
  $('#modalTitle').textContent = rec ? '编辑人事异动' : '登记人事异动';
  $('#fId').value = rec ? rec.id : '';
  $('#fType').value = rec ? rec.type : '调岗';
  $('#fDate').value = rec ? (rec.date || todayStr()) : todayStr();
  $('#fBefore').value = rec ? (rec.before || '') : '';
  $('#fAfter').value = rec ? (rec.after || '') : '';
  $('#fDept').value = rec ? (rec.department || '') : '';
  $('#fReason').value = rec ? (rec.reason || '') : '';
  $('#fRemark').value = rec ? (rec.remark || '') : '';
  if (!rec) {
    // 新建：默认带出所选教师的当前职务 / 部门作为「变动前」
    const tea = teachers.find(t => t.id === $('#fTeacher').value);
    if (tea) {
      $('#fBefore').value = [tea.position, tea.department].filter(Boolean).join(' / ');
      $('#fDept').value = tea.department || '';
    }
  }
  updatePermWarn(teachers.find(x => x.id === $('#fTeacher').value));
  $('#modalMask').classList.add('show');
}
function closeModal() { $('#modalMask').classList.remove('show'); }

async function saveRec(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const data = {
    teacherId: $('#fTeacher').value,
    type: $('#fType').value,
    date: $('#fDate').value || todayStr(),
    before: $('#fBefore').value.trim(),
    after: $('#fAfter').value.trim(),
    department: $('#fDept').value.trim(),
    reason: $('#fReason').value.trim(),
    remark: $('#fRemark').value.trim()
  };
  if (!data.teacherId) { toast('请选择要登记异动的教师', 'error'); return; }
  // 权限变更：必须勾选确认并二次确认后才允许提交（职务即权限来源）
  const t = teachers.find(x => x.id === data.teacherId);
  updatePermWarn(t);
  const warn = $('#permWarn');
  if (warn && !warn.hidden) {
    if (!$('#permAck').checked) {
      toast('该异动会改变其后台权限，请先勾选确认', 'error');
      return;
    }
    const now = permDesc(matchPerm(data.after));
    const ok = await confirmDlg(
      `「${t ? t.name : ''}」的后台权限将由「${teacherPermDesc(t)}」变为「${now}」，确定继续保存该人事异动吗？`,
      { title: '权限变更确认', okText: '确认变更', danger: true }
    );
    if (!ok) return;
  }
  const done = busyBtn(e && e.submitter ? e.submitter : $('#hrForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
  try {
    const res = await fetch(id ? `${HR_API}/${id}` : HR_API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return; }
    toast(json.msg || (id ? '已保存' : '已登记'), 'success');
    closeModal();
    await loadHR();
    await loadTeachers();
  } catch (err) {
    toast('保存失败：' + err.message, 'error');
  } finally {
    done();
  }
}

async function delRec(id, name) {
  if (!(await confirmDlg(`确定删除「${name}」的这条人事异动记录？删除不会回退教师档案中已同步的职务 / 状态。`, { title: '删除记录', okText: '删除', danger: true }))) return;
  try {
    const res = await fetch(`${HR_API}/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '删除失败', 'error'); return; }
    toast('已删除', 'success');
    await loadHR();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

function exportCsv() {
  const kw = ($('#kw').value || '').trim().toLowerCase();
  const type = $('#typeFilter').value;
  const year = $('#yearFilter').value;
  let list = records.slice();
  if (kw) {
    list = list.filter(r =>
      [r.teacherName, r.teacherNo, r.before, r.after, r.department, r.reason, r.remark, r.operator]
        .some(v => String(v || '').toLowerCase().indexOf(kw) !== -1));
  }
  if (type) list = list.filter(r => r.type === type);
  if (year) list = list.filter(r => String(r.date || '').slice(0, 4) === year);
  if (!list.length) { toast('当前筛选下没有可导出的记录', 'error'); return; }
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['教师', '工号', '异动类型', '生效日期', '变动前', '变动后', '变动后部门', '权限变更', '事由', '登记人', '登记时间', '备注'];
  const lines = [head.map(cell).join(',')];
  list.forEach(r => {
    lines.push([r.teacherName, r.teacherNo, r.type, r.date, r.before, r.after, r.department,
      r.effect || '', r.reason, r.operator, fmtTime(r.createdAt), r.remark].map(cell).join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '人事异动记录-' + todayStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出 ' + list.length + ' 条记录', 'success');
}

function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#btnExport').onclick = exportCsv;
  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#hrForm').onsubmit = saveRec;
  $('#kw').oninput = renderTable;
  $('#typeFilter').onchange = renderTable;
  $('#yearFilter').onchange = renderTable;
  // 切换教师时自动带出其当前职务 / 部门作为「变动前」
  $('#fTeacher').onchange = () => {
    if ($('#fId').value) return;
    const tea = teachers.find(t => t.id === $('#fTeacher').value);
    if (!tea) return;
    $('#fBefore').value = [tea.position, tea.department].filter(Boolean).join(' / ');
    $('#fDept').value = tea.department || '';
    updatePermWarn(tea);
  };
  // 职务 / 类型变化时刷新权限变更预警
  const permWatch = () => updatePermWarn(teachers.find(t => t.id === $('#fTeacher').value));
  $('#fAfter').addEventListener('input', permWatch);
  $('#fType').addEventListener('change', permWatch);
  $('#hrBody').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const rec = records.find(x => x.id === tr.dataset.id);
    if (!rec) return;
    if (btn.dataset.act === 'edit') openModal(rec);
    else if (btn.dataset.act === 'del') delRec(rec.id, rec.teacherName);
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  // 组织架构（侧边栏树 + 模态框编辑）
  $('#btnAddDept').onclick = () => openDeptEditor('add');
  $('#deptEditorCancel').onclick = closeDeptModal;
  $('#deptEditorSave').onclick = saveDeptEditor;
  $('#deptModalClose').onclick = closeDeptModal;
  $('#deptModal').onclick = (e) => { if (e.target === $('#deptModal')) closeDeptModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#deptModal') && $('#deptModal').classList.contains('show')) closeDeptModal(); });
  $('#deptTree').addEventListener('click', (e) => {
    // 折叠 / 展开
    const tg = e.target.closest('.ttoggle[data-toggle]');
    if (tg) {
      const id = tg.getAttribute('data-toggle');
      if (deptCollapsed.has(id)) deptCollapsed.delete(id); else deptCollapsed.add(id);
      renderDeptTree();
      return;
    }
    // 打开 / 关闭下拉菜单
    const mb = e.target.closest('.tmenu-btn');
    if (mb) {
      e.stopPropagation();
      const menu = mb.parentElement.querySelector('.tmenu');
      const willOpen = menu.hidden;
      closeAllMenus();
      menu.hidden = !willOpen;
      return;
    }
    // 菜单项：添加子部门 / 编辑 / 删除
    const mi = e.target.closest('.tmenu [data-act]');
    if (mi) {
      e.stopPropagation();
      const act = mi.dataset.act, id = mi.dataset.id || '';
      closeAllMenus();
      if (act === 'add') (id ? openDeptEditor('add-child', { id }) : openDeptEditor('add'));
      else if (act === 'edit') openDeptEditor('edit', { id });
      else if (act === 'del') delDept(id);
      return;
    }
    // 点击行：选中高亮
    const rw = e.target.closest('.trow');
    if (rw) {
      document.querySelectorAll('#deptTree .trow.selected').forEach(el => el.classList.remove('selected'));
      rw.classList.add('selected');
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#deptTree .tmenu-wrap')) closeAllMenus();
  });
}

window.cbEmbedRefresh = function () { loadTeachers().then(loadHR); };

loadPerms().then(loadTeachers).then(() => {
  bindEvents();
  loadHR().then(applyWriteScope);
  Promise.all([loadDept(), loadLeaders(), getSchoolName()]).then(renderDeptTree);
});

// ===== 组织架构（人事管理 → 组织架构；部门权限在系统设置配置）=====
const DEPT_API = '/api/departments';
let deptCache = [];        // 当前部门列表（扁平，含 parentId / leader*）
let leaderOptions = [];    // 负责人候选：教师 + 后勤职工 {id, type, name, sub}
let schoolNameCache = '学生管理系统';  // 组织架构树首层根名称（取自系统设置 schoolName）
const deptCollapsed = new Set();       // 已折叠的节点 id（含虚拟根 '__root__'）
function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
async function loadDept() {
  try {
    const res = await fetch(DEPT_API);
    const json = await res.json();
    deptCache = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
  } catch (e) { deptCache = []; }
}
// 拉取负责人候选：教师（/api/teachers）+ 后勤职工（/api/logistics）
async function loadLeaders() {
  leaderOptions = [];
  try {
    const [t, l] = await Promise.all([
      fetch(TEA_API).then(r => r.json()),
      fetch(LOG_API).then(r => r.json())
    ]);
    if (t && t.code === 0 && Array.isArray(t.data)) {
      t.data.forEach(x => leaderOptions.push({ id: x.id, type: 'teacher', name: x.name || '', sub: x.department || (x.position || '教师') }));
    }
    if (l && l.code === 0 && Array.isArray(l.data)) {
      l.data.forEach(x => leaderOptions.push({ id: x.id, type: 'logistics', name: x.name || '', sub: (x.category || '后勤') + (x.post ? '·' + x.post : '') }));
    }
  } catch (e) { /* 候选失败不影响主流程 */ }
}
function deptNameById(id) { const d = deptCache.find(x => x.id === id); return d ? d.name : ''; }
// 收集某部门全部子孙 id（含自身），用于级联删除
function collectSubtree(id) {
  const out = [id];
  deptCache.filter(d => (d.parentId || '') === id).forEach(k => out.push(...collectSubtree(k.id)));
  return out;
}
// 获取学校名（组织架构树首层根）：优先 site.js 注入的 window.SITE，否则拉取公开设置
function getSchoolName() {
  if (window.SITE && window.SITE.schoolName) { schoolNameCache = String(window.SITE.schoolName); return Promise.resolve(); }
  return fetch('/api/settings').then(r => r.json()).then(j => {
    const d = j && j.data;
    if (d && d.schoolName) schoolNameCache = String(d.schoolName);
  }).catch(() => {});
}
// 关闭所有节点下拉菜单
function closeAllMenus() {
  document.querySelectorAll('#deptTree .tmenu').forEach(m => { m.hidden = true; });
}
const TREE_ICONS = {
  building: '<svg class="tico building" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>',
  staff: '<svg class="tico staff" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  school: '<svg class="tico school" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-5h4v5"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>'
};
function renderDeptTree() {
  const host = $('#deptTree');
  if (!host) return;
  const writable = canWrite();
  const kidsOf = pid => deptCache.filter(d => (d.parentId || '') === pid);
  const roots = kidsOf('');

  function row(icon, name, meta, menu, hasKids, collapsed, nodeId) {
    const toggle = hasKids
      ? '<button type="button" class="ttoggle' + (collapsed ? ' collapsed' : '') + '" data-toggle="' + escAttr(nodeId) + '"></button>'
      : '<span class="ttoggle leaf"></span>';
    return '<div class="trow">' + toggle + icon +
      '<span class="tname">' + escAttr(name) + '</span>' +
      (meta ? '<span class="tmeta">' + escAttr(meta) + '</span>' : '') +
      (menu || '') +
    '</div>';
  }
  function menuHtml(items) {
    return '<span class="tmenu-wrap">' +
      '<button type="button" class="tmenu-btn" title="操作">' + TREE_ICONS.more + '</button>' +
      '<div class="tmenu" hidden>' + items.map(it =>
        '<button type="button" data-act="' + it.act + '" data-id="' + escAttr(it.id == null ? '' : it.id) + '">' + it.label + '</button>'
      ).join('') + '</div>' +
    '</span>';
  }
  function node(d) {
    const children = kidsOf(d.id);
    const collapsed = deptCollapsed.has(d.id);
    const menu = writable ? menuHtml([
      { act: 'add', id: d.id, label: '添加子部门' },
      { act: 'edit', id: d.id, label: '编辑' },
      { act: 'del', id: d.id, label: '删除' }
    ]) : '';
    let html = '<div class="tnode' + (collapsed ? ' collapsed' : '') + '">' +
      row(children.length ? TREE_ICONS.building : TREE_ICONS.staff, d.name, d.leaderName || '', menu, children.length > 0, collapsed, d.id);
    if (children.length) html += '<div class="tchildren">' + children.map(node).join('') + '</div>';
    html += '</div>';
    return html;
  }

  // 首层根：学校名称（虚拟节点，其下挂所有顶级部门）
  const rootCollapsed = deptCollapsed.has('__root__');
  const rootMenu = writable ? menuHtml([{ act: 'add', id: '', label: '添加部门' }]) : '';
  let html = '<div class="tnode tnode-root">' +
    row(TREE_ICONS.school, schoolNameCache, '共 ' + deptCache.length + ' 个部门', rootMenu, roots.length > 0, rootCollapsed, '__root__') +
    (roots.length ? '<div class="tchildren">' + roots.map(node).join('') + '</div>' : '') +
    '</div>';
  if (!deptCache.length) {
    html += writable
      ? '<div class="hr-tip" style="margin-top:8px">还没有部门，点击左侧「添加根部门」创建（如：校长室、教务处、总务处…）。</div>'
      : '<div class="hr-tip" style="margin-top:8px">暂无部门数据。</div>';
  }
  host.innerHTML = html;
}
// 打开编辑/新增表单：mode='add' 根部门；'add-child' 挂在 parentId 下；'edit' 编辑 existId
async function openDeptEditor(mode, opts) {
  if (!leaderOptions.length) { try { await loadLeaders(); } catch (e) {} }
  const editor = $('#deptEditor');
  const parentSel = $('#deptParent');
  const leaderSel = $('#deptLeader');
  editor.dataset.mode = mode;
  editor.dataset.editId = (mode === 'edit' && opts && opts.id) ? opts.id : '';
  const selfId = (mode === 'edit' && opts) ? opts.id : '';
  const banned = selfId ? collectSubtree(selfId) : []; // 排除自身及子孙，避免成环
  // 上级部门下拉（树形缩进）
  let phtml = '<option value="">（无 / 顶级部门）</option>';
  function walk(pid, prefix) {
    deptCache.filter(d => (d.parentId || '') === pid && banned.indexOf(d.id) === -1).forEach(d => {
      phtml += '<option value="' + escAttr(d.id) + '">' + escAttr(prefix + d.name) + '</option>';
      walk(d.id, prefix + '　');
    });
  }
  walk('', '');
  parentSel.innerHTML = phtml;
  if (mode === 'add-child' && opts) parentSel.value = opts.id;
  else if (mode === 'edit' && opts) {
    const d = deptCache.find(x => x.id === opts.id);
    if (d) parentSel.value = d.parentId || '';
  }
  // 负责人下拉（教师 + 后勤）
  let lhtml = '<option value="">（未设置）</option>';
  leaderOptions.forEach(o => {
    lhtml += '<option value="' + escAttr(o.id) + '" data-type="' + o.type + '">' + escAttr(o.name + '（' + (o.sub || '') + '）') + '</option>';
  });
  leaderSel.innerHTML = lhtml;
  // 填充值
  if (mode === 'edit' && opts) {
    const d = deptCache.find(x => x.id === opts.id);
    $('#deptEditorTitle').textContent = '编辑部门';
    $('#deptName').value = d ? d.name : '';
    $('#deptDesc').value = d ? (d.desc || '') : '';
    if (d && d.leaderId) {
      const lv = [...leaderSel.options].find(op => op.value === d.leaderId && op.getAttribute('data-type') === d.leaderType);
      if (lv) lv.selected = true; else leaderSel.value = '';
    } else leaderSel.value = '';
  } else {
    $('#deptEditorTitle').textContent = (mode === 'add-child') ? '添加子部门' : '添加部门';
    $('#deptName').value = '';
    $('#deptDesc').value = '';
    leaderSel.value = '';
  }
  $('#deptModal').classList.add('show');
  $('#deptName').focus();
}
async function saveDeptEditor() {
  const editor = $('#deptEditor');
  const mode = editor.dataset.mode;
  const editId = editor.dataset.editId;
  const name = ($('#deptName').value || '').trim();
  if (!name) { toast('请填写部门名称', 'error'); return; }
  if (deptCache.some(d => d.name.toLowerCase() === name.toLowerCase() && d.id !== editId)) {
    toast('部门「' + name + '」已存在', 'error'); return;
  }
  const parentId = ($('#deptParent').value || '').trim();
  const leaderOpt = $('#deptLeader').selectedOptions[0];
  const leaderId = leaderOpt ? (leaderOpt.value || '') : '';
  const leaderType = (leaderOpt && leaderOpt.getAttribute('data-type')) || '';
  const leaderName = (leaderOpt && leaderOpt.value) ? leaderOpt.textContent.replace(/（.*）$/, '').trim() : '';
  const desc = ($('#deptDesc').value || '').trim();
  if (mode === 'edit' && editId) {
    const d = deptCache.find(x => x.id === editId);
    if (d) Object.assign(d, { name, parentId, leaderId, leaderType, leaderName, desc });
  } else {
    deptCache.push({ id: 'dep_' + Date.now().toString(36), name, parentId, leaderId, leaderType, leaderName, desc });
  }
  closeDeptModal();
  await commitDept();
}
async function delDept(id) {
  const sub = collectSubtree(id);
  const name = deptNameById(id);
  const cnt = sub.length;
  if (!window.confirm('确定删除部门「' + name + '」' + (cnt > 1 ? '及其下 ' + (cnt - 1) + ' 个子部门' : '') + '？')) return;
  deptCache = deptCache.filter(d => sub.indexOf(d.id) === -1);
  renderDeptTree();
  await commitDept();
}
// 把整个部门列表即时提交到服务端（新增/编辑/删除共用）
async function commitDept() {
  if (!canWrite()) { toast('无保存权限', 'error'); return false; }
  const done = busyBtn($('#deptEditorSave'), '保存中…');
  if (!done) return false;
  try {
    const payload = deptCache.map(d => ({
      id: d.id, name: d.name, parentId: d.parentId || '',
      leaderId: d.leaderId || '', leaderType: d.leaderType || '', leaderName: d.leaderName || '', desc: d.desc || ''
    }));
    const res = await fetch(DEPT_API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return false; }
    deptCache = json.data || deptCache;
    toast(json.msg || '组织架构已保存', 'success');
    renderDeptTree();
    await loadTeachers();
    return true;
  } catch (e) { toast('保存失败：' + e.message, 'error'); return false; }
  finally { done(); }
}
function closeDeptModal() { const m = $('#deptModal'); if (m) m.classList.remove('show'); }
