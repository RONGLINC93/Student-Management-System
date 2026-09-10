// 考勤 + 操行（奖惩/评语）
const ATT_API = '/api/attendance';
const COND_API = '/api/conduct';
const GRADES_API = '/api/grades';
const ALL_API = '/api/all-students';

let allStudents = [];
let gradesList = [];
let classList = [];
let roster = [];          // 当前登记的学生（含已保存状态）
let condPick = null;      // 弹窗中选中的学生

const STATUS_NAMES = { present: '出勤', late: '迟到', early: '早退', leave: '请假', absent: '旷课' };
const $ = (s) => document.querySelector(s);

function esc(v) {
  return String(v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function today() { return new Date().toISOString().slice(0, 10); }
async function jfetch(url, opt) {
  const res = await fetch(url, opt);
  const j = await res.json();
  if (j.code !== 0) throw new Error(j.msg || '请求失败');
  return j.data;
}
function qs(params) {
  const sp = new URLSearchParams();
  Object.keys(params).forEach(k => { if (params[k]) sp.set(k, params[k]); });
  return sp.toString();
}
function classByGrade(grade) {
  const items = classList.filter(c => !grade || c.grade === grade);
  return items;
}
function fillGradeSelects() {
  const ids = ['attGrade', 'recGrade'];
  ids.forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    el.innerHTML = '<option value="">全部年级</option>' + gradesList.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  });
}
function fillClassSelect(selId, grade) {
  const sel = $('#' + selId);
  if (!sel) return;
  sel.innerHTML = '<option value="">' + (selId === 'attClass' ? '请先选择班级' : '全部班级') + '</option>' +
    classByGrade(grade).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}

// ========== 考勤登记 ==========
async function loadRoster() {
  const date = $('#attDate').value || today();
  const classId = $('#attClass').value;
  if (!classId) { toast('请选择班级', 'error'); return; }
  const cls = classList.find(c => c.id === classId);
  roster = allStudents.filter(s => s.classId === classId);
  // 尝试读取已保存记录
  let saved = null;
  try {
    const list = await jfetch(ATT_API + '?' + qs({ date, classId }));
    saved = list.find(x => x.date === date && x.classId === classId) || null;
  } catch (e) { /* ignore */ }
  const map = {};
  if (saved) saved.records.forEach(r => { map[r.id] = r.status; });

  if (!roster.length) {
    $('#attBody').innerHTML = '<tr><td colspan="5" class="empty-tip">该班级暂无学生，请先到班级管理中添加学生</td></tr>';
    $('#attStats').style.display = 'none';
    return;
  }
  $('#attBody').innerHTML = roster.map((s, i) => {
    const curSt = map[s.id] || 'present';
    const opts = Object.keys(STATUS_NAMES).map(k => `<option value="${k}" ${k === curSt ? 'selected' : ''} class="st-${k}">${STATUS_NAMES[k]}</option>`).join('');
    return `<tr data-sid="${esc(s.id)}">
      <td>${i + 1}</td><td>${esc(s.studentId || '—')}</td><td><strong>${esc(s.name)}</strong></td><td>${s.gender}</td>
      <td><select class="st-select st-att" data-sid="${esc(s.id)}">${opts}</select></td>
    </tr>`;
  }).join('');
  refreshStats();
}

function refreshStats() {
  const sel = $('#attBody');
  if (!sel.querySelector('.st-att')) { $('#attStats').style.display = 'none'; return; }
  const cnt = {};
  Object.keys(STATUS_NAMES).forEach(k => cnt[k] = 0);
  sel.querySelectorAll('.st-att').forEach(s => { cnt[s.value] = (cnt[s.value] || 0) + 1; });
  const total = roster.length;
  const rate = total ? (((total - (cnt.late + cnt.early + cnt.leave + cnt.absent)) / total) * 100).toFixed(1) : 0;
  $('#attStats').style.display = '';
  $('#attStats').innerHTML = [
    `<span>应到 <b>${total}</b></span>`,
    `<span>出勤 <b class="st-present">${cnt.present}</b></span>`,
    `<span>迟到 <b class="st-late">${cnt.late}</b></span>`,
    `<span>早退 <b class="st-early">${cnt.early}</b></span>`,
    `<span>请假 <b class="st-leave">${cnt.leave}</b></span>`,
    `<span>旷课 <b class="st-absent">${cnt.absent}</b></span>`,
    `<span>出勤率 <b>${rate}%</b></span>`
  ].join('');
}

async function saveAttendance() {
  const date = $('#attDate').value || today();
  const classId = $('#attClass').value;
  if (!classId) { toast('请先选择班级', 'error'); return; }
  const cls = classList.find(c => c.id === classId);
  const records = [];
  $('#attBody').querySelectorAll('tr[data-sid]').forEach(tr => {
    const sid = tr.dataset.sid;
    const stSel = tr.querySelector('.st-att');
    const stu = allStudents.find(s => s.id === sid);
    records.push({ id: sid, name: stu ? stu.name : '', status: stSel ? stSel.value : 'present' });
  });
  const done = busyBtn($('#btnSaveAtt'), '保存中…');
  if (!done) return;
  try {
    await jfetch(ATT_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, classId, grade: cls ? cls.grade : '', className: cls ? cls.name : '', records })
    });
    toast('考勤已保存', 'success');
    refreshStats();
  } catch (e) { toast(e.message, 'error'); }
  finally { done(); }
}

// ========== 考勤记录查询 ==========
async function queryRecords() {
  const from = $('#recFrom').value;
  const to = $('#recTo').value;
  const classId = $('#recClass').value;
  const grade = $('#recGrade').value;
  const list = await jfetch(ATT_API + '?' + qs({ from, to, classId, grade }));
  const body = $('#recBody');
  if (!list.length) { body.innerHTML = '<tr><td colspan="10" class="empty-tip">暂无考勤记录</td></tr>'; return; }
  body.innerHTML = list.map(x => {
    const c = { present: 0, late: 0, early: 0, leave: 0, absent: 0 };
    (x.records || []).forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });
    const total = x.records ? x.records.length : 0;
    const rate = total ? (((total - c.late - c.early - c.leave - c.absent) / total) * 100).toFixed(1) : '—';
    return `<tr data-id="${esc(x.id)}">
      <td>${esc(x.date)}</td><td>${esc(x.className)}</td><td>${total}</td><td class="st-present">${c.present}</td>
      <td class="st-late">${c.late}</td><td class="st-early">${c.early}</td><td class="st-leave">${c.leave}</td>
      <td class="st-absent">${c.absent}</td><td>${rate}%</td>
      <td><div class="row-actions"><button class="btn-sm btn-edit" data-act="edit-att">编辑</button><button class="btn-sm btn-del" data-act="del-att">删除</button></div></td>
    </tr>`;
  }).join('');
}

// ========== 操行 ==========
async function queryConduct() {
  const kw = $('#cSearch').value.trim();
  const type = $('#cType').value;
  const studentId = $('#cSearch').dataset.studentId || '';
  const list = await jfetch(COND_API + '?' + qs({ kw, type, studentId }));
  const tmap = { reward: '<span class="tag tag-reward">奖励</span>', punish: '<span class="tag tag-punish">处分</span>', comment: '<span class="tag tag-comment">评语</span>' };
  const body = $('#condBody');
  if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="empty-tip">暂无操行记录</td></tr>'; return; }
  body.innerHTML = list.map(x => `<tr data-id="${esc(x.id)}">
    <td>${esc(x.date || '—')}</td>
    <td><strong>${esc(x.name || '—')}</strong></td>
    <td>${esc(x.className || (x.grade || '未分班'))}</td>
    <td>${tmap[x.type] || esc(x.type || '')}</td>
    <td>${esc(x.title)}</td>
    <td class="dim" style="max-width:280px">${esc(x.detail || '—')}</td>
    <td><div class="row-actions"><button class="btn-sm btn-edit" data-act="edit">编辑</button><button class="btn-sm btn-del" data-act="del">删除</button></div></td>
  </tr>`).join('');
}

function openCondModal(item) {
  $('#condModalTitle').textContent = item ? '编辑操行记录' : '新增操行记录';
  $('#cId').value = item ? item.id : '';
  condPick = item ? (allStudents.find(s => s.id === item.studentId) || null) : null;
  const sel = $('#cStudentSel');
  sel.value = condPick ? condPick.name + (condPick.studentId ? '（' + condPick.studentId + '）' : '') : '';
  sel.disabled = !!item;
  $('#cSelType').value = item ? item.type : 'reward';
  $('#cDate').value = item ? (item.date || today()) : today();
  $('#cTitle').value = item ? item.title : '';
  $('#cDetail').value = item ? (item.detail || '') : '';
  $('#modalMask').classList.add('show');
  if (!item) setTimeout(() => sel.focus(), 60);
}

function condPickList(kw) {
  const box = $('#cStudentList');
  if (!kw) { box.innerHTML = ''; return; }
  const list = allStudents.filter(s => (s.name || '').includes(kw) || (s.studentId || '').includes(kw)).slice(0, 10);
  if (!list.length) { box.innerHTML = '<div class="sel-item dim">未找到学生</div>'; return; }
  box.innerHTML = list.map(s => `<div class="sel-item" data-id="${esc(s.id)}">${esc(s.name)}（${esc(s.studentId || s.grade || '未分班')}）${s.className ? ' · ' + esc(s.className) : ''}</div>`).join('');
}

async function saveCond(e) {
  e.preventDefault();
  if (!condPick) { toast('请先选择学生', 'error'); return; }
  const payload = {
    studentId: condPick.id,
    type: $('#cSelType').value,
    date: $('#cDate').value || today(),
    title: $('#cTitle').value.trim(),
    detail: $('#cDetail').value.trim()
  };
  if (!payload.title) { toast('请填写标题', 'error'); return; }
  const id = $('#cId').value;
  const done = busyBtn(e && e.submitter ? e.submitter : $('#condForm') && $('#condForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
  try {
    await jfetch(id ? `${COND_API}/${id}` : COND_API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    toast(id ? '已更新' : '已添加', 'success');
    $('#modalMask').classList.remove('show');
    queryConduct();
  } catch (err) { toast(err.message, 'error'); }
  finally { done(); }
}

async function delConduct(id) {
  if (!(await confirmDlg('确定删除该条操行记录？', { title: '删除记录', okText: '删除', danger: true }))) return;
  try {
    await jfetch(`${COND_API}/${id}`, { method: 'DELETE' });
    toast('已删除', 'success');
    queryConduct();
  } catch (e) { toast(e.message, 'error'); }
}

function switchTab(tab) {
  document.querySelectorAll('.cd-tabs .cd-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['register', 'records', 'conduct'].forEach(k => $('#tab-' + k).hidden = k !== tab);
  if (tab === 'records') queryRecords();
  if (tab === 'conduct') queryConduct();
}

function bindEvents() {
  // 年级 -> 班级
  $('#attGrade').onchange = () => fillClassSelect('attClass', $('#attGrade').value);
  $('#btnLoadRoster').onclick = loadRoster;
  $('#btnSaveAtt').onclick = saveAttendance;
  $('#btnSetAllP').onclick = () => {
    $('#attBody').querySelectorAll('.st-att').forEach(s => { s.value = 'present'; });
    refreshStats();
  };
  $('#attBody').addEventListener('change', (e) => {
    if (e.target.classList.contains('st-att')) refreshStats();
  });
  $('#recGrade').onchange = () => fillClassSelect('recClass', $('#recGrade').value);
  $('#btnQueryRecords').onclick = queryRecords;
  $('#recBody').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('tr').dataset.id;
    if (b.dataset.act === 'del-att') {
      if (!(await confirmDlg('确定删除该日考勤记录？', { title: '删除考勤', okText: '删除', danger: true }))) return;
      await jfetch(`${ATT_API}/${id}`, { method: 'DELETE' });
      toast('已删除', 'success'); queryRecords();
    } else if (b.dataset.act === 'edit-att') {
      // 回填到登记页
      try {
        const list = await jfetch(ATT_API + '?' + qs({ date: $('#recFrom').value || '', classId: '' }));
        const rec = list.find(x => x.id === id);
        if (!rec) return toast('未找到记录', 'error');
        $('#attDate').value = rec.date;
        const gOpt = [...$('#attGrade').options].find(o => o.value === rec.grade);
        if (gOpt) $('#attGrade').value = rec.grade;
        fillClassSelect('attClass', rec.grade);
        $('#attClass').value = rec.classId;
        switchTab('register');
        await loadRoster();
        // 覆盖状态
        const map = {};
        rec.records.forEach(r => map[r.id] = r.status);
        $('#attBody').querySelectorAll('.st-att').forEach(s => { if (map[s.dataset.sid]) s.value = map[s.dataset.sid]; });
        refreshStats();
      } catch (err) { toast(err.message, 'error'); }
    }
  };

  // 操行
  document.querySelectorAll('.cd-tabs .cd-tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
  $('#btnQueryCond').onclick = queryConduct;
  $('#cType').onchange = queryConduct;
  $('#btnAddCond').onclick = () => openCondModal(null);
  $('#condBody').onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('tr').dataset.id;
    if (b.dataset.act === 'edit') {
      jfetch(COND_API + '?' + qs({})).then(list => {
        const it = list.find(x => x.id === id);
        if (it) openCondModal(it);
      });
    } else if (b.dataset.act === 'del') delConduct(id);
  };
  $('#modalClose').onclick = () => $('#modalMask').classList.remove('show');
  $('#modalCancel').onclick = () => $('#modalMask').classList.remove('show');
  $('#condForm').onsubmit = saveCond;
  $('#cStudentSel').oninput = (e) => condPickList(e.target.value.trim());
  $('#cStudentList').onclick = (e) => {
    const it = e.target.closest('.sel-item[data-id]');
    if (!it) return;
    condPick = allStudents.find(s => s.id === it.dataset.id) || null;
    if (condPick) {
      $('#cStudentSel').value = condPick.name + (condPick.studentId ? '（' + condPick.studentId + '）' : '');
    }
    $('#cStudentList').innerHTML = '';
  };

  // 从成绩管理跳转：?studentId=xxx 定位该生操行
  const urlId = new URLSearchParams(location.search).get('studentId');
  if (urlId) {
    const stu = allStudents.find(s => s.id === urlId);
    switchTab('conduct');
    $('#cSearch').dataset.studentId = urlId;
    if (stu) {
      $('#cSearch').value = stu.name;
      $('#cSearch').dataset.studentId = stu.id;
    }
    queryConduct();
  }

  window.addEventListener('cb-site-ready', () => { queryConduct(); });
}

window.cbEmbedRefresh = function () {
  loadBase().then(() => {});
};

async function loadBase() {
  const [all, grades] = await Promise.all([
    jfetch(ALL_API, { method: 'GET' }),
    jfetch(GRADES_API, { method: 'GET' })
  ]);
  allStudents = all;
  gradesList = grades;
  classList = [];
  const seen = new Set();
  all.forEach(s => {
    if (s.classId && !seen.has(s.classId)) {
      seen.add(s.classId);
      classList.push({ id: s.classId, name: s.className, grade: s.grade });
    }
  });
  classList.sort((a, b) => a.grade.localeCompare(b.grade, 'zh-Hans-CN', { numeric: true }) || a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
  fillGradeSelects();
  fillClassSelect('attClass', '');
  fillClassSelect('recClass', '');
  $('#recFrom').value = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  $('#recTo').value = today();
  $('#attDate').value = today();
  $('#cDate').value = today();
}

loadBase().then(() => {
  bindEvents();
});
