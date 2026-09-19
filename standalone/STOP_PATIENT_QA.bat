@echo off
title Stop Patient QA Analytics
cd /d "%~dp0"
echo Stopping Patient QA local server...
taskkill /F /FI "WINDOWTITLE eq Patient QA Analytics*" /T 2>nul
echo Done.
timeout /t 2 >nul
