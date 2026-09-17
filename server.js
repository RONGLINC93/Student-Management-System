/**
 * 学生管理系统 — HTTP 服务：REST API 路由 + 静态文件托管 + 登录认证
 *
 * @author RONGLINC <chenronglin1993@hotmail.com>
 * @homepage https://github.com/RONGLINC93/Student-Management-System
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

// 应用版本号（单一来源：package.json 的 version）
// 界面由 GET /api/settings 下发后写入 [data-app-version]，飞牛 fpk 打包脚本亦从此处同步
const APP_VERSION = (() => {
  try {
    return String(require('./package.json').version || '');
  } catch (e) {
    return '';
  }
})();

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'students.json');
const CLASSES_FILE = path.join(__dirname, 'data', 'classes.json');
const GRADES_FILE = path.join(__dirname, 'data', 'grades.json');
const FILTERS_FILE = path.join(__dirname, 'data', 'filters.json');
const WORKBENCH_FILE = path.join(__dirname, 'data', 'workbench.json'); // 工作台选项卡状态（按账号）
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SECRET_FILE = path.join(__dirname, 'data', '.auth_secret');
// 学生管理系统扩展数据
const TEACHERS_FILE = path.join(__dirname, 'data', 'teachers.json');       // 教师档案
const EXAMS_FILE = path.join(__dirname, 'data', 'exams.json');             // 考试场次与成绩
const ATTENDANCE_FILE = path.join(__dirname, 'data', 'attendance.json');   // 考勤
const CONDUCT_FILE = path.join(__dirname, 'data', 'conduct.json');         // 操行（奖惩/评语）
const DORMS_FILE = path.join(__dirname, 'data', 'dormitories.json');       // 宿舍房间
const DORM_APPS_FILE = path.join(__dirname, 'data', 'dorm_applications.json'); // 学生住宿申请
const LEAVES_FILE = path.join(__dirname, 'data', 'leaves.json');               // 请假申请（学生在线申请 / 后台审批）
const ANNOUNCEMENTS_FILE = path.join(__dirname, 'data', 'announcements.json'); // 通知公告（面向全校 / 年级 / 班级）
const TRASH_FILE = path.join(__dirname, 'data', 'students_trash.json');        // 学生回收站（删除后软归档，可恢复）
const NOTIFICATIONS_FILE = path.join(__dirname, 'data', 'notifications.json'); // 学生中心站内消息（各类事务变化通知）
const TIMETABLES_FILE = path.join(__dirname, 'data', 'timetables.json');       // 课程表（按班级排课，教师/学生端只读查看）
const COURSE_PLANS_FILE = path.join(__dirname, 'data', 'course-plans.json');    // 各年级课程计划（决定课表可排什么课）
const AUDIT_FILE = path.join(__dirname, 'data', 'audit.json');                  // 操作审计日志
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');                     // 服务器本地自动 / 手动备份目录

// 会话：Cookie 内 HMAC 签名（无服务端 session），Path=/ 以便所有页面共享
const AUTH_COOKIE = 'icbs_auth';        // 后台工作台（管理员 / 查看）
const STUDENT_COOKIE = 'icbs_stu_auth'; // 学生自助端（与学生登录完全隔离，可同浏览器共存）
const TEACHER_COOKIE = 'icbs_tea_auth'; // 教师自助端（与后台 / 学生登录完全隔离，可同浏览器共存）
const SESSION_SECONDS = 24 * 3600;      // 默认会话 24 小时
const REMEMBER_SECONDS = 7 * 24 * 3600; // 「记住我」7 天
const ROLES = { ADMIN: 'admin', VIEWER: 'viewer', STUDENT: 'student', TEACHER: 'teacher', STAFF: 'staff', DORM: 'dorm' };
const ROLE_LABEL = { admin: '管理员', viewer: '查看模式', student: '学生', teacher: '教师', staff: '教务', dorm: '宿管' };

// 已注销的会话 token（内存级；保证“退出登录”后旧 Cookie 立即失效）
const revokedTokens = new Set();

// 系统默认设置
// 职位权限可配置模块（系统设置 → 职位权限）：key 供前后端引用，apis 为对应可写接口前缀
// 注意：教师管理 / 智能分班 / 系统设置 / 备份审计等仅限管理员，不开放配置
const PERMISSION_MODULES = [
  { key: 'students',      name: '学生档案', apis: ['/api/students', '/api/trash'] },
  { key: 'classes',       name: '班级管理', apis: ['/api/classes'] },
  { key: 'grades',        name: '年级管理', apis: ['/api/grades'] },
  { key: 'exams',         name: '成绩管理', apis: ['/api/exams'] },
  { key: 'conduct',       name: '考勤操行', apis: ['/api/attendance', '/api/conduct'] },
  { key: 'leaves',        name: '请假管理', apis: ['/api/leaves'] },
  { key: 'announcements', name: '通知公告', apis: ['/api/announcements'] },
  { key: 'timetables',    name: '课程表',   apis: ['/api/timetables'] },
  { key: 'courses',       name: '课程管理', apis: ['/api/course-plans'] },
  { key: 'dorms',         name: '宿舍管理', apis: ['/api/dorms', '/api/dorm-apps'] }
];
// 读取某角色的可写模块 key 列表（settings 缺失 / 字段异常时回退默认）
// 教务、宿管权限严格独立：教务只按教务职位授权、宿管只按宿管职位授权，不做合并
function positionWritable(role) {
  if (role !== ROLES.STAFF && role !== ROLES.DORM) return [];
  let arr = DEFAULT_SETTINGS.positionPermissions[role];
  try {
    const pp = readSettings().positionPermissions;
    if (pp && Array.isArray(pp[role])) arr = pp[role];
  } catch (e) { /* 读取失败保持默认 */ }
  return PERMISSION_MODULES.map(m => m.key).filter(k => arr.indexOf(k) !== -1);
}
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
  subjects: [],              // 考试科目配置：[{ key, name, max }]，空时使用 DEFAULT_SUBJECTS
  // 服务器管理（系统设置 → 服务器管理）：仅用于重启本服务自身
  serverControl: {
    restartDelay: 1          // 重启服务前的延迟（秒），留给前端接收响应
  },
  // 自动备份（系统设置 → 数据管理 → 备份与恢复）
  backup: {
    auto: false,             // 是否开启每日自动备份
    time: '03:00',           // 自动备份时刻（本地时间 HH:MM）
    keep: 7                  // 自动备份保留份数（超出自动删除最旧）
  },
  // 职位权限（系统设置 → 职位权限）：教务（staff）/ 宿管（dorm）可管理的模块 key
  // 默认：教务可管学籍与教学（不含请假、宿舍——请假审批归班主任，宿舍归宿管）；宿管仅宿舍
  positionPermissions: {
    staff: ['students', 'classes', 'grades', 'exams', 'conduct', 'announcements', 'timetables', 'courses'],
    dorm: ['dorms']
  }
};

// 课程表：默认节次（学校可按需在「课程表 → 节次设置」中调整）与星期字典
const DEFAULT_TIMETABLE_PERIODS = [
  { label: '第1节', time: '08:00-08:45' },
  { label: '第2节', time: '08:55-09:40' },
  { label: '第3节', time: '10:00-10:45' },
  { label: '第4节', time: '10:55-11:40' },
  { label: '第5节', time: '14:00-14:45' },
  { label: '第6节', time: '14:55-15:40' },
  { label: '第7节', time: '16:00-16:45' },
  { label: '第8节', time: '16:55-17:40' }
];
const TIMETABLE_WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TIMETABLE_MAX_PERIODS = 12;

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
if (!fs.existsSync(WORKBENCH_FILE)) {
  fs.writeFileSync(WORKBENCH_FILE, '{}', 'utf-8');
}
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
}
['teachers', 'exams', 'attendance', 'conduct', 'dormitories', 'dormApps', 'leaves', 'announcements', 'trash'].forEach(name => {
  const f = { teachers: TEACHERS_FILE, exams: EXAMS_FILE, attendance: ATTENDANCE_FILE, conduct: CONDUCT_FILE, dormitories: DORMS_FILE, dormApps: DORM_APPS_FILE, leaves: LEAVES_FILE, announcements: ANNOUNCEMENTS_FILE, trash: TRASH_FILE }[name];
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf-8');
});
if (!fs.existsSync(TIMETABLES_FILE)) fs.writeFileSync(TIMETABLES_FILE, JSON.stringify(defaultTimetables(), null, 2), 'utf-8');

// 课程计划：与现存年级一致；如尚无年级则按常见的高一/高二/高三兜底，并预置一份默认课程清单
function defaultCoursePlansFor(gradeList) {
  const COMMON_TYPES = ['必修'];
  const DEFAULT_COURSES = [
    { name: '语文', type: '必修', weeklyHours: 5, examType: '考试', remark: '' },
    { name: '数学', type: '必修', weeklyHours: 5, examType: '考试', remark: '' },
    { name: '英语', type: '必修', weeklyHours: 5, examType: '考试', remark: '' },
    { name: '物理', type: '必修', weeklyHours: 3, examType: '考试', remark: '' },
    { name: '化学', type: '必修', weeklyHours: 3, examType: '考试', remark: '' },
    { name: '生物', type: '必修', weeklyHours: 2, examType: '考试', remark: '' },
    { name: '政治', type: '必修', weeklyHours: 2, examType: '考试', remark: '' },
    { name: '历史', type: '必修', weeklyHours: 2, examType: '考试', remark: '' },
    { name: '地理', type: '必修', weeklyHours: 2, examType: '考试', remark: '' },
    { name: '体育', type: '必修', weeklyHours: 2, examType: '考查', remark: '' },
    { name: '音乐', type: '必修', weeklyHours: 1, examType: '考查', remark: '' },
    { name: '美术', type: '必修', weeklyHours: 1, examType: '考查', remark: '' },
    { name: '信息技术', type: '必修', weeklyHours: 1, examType: '考查', remark: '' },
    { name: '综合实践', type: '必修', weeklyHours: 1, examType: '考查', remark: '含劳动、研学等' }
  ];
  const out = {};
  (gradeList || []).forEach(g => { if (g) out[g] = { courses: DEFAULT_COURSES.slice() }; });
  return out;
}
function readCoursePlans() {
  try {
    const raw = JSON.parse(fs.readFileSync(COURSE_PLANS_FILE, 'utf-8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch (e) { /* fall through */ }
  return defaultCoursePlansFor(readGrades());
}
function writeCoursePlans(data) { atomicWriteJson(COURSE_PLANS_FILE, data || {}); }
if (!fs.existsSync(COURSE_PLANS_FILE)) {
  writeCoursePlans(defaultCoursePlansFor(readGrades()));
}
if (!fs.existsSync(AUDIT_FILE)) fs.writeFileSync(AUDIT_FILE, '[]', 'utf-8');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

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

// 原子写入 JSON：先写同目录临时文件，再 rename 覆盖目标文件。
// 避免写入过程中进程退出 / 断电造成数据文件被截断损坏（rename 在同卷上是原子操作）。
function atomicWriteJson(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function readStudents() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeStudents(list) {
  atomicWriteJson(DATA_FILE, list);
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
  atomicWriteJson(CLASSES_FILE, list);
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
  atomicWriteJson(GRADES_FILE, list);
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
  atomicWriteJson(FILTERS_FILE, filters);
}

// ===== 工作台选项卡状态（按账号分别记忆）=====
function readWorkbench() {
  try {
    const raw = fs.readFileSync(WORKBENCH_FILE, 'utf-8');
    const map = JSON.parse(raw);
    return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  } catch (e) {
    return {};
  }
}

function writeWorkbench(map) {
  atomicWriteJson(WORKBENCH_FILE, map);
}

// 校验并收敛前端提交的工作台状态（页签数量/字段长度/账号名均作限制）
const WORKBENCH_MAX_TABS = 30;
function sanitizeWorkbenchState(b) {
  const src = (b && typeof b === 'object') ? b : {};
  const out = { ts: Date.now(), tabs: [], splitOn: !!src.splitOn, activeKey: '', leftKey: '', rightKey: '', splitRatio: 0.5 };
  const keyOk = k => typeof k === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(k);
  const list = Array.isArray(src.tabs) ? src.tabs : [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.tabs.length < WORKBENCH_MAX_TABS; i++) {
    const it = list[i] || {};
    const k = keyOk(it.key) ? it.key.trim() : '';
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.tabs.push({ key: k, side: !!it.side });
  }
  if (!out.tabs.length) {
    return { ts: out.ts, tabs: [], splitOn: false, activeKey: '', leftKey: '', rightKey: '', splitRatio: 0.5 };
  }
  if (keyOk(src.activeKey)) out.activeKey = src.activeKey;
  if (keyOk(src.leftKey)) out.leftKey = src.leftKey;
  if (keyOk(src.rightKey)) out.rightKey = src.rightKey;
  // 分屏主窗格占比：仅接受 0.25~0.75 的有限数字，越界回退到默认 0.5
  const ratio = Number(src.splitRatio);
  if (isFinite(ratio) && ratio >= 0.25 && ratio <= 0.75) {
    out.splitRatio = Math.round(ratio * 100) / 100;
  }
  return out;
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
  // 学籍状态（active 在籍 / leave 休学 / quit 退学 / transfer 转出 / graduate 毕业）与异动流水
  out.status = ['active', 'leave', 'quit', 'transfer', 'graduate'].indexOf(o.status) !== -1 ? o.status : 'active';
  out.history = Array.isArray(o.history) ? o.history.map(h => ({
    at: String(h.at || ''),
    from: String(h.from || ''),
    to: String(h.to || ''),
    note: String(h.note || ''),
    op: String(h.op || '')
  })) : [];
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
  atomicWriteJson(file, list);
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
const readDormApps = () => readJsonFile(DORM_APPS_FILE, []);
const writeDormApps = l => writeJsonFile(DORM_APPS_FILE, l);
const readLeaves = () => readJsonFile(LEAVES_FILE, []);
const writeLeaves = l => writeJsonFile(LEAVES_FILE, l);
const readAnnouncements = () => readJsonFile(ANNOUNCEMENTS_FILE, []);
const writeAnnouncements = l => writeJsonFile(ANNOUNCEMENTS_FILE, l);
const readTrash = () => readJsonFile(TRASH_FILE, []);
const writeTrash = l => writeJsonFile(TRASH_FILE, l);
const readNotifications = () => readJsonFile(NOTIFICATIONS_FILE, []);
const writeNotifications = l => writeJsonFile(NOTIFICATIONS_FILE, l);

// ===== 课程计划（各年级课程清单，决定课表可排什么课）=====
// 数据结构：{ [grade]: { courses: [ { name, type, weeklyHours, examType, remark } ] } }
// 与现存 grades.json 一一对应；删除年级时其计划可保留在文件里但 API 不返回
const COURSE_TYPES = ['必修', '选修', '校本', '实践'];
const COURSE_EXAM_TYPES = ['考试', '考查', '无'];
function normalizeCoursePlanEntry(c) {
  if (!c || typeof c !== 'object') return null;
  const name = String(c.name || '').trim().slice(0, 20);
  if (!name) return null;
  const type = COURSE_TYPES.indexOf(c.type) !== -1 ? c.type : '必修';
  const hours = Math.max(0, Math.min(20, Math.floor(Number(c.weeklyHours) || 0)));
  const examType = COURSE_EXAM_TYPES.indexOf(c.examType) !== -1 ? c.examType : '考试';
  const remark = String(c.remark || '').trim().slice(0, 100);
  return { name, type, weeklyHours: hours, examType, remark };
}
function normalizeCoursePlan(raw) {
  if (!raw || typeof raw !== 'object') return { courses: [] };
  const seen = {};
  const courses = [];
  (Array.isArray(raw.courses) ? raw.courses : []).forEach(c => {
    const n = normalizeCoursePlanEntry(c);
    if (!n) return;
    if (seen[n.name]) return; // 同名课程仅保留一个
    seen[n.name] = 1;
    courses.push(n);
  });
  return { courses };
}
function publicCoursePlans() {
  // 仅返回当前 grades.json 里实际存在的年级对应的计划；返回中附带所有年级列表，便于前端识别缺失项
  const grades = readGrades();
  const all = readCoursePlans();
  const plans = {};
  grades.forEach(g => { plans[g] = normalizeCoursePlan(all[g]); });
  return { grades, plans };
}

// ===== 课程表（按班级排课，教师 / 学生端只读查看）=====
// 数据结构：{ term, periods: [{label,time}], days: [1..7], tables: { [classId]: { classId, className, grade, slots, updatedAt } } }
// slots 的键为「星期-节次」（如 "1-3" 表示周一第 3 节），值 { subject, teacherNo, teacher, room }
function defaultTimetables() {
  return {
    term: '',
    periods: DEFAULT_TIMETABLE_PERIODS.map(p => ({ label: p.label, time: p.time })),
    days: [1, 2, 3, 4, 5],
    tables: {}
  };
}
function normalizeTimetablePeriods(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < arr.length && out.length < TIMETABLE_MAX_PERIODS; i++) {
    const p = arr[i] || {};
    out.push({
      label: String(p.label || '').trim().slice(0, 12) || ('第' + (out.length + 1) + '节'),
      time: String(p.time || '').trim().slice(0, 20)
    });
  }
  return out.length ? out : DEFAULT_TIMETABLE_PERIODS.map(p => ({ label: p.label, time: p.time }));
}
function normalizeTimetableDays(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const set = new Set();
  arr.forEach(d => {
    const n = Number(d);
    if (n >= 1 && n <= 7) set.add(n);
  });
  const out = Array.from(set).sort((a, b) => a - b);
  return out.length ? out : [1, 2, 3, 4, 5];
}
// 单元格规范化：科目与教师皆为空视为未排课（删除该键）
function normalizeTimetableSlot(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const subject = String(o.subject || '').trim().slice(0, 20);
  const teacher = String(o.teacher || '').trim().slice(0, 20);
  if (!subject && !teacher) return null;
  return {
    subject,
    teacherNo: String(o.teacherNo || '').trim().slice(0, 30),
    teacher,
    room: String(o.room || '').trim().slice(0, 20)
  };
}
function normalizeTimetableSlots(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  Object.keys(src).forEach(k => {
    const m = /^([1-7])-(\d{1,2})$/.exec(k);
    if (!m) return;
    const day = Number(m[1]);
    const period = Number(m[2]);
    if (period < 1 || period > TIMETABLE_MAX_PERIODS) return;
    const slot = normalizeTimetableSlot(src[k]);
    if (slot) out[day + '-' + period] = slot;
  });
  return out;
}
function readTimetables() {
  try {
    return normalizeTimetables(JSON.parse(fs.readFileSync(TIMETABLES_FILE, 'utf-8')));
  } catch (e) {
    return defaultTimetables();
  }
}
// 任意来源（数据文件 / 备份导入）→ 标准课表结构
function normalizeTimetables(v) {
  const base = defaultTimetables();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return base;
  {
    const tables = {};
    (v.tables && typeof v.tables === 'object' && !Array.isArray(v.tables)) ? Object.keys(v.tables).forEach(id => {
      const t = v.tables[id] || {};
      tables[id] = {
        classId: String(t.classId || id),
        className: String(t.className || '').trim().slice(0, 40),
        grade: String(t.grade || '').trim().slice(0, 20),
        slots: normalizeTimetableSlots(t.slots),
        updatedAt: String(t.updatedAt || '')
      };
    }) : null;
    return {
      term: String(v.term || '').trim().slice(0, 40),
      periods: normalizeTimetablePeriods(v.periods),
      days: normalizeTimetableDays(v.days),
      tables
    };
  }
}
function writeTimetables(t) {
  atomicWriteJson(TIMETABLES_FILE, t);
}
// 课表设置视图（供前端渲染）
function timetableMeta(t) {
  return { term: t.term, periods: t.periods, days: t.days, weekdays: TIMETABLE_WEEKDAYS };
}
// 按班级课表视图（合并班级/年级信息，班级已删除时标记 invalid）
function timetableClassView(t, classId) {
  const cls = readClasses().find(c => c.id === classId) || null;
  const saved = t.tables[classId] || null;
  return {
    classId,
    className: cls ? cls.name : ((saved && saved.className) || '（班级已删除）'),
    grade: cls ? (cls.grade || '') : ((saved && saved.grade) || ''),
    headTeacher: cls ? (cls.headTeacher || '') : '',
    exists: !!cls,
    slots: saved ? saved.slots : {},
    updatedAt: saved ? saved.updatedAt : ''
  };
}
// 教师个人的全部任课安排（跨班级扫描）
function teacherTimetableOf(tea) {
  const t = readTimetables();
  const no = String((tea && tea.teacherNo) || '').trim();
  const name = String((tea && tea.name) || '').trim();
  const entries = [];
  const classes = readClasses();
  Object.keys(t.tables).forEach(cid => {
    const tab = t.tables[cid];
    const hit = {};
    Object.keys(tab.slots || {}).forEach(k => {
      const s = tab.slots[k];
      const byNo = no && s.teacherNo && s.teacherNo === no;
      const byName = name && s.teacher === name;
      if (byNo || byName) hit[k] = s;
    });
    if (!Object.keys(hit).length) return;
    const cls = classes.find(c => c.id === cid);
    entries.push({
      classId: cid,
      className: cls ? cls.name : (tab.className || '（班级已删除）'),
      grade: cls ? (cls.grade || '') : (tab.grade || ''),
      slots: hit
    });
  });
  entries.sort((a, b) => String(a.grade + a.className).localeCompare(String(b.grade + b.className), 'zh-Hans-CN', { numeric: true }));
  return Object.assign(timetableMeta(t), { entries });
}
// 排课冲突检测：同一教师 / 同一教室在同一时间被排进了多个班级
function timetableConflicts(t) {
  const map = {};
  const add = (day, period, type, key, name, info) => {
    const sk = day + '-' + period + '|' + type + '|' + key;
    if (!map[sk]) map[sk] = { day, period, type: type === 'teacher' ? '教师冲突' : '教室冲突', name, classes: [] };
    map[sk].classes.push(info);
  };
  Object.keys(t.tables).forEach(cid => {
    const tab = t.tables[cid];
    Object.keys(tab.slots || {}).forEach(k => {
      const m = /^([1-7])-(\d{1,2})$/.exec(k);
      if (!m) return;
      const day = Number(m[1]), period = Number(m[2]);
      const s = tab.slots[k];
      const info = { classId: cid, className: tab.className || '', subject: s.subject || '' };
      if (s.teacherNo) add(day, period, 'teacher', 'no:' + s.teacherNo, s.teacher || s.teacherNo, info);
      else if (s.teacher) add(day, period, 'teacher', 'name:' + s.teacher, s.teacher, info);
      if (s.room) add(day, period, 'room', s.room, s.room, info);
    });
  });
  return Object.keys(map).map(k => map[k]).filter(x => x.classes.length > 1);
}

// ===== 数据备份（手动下载导出 + 服务器本地自动备份）=====
// 全量备份载荷：集中在此处维护，保证「下载导出 / 手动备份 / 自动备份」内容一致
function buildBackupPayload() {
  return {
    app: 'intelligent-class-allocation-system',
    version: APP_VERSION,
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
    dorms: readDorms(),
    dormApps: readDormApps(),
    leaves: readLeaves(),
    announcements: readAnnouncements(),
    timetables: readTimetables(),
    trash: readTrash(),
    notifications: readNotifications()
  };
}
const BACKUP_NAME_RE = /^backup-\d{8}-\d{6}\.json$/;
const bp2 = n => (n < 10 ? '0' + n : '' + n);
function backupStamp(d) {
  d = d || new Date();
  return '' + d.getFullYear() + bp2(d.getMonth() + 1) + bp2(d.getDate())
    + '-' + bp2(d.getHours()) + bp2(d.getMinutes()) + bp2(d.getSeconds());
}
function backupDayOf(d) {
  d = d || new Date();
  return '' + d.getFullYear() + bp2(d.getMonth() + 1) + bp2(d.getDate());
}
// 列出本地备份（按文件名时间倒序），并读取每条记录的 kind（auto/manual）
function listBackupFiles() {
  let names = [];
  try { names = fs.readdirSync(BACKUP_DIR).filter(n => BACKUP_NAME_RE.test(n)); } catch (e) { names = []; }
  return names.map(n => {
    let size = 0, mtime = '', kind = 'manual';
    try {
      const fp = path.join(BACKUP_DIR, n);
      const st = fs.statSync(fp);
      size = st.size; mtime = st.mtime.toISOString();
      try { kind = JSON.parse(fs.readFileSync(fp, 'utf-8')).kind || 'manual'; } catch (e) {}
    } catch (e) {}
    return { name: n, size, mtime, kind };
  }).sort((a, b) => b.name.localeCompare(a.name));
}
// 在服务器本地生成一份备份，返回文件名
function createBackupFile(kind) {
  const payload = buildBackupPayload();
  payload.kind = kind === 'auto' ? 'auto' : 'manual';
  const name = 'backup-' + backupStamp() + '.json';
  atomicWriteJson(path.join(BACKUP_DIR, name), payload);
  return name;
}
// 按保留份数清理「自动备份」（手动备份永久保留）
function pruneAutoBackups(keep) {
  const autoOnes = listBackupFiles().filter(f => f.kind === 'auto');
  autoOnes.slice(Math.max(1, keep | 0)).forEach(f => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (e) {}
  });
}
// 备份名校验 + 防路径穿越，返回安全的绝对路径（非法返回 null）
function resolveBackupFile(name) {
  if (typeof name !== 'string' || !BACKUP_NAME_RE.test(name)) return null;
  const fp = path.join(BACKUP_DIR, name);
  return fp.startsWith(BACKUP_DIR + path.sep) ? fp : null;
}
// 自动备份调度器：每分钟检查，到达设置时刻且当天尚未备份时生成一份
let backupSchedulerStarted = false;
let backupLastDay = '';
function startBackupScheduler() {
  if (backupSchedulerStarted) return;
  backupSchedulerStarted = true;
  const run = () => {
    try {
      const cfg = Object.assign({}, DEFAULT_SETTINGS.backup, readSettings().backup || {});
      if (!cfg.auto) return;
      const now = new Date();
      const dayCompact = backupDayOf(now);
      const dayIso = dayCompact.slice(0, 4) + '-' + dayCompact.slice(4, 6) + '-' + dayCompact.slice(6, 8);
      if (backupLastDay === dayIso) return;
      const hm = bp2(now.getHours()) + ':' + bp2(now.getMinutes());
      if (hm < String(cfg.time)) return;
      const prefix = 'backup-' + dayCompact + '-';
      if (listBackupFiles().some(f => f.name.indexOf(prefix) === 0)) {
        backupLastDay = dayIso; // 今天已有（含手动）备份，跳过并标记
        return;
      }
      const name = createBackupFile('auto');
      backupLastDay = dayIso;
      pruneAutoBackups(cfg.keep);
      console.log('[自动备份] 已生成今日备份：' + name);
    } catch (e) {
      console.error('[自动备份失败]', e && e.message);
    }
  };
  run(); // 启动时补检（例如服务停机跨过备份时刻，启动后立即补一份）
  setInterval(run, 60 * 1000).unref();
}

// ===== 学生中心站内消息（事务变化通知）=====
// 通知对象以学生内部 id（= students.json 的 id，与请假 sid / 宿舍 sid / 操行 studentId 同源）为主键
const NOTIFY_LIMIT = 100;      // 每位学生最多保留的通知条数，超出丢弃最旧的
const NOTIFY_MAX_LENGTH = 300; // 正文最大长度（超出截断）
// 批量写入通知（仅落盘一次），items: [{ sid, type, title, body }]
function notifyBatch(items) {
  const list = (items || []).filter(x => x && String(x.sid || '').trim());
  if (!list.length) return 0;
  const now = new Date().toISOString();
  const fresh = list.map(x => ({
    id: genId(),
    sid: String(x.sid),
    type: x.type || 'system',
    title: String(x.title || '').slice(0, 60),
    body: String(x.body || '').slice(0, NOTIFY_MAX_LENGTH),
    read: false,
    createdAt: now
  }));
  // 新通知在前，同一学生只保留最近 NOTIFY_LIMIT 条
  const seen = {};
  const kept = [];
  fresh.concat(readNotifications()).forEach(n => {
    const key = String(n.sid);
    const used = seen[key] || 0;
    if (used >= NOTIFY_LIMIT) return;
    seen[key] = used + 1;
    kept.push(n);
  });
  writeNotifications(kept);
  return fresh.length;
}
// 给单个学生推一条通知
function notifyStudent(sid, type, title, body) {
  return notifyBatch([{ sid: sid, type: type, title: title, body: body }]);
}

// 教师档案规范化
function normalizeTeacher(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  // 任教年级：兼容数组 / 逗号串 / 旧字段
  let grades = [];
  if (Array.isArray(o.grades)) grades = o.grades;
  else if (typeof o.grades === 'string') grades = o.grades.split(/[,，、;；\/\s]+/);
  grades = [...new Set(grades.map(g => String(g || '').trim()).filter(Boolean))].slice(0, 20);
  return {
    id: o.id || genId(),
    teacherNo: String(o.teacherNo || '').trim(),
    name: String(o.name || '').trim(),
    gender: o.gender === '女' ? '女' : '男',
    subject: String(o.subject || '').trim(),   // 任教学科名
    title: String(o.title || '').trim(),       // 职称/职务
    phone: String(o.phone || '').trim(),
    joinYear: String(o.joinYear || '').trim(),
    idCard: String(o.idCard || '').trim().toUpperCase().replace(/[^0-9X]/g, '').slice(0, 18), // 身份证号（教师端初始密码 = 后 6 位）
    ethnic: String(o.ethnic || '').trim().slice(0, 20),         // 民族
    hometown: String(o.hometown || '').trim().slice(0, 50),     // 籍贯
    political: String(o.political || '').trim().slice(0, 20),   // 政治面貌
    education: String(o.education || '').trim().slice(0, 30),   // 学历 / 学位
    address: String(o.address || '').trim().slice(0, 100),      // 家庭住址
    emergencyName: String(o.emergencyName || '').trim().slice(0, 30),  // 紧急联系人
    emergencyPhone: String(o.emergencyPhone || '').trim().slice(0, 30), // 紧急联系电话
    grades,                                   // 任教年级（联动课程表教师下拉）
    classId: o.classId || '',                  // 班主任所在班级 id
    remark: String(o.remark || '').trim()
  };
}
// 身份证号脱敏展示（保留前 4 位 + 后 4 位）
function maskIdCard(no) {
  const s = String(no || '').trim().toUpperCase();
  if (!s) return '';
  if (s.length <= 4) return '****';
  if (s.length <= 8) return s.slice(0, 2) + '****' + s.slice(-2);
  return s.slice(0, 4) + '**********' + s.slice(-4);
}
// 教师初始密码 = 身份证号后 6 位（未登记 / 不足 6 位返回空串）
function teacherInitPassword(tea) {
  const id = String((tea && tea.idCard) || '').trim();
  return id.length >= 6 ? id.slice(-6) : '';
}
// 全部学生（未分班学生 + 各班名单），供跨模块引用
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
// 从全部学生中按学号找学生（优先已分班名单，其次未分班学生）
function findStudentByNo(no) {
  const { pool, allocated } = allStudentsFlat();
  const key = String(no || '').trim();
  if (!key) return null;
  const a = allocated.find(s => String(s.studentId || '') === key);
  if (a) return a;
  return pool.find(s => String(s.studentId || '') === key) || null;
}
// 学生在哪个宿舍房间（没有则 null）
function findDormOfStudent(sid) {
  return readDorms().find(r => (r.students || []).some(x => String(x) === String(sid))) || null;
}
// 从教师档案中按工号找教师
function findTeacherByNo(no) {
  const key = String(no || '').trim();
  if (!key) return null;
  return readTeachers().find(t => String(t.teacherNo || '').trim() === key) || null;
}

// ===== 学生自助端辅助 =====
// 房间是否允许该性别入住
function genderRoomAllowed(room, gender) {
  if (!room) return false;
  if (room.gender === 'male') return gender === '男';
  if (room.gender === 'female') return gender === '女';
  return true;
}
// 房间基础视图（含当前空床）
function roomView(r) {
  const occ = (r.students || []).length;
  return {
    id: r.id,
    building: r.building,
    roomNo: r.roomNo,
    gender: r.gender,
    capacity: Number(r.capacity) || 1,
    occupied: occ,
    free: Math.max(0, (Number(r.capacity) || 1) - occ)
  };
}
function roomLabel(roomId) {
  const r = readDorms().find(x => x.id === roomId);
  return r ? { building: r.building, roomNo: r.roomNo } : { building: '', roomNo: '' };
}
// 学生可申请的候选房间（性别相符 + 尚有空床）
function studentApplyRooms(stu) {
  const g = stu && stu.gender;
  return readDorms()
    .filter(r => genderRoomAllowed(r, g) && (r.students || []).length < (Number(r.capacity) || 1))
    .sort((a, b) =>
      String(a.building).localeCompare(String(b.building), 'zh-Hans-CN', { numeric: true }) ||
      String(a.roomNo).localeCompare(String(b.roomNo), 'zh-Hans-CN', { numeric: true }))
    .map(roomView);
}
// 学生端首页聚合视图：档案 + 班级 + 教师 + 宿舍 + 申请状态
function buildStudentPortalHome(stu) {
  const classes = readClasses();
  const cls = (stu.classId && classes.find(c => c.id === stu.classId)) || null;
  const teachers = readTeachers();
  const head = cls
    ? (teachers.find(t => t.classId === cls.id) || teachers.find(t => t.name === (cls.headTeacher || '')) || null)
    : null;
  const dorm = findDormOfStudent(stu.id);
  const apps = readDormApps()
    .filter(a => String(a.sid) === String(stu.id))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const pending = apps.find(a => a.status === 'pending') || null;
  const last = apps.length ? apps[apps.length - 1] : null;

  let dormData = null;
  if (dorm) {
    let bed = 0;
    const roommates = [];
    (dorm.students || []).forEach((sid, i) => {
      if (String(sid) === String(stu.id)) { bed = i + 1; return; }
      const m = findStudentById(sid);
      roommates.push({ name: m ? m.name : '（已离校学生）', gender: m ? m.gender : '' });
    });
    dormData = Object.assign(roomView(dorm), { bed, roommates });
  }

  return {
    sid: stu.id,
    studentNo: stu.studentId || '',
    name: stu.name || '',
    gender: stu.gender || '',
    grade: stu.grade || (cls ? cls.grade : ''),
    photo: stu.photo || '',
    allocated: !!cls,
    classId: cls ? cls.id : null,
    className: cls ? cls.name : null,
    headTeacher: cls ? {
      name: cls.headTeacher || '',
      subject: (head && head.subject) || '',
      title: (head && head.title) || '',
      phone: (head && head.phone) || ''
    } : null,
    rosterCount: cls ? (cls.students || []).length : 0,
    roster: cls ? (cls.students || []).map(s => ({ id: s.id, studentNo: s.studentId || '', name: s.name || '', gender: s.gender || '' })) : [],
    dorm: dormData,
    app: pending ? Object.assign({}, pending, roomLabel(pending.roomId)) : null,
    appLast: last ? Object.assign({ status: last.status, createdAt: last.createdAt }, roomLabel(last.roomId)) : null,
    applyEnabled: !dorm && !pending,
    rooms: studentApplyRooms(stu)
  };
}
// 教师端首页聚合视图：档案 + 班主任班级 + 花名册
function buildTeacherPortalHome(t) {
  const classes = readClasses();
  const cls = (t.classId && classes.find(c => c.id === t.classId)) || null;
  const roster = cls ? (cls.students || []) : [];
  // 班主任班级的宿舍分布概览（供教师快速了解本班住宿情况）
  const dorms = readDorms();
  const dormOf = {};
  dorms.forEach(r => (r.students || []).forEach(sid => { dormOf[sid] = r.building + ' ' + r.roomNo; }));
  return {
    tid: t.id,
    teacherNo: t.teacherNo || '',
    name: t.name || '',
    gender: t.gender || '',
    subject: t.subject || '',
    title: t.title || '',
    phone: t.phone || '',
    joinYear: t.joinYear || '',
    idCardMasked: maskIdCard(t.idCard),   // 身份证号脱敏（前 4 + 后 4）
    ethnic: t.ethnic || '',               // 民族
    hometown: t.hometown || '',           // 籍贯
    political: t.political || '',         // 政治面貌
    education: t.education || '',         // 学历 / 学位
    address: t.address || '',             // 家庭住址（仅本人与管理员可见）
    emergencyName: t.emergencyName || '', // 紧急联系人
    emergencyPhone: t.emergencyPhone || '', // 紧急联系电话
    isHead: !!cls,
    classId: cls ? cls.id : null,
    className: cls ? cls.name : null,
    grade: cls ? (cls.grade || '') : '',
    headTeacher: cls ? (cls.headTeacher || '') : '',
    rosterCount: roster.length,
    maleCount: roster.filter(s => s.gender === '男').length,
    femaleCount: roster.filter(s => s.gender === '女').length,
    roster: roster.map(s => ({
      id: s.id,
      studentNo: s.studentId || '',
      name: s.name || '',
      gender: s.gender || '',
      specialty: s.specialty || '',
      dorm: dormOf[s.id] || ''
    }))
  };
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
  atomicWriteJson(SETTINGS_FILE, settings);
}

// ===== 登录认证：账号 / 口令 / 会话 =====
function readUsers() {
  try {
    const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function writeUsers(list) {
  atomicWriteJson(USERS_FILE, list);
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

// ===== 登录防爆破（内存级，重启清空）=====
// 同一「账号 + 客户端 IP」连续失败 5 次后临时锁定；锁定时长 1 分钟起，
// 每多失败一轮翻倍，上限 30 分钟；登录成功立即清零。
const loginFails = new Map();                 // key -> { count, lockUntil, lastTry }
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_BASE_MS = 60 * 1000;
const LOGIN_LOCK_MAX_MS = 30 * 60 * 1000;
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || '';
}
function loginGuardKey(req, username) {
  return String(username || '').toLowerCase().slice(0, 40) + '|' + clientIp(req);
}
// 返回剩余锁定秒数；0 表示未锁定
function loginLockLeft(req, username) {
  const it = loginFails.get(loginGuardKey(req, username));
  if (!it || !it.lockUntil || it.lockUntil <= Date.now()) return 0;
  return Math.ceil((it.lockUntil - Date.now()) / 1000);
}
// 记录一次失败；返回当前剩余锁定秒数
function loginMarkFail(req, username) {
  const k = loginGuardKey(req, username);
  const now = Date.now();
  const it = loginFails.get(k) || { count: 0, lockUntil: 0, lastTry: 0 };
  if (it.lockUntil && it.lockUntil <= now) { it.count = 0; it.lockUntil = 0; } // 上轮锁定已过期，重新计数
  it.count++;
  if (it.count >= LOGIN_MAX_FAILS) {
    const round = it.count - LOGIN_MAX_FAILS;
    it.lockUntil = now + Math.min(LOGIN_LOCK_MAX_MS, LOGIN_LOCK_BASE_MS * Math.pow(2, round));
  }
  it.lastTry = now;
  loginFails.set(k, it);
  return loginLockLeft(req, username);
}
function loginMarkSuccess(req, username) {
  loginFails.delete(loginGuardKey(req, username));
}
// 定时清理超过 1 小时未活动的计数项，避免 Map 无限增长
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFails) {
    if (v.lastTry && now - v.lastTry > 60 * 60 * 1000 && (!v.lockUntil || v.lockUntil < now)) {
      loginFails.delete(k);
    }
  }
}, 10 * 60 * 1000).unref();
// 锁定提示文案
function lockMsg(leftSeconds) {
  const min = Math.ceil(leftSeconds / 60);
  return '登录失败次数过多，为保障账号安全已临时锁定，请 ' + min + ' 分钟后再试';
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
    // 账号被删除 / 角色变更后旧会话自动失效；教务（staff）/ 宿管（dorm）会话对应 users.json 中的教师账号
    const sessionOnTeacher = !!user && (data.r === ROLES.STAFF || data.r === ROLES.DORM) && user.role === ROLES.TEACHER;
    if (!user || (user.role !== data.r && !sessionOnTeacher)) return null;
    return { username: user.u, role: data.r };
  } catch (e) { return null; }
}
function cookieHeader(token, maxAge) {
  return AUTH_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}
function clearCookieHeader() {
  return AUTH_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
function studentCookieHeader(token, maxAge) {
  return STUDENT_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}
function clearStudentCookieHeader() {
  return STUDENT_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
// 校验学生端 Cookie 会话；仅接受 users.json 中 role=student 的学生账号
function authStudent(req) {
  try {
    const c = parseCookies(req)[STUDENT_COOKIE];
    if (!c || revokedTokens.has(c)) return null;
    const dot = c.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = c.slice(0, dot);
    const sig = c.slice(dot + 1);
    if (!safeEq(sig, sign(payload))) return null;
    const data = JSON.parse(unb64url(payload));
    if (!data.u || data.r !== ROLES.STUDENT || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    const user = findUser(data.u);
    if (!user || user.role !== ROLES.STUDENT) return null;
    return { username: user.u, role: user.role, sid: user.sid || '', name: user.name || '', must: !!user.must };
  } catch (e) { return null; }
}
function teacherCookieHeader(token, maxAge) {
  return TEACHER_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}
function clearTeacherCookieHeader() {
  return TEACHER_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
// 校验教师端 Cookie 会话；仅接受 users.json 中 role=teacher 的教师账号
function authTeacher(req) {
  try {
    const c = parseCookies(req)[TEACHER_COOKIE];
    if (!c || revokedTokens.has(c)) return null;
    const dot = c.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = c.slice(0, dot);
    const sig = c.slice(dot + 1);
    if (!safeEq(sig, sign(payload))) return null;
    const data = JSON.parse(unb64url(payload));
    if (!data.u || data.r !== ROLES.TEACHER || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    const user = findUser(data.u);
    if (!user || user.role !== ROLES.TEACHER) return null;
    return { username: user.u, role: user.role, tid: user.tid || '', name: user.name || '', must: !!user.must };
  } catch (e) { return null; }
}
function redirect(res, loc) {
  res.writeHead(302, { Location: loc });
  res.end();
}
// 通过登录用户名解析教师档案（优先 user.tid，其次按工号匹配）
function findTeacherOfAuth(t) {
  const user = findUser(t.username);
  const teachers = readTeachers();
  if (user && user.tid) {
    const hit = teachers.find(x => x.id === user.tid);
    if (hit) return hit;
  }
  return teachers.find(x => String(x.teacherNo || '').trim() === t.username) || null;
}
// 教务职位教师：职称 / 职务包含「教务」（如 教务、教务主任、教务处），可登录管理后台管理教务项目
function isAcademicStaff(t) {
  return !!t && String(t.title || '').indexOf('教务') !== -1;
}
// 宿管职位教师：职称 / 职务包含「宿管」或「宿舍管理」（如 宿管、宿管员、宿舍管理员），可登录管理后台管理宿舍项目
// 注意：同时含「教务」与「宿管」时以教务（staff）身份登录，仅按教务职位权限授权，不再并入宿管模块
function isDormStaff(t) {
  const title = String((t && t.title) || '');
  return title.indexOf('宿管') !== -1 || title.indexOf('宿舍管理') !== -1;
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
  // 职位权限：仅接受白名单模块 key；角色字段缺失时保留原值，传入 null 时恢复默认
  if (body.positionPermissions !== undefined && body.positionPermissions && typeof body.positionPermissions === 'object') {
    const cur = (s.positionPermissions && typeof s.positionPermissions === 'object')
      ? s.positionPermissions : DEFAULT_SETTINGS.positionPermissions;
    const pp = { staff: (cur.staff || []).slice(), dorm: (cur.dorm || []).slice() };
    [ROLES.STAFF, ROLES.DORM].forEach(role => {
      const arr = body.positionPermissions[role];
      if (arr === null) pp[role] = DEFAULT_SETTINGS.positionPermissions[role].slice();
      else if (Array.isArray(arr)) {
        pp[role] = PERMISSION_MODULES.map(m => m.key).filter(k => arr.indexOf(k) !== -1);
      }
    });
    s.positionPermissions = pp;
  }
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
  // 服务器管理：仅保留重启延迟（同时清除历史版本遗留的电源控制字段）
  if (body.serverControl && typeof body.serverControl === 'object') {
    const def = DEFAULT_SETTINGS.serverControl;
    const prev = (s.serverControl && typeof s.serverControl === 'object') ? s.serverControl : {};
    const raw = body.serverControl.restartDelay !== undefined ? body.serverControl.restartDelay : prev.restartDelay;
    s.serverControl = {
      restartDelay: Math.min(30, Math.max(0, Number(raw !== undefined ? raw : def.restartDelay) || 0))
    };
  }
  // 自动备份：开关 / 时刻 / 保留份数
  if (body.backup && typeof body.backup === 'object') {
    const def = DEFAULT_SETTINGS.backup;
    const prev = (s.backup && typeof s.backup === 'object') ? s.backup : {};
    const timeRaw = String(body.backup.time !== undefined ? body.backup.time : prev.time || def.time).trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(timeRaw);
    s.backup = {
      auto: !!body.backup.auto,
      time: m ? (String(m[1]).padStart(2, '0') + ':' + m[2]) : def.time,
      keep: Math.min(100, Math.max(1, Number(body.backup.keep !== undefined ? body.backup.keep : prev.keep) || def.keep))
    };
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

// ===== 服务器管理：本服务状态采集与自身重启 =====
const SERVER_STARTED_AT = Date.now(); // 进程启动时间（用于计算运行时长）

// 读取 serverControl 配置（settings.json 缺字段时回退默认值）
function readServerControl() {
  const def = DEFAULT_SETTINGS.serverControl;
  let sc = {};
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    if (raw && typeof raw.serverControl === 'object' && raw.serverControl) sc = raw.serverControl;
  } catch (e) {}
  const raw = sc.restartDelay !== undefined ? sc.restartDelay : def.restartDelay;
  return { restartDelay: Math.min(30, Math.max(0, Number(raw) || 0)) };
}

// 运行环境是否为容器（决定「重启服务」能否由外部守护自动拉起）
function inContainer() {
  try {
    if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) return true;
    const cg = fs.readFileSync('/proc/1/cgroup', 'utf-8');
    return /docker|containerd|kubepods|lxc/i.test(cg);
  } catch (e) {
    return false;
  }
}

// 是否被外部守护（容器 restart 策略 / PM2 / systemd），决定「重启服务」采用哪种方式
function hasSupervisor() {
  return inContainer() || !!process.env.pm_id || !!process.env.PM2_HOME || !!process.env.INVOCATION_ID;
}

function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (Math.round(v * 10) / 10) + ' ' + units[i];
}

function secondsToHuman(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d) parts.push(d + ' 天');
  if (h) parts.push(h + ' 小时');
  if (m) parts.push(m + ' 分');
  if (!d && !h) parts.push(s + ' 秒');
  return parts.join(' ');
}

// 统计目录占用（data 目录文件数量有限，递归开销可忽略）
function dirSize(dir) {
  let total = 0;
  try {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
      const p = path.join(dir, d.name);
      try {
        if (d.isDirectory()) total += dirSize(p);
        else total += fs.statSync(p).size;
      } catch (e) {}
    });
  } catch (e) {}
  return total;
}

// 汇总本服务运行状态（只读，供设置页展示）
function collectServerStatus() {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus() || [];
  const load = (typeof os.loadavg === 'function') ? os.loadavg() : [0, 0, 0];
  const procUp = Math.floor((Date.now() - SERVER_STARTED_AT) / 1000);
  const container = inContainer();
  const managed = hasSupervisor();
  const sc = readServerControl();
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    osName: (typeof os.type === 'function' ? os.type() : '') + ' ' + (typeof os.release === 'function' ? os.release() : ''),
    nodeVersion: process.version,
    pid: process.pid,
    port: PORT,
    cwd: process.cwd(),
    startedAt: new Date(SERVER_STARTED_AT).toISOString(),
    uptime: procUp,
    uptimeText: secondsToHuman(procUp),
    hostUptimeText: secondsToHuman(typeof os.uptime === 'function' ? os.uptime() : 0),
    cpuModel: cpus.length ? String(cpus[0].model || '').trim() : '',
    cpuCount: cpus.length,
    load1: Math.round((Number(load[0]) || 0) * 100) / 100,
    load5: Math.round((Number(load[1]) || 0) * 100) / 100,
    load15: Math.round((Number(load[2]) || 0) * 100) / 100,
    memUsed: totalMem - freeMem,
    memTotal: totalMem,
    memText: formatBytes(totalMem - freeMem) + ' / ' + formatBytes(totalMem),
    memPercent: totalMem ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0,
    procRssText: formatBytes(mem.rss),
    procHeapText: formatBytes(mem.heapUsed),
    dataSizeText: formatBytes(dirSize(dataDir)),
    container: container,
    supervisor: managed,       // 是否由 Docker / PM2 / systemd 托管
    restartDelay: sc.restartDelay
  };
}

// 重启本服务自身：
//  - 有外部守护时：退出进程，由守护（Docker restart 策略 / PM2 / systemd）自动拉起，最稳妥
//  - 无守护（手动 node server.js）时：派生一个独立助手进程，待端口释放后重新拉起自身
function restartService(delayMs) {
  if (hasSupervisor()) {
    setTimeout(() => process.exit(0), delayMs);
    return 'supervisor';
  }
  try {
    const helper = 'const{spawn}=require("child_process");setTimeout(function(){' +
      'var p=spawn(process.execPath,[process.argv[1]],{cwd:process.argv[2],detached:true,stdio:"ignore",env:process.env});p.unref();},' +
      delayMs + ');';
    const child = spawn(process.execPath, ['-e', helper, __filename, __dirname], {
      cwd: __dirname, detached: true, stdio: 'ignore', env: process.env
    });
    child.unref();
    setTimeout(() => process.exit(0), 200); // 助手已在等待，本进程可立即退出释放端口
    return 'self';
  } catch (e) {
    setTimeout(() => process.exit(0), delayMs);
    return 'exit';
  }
}

// ===== 操作审计日志 =====
const AUDIT_LIMIT = 3000; // 最多保留 3000 条，超出丢弃最旧
// 路径前缀 → 业务模块名（按前缀长度降序匹配，长的优先）
const AUDIT_MODULES = [
  ['/api/students/batch-assign', '学生档案 · 批量分班'],
  ['/api/students/batch-delete', '学生档案 · 批量删除'],
  ['/api/trash', '回收站'],
  ['/api/students', '学生档案'],
  ['/api/classes', '班级管理'],
  ['/api/grades', '年级管理'],
  ['/api/teachers', '教师管理'],
  ['/api/exams', '成绩管理'],
  ['/api/attendance', '考勤管理'],
  ['/api/conduct', '操行管理'],
  ['/api/leaves', '请假管理'],
  ['/api/announcements', '通知公告'],
  ['/api/timetables', '课程表'],
  ['/api/course-plans', '课程管理'],
  ['/api/dorm-apps', '宿舍管理 · 入住申请审核'],
  ['/api/dorms', '宿舍管理'],
  ['/api/allocate', '智能分班'],
  ['/api/live', '大屏直播'],
  ['/api/board', '分班大屏'],
  ['/api/settings', '系统设置'],
  ['/api/filters', '前端偏好'],
  ['/api/workbench', '工作台状态'],
  ['/api/users', '账号管理'],
  ['/api/backup', '数据备份'],
  ['/api/backups', '备份管理'],
  ['/api/restore', '数据恢复'],
  ['/api/server', '服务器管理'],
  ['/api/student/dorm', '学生端 · 住宿申请'],
  ['/api/student/leaves', '学生端 · 请假'],
  ['/api/student', '学生中心'],
  ['/api/teacher/leaves', '教师端 · 请假审批'],
  ['/api/teacher/profile', '教师端 · 完善个人信息'],
  ['/api/teacher', '教师中心']
].sort((a, b) => b[0].length - a[0].length);
const AUDIT_METHOD_LABEL = { POST: '新增', PUT: '更新', PATCH: '更新', DELETE: '删除' };
function auditModuleOf(pathname) {
  const hit = AUDIT_MODULES.find(m => pathname === m[0] || pathname.startsWith(m[0] + '/') || pathname.startsWith(m[0] + '?'));
  return hit ? hit[1] : pathname;
}
function readAudit() {
  try {
    const v = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function addAudit(rec) {
  try {
    const list = readAudit();
    list.unshift(Object.assign({ id: genId(), at: new Date().toISOString() }, rec));
    if (list.length > AUDIT_LIMIT) list.length = AUDIT_LIMIT;
    atomicWriteJson(AUDIT_FILE, list);
  } catch (e) {
    console.error('[审计日志写入失败]', e && e.message);
  }
}
// 在响应成功结束（2xx/3xx）后异步落盘一条审计记录；不含请求体，避免记录密码等敏感数据
function registerAudit(res, rec) {
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) addAudit(rec);
  });
}

// 共享请求处理函数: 两个 server 实例 (IPv4 / IPv6) 都通过它处理请求,
// 这样 Node.js 的 http.Server.listen() 多次调用限制 (ERR_SERVER_ALREADY_LISTEN)
// 就被规避, 各自独立绑定一个 socket.
function serverHandler(req, res) {
  Promise.resolve(handle(req, res)).catch(err => {
    console.error('[请求处理异常]', req.method, req.url, err);
    if (!res.headersSent) {
      try { sendJson(res, 500, { code: 1, msg: '服务器内部错误，请稍后重试' }); } catch (e) {}
    } else {
      try { res.end(); } catch (e) {}
    }
  });
}

const server = http.createServer(serverHandler);
const serverV6 = http.createServer(serverHandler);

// 进程级兜底：意外异常只记录日志，避免直接终止整个服务
process.on('unhandledRejection', (reason) => {
  console.error('[未处理的 Promise 异常]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[未捕获异常]', err);
});

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ===== 安全响应头（本系统为同源应用，不开放跨域）=====
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // 工作台以同源 iframe 嵌入各功能页
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self'"
  ].join('; '));
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
  // 学生自助端接口（独立会话，自行鉴权），不走后台权限闸门
  const isStudentApi = pathname.startsWith('/api/student/');
  // 教师自助端接口（独立会话，自行鉴权），不走后台权限闸门（注意与后台 /api/teachers 区分）
  const isTeacherApi = pathname.startsWith('/api/teacher/');
  // 个人偏好接口（前端筛选记忆 / 工作台页签状态）：不涉及业务数据，登录即可写，
  // 不按职位模块闸门拦截（否则教务 / 宿管 / 查看模式在功能页保存筛选会全部 403）
  const isPrefWrite = req.method !== 'GET'
    && (pathname === '/api/filters' || pathname === '/api/workbench');
  // 职位权限（可在「系统设置 → 职位权限」按模块勾选配置，默认值见 DEFAULT_SETTINGS）：
  // 教务（staff）/ 宿管（dorm）仅可写已授权模块的接口，其余一律只读；教师管理 / 智能分班 /
  // 系统设置 / 备份审计等仅限管理员，不开放配置。请假默认不对教务开放（审批由班主任在教师端完成）；
  // 宿舍默认仅宿管可写（教务、宿管权限严格独立，不做合并）。
  const POSITION_ROLES = [ROLES.STAFF, ROLES.DORM];
  if (pathname.startsWith('/api/') && !isAuthEndpoint && !isStudentApi && !isTeacherApi && !publicRead) {
    const u = authUser(req);
    if (!u) return sendJson(res, 401, { code: 1, msg: '登录已失效，请重新登录' });
    const roleCanWrite = POSITION_ROLES.indexOf(u.role) !== -1
      && positionWritable(u.role).some(k => {
        const m = PERMISSION_MODULES.find(x => x.key === k);
        return m && m.apis.some(p => pathname === p || pathname.startsWith(p + '/'));
      });
    if ((pathname === '/api/backup'
      || pathname === '/api/backups' || pathname.startsWith('/api/backups/')
      || pathname === '/api/audit') && u.role !== ROLES.ADMIN) {
      return sendJson(res, 403, { code: 1, msg: '备份与审计功能仅限管理员账号' });
    }
    if (req.method !== 'GET' && u.role !== ROLES.ADMIN && !roleCanWrite && !isPrefWrite) {
      const permNames = positionWritable(u.role)
        .map(k => (PERMISSION_MODULES.find(x => x.key === k) || {}).name).filter(Boolean).join('、');
      return sendJson(res, 403, {
        code: 1,
        msg: POSITION_ROLES.indexOf(u.role) !== -1
          ? (permNames
            ? '当前职位仅可管理：' + permNames + '（可在「系统设置 → 职位权限」调整），其余模块仅可查看'
            : '当前职位未获授权任何可管理模块（可在「系统设置 → 职位权限」调整），仅可查看')
          : '当前账号为「查看模式」，仅可查看，不能修改数据'
      });
    }
    // 审计：记录后台写操作（登录 / 改密等含敏感信息的接口不在此列，账号管理 /api/users 保留；
    // 个人偏好接口高频且无业务含义，不记录）
    if (req.method !== 'GET' && !isPrefWrite) {
      registerAudit(res, {
        actor: u.username,
        actorRole: u.role,
        method: req.method,
        module: auditModuleOf(pathname),
        path: pathname,
        ip: clientIp(req)
      });
    }
  }
  // 审计：学生端写操作（排除登录 / 退出 / 改密）
  if (isStudentApi && req.method !== 'GET'
    && pathname !== '/api/student/login' && pathname !== '/api/student/logout'
    && pathname !== '/api/student/password') {
    const su = authStudent(req);
    if (su) {
      registerAudit(res, {
        actor: su.name + '（学生 ' + su.username + '）',
        actorRole: ROLES.STUDENT,
        method: req.method,
        module: auditModuleOf(pathname),
        path: pathname,
        ip: clientIp(req)
      });
    }
  }

  // 审计：教师端写操作（排除登录 / 退出 / 改密）
  if (isTeacherApi && req.method !== 'GET'
    && pathname !== '/api/teacher/login' && pathname !== '/api/teacher/logout'
    && pathname !== '/api/teacher/password') {
    const ta = authTeacher(req);
    if (ta) {
      registerAudit(res, {
        actor: ta.name + '（教师 ' + ta.username + '）',
        actorRole: ROLES.TEACHER,
        method: req.method,
        module: auditModuleOf(pathname),
        path: pathname,
        ip: clientIp(req)
      });
    }
  }

  // ===== 登录认证 API =====
  // 账号密码登录（remember=true 时会话延长至 7 天）
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    if (username) {
      const locked = loginLockLeft(req, username);
      if (locked) return sendJson(res, 429, { code: 1, msg: lockMsg(locked) });
    }
    const user = findUser(username);
    if (!user || !verifyPassword(body.password, user.salt, user.hash)) {
      const left = username ? loginMarkFail(req, username) : 0;
      return sendJson(res, 401, { code: 1, msg: left ? lockMsg(left) : '账号或密码不正确' });
    }
    if (user.role === ROLES.STUDENT) {
      return sendJson(res, 403, { code: 1, msg: '该账号为学生账号，请前往「学生登录入口」登录' });
    }
    if (user.role === ROLES.TEACHER) {
      // 教务 / 宿管职位教师：允许登录管理后台（会话角色 = staff / dorm，仅可管理对应项目）
      const tea = findTeacherOfAuth({ username: user.u });
      const sessionRole = tea && isAcademicStaff(tea) ? ROLES.STAFF
        : tea && isDormStaff(tea) ? ROLES.DORM : null;
      if (sessionRole) {
        if (user.must) {
          return sendJson(res, 403, { code: 1, msg: '请先通过「教师登录入口」完成首次密码修改，再登录管理后台' });
        }
        loginMarkSuccess(req, username);
        const ttl = body.remember ? REMEMBER_SECONDS : SESSION_SECONDS;
        const token = makeToken(user.u, sessionRole, ttl);
        res.setHeader('Set-Cookie', cookieHeader(token, ttl));
        return sendJson(res, 200, {
          code: 0, msg: '登录成功（' + ROLE_LABEL[sessionRole] + '）',
          data: { username: user.u, role: sessionRole, nickname: user.nickname || '', label: ROLE_LABEL[sessionRole] }
        });
      }
      return sendJson(res, 403, { code: 1, msg: '该账号为教师账号，请前往「教师登录入口」登录' });
    }
    loginMarkSuccess(req, username);
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
    // writable：当前会话可写模块 key 列表（admin 全量、viewer 空、教务/宿管按职位权限设置），
    // 供前端按页面隐藏 / 显示写操作按钮（服务端仍以闸门拦截为准）
    const writable = u.role === ROLES.ADMIN
      ? PERMISSION_MODULES.map(m => m.key)
      : u.role === ROLES.VIEWER ? [] : positionWritable(u.role);
    return sendJson(res, 200, {
      code: 0,
      data: {
        username: u.username,
        role: u.role,
        nickname: (full && full.nickname) || '',
        label: ROLE_LABEL[u.role],
        writable
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
      // 学生 / 教师自助账号的角色不可在此修改（自助端会话与角色强绑定）
      if ((cur.role === ROLES.STUDENT || cur.role === ROLES.TEACHER)
        && (body.role === ROLES.VIEWER || body.role === ROLES.ADMIN)) {
        return sendJson(res, 400, { code: 1, msg: '学生 / 教师自助账号的角色不可修改' });
      }
      if (body.role === ROLES.VIEWER || body.role === ROLES.ADMIN) cur.role = body.role;
      if (typeof body.nickname === 'string') cur.nickname = body.nickname.trim().slice(0, 20);
      if (body.password) {
        if (!validPassword(body.password)) return sendJson(res, 400, { code: 1, msg: '密码需为 6～64 位字符' });
        cur.salt = crypto.randomBytes(16).toString('hex');
        cur.hash = hashPassword(body.password, cur.salt);
        // 学生 / 教师自助账号：重设为「初始默认密码」时恢复首次登录的强制改密状态，否则解除
        if (cur.role === ROLES.STUDENT || cur.role === ROLES.TEACHER) {
          let initPwd = '';
          if (cur.role === ROLES.STUDENT) initPwd = cur.u; // 学生初始密码 = 学号
          else initPwd = teacherInitPassword(findTeacherByNo(cur.u)); // 教师初始密码 = 身份证后 6 位
          cur.must = !!initPwd && body.password === initPwd;
        }
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
    // 同步清理该账号的工作台选项卡状态
    const wb = readWorkbench();
    if (wb[target]) {
      delete wb[target];
      writeWorkbench(wb);
    }
    return sendJson(res, 200, { code: 0, msg: '账号已删除' });
  }

  // ===== 学生自助端 API（全新学生入口，账号/初始密码均为学号）=====

  // 学生登录：账号 = 学号；首次登录密码 = 学号（无账号时自动建档），登录后强制修改密码
  if (pathname === '/api/student/login' && req.method === 'POST') {
    const body = await readBody(req);
    const no = String(body.username || '').trim();
    const pw = String(body.password || '');
    if (!no) return sendJson(res, 400, { code: 1, msg: '请输入学号' });
    const stu = findStudentByNo(no);
    if (!stu) return sendJson(res, 401, { code: 1, msg: '未查询到该学号的学生档案，请与学校核对' });
    const locked = loginLockLeft(req, no);
    if (locked) return sendJson(res, 429, { code: 1, msg: lockMsg(locked) });
    const exist = findUser(no);
    if (exist && exist.role !== ROLES.STUDENT) {
      return sendJson(res, 403, { code: 1, msg: '该学号与后台账号冲突，请联系管理员处理' });
    }
    const first = !exist;
    const ok = first ? (pw === no) : verifyPassword(pw, exist.salt, exist.hash);
    if (!ok) {
      const left = loginMarkFail(req, no);
      return sendJson(res, 401, {
        code: 1,
        msg: left ? lockMsg(left) : (first ? '首次登录请使用本人学号作为初始密码' : '学号或密码不正确，忘记密码请联系班主任重置')
      });
    }
    loginMarkSuccess(req, no);
    let user = exist;
    if (first) {
      const salt = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString();
      user = {
        u: no, salt,
        hash: hashPassword(no, salt),
        role: ROLES.STUDENT,
        sid: stu.id,
        name: stu.name,
        nickname: stu.name,
        must: true,               // 首次登录，需强制修改密码
        createdAt: now,
        updatedAt: now
      };
      const list = readUsers();
      list.push(user);
      writeUsers(list);
    } else if (user.sid !== stu.id || user.name !== stu.name) {
      // 后台维护学生档案后，同步最新姓名/档案 id
      user.sid = stu.id;
      user.name = stu.name;
      user.nickname = stu.name || user.nickname;
      user.updatedAt = new Date().toISOString();
      writeUsers(readUsers().map(x => (x.u === user.u ? user : x)));
    }
    const ttl = body.remember ? REMEMBER_SECONDS : SESSION_SECONDS;
    const token = makeToken(user.u, user.role, ttl);
    res.setHeader('Set-Cookie', studentCookieHeader(token, ttl));
    return sendJson(res, 200, {
      code: 0, msg: '登录成功',
      data: {
        username: user.u,
        name: stu.name,
        role: user.role,
        label: ROLE_LABEL[user.role] || '学生',
        must: !!user.must
      }
    });
  }

  // 学生端退出
  if (pathname === '/api/student/logout') {
    const t = parseCookies(req)[STUDENT_COOKIE];
    if (t) revokedTokens.add(t);
    res.setHeader('Set-Cookie', clearStudentCookieHeader());
    if (req.method === 'GET') return redirect(res, '/slogin.html');
    return sendJson(res, 200, { code: 0, msg: '已退出登录' });
  }

  // 学生端会话信息（强制改密状态 + 个人档案聚合，首次登录需强制改密）
  if (pathname === '/api/student/me' && req.method === 'GET') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生端' });
    const user = findUser(s.username);
    const stu = findStudentByNo(s.username);
    if (!user || !stu) {
      return sendJson(res, 200, {
        code: 0,
        data: {
          username: s.username,
          name: (user && user.name) || s.username,
          role: 'student', label: '学生',
          must: !!(user && user.must),
          gone: true,
          profile: null
        }
      });
    }
    return sendJson(res, 200, {
      code: 0,
      data: {
        username: s.username,
        name: stu.name || s.username,
        role: 'student', label: '学生',
        must: !!user.must,
        profile: buildStudentPortalHome(stu)
      }
    });
  }

  // 学生端修改密码：普通修改需验证旧密码；首次登录强制改密(must=true)直接设置新密码，无需旧密码
  if (pathname === '/api/student/password' && req.method === 'PUT') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生端' });
    const body = await readBody(req);
    const user = findUser(s.username);
    if (!user) return sendJson(res, 401, { code: 1, msg: '账号不存在，请重新登录' });
    const forced = !!user.must; // 处于强制改密状态时，登录时已用初始密码验证过身份
    if (!forced && !verifyPassword(body.oldPassword, user.salt, user.hash)) {
      return sendJson(res, 400, { code: 1, msg: '当前密码不正确' });
    }
    const np = String(body.newPassword || '');
    if (!validPassword(np)) return sendJson(res, 400, { code: 1, msg: '新密码需为 6～64 位字符' });
    if (np === user.u) return sendJson(res, 400, { code: 1, msg: '出于安全考虑，密码不能与学号相同，请重新设置' });
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = hashPassword(np, user.salt);
    user.must = false;
    user.updatedAt = new Date().toISOString();
    writeUsers(readUsers().map(x => (x.u === user.u ? user : x)));
    return sendJson(res, 200, { code: 0, msg: '密码修改成功，请妥善保管新密码' });
  }

  // 提交住宿申请（仅限性别相符且尚有空床的房间）
  if (pathname === '/api/student/dorm/apply' && req.method === 'POST') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生端' });
    const body = await readBody(req);
    const stu = findStudentByNo(s.username);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '未查询到学生档案' });
    const roomId = String(body.roomId || '');
    const room = readDorms().find(r => r.id === roomId);
    if (!room) return sendJson(res, 404, { code: 1, msg: '未找到该宿舍房间' });
    if (findDormOfStudent(stu.id)) {
      return sendJson(res, 400, { code: 1, msg: '您已安排宿舍，如需调换请先联系班主任或宿管' });
    }
    const apps = readDormApps();
    if (apps.some(a => String(a.sid) === String(stu.id) && a.status === 'pending')) {
      return sendJson(res, 400, { code: 1, msg: '您已有申请正在审核中，请耐心等待' });
    }
    if (!genderRoomAllowed(room, stu.gender)) {
      return sendJson(res, 400, {
        code: 1,
        msg: room.gender === 'male' ? '该房间为男生宿舍，仅限男生申请'
          : room.gender === 'female' ? '该房间为女生宿舍，仅限女生申请' : '该房间性别不匹配'
      });
    }
    if ((room.students || []).length >= (Number(room.capacity) || 1)) {
      return sendJson(res, 400, { code: 1, msg: '该房间床位已满，请选择其他房间' });
    }
    const now = new Date().toISOString();
    const app = {
      id: genId(),
      sid: stu.id,
      no: String(stu.studentId || ''),
      name: stu.name,
      grade: stu.grade || '',
      className: stu.className || '',
      roomId: room.id,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };
    apps.push(app);
    writeDormApps(apps);
    return sendJson(res, 200, { code: 0, msg: '申请已提交，请等待管理员/班主任审核', data: app });
  }

  // 撤销自己的住宿申请
  if (pathname === '/api/student/dorm/apply' && req.method === 'DELETE') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生端' });
    const stu = findStudentByNo(s.username);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '未查询到学生档案' });
    const list = readDormApps();
    const idx = list.findIndex(a => String(a.sid) === String(stu.id) && a.status === 'pending');
    if (idx === -1) return sendJson(res, 400, { code: 1, msg: '没有待审核的申请' });
    list.splice(idx, 1);
    writeDormApps(list);
    return sendJson(res, 200, { code: 0, msg: '申请已撤销' });
  }

  // ===== 教师自助端 API（教师入口，账号 = 工号，初始密码 = 身份证号后 6 位）=====

  // 教师登录：账号 = 工号；首次登录密码 = 身份证号后 6 位（无账号时自动建档），登录后强制修改密码
  if (pathname === '/api/teacher/login' && req.method === 'POST') {
    const body = await readBody(req);
    const no = String(body.username || '').trim();
    const pw = String(body.password || '');
    if (!no) return sendJson(res, 400, { code: 1, msg: '请输入工号' });
    const tea = findTeacherByNo(no);
    if (!tea) return sendJson(res, 401, { code: 1, msg: '未查询到该工号的教师档案，请与学校核对' });
    const initPwd = teacherInitPassword(tea);
    if (!initPwd) {
      return sendJson(res, 403, { code: 1, msg: '教师档案未登记身份证号，请联系管理员在「教师管理」中补录后再登录' });
    }
    const locked = loginLockLeft(req, no);
    if (locked) return sendJson(res, 429, { code: 1, msg: lockMsg(locked) });
    const exist = findUser(no);
    if (exist && exist.role !== ROLES.TEACHER) {
      return sendJson(res, 403, { code: 1, msg: '该工号与后台账号冲突，请联系管理员处理' });
    }
    const first = !exist;
    const ok = first ? (pw === initPwd) : verifyPassword(pw, exist.salt, exist.hash);
    if (!ok) {
      const left = loginMarkFail(req, no);
      return sendJson(res, 401, {
        code: 1,
        msg: left ? lockMsg(left) : (first ? '首次登录请使用本人身份证号后 6 位作为初始密码' : '工号或密码不正确，忘记密码请联系管理员重置')
      });
    }
    loginMarkSuccess(req, no);
    let user = exist;
    if (first) {
      const salt = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString();
      user = {
        u: no, salt,
        hash: hashPassword(initPwd, salt),
        role: ROLES.TEACHER,
        tid: tea.id,
        name: tea.name,
        nickname: tea.name,
        must: true,               // 首次登录，需强制修改密码
        createdAt: now,
        updatedAt: now
      };
      const list = readUsers();
      list.push(user);
      writeUsers(list);
    } else if (user.tid !== tea.id || user.name !== tea.name) {
      // 后台维护教师档案后，同步最新姓名/档案 id
      user.tid = tea.id;
      user.name = tea.name;
      user.nickname = tea.name || user.nickname;
      user.updatedAt = new Date().toISOString();
      writeUsers(readUsers().map(x => (x.u === user.u ? user : x)));
    }
    const ttl = body.remember ? REMEMBER_SECONDS : SESSION_SECONDS;
    const token = makeToken(user.u, user.role, ttl);
    res.setHeader('Set-Cookie', teacherCookieHeader(token, ttl));
    return sendJson(res, 200, {
      code: 0, msg: '登录成功',
      data: {
        username: user.u,
        name: tea.name,
        role: user.role,
        label: ROLE_LABEL[user.role] || '教师',
        must: !!user.must
      }
    });
  }

  // 教师端退出
  if (pathname === '/api/teacher/logout') {
    const t = parseCookies(req)[TEACHER_COOKIE];
    if (t) revokedTokens.add(t);
    res.setHeader('Set-Cookie', clearTeacherCookieHeader());
    if (req.method === 'GET') return redirect(res, '/tlogin.html');
    return sendJson(res, 200, { code: 0, msg: '已退出登录' });
  }

  // 教师端会话信息（强制改密状态 + 个人档案聚合）
  if (pathname === '/api/teacher/me' && req.method === 'GET') {
    const t = authTeacher(req);
    if (!t) return sendJson(res, 401, { code: 1, msg: '请先登录教师端' });
    const user = findUser(t.username);
    const teachers = readTeachers();
    const tea = teachers.find(x => x.id === (user && user.tid)) || teachers.find(x => String(x.teacherNo || '').trim() === t.username) || null;
    if (!user || !tea) {
      return sendJson(res, 200, {
        code: 0,
        data: {
          username: t.username,
          name: (user && user.name) || t.username,
          role: 'teacher', label: '教师',
          must: !!(user && user.must),
          gone: true,
          profile: null
        }
      });
    }
    return sendJson(res, 200, {
      code: 0,
      data: {
        username: t.username,
        name: tea.name || t.username,
        role: 'teacher', label: '教师',
        must: !!user.must,
        profile: buildTeacherPortalHome(tea)
      }
    });
  }

  // 教师端完善个人身份信息：性别 / 任教学科 / 职称 / 联系电话 / 入职年份
  // （工号、姓名、身份证号、班主任班级等关键身份由管理员在后台维护，教师不可自行修改）
  if (pathname === '/api/teacher/profile' && req.method === 'PUT') {
    const t = authTeacher(req);
    if (!t) return sendJson(res, 401, { code: 1, msg: '请先登录教师端' });
    const body = await readBody(req);
    const user = findUser(t.username);
    const teachers = readTeachers();
    let idx = user && user.tid ? teachers.findIndex(x => x.id === user.tid) : -1;
    if (idx === -1) idx = teachers.findIndex(x => String(x.teacherNo || '').trim() === t.username);
    if (!user || idx === -1) return sendJson(res, 404, { code: 1, msg: '教师档案不存在或已被删除，请联系管理员' });
    const cur = teachers[idx];
    if (body.gender !== undefined) cur.gender = body.gender === '女' ? '女' : '男';
    if (body.subject !== undefined) cur.subject = String(body.subject).trim().slice(0, 50);
    if (body.title !== undefined) cur.title = String(body.title).trim().slice(0, 30);
    if (body.phone !== undefined) cur.phone = String(body.phone).trim().slice(0, 30);
    if (body.joinYear !== undefined) cur.joinYear = String(body.joinYear).trim().slice(0, 10);
    if (body.ethnic !== undefined) cur.ethnic = String(body.ethnic).trim().slice(0, 20);
    if (body.hometown !== undefined) cur.hometown = String(body.hometown).trim().slice(0, 50);
    if (body.political !== undefined) cur.political = String(body.political).trim().slice(0, 20);
    if (body.education !== undefined) cur.education = String(body.education).trim().slice(0, 30);
    if (body.address !== undefined) cur.address = String(body.address).trim().slice(0, 100);
    if (body.emergencyName !== undefined) cur.emergencyName = String(body.emergencyName).trim().slice(0, 30);
    if (body.emergencyPhone !== undefined) cur.emergencyPhone = String(body.emergencyPhone).trim().slice(0, 30);
    writeTeachers(teachers);
    return sendJson(res, 200, { code: 0, msg: '个人信息已更新', data: buildTeacherPortalHome(cur) });
  }

  // 教师端修改密码：普通修改需验证旧密码；首次登录强制改密(must=true)直接设置新密码，无需旧密码
  if (pathname === '/api/teacher/password' && req.method === 'PUT') {
    const t = authTeacher(req);
    if (!t) return sendJson(res, 401, { code: 1, msg: '请先登录教师端' });
    const body = await readBody(req);
    const user = findUser(t.username);
    if (!user) return sendJson(res, 401, { code: 1, msg: '账号不存在，请重新登录' });
    const forced = !!user.must; // 处于强制改密状态时，登录时已用初始密码验证过身份
    if (!forced && !verifyPassword(body.oldPassword, user.salt, user.hash)) {
      return sendJson(res, 400, { code: 1, msg: '当前密码不正确' });
    }
    const np = String(body.newPassword || '');
    if (!validPassword(np)) return sendJson(res, 400, { code: 1, msg: '新密码需为 6～64 位字符' });
    if (np === user.u) return sendJson(res, 400, { code: 1, msg: '出于安全考虑，密码不能与工号相同，请重新设置' });
    const initPwd = teacherInitPassword(findTeacherByNo(user.u));
    if (initPwd && np === initPwd) {
      return sendJson(res, 400, { code: 1, msg: '出于安全考虑，密码不能与身份证号后 6 位相同，请重新设置' });
    }
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = hashPassword(np, user.salt);
    user.must = false;
    user.updatedAt = new Date().toISOString();
    writeUsers(readUsers().map(x => (x.u === user.u ? user : x)));
    return sendJson(res, 200, { code: 0, msg: '密码修改成功，请妥善保管新密码' });
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

  // 重置学生登录密码（管理端）：恢复「学号 = 初始密码」并进入首次登录强制改密状态
  // 放在通用 /api/students/:id PUT 之前拦截，避免被当作档案 id 处理
  const pwdResetMatch = pathname.match(/^\/api\/students\/([^/]+)\/password-reset$/);
  if (pwdResetMatch && req.method === 'PUT') {
    const stuId = pwdResetMatch[1];
    const pool = readStudents();
    let stu = pool.find(x => x.id === stuId) || null;
    if (!stu) {
      const cls = readClasses();
      for (let i = 0; i < cls.length && !stu; i++) {
        const s = (cls[i].students || []).find(x => x.id === stuId);
        if (s) stu = s;
      }
    }
    if (!stu) return sendJson(res, 404, { code: 1, msg: '未找到该学生档案' });
    const no = String(stu.studentId || '').trim();
    if (!no) return sendJson(res, 400, { code: 1, msg: '该学生缺少学号，无法重置账号密码' });
    const salt = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const users = readUsers();
    const idx = users.findIndex(x => x.u === no);
    if (idx >= 0) {
      if (users[idx].role !== ROLES.STUDENT) {
        return sendJson(res, 400, { code: 1, msg: `学号「${no}」已被后台账号占用，无法重置` });
      }
      const u = users[idx];
      u.salt = salt;
      u.hash = hashPassword(no, salt);
      u.must = true; // 重置后再次登录需强制设置个人密码
      u.sid = stu.id;
      u.name = stu.name || u.name;
      u.nickname = stu.name || u.nickname;
      u.updatedAt = now;
    } else {
      // 该生尚未建立登录账号：直接创建，同样以学号为初始密码
      users.push({
        u: no, salt,
        hash: hashPassword(no, salt),
        role: ROLES.STUDENT,
        sid: stu.id,
        name: stu.name,
        nickname: stu.name,
        must: true,
        createdAt: now,
        updatedAt: now
      });
    }
    writeUsers(users);
    return sendJson(res, 200, { code: 0, msg: `密码已重置为学号「${no}」，该生下次登录需重新设置个人密码` });
  }

  // 手动安排入班 / 转班（学生档案页）：从未分班学生或原班级移入目标班级，并校验年级一致性与班级容量
  const assignMatch = pathname.match(/^\/api\/students\/([^/]+)\/assign$/);
  if (assignMatch && req.method === 'POST') {
    const stuId = decodeURIComponent(assignMatch[1]);
    const body = await readBody(req);
    const classId = String(body.classId || '').trim();
    if (!classId) return sendJson(res, 400, { code: 1, msg: '请选择目标班级' });
    const classes = readClasses();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '目标班级不存在，请刷新后重试' });
    const students = readStudents();
    // 定位学生当前所在：优先未分班学生，其次各班名单
    let fromClass = null;
    let curStu = students.find(s => s.id === stuId) || null;
    if (!curStu) {
      for (const c of classes) {
        const hit = (c.students || []).find(s => s.id === stuId);
        if (hit) { fromClass = c; curStu = hit; break; }
      }
    }
    if (!curStu) return sendJson(res, 404, { code: 1, msg: '未找到该学生档案' });
    if (fromClass && fromClass.id === classId) {
      return sendJson(res, 200, { code: 0, msg: `「${curStu.name}」已在 ${cls.name}，无需调整` });
    }
    // 年级一致性：学生已设年级时，只能分入同年级班级
    const stuGrade = String(curStu.grade || '').trim();
    const clsGrade = String(cls.grade || '').trim();
    if (stuGrade && clsGrade && stuGrade !== clsGrade) {
      return sendJson(res, 400, { code: 1, msg: `该生年级为「${stuGrade}」，不能分入 ${clsGrade} 的「${cls.name}」` });
    }
    // 目标班级容量（若该生原在目标班则排除自身）
    const cap = Number(cls.capacity) || 0;
    const inTarget = (cls.students || []).some(s => s.id === stuId);
    if (cap > 0 && !inTarget && (cls.students || []).length >= cap) {
      return sendJson(res, 400, { code: 1, msg: `「${cls.name}」已满员（${cap}/${cap}），不能再安排学生` });
    }
    // 从原位置移出（未分班学生 / 原班级）
    if (fromClass) {
      fromClass.students = (fromClass.students || []).filter(s => s.id !== stuId);
    } else {
      const idx = students.findIndex(s => s.id === stuId);
      if (idx !== -1) students.splice(idx, 1);
    }
    // 以班级年级为准写入新名单
    const rec = normalizeStudent(Object.assign({}, curStu, { grade: clsGrade || curStu.grade || '' }));
    if (!cls.students) cls.students = [];
    cls.students.push(rec);
    writeClasses(classes);
    writeStudents(students);
    const msg = fromClass
      ? `已将「${curStu.name}」从 ${fromClass.name} 转入 ${cls.name}`
      : `已将「${curStu.name}」安排入 ${cls.name}`;
    return sendJson(res, 200, { code: 0, msg });
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

  // 学籍异动：更新学生状态（在籍 / 休学 / 退学 / 转出 / 毕业）并记录流水
  const statusMatch = pathname.match(/^\/api\/students\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'PUT') {
    const sid = statusMatch[1];
    const body = await readBody(req);
    const me = authUser(req);
    const VALID = ['active', 'leave', 'quit', 'transfer', 'graduate'];
    const LABEL = { active: '在籍', leave: '休学', quit: '退学', transfer: '转出', graduate: '毕业' };
    const next = String(body.status || '').trim();
    if (VALID.indexOf(next) === -1) return sendJson(res, 400, { code: 1, msg: '无效的学籍状态' });
    const note = String(body.note || '').trim().slice(0, 200);
    const now = new Date().toISOString();
    const apply = function (s) {
      const old = VALID.indexOf(s.status) !== -1 ? s.status : 'active';
      if (old === next) return false;
      s.status = next;
      if (!Array.isArray(s.history)) s.history = [];
      s.history.push({ at: now, from: LABEL[old], to: LABEL[next], note, op: (me && me.username) || '' });
      if (s.history.length > 200) s.history = s.history.slice(-200);
      return true;
    };
    const list = readStudents();
    const pi = list.findIndex(s => s.id === sid);
    if (pi !== -1) {
      if (!apply(list[pi])) return sendJson(res, 200, { code: 0, msg: '学籍状态未变化' });
      writeStudents(list);
      return sendJson(res, 200, { code: 0, data: { status: list[pi].status }, msg: '学籍状态已更新为「' + LABEL[next] + '」' });
    }
    const classes = readClasses();
    let hit = null;
    classes.forEach(function (c) {
      const s = (c.students || []).find(x => x.id === sid);
      if (s) hit = s;
    });
    if (!hit) return sendJson(res, 404, { code: 1, msg: '未找到该学生档案' });
    if (!apply(hit)) return sendJson(res, 200, { code: 0, msg: '学籍状态未变化' });
    writeClasses(classes);
    return sendJson(res, 200, { code: 0, data: { status: hit.status }, msg: '学籍状态已更新为「' + LABEL[next] + '」' });
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

  // 删除学生：移入回收站（未分班学生 / 班级名单 / 宿舍联动），可随时恢复
  if (pathname.startsWith('/api/students/') && req.method === 'DELETE') {
    const id = decodeURIComponent(pathname.split('/').pop());
    if (!id) return sendJson(res, 400, { code: 1, msg: '无效的学生编号' });
    const trash = readTrash();
    const now = new Date().toISOString();
    const list = readStudents();
    const pi = list.findIndex(s => s.id === id);
    if (pi !== -1) {
      const stu = list[pi];
      trash.push(Object.assign({}, stu, { deletedAt: now, deletedFrom: 'pool', sourceClassId: '', sourceClassName: '' }));
      list.splice(pi, 1);
      writeStudents(list);
      writeTrash(trash);
      removeFromDorms(id);
      return sendJson(res, 200, { code: 0, msg: '已将「' + (stu.name || id) + '」移入回收站，可在「回收站」中恢复' });
    }
    const classes = readClasses();
    for (const c of classes) {
      const si = (c.students || []).findIndex(s => s.id === id);
      if (si !== -1) {
        const stu = c.students[si];
        trash.push(Object.assign({}, stu, { deletedAt: now, deletedFrom: 'class', sourceClassId: c.id, sourceClassName: c.name }));
        c.students.splice(si, 1);
        writeClasses(classes);
        writeTrash(trash);
        removeFromDorms(id);
        return sendJson(res, 200, { code: 0, msg: '已将「' + (stu.name || id) + '」移入回收站并退出' + (c.name || '原班级') + '，可恢复' });
      }
    }
    return sendJson(res, 404, { code: 1, msg: '未找到该学生档案' });
  }

  // 批量删除学生：与单删一致，逐个移入回收站（未分班池 / 班级名单 / 宿舍联动），可恢复
  if (pathname === '/api/students/batch-delete' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return sendJson(res, 400, { code: 1, msg: '请选择要删除的学生' });
    const idSet = new Set(ids);
    const trash = readTrash();
    const now = new Date().toISOString();
    const removed = [];
    // 未分班学生
    const list = readStudents();
    const poolKeep = list.filter(s => {
      if (!idSet.has(String(s.id))) return true;
      trash.push(Object.assign({}, s, { deletedAt: now, deletedFrom: 'pool', sourceClassId: '', sourceClassName: '' }));
      removed.push(s);
      return false;
    });
    if (removed.length) writeStudents(poolKeep);
    // 各班花名册
    const classes = readClasses();
    let clsChanged = false;
    classes.forEach(c => {
      const before = (c.students || []).length;
      c.students = (c.students || []).filter(s => {
        if (!idSet.has(String(s.id))) return true;
        trash.push(Object.assign({}, s, { deletedAt: now, deletedFrom: 'class', sourceClassId: c.id, sourceClassName: c.name }));
        removed.push(s);
        return false;
      });
      if ((c.students || []).length !== before) clsChanged = true;
    });
    if (clsChanged) writeClasses(classes);
    if (!removed.length) return sendJson(res, 404, { code: 1, msg: '未找到所选学生档案' });
    writeTrash(trash);
    removed.forEach(s => removeFromDorms(s.id));
    return sendJson(res, 200, {
      code: 0,
      msg: `已将 ${removed.length} 名学生移入回收站（含自动退宿），可在回收站中恢复`,
      data: { removed: removed.length }
    });
  }

  // 批量分班：逐个校验年级一致性与班级剩余容量后统一安排入班（已在目标班的自动跳过）
  if (pathname === '/api/students/batch-assign' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    const classId = String(body.classId || '').trim();
    if (!ids.length) return sendJson(res, 400, { code: 1, msg: '请选择要分班的学生' });
    if (!classId) return sendJson(res, 400, { code: 1, msg: '请选择目标班级' });
    const classes = readClasses();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '目标班级不存在，请刷新后重试' });
    const clsGrade = String(cls.grade || '').trim();
    const pool = readStudents();
    // 定位每个所选学生的当前档案（未分班池优先，其次各班名单）
    const picked = [];
    ids.forEach(id => {
      let stu = pool.find(s => String(s.id) === id) || null;
      if (!stu) {
        for (const c of classes) {
          const hit = (c.students || []).find(s => String(s.id) === id);
          if (hit) { stu = hit; break; }
        }
      }
      if (stu) picked.push(stu);
    });
    if (!picked.length) return sendJson(res, 404, { code: 1, msg: '未找到所选学生档案' });
    const inTarget = new Set((cls.students || []).map(s => String(s.id)));
    // 年级一致性校验：学生已设年级时必须与目标班级年级一致
    const ok = [];
    const skipped = [];
    picked.forEach(stu => {
      const stuGrade = String(stu.grade || '').trim();
      if (stuGrade && clsGrade && stuGrade !== clsGrade) {
        skipped.push(`「${stu.name || stu.id}」（${stuGrade}）`);
        return;
      }
      ok.push(stu);
    });
    if (!ok.length) {
      return sendJson(res, 400, {
        code: 1,
        msg: `所选学生年级与「${cls.name}」（${clsGrade || '未设年级'}）不一致，无法批量分班`
      });
    }
    const okSet = new Set(ok.map(s => String(s.id)));
    const newIds = ok.filter(s => !inTarget.has(String(s.id)));
    // 容量校验：目标班现有 + 本次新增（已在目标班的不计入）
    const cap = Number(cls.capacity) || 0;
    const cur = (cls.students || []).length;
    if (cap > 0 && cur + newIds.length > cap) {
      return sendJson(res, 400, {
        code: 1,
        msg: `「${cls.name}」容量不足（现有 ${cur}/${cap}，本次需再安排 ${newIds.length} 人），请先调整班级容量或减少人数`
      });
    }
    if (!newIds.length) {
      return sendJson(res, 200, { code: 0, msg: `所选学生均已在「${cls.name}」，无需调整`, data: { moved: 0, skipped: skipped.length } });
    }
    // 从未分班池与其它班级名单中移出
    writeStudents(pool.filter(s => !okSet.has(String(s.id))));
    classes.forEach(c => {
      if (c.id === classId) return;
      c.students = (c.students || []).filter(s => !okSet.has(String(s.id)));
    });
    // 写入目标班级名单
    if (!cls.students) cls.students = [];
    ok.forEach(stu => {
      if (inTarget.has(String(stu.id))) return; // 已在目标班，无需重复
      const rec = normalizeStudent(Object.assign({}, stu, { grade: clsGrade || stu.grade || '' }));
      rec.id = stu.id;
      cls.students.push(rec);
    });
    writeClasses(classes);
    let msg = `已将 ${newIds.length} 名学生安排入「${cls.name}」`;
    if (skipped.length) msg += `；另有 ${skipped.length} 名因年级不符被跳过：${skipped.slice(0, 5).join('、')}${skipped.length > 5 ? ' 等' : ''}`;
    return sendJson(res, 200, { code: 0, msg, data: { moved: newIds.length, skipped: skipped.length } });
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

  // 清空所有学生：未分班学生与各班花名册一并移入回收站（班级本身保留，可恢复；避免「清空学生」后名单里还残留已分班学生）
  if (pathname === '/api/students' && req.method === 'DELETE') {
    const trash = readTrash();
    const now = new Date().toISOString();
    const list = readStudents();
    list.forEach(s => trash.push(Object.assign({}, s, { deletedAt: now, deletedFrom: 'pool', sourceClassId: '', sourceClassName: '' })));
    writeStudents([]);
    const classes = readClasses();
    classes.forEach(c => (c.students || []).forEach(s => trash.push(Object.assign({}, s, { deletedAt: now, deletedFrom: 'class', sourceClassId: c.id, sourceClassName: c.name }))));
    classes.forEach(c => { c.students = []; });
    writeClasses(classes);
    writeTrash(trash);
    // 联动清理：退宿 + 操行记录
    writeDorms(readDorms().map(r => Object.assign({}, r, { students: [] })));
    writeConduct([]);
    return sendJson(res, 200, { code: 0, msg: '已清空（全部学生已进入回收站，可在回收站中恢复）' });
  }

  // 班主任同步：以班级 headTeacher（教师姓名）为准校正教师档案的 classId，
  // 使「班级管理」中选定的班主任与教师档案保持一致（与教师管理「任班主任」互为入口）。
  // 一位教师只能担任一个班的班主任，原班归属会被同步解除。
  function syncClassHeadTeacher(classId) {
    const classes = readClasses();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return;
    const headName = cls.headTeacher || '';
    const teachers = readTeachers();
    let clsChanged = false;
    let teaChanged = false;
    // 解除不再担任本班班主任的教师
    teachers.forEach(t => {
      if (t.classId === classId && t.name !== headName) {
        t.classId = '';
        teaChanged = true;
      }
    });
    // 将新任班主任教师（按姓名匹配）关联到本班；若其原在别班，先解除别班
    if (headName) {
      const t = teachers.find(x => x.name === headName);
      if (t && t.classId !== classId) {
        if (t.classId) {
          const oldCls = classes.find(c => c.id === t.classId);
          if (oldCls && oldCls.headTeacher === t.name) {
            oldCls.headTeacher = '';
            clsChanged = true;
          }
        }
        t.classId = classId;
        teaChanged = true;
      }
    }
    if (teaChanged) writeTeachers(teachers);
    if (clsChanged) writeClasses(classes);
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
    syncClassHeadTeacher(cls.id); // 同步教师档案中的班主任归属
    return sendJson(res, 200, { code: 0, data: cls });
  }

  // 批量新增班级：按「年级 + 序号 + 班」一次生成多个（如 高一1班 ~ 高一6班），同名自动跳过
  if (pathname === '/api/classes/batch' && req.method === 'POST') {
    const body = await readBody(req);
    const grade = String(body.grade || '').trim();
    if (!grade) return sendJson(res, 400, { code: 1, msg: '请选择年级' });
    const start = Math.max(1, Math.min(99, parseInt(body.start, 10) || 1));
    const count = Math.max(1, Math.min(60, parseInt(body.count, 10) || 1));
    const capacity = Number(body.capacity) || 50;
    const list = readClasses();
    const existNames = new Set(list.map(c => String(c.name || '').trim()));
    const created = [];
    const skipped = [];
    for (let i = 0; i < count; i++) {
      const name = grade + (start + i) + '班';
      if (existNames.has(name)) { skipped.push(name); continue; }
      let id = genId();
      while (list.some(c => c.id === id)) id = genId();
      const cls = { id, name, grade, headTeacher: '', capacity, students: [] };
      list.push(cls);
      existNames.add(name);
      created.push(cls);
    }
    if (created.length) writeClasses(list);
    const msg = skipped.length
      ? `已添加 ${created.length} 个班级，${skipped.length} 个同名班级已跳过`
      : `已添加 ${created.length} 个班级`;
    return sendJson(res, 200, { code: 0, data: { created, skipped }, msg });
  }

  // 更新班级内某位已分班学生（直接编辑名单里的学生，无需先退回未分班）
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
    // 学号全局查重（未分班学生 + 全部班级名单，排除自身）
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
    const nextGrade = body.grade !== undefined ? body.grade : list[idx].grade;
    const gradeChanged = nextGrade !== list[idx].grade;
    list[idx] = {
      ...list[idx],
      name: body.name !== undefined ? body.name.trim() : list[idx].name,
      grade: nextGrade,
      headTeacher: body.headTeacher !== undefined ? body.headTeacher.trim() : list[idx].headTeacher,
      capacity: body.capacity !== undefined ? Number(body.capacity) : list[idx].capacity
    };
    // 年级变动：班级内学生 grade 字段一并同步，避免"班级高一/学生高二"出现
    if (gradeChanged) {
      (list[idx].students || []).forEach(s => { s.grade = nextGrade; });
    }
    writeClasses(list);
    syncClassHeadTeacher(id); // 班主任变更后同步教师档案中的归属
    // 课表数据中该班的 grade 字段跟着同步（供多端读取保持一致）
    if (gradeChanged) {
      const timetables = readTimetables();
      if (timetables.tables[id]) {
        timetables.tables[id].grade = nextGrade;
        writeTimetables(timetables);
      }
    }
    return sendJson(res, 200, { code: 0, data: readClasses().find(c => c.id === id) });
  }

  // 删除班级（要求班级内已无学生，需先将学生退回未分班）
  if (pathname.startsWith('/api/classes/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const classes = readClasses();
    const cls = classes.find(c => c.id === id);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '班级不存在' });
    const cnt = (cls.students || []).length;
    if (cnt) {
      return sendJson(res, 400, {
        code: 1,
        msg: `「${cls.name}」内还有 ${cnt} 名学生，请先在花名册中「全部退回」后再删除班级`
      });
    }
    writeClasses(classes.filter(c => c.id !== id));
    // 解除该班班主任教师在教师档案中的归属
    const teachers = readTeachers();
    if (teachers.some(t => t.classId === id)) {
      teachers.forEach(t => { if (t.classId === id) t.classId = ''; });
      writeTeachers(teachers);
    }
    return sendJson(res, 200, { code: 0, msg: '已删除' });
  }

  // 批量删除班级（要求所选班级内均已无学生）
  if (pathname === '/api/classes/batch-delete' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return sendJson(res, 400, { code: 1, msg: '请选择要删除的班级' });
    const idSet = new Set(ids);
    const classes = readClasses();
    const hit = classes.filter(c => idSet.has(c.id));
    if (!hit.length) return sendJson(res, 404, { code: 1, msg: '所选班级均不存在' });
    // 班级内仍有学生时不允许删除，需先将学生退回未分班
    const blocked = hit.filter(c => (c.students || []).length);
    if (blocked.length) {
      const detail = blocked.slice(0, 3).map(c => `「${c.name}」（${c.students.length} 人）`).join('、')
        + (blocked.length > 3 ? ` 等 ${blocked.length} 个班级` : '');
      return sendJson(res, 400, {
        code: 1,
        msg: `${detail}内还有学生，请先在花名册中「全部退回」后再删除班级`
      });
    }
    writeClasses(classes.filter(c => !idSet.has(c.id)));
    // 解除这些班级班主任教师在教师档案中的归属
    const teachers = readTeachers();
    if (teachers.some(t => idSet.has(t.classId))) {
      teachers.forEach(t => { if (idSet.has(t.classId)) t.classId = ''; });
      writeTeachers(teachers);
    }
    return sendJson(res, 200, { code: 0, msg: `已删除 ${hit.length} 个班级`, data: { removed: hit.length } });
  }

  // 清空所有班级（学生退回未分班）
  if (pathname === '/api/classes' && req.method === 'DELETE') {
    const classes = readClasses();
    const students = readStudents();
    classes.forEach(c => {
      if (c.students && c.students.length) students.push(...c.students);
    });
    writeClasses([]);
    writeStudents(students);
    // 清空全部教师档案中的班主任归属
    const teachers = readTeachers();
    if (teachers.some(t => t.classId)) {
      teachers.forEach(t => { t.classId = ''; });
      writeTeachers(teachers);
    }
    return sendJson(res, 200, { code: 0, msg: '已清空所有班级，学生已退回未分班' });
  }

  // 整班学生全部退回未分班（班级保留）
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
    return sendJson(res, 200, { code: 0, msg: '已全部退回未分班' });
  }

  // 把单个学生从班级退回未分班
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
    return sendJson(res, 200, { code: 0, msg: '已退回未分班' });
  }

  // 批量入班：把未分班学生一次分入目标班级
  const batchMatch = pathname.match(/^\/api\/classes\/([^/]+)\/add$/);
  if (batchMatch && req.method === 'POST') {
    const classId = batchMatch[1];
    const body = await readBody(req);
    const wantIds = Array.isArray(body.studentIds)
      ? body.studentIds.map(s => String(s).trim()).filter(Boolean)
      : [];
    if (!wantIds.length) return sendJson(res, 400, { code: 1, msg: '请先勾选要入班的学生' });
    const classes = readClasses();
    const cls = classes.find(c => c.id === classId);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '班级不存在' });
    const pool = readStudents();
    const clsGrade = String(cls.grade || '').trim();
    const curCount = (cls.students || []).length;
    const cap = Number(cls.capacity) || 0;
    // 逐个定位并校验（只接受未分班学生）
    const picked = [];
    const invalid = [];
    const seen = new Set();
    for (const sid of wantIds) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      const stu = pool.find(s => s.id === sid);
      if (!stu) {
        invalid.push({ name: sid || '未知', reason: '不是未分班学生' });
        continue;
      }
      const stuGrade = String(stu.grade || '').trim();
      if (clsGrade && stuGrade && stuGrade !== clsGrade) {
        invalid.push({ name: stu.name || stu.studentId || sid, reason: `年级为「${stuGrade}」，与「${cls.name}」（${cls.grade}）不符` });
        continue;
      }
      picked.push(stu);
    }
    if (invalid.length) {
      const list = invalid.slice(0, 3).map(x => `${x.name}（${x.reason}）`).join('、');
      return sendJson(res, 400, { code: 1, msg: `有 ${invalid.length} 名学生无法加入：${list}${invalid.length > 3 ? ' 等' : ''}` });
    }
    const targetCount = curCount + picked.length;
    if (cap > 0 && targetCount > cap) {
      return sendJson(res, 400, { code: 1, msg: `「${cls.name}」容量不足：当前 ${curCount}/${cap}，还差 ${targetCount - cap} 个名额` });
    }
    // 写入：从未分班学生中移除 → 班级名单追加（未设年级的学生按班级年级补填）
    if (!cls.students) cls.students = [];
    const inClsIds = new Set(cls.students.map(s => s.id));
    let added = 0;
    for (const stu of picked) {
      if (inClsIds.has(stu.id)) continue;
      const rec = normalizeStudent(Object.assign({}, stu, { grade: clsGrade || stu.grade || '' }));
      cls.students.push(rec);
      const pi = pool.findIndex(p => p.id === stu.id);
      if (pi !== -1) pool.splice(pi, 1);
      added++;
    }
    writeClasses(classes);
    writeStudents(pool);
    return sendJson(res, 200, { code: 0, msg: `已将 ${added} 名学生分入「${cls.name}」`, data: { added, count: cls.students.length } });
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

  // 删除年级（要求该年级下已无班级，需先删除班级）
  if (pathname.startsWith('/api/grades/') && req.method === 'DELETE') {
    const name = decodeURIComponent(pathname.split('/').pop());
    const grades = readGrades();
    const idx = grades.indexOf(name);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '年级不存在' });
    // 年级下仍有班级时不允许删除，需先删除这些班级
    const gradeClasses = readClasses().filter(c => c.grade === name);
    if (gradeClasses.length) {
      return sendJson(res, 400, {
        code: 1,
        msg: `「${name}」下还有 ${gradeClasses.length} 个班级，请先在班级管理中删除这些班级后再删除年级`
      });
    }
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
    // 同步清理：课程计划中该年级键 / 课表中残留条目（前置条件：年级下已无班级）
    const plans = readCoursePlans();
    if (Object.prototype.hasOwnProperty.call(plans, name)) {
      delete plans[name];
      writeCoursePlans(plans);
    }
    const timetables = readTimetables();
    let ttChanged = false;
    Object.keys(timetables.tables || {}).forEach(cid => {
      if (timetables.tables[cid] && timetables.tables[cid].grade === name) {
        delete timetables.tables[cid];
        ttChanged = true;
      }
    });
    if (ttChanged) writeTimetables(timetables);
    return sendJson(res, 200, { code: 0, msg: '已删除' });
  }

  // 批量删除年级（所选年级下学生 / 班级 / 考试 / 考勤的年级字段一并清空）
  if (pathname === '/api/grades/batch-delete' && req.method === 'POST') {
    const body = await readBody(req);
    const names = Array.isArray(body.names)
      ? [...new Set(body.names.map(n => String(n).trim()).filter(Boolean))]
      : [];
    if (!names.length) return sendJson(res, 400, { code: 1, msg: '请选择要删除的年级' });
    const grades = readGrades();
    const hit = names.filter(n => grades.includes(n));
    if (!hit.length) return sendJson(res, 404, { code: 1, msg: '所选年级均不存在' });
    // 年级下仍有班级时不允许删除，需先删除这些班级
    const classes = readClasses();
    const blocked = hit.filter(n => classes.some(c => c.grade === n));
    if (blocked.length) {
      const detail = blocked.slice(0, 3)
        .map(n => `「${n}」（${classes.filter(c => c.grade === n).length} 个班级）`).join('、')
        + (blocked.length > 3 ? ` 等 ${blocked.length} 个年级` : '');
      return sendJson(res, 400, {
        code: 1,
        msg: `${detail}下还有班级，请先在班级管理中删除这些班级后再删除年级`
      });
    }
    const nameSet = new Set(hit);
    writeGrades(grades.filter(g => !nameSet.has(g)));
    const students = readStudents();
    students.forEach(s => { if (nameSet.has(s.grade)) s.grade = ''; });
    writeStudents(students);
    classes.forEach(c => { if (nameSet.has(c.grade)) c.grade = ''; });
    writeClasses(classes);
    writeExams(readExams().map(x => Object.assign({}, x, { grade: nameSet.has(x.grade) ? '' : x.grade })));
    writeAttendance(readAttendance().map(x => Object.assign({}, x, { grade: nameSet.has(x.grade) ? '' : x.grade })));
    // 同步清理：课程计划中各年级键 / 课表中残留条目
    const plans = readCoursePlans();
    let plansChanged = false;
    nameSet.forEach(n => {
      if (Object.prototype.hasOwnProperty.call(plans, n)) { delete plans[n]; plansChanged = true; }
    });
    if (plansChanged) writeCoursePlans(plans);
    const timetables = readTimetables();
    let ttChanged = false;
    Object.keys(timetables.tables || {}).forEach(cid => {
      if (timetables.tables[cid] && nameSet.has(timetables.tables[cid].grade)) {
        delete timetables.tables[cid];
        ttChanged = true;
      }
    });
    if (ttChanged) writeTimetables(timetables);
    return sendJson(res, 200, { code: 0, msg: `已删除 ${hit.length} 个年级`, data: { removed: hit } });
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
    const oldName = list[idx].name;
    list[idx] = normalizeTeacher(Object.assign({}, list[idx], body));
    if (!list[idx].name) return sendJson(res, 400, { code: 1, msg: '教师姓名不能为空' });
    // 改名联动：把仍以旧姓名作为班主任的班级同步更新为新姓名
    if (oldName && list[idx].name !== oldName) {
      const classes = readClasses();
      let clsChanged = false;
      classes.forEach(c => {
        if (c.headTeacher === oldName) {
          c.headTeacher = list[idx].name;
          clsChanged = true;
        }
      });
      if (clsChanged) writeClasses(classes);
    }
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
    const touchedIds = [];
    const apply = (s) => {
      if (want && !want.has(String(s.id))) return;
      const rec = x.records && x.records[String(s.id)];
      if (!rec) return;
      s.scores = s.scores || {};
      Object.keys(rec).forEach(k => { s.scores[k] = Math.max(0, Number(rec[k]) || 0); });
      updated++;
      if (touchedIds.indexOf(String(s.id)) === -1) touchedIds.push(String(s.id));
    };
    const pool = readStudents();
    pool.forEach(apply);
    writeStudents(pool);
    const classes = readClasses();
    classes.forEach(c => (c.students || []).forEach(apply));
    writeClasses(classes);
    // 事务通知：档案成绩被该场考试更新过的学生
    notifyBatch(touchedIds.map(sid => ({
      sid: sid, type: 'score', title: '成绩已更新',
      body: '「' + x.name + '」的成绩已同步到你的档案成绩。'
    })));
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
    // 事务通知：操行（奖励 / 处分 / 评语）记录推送学生
    notifyStudent(studentId, 'conduct', '操行记录更新',
      item.date + ' 新增「' + (CONDUCT_TYPE[item.type] || '记录') + '」：' + item.title +
      (item.detail ? '（' + item.detail + '）' : ''));
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

  // 学生住宿申请（列表/审核），供宿舍管理与后台处理；GET 需后台登录，处理操作需管理员
  if (pathname === '/api/dorm-apps' && req.method === 'GET') {
    const statusFilter = String(new URL(req.url, 'http://x').searchParams.get('status') || 'pending');
    const list = readDormApps().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const counts = { pending: 0, approved: 0, rejected: 0 };
    const joined = list.map(a => {
      if (a.status && counts[a.status] !== undefined) counts[a.status]++;
      const r = readDorms().find(x => x.id === a.roomId);
      const v = roomView(r || {});
      return Object.assign({}, a, {
        building: r ? r.building : '（房间已删除）',
        roomNo: r ? r.roomNo : '-',
        roomCapacity: r ? v.capacity : 0,
        roomOccupied: r ? v.occupied : 0,
        roomFree: r ? v.free : 0,
        roomGender: r ? r.gender : ''
      });
    });
    const filtered = statusFilter === 'all' ? joined : joined.filter(x => x.status === statusFilter);
    return sendJson(res, 200, { code: 0, data: filtered, counts });
  }

  // 审核处理：approve 通过（安排入住）/ reject 不通过
  if (pathname.startsWith('/api/dorm-apps/') && req.method === 'POST') {
    const parts = pathname.split('/'); // ['', 'api', 'dorm-apps', id, action]
    const appId = parts[3];
    const action = parts[4];
    if (action !== 'approve' && action !== 'reject') {
      return sendJson(res, 404, { code: 1, msg: '接口不存在' });
    }
    const apps = readDormApps();
    const app = apps.find(a => a.id === appId && a.status === 'pending');
    if (!app) return sendJson(res, 404, { code: 1, msg: '申请不存在或已处理' });
    const now = new Date().toISOString();
    if (action === 'reject') {
      app.status = 'rejected';
      app.handledAt = now;
      app.updatedAt = now;
      notifyStudent(app.sid, 'dorm', '住宿申请未通过',
        '你提交的住宿申请未通过审核，如需入住可在学生中心重新选择房间提交申请。');
      writeDormApps(apps);
      return sendJson(res, 200, { code: 0, msg: '已驳回申请' });
    }
    // 通过：校验并安排入住
    const dorms = readDorms();
    const room = dorms.find(r => r.id === app.roomId);
    if (!room) return sendJson(res, 400, { code: 1, msg: '申请的宿舍房间已不存在，请改为不通过' });
    const stu = findStudentById(app.sid);
    if (!stu) return sendJson(res, 400, { code: 1, msg: '未找到该学生档案，无法安排入住' });
    if (!genderRoomAllowed(room, stu.gender)) {
      return sendJson(res, 400, {
        code: 1,
        msg: room.gender === 'male' ? '该房间为男生宿舍，与该学生性别不符'
          : room.gender === 'female' ? '该房间为女生宿舍，与该学生性别不符' : '该房间与该学生性别不符'
      });
    }
    const cap = Number(room.capacity) || 1;
    const occExcl = (room.students || []).filter(x => String(x) !== String(app.sid)).length;
    if (occExcl >= cap) return sendJson(res, 400, { code: 1, msg: '该房间床位已满，可先让申请人改选其他房间' });
    // 若学生当前住在其它房间则先移出，再安排至目标房间
    dorms.forEach(r => {
      r.students = (r.students || []).filter(x => String(x) !== String(app.sid));
    });
    const target = dorms.find(r => r.id === room.id);
    target.students.push(app.sid);
    writeDorms(dorms);
    app.status = 'approved';
    app.handledAt = now;
    app.updatedAt = now;
    notifyStudent(app.sid, 'dorm', '住宿申请已通过',
      '已为你安排入住 ' + (room.building || '') + ' ' + (room.roomNo || '') + '，可在学生中心「宿舍安排」查看床位。');
    writeDormApps(apps);
    return sendJson(res, 200, { code: 0, msg: '已通过：' + stu.name + ' 已安排入住 ' + (room.building || '') + (room.roomNo || '') });
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
    // 仅对本次新入住的学生发通知（原本已住本房间的不重复提醒）
    const addedIds = ids.filter(sid => !(r.students || []).some(x => String(x) === String(sid)));
    r.students = Array.from(new Set([...(r.students || []).filter(s => !ids.includes(String(s))), ...ids]));
    if (addedIds.length) {
      notifyBatch(addedIds.map(sid => ({
        sid: sid, type: 'dorm', title: '宿舍安排已更新',
        body: '你已被安排入住 ' + (r.building || '') + ' ' + (r.roomNo || '') + '，可在学生中心「宿舍安排」查看。'
      })));
    }
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
    notifyStudent(stuId, 'dorm', '已办理退宿',
      '你已从 ' + (r.building || '') + ' ' + (r.roomNo || '') + ' 退宿，如需重新入住可提交住宿申请。');
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
  // 提交分班结果：将学生从未分班学生移入对应班级
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

    // 从未分班学生移除已分配的学生
    const assignedIds = new Set();
    assignments.forEach(a => {
      (a.students || []).forEach(s => assignedIds.add(s.id));
    });
    const remaining = students.filter(s => !assignedIds.has(s.id));

    // 事务通知：告知每位被分入班级的学生
    const classNotes = [];
    assignments.forEach(a => {
      const cls = classes.find(c => c.id === a.classId);
      if (!cls) return;
      (a.students || []).forEach(s => classNotes.push({
        sid: s.id, type: 'class', title: '分班结果已更新',
        body: '你已被分入「' + cls.name + '」' + (cls.grade ? '（' + cls.grade + '）' : '') + '，可在学生中心「我的分班结果」查看。'
      }));
    });
    notifyBatch(classNotes);

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

  // 看板聚合数据：持久化班级 + 未分班学生 + 年级 + 实时快照 + 分班页当前年级，一次拉齐供大屏轮询
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

  // ===== 工作台选项卡状态 API（按账号分别记忆：打开页签/顺序/分屏）=====
  // 读取当前账号的工作台状态；从未保存过返回 data:null
  if (pathname === '/api/workbench' && req.method === 'GET') {
    const me = authUser(req);
    const map = readWorkbench();
    const st = (map && typeof map === 'object') ? map[me.username] : null;
    return sendJson(res, 200, { code: 0, data: st || null });
  }
  // 保存当前账号的工作台状态（写操作沿用全局角色限制：仅管理员可写）
  if (pathname === '/api/workbench' && (req.method === 'PUT' || req.method === 'POST')) {
    const me = authUser(req);
    const body = await readBody(req);
    const map = readWorkbench();
    map[me.username] = sanitizeWorkbenchState(body);
    writeWorkbench(map);
    return sendJson(res, 200, { code: 0, msg: '已保存', data: map[me.username] });
  }

  // ===== 系统设置 API =====
  if (pathname === '/api/settings' && req.method === 'GET') {
    const s = Object.assign({}, readSettings()); // 副本：version 不写入设置文件
    s.subjects = readSubjects(); // 始终返回生效科目
    s.version = APP_VERSION;     // 版本号（来自 package.json），供 [data-app-version] 渲染
    // 未登录（登录页 / 学生端 / 教师端 / 大屏等公开场景）仅返回品牌展示字段，
    // 避免向匿名访客泄露职位权限 / 备份策略 / 服务器控制等内部配置
    if (!authUser(req)) {
      const pub = {};
      ['schoolName', 'logoDataUrl', 'schoolYear', 'slogan', 'schoolAddress',
        'schoolPhone', 'schoolWebsite', 'subjects', 'version'].forEach(k => { pub[k] = s[k]; });
      return sendJson(res, 200, { code: 0, data: pub });
    }
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

  // ===== 服务器管理 API（仅管理员）=====
  // 运行状态：进程 / 系统 / 内存 / 负载 / 数据目录占用 / 是否容器托管
  if (pathname === '/api/server/status' && req.method === 'GET') {
    const u = authUser(req);
    if (!u || u.role !== ROLES.ADMIN) {
      return sendJson(res, 403, { code: 1, msg: '服务器管理仅限管理员账号' });
    }
    return sendJson(res, 200, { code: 0, data: collectServerStatus() });
  }

  // 重启本服务自身（不涉及宿主机 / 操作系统层面的重启或关机）
  if (pathname === '/api/server/restart' && req.method === 'POST') {
    const u = authUser(req);
    if (!u || u.role !== ROLES.ADMIN) {
      return sendJson(res, 403, { code: 1, msg: '服务器管理仅限管理员账号' });
    }
    const sc = readServerControl();
    const delayMs = Math.max(500, (Number(sc.restartDelay) || 0) * 1000);
    const delaySec = Math.round(delayMs / 1000);
    const mode = restartService(delayMs);
    sendJson(res, 200, {
      code: 0,
      data: { restarting: true, delay: delaySec, mode: mode },
      msg: mode === 'supervisor'
        ? '正在重启服务，约 ' + delaySec + ' 秒后自动恢复，请稍后刷新页面'
        : '正在重启服务，约 ' + delaySec + ' 秒后自动恢复；若长时间无法访问，请手动执行 node server.js'
    });
    return;
  }

  // 导出全量数据备份（下载 JSON 文件）
  if (pathname === '/api/backup' && req.method === 'GET') {
    const payload = buildBackupPayload();
    payload.kind = 'export';
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sms-backup-' + new Date().toISOString().slice(0, 10) + '.json"'
    });
    return res.end(body);
  }

  // ===== 服务器本地备份管理（仅管理员，闸门已校验角色）=====
  // 备份列表
  if (pathname === '/api/backups' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: listBackupFiles() });
  }
  // 立即在服务器本地生成一份备份
  if (pathname === '/api/backups' && req.method === 'POST') {
    const name = createBackupFile('manual');
    return sendJson(res, 200, { code: 0, data: { name }, msg: '备份已生成：' + name });
  }
  const backupItem = pathname.match(/^\/api\/backups\/(backup-\d{8}-\d{6}\.json)$/);
  if (backupItem && req.method === 'GET') {
    const fp = resolveBackupFile(decodeURIComponent(backupItem[1]));
    if (!fp || !fs.existsSync(fp)) return sendJson(res, 404, { code: 1, msg: '备份文件不存在' });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + path.basename(fp) + '"',
      'Cache-Control': 'no-cache'
    });
    return fs.createReadStream(fp).pipe(res);
  }
  if (backupItem && req.method === 'DELETE') {
    const fp = resolveBackupFile(decodeURIComponent(backupItem[1]));
    if (!fp || !fs.existsSync(fp)) return sendJson(res, 404, { code: 1, msg: '备份文件不存在' });
    fs.unlinkSync(fp);
    return sendJson(res, 200, { code: 0, msg: '备份已删除' });
  }

  // ===== 操作审计日志（仅管理员）=====
  if (pathname === '/api/audit' && req.method === 'GET') {
    const kw = String(url.searchParams.get('kw') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get('pageSize'), 10) || 20));
    let list = readAudit();
    if (kw) {
      list = list.filter(x => [x.actor, x.module, x.path, x.ip, x.method].some(v => String(v || '').toLowerCase().indexOf(kw) !== -1));
    }
    const total = list.length;
    const rows = list.slice((page - 1) * pageSize, page * pageSize);
    return sendJson(res, 200, { code: 0, data: { rows, total, page, pageSize } });
  }
  if (pathname === '/api/audit' && req.method === 'DELETE') {
    atomicWriteJson(AUDIT_FILE, []);
    return sendJson(res, 200, { code: 0, msg: '审计日志已清空' });
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
    if (Array.isArray(body.dormApps)) writeDormApps(body.dormApps);
    if (Array.isArray(body.leaves)) writeLeaves(body.leaves);
    if (Array.isArray(body.announcements)) writeAnnouncements(body.announcements);
    if (Array.isArray(body.trash)) writeTrash(body.trash);
    if (body.timetables && typeof body.timetables === 'object' && !Array.isArray(body.timetables)) writeTimetables(normalizeTimetables(body.timetables));
    if (Array.isArray(body.notifications)) writeNotifications(body.notifications);
    liveBoard = null;
    return sendJson(res, 200, { code: 0, msg: '恢复完成', classes: body.classes.length, students: body.students.length });
  }

  // ============ 补充模块：通知公告 · 请假管理 · 学生回收站 ============
  const LEAF_TYPES = ['病假', '事假', '公假', '其他'];
  const p2n = n => (n < 10 ? '0' + n : '' + n);
  const todayLocalStr = () => { const d = new Date(); return d.getFullYear() + '-' + p2n(d.getMonth() + 1) + '-' + p2n(d.getDate()); };
  const nextDateStr = ds => { const x = new Date(ds + 'T00:00:00'); x.setDate(x.getDate() + 1); return x.getFullYear() + '-' + p2n(x.getMonth() + 1) + '-' + p2n(x.getDate()); };
  const dateSeqArr = (start, end) => {
    if (!start || !end || String(start) > String(end)) return [];
    const out = [];
    let cur = String(start);
    let guard = 0;
    while (cur <= String(end) && guard < 1000) { out.push(cur); cur = nextDateStr(cur); guard++; }
    return out;
  };
  const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  // 审批通过 → 请假自动同步写入对应班级考勤（当天无考勤则新建；已有则不覆盖手工记录，只补漏）
  const applyLeaveToAttendance = function (leaf) {
    if (!leaf || !leaf.classId) return;
    const list = readAttendance();
    const days = dateSeqArr(leaf.startDate, leaf.endDate);
    let changed = false;
    const now = new Date().toISOString();
    days.forEach(function (d) {
      let doc = list.find(x => x.date === d && x.classId === leaf.classId);
      if (!doc) {
        doc = { id: genId(), date: d, grade: leaf.grade || '', classId: leaf.classId, className: leaf.className || '', records: [], updatedAt: now };
        list.unshift(doc);
        changed = true;
      }
      const recs = doc.records || [];
      if (!recs.some(r => String(r.id) === String(leaf.sid))) {
        recs.push({ id: String(leaf.sid), name: String(leaf.name || ''), status: 'leave' });
        doc.records = recs;
        doc.updatedAt = now;
        changed = true;
      }
    });
    if (changed) writeAttendance(list);
  };
  const validateLeavePayload = function (body) {
    const t = String(body.type || '').trim();
    if (LEAF_TYPES.indexOf(t) === -1) return '请假类型不正确';
    const s = String(body.startDate || '').trim();
    const e = String(body.endDate || '').trim();
    if (!isDateStr(s) || !isDateStr(e)) return '请假起止日期格式不正确';
    if (s > e) return '结束日期不能早于开始日期';
    return '';
  };

  // ---------- 通知公告（后台发布 / 编辑 / 删除）----------
  if (pathname === '/api/announcements' && req.method === 'GET') {
    const list = readAnnouncements().slice().sort((a, b) => (Number(b.pinned) || 0) - (Number(a.pinned) || 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return sendJson(res, 200, { code: 0, data: list });
  }
  if (pathname === '/api/announcements' && req.method === 'POST') {
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    if (!title) return sendJson(res, 400, { code: 1, msg: '请填写公告标题' });
    const content = String(body.content || '').trim();
    if (!content) return sendJson(res, 400, { code: 1, msg: '请填写公告内容' });
    const me = authUser(req);
    const now = new Date().toISOString();
    const item = {
      id: genId(),
      title: title.slice(0, 100),
      content,
      scopeType: ['all', 'grade', 'class'].indexOf(body.scopeType) !== -1 ? body.scopeType : 'all',
      scopeValue: String(body.scopeValue || '').trim().slice(0, 40),
      pinned: !!body.pinned,
      validTo: isDateStr(body.validTo) ? String(body.validTo).trim() : '',
      author: (me && (me.nickname || me.username)) || '管理员',
      createdAt: now,
      updatedAt: now
    };
    const list = readAnnouncements();
    list.unshift(item);
    writeAnnouncements(list);
    return sendJson(res, 200, { code: 0, data: item, msg: '公告已发布' });
  }
  const annMatch = pathname.match(/^\/api\/announcements\/([^/]+)$/);
  if (annMatch && req.method === 'DELETE') {
    const list = readAnnouncements();
    const idx = list.findIndex(a => a.id === annMatch[1]);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '公告不存在或已被删除' });
    list.splice(idx, 1);
    writeAnnouncements(list);
    return sendJson(res, 200, { code: 0, msg: '公告已删除' });
  }
  if (annMatch && req.method === 'PUT') {
    const body = await readBody(req);
    const list = readAnnouncements();
    const idx = list.findIndex(a => a.id === annMatch[1]);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '公告不存在或已被删除' });
    const a = list[idx];
    if (body.title !== undefined) a.title = String(body.title || '').trim().slice(0, 100);
    if (body.content !== undefined) a.content = String(body.content || '').trim();
    if (body.scopeType !== undefined && ['all', 'grade', 'class'].indexOf(body.scopeType) !== -1) a.scopeType = body.scopeType;
    if (body.scopeValue !== undefined) a.scopeValue = String(body.scopeValue || '').trim().slice(0, 40);
    if (body.pinned !== undefined) a.pinned = !!body.pinned;
    if (body.validTo !== undefined) a.validTo = isDateStr(body.validTo) ? String(body.validTo).trim() : '';
    a.updatedAt = new Date().toISOString();
    writeAnnouncements(list);
    return sendJson(res, 200, { code: 0, data: a, msg: '公告已更新' });
  }

  // ---------- 课程计划（各年级课程清单）----------
  if (pathname === '/api/course-plans' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: publicCoursePlans() });
  }
  // 保存/替换某年级的课程计划（整体覆盖式 PUT）
  const planMatch = pathname.match(/^\/api\/course-plans\/([^/]+)$/);
  if (planMatch && req.method === 'PUT') {
    const grade = decodeURIComponent(planMatch[1]).trim();
    const grades = readGrades();
    if (!grade || grades.indexOf(grade) === -1) {
      return sendJson(res, 404, { code: 1, msg: '年级不存在或已被删除，请先在「年级管理」中创建年级' });
    }
    const body = await readBody(req);
    const plan = normalizeCoursePlan(body);
    const all = readCoursePlans();
    all[grade] = plan;
    writeCoursePlans(all);
    return sendJson(res, 200, { code: 0, data: { grade, plan }, msg: '「' + grade + '」的课程计划已保存' });
  }
  // 删除某年级的课程计划（年级被删除时可显式调用清理文件）
  if (planMatch && req.method === 'DELETE') {
    const grade = decodeURIComponent(planMatch[1]).trim();
    const all = readCoursePlans();
    if (Object.prototype.hasOwnProperty.call(all, grade)) {
      delete all[grade];
      writeCoursePlans(all);
    }
    return sendJson(res, 200, { code: 0, msg: '「' + grade + '」的课程计划已删除' });
  }
  // 一键将某年级课程计划重置为内置默认（含所有常见科目）
  if (pathname.match(/^\/api\/course-plans\/[^/]+\/reset$/) && req.method === 'POST') {
    const grade = decodeURIComponent(pathname.split('/').slice(-2, -1)[0]).trim();
    const grades = readGrades();
    if (!grade || grades.indexOf(grade) === -1) {
      return sendJson(res, 404, { code: 1, msg: '年级不存在或已被删除' });
    }
    const defaults = defaultCoursePlansFor([grade]);
    const all = readCoursePlans();
    all[grade] = defaults[grade] || { courses: [] };
    writeCoursePlans(all);
    return sendJson(res, 200, { code: 0, data: { grade, plan: all[grade] }, msg: '已恢复「' + grade + '」的默认课程计划' });
  }

  // ---------- 课程表（后台：课表设置 / 按班级排课 / 复制 / 冲突检测）----------
  if (pathname === '/api/timetables' && req.method === 'GET') {
    const t = readTimetables();
    const classes = readClasses();
    const tables = classes.map(c => timetableClassView(t, c.id));
    Object.keys(t.tables).forEach(cid => {
      if (!classes.some(c => c.id === cid)) tables.push(timetableClassView(t, cid)); // 班级已删除的残留课表
    });
    return sendJson(res, 200, { code: 0, data: Object.assign(timetableMeta(t), { tables, conflicts: timetableConflicts(t) }) });
  }
  if (pathname === '/api/timetables/meta' && req.method === 'PUT') {
    const body = await readBody(req);
    const t = readTimetables();
    if (body.term !== undefined) t.term = String(body.term || '').trim().slice(0, 40);
    if (body.periods !== undefined) t.periods = normalizeTimetablePeriods(body.periods);
    if (body.days !== undefined) t.days = normalizeTimetableDays(body.days);
    // 节次 / 星期缩短后清理越界单元格，避免出现看不见的脏数据
    const daysSet = new Set(t.days);
    Object.keys(t.tables).forEach(cid => {
      const slots = t.tables[cid].slots || {};
      Object.keys(slots).forEach(k => {
        const m = /^([1-7])-(\d{1,2})$/.exec(k);
        if (!m || !daysSet.has(Number(m[1])) || Number(m[2]) > t.periods.length) delete slots[k];
      });
    });
    writeTimetables(t);
    return sendJson(res, 200, { code: 0, data: timetableMeta(t), msg: '课表设置已保存' });
  }
  if (pathname === '/api/timetables/copy' && req.method === 'POST') {
    const body = await readBody(req);
    const t = readTimetables();
    const classes = readClasses();
    const from = String(body.from || '');
    if (!classes.some(c => c.id === from)) return sendJson(res, 400, { code: 1, msg: '请选择有效的来源班级' });
    const src = t.tables[from];
    if (!src || !Object.keys(src.slots || {}).length) return sendJson(res, 400, { code: 1, msg: '来源班级还没有排课，无法复制' });
    let ids = Array.isArray(body.to) ? body.to.map(String) : [];
    if (!ids.length && body.grade) ids = classes.filter(c => (c.grade || '') === String(body.grade)).map(c => c.id);
    ids = ids.filter(id => id && id !== from && classes.some(c => c.id === id));
    if (!ids.length) return sendJson(res, 400, { code: 1, msg: '请选择要复制到的目标班级' });
    if (body.overwrite === false) {
      ids = ids.filter(id => !t.tables[id] || !Object.keys(t.tables[id].slots || {}).length);
    }
    if (!ids.length) return sendJson(res, 400, { code: 1, msg: '目标班级均已有课表，如需覆盖请勾选「覆盖已有课表」' });
    const now = new Date().toISOString();
    ids.forEach(id => {
      const cls = classes.find(c => c.id === id);
      t.tables[id] = {
        classId: id,
        className: cls.name,
        grade: cls.grade || '',
        slots: JSON.parse(JSON.stringify(src.slots)),
        updatedAt: now
      };
    });
    writeTimetables(t);
    return sendJson(res, 200, {
      code: 0,
      data: { copied: ids, conflicts: timetableConflicts(t) },
      msg: '已复制到 ' + ids.length + ' 个班级'
    });
  }
  const ttClassMatch = pathname.match(/^\/api\/timetables\/class\/([^/]+)$/);
  if (ttClassMatch && req.method === 'PUT') {
    const classId = decodeURIComponent(ttClassMatch[1]);
    const cls = readClasses().find(c => c.id === classId);
    if (!cls) return sendJson(res, 404, { code: 1, msg: '班级不存在或已被删除' });
    const body = await readBody(req);
    const t = readTimetables();
    const daysSet = new Set(t.days);
    const slots = {};
    const raw = normalizeTimetableSlots(body.slots);
    Object.keys(raw).forEach(k => {
      const parts = k.split('-');
      if (!daysSet.has(Number(parts[0])) || Number(parts[1]) > t.periods.length) return;
      slots[k] = raw[k];
    });
    const now = new Date().toISOString();
    t.tables[classId] = {
      classId,
      className: cls.name,
      grade: cls.grade || '',
      slots,
      updatedAt: now
    };
    writeTimetables(t);
    return sendJson(res, 200, {
      code: 0,
      data: { classId, slots, updatedAt: now, conflicts: timetableConflicts(t) },
      msg: '「' + cls.name + '」的课表已保存'
    });
  }
  if (ttClassMatch && req.method === 'DELETE') {
    const classId = decodeURIComponent(ttClassMatch[1]);
    const t = readTimetables();
    if (!t.tables[classId]) return sendJson(res, 404, { code: 1, msg: '该班级尚未排课' });
    delete t.tables[classId];
    writeTimetables(t);
    return sendJson(res, 200, { code: 0, msg: '该班级课表已清空' });
  }

  // ---------- 教师端：我的课表（只读，按教师工号/姓名跨班级汇总）----------
  if (pathname === '/api/teacher/timetable' && req.method === 'GET') {
    const t = authTeacher(req);
    if (!t) return sendJson(res, 401, { code: 1, msg: '请先登录教师端' });
    const tea = findTeacherOfAuth(t);
    if (!tea) return sendJson(res, 404, { code: 1, msg: '教师档案不存在或已被删除，请联系管理员' });
    const data = teacherTimetableOf(tea);
    data.teacher = { name: tea.name || '', teacherNo: tea.teacherNo || '', subject: tea.subject || '' };
    return sendJson(res, 200, { code: 0, data });
  }

  // ---------- 学生端：我的课表（只读，按本人所在班级展示）----------
  if (pathname === '/api/student/timetable' && req.method === 'GET') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生中心' });
    const stu = findStudentByNo(s.username);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '学生档案不存在或已被删除，请联系管理员' });
    const t = readTimetables();
    const view = stu.classId
      ? timetableClassView(t, stu.classId)
      : { classId: '', className: '', grade: '', exists: false, slots: {}, updatedAt: '' };
    return sendJson(res, 200, { code: 0, data: Object.assign(timetableMeta(t), view) });
  }

  // ---------- 请假管理（后台：列表 / 代登记 / 编辑 / 删除 / 审批）----------
  if (pathname === '/api/leaves' && req.method === 'GET') {
    const q = url.searchParams;
    const status = q.get('status') || '';
    const kw = (q.get('kw') || '').trim().toLowerCase();
    let list = readLeaves().slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (status) list = list.filter(x => x.status === status);
    if (kw) list = list.filter(x => [x.no, x.name, x.grade, x.className, x.type, x.reason, x.reviewNote].some(v => String(v || '').toLowerCase().includes(kw)));
    return sendJson(res, 200, { code: 0, data: list });
  }
  if (pathname === '/api/leaves' && req.method === 'POST') {
    const body = await readBody(req);
    const sid = String(body.studentId || '');
    const stu = sid ? findStudentById(sid) : null;
    if (!stu) return sendJson(res, 400, { code: 1, msg: '请选择请假学生' });
    const err = validateLeavePayload(body);
    if (err) return sendJson(res, 400, { code: 1, msg: err });
    const type = String(body.type).trim();
    const s = String(body.startDate).trim();
    const e = String(body.endDate).trim();
    const me = authUser(req);
    const now = new Date().toISOString();
    const item = {
      id: genId(),
      sid: stu.id,
      no: stu.studentId || '',
      name: stu.name || '',
      gender: stu.gender || '',
      grade: stu.grade || '',
      className: stu.className || '',
      classId: stu.classId || '',
      type,
      startDate: s,
      endDate: e,
      days: dateSeqArr(s, e).length,
      reason: String(body.reason || '').trim().slice(0, 300),
      status: 'pending',
      source: 'admin',
      submitter: (me && (me.nickname || me.username)) || '管理员',
      createdAt: now,
      updatedAt: now,
      reviewer: '',
      reviewNote: '',
      reviewedAt: ''
    };
    const list = readLeaves();
    list.unshift(item);
    writeLeaves(list);
    return sendJson(res, 200, { code: 0, data: item, msg: '已为「' + item.name + '」登记请假（待审批）' });
  }
  const leafReviewMatch = pathname.match(/^\/api\/leaves\/([^/]+)\/review$/);
  if (leafReviewMatch && req.method === 'POST') {
    const body = await readBody(req);
    const action = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : '';
    if (!action) return sendJson(res, 400, { code: 1, msg: '审批操作不正确' });
    const me = authUser(req);
    const list = readLeaves();
    const idx = list.findIndex(x => x.id === leafReviewMatch[1]);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '该请假申请不存在' });
    const leaf = list[idx];
    if (leaf.status !== 'pending') return sendJson(res, 400, { code: 1, msg: '该申请已处理，请勿重复审批' });
    leaf.status = action;
    leaf.reviewer = (me && (me.nickname || me.username)) || (me && me.username) || '';
    leaf.reviewNote = String(body.note || '').trim().slice(0, 200);
    leaf.reviewedAt = new Date().toISOString();
    leaf.updatedAt = leaf.reviewedAt;
    if (action === 'approved') applyLeaveToAttendance(leaf);
    // 事务通知：把审批结果推送到学生中心的消息通知
    notifyStudent(leaf.sid, 'leave',
      action === 'approved' ? '请假申请已通过' : '请假申请未通过',
      leaf.type + '：' + leaf.startDate + ' 至 ' + leaf.endDate + '（' + (leaf.days || 0) + ' 天）' +
      (action === 'approved' ? '，已批准' : '，未通过') +
      (leaf.reviewNote ? '。审批意见：' + leaf.reviewNote : ''));
    writeLeaves(list);
    return sendJson(res, 200, { code: 0, data: leaf, msg: action === 'approved' ? '已批准，请假已同步写入该班考勤' : '已驳回该请假申请' });
  }
  const leafMatch = pathname.match(/^\/api\/leaves\/([^/]+)$/);
  if (leafMatch && req.method === 'PUT') {
    const body = await readBody(req);
    const list = readLeaves();
    const idx = list.findIndex(x => x.id === leafMatch[1]);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '请假记录不存在' });
    const leaf = list[idx];
    if (leaf.status !== 'pending') return sendJson(res, 400, { code: 1, msg: '已处理的申请不可修改，如需变更请删除后重新登记' });
    if (body.type !== undefined && LEAF_TYPES.indexOf(String(body.type)) !== -1) leaf.type = String(body.type);
    const s = body.startDate !== undefined ? String(body.startDate).trim() : leaf.startDate;
    const e = body.endDate !== undefined ? String(body.endDate).trim() : leaf.endDate;
    if (isDateStr(s) && isDateStr(e) && s <= e) {
      leaf.startDate = s;
      leaf.endDate = e;
      leaf.days = dateSeqArr(s, e).length;
    }
    if (body.reason !== undefined) leaf.reason = String(body.reason || '').trim().slice(0, 300);
    leaf.updatedAt = new Date().toISOString();
    writeLeaves(list);
    return sendJson(res, 200, { code: 0, data: leaf, msg: '请假已更新' });
  }
  if (leafMatch && req.method === 'DELETE') {
    const list = readLeaves();
    const idx = list.findIndex(x => x.id === leafMatch[1]);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '请假记录不存在' });
    list.splice(idx, 1);
    writeLeaves(list);
    return sendJson(res, 200, { code: 0, msg: '请假记录已删除' });
  }

  // ---------- 教师端：班主任请假审批（仅可审批本班学生的申请）----------
  if (pathname === '/api/teacher/leaves' && req.method === 'GET') {
    const t = authTeacher(req);
    if (!t) return sendJson(res, 401, { code: 1, msg: '请先登录教师端' });
    const tea = findTeacherOfAuth(t);
    if (!tea) return sendJson(res, 404, { code: 1, msg: '教师档案不存在或已被删除，请联系管理员' });
    if (!tea.classId) return sendJson(res, 403, { code: 1, msg: '您目前不是班主任，暂无请假审批权限' });
    const q = url.searchParams;
    const status = q.get('status') || '';
    let list = readLeaves().filter(x => String(x.classId || '') === String(tea.classId))
      .sort((a, b) => {
        // 待审批优先，其余按提交时间倒序
        const rank = s => (s === 'pending' ? 0 : 1);
        return rank(a.status) - rank(b.status) || String(b.createdAt).localeCompare(String(a.createdAt));
      });
    if (status) list = list.filter(x => x.status === status);
    return sendJson(res, 200, { code: 0, data: list });
  }
  const tLeafReviewMatch = pathname.match(/^\/api\/teacher\/leaves\/([^/]+)\/review$/);
  if (tLeafReviewMatch && req.method === 'POST') {
    const t = authTeacher(req);
    if (!t) return sendJson(res, 401, { code: 1, msg: '请先登录教师端' });
    const tea = findTeacherOfAuth(t);
    if (!tea) return sendJson(res, 404, { code: 1, msg: '教师档案不存在或已被删除，请联系管理员' });
    if (!tea.classId) return sendJson(res, 403, { code: 1, msg: '您目前不是班主任，暂无请假审批权限' });
    const body = await readBody(req);
    const action = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : '';
    if (!action) return sendJson(res, 400, { code: 1, msg: '审批操作不正确' });
    const list = readLeaves();
    const idx = list.findIndex(x => x.id === tLeafReviewMatch[1]);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '该请假申请不存在' });
    const leaf = list[idx];
    if (String(leaf.classId || '') !== String(tea.classId)) {
      return sendJson(res, 403, { code: 1, msg: '该学生不在您负责的班级，无权审批' });
    }
    if (leaf.status !== 'pending') return sendJson(res, 400, { code: 1, msg: '该申请已处理，请勿重复审批' });
    leaf.status = action;
    leaf.reviewer = t.name + '（班主任）';
    leaf.reviewNote = String(body.note || '').trim().slice(0, 200);
    leaf.reviewedAt = new Date().toISOString();
    leaf.updatedAt = leaf.reviewedAt;
    if (action === 'approved') applyLeaveToAttendance(leaf);
    // 事务通知：把审批结果推送到学生中心的消息通知
    notifyStudent(leaf.sid, 'leave',
      action === 'approved' ? '请假申请已通过' : '请假申请未通过',
      leaf.type + '：' + leaf.startDate + ' 至 ' + leaf.endDate + '（' + (leaf.days || 0) + ' 天）'
        + (action === 'approved' ? '，班主任已批准' : '，班主任未通过')
        + (leaf.reviewNote ? '。审批意见：' + leaf.reviewNote : ''));
    writeLeaves(list);
    return sendJson(res, 200, {
      code: 0, data: leaf,
      msg: action === 'approved' ? '已批准，请假已同步写入该班考勤' : '已驳回该请假申请'
    });
  }

  // ---------- 学生回收站（后台：查看 / 恢复 / 彻底删除 / 清空）----------
  if (pathname === '/api/trash' && req.method === 'GET') {
    return sendJson(res, 200, { code: 0, data: readTrash() });
  }
  const trashRestoreMatch = pathname.match(/^\/api\/trash\/([^/]+)\/restore$/);
  if (trashRestoreMatch && req.method === 'POST') {
    const id = trashRestoreMatch[1];
    const trash = readTrash();
    const idx = trash.findIndex(t => t.id === id);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '回收站中不存在该学生' });
    const rec = trash[idx];
    const me = authUser(req) || {};
    const now = new Date().toISOString();
    let restoredInto = '';
    if (rec.sourceClassId) {
      const classes = readClasses();
      const cls = classes.find(c => c.id === rec.sourceClassId && String(c.grade || '') === String(rec.grade || ''));
      if (cls) {
        const occ = (cls.students || []).length;
        const cap = Number(cls.capacity) || 0;
        if (cap <= 0 || occ < cap) {
          const copy = Object.assign({}, rec);
          delete copy.deletedAt; delete copy.deletedFrom; delete copy.sourceClassId; delete copy.sourceClassName;
          copy.status = 'active';
          if (!Array.isArray(copy.history)) copy.history = [];
          copy.history.push({ at: now, from: '删除', to: '在籍', note: '从回收站恢复，回到 ' + cls.name, op: me.username || '' });
          if (!Array.isArray(cls.students)) cls.students = [];
          cls.students.push(copy);
          writeClasses(classes);
          restoredInto = cls.name;
        }
      }
    }
    if (!restoredInto) {
      const students = readStudents();
      const copy = Object.assign({}, rec);
      delete copy.deletedAt; delete copy.deletedFrom; delete copy.sourceClassId; delete copy.sourceClassName;
      copy.status = 'active';
      if (!Array.isArray(copy.history)) copy.history = [];
      copy.history.push({
        at: now, from: '删除', to: '在籍',
        note: rec.sourceClassName ? '从回收站恢复（原班 ' + rec.sourceClassName + ' 无法恢复，已回到未分班）' : '从回收站恢复',
        op: me.username || ''
      });
      students.push(copy);
      writeStudents(students);
      restoredInto = '未分班';
    }
    trash.splice(idx, 1);
    writeTrash(trash);
    return sendJson(res, 200, { code: 0, msg: '已恢复「' + (rec.name || '') + '」至' + restoredInto });
  }
  const trashPurgeMatch = pathname.match(/^\/api\/trash\/([^/]+)\/purge$/);
  if (trashPurgeMatch && req.method === 'POST') {
    const list = readTrash();
    const idx = list.findIndex(t => t.id === trashPurgeMatch[1]);
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '回收站中不存在该学生' });
    const name = list[idx].name || '';
    list.splice(idx, 1);
    writeTrash(list);
    return sendJson(res, 200, { code: 0, msg: '已彻底删除' + (name ? '「' + name + '」' : '该学生') + '，不可恢复' });
  }
  if (pathname === '/api/trash/clear' && req.method === 'POST') {
    const n = readTrash().length;
    writeTrash([]);
    return sendJson(res, 200, { code: 0, msg: '回收站已清空（' + n + ' 条）' });
  }

  // ---------- 学生自助端：查看我的公告 / 我的请假 / 在线请假 ----------
  if (pathname === '/api/student/announcements' && req.method === 'GET') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生中心' });
    const stu = findStudentByNo(s.username);
    const grade = (stu && stu.grade) || '';
    const className = (stu && stu.className) || '';
    const today = todayLocalStr();
    const list = readAnnouncements()
      .filter(function (a) {
        if (a.validTo && String(a.validTo) < today) return false;
        if (a.scopeType === 'grade') return !!grade && String(grade) === String(a.scopeValue);
        if (a.scopeType === 'class') return !!className && String(className) === String(a.scopeValue);
        return true;
      })
      .sort(function (a, b) { return (Number(b.pinned) || 0) - (Number(a.pinned) || 0) || String(b.createdAt).localeCompare(String(a.createdAt)); })
      .slice(0, 100)
      .map(function (a) {
        return {
          id: a.id,
          title: a.title,
          content: a.content,
          pinned: !!a.pinned,
          validTo: a.validTo || '',
          createdAt: a.createdAt,
          author: a.author || '',
          scopeLabel: a.scopeType === 'grade' ? '年级' : (a.scopeType === 'class' ? '班级' : '全校')
        };
      });
    return sendJson(res, 200, { code: 0, data: list });
  }
  // 我的消息通知：与本人相关的事务变化（请假审批 / 宿舍安排 / 分班结果 / 成绩 / 操行）
  if (pathname === '/api/student/notifications' && req.method === 'GET') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生中心' });
    const stu = findStudentByNo(s.username);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '未找到学生档案' });
    const mine = readNotifications()
      .filter(x => String(x.sid) === String(stu.id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return sendJson(res, 200, {
      code: 0,
      data: {
        list: mine.slice(0, 50),
        unread: mine.filter(x => !x.read).length,
        total: mine.length
      }
    });
  }
  // 标记消息已读：{ all: true } 全部已读；{ id } 单条已读
  if (pathname === '/api/student/notifications/read' && req.method === 'PUT') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生中心' });
    const stu = findStudentByNo(s.username);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '未找到学生档案' });
    const body = await readBody(req);
    const all = readNotifications();
    let n = 0;
    all.forEach(x => {
      if (String(x.sid) !== String(stu.id)) return;
      if (!body.all && String(x.id) !== String(body.id || '')) return;
      if (!x.read) { x.read = true; n++; }
    });
    if (n) writeNotifications(all);
    return sendJson(res, 200, { code: 0, read: n, msg: n ? '已标记 ' + n + ' 条为已读' : '没有未读消息' });
  }
  if (pathname === '/api/student/leaves' && req.method === 'GET') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生中心' });
    const stu = findStudentByNo(s.username);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '未找到学生档案' });
    const list = readLeaves().filter(x => x.sid === stu.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return sendJson(res, 200, { code: 0, data: list });
  }
  if (pathname === '/api/student/leaves' && req.method === 'POST') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生中心' });
    const stu = findStudentByNo(s.username);
    if (!stu) return sendJson(res, 404, { code: 1, msg: '未找到学生档案' });
    if (stu.status && stu.status !== 'active') return sendJson(res, 403, { code: 1, msg: '当前学籍状态（非在籍）不可在线请假，请联系班主任或管理员' });
    const body = await readBody(req);
    const err = validateLeavePayload(body);
    if (err) return sendJson(res, 400, { code: 1, msg: err });
    const type = String(body.type).trim();
    const s0 = String(body.startDate).trim();
    const e0 = String(body.endDate).trim();
    const now = new Date().toISOString();
    const dup = readLeaves().some(function (x) {
      return x.sid === stu.id && x.status === 'pending' && !(x.endDate < s0 || x.startDate > e0);
    });
    if (dup) return sendJson(res, 400, { code: 1, msg: '该时间段内已有待审批的请假申请，请勿重复提交' });
    const item = {
      id: genId(),
      sid: stu.id,
      no: stu.studentId || '',
      name: stu.name || '',
      gender: stu.gender || '',
      grade: stu.grade || '',
      className: stu.className || '',
      classId: stu.classId || '',
      type,
      startDate: s0,
      endDate: e0,
      days: dateSeqArr(s0, e0).length,
      reason: String(body.reason || '').trim().slice(0, 300),
      status: 'pending',
      source: 'student',
      submitter: stu.name || '',
      createdAt: now,
      updatedAt: now,
      reviewer: '',
      reviewNote: '',
      reviewedAt: ''
    };
    const list = readLeaves();
    list.unshift(item);
    writeLeaves(list);
    return sendJson(res, 200, { code: 0, data: item, msg: '请假申请已提交，等待班主任 / 管理员审批' });
  }
  const myLeafCancel = pathname.match(/^\/api\/student\/leaves\/([^/]+)$/);
  if (myLeafCancel && req.method === 'DELETE') {
    const s = authStudent(req);
    if (!s) return sendJson(res, 401, { code: 1, msg: '请先登录学生中心' });
    const stu = findStudentByNo(s.username);
    const list = readLeaves();
    const idx = list.findIndex(x => x.id === myLeafCancel[1] && x.sid === (stu && stu.id));
    if (idx === -1) return sendJson(res, 404, { code: 1, msg: '未找到可撤销的请假申请' });
    if (list[idx].status !== 'pending') return sendJson(res, 400, { code: 1, msg: '已处理的申请不可撤销' });
    list.splice(idx, 1);
    writeLeaves(list);
    return sendJson(res, 200, { code: 0, msg: '请假申请已撤销' });
  }

  // ===== 静态文件（含页面登录守卫）=====
  // 受保护页面：后台工作台与各功能页（大屏 result.html / 登录页无需登录）
  const PROTECTED_PAGES = ['/index.html', '/dashboard.html', '/students.html',
    '/classes.html', '/grades.html', '/allocate.html', '/settings.html',
    '/teachers.html', '/exams.html', '/conduct.html', '/dorm.html',
    '/analysis.html', '/leaves.html', '/announcements.html', '/timetable.html',
    '/courses.html'];
  const ADMIN_ONLY_PAGES = ['/settings.html'];
  // 学生自助端页面（独立会话，走 icbs_stu_auth）
  const STUDENT_PAGES = ['/student.html'];
  // 教师自助端页面（独立会话，走 icbs_tea_auth）
  const TEACHER_PAGES = ['/teacher.html'];
  const asPage = pathname === '/' ? '/index.html' : pathname;
  if (pathname === '/' || (asPage.endsWith('.html'))) {
    if (STUDENT_PAGES.indexOf(asPage) !== -1) {
      if (!authStudent(req)) {
        const next = encodeURIComponent(pathname + url.search);
        return redirect(res, '/slogin.html?next=' + next);
      }
    } else if (TEACHER_PAGES.indexOf(asPage) !== -1) {
      if (!authTeacher(req)) {
        const next = encodeURIComponent(pathname + url.search);
        return redirect(res, '/tlogin.html?next=' + next);
      }
    } else if (PROTECTED_PAGES.indexOf(asPage) !== -1) {
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
    // 已登录访问登录页 → 直接回到对应首页
    if (pathname === '/login.html' && authUser(req)) {
      return redirect(res, '/index.html');
    }
    if (pathname === '/slogin.html' && authStudent(req)) {
      return redirect(res, '/student.html');
    }
    if (pathname === '/tlogin.html' && authTeacher(req)) {
      return redirect(res, '/teacher.html');
    }
  }

  // 未匹配的接口统一返回 JSON 404，避免落入静态文件返回 HTML
  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { code: 1, msg: '接口不存在：' + pathname });
  }

  // favicon.ico 兼容（浏览器默认请求；统一指向 favicon.png）
  if (pathname === '/favicon.ico') {
    const ico = path.join(__dirname, 'public', 'favicon.png');
    if (fs.existsSync(ico)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(ico).pipe(res);
    }
    res.writeHead(204);
    return res.end();
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
      return res.end(notFoundPage(pathname));
    }
    const ext = path.extname(filePath);
    // 禁止缓存静态文件，保证 JS/CSS 更新后普通刷新即可生效
    res.writeHead(200, { 'Content-Type': getMime(ext), 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// 美化 404 页面（风格与登录页 / forbiddenPage 保持一致的渐变卡片）
function notFoundPage(urlPath) {
  const safePath = String(urlPath || '').replace(/[<>&"]/g, '');
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width,initial-scale=1" />'
    + '<meta name="author" content="RONGLINC (chenronglin1993@hotmail.com)" />'
    + '<link rel="icon" type="image/png" href="/favicon.png" />'
    + '<title>页面不存在 · 学生管理系统</title>'
    + '<style>*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'font-family:"Microsoft YaHei","PingFang SC",sans-serif;'
    + 'background:linear-gradient(135deg,#4f6ef7 0%,#7b5ef7 55%,#9b59d0 100%);padding:24px;color:#333}'
    + '.card{background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(40,40,90,.35);'
    + 'padding:56px 48px;text-align:center;max-width:520px;width:100%}'
    + '.code{font-size:84px;line-height:1;font-weight:800;'
    + 'background:linear-gradient(135deg,#4f6ef7,#9b59d0);-webkit-background-clip:text;background-clip:text;color:transparent}'
    + 'h1{font-size:22px;margin:14px 0 8px;color:#222}'
    + 'p{font-size:14px;color:#777;line-height:1.8;word-break:break-all}'
    + '.btns{margin-top:28px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}'
    + 'a{display:inline-block;padding:11px 28px;border-radius:10px;font-size:14px;text-decoration:none;transition:.2s}'
    + '.a1{background:linear-gradient(135deg,#4f6ef7,#7b5ef7);color:#fff}'
    + '.a1:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(79,110,247,.4)}'
    + '.a2{border:1px solid #d9def0;color:#4f6ef7}.a2:hover{background:#f2f5ff}'
    + '</style></head><body><div class="card">'
    + '<div class="code">404</div><h1>抱歉，页面走丢了</h1>'
    + '<p>您访问的地址不存在或已被移除：<br />' + safePath + '</p>'
    + '<div class="btns"><a class="a1" href="/">返回工作台</a>'
    + '<a class="a2" href="javascript:history.back()">返回上一页</a></div>'
    + '</div></body></html>';
}

startBackupScheduler();

// 双栈监听 IPv4 0.0.0.0 + IPv6 ::.
// 原因: Node.js 18+ 在 Linux 上 .listen(port) 不传 host 时默认绑 :: (IPv6 双栈),
//       但某些容器/NAS (如 fnOS) 的 IPv4 mapped IPv6 被禁用, IPv4 客户端访问
//       ::-only 监听会被 RST. 反之若只绑 0.0.0.0, fnOS 桌面 WebView (Chromium
//       内核) 默认 IPv6 first, localhost 解析成 ::1 后连接被 RST.
//       双栈同时绑 IPv4+IPv6 解决两端的 happy-eyeballs 兼容性问题.
const HOST_V4 = process.env.HOST || '0.0.0.0';
const HOST_V6 = process.env.HOST_V6 || '::';
console.log(`[v1.4.0 dual-stack] student-management-system 启动中...`);
server.listen(PORT, HOST_V4, () => {
  console.log(`[v1.4.0 IPv4-bind] listening on http://${HOST_V4 === '0.0.0.0' ? 'localhost' : HOST_V4}:${PORT}`);
});
server.listen(PORT, HOST_V6, () => {
  console.log(`[v1.4.0 IPv6-bind] listening on http://[${HOST_V6 === '::' ? 'localhost' : HOST_V6}]:${PORT}`);
});
console.log(`按 Ctrl+C 停止服务`);
