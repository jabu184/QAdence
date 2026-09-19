================================================================================
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
