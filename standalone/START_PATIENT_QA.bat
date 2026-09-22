@echo off
title QAdence - Trends and Analysis (Offline Localhost Edition)
cd /d "%~dp0"

echo ======================================================================
echo   QAdence - Trends and Analysis (Offline / Air-Gapped Local Edition)
echo ======================================================================
echo.
echo   * Self-contained: bundled Node.js and Python (NumPy/SciPy) engines
echo   * Security: strictly bound to 127.0.0.1 (NO external ports opened)
echo   * Permissions: runs in user space (NO admin rights required)
echo   * Statistical Analysis: Pearson, Spearman, Kendall, and Polynomial
echo.
echo Starting local application server...
echo.

set PORT=5000
set HOST=127.0.0.1

:: Automatically add bundled Python to session PATH and set PYTHON_PATH
if exist "%~dp0python\python.exe" (
  set "PATH=%~dp0python;%PATH%"
  set "PYTHON_PATH=%~dp0python\python.exe"
)

:: Locate portable Node.js runtime (bundled node.exe or system fallback)
set "NODE_CMD="
if exist "%~dp0node.exe" set "NODE_CMD=%~dp0node.exe"
if "%NODE_CMD%"=="" (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_CMD=node"
)

if not "%NODE_CMD%"=="" goto node_found

echo.
echo ======================================================================
echo   ERROR: Node.js runtime [node.exe] was not found!
echo ======================================================================
echo.
echo   This usually happens for one of two reasons:
echo.
echo   1. The ZIP archive was not extracted before running:
echo      - Please close this window.
echo      - Right-click standalone.zip and choose "Extract All...".
echo      - Open the newly extracted folder and run START_QADENCE.bat from there.
echo.
echo   2. Hospital Antivirus / Endpoint Security quarantined node.exe:
echo      - Check if your antivirus or Windows Defender blocked node.exe.
echo      - Restore node.exe or add an exclusion for the QAdence folder.
echo.
echo ======================================================================
echo.
pause
exit /b 1

:node_found

:: Automatically open default browser to the local app after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5000"

:: Launch local Node server using the located runtime
"%NODE_CMD%" "%~dp0server\index.js"

if errorlevel 1 (
  echo.
  echo Server encountered an error. Press any key to exit.
  pause >nul
)
