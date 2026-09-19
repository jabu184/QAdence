const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const standaloneDir = path.join(rootDir, 'standalone');
const zipFile = path.join(rootDir, 'standalone.zip');

console.log('--- Creating Standalone Distribution ---');

// 1. Terminate any running standalone node processes and clean previous standalone folder and zip
try {
  execSync('powershell -NoProfile -Command "& { Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path -and $_.Path -like \'*standalone*\') { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } } }"', { stdio: 'ignore' });
} catch (_) {}

if (fs.existsSync(standaloneDir)) {
  console.log('Cleaning previous standalone directory...');
  fs.rmSync(standaloneDir, { recursive: true, force: true });
}
if (fs.existsSync(zipFile)) {
  fs.rmSync(zipFile, { force: true });
}

fs.mkdirSync(standaloneDir, { recursive: true });

// 2. Copy portable node.exe
const nodeExeSource = process.execPath; // e.g. C:\Program Files\nodejs\node.exe
const nodeExeDest = path.join(standaloneDir, 'node.exe');
console.log(`Copying portable Node.js runtime from: ${nodeExeSource}...`);
fs.copyFileSync(nodeExeSource, nodeExeDest);

// 3. Copy server files
console.log('Copying server files...');
fs.cpSync(path.join(rootDir, 'server'), path.join(standaloneDir, 'server'), { recursive: true });

// 4. Update standalone/server/index.js to bind strictly to 127.0.0.1 (Localhost Only, No External Ports)
const serverIndexPath = path.join(standaloneDir, 'server', 'index.js');
let serverIndexContent = fs.readFileSync(serverIndexPath, 'utf8');

// Replace app.listen(PORT, ...) with app.listen(PORT, HOST, ...)
serverIndexContent = serverIndexContent.replace(
  /const PORT = process\.env\.PORT \|\| 5000;/g,
  `const PORT = process.env.PORT || 5000;\nconst HOST = process.env.HOST || '127.0.0.1';`
);

serverIndexContent = serverIndexContent.replace(
  /app\.listen\(PORT,\s*\(\)\s*=>/g,
  `app.listen(PORT, HOST, () =>`
);

serverIndexContent = serverIndexContent.replace(
  /Patient QA Analytics Server running on port \${PORT}/g,
  `Patient QA Analytics Server running locally on http://\${HOST}:\${PORT} (Offline / Localhost Only)`
);

serverIndexContent = serverIndexContent.replace(
  /http:\/\/localhost:\${PORT}\/api\/status/g,
  `http://\${HOST}:\${PORT}/api/status`
);

fs.writeFileSync(serverIndexPath, serverIndexContent, 'utf8');
console.log('Configured standalone server to bind strictly to 127.0.0.1 (localhost only).');

// 5. Copy built client distribution (HTML, JS, CSS)
console.log('Copying built client distribution (HTML/JS/CSS)...');
fs.cpSync(path.join(rootDir, 'client', 'dist'), path.join(standaloneDir, 'client', 'dist'), { recursive: true });

// 6. Copy runtime backend node_modules
console.log('Copying backend node_modules...');
fs.cpSync(path.join(rootDir, 'node_modules'), path.join(standaloneDir, 'node_modules'), { recursive: true });

// 7. Copy package.json
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(standaloneDir, 'package.json'));

// 8. Copy database
console.log('Copying initial database...');
fs.cpSync(path.join(rootDir, 'data'), path.join(standaloneDir, 'data'), { recursive: true });

// 9. Create 1-click Windows Launcher (START_PATIENT_QA.bat)
const startBatContent = `@echo off
title Patient QA Analytics (Offline Localhost Edition)
cd /d "%~dp0"

echo ======================================================================
echo   Patient QA Analytics - Offline / Air-Gapped Local Edition
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
".\\node.exe" "server\\index.js"

if errorlevel 1 (
  echo.
  echo Server encountered an error. Press any key to exit.
  pause >nul
)
`;
fs.writeFileSync(path.join(standaloneDir, 'START_PATIENT_QA.bat'), startBatContent, 'utf8');

// 10. Create 1-click Windows Stopper (STOP_PATIENT_QA.bat)
const stopBatContent = `@echo off
title Stop Patient QA Analytics
cd /d "%~dp0"
echo Stopping Patient QA local server...
taskkill /F /FI "WINDOWTITLE eq Patient QA Analytics*" /T 2>nul
echo Done.
timeout /t 2 >nul
`;
fs.writeFileSync(path.join(standaloneDir, 'STOP_PATIENT_QA.bat'), stopBatContent, 'utf8');

// 11. Create README_AIRGAPPED.txt
const readmeContent = `================================================================================
PATIENT QA ANALYTICS - STANDALONE AIR-GAPPED DISTRIBUTION
================================================================================

This package is a completely self-contained, offline distribution of the
Patient QA Analytics application designed for air-gapped or network-isolated
workstations (e.g., Linac consoles, treatment planning systems, or clinical PCs).

KEY SPECIFICATIONS:
--------------------------------------------------------------------------------
1. NO INSTALLATION REQUIRED:
   Includes the portable Windows Node.js runtime (node.exe), all required
   libraries, pre-compiled React 19 frontend assets, and SQLite backend.
   No internet connection or 'npm install' is needed.

2. NO ADMIN RIGHTS REQUIRED:
   Runs entirely in standard user space from any folder (or USB drive).

3. STRICTLY LOCALHOST ONLY (ZERO EXTERNAL PORTS):
   The server binds exclusively to IP address 127.0.0.1 (loopback adapter).
   No external network ports are opened, and it will not respond to external
   network traffic on the LAN/WAN, adhering to strict hospital IT security rules.

HOW TO RUN:
--------------------------------------------------------------------------------
1. Copy or extract this folder to any location on the target machine (e.g. Desktop).
2. Double-click "START_PATIENT_QA.bat".
3. A terminal window will open and your default web browser will automatically
   navigate to:
       http://127.0.0.1:5000
4. When finished, simply close the terminal window or run "STOP_PATIENT_QA.bat".

FOLDER STRUCTURE:
--------------------------------------------------------------------------------
- node.exe              : Portable Node.js runtime executable
- START_PATIENT_QA.bat  : 1-click application launcher
- STOP_PATIENT_QA.bat   : Clean application shutdown script
- client/dist/          : Pre-compiled React frontend (HTML, JavaScript, CSS)
- server/               : Application backend and analytics engine (Express)
- node_modules/         : Pre-packaged runtime dependencies (better-sqlite3, etc.)
- data/                 : Local SQLite database (patient_qa.db)

================================================================================
`;
fs.writeFileSync(path.join(standaloneDir, 'README_AIRGAPPED.txt'), readmeContent, 'utf8');

console.log('Standalone files assembled successfully in "standalone/" folder.');

// 12. Create standalone.zip using System.IO.Compression.ZipFile
console.log('Creating standalone.zip...');
try {
  execSync(
    `powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${standaloneDir}', '${zipFile}', [System.IO.Compression.CompressionLevel]::Optimal, $false)"`,
    { stdio: 'inherit' }
  );
  const zipStats = fs.statSync(zipFile);
  console.log(`Zip archive created: standalone.zip (${(zipStats.size / (1024 * 1024)).toFixed(2)} MB)`);
} catch (e) {
  console.error('Error creating zip archive:', e.message);
}

console.log('--- Standalone Package Complete ---');
