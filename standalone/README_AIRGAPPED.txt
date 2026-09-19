================================================================================
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
