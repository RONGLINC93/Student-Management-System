const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'students.json');
const CLASSES_FILE = path.join(__dirname, 'data', 'classes.json');
const GRADES_FILE = path.join(__dirname, 'data', 'grades.json');
const FILTERS_FILE = path.join(__dirname, 'data', 'filters.json');

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}
if (!fs.existsSync(CLASSES_FILE)) {
  fs.writeFileSync(CLASSES_FILE, '[]', 'utf-8');
}
if (!fs.existsSync(GRADES_FILE)) {
  fs.writeFileSync(GRADES_FILE, '["高一", "高二", "高三"]', 'utf-8');
}
if (!fs.existsSync(FILTERS_FILE)) {
  fs.writeFileSync(FILTERS_FILE, '{}', 'utf-8');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readStudents() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeStudents(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function readClasses() {
  try {
    const raw = fs.readFileSync(CLASSES_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeClasses(list) {
  fs.writeFileSync(CLASSES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function readGrades() {
  try {
    const raw = fs.readFileSync(GRADES_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return ['高一', '高二', '高三'];
  }
}

function writeGrades(list) {
  fs.writeFileSync(GRADES_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function readFilters() {
  try {
    const raw = fs.readFileSync(FILTERS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function writeFilters(filters) {
  fs.writeFileSync(FILTERS_FILE, JSON.stringify(filters, null, 2), 'utf-8');
}

// 实时分班快照（内存态，供大屏看板在分班动画过程中实时展示）
// phase: deal=分班进行中 / shuffle=正在随机排位 / ready=排位完成待分班 / ''=无阶段
let liveBoard = null; // { ts, grade, phase, classes: [{ id, name, grade, capacity, students: [] }] }
// 分班页当前筛选年级（内存态，分班页切换年级时实时广播，大屏开「跟播」据此同步，不依赖直播）
let boardGrade = '';

function genId() {
  return 'cls_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getMime(ext) {
  return MIME[ext] || 'application/octet-stream';
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS 支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ===== API 路由 =====
  // 获取所有学生（未分班）
  if (pathname === '/api/students' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: readStudents() });
  }

  // 获取所有学生（含已分班），标记分班状态
  if (pathname === '/api/all-students' && req.method === 'GET') {
    const unallocated = readStudents();
    const classes = readClasses();
    const allocated = [];
    classes.forEach(c => {
      (c.students || []).forEach(s => {
        allocated.push({ ...s, allocated: true, className: c.name });
      });
    });
    const allStudents = [
      ...unallocated.map(s => ({ ...s, allocated: false, className: '' })),
      ...allocated
    ];
    return sendJson(res, 200, { code: 0, data: allStudents });
  }

  // 新增学生
  if (pathname === '/api/students' && req.method === 'POST') {
    const body = await readBody(req);
    const list = readStudents();
    const stu = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      studentId: (body.studentId || '').trim(),
      grade: body.grade || '高一',
      photo: body.photo || '',
      name: (body.name || '').trim(),
      gender: body.gender || '男',
      chinese: Number(body.chinese) || 0,
      math: Number(body.math) || 0,
      english: Number(body.english) || 0,
      science: Number(body.science) || 0,
      specialty: body.specialty || ''
    };
    if (!stu.name) return sendJson(res, 400, { code: 1, msg: '姓名不能为空' });
    list.push(stu);
    writeStudents(list);
    return sendJson(res, 200, { code: 0, data: stu });
  }

  // 更新学生
  if (pathname.startsWith('/api/students/') && req.method === 'PUT') {
    const id = pathname.split('/').pop();
    const body = await readBody(req);
    const list = readStudents();
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '学生不存在' });
    list[idx] = {
      ...list[idx],
      studentId: body.studentId !== undefined ? body.studentId.trim() : list[idx].studentId,
      grade: body.grade !== undefined ? body.grade : list[idx].grade,
      photo: body.photo !== undefined ? body.photo : list[idx].photo,
      name: body.name !== undefined ? body.name.trim() : list[idx].name,
      gender: body.gender !== undefined ? body.gender : list[idx].gender,
      chinese: body.chinese !== undefined ? Number(body.chinese) : list[idx].chinese,
      math: body.math !== undefined ? Number(body.math) : list[idx].math,
      english: body.english !== undefined ? Number(body.english) : list[idx].english,
      science: body.science !== undefined ? Number(body.science) : list[idx].science,
      specialty: body.specialty !== undefined ? body.specialty : list[idx].specialty
    };
    writeStudents(list);
    return sendJson(res, 200, { code: 0, data: list[idx] });
  }

  // 删除学生
  if (pathname.startsWith('/api/students/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const list = readStudents();
    const next = list.filter(s => s.id !== id);
    writeStudents(next);
    return sendJson(res, 200, { code: 0, msg: '已删除' });
  }

  // 批量导入
  if (pathname === '/api/students/batch' && req.method === 'POST') {
    const body = await readBody(req);
    const list = readStudents();
    const arr = Array.isArray(body) ? body : (body.list || []);
    arr.forEach(s => {
      list.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        studentId: (s.studentId || '').trim(),
        grade: s.grade || '高一',
        photo: s.photo || '',
        name: (s.name || '').trim(),
        gender: s.gender || '男',
        chinese: Number(s.chinese) || 0,
        math: Number(s.math) || 0,
        english: Number(s.english) || 0,
        science: Number(s.science) || 0,
        specialty: s.specialty || ''
      });
    });
    writeStudents(list);
    return sendJson(res, 200, { code: 0, msg: '已导入', count: arr.length });
  }

  // 清空所有
  if (pathname === '/api/students' && req.method === 'DELETE') {
    writeStudents([]);
    return sendJson(res, 200, { code: 0, msg: '已清空' });
  }

  // ===== 班级管理 API =====
  // 获取所有班级（含学生列表）
  if (pathname === '/api/classes' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: readClasses() });
  }

  // 班级排序（拖拽排序后持久化）
  if (pathname === '/api/classes/order' && req.method === 'PUT') {
    const body = await readBody(req);
    const order = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const list = readClasses();
    const valid = order.length === list.length
      && new Set(order).size === order.length
      && order.every(id => list.some(c => c.id === id));
    if (!valid) return sendJson(res, 400, { code: 1, msg: '排序数据无效' });
    writeClasses(order.map(id => list.find(c => c.id === id)));
    return sendJson(res, 200, { code: 0, msg: '排序已保存' });
  }

  // 新增班级
  if (pathname === '/api/classes' && req.method === 'POST') {
    const body = await readBody(req);
    const list = readClasses();
    const cls = {
      id: genId(),
      name: (body.name || '').trim() || '新班级',
      grade: body.grade || '高一',
      headTeacher: (body.headTeacher || '').trim(),
      capacity: Number(body.capacity) || 50,
      students: []
    };
    list.push(cls);
    writeClasses(list);
    return sendJson(res, 200, { code: 0, data: cls });
  }

  // 修改班级
  if (pathname.startsWith('/api/classes/') && req.method === 'PUT') {
    const id = pathname.split('/').pop();
    const body = await readBody(req);
    const list = readClasses();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '班级不存在' });
    list[idx] = {
      ...list[idx],
      name: body.name !== undefined ? body.name.trim() : list[idx].name,
      grade: body.grade !== undefined ? body.grade : list[idx].grade,
      headTeacher: body.headTeacher !== undefined ? body.headTeacher.trim() : list[idx].headTeacher,
      capacity: body.capacity !== undefined ? Number(body.capacity) : list[idx].capacity
    };
    writeClasses(list);
    return sendJson(res, 200, { code: 0, data: list[idx] });
  }

  // 删除班级（学生退回学生池）
  if (pathname.startsWith('/api/classes/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const classes = readClasses();
    const students = readStudents();
    const cls = classes.find(c => c.id === id);
    if (cls && cls.students && cls.students.length) {
      // 学生退回池
      students.push(...cls.students);
    }
    const next = classes.filter(c => c.id !== id);
    writeClasses(next);
    writeStudents(students);
    return sendJson(res, 200, { code: 0, msg: '已删除，学生已退回学生池' });
  }

  // 清空所有班级（学生退回池）
  if (pathname === '/api/classes' && req.method === 'DELETE') {
    const classes = readClasses();
    const students = readStudents();
    classes.forEach(c => {
      if (c.students && c.students.length) students.push(...c.students);
    });
    writeClasses([]);
    writeStudents(students);
    return sendJson(res, 200, { code: 0, msg: '已清空所有班级，学生已退回学生池' });
  }

  // 把单个学生从班级退回学生池
  if (pathname.startsWith('/api/classes/') && pathname.includes('/remove/') && req.method === 'POST') {
    const parts = pathname.split('/');
    const classId = parts[3];
    const stuId = parts[5];
    const classes = readClasses();
    const students = readStudents();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '班级不存在' });
    const stu = (cls.students || []).find(s => s.id === stuId);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '学生不在该班级' });
    cls.students = (cls.students || []).filter(s => s.id !== stuId);
    students.push(stu);
    writeClasses(classes);
    writeStudents(students);
    return sendJson(res, 200, { code: 0, msg: '已退回学生池' });
  }

  // ===== 年级管理 API =====
  // 获取所有年级
  if (pathname === '/api/grades' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: readGrades() });
  }

  // 年级排序（拖拽排序后持久化）
  if (pathname === '/api/grades/order' && req.method === 'PUT') {
    const body = await readBody(req);
    const order = Array.isArray(body.grades) ? body.grades.map(g => String(g).trim()).filter(Boolean) : [];
    const grades = readGrades();
    const valid = order.length === grades.length
      && new Set(order).size === order.length
      && order.every(g => grades.includes(g));
    if (!valid) return sendJson(res, 400, { code: 1, msg: '排序数据无效' });
    writeGrades(order);
    return sendJson(res, 200, { code: 0, msg: '排序已保存' });
  }

  // 新增年级
  if (pathname === '/api/grades' && req.method === 'POST') {
    const body = await readBody(req);
    const grades = readGrades();
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { code: 1, msg: '年级名称不能为空' });
    if (grades.includes(name)) return sendJson(res, 400, { code: 1, msg: '该年级已存在' });
    grades.push(name);
    writeGrades(grades);
    return sendJson(res, 200, { code: 0, msg: '已添加', data: name });
  }

  // 修改年级名称
  if (pathname.startsWith('/api/grades/') && req.method === 'PUT') {
    const oldName = decodeURIComponent(pathname.split('/').pop());
    const body = await readBody(req);
    const newName = (body.name || '').trim();
    if (!newName) return sendJson(res, 400, { code: 1, msg: '年级名称不能为空' });
    const grades = readGrades();
    const idx = grades.indexOf(oldName);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '年级不存在' });
    if (grades.includes(newName) && newName !== oldName) return sendJson(res, 400, { code: 1, msg: '该年级名称已存在' });
    grades[idx] = newName;
    writeGrades(grades);
    // 更新学生和班级中的年级字段
    const students = readStudents();
    students.forEach(s => { if (s.grade === oldName) s.grade = newName; });
    writeStudents(students);
    const classes = readClasses();
    classes.forEach(c => { if (c.grade === oldName) c.grade = newName; });
    writeClasses(classes);
    return sendJson(res, 200, { code: 0, msg: '已修改' });
  }

  // 删除年级
  if (pathname.startsWith('/api/grades/') && req.method === 'DELETE') {
    const name = decodeURIComponent(pathname.split('/').pop());
    const grades = readGrades();
    const idx = grades.indexOf(name);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '年级不存在' });
    grades.splice(idx, 1);
    writeGrades(grades);
    // 清空该年级的学生和班级的年级字段
    const students = readStudents();
    students.forEach(s => { if (s.grade === name) s.grade = ''; });
    writeStudents(students);
    const classes = readClasses();
    classes.forEach(c => { if (c.grade === name) c.grade = ''; });
    writeClasses(classes);
    return sendJson(res, 200, { code: 0, msg: '已删除' });
  }

  // ===== 分班持久化 API =====
  // 提交分班结果：将学生从池移入对应班级
  if (pathname === '/api/allocate' && req.method === 'POST') {
    const body = await readBody(req);
    // body: { assignments: [{ classId, students: [...] }, ...] }
    const assignments = body.assignments || [];
    const classes = readClasses();
    const students = readStudents();

    assignments.forEach(a => {
      const cls = classes.find(c => c.id === a.classId);
      if (!cls) return;
      // 清空原学生（重新分班）
      const oldStudents = cls.students || [];
      if (oldStudents.length) students.push(...oldStudents);
      // 加入新学生
      cls.students = (a.students || []).map(s => ({ ...s }));
    });

    // 从学生池移除已分配的学生
    const assignedIds = new Set();
    assignments.forEach(a => {
      (a.students || []).forEach(s => assignedIds.add(s.id));
    });
    const remaining = students.filter(s => !assignedIds.has(s.id));

    writeClasses(classes);
    writeStudents(remaining);
    return sendJson(res, 200, { code: 0, msg: '分班完成', assigned: assignedIds.size, remaining: remaining.length });
  }

  // 清除实时快照
  if (pathname === '/api/live' && req.method === 'DELETE') {
    liveBoard = null;
    return sendJson(res, 200, { code: 0, msg: '已清除实时快照' });
  }

  // 推送实时分班快照（分班动画过程中每入班一人调用一次，body: { grade, classes }）
  if (pathname === '/api/live' && req.method === 'POST') {
    const body = await readBody(req);
    const classes = Array.isArray(body.classes) ? body.classes : [];
    liveBoard = {
      ts: Date.now(),
      grade: String(body.grade || ''),
      phase: String(body.phase || ''),
      cd: Number(body.cd) || 0, // 分班前倒计时当前数字（countdown 阶段 3/2/1）
      classes: classes.map(c => ({
        id: c.id,
        name: c.name || '',
        grade: c.grade || body.grade || '',
        headTeacher: c.headTeacher || '',
        capacity: Number(c.capacity) || 50,
        students: Array.isArray(c.students) ? c.students.map(s => ({ ...s })) : []
      }))
    };
    return sendJson(res, 200, { code: 0, msg: '已更新实时快照' });
  }

  // 分班页广播当前所选年级（大屏开启「跟播」时据此实时同步年级）
  if (pathname === '/api/board/grade' && req.method === 'POST') {
    const body = await readBody(req);
    boardGrade = String(body.grade || '');
    return sendJson(res, 200, { code: 0, msg: '已更新' });
  }

  // 看板聚合数据：持久化班级 + 学生池 + 年级 + 实时快照 + 分班页当前年级，一次拉齐供大屏轮询
  if (pathname === '/api/board' && req.method === 'GET') {
    return sendJson(res, 200, {
      code: 0,
      data: {
        classes: readClasses(),
        students: readStudents(),
        grades: readGrades(),
        live: liveBoard,
        grade: boardGrade
      }
    });
  }

  // ===== 筛选设置 API =====
  if (pathname === '/api/filters' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: readFilters() });
  }
  if (pathname === '/api/filters' && req.method === 'PUT') {
    const body = await readBody(req);
    const filters = readFilters();
    Object.assign(filters, body);
    writeFilters(filters);
    return sendJson(res, 200, { code: 0, data: filters });
  }

  // ===== 静态文件 =====
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, 'public', filePath);
  // 安全检查
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404 Not Found</h1>');
    }
    const ext = path.extname(filePath);
    // 禁止缓存静态文件，保证 JS/CSS 更新后普通刷新即可生效
    res.writeHead(200, { 'Content-Type': getMime(ext), 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`智能分班系统已启动: http://localhost:${PORT}`);
  console.log(`按 Ctrl+C 停止服务`);
});
