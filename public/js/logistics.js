// 后勤 / 职工管理：安保、保洁、食堂、维修、宿舍、绿化、司机、校医等
// 独立数据表（/api/logistics），与教师档案解耦：不参与教学统计、不进入课程表教师下拉与班主任候选
const LG_API = '/api/logistics';
const EMPLOY_TYPES = ['在编', '合同制', '劳务派遣', '外包', '临时', '其他'];
const SHIFTS = ['常白班', '早班', '晚班', '夜班', '轮班', '其他'];
const OFF_DUTY = ['离职', '退休'];
const DUE_DAYS = 30;   // 合同 / 健康证到期预警阈值（天）

let staff = [];
let deptCache = [];
const DEPT_API = '/api/departments';
// 职位（岗位）联动来源：人事管理 → 组织架构 → 职位管理
const POS_API = '/api/positions';
let posCache = [];

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
// 身份证脱敏：前 4 + **** + 后 4（列表不展示完整号码）
function maskIdCard(no) {
  const s = String(no || '').trim();
  if (!s) return '';
  if (s.length <= 8) return s.slice(0, 1) + '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}
// 是否可写：管理员全量；部门账号需在「系统设置 → 组织架构权限」中勾选「后勤/职工管理」
// （服务端同样按模块拦截写接口，此处仅为前端提示与隐藏）
function canWrite() {
  const a = window.AUTH;
  if (!a) return true;
  if (a.role === 'admin') return true;
  return Array.isArray(a.writable) && a.writable.indexOf('logistics') !== -1;
}
function applyWriteScope() {
  if (canWrite()) return;
  const add = $('#btnAdd');
  if (add) add.style.display = 'none';
  $$('.row-actions').forEach(el => { el.remove(); });
  const main = document.querySelector('main.container');
  if (main && !$('#lgReadonly')) {
    const tip = document.createElement('div');
    tip.id = 'lgReadonly';
    tip.className = 'lg-tip warn';
    tip.style.marginBottom = '12px';
    tip.textContent = '当前账号仅可查看后勤职工档案；新增 / 修改 / 删除需管理员在「系统设置 → 组织架构权限」中为该部门勾选「后勤/职工管理」模块。';
    main.insertBefore(tip, main.firstChild);
  }
}

// ===== 下拉与联想词初始化 =====
function fillSelect(sel, list, placeholder) {
  if (!sel) return;
  const items = placeholder ? ['<option value="">' + placeholder + '</option>'] : [];
  list.forEach(v => { items.push('<option value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</option>'); });
  sel.innerHTML = items.join('');
}
function fillDatalist(id, values) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = values.map(v => '<option value="' + escapeHtml(v) + '"></option>').join('');
}
function initOptions() {
  fillSelect($('#fEmployType'), EMPLOY_TYPES);
  fillSelect($('#fShift'), SHIFTS, '（未指定班次）');
}
// 拉取组织架构部门（与人事管理共用 /api/departments），供「所属部门」联动下拉
async function loadDept() {
  try {
    const res = await fetch(DEPT_API);
    const json = await res.json();
    deptCache = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
  } catch (e) { deptCache = []; }
}
// 树形缩进填充「所属部门」下拉（value=部门名称，与后勤职工 department 字段一致）
function fillDeptSelect() {
  const sel = $('#fDepartment');
  if (!sel) return;
  const kidsOf = pid => deptCache.filter(d => (d.parentId || '') === pid);
  let html = '<option value="">（未分配部门）</option>';
  (function walk(pid, prefix) {
    kidsOf(pid).forEach(d => {
      html += '<option value="' + escapeHtml(d.name) + '">' + escapeHtml(prefix + d.name) + '</option>';
      walk(d.id, prefix + '　');
    });
  })('', '');
  sel.innerHTML = html;
}
// 拉取职位列表（人事管理 → 组织架构 → 职位管理），用于「具体岗位」联动联想
async function loadPositions() {
  try {
    const res = await fetch(POS_API);
    const json = await res.json();
    posCache = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
  } catch (e) { posCache = []; }
  fillPostSelect();
}
// 职位下拉联动：依据所选「所属部门」过滤职位；未选部门则禁用并提示先选部门。
// 仅列出人事「组织架构 → 职位管理」中该部门下定义的职位，不提供自由填写。
function fillPostSelect() {
  const sel = $('#fPost');
  if (!sel) return;
  const dept = ($('#fDepartment') ? $('#fDepartment').value : '').trim();
  const prev = sel.value;
  if (!dept) {
    sel.disabled = true;
    sel.innerHTML = '<option value="">（请先选择所属部门）</option>';
    return;
  }
  sel.disabled = false;
  const pool = (posCache || []).filter(p => (p.department || '') === dept).map(p => p.name).filter(Boolean);
  const uniq = [];
  pool.forEach(n => { if (uniq.indexOf(n) === -1) uniq.push(n); });
  let html = '<option value="">（请选择职位）</option>';
  if (!uniq.length) html = '<option value="">（该部门暂无职位）</option>';
  uniq.forEach(n => { html += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'; });
  sel.innerHTML = html;
  // 切换部门后若原选择仍存在于新列表则保留，否则重置
  if ([].some.call(sel.options, o => o.value === prev)) sel.value = prev;
  else sel.value = '';
}

// ===== 到期渲染 =====
function dueCell(dateStr, days) {
  if (!dateStr) return '<span class="head-none">—</span>';
  let cls = '', flag = '';
  if (days !== null && days !== undefined) {
    if (days < 0) { cls = ' due-over'; flag = '<span class="due-flag over">已过期 ' + Math.abs(days) + ' 天</span>'; }
    else if (days <= DUE_DAYS) {
      cls = ' due-soon';
      flag = '<span class="due-flag">' + (days === 0 ? '今天到期' : days + ' 天后到期') + '</span>';
    }
  }
  return '<span class="due-cell' + cls + '">' + escapeHtml(dateStr) + '</span>' + flag;
}
function statusClass(st) {
  if (OFF_DUTY.indexOf(st) !== -1) return 'st-off';
  return st === '在职' ? 'st-on' : 'st-warn';
}

// ===== 列表渲染 =====
function filtered() {
  const kw = String(($('#kw') && $('#kw').value) || '').trim().toLowerCase();
  const st = $('#statusFilter') ? $('#statusFilter').value : '';
  const emp = $('#employFilter') ? $('#employFilter').value : '';
  const due = $('#dueFilter') ? $('#dueFilter').value : '';
  return staff.filter(s => {
    if (st && s.status !== st) return false;
    if (emp && s.employType !== emp) return false;
    if (due === 'contract' && !(s.contractDays !== null && s.contractDays !== undefined && s.contractDays <= DUE_DAYS)) return false;
    if (due === 'health' && !(s.healthDays !== null && s.healthDays !== undefined && s.healthDays <= DUE_DAYS)) return false;
    if (!kw) return true;
    return [s.name, s.staffNo, s.phone, s.post, s.department, s.vendor, s.area, s.remark, s.emergencyPhone]
      .some(v => String(v || '').toLowerCase().indexOf(kw) !== -1);
  });
}
function renderStats() {
  const on = staff.filter(s => OFF_DUTY.indexOf(s.status) === -1);
  const dueOf = (key) => on.filter(s => {
    const d = s[key];
    return d !== null && d !== undefined && d <= DUE_DAYS;
  }).length;
  const outsourced = on.filter(s => s.employType === '外包' || s.employType === '劳务派遣').length;
  $('#statAll').textContent = staff.length;
  $('#statOn').textContent = on.length;
  $('#statContract').textContent = dueOf('contractDays');
  $('#statHealth').textContent = dueOf('healthDays');
  $('#statOut').textContent = outsourced;
}
function renderTable() {
  const list = filtered();
  const body = $('#lgBody');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty-tip">' +
      (staff.length ? '没有符合条件的职工，换个关键词或调整筛选试试' : '暂无后勤职工档案，点击右上角「添加职工」开始') +
      '</td></tr>';
    return;
  }
  body.innerHTML = list.map(s => {
    const off = OFF_DUTY.indexOf(s.status) !== -1;
    const sub = [s.staffNo ? '工号 ' + s.staffNo : '未编工号', s.idCard ? maskIdCard(s.idCard) : ''].filter(Boolean).join(' · ');
    const deptCell = (s.department || '—') + (s.vendor ? '<span class="lg-cell-sub">外包：' + escapeHtml(s.vendor) + '</span>' : '');
    return `<tr data-id="${escapeHtml(s.id)}"${off ? ' class="lg-off"' : ''}>
      <td>
        <span class="lg-name">${escapeHtml(s.name || '—')}</span>
        <span class="lg-sub">${escapeHtml(sub)}</span>
      </td>
      <td><span class="gender-tag ${s.gender === '女' ? 'gender-female' : 'gender-male'}">${escapeHtml(s.gender || '男')}</span></td>
      <td>${s.post ? escapeHtml(s.post) : '<span class="head-none">—</span>'}</td>
      <td>${deptCell}</td>
      <td>${escapeHtml(s.employType || '—')}</td>
      <td>${escapeHtml(s.shift || '—')}</td>
      <td>${escapeHtml(s.area || '—')}</td>
      <td class="lg-phone">${escapeHtml(s.phone || '—')}</td>
      <td class="lg-date">${escapeHtml(s.joinDate || '—')}</td>
      <td>${dueCell(s.contractEnd, s.contractDays)}</td>
      <td>${dueCell(s.healthCertEnd, s.healthDays)}</td>
      <td><span class="st-tag ${statusClass(s.status)}">${escapeHtml(s.status || '在职')}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-sm btn-edit" data-act="edit">编辑</button>
          <button type="button" class="btn-sm btn-del" data-act="del">删除</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
function render() {
  renderStats();
  renderTable();
  applyWriteScope();
}

async function loadList() {
  try {
    const res = await fetch(LG_API);
    const json = await res.json();
    staff = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
    render();
    refreshDatalists();
  } catch (e) {
    $('#lgBody').innerHTML = '<tr><td colspan="13" class="empty-tip">加载失败，请刷新重试</td></tr>';
    if (window.toast) window.toast('读取后勤职工档案失败', 'error');
  }
}
// 外包单位 / 负责区域联想：取现有档案中已填过的值，减少重复录入
function refreshDatalists() {
  const uniq = key => {
    const seen = {};
    return staff.map(s => String(s[key] || '').trim()).filter(v => v && !seen[v] && (seen[v] = 1)).slice(0, 40);
  };
  fillDatalist('vendorList', uniq('vendor'));
  fillDatalist('areaList', uniq('area'));
}

// ===== 弹窗 =====
function openModal(rec) {
  fillDeptSelect();
  $('#modalTitle').textContent = rec ? '编辑后勤职工 · ' + (rec.name || '') : '添加后勤职工';
  $('#fId').value = rec ? (rec.id || '') : '';
  $('#fName').value = rec ? (rec.name || '') : '';
  $('#fStaffNo').value = rec ? (rec.staffNo || '') : '';
  $('#fGender').value = rec ? (rec.gender || '男') : '男';
  $('#fDepartment').value = rec ? (rec.department || '') : '';
  // 职位：按所选部门联动填充，再回填已存岗位（不在列表中的追加为选项以保留原值）
  fillPostSelect();
  const postSel = $('#fPost');
  const postVal = rec ? (rec.post || '') : '';
  if (postVal) {
    if (![].some.call(postSel.options, o => o.value === postVal)) {
      const opt = document.createElement('option');
      opt.value = postVal; opt.textContent = postVal;
      postSel.appendChild(opt);
    }
    postSel.value = postVal;
  } else {
    postSel.value = '';
  }
  $('#fEmployType').value = rec ? (rec.employType || '其他') : '其他';
  $('#fVendor').value = rec ? (rec.vendor || '') : '';
  $('#fStatus').value = rec ? (rec.status || '在职') : '在职';
  $('#fShift').value = rec ? (rec.shift || '') : '';
  $('#fArea').value = rec ? (rec.area || '') : '';
  $('#fPhone').value = rec ? (rec.phone || '') : '';
  $('#fIdCard').value = rec ? (rec.idCard || '') : '';
  $('#fJoinDate').value = rec ? (rec.joinDate || '') : '';
  $('#fContractEnd').value = rec ? (rec.contractEnd || '') : '';
  $('#fHealthCertEnd').value = rec ? (rec.healthCertEnd || '') : '';
  $('#fEmergencyPhone').value = rec ? (rec.emergencyPhone || '') : '';
  $('#fAddress').value = rec ? (rec.address || '') : '';
  $('#fRemark').value = rec ? (rec.remark || '') : '';
  $('#modalMask').classList.add('show');
}
function closeModal() {
  $('#modalMask').classList.remove('show');
}

async function saveRec(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const payload = {
    staffNo: $('#fStaffNo').value.trim(),
    name: $('#fName').value.trim(),
    gender: $('#fGender').value,
    post: $('#fPost').value.trim(),
    department: $('#fDepartment').value.trim(),
    vendor: $('#fVendor').value.trim(),
    employType: $('#fEmployType').value,
    status: $('#fStatus').value,
    shift: $('#fShift').value,
    area: $('#fArea').value.trim(),
    phone: $('#fPhone').value.trim(),
    idCard: $('#fIdCard').value.trim(),
    joinDate: $('#fJoinDate').value,
    contractEnd: $('#fContractEnd').value,
    healthCertEnd: $('#fHealthCertEnd').value,
    emergencyPhone: $('#fEmergencyPhone').value.trim(),
    address: $('#fAddress').value.trim(),
    remark: $('#fRemark').value.trim()
  };
  if (!payload.name) { window.toast('请填写职工姓名', 'error'); return; }
  const submitBtn = (e && e.submitter) || $('#lgForm').querySelector('button[type="submit"]');
  const done = window.busyBtn ? window.busyBtn(submitBtn, '保存中…') : null;
  if (done === null) return;
  try {
    const res = await fetch(id ? `${LG_API}/${encodeURIComponent(id)}` : LG_API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!json || json.code !== 0) throw new Error((json && json.msg) || '保存失败');
    window.toast(json.msg || '已保存', 'success');
    closeModal();
    await loadList();
  } catch (err) {
    window.toast('保存失败：' + err.message, 'error');
  } finally {
    if (done) done();
  }
}

async function delRec(id, name) {
  const ok = window.confirmDlg
    ? await window.confirmDlg(`确定删除「${name}」的后勤职工档案吗？删除后不可恢复。`, { title: '删除档案', okText: '删除', danger: true })
    : window.confirm(`确定删除「${name}」的后勤职工档案吗？删除后不可恢复。`);
  if (!ok) return;
  try {
    const res = await fetch(`${LG_API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.code !== 0) { window.toast(json.msg || '删除失败', 'error'); return; }
    window.toast('已删除', 'success');
    await loadList();
  } catch (err) {
    window.toast('删除失败：' + err.message, 'error');
  }
}

// ===== 导出 CSV =====
function exportCsv() {
  const list = filtered();
  if (!list.length) { window.toast('当前筛选下没有可导出的档案', 'error'); return; }
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['工号', '姓名', '性别', '具体岗位', '所属部门', '用工性质', '外包/派遣单位', '班次',
    '负责区域', '联系电话', '入职日期', '合同到期', '健康证到期', '在职状态', '紧急联系电话', '家庭住址', '备注'];
  const lines = [head.map(cell).join(',')];
  list.forEach(s => {
    lines.push([s.staffNo, s.name, s.gender, s.post, s.department, s.employType, s.vendor, s.shift,
      s.area, s.phone, s.joinDate, s.contractEnd, s.healthCertEnd, s.status, s.emergencyPhone, s.address, s.remark]
      .map(cell).join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '后勤职工档案-' + todayStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  window.toast('已导出 ' + list.length + ' 条档案', 'success');
}

// ===== 事件绑定 =====
function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#btnExport').onclick = exportCsv;
  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#modalMask').onclick = (e) => { if (e.target === $('#modalMask')) closeModal(); };
  $('#lgForm').onsubmit = saveRec;
  $('#kw').oninput = renderTable;
  $('#statusFilter').onchange = renderTable;
  $('#employFilter').onchange = renderTable;
  $('#dueFilter').onchange = renderTable;
  // 选择部门后，「具体岗位」联想词联动为该部门下定义的职位
  $('#fDepartment').onchange = fillPostSelect;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Esc') closeModal(); });
  // 行内编辑 / 删除（事件委托，重渲染不丢监听）
  $('#lgBody').addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr ? tr.dataset.id : '';
    const rec = staff.find(x => x.id === id);
    if (!rec) return;
    if (btn.dataset.act === 'edit') openModal(rec);
    else if (btn.dataset.act === 'del') delRec(rec.id, rec.name || '该职工');
  });
}

// 工作台顶栏 / 页签菜单「刷新当前页」
window.cbEmbedRefresh = function () { loadList(); };

function init() {
  initOptions();
  bindEvents();
  loadList();
  loadDept().then(fillDeptSelect);
  loadPositions();
}
init();
// 登录态就绪后按「组织架构权限」重渲染一次（未授权时隐藏写操作入口）
window.addEventListener('cb-auth-ready', function () { render(); }, { once: true });
