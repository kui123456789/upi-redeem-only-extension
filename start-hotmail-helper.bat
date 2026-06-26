@echo off
setlocal EnableExtensions
title GuJumpgate Hotmail Helper

cd /d "%~dp0"

set "HELPER_SCRIPT=scripts\hotmail_helper.py"
set "LOG_DIR=data"
set "START_LOG=%LOG_DIR%\hotmail-helper-start.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>nul
call :log_line "launcher opened"

if /i "%~1"=="/?" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage

call :resolve_python
if errorlevel 1 goto :python_not_found

call :validate_python_version
if errorlevel 1 goto :python_too_old

if not exist "%HELPER_SCRIPT%" goto :helper_not_found

if /i "%~1"=="--run-port" (
  if "%~2"=="" goto :usage
  call :run_single %~2
  goto :eof
)

if "%~1"=="" (
  call :run_single 17373
  goto :eof
)

set "PORT_ARGS=%*"
set "PORT_ARGS=%PORT_ARGS:,= %"
set "PORT_ARGS=%PORT_ARGS:;= %"

for %%P in (%PORT_ARGS%) do (
  call :start_instance %%~P
)
goto :eof

:resolve_python
if exist "python\python.exe" (
  set "PYTHON_EXE=%CD%\python\python.exe"
  set "PYTHON_ARGS="
  call :log_line "using bundled python\python.exe"
  exit /b 0
)

if exist ".runtime\python\python.exe" (
  set "PYTHON_EXE=%CD%\.runtime\python\python.exe"
  set "PYTHON_ARGS="
  call :log_line "using bundled .runtime\python\python.exe"
  exit /b 0
)

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON_EXE=py"
  set "PYTHON_ARGS=-3"
  exit /b 0
)

where python >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON_EXE=python"
  set "PYTHON_ARGS="
  exit /b 0
)

exit /b 1

:run_single
call :validate_port %~1
if errorlevel 1 goto :invalid_port

call :print_start_info %~1
call :check_port_available %~1
if errorlevel 1 goto :port_in_use

call :log_line "starting helper on port %~1"
"%PYTHON_EXE%" %PYTHON_ARGS% "%HELPER_SCRIPT%" --port %~1
set "HELPER_EXIT_CODE=%errorlevel%"
call :log_line "helper exited with code %HELPER_EXIT_CODE%"
if not "%HELPER_EXIT_CODE%"=="0" (
  echo.
  echo Hotmail Helper failed to start. Exit code: %HELPER_EXIT_CODE%
  echo.
  echo Common causes:
  echo   1. Python is not installed or is older than 3.10.
  echo   2. Port %~1 is already in use. Close the old helper window or use another port.
  echo   3. Security software blocked Python from starting a local 127.0.0.1 service.
  echo.
  pause
)
exit /b %HELPER_EXIT_CODE%

:start_instance
start "Hotmail Helper %~1" cmd /k ""%~f0" --run-port %~1"
exit /b 0

:validate_python_version
"%PYTHON_EXE%" %PYTHON_ARGS% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
exit /b %errorlevel%

:validate_port
echo(%~1| findstr /R "^[0-9][0-9]*$" >nul 2>nul
if errorlevel 1 exit /b 1
set /a HELPER_PORT=%~1 >nul 2>nul
if %HELPER_PORT% LSS 1 exit /b 1
if %HELPER_PORT% GTR 65535 exit /b 1
exit /b 0

:check_port_available
set "PORT_PID="
for /f "tokens=5" %%A in ('netstat -ano -p tcp ^| findstr /R /C:":%~1 .*LISTENING"') do (
  set "PORT_PID=%%A"
  exit /b 1
)
exit /b 0

:print_start_info
echo.
echo GuJumpgate Hotmail Helper
echo ------------------------------------------------------------
echo Folder: %CD%
echo Python: %PYTHON_EXE% %PYTHON_ARGS%
"%PYTHON_EXE%" %PYTHON_ARGS% --version
echo Helper: http://127.0.0.1:%~1
echo Check:  http://127.0.0.1:%~1/health
echo Log:    %CD%\%START_LOG%
echo ------------------------------------------------------------
echo Keep this window open while GuJumpgate is running.
echo.
exit /b 0

:log_line
>> "%START_LOG%" echo [%DATE% %TIME%] %~1
exit /b 0

:port_in_use
call :log_line "port %~1 already in use pid=%PORT_PID%"
echo.
echo Port %~1 is already in use.
echo.
echo This usually means Hotmail Helper is already running.
echo If GuJumpgate can connect to http://127.0.0.1:%~1, keep the old helper window open.
echo If GuJumpgate cannot connect, close the old helper window or end PID %PORT_PID%, then run this file again.
echo.
echo Tip: do not open multiple helpers on the same port.
echo.
pause
exit /b 0

:invalid_port
call :log_line "invalid port %~1"
echo.
echo Invalid helper port: %~1
echo Port must be a number from 1 to 65535.
echo Example:
echo   start-hotmail-helper.bat 17373
echo.
pause
exit /b 1

:python_not_found
call :log_line "python not found"
echo Python 3 not found. Please install Python 3.10+ and try again.
echo Download: https://www.python.org/downloads/windows/
pause
exit /b 1

:python_too_old
call :log_line "python too old or unusable"
echo Python 3.10+ is required to run Hotmail Helper.
echo Current Python:
"%PYTHON_EXE%" %PYTHON_ARGS% --version
echo.
echo Please install Python 3.10 or newer, then run this file again.
echo Download: https://www.python.org/downloads/windows/
pause
exit /b 1

:helper_not_found
call :log_line "helper script not found"
echo %HELPER_SCRIPT% was not found.
echo Please run start-hotmail-helper.bat from the extracted GuJumpgate folder.
pause
exit /b 1

:usage
echo Usage:
echo   start-hotmail-helper.bat
echo   start-hotmail-helper.bat 17373
echo   start-hotmail-helper.bat 17373 17374 17375
echo   start-hotmail-helper.bat 17373,17374,17375
echo.
echo No arguments: start one helper on the default port 17373 in the current window.
echo One or more ports: launch one helper window per port.
exit /b 0
