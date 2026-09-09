// 通知公告（后台）
const $A = s => document.querySelector(s);
const escA = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const ANN_API = '/api/announcements';

let anns = [];
let classes = [];
let gradeList = [];
let editingId = null;

function apiA(url, method = 'GET', body) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json()).then(j => {
    if (j.code !== 0) throw new Error(j.msg || '请求失败');
    return j.data;
  });
}
function fmtA(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function canWrite() {
  return !window.AUTH || window.AUTH.role !== 'viewer';
}
function scopeLabel(x) {
  if (x.scopeType === 'all') return '<span class="scope all">全校</span>';
  if (x.scopeType === 'grade') return '<span class="scope">年级 · ' + escA(x.scopeValue) + '</span>';
  return '<span class="scope">班级 · ' + escA(x.scopeValue) + '</span>';
}
function render() {
  const kw = ($A('#kw').value || '').trim().toLowerCase();
  const list = anns.filter(a => !kw || (a.title || '').toLowerCase().includes(kw) || (a.content || '').toLowerCase().includes(kw));
  $A('#annEmpty').style.display = list.length ? 'none' : '';
  const isAdmin = canWrite();
  $A('#annList').innerHTML = list.map(a => `
    <div class="ann-item ${a.pinned ? 'pinned' : ''}">
      <div class="ann-main">
        <div class="ann-title">${a.pinned ? '<span class="pin">置顶</span>' : ''}${scopeLabel(a)} ${escA(a.title)}</div>
        ${a.validTo ? '<div class="ann-meta"><span>截止：' + escA(a.validTo) + '</span></div>' : ''}
        <div class="ann-content">${escA(a.content)}</div>
        <div class="ann-meta"><span>发布：${escA(a.author || '')}</span><span>${fmtA(a.createdAt)}</span>${a.createdAt !== a.updatedAt ? '<span>（已编辑 ' + fmtA(a.updatedAt) + '）</span>' : ''}</div>
      </div>
      ${isAdmin ? `<div class="ann-ops">
          <button class="btn btn-sm btn-default" data-act="edit" data-id="${escA(a.id)}">编辑</button>
          <button class="btn btn-sm btn-danger" data-act="del" data-id="${escA(a.id)}">删除</button>
        </div>` : ''}
    </div>`).join('');
}
async function loadAll() {
  try {
    const [list, cls, gd] = await Promise.all([apiA(ANN_API), apiA('/api/classes'), apiA('/api/grades').catch(() => [])]);
    anns = list;
    classes = cls;
    gradeList = gd || [];
    render();
  } catch (e) { toast(e.message, 'error'); }
}
function refreshScopeOptions() {
  const type = $A('#scopeType').value;
  const sv = $A('#scopeValue');
  if (type === 'all') {
    sv.innerHTML = '<option value="">全校</option>';
  } else if (type === 'grade') {
    sv.innerHTML = '<option value="">选择年级…</option>' + gradeList.map(g => `<option value="${escA(g)}">${escA(g)}</option>`).join('');
  } else {
    const list = classes.slice().sort((a, b) => (a.grade || '').localeCompare(b.grade || '', 'zh-Hans-CN', { numeric: true }) || (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN', { numeric: true }));
    sv.innerHTML = '<option value="">选择班级…</option>' + list.map(c => `<option value="${escA(c.name)}">${escA(c.grade || '')} ${escA(c.name)}</option>`).join('');
  }
}
function openEdit(a) {
  if (!canWrite()) { toast('查看模式仅可浏览', 'error'); return; }
  editingId = a ? a.id : null;
  $A('#editTitle').textContent = a ? '编辑公告' : '发布公告';
  $A('#aTitle').value = a ? (a.title || '') : '';
  $A('#aContent').value = a ? (a.content || '') : '';
  $A('#scopeType').value = a && a.scopeType ? a.scopeType : 'all';
  refreshScopeOptions();
  if (a && a.scopeValue) $A('#scopeValue').value = a.scopeValue;
  $A('#validTo').value = a && a.validTo ? a.validTo : '';
  $A('#pinned').checked = !!(a && a.pinned);
  $A('#btnSave').textContent = a ? '保存修改' : '发布';
  $A('#editMask').classList.add('show');
}
async function saveAnn() {
  if (!canWrite()) return;
  const title = $A('#aTitle').value.trim();
  const content = $A('#aContent').value.trim();
  if (!title) return toast('请填写公告标题', 'error');
  if (!content) return toast('请填写公告内容', 'error');
  const payload = {
    title,
    content,
    scopeType: $A('#scopeType').value,
    scopeValue: $A('#scopeType').value === 'all' ? '' : $A('#scopeValue').value,
    pinned: $A('#pinned').checked,
    validTo: $A('#validTo').value
  };
  if (payload.scopeType !== 'all' && !payload.scopeValue) return toast('请选择面向的年级或班级', 'error');
  try {
    if (editingId) {
      await apiA(`${ANN_API}/${editingId}`, 'PUT', payload);
      toast('公告已更新', 'success');
    } else {
      await apiA(ANN_API, 'POST', payload);
      toast('公告已发布', 'success');
    }
    $A('#editMask').classList.remove('show');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}
async function delAnn(id) {
  const a = anns.find(x => x.id === id);
  if (!(await confirmDlg(`确定删除公告「${a ? a.title : ''}」？学生端将同步不可见。`, { title: '删除公告', okText: '删除', danger: true }))) return;
  try {
    await apiA(`${ANN_API}/${id}`, 'DELETE');
    toast('公告已删除', 'success');
    await loadAll();
  } catch (e) { toast(e.message, 'error'); }
}
function bindEvents() {
  $A('#btnNew').onclick = () => openEdit(null);
  $A('#editX').onclick = () => $A('#editMask').classList.remove('show');
  $A('#editCancel').onclick = () => $A('#editMask').classList.remove('show');
  $A('#editMask').addEventListener('click', e => { if (e.target === $A('#editMask')) $A('#editMask').classList.remove('show'); });
  $A('#btnSave').onclick = saveAnn;
  $A('#scopeType').onchange = refreshScopeOptions;
  $A('#kw').oninput = render;
  $A('#annList').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const a = anns.find(x => x.id === btn.dataset.id);
    if (btn.dataset.act === 'edit') openEdit(a);
    else if (btn.dataset.act === 'del') delAnn(btn.dataset.id);
  });
}
(async function init() {
  if (!canWrite()) { const b = document.getElementById('btnNew'); if (b) b.style.display = 'none'; }
  try {
    const [list, cls, gd] = await Promise.all([apiA(ANN_API), apiA('/api/classes').catch(() => []), apiA('/api/grades').catch(() => [])]);
    anns = list; classes = cls || []; gradeList = gd || [];
  } catch (e) { toast(e.message, 'error'); }
  bindEvents();
  render();
})();
window.cbEmbedRefresh = () => loadAll();
