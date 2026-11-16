@echo off
rem "Demarrer Impera" (ADR 0125, ops/pc/README.md): updates the CRM, then runs it until Ctrl+C in this window.
rem Launched by the desktop shortcut and by the scheduled task at the owner's logon (install-task.ps1).
chcp 65001 >nul
title Impera
cd /d "%~dp0..\.."
node ops\pc\start.mjs
if errorlevel 1 pause
