@echo off
rem Windows counterpart of stop.sh.
setlocal
cd /d "%~dp0.." || exit /b 1

docker compose down --remove-orphans
