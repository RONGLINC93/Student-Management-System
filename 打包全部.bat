@echo off
rem ===========================================================================
rem  Student Management System - 一键打包全部平台 (Windows)
rem
rem  依次执行:
rem    1) 打包rar.bat   生成 Windows + Linux 的 rar 包
rem                     (Windows 上只会真正产出 win rar;
rem                      linux rar 需要在 Linux 上跑 打包全部.sh 才能产出)
rem    2) 打包fpk.bat   生成 fnOS fpk 包 (依赖 fnos\fnpack.exe)
rem
rem  用法: 双击本文件, 或在 cmd 中执行  打包全部.bat
rem  前置: Node.js 14+, 并且 fnos\fnpack.exe 已就位 (用于 fpk 步骤)
rem ===========================================================================

cd /d "%~dp0"

echo === [1/2] RAR packages (Windows / Linux) ===
echo.
rem  设置 PACKAGE_ALL 让 打包rar.bat 不再倒计时 / 不再打开资源管理器
set "PACKAGE_ALL=1"
call "%~dp0打包rar.bat"
set "PACKAGE_ALL="
if errorlevel 1 goto fail

echo.
echo === [2/2] fnOS fpk package ===
echo.
call "%~dp0打包fpk.bat"
if errorlevel 1 goto fail

echo.
echo === All packages built. 输出目录: dist/ ===
rem explorer 返回值不可靠, 用 start 兜底
start "" "%~dp0dist"
call :countdown 5
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
echo Closing in %~1 seconds... (Ctrl+C to cancel)
for /l %%i in (%~1,-1,1) do (
    echo   %%i...
    ping -n 2 127.0.0.1 >nul
)
exit /b 0