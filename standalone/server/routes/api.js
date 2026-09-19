const express = require('express');
const router = express.Router();
const db = require('../db');
const qatrackClient = require('../qatrackClient');

// 1. App Status & Health
router.get('/status', (req, res) => {
  try {
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const testValCount = db.prepare('SELECT COUNT(*) as count FROM test_values').get().count;
    const unitCount = db.prepare('SELECT COUNT(*) as count FROM units').get().count;
    const presetCount = db.prepare('SELECT COUNT(*) as count FROM presets').get().count;
    const lastSession = db.prepare('SELECT work_completed FROM sessions ORDER BY work_completed DESC LIMIT 1').get();

    const config = qatrackClient.getConfig();

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
        authType: config.authType
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. QATrack+ Configuration
router.get('/config', (req, res) => {
  res.json(qatrackClient.getConfig());
});

router.post('/config', (req, res) => {
  try {
    const { baseUrl, token, authType } = req.body;
    let tokenToSave = token;
    if (tokenToSave === undefined || tokenToSave === null) {
      const existing = db.prepare("SELECT value FROM settings WHERE key = 'qatrack_token'").get();
      tokenToSave = existing ? existing.value : '';
    }
    qatrackClient.saveConfig(baseUrl || '', tokenToSave, authType || 'Token');
    res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    `);
    res.json({ success: true, message: 'All QA measurements, test definitions, and sessions cleared successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      WHERE u.active = 1
      UNION
      SELECT 
        s.unit_name as name,
        'Linac' as unitClass,
        '' as unitType,
        1 as active
      FROM sessions s
      WHERE s.unit_name NOT IN (SELECT name FROM units)
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
        WHERE active = 1 AND unit_name IN (SELECT name FROM units WHERE active = 1)
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
          SELECT DISTINCT test_list_name FROM unit_test_collections WHERE active = 1 AND unit_name IN (SELECT name FROM units WHERE active = 1)
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
      const isNumeric = t.numeric_count > (t.total_count * 0.5);
      map.set(key, {
        name: t.test_name,
        testList: t.test_list_name || 'General QA',
        unit: t.unit || '',
        isNumeric,
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
      metadataTests = ['Patient ID', 'Plan Name', 'Site', 'Beam Energy', 'Delivery Technique'],
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
      if (targetLists.length > 0) {
        const placeholders = targetLists.map(() => '?').join(',');
        countQuery += ` AND s.test_list_name IN (${placeholders})`;
        countParams.push(...targetLists);
      }
      if (units && units.length > 0) {
        const placeholders = units.map(() => '?').join(',');
        countQuery += ` AND s.unit_name IN (${placeholders})`;
        countParams.push(...units);
      }
      const countRow = db.prepare(countQuery).get(...countParams);
      if (!countRow || countRow.count === 0) {
        needsPull = true;
      }
    }

    // Determine session-level filters
    let sessionWhereClauses = [];
    let sessionParams = [];

    if (units && units.length > 0) {
      const placeholders = units.map(() => '?').join(',');
      sessionWhereClauses.push(`s.unit_name IN (${placeholders})`);
      sessionParams.push(...units);
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

    // Handle conditional test filters (e.g. Site == Prostate)
    filters.forEach((filter, idx) => {
      if (filter.testName && filter.value !== undefined && filter.value !== '') {
        const paramVal = filter.value;
        if (filter.operator === 'not_equals') {
          sessionWhereClauses.push(`
            s.id NOT IN (
              SELECT session_id FROM test_values
              WHERE test_name = ? AND value_string = ?
            )
          `);
          sessionParams.push(filter.testName, paramVal);
        } else if (filter.operator === 'contains') {
          sessionWhereClauses.push(`
            s.id IN (
              SELECT session_id FROM test_values
              WHERE test_name = ? AND value_string LIKE ?
            )
          `);
          sessionParams.push(filter.testName, `%${paramVal}%`);
        } else if (filter.operator === 'gt') {
          sessionWhereClauses.push(`
            s.id IN (
              SELECT session_id FROM test_values
              WHERE test_name = ? AND value_numeric > ?
            )
          `);
          sessionParams.push(filter.testName, parseFloat(paramVal));
        } else if (filter.operator === 'lt') {
          sessionWhereClauses.push(`
            s.id IN (
              SELECT session_id FROM test_values
              WHERE test_name = ? AND value_numeric < ?
            )
          `);
          sessionParams.push(filter.testName, parseFloat(paramVal));
        } else {
          // Default equals
          sessionWhereClauses.push(`
            s.id IN (
              SELECT session_id FROM test_values
              WHERE test_name = ? AND (value_string = ? OR value_numeric = ?)
            )
          `);
          sessionParams.push(filter.testName, paramVal, parseFloat(paramVal) || null);
        }
      }
    });

    const whereSql = sessionWhereClauses.length > 0
      ? `WHERE ${sessionWhereClauses.join(' AND ')}`
      : '';

    // Fetch matching sessions
    const sessionQuery = `
      SELECT s.id, s.unit_name, s.test_list_name, s.work_completed, s.status, s.created_by, s.comments
      FROM sessions s
      ${whereSql}
      ORDER BY s.work_completed ASC
    `;
    const sessions = db.prepare(sessionQuery).all(...sessionParams);

    if (sessions.length === 0) {
      return res.json({
        totalSessions: 0,
        dataPoints: [],
        xStats: calculateStats([]),
        yStats: calculateStats([]),
        grouped: {},
        tableRows: []
      });
    }

    const sessionIds = sessions.map(s => s.id);
    const idPlaceholders = sessionIds.map(() => '?').join(',');

    // Fetch all test values for these matching sessions
    const valuesQuery = `
      SELECT session_id, test_name, value_string, value_numeric, unit, tolerance_min, tolerance_max
      FROM test_values
      WHERE session_id IN (${idPlaceholders})
    `;
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

      const point = {
        sessionId: sess.id,
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

// 10. Presets Management
router.get('/presets', (req, res) => {
  try {
    const presets = db.prepare('SELECT * FROM presets ORDER BY updated_at DESC').all();
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
    const insert = db.prepare(`
      INSERT INTO presets (name, description, config_json, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const info = insert.run(name, description || '', JSON.stringify(config));
    res.json({ success: true, id: info.lastInsertRowid });
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

module.exports = router;
