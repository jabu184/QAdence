@echo off
title Stop QAdence
cd /d "%~dp0"
echo Stopping QAdence local server...
taskkill /F /FI "WINDOWTITLE eq QAdence*" /T 2>nul
taskkill /F /FI "WINDOWTITLE eq Patient QA Analytics*" /T 2>nul
echo Done.
timeout /t 2 >nul
