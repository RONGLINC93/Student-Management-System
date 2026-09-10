// 教师管理 - 主界面逻辑
const TEA_API = '/api/teachers';
const CLASS_API = '/api/classes';
let teachers = [];
let classList = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const IC_HEAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
const IC_CARET = '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const IC_UNCHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';
const IC_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const IC_USER_MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function splitSubjects(subject) {
  if (!subject) return [];
  return String(subject).split(/[,，、;；\/\s]+/).map(s => s.trim()).filter(Boolean);
}

async function loadClasses() {
  try {
    const res = await fetch(CLASS_API);
    const json = await res.json();
    classList = json.data || [];
    const dl = $('#subjectList');
    if (dl) {
      dl.innerHTML = '';
      (window.SUBJECTS || []).forEach(sj => {
        const opt = document.createElement('option');
        opt.value = sj.name;
        dl.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('加载班级失败', e);
  }
}

function renderTable() {
  const kw = ($('#searchInput').value || '').trim().toLowerCase();
  const gender = $('#genderFilter').value;
  const headState = $('#headFilter').value;
  let list = teachers.slice();
  if (kw) {
    list = list.filter(t =>
      (t.name || '').toLowerCase().includes(kw) ||
      (t.teacherNo || '').toLowerCase().includes(kw) ||
      (t.phone || '').toLowerCase().includes(kw) ||
      (t.subject || '').toLowerCase().includes(kw) ||
      (t.className || '').toLowerCase().includes(kw));
  }
  if (gender) list = list.filter(t => t.gender === gender);
  if (headState === 'head') list = list.filter(t => !!t.classId);
  else if (headState === 'none') list = list.filter(t => !t.classId);

  $('#statTotal').textContent = teachers.length;
  $('#statMale').textContent = teachers.filter(t => t.gender === '男').length;
  $('#statFemale').textContent = teachers.filter(t => t.gender === '女').length;
  $('#statHead').textContent = teachers.filter(t => !!t.classId).length;

  if (!list.length) {
    $('#tBody').innerHTML = '<tr><td colspan="8" class="empty-tip">暂无教师数据，点击右上角「添加教师」开始</td></tr>';
    return;
  }

  $('#tBody').innerHTML = list.map(t => {
    const gen = t.gender === '女' ? 'f' : 'm';
    const first = (t.name || '').trim().charAt(0) || '师';
    const chips = splitSubjects(t.subject).map(s => `<span class="subj-chip">${escapeHtml(s)}</span>`).join('');
    const headCell = t.classId && t.className
      ? `<span class="head-tag">${IC_HEAD}${escapeHtml(t.className)}</span>`
      : '<span class="head-none">未担任</span>';
    return `<tr data-id="${escapeHtml(t.id)}">
      <td>
        <div class="teacher-cell">
          <span class="teacher-avatar ${gen}">${escapeHtml(first)}</span>
          <div class="teacher-meta">
            <span class="teacher-name">${escapeHtml(t.name)}</span>
            <span class="teacher-sub">${t.teacherNo ? '工号 ' + escapeHtml(t.teacherNo) : '未编工号'}</span>
          </div>
        </div>
      </td>
      <td><span class="gender-tag ${t.gender === '女' ? 'gender-female' : 'gender-male'}">${escapeHtml(t.gender)}</span></td>
      <td>${chips || '<span class="head-none">—</span>'}</td>
      <td>${escapeHtml(t.title || '—')}</td>
      <td class="t-phone">${escapeHtml(t.phone || '—')}</td>
      <td>${escapeHtml(t.joinYear || '—')}</td>
      <td>${headCell}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-sm btn-edit" data-act="edit">编辑</button>
          <button type="button" class="btn-sm head-btn${t.classId ? ' is-head' : ''}" data-act="head">${IC_HEAD}<span>${t.classId ? '班主任' : '任班主任'}</span>${IC_CARET}</button>
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
    renderTable();
  } catch (e) {
    toast('加载教师失败：' + e.message, 'error');
  }
}

function openModal(t) {
  $('#modalTitle').textContent = t ? '编辑教师' : '添加教师';
  $('#fId').value = t ? t.id : '';
  $('#fTeacherNo').value = t ? t.teacherNo : '';
  $('#fName').value = t ? t.name : '';
  $('#fGender').value = t ? t.gender : '男';
  $('#fSubject').value = t ? t.subject : '';
  $('#fTitle').value = t ? t.title : '';
  $('#fJoinYear').value = t ? t.joinYear : '';
  $('#fPhone').value = t ? t.phone : '';
  $('#fRemark').value = t ? t.remark : '';
  $('#modalMask').classList.add('show');
  setTimeout(() => $('#fName').focus(), 100);
}
function closeModal() { $('#modalMask').classList.remove('show'); }

async function saveTeacher(e) {
  e.preventDefault();
  const id = $('#fId').value;
  const data = {
    teacherNo: $('#fTeacherNo').value.trim(),
    name: $('#fName').value.trim(),
    gender: $('#fGender').value,
    subject: $('#fSubject').value.trim(),
    title: $('#fTitle').value,
    joinYear: $('#fJoinYear').value.trim(),
    phone: $('#fPhone').value.trim(),
    remark: $('#fRemark').value.trim()
  };
  if (!data.name) { toast('请输入教师姓名', 'error'); return; }
  const done = busyBtn(e && e.submitter ? e.submitter : $('#teacherForm') && $('#teacherForm').querySelector('button[type="submit"]'), '保存中…');
  if (!done) return;
  try {
    const res = await fetch(id ? `${TEA_API}/${id}` : TEA_API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '保存失败', 'error'); return; }
    toast(id ? '保存成功' : '添加成功', 'success');
    closeModal();
    await loadTeachers();
  } catch (err) {
    toast('保存失败：' + err.message, 'error');
  } finally {
    done();
  }
}

async function setHead(teacherId, classId) {
  try {
    const res = await fetch(`${TEA_API}/${teacherId}/head`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId })
    });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '操作失败', 'error'); return; }
    toast(json.msg || '已更新', 'success');
    await loadClasses();
    await loadTeachers();
  } catch (e) {
    toast('操作失败：' + e.message, 'error');
  }
}

async function delTeacher(id, name) {
  if (!(await confirmDlg(`确定删除教师「${name}」？若其为班主任将同步解除该班班主任。`, { title: '删除教师', okText: '删除', danger: true }))) return;
  try {
    const res = await fetch(`${TEA_API}/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.code !== 0) { toast(json.msg || '删除失败', 'error'); return; }
    toast('已删除', 'success');
    await loadClasses();
    await loadTeachers();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

/* ===== 悬浮菜单（任 / 改任 / 解除班主任） ===== */
const ctx = $('#ctxMenu');
let ctxTeacher = null;

function closeCtxMenu() {
  if (!ctx) return;
  ctx.classList.remove('show');
  ctxTeacher = null;
}

function openCtxMenu(t, anchor) {
  if (!ctx) return;
  if (ctx.classList.contains('show') && ctxTeacher && ctxTeacher.id === t.id) { closeCtxMenu(); return; }
  if (!classList.length) { toast('暂无班级，请先在「班级管理」中添加班级', 'error'); return; }

  const isHead = !!t.classId;
  let classRows;
  if (!classList.length) {
    classRows = '<button type="button" class="ctx-item" disabled>暂无班级可选</button>';
  } else {
    classRows = classList.map(c => {
      const isCur = c.id === t.classId;
      const other = !isCur && c.headTeacher && c.headTeacher !== t.name ? c.headTeacher : '';
      const hint = isCur ? '担任中'
        : (other ? '现：' + escapeHtml(other) : '');
      const icon = isCur ? IC_CHECK : IC_UNCHECK;
      const curCls = isCur ? ' is-cur' : '';
      return `<button type="button" class="ctx-item${curCls}" data-kind="class" data-cid="${escapeHtml(c.id)}" data-cname="${escapeHtml(c.name)}" data-other="${escapeHtml(other)}" ${isCur ? 'disabled' : ''}>${icon}<span class="lbl">${escapeHtml(c.name)}</span><span class="hint">${hint}</span></button>`;
    }).join('');
  }

  const removeRow = isHead
    ? `<button type="button" class="ctx-item danger" data-kind="cancel">${IC_USER_MINUS}<span class="lbl">解除班主任（当前：${escapeHtml(t.className || '已设班级')}）</span></button>
       <div class="ctx-divider"></div>`
    : '';

  ctx.innerHTML =
    `<div class="ctx-caption">${IC_HEAD}<span>${isHead ? '改任班主任 · 选择班级' : '设为班主任 · 选择班级'}</span></div>
     ${removeRow}
     <div class="ctx-list">${classRows}</div>
     <div class="ctx-divider"></div>
     <button type="button" class="ctx-item" data-kind="edit">${IC_EDIT}<span class="lbl">编辑教师</span></button>
     <button type="button" class="ctx-item danger" data-kind="del">${IC_TRASH}<span class="lbl">删除教师</span></button>`;

  ctxTeacher = t;
  ctx.hidden = false;
  ctx.style.visibility = 'hidden';
  ctx.style.opacity = '0';

  const r = anchor.getBoundingClientRect();
  const mh = ctx.offsetHeight;
  const mw = ctx.offsetWidth;
  let top = r.bottom + 8;
  let left = r.right - mw;
  const placeAbove = top + mh > window.innerHeight - 8;
  if (placeAbove) top = Math.max(8, r.top - mh - 8);
  if (left < 8) left = Math.max(8, r.left);
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  ctx.classList.toggle('above', placeAbove);
  ctx.style.top = top + 'px';
  ctx.style.left = left + 'px';
  ctx.style.visibility = '';
  ctx.style.opacity = '';
  requestAnimationFrame(() => ctx.classList.add('show'));
}

async function ctxPick(t, kind, item) {
  if (kind === 'edit') { closeCtxMenu(); openModal(t); return; }
  if (kind === 'del') { closeCtxMenu(); delTeacher(t.id, t.name); return; }
  if (kind === 'cancel') {
    closeCtxMenu();
    if (!(await confirmDlg(`确定解除「${t.name}」的班主任职务吗？`, { title: '解除班主任', okText: '解除', danger: true }))) return;
    setHead(t.id, '');
    return;
  }
  if (kind === 'class') {
    const cid = item.dataset.cid;
    const cname = item.dataset.cname || '';
    const other = item.dataset.other || '';
    closeCtxMenu();
    if (other) {
      if (!(await confirmDlg(`「${cname}」现由「${other}」担任班主任，确定换由「${t.name}」担任吗？`, { title: '替换班主任', okText: '替换', danger: true }))) return;
    }
    setHead(t.id, cid);
  }
}

function bindEvents() {
  $('#btnAdd').onclick = () => openModal(null);
  $('#modalClose').onclick = closeModal;
  $('#modalCancel').onclick = closeModal;
  $('#teacherForm').onsubmit = saveTeacher;
  $('#searchInput').oninput = renderTable;
  $('#genderFilter').onchange = renderTable;
  $('#headFilter').onchange = renderTable;

  // 悬浮菜单动作（事件委托，防止 re-render 丢失监听）
  document.addEventListener('click', (e) => {
    if (e.target.closest('#ctxMenu')) return;
    if (e.target.closest('[data-act="head"]')) return;
    closeCtxMenu();
  });
  ctx.onclick = async (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item || item.disabled || !ctxTeacher) return;
    const kind = item.dataset.kind;
    if (kind === 'class' || kind === 'cancel' || kind === 'edit' || kind === 'del') ctxPick(ctxTeacher, kind, item);
  };

  $('#tBody').onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const t = teachers.find(x => x.id === tr.dataset.id);
    if (!t) return;
    if (btn.dataset.act === 'edit') openModal(t);
    else if (btn.dataset.act === 'del') delTeacher(t.id, t.name);
    else if (btn.dataset.act === 'head') openCtxMenu(t, btn);
  };

  window.addEventListener('resize', closeCtxMenu);
  window.addEventListener('scroll', closeCtxMenu, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });

  window.addEventListener('cb-site-ready', () => {
    if (window.SUBJECTS && window.SUBJECTS.length) {
      const dl = $('#subjectList');
      if (dl) dl.innerHTML = '';
    }
    loadTeachers();
  });
}

window.cbEmbedRefresh = function () { loadClasses().then(loadTeachers); };

loadClasses().then(() => {
  bindEvents();
  loadTeachers();
});
