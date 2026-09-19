// 人事管理 - 教师人事异动台账
const HR_API = '/api/hr';
const TEA_API = '/api/teachers';
const LOG_API = '/api/logistics';
const PERM_API = '/api/dept-perms';
let records = [];
let teachers = [];
// 组织架构权限（部门 → 可管理模块，服务端已按层级算好继承）
let deptPermMap = {};
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
// 按「组织架构权限」判定是否可登记 / 编辑人事异动：管理员全量；部门账号需被授权 hr 模块
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
    tip.textContent = '当前账号仅可查看人事异动台账；登记 / 修改需管理员在「系统设置 → 组织架构权限」中为该部门勾选「人事管理」模块。';
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

// 切换「人员名单 / 异动台账」；key = member（人员名单）| record（异动台账）
function switchTab(key) {
  const k = key === 'record' ? 'record' : 'member';
  const pm = $('#paneMember'), pr = $('#paneRecord');
  if (pm) pm.hidden = k !== 'member';
  if (pr) pr.hidden = k !== 'record';
  document.querySelectorAll('.hr-tab').forEach(btn => {
    const on = btn.dataset.tab === k;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

async function loadPerms() {
  try {
    const res = await fetch(PERM_API);
    const json = await res.json();
    deptPermMap = (json.data && json.data.effective) || {};
    permModules = (json.data && json.data.modules) || [];
  } catch (e) {
    deptPermMap = {};
    permModules = [];
  }
}
function moduleNames(keys) {
  const names = permModules.filter(m => (keys || []).indexOf(m.key) !== -1).map(m => m.name);
  return names.length ? names.join('、') : '无';
}
// 按部门名匹配权限条目（服务端下发的 effective 已含上级部门继承，与服务端判定一致）
function matchPerm(dept) {
  const n = String(dept || '').trim();
  if (!n) return null;
  const mods = deptPermMap[n];
  return Array.isArray(mods) ? { name: n, modules: mods } : null;
}
function permDesc(p) {
  if (!p) return '无后台权限（仅教师端）';
  return moduleNames(p.modules || []);
}
// 有所属部门但未配置任何可管理模块：仍可登录管理后台（身份即部门），只是全部模块仅可查看
const UNCONFIGURED_PERM = '可登录后台，未配置可管理模块（全部仅可查看）';
// 教师当前生效的权限描述（优先用服务端 /api/teachers 算好的 perm，其次按所属部门实时计算）
function teacherPermDesc(t) {
  if (!t) return '无后台权限（仅教师端）';
  if (OFF_DUTY.indexOf(t.status || '在职') !== -1) return '无后台权限（已离岗）';
  if (t.perm && t.perm.matched) {
    const mods = t.perm.modules || [];
    return mods.length ? moduleNames(mods) : UNCONFIGURED_PERM;
  }
  const hit = matchPerm(t.department);
  return hit ? permDesc(hit) : (t.department ? UNCONFIGURED_PERM : '无后台权限（仅教师端）');
}
function hrWritesDept(type) {
  return ['调岗', '晋升', '入职', '转正', '借调', '其他'].indexOf(type) !== -1;
}
// 权限变更预警：所属部门变化会同步改变后台身份与可管理范围
function updatePermWarn(t) {
  const warn = $('#permWarn');
  const ackBox = $('#permAckBox');
  const ack = $('#permAck');
  if (!warn || !ackBox) return;
  const type = $('#fType').value;
  const dept = String($('#fDept').value || '').trim();
  if (!t || !hrWritesDept(type) || !dept) {
    warn.hidden = true; ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  const before = teacherPermDesc(t);
  const hit = matchPerm(dept);
  const now = permDesc(hit) || UNCONFIGURED_PERM;
  if (before === now) {
    warn.hidden = true; ackBox.hidden = true;
    if (ack) ack.checked = false;
    return;
  }
  warn.hidden = false;
  warn.innerHTML = '该异动会把「<b>' + escapeHtml(t.name) + '</b>」的所属部门改为「<b>' + escapeHtml(dept)
    + '</b>」，其后台权限将由 <b>' + escapeHtml(before) + '</b> 变为 <b>' + escapeHtml(now)
    + '</b>。请确认这是本次调岗 / 借调的真实授权意图。';
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
    const pHit = tea ? matchPerm(tea.department) : null;
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
  // 权限变更：必须勾选确认并二次确认后才允许提交（所属部门即权限来源）
  const t = teachers.find(x => x.id === data.teacherId);
  updatePermWarn(t);
  const warn = $('#permWarn');
  if (warn && !warn.hidden) {
    if (!$('#permAck').checked) {
      toast('该异动会改变其后台权限，请先勾选确认', 'error');
      return;
    }
    const hit = matchPerm(data.department);
    const now = permDesc(hit) || UNCONFIGURED_PERM;
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
    renderDeptTree();   // 教师所属部门 / 职务可能已变，同步组织架构人数与人员名单
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
  // 人员名单 / 异动台账 切换
  document.querySelectorAll('.hr-tab').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  // 人员名单：关键字 / 身份 / 在职状态筛选，chip 上的 × 清除组织架构筛选
  const memKw = $('#memKw'), memKind = $('#memKind'), memStatus = $('#memStatus');
  if (memKw) memKw.oninput = renderMemberList;
  if (memKind) memKind.onchange = renderMemberList;
  if (memStatus) memStatus.onchange = renderMemberList;
  // 人员名单「查看」：跳到对应管理页并打开该人员详情（教师 → 教师管理，后勤职工 → 后勤管理）
  $('#memBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mview]');
    if (!btn) return;
    const id = btn.getAttribute('data-mview') || '';
    const kind = btn.getAttribute('data-mkind') || 'teacher';
    const url = (kind === 'staff' ? '/logistics.html?staff=' : '/teachers.html?teacher=') + encodeURIComponent(id);
    if (typeof window.goPage === 'function') window.goPage(url);
    else location.href = url;
  });
  if ($('#memChipClear')) $('#memChipClear').onclick = () => {
    memSel = { kind: 'all', value: '', dept: '' };
    renderDeptTree();
  };
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
  // 所属部门 / 类型变化时刷新权限变更预警
  const permWatch = () => updatePermWarn(teachers.find(t => t.id === $('#fTeacher').value));
  $('#fDept').addEventListener('input', permWatch);
  $('#fDept').addEventListener('change', permWatch);
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
  // 部门树拖拽排序（改变上级 / 同级顺序）
  bindDeptDnd();
  $('#deptTree').addEventListener('click', (e) => {
    // 折叠 / 展开
    const tg = e.target.closest('.ttoggle[data-toggle]');
    if (tg) {
      const id = tg.getAttribute('data-toggle');
      if (deptCollapsed.has(id)) deptCollapsed.delete(id); else deptCollapsed.add(id);
      renderDeptTree();
      return;
    }
    // 打开 / 关闭下拉菜单（fixed 定位，避免被侧栏 overflow:auto 裁切）
    const mb = e.target.closest('.tmenu-btn');
    if (mb) {
      e.stopPropagation();
      const menu = mb.parentElement.querySelector('.tmenu');
      const willOpen = menu.hidden;
      closeAllMenus();
      if (willOpen) {
        menu.hidden = false;
        const r = mb.getBoundingClientRect();
        const mh = menu.offsetHeight, mw = menu.offsetWidth;
        let top = r.bottom + 4;
        if (top + mh > window.innerHeight - 6) top = r.top - mh - 4; // 空间不足翻到上方
        if (top < 6) top = 6;
        let left = r.right - mw;
        if (left < 6) left = 6;
        menu.style.position = 'fixed';
        menu.style.right = 'auto';
        menu.style.bottom = 'auto';
        menu.style.top = top + 'px';
        menu.style.left = left + 'px';
      }
      return;
    }
    // 菜单项：添加子部门 / 编辑 / 删除
    const mi = e.target.closest('.tmenu [data-act]');
    if (mi) {
      e.stopPropagation();
      const act = mi.dataset.act, id = mi.dataset.id || '';
      closeAllMenus();
      if (act === 'add') (id ? openDeptEditor('add-child', { id }) : openDeptEditor('add'));
      else if (act === 'addpos') openPosEditor('add', { deptId: id });
      else if (act === 'edit') openDeptEditor('edit', { id });
      else if (act === 'del') delDept(id);
      return;
    }
    // 职位行内操作（编辑 / 删除）：data-pact 避免与部门菜单 data-act 冲突
    const pbtn = e.target.closest('[data-pact]');
    if (pbtn) {
      e.stopPropagation();
      const pact = pbtn.dataset.pact, pid = pbtn.dataset.id;
      closeAllMenus();
      if (pact === 'edit') openPosEditor('edit', { id: pid });
      else if (pact === 'del') delPos(pid);
      return;
    }
    // 点击行：选中高亮 + 按该节点筛选人员（折叠 / 展开只认行前的三角形）
    const rw = e.target.closest('.trow');
    if (rw) {
      const kind = rw.dataset.kind || '';
      if (kind) {
        memSel = { kind, value: rw.dataset.value || '', dept: rw.dataset.dept || '' };
        switchTab('member');   // 点了组织架构就切到人员名单，让筛选结果可见
      }
      renderDeptTree();   // 刷新选中态 / 人数，并同步右侧人员名单
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#deptTree .tmenu-wrap')) closeAllMenus();
  });
  // 菜单为 fixed 定位，不跟随滚动容器；滚动时关闭以免错位
  window.addEventListener('scroll', closeAllMenus, true);
  // 职位（组织架构树内：部门「⋯」菜单添加 / 行内编辑删除）
  $('#posEditorCancel').onclick = closePosModal;
  $('#posEditorSave').onclick = savePosEditor;
  $('#posModalClose').onclick = closePosModal;
  $('#posModal').onclick = (e) => { if (e.target === $('#posModal')) closePosModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#posModal') && $('#posModal').classList.contains('show')) closePosModal(); });
}

window.cbEmbedRefresh = function () {
  loadTeachers().then(loadHR);
  loadPositions().then(renderDeptTree);
  loadStaff().then(renderMemberList);
};

loadPerms().then(loadTeachers).then(() => {
  bindEvents();
  loadHR().then(applyWriteScope);
  Promise.all([loadDept(), loadStaff(), loadLeaders(), getSchoolName()]).then(renderDeptTree);
  loadPositions().then(renderDeptTree);
});

// ===== 组织架构（人事管理 → 组织架构；部门权限在系统设置配置）=====
const DEPT_API = '/api/departments';
let deptCache = [];        // 当前部门列表（扁平，含 parentId / leader*）
let leaderOptions = [];    // 负责人候选：教师 + 后勤职工 {id, type, name, sub}
let staffCache = [];       // 后勤职工（/api/logistics），与 teachers 共同组成「人员名单」
let schoolNameCache = '学生管理系统';  // 组织架构树首层根名称（取自系统设置 schoolName）
const deptCollapsed = new Set();       // 已折叠的节点 id（含虚拟根 '__root__'）
// 左侧组织架构点击后的筛选：all（全部）/ dept（部门，含下属部门）/ pos（部门下职位）/ none（未分配部门）
let memSel = { kind: 'all', value: '', dept: '' };
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
// 拉取后勤职工：组织架构点击后的「人员名单」与部门负责人候选都依赖它
async function loadStaff() {
  try {
    const res = await fetch(LOG_API);
    const json = await res.json();
    staffCache = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
  } catch (e) { staffCache = []; }
}
// 拉取负责人候选：教师（/api/teachers）+ 后勤职工（/api/logistics）
async function loadLeaders() {
  leaderOptions = [];
  try {
    if (!staffCache.length) await loadStaff();
    const t = await fetch(TEA_API).then(r => r.json());
    if (t && t.code === 0 && Array.isArray(t.data)) {
      t.data.forEach(x => leaderOptions.push({ id: x.id, type: 'teacher', name: x.name || '', sub: x.department || (x.position || '教师') }));
    }
    staffCache.forEach(x => leaderOptions.push({ id: x.id, type: 'logistics', name: x.name || '', sub: (x.category || '后勤') + (x.post ? '·' + x.post : '') }));
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
// ===== 人员名单（教师 + 后勤职工）：按左侧组织架构节点筛选 =====
let descMemo = {};         // 部门名 → 全部下属部门名（按当前 deptCache 缓存，树重建时清空）
// 某部门（按名称）的全部下属部门名，用于「部门含下属部门」筛选与人数统计
function deptDescendantNames(name) {
  if (descMemo[name]) return descMemo[name];
  const out = [];
  const hit = deptCache.find(d => String(d.name || '').trim() === name);
  if (!hit) { descMemo[name] = out; return out; }
  (function walk(pid) {
    deptCache.filter(d => String(d.parentId || '') === pid).forEach(d => {
      out.push(String(d.name || '').trim());
      walk(d.id);
    });
  })(hit.id);
  descMemo[name] = out;
  return out;
}
// 统一人员视图：教师（teachers）+ 后勤职工（staffCache）
function memberRows() {
  const rows = [];
  teachers.forEach(t => rows.push({
    kind: 'teacher', id: t.id, name: t.name || '', no: t.teacherNo || '',
    dept: String(t.department || '').trim(), post: String(t.position || '').trim(),
    sub: [t.title, t.subject].filter(Boolean).join(' · '),
    phone: t.phone || '', join: String(t.joinYear || '').trim(), status: t.status || '在职'
  }));
  staffCache.forEach(s => rows.push({
    kind: 'staff', id: s.id, name: s.name || '', no: s.staffNo || '',
    dept: String(s.department || '').trim(), post: String(s.post || '').trim(),
    sub: [s.employType, s.vendor ? '外包：' + s.vendor : '', s.area].filter(Boolean).join(' · '),
    phone: s.phone || '', join: String(s.joinDate || '').slice(0, 4), status: s.status || '在职'
  }));
  return rows;
}
function matchMember(m, sel) {
  if (!sel || sel.kind === 'all') return true;
  if (sel.kind === 'none') return !m.dept;
  if (sel.kind === 'dept') {
    if (!m.dept) return false;
    return m.dept === sel.value || deptDescendantNames(sel.value).indexOf(m.dept) !== -1;
  }
  if (sel.kind === 'pos') return m.dept === sel.dept && m.post === sel.value;
  return true;
}
// 当前筛选下的名单（含工具栏关键字 / 身份 / 在职状态）
function memberList() {
  const kw = String(($('#memKw') && $('#memKw').value) || '').trim().toLowerCase();
  const kind = $('#memKind') ? $('#memKind').value : '';
  const st = $('#memStatus') ? $('#memStatus').value : '';
  let list = memberRows().filter(m => matchMember(m, memSel));
  if (kind) list = list.filter(m => m.kind === kind);
  if (st) list = list.filter(m => m.status === st);
  if (kw) {
    list = list.filter(m => [m.name, m.no, m.dept, m.post, m.sub, m.phone]
      .some(v => String(v || '').toLowerCase().indexOf(kw) !== -1));
  }
  list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'teacher' ? -1 : 1)
    || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  return list;
}
function renderMemberList() {
  const body = $('#memBody');
  if (!body) return;
  const list = memberList();
  // 筛选提示 chip（显示当前部门 / 职位与命中人数，可一键清除）
  const chip = $('#memChip'), txt = $('#memChipText');
  let label = '';
  if (memSel.kind === 'dept') label = '部门：' + memSel.value;
  else if (memSel.kind === 'pos') label = '职位：' + memSel.value + '（' + memSel.dept + '）';
  else if (memSel.kind === 'none') label = '未分配部门';
  if (chip) {
    chip.hidden = !label;
    if (txt) txt.textContent = label ? label + ' · ' + list.length + ' 人' : '';
  }
  const cnt = $('#memCount');
  if (cnt) cnt.textContent = '共 ' + list.length + ' 人';
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty-tip">当前筛选下没有人员</td></tr>';
    return;
  }
  body.innerHTML = list.map(m => {
    const off = OFF_DUTY.indexOf(m.status) !== -1;
    return `<tr${off ? ' class="mem-off"' : ''}>
      <td>
        <span class="hr-name">${escapeHtml(m.name || '—')}${m.no ? ' <span class="hr-cell-sub">' + escapeHtml(m.no) + '</span>' : ''}</span>
      </td>
      <td><span class="kind-tag ${m.kind === 'teacher' ? 'kind-teacher' : 'kind-staff'}">${m.kind === 'teacher' ? '教师' : '后勤职工'}</span></td>
      <td>${m.dept ? escapeHtml(m.dept) : '<span class="hr-cell-sub">未分配</span>'}</td>
      <td>${m.post ? escapeHtml(m.post) : '—'}${m.sub ? '<span class="hr-cell-sub">' + escapeHtml(m.sub) + '</span>' : ''}</td>
      <td>${escapeHtml(m.phone || '—')}</td>
      <td class="hr-date">${escapeHtml(m.join || '—')}</td>
      <td><span class="st-tag ${statusClass(m.status)}">${escapeHtml(m.status || '在职')}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-sm btn-view" data-mview="${escapeHtml(m.id)}" data-mkind="${m.kind}" title="查看详细信息">查看</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderDeptTree() {
  const host = $('#deptTree');
  if (!host) return;
  descMemo = {};                       // 部门结构可能已变，清空下属部门缓存
  const writable = canWrite();
  // 同级按自定义顺序 sort 排列（未设置顺序的排在最后，按名称兜底）
  const sortKeyOf = d => (d && d.sort != null ? Number(d.sort) : Number.MAX_SAFE_INTEGER);
  const kidsOf = pid => deptCache.filter(d => (d.parentId || '') === pid)
    .sort((a, b) => sortKeyOf(a) - sortKeyOf(b) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  const roots = kidsOf('');
  const memAll = memberRows();                                  // 人员名单（教师 + 后勤职工），用于人数统计
  const memberCount = sel => memAll.filter(m => matchMember(m, sel)).length;
  // 当前节点是否为筛选中的节点（用于行高亮）
  const isMemSel = (kind, value, dept) => memSel.kind === kind
    && String(memSel.value || '') === String(value || '')
    && String(memSel.dept || '') === String(dept || '');

  function row(icon, name, meta, menu, hasKids, collapsed, nodeId, deptId, sel, attrs) {
    const toggle = hasKids
      ? '<button type="button" class="ttoggle' + (collapsed ? ' collapsed' : '') + '" data-toggle="' + escAttr(nodeId) + '"></button>'
      : '<span class="ttoggle leaf"></span>';
    // 部门行可拖拽调整层级与顺序（无写权限时不开启）
    const dragAttr = (writable && deptId)
      ? ' draggable="true" data-dept="' + escAttr(deptId) + '" title="按住拖动可调整层级与顺序"'
      : '';
    return '<div class="trow' + (sel ? ' selected' : '') + '"' + dragAttr + (attrs || '') + '>' + toggle + icon +
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
  // 部门下的职位行（作为该部门子项展示；点击即按「部门 + 职位」筛选人员）
  function posRow(p, deptName) {
    const actions = writable
      ? '<span class="tmenu-wrap"><button type="button" class="tmenu-btn" title="操作">' + TREE_ICONS.more + '</button>' +
        '<div class="tmenu" hidden>' +
          '<button type="button" data-pact="edit" data-id="' + escAttr(p.id) + '">编辑</button>' +
          '<button type="button" data-pact="del" data-id="' + escAttr(p.id) + '">删除</button>' +
        '</div></span>'
      : '';
    const pName = String(p.name || '').trim();
    const meta = [p.desc || '', memberCount({ kind: 'pos', dept: deptName, value: pName }) + ' 人'].filter(Boolean).join(' · ');
    return '<div class="trow tpos' + (isMemSel('pos', pName, deptName) ? ' selected' : '') + '"'
      + ' data-kind="pos" data-value="' + escAttr(pName) + '" data-dept="' + escAttr(deptName) + '"'
      + ' title="查看「' + escAttr(deptName + ' · ' + pName) + '」的在岗人员">' +
      '<span class="ttoggle leaf"></span>' +
      '<span class="tpos-badge">职位</span>' +
      '<span class="tname">' + escAttr(p.name) + '</span>' +
      (meta ? '<span class="tmeta">' + escAttr(meta) + '</span>' : '') +
      actions +
    '</div>';
  }
  function node(d) {
    const children = kidsOf(d.id);
    const collapsed = deptCollapsed.has(d.id);
    const deptName = String(d.name || '').trim();
    const posRows = posCache.filter(p => (p.departmentId || '') === d.id || (p.department || '') === deptName)
      .map(p => posRow(p, deptName)).join('');
    const menu = writable ? menuHtml([
      { act: 'addpos', id: d.id, label: '添加职位' },
      { act: 'add', id: d.id, label: '添加子部门' },
      { act: 'edit', id: d.id, label: '编辑' },
      { act: 'del', id: d.id, label: '删除' }
    ]) : '';
    const hasKids = children.length > 0 || !!posRows;
    const deptMeta = [d.leaderName || '', memberCount({ kind: 'dept', value: deptName }) + ' 人'].filter(Boolean).join(' · ');
    let html = '<div class="tnode' + (collapsed ? ' collapsed' : '') + '">' +
      row(children.length ? TREE_ICONS.building : TREE_ICONS.staff, d.name, deptMeta, menu, hasKids, collapsed, d.id, d.id,
        isMemSel('dept', deptName, ''),
        ' data-kind="dept" data-value="' + escAttr(deptName) + '" title="查看「' + escAttr(deptName) + '」及下属部门的人员"');
    if (children.length) html += '<div class="tchildren">' + children.map(node).join('') + '</div>';
    if (posRows) html += '<div class="tpositions">' + posRows + '</div>';
    html += '</div>';
    return html;
  }

  // 首层根：学校名称（虚拟节点，其下挂所有顶级部门；点击 = 显示全部人员）
  const rootCollapsed = deptCollapsed.has('__root__');
  const rootMenu = writable ? menuHtml([{ act: 'add', id: '', label: '添加部门' }]) : '';
  // 未分配部门：教师 / 职工未填所属部门时也挂出来，避免无处查找
  const unassignedRow = '<div class="tnode">' +
    row(TREE_ICONS.staff, '未分配部门', memberCount({ kind: 'none' }) + ' 人', '', false, false, '', '',
      isMemSel('none', '', ''),
      ' data-kind="none" data-value="" title="尚未归属部门的教师 / 后勤职工"') +
    '</div>';
  let html = '<div class="tnode tnode-root' + (rootCollapsed ? ' collapsed' : '') + '">' +
    row(TREE_ICONS.school, schoolNameCache,
      '共 ' + deptCache.length + ' 个部门 · ' + memberCount({ kind: 'all' }) + ' 人',
      rootMenu, true, rootCollapsed, '__root__', '',
      isMemSel('all', '', ''),
      ' data-kind="all" data-value="" title="显示全部教师与后勤职工"') +
    '<div class="tchildren">' + unassignedRow + roots.map(node).join('') + '</div>' +
    '</div>';
  if (!deptCache.length) {
    html += writable
      ? '<div class="hr-tip" style="margin-top:8px">还没有部门，点击左侧「添加根部门」创建（如：校长室、教务处、总务处…）。</div>'
      : '<div class="hr-tip" style="margin-top:8px">暂无部门数据。</div>';
  }
  host.innerHTML = html;
  renderMemberList();   // 人数与选中态变化后同步右侧人员名单
}

// ===== 拖拽调整部门位置（改变上级 / 同级顺序），松手即保存 =====
let dragDeptId = '';   // 正在拖拽的部门 id
let dropMode = '';     // before：插到目标前；after：插到目标后；into：成为目标的子部门
function clearDropMarks() {
  document.querySelectorAll('#deptTree .trow').forEach(r => r.classList.remove('drop-before', 'drop-after', 'drop-into'));
}
// 按当前列表顺序重写 sort，让同级顺序能持久化到服务端
function reindexDeptSort() { deptCache.forEach((d, i) => { d.sort = i; }); }
// 把 dragId 移到 targetId 的前 / 后 / 内部
function moveDept(dragId, targetId, mode) {
  if (!canWrite()) { toast('无保存权限', 'error'); return; }
  const drag = deptCache.find(d => d.id === dragId);
  const target = deptCache.find(d => d.id === targetId);
  if (!drag || !target || dragId === targetId) return;
  if (collectSubtree(dragId).indexOf(targetId) !== -1) { toast('不能移动到自己的下级部门', 'error'); return; }
  drag.parentId = (mode === 'into') ? targetId : (target.parentId || '');
  deptCache.splice(deptCache.indexOf(drag), 1);
  const ti = deptCache.findIndex(d => d.id === targetId);
  if (mode === 'before') deptCache.splice(ti, 0, drag);
  else if (mode === 'after') deptCache.splice(ti + 1, 0, drag);
  else deptCache.push(drag);   // 移入子级时排在该父部门子项末尾
  reindexDeptSort();
  if (mode === 'into') deptCollapsed.delete(targetId);  // 移入后展开，便于看到结果
  renderDeptTree();
  commitDept();
}
function bindDeptDnd() {
  const host = $('#deptTree');
  if (!host || host.dataset.dnd) return;
  host.dataset.dnd = '1';
  host.addEventListener('dragstart', (e) => {
    const row = e.target.closest && e.target.closest('.trow[data-dept]');
    if (!row) return;
    dragDeptId = row.dataset.dept || '';
    row.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragDeptId);
    }
  });
  host.addEventListener('dragend', () => {
    dragDeptId = ''; dropMode = '';
    clearDropMarks();
    document.querySelectorAll('#deptTree .trow.dragging').forEach(r => r.classList.remove('dragging'));
  });
  host.addEventListener('dragover', (e) => {
    if (!dragDeptId) return;
    const row = e.target.closest ? e.target.closest('.trow[data-dept]') : null;
    clearDropMarks();
    if (!row || row.dataset.dept === dragDeptId) return;
    if (collectSubtree(dragDeptId).indexOf(row.dataset.dept) !== -1) return; // 禁止拖进自己的下级
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    // 上 / 下边缘 30% 调整为同级顺序，中间区域表示成为其子部门
    const rect = row.getBoundingClientRect();
    const p = (e.clientY - rect.top) / Math.max(1, rect.height);
    dropMode = p < 0.3 ? 'before' : (p > 0.7 ? 'after' : 'into');
    row.classList.add(dropMode === 'into' ? 'drop-into' : (dropMode === 'before' ? 'drop-before' : 'drop-after'));
  });
  host.addEventListener('dragleave', (e) => { if (!host.contains(e.relatedTarget)) clearDropMarks(); });
  host.addEventListener('drop', (e) => {
    const row = e.target.closest ? e.target.closest('.trow[data-dept]') : null;
    const dragId = dragDeptId, mode = dropMode;
    clearDropMarks();
    if (!dragId || !row || !mode) return;
    e.preventDefault();
    moveDept(dragId, row.dataset.dept, mode);
  });
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
  memSel = { kind: 'all', value: '', dept: '' };   // 部门已删除，筛选复位避免停在空名单上
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
      id: d.id, name: d.name, parentId: d.parentId || '', sort: (d.sort == null ? null : Number(d.sort)),
      leaderId: d.leaderId || '', leaderType: d.leaderType || '', leaderName: d.leaderName || '', desc: d.desc || ''
    }));
    const res = await fetch(DEPT_API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return false; }
    deptCache = json.data || deptCache;
    toast(json.msg || '组织架构已保存', 'success');
    await loadTeachers();
    renderDeptTree();
    return true;
  } catch (e) { toast('保存失败：' + e.message, 'error'); return false; }
  finally { done(); }
}
function closeDeptModal() { const m = $('#deptModal'); if (m) m.classList.remove('show'); }

// ===== 职位（岗位）管理（人事管理 → 组织架构 → 职位管理；后勤职工岗位联动来源）=====
const POS_API = '/api/positions';
let posCache = [];
// 拉取职位列表
async function loadPositions() {
  try {
    const res = await fetch(POS_API);
    const json = await res.json();
    posCache = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
  } catch (e) { posCache = []; }
}
// 部门下拉（树形缩进，value=部门 id，文本带部门名），供职位归属选择
function fillPositionDeptSelect() {
  const sel = $('#posDept');
  if (!sel) return;
  const kidsOf = pid => deptCache.filter(d => (d.parentId || '') === pid);
  let html = '<option value="">（未分配部门）</option>';
  (function walk(pid, prefix) {
    kidsOf(pid).forEach(d => {
      html += '<option value="' + escAttr(d.id) + '">' + escAttr(prefix + d.name) + '</option>';
      walk(d.id, prefix + '　');
    });
  })('', '');
  sel.innerHTML = html;
}
// 渲染职位列表（整合进组织架构树，由 renderDeptTree 统一渲染，这里不再单独渲染）
function openPosEditor(mode, opts) {
  fillPositionDeptSelect();
  const editor = $('#posModal');
  const title = $('#posEditorTitle');
  const nameI = $('#posName');
  const deptI = $('#posDept');
  const descI = $('#posDesc');
  if (mode === 'edit' && opts) {
    const p = posCache.find(x => x.id === opts.id);
    title.textContent = '编辑职位';
    nameI.value = p ? p.name : '';
    deptI.value = p ? (p.departmentId || '') : '';
    descI.value = p ? (p.desc || '') : '';
    editor.dataset.editId = opts.id;
  } else {
    title.textContent = '添加职位';
    nameI.value = '';
    deptI.value = (opts && opts.deptId) ? opts.deptId : '';
    descI.value = '';
    editor.dataset.editId = '';
  }
  editor.classList.add('show');
  nameI.focus();
}
async function savePosEditor() {
  const name = ($('#posName').value || '').trim();
  if (!name) { toast('请填写职位名称', 'error'); return; }
  const deptId = ($('#posDept').value || '').trim();
  if (!deptId) { toast('请选择所属部门（职位须归属于组织架构中的某个部门）', 'error'); return; }
  const deptObj = deptCache.find(d => d.id === deptId);
  const department = deptObj ? deptObj.name : '';
  const desc = ($('#posDesc').value || '').trim();
  const editId = $('#posModal').dataset.editId || '';
  if (editId) {
    const p = posCache.find(x => x.id === editId);
    if (p) Object.assign(p, { name, departmentId: deptId, department, desc });
  } else {
    posCache.push({ id: 'pos_' + Date.now().toString(36), name, departmentId: deptId, department, desc });
  }
  closePosModal();
  await commitPositions();
}
async function delPos(id) {
  const p = posCache.find(x => x.id === id);
  if (!p) return;
  if (!window.confirm('确定删除职位「' + p.name + '」？该操作仅删除职位定义，已登记的后勤职工档案不受影响。')) return;
  posCache = posCache.filter(x => x.id !== id);
  renderDeptTree();
  await commitPositions();
}
// 全量提交职位列表到服务端
async function commitPositions() {
  if (!canWrite()) { toast('无保存权限', 'error'); return false; }
  const done = busyBtn($('#posEditorSave'), '保存中…');
  if (!done) return false;
  try {
    const payload = posCache.map(p => ({
      id: p.id, name: p.name,
      departmentId: p.departmentId || '', department: p.department || '', desc: p.desc || ''
    }));
    const res = await fetch(POS_API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return false; }
    posCache = json.data || posCache;
    toast(json.msg || '职位已保存', 'success');
    renderDeptTree();
    return true;
  } catch (e) { toast('保存失败：' + e.message, 'error'); return false; }
  finally { done(); }
}
function closePosModal() { const m = $('#posModal'); if (m) m.classList.remove('show'); }
