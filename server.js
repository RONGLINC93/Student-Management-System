const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'students.json');
const CLASSES_FILE = path.join(__dirname, 'data', 'classes.json');
const GRADES_FILE = path.join(__dirname, 'data', 'grades.json');
const FILTERS_FILE = path.join(__dirname, 'data', 'filters.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SECRET_FILE = path.join(__dirname, 'data', '.auth_secret');
// 学生管理系统扩展数据
const TEACHERS_FILE = path.join(__dirname, 'data', 'teachers.json');       // 教师档案
const EXAMS_FILE = path.join(__dirname, 'data', 'exams.json');             // 考试场次与成绩
const ATTENDANCE_FILE = path.join(__dirname, 'data', 'attendance.json');   // 考勤
const CONDUCT_FILE = path.join(__dirname, 'data', 'conduct.json');         // 操行（奖惩/评语）
const DORMS_FILE = path.join(__dirname, 'data', 'dormitories.json');       // 宿舍房间

// 会话：Cookie 内 HMAC 签名（无服务端 session），Path=/ 以便所有页面共享
const AUTH_COOKIE = 'icbs_auth';
const SESSION_SECONDS = 24 * 3600;      // 默认会话 24 小时
const REMEMBER_SECONDS = 7 * 24 * 3600; // 「记住我」7 天
const ROLES = { ADMIN: 'admin', VIEWER: 'viewer' };
const ROLE_LABEL = { admin: '管理员', viewer: '查看模式' };

// 已注销的会话 token（内存级；保证“退出登录”后旧 Cookie 立即失效）
const revokedTokens = new Set();

// 系统默认设置
const DEFAULT_SETTINGS = {
  schoolName: '学生管理系统', // 页面顶部 / 工作台品牌 / 标题展示的学校（机构）名称
  logoDataUrl: '',           // 校徽图片（data:image 前缀的 base64 小图，≤900KB）
  schoolYear: '',            // 学年标签，如「2026 年秋季」
  slogan: '',                // 校训 / 标语（大屏页脚展示）
  schoolAddress: '',         // 学校地址（大屏页脚展示）
  schoolPhone: '',           // 联系电话（大屏页脚展示）
  schoolWebsite: '',         // 学校官网地址（http/https，各页顶栏「官网」入口 + 大屏页脚）
  balanceGender: 1.5,        // 综合均衡：性别均衡强度（越大越强调男女比例均衡）
  balanceSpecialty: 2,       // 综合均衡：特长均衡强度（越大越强调特长分布均衡）
  subjects: []               // 考试科目配置：[{ key, name, max }]，空时使用 DEFAULT_SUBJECTS
};

// 默认考试科目（语文 / 数学 / 英语 / 理综，兼容旧版系统的分班参考成绩）
const DEFAULT_SUBJECTS = [
  { key: 'chinese', name: '语文', max: 150 },
  { key: 'math', name: '数学', max: 150 },
  { key: 'english', name: '英语', max: 150 },
  { key: 'science', name: '理综', max: 300 }
];

// 学生档案字段清单（基础 + 学籍扩展，新增字段在此登记即可贯穿各 API）
const ARCH_FIELDS = [
  'studentId', 'grade', 'photo', 'name', 'gender', 'specialty',
  'archNo', 'idCard', 'birthday', 'nation', 'nativePlace', 'address',
  'guardian', 'guardianPhone', 'guardianRel', 'enrollDate', 'remark'
];
// 考勤状态字典
const ATT_STATUS = { present: '出勤', late: '迟到', early: '早退', leave: '请假', absent: '旷课' };
// 操行类型字典
const CONDUCT_TYPE = { reward: '奖励', punish: '处分', comment: '评语' };
// 宿舍性别限制
const DORM_GENDER = { any: '不限', male: '男生楼', female: '女生楼' };

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
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
}
['teachers', 'exams', 'attendance', 'conduct', 'dormitories'].forEach(name => {
  const f = { teachers: TEACHERS_FILE, exams: EXAMS_FILE, attendance: ATTENDANCE_FILE, conduct: CONDUCT_FILE, dormitories: DORMS_FILE }[name];
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf-8');
});

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

// ===== 科目配置 =====
// 读取设置中的科目；未配置任何科目时回退默认科目
function readSubjects() {
  const s = readSettings();
  const arr = Array.isArray(s.subjects) && s.subjects.length ? s.subjects : DEFAULT_SUBJECTS;
  return arr.map(sj => ({
    key: String(sj.key || '').replace(/[^a-z0-9_]/gi, '') || 'subj',
    name: String(sj.name || '').trim() || '科目',
    max: Math.min(1000, Math.max(10, Number(sj.max) || 100))
  }));
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return Object.assign({}, DEFAULT_SETTINGS, raw);
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

// ===== 学生档案规范化（新旧数据通用） =====
// 将任意来源的学生对象整理为标准档案结构：
//  - 成绩统一存入 scores = { [subjectKey]: number }
//  - 旧字段 chinese/math/english/science 自动迁移进 scores
//  - 学籍扩展字段缺省时补空
function normalizeStudent(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const out = { id: o.id || genId() };
  ARCH_FIELDS.forEach(f => { out[f] = f === 'grade' ? String(o[f] || '') : (o[f] !== undefined ? o[f] : ''); });
  out.name = String(out.name || '');
  out.gender = out.gender === '女' ? '女' : '男';
  out.studentId = String(out.studentId || '').trim();
  out.photo = String(out.photo || '');
  // 旧固定成绩字段迁移
  if (o.scores === undefined || o.scores === null) {
    const legacy = ['chinese', 'math', 'english', 'science'];
    if (legacy.some(k => o[k] !== undefined)) {
      out.scores = {};
      legacy.forEach(k => { if (o[k] !== undefined) out.scores[k] = Math.max(0, Number(o[k]) || 0); });
    } else {
      out.scores = {};
    }
  } else {
    out.scores = {};
    const obj = (typeof o.scores === 'object' && o.scores) ? o.scores : {};
    Object.keys(obj).forEach(k => { out.scores[k] = Math.max(0, Math.min(1000, Number(obj[k]) || 0)); });
  }
  return out;
}

// 依据前端提交创建/更新档案字段
function pickArch(body) {
  const raw = {};
  ARCH_FIELDS.forEach(f => {
    if (body[f] !== undefined) raw[f] = body[f];
  });
  return raw;
}
// 新建学生：字段白名单 + 分数解析 + 默认年级
function buildStudent(body) {
  const defGrade = (readGrades()[0]) || '';
  const raw = { id: genId(), grade: body.grade !== undefined ? body.grade : defGrade };
  Object.assign(raw, pickArch(body));
  const stu = normalizeStudent(raw);
  const scores = bodyScores(body);
  if (scores) stu.scores = scores;
  return stu;
}

// 前端提交时解析成绩：支持 scores 对象，也兼容旧扁平字段
function bodyScores(body) {
  if (body.scores && typeof body.scores === 'object') {
    const obj = {};
    Object.keys(body.scores).forEach(k => { obj[k] = Math.max(0, Math.min(1000, Number(body.scores[k]) || 0)); });
    return obj;
  }
  if (body.chinese !== undefined || body.math !== undefined || body.english !== undefined || body.science !== undefined) {
    return {
      chinese: Math.max(0, Number(body.chinese) || 0),
      math: Math.max(0, Number(body.math) || 0),
      english: Math.max(0, Number(body.english) || 0),
      science: Math.max(0, Number(body.science) || 0)
    };
  }
  return null; // 未提交成绩：不修改
}

// 读取数据时统一规范化（惰性迁移：任何一次写回即持久化新结构）
function readStudents() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return Array.isArray(list) ? list.map(s => normalizeStudent(s)) : [];
  } catch (e) {
    return [];
  }
}

function readClasses() {
  try {
    const list = JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf-8'));
    if (!Array.isArray(list)) return [];
    return list.map(c => Object.assign({}, c, {
      students: Array.isArray(c.students) ? c.students.map(s => normalizeStudent(s)) : []
    }));
  } catch (e) {
    return [];
  }
}

// ===== 教师 / 考试 / 考勤 / 操行 / 宿舍数据读写 =====
function readJsonFile(file, def) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(v) ? v : def;
  } catch (e) { return def; }
}
function writeJsonFile(file, list) {
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf-8');
}
const readTeachers = () => readJsonFile(TEACHERS_FILE, []);
const writeTeachers = l => writeJsonFile(TEACHERS_FILE, l);
const readExams = () => readJsonFile(EXAMS_FILE, []);
const writeExams = l => writeJsonFile(EXAMS_FILE, l);
const readAttendance = () => readJsonFile(ATTENDANCE_FILE, []);
const writeAttendance = l => writeJsonFile(ATTENDANCE_FILE, l);
const readConduct = () => readJsonFile(CONDUCT_FILE, []);
const writeConduct = l => writeJsonFile(CONDUCT_FILE, l);
const readDorms = () => readJsonFile(DORMS_FILE, []);
const writeDorms = l => writeJsonFile(DORMS_FILE, l);

// 教师档案规范化
function normalizeTeacher(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  return {
    id: o.id || genId(),
    teacherNo: String(o.teacherNo || '').trim(),
    name: String(o.name || '').trim(),
    gender: o.gender === '女' ? '女' : '男',
    subject: String(o.subject || '').trim(),   // 任教学科名
    title: String(o.title || '').trim(),       // 职称/职务
    phone: String(o.phone || '').trim(),
    joinYear: String(o.joinYear || '').trim(),
    classId: o.classId || '',                  // 班主任所在班级 id
    remark: String(o.remark || '').trim()
  };
}
// 全部学生（学生池 + 各班名单），供跨模块引用
function allStudentsFlat() {
  const pool = readStudents();
  const allocated = [];
  readClasses().forEach(c => {
    (c.students || []).forEach(s => allocated.push(Object.assign({}, s, { classId: c.id, className: c.name, grade: c.grade || s.grade || '' })));
  });
  return { pool, allocated, all: [...pool, ...allocated] };
}
// 从全部学生中按 id 找学生
function findStudentById(id) {
  const { all } = allStudentsFlat();
  return all.find(s => s.id === id) || null;
}
// 把学生从全部宿舍房间中移除（退宿）
function removeFromDorms(studentId) {
  const dorms = readDorms();
  let changed = false;
  dorms.forEach(r => {
    const before = r.students ? r.students.length : 0;
    r.students = (r.students || []).filter(id => String(id) !== String(studentId));
    if ((r.students || []).length !== before) changed = true;
  });
  if (changed) writeDorms(dorms);
}

function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// ===== 登录认证：账号 / 口令 / 会话 =====
function readUsers() {
  try {
    const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function writeUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}
function findUser(name) {
  const list = readUsers();
  for (let i = 0; i < list.length; i++) if (list[i].u === name) return list[i];
  return null;
}

// scrypt 加盐口令哈希（同步即可，登录频率很低）
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function verifyPassword(password, salt, hash) {
  try {
    const calc = hashPassword(password, salt);
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(String(hash), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

// base64url 工具（兼容较老 Node，不依赖 Buffer#toString('base64url')）
function b64url(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function readSecret() {
  try {
    return fs.readFileSync(SECRET_FILE, 'utf-8').trim();
  } catch (e) { return 'icbs-demo-secret'; }
}
function sign(payload) {
  return crypto.createHmac('sha256', readSecret()).update(payload).digest('hex');
}
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
function makeToken(username, role, ttlSeconds) {
  const payload = b64url(JSON.stringify({ u: username, r: role, exp: Date.now() + ttlSeconds * 1000 }));
  return payload + '.' + sign(payload);
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}
// 校验 Cookie 会话；有效返回 { username, role }，否则 null
function authUser(req) {
  try {
    const c = parseCookies(req)[AUTH_COOKIE];
    if (!c || revokedTokens.has(c)) return null;
    const dot = c.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = c.slice(0, dot);
    const sig = c.slice(dot + 1);
    if (!safeEq(sig, sign(payload))) return null;
    const data = JSON.parse(unb64url(payload));
    if (!data.u || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    const user = findUser(data.u);
    if (!user || user.role !== data.r) return null; // 账号被删除 / 角色变更后旧会话自动失效
    return { username: user.u, role: user.role };
  } catch (e) { return null; }
}
function cookieHeader(token, maxAge) {
  return AUTH_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}
function clearCookieHeader() {
  return AUTH_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
function redirect(res, loc) {
  res.writeHead(302, { Location: loc });
  res.end();
}
function forbiddenPage(msg) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>403 · 无权限</title></head>' +
    '<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#eef1f8;color:#1f2937">' +
    '<div style="text-align:center;background:#fff;border-radius:16px;padding:40px 48px;box-shadow:0 10px 30px rgba(30,41,82,.08)">' +
    '<div style="font-size:52px;font-weight:800;background:linear-gradient(135deg,#4f6df5,#7b5cf5);-webkit-background-clip:text;background-clip:text;color:transparent">403</div>' +
    '<p style="margin:10px 0 24px;font-size:14px;color:#6b7280">' + String(msg || '您没有权限访问该页面。').replace(/</g, '&lt;') + '</p>' +
    '<a href="/login.html" style="color:#4f6df5;font-size:14px;margin-right:16px">返回登录</a>' +
    '<a href="/result.html" style="color:#4f6df5;font-size:14px">前往分班结果大屏</a>' +
    '</div></body></html>';
}

// 确保账号与签名密钥文件存在；仅当没有任何账号时创建默认管理员
function ensureAuthFiles() {
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), 'utf-8');
  }
  if (!fs.existsSync(USERS_FILE) || readUsers().length === 0) {
    const salt = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    writeUsers([{
      u: 'admin',
      salt,
      hash: hashPassword('admin123', salt),
      role: ROLES.ADMIN,
      nickname: '管理员',
      createdAt: now,
      updatedAt: now
    }]);
    console.log('[提示] 已创建默认管理员账号 admin / admin123，请登录后在「系统设置 → 账号与安全」中尽快修改密码。');
  }
}
ensureAuthFiles();

// 校验用户名 / 口令规范
function validUsername(name) {
  return /^[\w\u4e00-\u9fa5-]{2,20}$/.test(name);
}
function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 64;
}

// 过滤非法/越界的设置值
function sanitizeSettings(body) {
  const s = readSettings();
  const clip = (v, max) => String(v).trim().slice(0, max);
  if (typeof body.schoolName === 'string') {
    s.schoolName = clip(body.schoolName, 40) || DEFAULT_SETTINGS.schoolName;
  }
  if (typeof body.schoolYear === 'string') s.schoolYear = clip(body.schoolYear, 60);
  if (typeof body.slogan === 'string') s.slogan = clip(body.slogan, 200);
  if (typeof body.schoolAddress === 'string') s.schoolAddress = clip(body.schoolAddress, 200);
  if (typeof body.schoolPhone === 'string') s.schoolPhone = clip(body.schoolPhone, 40);
  if (typeof body.schoolWebsite === 'string') {
    const v = String(body.schoolWebsite).trim().slice(0, 200);
    if (!v) {
      s.schoolWebsite = ''; // 清空 = 隐藏官网入口
    } else if (/^(javascript|vbscript|data):/i.test(v)) {
      // 危险 scheme：忽略本次提交，保留原有设置
    } else if (/^https?:\/\//i.test(v)) {
      s.schoolWebsite = v;
    } else {
      s.schoolWebsite = 'https://' + v; // 自动补全协议
    }
  }
  if (typeof body.logoDataUrl === 'string') {
    const v = String(body.logoDataUrl);
    // 仅接受 data:image 开头的图片数据；空字符串 = 移除校徽；其余非法值保持原样
    if (v === '' || (v.indexOf('data:image/') === 0 && v.length <= 900000)) {
      s.logoDataUrl = v;
    }
  }
  if (body.balanceGender !== undefined) {
    s.balanceGender = Math.min(5, Math.max(0, Number(body.balanceGender) || 0));
  }
  if (body.balanceSpecialty !== undefined) {
    s.balanceSpecialty = Math.min(5, Math.max(0, Number(body.balanceSpecialty) || 0));
  }
  if (Array.isArray(body.subjects)) {
    if (!body.subjects.length) {
      s.subjects = null; // 标记：提交了空科目数组（路由层据此返回校验错误）
    } else {
      const seen = new Set();
      const arr = [];
      body.subjects.forEach(sj => {
        const rawKey = String((sj && sj.key) || '').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '').slice(0, 12);
        const key = rawKey || 'subject';
        if (seen.has(key)) return;
        seen.add(key);
        arr.push({
          key,
          name: String((sj && sj.name) || '').trim().slice(0, 12) || '科目',
          max: Math.min(1000, Math.max(10, Number((sj && sj.max)) || 100))
        });
      });
      if (arr.length) s.subjects = arr;
    }
  }
  return s;
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

  // ===== 访问控制（登录与会话）=====
  // 公开只读接口：大屏轮询与各页品牌配置（含未登录访问）
  const publicRead = req.method === 'GET'
    && (pathname === '/api/settings' || pathname === '/api/board');
  const isAuthEndpoint = pathname === '/api/login' || pathname === '/api/logout'
    || pathname === '/api/auth/me' || pathname === '/api/auth/password'
    || pathname === '/api/users' || pathname.startsWith('/api/users/');
  if (pathname.startsWith('/api/') && !isAuthEndpoint && !publicRead) {
    const u = authUser(req);
    if (!u) return sendJson(res, 401, { code: 1, msg: '登录已失效，请重新登录' });
    if (pathname === '/api/backup' && u.role !== ROLES.ADMIN) {
      return sendJson(res, 403, { code: 1, msg: '数据备份导出仅限管理员账号' });
    }
    if (req.method !== 'GET' && u.role !== ROLES.ADMIN) {
      return sendJson(res, 403, { code: 1, msg: '当前账号为「查看模式」，仅可查看，不能修改数据' });
    }
  }

  // ===== 登录认证 API =====
  // 账号密码登录（remember=true 时会话延长至 7 天）
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const user = findUser(username);
    if (!user || !verifyPassword(body.password, user.salt, user.hash)) {
      return sendJson(res, 401, { code: 1, msg: '账号或密码不正确' });
    }
    const ttl = body.remember ? REMEMBER_SECONDS : SESSION_SECONDS;
    const token = makeToken(user.u, user.role, ttl);
    res.setHeader('Set-Cookie', cookieHeader(token, ttl));
    return sendJson(res, 200, {
      code: 0, msg: '登录成功',
      data: { username: user.u, role: user.role, nickname: user.nickname || '', label: ROLE_LABEL[user.role] }
    });
  }

  // 退出登录（GET 供链接直达，POST 供前端调用）
  if (pathname === '/api/logout') {
    const t = parseCookies(req)[AUTH_COOKIE];
    if (t) revokedTokens.add(t); // 立即作废旧会话
    res.setHeader('Set-Cookie', clearCookieHeader());
    if (req.method === 'GET') return redirect(res, '/login.html');
    return sendJson(res, 200, { code: 0, msg: '已退出登录' });
  }

  // 当前登录用户（供页面顶栏展示 / 前端判断角色）
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const u = authUser(req);
    if (!u) return sendJson(res, 401, { code: 1, msg: '未登录' });
    const full = findUser(u.username);
    return sendJson(res, 200, {
      code: 0,
      data: {
        username: u.username,
        role: u.role,
        nickname: (full && full.nickname) || '',
        label: ROLE_LABEL[u.role]
      }
    });
  }

  // 修改自己的密码（管理员 / 查看账号均可）
  if (pathname === '/api/auth/password' && req.method === 'PUT') {
    const u = authUser(req);
    if (!u) return sendJson(res, 401, { code: 1, msg: '登录已失效，请重新登录' });
    const body = await readBody(req);
    const user = findUser(u.username);
    if (!user) return sendJson(res, 401, { code: 1, msg: '账号不存在，请重新登录' });
    if (!verifyPassword(body.oldPassword, user.salt, user.hash)) {
      return sendJson(res, 400, { code: 1, msg: '当前密码不正确' });
    }
    if (!validPassword(body.newPassword)) {
      return sendJson(res, 400, { code: 1, msg: '新密码需为 6～64 位字符' });
    }
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = hashPassword(body.newPassword, user.salt);
    user.updatedAt = new Date().toISOString();
    writeUsers(readUsers().map(x => (x.u === user.u ? user : x)));
    // 让旧会话仍有效（密码已改），无需强制重新登录
    return sendJson(res, 200, { code: 0, msg: '密码已更新' });
  }

  // ===== 账号管理 API（仅管理员）=====
  if (pathname === '/api/users' && req.method === 'GET') {
    const me = authUser(req);
    if (!me) return sendJson(res, 401, { code: 1, msg: '登录已失效，请重新登录' });
    if (me.role !== ROLES.ADMIN) return sendJson(res, 403, { code: 1, msg: '账号管理仅限管理员' });
    return sendJson(res, 200, {
      code: 0,
      data: readUsers().map(x => ({
        username: x.u, role: x.role, nickname: x.nickname || '',
        createdAt: x.createdAt, updatedAt: x.updatedAt
      }))
    });
  }

  if (pathname === '/api/users' && req.method === 'POST') {
    const me = authUser(req);
    if (!me) return sendJson(res, 401, { code: 1, msg: '登录已失效，请重新登录' });
    if (me.role !== ROLES.ADMIN) return sendJson(res, 403, { code: 1, msg: '账号管理仅限管理员' });
    const body = await readBody(req);
    const name = String(body.username || '').trim();
    if (!validUsername(name)) return sendJson(res, 400, { code: 1, msg: '账号需为 2～20 位中英文、数字、下划线或短横线' });
    if (findUser(name)) return sendJson(res, 400, { code: 1, msg: '该账号已存在' });
    if (!validPassword(body.password)) return sendJson(res, 400, { code: 1, msg: '初始密码需为 6～64 位字符' });
    const role = body.role === ROLES.VIEWER ? ROLES.VIEWER : ROLES.ADMIN;
    const salt = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const list = readUsers();
    list.push({
      u: name, salt,
      hash: hashPassword(body.password, salt),
      role,
      nickname: String(body.nickname || '').trim().slice(0, 20),
      createdAt: now, updatedAt: now
    });
    writeUsers(list);
    return sendJson(res, 200, { code: 0, msg: '账号已创建', data: name });
  }

  if (pathname.startsWith('/api/users/') && (req.method === 'PUT' || req.method === 'DELETE')) {
    const me = authUser(req);
    if (!me) return sendJson(res, 401, { code: 1, msg: '登录已失效，请重新登录' });
    if (me.role !== ROLES.ADMIN) return sendJson(res, 403, { code: 1, msg: '账号管理仅限管理员' });
    const target = decodeURIComponent(pathname.split('/').pop());
    const list = readUsers();
    const idx = list.findIndex(x => x.u === target);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '账号不存在' });

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const cur = list[idx];
      const isLastAdmin = cur.role === ROLES.ADMIN && !list.some(x => x !== cur && x.role === ROLES.ADMIN);
      if (body.role === ROLES.VIEWER && cur.role === ROLES.ADMIN && isLastAdmin) {
        return sendJson(res, 400, { code: 1, msg: '系统需至少保留一个管理员账号' });
      }
      if (body.role === ROLES.VIEWER || body.role === ROLES.ADMIN) cur.role = body.role;
      if (typeof body.nickname === 'string') cur.nickname = body.nickname.trim().slice(0, 20);
      if (body.password) {
        if (!validPassword(body.password)) return sendJson(res, 400, { code: 1, msg: '密码需为 6～64 位字符' });
        cur.salt = crypto.randomBytes(16).toString('hex');
        cur.hash = hashPassword(body.password, cur.salt);
      }
      cur.updatedAt = new Date().toISOString();
      writeUsers(list);
      return sendJson(res, 200, { code: 0, msg: '账号已更新' });
    }

    // DELETE：禁止删除自己与系统内最后一个管理员
    if (target === me.username) {
      return sendJson(res, 400, { code: 1, msg: '不能删除当前登录的账号' });
    }
    const isLastAdmin = list[idx].role === ROLES.ADMIN && !list.some(x => x !== list[idx] && x.role === ROLES.ADMIN);
    if (isLastAdmin) {
      return sendJson(res, 400, { code: 1, msg: '系统需至少保留一个管理员账号' });
    }
    list.splice(idx, 1);
    writeUsers(list);
    return sendJson(res, 200, { code: 0, msg: '账号已删除' });
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
        allocated.push({ ...s, allocated: true, className: c.name, classId: c.id });
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
    const stu = buildStudent(body);
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
    // 档案字段更新（白名单）
    Object.assign(list[idx], pickArch(body));
    list[idx].studentId = String(list[idx].studentId || '').trim();
    if (body.name !== undefined) list[idx].name = String(body.name || '').trim();
    if (body.gender !== undefined) list[idx].gender = body.gender === '女' ? '女' : '男';
    if (body.grade !== undefined) list[idx].grade = String(body.grade || '');
    const scores = bodyScores(body);
    if (scores) list[idx].scores = scores;
    writeStudents(list);
    return sendJson(res, 200, { code: 0, data: list[idx] });
  }

  // 删除学生（含退宿联动）
  if (pathname.startsWith('/api/students/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const list = readStudents();
    const next = list.filter(s => s.id !== id);
    writeStudents(next);
    removeFromDorms(id);
    return sendJson(res, 200, { code: 0, msg: '已删除' });
  }

  // 批量导入
  if (pathname === '/api/students/batch' && req.method === 'POST') {
    const body = await readBody(req);
    const list = readStudents();
    const arr = Array.isArray(body) ? body : (body.list || []);
    let count = 0;
    arr.forEach(s => {
      const stu = buildStudent(s);
      if (!stu.name) return;
      list.push(stu);
      count++;
    });
    writeStudents(list);
    return sendJson(res, 200, { code: 0, msg: '已导入', count });
  }

  // 清空所有学生：学生池与各班花名册一并清空（班级本身保留，避免「清空学生」后名单里还残留已分班学生）
  if (pathname === '/api/students' && req.method === 'DELETE') {
    writeStudents([]);
    const classes = readClasses();
    classes.forEach(c => { c.students = []; });
    writeClasses(classes);
    // 联动清理：退宿 + 操行记录
    writeDorms(readDorms().map(r => Object.assign({}, r, { students: [] })));
    writeConduct([]);
    return sendJson(res, 200, { code: 0, msg: '已清空' });
  }

  // ===== 班级管理 API =====
  // 获取所有班级（含学生名单）
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

  // 更新班级内某位已分班学生（直接编辑名单里的学生，无需先退回池）
  if (pathname.startsWith('/api/classes/') && pathname.includes('/students/') && req.method === 'PUT') {
    const parts = pathname.split('/');
    const classId = parts[3];
    const stuId = parts[5];
    const body = await readBody(req);
    const classes = readClasses();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '班级不存在' });
    const idx = (cls.students || []).findIndex(s => s.id === stuId);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '学生不在该班级' });
    // 学号全局查重（学生池 + 全部班级名单，排除自身）
    const newStuId = body.studentId !== undefined ? String(body.studentId).trim() : cls.students[idx].studentId;
    const pool = readStudents();
    const allStu = [
      ...pool,
      ...classes.flatMap(c => c.students || [])
    ].filter(s => s.id !== stuId);
    if (allStu.some(s => s.studentId && String(s.studentId) === newStuId)) {
      return sendJson(res, 400, { code: 1, msg: '学号已存在' });
    }
    Object.assign(cls.students[idx], pickArch(body));
    if (body.name !== undefined) cls.students[idx].name = String(body.name || '').trim();
    if (body.gender !== undefined) cls.students[idx].gender = body.gender === '女' ? '女' : '男';
    cls.students[idx].studentId = String(cls.students[idx].studentId || '').trim();
    const scores = bodyScores(body);
    if (scores) cls.students[idx].scores = scores;
    writeClasses(classes);
    return sendJson(res, 200, { code: 0, data: cls.students[idx] });
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

  // 整班学生全部退回学生池（班级保留）
  if (pathname.startsWith('/api/classes/') && pathname.endsWith('/return-all') && req.method === 'POST') {
    const classId = pathname.split('/')[3];
    const classes = readClasses();
    const students = readStudents();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '班级不存在' });
    const stus = cls.students || [];
    if (stus.length) students.push(...stus);
    cls.students = [];
    writeClasses(classes);
    writeStudents(students);
    return sendJson(res, 200, { code: 0, msg: '已全部退回学生池' });
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
    // 更新学生 / 班级 / 考试 / 考勤中的年级字段
    const students = readStudents();
    students.forEach(s => { if (s.grade === oldName) s.grade = newName; });
    writeStudents(students);
    const classes = readClasses();
    classes.forEach(c => { if (c.grade === oldName) c.grade = newName; });
    writeClasses(classes);
    writeExams(readExams().map(x => Object.assign({}, x, { grade: x.grade === oldName ? newName : x.grade })));
    writeAttendance(readAttendance().map(x => Object.assign({}, x, { grade: x.grade === oldName ? newName : x.grade })));
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
    // 清空该年级的学生 / 班级 / 考试 / 考勤的年级字段
    const students = readStudents();
    students.forEach(s => { if (s.grade === name) s.grade = ''; });
    writeStudents(students);
    const classes = readClasses();
    classes.forEach(c => { if (c.grade === name) c.grade = ''; });
    writeClasses(classes);
    writeExams(readExams().map(x => Object.assign({}, x, { grade: x.grade === name ? '' : x.grade })));
    writeAttendance(readAttendance().map(x => Object.assign({}, x, { grade: x.grade === name ? '' : x.grade })));
    return sendJson(res, 200, { code: 0, msg: '已删除' });
  }

  // ===== 教师管理 API =====
  if (pathname === '/api/teachers' && req.method === 'GET') {
    const classes = readClasses();
    const list = readTeachers().map(t => {
      const cls = t.classId ? classes.find(c => c.id === t.classId) : null;
      return Object.assign({}, normalizeTeacher(t), {
        className: cls ? cls.name : '',
        classGrade: cls ? (cls.grade || '') : ''
      });
    });
    return sendJson(res, 200, { code: 0, data: list });
  }

  if (pathname === '/api/teachers' && req.method === 'POST') {
    const body = await readBody(req);
    const t = normalizeTeacher(body);
    if (!t.name) return sendJson(res, 400, { code: 1, msg: '教师姓名不能为空' });
    const list = readTeachers();
    if (t.teacherNo && list.some(x => x.teacherNo === t.teacherNo)) {
      return sendJson(res, 400, { code: 1, msg: '工号已存在' });
    }
    list.push(t);
    writeTeachers(list);
    return sendJson(res, 200, { code: 0, data: t });
  }

  if (pathname.startsWith('/api/teachers/') && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = pathname.split('/').pop();
    const list = readTeachers();
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '教师不存在' });

    if (req.method === 'DELETE') {
      const t = list[idx];
      // 若该教师是某班班主任则同步清空班级班主任
      const classes = readClasses();
      const cls = classes.find(c => c.id === t.classId || c.headTeacher === t.name);
      if (cls && cls.headTeacher === t.name) {
        cls.headTeacher = '';
        writeClasses(classes);
      }
      list.splice(idx, 1);
      writeTeachers(list);
      return sendJson(res, 200, { code: 0, msg: '已删除' });
    }

    const body = await readBody(req);
    if (body.teacherNo && body.teacherNo !== list[idx].teacherNo && list.some(x => x.teacherNo === body.teacherNo)) {
      return sendJson(res, 400, { code: 1, msg: '工号已存在' });
    }
    list[idx] = normalizeTeacher(Object.assign({}, list[idx], body));
    if (!list[idx].name) return sendJson(res, 400, { code: 1, msg: '教师姓名不能为空' });
    writeTeachers(list);
    return sendJson(res, 200, { code: 0, data: list[idx] });
  }

  // 设置 / 取消班主任：classId 传班级 id 或空字符串
  if (pathname.startsWith('/api/teachers/') && pathname.endsWith('/head') && req.method === 'POST') {
    const id = pathname.split('/')[3];
    const body = await readBody(req);
    const list = readTeachers();
    const t = list.find(x => x.id === id);
    if (!t) return sendJson(res, 404, { code: 1, msg: '教师不存在' });
    const classes = readClasses();
    const newClassId = String(body.classId || '');
    const oldCls = classes.find(c => c.id === t.classId);
    // 清空旧班主任关系
    if (oldCls && oldCls.headTeacher === t.name) {
      oldCls.headTeacher = '';
    }
    let target = null;
    if (newClassId) {
      target = classes.find(c => c.id === newClassId);
      if (!target) return sendJson(res, 404, { code: 1, msg: '班级不存在' });
      // 该班原有班主任若有对应教师记录，同步解除
      const pre = readTeachers().find(x => x.id !== id && x.classId === newClassId);
      if (pre) pre.classId = '';
      target.headTeacher = t.name;
    }
    writeClasses(classes);
    t.classId = newClassId;
    writeTeachers(list);
    return sendJson(res, 200, {
      code: 0, msg: target ? `已将「${t.name}」设为「${target.name}」班主任` : '已取消班主任',
      data: Object.assign({}, t, { className: target ? target.name : '' })
    });
  }

  // ===== 考试与成绩管理 API =====
  // 列表（不含完整成绩明细，附带参与人数）
  if (pathname === '/api/exams' && req.method === 'GET') {
    const list = readExams().map(x => Object.assign({}, x, {
      stuCount: x.records ? Object.keys(x.records).length : 0
    }));
    return sendJson(res, 200, { code: 0, data: list });
  }

  if (pathname === '/api/exams' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendJson(res, 400, { code: 1, msg: '考试名称不能为空' });
    const x = {
      id: genId(),
      name,
      type: String(body.type || '考试').trim().slice(0, 12),
      grade: String(body.grade || ''),
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      remark: String(body.remark || '').trim().slice(0, 200),
      createdAt: new Date().toISOString(),
      records: {}
    };
    const list = readExams();
    list.unshift(x);
    writeExams(list);
    return sendJson(res, 200, { code: 0, data: x });
  }

  if (pathname.startsWith('/api/exams/') && req.method === 'GET') {
    const id = pathname.split('/').pop();
    const x = readExams().find(e => e.id === id);
    if (!x) return sendJson(res, 404, { code: 1, msg: '考试不存在' });
    return sendJson(res, 200, { code: 0, data: x });
  }

  if (pathname.startsWith('/api/exams/') && pathname.endsWith('/records') && req.method === 'PUT') {
    const id = pathname.split('/')[3];
    const body = await readBody(req);
    const list = readExams();
    const x = list.find(e => e.id === id);
    if (!x) return sendJson(res, 404, { code: 1, msg: '考试不存在' });
    x.records = x.records || {};
    const arr = Array.isArray(body.list) ? body.list : [];
    let count = 0;
    arr.forEach(r => {
      if (!r || !r.id) return;
      const values = {};
      Object.keys(r.values || {}).forEach(k => {
        const n = Number(r.values[k]);
        values[k] = (r.values[k] === '' || r.values[k] === null || r.values[k] === undefined) ? null : Math.max(0, Math.min(1000, n || 0));
      });
      x.records[String(r.id)] = values;
      count++;
    });
    writeExams(list);
    return sendJson(res, 200, { code: 0, msg: '成绩已保存', count });
  }

  // 某次考试批量录入（records 完整覆盖该次考试）：body { list:[{ id, name, values }] }
  if (pathname.startsWith('/api/exams/') && pathname.endsWith('/records/set') && req.method === 'PUT') {
    const id = pathname.split('/')[3];
    const body = await readBody(req);
    const list = readExams();
    const x = list.find(e => e.id === id);
    if (!x) return sendJson(res, 404, { code: 1, msg: '考试不存在' });
    const out = {};
    const arr = Array.isArray(body.list) ? body.list : [];
    arr.forEach(r => {
      if (!r || !r.id) return;
      const values = {};
      Object.keys(r.values || {}).forEach(k => {
        const v = r.values[k];
        values[k] = (v === '' || v === null || v === undefined) ? null : Math.max(0, Math.min(1000, Number(v) || 0));
      });
      out[String(r.id)] = values;
    });
    x.records = out;
    writeExams(list);
    return sendJson(res, 200, { code: 0, msg: '成绩已保存', count: arr.length });
  }

  // 将某次考试的成绩同步为学生「当前档案成绩」（参与分班参考）
  if (pathname.startsWith('/api/exams/') && pathname.endsWith('/archive') && req.method === 'POST') {
    const id = pathname.split('/')[3];
    const body = await readBody(req);
    const list = readExams();
    const x = list.find(e => e.id === id);
    if (!x) return sendJson(res, 404, { code: 1, msg: '考试不存在' });
    const want = body.studentIds && Array.isArray(body.studentIds) ? new Set(body.studentIds.map(String)) : null;
    let updated = 0;
    const apply = (s) => {
      if (want && !want.has(String(s.id))) return;
      const rec = x.records && x.records[String(s.id)];
      if (!rec) return;
      s.scores = s.scores || {};
      Object.keys(rec).forEach(k => { s.scores[k] = Math.max(0, Number(rec[k]) || 0); });
      updated++;
    };
    const pool = readStudents();
    pool.forEach(apply);
    writeStudents(pool);
    const classes = readClasses();
    classes.forEach(c => (c.students || []).forEach(apply));
    writeClasses(classes);
    return sendJson(res, 200, { code: 0, msg: `已将 ${updated} 名学生的档案成绩更新为该场考试成绩` });
  }

  if (pathname.startsWith('/api/exams/') && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = pathname.split('/').pop();
    const list = readExams();
    const idx = list.findIndex(e => e.id === id);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '考试不存在' });
    if (req.method === 'DELETE') {
      list.splice(idx, 1);
      writeExams(list);
      return sendJson(res, 200, { code: 0, msg: '已删除' });
    }
    const body = await readBody(req);
    if (body.name !== undefined) list[idx].name = String(body.name || '').trim().slice(0, 40) || list[idx].name;
    if (body.type !== undefined) list[idx].type = String(body.type || '').trim().slice(0, 12);
    if (body.grade !== undefined) list[idx].grade = String(body.grade || '');
    if (body.date !== undefined) list[idx].date = String(body.date || '').slice(0, 10);
    if (body.remark !== undefined) list[idx].remark = String(body.remark || '').trim().slice(0, 200);
    writeExams(list);
    return sendJson(res, 200, { code: 0, data: list[idx], msg: '已更新' });
  }

  // ===== 考勤 API =====
  // 查询：?date=YYYY-MM-DD&classId=&grade=&from=&to=  单条记录带 records
  if (pathname === '/api/attendance' && req.method === 'GET') {
    const u = url;
    const date = u.searchParams.get('date') || '';
    const classId = u.searchParams.get('classId') || '';
    const grade = u.searchParams.get('grade') || '';
    const from = u.searchParams.get('from') || '';
    const to = u.searchParams.get('to') || '';
    let list = readAttendance().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (date) list = list.filter(x => x.date === date);
    if (classId) list = list.filter(x => x.classId === classId);
    if (grade) list = list.filter(x => x.grade === grade);
    if (from) list = list.filter(x => x.date >= from);
    if (to) list = list.filter(x => x.date <= to);
    return sendJson(res, 200, { code: 0, data: list });
  }

  // 新增 / 更新某日某班的考勤：body { date, grade, classId, className, records:[{id,status}] }
  if (pathname === '/api/attendance' && req.method === 'POST') {
    const body = await readBody(req);
    const date = String(body.date || '').trim();
    const classId = String(body.classId || '').trim();
    if (!date || !classId) return sendJson(res, 400, { code: 1, msg: '日期与班级不能为空' });
    const list = readAttendance();
    const cls = readClasses().find(c => c.id === classId);
    const idx = list.findIndex(x => x.date === date && x.classId === classId);
    const arr = Array.isArray(body.records) ? body.records : [];
    const records = arr
      .filter(r => r && r.id)
      .map(r => ({
        id: String(r.id),
        name: String(r.name || ''),
        status: ATT_STATUS[r.status] !== undefined ? r.status : 'present'
      }));
    const doc = {
      id: (list[idx] && list[idx].id) || genId(),
      date,
      grade: String(body.grade || (cls ? cls.grade : '')),
      classId,
      className: String(body.className || (cls ? cls.name : '')),
      records,
      updatedAt: new Date().toISOString()
    };
    if (idx === -1) list.unshift(doc);
    else list[idx] = doc;
    writeAttendance(list);
    return sendJson(res, 200, { code: 0, data: doc, msg: '考勤已保存' });
  }

  if (pathname.startsWith('/api/attendance/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    writeAttendance(readAttendance().filter(x => x.id !== id));
    return sendJson(res, 200, { code: 0, msg: '已删除' });
  }

  // ===== 操行（奖惩 / 评语）API =====
  if (pathname === '/api/conduct' && req.method === 'GET') {
    const u = url;
    const studentId = u.searchParams.get('studentId') || '';
    const type = u.searchParams.get('type') || '';
    const kw = (u.searchParams.get('kw') || '').toLowerCase();
    let list = readConduct().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (studentId) list = list.filter(x => x.studentId === studentId);
    if (type) list = list.filter(x => x.type === type);
    if (kw) list = list.filter(x =>
      (x.name || '').toLowerCase().includes(kw) ||
      (x.title || '').toLowerCase().includes(kw) ||
      (x.detail || '').toLowerCase().includes(kw) ||
      (x.className || '').toLowerCase().includes(kw));
    return sendJson(res, 200, { code: 0, data: list });
  }

  if (pathname === '/api/conduct' && req.method === 'POST') {
    const body = await readBody(req);
    const studentId = String(body.studentId || '');
    if (!studentId) return sendJson(res, 400, { code: 1, msg: '请选择学生' });
    const title = String(body.title || '').trim();
    if (!title) return sendJson(res, 400, { code: 1, msg: '请填写标题' });
    const stu = findStudentById(studentId);
    const item = {
      id: genId(),
      studentId,
      name: stu ? stu.name : String(body.name || ''),
      grade: stu ? stu.grade : String(body.grade || ''),
      className: stu && stu.className ? stu.className : '',
      type: CONDUCT_TYPE[body.type] ? body.type : 'comment',
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      title,
      detail: String(body.detail || '').trim(),
      createdAt: new Date().toISOString()
    };
    const list = readConduct();
    list.unshift(item);
    writeConduct(list);
    return sendJson(res, 200, { code: 0, data: item });
  }

  if (pathname.startsWith('/api/conduct/') && (req.method === 'PUT' || req.method === 'DELETE')) {
    const id = pathname.split('/').pop();
    const list = readConduct();
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '记录不存在' });
    if (req.method === 'DELETE') {
      list.splice(idx, 1);
      writeConduct(list);
      return sendJson(res, 200, { code: 0, msg: '已删除' });
    }
    const body = await readBody(req);
    if (body.title !== undefined) list[idx].title = String(body.title || '').trim();
    if (body.type !== undefined && CONDUCT_TYPE[body.type]) list[idx].type = body.type;
    if (body.date !== undefined) list[idx].date = String(body.date || '').slice(0, 10);
    if (body.detail !== undefined) list[idx].detail = String(body.detail || '').trim();
    writeConduct(list);
    return sendJson(res, 200, { code: 0, data: list[idx], msg: '已更新' });
  }

  // ===== 宿舍管理 API =====
  if (pathname === '/api/dorms' && req.method === 'GET') {
    const list = readDorms().sort((a, b) =>
      String(a.building).localeCompare(String(b.building), 'zh-Hans-CN', { numeric: true }) ||
      String(a.roomNo).localeCompare(String(b.roomNo), 'zh-Hans-CN', { numeric: true }));
    return sendJson(res, 200, { code: 0, data: list });
  }

  if (pathname === '/api/dorms' && req.method === 'POST') {
    const body = await readBody(req);
    const roomNo = String(body.roomNo || '').trim();
    if (!roomNo) return sendJson(res, 400, { code: 1, msg: '房号不能为空' });
    const building = String(body.building || '未命名楼栋').trim();
    const list = readDorms();
    if (list.some(r => r.building === building && String(r.roomNo) === roomNo)) {
      return sendJson(res, 400, { code: 1, msg: '该楼栋下已存在此房号' });
    }
    const item = {
      id: genId(),
      building,
      roomNo,
      capacity: Math.min(100, Math.max(1, Number(body.capacity) || 4)),
      gender: DORM_GENDER[body.gender] ? body.gender : 'any',
      students: []
    };
    list.push(item);
    writeDorms(list);
    return sendJson(res, 200, { code: 0, data: item });
  }

  if (pathname.startsWith('/api/dorms/') && req.method === 'PUT') {
    const id = pathname.split('/').pop();
    const list = readDorms();
    const r = list.find(x => x.id === id);
    if (!r) return sendJson(res, 404, { code: 1, msg: '房间不存在' });
    const body = await readBody(req);
    if (body.building !== undefined) r.building = String(body.building || '未命名楼栋').trim();
    if (body.roomNo !== undefined) r.roomNo = String(body.roomNo || '').trim();
    if (body.capacity !== undefined) {
      const cap = Math.min(100, Math.max(1, Number(body.capacity) || 4));
      if (cap < (r.students || []).length) return sendJson(res, 400, { code: 1, msg: '容量不能小于当前入住人数' });
      r.capacity = cap;
    }
    if (DORM_GENDER[body.gender]) r.gender = body.gender;
    writeDorms(list);
    return sendJson(res, 200, { code: 0, data: r });
  }

  // 分配入住：body { studentIds: [id...] }
  if (pathname.startsWith('/api/dorms/') && pathname.endsWith('/assign') && req.method === 'POST') {
    const id = pathname.split('/')[3];
    const body = await readBody(req);
    const dorms = readDorms();
    const r = dorms.find(x => x.id === id);
    if (!r) return sendJson(res, 404, { code: 1, msg: '房间不存在' });
    const ids = Array.isArray(body.studentIds) ? body.studentIds.map(String) : [];
    if (!ids.length) return sendJson(res, 400, { code: 1, msg: '请选择学生' });
    const cap = Number(r.capacity) || 4;
    const occupied = (r.students || []).filter(x => !ids.includes(String(x))).length;
    if (occupied + ids.length > cap) return sendJson(res, 400, { code: 1, msg: '房间容量不足' });
    // 性别校验
    ids.forEach(sid => {
      const stu = findStudentById(sid);
      if (!stu) return;
      if (r.gender === 'male' && stu.gender !== '男') { r.genderErr = true; }
      if (r.gender === 'female' && stu.gender !== '女') { r.genderErr = true; }
    });
    if (r.genderErr) {
      delete r.genderErr;
      return sendJson(res, 400, { code: 1, msg: r.gender === 'male' ? '该宿舍为男生宿舍，不能入住女生' : '该宿舍为女生宿舍，不能入住男生' });
    }
    // 学生已被安排到其他宿舍：自动迁出
    dorms.forEach(x => {
      if (x.id === id) return;
      x.students = (x.students || []).filter(s => !ids.includes(String(s)));
    });
    r.students = Array.from(new Set([...(r.students || []).filter(s => !ids.includes(String(s))), ...ids]));
    writeDorms(dorms);
    return sendJson(res, 200, { code: 0, msg: `已安排 ${ids.length} 名学生入住` });
  }

  // 单人退宿
  if (pathname.startsWith('/api/dorms/') && pathname.includes('/remove/') && req.method === 'POST') {
    const parts = pathname.split('/');
    const dormId = parts[3];
    const stuId = parts[5];
    const dorms = readDorms();
    const r = dorms.find(x => x.id === dormId);
    if (!r) return sendJson(res, 404, { code: 1, msg: '房间不存在' });
    r.students = (r.students || []).filter(s => String(s) !== String(stuId));
    writeDorms(dorms);
    return sendJson(res, 200, { code: 0, msg: '已退宿' });
  }

  // 清空整间 / 删除房间
  if (pathname.startsWith('/api/dorms/') && (pathname.endsWith('/clear') || req.method === 'DELETE')) {
    const id = pathname.split('/')[3];
    const list = readDorms();
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '房间不存在' });
    if (pathname.endsWith('/clear')) {
      list[idx].students = [];
      writeDorms(list);
      return sendJson(res, 200, { code: 0, msg: '已清空房间' });
    }
    list.splice(idx, 1);
    writeDorms(list);
    return sendJson(res, 200, { code: 0, msg: '房间已删除' });
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

  // ===== 系统设置 API =====
  if (pathname === '/api/settings' && req.method === 'GET') {
    const s = readSettings();
    s.subjects = readSubjects(); // 始终返回生效科目
    return sendJson(res, 200, { code: 0, data: s });
  }
  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readBody(req);
    const s = sanitizeSettings(body);
    if (s.subjects === null) {
      return sendJson(res, 400, { code: 1, msg: '至少需要保留一个科目' });
    }
    if (Array.isArray(s.subjects)) {
      // 迁移学生旧成绩：若科目 key 集合不再包含旧的 chinese/math/english/science，
      // 旧成绩字段在读取时已自动并入 scores，这里不做额外处理
      s.subjects = s.subjects.length ? s.subjects : DEFAULT_SUBJECTS;
    }
    writeSettings(s);
    return sendJson(res, 200, { code: 0, data: s, msg: '设置已保存' });
  }

  // 导出全量数据备份（下载 JSON 文件）
  if (pathname === '/api/backup' && req.method === 'GET') {
    const payload = {
      app: 'intelligent-class-allocation-system',
      exportedAt: new Date().toISOString(),
      settings: readSettings(),
      grades: readGrades(),
      filters: readFilters(),
      classes: readClasses(),
      students: readStudents(),
      teachers: readTeachers(),
      exams: readExams(),
      attendance: readAttendance(),
      conduct: readConduct(),
      dorms: readDorms()
    };
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sms-backup-' + new Date().toISOString().slice(0, 10) + '.json"'
    });
    return res.end(body);
  }

  // 导入备份（覆盖全部业务数据，settings/grades/filters 缺省时保留现有）
  if (pathname === '/api/restore' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.classes) || !Array.isArray(body.students)) {
      return sendJson(res, 400, { code: 1, msg: '备份文件格式不正确' });
    }
    writeSettings(body.settings && typeof body.settings === 'object' ? sanitizeSettings(body.settings) : readSettings());
    writeGrades(Array.isArray(body.grades) ? body.grades.map(String).filter(Boolean) : readGrades());
    writeFilters(body.filters && typeof body.filters === 'object' ? body.filters : {});
    writeClasses(body.classes.map(c => Object.assign({}, c, { students: Array.isArray(c.students) ? c.students : [] })));
    writeStudents(body.students);
    if (Array.isArray(body.teachers)) writeTeachers(body.teachers.map(normalizeTeacher));
    if (Array.isArray(body.exams)) writeExams(body.exams);
    if (Array.isArray(body.attendance)) writeAttendance(body.attendance);
    if (Array.isArray(body.conduct)) writeConduct(body.conduct);
    if (Array.isArray(body.dorms)) writeDorms(body.dorms);
    liveBoard = null;
    return sendJson(res, 200, { code: 0, msg: '恢复完成', classes: body.classes.length, students: body.students.length });
  }

  // ===== 静态文件（含页面登录守卫）=====
  // 受保护页面：后台工作台与各功能页（大屏 result.html / 登录页无需登录）
  const PROTECTED_PAGES = ['/index.html', '/dashboard.html', '/students.html',
    '/classes.html', '/grades.html', '/allocate.html', '/settings.html',
    '/teachers.html', '/exams.html', '/conduct.html', '/dorm.html'];
  const ADMIN_ONLY_PAGES = ['/settings.html'];
  const asPage = pathname === '/' ? '/index.html' : pathname;
  if (pathname === '/' || (asPage.endsWith('.html'))) {
    if (PROTECTED_PAGES.indexOf(asPage) !== -1) {
      const u = authUser(req);
      if (!u) {
        const next = encodeURIComponent(pathname + url.search);
        return redirect(res, '/login.html?next=' + next);
      }
      if (ADMIN_ONLY_PAGES.indexOf(asPage) !== -1 && u.role !== ROLES.ADMIN) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(forbiddenPage('「系统设置」仅限管理员账号使用。'));
      }
    }
    // 已登录访问登录页 → 直接回到工作台
    if (pathname === '/login.html' && authUser(req)) {
      return redirect(res, '/index.html');
    }
  }

  // 根路径即后台工作台（选项卡式工作台，默认停靠“数据总览”页）
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
  console.log(`学生管理系统已启动: http://localhost:${PORT}`);
  console.log(`按 Ctrl+C 停止服务`);
});
