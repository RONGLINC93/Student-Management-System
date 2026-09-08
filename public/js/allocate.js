// 智能分班 - 随机排位 · 均衡编班逻辑
const API = '/api/students';
const CLS_API = '/api/classes';
const GRADES_API = '/api/grades';
const FILTERS_API = '/api/filters';
const LIVE_API = '/api/live';
const BOARD_GRADE_API = '/api/board/grade'; // 广播当前所选年级，供大屏「跟播」实时同步
let allStudents = []; // 所有学生
let allClasses = []; // 所有班级
let students = []; // 当前年级筛选后的学生
let classData = []; // 当前年级筛选后的班级
let cardEls = []; // 学生卡片DOM引用
let allocationResult = null; // 分班结果
let isShuffling = false;
let isDealing = false;
let cdValue = 0;      // 分班倒计时当前数字：0=未倒计时 / 3·2·1
let gradesList = []; // 年级列表

const $ = (s) => document.querySelector(s);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function totalScore(s) {
  return Number(s.chinese) + Number(s.math) + Number(s.english) + Number(s.science);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 同步控制面板与悬浮按钮的禁用状态（悬浮按钮不可用时隐藏）
function setShuffleDisabled(v) {
  $('#btnShuffle').disabled = v;
  const fb = $('#floatShuffle');
  if (fb) fb.classList.toggle('hidden', v);
}

// 悬浮按钮模式：shuffle=随机排位（紫色），deal=开始分班（绿色）
let floatMode = 'shuffle';
function setFloatMode(mode) {
  floatMode = mode;
  const fb = $('#floatShuffle');
  if (!fb) return;
  const text = mode === 'deal' ? '开始分班' : '随机排位';
  $('#floatShuffleText').textContent = text;
  fb.title = text;
  fb.classList.toggle('deal', mode === 'deal');
}

// 演示速度换算：档位 1-5 → 时间倍率（越小越快）
function dealPause(base) {
  const spd = Number($('#dealSpeed')?.value || 3);
  const factor = [2.2, 1.6, 1, 0.6, 0.35][spd - 1] || 1;
  return Math.max(40, Math.round(base * factor));
}

// 更新速度/大小控件的数值显示
function updateDealControls() {
  const spd = $('#dealSpeed');
  const sc = $('#showScale');
  if (spd) $('#dealSpeedVal').textContent = spd.value;
  if (sc) $('#showScaleVal').textContent = sc.value;
}

// 加载年级选项到下拉框
async function loadGradeOptions() {
  try {
    const res = await fetch(GRADES_API);
    const json = await res.json();
    gradesList = json.data || [];

    // 填充筛选下拉框（分班必须指定具体年级，不支持全部年级）
    const filterSel = $('#gradeFilter');
    if (filterSel) {
      const curVal = filterSel.value;
      filterSel.innerHTML = '<option value="">请选择年级</option>';
      gradesList.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        filterSel.appendChild(opt);
      });
      // 恢复之前保存的选择，否则默认不选，必须手动选择年级
      filterSel.value = curVal && gradesList.includes(curVal) ? curVal : '';
    }
  } catch (e) {
    console.error('加载年级失败:', e);
  }
}

// 保存筛选设置到服务端
async function saveFilters() {
  try {
    const filters = {
      'allocate:grade': $('#gradeFilter')?.value || '',
      'allocate:strategy': $('#strategy')?.value || '',
      'allocate:dealSpeed': $('#dealSpeed')?.value || '3',
      'allocate:showScale': $('#showScale')?.value || '1.6'
    };
    await fetch(FILTERS_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters)
    });
  } catch (e) {
    console.error('保存筛选失败:', e);
  }
}

// 从服务端加载筛选设置
async function loadFilters() {
  try {
    const res = await fetch(FILTERS_API);
    const json = await res.json();
    const savedFilters = json.data || {};

    // 恢复筛选设置
    const gradeFilter = $('#gradeFilter');
    if (gradeFilter && savedFilters['allocate:grade']) {
      gradeFilter.value = savedFilters['allocate:grade'];
    }
    const strategy = $('#strategy');
    if (strategy && savedFilters['allocate:strategy']) {
      strategy.value = savedFilters['allocate:strategy'];
    }
    const dealSpeed = $('#dealSpeed');
    if (dealSpeed && savedFilters['allocate:dealSpeed']) {
      dealSpeed.value = savedFilters['allocate:dealSpeed'];
    }
    const showScale = $('#showScale');
    if (showScale && savedFilters['allocate:showScale']) {
      showScale.value = savedFilters['allocate:showScale'];
    }
    updateDealControls();
  } catch (e) {
    console.error('加载筛选失败:', e);
  }
}

// 加载学生和班级
async function loadStudents() {
  try {
    const [stuRes, clsRes] = await Promise.all([fetch(API), fetch(CLS_API)]);
    const stuJson = await stuRes.json();
    const clsJson = await clsRes.json();
    allStudents = stuJson.data || [];
    allClasses = clsJson.data || [];
    applyGradeFilter();
  } catch (e) {
    toast('加载失败：' + e.message, 'error');
  }
}

// 应用年级筛选（必须选择年级才能开始分班）
function applyGradeFilter() {
  const grade = $('#gradeFilter')?.value || '';
  if (grade) {
    students = allStudents.filter(s => s.grade === grade);
    classData = allClasses.filter(c => c.grade === grade);
  } else {
    // 未选择年级：不允许操作
    students = [];
    classData = [];
  }

  // 清空摆放区中的学生卡片
  const deckArea = $('#deckArea');
  if (deckArea) {
    deckArea.innerHTML = '';
  }
  cardEls = [];

  $('#totalStu').textContent = students.length;
  $('#classCount').textContent = classData.length;

  // 同步醒目的年级水印大字（舞台背景展示当前年级）
  const stageWatermark = $('#stageGradeWatermark');
  if (stageWatermark) stageWatermark.textContent = grade || '';

  if (!grade) {
    // 未选择年级
    $('#stageTip').style.display = 'flex';
    $('#stageTip').innerHTML = `
      <svg class="stage-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 7l9-4 9 4M5 7v6c0 4 14 4 14 0V7"/></svg>
      <p>请先选择年级</p>
      <small>选择年级后才能开始随机排位分班</small>`;
    setShuffleDisabled(true);
  } else if (!classData.length) {
    // 无班级
    $('#stageTip').style.display = 'flex';
    $('#stageTip').innerHTML = `
      <svg class="stage-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>
      <p>暂无班级</p>
      <small>请先到 <a href="/classes.html" style="color:#a5b4fc">班级管理</a> 创建班级</small>`;
    setShuffleDisabled(true);
  } else if (!students.length) {
    $('#stageTip').style.display = 'flex';
    $('#stageTip').innerHTML = `
      <svg class="stage-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
      <p>学生池已空</p>
      <small>所有学生已分入班级，请到 <a href="/classes.html" style="color:#a5b4fc">班级管理</a> 查看</small>`;
    setShuffleDisabled(true);
  } else {
    setShuffleDisabled(false);
    setFloatMode('shuffle');
    // 直接显示学生卡片（正面朝上，网格平铺）
    renderStudentCards();
  }

  // 年级筛选后直接显示该年级班级（含已分班学生）
  renderClassesPreview();
}

// 渲染单个班级块（含已分班学生）
function renderClassBlock(c, i) {
  const members = c.students || [];
  const memberHtml = members.map(s => {
    const photoInner = s.photo
      ? `<img src="${escapeHtml(s.photo)}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${escapeHtml(s.name.slice(0,1))}'" />`
      : escapeHtml((s.name || '?').slice(0, 1));
    return `
    <div class="stu-card in-class ${s.gender === '男' ? 'male' : 'female'}" data-id="${s.id}">
      <div class="card-photo">${photoInner}</div>
      <div class="card-body">
        <div class="card-name">${escapeHtml(s.name)}</div>
        <div class="card-info">${escapeHtml(s.studentId || '')}<br/>语${s.chinese}·数${s.math} 英${s.english}·理${s.science}</div>
      </div>
      <div class="card-gender">${s.gender === '男' ? '♂' : '♀'}</div>
      <div class="card-total">${totalScore(s)}</div>
    </div>`;
  }).join('');
  return `
    <div class="class-block" data-class="${i}" data-cls-id="${c.id}">
      <div class="class-header">
        <h3>${escapeHtml(c.name)}</h3>
        <span class="class-meta">${members.length} 人</span>
      </div>
      <div class="class-body" id="classBody-${i}">${memberHtml}</div>
    </div>`;
}

// 年级筛选后直接显示班级
function renderClassesPreview() {
  const rs = $('#resultSection');
  if (!$('#gradeFilter')?.value || !classData.length) {
    rs.style.display = 'none';
    return;
  }
  rs.style.display = 'block';
  $('#resultTitle').textContent = `${$('#gradeFilter')?.value || ''} · 班级列表`;
  const allocatedCount = classData.reduce((a, c) => a + (c.students || []).length, 0);
  $('#resultStats').innerHTML = `
    <span class="result-stat-item">班级数：${classData.length}</span>
    <span class="result-stat-item">已分班：${allocatedCount} 人</span>
    <span class="result-stat-item">待分班：${students.length} 人</span>`;
  $('#classesGrid').innerHTML = classData.map((c, i) => renderClassBlock(c, i)).join('');
}

// 直接渲染学生卡片到桌面（正面朝上，网格平铺）
function renderStudentCards() {
  const deckArea = $('#deckArea');
  deckArea.innerHTML = '';
  $('#stageTip').style.display = 'none';

  cardEls = students.map((s, i) => {
    const card = createCardElement(s, i);
    deckArea.appendChild(card);
    return card;
  });
  // 网格平铺布局
  layoutGrid();
}

// 网格平铺布局
function layoutGrid() {
  const { w, h } = getStageSize();
  console.log('Stage size:', w, h); // 调试信息
  const cardW = 110, cardH = 150;
  const gap = 12;
  const cols = Math.max(1, Math.floor((w - gap) / (cardW + gap)));
  console.log('Columns:', cols); // 调试信息
  const startX = (w - cols * (cardW + gap) + gap) / 2;
  const startY = 20;
  cardEls.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    console.log(`Card ${i}: col=${col}, row=${row}, x=${x}, y=${y}`); // 调试信息
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.style.transform = 'rotate(0deg)';
    card.style.zIndex = i;
  });
}

// 创建学生卡片
function createCardElement(stu, idx) {
  const card = document.createElement('div');
  card.className = `stu-card ${stu.gender === '男' ? 'male' : 'female'}`;
  card.dataset.id = stu.id;
  card.dataset.idx = idx;
  const photoInner = stu.photo
    ? `<img src="${escapeHtml(stu.photo)}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${escapeHtml(stu.name.slice(0,1))}'" />`
    : escapeHtml((stu.name || '?').slice(0, 1));
  card.innerHTML = `
    <div class="card-photo">${photoInner}</div>
    <div class="card-body">
      <div class="card-name">${escapeHtml(stu.name)}</div>
      <div class="card-info">${escapeHtml(stu.studentId || '')}<br/>语${stu.chinese}·数${stu.math} 英${stu.english}·理${stu.science}</div>
    </div>
    <div class="card-gender">${stu.gender === '男' ? '♂' : '♀'}</div>
    <div class="card-total">${totalScore(stu)}</div>
  `;
  return card;
}

// 获取舞台尺寸
function getStageSize() {
  const stage = $('#stage');
  return { w: stage.clientWidth, h: stage.clientHeight };
}

// 随机排位：学生卡片保持正面朝上，在舞台网格中随机位移几次
async function startShuffle() {
  if (!students.length || isShuffling || isDealing) return;
  if (!$('#gradeFilter')?.value) {
    toast('请先选择年级', 'error');
    return;
  }
  isShuffling = true;
  setShuffleDisabled(true);
  $('#btnDeal').disabled = true;
  $('#btnReset').disabled = true;

  // 同步推送到大屏：提示观众「正在随机排位」，并与本页年级对齐
  liveGrade = $('#gradeFilter')?.value || '';
  phaseState = 'shuffle';
  startPhasePump();
  pushLiveBoard();

  // 如果卡片尚未渲染（理论上不会发生），先渲染
  if (!cardEls.length) {
    renderStudentCards();
  }

  showStatus('正在随机排位...'); // 动画进行中提示：不阻断排位动画

  // 多次随机换位：每次打乱卡片顺序后按网格重新平铺，
  // 卡片借助 CSS 的 left/top 过渡平滑位移，最终顺序即排位结果
  const rounds = 3;
  for (let r = 0; r < rounds; r++) {
    // Fisher-Yates 随机打乱卡片顺序
    for (let i = cardEls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cardEls[i], cardEls[j]] = [cardEls[j], cardEls[i]];
    }
    layoutGrid();
    await sleep(r === rounds - 1 ? 700 : 850);
  }

  isShuffling = false;
  setShuffleDisabled(false);
  setFloatMode('deal');
  $('#btnDeal').disabled = false;
  $('#btnReset').disabled = false;

  // 同步推送到大屏：随机排位已完成，等待点击「开始分班」进入分班直播
  phaseState = 'ready';
  pushLiveBoard();
  toast('随机排位完成，可以开始分班', 'success');
}

// ===== 分班算法（容量感知：各班人数不超过容量，且尽量平均） =====
function computeAllocation(strategy) {
  const caps = classData.map(c => Math.max(1, Number(c.capacity) || 50));
  const nCls = caps.length;
  const total = students.length;

  // 1) 目标班额：容量内尽量平均，多出的名额优先给当前人数最少的班
  const budget = new Array(nCls).fill(0);
  let placed = 0;
  while (placed < total) {
    let bi = -1, min = Infinity;
    for (let i = 0; i < nCls; i++) {
      if (budget[i] < caps[i] && budget[i] < min) { min = budget[i]; bi = i; }
    }
    if (bi === -1) break;
    budget[bi]++; placed++;
  }
  if (placed < total && nCls) budget[nCls - 1] += total - placed; // 防御性兜底

  const classes = Array.from({ length: nCls }, () => []);
  const clone = s => ({ ...s, _total: totalScore(s) });

  if (strategy === 'random') {
    // 2) 随机分班：班额保持不变，随机决定每位学生去向
    const targets = [];
    budget.forEach((n, i) => { while (n--) targets.push(i); });
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }
    students.forEach((s, i) => classes[targets[i]].push(clone(s)));
  } else if (strategy === 'snake') {
    // 3) S型蛇形：总分从高到低，按 1..n,n..1 循环入班，整班满额自动跳过
    const sorted = [...students].sort((a, b) => totalScore(b) - totalScore(a));
    const seq = [];
    const rem = budget.slice();
    let pos = 0, fwd = true;
    while (seq.length < total) {
      if (rem[pos] > 0) { seq.push(pos); rem[pos]--; }
      if (fwd) { if (++pos >= nCls) { pos = nCls - 1; fwd = false; } }
      else { if (--pos < 0) { pos = 0; fwd = true; } }
    }
    sorted.forEach((s, i) => classes[seq[i]].push(clone(s)));
  } else {
    // 4) 综合均衡（默认）：贪心均衡 总分/性别/特长，且不突破班额
    const sorted = students.map(clone).sort((a, b) => b._total - a._total);
    const room = budget.slice();
    const tSum = new Array(nCls).fill(0), mMale = new Array(nCls).fill(0),
      mFemale = new Array(nCls).fill(0), mSpec = new Array(nCls).fill(0);
    sorted.forEach(s => {
      const sum = tSum.reduce((a, b) => a + b, 0) || 1;
      const avg = sum / nCls;
      let bi = -1, best = -Infinity;
      for (let i = 0; i < nCls; i++) {
        if (room[i] <= 0) continue; // 满员跳过
        const totalPart = -tSum[i] + (avg - tSum[i]) * 0.5;
        const same = s.gender === '男' ? mMale[i] : mFemale[i];
        const opp = s.gender === '男' ? mFemale[i] : mMale[i];
        const sc = totalPart + (opp - same) * 1.5 + (s.specialty ? -mSpec[i] : 0) * 2;
        if (sc > best) { best = sc; bi = i; }
      }
      if (bi === -1) bi = nCls - 1;
      classes[bi].push(s);
      room[bi]--; tSum[bi] += s._total;
      if (s.gender === '男') mMale[bi]++; else mFemale[bi]++;
      if (s.specialty) mSpec[bi]++;
    });
  }
  return classes;
}

// 依次分班：按策略结果将学生依次放入各班
async function startDeal() {
  if (!cardEls.length || isShuffling || isDealing) return;
  if (!$('#gradeFilter')?.value) {
    toast('请先选择年级', 'error');
    return;
  }
  const classCount = classData.length;
  if (!classCount) {
    toast('请先到班级管理创建班级', 'error');
    return;
  }
  if (students.length < classCount) {
    toast('学生人数不能少于班级数', 'error');
    return;
  }
  const totalCap = classData.reduce((a, c) => a + (Number(c.capacity) || 50), 0);
  if (students.length > totalCap) {
    toast(`班级总容量不足：待分学生 ${students.length} 人 > 总容量 ${totalCap} 人，请先在班级管理中调大容量或退回部分学生`, 'error');
    return;
  }
  const strategy = $('#strategy').value;
  const showScale = Number($('#showScale')?.value || 1.6);
  isDealing = true;
  stopPhasePump(); // 排位提示帧让位：倒计时帧由 runDealCountdown 逐秒接管，随后每入班一人的实时帧自带 deal 阶段
  setShuffleDisabled(true);
  $('#btnDeal').disabled = true;
  $('#btnReset').disabled = true;

  // 初始化大屏实时快照状态（每个班以班级块中已展示的学生为起点）
  liveGrade = $('#gradeFilter')?.value || '';
  liveClassStudents = classData.map(c => (c.students || []).slice());

  // 3-2-1 居中大字倒计时（分班页本地 + 实时帧同步到大屏），倒计时结束才正式开始分班
  await runDealCountdown();

  // 计算结果
  allocationResult = computeAllocation(strategy);
  pushLiveBoard(); // 分班首帧：让大屏从倒计时切换到「分班进行中」

  // 显示结果区域（使用真实班级名，保留已分班学生）
  $('#resultSection').style.display = 'block';
  $('#resultTitle').textContent = `${$('#gradeFilter')?.value || ''} · 分班结果`;
  $('#classesGrid').innerHTML = classData.map((c, i) => renderClassBlock(c, i)).join('');

  // 构建入班顺序：按结果中各班轮流取人，每轮覆盖所有班
  const dealOrder = [];
  const maxLen = Math.max(...allocationResult.map(c => c.length));
  for (let r = 0; r < maxLen; r++) {
    for (let c = 0; c < classCount; c++) {
      if (allocationResult[c][r]) dealOrder.push({ stu: allocationResult[c][r], classIdx: c });
    }
  }

  showStatus('正在依次分班...'); // 动画进行中提示：不阻断分班动画
  // 逐人分入班级
  for (let i = 0; i < dealOrder.length; i++) {
    const { stu, classIdx } = dealOrder[i];
    const card = cardEls.find(c => c.dataset.id === stu.id);
    if (!card) continue;

    card.classList.add('dealing');

    // 先放大展示：移到舞台中央并放大（大小/速度可调），同时显示目标班级
    const { w, h } = getStageSize();
    card.classList.add('showcase');
    card.style.zIndex = 9999;
    card.style.left = (w / 2 - 55) + 'px';
    card.style.top = (h / 2 - 75) + 'px';
    card.style.transform = `scale(${showScale})`;
    const tag = document.createElement('div');
    tag.className = 'showcase-tag';
    tag.textContent = `${classData[classIdx]?.name || ''}`;
    // 显示在卡片右侧，垂直居中，大小跟随卡片缩放
    tag.style.left = (w / 2 + 55 * showScale + 16) + 'px';
    tag.style.top = (h / 2) + 'px';
    tag.style.fontSize = (15 * showScale) + 'px';
    tag.style.padding = (6 * showScale) + 'px ' + (18 * showScale) + 'px';
    // 标签晚于卡片弹出（约为展示时长的 55%）
    tag.style.animationDelay = Math.min(350, Math.round(dealPause(550) * 0.55)) + 'ms';
    $('#deckArea').appendChild(tag);
    await sleep(dealPause(550));
    tag.remove();
    card.classList.remove('showcase');

    // 飞向目标班级区域
    const targetClass = document.getElementById(`classBody-${classIdx}`);
    const cardRect = card.getBoundingClientRect();
    const targetRect = targetClass.getBoundingClientRect();
    const dx = targetRect.left - cardRect.left + 8;
    const dy = targetRect.top - cardRect.top + 12;
    const currentLeft = parseFloat(card.style.left || '0');
    const currentTop = parseFloat(card.style.top || '0');
    card.style.left = (currentLeft + dx) + 'px';
    card.style.top = (currentTop + dy) + 'px';
    card.style.transform = 'rotate(360deg) scale(0.5)';
    card.style.opacity = '0.6';

    await sleep(dealPause(140));

    // 落入班级（转成列表卡片）
    card.style.position = 'relative';
    card.style.left = '0';
    card.style.top = '0';
    card.style.transform = 'rotate(0)';
    card.style.opacity = '1';
    card.style.width = '100%';
    card.style.height = 'auto';
    card.style.transition = 'all .35s ease';
    card.classList.add('in-class');
    card.classList.remove('dealing');
    targetClass.appendChild(card);

    // 更新班级人数
    const meta = document.querySelector(`[data-class="${classIdx}"] .class-meta`);
    if (meta) meta.textContent = `${targetClass.children.length} 人`;

    // 实时同步到大屏看板：该生已入班
    liveClassStudents[classIdx] = liveClassStudents[classIdx] || [];
    liveClassStudents[classIdx].push(stu);
    pushLiveBoard();

    await sleep(dealPause(120));
  }

  // 动画结束前强制发出最后一帧，再持久化
  await sendLiveNow();
  await persistAllocation();
  // 持久化完成：清除实时快照，看板回落显示 classes.json
  clearLiveBoard();

  isDealing = false;
  setShuffleDisabled(false);
  $('#btnReset').disabled = false;
  renderResultStats();
  toast('分班完成！学生已存入各班', 'success');

  // 刷新学生池显示（移除已分配的学生），班级列表由 applyGradeFilter 重新渲染
  await loadStudents();
  allocationResult = null;
}

// ===== 开始分班前 3-2-1 倒计时（分班页居中大字 + 实时帧同步大屏） =====
const CD_STEP_MS = 1000; // 每个数字停留时长（> 大屏轮询 0.8s，保证倒计时每帧都能被捕捉）

// 切换分班页倒计时遮罩（v=0 隐藏）
function showCdOverlay(v) {
  const mask = $('#cdMask');
  const digit = $('#cdDigit');
  if (!mask || !digit) return;
  if (v > 0) {
    digit.textContent = v;
    digit.classList.remove('pop');
    void digit.offsetWidth; // 强制重启动画
    digit.classList.add('pop');
    mask.classList.add('show');
  } else {
    mask.classList.remove('show');
  }
}

// 播放 3-2-1 倒计时：逐秒更新本地大字，并把携带当前数字的 countdown 帧推送给大屏
async function runDealCountdown() {
  for (let v = 3; v >= 1; v--) {
    cdValue = v; // livePayload 据此将阶段设为 countdown
    showCdOverlay(v);
    pushLiveBoard();
    await sleep(CD_STEP_MS);
  }
  cdValue = 0;
  showCdOverlay(0);
}

// ===== 大屏看板实时推送 =====
// 分班动画每入班一人即刷新内存快照，大屏 /result.html 通过 /api/board 轮询可看到逐步入班的过程
let livePending = false;
let liveTimer = null;
let liveGrade = '';
let liveClassStudents = []; // 与 classData 同序，记录每班当前应显示的学生
let phaseState = '';        // 分班直播的阶段：shuffle=正在随机排位 / ready=排位完成待开始分班；分班中实时帧由 isDealing 判断
let phaseTimer = null;      // 排位阶段心跳定时器：维持大屏提示帧不超过其 6s 有效期

// 大屏快照：分班中每入班一人刷新一帧（phase=deal）；
// 随机排位阶段发送提示帧（shuffle/ready），班级名单与大屏已展示的持久化数据保持一致（无实时增量变化）
function livePayload() {
  // 倒计时阶段：点击「开始分班」后先广播携带当前数字的 countdown 帧；随后分班中的实时帧为 deal 阶段
  const phase = cdValue > 0 ? 'countdown' : (isDealing ? 'deal' : phaseState);
  return {
    grade: liveGrade,
    phase,
    cd: cdValue, // 当前倒计时数字（3/2/1，非倒计时为 0）
    classes: classData.map((c, i) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      headTeacher: c.headTeacher || '',
      capacity: c.capacity,
      students: (isDealing ? (liveClassStudents[i] || []) : (c.students || [])).map(s => ({ ...s }))
    }))
  };
}

// 立即发送一帧（动画结束/切换前强制发出最终状态）
async function sendLiveNow() {
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
  if (!livePending) return;
  livePending = false;
  try {
    await fetch(LIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(livePayload())
    });
  } catch (e) {
    console.error('推送实时快照失败:', e);
  }
}

// 节流推送（≤200ms 一帧）
function pushLiveBoard() {
  livePending = true;
  if (liveTimer) return;
  liveTimer = setTimeout(() => { liveTimer = null; sendLiveNow(); }, 200);
}

// 排位阶段心跳：shuffle 动画约 3s，排位完成后可能等待较久才开始分班，
// 大屏提示帧 6s 即失效，故每 3s 补推一帧维持提示（真正分班开始后自动停止）
function startPhasePump() {
  if (phaseTimer) clearInterval(phaseTimer);
  phaseTimer = setInterval(() => {
    if (isDealing || !phaseState) return;
    pushLiveBoard();
  }, 3000);
}

function stopPhasePump() {
  if (phaseTimer) { clearInterval(phaseTimer); phaseTimer = null; }
}

// 清除实时快照（分班结束 / 重置后，大屏回落显示持久化 classes.json）
function clearLiveBoard() {
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; }
  livePending = false;
  liveClassStudents = [];
  phaseState = '';
  stopPhasePump();
  fetch(LIVE_API, { method: 'DELETE' }).catch(() => {});
}

// 持久化分班到后端
async function persistAllocation() {
  try {
    const assignments = allocationResult.map((cls, i) => ({
      classId: classData[i].id,
      students: cls.map(s => ({ ...s }))
    }));
    await fetch('/api/allocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments })
    });
  } catch (e) {
    console.error('持久化失败:', e);
  }
}

// 渲染结果统计
function renderResultStats() {
  if (!allocationResult) return;
  const stats = $('#resultStats');
  const totals = allocationResult.map(cls => {
    const sum = cls.reduce((a, s) => a + totalScore(s), 0);
    return { count: cls.length, sum, avg: cls.length ? (sum / cls.length).toFixed(1) : 0 };
  });
  const allTotals = totals.map(t => t.sum);
  const maxT = Math.max(...allTotals);
  const minT = Math.min(...allTotals);
  stats.innerHTML = `
    <span class="result-stat-item">班级数：${allocationResult.length}</span>
    <span class="result-stat-item">总人数：${students.length}</span>
    <span class="result-stat-item">最高总分：${maxT}</span>
    <span class="result-stat-item">最低总分：${minT}</span>
    <span class="result-stat-item">差值：${maxT - minT}</span>
  `;
}

// 重置（silent=true：程序内部触发的自动重置不弹提示）
function reset(silent = false) {
  if (isShuffling || isDealing) return;
  cardEls.forEach(c => c.remove());
  cardEls = [];
  allocationResult = null;
  $('#resultSection').style.display = 'none';
  $('#btnDeal').disabled = true;
  // 重置时同步清除大屏实时快照
  clearLiveBoard();
  // 重新加载数据（学生可能已被分入班级）
  loadStudents();
  if (!silent) toast('已重置', 'success');
}

// 投屏链接同步携带当前所选年级，打开大屏即与该年级对齐
function syncBoardLink() {
  const a = $('#btnBoard');
  if (!a) return;
  const g = $('#gradeFilter')?.value || '';
  a.dataset.href = '/result.html' + (g ? '?grade=' + encodeURIComponent(g) : '');
}

// 广播当前所选年级到大屏：大屏开启「跟播」时，无需直播也会立即切到该年级
function syncBoardGrade() {
  const g = $('#gradeFilter')?.value || '';
  fetch(BOARD_GRADE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade: g })
  }).catch(() => {});
}

// 事件绑定
function bindEvents() {
  $('#btnShuffle').onclick = startShuffle;
  const fb = $('#floatShuffle');
  if (fb) fb.onclick = () => (floatMode === 'deal' ? startDeal() : startShuffle());
  $('#btnDeal').onclick = startDeal;
  $('#btnReset').onclick = () => reset();
  $('#btnBoard').onclick = () => window.open($('#btnBoard').dataset.href || '/result.html', '_blank');
  $('#gradeFilter').onchange = () => {
    applyGradeFilter();
    saveFilters(); // 保存筛选
    syncBoardLink(); // 投屏链接同步携带当前年级
    syncBoardGrade(); // 实时广播到大屏，让大屏「跟播」立即切到该年级
    // 如果正在排位或分班中，先重置（程序自动重置，不弹提示）
    if (isShuffling || isDealing) {
      reset(true);
    } else if (phaseState) {
      // 取消上一轮「排位完成待开始分班」的提示，避免残留到切换后的年级
      clearLiveBoard();
    }
  };
  $('#strategy').onchange = () => {
    saveFilters(); // 保存策略
  };
  const speedInput = $('#dealSpeed');
  const scaleInput = $('#showScale');
  if (speedInput) speedInput.oninput = () => { updateDealControls(); saveFilters(); };
  if (scaleInput) scaleInput.oninput = () => { updateDealControls(); saveFilters(); };

  // 设置模态框
  const settingsMask = $('#settingsMask');
  const openSettings = () => { if (settingsMask) settingsMask.classList.add('show'); };
  const closeSettings = () => { if (settingsMask) settingsMask.classList.remove('show'); };
  const settingsBtn = $('#btnSettings');
  if (settingsBtn) settingsBtn.onclick = openSettings;
  const settingsClose = $('#settingsClose');
  if (settingsClose) settingsClose.onclick = closeSettings;
  const settingsDone = $('#settingsDone');
  if (settingsDone) settingsDone.onclick = closeSettings;
  if (settingsMask) settingsMask.onclick = (e) => { if (e.target === settingsMask) closeSettings(); };
}

bindEvents();
// 分班页关闭/刷新时清空年级广播，大屏不再强绑本页年级
window.addEventListener('pagehide', () => {
  fetch(BOARD_GRADE_API, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade: '' })
  }).catch(() => {});
});
Promise.all([loadGradeOptions(), loadFilters()]).then(() => {
  loadStudents();
  syncBoardLink(); // 恢复筛选后同步投屏链接的年级参数
  syncBoardGrade(); // 恢复筛选后广播当前年级，让已打开的大屏同步对齐
});
