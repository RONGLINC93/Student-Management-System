# 学生管理系统

一个基于纯 Node.js（零依赖）的全功能学生管理系统，覆盖 **学籍档案、班级 / 年级、教师档案、多科目成绩、考勤操行、宿舍安排** 等教务管理模块，并内置「随机排位 + 均衡编班」的智能分班与投屏直播大屏。所有数据以 JSON 文件本地持久化，无需数据库，开箱即用。

## 模块总览

- **数据总览**（dashboard.html）：全校概况、分班进度、各班容量、学科均分、特长分布
- **学生档案**（students.html）：学籍字段（档案编号 / 身份证 / 生日 / 民族户籍 / 住址 / 监护人等）+ 各科成绩，批量 CSV 导入导出
- **班级 / 年级**（classes.html / grades.html）：容量设置、花名册、卡片拖拽排序、删除班级学生自动退回池
- **教师管理**（teachers.html）：教师档案、任教学科、班主任与班级联动（一个班级只对应一名班主任）
- **成绩管理**（exams.html）：多场次考试、可配置科目成绩录入、班级均分 / 最高 / 排名统计、个人成绩单、批量载入档案成绩、成绩归档为档案成绩、CSV 导出
- **考勤操行**（conduct.html）：按日考勤登记（全出勤快捷、逐人状态）、历史记录查询回填、奖惩与评语
- **宿舍管理**（dorm.html）：楼栋房间卡片流、性别 / 容量 / 年级筛选、安排入住、退宿 / 清空 / 自动迁宿
- **智能分班**（allocate.html）：S 型 / 综合均衡（成绩 + 性别 + 特长）/ 随机三种策略与排位动画
- **分班结果大屏**（result.html）：深色投屏页，分班过程实时直播、班级花名册展开、LIVE 状态点亮
- **后台工作台**（index.html）：选项卡式管理全部模块，支持拖拽排序、深链定位（`?mod=exams`）
- **系统设置**（settings.html）：学校信息 / 校徽、可配置考试科目（增删改 + 满分）、分班规则、备份恢复、账号安全

> 考试科目可在「系统设置 → 科目设置」自由增删（含满分），学生档案成绩、成绩录入、数据总览与分班参考成绩全部按配置科目动态渲染，旧版“语文 / 数学 / 英语 / 理综”成绩会自动迁移。

## 快速开始

```bash
# 方式一
node server.js

# 方式二
npm start

# 方式三（Windows）
双击 运行.bat
```

浏览器访问 <http://localhost:3000>。默认账号：**admin / admin123**（登录后请及时在「系统设置 → 账号与安全」中修改）。

> 修改 `server.js` 后需重启服务；修改 `public/` 下的前端文件刷新页面即可生效（静态资源已禁用缓存）。

## 项目结构

```
├── server.js              # HTTP 服务：REST API 路由 + 静态文件托管 + 登录认证
├── package.json
├── 运行.bat / 拉取.bat / 推送.bat
├── data/                  # JSON 数据存储（缺省文件在首次写入时自动创建）
│   ├── settings.json      # 系统设置（学校信息 / 科目 / 分班规则）
│   ├── users.json         # 登录账号
│   ├── students.json      # 学生档案（含成绩 / 学籍字段）
│   ├── classes.json       # 班级（含已分班学生）
│   ├── grades.json        # 年级列表
│   ├── filters.json       # 前端筛选 / 分页等偏好
│   ├── teachers.json      # 教师档案（班主任与班级联动）
│   ├── exams.json         # 考试场次与成绩记录
│   ├── attendance.json    # 考勤记录
│   ├── conduct.json       # 操行（奖惩 / 评语）记录
│   └── dormitories.json   # 宿舍房间与入住名单
├── docs/screenshots/      # README 界面截图
└── public/
    ├── index.html / js/admin.js      # 后台工作台（侧栏菜单 + 选项卡）
    ├── login.html                    # 登录页
    ├── dashboard.html / js/dashboard.js
    ├── students.html  / js/app.js    # 学生档案
    ├── classes.html    / js/classes.js
    ├── grades.html     / js/grades.js
    ├── teachers.html   / js/teachers.js
    ├── exams.html      / js/exams.js
    ├── conduct.html    / js/conduct.js
    ├── dorm.html       / js/dorm.js
    ├── allocate.html   / js/allocate.js
    ├── result.html     / js/result.js
    ├── css/style.css   / css/admin.css
    └── js/             # site.js（全站配置注入 / 科目与成绩辅助）
                         # embed.js（工作台 iframe 嵌入桥接）
                         # dialog.js（toast / confirmDlg / showStatus）
```

## API 一览

REST 接口均支持 GET / POST / PUT / DELETE，统一返回 `{ code, data, msg }`：

| 分类 | 路径前缀 | 说明 |
|---|---|---|
| 学生 | `/api/students` | 档案增删改、批量导入、清空 |
| 班级 / 年级 | `/api/classes`、`/api/grades` | 增删改、排序、退班/整班退回 |
| 教师 | `/api/teachers` | 档案增删改、`/head` 设 / 撤班主任（联动班级） |
| 考试 | `/api/exams` | 场次增删改、`/records` 成绩录入、`/records/set` 按成绩表覆盖、`/archive` 归档为档案成绩 |
| 考勤 | `/api/attendance` | 按日 / 按班保存与查询、删除 |
| 操行 | `/api/conduct` | 奖惩评语增删改、按学生查询 |
| 宿舍 | `/api/dorms` | 房间增删改、`/assign` 入住、`/remove/:stuId` 退宿、清空 / 自动迁宿 |
| 分班 / 大屏 | `/api/allocate`、`/api/live`、`/api/board` | 提交分班结果、直播快照、大屏聚合 |
| 设置 / 账号 | `/api/settings`、`/api/auth/*`、`/api/filters` | 系统设置、登录与改密、前端偏好 |
| 备份恢复 | `/api/backup`、`/api/restore` | 全量 JSON 打包下载与恢复 |

## 使用注意事项

- 智能分班前必须先选择年级；学生人数不能少于班级数
- 随机排位 / 分班进行中时操作按钮会禁用，切换年级会自动重置当前进度
- 危险操作（删除、清空等）均需弹窗二次确认
- 查看模式账号只能浏览，不能进入系统设置或执行写操作
- CSV 导入模板表头为：`学号,年级,姓名,性别,语文,数学,英语,理综,特长`（科目列随系统配置动态变化，以「下载示例表格」为准），`姓名` 必填
