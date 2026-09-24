const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'patient_qa.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    unit_class TEXT,
    unit_type TEXT,
    serial_number TEXT,
    location TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS test_lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS test_definitions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT,
    test_list_name TEXT,
    unit TEXT,
    data_type TEXT,
    is_numeric INTEGER DEFAULT 1,
    formatting TEXT,
    UNIQUE(name, test_list_name)
  );

  CREATE INDEX IF NOT EXISTS idx_test_def_name ON test_definitions(name);
  CREATE INDEX IF NOT EXISTS idx_test_def_list ON test_definitions(test_list_name);

  CREATE TABLE IF NOT EXISTS unit_test_collections (
    id INTEGER PRIMARY KEY,
    unit_id INTEGER,
    unit_name TEXT,
    test_list_id INTEGER,
    test_list_name TEXT,
    collection_name TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_utc_unit ON unit_test_collections(unit_name);
  CREATE INDEX IF NOT EXISTS idx_utc_test_list ON unit_test_collections(test_list_name);

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qatrack_instance_id INTEGER UNIQUE,
    unit_id INTEGER,
    unit_name TEXT NOT NULL,
    test_list_name TEXT NOT NULL,
    work_completed DATETIME NOT NULL,
    created_by TEXT,
    status TEXT,
    comments TEXT,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    modified_by TEXT,
    modified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS test_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    test_name TEXT NOT NULL,
    test_slug TEXT,
    value_string TEXT,
    value_numeric REAL,
    unit TEXT,
    tolerance_min REAL,
    tolerance_max REAL,
    status TEXT,
    pass_fail TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_test_values_session ON test_values(session_id);
  CREATE INDEX IF NOT EXISTS idx_test_values_name ON test_values(test_name);
  CREATE INDEX IF NOT EXISTS idx_test_values_numeric ON test_values(value_numeric);
  CREATE INDEX IF NOT EXISTS idx_test_values_name_sess ON test_values(test_name, session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_unit ON sessions(unit_name);
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(work_completed);
  CREATE INDEX IF NOT EXISTS idx_sessions_test_list ON sessions(test_list_name);

  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    config_json TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_instance_statuses (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT,
    requires_review INTEGER DEFAULT 0,
    valid INTEGER DEFAULT 1,
    is_rejected INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS unit_test_infos (
    id INTEGER PRIMARY KEY,
    unit_id INTEGER,
    unit_url TEXT,
    test_id INTEGER,
    test_name TEXT NOT NULL,
    test_slug TEXT,
    unit TEXT,
    data_type TEXT,
    is_numeric INTEGER DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_uti_test_name ON unit_test_infos(test_name);
`);

// Safe migrations for existing databases
try {
  const cols = db.prepare("PRAGMA table_info(units)").all().map(c => c.name);
  if (!cols.includes('unit_class')) {
    db.exec("ALTER TABLE units ADD COLUMN unit_class TEXT");
  }
  if (!cols.includes('unit_type')) {
    db.exec("ALTER TABLE units ADD COLUMN unit_type TEXT");
  }

  const utcCols = db.prepare("PRAGMA table_info(unit_test_collections)").all().map(c => c.name);
  if (!utcCols.includes('active')) {
    db.exec("ALTER TABLE unit_test_collections ADD COLUMN active INTEGER DEFAULT 1");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_utc_active ON unit_test_collections(active)");

  const presetCols = db.prepare("PRAGMA table_info(presets)").all().map(c => c.name);
  if (!presetCols.includes('order_index')) {
    db.exec("ALTER TABLE presets ADD COLUMN order_index INTEGER DEFAULT 0");
  }

  const tvCols = db.prepare("PRAGMA table_info(test_values)").all().map(c => c.name);
  if (!tvCols.includes('pass_fail')) {
    db.exec("ALTER TABLE test_values ADD COLUMN pass_fail TEXT");
  }

  const tdCols = db.prepare("PRAGMA table_info(test_definitions)").all().map(c => c.name);
  if (!tdCols.includes('formatting')) {
    db.exec("ALTER TABLE test_definitions ADD COLUMN formatting TEXT");
  }

  const sessCols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
  if (!sessCols.includes('reviewed_by')) {
    db.exec("ALTER TABLE sessions ADD COLUMN reviewed_by TEXT");
  }
  if (!sessCols.includes('reviewed_at')) {
    db.exec("ALTER TABLE sessions ADD COLUMN reviewed_at DATETIME");
  }
  if (!sessCols.includes('modified_by')) {
    db.exec("ALTER TABLE sessions ADD COLUMN modified_by TEXT");
  }
  if (!sessCols.includes('modified_at')) {
    db.exec("ALTER TABLE sessions ADD COLUMN modified_at DATETIME");
  }
} catch (e) {
  console.warn('Migration warning:', e.message);
}

module.exports = db;
