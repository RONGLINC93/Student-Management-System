@echo off
rem ===========================================================================
rem  fnOS (FeiNiu) fpk builder for the Student Management System
rem  Usage: double-click, or run  build-fpk.bat  from a terminal
rem  Prereq: fnpack.exe (Windows x86) put next to this file or added to PATH
rem          https://developer.fnnas.com/docs/cli/fnpack/
rem  NOTE: keep this file ASCII-only, batch parsing of non-ASCII is fragile.
rem ===========================================================================
setlocal
set "HERE=%~dp0"
set "PROJ=%HERE%.."
set "PKG=%HERE%student-management-system"
set "SERVER=%PKG%\app\server"

echo === Build fnOS fpk: Student Management System ===
echo.

echo [1/4] Copy application files...
if exist "%SERVER%" rmdir /s /q "%SERVER%"
mkdir "%SERVER%"
copy /y "%PROJ%\server.js" "%SERVER%\server.js" >nul
if errorlevel 1 goto fail
copy /y "%PROJ%\package.json" "%SERVER%\package.json" >nul
xcopy "%PROJ%\public" "%SERVER%\public" /e /i /y /q >nul
if errorlevel 1 goto fail

echo [2/4] Normalize newlines to LF...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%normalize-lf.ps1" -Path "%PKG%"
if errorlevel 1 goto fail

echo [3/4] Locate fnpack...
set "FNPACK="
if exist "%HERE%fnpack.exe" set "FNPACK=%HERE%fnpack.exe"
if not defined FNPACK for %%I in (fnpack.exe) do if not "%%~$PATH:I"=="" set "FNPACK=%%~$PATH:I"
if not defined FNPACK goto nofnpack
echo     %FNPACK%

echo [4/4] Packing and renaming (with version)...
pushd "%PKG%"
"%FNPACK%" build
set "RC=%ERRORLEVEL%"
popd
if not "%RC%"=="0" goto fail

rem --- append version from manifest: <appname>-<version>.fpk ---
set "APPNAME="
set "VERSION="
for /f "tokens=2 delims==" %%V in ('findstr /b /c:"appname" "%PKG%\manifest"') do set "APPNAME=%%V"
for /f "tokens=2 delims==" %%V in ('findstr /b /c:"version" "%PKG%\manifest"') do set "VERSION=%%V"
set "APPNAME=%APPNAME: =%"
set "VERSION=%VERSION: =%"
if not defined APPNAME set "APPNAME=student-management-system"
set "OUT=%PKG%\%APPNAME%.fpk"
if not defined VERSION goto noversion
set "OUTV=%PKG%\%APPNAME%-%VERSION%.fpk"
if exist "%PKG%\%APPNAME%.fpk" move /y "%PKG%\%APPNAME%.fpk" "%OUTV%" >nul
if exist "%OUTV%" set "OUT=%OUTV%"
:noversion

echo.
echo Done: %OUT%
echo Install: upload it in the fnOS App Center, or over SSH run
echo   appcenter-cli install-fpk "%OUT%"
echo.
pause
exit /b 0

:nofnpack
echo.
echo fnpack.exe not found.
echo Download the Windows x86 build from
echo   https://developer.fnnas.com/docs/cli/fnpack/
echo The downloaded file has no extension - rename it to fnpack.exe and put it in:
echo   %HERE%
echo.
pause
exit /b 1

:fail
echo.
echo Build FAILED. See the output above.
echo.
pause
exit /b 1
