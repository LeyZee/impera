@echo off
rem Installs, once, the start of Impera at the owner's logon (ops/pc/README.md). No administrator rights needed.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-task.ps1"
pause
