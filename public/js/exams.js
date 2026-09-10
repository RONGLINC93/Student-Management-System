// 成绩管理 - 考试场次 / 录入 / 统计 / 个人成绩单
const EXAM_API = '/api/exams';
const ALL_API = '/api/all-students';
const GRADES_API = '/api/grades';

let exams = [];           // 列表
let allStudents = [];     // 全部学生（含班级标记）
let gradesList = [];
let classList = [];       // 班级（供筛选）
let cur = null;           // 当前考试详情对象
let curId = '';
let personalCache = {};   // 学生id -> 历次考试结果

const $ = (s) => document.querySelector(s);

function esc(v) {
  return String(v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function subjList() { return window.SUBJECTS || []; }
function subjectHeaders() {
  return subjList().map(sj => sj.name);
}
function stuById(id) { return allStudents.find(s => s.id === id); }
function recOf(stuId) { return (cur && cur.records && cur.records[stuId]) ? cur.records[stuId] : null; }
function totalOf(rec) {
  let t = 0, any = false;
  subjList().forEach(sj => {
    const v = rec && rec[sj.key];
    if (v === null || v === undefined || v === '') return;
    any = true; t += Number(v) || 0;
  });
  return any ? t : null;
}
function avgOf(list) {
  if (!list.length) return 0;
  const s = list.reduce((a, x) => a + (x || 0), 0);
  return s / list.length;
}
function today() { return new Date().toISOString().slice(0, 10); }

async function api(url, method, body) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.msg || '请求失败');
  return json.data;
}

async function loadBase() {
  const [ex, all, g] = await Promise.all([
    api(EXAM_API, 'GET'),
    api(ALL_API, 'GET'),
    api(GRADES_API, 'GET')
  ]);
  exams = ex; allStudents = all; gradesList = g;
  classList = [];
  const seen = new Set();
  allStudents.forEach(s => {
    if (s.classId && !seen.has(s.classId)) {
      seen.add(s.classId);
      classList.push({ id: s.classId, name: s.className, grade: s.grade });
    }
  });
  classList.sort((a, b) => a.grade.localeCompare(b.grade, 'zh-Hans-CN', { numeric: true }) || a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
  // 年级下拉
  [['eGrade'], ['nGrade']].forEach(([id]) => {
    const el = $('#' + id);
    if (!el) return;
    el.innerHTML = '<option value="">全校</option>' + gradesList.map(g2 => `<option value="${esc(g2)}">${esc(g2)}</option>`).join('');
  });
  renderExamList();
}

function renderExamList() {
  const kw = ($('#examSearch').value || '').trim().toLowerCase();
  let list = exams.slice();
  if (kw) list = list.filter(x => (x.name || '').toLowerCase().includes(kw));
  const box = $('#examList');
  if (!list.length) { box.innerHTML = '<p class="empty-tip2">暂无考试</p>'; return; }
  box.innerHTML = list.map(x => `
    <div class="exam-item ${x.id === curId ? 'active' : ''}" data-id="${esc(x.id)}">
      <div class="e-name">${esc(x.name)}</div>
      <div class="e-meta">
        <span class="e-type">${esc(x.type || '考试')}</span>
        <span>${esc(x.grade || '全校')}</span>
        <span>${esc((x.date || '').slice(0, 10) || '—')}</span>
        <span>${x.stuCount || 0} 人</span>
      </div>
    </div>`).join('');
}

function switchTab(name) {
  document.querySelectorAll('.main-tabs .mt').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['entry', 'stats', 'personal'].forEach(k => { $('#tab-' + k).hidden = k !== name; });
  if (name === 'stats') renderStats();
  if (name === 'personal') renderPersonal();
}

function renderClassOptions() {
  const scope = $('#scopeClass');
  const grade = cur ? cur.grade : '';
  let items = classList;
  if (grade) items = items.filter(c => c.grade === grade);
  scope.innerHTML = '<option value="">' + (grade ? `全部${esc(grade)}班级` : '全部班级') + '</option>' +
    items.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (grade) {
    // 含未分班学生
    const hasPool = allStudents.some(s => !s.classId && s.grade === grade);
    if (hasPool) scope.insertAdjacentHTML('beforeend', `<option value="__pool">${esc(grade)}（未分班）</option>`);
  }
}

function scopeStudents() {
  const grade = cur ? cur.grade : '';
  const cls = $('#scopeClass').value;
  return allStudents.filter(s => {
    if (cls === '__pool') return !s.classId && s.grade === grade;
    if (cls) return s.classId === cls;
    if (grade) return s.grade === grade;
    return true;
  });
}

function renderEntry() {
  renderClassOptions();
  const tbodyHtml = scopeStudents().map(s => {
    const rec = recOf(s.id) || {};
    const cells = subjList().map(sj => {
      const v = rec[sj.key];
      const val = (v === null || v === undefined || v === '') ? '' : v;
      return `<td><input type="number" class="inp" data-sid="${esc(s.id)}" data-subj="${esc(sj.key)}" value="${esc(val)}" min="0" max="${sj.max || 1000}" /></td>`;
    }).join('');
    const totalV = totalOf(rec);
    return `<tr data-sid="${esc(s.id)}">
      <td><span class="cls-cell">${s.classId ? esc(s.className) : '<span class="dim">未分班</span>'}</span></td>
      <td style="text-align:left">${esc(s.studentId || '')}</td>
      <td style="text-align:left" class="st-name">${esc(s.name)}</td>
      ${cells}
      <td class="st-total">${totalV === null ? '—' : totalV}</td>
    </tr>`;
  }).join('');
  const head = `<tr>
    <th>班级</th><th>学号</th><th>姓名</th>${subjList().map(sj => `<th>${esc(sj.name)}</th>`).join('')}<th>总分</th>
  </tr>`;
  $('#entryTable').innerHTML = head + (scopeStudents().length ? tbodyHtml : '<tr><td colspan="' + (3 + subjList().length + 1) + '" class="empty-tip2">该范围暂无学生</td></tr>');
}

async function selectExam(id) {
  curId = id;
  cur = await api(`${EXAM_API}/${id}`, 'GET');
  $('#emptyHint').hidden = true;
  $('#examDetail').hidden = false;
  $('#eName').value = cur.name || '';
  $('#eType').value = cur.type || '期中考试';
  $('#eGrade').value = cur.grade || '';
  $('#eDate').value = (cur.date || today()).slice(0, 10);
  renderExamList();
  renderEntry();
  switchTab('entry');
  // 个人成绩单选重新填充
  const sel = $('#personalStudent');
  const prev = sel.value;
  sel.innerHTML = allStudents.map(s => `<option value="${esc(s.id)}">${esc((s.grade || '') + ' ' + s.name)}${s.studentId ? '（' + esc(s.studentId) + '）' : ''}</option>`).join('');
  if (prev && allStudents.some(s => s.id === prev)) sel.value = prev;
}

async function createExam(e) {
  e.preventDefault();
  const name = $('#nName').value.trim();
  if (!name) { toast('请填写考试名称', 'error'); return; }
  const done = busyBtn(e && e.submitter ? e.submitter : $('#newExamForm') && $('#newExamForm').querySelector('button[type="submit"]'), '创建中…');
  if (!done) return;
  try {
    const x = await api(EXAM_API, 'POST', {
      name,
      type: $('#nType').value,
      grade: $('#nGrade').value,
      date: $('#nDate').value || today(),
      remark: $('#nRemark').value.trim()
    });
    $('#modalMask').classList.remove('show');
    toast('考试已创建', 'success');
    exams.unshift(x);
    curId = '';
    await selectExam(x.id);
  } catch (err) { toast(err.message, 'error'); }
  finally { done(); }
}

function collectEntryRows() {
  const rows = [];
  const inputs = $('#entryTable').querySelectorAll('input.inp');
  inputs.forEach(inp => {
    const sid = inp.dataset.sid;
    const subj = inp.dataset.subj;
    let row = rows.find(r => r.id === sid);
    if (!row) { row = { id: sid, values: {} }; rows.push(row); }
    const v = inp.value.trim();
    row.values[subj] = v === '' ? null : Number(v);
  });
  // 含已保存但未在该范围展示的记录，需保重：合并模式保留旧的
  return rows;
}

function rowTotalUpdate(row) {
  let t = 0, any = false;
  row.querySelectorAll('input.inp').forEach(inp => {
    const v = Number(inp.value);
    if (!isNaN(v) && inp.value.trim() !== '') { t += v; any = true; }
  });
  const cell = row.querySelector('.st-total');
  if (cell) cell.textContent = any ? t : '—';
}

function renderStats() {
  const grade = cur ? cur.grade : '';
  // 参与统计：该考试记录中属于当前年级范围的考生
  const parts = [];
  Object.keys(cur.records || {}).forEach(id => {
    const stu = stuById(id);
    if (!stu) return;
    if (grade && stu.grade !== grade) return;
    const t = totalOf(cur.records[id]);
    if (t === null) return;
    parts.push({ id, stu, rec: cur.records[id], total: t });
  });
  const allTotals = parts.map(p => p.total).sort((a, b) => b - a);
  parts.forEach(p => { p.rank = allTotals.indexOf(p.total) + 1; });
  const totalList = parts.map(p => p.total);
  const maxT = totalList.length ? Math.max(...totalList) : 0;
  const avgT = totalList.length ? avgOf(totalList) : 0;
  $('#statSummary').innerHTML = `
    <div class="entry-bar" style="margin:0 0 10px">
      <div style="flex:1;display:flex;gap:24px;flex-wrap:wrap">
        <div><span class="dim">参考人数 </span><b>${parts.length}</b></div>
        <div><span class="dim">总分均分 </span><b>${avgT.toFixed(1)}</b></div>
        <div><span class="dim">最高总分 </span><b>${maxT}</b></div>
        <div><span class="dim">考生范围 </span><b>${esc(cur.grade || '全校')}</b></div>
      </div>
    </div>`;
  // 按班级聚合（含未分班）
  const groups = {};
  parts.forEach(p => { const k = p.stu.classId || '__pool'; (groups[k] = groups[k] || []).push(p); });
  const keys = Object.keys(groups);
  const head = '<tr><th>班级</th><th>人数</th>' + subjList().map(sj => `<th>${esc(sj.name)}</th>`).join('') + '<th>总分均分</th><th>最高总分</th></tr>';
  if (!keys.length) {
    $('#statTable').innerHTML = head + '<tr><td colspan="' + (3 + subjList().length + 1) + '" class="empty-tip2">暂无成绩数据</td></tr>';
    return;
  }
  keys.sort((a, b) => {
    const ga = a === '__pool' ? '\uffff' : (groups[a][0].stu.className || '');
    const gb = b === '__pool' ? '\uffff' : (groups[b][0].stu.className || '');
    return ga.localeCompare(gb, 'zh-Hans-CN', { numeric: true });
  });
  $('#statTable').innerHTML = head + keys.map(k => {
    const ps = groups[k];
    const name = k === '__pool' ? esc(cur.grade || '') + '（未分班）' : esc(ps[0].stu.className || '未知班级');
    const cells = subjList().map(sj => {
      const arr = ps.map(p => {
        const v = p.rec[sj.key];
        return (v === null || v === undefined || v === '') ? null : Number(v);
      }).filter(x => x !== null);
      return '<td>' + (arr.length ? avgOf(arr).toFixed(1) : '—') + '</td>';
    }).join('');
    return `<tr><td style="text-align:left">${name}</td><td>${ps.length}</td>${cells}<td><b>${(ps.reduce((a, p) => a + p.total, 0) / ps.length).toFixed(1)}</b></td><td>${Math.max(...ps.map(p => p.total))}</td></tr>`;
  }).join('');
}

function renderPersonal() {
  const sid = $('#personalStudent').value;
  const stu = stuById(sid);
  if (!stu) { $('#personalTable').innerHTML = '<tr><td class="empty-tip2">请选择学生</td></tr>'; return; }
  const rows = [];
  exams.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(x => {
    const rec = (x.records && x.records[sid]) || null;
    if (!rec) return;
    const total = totalOf(rec);
    // 同场排名
    let rank = 0;
    if (total !== null) {
      const others = Object.keys(x.records || {}).map(k => ({ id: k, t: totalOf(x.records[k]) }))
        .filter(o => o.t !== null && stuById(o.id) && (!x.grade || stuById(o.id).grade === x.grade));
      others.sort((a, b) => b.t - a.t);
      rank = others.findIndex(o => o.id === sid) + 1;
    }
    rows.push({ x, rec, total, rank });
  });
  const head = '<tr><th>考试</th><th>类型</th><th>日期</th>' + subjList().map(sj => `<th>${esc(sj.name)}</th>`).join('') + '<th>总分</th><th>范围排名</th></tr>';
  if (!rows.length) {
    $('#personalTable').innerHTML = head + `<tr><td colspan="${5 + subjList().length}" class="empty-tip2">该学生暂无考试成绩记录</td></tr>`;
    return;
  }
  $('#personalTable').innerHTML = head + rows.map(r => {
    const cells = subjList().map(sj => {
      const v = r.rec[sj.key];
      return `<td>${(v === null || v === undefined || v === '') ? '—' : v}</td>`;
    }).join('');
    return `<tr>
      <td style="text-align:left">${esc(r.x.name)}</td><td>${esc(r.x.type || '—')}</td><td>${esc((r.x.date || '').slice(0, 10) || '—')}</td>
      ${cells}<td><b>${r.total === null ? '—' : r.total}</b></td><td>${r.rank ? r.rank + ' 名' : '—'}</td>
    </tr>`;
  }).join('');
  $('#btnViewConduct').hidden = false;
}

async function saveMeta() {
  const done = busyBtn($('#btnMetaSave'), '保存中…');
  if (!done) return;
  try {
    await api(`${EXAM_API}/${curId}`, 'PUT', {
      name: $('#eName').value.trim(),
      type: $('#eType').value,
      grade: $('#eGrade').value,
      date: $('#eDate').value
    });
    toast('考试信息已保存', 'success');
    await loadBase();
    await selectExam(curId);
  } catch (e) { toast(e.message, 'error'); }
  finally { done(); }
}

async function saveScores() {
  const list = collectEntryRows();
  const done = busyBtn($('#btnSaveScores'), '保存中…');
  if (!done) return;
  try {
    await api(`${EXAM_API}/${curId}/records`, 'PUT', { list });
    toast(`已保存 ${list.length} 名学生的成绩`, 'success');
    cur = await api(`${EXAM_API}/${curId}`, 'GET');
    renderEntry();
    renderExamList();
  } catch (e) { toast(e.message, 'error'); }
  finally { done(); }
}

function fillArchive() {
  const inputs = $('#entryTable').querySelectorAll('input.inp');
  let n = 0;
  inputs.forEach(inp => {
    if (inp.value.trim() !== '') return;
    const s = stuById(inp.dataset.sid);
    if (!s || !s.scores) return;
    const v = s.scores[inp.dataset.subj];
    if (v === null || v === undefined || v === '') return;
    inp.value = v;
    n++;
  });
  $('#entryTable').querySelectorAll('tr[data-sid]').forEach(tr => rowTotalUpdate(tr));
  toast(`已从档案成绩填入 ${n} 个分数（仅填充空白格）`, 'success');
}

function exportCsv() {
  const rows = [['班级', '学号', '姓名', ...subjectHeaders(), '总分']];
  scopeStudents().forEach(s => {
    const rec = recOf(s.id) || {};
    const cells = subjList().map(sj => {
      const v = rec[sj.key];
      return (v === null || v === undefined || v === '') ? '' : v;
    });
    const t = totalOf(rec);
    rows.push([s.className || (s.grade || '') + '（未分班）', s.studentId || '', s.name, ...cells, t === null ? '' : t]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(v => {
    const str = String(v === undefined || v === null ? '' : v);
    return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = ((cur.name || '考试成绩') + '-' + today()) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

function bindEvents() {
  $('#btnNewExam').onclick = () => $('#modalMask').classList.add('show');
  $('#modalClose').onclick = () => $('#modalMask').classList.remove('show');
  $('#modalCancel').onclick = () => $('#modalMask').classList.remove('show');
  $('#newExamForm').onsubmit = createExam;
  $('#examSearch').oninput = renderExamList;

  $('#examList').onclick = (e) => {
    const it = e.target.closest('.exam-item');
    if (it) selectExam(it.dataset.id);
  };
  document.querySelectorAll('.main-tabs .mt').forEach(t => {
    t.onclick = () => switchTab(t.dataset.tab);
  });
  $('#scopeClass').onchange = renderEntry;
  $('#btnFillArchive').onclick = fillArchive;
  $('#btnSaveScores').onclick = saveScores;
  $('#btnMetaSave').onclick = saveMeta;
  $('#btnDelExam').onclick = async () => {
    if (!(await confirmDlg(`确定删除考试「${cur.name}」及其全部成绩记录？`, { title: '删除考试', okText: '删除', danger: true }))) return;
    const done = busyBtn(document.getElementById('btnDelExam'), '删除中…');
    if (!done) return;
    try {
      await api(`${EXAM_API}/${curId}`, 'DELETE');
      toast('已删除', 'success');
      exams = exams.filter(x => x.id !== curId);
      curId = ''; cur = null;
      $('#examDetail').hidden = true;
      $('#emptyHint').hidden = false;
      renderExamList();
    } catch (e) { toast(e.message, 'error'); }
    finally { done(); }
  };
  $('#btnToArchive').onclick = async () => {
    if (!(await confirmDlg('将本场考试已录入的成绩覆盖同步为对应学生的「当前档案成绩」？\n该成绩将作为班级总览、分班均衡等参考。', { title: '设为档案成绩', okText: '同步', danger: false }))) return;
    const done = busyBtn(document.getElementById('btnToArchive'), '同步中…');
    if (!done) return;
    try {
      const data = await api(`${EXAM_API}/${curId}/archive`, 'POST', {});
      toast(data.msg || '同步完成', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { done(); }
  };
  $('#btnExportCsv').onclick = exportCsv;
  $('#btnViewConduct').onclick = () => {
    const sid = $('#personalStudent').value;
    window.open('/conduct.html?studentId=' + encodeURIComponent(sid), '_blank');
  };
  $('#personalStudent').onchange = renderPersonal;

  // 总分实时刷新
  $('#entryTable').addEventListener('input', (e) => {
    if (e.target.classList.contains('inp')) rowTotalUpdate(e.target.closest('tr'));
  });

  window.addEventListener('cb-site-ready', () => {
    loadBase();
  });
}

window.cbEmbedRefresh = function () { loadBase(); };

loadBase().then(() => {
  bindEvents();
  if (exams.length) selectExam(exams[0].id);
});
