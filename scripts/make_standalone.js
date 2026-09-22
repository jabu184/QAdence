const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const standaloneDir = path.join(rootDir, 'standalone');
const zipFile = path.join(rootDir, 'standalone.zip');

console.log('=== Creating QAdence Standalone Distribution ===');

// Helper: Filtered recursive directory copy
function copyDirFiltered(src, dest, excludeRegex) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, item.name);
    const destPath = path.join(dest, item.name);
    if (excludeRegex && excludeRegex.test(item.name)) {
      continue;
    }
    if (item.isDirectory()) {
      copyDirFiltered(srcPath, destPath, excludeRegex);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Terminate any running standalone node processes and clean previous standalone folder and zip
try {
  execSync('powershell -NoProfile -Command "& { Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object { if ($_.Path -and $_.Path -like \'*standalone*\') { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } } }"', { stdio: 'ignore' });
} catch (_) {}

if (fs.existsSync(standaloneDir)) {
  console.log('Cleaning previous standalone directory...');
  fs.rmSync(standaloneDir, { recursive: true, force: true });
}
if (fs.existsSync(zipFile)) {
  console.log('Removing old standalone.zip...');
  fs.rmSync(zipFile, { force: true });
}

fs.mkdirSync(standaloneDir, { recursive: true });

// 2. Ensure frontend client is freshly compiled
console.log('Building production client assets...');
try {
  execSync('npm --prefix client run build', { cwd: rootDir, stdio: 'inherit' });
} catch (err) {
  console.warn('Frontend build warning:', err.message);
}

// 3. Copy portable node.exe
const nodeExeSource = process.execPath;
const nodeExeDest = path.join(standaloneDir, 'node.exe');
console.log(`Copying portable Node.js runtime from: ${nodeExeSource}...`);
fs.copyFileSync(nodeExeSource, nodeExeDest);

// 4. Copy server files
console.log('Copying server files...');
fs.cpSync(path.join(rootDir, 'server'), path.join(standaloneDir, 'server'), { recursive: true });

// 5. Update standalone/server/index.js to bind strictly to 127.0.0.1 (Localhost Only, Zero External Ports)
const serverIndexPath = path.join(standaloneDir, 'server', 'index.js');
let serverIndexContent = fs.readFileSync(serverIndexPath, 'utf8');

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

// 6. Copy built client distribution (HTML, JS, CSS)
console.log('Copying built client distribution (HTML/JS/CSS)...');
fs.cpSync(path.join(rootDir, 'client', 'dist'), path.join(standaloneDir, 'client', 'dist'), { recursive: true });

// 7. Copy runtime backend node_modules
console.log('Copying backend node_modules...');
fs.cpSync(path.join(rootDir, 'node_modules'), path.join(standaloneDir, 'node_modules'), { recursive: true });

// 8. Copy package.json
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(standaloneDir, 'package.json'));

// 9. Copy database
console.log('Copying initial database...');
fs.cpSync(path.join(rootDir, 'data'), path.join(standaloneDir, 'data'), { recursive: true });

// 10. Bundle Portable Python Runtime with NumPy and SciPy
console.log('Bundling portable Python statistical runtime (NumPy & SciPy)...');
let pyPrefix = null;
const candidatePrefixes = [
  'C:\\Users\\vboxuser\\AppData\\Local\\Python\\pythoncore-3.14-64'
];

for (const c of candidatePrefixes) {
  if (fs.existsSync(path.join(c, 'python.exe'))) {
    pyPrefix = c;
    break;
  }
}

if (!pyPrefix) {
  try {
    const detected = execSync('python -c "import sys; print(sys.prefix)"', { encoding: 'utf8' }).trim();
    if (detected && fs.existsSync(path.join(detected, 'python.exe'))) {
      pyPrefix = detected;
    }
  } catch (_) {}
}

if (pyPrefix) {
  console.log(`Discovered Python runtime at: ${pyPrefix}`);
  const destPyDir = path.join(standaloneDir, 'python');
  fs.mkdirSync(destPyDir, { recursive: true });

  // Copy root Python executables and DLLs
  for (const f of fs.readdirSync(pyPrefix)) {
    if (f.endsWith('.exe') || f.endsWith('.dll') || f === 'LICENSE.txt') {
      fs.copyFileSync(path.join(pyPrefix, f), path.join(destPyDir, f));
    }
  }

  // Copy DLLs folder
  if (fs.existsSync(path.join(pyPrefix, 'DLLs'))) {
    copyDirFiltered(
      path.join(pyPrefix, 'DLLs'),
      path.join(destPyDir, 'DLLs'),
      /__pycache__|\.pyc$/i
    );
  }

  // Copy standard library Lib (excluding site-packages, test/tests, tkinter, idlelib, turtledemo to save space)
  if (fs.existsSync(path.join(pyPrefix, 'Lib'))) {
    const destLibDir = path.join(destPyDir, 'Lib');
    fs.mkdirSync(destLibDir, { recursive: true });
    for (const item of fs.readdirSync(path.join(pyPrefix, 'Lib'), { withFileTypes: true })) {
      if (item.name === 'site-packages') continue;
      if (/^(test|tests|tkinter|idlelib|turtledemo|__pycache__)$/i.test(item.name)) continue;
      if (item.name.endsWith('.pyc')) continue;

      const sPath = path.join(pyPrefix, 'Lib', item.name);
      const dPath = path.join(destLibDir, item.name);
      if (item.isDirectory()) {
        copyDirFiltered(sPath, dPath, /__pycache__|\.pyc$|^test$|^tests$/i);
      } else {
        fs.copyFileSync(sPath, dPath);
      }
    }

    // Copy targeted site-packages: NumPy and SciPy (with their required DLL libs)
    const srcSitePackages = path.join(pyPrefix, 'Lib', 'site-packages');
    const destSitePackages = path.join(destLibDir, 'site-packages');
    fs.mkdirSync(destSitePackages, { recursive: true });

    const targetPackages = ['numpy', 'numpy.libs', 'scipy', 'scipy.libs'];
    for (const pkg of targetPackages) {
      const p = path.join(srcSitePackages, pkg);
      if (fs.existsSync(p)) {
        console.log(`Bundling ${pkg}...`);
        copyDirFiltered(p, path.join(destSitePackages, pkg), /__pycache__|\.pyc$|^tests$/i);
      }
    }
  }

  // Verify bundled portable Python
  try {
    const bundledPyExe = path.join(destPyDir, 'python.exe');
    const testOut = execFileSync(bundledPyExe, ['-c', 'import numpy, scipy; print("Python Statistical Engine Verified:", numpy.__version__, scipy.__version__)'], { encoding: 'utf8' });
    console.log(`[VERIFIED] ${testOut.trim()}`);
  } catch (testErr) {
    console.warn('[WARNING] Bundled Python verification test:', testErr.message);
  }
} else {
  console.warn('[WARNING] Python installation not found on host. The application will use its built-in JavaScript statistical engine fallback.');
}

// 11. Create 1-click Windows Launchers (START_QADENCE.bat and START_PATIENT_QA.bat)
const startBatContent = `@echo off
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
if exist "%~dp0python\\python.exe" (
  set "PATH=%~dp0python;%PATH%"
  set "PYTHON_PATH=%~dp0python\\python.exe"
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
"%NODE_CMD%" "%~dp0server\\index.js"

if errorlevel 1 (
  echo.
  echo Server encountered an error. Press any key to exit.
  pause >nul
)
`;
fs.writeFileSync(path.join(standaloneDir, 'START_QADENCE.bat'), startBatContent, 'utf8');
fs.writeFileSync(path.join(standaloneDir, 'START_PATIENT_QA.bat'), startBatContent, 'utf8');

// 12. Create 1-click Windows Stoppers (STOP_QADENCE.bat and STOP_PATIENT_QA.bat)
const stopBatContent = `@echo off
title Stop QAdence
cd /d "%~dp0"
echo Stopping QAdence local server...
taskkill /F /FI "WINDOWTITLE eq QAdence*" /T 2>nul
taskkill /F /FI "WINDOWTITLE eq Patient QA Analytics*" /T 2>nul
echo Done.
timeout /t 2 >nul
`;
fs.writeFileSync(path.join(standaloneDir, 'STOP_QADENCE.bat'), stopBatContent, 'utf8');
fs.writeFileSync(path.join(standaloneDir, 'STOP_PATIENT_QA.bat'), stopBatContent, 'utf8');

// 13. Create README_AIRGAPPED.txt
const readmeContent = `================================================================================
QADENCE: TRENDS & ANALYSIS - STANDALONE AIR-GAPPED DISTRIBUTION
================================================================================

This package is a completely self-contained, offline distribution of the
QAdence application designed for air-gapped or network-isolated
workstations (e.g., Linac consoles, treatment planning systems, or clinical PCs).

KEY SPECIFICATIONS:
--------------------------------------------------------------------------------
1. NO INSTALLATION REQUIRED:
   Includes:
   - Portable Node.js runtime (node.exe)
   - Portable Python runtime (python/python.exe) with NumPy and SciPy
   - Pre-compiled React frontend assets and Express backend
   - Local SQLite database engine and schema
   - Built-in JavaScript statistical calculation fallback engine
   No internet connection or 'npm install' or 'pip install' is needed.

2. ADVANCED STATISTICAL ANALYSIS:
   Supports automated correlation analysis for clinical QA metrics:
   - Pearson Linear Correlation (r, R², p-value, 95% Confidence Interval)
   - Spearman Rank Non-Parametric Monotonic Correlation (rho, p-value)
   - Kendall Tau Dependence (tau, p-value)
   - Polynomial Quadratic Curvilinear Modeling (deg=2 R², Delta R²)
   - Automated correlation type recommendations and clinical narratives

3. PRESET EXPORT & IMPORT:
   Save and export QA preset configurations as downloadable .json files
   and import them directly across different instances or workstations.

4. NO ADMIN RIGHTS REQUIRED:
   Runs entirely in standard user space from any folder or USB flash drive.

5. STRICTLY LOCALHOST ONLY (ZERO EXTERNAL PORTS):
   The server binds exclusively to IP address 127.0.0.1 (loopback adapter).
   No external network ports are opened, and it will not respond to external
   network traffic on the LAN/WAN, adhering to strict hospital IT security rules.

HOW TO RUN:
--------------------------------------------------------------------------------
1. Copy or extract this folder to any location on the target machine (e.g. Desktop).
2. Double-click "START_QADENCE.bat".
3. A terminal window will open and your default web browser will automatically
   navigate to:
       http://127.0.0.1:5000
4. When finished, simply close the terminal window or run "STOP_QADENCE.bat".

FOLDER STRUCTURE:
--------------------------------------------------------------------------------
- node.exe              : Portable Node.js runtime executable
- python/               : Portable Python statistical engine (NumPy & SciPy)
- START_QADENCE.bat     : 1-click application launcher
- STOP_QADENCE.bat      : Clean application shutdown script
- client/dist/          : Pre-compiled React frontend (HTML, JavaScript, CSS)
- server/               : Application backend and analytics engine (Express)
- node_modules/         : Pre-packaged runtime dependencies (better-sqlite3, etc.)
- data/                 : Local SQLite database (patient_qa.db)

================================================================================
`;
fs.writeFileSync(path.join(standaloneDir, 'README_AIRGAPPED.txt'), readmeContent, 'utf8');

console.log('Standalone files assembled successfully in "standalone/" folder.');

// 14. Create standalone.zip using System.IO.Compression.ZipFile
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
