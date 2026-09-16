@echo off
rem 切换到 UTF-8 代码页, 避免中文输出乱码
chcp 65001 >nul 2>&1

rem ===========================================================================
rem  Student Management System - 一键打包全部产物 (Windows)
rem
rem  依次执行:
rem    1) 打包rar-win.bat   生成 Windows 版 rar (含 运行.bat)
rem    2) 打包rar-linux.bat 生成 Linux 版 rar   (含 启动.sh)
rem    3) 打包rar-mac.bat   生成 macOS 版 rar   (含 启动.command, Finder 双击即可)
rem    4) 打包fpk.bat       生成 fnOS fpk 包   (依赖 fnos\fnpack.exe)
rem    5) 打包dev.bat       生成 dev 源码 zip  (面向二次开发者, 随 Release 上传)
rem
rem  用法: 双击本文件, 或在 cmd 中执行  打包全部.bat
rem  前置: Node.js 14+, 并且 fnos\fnpack.exe 已就位 (用于 fpk 步骤)
rem ===========================================================================

rem  缓存外层 PACKAGE_ALL, 用于末尾判断是否嵌套调用
rem    (中间流程会用 set "PACKAGE_ALL=" 清空, 所以不能直接看 PACKAGE_ALL)
set "WAS_NESTED=%PACKAGE_ALL%"

cd /d "%~dp0"

echo === [1/4] Windows RAR package ===
echo.
rem  设置 PACKAGE_ALL 让 打包rar-win.bat 不再倒计时 / 不再打开资源管理器
set "PACKAGE_ALL=1"
call "%~dp0打包rar-win.bat"
set "PACKAGE_ALL="
if errorlevel 1 goto fail

echo.
echo === [2/4] Linux RAR package ===
echo.
rem  设置 PACKAGE_ALL 让 打包rar-linux.bat 不再倒计时 / 不再打开资源管理器
set "PACKAGE_ALL=1"
call "%~dp0打包rar-linux.bat"
set "PACKAGE_ALL="
if errorlevel 1 goto fail

echo.
echo === [3/4] macOS RAR package ===
echo.
rem  设置 PACKAGE_ALL 让 打包rar-mac.bat 不再倒计时 / 不再打开资源管理器
set "PACKAGE_ALL=1"
call "%~dp0打包rar-mac.bat"
set "PACKAGE_ALL="
if errorlevel 1 goto fail

echo.
echo === [4/5] fnOS fpk package ===
echo.
rem  设置 PACKAGE_ALL 让 打包fpk.bat 内部不再打开资源管理器 / 不再倒计时
set "PACKAGE_ALL=1"
call "%~dp0打包fpk.bat"
set "PACKAGE_ALL="
if errorlevel 1 goto fail

echo.
echo === [5/5] dev source package ===
echo.
rem  设置 PACKAGE_ALL 让 打包dev.bat 内部不再打开资源管理器 / 不再倒计时
set "PACKAGE_ALL=1"
call "%~dp0打包dev.bat"
set "PACKAGE_ALL="
if errorlevel 1 goto fail

echo.
echo === All packages built. 输出目录: dist/ ===
rem  单独运行 (WAS_NESTED 空) 时打开 dist + 倒计时关窗口
rem  被 发布.bat 等嵌套调用 (WAS_NESTED=1) 时跳过, 由外层脚本统一倒计时
if "%WAS_NESTED%"=="" (
    rem explorer 返回值不可靠, 用 start 兜底
    start "" "%~dp0dist"
    call :countdown 5
)
exit /b 0

:fail
echo.
echo [ERROR] Build failed. See messages above.
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