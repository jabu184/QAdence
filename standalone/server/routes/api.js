const express = require('express');
const router = express.Router();
const db = require('../db');
const qatrackClient = require('../qatrackClient');
const path = require('path');
const fs = require('fs');

// 1. App Status & Health
router.get('/status', (req, res) => {
  try {
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const testValCount = db.prepare('SELECT COUNT(*) as count FROM test_values').get().count;
    const unitCount = db.prepare('SELECT COUNT(*) as count FROM units').get().count;
    const presetCount = db.prepare('SELECT COUNT(*) as count FROM presets').get().count;
    const lastSession = db.prepare('SELECT work_completed FROM sessions ORDER BY work_completed DESC LIMIT 1').get();

    const config = qatrackClient.getConfig();

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      status: 'ok',
      db: {
        sessionCount,
        testValCount,
        unitCount,
        presetCount,
        latestSessionDate: lastSession ? lastSession.work_completed : null
      },
      qatrack: {
        configured: !!(config.baseUrl && config.hasToken),
        baseUrl: config.baseUrl,
        hasToken: config.hasToken,
        authType: config.authType,
        includeUnapproved: config.includeUnapproved,
        includeRejected: config.includeRejected
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. QATrack+ Configuration
router.get('/config', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.json(qatrackClient.getConfig());
});

router.post('/config', (req, res) => {
  try {
    const { baseUrl, token, authType, includeUnapproved, includeRejected } = req.body;
    let tokenToSave = token;
    if (tokenToSave === undefined || tokenToSave === null) {
      const existing = db.prepare("SELECT value FROM settings WHERE key = 'qatrack_token'").get();
      tokenToSave = existing ? existing.value : '';
    }
    qatrackClient.saveConfig(baseUrl || '', tokenToSave, authType || 'Token', {
      includeUnapproved,
      includeRejected
    });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      success: true,
      message: 'Settings saved successfully.',
      config: qatrackClient.getConfig()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. Backup All Settings & Presets to JSON
router.get(['/settings/backup', '/backup/export'], (req, res) => {
  try {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settingsObj = {};
    for (const row of settingsRows) {
      settingsObj[row.key] = row.value;
    }

    const presetRows = db.prepare('SELECT * FROM presets ORDER BY order_index ASC, id ASC').all();
    const presets = presetRows.map(p => {
      let parsedConfig = {};
      try {
        parsedConfig = typeof p.config_json === 'string' ? JSON.parse(p.config_json) : (p.config || {});
      } catch (_) {}
      return {
        name: p.name,
        description: p.description || '',
        order_index: p.order_index || 0,
        config: parsedConfig
      };
    });

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `qadence_backup_${dateStr}.json`;

    const exportData = {
      app: 'QAdence',
      version: '1.1.0',
      backupType: 'full_settings_and_presets',
      exportedAt: new Date().toISOString(),
      settings: settingsObj,
      presets: presets
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2c. Restore All Settings & Presets from JSON
router.post(['/settings/restore', '/backup/restore'], (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid backup JSON payload.' });
    }

    let restoredSettingsCount = 0;
    let restoredPresetsCount = 0;

    // Detect settings in payload (supports payload.settings object or top-level keys)
    const settingsToRestore = {};
    if (payload.settings && typeof payload.settings === 'object') {
      Object.assign(settingsToRestore, payload.settings);
    } else {
      if (payload.baseUrl !== undefined || payload.qatrack_url !== undefined) {
        settingsToRestore.qatrack_url = payload.baseUrl || payload.qatrack_url;
      }
      if (payload.token !== undefined || payload.qatrack_token !== undefined) {
        settingsToRestore.qatrack_token = payload.token || payload.qatrack_token;
      }
      if (payload.authType !== undefined || payload.qatrack_auth_type !== undefined) {
        settingsToRestore.qatrack_auth_type = payload.authType || payload.qatrack_auth_type;
      }
      if (payload.includeUnapproved !== undefined || payload.qatrack_include_unapproved !== undefined) {
        settingsToRestore.qatrack_include_unapproved = String(payload.includeUnapproved ?? payload.qatrack_include_unapproved);
      }
      if (payload.includeRejected !== undefined || payload.qatrack_include_rejected !== undefined) {
        settingsToRestore.qatrack_include_rejected = String(payload.includeRejected ?? payload.qatrack_include_rejected);
      }
    }

    // Detect presets in payload
    let presetsToRestore = [];
    if (Array.isArray(payload.presets)) {
      presetsToRestore = payload.presets;
    } else if (Array.isArray(payload)) {
      presetsToRestore = payload;
    }

    const replacePresets = Boolean(payload.replacePresets);

    const restoreTx = db.transaction(() => {
      // 1. Restore settings
      const upsertSetting = db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);

      for (const [key, val] of Object.entries(settingsToRestore)) {
        if (typeof key === 'string' && key.trim() && val !== undefined && val !== null) {
          upsertSetting.run(key.trim(), String(val));
          restoredSettingsCount++;
        }
      }

      // 2. Restore presets
      if (presetsToRestore.length > 0) {
        if (replacePresets) {
          db.prepare('DELETE FROM presets').run();
        }

        const checkExisting = db.prepare('SELECT id, name FROM presets WHERE LOWER(name) = ?');
        const updatePresetStmt = db.prepare(`
          UPDATE presets 
          SET description = ?, config_json = ?, order_index = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `);
        const insertPresetStmt = db.prepare(`
          INSERT INTO presets (name, description, config_json, order_index, updated_at) 
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        const maxOrderRow = db.prepare('SELECT COALESCE(MAX(order_index), 0) as maxOrder FROM presets').get();
        let currentOrder = maxOrderRow?.maxOrder || 0;

        for (const p of presetsToRestore) {
          if (!p || typeof p !== 'object') continue;
          const rawName = String(p.name || '').trim();
          if (!rawName) continue;

          let configObj = p.config;
          if (!configObj && p.config_json) {
            try {
              configObj = typeof p.config_json === 'string' ? JSON.parse(p.config_json) : p.config_json;
            } catch (_) {}
          }
          if (!configObj || typeof configObj !== 'object') continue;

          const configJson = JSON.stringify(configObj);
          const description = String(p.description || '').trim();
          const orderIndex = typeof p.order_index === 'number' ? p.order_index : ++currentOrder;

          const existing = checkExisting.get(rawName.toLowerCase());
          if (existing && !replacePresets) {
            updatePresetStmt.run(description, configJson, orderIndex, existing.id);
            restoredPresetsCount++;
          } else {
            insertPresetStmt.run(rawName, description, configJson, orderIndex);
            restoredPresetsCount++;
          }
        }
      }
    });

    restoreTx();
    qatrackClient.reloadConfig();

    res.json({
      success: true,
      message: `Successfully restored ${restoredSettingsCount} configuration setting(s) and ${restoredPresetsCount} preset(s).`,
      restoredSettingsCount,
      restoredPresetsCount,
      config: qatrackClient.getConfig()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Test Connection
router.post('/test-connection', async (req, res) => {
  try {
    const result = await qatrackClient.testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Trigger Live Sync (Full, Metadata-only, or On-Demand)
router.post('/sync', async (req, res) => {
  try {
    const result = await qatrackClient.syncFromQATrack(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4a. Fast Structure & Metadata Sync Only
router.post('/sync/metadata', async (req, res) => {
  try {
    const result = await qatrackClient.syncMetadata(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4b. On-Demand Test List Session Ingest
router.post('/sync/on-demand', async (req, res) => {
  try {
    const result = await qatrackClient.syncOnDemand(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4c. Live Sync Status
router.get('/sync/status', (req, res) => {
  res.json(qatrackClient.getSyncStatus());
});

// 4d. Cancel Active Sync
router.post('/sync/cancel', (req, res) => {
  res.json(qatrackClient.cancelSync());
});

// 5b. Clear All Data (Wipe cached data)
router.post('/clear-data', (req, res) => {
  try {
    db.exec(`
      DELETE FROM test_values;
      DELETE FROM sessions;
      DELETE FROM units;
      DELETE FROM test_lists;
      DELETE FROM test_definitions;
      DELETE FROM unit_test_collections;
      DELETE FROM unit_test_infos;
    `);
    res.json({ success: true, message: 'All QA measurements, test definitions, and sessions cleared successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5c. Seed Demo QA Data (Explicit button action only, never run by default)
const { seedDemoData } = require('../scripts/demo_data');
router.post('/demo/load', (req, res) => {
  try {
    const { clearExisting = false } = req.body || {};
    const result = seedDemoData(db, { clearExisting });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Schema Discovery: Units (with unitClass and unitType)
router.get('/schema/units', (req, res) => {
  try {
    const units = db.prepare(`
      SELECT 
        u.name as name,
        COALESCE(u.unit_class, 'Linac') as unitClass,
        COALESCE(u.unit_type, '') as unitType,
        u.active as active
      FROM units u
      WHERE u.active = 1 OR u.name IN (SELECT DISTINCT unit_name FROM sessions)
      UNION
      SELECT 
        s.unit_name as name,
        'Linac' as unitClass,
        '' as unitType,
        1 as active
      FROM sessions s
      WHERE s.unit_name IS NOT NULL AND s.unit_name != '' AND LOWER(TRIM(s.unit_name)) NOT IN (SELECT LOWER(TRIM(name)) FROM units)
      ORDER BY unitClass ASC, name ASC
    `).all();

    res.json(units);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6d. Schema Discovery: Unit Classes
router.get('/schema/unit-classes', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT COALESCE(unit_class, 'Linac') as unitClass
      FROM units
      WHERE active = 1 AND unit_class IS NOT NULL AND unit_class != ''
      ORDER BY unitClass ASC
    `).all();

    let classes = rows.map(r => r.unitClass);
    if (classes.length === 0) {
      classes = ['Linac'];
    }
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6b. Schema Discovery: Years
router.get('/schema/years', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT strftime('%Y', work_completed) as year
      FROM sessions
      WHERE work_completed IS NOT NULL AND work_completed != ''
      ORDER BY year DESC
    `).all();
    const currentYear = String(new Date().getFullYear());
    const years = rows.map(r => r.year).filter(Boolean);
    if (!years.includes(currentYear)) {
      years.unshift(currentYear);
    }
    res.json(years);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6c. Schema Discovery: Test Lists (Ordered Alphabetically)
// Strictly exclude test lists with no data (or active assignments)
router.get('/schema/test-lists', (req, res) => {
  try {
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get()?.count || 0;
    let rows;
    if (sessionCount > 0) {
      // If data exists in the database, strictly return test lists that have data!
      rows = db.prepare(`
        SELECT DISTINCT test_list_name as name
        FROM sessions
        WHERE test_list_name IS NOT NULL AND test_list_name != ''
        ORDER BY name COLLATE NOCASE ASC
      `).all();
    } else {
      // If no sessions yet, only return test lists with active assignments on active units
      rows = db.prepare(`
        SELECT DISTINCT test_list_name as name
        FROM unit_test_collections
        WHERE (active = 1 OR unit_name IN (SELECT DISTINCT unit_name FROM sessions)) AND unit_name IS NOT NULL AND unit_name != ''
        ORDER BY name COLLATE NOCASE ASC
      `).all();
    }
    res.json(rows.map(r => r.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Schema Discovery: Available Tests and their Data Types grouped by Test List (Ordered Alphabetically)
router.get('/schema/tests', (req, res) => {
  try {
    const ingested = db.prepare(`
      SELECT
        tv.test_name,
        COALESCE(s.test_list_name, 'General QA') as test_list_name,
        COUNT(*) as total_count,
        COUNT(tv.value_numeric) as numeric_count,
        COUNT(tv.value_string) as string_count,
        MAX(tv.unit) as unit
      FROM test_values tv
      LEFT JOIN sessions s ON tv.session_id = s.id
      GROUP BY tv.test_name, s.test_list_name
    `).all();

    let definitions = [];
    try {
      definitions = db.prepare(`
        SELECT name as test_name, COALESCE(test_list_name, 'General QA') as test_list_name, unit, is_numeric
        FROM test_definitions
        WHERE test_list_name IN (
          SELECT DISTINCT test_list_name FROM sessions WHERE test_list_name IS NOT NULL AND test_list_name != ''
          UNION
          SELECT DISTINCT test_list_name FROM unit_test_collections WHERE (active = 1 OR unit_name IN (SELECT DISTINCT unit_name FROM sessions)) AND unit_name IS NOT NULL AND unit_name != ''
        )
      `).all();
    } catch (_) {}

    const map = new Map();
    for (const d of definitions) {
      const key = `${d.test_name}::${d.test_list_name}`;
      map.set(key, {
        name: d.test_name,
        testList: d.test_list_name,
        unit: d.unit || '',
        isNumeric: d.is_numeric === 1,
        totalCount: 0,
        numericCount: 0
      });
    }

    for (const t of ingested) {
      const key = `${t.test_name}::${t.test_list_name}`;
      const existing = map.get(key);
      const isNumericFromIngest = t.numeric_count > 0 && (t.numeric_count >= t.total_count * 0.25 || t.numeric_count >= 1);
      const isNumeric = existing ? (existing.isNumeric || isNumericFromIngest) : isNumericFromIngest;
      map.set(key, {
        name: t.test_name,
        testList: t.test_list_name || 'General QA',
        unit: t.unit || existing?.unit || '',
        isNumeric: Boolean(isNumeric),
        totalCount: t.total_count,
        numericCount: t.numeric_count
      });
    }

    const formatted = Array.from(map.values()).sort((a, b) => {
      const listCmp = (a.testList || '').localeCompare(b.testList || '', undefined, { sensitivity: 'base' });
      if (listCmp !== 0) return listCmp;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Schema Discovery: Distinct values for a categorical test
router.get('/schema/test-values', (req, res) => {
  try {
    const testName = req.query.test_name;
    if (!testName) return res.json([]);

    const rows = db.prepare(`
      SELECT DISTINCT value_string
      FROM test_values
      WHERE test_name = ? AND value_string IS NOT NULL AND value_string != ''
      ORDER BY value_string
      LIMIT 100
    `).all(testName);

    res.json(rows.map(r => r.value_string));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper for statistics
function calculateStats(numbers) {
  if (!numbers || numbers.length === 0) {
    return { count: 0, mean: 0, stdDev: 0, min: 0, max: 0, median: 0 };
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[count - 1];
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];

  return {
    count,
    mean: Math.round(mean * 1000) / 1000,
    stdDev: Math.round(stdDev * 1000) / 1000,
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
    median: Math.round(median * 1000) / 1000
  };
}

// 9. Core Query & Analytics Engine
router.post('/query', async (req, res) => {
  try {
    const {
      units = [],
      testLists = [],
      includeAllInstances = true,
      dateFrom,
      dateTo,
      filters = [], // [{ testName: 'Site', operator: 'equals', value: 'Prostate' }]
      xVariable,   // e.g. 'Planned Dose' or 'work_completed'
      yVariable,   // e.g. 'Measured Dose' or 'Gamma Pass Rate (3%/3mm)'
      groupBy,     // e.g. 'unit_name' or 'Site' or 'Beam Energy'
      metadataTests = ['Patient ID', 'Plan ID', 'Plan Name', 'Site', 'Beam Energy', 'Delivery Technique'],
      pullOnDemand = false
    } = req.body;

    if (!yVariable) {
      return res.status(400).json({ error: 'yVariable is required.' });
    }

    // Check if on-demand fetch is recommended (e.g. 0 local records in database for this variable)
    const qConfig = qatrackClient.getConfig();
    let needsPull = false;
    let targetLists = [];
    if (qConfig.hasToken && qConfig.baseUrl) {
      if (!includeAllInstances && testLists && testLists.length > 0) {
        targetLists = Array.isArray(testLists) ? testLists : [testLists];
      } else if (!includeAllInstances && req.body.testList) {
        targetLists = [req.body.testList];
      } else {
        const defRows = db.prepare('SELECT DISTINCT test_list_name FROM test_definitions WHERE name = ?').all(yVariable);
        targetLists = defRows.map(r => r.test_list_name).filter(Boolean);
        if (targetLists.length === 0) {
          const sessRows = db.prepare(`
            SELECT DISTINCT s.test_list_name 
            FROM sessions s 
            JOIN test_values tv ON s.id = tv.session_id 
            WHERE tv.test_name = ?
          `).all(yVariable);
          targetLists = sessRows.map(r => r.test_list_name).filter(Boolean);
        }
      }

      let countQuery = `
        SELECT COUNT(*) as count 
        FROM test_values tv
        JOIN sessions s ON tv.session_id = s.id
        WHERE tv.test_name = ?
      `;
      const countParams = [yVariable];
      if (!includeAllInstances && targetLists.length > 0) {
        const placeholders = targetLists.map(() => '?').join(',');
        countQuery += ` AND s.test_list_name IN (${placeholders})`;
        countParams.push(...targetLists);
      }
      // Note: Do not scope countQuery by units. If the local database already has data for this variable,
      // filtering by a specific machine that happens to have 0 records should not trigger a needsPull auto-sync.
      const countRow = db.prepare(countQuery).get(...countParams);
      if (!countRow || countRow.count === 0) {
        needsPull = true;
      }
    }

    // Determine session-level filters
    let sessionWhereClauses = [];
    let sessionParams = [];

    // Filter rejected & unapproved sessions (respecting per-request override or server setting)
    const effectiveIncludeUnapproved = req.body.includeUnapproved !== undefined
      ? Boolean(req.body.includeUnapproved)
      : qConfig.includeUnapproved;
    const effectiveIncludeRejected = req.body.includeRejected !== undefined
      ? Boolean(req.body.includeRejected)
      : qConfig.includeRejected;

    if (!effectiveIncludeRejected) {
      sessionWhereClauses.push(`(s.status IS NULL OR LOWER(s.status) NOT LIKE '%reject%')`);
    }
    if (!effectiveIncludeUnapproved) {
      sessionWhereClauses.push(`(s.status IS NULL OR LOWER(s.status) NOT IN ('unapproved', 'unreviewed', 'in progress', 'pending'))`);
    }

    if (units && units.length > 0) {
      const exactUnits = units.map(u => String(u).trim()).filter(Boolean);
      const strippedUnits = exactUnits.map(u => u.toLowerCase().replace(/[\s-_]/g, ''));
      const p1 = exactUnits.map(() => '?').join(',');
      const p2 = strippedUnits.map(() => '?').join(',');
      sessionWhereClauses.push(`(
        s.unit_name COLLATE NOCASE IN (${p1})
        OR REPLACE(REPLACE(REPLACE(LOWER(TRIM(s.unit_name)), ' ', ''), '-', ''), '_', '') IN (${p2})
      )`);
      sessionParams.push(...exactUnits, ...strippedUnits);
    }

    // Test List filtering (if not including all instances)
    let effectiveTestLists = [];
    if (Array.isArray(testLists)) {
      effectiveTestLists = testLists.filter(Boolean);
    } else if (typeof testLists === 'string' && testLists.trim()) {
      effectiveTestLists = [testLists.trim()];
    }
    if (req.body.testList && typeof req.body.testList === 'string' && req.body.testList.trim() && !effectiveTestLists.includes(req.body.testList.trim())) {
      effectiveTestLists.push(req.body.testList.trim());
    }

    if (!includeAllInstances && effectiveTestLists.length > 0) {
      const placeholders = effectiveTestLists.map(() => '?').join(',');
      sessionWhereClauses.push(`COALESCE(s.test_list_name, 'General QA') IN (${placeholders})`);
      sessionParams.push(...effectiveTestLists);
    }

    if (dateFrom) {
      sessionWhereClauses.push(`s.work_completed >= ?`);
      sessionParams.push(dateFrom);
    }
    if (dateTo) {
      sessionWhereClauses.push(`s.work_completed <= ?`);
      sessionParams.push(dateTo);
    }

    // Handle conditional test filters (e.g. Site == Prostate) with AND / OR combination support
    const filterConditions = [];
    filters.forEach((filter) => {
      if (filter.testName && filter.value !== undefined && filter.value !== '') {
        const paramVal = filter.value;
        let clause = '';
        let params = [];

        if (filter.operator === 'not_equals') {
          clause = `s.id NOT IN (
            SELECT session_id FROM test_values
            WHERE test_name = ? AND value_string = ?
          )`;
          params = [filter.testName, paramVal];
        } else if (filter.operator === 'contains') {
          clause = `s.id IN (
            SELECT session_id FROM test_values
            WHERE test_name = ? AND value_string LIKE ?
          )`;
          params = [filter.testName, `%${paramVal}%`];
        } else if (filter.operator === 'gt') {
          clause = `s.id IN (
            SELECT session_id FROM test_values
            WHERE test_name = ? AND value_numeric > ?
          )`;
          params = [filter.testName, parseFloat(paramVal)];
        } else if (filter.operator === 'lt') {
          clause = `s.id IN (
            SELECT session_id FROM test_values
            WHERE test_name = ? AND value_numeric < ?
          )`;
          params = [filter.testName, parseFloat(paramVal)];
        } else {
          // Default equals
          clause = `s.id IN (
            SELECT session_id FROM test_values
            WHERE test_name = ? AND (value_string = ? OR value_numeric = ?)
          )`;
          params = [filter.testName, paramVal, parseFloat(paramVal) || null];
        }

        const logic = filter.logic || req.body.filterLogic || 'and';
        filterConditions.push({ clause, params, logic });
      }
    });

    if (filterConditions.length > 0) {
      let filterSql = '';
      filterConditions.forEach((fc, idx) => {
        if (idx === 0) {
          filterSql += `(${fc.clause})`;
        } else {
          const op = (fc.logic && fc.logic.toUpperCase() === 'OR') ? 'OR' : 'AND';
          filterSql += ` ${op} (${fc.clause})`;
        }
        sessionParams.push(...fc.params);
      });
      sessionWhereClauses.push(`(${filterSql})`);
    }

    const whereSql = sessionWhereClauses.length > 0
      ? `WHERE ${sessionWhereClauses.join(' AND ')}`
      : '';

    // Fetch matching sessions
    const sessionQuery = `
      SELECT s.id, s.qatrack_instance_id, s.unit_name, s.test_list_name, s.work_completed, s.status, s.created_by, s.comments
      FROM sessions s
      ${whereSql}
      ORDER BY s.work_completed ASC
    `;
    const sessions = db.prepare(sessionQuery).all(...sessionParams);

    if (sessions.length === 0) {
      return res.json({
        totalSessions: 0,
        matchedPoints: 0,
        dataPoints: [],
        xStats: calculateStats([]),
        yStats: calculateStats([]),
        grouped: {},
        tableRows: [],
        needsPull,
        targetLists
      });
    }

    const sessionIds = sessions.map(s => s.id);
    const idPlaceholders = sessionIds.map(() => '?').join(',');

    // Fetch all test values for these matching sessions
    let valuesQuery = `
      SELECT session_id, test_name, value_string, value_numeric, unit, tolerance_min, tolerance_max
      FROM test_values
      WHERE session_id IN (${idPlaceholders})
    `;
    if (!effectiveIncludeRejected) {
      valuesQuery += ` AND (status IS NULL OR LOWER(status) NOT LIKE '%reject%')`;
    }
    if (!effectiveIncludeUnapproved) {
      valuesQuery += ` AND (status IS NULL OR LOWER(status) NOT IN ('unapproved', 'unreviewed', 'in progress', 'pending'))`;
    }
    const testValues = db.prepare(valuesQuery).all(...sessionIds);

    // Group test values by session_id
    const valuesBySession = new Map();
    for (const v of testValues) {
      if (!valuesBySession.has(v.session_id)) {
        valuesBySession.set(v.session_id, {});
      }
      valuesBySession.get(v.session_id)[v.test_name] = v;
    }

    // Build data points and table rows
    const dataPoints = [];
    const tableRows = [];
    const xValues = [];
    const yValues = [];
    const grouped = {};

    for (const sess of sessions) {
      const sessVals = valuesBySession.get(sess.id) || {};
      const yValObj = sessVals[yVariable];

      // Y value must exist and have numeric representation for plotting
      let yNum = yValObj ? yValObj.value_numeric : null;
      if (yNum === null || isNaN(yNum)) continue;

      // Calculate X value
      let xNum = null;
      let xLabel = '';
      if (!xVariable || xVariable === 'work_completed') {
        xNum = new Date(sess.work_completed).getTime();
        xLabel = sess.work_completed;
      } else {
        const xValObj = sessVals[xVariable];
        xNum = xValObj ? xValObj.value_numeric : null;
        xLabel = xValObj ? (xValObj.value_string || String(xValObj.value_numeric)) : '';
      }

      // Determine group label
      let groupName = 'All';
      if (groupBy === 'unit_name') {
        groupName = sess.unit_name;
      } else if (groupBy && sessVals[groupBy]) {
        groupName = sessVals[groupBy].value_string || String(sessVals[groupBy].value_numeric);
      }

      // Collect metadata
      const meta = {
        sessionId: sess.id,
        qatrackInstanceId: sess.qatrack_instance_id || null,
        testList: sess.test_list_name,
        unit: sess.unit_name,
        date: sess.work_completed,
        status: sess.status,
        operator: sess.created_by
      };
      for (const mt of metadataTests) {
        if (sessVals[mt]) {
          meta[mt] = sessVals[mt].value_string || sessVals[mt].value_numeric;
        }
      }
      // Ensure Plan ID is resolved from test values (checking variants, or fallback to Plan Name)
      if (!meta['Plan ID']) {
        const planCandidate = sessVals['Plan ID'] || sessVals['Plan Id'] || sessVals['plan_id'] || sessVals['Plan'] || sessVals['Plan Number'] || sessVals['Plan Name'];
        if (planCandidate) {
          meta['Plan ID'] = planCandidate.value_string || planCandidate.value_numeric;
        }
      }

      const point = {
        sessionId: sess.id,
        qatrackInstanceId: sess.qatrack_instance_id || null,
        x: xNum,
        xLabel,
        y: yNum,
        unit: sess.unit_name,
        date: sess.work_completed,
        group: groupName,
        metadata: meta,
        yToleranceMin: yValObj ? yValObj.tolerance_min : null,
        yToleranceMax: yValObj ? yValObj.tolerance_max : null
      };

      dataPoints.push(point);
      yValues.push(yNum);
      if (typeof xNum === 'number' && !isNaN(xNum) && xVariable !== 'work_completed') {
        xValues.push(xNum);
      }

      if (!grouped[groupName]) {
        grouped[groupName] = [];
      }
      grouped[groupName].push(point);

      // Table row representation
      const row = {
        sessionId: sess.id,
        date: sess.work_completed,
        unit: sess.unit_name,
        status: sess.status,
        ...meta,
        [yVariable]: yNum,
        ...(xVariable && xVariable !== 'work_completed' ? { [xVariable]: xNum } : {})
      };
      tableRows.push(row);
    }

    res.json({
      totalSessions: sessions.length,
      matchedPoints: dataPoints.length,
      dataPoints,
      xStats: calculateStats(xValues),
      yStats: calculateStats(yValues),
      grouped,
      tableRows,
      needsPull,
      targetLists
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helpers for session details formatting and previous/following calculations
function formatQATrackValue(val, formatSpec) {
  if (val === null || val === undefined || isNaN(val)) return '';
  if (!formatSpec || typeof formatSpec !== 'string') return String(val);
  const spec = formatSpec.trim();
  const floatMatch = spec.match(/%([0-9]*)\.?([0-9]+)?f/);
  if (floatMatch) {
    const decimals = floatMatch[2] !== undefined ? parseInt(floatMatch[2], 10) : 2;
    return Number(val).toFixed(decimals);
  }
  const gMatch = spec.match(/%([0-9]*)\.?([0-9]+)?g/);
  if (gMatch) {
    const sigFigs = gMatch[2] !== undefined ? parseInt(gMatch[2], 10) : 4;
    return Number(val).toPrecision(sigFigs);
  }
  if (spec.match(/%d|%i/)) {
    return String(Math.round(Number(val)));
  }
  const expMatch = spec.match(/%([0-9]*)\.?([0-9]+)?e/);
  if (expMatch) {
    const decimals = expMatch[2] !== undefined ? parseInt(expMatch[2], 10) : 2;
    return Number(val).toExponential(decimals);
  }
  return String(val);
}

function calculateDiffAndArrow(targetVal, currentVal) {
  if (targetVal === null || targetVal === undefined || isNaN(targetVal) ||
      currentVal === null || currentVal === undefined || isNaN(currentVal)) {
    return { diffPercent: null, arrow: null };
  }

  const delta = targetVal - currentVal;
  let arrow = '→';
  if (delta > 0.000001) arrow = '↑';
  else if (delta < -0.000001) arrow = '↓';

  let diffPercent = null;
  if (Math.abs(currentVal) > 0.000001) {
    diffPercent = Math.round(((delta / Math.abs(currentVal)) * 100) * 10) / 10;
  } else if (Math.abs(targetVal) < 0.000001) {
    diffPercent = 0;
  }

  return { diffPercent, arrow };
}

function sanitizeComments(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const texts = parsed.map(p => {
            if (typeof p === 'string') {
              if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('/api/')) return '';
              return p.trim();
            }
            if (p && typeof p === 'object') {
              return (p.comment || p.comment_text || p.text || '').trim();
            }
            return '';
          }).filter(Boolean);
          return texts.join('\n');
        }
      } catch (_) {}
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/api/')) {
      return '';
    }
    return trimmed;
  }
  return '';
}

// 8b. Session Details & Associated Test List Values (for Pop-up Splash)
router.get(['/session-details/:id', '/sessions/:id/details'], async (req, res) => {
  try {
    const sessionId = req.params.id;
    let session = db.prepare(`
      SELECT s.*, u.unit_class, u.unit_type, u.serial_number, u.location
      FROM sessions s
      LEFT JOIN units u ON s.unit_name = u.name
      WHERE s.id = ? OR s.qatrack_instance_id = ?
    `).get(sessionId, sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (session.qatrack_instance_id && (!session.reviewed_by && !session.modified_by)) {
      try {
        const liveInfo = await qatrackClient.fetchSingleSessionDetails(session.qatrack_instance_id);
        if (liveInfo) {
          session = { ...session, ...liveInfo };
        }
      } catch (_) {}
    }

    // Clean comments if legacy raw URL array was stored
    session.comments = sanitizeComments(session.comments);

    const testValuesRaw = db.prepare(`
      SELECT tv.id, tv.session_id, tv.test_name, tv.test_slug, tv.value_string, tv.value_numeric,
             tv.unit, tv.tolerance_min, tv.tolerance_max, tv.status, tv.pass_fail,
             td.formatting
      FROM test_values tv
      LEFT JOIN (SELECT name, MAX(formatting) as formatting FROM test_definitions GROUP BY name) td ON tv.test_name = td.name
      WHERE tv.session_id = ?
      GROUP BY tv.id
      ORDER BY tv.test_name ASC
    `).all(session.id);

    // Guarantee strictly 1 row per unique test name
    const seenTests = new Set();
    const uniqueTestValues = [];
    for (const tv of testValuesRaw) {
      const key = (tv.test_name || '').toLowerCase().trim();
      if (!seenTests.has(key)) {
        seenTests.add(key);
        uniqueTestValues.push(tv);
      }
    }

    const getPrevStmt = db.prepare(`
      SELECT tv.value_string, tv.value_numeric, tv.unit, tv.status, tv.pass_fail, s.work_completed, s.id as session_id, td.formatting
      FROM test_values tv
      JOIN sessions s ON tv.session_id = s.id
      LEFT JOIN (SELECT name, MAX(formatting) as formatting FROM test_definitions GROUP BY name) td ON tv.test_name = td.name
      WHERE s.unit_name = ? AND tv.test_name = ?
        AND (s.work_completed < ? OR (s.work_completed = ? AND s.id < ?))
      ORDER BY s.work_completed DESC, s.id DESC
      LIMIT 1
    `);

    const getNextStmt = db.prepare(`
      SELECT tv.value_string, tv.value_numeric, tv.unit, tv.status, tv.pass_fail, s.work_completed, s.id as session_id, td.formatting
      FROM test_values tv
      JOIN sessions s ON tv.session_id = s.id
      LEFT JOIN (SELECT name, MAX(formatting) as formatting FROM test_definitions GROUP BY name) td ON tv.test_name = td.name
      WHERE s.unit_name = ? AND tv.test_name = ?
        AND (s.work_completed > ? OR (s.work_completed = ? AND s.id > ?))
      ORDER BY s.work_completed ASC, s.id ASC
      LIMIT 1
    `);

    const enrichedTestValues = uniqueTestValues.map(tv => {
      // 1. Ensure value_string preserves exact formatting/precision from QATrack
      let currentDisplay = tv.value_string;
      if ((currentDisplay === null || currentDisplay === undefined || currentDisplay === '' || currentDisplay === String(tv.value_numeric)) &&
          tv.formatting && tv.value_numeric !== null) {
        currentDisplay = formatQATrackValue(tv.value_numeric, tv.formatting);
      } else if (currentDisplay === null || currentDisplay === undefined) {
        currentDisplay = tv.value_numeric !== null ? String(tv.value_numeric) : '';
      }

      // 2. Tolerance & Action level marking:
      // - 'no_tolerance' (blue) when test has no tolerance defined in QATrack
      // - 'tolerance' (amber) strictly when value is outside tolerance level but within action level
      // - 'action' (red) when outside action level
      // - 'ok' when passing within tolerance
      const pFail = (tv.pass_fail || '').toLowerCase().trim();
      const st = (tv.status || '').toLowerCase().trim();
      let toleranceLevel = 'ok';

      if (pFail === 'no_tol' || pFail === 'no_tolerance' || pFail === 'not_set' || pFail.includes('no_tol') || pFail === 'none') {
        toleranceLevel = 'no_tolerance';
      } else if (pFail.includes('action') || st.includes('action') || pFail === 'fail' || st === 'fail') {
        toleranceLevel = 'action';
      } else if ((pFail.includes('tolerance') && !pFail.includes('no_tol')) || pFail === 'tol' || st === 'tolerance' || st === 'tol' || st.includes('warn')) {
        toleranceLevel = 'tolerance';
      } else if (!pFail && tv.tolerance_min === null && tv.tolerance_max === null) {
        toleranceLevel = 'no_tolerance';
      }

      // 3. Review status (Approved, Unreviewed, etc.)
      let reviewStatus = tv.status || 'Approved';
      if (['ok', 'action', 'tolerance', 'tol', 'pass', 'no_tol', 'no_tolerance'].includes(reviewStatus.toLowerCase())) {
        reviewStatus = session.status || 'Approved';
      }

      // 4. Fetch previous test reading for this machine
      let previous = null;
      try {
        const prevRow = getPrevStmt.get(session.unit_name, tv.test_name, session.work_completed, session.work_completed, session.id);
        if (prevRow) {
          let prevDisplay = prevRow.value_string;
          if ((!prevDisplay || prevDisplay === String(prevRow.value_numeric)) && prevRow.formatting && prevRow.value_numeric !== null) {
            prevDisplay = formatQATrackValue(prevRow.value_numeric, prevRow.formatting);
          } else if (prevDisplay === null || prevDisplay === undefined) {
            prevDisplay = prevRow.value_numeric !== null ? String(prevRow.value_numeric) : '';
          }
          const { diffPercent, arrow } = calculateDiffAndArrow(prevRow.value_numeric, tv.value_numeric);
          previous = {
            value_string: prevDisplay,
            value_numeric: prevRow.value_numeric,
            diffPercent,
            arrow,
            date: prevRow.work_completed,
            sessionId: prevRow.session_id
          };
        }
      } catch (_) {}

      // 5. Fetch following test reading for this machine
      let following = null;
      try {
        const nextRow = getNextStmt.get(session.unit_name, tv.test_name, session.work_completed, session.work_completed, session.id);
        if (nextRow) {
          let nextDisplay = nextRow.value_string;
          if ((!nextDisplay || nextDisplay === String(nextRow.value_numeric)) && nextRow.formatting && nextRow.value_numeric !== null) {
            nextDisplay = formatQATrackValue(nextRow.value_numeric, nextRow.formatting);
          } else if (nextDisplay === null || nextDisplay === undefined) {
            nextDisplay = nextRow.value_numeric !== null ? String(nextRow.value_numeric) : '';
          }
          const { diffPercent, arrow } = calculateDiffAndArrow(nextRow.value_numeric, tv.value_numeric);
          following = {
            value_string: nextDisplay,
            value_numeric: nextRow.value_numeric,
            diffPercent,
            arrow,
            date: nextRow.work_completed,
            sessionId: nextRow.session_id
          };
        }
      } catch (_) {}

      return {
        id: tv.id,
        test_name: tv.test_name,
        test_slug: tv.test_slug,
        value_string: currentDisplay,
        value_numeric: tv.value_numeric,
        unit: tv.unit,
        tolerance_min: tv.tolerance_min,
        tolerance_max: tv.tolerance_max,
        toleranceLevel,
        reviewStatus,
        previous,
        following
      };
    });

    const qatrackConfig = qatrackClient.getConfig();
    const baseUrl = (qatrackConfig.baseUrl || '').replace(/\/+$/, '');
    const qatrackWebUrl = session.qatrack_instance_id && baseUrl
      ? `${baseUrl}/qa/session/details/${session.qatrack_instance_id}/`
      : null;

    res.json({
      success: true,
      session,
      testValues: enrichedTestValues,
      qatrackWebUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Presets Management (Sorted by custom order_index)
router.get('/presets', (req, res) => {
  try {
    const presets = db.prepare('SELECT * FROM presets ORDER BY order_index ASC, id ASC').all();
    const parsed = presets.map(p => ({
      ...p,
      config: JSON.parse(p.config_json)
    }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/presets', (req, res) => {
  try {
    const { name, description, config } = req.body;
    if (!name || !config) {
      return res.status(400).json({ error: 'Name and config are required.' });
    }
    const maxOrderRow = db.prepare('SELECT COALESCE(MAX(order_index), 0) as maxOrder FROM presets').get();
    const nextOrder = (maxOrderRow?.maxOrder || 0) + 1;
    const insert = db.prepare(`
      INSERT INTO presets (name, description, config_json, order_index, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const info = insert.run(name, description || '', JSON.stringify(config), nextOrder);
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder presets
router.put('/presets/reorder', (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds array is required.' });
    }
    const updateOrder = db.prepare('UPDATE presets SET order_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const reorderTx = db.transaction((ids) => {
      ids.forEach((id, idx) => {
        updateOrder.run(idx + 1, id);
      });
    });
    reorderTx(orderedIds);

    const allPresets = db.prepare('SELECT * FROM presets ORDER BY order_index ASC, id ASC').all().map(p => ({
      ...p,
      config: JSON.parse(p.config_json)
    }));
    res.json({ success: true, presets: allPresets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/presets/:id', (req, res) => {
  try {
    const { name, description, config } = req.body;
    if (!name && !config && description === undefined) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }
    const existing = db.prepare('SELECT * FROM presets WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Preset not found.' });
    }
    const newName = name || existing.name;
    const newDesc = description !== undefined ? description : existing.description;
    const newConfigJson = config ? JSON.stringify(config) : existing.config_json;

    db.prepare(`
      UPDATE presets 
      SET name = ?, description = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newName, newDesc, newConfigJson, req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/presets/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM presets WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9b. Export Presets as JSON
router.get('/presets/export', (req, res) => {
  try {
    const { id } = req.query;
    let presetRows = [];
    let filename = '';

    if (id) {
      const row = db.prepare('SELECT * FROM presets WHERE id = ?').get(id);
      if (!row) {
        return res.status(404).json({ error: 'Preset not found.' });
      }
      presetRows = [row];
      const safeName = (row.name || 'preset').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      filename = `qadence_preset_${safeName}.json`;
    } else {
      presetRows = db.prepare('SELECT * FROM presets ORDER BY order_index ASC, id ASC').all();
      const dateStr = new Date().toISOString().split('T')[0];
      filename = `qadence_presets_${dateStr}.json`;
    }

    const exportData = {
      app: 'QAdence',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      presets: presetRows.map(p => {
        let parsedConfig = {};
        try {
          parsedConfig = typeof p.config_json === 'string' ? JSON.parse(p.config_json) : (p.config || {});
        } catch (_) {}
        return {
          name: p.name,
          description: p.description || '',
          config: parsedConfig
        };
      })
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9c. Import Presets from JSON
router.post('/presets/import', (req, res) => {
  try {
    const payload = req.body;
    let presetsToImport = [];
    let overwrite = false;

    if (Array.isArray(payload)) {
      presetsToImport = payload;
    } else if (payload && typeof payload === 'object') {
      if (Array.isArray(payload.presets)) {
        presetsToImport = payload.presets;
        overwrite = Boolean(payload.overwrite);
      } else if (payload.name && (payload.config || payload.config_json)) {
        presetsToImport = [payload];
        overwrite = Boolean(payload.overwrite);
      }
    }

    if (!Array.isArray(presetsToImport) || presetsToImport.length === 0) {
      return res.status(400).json({ error: 'No valid presets found in import payload.' });
    }

    const checkExisting = db.prepare('SELECT id, name FROM presets WHERE LOWER(name) = ?');
    const updateStmt = db.prepare(`
      UPDATE presets 
      SET description = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    const maxOrderRow = db.prepare('SELECT COALESCE(MAX(order_index), 0) as maxOrder FROM presets').get();
    let currentOrder = maxOrderRow?.maxOrder || 0;
    const insertStmt = db.prepare(`
      INSERT INTO presets (name, description, config_json, order_index, updated_at) 
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    let importedCount = 0;
    let updatedCount = 0;
    const processedPresets = [];

    const importTx = db.transaction(() => {
      for (const p of presetsToImport) {
        if (!p || typeof p !== 'object') continue;
        const rawName = String(p.name || '').trim();
        if (!rawName) continue;

        let configObj = p.config;
        if (!configObj && p.config_json) {
          try {
            configObj = typeof p.config_json === 'string' ? JSON.parse(p.config_json) : p.config_json;
          } catch (_) {}
        }
        if (!configObj || typeof configObj !== 'object') {
          continue; // Skip invalid presets
        }

        const configJson = JSON.stringify(configObj);
        const description = String(p.description || '').trim();

        const existing = checkExisting.get(rawName.toLowerCase());
        if (existing && overwrite) {
          updateStmt.run(description, configJson, existing.id);
          updatedCount++;
          processedPresets.push({ id: existing.id, name: rawName, action: 'updated' });
        } else {
          let finalName = rawName;
          if (existing && !overwrite) {
            let suffix = 1;
            while (checkExisting.get(`${rawName} (Imported${suffix > 1 ? ` ${suffix}` : ''})`.toLowerCase())) {
              suffix++;
            }
            finalName = `${rawName} (Imported${suffix > 1 ? ` ${suffix}` : ''})`;
          }
          currentOrder++;
          const info = insertStmt.run(finalName, description, configJson, currentOrder);
          importedCount++;
          processedPresets.push({ id: info.lastInsertRowid, name: finalName, action: 'imported' });
        }
      }
    });

    importTx();

    const allPresets = db.prepare('SELECT * FROM presets ORDER BY order_index ASC, id ASC').all().map(p => ({
      ...p,
      config: JSON.parse(p.config_json)
    }));

    res.json({
      success: true,
      importedCount,
      updatedCount,
      totalProcessed: processedPresets.length,
      processed: processedPresets,
      presets: allPresets
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Statistical Correlation Analysis (Pearson & Non-Parametric)
const { spawn } = require('child_process');
const { calculateCorrelationJS } = require('../scripts/correlation_fallback');

function getPythonExecutable() {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  const candidates = [
    path.join(__dirname, '..', '..', 'python', 'python.exe'),
    path.join(__dirname, '..', 'python', 'python.exe'),
    path.join(process.cwd(), 'python', 'python.exe'),
    path.join(process.cwd(), '..', 'python', 'python.exe'),
    'C:\\Users\\vboxuser\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return 'python';
}

function runPythonCorrelation(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'correlation.py');
    const pyExe = getPythonExecutable();
    const py = spawn(pyExe, [scriptPath], { windowsHide: true });

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', data => {
      stdout += data.toString();
    });

    py.stderr.on('data', data => {
      stderr += data.toString();
    });

    py.on('error', err => {
      reject(err);
    });

    py.on('close', code => {
      if (code !== 0) {
        return reject(new Error(stderr || `Python script exited with code ${code}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse python output: ${e.message}`));
      }
    });

    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

router.post('/analysis/correlation', async (req, res) => {
  const { datasets = [], xName = 'X Variable', yName = 'Y Variable', measure = 'all' } = req.body;
  try {
    const result = await runPythonCorrelation({ datasets, xName, yName, measure });
    if (result && result.success) {
      return res.json(result);
    }
    throw new Error(result?.error || 'Python returned unsuccessful result');
  } catch (err) {
    console.warn('Python correlation execution warning (falling back to built-in JS engine):', err.message);
    try {
      const fallbackResult = calculateCorrelationJS({ datasets, xName, yName, measure });
      return res.json(fallbackResult);
    } catch (fallbackErr) {
      console.error('Correlation analysis failed completely:', fallbackErr);
      return res.status(500).json({ error: fallbackErr.message });
    }
  }
});

module.exports = router;
