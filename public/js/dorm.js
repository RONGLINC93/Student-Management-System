// 宿舍管理 - 楼栋 / 房间 / 入住分配
const DORM_API = '/api/dorms';
const ALL_API = '/api/all-students';
const GRADES_API = '/api/grades';

let dorms = [];
let allStudents = [];
let gradesList = [];
let assignRoomId = '';

const $ = (s) => document.querySelector(s);
function esc(v) {
  return String(v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
async function jfetch(url, opt) {
  const res = await fetch(url, opt);
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.msg || '请求失败');
  return j.data;
}
const GENDER_TEXT = { any: '混合', male: '男生', female: '女生' };

function studMap() {
  const m = {};
  allStudents.forEach(s => { m[s.id] = s; });
  return m;
}
function studentName(id) {
  const m = studMap();
  return m[id] ? m[id].name : '未知';
}

async function loadBase() {
  const [all, g] = await Promise.all([jfetch(ALL_API, { method: 'GET' }), jfetch(GRADES_API, { method: 'GET' })]);
  allStudents = all;
  gradesList = g;
  const gradeSel = $('#assignGrade');
  gradeSel.innerHTML = '<option value="">全部年级</option>' + g.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
}
async function loadDorms() {
  dorms = await jfetch(DORM_API, { method: 'GET' });
  render();
}

function render() {
  const buildings = [...new Set(dorms.map(r => r.building))];
  // 楼栋筛选
  const bSel = $('#buildFilter');
  if (!buildFilterTouched) {
    const cur = bSel.value;
    bSel.innerHTML = '<option value="">全部楼栋</option>' + buildings.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
    bSel.value = cur && buildings.includes(cur) ? cur : '';
  }
  // 数据列表 datalist
  $('#buildList').innerHTML = buildings.map(b => `<option value="${esc(b)}"></option>`).join('');
  // 统计
  let beds = 0, inCount = 0;
  dorms.forEach(r => { beds += Number(r.capacity) || 0; inCount += (r.students || []).length; });
  $('#sRooms').textContent = dorms.length;
  $('#sBeds').textContent = beds;
  $('#sIn').textContent = inCount;
  $('#sRate').textContent = beds ? Math.round(inCount / beds * 100) + '%' : '0%';

  const build = $('#buildFilter').value;
  const kw = ($('#roomSearch').value || '').trim().toLowerCase();
  let list = dorms;
  if (build) list = list.filter(r => r.building === build);
  if (kw) list = list.filter(r => String(r.roomNo).toLowerCase().includes(kw) || String(r.building).toLowerCase().includes(kw));
  const groups = {};
  list.forEach(r => (groups[r.building] = groups[r.building] || []).push(r));
  const box = $('#roomGroups');
  if (!list.length) {
    box.innerHTML = '<div class="empty-tip" style="padding:60px 10px">暂无房间，点击右上角「添加房间」开始</div>';
    return;
  }
  const sm = studMap();
  box.innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })).map(g => {
    const items = groups[g].map(r => {
      const occ = (r.students || []).length;
      const cap = Number(r.capacity) || 1;
      const pct = Math.min(100, Math.round(occ / cap * 100));
      const mems = (r.students || []).map(id => {
        const s = sm[id];
        return `<div class="mem-chip"><span>${s ? esc(s.name) : '已删除学生'}<span class="dim">（${s ? esc(s.studentId || s.grade) : '?'}）</span></span><button data-id="${esc(id)}" title="退宿" data-act="remove">×</button></div>`;
      }).join('') || '<div class="room-empty">暂无学生入住</div>';
      return `<div class="room-card" data-room-id="${esc(r.id)}">
        <div class="r-head">
          <div><span class="r-name">${esc(r.roomNo)}</span><span class="r-no"> · ${esc(r.building)}</span></div>
          <span class="tag gender-${esc(r.gender)}">${GENDER_TEXT[r.gender] || '混合'}</span>
        </div>
        <div class="cap-line"><span>已入住 <b>${occ}</b> / ${cap} 人</span></div>
        <div class="bed-bar"><i style="width:${pct}%"></i></div>
        <div class="mem-list">${mems}</div>
        <div class="r-actions">
          <button class="btn btn-primary btn-sm" data-act="assign">安排入住</button>
          <button class="btn btn-default btn-sm" data-act="edit">编辑</button>
          <button class="btn btn-default btn-sm" data-act="clear">清空</button>
          <button class="btn btn-outline btn-sm danger-text" data-act="del">删除</button>
        </div>
      </div>`;
    }).join('');
    return `<h3 style="margin:14px 0 6px;font-size:15px;display:flex;align-items:center;gap:8px">${esc(g)} <span class="dim" style="font-size:12px">${items.length ? groups[g].length + ' 间' : ''}</span></h3>
    <div class="room-grid">${items}</div>`;
  }).join('');
}
let buildFilterTouched = false;

// ========== 房间增删改 ==========
function openRoomModal(room) {
  $('#roomModalTitle').textContent = room ? '编辑房间' : '添加房间';
  $('#rId').value = room ? room.id : '';
  $('#rBuilding').value = room ? room.building : '';
  $('#rRoomNo').value = room ? room.roomNo : '';
  $('#rCapacity').value = room ? room.capacity : 4;
  $('#rGender').value = room ? room.gender : 'any';
  $('#modalMask').classList.add('show');
}
function closeRoomModal() { $('#modalMask').classList.remove('show'); }

async function saveRoom(e) {
  e.preventDefault();
  const id = $('#rId').value;
  const payload = {
    building: $('#rBuilding').value.trim(),
    roomNo: $('#rRoomNo').value.trim(),
    capacity: Number($('#rCapacity').value) || 4,
    gender: $('#rGender').value
  };
  if (!payload.roomNo) { toast('请填写房号', 'error'); return; }
  try {
    await jfetch(id ? `${DORM_API}/${id}` : DORM_API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    toast(id ? '已保存' : '房间已添加', 'success');
    closeRoomModal();
    loadDorms();
  } catch (e) { toast(e.message, 'error'); }
}

// ========== 入住安排 ==========
function openAssign(room) {
  assignRoomId = room.id;
  const cap = Number(room.capacity) || 1;
  const free = cap - (room.students || []).length;
  $('#assignTitle').textContent = `安排入住 · ${room.building} ${room.roomNo}`;
  $('#assignHint').innerHTML = `当前 ${(room.students || []).length}/${cap} 人，还可入住 <b>${Math.max(0, free)}</b> 人。` +
    (room.gender !== 'any' ? `（${GENDER_TEXT[room.gender]}宿舍，将自动筛去不符性别学生）` : '');
  $('#assignGrade').value = '';
  $('#assignSearch').value = '';
  $('#assignCount').textContent = '';
  renderAssignList();
  $('#assignMask').classList.add('show');
}
function freeStudents() {
  const used = new Set();
  dorms.forEach(r => (r.students || []).forEach(id => used.add(id)));
  return allStudents.filter(s => !used.has(s.id));
}
function renderAssignList() {
  const room = dorms.find(r => r.id === assignRoomId);
  if (!room) return;
  const kw = ($('#assignSearch').value || '').trim().toLowerCase();
  const grade = $('#assignGrade').value;
  let list = freeStudents();
  if (room.gender === 'male') list = list.filter(s => s.gender === '男');
  if (room.gender === 'female') list = list.filter(s => s.gender === '女');
  if (grade) list = list.filter(s => s.grade === grade);
  if (kw) list = list.filter(s => (s.name || '').toLowerCase().includes(kw) || (s.studentId || '').toLowerCase().includes(kw));
  const cap = Number(room.capacity) || 1;
  const remain = cap - (room.students || []).length;
  const box = $('#assignList');
  if (!list.length) { box.innerHTML = '<div class="room-empty">无可分配的学生（未入住且符合条件）</div>'; $('#assignCount').textContent = ''; return; }
  box.innerHTML = list.map(s => `<label class="assign-item">
    <input type="checkbox" value="${esc(s.id)}" />
    <span>${esc(s.name)}</span>
    <span class="dim" style="font-size:12px">${esc(s.studentId || s.grade)}</span>
    <span class="dim" style="margin-left:auto;font-size:12px">${s.className ? esc(s.className) : esc(s.grade)}</span>
  </label>`).join('');
  $('#assignCount').textContent = `可选 ${list.length} 人，剩余床位 ${Math.max(0, remain)}`;
  box.querySelectorAll('input[type=checkbox]').forEach((cb, i) => { if (i < remain) cb.checked = true; });
}
function closeAssign() { $('#assignMask').classList.remove('show'); }

async function doAssign() {
  const ids = [...$('#assignList').querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
  if (!ids.length) { toast('请至少选择一名学生', 'error'); return; }
  try {
    await jfetch(`${DORM_API}/${assignRoomId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: ids })
    });
    toast('已安排入住', 'success');
    closeAssign();
    loadDorms();
  } catch (e) { toast(e.message, 'error'); }
}

function bindEvents() {
  $('#btnAddRoom').onclick = () => openRoomModal(null);
  $('#modalClose').onclick = closeRoomModal;
  $('#modalCancel').onclick = closeRoomModal;
  $('#modalMask').onclick = (e) => { if (e.target.id === 'modalMask') closeRoomModal(); };
  $('#roomForm').onsubmit = saveRoom;

  $('#assignClose').onclick = closeAssign;
  $('#assignCancel').onclick = closeAssign;
  $('#assignMask').onclick = (e) => { if (e.target.id === 'assignMask') closeAssign(); };
  $('#btnDoAssign').onclick = doAssign;
  $('#assignSearch').oninput = renderAssignList;
  $('#assignGrade').onchange = renderAssignList;

  $('#buildFilter').onchange = (e) => { buildFilterTouched = true; render(); };
  $('#roomSearch').oninput = render;
  // 卡片操作（安排入住 / 编辑 / 清空 / 删除 / 退宿）
  bindCardActions();
}

function bindCardActions() {
  const box = $('#roomGroups');
  box.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.roomId;
    if (!id) return;
    const room = dorms.find(r => r.id === id);
    if (!room) return;
    if (b.dataset.act === 'assign') openAssign(room);
    else if (b.dataset.act === 'edit') openRoomModal(room);
    else if (b.dataset.act === 'clear') {
      if (!(await confirmDlg(`清空房间「${room.roomNo}」的全部 ${(room.students || []).length} 名入住学生？`, { title: '清空房间', okText: '清空', danger: true }))) return;
      await jfetch(`${DORM_API}/${id}/clear`, { method: 'POST' });
      toast('已清空', 'success'); loadDorms();
    } else if (b.dataset.act === 'del') {
      if (!(await confirmDlg(`删除房间「${room.building} ${room.roomNo}」？（${(room.students || []).length} 名学生将退宿）`, { title: '删除房间', okText: '删除', danger: true }))) return;
      await jfetch(`${DORM_API}/${id}`, { method: 'DELETE' });
      toast('已删除', 'success'); loadDorms();
    } else if (b.dataset.act === 'remove') {
      const sid = b.dataset.id;
      if (!(await confirmDlg(`确定让该生退宿？`, { title: '退宿', okText: '退宿', danger: false }))) return;
      await jfetch(`${DORM_API}/${id}/remove/${sid}`, { method: 'POST' });
      toast('已退宿', 'success'); loadDorms();
    }
  };
}

window.cbEmbedRefresh = function () { loadDorms(); };

loadBase().then(() => {
  bindEvents();
  // 由于卡片 data-room-id 需要注入，render 生成时带上
  loadDorms();
});
