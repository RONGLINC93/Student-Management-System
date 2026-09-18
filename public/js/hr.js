// 人事管理 - 教师人事异动台账
const HR_API = '/api/hr';
const TEA_API = '/api/teachers';
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
}

window.cbEmbedRefresh = function () { loadTeachers().then(loadHR); };

loadPerms().then(loadTeachers).then(() => {
  bindEvents();
  loadHR();
});
