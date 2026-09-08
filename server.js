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
  schoolName: '智能分班系统', // 页面顶部 / 工作台品牌 / 标题展示的学校（机构）名称
  logoDataUrl: '',           // 校徽图片（data:image 前缀的 base64 小图，≤900KB）
  schoolYear: '',            // 学年标签，如「2026 年秋季」
  slogan: '',                // 校训 / 标语（大屏页脚展示）
  schoolAddress: '',         // 学校地址（大屏页脚展示）
  schoolPhone: '',           // 联系电话（大屏页脚展示）
  schoolWebsite: '',         // 学校官网地址（http/https，各页顶栏「官网」入口 + 大屏页脚）
  balanceGender: 1.5,        // 综合均衡：性别均衡强度（越大越强调男女比例均衡）
  balanceSpecialty: 2        // 综合均衡：特长均衡强度（越大越强调特长分布均衡）
};

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

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return Object.assign({}, DEFAULT_SETTINGS, raw);
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
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

  // 清空所有学生：学生池与各班花名册一并清空（班级本身保留，避免「清空学生」后名单里还残留已分班学生）
  if (pathname === '/api/students' && req.method === 'DELETE') {
    writeStudents([]);
    const classes = readClasses();
    classes.forEach(c => { c.students = []; });
    writeClasses(classes);
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
    cls.students[idx] = {
      ...cls.students[idx],
      studentId: body.studentId !== undefined ? String(body.studentId).trim() : cls.students[idx].studentId,
      photo: body.photo !== undefined ? body.photo : cls.students[idx].photo,
      name: body.name !== undefined ? String(body.name).trim() : cls.students[idx].name,
      gender: body.gender !== undefined ? body.gender : cls.students[idx].gender,
      chinese: body.chinese !== undefined ? Number(body.chinese) : cls.students[idx].chinese,
      math: body.math !== undefined ? Number(body.math) : cls.students[idx].math,
      english: body.english !== undefined ? Number(body.english) : cls.students[idx].english,
      science: body.science !== undefined ? Number(body.science) : cls.students[idx].science,
      specialty: body.specialty !== undefined ? body.specialty : cls.students[idx].specialty
    };
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

  // ===== 系统设置 API =====
  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: readSettings() });
  }
  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readBody(req);
    const s = sanitizeSettings(body);
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
      students: readStudents()
    };
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="icbs-backup-' + new Date().toISOString().slice(0, 10) + '.json"'
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
    liveBoard = null;
    return sendJson(res, 200, { code: 0, msg: '恢复完成', classes: body.classes.length, students: body.students.length });
  }

  // ===== 静态文件（含页面登录守卫）=====
  // 受保护页面：后台工作台与各功能页（大屏 result.html / 登录页无需登录）
  const PROTECTED_PAGES = ['/index.html', '/dashboard.html', '/students.html',
    '/classes.html', '/grades.html', '/allocate.html', '/settings.html'];
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
  console.log(`智能分班系统已启动: http://localhost:${PORT}`);
  console.log(`按 Ctrl+C 停止服务`);
});
