@echo off
rem 切换到 UTF-8 代码页, 避免中文输出乱码
chcp 65001 >nul 2>&1

rem ===========================================================================
rem  Student Management System - 一键发布新版本 (Windows)
rem
rem  依次执行:
rem    1) 打包全部.bat   构建全部平台产物 (Windows/Linux rar + fnOS fpk)
rem    2) release.js     从 package.json 读 version, 创建 git tag 并推送
rem
rem  用法: 双击本文件, 或在 cmd 中执行  生成发布.bat
rem
rem  前置:
rem    - Node.js 14+ 已安装并在 PATH 中
rem    - .env 配置好 GITHUB_REPO_URL 与 GITHUB_TOKEN (拉取.bat / 推送.bat 同款)
rem    - fnos\fnpack.exe 已就位 (打包全部.bat 依赖)
rem    - package.json 的 version 已手工调整到目标版本号, 并 commit
rem
rem  注意:
rem    - 不会自动改版本号, 仅按 package.json 当前 version 打 v<version> tag
rem    - tag 推送成功后, 仍需到 GitHub Releases 页面基于该 tag 创建 Release
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
echo === [2/2] Tag and push to GitHub ===
echo.
node "%~dp0release.js"
if errorlevel 1 goto fail

echo.
echo === Release complete. 产物: dist\, git tag 已推送 ===
call :countdown 5
exit /b 0

::fail
echo.
echo [ERROR] Release failed. See messages above.
call :countdown 5
exit /b 1

rem ---------------------------------------------------------------------------
rem  :countdown <秒数>
rem  从 <秒数> 倒数到 0, 每秒打印剩余秒数 (Ctrl+C 可中断).
rem  本子例程只倒计时不退出, 调用方负责 exit /b.
rem ---------------------------------------------------------------------------
::countdown
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