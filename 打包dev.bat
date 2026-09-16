@echo off
rem 切换到 UTF-8 代码页, 避免中文输出乱码
chcp 65001 >nul 2>&1

rem ===========================================================================
rem  Student Management System - 开发包 (zip) 打包
rem
rem  真正的打包逻辑在 build.js（Node.js 跨平台脚本）。
rem  这个 .bat 只是为了方便 Windows 用户双击 / 在 cmd 中使用。
rem
rem  产物：dist\Student-Management-System-<version>-dev.zip
rem    - 含完整项目源码（除 .git / node_modules / data / dist / *.rar / .env 等）
rem    - zip 格式，PowerShell Compress-Archive 自带，无需额外工具
rem    - 面向二次开发者：解压后 node server.js 直接运行
rem
rem  前置：Node.js 14+ 已安装并在 PATH 中
rem ===========================================================================

rem  把当前目录切换到脚本所在目录，避免相对路径出错
cd /d "%~dp0"

rem  固定只打 dev 包
node "%~dp0build.js" dev

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See messages above.
    call :countdown 5
    exit /b 1
)

rem  成功提示 + 打开输出目录
echo.
echo === Done. 输出文件: %~dp0dist\Student-Management-System-*-dev.zip ===
start "" "%~dp0dist" 2>nul
call :countdown 5

exit /b 0

rem ---------------------------------------------------------------------------
rem  :countdown <秒数>
rem  从 <秒数> 倒数到 0, 每秒打印剩余秒数 (Ctrl+C 可中断).
rem ---------------------------------------------------------------------------
    :countdown
echo.
echo %~1 秒后自动关闭窗口... (按 Ctrl+C 取消)
for /l %%i in (%~1,-1,1) do (
    echo   %%i...
    ping -n 2 127.0.0.1 >nul
)
exit /b 0