@echo off
rem Windows counterpart of start.sh. Batch rather than PowerShell because the default execution
rem policy refuses to run an unsigned .ps1, and a .cmd runs from cmd, PowerShell or Explorer alike.
setlocal
cd /d "%~dp0.." || exit /b 1

set "COMPOSE_FILES=-f docker-compose.yml"
rem Running nvidia-smi, not only finding it: a driver can be installed but non-functional.
where nvidia-smi >nul 2>&1 && nvidia-smi >nul 2>&1
if errorlevel 1 (
  echo No NVIDIA GPU detected - building CPU-only, slower stem separation.
) else (
  echo NVIDIA GPU detected - building with CUDA support.
  set "COMPOSE_FILES=%COMPOSE_FILES% -f docker-compose.gpu.yml"
)

rem `call`, so a docker that is itself a .cmd/.bat shim returns here instead of ending the script.
call docker compose %COMPOSE_FILES% up -d --build --remove-orphans
if errorlevel 1 exit /b %errorlevel%

set "SHOWN_PORT=%PORT%"
if not defined SHOWN_PORT set "SHOWN_PORT=8080"
echo.
echo CHORD is running at http://localhost:%SHOWN_PORT%
echo Stop it with scripts\stop.cmd
