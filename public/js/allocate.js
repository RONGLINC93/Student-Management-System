// 智能分班 - 卡牌洗牌发牌逻辑
const API = '/api/students';
const CLS_API = '/api/classes';
const GRADES_API = '/api/grades';
const FILTERS_API = '/api/filters';
let allStudents = []; // 所有学生
let allClasses = []; // 所有班级
let students = []; // 当前年级筛选后的学生
let classData = []; // 当前年级筛选后的班级
let cardEls = []; // 卡牌DOM引用
let allocationResult = null; // 分班结果
let isShuffling = false;
let isDealing = false;
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

// 悬浮按钮模式：shuffle=开始洗牌（紫色），deal=开始分班（绿色）
let floatMode = 'shuffle';
function setFloatMode(mode) {
  floatMode = mode;
  const fb = $('#floatShuffle');
  if (!fb) return;
  const text = mode === 'deal' ? '开始分班' : '开始洗牌';
  $('#floatShuffleText').textContent = text;
  fb.title = text;
  fb.classList.toggle('deal', mode === 'deal');
}

// 发牌速度换算：档位 1-5 → 时间倍率（越小越快）
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

// 应用年级筛选（必须选择年级才能洗牌分班）
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

  // 清除牌堆区域的卡牌
  const deckArea = $('#deckArea');
  if (deckArea) {
    deckArea.innerHTML = '';
  }
  cardEls = [];

  $('#totalStu').textContent = students.length;
  $('#classCount').textContent = classData.length;

  // 同步醒目的年级显示（控制面板标签 + 舞台角标 + 舞台水印大字）
  const gradeTag = $('#gradeTag');
  if (gradeTag) {
    gradeTag.textContent = grade || '未选择';
    gradeTag.classList.toggle('empty', !grade);
  }
  const stageWatermark = $('#stageGradeWatermark');
  if (stageWatermark) stageWatermark.textContent = grade || '';

  if (!grade) {
    // 未选择年级
    $('#stageTip').style.display = 'flex';
    $('#stageTip').innerHTML = `
      <svg class="stage-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 7l9-4 9 4M5 7v6c0 4 14 4 14 0V7"/></svg>
      <p>请先选择年级</p>
      <small>选择年级后才能开始洗牌分班</small>`;
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

// 创建卡牌
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
    <div class="card-back-pattern"></div>
  `;
  return card;
}

// 获取舞台尺寸
function getStageSize() {
  const stage = $('#stage');
  return { w: stage.clientWidth, h: stage.clientHeight };
}

// 在舞台中布局卡牌（初始牌堆）
function layoutDeck(centerSpread = false) {
  const { w, h } = getStageSize();
  const cardW = 110, cardH = 150;
  const cx = w / 2 - cardW / 2;
  const cy = h / 2 - cardH / 2;
  cardEls.forEach((card, i) => {
    if (centerSpread) {
      // 散开成扇形
      const n = cardEls.length;
      const angleRange = Math.min(160, n * 12);
      const step = n > 1 ? angleRange / (n - 1) : 0;
      const angle = -angleRange / 2 + step * i;
      const rad = (angle * Math.PI) / 180;
      const r = 160;
      const x = cx + Math.sin(rad) * r;
      const y = cy + Math.cos(rad) * r * 0.4 - 20;
      card.style.left = x + 'px';
      card.style.top = y + 'px';
      card.style.transform = `rotate(${angle * 0.6}deg)`;
      card.style.zIndex = i;
    } else {
      // 堆叠成牌堆（轻微错位）
      const offset = i * 0.6;
      card.style.left = (cx + offset - cardEls.length * 0.3) + 'px';
      card.style.top = (cy + offset - cardEls.length * 0.3) + 'px';
      card.style.transform = `rotate(${(i - cardEls.length / 2) * 0.5}deg)`;
      card.style.zIndex = i;
    }
  });
}

// 开始洗牌
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

  // 如果卡牌尚未渲染（理论上不会发生），先渲染
  if (!cardEls.length) {
    renderStudentCards();
  }

  // 先收拢成牌堆（正面朝下）
  cardEls.forEach(card => card.classList.add('face-down'));
  await sleep(200);
  layoutDeck(false);
  await sleep(500);

  // 散开成扇形
  layoutDeck(true);
  await sleep(500);

  // 洗牌动画：所有卡牌开始shuffling
  cardEls.forEach((card, i) => {
    card.style.animationDelay = (i * 0.04) + 's';
    card.classList.add('shuffling');
  });

  showStatus('正在洗牌...'); // 动画进行中提示：不阻断洗牌动画
  await sleep(2600);

  // 停止洗牌，保持背面朝上，散开成扇形
  cardEls.forEach(card => {
    card.classList.remove('shuffling');
    // 保持 face-down，发牌时才翻回正面
    card.style.animationDelay = '';
  });
  layoutDeck(true);
  await sleep(500);

  isShuffling = false;
  setShuffleDisabled(false);
  setFloatMode('deal');
  $('#btnDeal').disabled = false;
  $('#btnReset').disabled = false;
  toast('洗牌完成，可以发牌分班', 'success');
}

// ===== 分班算法 =====
function computeAllocation(strategy, classCount) {
  const list = students.map(s => ({ ...s, _total: totalScore(s) }));
  const classes = Array.from({ length: classCount }, () => []);

  if (strategy === 'random') {
    // 随机分班
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    shuffled.forEach((s, i) => classes[i % classCount].push(s));
  } else if (strategy === 'snake') {
    // S型蛇形：按总分排序，1,2,...,n,n,...,2,1 循环
    const sorted = [...list].sort((a, b) => b._total - a._total);
    let dir = 1;
    let cur = 0;
    sorted.forEach(s => {
      classes[cur].push(s);
      if (dir === 1) {
        if (cur === classCount - 1) dir = -1;
        else cur++;
      } else {
        if (cur === 0) dir = 1;
        else cur--;
      }
    });
  } else {
    // 综合均衡：贪心，每次把当前学生分到「最该补的班」
    // 先按总分排序，从高到低，分到当前总分最低且性别/特长尽量平衡的班
    const sorted = [...list].sort((a, b) => b._total - a._total);
    const classTotals = new Array(classCount).fill(0);
    const classMale = new Array(classCount).fill(0);
    const classFemale = new Array(classCount).fill(0);
    const classSpec = new Array(classCount).fill(0);
    sorted.forEach(s => {
      // 评分：总分低优先 + 性别平衡 + 特长分散
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < classCount; i++) {
        const avgTotal = (classTotals.reduce((a, b) => a + b, 0) || 1) / classCount;
        const totalScore_ = -classTotals[i] + (avgTotal - classTotals[i]) * 0.5; // 总分越低越优先
        const sameGender = (s.gender === '男' ? classMale[i] : classFemale[i]);
        const oppGender = (s.gender === '男' ? classFemale[i] : classMale[i]);
        const genderScore = oppGender - sameGender; // 异性多则更欢迎该同性
        const specScore = s.specialty ? -classSpec[i] : 0;
        const score = totalScore_ + genderScore * 1.5 + specScore * 2;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      classes[bestIdx].push(s);
      classTotals[bestIdx] += s._total;
      if (s.gender === '男') classMale[bestIdx]++;
      else classFemale[bestIdx]++;
      if (s.specialty) classSpec[bestIdx]++;
    });
  }
  return classes;
}

// 发牌分班
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
  const strategy = $('#strategy').value;
  const showScale = Number($('#showScale')?.value || 1.6);
  isDealing = true;
  setShuffleDisabled(true);
  $('#btnDeal').disabled = true;
  $('#btnReset').disabled = true;

  // 计算结果
  allocationResult = computeAllocation(strategy, classCount);

  // 显示结果区域（使用真实班级名，保留已分班学生）
  $('#resultSection').style.display = 'block';
  $('#resultTitle').textContent = `${$('#gradeFilter')?.value || ''} · 分班结果`;
  $('#classesGrid').innerHTML = classData.map((c, i) => renderClassBlock(c, i)).join('');

  // 构建发牌顺序：按结果中各班轮流发，每轮发到所有班
  const dealOrder = [];
  const maxLen = Math.max(...allocationResult.map(c => c.length));
  for (let r = 0; r < maxLen; r++) {
    for (let c = 0; c < classCount; c++) {
      if (allocationResult[c][r]) dealOrder.push({ stu: allocationResult[c][r], classIdx: c });
    }
  }

  showStatus('开始发牌...'); // 动画进行中提示：不阻断发牌动画
  // 逐张发牌
  for (let i = 0; i < dealOrder.length; i++) {
    const { stu, classIdx } = dealOrder[i];
    const card = cardEls.find(c => c.dataset.id === stu.id);
    if (!card) continue;

    // 翻牌（正面朝上）
    card.classList.remove('face-down');
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

    await sleep(dealPause(120));
  }

  // 持久化分班结果：学生从池移入班级
  await persistAllocation();

  isDealing = false;
  setShuffleDisabled(false);
  $('#btnReset').disabled = false;
  renderResultStats();
  toast('分班完成！学生已存入各班', 'success');

  // 刷新学生池显示（移除已分配的学生），班级列表由 applyGradeFilter 重新渲染
  await loadStudents();
  allocationResult = null;
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
  // 重新加载数据（学生可能已被分入班级）
  loadStudents();
  if (!silent) toast('已重置', 'success');
}

// 事件绑定
function bindEvents() {
  $('#btnShuffle').onclick = startShuffle;
  const fb = $('#floatShuffle');
  if (fb) fb.onclick = () => (floatMode === 'deal' ? startDeal() : startShuffle());
  $('#btnDeal').onclick = startDeal;
  $('#btnReset').onclick = () => reset();
  $('#gradeFilter').onchange = () => {
    applyGradeFilter();
    saveFilters(); // 保存筛选
    // 如果正在洗牌或发牌，先重置（程序自动重置，不弹提示）
    if (isShuffling || isDealing) {
      reset(true);
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
Promise.all([loadGradeOptions(), loadFilters()]).then(() => {
  loadStudents();
});
