// 实时分班结果大屏
const BOARD_API = '/api/board';
const MAX_SHOWN = 9;   // 班级卡内直接展示的入座学生数量（最新入座的 N 位，3 行网格）
// 每个学生入场都走「顶部起飞 → 中央展示台展示具体信息 → 飞入对应班级」三段；
// 大屏不丢动画：直播期间人人完整播报。分班页约 0.8~1.8s/人推送，舞台积压时绝不“闪现”入座，
// 而是按排在自己后面的学生数压缩各段飞行/展示时长去追赶直播节奏；
// 直播正常结束后，尚未播完的队列也会逐个播完（结果已持久化，播完即点亮真实座位）。
const LEG_TO_STAGE = 360;   // 宽松模式：顶部 → 展示台 飞行时长
const LEG_TO_SEAT = 430;    // 宽松模式：展示台 → 班级座位 飞行时长
const FAST_LEG_MS = 250;    // 追赶模式：每段飞行时长（队列积压较大时）
const SHOW_MAX_MS = 1500;   // 舞台无人排队：完整展示时长
const SHOW_FAST_MS = 340;   // 后面有人排队：最小展示时长（仍展示信息卡）
const PRESSURE = 3;         // 排在自己身后的学生 ≥ 该值时，飞行时长切换为追赶模式
const POLL_MS = 800;        // 轮询周期：越短越贴近分班页实时进度

let boardData = { classes: [], students: [], grades: [], live: null, grade: '' };
// 大屏始终只展示一个年级（不提供「全部年级」视图）：直播中只播直播所在年级；
// 无直播且开启「跟播」时跟随分班页广播的当前年级；均无则进入「等待年级」空态。
// 打开时可带 ?grade=年级 作为初始展示年级
let gradeFilter = new URLSearchParams(location.search).get('grade') || '';
let autoGrade = true; // 自动跟播：直播或分班页切换年级时自动同步年级
let gradeListSig = ''; // 年级下拉内容签名（避免每帧重建）
let expandedIds = new Set(); // 当前展开花名册的班级 id（可同时展开多个班）
const lastToggleAt = {};     // 防双击连点：同一班级按钮 350ms 内再次点击忽略（不同班互不影响）

// 展开状态持久化（sessionStorage）：大屏页面意外刷新/被浏览器重载后自动恢复上次展开的名册，
// 避免“什么都没点名册却收起来了”
function persistExpanded() {
  try { sessionStorage.setItem('boardExpanded', JSON.stringify([...expandedIds])); } catch (e) {}
}
function restoreExpanded(classes) {
  if (expandedIds.size || !classes.length) return;
  let arr = [];
  try { arr = JSON.parse(sessionStorage.getItem('boardExpanded') || '[]') || []; } catch (e) {}
  const ids = new Set(classes.map(c => c.id));
  arr.forEach(id => { if (ids.has(id)) expandedIds.add(id); });
  if (expandedIds.size) persistExpanded();
}
let lastLiveTs = 0;    // 已应用到界面/飞行队列的 live 时间戳
let lastCdDigit = 0;   // 倒计时遮罩上次显示的数字（仅数字变化时重触发弹入动画）
let wasLive = false;   // 上一轮数据是否处于有效直播帧
let lastLiveGrade = '';// 最近一帧有效直播对应的年级（回落提示是否与当前年级相关）
let wasDealLive = false; // 上一轮是否处于「分班进行中」直播（仅该模式结束时回落才提示已同步）

// 展示队列：直播帧间检测到的新学生，逐个上台展示后飞入班级
let flyQueue = [];
let flyQueuedKeys = new Set();
let showcaseBusy = false; // 舞台串行锁：一次只播报一人
let showAbort = false;    // 页面切换 / 数据归零时置位，中断当前展示动画

const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function totalScore(s) {
  const r = window.subjTotal(s);
  return r.total;
}

// live 快照是否仍有效（最近 6 秒内更新过）
function liveFresh() {
  return !!(boardData.live && boardData.live.ts && Date.now() - boardData.live.ts < 6000);
}

// 当前 live 的阶段：deal=正在分班 / shuffle=正在随机排位 / ready=排位完成待开始分班 / countdown=倒计时（帧内携带 cd 数字）
function livePhase() {
  const l = boardData.live;
  if (!l || !l.ts || Date.now() - l.ts >= 6000) return '';
  return l.phase || 'deal'; // 兼容旧版本快照（未带阶段字段时视为分班中）
}

// 是否有真实分班动画在进行中（分班直播且已有学生被实时分配）
function isAllocMode() {
  if (livePhase() !== 'deal') return false;
  const l = boardData.live;
  return !!(l && (l.classes || []).some(c => (c.students || []).length));
}

// 合并视图：优先 live 快照中的班级数据（分班过程中逐步变化），否则回退到持久化班级
function getViewClasses() {
  const liveMap = new Map();
  if (liveFresh()) {
    (boardData.live.classes || []).forEach(c => liveMap.set(c.id, c));
  }
  let list = boardData.classes.map(c => liveMap.get(c.id) || c);
  // live 中若出现尚未持久化的班级也补进来
  liveMap.forEach(c => { if (!list.some(x => x.id === c.id)) list.push(c); });
  // 大屏只展示当前年级数据：未锁定年级（等待同步）时不展示任何班级，避免混入其它年级
  if (gradeFilter) list = list.filter(c => c.grade === gradeFilter);
  else list = [];
  return list;
}

function viewClassById(id) {
  return getViewClasses().find(c => c.id === id) || null;
}

// ============ 班级卡 DOM（卡片常驻，只增量更新内容，避免直播时整屏闪烁） ============

function buildCard(c) {
  const el = document.createElement('div');
  el.className = 'board-class';
  el.dataset.id = c.id;
  el.innerHTML = `
  <div class="board-class-head">
    <div class="board-class-title">
      <span class="board-class-name"></span>
      <span class="board-class-meta"></span>
    </div>
    <div class="board-class-head-right">
      <button type="button" class="board-roster-btn" title="展开/收起班级花名册"></button>
      <div class="board-class-cap"></div>
    </div>
  </div>
  <div class="board-bar"><div class="board-bar-fill"></div></div>
  <div class="board-mini-row"></div>
  <div class="board-members"></div>
  <div class="board-roster" style="display:none"></div>`;
  return el;
}

function updateCard(cardEl, cls, opts) {
  cardEl.classList.toggle('is-live', isAllocMode());
  const exp = expandedIds.has(cls.id);
  cardEl.classList.toggle('expanded', exp);

  // 头部「花名册」开关按钮文案随展开状态变化
  const rosterBtn = cardEl.querySelector('.board-roster-btn');
  if (rosterBtn) {
    rosterBtn.textContent = exp ? '收起花名册' : '查看花名册';
    rosterBtn.title = exp ? '收起该班级花名册' : '展开该班级花名册（查看完整名单）';
  }

  const stu = cls.students || [];
  const count = stu.length;
  const cap = Number(cls.capacity) || 50;

  cardEl.querySelector('.board-class-name').textContent = cls.name || '';
  cardEl.querySelector('.board-class-meta').textContent = (cls.grade || '') + (cls.headTeacher ? ' · ' + cls.headTeacher : '');

  const capEl = cardEl.querySelector('.board-class-cap');
  capEl.innerHTML = `<span class="cap-num">${count}</span><span class="cap-max"> / ${cap}</span>`;

  const pct = cap ? Math.min(100, Math.round(count / cap * 100)) : 0;
  const fill = cardEl.querySelector('.board-bar-fill');
  fill.style.width = pct + '%';
  fill.classList.toggle('full', pct >= 100);

  const male = stu.filter(s => s.gender === '男').length;
  const avg = count ? (stu.reduce((a, s) => a + totalScore(s), 0) / count).toFixed(1) : '0';
  const mini = cardEl.querySelector('.board-mini-row');
  mini.innerHTML = `<span class="board-mini b-male">男 ${male}</span><span class="board-mini b-female">女 ${count - male}</span><span class="board-mini b-avg">均分 ${avg}</span>`;

  syncMembers(cardEl, cls, opts);

  // 展开名册：轮询刷新时保留列表滚动位置，避免看着看着跳回顶部
  const roster = cardEl.querySelector('.board-roster');
  if (exp) {
    const listEl = roster.querySelector('.board-roster-list');
    const prevTop = listEl ? listEl.scrollTop : 0;
    roster.style.display = 'block';
    roster.innerHTML = rosterHtml(cls);
    const newList = roster.querySelector('.board-roster-list');
    if (newList) newList.scrollTop = prevTop;
  } else {
    roster.style.display = 'none';
  }
}

// 成员小卡头像
function chipAvatarHtml(s) {
  const g = s.gender === '男' ? 'm' : 'f';
  if (s.photo) {
    return `<span class="board-chip-ava" style="background-image:url('${escapeHtml(s.photo)}')"></span>`;
  }
  return `<span class="board-chip-ava ${g}">${escapeHtml((s.name || '?').slice(0, 1))}</span>`;
}

function appendChip(box, s, ghost) {
  const el = document.createElement('div');
  el.className = 'board-chip' + (ghost ? ' seat-ghost' : ' in');
  el.dataset.id = s.id;
  el.innerHTML = `${chipAvatarHtml(s)}<span class="board-chip-name">${escapeHtml(s.name || '')}</span>`;
  box.appendChild(el);
  return el;
}

// 同步某班级卡的「入座区」：只保留最新 MAX_SHOWN 位，新学生动画入座或直接落座。
// 展开名册时该区被 CSS 隐藏（避免与名单重复），小卡仅作「已入座」标记：新学生仍照常入队播报，
// 由 runShowcase 选择飞入名册对应行高亮；收起名册后小卡立即还原。
function syncMembers(cardEl, cls, opts) {
  const box = cardEl.querySelector('.board-members');
  if (!box) return;
  const S = cls.students || [];
  const W = S.slice(-MAX_SHOWN);
  const win = new Set(W.map(s => String(s.id)));

  // 移除被挤出窗口的旧学生小卡
  [...box.querySelectorAll('.board-chip')].forEach(ch => {
    if (!win.has(ch.dataset.id)) ch.remove();
  });

  const emptyTip = box.querySelector('.board-members-empty');
  if (!W.length) {
    if (!emptyTip) {
      box.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'board-members-empty';
      d.textContent = '等待学生入座…';
      box.appendChild(d);
    }
    return;
  }
  if (emptyTip) emptyTip.remove();

  const seated = new Set([...box.querySelectorAll('.board-chip')].map(c => String(c.dataset.id)));
  W.forEach(s => {
    if (seated.has(String(s.id))) return;
    if (opts.anim && cardEl.isConnected && s.id && s.name) {
      enqueueSeat(cardEl, s);   // 逐人上台展示后飞入座位
    } else {
      // 直接落座（首帧/回落/页面中途打开）；若该生已在展示队列则跳过
      const key = cardEl.dataset.id + '\u0001' + s.id;
      if (!flyQueuedKeys.has(key)) seatNow(box, s);
    }
  });
}

function seatNow(box, s) {
  appendChip(box, s, false);
}

// ============ 展示台 + 三段式飞行（顶部起飞 → 中央展示 → 飞入班级） ============

function flyOrigin() {
  return { x: Math.round(window.innerWidth / 2), y: 130 };
}

// 中央展示台：位于视口水平正中、上部约 1/3 处（班级网格顶部的「入场区」）
function stageCenter() {
  return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight * 0.3) };
}

function enqueueSeat(cardEl, s) {
  const key = cardEl.dataset.id + '\u0001' + s.id;
  if (flyQueuedKeys.has(key)) return;
  flyQueuedKeys.add(key);
  flyQueue.push({ cardEl, key, student: s });
  runShowcaseQueue();
}

// 展示时长：后面还有人在排队则压缩停留追赶直播，队列清空时完整展示
function pickShowMs(backlog) {
  return backlog >= 1 ? SHOW_FAST_MS : SHOW_MAX_MS;
}

// 飞行时长：身后积压较多时压缩飞行追赶直播；无人排队时用宽松时长
function pickLegMs(backlog, seat) {
  if (backlog >= PRESSURE) return FAST_LEG_MS;
  return seat ? LEG_TO_SEAT : LEG_TO_STAGE;
}

// 舞台串行调度：FIFO 一次播报一人；清空即释放
function runShowcaseQueue() {
  if (showcaseBusy) return;
  showcaseBusy = true;
  showAbort = false;
  (async () => {
    while (flyQueue.length && !showAbort) {
      const item = flyQueue.shift();
      flyQueuedKeys.delete(item.key);
      if (item.cardEl.isConnected && $('#classesGrid').contains(item.cardEl)) {
        await runShowcase(item, flyQueue.length);
      }
    }
    showcaseBusy = false;
    showAbort = false;
  })();
}

// 学生是否在「已持久化的班级名单」中（回落显示应以此为唯一事实）
function seatInPersisted(cardId, stuId) {
  const c = boardData.classes.find(x => x.id === cardId);
  return !!(c && (c.students || []).some(s => s.id === stuId));
}

// 年级切换 / 网格数据清空时：放弃剩余动画，把排队学生直接补齐，并清掉飞行残影。
// 只补「已持久化」的学生：正常分班结果已落盘所以能补上；中途重置/中止未落盘的学生直接丢弃，
// 避免出现幽灵座位。注意：正常直播结束不调用本函数，已入队学生逐个播完即可。
function flushFlyQueue() {
  showAbort = true;
  const rest = flyQueue.splice(0);
  rest.forEach(item => {
    flyQueuedKeys.delete(item.key);
    if (item.cardEl.isConnected && seatInPersisted(item.cardEl.dataset.id, item.student.id)) {
      const box = item.cardEl.querySelector('.board-members');
      if (box) seatNow(box, item.student);
    }
  });
  const layer = $('#flyLayer');
  if (layer) layer.innerHTML = '';
}

// 单个学生的完整入场流程：起飞 → 展示 → 入座三段人人完整播放，
// 队列压力大时仅压缩各段时间（追赶节奏），绝不会跳过动画
async function runShowcase(item, backlog) {
  const cardEl = item.cardEl;
  const s = item.student;
  const cardId = cardEl.dataset.id;
  const box = cardEl.querySelector('.board-members');
  if (!box) return;
  const exp = expandedIds.has(cardId);

  // 直播已结束且该生未落盘（中途重置/中止）：不再播放，避免出现幽灵座位
  if (!liveFresh() && !seatInPersisted(cardId, s.id)) return;

  if (!exp) {
    // 收起状态：该生若已被更多新同学挤出「最新入座」展示窗口，就无需再补动画
    // （否则会出现飞入后随即被新帧挤掉的闪烁；窗口只展示最新 MAX_SHOWN 位）
    const cur = viewClassById(cardId);
    if (!cur || !(cur.students || []).slice(-MAX_SHOWN).some(x => x.id === s.id)) return;
  }

  // 幽灵占位：先放入入座区（展开名册时该容器隐藏，仅作「已入座」标记，收起后立即还原），动画期间始终占位
  const chip = appendChip(box, s, true);

  const showMs = pickShowMs(backlog);
  const legMs = pickLegMs(backlog, false);
  const seatMs = pickLegMs(backlog, true);

  // 1) 从顶部中央飞向展示台
  await flyBetween(flyOrigin(), stageCenter(), s, legMs);
  if (showAbort) { finishChip(cardId, chip); return; }

  // 2) 展示台放大呈现具体信息（淡出与下一步飞入并行，节省追赶时间）
  const clsName = (viewClassById(cardId) || {}).name || '';
  await showDetail(s, clsName, stageCenter(), showMs);
  if (showAbort) { finishChip(cardId, chip); return; }

  if (exp) {
    // 3) 展开名册：飞入名册中对应行并高亮（名单本身无重复小卡，落点即该生所在行）
    await rosterLanding(cardEl, s, seatMs);
    if (showAbort) { finishChip(cardId, chip); return; }
    settleChip(chip); // 点亮隐藏占位，作为已入座标记
    return;
  }

  // 3) 收起状态：飞入对应班级的座位小卡
  const to = chipCenter(chip);
  if (!to) { settleChip(chip); return; }
  await flyBetween(stageCenter(), to, s, seatMs);
  if (showAbort) { finishChip(cardId, chip); return; }
  settleChip(chip);
}

// ============ 展开名册模式的入座落点：飞入名册对应行并高亮 ============

function findRosterRow(list, sid) {
  const id = String(sid);
  return [...list.querySelectorAll('.board-roster-row')].find(r => r.dataset.id === id) || null;
}

// 让名册内的行滚动到可视区（只滚动名册容器本身，不动页面）
function revealRowInList(listEl, row) {
  const relTop = row.offsetTop - listEl.offsetTop;
  const relBot = relTop + row.offsetHeight;
  if (relTop < listEl.scrollTop) {
    listEl.scrollTop = Math.max(0, relTop - 2);
  } else if (relBot > listEl.scrollTop + listEl.clientHeight) {
    listEl.scrollTop = Math.max(0, relBot - listEl.clientHeight + 2);
  }
}

// 第三段飞行终点：优先该学生在名册中的行；行不存在/不可见时落到名册区域中部。到达后行高亮「刚刚入座」
function rosterLanding(cardEl, s, ms) {
  const roster = cardEl.querySelector('.board-roster');
  const list = roster ? roster.querySelector('.board-roster-list') : null;
  let target = null;
  if (list) {
    const row = findRosterRow(list, s.id);
    if (row) {
      revealRowInList(list, row);
      const rect = row.getBoundingClientRect();
      if (rect.width && rect.height) target = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }
  if (!target) {
    const anchor = list || roster || cardEl;
    const rect = anchor.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // 卡片不可见，无可见落点
    target = { x: rect.left + rect.width / 2, y: Math.max(rect.top + 8, rect.top + rect.height / 2) };
  }
  return flyBetween(stageCenter(), target, s, ms).then(() => {
    // 名册每轮轮询会整体重建，落地点到达后重新查询该行再高亮
    const curRoster = cardEl.querySelector('.board-roster');
    const curList = curRoster ? curRoster.querySelector('.board-roster-list') : null;
    if (!curList) return;
    const row = findRosterRow(curList, s.id);
    if (row && row.isConnected) {
      row.classList.remove('fresh');
      void row.offsetWidth; // 强制重放高亮动画
      row.classList.add('fresh');
    }
  });
}

function settleChip(chip) {
  if (chip.isConnected) {
    chip.classList.remove('seat-ghost');
    chip.classList.add('in');
  }
}

// 展示被中断（重置/回落）时的收尾：学生已持久化才点亮座位，否则撤掉幽灵占位
function finishChip(cardId, chip) {
  if (!chip.isConnected) return;
  if (seatInPersisted(cardId, chip.dataset.id)) settleChip(chip);
  else chip.remove();
}

// 幽灵座位的中心点（供离场飞行测算终点）
function chipCenter(chip) {
  if (!chip.isConnected) return null;
  const r = chip.getBoundingClientRect();
  if (!r.width || !r.height) return null; // 容器被隐藏时无可见落点
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function flyCardContent(s) {
  const g = s.gender === '男' ? 'm' : 'f';
  const ava = s.photo
    ? `<span class="fly-ava" style="background-image:url('${escapeHtml(s.photo)}')"></span>`
    : `<span class="fly-ava ${g}">${escapeHtml((s.name || '?').slice(0, 1))}</span>`;
  return `${ava}<span class="fly-name">${escapeHtml(s.name || '')}</span>`;
}

// 一段飞行（从 A 点飞往 B 点），完成后 resolve
function flyBetween(from, to, s, ms) {
  return new Promise(resolve => {
    const layer = $('#flyLayer');
    if (!layer || !to) { resolve(); return; }
    const node = document.createElement('div');
    node.className = 'fly-card';
    node.innerHTML = flyCardContent(s);
    layer.appendChild(node);

    const nr = node.getBoundingClientRect();
    node.style.transition = 'none';
    node.style.left = (from.x - nr.width / 2) + 'px';
    node.style.top = (from.y - nr.height / 2) + 'px';
    node.style.transform = 'scale(.5) rotate(-8deg)';
    node.style.opacity = '0';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      node.style.transition =
        'left ' + ms + 'ms cubic-bezier(.15,.7,.3,1), top ' + ms + 'ms cubic-bezier(.15,.7,.3,1), '
        + 'transform 260ms cubic-bezier(.2,.8,.3,1.1), opacity 130ms ease-out';
      node.style.left = (to.x - nr.width / 2) + 'px';
      node.style.top = (to.y - nr.height / 2) + 'px';
      node.style.transform = 'scale(1) rotate(0deg)';
      node.style.opacity = '1';
    }));

    setTimeout(() => {
      node.remove();
      resolve();
    }, ms + 40);
  });
}

// 展示台具体信息卡
function stageDetailHtml(s, clsName) {
  const g = s.gender === '男' ? 'm' : 'f';
  const avatar = s.photo
    ? `<span class="sd-avatar" style="background-image:url('${escapeHtml(s.photo)}')"></span>`
    : `<span class="sd-avatar ${g}">${escapeHtml((s.name || '?').slice(0, 1))}</span>`;
  const scores = (window.SUBJECTS || []).map(sj => ({ k: sj.name, v: window.stuScore(s, sj.key) }));
  return `
  ${avatar}
  <div class="sd-main">
    <div class="sd-name">${escapeHtml(s.name || '')}<span class="sd-g ${g}">${s.gender === '男' ? '男' : '女'}</span></div>
    <div class="sd-id">学号 ${escapeHtml(s.studentId || '-')}${s.specialty ? ' · 特长 ' + escapeHtml(s.specialty) : ''}</div>
    <div class="sd-scores">
      ${scores.map(x => `<div class="sd-score"><b>${x.k}</b><span>${x.v ?? '-'}</span></div>`).join('')}
    </div>
  </div>
  <div class="sd-right">
    <div class="sd-total"><b>总分</b><span>${totalScore(s)}</span></div>
    <div class="sd-go">➜ ${escapeHtml(clsName || '班级')}</div>
  </div>`;
}

// 在展示台展示具体信息 showMs 毫秒
function showDetail(s, clsName, pt, showMs) {
  return new Promise(resolve => {
    const layer = $('#flyLayer');
    if (!layer) { resolve(); return; }
    const d = document.createElement('div');
    d.className = 'stage-detail';
    d.innerHTML = stageDetailHtml(s, clsName);
    layer.appendChild(d);

    // 定位到展示台中心并放大入场
    const nr = d.getBoundingClientRect();
    d.style.left = (pt.x - nr.width / 2) + 'px';
    d.style.top = (pt.y - nr.height / 2) + 'px';
    d.classList.add('sd-in');
    d.style.opacity = '1';

    setTimeout(() => {
      d.classList.remove('sd-in');
      d.classList.add('sd-out');
      setTimeout(() => d.remove(), 260); // 淡出动画与后续飞入并行执行
      resolve();
    }, Math.max(showMs, 300));
  });
}

// ============ 概览 / 徽标 / 头部大字 ============

// 概览统计（每次轮询都更新）
function renderStats() {
  const classes = getViewClasses();
  const grade = gradeFilter;
  const assigned = classes.reduce((a, c) => a + (c.students || []).length, 0);
  const capacity = classes.reduce((a, c) => a + (Number(c.capacity) || 0), 0);
  // 「未分班学生」只统计当前年级的未分班学生；实时分班中学生尚未真正从服务端未分班名单移除，
  // 用 live 快照中「当前年级」新增入班人数做减法，让数值随动画同步递减
  let poolLeft = grade ? boardData.students.filter(s => s.grade === grade).length : 0;
  if (liveFresh() && grade) {
    const gradeIds = new Set(boardData.classes.filter(c => c.grade === grade).map(c => c.id));
    const persCount = new Map(
      boardData.classes.filter(c => c.grade === grade).map(c => [c.id, (c.students || []).length])
    );
    const delta = (boardData.live.classes || []).reduce((a, c) => {
      if (!gradeIds.has(c.id)) return a; // 其它年级的实时入班不计入本年级统计
      return a + Math.max(0, (c.students || []).length - (persCount.get(c.id) || 0));
    }, 0);
    poolLeft = Math.max(0, poolLeft - delta);
  }
  $('#statClasses').textContent = classes.length;
  $('#statAssigned').textContent = assigned;
  $('#statPool').textContent = poolLeft;
  $('#statCapacity').textContent = capacity;
}

function renderLiveBadge() {
  const badge = $('#liveBadge');
  const text = $('#liveText');
  if (!badge) return;
  const ph = livePhase();
  const grade = (boardData.live && boardData.live.grade) || '';
  if (ph === 'shuffle') {
    badge.classList.add('on');
    text.textContent = `随机排位中 · ${grade}`;
  } else if (ph === 'ready') {
    badge.classList.add('on');
    text.textContent = '排位完成 · 待开始分班';
  } else if (ph === 'countdown') {
    const l = boardData.live;
    badge.classList.add('on');
    text.textContent = `倒计时 ${(l && l.cd) || ''} · ${grade}`;
  } else if (isAllocMode()) {
    badge.classList.add('on');
    text.textContent = `分班进行中 · ${grade}`;
  } else if (liveFresh()) {
    badge.classList.add('on');
    text.textContent = '已推送，等待入班…';
  } else {
    badge.classList.remove('on');
    text.textContent = '已就绪 · 等待分班';
  }
}

// ============ 大屏 3-2-1 倒计时遮罩 ============
// 以服务端 countdown 帧的 cd 数字为准逐秒对齐；若漏帧或旧服务端未存 cd，
// 本地按「首次见到 countdown 阶段」起兜底计时 3→2→1，保证倒计时必然连续播放。
// 任何一帧阶段切走（deal/结束）立即收起遮罩。
let cdTickTimer = null;   // 本地倒计时推进定时器
let cdDeadline = 0;       // 本地倒计时应结束的时间戳（毫秒）

// 由倒计时截止时间推算当前应显示的数字（每 1s 递减一位）
function cdShownDigit() {
  if (cdDeadline <= 0) return 3;
  const remain = Math.ceil((cdDeadline - Date.now()) / 1000);
  return Math.max(1, Math.min(3, remain));
}

function showCdDigit(v) {
  const digit = $('#cdDigit');
  if (!digit) return;
  const vv = Math.max(1, Math.min(3, v));
  digit.textContent = vv;
  if (vv !== lastCdDigit) {
    digit.classList.remove('pop');
    void digit.offsetWidth; // 强制重启动画
    digit.classList.add('pop');
    lastCdDigit = vv;
  }
}

function stopCdLocal() {
  if (cdTickTimer) { clearInterval(cdTickTimer); cdTickTimer = null; }
  cdDeadline = 0;
}

// 本地兜底：按截止时间推进数字；阶段已切走则收起遮罩（下次轮询 renderCdOverlay 同样会处理）
function cdTick() {
  if (livePhase() !== 'countdown') {
    stopCdLocal();
    const overlay = $('#cdOverlay');
    if (overlay) overlay.classList.remove('show');
    return;
  }
  showCdDigit(cdShownDigit());
}

function renderCdOverlay() {
  const overlay = $('#cdOverlay');
  const digit = $('#cdDigit');
  if (!overlay || !digit) return;
  const l = boardData.live;
  const cd = (l && Number(l.cd)) || 0;
  const ph = livePhase();

  if (ph !== 'countdown') {
    stopCdLocal();
    overlay.classList.remove('show');
    lastCdDigit = 0;
    return;
  }

  // 倒计时阶段：遮罩常显
  overlay.classList.add('show');
  if (!cdTickTimer) {
    // 首次见到倒计时帧：从服务端数字开始（未带 cd 的旧帧从 3 开始），并启动本地兜底计时
    const startV = Math.max(1, cd || 3);
    cdDeadline = Date.now() + startV * 1000;
    showCdDigit(startV);
    cdTickTimer = setInterval(cdTick, 250);
    return;
  }
  // 服务端帧到达且数字推进（3→2→1），或新一轮倒计时重新从 3 开始：以服务端为准重新对齐
  if (cd >= 1 && (cd < lastCdDigit || cd === 3)) {
    cdDeadline = Date.now() + cd * 1000;
    showCdDigit(cd);
  }
}

// 控制条中部胶囊：随机排位 / 排位完成两阶段的醒目提示（观众无需盯操作页）
function renderPhaseBanner() {
  const host = $('#phaseCenter');
  if (!host) return;
  const ph = livePhase();
  const l = boardData.live;
  const related = liveFresh() && l && gradeFilter && l.grade === gradeFilter;
  const show = related && (ph === 'shuffle' || ph === 'ready');
  if (!show) { host.innerHTML = ''; return; }
  if (ph === 'ready') {
    host.innerHTML = `
      <div class="board-phase ready">
        <b>随机排位完成 · ${escapeHtml(l.grade || '')}</b>
        <small>请在分班页点击「开始分班」，学生将逐个分入班级</small>
      </div>`;
  } else {
    host.innerHTML = `
      <div class="board-phase shuffle">
        <b>正在随机排位 · ${escapeHtml(l.grade || '')}</b>
        <small>学生卡片随机换位定序，排好后将逐个分入班级</small>
      </div>`;
  }
}

// 更新头部居中的「当前分班年级」大字（跟随大屏实际展示的年级，直播时红色脉冲强调；
// 随机排位/排位完成阶段同步改文案提示）
function renderCurrentGrade() {
  const box = $('#boardCurrent');
  const label = $('#currentGradeLabel');
  const txt = $('#currentGradeText');
  if (!box || !label || !txt) return;
  const has = !!gradeFilter;
  const liveNow = has && liveFresh() && boardData.live && boardData.live.grade === gradeFilter;
  const ph = liveNow ? livePhase() : '';
  box.classList.toggle('idle', !has);
  // 随机排位是实时动画也强调提示；「排位完成·待开始」属等待期则不高亮脉冲
  box.classList.toggle('hot', liveNow && ph !== 'ready');
  label.textContent = liveNow
    ? (ph === 'shuffle' ? '正在随机排位' : ph === 'ready' ? '排位完成 · 待分班'
      : ph === 'countdown' ? '倒计时 · 即将开始分班' : '分班进行中')
    : (has ? '当前分班年级' : '等待年级同步');
  txt.textContent = gradeFilter || '待同步';
}

// 展开花名册
function rosterHtml(c) {
  const stu = c.students || [];
  if (!stu.length) return `<div class="roster-empty">该班级暂无学生</div>`;
  return `
  <div class="roster-header">班级花名册 · ${escapeHtml(c.name)}（${stu.length} 人）</div>
  <div class="board-roster-list">
    ${stu.map(s => {
      const photo = s.photo
        ? `<span class="board-roster-avatar" style="background-image:url('${escapeHtml(s.photo)}')"></span>`
        : `<span class="board-roster-avatar ${s.gender === '男' ? 'm' : 'f'}">${escapeHtml((s.name || '?').slice(0, 1))}</span>`;
      return `
      <div class="board-roster-row" data-id="${escapeHtml(String(s.id))}">
        ${photo}
        <div class="board-roster-name">${escapeHtml(s.name)}</div>
        <span class="gender-tag ${s.gender === '男' ? 'gender-male' : 'gender-female'}">${escapeHtml(s.gender)}</span>
        <div class="board-roster-info">${escapeHtml(s.studentId || '')}${s.specialty ? ' · ' + escapeHtml(s.specialty) : ''}</div>
        <span class="board-roster-total">${totalScore(s)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

// ============ 网格对账：卡片常驻、按需增删/增量更新 ============

function reconcileGrid(classes) {
  const grid = $('#classesGrid');
  const empty = $('#emptyTip');
  restoreExpanded(classes); // 页面重载后恢复上次展开的名册（仅当有记录且该班仍展示时）
  const liveNow = liveFresh();
  const ts = (boardData.live && boardData.live.ts) || 0;
  // 是否为「新的直播帧」：只有直播快照刷新过才可能有新学生需要飞入
  const liveFrame = liveNow && ts !== lastLiveTs;
  // 本页此前已看过直播、且是新一轮直播刚开场（之前回落过）：首帧新入班的学生同样走动画，
  // 避免第一个学生“闪现”入座；页面刚打开/从未看过直播时不补旧动画（整屏现状直接落座）
  const liveResume = liveNow && !wasLive && lastLiveTs > 0;
  const animFrame = liveFrame && (wasLive || liveResume);
  if (liveNow) {
    lastLiveTs = ts;
    if (boardData.live && boardData.live.grade) lastLiveGrade = boardData.live.grade;
  }

  // 1) 移除不再展示的班级卡（年级切换/数据清空时，中断相关播报并直接补齐）
  //    注意：直播结束回落这里不打断播放，已入队的展示会播完后逐个点亮
  let removedCard = false;
  const visibleIds = new Set(classes.map(c => c.id));
  [...grid.children].forEach(child => {
    if (!visibleIds.has(child.dataset.id)) {
      child.remove();
      expandedIds.delete(child.dataset.id);
      removedCard = true;
    }
  });
  // 仅年级切换 / 数据清空才中断队列；直播正常结束不打断，已入队学生逐个播完
  if (removedCard) { flushFlyQueue(); persistExpanded(); }

  // 2) 对齐顺序并补充新卡，已有卡仅增量更新
  classes.forEach((cls, i) => {
    const ref = grid.children[i];
    if (ref && ref.dataset.id === cls.id) {
      updateCard(ref, cls, { anim: animFrame });
    } else {
      const el = buildCard(cls);
      updateCard(el, cls, { anim: false });
      grid.insertBefore(el, ref || null);
    }
  });

  empty.style.display = classes.length ? 'none' : 'block';
  if (!classes.length) updateEmptyTip();

  // 3) 直播结束回落提示（仅当上一轮是「分班进行中」直播且年级相关时提示，
  //    随机排位/排位完成等准备阶段结束回落不提示，避免误导）
  if (wasDealLive && !liveNow) {
    const rel = !gradeFilter || !lastLiveGrade || lastLiveGrade === gradeFilter;
    if (rel) toast('分班结果已同步到大屏', 'success');
  }
  wasLive = liveNow;
  wasDealLive = liveNow && livePhase() === 'deal';
}

// 空态提示：区分「等待年级同步」与「所选年级暂无班级」
function updateEmptyTip() {
  const empty = $('#emptyTip');
  if (!empty) return;
  const p = empty.querySelector('p');
  const small = empty.querySelector('small');
  if (!p || !small) return;
  if (!gradeFilter) {
    p.textContent = '等待年级同步…';
    small.innerHTML = '请到 <a href="/allocate.html">智能分班</a> 页选择年级并开始分班，大屏只展示当前年级的数据';
  } else {
    p.textContent = '该年级暂无班级';
    small.innerHTML = '请先到 <a href="/classes.html">班级管理</a> 为「' + escapeHtml(gradeFilter) + '」创建班级，再到 <a href="/allocate.html">智能分班</a> 开始分班';
  }
}

function renderBoard() {
  renderStats();
  renderLiveBadge();
  renderPhaseBanner();
  renderCurrentGrade();
  renderCdOverlay();
  reconcileGrid(getViewClasses());
}

// ============ 数据轮询 ============

async function loadBoard() {
  try {
    const res = await fetch(BOARD_API);
    const json = await res.json();
    if (json.code === 0) {
      boardData = json.data || boardData;
      autoFollowGrade();      // 先同步直播年级
      syncGradeOptions();     // 再同步下拉选项（含上面可能切到的年级）
    }
    renderBoard();
  } catch (e) {
    const badge = $('#liveBadge');
    if (badge) { badge.classList.remove('on'); $('#liveText').textContent = '连接失败'; }
  }
}

// ============ 辅助控件 ============

function tickClock() {
  const el = $('#clock');
  if (el) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}

// 同步「跟播」开关的显示状态
function setFollowUI() {
  const btn = $('#followBtn');
  if (!btn) return;
  btn.classList.toggle('on', autoGrade);
  btn.title = autoGrade ? '已开启：空闲时跟随分班页所选年级，直播中自动切到直播年级' : '已暂停：空闲时保持手动固定的年级（直播中仍会自动切到直播年级）';
  btn.textContent = autoGrade ? '跟播中' : '手动';
}

// 用服务端返回的最新年级列表重建下拉（保留当前选择；年级被删除时回到「自动」等待同步）
function syncGradeOptions() {
  const sel = $('#gradeFilter');
  if (!sel) return;
  const grades = (boardData.grades || []).slice();
  const sig = grades.join('\u0001');
  if (sig !== gradeListSig) {
    gradeListSig = sig;
    const prev = gradeFilter;
    // 下拉只列具体年级 + 顶部的「自动」项，不提供「全部年级」视图
    sel.innerHTML = '<option value="">自动 · 跟随分班</option>' + grades.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    if (prev && !grades.includes(prev)) {
      gradeFilter = '';
    }
  }
  if (sel.value !== gradeFilter) sel.value = gradeFilter;
}

// 自动跟播：大屏始终只展示一个年级。
// 1) 分班直播进行中 → 只播直播所在年级（即使处于手动固定也跟随，保证网格与统计始终对应正在分班的年级）；
// 2) 无直播且开启「跟播」→ 跟随分班页广播的当前年级；分班页未广播（未选/未打开）则保留当前展示并等待。
function autoFollowGrade() {
  const l = boardData.live;
  if (liveFresh() && l && l.grade) {
    if (gradeFilter !== l.grade) gradeFilter = l.grade;
    return;
  }
  if (!autoGrade) return;                     // 空闲期尊重手动固定的年级
  if (!(boardData.grades || []).length) return; // 年级列表尚未加载，先不动
  const g = boardData.grade || '';            // 分班页当前所选年级
  if (g && g !== gradeFilter) gradeFilter = g;
}

function bindEvents() {
  $('#gradeFilter').onchange = () => {
    const v = $('#gradeFilter').value;
    if (v) {
      // 手动固定某个年级：仅空闲期生效（直播开始时大屏仍会切到直播年级）
      gradeFilter = v;
      if (autoGrade) {
        autoGrade = false;
        setFollowUI();
        toast('已固定在「' + v + '」（直播中仍会自动切换）', 'info');
      }
    } else {
      // 选回「自动」：恢复跟播，立即按当前直播 / 分班页广播的年级同步
      gradeFilter = '';
      autoGrade = true;
      autoFollowGrade();
      setFollowUI();
      if (gradeFilter) toast('已恢复跟播：当前「' + gradeFilter + '」', 'info');
    }
    syncGradeOptions();
    renderBoard();
  };
  $('#followBtn').onclick = () => {
    autoGrade = !autoGrade;
    if (autoGrade) {
      // 恢复跟播：如果当前就有直播，立即同步过去
      gradeFilter = '';
      autoFollowGrade();
      syncGradeOptions();
      renderBoard();
    }
    setFollowUI();
  };
  // 展开 / 收起花名册：仅「查看花名册 / 收起花名册」按钮触发。
  // 点击卡片其它区域（名册列表、滚动条、班级名、空白处）一律不切换。
  // 防“自动收起”三重保护：
  //  1) 允许多个班同时展开——展开 B 不再自动收起 A；
  //  2) 双击/投影笔连点 350ms 内的第二次点击忽略——避免“刚展开立刻又收起”；
  //  3) 点击后让按钮失焦——避免焦点停在按钮上，之后按空格/回车误触发收起。
  $('#classesGrid').onclick = (e) => {
    const btn = e.target.closest('.board-roster-btn');
    if (!btn) return; // 只有按钮点击才响应
    const card = btn.closest('.board-class');
    if (!card) return;
    e.stopPropagation();
    const id = card.dataset.id;
    const cls = viewClassById(id);
    if (!cls) return;
    const now = Date.now();
    if (now - (lastToggleAt[id] || 0) < 350) return; // 双击/投影笔连点防抖
    lastToggleAt[id] = now;
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    persistExpanded();
    updateCard(card, cls, { anim: false });
    btn.blur();
  };
}

bindEvents();
setFollowUI();
tickClock();
setInterval(tickClock, 1000);
loadBoard();
setInterval(loadBoard, POLL_MS);
