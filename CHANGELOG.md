# 更新日志

本文件记录「学生管理系统」的版本变更。

**版本号单一来源：`package.json` 的 `version` 字段。** 发布新版本时只需改这一处：

- **界面**：服务端在 `GET /api/settings` 响应中下发 `version`，`public/js/site.js` 把它写入页面里所有 `[data-app-version]` 占位元素（工作台侧栏底部、系统设置 → 数据管理 → 卡片页脚）。占位元素内的文字是接口取不到时的回退值，可忽略。
- **飞牛 fpk 包**：`fnos/build-fpk.bat` / `build-fpk.sh` 在打包前把 `package.json` 的版本写入 `fnos/student-management-system/manifest` 的 `version`（Windows 走 `fnos/sync-version.ps1`，Linux/macOS 走 `sed`），产物随之命名为 `student-management-system-<version>.fpk`。
- **本文件**：版本条目需手动补充。

---

## Unreleased

本次为「跨平台打包补齐」批次，独立于下条 v1.3.0 的功能/安全/性能变更；下次发版时合并到正式版本号。

### 新增：macOS 平台支持

- **`启动.command`**：macOS Finder 双击即可启动。Finder 自动 `chmod +x` 并打开 Terminal，无需手动 chmod 或 cd。脚本内 `osascript` 弹原生错误对话框（区别于 `启动.sh` 的纯文本提示），并用 `lsof`（macOS 自带）查端口占用、用 `open` 自动打开浏览器
- **`启动.sh`**（Linux/macOS 通用）：保留并完善，macOS 上亦可手动 `chmod +x && ./启动.sh` 运行
- **`运行.bat`**（Windows）：不动
- **`打包rar-mac.bat`** / **`打包rar-mac.sh`**：分别从 Windows / Linux/macOS 上打 macOS 版 rar 产物 `Student-Management-System-<ver>-macos.rar`
- **`打包全部.bat`**：步骤由 `[1/3] [2/3] [3/3]` 改为 `[1/4] Windows` / `[2/4] Linux` / `[3/4] macOS` / `[4/4] fnOS fpk`
- **`打包全部.sh`**：步骤由 `[1/2] [2/2]` 改为 `[1/3] RAR (Linux / Windows / macOS)` / `[2/2] fpk（跳过）`，macOS rar 同 Linux 步骤一起跑
- **`build.js`**：新增 `macos` target；新函数 `readmeMacos`（macOS 专用 `使用说明.txt`，含 Finder 双击、`osascript` 错误提示、`brew install node` 等 macOS 特有说明）；`install` 提示新增 `macOS : 解压后在 Finder 里双击 启动.command` 行；启动脚本在打包阶段做 **CRLF→LF 归一化**（`.sh` / `.command` 强制 LF，`.bat` 保留 CRLF），避免 Windows 上构建的产物在 macOS/Linux 上因 CRLF shebang 引发报错
- **`release.js`**：candidates 列表加入 `Student-Management-System-<version>-macos.rar`，发版时 macOS 包自动随其他平台一并上传到 GitHub Release
- **`README.md`**：新增「## 运行平台」小节，6 种平台（Windows / macOS / Linux 桌面 / Linux 服务器 / Docker / fnOS）的启动方式与差异一表尽览；macOS 行把"Finder 双击 `启动.command`"作为推荐启动方式，并说明"来自身份不明的开发者"提示的绕过办法；「## 快速开始」由 5 种方式扩展为 6 种（新增 `启动.command`）；「## 打包与发布」表格加入 macOS 产物行；「## 项目结构」加入 `启动.command` 与 `打包rar-mac.bat/.sh`

### 新增：开发包 (`dev` target)

面向二次开发者的**完整源代码 zip 包**，与面向终端用户的 rar / fpk 发布包解耦：

- **`build.js`** 新增 `dev` target：
  - 输出 `dist/Student-Management-System-<ver>-dev.zip`
  - 用 zip 格式：Windows 走 PowerShell `Compress-Archive`（系统自带，无需安装任何 zip 工具），Linux/macOS 走系统 `zip` 命令
  - **不**依赖 WinRAR / rar，dev target 在没有 rar 的机器上也能跑
  - 内容是项目根目录完整源码（除 `.git/`、`node_modules/`、`data/`、`dist/`、`fpk/`、`.playwright-cli`、`.vscode/`、`.idea/`、`__pycache__/`、`.cache/`、`.tmp/` 等运行时/构建/缓存目录，以及 `*.rar` / `*.zip` / `*.fpk` / `*.tar` / `*.gz` / `*.log` / `*.tmp` / `*.bak` / `*.swp` / `~` 等后缀与 `.env` / `.env.local` / `.env.*.local` / `.DS_Store` / `Thumbs.db` / `desktop.ini` 等精确文件名 —— **重点：`.env` 含 `GITHUB_TOKEN`，已被黑名单强制排除，不会泄露**）
  - 新增 `DEV_EXCLUDE_TOP` / `DEV_EXCLUDE_SUFFIX` / `DEV_EXCLUDE_EXACT` 三组黑名单
  - 新增 `prepareDevStaging`（递归拷贝并按黑名单过滤）+ `zipStaging`（跨平台调用 zip 工具）+ `buildDev`（编排整流程）
  - `main()` 增加 `target === 'dev'` 分支：跳过 `locateRar()`（无需 rar），直接走 `buildDev()`
- **`打包dev.bat`** / **`打包dev.sh`**：独立 dev 打包脚本，Windows 双击 / Linux/macOS `./打包dev.sh` 直接调用 `node build.js dev`，完成后 5 秒倒计时关闭并尝试打开 `dist/`
- **dev 包内置 `开发包说明.md`**：开发者向，包含目录树、已排除清单、快速开始、打包命令、发布流程
- **`release.js`**：candidates **不**包含 dev 包 —— dev 包只给二次开发者分发，不参与 GitHub Release 发版（避免给终端用户下载到 3 MB 的源码包）
- **`README.md`**：「## 打包与发布」表格新增「打开发包」行；新增「### 开发者打包（dev target）」小节说明 dev target 用法、前置依赖、与发版流程的关系；「## 项目结构」加入 `打包dev.bat / .sh` 行

### 改进

- `发布.bat` 发布成功 / 部分失败时分两段（`:warn` / 成功段）从 `dist/.last-release.json` 读取并格式化打印结果，再倒计时关闭 —— 上次会话的修复点，本批次与 macOS / dev 工作一并 commit
- `build.js main()` 重构：rar 与 dev 两条路径显式分离；rar 路径仍走原有 `locateRar()` + `buildOne()` 流程，dev 路径单独走 `buildDev()`，二者互不耦合
- `build.js` 黑名单增强：新增 `DEV_EXCLUDE_GLOB` 数组（glob 模式编译成正则）+ `shouldExcludeDev()` 同步加 glob 匹配，修复之前 `.env.*.local` 写在精确名 Set 里实际永不匹配的 bug；新增 `test_*.txt` 模式拦截调试时 `cmd / node > test_xxx.txt` 重定向留下的临时日志
- `.gitignore`：新增 `test_*.txt` 规则；清理掉上次调试遗留的 `test_output.txt`（`git rm --cached` + 磁盘删除）
- **`build.js dev target 排除策略重构为 `.gitignore`-driven**（替代之前独立维护的硬编码黑名单）：
  - 之前 `build.js` 有一组 `DEV_EXCLUDE_TOP / DEV_EXCLUDE_SUFFIX / DEV_EXCLUDE_EXACT / DEV_EXCLUDE_GLOB` 与项目 `.gitignore` 内容重复、且**永远落后于 `.gitignore`**（典型例子：`fnos/.gitignore` 里 `student-management-system/app/server/` 这条目录级排除，硬编码黑名单无法表达，导致 dev 包错误地包含 `fnos/student-management-system/app/server/*` 几十个重复文件）
  - 现在 `dev target` 完全按项目内**所有 `.gitignore`**（项目根 + `fnos/.gitignore`）规则评估，**不再**维护独立黑名单；内置零依赖的简易 `.gitignore` glob → regex 编译器，支持 `* / ** / ? / [...] / ! / / 锚定 / 末尾 / 仅目录` 这些常用语法
  - 子目录 `.gitignore` 优先于父目录（深处优先）；同一 `.gitignore` 内规则从下到上处理（最后一条匹配生效，与 git 行为一致）
  - 保留 6 个**硬编码**顶层黑名单作为"项目层语义"兜底（与 `.gitignore` 内容无关）：`.git / node_modules / data / dist / fpk / .trae` —— 这些不写进 `.gitignore` 不合适（`.git` 不该出现在 `.gitignore` 中），且是 dev 包**永远**不该包含的项
- **`.gitignore` 补全**：将之前散落在 `build.js` 硬编码里的通用后缀黑名单（`*.rar *.zip *.fpk *.tar *.gz *.tgz *.7z *.log *.tmp *.bak *.swp *.swo *~`）与平台杂项（`.DS_STORE Thumbs.db desktop.ini ehthumbs.db`）和机密（`.env / .env.local / .env.*.local`）整合进主 `.gitignore`；现在 dev 包按 `.gitignore` 评估就能自动覆盖这些模式

### 已验证

- `node --check` 通过 `build.js` / `release.js`
- Windows 上 `node build.js {win,linux,macos}` 三种 rar target 都成功打包；rar 解包验证 `启动.sh` / `启动.command` 是纯 LF（CRLF=0），`运行.bat` 保留 CRLF
- Windows 上 `node build.js dev` 成功生成 `dist/Student-Management-System-1.3.0-dev.zip`（99 个文件 / 1.42 MB）；PowerShell `Expand-Archive` 解压并扫盘后**确认 zip 内无**：
  - 硬编码顶层黑名单（`.git / node_modules / data / dist / fpk / .trae`）
  - 通用后缀黑名单（`*.rar / *.zip / *.fpk / *.tar / *.gz / *.tgz / *.7z / *.log / *.tmp / *.bak / *.swp / *.swo / *~`）
  - 机密文件（`.env / .env.local / .env.*.local`）
  - 平台杂项（`.DS_Store / Thumbs.db / desktop.ini / ehthumbs.db`）
  - 调试日志（`test_*.txt`）
  - `fnos/.gitignore` 特有规则生效：`fnos/student-management-system/app/server/*`（几十个重复文件，未打包）、`fnos/fnpack.exe`（3.96 MB，未打包）、`fnos/student-management-system/*.fpk`（如存在会未打包）
  - 之前硬编码黑名单版本错误打包的 `fnos/fnpack.exe解压出来就行.rar`（1.36 MB），现已被主 `.gitignore` 的 `*.rar` 正确排除
- Windows 上 `打包dev.bat` 双击调用 `build.js dev` 全流程跑通，5 秒倒计时 + 自动弹出 `dist/` 资源管理器
- bat 文件保持 UTF-8 无 BOM、全 CRLF

### 已验证

- `node --check` 通过 `build.js` / `release.js`
- Windows 上 `node build.js {win,linux,macos}` 三种 rar target 都成功打包；rar 解包验证 `启动.sh` / `启动.command` 是纯 LF（CRLF=0），`运行.bat` 保留 CRLF
- Windows 上 `node build.js dev` 成功生成 `dist/Student-Management-System-1.3.0-dev.zip`（约 3.3 MB，139 个文件）；PowerShell `Expand-Archive` 解压并扫盘后**确认 zip 内无 `.env` / `.git` / `data` / `dist` / `node_modules` / `.playwright-cli` / `*.rar` / `*.zip` / `*.log` 等任何黑名单项**
- Windows 上 `打包dev.bat` 双击调用 `build.js dev` 全流程跑通，5 秒倒计时 + 自动弹出 `dist/` 资源管理器
- bat 文件保持 UTF-8 无 BOM、全 CRLF

---

## v1.3.0 — 2026-09-15

### 补充作者信息

- `package.json`：填充 `author` 字段为 `RONGLINC <chenronglin1993@hotmail.com> (https://github.com/RONGLINC93)`
- `README.md`：新增「作者与反馈」小节（作者 / 邮箱 / 项目地址）
- `public/` 下全部 18 个 HTML 页面：`<head>` 中新增 `<meta name="author">` 标签
- 界面署名：工作台侧栏底部（中文版权行「版权所有 © 2026 RONGLINC」，点击新窗口跳转项目 GitHub 仓库）、系统设置 → 数据管理 → 卡片页脚、后台登录页与学生登录页页脚新增「作者：RONGLINC」（后台登录页附邮箱）
- 移除工作台侧栏底部与数据管理卡片页脚原有的「本地演示」标注
- 工作台「学生中心演示」菜单更名为「学生中心」；智能分班设置中「演示速度」更名为「动画速度」（仅文案调整，逻辑不变）
- `server.js` / `pull.js` / `push.js`：文件头新增 `@author RONGLINC` 注释

### 安全加固

- **登录防爆破**：后台与学生登录按「账号 + 客户端 IP」计数，连续失败 5 次临时锁定，锁定时长 1 分钟起逐轮翻倍（上限 30 分钟），登录成功立即清零；锁定期间返回 HTTP 429 与中文提示。计数为内存态并定时清理，服务重启即重置
- **异常兜底**：所有请求统一经 Promise 包装处理，处理函数抛错时返回 500 JSON / 不再挂死连接；新增 `uncaughtException` / `unhandledRejection` 进程级监听，意外异常只记录日志、不终止服务
- **数据原子写入**：全部业务数据写入改为「临时文件 + rename」原子落盘（新增 `atomicWriteJson`），避免写入中途退出 / 断电造成 JSON 被截断损坏
- **收紧跨域与安全响应头**：本系统为同源应用，移除原 `Access-Control-Allow-Origin: *`；统一追加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`（工作台同源 iframe 嵌入不受影响）、`Referrer-Policy: same-origin` 及兼容现有内联脚本 / 样式的 CSP
- **统一 401 处理**：`public/js/site.js` 包装全局 `fetch`，任意接口返回 401 时自动跳转对应登录页（后台 `/login.html`、学生端 `/slogin.html`，均带 `next` 回跳地址）；工作台 iframe 内由顶层窗口跳转，登录接口本身的 401（密码错误）不拦截
- **404 页面**：不存在的页面返回与系统风格一致的中文渐变 404 卡片（含返回工作台 / 上一页入口）；未匹配的 `/api/` 路径统一返回 JSON 404，不再落入 HTML
- **站点图标**：新增 `public/favicon.png` 并兼容 `/favicon.ico` 请求，全部 18 个 HTML 页面引入 favicon

### 新功能

- **自动定时备份**（系统设置 → 数据管理）：
  - 可开关每日自动备份、设置备份时刻与保留份数（默认 03:00、保留 7 份）；服务停机跨过备份时刻时，启动后自动补备份
  - 备份保存在服务器 `data/backups/`，文件名 `backup-YYYYMMDD-HHmmss.json`；仅自动备份按保留份数清理，手动备份永久保留
  - 新增接口：备份列表 / 立即备份 / 下载 / 删除（`/api/backups`，仅管理员，文件名严格白名单校验防路径穿越）；列表内可直接一键「恢复」
  - 备份内容补全请假、通知公告、回收站、站内消息；数据恢复同步支持上述四类
- **操作审计日志**（系统设置 → 操作审计，仅管理员）：
  - 自动记录后台与学生端的全部新增 / 修改 / 删除操作：操作人、角色、方法、业务模块、路径、IP、时间（只记路径不记请求体，不记录登录 / 改密等敏感接口），仅在请求成功（2xx/3xx）后落盘
  - 本地环形保留最近 3000 条；支持按操作人 / 模块 / 路径 / IP 关键词搜索与分页，可整体清空
- **打印支持**：
  - 成绩管理 → 个人成绩单新增「打印成绩单」按钮，输出含学校名、学生信息、历次考试成绩与排名的规整打印件（`@media print` 自动隐藏导航、侧栏与工具栏）
  - 学生中心「我的分班结果」新增「打印分班通知单」按钮，输出含学生信息、分配班级、班主任与学校落款的正式单据

### 优化

- 数据总览、工作台角标、分班大屏的轮询在页面隐藏（切走窗口 / 最小化）时自动暂停，回到页面立即刷新一次并恢复轮询，减少无效请求
- 全量数据导出（`/api/backup`）改用统一备份载荷，与本地备份内容一致

---

## v1.2.0 — 2026-09-11

### 学生列表批量操作

学生列表新增多选与批量处理能力，未改动任何已有接口的入参 / 出参，原有单条操作行为不变。

#### 1. 多选（`public/students.html` / `public/js/app.js`）

- 表格最左侧新增固定勾选列（不参与「列显示」设置，不可隐藏），表头勾选框可**全选 / 取消全选当前筛选结果**（跨分页生效，半选态显示为不确定态）
- 已勾选行整行浅蓝底 + 左侧色条标识；勾选状态在翻页、排序、筛选、切换列显隐时保留，学生被删除后自动剔除失效勾选
- 屏幕底部新增浮动「批量操作条」，实时显示已选人数，含：批量分班 / 批量分配宿舍 / 批量删除 / 取消选择；窄屏自动铺满底部一行

#### 2. 批量分班（`POST /api/students/batch-assign`）

- 弹窗顶部列出已选学生（姓名 + 年级 + 现班级胶囊），显示目标班级下拉（标注 `已用/容量`，容量不足的班级置灰不可选）
- 所选学生年级一致时只列出同年级班级；年级混杂时列出全部班级，并在提示区说明年级不符者将被跳过
- 服务端逐个校验：**年级一致性**（学生已设年级时必须与目标班级一致，不一致的跳过并在返回文案中列出前 5 名）、**班级容量**（现有 + 本次新增不得超出容量，超出直接拒绝）；已在目标班级的学生自动跳过，无需重复入班
- 成功后从未分班池与其它班级名单中移出并写入目标班级，返回 `{ moved, skipped }`

#### 3. 批量分配宿舍（复用 `POST /api/dorms/:roomId/assign`）

- 弹窗列出已选学生概览，可按楼栋 / 房号搜索
- 房间列表**只展示能一次性容纳本次人数的房间**：性别匹配（全部同性别只能进同性别或混合宿舍，性别混杂则只允许混合宿舍）且剩余床位足够；无可选房间时给出具体原因提示
- 容量按「房间已住人数 − 本次学生中已在该房间的人数 + 本次人数」计算，选中后确认即为整批入住；原在其他房间的学生由服务端自动退宿腾出床位

#### 4. 批量删除（`POST /api/students/batch-delete`）

- 二次确认后批量移入「回收站」，逐条记录来源（未分班池 / 班级名单 + 原班级名），可在回收站中逐条恢复
- 班级名单与未分班池同步清理，已入住学生自动退宿；未匹配到任何档案时返回 404

#### 5. 示例数据导入（系统设置 → 数据管理）

- 原「学生管理 → 更多 → 批量导入示例」属于数据维护操作，整体迁移到「**系统设置 → 数据管理 → 示例数据**」并升级为**一键导入整套餐演示数据**，学生管理页「更多」菜单只保留「下载示例表格」「导入表格数据」
- 按 **年级 → 班级 → 宿舍 → 学生** 顺序追加写入，可安全重复点击，全程**不覆盖、不删除**已有数据：
  - **3 个年级**：高一 / 高二 / 高三（已存在则跳过，复用 `POST /api/grades`）
  - **6 个班级**：每个年级 2 个班、容量 50（同名班级由服务端跳过，复用 `POST /api/classes/batch`）
  - **6 间宿舍**：1 号楼男生 101～103、2 号楼女生 101～103，4 人间（同楼栋同房号跳过，复用 `POST /api/dorms`）
  - **12 名学生**：覆盖三个年级，含各科成绩与特长（复用 `POST /api/students/batch`，导入后为未分班 / 未住宿状态）
- 学生成绩改为**按当前「考试科目设置」的科目逐科生成**（各科 70~99，逐生 / 逐科错开，修正原实现中所有示例学生成绩完全相同的问题），特长轮换
- 导入前弹窗列出将写入的四类数据，导入后 toast 汇总「新增 X 个年级 / X 个班级 / X 间宿舍 / X 名学生，另有 N 项已存在已跳过」，任一子接口失败不中断后续步骤；无需服务端改动

---

## v1.1.0 — 2026-09-11

### 全站小屏适配

本次更新**不改变任何功能、接口与数据结构**，只调整界面在不同屏宽下的布局；桌面端（≥900px）的观感与行为与此前完全一致。

#### 1. 后台工作台（`index.html` / `css/admin.css` / `js/admin.js`）

- 左侧导航由常驻 230px 改为**抽屉式**：窄屏默认移出屏幕，点顶栏菜单按钮滑出，点遮罩 / 关闭按钮 / 任一菜单项 / `Esc` 收回，视口拉宽到断点以上自动复位
- 新增 `#btnAsideToggle`（顶栏菜单按钮）、`#btnAsideClose`（抽屉关闭按钮）、`#asideBackdrop`（遮罩层）三处结构与配套样式
- 顶栏在窄屏下收紧：隐藏面包屑、高度降至 50px、图标按钮改 32px、账号胶囊收窄（≤560px 进一步隐藏角色标签）
- 页签条与单个页签收窄，一屏可容纳更多页签
- `.admin-layout` 高度改用 `100dvh`（不支持时回退 `100vh`），避免移动端地址栏伸缩时高度跳动
- `.brand-text` 支持省略号收缩，校名过长不再撑破顶栏

#### 2. 功能页公用外壳（`css/style.css` / `js/site.js`）

- 新增 `900px / 640px / 420px` 三档小屏规则，统一覆盖：
  - **顶栏导航折叠**：`.nav-toggle` 汉堡按钮 + `.nav` 在窄屏改为整行展开的纵向菜单（`.nav.open`），可滚动、点空白或 `Esc` 收起
  - 页面容器 `.container` 内边距、`.logo h1` 省略号收缩、`.subtitle` 在 420px 以下隐藏
  - 工具栏 / 筛选条 `.toolbar` 两组内容整行堆叠，搜索框与下拉整行、按钮等宽铺开
  - 数据表格 `.table-wrap` 放开横向滚动，避免窄屏内容被 `overflow:hidden` 裁切
  - 统计卡片 `.stats`（窄屏双列）、弹窗 `.modal` / `.dialog-panel`、表单网格 `.form-grid`（单列）
  - 分页 `.pagination`、提示 `toast`、班级卡片 `.classes-grid`、名册工具条 `.roster-*`
  - 智能分班舞台 `.stage` 高度与年级水印字号按屏宽递减
- `site.js` 新增 `setupMobileNav()`：自动向 `.header-inner` 注入汉堡按钮并接管展开 / 收起，**各功能页无需修改 HTML**；大屏页（`result.html`，无导航）与登录页自动跳过
- 大屏页 `result.html` 顶栏右侧新增「&lt; 返回」入口（`js/result.js` 绑定）：同源且确有上一页时回退上一页，否则跳 `/login.html`（已登录会被服务端重定向到工作台），补上大屏页既无导航又无返回按钮的出口
- 大屏页公开访问（无需登录）时，顶栏「去分班」与空态里的「班级管理 / 智能分班」链接会把人弹回登录页：现按登录状态处理——未登录或查看模式隐藏「去分班」（`js/result.js` 拉 `/api/auth/me` 判定），空态文案改为引导登录

#### 3. 各功能页内联样式补充断点

这些组件定义在页面自身的 `<style>` 中，优先级高于共享文件，因此就地补充：

| 页面 | 适配内容 |
|---|---|
| `exams.html` | 左侧考试列表折叠为上方横向卡片条；主区页签横向滑动；成绩录入表保持最小宽度横向滚动 |
| `conduct.html` | 页签横向滑动；筛选条控件加大点按区域并整行铺开；弹窗表单改单列 |
| `leaves.html` | 统计指标胶囊撑满整行；审核信息与推荐学生列表允许换行 |
| `announcements.html` | 发布表单的三列栅格提为 `.form-3` 类并在窄屏降为单列；公告条目与操作按钮改竖排 |
| `teachers.html` | 表格区高度按小屏可视高度重算；悬浮菜单 `#ctxMenu` 宽度不超出屏宽 |
| `dorm.html` | 房态图瓦片改小改密（窄屏一行 2~3 个）；房态筛选与申请页签横向滑动；申请列表操作按钮整行排列 |

#### 4. 登录页（`login.html` / `slogin.html`）

- 大屏零变化：尺寸提为 CSS 变量，媒体查询仅覆盖变量，桌面端观感不变
- 允许纵向滚动：`body` 的 `overflow: hidden` 改为 `overflow-x: hidden`（原先内容高于视口会被裁掉且无法滚动），并补 `min-height: 100dvh`、`-webkit-text-size-adjust: 100%`
- ≤760px：改单列；品牌区不再整块隐藏，压缩为顶部条（保留校徽 + 校名，隐藏口号 / 要点与装饰圆环）；输入框字号提到 16px；表单内边距、圆角、页边距同步收窄
- ≤400px：页边距与内边距进一步压缩，标题字号下调，学生入口按钮允许换行，底部提示字号缩小
- 矮屏与横屏：`max-height: 640px` 隐藏要点列表并压缩各段间距；`orientation: landscape` + `max-height: 520px` + `max-width: 950px` 时隐藏品牌区让表单独占

#### 5. 断点约定

| 断点 | 用途 | 来源 |
|---|---|---|
| 1180px | 分班结果大屏头部居中大字回归文档流 | 原有 |
| 1100px | 后台工作台「左右分屏 ↔ 上下堆叠」 | 原有 |
| **900px** | 侧栏抽屉 / 顶栏导航折叠 / 通用组件小屏规则 | **本次新增** |
| 760px | 工作台单窗格、登录页改单列（本次另加品牌压缩条）、分班双栏改单列 | 原有 + 增强 |
| **640px** | 手机档（统计双列、弹窗按钮竖排、班级卡片单列） | **本次新增** |
| **560px** | 工作台顶栏进一步精简 | **本次新增** |
| 520px | 数据总览容量条改双列 | 原有 |
| **420px** | 小屏手机 | **本次新增** |

> 登录页样式内联在页面 `<style>` 中，其 760px / 400px 与矮屏（640px）、横屏（520px + 950px）四档断点只作用于两个登录页，不影响其余页面。

> 900px 为新增断点，与工作台原有的分屏断点（1100 / 760px）相互独立，不影响分屏行为。

#### 6. 涉及文件

```
 public/announcements.html |  14 ++++-
 public/conduct.html       |  21 +++++++
 public/css/admin.css      | 119 +++++++++++++++++++++++++++++++++++-
 public/css/style.css      | 152 ++++++++++++++++++++++++++++++++++++++++++++++
 public/dorm.html          |  24 ++++++++
 public/exams.html         |  26 ++++++++
 public/index.html         |   8 +++
 public/js/admin.js        |  43 +++++++++++++
 public/js/site.js         |  56 +++++++++++++++++
 public/leaves.html        |  16 +++++
 public/login.html         |  52 +++++-
 public/slogin.html        |  53 +++++-
 public/teachers.html      |  10 +++
 13 files changed, 589 insertions(+), 11 deletions(-)
```

---

## v1.0.0

首个版本。所有数据以 JSON 文件本地持久化（`data/`），零依赖纯 Node.js，开箱即用。

**教务管理**

- 数据总览：全校概况、分班进度、各班容量、学科均分、特长分布
- 学生档案：学籍字段（档案编号 / 身份证 / 生日 / 民族户籍 / 住址 / 监护人等）、各科成绩、学籍状态与异动记录、误删回收站、批量 CSV 导入导出
- 班级 / 年级：容量设置、花名册、卡片拖拽排序，删除班级时学生自动退回未分班
- 教师管理：教师档案、任教学科、班主任与班级联动（一个班级只对应一名班主任）
- 成绩管理：多场次考试、可配置科目成绩录入、班级均分 / 最高 / 排名统计、个人成绩单、批量载入档案成绩、成绩归档、CSV 导出
- 考勤操行：按日考勤登记（全出勤快捷、逐人状态）、历史记录查询回填、奖惩与评语
- 请假管理：学生在线请假 + 后台代登记，审批通过自动写入对应日期考勤（leave），支持统计、筛选与 CSV 导出
- 通知公告：可面向全校 / 指定年级 / 指定班级，支持置顶与截止时间，学生中心即时查看
- 成绩分析：单场分析（均分 / 及格率 / 优秀率 / 分数段）、同年级班级对比、学业预警、个人成绩趋势
- 宿舍管理：楼栋房间卡片流、性别 / 容量 / 年级筛选、安排入住、退宿 / 清空 / 自动迁宿
- 智能分班：S 型 / 综合均衡（成绩 + 性别 + 特长）/ 随机三种策略与排位动画
- 分班结果大屏：深色投屏页，分班过程实时直播、班级花名册展开、LIVE 状态点亮

**系统与入口**

- 后台工作台：选项卡式管理全部模块，支持拖拽排序、深链定位（`?mod=exams`）
- 系统设置：学校信息 / 校徽、可配置考试科目（增删改 + 满分）、分班规则、备份恢复、账号安全、服务器管理（运行状态 / 重启本服务）
- 学生中心：学生凭学号自助登录，查看分班 / 宿舍 / 学籍档案，在线请假并跟踪审批进度，查看面向本人发布的公告
