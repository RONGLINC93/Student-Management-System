#!/usr/bin/env node
/**
 * Student Management System - 打包构建工具（跨平台）
 *
 * 用法：
 *   node build.js                同时构建 Windows / Linux / macOS 三个 RAR 发布包
 *   node build.js win            只生成 Student-Management-System-<ver>-win.rar
 *                                （含 运行.bat）
 *   node build.js linux          只生成 Student-Management-System-<ver>-linux.rar
 *                                （含 启动.sh）
 *   node build.js macos          只生成 Student-Management-System-<ver>-macos.rar
 *                                （含 启动.command，Finder 双击即可）
 *   node build.js all            同不传参数
 *   node build.js dev            生成 Student-Management-System-<ver>-dev.zip
 *                                （开发包 / 源码包，含完整项目源码，所有平台启动
 *                                 脚本、build/release/pull/push 脚本、Dockerfile、
 *                                 fnos SDK、docs/。不含 .git/、data/、dist/、
 *                                 node_modules/，不需要 rar 工具）
 *
 * 设计取舍：
 *   - 主流程用 Node.js 实现（项目本身已依赖 Node，无需引入新工具）
 *   - 这样可以彻底绕开 cmd 批处理中 if/call/括号块的怪异语法陷阱
 *   - UTF-8 文本写入是 Node 默认行为，Chinese README 不会再出问题
 *   - 跨平台（Windows / Linux / macOS）共用一份核心逻辑
 *
 * 依赖：
 *   - WinRAR（Windows，%ProgramFiles%\WinRAR\WinRAR.exe 或 PATH 中的 rar.exe）
 *               —— 仅 rar target 需要
 *   - rar      （Linux/macOS，包管理器安装的 rar/unrar 命令行工具）
 *               —— 仅 rar target 需要
 *   - zip      （Linux/macOS 自带 / 包管理器安装）—— 仅 dev target 需要
 *               —— Windows 不需要，PowerShell 自带 Compress-Archive
 *
 * 输出（位于 <项目根>/dist/）：
 *   Student-Management-System-<version>-win.rar       (发布包：Windows 终端用户)
 *   Student-Management-System-<version>-linux.rar     (发布包：Linux 终端用户)
 *   Student-Management-System-<version>-macos.rar     (发布包：macOS 终端用户)
 *   Student-Management-System-<version>-dev.zip       (开发包：二次开发者)
 *
 * 说明：
 *   - data/ 不会被打包（运行期数据，应单独备份；server.js 首次写入时自动创建）
 *   - 临时 staging 目录在打包完成后自动清理
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ===========================================================================
//  1. 解析参数
// ===========================================================================
const PROJ = __dirname;
const APPNAME = 'Student-Management-System';
const RAR_FILES = [
  'README.md',
  'CHANGELOG.md',
  // 文档目录（如果存在）
  // 注意：docs/ 是否需要打包由用户决定；这里默认不打，避免发布包过大。
];

const argv = process.argv.slice(2);
const target = (argv[0] || 'all').toLowerCase();

if (!['win', 'linux', 'macos', 'all', 'dev'].includes(target)) {
  console.error(`Usage: node build.js [win|linux|macos|all|dev]`);
  process.exit(1);
}

// ===========================================================================
//  2. 读取 package.json（version 是单一来源）
// ===========================================================================
let VERSION = '1.0.0';
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PROJ, 'package.json'), 'utf8')
  );
  if (pkg.version) VERSION = String(pkg.version);
} catch (e) {
  console.error(`[WARN] Failed to read package.json: ${e.message}; using VERSION=1.0.0`);
}

// ===========================================================================
//  3. 生成 README 内容（UTF-8 模板字符串，中文不会乱码）
// ===========================================================================
function readmeWin(v) {
  return `# ${APPNAME} v${v} (Windows)

本压缩包是「学生管理系统」的 **Windows** 版离线发布包，解压后双击 运行.bat 即可启动。

## 运行要求

- Node.js 14 或更高版本（项目零依赖，无需 npm install）
- 端口 3000 默认空闲；如被占用请设置环境变量 PORT 后再启动

## 快速开始

直接双击 运行.bat。

浏览器访问 http://localhost:3000，默认账号 admin / admin123。
首次登录后请到「系统设置 - 账号与安全」修改密码。

## 自定义端口

    set PORT=8080 && 运行.bat

## 目录说明

- server.js / package.json / public/     应用本体
- 运行.bat                               Windows 启动脚本
- data/                                  首次写入时由 server.js 自动创建，不需要预先提供

## 数据备份

「系统设置 - 数据管理 - 备份与恢复」可一键打包 / 恢复 data\\ 下全部 JSON 数据。

---
提示：本包不含 Linux 启动脚本。如果你在 Linux / macOS 上使用，请改用
  Student-Management-System-${v}-linux.rar
`;
}

function readmeLinux(v) {
  return `# ${APPNAME} v${v} (Linux)

本压缩包是「学生管理系统」的 **Linux** 版离线发布包，解压后执行 ./启动.sh 即可启动。

## 运行要求

- Node.js 14 或更高版本（项目零依赖，无需 npm install）
- 端口 3000 默认空闲；如被占用请设置环境变量 PORT 后再启动
- 需要可执行权限：chmod +x 启动.sh

## 快速开始

    chmod +x 启动.sh
    ./启动.sh

浏览器访问 http://localhost:3000，默认账号 admin / admin123。
首次登录后请到「系统设置 - 账号与安全」修改密码。

## 自定义端口

    PORT=8080 ./启动.sh

## 目录说明

- server.js / package.json / public/     应用本体
- 启动.sh                               Linux 启动脚本
- data/                                 首次写入时由 server.js 自动创建，不需要预先提供

## 数据备份

「系统设置 - 数据管理 - 备份与恢复」可一键打包 / 恢复 data/ 下全部 JSON 数据。

---
提示：本包不含 Windows / macOS 启动脚本。如果你在 Windows 上使用，请改用
  Student-Management-System-${v}-win.rar；
如在 macOS 上使用，请改用 Student-Management-System-${v}-macos.rar
（Finder 双击 启动.command 即可，无需 chmod）。
`;
}

function readmeMacos(v) {
  return `# ${APPNAME} v${v} (macOS)

本压缩包是「学生管理系统」的 **macOS** 版离线发布包，解压后在 Finder 里双击 启动.command 即可启动。

## 运行要求

- macOS 10.13 (High Sierra) 或更高版本
- Node.js 14 或更高版本（项目零依赖，无需 npm install）
  - 推荐方式：官方安装包 https://nodejs.org （pkg 安装）
  - 其他方式：brew install node
- 端口 3000 默认空闲；如被占用请在 Terminal 里 export PORT=<其他端口> 后再双击启动

## 快速开始

1. 解压本压缩包到任意目录（例如 ~/Applications）
2. 在 Finder 里打开解压后的文件夹
3. **双击 启动.command**

Finder 会自动用 Terminal 打开并运行脚本，浏览器自动打开 http://localhost:3000。
默认账号 admin / admin123（首次登录后请到「系统设置 - 账号与安全」修改）。

> 首次双击若提示"无法打开，因为来自身份不明的开发者"，请到
> 「系统设置 → 隐私与安全性」点击"仍要打开"，或对 启动.command 右键选择"打开"。

## 自定义端口

在 Terminal 里先设置环境变量再双击：

    export PORT=8080
    open "$(dirname "$(pwd)")"   # 然后双击 启动.command

或者直接用命令行：

    cd "$(dirname "$(pwd)")"
    PORT=8080 ./启动.command

## 目录说明

- server.js / package.json / public/   应用本体
- 启动.command                          macOS Finder 双击启动脚本（自动 chmod +x）
- data/                                首次写入时由 server.js 自动创建，不需要预先提供

## 数据备份

「系统设置 - 数据管理 - 备份与恢复」可一键打包 / 恢复 data/ 下全部 JSON 数据。

## 卸载

直接删除解压目录即可（data/ 内是全部数据，先备份或迁移再删）。

---
提示：本包不含 Windows / Linux 启动脚本。如果你在 Windows 上使用，请改用
  Student-Management-System-${v}-win.rar；
如在 Linux 上使用，请改用 Student-Management-System-${v}-linux.rar
（chmod +x 启动.sh && ./启动.sh）。
`;
}

// ===========================================================================
//  4. 工具函数
// ===========================================================================
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function locateRar() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinRAR', 'WinRAR.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WinRAR', 'rar.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WinRAR', 'WinRAR.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WinRAR', 'rar.exe'),
      path.join(process.env.ProgramW6432 || '', 'WinRAR', 'WinRAR.exe'),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    // 退化到 PATH 中查找
    for (const name of ['WinRAR.exe', 'winrar', 'rar.exe', 'rar']) {
      const r = spawnSync(name, [], { stdio: 'ignore' });
      if (!r.error) return name;
    }
    throw new Error(
      'WinRAR / rar.exe not found. Install WinRAR from https://www.win-rar.com/ ' +
      'and ensure WinRAR.exe is in %ProgramFiles%\\WinRAR\\ or on PATH.'
    );
  } else {
    for (const name of ['rar', 'unrar']) {
      const r = spawnSync(name, ['--version'], { stdio: 'ignore' });
      if (!r.error) return name;
    }
    throw new Error(
      'rar / unrar not found. Install via your package manager, e.g.\n' +
      '  Debian/Ubuntu:  sudo apt install rar\n' +
      '  macOS:          brew install --cask rar'
    );
  }
}

// ===========================================================================
//  5. 构造 staging 目录并打包一个平台
// ===========================================================================
function buildOne({ suffix, launch, readme }, rarBin) {
  const pkgName = `${APPNAME}-${VERSION}-${suffix}`;
  const stg = path.join(PROJ, 'dist', 'staging', pkgName);
  const out = path.join(PROJ, 'dist', `${pkgName}.rar`);

  console.log(`\n[BUILD] ${suffix}  ==>  ${out}`);

  // 清理 staging
  rmrf(stg);
  fs.mkdirSync(stg, { recursive: true });

  // [1/4] 拷贝应用文件
  console.log('   [1/4] Copying application files ...');
  fs.copyFileSync(path.join(PROJ, 'server.js'), path.join(stg, 'server.js'));
  fs.copyFileSync(path.join(PROJ, 'package.json'), path.join(stg, 'package.json'));
  // 启动脚本：.sh / .command 是 Unix 格式, 强制 LF 换行 (避免 Windows CRLF
  // 在 macOS / Linux 上引起 shebang / 行尾问题); .bat 保留 CRLF 不动
  const launchSrc = path.join(PROJ, launch);
  const launchDst = path.join(stg, launch);
  const isUnixLaunch = launch.endsWith('.sh') || launch.endsWith('.command');
  if (isUnixLaunch) {
    const text = fs.readFileSync(launchSrc, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(launchDst, text, 'utf8');
  } else {
    fs.copyFileSync(launchSrc, launchDst);
  }
  for (const f of RAR_FILES) {
    const src = path.join(PROJ, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(stg, f));
    }
  }

  // [2/4] 拷贝 public/
  console.log('   [2/4] Copying public/ ...');
  copyDir(path.join(PROJ, 'public'), path.join(stg, 'public'));

  // [3/4] 生成 使用说明.txt（UTF-8 写入，Node 默认就是 UTF-8）
  console.log('   [3/4] Generating 使用说明.txt ...');
  fs.writeFileSync(path.join(stg, '使用说明.txt'), readme(VERSION), 'utf8');

  // [4/4] 调用 rar 创建压缩包
  console.log('   [4/4] Creating RAR archive ...');
  //  -r    递归
  //  -ep1  丢弃绝对路径前缀（避免出现 dist\staging\xxx\ 层级）
  //  -m5   最佳压缩
  //  -cfg- 不写注册表风格 ini
  //  -os   关闭 NTFS 流，避免 Linux 解压时报 [share]
  const args = [
    'a',
    '-r',
    '-ep1',
    '-m5',
    '-cfg-',
    '-os',
    out,
    path.join(stg, '*'),
  ];
  const r = spawnSync(rarBin, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`rar exited with code ${r.status}`);
  }

  console.log(`   [OK]   ${out}`);
}

// ===========================================================================
//  6. 构造开发包 (dev target)
//     - 输出 Student-Management-System-<version>-dev.zip
//     - 内容是完整项目源码（按项目内所有 .gitignore 规则排除）
//     - 用 zip 格式：
//         Windows: PowerShell Compress-Archive（系统自带，无需安装）
//         Linux/macOS: zip（系统或包管理器自带）
//     - 无需 rar 工具
//
//  排除策略 = "Git-native"：完全按 .gitignore 规则决定
//     - 收集项目根 + 全部子目录里的 .gitignore（递归扫描）
//     - 子目录的 .gitignore 优先于父目录的 .gitignore（深处优先）
//     - 同一个 .gitignore 内从下到上处理，最后一条匹配生效
//     - 不需要 npm 依赖：内置一个 .gitignore glob → regex 编译器，
//       覆盖 * / ** / ? / [...] / ! / / 锚定 / 末尾 / 仅目录 这些常用语法
//
//  唯一**硬编码**始终排除的顶层目录（与 .gitignore 内容无关，由 dev 包语义决定）：
//     .git  (git 历史)
//     node_modules  (项目零依赖，dev 包不该携带)
//     data   (运行期用户数据，含密码 hash 等敏感信息)
//     dist   (本工具自身产生的构建产物目录)
//     fpk    (打包fpk.bat 的产物目录)
//     .trae  (IDE 工具缓存)
// ===========================================================================

// 硬编码顶层黑名单：dev 包永远不该包含的目录（不论 .gitignore 怎么写）
//   这些是"项目层"语义决定，与文件类型无关；把它们写进 .gitignore 不合适
//   （例如 .git 目录本就不应该出现在 .gitignore 中——那是 git 的事实）
const DEV_HARDCODED_EXCLUDE = new Set([
  '.git',
  'node_modules',
  'data',
  'dist',
  'fpk',
  '.trae',
  '.playwright-cli',   // playwright-cli 工具产物（DOM dump 缓存），不属于项目资产
]);

/**
 * 把 .gitignore 的 glob 模式编译成正则
 *   支持语法：
 *     *        任意不含 / 的字符
 *     **       任意字符（含 /）
 *     ?        单个不含 / 的字符
 *     [abc]    字符集
 *     /pattern 仅匹配根（外部处理，不参与编译）
 *     pattern/ 仅匹配目录（外部处理，不参与编译）
 */
function compileGitignoreGlob(pattern) {
  // 占位符避开后续正则字符替换
  let p = pattern;

  // 1) 字符集占位（避免被 . 替换等破坏）
  p = p.replace(/\[([^\]]*)\]/g, (_, body) => `\x01[${body}]\x01`);

  // 2) 转义正则元字符（保留 * ? 还有占位符）
  p = p.replace(/[.+^$|(){}]/g, '\\$&');

  // 3) ** → .* （先于 * 处理）
  p = p.replace(/\*\*/g, '\x02');

  // 4) * → [^/]*
  p = p.replace(/\*/g, '[^/]*');

  // 5) ? → [^/]
  p = p.replace(/\?/g, '[^/]');

  // 6) 还原 ** 占位
  p = p.replace(/\x02/g, '.*');

  // 7) 还原字符集占位（去掉之前的转义）
  p = p.replace(/\x01\[([^\]]*)\]\x01/g, (_, body) =>
    body.replace(/\\\+/g, '+').replace(/\\\./g, '.'));

  return new RegExp('^' + p + '$');
}

/**
 * 解析单个 .gitignore 文件，返回规则数组
 *   规则：{ pattern, regex, negation, anchored, dirOnly }
 */
function parseGitignore(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const rules = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.replace(/^\s+|\s+$/g, '');
    if (!trimmed || trimmed.startsWith('#')) continue;

    let line = trimmed;
    let negation = false;
    if (line.startsWith('!')) { negation = true; line = line.slice(1); }

    let anchored = false;
    if (line.startsWith('/')) { anchored = true; line = line.slice(1); }

    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }

    if (!line) continue;

    rules.push({
      pattern: line,
      regex: compileGitignoreGlob(line),
      negation,
      anchored,
      dirOnly,
    });
  }
  return rules;
}

/**
 * 递归收集项目里所有 .gitignore
 *   跳过 DEV_HARDCODED_EXCLUDE 下的目录（避免无谓扫描 .git/ / node_modules/）
 *   返回 [{ dir, rules }]
 */
function collectGitignores(rootDir) {
  const result = [];
  function walk(dir) {
    const giPath = path.join(dir, '.gitignore');
    if (fs.existsSync(giPath)) {
      result.push({ dir, rules: parseGitignore(giPath) });
    }
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      if (DEV_HARDCODED_EXCLUDE.has(ent.name)) continue;
      walk(path.join(dir, ent.name));
    }
  }
  walk(rootDir);
  return result;
}

/**
 * 判断 absPath 是否被任意 .gitignore 规则忽略
 *   评估顺序：
 *     1) 子目录 .gitignore 先评估（深处优先）—— 子目录规则覆盖父目录
 *     2) 同一个 .gitignore 内规则从下到上处理（最后一条匹配生效）
 *   .gitignore 只作用于其所在目录及其子目录
 *   stat: fs.Stats（需要判断 isDirectory()，dirOnly 规则用得上）
 */
function isIgnoredByGitignores(absPath, stat, gitignores, rootDir) {
  const isDir = stat ? stat.isDirectory() : false;

  // 按"相对 rootDir 的路径深度"深的优先
  const sorted = [...gitignores].sort((a, b) => {
    const da = path.relative(rootDir, a.dir).split(/[\\/]/).filter(Boolean).length;
    const db = path.relative(rootDir, b.dir).split(/[\\/]/).filter(Boolean).length;
    return db - da;
  });

  let ignored = false;
  for (const { dir, rules } of sorted) {
    // .gitignore 只对其目录及子目录生效
    if (absPath !== dir && !absPath.startsWith(dir + path.sep)) continue;

    const rel = path.relative(dir, absPath).split(/[\\/]/).join('/');
    const base = path.basename(absPath);

    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r.dirOnly && !isDir) continue;

      let matched;
      if (r.anchored) {
        matched = r.regex.test(rel);
      } else {
        // 非锚定：既匹配 rel 也匹配 base
        // 例如 `*.log` 应匹配任意深度的 xxx.log
        matched = r.regex.test(rel) || r.regex.test(base);
      }
      if (matched) ignored = !r.negation;
    }
  }
  return ignored;
}

/**
 * 把项目根目录按 .gitignore 规则拷到 staging 目录
 *   1. 硬编码顶层黑名单（DEV_HARDCODED_EXCLUDE）始终跳过
 *   2. 其余按项目内全部 .gitignore 评估
 */
function prepareDevStaging(stg) {
  const PROJ_ABS = path.resolve(PROJ);
  const gitignores = collectGitignores(PROJ_ABS);

  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const s = path.join(dir, ent.name);
      const rel = path.relative(PROJ_ABS, s);

      // 1) 硬编码顶层黑名单（路径首段命中即跳过）
      const firstSeg = rel.split(/[\\/]/)[0];
      if (DEV_HARDCODED_EXCLUDE.has(firstSeg)) continue;

      // 2) .gitignore 评估
      if (isIgnoredByGitignores(s, ent, gitignores, PROJ_ABS)) continue;

      const d = path.join(stg, rel);
      if (ent.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        walk(s);
      } else if (ent.isFile()) {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
    }
  }
  walk(PROJ_ABS);
}

/**
 * 调用系统 zip 工具打包
 *   Windows: PowerShell Compress-Archive
 *   Linux/macOS: zip -r
 */
function zipStaging(stg, zipFile) {
  if (process.platform === 'win32') {
    // Windows: PowerShell Compress-Archive
    //   -Force 覆盖已存在的目标
    //   -Path 接受通配符 'staging\*' 等
    //   注意：路径里有空格时整个参数要加单引号
    const stgQ = `'${stg}\\*'`;
    const outQ = `'${zipFile}'`;
    const ps = [
      'Compress-Archive',
      `-Path ${stgQ}`,
      `-DestinationPath ${outQ}`,
      '-Force',
    ].join(' ');
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    if (r.status !== 0) {
      throw new Error(`PowerShell Compress-Archive exited with code ${r.status}`);
    }
  } else {
    // Linux/macOS: 切换到 staging 父目录，用 zip -r 把 staging/<pkgName>/ 内的
    // 内容压到 <pkgName>.zip（带顶层目录名）
    const pkgName = path.basename(stg);
    const parent = path.dirname(stg);
    // 检查 zip 是否可用
    const probe = spawnSync('zip', ['--version'], { stdio: 'ignore' });
    if (probe.error) {
      throw new Error(
        'zip command not found. Install via your package manager, e.g.\n' +
        '  Debian/Ubuntu:  sudo apt install zip\n' +
        '  macOS:          zip 通常自带；或 brew install zip'
      );
    }
    const r = spawnSync('zip', ['-r', '-q', '-X', `${pkgName}.zip`, `${pkgName}/`], {
      cwd: parent,
      stdio: 'inherit',
    });
    if (r.status !== 0) {
      throw new Error(`zip exited with code ${r.status}`);
    }
    // zip 把产物写到了 parent/<pkgName>.zip，移动到期望位置
    const generated = path.join(parent, `${pkgName}.zip`);
    if (path.resolve(generated) !== path.resolve(zipFile)) {
      fs.renameSync(generated, zipFile);
    }
  }
}

function buildDev() {
  const pkgName = `${APPNAME}-${VERSION}-dev`;
  const stg = path.join(PROJ, 'dist', 'staging', pkgName);
  const out = path.join(PROJ, 'dist', `${pkgName}.zip`);

  console.log(`\n[BUILD] dev  ==>  ${out}`);

  rmrf(stg);
  fs.mkdirSync(stg, { recursive: true });

  // [1/3] 把项目源码（按黑名单过滤）拷到 staging
  console.log('   [1/3] Copying source files (excluding .git / node_modules / data / dist / *.rar / *.zip / ...) ...');
  prepareDevStaging(stg);

  // 统计文件数（仅供日志）
  let fileCount = 0;
  (function count(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) count(p);
      else if (ent.isFile()) fileCount++;
    }
  })(stg);
  console.log(`         -> 包含 ${fileCount} 个文件`);

  // [2/3] 写一个开发包专属的 README（dev pack 自述）
  console.log('   [2/3] Generating 开发包说明.md ...');
  const devReadme = `# ${APPNAME} v${VERSION} (Development Package / 源代码包)

本压缩包是「学生管理系统」的**开发包**，面向二次开发者，包含完整项目源码。

> 给终端用户的发布包请到项目 GitHub Releases 下载对应平台的 rar / fpk。

## 内容

- server.js                  HTTP 服务：REST API 路由 + 静态文件托管 + 登录认证
- package.json               版本号与项目元信息（单一来源 version 字段）
- build.js                   打包构建工具（node build.js [win|linux|macos|all|dev]）
- release.js                 GitHub Release 创建 + 资产上传
- pull.js / push.js          Git 拉取 / 推送逻辑（被 .bat 调用）
- 运行.bat                   Windows 启动（自动打开浏览器）
- 启动.sh                    Linux 启动（自动打开浏览器）
- 启动.command               macOS 启动（Finder 双击即可）
- 拉取.bat / 推送.bat        Git 拉取 / 推送（带 token 注入与脱敏）
- 打包rar-{win,linux,mac}.bat/.sh   打 rar 发布包
- 打包fpk.bat                打 fnOS .fpk 包（仅 Windows）
- 打包全部.bat / .sh         一键打全部平台产物
- 打包dev.bat / .sh          打开发包（zip）
- 发布.bat                   一键发布新版本到 GitHub
- Dockerfile                 生产镜像（Alpine + Node 20）
- docker-compose.yml         一键部署，数据卷持久化
- fnos/                      飞牛 NAS 应用 SDK（含 manifest / build-fpk 脚本 / fnpack.exe）
- public/                    前端（HTML / JS / CSS）
- docs/                      README 引用的截图
- README.md                  项目说明（运行环境 / 启动方式 / 打包 / API 等）
- CHANGELOG.md               版本变更日志

## 已排除（开发者按需自取）

dev 包按项目内**所有 .gitignore**（项目根 + **fnos/.gitignore**）的规则排除文件，并附加几个硬编码顶层黑名单（**.git/**、**node_modules/**、**data/**、**dist/**、**fpk/**、**.trae/**）作为"项目层语义"兜底。

**主 .gitignore 排除的常见项：**

| 排除项 | 原因 |
|---|---|
| **node_modules/** | 项目零依赖，无需 node_modules |
| **data/** | 运行期数据，应单独备份；server.js 首次写入时自动创建 |
| **dist/** / **fpk/** | 构建产物目录，不打包自身 |
| **\*.rar** **\*.zip** **\*.fpk** **\*.tar** **\*.gz** **\*.tgz** **\*.7z** | 其他构建产物 |
| **\*.log** **\*.tmp** **\*.bak** **\*.swp** **\*.swo** | 临时 / 备份文件 |
| **test_\*.txt** | 调试时 cmd/node 输出重定向的临时日志 |
| **.env** **.env.local** **.env.\*.local** | 含 GITHUB_TOKEN 等机密，绝不能入库 |
| **.DS_Store** **Thumbs.db** **desktop.ini** | 平台杂项 |

**fnos/.gitignore 额外排除**（在 dev 包里实际未包含）：

| 排除项 | 原因 |
|---|---|
| **student-management-system/app/server/** | 由 build-fpk 脚本从项目根复制进来，不入库 |
| **student-management-system/\*.fpk** | fpk 打包产物 |
| **fnpack** / **fnpack.exe** | 本地下载的打包工具，文件很大 |

**硬编码顶层黑名单**（与 .gitignore 无关，dev 包语义必需）：**.git**、**node_modules**、**data**、**dist**、**fpk**、**.trae**

> 修改项目根 **.gitignore** 或 **fnos/.gitignore** 后，下一次 **node build.js dev** 自动按新规则过滤，**无需改 build.js**。

## 快速开始（作为开发者）

1. 解压后进入项目目录

       cd Student-Management-System-${VERSION}-dev

2. 直接运行（项目零依赖，无需 npm install）

       node server.js

3. 浏览器访问 <http://localhost:3000>
   默认账号 admin / admin123

## 打包构建

- 单独打某个平台：

      node build.js win
      node build.js linux
      node build.js macos

- 一次打全部平台：

      node build.js all

- 打开发包（生成 -dev.zip）：

      node build.js dev

## 发布新版本

1. 修改 package.json 的 version 字段
2. 编辑 CHANGELOG.md 加新版本条目
3. git commit
4. 双击 发布.bat（Windows），或在 Linux/macOS 上：

       ./打包全部.sh && node release.js

发布前需在项目根 \`.env\` 配好：

    GITHUB_REPO_URL=https://github.com/<owner>/<repo>.git
    GITHUB_TOKEN=ghp_xxx

## 许可与作者

详见 [README.md](./README.md) 与 [CHANGELOG.md](./CHANGELOG.md)。
`;
  fs.writeFileSync(path.join(stg, '开发包说明.md'), devReadme, 'utf8');

  // [3/3] 打成 zip
  console.log('   [3/3] Creating ZIP archive ...');
  zipStaging(stg, out);

  const sz = fs.statSync(out).size;
  const szKB = (sz / 1024).toFixed(1);
  console.log(`   [OK]   ${out}  (${szKB} KB, ${fileCount} 个文件)`);
}
function main() {
  console.log(
    `=== Build package(s): ${APPNAME} v${VERSION}  [target=${target}] ===`
  );

  // 准备输出目录
  const distDir = path.join(PROJ, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  // ---- dev target: 走 buildDev，不需要 rar 工具 ----
  if (target === 'dev') {
    // 清理旧 dev 包
    const old = path.join(distDir, `${APPNAME}-${VERSION}-dev.zip`);
    if (fs.existsSync(old)) fs.unlinkSync(old);

    try {
      buildDev();
    } catch (e) {
      console.error(`\n[ERROR] Build FAILED: ${e.message}`);
      rmrf(path.join(distDir, 'staging'));
      process.exit(1);
    }
    rmrf(path.join(distDir, 'staging'));
    console.log(`\n=== Done ===`);
    console.log(`Output: ${path.join(distDir, `${APPNAME}-${VERSION}-dev.zip`)}`);
    console.log(``);
    console.log(`Usage:`);
    console.log(`  给二次开发者：解压后 cd 进入目录，node server.js 直接运行`);
    return;
  }

  // ---- rar target: 需要定位 rar 工具 ----
  let rarBin;
  try {
    rarBin = locateRar();
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  console.log(`[INFO] Using rar: ${rarBin}`);

  // 清理旧产物 —— 只清当前 target 对应的旧包，避免打一个平台时把另一个平台
  // 之前打好的包误删掉 (target=all 时才三个都清)。
  const suffixesToClean = target === 'all' ? ['win', 'linux', 'macos'] : [target];
  for (const suffix of suffixesToClean) {
    const old = path.join(distDir, `${APPNAME}-${VERSION}-${suffix}.rar`);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  // 列出要构建的平台
  const jobs = [];
  if (target === 'win' || target === 'all') {
    jobs.push({
      suffix: 'win',
      launch: '运行.bat',
      readme: readmeWin,
    });
  }
  if (target === 'linux' || target === 'all') {
    jobs.push({
      suffix: 'linux',
      launch: '启动.sh',
      readme: readmeLinux,
    });
  }
  if (target === 'macos' || target === 'all') {
    jobs.push({
      suffix: 'macos',
      launch: '启动.command',
      readme: readmeMacos,
    });
  }

  try {
    for (const job of jobs) buildOne(job, rarBin);
  } catch (e) {
    console.error(`\n[ERROR] Build FAILED: ${e.message}`);
    rmrf(path.join(distDir, 'staging'));
    process.exit(1);
  }

  // 清理 staging
  rmrf(path.join(distDir, 'staging'));

  console.log(`\n=== Done ===`);
  console.log(`Output under: ${distDir}`);
  console.log(``);
  console.log(`Install:`);
  console.log(`  Windows : 解压后双击 运行.bat`);
  console.log(`  Linux   : 解压后 chmod +x 启动.sh && ./启动.sh`);
  console.log(`  macOS   : 解压后在 Finder 里双击 启动.command`);
}

main();