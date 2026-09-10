// 宿舍管理 - 酒店式房态图 / 入住办理 / 换房调床
const DORM_API = '/api/dorms';
const ALL_API = '/api/all-students';
const GRADES_API = '/api/grades';

const GENDER_TEXT = { any: '混合', male: '男生', female: '女生' };
const STATE_TEXT = { empty: '空房', part: '部分入住', full: '满房' };

/* 房态卡片中每个床位的小床图标（描边风格，颜色由 .bed 的 color 决定） */
const BED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>';

let dorms = [];
let allStudents = [];
let gradesList = [];
let assignRoomId = '';      // 补员（多选）目标房间
let detailRoomId = '';      // 当前打开的详情房间
let ciSid = '';             // 入住办理选中的学生
let ciRoomId = '';          // 入住办理选中的房间
let focusSid = '';          // 从学生档案深链跳转时要高亮的学生

// ========== 学生入住申请（学生端提交，宿管审核） ==========
const DORM_APPS_API = '/api/dorm-apps';
const APP_STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '未通过' };
let dormApps = [];
let dormAppsCounts = {};
let dormAppsFilter = 'pending';

// 房态图筛选
const filter = { state: 'all', build: '', kw: '' };

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

// ========== 通用计算 ==========
function occ(room) { return (room.students || []).length; }
function capOf(room) { return Number(room.capacity) || 1; }
function freeOf(room) { return Math.max(0, capOf(room) - occ(room)); }
function stateKey(room) {
  const o = occ(room), c = capOf(room);
  if (o <= 0) return 'empty';
  if (o >= c) return 'full';
  return 'part';
}
function studMap() {
  const m = {};
  allStudents.forEach(s => { m[s.id] = s; });
  return m;
}
function canStay(room, stu) {
  const g = stu && stu.gender;
  if (room.gender === 'male') return g === '男';
  if (room.gender === 'female') return g === '女';
  return true;
}
function roomOfSid(sid) {
  return dorms.find(r => (r.students || []).map(String).includes(String(sid))) || null;
}
function roomSort(a, b) {
  return String(a.building).localeCompare(String(b.building), 'zh-Hans-CN', { numeric: true }) ||
    String(a.roomNo).localeCompare(String(b.roomNo), 'zh-Hans-CN', { numeric: true });
}
function genderCls(gender) {
  if (gender === '男') return 'male';
  if (gender === '女') return 'female';
  return 'u';
}

// ========== 数据加载 ==========
async function loadBase() {
  const [all, g] = await Promise.all([jfetch(ALL_API, { method: 'GET' }), jfetch(GRADES_API, { method: 'GET' })]);
  allStudents = all;
  gradesList = g;
  const gradeSel = $('#assignGrade');
  gradeSel.innerHTML = '<option value="">全部年级</option>' + g.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  const ciGrade = $('#ciGrade');
  ciGrade.innerHTML = '<option value="">全部年级</option>' + g.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
}

async function loadDorms() {
  dorms = await jfetch(DORM_API, { method: 'GET' });
  render();
}

// 任一操作后统一刷新：列表 + 可能打开的详情 / 入住办理
async function reload() {
  await loadDorms();
  if ($('#detailMask').classList.contains('show')) renderDetail();
  if ($('#checkinMask').classList.contains('show')) renderCheckin();
  refreshAppsUI();
}

// ========== 房态图 ==========
function render() {
  // 楼栋筛选下拉
  const buildings = [...new Set(dorms.map(r => r.building))];
  const bSel = $('#buildFilter');
  const curBuild = filter.build;
  bSel.innerHTML = '<option value="">全部楼栋</option>' + buildings.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  if (!buildings.includes(curBuild)) filter.build = '';
  bSel.value = filter.build;
  $('#buildList').innerHTML = buildings.map(b => `<option value="${esc(b)}"></option>`).join('');
  // 状态 chips
  document.querySelectorAll('#stateChips .state-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.state === filter.state);
  });
  renderStats();
  renderMap();
}

function renderStats() {
  const buildings = new Set();
  let beds = 0, inCount = 0;
  dorms.forEach(r => {
    buildings.add(r.building);
    beds += capOf(r);
    inCount += occ(r);
  });
  $('#sBuildings').textContent = buildings.size;
  $('#sRooms').textContent = dorms.length;
  $('#sBeds').textContent = beds;
  $('#sIn').textContent = inCount;
  $('#sRate').textContent = beds ? Math.round(inCount / beds * 100) + '%' : '0%';
}

function renderMap() {
  const box = $('#roomGroups');
  if (!dorms.length) {
    box.innerHTML = `
      <div class="empty-card">
        <div class="e-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14"/><path d="M7 21v-5h10v5"/><path d="M10 6h4M10 9h4M10 12h4"/></svg></div>
        <p>还没有宿舍房间</p>
        <small>先录入楼栋与房间（支持一键批量生成），之后即可在房态图上办理入住。</small>
        <div class="e-btn"><button class="btn btn-primary" id="emptyAdd">添加房间</button></div>
      </div>`;
    return;
  }
  // 筛选
  let list = dorms.slice();
  if (filter.state === 'empty') list = list.filter(r => stateKey(r) === 'empty');
  else if (filter.state === 'part') list = list.filter(r => stateKey(r) === 'part');
  else if (filter.state === 'full') list = list.filter(r => stateKey(r) === 'full');
  if (filter.build) list = list.filter(r => r.building === filter.build);
  if (filter.kw) list = list.filter(r => String(r.roomNo).toLowerCase().includes(filter.kw) || String(r.building).toLowerCase().includes(filter.kw));
  if (!list.length) {
    box.innerHTML = '<div class="empty-card"><p>没有符合条件的房间</p><small>试试切换房态筛选 / 楼栋或调整关键词。</small></div>';
    return;
  }
  // 按楼栋分组
  const groups = {};
  list.forEach(r => (groups[r.building] = groups[r.building] || []).push(r));
  const buildingKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));

  box.innerHTML = buildingKeys.map(g => {
    const items = groups[g].slice().sort(roomSort).map(tileHtml).join('');
    const gRooms = groups[g];
    let gOcc = 0, gBeds = 0;
    gRooms.forEach(r => { gOcc += occ(r); gBeds += capOf(r); });
    return `
      <section class="build-sec">
        <div class="build-h">
          <div class="b-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14"/><path d="M7 21v-5h10v5"/><path d="M10 6h4M10 9h4M10 12h4"/></svg></div>
          <h3>${esc(g)}</h3>
          <span class="b-sum">${groups[g].length} 间 · 在住 ${gOcc}/${gBeds}</span>
        </div>
        <div class="room-map">${items}</div>
      </section>`;
  }).join('');
}

function tileHtml(r) {
  const sk = stateKey(r);
  const o = occ(r), c = capOf(r);
  const sm = studMap();
  const genderCl = r.gender === 'male' ? 'male' : (r.gender === 'female' ? 'female' : '');
  const beds = Array.from({ length: c }, (_, i) => {
    const sid = (r.students || [])[i];
    const stu = sid ? sm[sid] : null;
    if (!sid) return `<span class="bed">${BED_ICON}</span>`;
    return `<span class="bed on-${stu ? genderCls(stu.gender) : 'unknown'}">${BED_ICON}</span>`;
  }).join('');
  const free = freeOf(r);
  const freeText = sk === 'full' ? '' : `<div class="rt-free">空 ${free} 床</div>`;
  return `
    <div class="rtile st-${sk}" data-room-id="${esc(r.id)}" title="点击查看房间详情">
      <div class="rt-top">
        <span class="rt-no">${esc(r.roomNo)}</span>
        <span class="rt-g ${genderCl}">${GENDER_TEXT[r.gender] || '混合'}</span>
      </div>
      <div class="rt-state"><i></i>${sk === 'empty' ? '空房' : (sk === 'full' ? '满房' : '部分入住')}</div>
      ${freeText}
      <div class="rt-beds">${beds}</div>
    </div>`;
}

// ========== 房间详情 ==========
function openDetail(roomId) {
  detailRoomId = roomId;
  renderDetail();
  $('#detailMask').classList.add('show');
}
function closeDetail() {
  detailRoomId = '';
  $('#detailMask').classList.remove('show');
}
function renderDetail() {
  const room = dorms.find(r => r.id === detailRoomId);
  if (!room) { closeDetail(); return; }
  const sk = stateKey(room);
  const o = occ(room), c = capOf(room), free = freeOf(room);
  const sm = studMap();
  const genderCl = room.gender === 'male' ? 'male' : (room.gender === 'female' ? 'female' : 'any');
  $('#dtlTitle').textContent = `${room.building} ${room.roomNo}`;
  const genderEl = $('#dtlGender');
  genderEl.className = `tag gender-${genderCl}`;
  genderEl.textContent = GENDER_TEXT[room.gender] || '混合';
  const stEl = $('#dtlState');
  stEl.className = `st-pill p-${sk}`;
  stEl.textContent = STATE_TEXT[sk];
  $('#dtlOcc').textContent = o;
  $('#dtlCap').textContent = c;
  $('#dtlFree').textContent = sk === 'full' ? '已无空床' : `剩余 ${free} 张空床`;
  $('#dtlFree').style.color = sk === 'full' ? '#6d28d9' : '#15803d';
  $('#dtlBar').style.width = c ? Math.min(100, o / c * 100) + '%' : '0%';
  $('#dtlBar').style.background = sk === 'empty' ? '#22c55e' : (sk === 'full' ? '#8b5cf6' : '#f59e0b');
  $('#dtlSub').textContent = o ? `（床位按入住顺序编号）` : '';
  // 操作按钮可用性
  $('#btnDetailAssign').disabled = free <= 0;
  $('#btnDetailClear').disabled = o <= 0;
  const rows = (room.students || []).map((sid, i) => {
    const stu = sm[sid];
    const g = stu ? genderCls(stu.gender) : 'u';
    const name = stu ? stu.name : '（已删除学生）';
    const sub = stu ? (stu.className ? `${stu.grade} ${stu.className}` : (stu.grade || '')) : '';
    const isFocus = focusSid && String(sid) === String(focusSid);
    return `
      <div class="occ-row ${isFocus ? 'focus' : ''}" data-sid="${esc(sid)}">
        <span class="ava ${g}">${esc(String(name).charAt(0))}</span>
        <div style="min-width:0">
          <div class="occ-name">${esc(name)}</div>
          <div class="occ-sub">${esc(sub)}${stu && stu.studentId ? ' · ' + esc(stu.studentId) : ''}</div>
        </div>
        <span class="bed-no">床 ${i + 1}</span>
        <div class="occ-right">
          <button class="btn btn-default btn-sm" data-sid="${esc(sid)}" data-room-id="${esc(room.id)}" data-act="transfer" title="调到其它有空床且性别相符的房间">换房</button>
          <button class="btn btn-outline btn-sm danger-text" data-sid="${esc(sid)}" data-room-id="${esc(room.id)}" data-act="remove" title="退宿">退宿</button>
        </div>
      </div>`;
  }).join('');
  $('#dtlOccList').innerHTML = rows || '<div class="empty-inline">该房间暂无学生入住</div>';
}

// ========== 深链：从学生档案跳转时自动定位房间并高亮学生 ==========
function cssEscStr(v) {
  if (window.CSS && CSS.escape) return CSS.escape(v);
  return String(v).replace(/"/g, '\\"');
}
function applyRoomDeepLink() {
  const p = new URLSearchParams(location.search);
  const rid = p.get('room');
  if (!rid) return;
  const room = dorms.find(r => String(r.id) === String(rid));
  if (!room) return;
  focusSid = p.get('focus') || '';
  const tile = document.querySelector(`.rtile[data-room-id="${cssEscStr(rid)}"]`);
  if (tile) {
    tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tile.classList.add('flash');
    setTimeout(() => tile.classList.remove('flash'), 2200);
  }
  openDetail(room.id);
  setTimeout(() => {
    const occList = document.getElementById('dtlOccList');
    const row = occList && occList.querySelector('.occ-row.focus');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
}

// ========== 房间 增 / 删 / 改 ==========
function expandRoomNos(roomNo, batch) {
  const n = Math.max(1, Math.min(50, Number(batch) || 1));
  if (n === 1) return [String(roomNo)];
  const m = String(roomNo).match(/^(.*?)(\d+)$/);
  if (!m) return [String(roomNo)];
  const [, pre, dig] = m;
  const start = parseInt(dig, 10);
  const w = dig.length;
  return Array.from({ length: n }, (_, i) => pre + String(start + i).padStart(w, '0'));
}

function openRoomModal(room) {
  $('#roomModalTitle').textContent = room ? '编辑房间' : '添加房间';
  $('#rId').value = room ? room.id : '';
  $('#rBuilding').value = room ? room.building : '';
  $('#rRoomNo').value = room ? room.roomNo : '';
  $('#rCapacity').value = room ? room.capacity : 4;
  $('#rGender').value = room ? room.gender : 'any';
  const cnt = $('#rCount');
  cnt.value = room ? 1 : 1;
  cnt.disabled = !!room;
  $('#modalMask').classList.add('show');
}
function closeRoomModal() { $('#modalMask').classList.remove('show'); }

async function saveRoom(e) {
  e.preventDefault();
  const id = $('#rId').value;
  const building = $('#rBuilding').value.trim();
  const roomNo = $('#rRoomNo').value.trim();
  const capacity = Number($('#rCapacity').value) || 4;
  const gender = $('#rGender').value;
  if (!roomNo) { toast('请填写房号', 'error'); return; }
  const done = busyBtn(e && e.submitter ? e.submitter : $('#roomForm') && $('#roomForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
  try {
    if (id) {
      // 编辑
      try {
        await jfetch(`${DORM_API}/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ building, roomNo, capacity, gender })
        });
        toast('房间已保存', 'success');
        closeRoomModal();
        await reload();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    // 新增（支持批量）
    const batch = Math.min(50, Math.max(1, Number($('#rCount').value) || 1));
    const nos = expandRoomNos(roomNo, batch);
    if (nos.length > 1 && new Set(nos).size !== nos.length) { toast('批量生成的房号存在重复，请调整起始房号', 'error'); return; }
    const dup = nos.find(n => dorms.some(r => r.building === building && String(r.roomNo) === n));
    if (dup) { toast(`「${building} ${dup}」已存在`, 'error'); return; }
    try {
      for (const n of nos) {
        await jfetch(DORM_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ building, roomNo: n, capacity, gender })
        });
      }
      toast(nos.length > 1 ? `已添加 ${nos.length} 间房间` : '房间已添加', 'success');
      closeRoomModal();
      await reload();
    } catch (err) { toast(err.message, 'error'); }
  } finally { done(); }
}

// ========== 补员入住（多选） ==========
function openAssign(roomId) {
  const room = dorms.find(r => r.id === roomId);
  if (!room) return;
  assignRoomId = roomId;
  const free = freeOf(room);
  $('#assignTitle').textContent = `补员入住 · ${room.building} ${room.roomNo}`;
  $('#assignHint').innerHTML = `当前 ${occ(room)}/${capOf(room)} 人，还可入住 <b>${free}</b> 人。` +
    (room.gender !== 'any' ? `（${GENDER_TEXT[room.gender]}宿舍，将自动筛去不符性别学生）` : '');
  $('#assignGrade').value = '';
  $('#assignSearch').value = '';
  $('#assignCount').textContent = '';
  renderAssignList();
  $('#assignMask').classList.add('show');
}
function freeStudents() {
  const used = new Set();
  dorms.forEach(r => (r.students || []).forEach(sid => used.add(String(sid))));
  return allStudents.filter(s => !used.has(String(s.id)));
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
  const remain = freeOf(room);
  const box = $('#assignList');
  if (!list.length) {
    box.innerHTML = '<div class="empty-inline">无可分配的学生（未入住且符合条件）</div>';
    $('#assignCount').textContent = '';
    return;
  }
  box.innerHTML = list.map(s => `<label class="assign-item">
    <input type="checkbox" value="${esc(s.id)}" />
    <span>${esc(s.name)}</span>
    <span class="dim-text" style="font-size:12px">${esc(s.studentId || s.grade)}</span>
    <span class="dim-text" style="margin-left:auto;font-size:12px">${s.className ? esc(s.className) : esc(s.grade)}</span>
  </label>`).join('');
  $('#assignCount').textContent = `可选 ${list.length} 人，剩余床位 ${Math.max(0, remain)}`;
  box.querySelectorAll('input[type=checkbox]').forEach((cb, i) => { if (i < remain) cb.checked = true; });
}
function closeAssign() { $('#assignMask').classList.remove('show'); }

async function doAssign() {
  const ids = [...$('#assignList').querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
  if (!ids.length) { toast('请至少选择一名学生', 'error'); return; }
  const done = busyBtn($('#btnDoAssign'), '处理中…');
  if (!done) return;
  try {
    await jfetch(`${DORM_API}/${assignRoomId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: ids })
    });
    toast(`已安排 ${ids.length} 名学生入住`, 'success');
    closeAssign();
    await reload();
  } catch (err) { toast(err.message, 'error'); }
  finally { done(); }
}

// ========== 入住办理 / 换房（单一学生） ==========
function openCheckin(presetSid) {
  ciSid = presetSid || '';
  ciRoomId = '';
  const cur = ciSid ? roomOfSid(ciSid) : null;
  $('#checkinTitle').textContent = cur ? '换房调床' : '办理入住';
  if (!presetSid) { $('#ciSearch').value = ''; $('#ciGrade').value = ''; }
  renderCheckin();
  $('#checkinMask').classList.add('show');
}
function closeCheckin() {
  $('#checkinMask').classList.remove('show');
  ciSid = '';
  ciRoomId = '';
}

function ciStudentList() {
  const kw = ($('#ciSearch').value || '').trim().toLowerCase();
  const grade = $('#ciGrade').value;
  let list = allStudents.slice();
  if (grade) list = list.filter(s => s.grade === grade);
  if (kw) list = list.filter(s =>
    (s.name || '').toLowerCase().includes(kw) ||
    (s.studentId || '').toLowerCase().includes(kw) ||
    (s.className || '').toLowerCase().includes(kw));
  return list.slice(0, 60);
}

function roomCandidatesFor(stu) {
  const cur = roomOfSid(stu.id);
  return dorms
    .filter(r => (!cur || r.id !== cur.id) && freeOf(r) > 0 && canStay(r, stu))
    .sort(roomSort);
}

function renderCheckin() {
  renderCiStudents();
  renderCiRooms();
  updateCiMeta();
}

function renderCiStudents() {
  let list = ciStudentList();
  const box = $('#ciStuList');
  // 换房等场景：被选中的学生即使不在当前筛选结果里也要钉在最前，避免误取消
  if (ciSid && !list.some(s => s.id === ciSid)) {
    const stu = allStudents.find(s => s.id === ciSid);
    if (stu) list = [stu].concat(list);
  }
  if (!list.length) { box.innerHTML = '<div class="empty-inline">没有匹配的学生</div>'; return; }
  box.innerHTML = list.map(s => {
    const cur = roomOfSid(s.id);
    const inDorm = !!cur;
    const g = genderCls(s.gender);
    const meta = (s.className ? `${s.grade} ${s.className}` : (s.grade || '未分班')) + (s.studentId ? ` · ${s.studentId}` : '');
    return `
      <div class="stu-row ${s.id === ciSid ? 'sel' : ''}" data-sid="${esc(s.id)}">
        <span class="ava ${g}">${esc(String(s.name || '?').charAt(0))}</span>
        <div style="min-width:0">
          <div class="stu-name">${esc(s.name)}</div>
          <div class="stu-sub">${esc(meta)}</div>
        </div>
        <span class="cur-tag ${inDorm ? 'has' : ''}">${inDorm ? '住 ' + esc(cur.building + ' ' + cur.roomNo) : '未住宿'}</span>
      </div>`;
  }).join('');
}

function renderCiRooms() {
  const box = $('#ciRoomList');
  if (!ciSid) {
    box.innerHTML = '<div class="empty-inline">请在左侧选择一名学生</div>';
    return;
  }
  const stu = allStudents.find(s => s.id === ciSid);
  if (!stu) { box.innerHTML = ''; return; }
  const cur = roomOfSid(stu.id);
  const candidates = roomCandidatesFor(stu);
  // 同步 hint
  const hint = $('#ciHint');
  if (cur) {
    hint.innerHTML = `${esc(stu.name)} 现住 <b>${esc(cur.building + ' ' + cur.roomNo)}</b>；选择下方新房间后，原床位将自动空出（换房）。`;
  } else {
    hint.innerHTML = `${esc(stu.name)} 当前未住宿；直接选择下方房间即可办理入住。`;
  }
  if (!candidates.length) {
    box.innerHTML = '<div class="empty-inline">没有可入住的房间<br/><span style="font-size:11px">（宿舍已满 或 无与该生性别相符的空床）</span></div>';
    ciRoomId = '';
    return;
  }
  // 默认选中第一个，若原选中房间仍可用则保留
  if (!candidates.some(r => r.id === ciRoomId)) ciRoomId = candidates[0].id;
  box.innerHTML = candidates.map(r => {
    const sk = stateKey(r);
    const free = freeOf(r);
    const sel = r.id === ciRoomId ? 'sel' : '';
    return `
      <div class="room-row ${sel}" data-rid="${esc(r.id)}">
        <span class="rbar st-${sk}"></span>
        <div class="room-main">
          <b>${esc(r.roomNo)}</b>
          <div class="rsub">${esc(r.building)} · ${GENDER_TEXT[r.gender] || '混合'}宿舍</div>
        </div>
        <div class="room-meta">
          <span class="room-state">${STATE_TEXT[sk]}</span>
          <span class="room-free ${free === 1 ? 'few' : ''}">空 ${free} 床</span>
        </div>
      </div>`;
  }).join('');
}

function updateCiMeta() {
  const go = $('#btnCiGo');
  if (!ciSid) { $('#ciMeta').textContent = ''; go.disabled = true; return; }
  const stu = allStudents.find(s => s.id === ciSid);
  const cur = roomOfSid(ciSid);
  if (!ciRoomId) {
    $('#ciMeta').textContent = stu ? `已选：${stu.name}` : '';
    go.textContent = cur ? '确认换房' : '确认入住';
    go.disabled = true;
    return;
  }
  const room = dorms.find(r => r.id === ciRoomId);
  $('#ciMeta').textContent = room && stu ? `将安排 ${stu.name} → ${room.building} ${room.roomNo}` : '';
  go.textContent = cur ? '确认换房' : '确认入住';
  go.disabled = false;
}

async function doCheckin() {
  const stu = allStudents.find(s => s.id === ciSid);
  const room = dorms.find(r => r.id === ciRoomId);
  if (!stu || !room) { toast('请选择学生和房间', 'error'); return; }
  const cur = roomOfSid(ciSid);
  const done = busyBtn($('#btnCiGo'), '处理中…');
  if (!done) return;
  try {
    await jfetch(`${DORM_API}/${room.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: [stu.id] })
    });
    toast(cur ? `${stu.name} 已换至 ${room.building} ${room.roomNo}` : `${stu.name} 已入住 ${room.building} ${room.roomNo}`, 'success');
    closeCheckin();
    await reload();
  } catch (err) { toast(err.message, 'error'); }
  finally { done(); }
}

// ========== 学生入住申请：数据与渲染 ==========
function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtAppTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function fetchApps() {
  const res = await fetch(`${DORM_APPS_API}?status=${dormAppsFilter}`);
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.msg || '请求失败');
  return { list: j.data || [], counts: j.counts || {} };
}
async function refreshAppsUI() {
  try {
    const { list, counts } = await fetchApps();
    dormApps = list;
    dormAppsCounts = counts || {};
    const n = dormAppsCounts.pending || 0;
    const badge = $('#appCountBadge');
    if (badge) badge.textContent = n ? String(n) : '';
    if ($('#appsMask').classList.contains('show')) renderApps();
  } catch (e) { /* 会话状态异常时静默处理，徽标留空 */ }
}
function openApps() {
  $('#appsMask').classList.add('show');
  renderApps();
  refreshAppsUI();
}
function closeApps() { $('#appsMask').classList.remove('show'); }
function renderApps() {
  const box = $('#appsList');
  const cnt = $('#appsCount');
  if (!box) return;
  const pending = dormAppsCounts.pending || 0;
  const approved = dormAppsCounts.approved || 0;
  const rejected = dormAppsCounts.rejected || 0;
  const viewer = window.AUTH && window.AUTH.role === 'viewer';
  cnt.textContent = dormAppsFilter === 'pending'
    ? (pending ? `待处理 ${pending} 条` : '已全部处理')
    : `共 ${dormApps.length} 条 · 待 ${pending} / 通过 ${approved} / 驳回 ${rejected}`;
  if (!dormApps.length) {
    box.innerHTML = `<div class="empty-inline">${dormAppsFilter === 'pending' ? '暂无待处理的学生入住申请' : '暂无申请记录'}</div>`;
    return;
  }
  box.innerHTML = dormApps.map(a => {
    const meta = [a.no ? ('学号 ' + a.no) : '', a.grade ? a.grade : '', a.className ? a.className : ''].filter(Boolean).join(' · ');
    const statusCls = a.status === 'approved' ? 'ok' : (a.status === 'rejected' ? 'rej' : 'no');
    const actionHtml = a.status === 'pending'
      ? (viewer
        ? `<span class="app-st no">查看模式</span>`
        : `<button type="button" class="btn btn-primary btn-sm" data-app-id="${escAttr(a.id)}" data-app-act="approve" title="通过后自动为该生安排入住">通过入住</button>
           <button type="button" class="btn btn-outline btn-sm danger-text" data-app-id="${escAttr(a.id)}" data-app-act="reject">不通过</button>`)
      : `<span class="app-st ${statusCls}">${escAttr(APP_STATUS_TEXT[a.status] || a.status)}</span>`;
    return `<div class="app-row">
      <span class="ava">${escAttr(String(a.name || '?').charAt(0))}</span>
      <div class="app-main">
        <b>${escAttr(a.name)}</b>
        <div class="app-sub">${escAttr(meta)}</div>
      </div>
      <span class="app-room">${escAttr((a.building || '') + ' ' + (a.roomNo || '-'))}</span>
      ${a.status === 'pending' ? `<span class="app-st ${a.roomFree > 0 ? 'ok' : 'rej'}">${a.roomFree > 0 ? '余 ' + a.roomFree + ' 床' : '房间已满'}</span>` : ''}
      <span class="app-time">${fmtAppTime(a.createdAt)}</span>
      <div class="app-actions">${actionHtml}</div>
    </div>`;
  }).join('');
}
// 审核/数据变化后通知父工作台刷新侧边栏角标（独立打开页面时无操作）
function notifyAppsChangedToParent() {
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'icst-dorm-apps' }, location.origin);
  } catch (e) {}
}
async function handleDormApp(appId, act) {
  const app = dormApps.find(x => x.id === appId);
  if (!app) return;
  if (act === 'approve') {
    const ok = await confirmDlg(`确认通过「${app.name}」的申请，并将其安排入住「${app.building} ${app.roomNo}」？`, { title: '通过入住申请', okText: '通过入住' });
    if (!ok) return;
  } else {
    const ok = await confirmDlg(`确认不通过「${app.name}」的入住申请？`, { title: '驳回申请', okText: '驳回', danger: true });
    if (!ok) return;
  }
  try {
    await jfetch(`${DORM_APPS_API}/${appId}/${act}`, { method: 'POST' });
    toast(act === 'approve' ? `已通过，${app.name} 已安排入住 ${app.building} ${app.roomNo}` : `已驳回 ${app.name} 的申请`, 'success');
    await loadDorms();
    if ($('#detailMask').classList.contains('show')) renderDetail();
    if ($('#checkinMask').classList.contains('show')) renderCheckin();
    await refreshAppsUI();
    notifyAppsChangedToParent();
  } catch (err) { toast(err.message, 'error'); refreshAppsUI(); }
}

// ========== 事件绑定 ==========
function bindEvents() {
  // 房态工具栏
  $('#btnCheckin').onclick = () => openCheckin();
  $('#btnAddRoom').onclick = () => openRoomModal(null);
  $('#stateChips').onclick = (e) => {
    const c = e.target.closest('.state-chip');
    if (!c) return;
    filter.state = c.dataset.state;
    render();
  };
  $('#buildFilter').onchange = (e) => { filter.build = e.target.value; render(); };
  $('#roomSearch').oninput = (e) => { filter.kw = e.target.value.trim().toLowerCase(); render(); };

  // 房态图：点卡片开详情；空状态按钮
  $('#roomGroups').onclick = (e) => {
    if (e.target.closest('#emptyAdd')) { openRoomModal(null); return; }
    const t = e.target.closest('.rtile');
    if (t) openDetail(t.dataset.roomId);
  };

  // 房间新增/编辑
  $('#modalClose').onclick = closeRoomModal;
  $('#modalCancel').onclick = closeRoomModal;
  $('#roomForm').onsubmit = saveRoom;

  // 房间详情
  $('#detailClose').onclick = closeDetail;
  $('#btnDetailAssign').onclick = () => { if (detailRoomId) openAssign(detailRoomId); };
  $('#btnDetailEdit').onclick = () => {
    const room = dorms.find(r => r.id === detailRoomId);
    if (room) openRoomModal(room);
  };
  $('#btnDetailClear').onclick = async () => {
    const room = dorms.find(r => r.id === detailRoomId);
    if (!room) return;
    if (!(await confirmDlg(`清空「${room.building} ${room.roomNo}」的全部 ${occ(room)} 名入住学生？`, { title: '清空房间', okText: '清空', danger: true }))) return;
    const done = busyBtn(document.getElementById('btnDetailClear'), '清空中…');
    if (!done) return;
    try {
      await jfetch(`${DORM_API}/${room.id}/clear`, { method: 'POST' });
      toast('已清空房间', 'success');
      await reload();
    } catch (err) { toast(err.message, 'error'); }
    finally { done(); }
  };
  $('#btnDetailDel').onclick = async () => {
    const room = dorms.find(r => r.id === detailRoomId);
    if (!room) return;
    if (!(await confirmDlg(`删除房间「${room.building} ${room.roomNo}」？（${occ(room)} 名学生将一并退宿）`, { title: '删除房间', okText: '删除', danger: true }))) return;
    const done = busyBtn(document.getElementById('btnDetailDel'), '删除中…');
    if (!done) return;
    try {
      await jfetch(`${DORM_API}/${room.id}`, { method: 'DELETE' });
      toast('已删除房间', 'success');
      await reload();
    } catch (err) { toast(err.message, 'error'); }
    finally { done(); }
  };
  // 详情内入住学生行操作（换房 / 退宿）
  $('#dtlOccList').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const sid = b.dataset.sid;
    const room = dorms.find(r => r.id === detailRoomId);
    if (!room) return;
    if (b.dataset.act === 'transfer') {
      openCheckin(sid);
    } else if (b.dataset.act === 'remove') {
      const stu = studMap()[sid];
      if (!(await confirmDlg(`确定让 ${stu ? stu.name : '该生'} 退宿「${room.building} ${room.roomNo}」？`, { title: '退宿', okText: '退宿', danger: true }))) return;
      const done = busyBtn(b, '处理中…');
      if (!done) return;
      try {
        await jfetch(`${DORM_API}/${room.id}/remove/${sid}`, { method: 'POST' });
        toast('已退宿', 'success');
        await reload();
      } catch (err) { toast(err.message, 'error'); }
      finally { done(); }
    }
  };

  // 补员（多选）弹窗
  $('#assignClose').onclick = closeAssign;
  $('#assignCancel').onclick = closeAssign;
  $('#btnDoAssign').onclick = doAssign;
  $('#assignSearch').oninput = renderAssignList;
  $('#assignGrade').onchange = renderAssignList;

  // 入住办理 / 换房
  $('#checkinClose').onclick = closeCheckin;
  $('#ciCancel').onclick = closeCheckin;
  $('#btnCiGo').onclick = doCheckin;
  $('#ciSearch').oninput = renderCheckin;
  $('#ciGrade').onchange = renderCheckin;
  $('#ciStuList').onclick = (e) => {
    const row = e.target.closest('.stu-row');
    if (!row) return;
    if (ciSid === row.dataset.sid) { ciSid = ''; ciRoomId = ''; renderCheckin(); return; }
    ciSid = row.dataset.sid;
    ciRoomId = '';
    renderCheckin();
  };
  $('#ciRoomList').onclick = (e) => {
    const row = e.target.closest('.room-row');
    if (!row) return;
    ciRoomId = row.dataset.rid;
    renderCheckin();
  };

  // 学生入住申请审核
  $('#btnDormApps').onclick = openApps;
  $('#appsClose').onclick = closeApps;
  $('#appsTabs').onclick = (e) => {
    const t = e.target.closest('.apps-tab');
    if (!t) return;
    dormAppsFilter = t.dataset.status;
    document.querySelectorAll('#appsTabs .apps-tab').forEach(x => x.classList.toggle('active', x === t));
    refreshAppsUI();
  };
  $('#appsList').onclick = async (e) => {
    const b = e.target.closest('[data-app-act]');
    if (!b) return;
    const done = busyBtn(b, '处理中…');
    if (!done) return;
    try { await handleDormApp(b.dataset.appId, b.dataset.appAct); }
    finally { done(); }
  };
}

window.cbEmbedRefresh = function () { loadDorms(); };

// AUTH（含查看模式角色）就绪后刷新申请角标与操作按钮
window.addEventListener('cb-auth-ready', () => refreshAppsUI());

loadBase().then(() => {
  bindEvents();
  return loadDorms();
}).then(() => {
  applyRoomDeepLink();
  refreshAppsUI();
}).catch(err => { toast(err.message, 'error'); });
