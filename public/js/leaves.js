// 请假管理（后台）— 学生在线请假与代登记统一审批，批准后同步写入考勤
const $L = s => document.querySelector(s);
const escL = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const LEAF_API = '/api/leaves';
const GRADES_API = '/api/grades';
const TYPES = ['病假', '事假', '公假', '其他'];
const STATUS = { pending: { label: '待审批', cls: 'tag-p' }, approved: { label: '已批准', cls: 'tag-a' }, rejected: { label: '已驳回', cls: 'tag-r' } };

let leaves = [];
let allStudents = [];
let gradesList = [];
let statusTab = 'all';
let curReview = null;
let editingId = null;      // 正在编辑的请假 id；null 表示新增（代登记）
let stuFocused = -1;
let stuFiltered = [];

function apiL(url, method = 'GET', body) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json()).then(j => {
    if (j.code !== 0) throw new Error(j.msg || '请求失败');
    return j.data;
  });
}
function localToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysBetween(a, b) {
  if (!a || !b || a > b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}
function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function canWrite() {
  return !window.AUTH || window.AUTH.role !== 'viewer';
}

function renderChips() {
  const counts = { all: leaves.length, pending: 0, approved: 0, rejected: 0 };
  leaves.forEach(x => { if (STATUS[x.status]) counts[x.status]++; });
  const list = [
    { k: 'all', label: '全部', n: counts.all, dot: '' },
    { k: 'pending', label: '待审批', n: counts.pending, dot: '#f59e0b' },
    { k: 'approved', label: '已批准', n: counts.approved, dot: '#10b981' },
    { k: 'rejected', label: '已驳回', n: counts.rejected, dot: '#ef4444' }
  ];
  $L('#sumChips').innerHTML = list.map(c => `
    <button class="sum-chip ${c.k === statusTab ? 'active' : ''}" data-st="${c.k}">
      <span>${c.dot ? '<i class="dot" style="background:' + c.dot + '"></i>' : ''}${c.label}</span>
      <b>${c.n}</b>
    </button>`).join('');
}
function filtered() {
  const kw = ($L('#kw').value || '').trim().toLowerCase();
  const g = $L('#gradeFilter').value;
  return leaves.filter(x => {
    if (statusTab !== 'all' && x.status !== statusTab) return false;
    if (g && x.grade !== g) return false;
    if (kw && ![x.name, x.no, x.className, x.reason, x.reviewer].some(v => String(v || '').toLowerCase().includes(kw))) return false;
    return true;
  });
}
function renderList() {
  const list = filtered();
  $L('#leafEmpty').style.display = list.length ? 'none' : '';
  const body = $L('#leafBody');
  if (!list.length) { body.innerHTML = ''; return; }
  const isAdmin = canWrite();
  body.innerHTML = list.map(x => {
    const st = STATUS[x.status] || STATUS.pending;
    const reviewInfo = x.status === 'pending'
      ? '<span class="type-line">等待审批</span>'
      : (x.reviewedAt ? fmt(x.reviewedAt) + (x.reviewer ? ' · ' + escL(x.reviewer) : '') : '—') + (x.reviewNote ? '<br/><span class="type-line">意见：' + escL(x.reviewNote) + '</span>' : '');
    const ops = [];
    if (isAdmin) {
      if (x.status === 'pending') {
        ops.push('<button class="btn btn-sm btn-success" data-act="review" data-id="' + x.id + '">审批</button>');
        ops.push('<button class="btn btn-sm btn-default" data-act="edit" data-id="' + x.id + '">编辑</button>');
      } else {
        ops.push('<button class="btn btn-sm btn-default" data-act="review" data-id="' + x.id + '" title="查看">查看</button>');
      }
      ops.push('<button class="btn btn-sm btn-danger" data-act="del" data-id="' + x.id + '">删除</button>');
    }
    return `<tr>
      <td><strong>${escL(x.name)}</strong><div class="type-line">${escL(x.no || '')}${x.gender ? ' · ' + escL(x.gender) : ''}</div></td>
      <td>${x.className ? escL(x.className) : '<span class="type-line">待分班</span>'}</td>
      <td><span class="tag tag-p">${escL(x.type)}</span><div class="type-line">${x.days || daysBetween(x.startDate, x.endDate)} 天</div></td>
      <td>${escL(x.startDate || '—')} ~ ${escL(x.endDate || '—')}</td>
      <td style="max-width:220px">${escL(x.reason || '—')}</td>
      <td><span class="type-line">${x.source === 'student' ? '学生提交' : '代登记'}</span>${x.source === 'student' ? '<br/>' + escL(x.submitter || '') : ''}</td>
      <td class="type-line">${fmt(x.createdAt)}</td>
      <td><span class="tag ${st.cls}">${st.label}</span><div class="type-line">${reviewInfo}</div></td>
      <td><div class="btn-row">${ops.join('')}</div></td>
    </tr>`;
  }).join('');
}
function renderAll() {
  renderChips();
  renderList();
}
function applyWriteVisibility() {
  const hidden = !canWrite();
  ['btnNew'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = hidden ? 'none' : ''; });
}

async function loadLeaves() {
  try {
    leaves = await apiL(LEAF_API + '?v=' + Date.now(), 'GET');
    refreshGradeFilter();
    renderAll();
  } catch (e) { toast(e.message, 'error'); }
}
function refreshGradeFilter() {
  const gf = document.getElementById('gradeFilter');
  if (!gf) return;
  const prev = gf.value;
  // 年级筛选以「系统年级全集」为准；接口异常时兜底取学生/请假记录里的年级
  let grades = gradesList.slice();
  if (!grades.length) {
    grades = Array.from(new Set([
      ...leaves.map(x => x.grade),
      ...allStudents.map(s => s.grade)
    ].filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true }));
  }
  gf.innerHTML = '<option value="">全部年级</option>' + grades.map(g => `<option value="${escL(g)}">${escL(g)}</option>`).join('');
  gf.value = grades.includes(prev) ? prev : '';
}
function loadGrades() {
  return apiL(GRADES_API + '?v=' + Date.now(), 'GET').then(g => { gradesList = Array.isArray(g) ? g : []; });
}
function loadStudents() {
  return apiL('/api/all-students?v=' + Date.now(), 'GET').then(list => {
    allStudents = list.slice().sort((a, b) => {
      const c = (a.grade || '').localeCompare(b.grade || '', 'zh-Hans-CN', { numeric: true });
      return c || (a.className || '').localeCompare(b.className || '', 'zh-Hans-CN', { numeric: true}) || String(a.studentId || '').localeCompare(String(b.studentId || ''), 'zh-Hans-CN', { numeric: true });
    });
  });
}
// 打开表单弹窗：x 为空 = 代登记，传入记录 = 编辑（与其他页面「同一弹窗复用」一致）
function openForm(x) {
  if (!canWrite()) { toast('查看模式仅可浏览', 'error'); return; }
  editingId = x ? x.id : null;
  $L('#formTitle').textContent = x ? '编辑请假' : '代登记请假';
  $L('#btnSave').textContent = x ? '保存修改' : '提交（待审批）';
  $L('#stuSug').hidden = true;
  // 编辑时不允许更换学生（后端 PUT 也不接收 studentId），仅只读展示
  $L('#stuSearch').disabled = !!x;
  $L('#stuSearch').value = x ? `${x.name || ''}（${x.no || '—'}${x.className ? ' · ' + x.className : ''}）` : '';
  $L('#stuSel').value = '';
  $L('#typeSel').innerHTML = TYPES.map(t => `<option${x && x.type === t ? ' selected' : ''}>${t}</option>`).join('');
  const t = localToday();
  $L('#startDate').value = x ? (x.startDate || t) : t;
  $L('#endDate').value = x ? (x.endDate || t) : t;
  $L('#reason').value = x ? (x.reason || '') : '';
  updateDaysTip();
  $L('#newMask').classList.add('show');
}
// 关闭表单弹窗并复位编辑态
function closeForm() {
  editingId = null;
  $L('#newMask').classList.remove('show');
}
function stuLabel(s) {
  return `${s.name}（${s.studentId || '—'}${s.className ? ' · ' + s.className : ' · 待分班'}）`;
}
function stuFilter(kw) {
  return allStudents
    .filter(s => !s.status || s.status === 'active')
    .filter(s => [s.name, s.studentId, s.className, s.grade].some(v => String(v || '').toLowerCase().includes(kw)))
    .slice(0, 50);
}
function renderStuSug() {
  const box = $L('#stuSug');
  if (!stuFiltered.length) {
    box.innerHTML = '<div class="sug-empty">无匹配学生</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = stuFiltered.map((s, i) => `
    <div class="sug-item ${i === stuFocused ? 'on' : ''}" data-id="${s.id}">
      <span><strong>${escL(s.name)}</strong><span class="sug-no">${escL(s.studentId || '')}</span></span>
      <span class="sug-info">${escL(s.className || '待分班')}${s.grade ? ' · ' + escL(s.grade) : ''}</span>
    </div>`).join('');
  box.hidden = false;
}
function showStuSug(kw) {
  kw = (kw || '').trim().toLowerCase();
  if (!kw) { $L('#stuSug').hidden = true; return; }
  stuFocused = -1;
  stuFiltered = stuFilter(kw);
  renderStuSug();
}
function pickStu(s) {
  $L('#stuSearch').value = stuLabel(s);
  $L('#stuSel').value = s.id;
  $L('#stuSug').hidden = true;
}
function updateDaysTip() {
  const n = daysBetween($L('#startDate').value, $L('#endDate').value);
  $L('#daysTip').textContent = n ? n + ' 天' : '结束日期不能早于开始日期';
}
// 数据变化后通知父工作台刷新侧边栏「请假管理」待审批角标（独立打开页面时无操作）
function notifyLeavesChangedToParent() {
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'icst-leaves' }, location.origin);
  } catch (e) {}
}
async function submitForm() {
  const type = $L('#typeSel').value;
  const s = $L('#startDate').value;
  const e = $L('#endDate').value;
  if (!editingId && !$L('#stuSel').value) return toast('请从搜索结果中选择学生', 'error');
  if (!s || !e || s > e) return toast('请选择正确的起止日期', 'error');
  const reason = $L('#reason').value;
  try {
    if (editingId) {
      await apiL(`${LEAF_API}/${editingId}`, 'PUT', { type, startDate: s, endDate: e, reason });
      toast('请假已更新', 'success');
    } else {
      await apiL(LEAF_API, 'POST', { studentId: $L('#stuSel').value, type, startDate: s, endDate: e, reason });
      toast('已登记，等待审批', 'success');
    }
    closeForm();
    await loadLeaves();
    notifyLeavesChangedToParent();
  } catch (err) { toast(err.message, 'error'); }
}
function openReview(x) {
  curReview = x;
  const st = STATUS[x.status] || STATUS.pending;
  $L('#reviewInfo').innerHTML =
    `<div style="font-size:15px;font-weight:600;margin-bottom:4px">${escL(x.name)}${x.no ? '（' + escL(x.no) + '）' : ''}</div>
     <div>班级：${escL(x.className || '待分班')} · 类型：${escL(x.type)}</div>
     <div>时间：${escL(x.startDate)} ~ ${escL(x.endDate)}（${x.days || daysBetween(x.startDate, x.endDate)} 天）</div>
     <div>事由：${escL(x.reason || '—')}</div>
     <div style="margin-top:4px">当前状态：<span class="tag ${st.cls}">${st.label}</span>${x.reviewer ? ' · 处理人：' + escL(x.reviewer) : ''}</div>`;
  $L('#reviewNote').value = x.reviewNote || '';
  const pending = x.status === 'pending' && canWrite();
  $L('#btnApprove').style.display = pending ? '' : 'none';
  $L('#btnReject').style.display = pending ? '' : 'none';
  $L('#reviewMask').classList.add('show');
}
async function doReview(action) {
  if (!curReview) return;
  const note = $L('#reviewNote').value.trim();
  try {
    await apiL(`${LEAF_API}/${curReview.id}/review`, 'POST', { action, note });
    toast(action === 'approve' ? '已批准，请假已同步写入该班考勤' : '已驳回', 'success');
    $L('#reviewMask').classList.remove('show');
    await loadLeaves();
    notifyLeavesChangedToParent();
  } catch (err) { toast(err.message, 'error'); }
}
async function delLeaf(id) {
  const x = leaves.find(v => v.id === id);
  if (!(await confirmDlg('确定删除这条请假记录？（不影响已写入的考勤）', { title: '删除请假', okText: '删除', danger: true }))) return;
  try {
    await apiL(`${LEAF_API}/${id}`, 'DELETE');
    toast('已删除', 'success');
    await loadLeaves();
    notifyLeavesChangedToParent();
  } catch (err) { toast(err.message, 'error'); }
}
function exportCsv() {
  const list = filtered();
  if (!list.length) return toast('没有可导出的记录', 'error');
  const head = ['学号', '姓名', '性别', '年级', '班级', '类型', '开始日期', '结束日期', '天数', '事由', '来源', '状态', '审批人', '审批时间', '提交时间'];
  const rows = list.map(x => [
    x.no, x.name, x.gender || '', x.grade || '', x.className || '',
    x.type, x.startDate || '', x.endDate || '', x.days || '', x.reason || '',
    x.source === 'student' ? '学生提交' : '代登记', (STATUS[x.status] || {}).label || x.status,
    x.reviewer || '', x.reviewedAt ? fmt(x.reviewedAt) : '', x.createdAt ? fmt(x.createdAt) : ''
  ]);
  const csv = '\uFEFF' + [head, ...rows].map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = '请假记录_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function bindEvents() {
  $L('#btnNew').onclick = () => openForm(null);
  $L('#btnExport').onclick = exportCsv;
  $L('#newX').onclick = closeForm;
  $L('#newCancel').onclick = closeForm;
  $L('#newMask').addEventListener('click', e => { if (e.target === $L('#newMask')) closeForm(); });
  $L('#btnSave').onclick = submitForm;
  $L('#startDate').onchange = updateDaysTip;
  $L('#endDate').onchange = updateDaysTip;

  // 学生搜索选择
  const stuSearch = $L('#stuSearch');
  const stuSug = $L('#stuSug');
  stuSearch.addEventListener('input', () => { $L('#stuSel').value = ''; showStuSug(stuSearch.value); });
  stuSearch.addEventListener('focus', () => { if (stuSearch.value.trim()) showStuSug(stuSearch.value); });
  stuSearch.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!stuFiltered.length) return;
      stuFocused = stuFocused < stuFiltered.length - 1 ? stuFocused + 1 : stuFocused;
      renderStuSug();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      stuFocused = stuFocused > -1 ? stuFocused - 1 : stuFocused;
      renderStuSug();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = stuFocused >= 0 ? stuFiltered[stuFocused] : stuFiltered[0];
      if (s) pickStu(s);
    } else if (e.key === 'Escape') {
      stuSug.hidden = true;
    }
  });
  stuSearch.addEventListener('blur', () => setTimeout(() => { stuSug.hidden = true; }, 150));
  stuSug.addEventListener('mousedown', e => {
    const item = e.target.closest('.sug-item');
    if (!item) return;
    const s = stuFiltered.find(v => String(v.id) === item.dataset.id);
    if (s) pickStu(s);
  });

  $L('#reviewX').onclick = () => $L('#reviewMask').classList.remove('show');
  $L('#reviewMask').addEventListener('click', e => { if (e.target === $L('#reviewMask')) $L('#reviewMask').classList.remove('show'); });
  $L('#btnApprove').onclick = () => doReview('approve');
  $L('#btnReject').onclick = () => doReview('reject');

  $L('#sumChips').addEventListener('click', e => {
    const chip = e.target.closest('.sum-chip');
    if (!chip) return;
    statusTab = chip.dataset.st;
    renderChips();
    renderList();
  });
  $L('#kw').oninput = renderList;
  $L('#gradeFilter').onchange = renderList;
  $L('#leafBody').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const x = leaves.find(v => v.id === id);
    if (btn.dataset.act === 'review') openReview(x);
    else if (btn.dataset.act === 'edit') openForm(x);
    else if (btn.dataset.act === 'del') delLeaf(id);
  });
}

(async function init() {
  try {
    await Promise.all([loadStudents(), loadLeaves()]);
    await loadGrades();
    refreshGradeFilter();
  } catch (e) { toast(e.message, 'error'); }
  bindEvents();
  applyWriteVisibility();
  renderAll();
})();
window.cbEmbedRefresh = () => loadLeaves();
