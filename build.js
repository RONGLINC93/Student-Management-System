#!/usr/bin/env node
/**
 * Student Management System - RAR package builder (cross-platform)
 *
 * 用法：
 *   node build.js                同时构建 Windows / Linux / macOS 三个 RAR 包
 *   node build.js win            只生成 Student-Management-System-<ver>-win.rar
 *                                （含 运行.bat）
 *   node build.js linux          只生成 Student-Management-System-<ver>-linux.rar
 *                                （含 启动.sh）
 *   node build.js macos          只生成 Student-Management-System-<ver>-macos.rar
 *                                （含 启动.command，Finder 双击即可）
 *   node build.js all            同不传参数
 *
 * 设计取舍：
 *   - 主流程用 Node.js 实现（项目本身已依赖 Node，无需引入新工具）
 *   - 这样可以彻底绕开 cmd 批处理中 if/call/括号块的怪异语法陷阱
 *   - UTF-8 文本写入是 Node 默认行为，Chinese README 不会再出问题
 *   - 跨平台（Windows / Linux / macOS）共用一份核心逻辑
 *
 * 依赖：
 *   - WinRAR（Windows，%ProgramFiles%\WinRAR\WinRAR.exe 或 PATH 中的 rar.exe）
 *   - rar（Linux/macOS，包管理器安装的 rar/unrar 命令行工具）
 *
 * 输出（位于 <项目根>/dist/）：
 *   Student-Management-System-<version>-win.rar
 *   Student-Management-System-<version>-linux.rar
 *   Student-Management-System-<version>-macos.rar
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

if (!['win', 'linux', 'macos', 'all'].includes(target)) {
  console.error(`Usage: node build.js [win|linux|macos|all]`);
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
//  6. 主流程
// ===========================================================================
function main() {
  console.log(
    `=== Build RAR package(s): ${APPNAME} v${VERSION}  [target=${target}] ===`
  );

  // 定位 rar 工具
  let rarBin;
  try {
    rarBin = locateRar();
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  console.log(`[INFO] Using rar: ${rarBin}`);

  // 准备输出目录
  const distDir = path.join(PROJ, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

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