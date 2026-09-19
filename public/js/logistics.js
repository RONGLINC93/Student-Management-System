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
// 左侧部门树筛选：kind = all（全部）/ dept（部门，含下属部门）/ post（部门下的岗位）/ none（未分配部门）
let treeSel = { kind: 'all', value: '', dept: '', post: '' };
// 部门树折叠状态（键：'__root__' / 'd:部门名'），默认展开
const deptCollapsed = new Set();
// 树节点图标：全部职工 / 部门 / 岗位
const TREE_ICONS = {
  root: '<svg class="gico school" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/></svg>',
  dept: '<svg class="gico grade" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 14l9 5 9-5"/></svg>',
  post: '<svg class="gico cls" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16"/><path d="M16 10h.01"/><path d="M16 14h.01"/></svg>'
};
// 职位（岗位）联动来源：人事管理 → 组织架构 → 职位管理
const POS_API = '/api/positions';
let posCache = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// 职工照片：上传 / 摄像头拍照由公共模块 /js/photo.js 提供（教师、学生档案共用同一套交互）
let photoField = null;

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

// 行操作按钮（操作 ▾）的三角图标
const IC_CARET = '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

// ===== 左侧「所属部门」树：点击节点筛选职工 =====
// 部门来自人事管理 → 组织架构（/api/departments），职工通过 department（部门名称）归属
function deptKidsOf(pid) {
  const p = String(pid || '');
  return deptCache.filter(d => String(d.parentId || '') === p);
}
// 某部门的所有下属部门名（用于「含下属部门」统计与筛选）
function descendantNames(name) {
  const out = [];
  (function walk(list) {
    list.forEach(d => {
      const kids = deptKidsOf(d.id);
      kids.forEach(k => out.push(String(k.name || '').trim()));
      walk(kids);
    });
  })(deptCache.filter(d => String(d.name || '').trim() === name));
  return out;
}
// 职工中出现、但组织架构里已不存在的部门名（如部门改名 / 删除），单独挂出以免这些职工无处查找
function extraDeptNames() {
  const known = deptCache.map(d => String(d.name || '').trim());
  const names = [];
  staff.forEach(s => {
    const n = String(s.department || '').trim();
    if (n && known.indexOf(n) === -1 && names.indexOf(n) === -1) names.push(n);
  });
  return names;
}
// 部门下已有职工的岗位（岗位来自「组织架构 → 职位管理」，此处只列实际有人的岗位）
function postsOfDept(name) {
  const posts = [];
  staff.forEach(s => {
    if (String(s.department || '').trim() !== name) return;
    const p = String(s.post || '').trim();
    if (p && posts.indexOf(p) === -1) posts.push(p);
  });
  return posts.sort();
}
function matchTree(s, sel) {
  if (!sel || sel.kind === 'all') return true;
  const dept = String(s.department || '').trim();
  if (sel.kind === 'none') return !dept;
  if (sel.kind === 'dept') {
    if (!dept) return false;
    return dept === sel.value || descendantNames(sel.value).indexOf(dept) !== -1;
  }
  if (sel.kind === 'post') return dept === sel.dept && String(s.post || '').trim() === sel.post;
  return true;
}
function treeRow(o) {
  const toggle = o.hasKids
    ? '<button type="button" class="gtree-toggle' + (o.collapsed ? ' collapsed' : '') + '" data-toggle="' + escapeHtml(o.nodeId || '') + '" aria-label="展开 / 收起"></button>'
    : '<span class="gtree-toggle leaf"></span>';
  return '<div class="gtree-row' + (o.selected ? ' selected' : '') + '" data-kind="' + escapeHtml(o.kind) + '" data-value="' + escapeHtml(o.value || '') + '"'
    + (o.dept ? ' data-dept="' + escapeHtml(o.dept) + '"' : '')
    + (o.title ? ' title="' + escapeHtml(o.title) + '"' : '') + '>'
    + toggle + o.icon
    + '<span class="gname">' + escapeHtml(o.name) + '</span>'
    + (o.meta ? '<span class="gmeta">' + escapeHtml(o.meta) + '</span>' : '')
    + '</div>';
}
// 递归渲染部门节点：下属部门 + 本部门岗位
function deptNode(d, isSel, countOf) {
  const name = String(d.name || '').trim();
  const kids = deptKidsOf(d.id);
  const posts = postsOfDept(name);
  const collapsed = deptCollapsed.has('d:' + name);
  let node = '<div class="gnode' + (collapsed ? ' collapsed' : '') + '">' + treeRow({
    icon: TREE_ICONS.dept, name, kind: 'dept', value: name,
    meta: countOf({ kind: 'dept', value: name }) + ' 人',
    selected: isSel('dept', name, ''), hasKids: kids.length > 0 || posts.length > 0,
    collapsed, nodeId: 'd:' + name,
    title: name + (kids.length ? '（含 ' + kids.length + ' 个下属部门）' : '')
  });
  if (kids.length || posts.length) {
    let inner = kids.map(k => deptNode(k, isSel, countOf)).join('');
    posts.forEach(p => {
      inner += '<div class="gnode">' + treeRow({
        icon: TREE_ICONS.post, name: p, kind: 'post', value: p, dept: name,
        meta: countOf({ kind: 'post', dept: name, post: p }) + ' 人',
        selected: isSel('post', p, name), title: name + ' · ' + p
      }) + '</div>';
    });
    node += '<div class="gchildren">' + inner + '</div>';
  }
  return node + '</div>';
}
function renderDeptTree() {
  const host = $('#deptTree');
  if (!host) return;
  const isSel = (kind, value, dept) => treeSel.kind === kind
    && String(treeSel.value || '') === String(value || '')
    && String(treeSel.dept || '') === String(dept || '');
  const countOf = sel => staff.filter(s => matchTree(s, sel)).length;
  const rootCollapsed = deptCollapsed.has('__root__');
  const extras = extraDeptNames();
  let kids = '<div class="gnode">' + treeRow({
    icon: TREE_ICONS.post, name: '未分配部门', kind: 'none', value: '',
    meta: countOf({ kind: 'none' }) + ' 人', selected: isSel('none', '', ''),
    title: '尚未分配部门的职工'
  }) + '</div>';
  deptKidsOf('').forEach(d => { kids += deptNode(d, isSel, countOf); });
  extras.forEach(n => { kids += deptNode({ id: '__ext__:' + n, name: n }, isSel, countOf); });
  const empty = !deptCache.length && !extras.length;
  host.innerHTML = '<div class="gnode gnode-root' + (rootCollapsed ? ' collapsed' : '') + '">'
    + treeRow({
      icon: TREE_ICONS.root, name: '全部职工', kind: 'all', value: '',
      meta: staff.length + ' 人', selected: isSel('all', '', ''),
      hasKids: true, collapsed: rootCollapsed, nodeId: '__root__', title: '显示全部后勤职工'
    })
    + '<div class="gchildren">' + kids + '</div></div>'
    + (empty ? '<p class="sidebar-tip" style="margin-top:8px">暂无部门，请先在「人事管理 → 组织架构」中建立部门。</p>' : '');
}
function bindDeptTree() {
  const host = $('#deptTree');
  if (!host || host.dataset.bound) return;
  host.dataset.bound = '1';
  host.addEventListener('click', e => {
    const tg = e.target.closest('.gtree-toggle');
    if (tg && !tg.classList.contains('leaf')) {
      const id = tg.dataset.toggle || '';
      if (deptCollapsed.has(id)) deptCollapsed.delete(id);
      else deptCollapsed.add(id);
      renderDeptTree();
      return;
    }
    const row = e.target.closest('.gtree-row');
    if (!row) return;
    const kind = row.dataset.kind || 'all';
    const value = row.dataset.value || '';
    const dept = row.dataset.dept || '';
    // 已选中则保持不变（避免重复刷新）；切换其它节点或点「全部职工」即恢复
    if (treeSel.kind === kind && String(treeSel.value || '') === value && String(treeSel.dept || '') === dept) return;
    treeSel = { kind, value, dept, post: kind === 'post' ? value : '' };
    renderDeptTree();
    renderTable();
  });
}
// 工具栏中的筛选提示 chip（显示当前部门 / 岗位与命中人数，可一键清除）
function updateTreeChip(count) {
  const chip = $('#treeChip');
  if (!chip) return;
  const txt = $('#treeChipText');
  // 未筛选时隐藏并清空文本，避免残留上一次的筛选提示
  if (treeSel.kind === 'all') { chip.hidden = true; if (txt) txt.textContent = ''; return; }
  let label = '未分配部门';
  if (treeSel.kind === 'dept') label = '部门：' + treeSel.value;
  else if (treeSel.kind === 'post') label = '岗位：' + treeSel.value + '（' + treeSel.dept + '）';
  chip.hidden = false;
  if (txt) txt.textContent = label + ' · ' + count + ' 人';
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
    // 左侧部门树筛选（与工具栏其它条件为「且」关系）
    if (!matchTree(s, treeSel)) return false;
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
  updateTreeChip(list.length);
  const body = $('#lgBody');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty-tip">' +
      (!staff.length ? '暂无后勤职工档案，点击右上角「添加职工」开始'
        : (treeSel.kind === 'all' ? '没有符合条件的职工，换个关键词或调整筛选试试'
          : '该部门 / 岗位下没有符合条件的职工，点击左侧「全部职工」查看全部')) +
      '</td></tr>';
    return;
  }
  body.innerHTML = list.map(s => {
    const off = OFF_DUTY.indexOf(s.status) !== -1;
    const sub = [s.staffNo ? '工号 ' + s.staffNo : '未编工号', s.idCard ? maskIdCard(s.idCard) : ''].filter(Boolean).join(' · ');
    const deptCell = (s.department || '—') + (s.vendor ? '<span class="lg-cell-sub">外包：' + escapeHtml(s.vendor) + '</span>' : '');
    // 头像：有照片显示照片，否则退回首字色块
    const gen = s.gender === '女' ? 'f' : 'm';
    const first = (s.name || '').trim().charAt(0) || '职';
    const avatar = (window.PhotoField && window.PhotoField.isSrc(s.photo))
      ? `<span class="lg-avatar"><img src="${escapeHtml(s.photo)}" alt="" /></span>`
      : `<span class="lg-avatar ${gen}">${escapeHtml(first)}</span>`;
    return `<tr data-id="${escapeHtml(s.id)}"${off ? ' class="lg-off"' : ''}>
      <td>
        <div class="lg-cell">
          ${avatar}
          <div>
            <span class="lg-name">${escapeHtml(s.name || '—')}</span>
            <span class="lg-sub">${escapeHtml(sub)}</span>
          </div>
        </div>
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
          <button type="button" class="btn-sm more-btn" data-act="more" title="编辑 / 删除">操作${IC_CARET}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
function render() {
  renderStats();
  renderTable();
  renderDeptTree(); // 部门树人数随档案变化（新增 / 编辑 / 删除后同步）
  applyWriteScope();
}

async function loadList() {
  try {
    const res = await fetch(LG_API);
    const json = await res.json();
    staff = (json && json.code === 0 && Array.isArray(json.data)) ? json.data : [];
    render();
    refreshDatalists();
    applyStaffDeepLink();
  } catch (e) {
    $('#lgBody').innerHTML = '<tr><td colspan="13" class="empty-tip">加载失败，请刷新重试</td></tr>';
    if (window.toast) window.toast('读取后勤职工档案失败', 'error');
  }
}
// 深链：人事管理「人员名单 → 查看」跳转（?staff=id）时直接打开该职工详情
let staffDeepLinkDone = false;
let staffDeepLinkBack = false;   // 该详情是否由人事管理深链打开（关闭时回跳）
function applyStaffDeepLink() {
  if (staffDeepLinkDone) return;
  const id = new URLSearchParams(location.search).get('staff');
  if (!id) return;
  const s = staff.find(x => String(x.id) === String(id));
  if (!s) return;
  staffDeepLinkDone = true;
  staffDeepLinkBack = true;   // 关闭详情后回跳人事管理
  openModal(s);
}
// 页签已打开且地址未变时（重复查看同一人），由工作台下发指令重新执行深链
window.cbEmbedDeepLink = function () {
  staffDeepLinkDone = false;
  applyStaffDeepLink();
};
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
  if (photoField) photoField.set(rec ? (rec.photo || '') : '');   // 照片：编辑时回填，新增时清空
  $('#fName').value = rec ? (rec.name || '') : '';
  $('#fStaffNo').value = rec ? (rec.staffNo || '') : '';
  $('#fGender').value = rec ? (rec.gender || '男') : '男';
  // 所属部门：回填已存值；若该部门已改名 / 删除（不在下拉里），追加为选项以保留原值
  const deptSel = $('#fDepartment');
  const deptVal = rec ? (rec.department || '') : '';
  if (deptVal && ![].some.call(deptSel.options, o => o.value === deptVal)) {
    const dopt = document.createElement('option');
    dopt.value = deptVal; dopt.textContent = deptVal;
    deptSel.appendChild(dopt);
  }
  deptSel.value = deptVal;
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
  // 由人事管理「查看」深链打开的详情：关闭后回到人事管理（页签已开则直接切回）
  if (staffDeepLinkBack) {
    staffDeepLinkBack = false;
    if (typeof window.goPage === 'function') window.goPage('/hr.html');
    else location.href = '/hr.html';
  }
}

async function saveRec(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const payload = {
    photo: photoField ? photoField.get() : '',   // 照片（弹窗内上传 / 拍照后的 data:image；空串表示移除）
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

// ===== 行操作下拉菜单：操作 ▾ → 编辑 / 删除 =====
// 菜单容器与定位由 /js/rowmenu.js（教师管理、后勤管理共用）负责，这里只定义菜单项与动作
function openRowMenu(rec, anchor) {
  if (!window.RowMenu) return;
  const IC = window.ROW_ICONS || {};
  window.RowMenu.open(anchor, {
    caption: '操作 · ' + (rec.name || ''),
    tail: [
      { kind: 'edit', label: '编辑档案', icon: IC.edit || '' },
      { kind: 'del', label: '删除档案', icon: IC.trash || '', danger: true }
    ],
    onPick: (ds) => {
      if (ds.kind === 'edit') openModal(rec);
      else if (ds.kind === 'del') delRec(rec.id, rec.name || '该职工');
    }
  });
}

// ===== 事件绑定 =====
function bindEvents() {
  // 职工照片：上传 / 摄像头拍照（公共模块 /js/photo.js，教师、学生档案共用同一套交互）
  if (window.PhotoField) {
    photoField = window.PhotoField.create({
      preview: '#fPhotoPreview', pick: '#fPhotoPick', cam: '#fPhotoCam',
      clear: '#fPhotoClear', input: '#fPhotoFile'
    });
  }
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
  // 左侧部门树：点击节点筛选职工；chip 上的 × 与侧栏「全部职工」按钮清除筛选
  bindDeptTree();
  const clearTree = () => {
    if (treeSel.kind === 'all') return;
    treeSel = { kind: 'all', value: '', dept: '', post: '' };
    renderDeptTree();
    renderTable();
  };
  if ($('#btnTreeAll')) $('#btnTreeAll').onclick = clearTree;
  if ($('#treeChipClear')) $('#treeChipClear').onclick = clearTree;
  // 选择部门后，「具体岗位」联想词联动为该部门下定义的职位
  $('#fDepartment').onchange = fillPostSelect;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Esc') closeModal(); });
  // 行内「操作 ▾」下拉菜单（事件委托，重渲染不丢监听）
  $('#lgBody').addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    const tr = btn.closest('tr');
    const id = tr ? tr.dataset.id : '';
    const rec = staff.find(x => x.id === id);
    if (!rec) return;
    if (btn.dataset.act === 'more') openRowMenu(rec, btn);
  });
}

// 工作台顶栏 / 页签菜单「刷新当前页」
window.cbEmbedRefresh = function () { loadList(); };

function init() {
  initOptions();
  bindEvents();
  // 先拉部门 / 职位再拉档案：人事管理「查看」深链打开详情时，部门 / 职位联动才不会是空的
  Promise.all([loadDept(), loadPositions()]).then(() => {
    fillDeptSelect();
    renderDeptTree();
    loadList();
  });
}
init();
// 登录态就绪后按「组织架构权限」重渲染一次（未授权时隐藏写操作入口）
window.addEventListener('cb-auth-ready', function () { render(); }, { once: true });
