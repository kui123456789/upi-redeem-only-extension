@echo off
setlocal EnableExtensions
title GuJumpgate PPBoom

cd /d "%~dp0"

set "SERVICE_DIR=services\ppboom"
set "HELPER_SCRIPT=%SERVICE_DIR%\app.py"
set "REQUIREMENTS_FILE=%SERVICE_DIR%\requirements.txt"
set "LOG_DIR=data"
set "START_LOG=%LOG_DIR%\ppboom-start.log"
set "DEFAULT_HOST=127.0.0.1"
set "DEFAULT_PORT=8787"

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
if not exist "%REQUIREMENTS_FILE%" goto :helper_not_found

if "%~1"=="" (
  call :run_single %DEFAULT_PORT%
  goto :eof
)

call :validate_port %~1
if errorlevel 1 goto :invalid_port
call :run_single %~1
goto :eof

:resolve_python
if exist "python\python.exe" (
  set "PYTHON_EXE=%CD%\python\python.exe"
  set "PYTHON_ARGS="
  exit /b 0
)

if exist ".runtime\python\python.exe" (
  set "PYTHON_EXE=%CD%\.runtime\python\python.exe"
  set "PYTHON_ARGS="
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
call :print_start_info %~1
call :cleanup_existing_helper %~1
if errorlevel 1 goto :port_cleanup_failed
call :log_line "starting ppboom on port %~1"
"%PYTHON_EXE%" %PYTHON_ARGS% -m uvicorn services.ppboom.app:app --host %DEFAULT_HOST% --port %~1
set "HELPER_EXIT_CODE=%errorlevel%"
call :log_line "ppboom exited with code %HELPER_EXIT_CODE%"
if not "%HELPER_EXIT_CODE%"=="0" (
  echo.
  echo PPBoom failed to start. Exit code: %HELPER_EXIT_CODE%
  echo.
  echo Common causes:
  echo   1. Python is not installed or is older than 3.10.
  echo   2. The required modules are not installed. Run:
  echo      %PYTHON_EXE% %PYTHON_ARGS% -m pip install -r %REQUIREMENTS_FILE%
  echo   3. Port %~1 is already in use.
  echo.
  pause
)
exit /b %HELPER_EXIT_CODE%

:cleanup_existing_helper
set "CLEANED_EXISTING_HELPER="
for /f "tokens=5" %%A in ('netstat -ano -p tcp ^| findstr /R /C:":%~1 .*LISTENING"') do (
  if not "%%A"=="0" (
    call :log_line "stopping existing listener on port %~1 pid=%%A"
    echo Stopping existing PPBoom listener on port %~1 ^(PID %%A^)...
    taskkill /PID %%A /F >nul 2>nul
    if errorlevel 1 (
      call :log_line "failed to stop existing listener on port %~1 pid=%%A"
      exit /b 1
    )
    set "CLEANED_EXISTING_HELPER=1"
  )
)
if defined CLEANED_EXISTING_HELPER (
  timeout /t 1 /nobreak >nul
)
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
echo GuJumpgate PPBoom
echo ------------------------------------------------------------
echo Folder: %CD%
echo Python: %PYTHON_EXE% %PYTHON_ARGS%
"%PYTHON_EXE%" %PYTHON_ARGS% --version
if defined OPENAI_PAY_DEFAULT_PROXY (
echo Initial Proxy: configured via OPENAI_PAY_DEFAULT_PROXY
) else (
echo Initial Proxy: direct connection ^(OPENAI_PAY_DEFAULT_PROXY not set^)
)
if defined OPENAI_PAY_PROVIDER_PROXY (
echo Provider Proxy: configured via OPENAI_PAY_PROVIDER_PROXY
) else (
echo Provider Proxy: request/default fallback, or direct if none configured
)
echo Helper: http://%DEFAULT_HOST%:%~1
echo Check:  http://%DEFAULT_HOST%:%~1/health
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
echo If PPBoom is already running at http://%DEFAULT_HOST%:%~1/health, keep the old window open.
echo Otherwise, close the old process or use another port.
echo.
pause
exit /b 0

:port_cleanup_failed
echo.
echo Failed to stop the existing process on port %~1.
echo Please close the old PPBoom window or stop the process manually, then run this script again.
echo.
pause
exit /b 1

:invalid_port
call :log_line "invalid port %~1"
echo.
echo Invalid helper port: %~1
echo Port must be a number from 1 to 65535.
pause
exit /b 1

:python_not_found
call :log_line "python not found"
echo Python 3 not found. Please install Python 3.10+ and try again.
pause
exit /b 1

:python_too_old
call :log_line "python too old or unusable"
echo Python 3.10+ is required to run PPBoom.
"%PYTHON_EXE%" %PYTHON_ARGS% --version
pause
exit /b 1

:helper_not_found
call :log_line "helper files not found"
echo PPBoom helper files were not found.
echo Please run start-ppboom.bat from the GuJumpgate folder.
pause
exit /b 1

:usage
echo Usage:
echo   start-ppboom.bat
echo   start-ppboom.bat 8787
echo.
echo No arguments: start PPBoom on the default port 8787.
exit /b 0
