@echo off
title QAdence - Trends & Analysis (Offline Localhost Edition)
cd /d "%~dp0"

echo ======================================================================
echo   QAdence - Trends & Analysis (Offline / Air-Gapped Local Edition)
echo ======================================================================
echo.
echo   * Self-contained: runs without Node.js installation
echo   * Security: strictly bound to 127.0.0.1 (NO external ports opened)
echo   * Permissions: runs in user space (NO admin rights required)
echo.
echo Starting local application server...
echo.

set PORT=5000
set HOST=127.0.0.1

:: Automatically open default browser to the local app after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5000"

:: Launch local Node server using the bundled portable runtime
".\node.exe" "server\index.js"

if errorlevel 1 (
  echo.
  echo Server encountered an error. Press any key to exit.
  pause >nul
)
