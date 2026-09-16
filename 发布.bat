@echo off
rem 切换到 UTF-8 代码页, 避免中文输出乱码
chcp 65001 >nul 2>&1

rem ===========================================================================
rem  Student Management System - 一键发布新版本 (Windows)
rem
rem  依次执行:
rem    1) 打包全部.bat  构建全部产物 (Windows/Linux/macOS rar + fnOS fpk + dev 源码 zip)
rem    2) release.js    从 package.json 读 version, 创建 git tag 并推送,
rem                     再用 GitHub API 创建 Release 并上传 dist/ 下的产物
rem                     (Win/Linux/macOS rar + fpk + dev zip)
rem    3) 发布成功后, release.js 自动把 package.json 的 version patch +1
rem                     并本地 commit, 供下一次发布直接使用
rem    4) 从 dist\.last-release.json 读取并打印发布结果, 然后倒计时关闭
rem
rem  用法: 双击本文件, 或在 cmd 中执行  发布.bat
rem
rem  前置:
rem    - Node.js 14+ 已安装并在 PATH 中
rem    - .env 配置好 GITHUB_REPO_URL 与 GITHUB_TOKEN (拉取.bat / 推送.bat 同款)
rem    - GITHUB_TOKEN 需有 repo 权限 (创建 Release + 上传资产)
rem    - fnos\fnpack.exe 已就位 (打包全部.bat 依赖)
rem    - package.json 的 version 即本次要发布的版本, 且已 commit
rem
rem  注意:
rem    - 发布完成后才会自动叠加版本号 (patch +1 并本地 commit, 不推送),
rem      发布失败则版本号保持不变
rem    - 如需 minor/major 跳版 (如 1.4.3 -> 1.5.0), 在下次发布前手工改即可
rem    - Release body 自动从 CHANGELOG.md 提取该版本段
rem    - 发布结果会持久化到 dist\.last-release.json 供查阅
rem ===========================================================================

cd /d "%~dp0"

echo === [1/2] Build all packages ===
echo.
rem  设置 PACKAGE_ALL 让 打包全部.bat 内部不再打开资源管理器 / 不再倒计时
set "PACKAGE_ALL=1"
call "%~dp0打包全部.bat"
set "PACKAGE_ALL="
if errorlevel 1 goto fail

echo.
echo === [2/2] Tag, Release and upload to GitHub ===
echo.
node "%~dp0release.js"
if errorlevel 2 goto warn
if errorlevel 1 goto fail

rem 全部成功 - 从 dist\.last-release.json 读取并显示结果
echo.
echo === [结果] 发布成功 ===
if exist "dist\.last-release.json" (
  node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8'));console.log('  版本:    '+j.tagName);console.log('  Release: '+j.html_url);console.log('  资产:');for (const a of j.assets){console.log('    - '+a.name+(a.ok?'  [OK]':'  [FAIL HTTP '+a.status+']'));}" "dist\.last-release.json"
) else (
  echo   (dist\.last-release.json 未生成, 见上方 release.js 输出)
)
echo.
echo   详情: dist\.last-release.json
call :countdown 5
exit /b 0

:warn
rem Release 已建, 部分资产上传失败
echo.
echo === [结果] Release 已创建, 部分资产上传失败 ===
if exist "dist\.last-release.json" (
  node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf-8'));console.log('  Release: '+j.html_url);console.log('  资产:');for (const a of j.assets){console.log('    - '+a.name+(a.ok?'  [OK]':'  [FAIL HTTP '+a.status+']'));}" "dist\.last-release.json"
)
echo.
echo   失败资产可手动重传到上方 Release URL
call :countdown 5
exit /b 2

:fail
echo.
echo [ERROR] Release failed. See messages above.
call :countdown 5
exit /b 1

rem ---------------------------------------------------------------------------
rem  :countdown <秒数>
rem  从 <秒数> 倒数到 0, 每秒打印剩余秒数 (Ctrl+C 可中断).
rem  本子例程只倒计时不退出, 调用方负责 exit /b.
rem ---------------------------------------------------------------------------
:countdown
echo.
echo %~1 秒后自动关闭窗口... (按 Ctrl+C 取消)
for /l %%i in (%~1,-1,1) do (
    echo   %%i...
    ping -n 2 127.0.0.1 >nul
)
rem  双击运行 (PACKAGE_ALL 未设) 时 exit (不带 /b) 会关掉 cmd 窗口;
rem  嵌套调用 (打包全部.bat 之类) 时 PACKAGE_ALL=1, 仍走 exit /b 让调用方继续。
if "%PACKAGE_ALL%"=="" exit
exit /b 0