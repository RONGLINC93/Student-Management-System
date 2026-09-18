// 成绩深度分析：单场 / 班级对比 / 学业预警 / 个人趋势（均基于现有考试数据在浏览器端计算）
const $Q = s => document.querySelector(s);
const escP = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const round1 = n => Math.round(n * 10) / 10;
const roundPct = n => Math.round(n * 100) / 100;

let examList = [];       // 元数据列表
let curExam = null;      // 完整考试对象
let classList = [];      // 班级（含花名册）
let allStudents = [];    // 全量学生
let trendExams = [];     // 个人趋势用完整考试
let curTab = 'overview';
let curWarn = 60;

function apiA2(url, method = 'GET', body) {
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }).then(r => r.json()).then(j => {
    if (j.code !== 0) throw new Error(j.msg || '请求失败');
    return j.data;
  });
}
// 科目表（按设置科目；考试中出现但设置里没有的键追加为“临时科目”）
function subjDefs(exam) {
  const map = new Map();
  (window.SUBJECTS || []).forEach(s => map.set(s.key, { key: s.key, name: s.name, max: s.max || 100 }));
  (exam && exam.records ? Object.keys(exam.records) : []).forEach(sid => {
    const rec = exam.records[sid] || {};
    Object.keys(rec).forEach(k => {
      if (!map.has(k)) map.set(k, { key: k, name: k, max: 100 });
    });
  });
  return Array.from(map.values());
}
function scoreNum(v) {
  return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
}
// 学生某次考试“总分百分比”（按科满分加权），无成绩返回 null
function examPct(rec, defs) {
  let sum = 0, maxSum = 0, any = false;
  defs.forEach(d => {
    const v = scoreNum(rec && rec[d.key]);
    if (v === null) return;
    any = true;
    sum += Math.max(0, v);
    maxSum += d.max;
  });
  if (!any || !maxSum) return null;
  return Math.min(100, (sum / maxSum) * 100);
}
function fmtP(n) {
  return n === null || n === undefined ? '—' : roundPct(n).toFixed(1).replace(/\.0$/, '');
}
function pctTxt(v) { return v === null ? '—' : fmtP(v) + '%'; }

// ============ 加载 ============
async function loadBase() {
  const [ex, cls, all] = await Promise.all([
    apiA2('/api/exams'), apiA2('/api/classes'), apiA2('/api/all-students')
  ]);
  examList = (ex || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  classList = cls || [];
  allStudents = all || [];
  renderExamOptions();
}
function renderExamOptions() {
  const sel = $Q('#examSel');
  sel.innerHTML = '<option value="">（请选择考试）</option>' + examList.map(x =>
    `<option value="${escP(x.id)}">${escP(x.name)} · ${escP(x.type || '考试')} · ${escP(x.grade || '全校')} · ${escP((x.date || '').slice(0, 10) || '—')}（${x.stuCount || 0}人）</option>`).join('');
  if (examList[0]) sel.value = examList[0].id;
  if (examList[0]) selectExam(examList[0].id);
}
async function selectExam(id) {
  try {
    curExam = await apiA2('/api/exams/' + encodeURIComponent(id));
  } catch (e) {
    curExam = null;
    toast(e.message, 'error');
  }
  if (curTab === 'overview') renderOverview();
  else if (curTab === 'compare') renderCompare();
  else if (curTab === 'warn') renderWarn();
  // trend 由趋势 tab 自行选择
}

// ============ 单场分析 ============
function participants(defs) {
  const rows = [];
  const recs = curExam.records || {};
  Object.keys(recs).forEach(sid => {
    const pct = examPct(recs[sid], defs);
    if (pct !== null) rows.push({ sid, rec: recs[sid], pct });
  });
  return rows;
}
function renderOverview() {
  const empty = $Q('#ovEmpty');
  const body = $Q('#ovBody');
  const showEmpty = (title, sub) => {
    body.hidden = true;
    empty.hidden = false;
    $Q('#ovEmptyTitle').textContent = title;
    $Q('#ovEmptySub').textContent = sub;
  };
  if (!curExam) return showEmpty('请选择考试场次', '暂无可分析数据，请先在「成绩管理」中新建考试并录入成绩');
  const defs = subjDefs(curExam);
  const rows = participants(defs);
  if (!rows.length) return showEmpty('该场考试暂无成绩数据', '请先在「成绩管理」中为该场考试录入成绩后再回来查看');
  empty.hidden = true;
  body.hidden = false;
  const box = $Q('#kpiBox');
  const avg = rows.reduce((a, r) => a + r.pct, 0) / rows.length;
  const pass = rows.filter(r => r.pct >= 60).length / rows.length * 100;
  const excel = rows.filter(r => r.pct >= 85).length / rows.length * 100;
  const maxP = Math.max(...rows.map(r => r.pct));
  const minP = Math.min(...rows.map(r => r.pct));
  box.innerHTML = [
    ['参加人数', rows.length + ' 人'],
    ['平均总分 %', fmtP(avg) + '%'],
    ['及格率', fmtP(pass) + '%'],
    ['优秀率', fmtP(excel) + '%'],
    ['最高 %', fmtP(maxP) + '%'],
    ['最低 %', fmtP(minP) + '%']
  ].map(k => `<div class="kpi"><b>${k[1]}</b><span>${k[0]}</span></div>`).join('');

  // 分数段
  const bands = [
    { label: '不及格（<60）', min: 0, max: 60, color: '#fca5a5' },
    { label: '及格（60-70）', min: 60, max: 70, color: '#fcd34d' },
    { label: '良好（70-85）', min: 70, max: 85, color: '#93c5fd' },
    { label: '优秀（≥85）', min: 85, max: 101, color: '#6ee7b7' }
  ];
  const seg = bands.map(b => ({ b, n: rows.filter(r => r.pct >= b.min && r.pct < b.max).length }));
  const total = seg.reduce((s, x) => s + x.n, 0) || 1;
  $Q('#segBox').innerHTML = `
    <div class="seg">${seg.map(s => `<i style="width:${(s.n / total * 100).toFixed(1)}%;background:${s.b.color}"></i>`).join('')}</div>
    <div class="seg-legend">${seg.map(s => `<span><em style="background:${s.b.color}"></em>${s.b.label}：${s.n} 人（${fmtP(s.n / total * 100)}%）</span>`).join('')}</div>`;

  // 分科指标
  const subjHtml = defs.map(d => {
    const vals = rows.map(r => scoreNum(r.rec[d.key])).filter(v => v !== null);
    if (!vals.length) return null;
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const pPass = vals.filter(v => v >= d.max * 0.6).length / vals.length * 100;
    const pEx = vals.filter(v => v >= d.max * 0.85).length / vals.length * 100;
    return `<tr>
      <td><b>${escP(d.name)}</b></td><td>${d.max}</td><td>${vals.length}</td>
      <td>${fmtP(mean)}</td><td>${fmtP(Math.max(...vals))}</td><td>${fmtP(Math.min(...vals))}</td>
      <td>${fmtP(pPass)}%</td><td>${fmtP(pEx)}%</td>
    </tr>`;
  }).filter(Boolean).join('');
  $Q('#subjTable').innerHTML = subjHtml;
}

// ============ 班级对比 ============
function classOfStudent(sid) {
  for (const c of classList) {
    if ((c.students || []).some(s => s.id === sid)) return c;
  }
  return null;
}
function renderCompare() {
  if (!curExam) return;
  const defs = subjDefs(curExam);
  const rows = participants(defs);
  const grade = curExam.grade || '';
  const groups = new Map();
  rows.forEach(r => {
    const cls = classOfStudent(r.sid);
    if (!cls || (grade && cls.grade !== grade)) return;
    if (!groups.has(cls.name)) groups.set(cls.name, []);
    groups.get(cls.name).push(r);
  });
  // 未分班学生（同年级）
  const pool = rows.filter(r => {
    const cls = classOfStudent(r.sid);
    return !cls;
  });
  const out = [];
  groups.forEach((arr, name) => out.push({ name, arr }));
  if (pool.length) out.push({ name: '（未分班）', arr: pool });
  out.sort((a, b) => a.arr.length - b.arr.length || a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));
  const box = $Q('#clsTable');
  if (!out.length) { box.innerHTML = '<tr><td colspan="7" class="empty-tip">暂无可对比班级</td></tr>'; return; }
  const maxAvg = Math.max(...out.map(g => g.arr.reduce((s, r) => s + r.pct, 0) / g.arr.length));
  box.innerHTML = out.map(g => {
    const n = g.arr.length;
    const avg = g.arr.reduce((s, r) => s + r.pct, 0) / n;
    const pPass = g.arr.filter(r => r.pct >= 60).length / n * 100;
    const pEx = g.arr.filter(r => r.pct >= 85).length / n * 100;
    const maxV = Math.max(...g.arr.map(r => r.pct));
    const w = maxAvg ? Math.max(2, avg / maxAvg * 100) : 0;
    return `<tr>
      <td><b>${escP(g.name)}</b></td><td>${n}</td>
      <td>${fmtP(avg)}%</td><td>${fmtP(pPass)}%</td><td>${fmtP(pEx)}%</td>
      <td>${fmtP(maxV)}%</td>
      <td><div class="pct-bar"><i style="width:${w.toFixed(1)}%"></i></div></td>
    </tr>`;
  }).join('');
}

// ============ 学业预警 ============
function renderWarn() {
  const box = $Q('#warnTable');
  if (!curExam) { box.innerHTML = '<tr><td colspan="6" class="empty-tip">请先选择考试</td></tr>'; return; }
  const defs = subjDefs(curExam);
  const rows = participants(defs);
  if (!rows.length) { box.innerHTML = '<tr><td colspan="6" class="empty-tip">该场考试尚无成绩数据</td></tr>'; return; }
  const list = rows.map(r => {
    const failSubj = [];
    let minP = 100, minName = '';
    defs.forEach(d => {
      const v = scoreNum(r.rec[d.key]);
      if (v === null) return;
      const p = v / d.max * 100;
      if (p < minP) { minP = p; minName = d.name; }
      if (v < d.max * 0.6) failSubj.push(d.name + ' ' + v + '/' + d.max);
    });
    const cls = classOfStudent(r.sid);
    return { sid: r.sid, name: stuName(r.sid), cls, pct: r.pct, failSubj, minP, minName };
  });
  const th = Number($Q('#warnLine').value) || curWarn;
  curWarn = th;
  const flagged = list.filter(x => x.pct < th || x.failSubj.length).sort((a, b) => a.pct - b.pct);
  $Q('#warnNote').textContent = '共扫描 ' + list.length + ' 人，命中预警 ' + flagged.length + ' 人';
  if (!flagged.length) { box.innerHTML = '<tr><td colspan="6" class="empty-tip">无预警：全体总分百分比 ≥ ' + th + '% 且无单科低于及格</td></tr>'; return; }
  box.innerHTML = flagged.map(x => {
    const tip = x.pct < th ? '总分低于 ' + th + '%，建议重点关注' : (x.failSubj.length === 1 ? '单科偏弱，建议辅导' : '多科偏弱，建议制定提升计划');
    return `<tr>
      <td><b>${escP(x.name)}</b><div class="mini">${escP(studentNo(x.sid))}</div></td>
      <td>${x.cls ? escP(x.cls.name) : '<span class="mini">未分班</span>'}</td>
      <td class="${x.pct < th ? 'warn-bad' : ''}">${fmtP(x.pct)}%</td>
      <td>${x.failSubj.length ? x.failSubj.map(s => '<div class="warn-card mini warn-line">' + escP(s) + '</div>').join('') : '<span class="mini">—</span>'}</td>
      <td>${escP(x.minName)} ${fmtP(x.minP)}%</td>
      <td class="mini">${tip}</td>
    </tr>`;
  }).join('');
}
function stuObj(sid) {
  for (const s of allStudents) if (s.id === sid) return s;
  for (const c of classList) { const s = (c.students || []).find(x => x.id === sid); if (s) return s; }
  return null;
}
function stuName(sid) { const s = stuObj(sid); return s ? (s.name || sid) : sid; }
function studentNo(sid) { const s = stuObj(sid); return s ? (s.studentId || '') : ''; }

// ============ 个人趋势 ============
function fillTrendStuList() {
  const kw = ($Q('#stuSearch').value || '').trim().toLowerCase();
  const list = allStudents.filter(s => !kw || String(s.name || '').toLowerCase().includes(kw) || String(s.studentId || '').toLowerCase().includes(kw));
  const sel = $Q('#trendStu');
  sel.innerHTML = '<option value="">（请选择学生）</option>' + list.map(s =>
    `<option value="${escP(s.id)}">${escP(s.name)}${s.className ? ' · ' + escP(s.className) : ''}（${escP(s.studentId || '')}）</option>`).join('');
}
async function ensureTrendExams() {
  const list = examList.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))).slice(-10);
  const out = [];
  for (const x of list) {
    try { out.push(await apiA2('/api/exams/' + encodeURIComponent(x.id))); } catch (e) { /* 跳过异常 */ }
  }
  trendExams = out;
}
function renderTrend() {
  const sel = $Q('#trendStu');
  const sid = sel.value;
  const note = $Q('#trendNote');
  if (!sid) { note.textContent = ''; $Q('#trendSvg').innerHTML = ''; $Q('#trendLegend').innerHTML = ''; return; }
  ensureTrendExams().then(() => {
    const pts = [];
    trendExams.forEach(ex => {
      const rec = ex.records && ex.records[sid];
      const pct = examPct(rec, subjDefs(ex));
      if (pct !== null) pts.push({ name: ex.name || '', date: ex.date || '', pct });
    });
    note.textContent = '共匹配 ' + pts.length + ' 次有效考试记录';
    if (!pts.length) {
      $Q('#trendSvg').innerHTML = '<text x="400" y="130" text-anchor="middle" fill="#9ca3af" font-size="14">该学生暂无历史考试成绩</text>';
      $Q('#trendLegend').innerHTML = '';
      return;
    }
    const W = 800, H = 260, L = 52, R = 20, T = 20, B = 40;
    const iw = W - L - R, ih = H - T - B;
    const xOf = i => L + (pts.length === 1 ? iw / 2 : i * iw / (pts.length - 1));
    const yOf = p => T + ih - (p / 100) * ih;
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p.pct).toFixed(1)}`).join(' ');
    let grid = '', ax = '';
    [0, 50, 100].forEach(v => {
      const y = yOf(v).toFixed(1);
      grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${v === 0 ? '#d1d5db' : '#e5e7eb'}" stroke-width="1"/>`;
      ax += `<text x="${L - 8}" y="${Number(y) + 4}" text-anchor="end" fill="#9ca3af" font-size="11">${v}</text>`;
    });
    const bars = [60, 85].map(v => {
      const y = yOf(v).toFixed(1);
      return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${v === 60 ? '#f59e0b' : '#10b981'}" stroke-width="1" stroke-dasharray="5 4"/><text x="${W - R - 2}" y="${Number(y) - 4}" text-anchor="end" fill="#9ca3af" font-size="10">${v === 60 ? '及格线' : '优秀线'}</text>`;
    }).join('');
    const dots = pts.map((p, i) => `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(p.pct).toFixed(1)}" r="4" fill="#2563eb"/>`).join('');
    const labels = pts.map((p, i) => {
      const x = Math.min(Math.max(xOf(i), 40), W - 40);
      return `<text x="${x.toFixed(0)}" y="${H - 14}" text-anchor="middle" fill="#6b7280" font-size="11">${escP(shortName(p.name))}</text>`;
    }).join('');
    $Q('#trendSvg').innerHTML = grid + bars + ax + labels + `<path d="${line}" fill="none" stroke="#2563eb" stroke-width="2.4" stroke-linecap="round"/>` + dots;
    $Q('#trendLegend').innerHTML = pts.map(p => `<span style="white-space:nowrap">${escP(p.name)}：<b style="color:#2563eb">${fmtP(p.pct)}%</b></span>`).join('') + '<span style="white-space:nowrap">折线为总分百分比走势，0-100 满刻度。</span>';
  });
}
function shortName(n) {
  const s = String(n || '');
  return s.length > 6 ? s.slice(0, 6) : s;
}

// ============ Tab 切换 ============
function switchTab(name) {
  curTab = name;
  document.querySelectorAll('#anTabs .an-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['overview', 'compare', 'warn', 'trend'].forEach(k => { const el = document.getElementById('tab-' + k); if (el) el.hidden = k !== name; });
  if (name === 'overview') renderOverview();
  else if (name === 'compare') renderCompare();
  else if (name === 'warn') renderWarn();
  else if (name === 'trend') { fillTrendStuList(); renderTrend(); }
}

function bindEvents() {
  $Q('#anTabs').addEventListener('click', e => {
    const t = e.target.closest('.an-tab');
    if (t) switchTab(t.dataset.tab);
  });
  $Q('#examSel').onchange = e => { if (e.target.value) selectExam(e.target.value); };
  $Q('#warnLine').onchange = renderWarn;
  $Q('#stuSearch').oninput = () => { fillTrendStuList(); renderTrend(); };
  $Q('#trendStu').onchange = renderTrend;
}
(async function init() {
  bindEvents();
  try { await loadBase(); } catch (e) { toast(e.message, 'error'); }
})();
window.cbEmbedRefresh = () => loadBase().then(() => renderOverview());
