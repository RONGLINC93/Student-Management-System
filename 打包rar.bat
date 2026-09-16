@echo off
rem ===========================================================================
rem  Student Management System - Windows 调用器
rem
rem  真正的打包逻辑在 build.js（Node.js 跨平台脚本）。
rem  这个 .bat 只是为了方便 Windows 用户双击 / 在 cmd 中使用。
rem
rem  用法（与 build.js 一致）：
rem     打包rar.bat                同时打两个平台
rem     打包rar.bat win            只打 Windows 版（含 运行.bat）
rem     打包rar.bat linux          只打 Linux 版（含 启动.sh）
rem     打包rar.bat all            同不传参数
rem
rem  前置：Node.js 14+ 已安装并在 PATH 中
rem ===========================================================================

rem  把当前目录切换到脚本所在目录，避免相对路径出错
cd /d "%~dp0"

rem  透传所有参数给 build.js；%~dp0build.js 会随 cmd 的当前代码页解析，
rem  但 build.js 内部只用 Node 默认 UTF-8，所以不会有编码问题。
node "%~dp0build.js" %*

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See messages above.
    if "%PACKAGE_ALL%"=="" call :countdown 5
    exit /b 1
)

rem  成功提示 + 打开输出目录。
rem  PACKAGE_ALL 由 打包全部.bat 在嵌套调用前设置，
rem  此时不再倒计时 / 不再打开资源管理器（外层已经做）。
if "%PACKAGE_ALL%"=="" (
    echo.
    echo === Done. 输出目录: %~dp0dist ===
    rem  start "" 返回值不可靠，但也不影响流程
    start "" "%~dp0dist" 2>nul
    call :countdown 5
)

exit /b 0

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