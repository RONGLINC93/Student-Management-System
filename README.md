# 学生管理系统

一个基于纯 Node.js（零依赖）的全功能学生管理系统，覆盖 **学籍档案、班级 / 年级、教师档案、多科目成绩、考勤操行、请假、通知公告、成绩分析、宿舍安排、学籍异动 / 回收站** 等教务管理模块，并内置「随机排位 + 均衡编班」的智能分班与投屏直播大屏，同时提供面向学生的自助中心。所有数据以 JSON 文件本地持久化，无需数据库，开箱即用。

## 模块总览

- **数据总览**（dashboard.html）：全校概况、分班进度、各班容量、学科均分、特长分布
- **学生档案**（students.html）：学籍字段（档案编号 / 身份证 / 生日 / 民族户籍 / 住址 / 监护人等）+ 各科成绩、学籍状态（休学 / 转出 / 毕业等）与异动记录、误删回收站（可恢复 / 彻底删除），批量 CSV 导入导出
- **班级 / 年级**（classes.html / grades.html）：容量设置、花名册、卡片拖拽排序、删除班级时学生自动退回未分班
- **教师管理**（teachers.html）：教师档案、任教学科、班主任与班级联动（一个班级只对应一名班主任）
- **成绩管理**（exams.html）：多场次考试、可配置科目成绩录入、班级均分 / 最高 / 排名统计、个人成绩单、批量载入档案成绩、成绩归档为档案成绩、CSV 导出
- **考勤操行**（conduct.html）：按日考勤登记（全出勤快捷、逐人状态）、历史记录查询回填、奖惩与评语
- **请假管理**（leaves.html）：学生在线请假 + 后台代登记，审批通过自动同步写入对应日期考勤（leave），支持统计、筛选与 CSV 导出
- **通知公告**（announcements.html）：后台发布 / 编辑 / 删除，可面向全校 / 指定年级 / 指定班级，支持置顶与截止时间，学生中心即时查看
- **成绩分析**（analysis.html）：单场分析（均分 / 及格率 / 优秀率 / 分数段）、同年级班级对比、学业预警、个人成绩趋势
- **宿舍管理**（dorm.html）：楼栋房间卡片流、性别 / 容量 / 年级筛选、安排入住、退宿 / 清空 / 自动迁宿
- **智能分班**（allocate.html）：S 型 / 综合均衡（成绩 + 性别 + 特长）/ 随机三种策略与排位动画
- **分班结果大屏**（result.html）：深色投屏页，分班过程实时直播、班级花名册展开、LIVE 状态点亮
- **学生中心**（student.html）：学生凭学号自助登录，查看分班 / 宿舍 / 学籍档案，在线请假并跟踪审批进度、查看面向本人发布的公告
- **后台工作台**（index.html）：选项卡式管理全部模块，支持拖拽排序、深链定位（`?mod=exams`）
- **系统设置**（settings.html）：学校信息 / 校徽、可配置考试科目（增删改 + 满分）、分班规则、备份恢复、账号安全、服务器管理（运行状态 / 重启服务）

> 考试科目可在「系统设置 → 科目设置」自由增删（含满分），学生档案成绩、成绩录入、数据总览与分班参考成绩全部按配置科目动态渲染，旧版“语文 / 数学 / 英语 / 理综”成绩会自动迁移。

## 运行平台

本项目是**纯 Node.js 零依赖**应用（标准库 `http` / `fs` / `path` / `crypto` / `child_process`，**无需 `npm install`**），任何能跑 Node.js 14+ 的平台都能直接拉下来跑：

| 平台 | 启动方式 | 备注 |
|---|---|---|
| **Windows 10 / 11 / Server** | 双击 `运行.bat` 或 `node server.js` | 启动后自动用默认浏览器打开 <http://localhost:3000> |
| **macOS** | **Finder 双击 `启动.command`**（首选，Finder 自动 chmod +x 并打开 Terminal）；或 `chmod +x 启动.sh && ./启动.sh`；或 `node server.js` | macOS 版脚本会通过 `osascript` 弹原生错误框、通过 `open` 自动打开浏览器；首次双击若提示\"来自身份不明的开发者\"，请到「系统设置 → 隐私与安全性」点\"仍要打开\" |
| **Linux（桌面）** | `chmod +x 启动.sh && ./启动.sh`，或 `node server.js` | 脚本通过 `xdg-open` 自动打开浏览器 |
| **Linux（服务器 / NAS）** | `node server.js`（建议配合 systemd / Docker） | 无图形界面，需自行访问 <http://<host>:3000> |
| **Docker / Docker Compose** | `docker compose up -d` | 由 `Dockerfile` + `docker-compose.yml` 构建，数据卷挂载 `data/` 持久化 |
| **fnOS（飞牛 NAS）** | 应用商店安装，或本地导入 `dist/*.fpk` | `.fpk` 只能在 Windows 上构建，见下表 |

前端仅依赖浏览器，Chrome / Firefox / Edge / Safari / 移动浏览器均可访问。

> Node.js 安装参考：<br>Windows / macOS — 官方安装包 <https://nodejs.org/zh-cn>；<br>Ubuntu / Debian — `sudo apt-get install -y nodejs`；<br>CentOS / RHEL — `sudo yum install -y nodejs`。

## 快速开始

```bash
# 方式一（任何平台）
node server.js

# 方式二（任何平台，等价于 node server.js）
npm start

# 方式三（Windows：自动打开浏览器）
双击 运行.bat

# 方式四（macOS：Finder 双击 启动.command，推荐）
#       （Finder 会自动 chmod +x 并打开 Terminal）

# 方式五（macOS / Linux：手动启动）
chmod +x 启动.sh && ./启动.sh

# 方式六（Docker）
docker compose up -d
```

浏览器访问 <http://localhost:3000>。默认账号：**admin / admin123**（登录后请及时在「系统设置 → 账号与安全」中修改）。

> 修改 `server.js` 后需重启服务；修改 `public/` 下的前端文件刷新页面即可生效（静态资源已禁用缓存）。

## 打包与发布

| 任务 | Windows | Linux / macOS |
|---|---|---|
| 打 rar 包（Linux 产物） | `打包rar-linux.bat` | `./打包rar-linux.sh` |
| 打 rar 包（Windows 产物） | `打包rar-win.bat` | `./打包rar-win.sh`（需自行安装 `rar` 命令） |
| 打 rar 包（macOS 产物） | `打包rar-mac.bat` | `./打包rar-mac.sh`（macOS 推荐 `brew install --cask rar`） |
| 打 fnOS `.fpk` 包 | `打包fpk.bat` | ❌ **不支持** — 依赖 `fnos/fnpack.exe`（Windows x86 二进制） |
| **一键打全部平台产物** | `打包全部.bat` | `./打包全部.sh`（自动跳过 fpk 步骤并提示） |
| 打开发包（zip，面向二次开发者） | `打包dev.bat` | `./打包dev.sh`（不需 rar；Windows 用 PowerShell Compress-Archive，Linux/macOS 用 `zip`） |
| 拉取 / 推送 | `拉取.bat` / `推送.bat` | 直接 `git pull` / `git push` |
| **发布新版本到 GitHub** | `发布.bat` | 手工跑 `./打包全部.sh && node release.js` |

**`发布.bat`** 会自动完成：构建全部平台产物 → `git tag v<version>` 并推送 → 用 GitHub API 创建 Release → 上传 `dist/` 下的 rar / fpk 资产 → 显示结果摘要倒计时关闭。详见 `release.js`（顶部 JSDoc 注释说明完整流程与退出码）。

发布前置：Node.js 14+、`.env` 配好 `GITHUB_REPO_URL` 与 `GITHUB_TOKEN`（同 `拉取.bat` / `推送.bat`）、`package.json` 的 `version` 已手工调整并 commit。

### 开发者打包（dev target）

`dev target` 产出一个 zip 格式的**完整源码包**，面向二次开发者（不含 `.git/`、`node_modules/`、`data/`、`dist/`、`.env` 等敏感文件，不需要 WinRAR / rar 工具）：

```bash
node build.js dev          # 生成 dist/Student-Management-System-<ver>-dev.zip
# Windows: 双击 打包dev.bat
# Linux/macOS: ./打包dev.sh
```

产物内容：

- 完整源码（`public/`、`fnos/` SDK、`docs/` 截图、所有平台启动脚本、build/release/pull/push 脚本、Dockerfile / docker-compose.yml、`.gitignore`、README.md、CHANGELOG.md）
- 包内附 `开发包说明.md`（开发者快速上手 / 二次开发指南）
- 自动排除：`.git/`、`node_modules/`、`data/`、`dist/`、`*.rar` / `*.zip` / `*.fpk`、`.env`、`*.log`、`*.tmp`、`.vscode/`、`.idea/` 等
- dev 包**不**随发布流程上传到 GitHub Release —— 它只给二次开发者分发，发布时只上传 win/linux/macos rar + fpk

**前置**：

- Windows：Node.js 14+（PowerShell `Compress-Archive` 系统自带，无需任何 zip 工具）
- Linux：Node.js 14+ + `zip`（`sudo apt install zip` 或自带）
- macOS：Node.js 14+（`zip` 系统自带）

## 项目结构

```
├── server.js              # HTTP 服务：REST API 路由 + 静态文件托管 + 登录认证
├── package.json
├── Dockerfile             # 生产镜像（Alpine + Node 20）
├── docker-compose.yml     # 一键部署，数据卷持久化
├── 运行.bat               # Windows 启动（自动打开浏览器）
├── 启动.sh                # Linux 启动（自动打开浏览器，Terminal 运行）
├── 启动.command           # macOS 启动（Finder 双击即可，自动开 Terminal）
├── 拉取.bat / 推送.bat    # Git 拉取 / 推送（带 token 注入与脱敏）
├── 打包rar-win.bat/.sh    # 打 Windows rar 包
├── 打包rar-linux.bat/.sh  # 打 Linux rar 包
├── 打包rar-mac.bat/.sh    # 打 macOS rar 包（含 启动.command）
├── 打包fpk.bat            # 打 fnOS .fpk 包（仅 Windows）
├── 打包全部.bat/.sh       # 一键打全部平台产物（rar + fpk）
├── 打包dev.bat/.sh        # 打开发包（zip，面向二次开发者）
├── 发布.bat               # 一键发布新版本到 GitHub（打包 + tag + Release）
├── build.js               # 打包构建逻辑（被 *.bat / *.sh 调用，支持 win/linux/macos/all/dev）
├── release.js             # GitHub Release 创建 + 资产上传
├── pull.js / push.js      # Git 拉取 / 推送逻辑
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
│   ├── dormitories.json   # 宿舍房间与入住名单
│   ├── leaves.json        # 请假申请（学生在线 / 后台登记 / 审批）
│   ├── announcements.json # 通知公告（全校 / 年级 / 班级）
│   └── students_trash.json# 学生回收站（软删除归档，可恢复）
├── docs/screenshots/      # README 界面截图
└── public/
    ├── index.html / js/admin.js      # 后台工作台（侧栏菜单 + 选项卡）
    ├── login.html                    # 后台登录页
    ├── dashboard.html / js/dashboard.js
    ├── students.html  / js/app.js    # 学生档案（学籍状态 / 回收站）
    ├── classes.html    / js/classes.js
    ├── grades.html     / js/grades.js
    ├── teachers.html   / js/teachers.js
    ├── exams.html      / js/exams.js
    ├── conduct.html    / js/conduct.js
    ├── dorm.html       / js/dorm.js
    ├── allocate.html   / js/allocate.js
    ├── result.html     / js/result.js
    ├── leaves.html     / js/leaves.js       # 请假管理
    ├── announcements.html / js/announcements.js  # 通知公告
    ├── analysis.html   / js/analysis.js     # 成绩分析
    ├── slogin.html                          # 学生登录页
    ├── student.html                         # 学生中心（分班/宿舍/请假/公告）
    ├── css/style.css   / css/admin.css
    └── js/             # site.js（全站配置注入 / 科目与成绩辅助）
                         # embed.js（工作台 iframe 嵌入桥接）
                         # dialog.js（toast / confirmDlg / showStatus）
```

## API 一览

REST 接口均支持 GET / POST / PUT / DELETE，统一返回 `{ code, data, msg }`：

| 分类 | 路径前缀 | 说明 |
|---|---|---|
| 学生 | `/api/students` | 档案增删改（删除进回收站）、批量导入、清空、`/:id/status` 学籍异动 |
| 班级 / 年级 | `/api/classes`、`/api/grades` | 增删改、排序、退班/整班退回 |
| 教师 | `/api/teachers` | 档案增删改、`/head` 设 / 撤班主任（联动班级） |
| 考试 | `/api/exams` | 场次增删改、`/records` 成绩录入、`/records/set` 按成绩表覆盖、`/archive` 归档为档案成绩 |
| 考勤 | `/api/attendance` | 按日 / 按班保存与查询、删除 |
| 操行 | `/api/conduct` | 奖惩评语增删改、按学生查询 |
| 请假 | `/api/leaves` | 请假增删改、`/:id/review` 审批（通过自动写考勤） |
| 公告 | `/api/announcements` | 公告发布 / 编辑 / 删除 |
| 回收站 | `/api/trash` | 查看、`/:id/restore` 恢复、`/:id/purge` 彻底删除、清空 |
| 学生自助 | `/api/student/*` | 独立会话：`/me` 聚合档案、`/leaves` 在线请假与撤销、`/announcements` 我的公告 |
| 宿舍 | `/api/dorms` | 房间增删改、`/assign` 入住、`/remove/:stuId` 退宿、清空 / 自动迁宿 |
| 分班 / 大屏 | `/api/allocate`、`/api/live`、`/api/board` | 提交分班结果、直播快照、大屏聚合 |
| 设置 / 账号 | `/api/settings`、`/api/auth/*`、`/api/filters` | 系统设置、登录与改密、前端偏好 |
| 备份恢复 | `/api/backup`、`/api/restore` | 全量 JSON 打包下载与恢复 |
| 服务器 | `/api/server/*` | `status` 本服务运行状态、`restart` 重启本服务（仅管理员，不涉及操作系统层面的重启/关机） |

## 使用注意事项

- 智能分班前必须先选择年级；学生人数不能少于班级数
- 随机排位 / 分班进行中时操作按钮会禁用，切换年级会自动重置当前进度
- 危险操作（删除、清空等）均需弹窗二次确认
- 查看模式账号只能浏览，不能进入系统设置或执行写操作
- CSV 导入模板表头为：`学号,年级,姓名,性别,语文,数学,英语,理综,特长`（科目列随系统配置动态变化，以「下载示例表格」为准），`姓名` 必填

## 作者与反馈

- 作者：**RONGLINC**
- 邮箱：<chenronglin1993@hotmail.com>
- 项目地址：<https://github.com/RONGLINC93/Student-Management-System>（欢迎 Issue 反馈问题与建议）
