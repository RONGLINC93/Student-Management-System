chcp 65001 >nul 2>&1
@echo off
rem ===========================================================================
rem  fnOS (飞牛) fpk 打包 - 学生管理系统
rem  用法: 双击本文件, 或在终端中执行。
rem        所有路径相对 %~dp0, 无论在哪个目录调用都构建当前脚本所在项目。
rem        无需先 cd 到此目录。
rem  前置: fnos\fnpack.exe (Windows x86) - 下载地址
rem          https://developer.fnnas.com/docs/cli/fnpack/
rem         (下载的文件无扩展名, 重命名为 fnpack.exe)
rem  输出: <项目根>\dist\<appname>-<version>.fpk (目录按需创建)
rem  说明: 文件用 UTF-8 (无 BOM) + 头部 chcp 65001 才能正确显示中文。
rem ===========================================================================
setlocal
set "PROJ=%~dp0"
set "FNOS=%PROJ%fnos"
set "PKG=%FNOS%\student-management-system"
set "SERVER=%PKG%\app\server"

echo === 构建 fnOS fpk: 学生管理系统 ===
echo.

echo [1/5] 复制应用文件...
if exist "%SERVER%" rmdir /s /q "%SERVER%"
mkdir "%SERVER%"
copy /y "%PROJ%server.js" "%SERVER%\server.js" >nul
if errorlevel 1 goto fail
copy /y "%PROJ%package.json" "%SERVER%\package.json" >nul
if errorlevel 1 goto fail
xcopy "%PROJ%public" "%SERVER%\public" /e /i /y /q >nul
if errorlevel 1 goto fail

echo [2/5] 同步 package.json 版本号到 manifest...
powershell -NoProfile -ExecutionPolicy Bypass -File "%FNOS%\sync-version.ps1" -From "%PROJ%package.json" -Manifest "%PKG%\manifest"
if errorlevel 1 goto fail

echo [3/5] 规范化换行符为 LF...
powershell -NoProfile -ExecutionPolicy Bypass -File "%FNOS%\normalize-lf.ps1" -Path "%PKG%"
if errorlevel 1 goto fail

echo [4/5] 定位 fnpack...
set "FNPACK="
if exist "%FNOS%\fnpack.exe" set "FNPACK=%FNOS%\fnpack.exe"
if not defined FNPACK if exist "%PROJ%fnpack.exe" set "FNPACK=%PROJ%fnpack.exe"
if not defined FNPACK for %%I in (fnpack.exe) do if not "%%~$PATH:I"=="" set "FNPACK=%%~$PATH:I"
if not defined FNPACK goto nofnpack
echo     %FNPACK%

echo [5/5] 打包并按版本号重命名...
pushd "%PKG%"
"%FNPACK%" build
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto fail

rem --- 输出目录: <项目根>\dist (按需创建) ---
set "OUTDIR=%PROJ%dist"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"
if errorlevel 1 goto fail

rem --- 重命名为 <appname>-<version>.fpk 并移到输出目录 ---
set "APPNAME="
set "VERSION="
for /f "tokens=2 delims==" %%V in ('findstr /b /c:"appname" "%PKG%\manifest"') do set "APPNAME=%%V"
for /f "tokens=2 delims==" %%V in ('findstr /b /c:"version" "%PKG%\manifest"') do set "VERSION=%%V"
set "APPNAME=%APPNAME: =%"
set "VERSION=%VERSION: =%"
if not defined APPNAME set "APPNAME=student-management-system"
set "BUILT=%PKG%\%APPNAME%.fpk"
set "OUTNAME=%APPNAME%.fpk"
if defined VERSION set "OUTNAME=%APPNAME%-%VERSION%.fpk"
if not exist "%BUILT%" goto fail
move /y "%BUILT%" "%OUTDIR%\%OUTNAME%" >nul
if errorlevel 1 goto fail
set "OUT=%OUTDIR%\%OUTNAME%"

echo.
echo === 完成. 输出: %OUT% ===
echo.
echo 安装: 上传到 fnOS 应用中心, 或通过 SSH 执行:
echo   appcenter-cli install-fpk "%OUT%"
echo.

rem --- 打开输出目录并定位刚打包的文件 ---
rem     (explorer 即便成功也返回非零退出码, 忽略即可)
rem     从 打包全部.bat 调用时跳过 (由外层脚本处理)
if "%PACKAGE_ALL%"=="" start "" "%PROJ%dist" 2>nul

echo.
if "%PACKAGE_ALL%"=="" call :countdown 5
exit /b 0

rem ---------------------------------------------------------------------------
rem  :countdown <秒数>
rem  从 <秒数> 倒数到 0, 每秒打印剩余秒数 (Ctrl+C 可中断)。
rem  本子例程只倒计时不退出, 调用方负责 exit /b。
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

:nofnpack
echo.
echo [错误] 找不到 fnpack.exe。
echo 请从以下地址下载 Windows x86 版本：
echo   https://developer.fnnas.com/docs/cli/fnpack/
echo 下载的文件无扩展名 - 请重命名为 fnpack.exe 并放到：
echo   %FNOS%
echo.
call :countdown 5
exit /b 1

:fail
echo.
echo [错误] 打包失败，详见上方信息。
echo.
call :countdown 5
exit /b 1
