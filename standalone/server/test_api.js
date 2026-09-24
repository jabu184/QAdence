const express = require('express');
const cors = require('cors');
const apiRouter = require('./routes/api');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

const server = app.listen(5099, async () => {
  let originalSettings = [];
  try {
    const axios = require('axios');
    const base = 'http://localhost:5099/api';
    const db = require('./db');
    originalSettings = db.prepare('SELECT * FROM settings').all();
    db.exec(`
      DELETE FROM test_values;
      DELETE FROM sessions;
      DELETE FROM test_definitions;
      DELETE FROM test_lists;
      DELETE FROM units;
      DELETE FROM unit_test_collections;
      DELETE FROM presets;
    `);

    // Insert isolated test fixture
    db.prepare(`INSERT INTO units (id, name, unit_class, unit_type, active) VALUES (1, 'TrueBeam 1', 'Linac', 'TrueBeam', 1), (2, 'LA10', 'Linac', 'Elekta', 1)`).run();
    db.prepare(`INSERT INTO test_lists (id, name) VALUES (1, 'Patient Specific QA'), (2, '171 - Delta 4 Patient')`).run();
    db.prepare(`INSERT INTO unit_test_collections (id, unit_id, unit_name, test_list_id, test_list_name, active) VALUES (1, 1, 'TrueBeam 1', 1, 'Patient Specific QA', 1), (2, 2, 'LA10', 2, '171 - Delta 4 Patient', 1)`).run();
    db.prepare(`INSERT INTO test_definitions (name, slug, test_list_name, unit, data_type, is_numeric) VALUES ('Gamma Pass Rate (3%/3mm)', 'gamma-3-3', 'Patient Specific QA', '%', 'simple', 1), ('Gamma Pass Rate (3%/3mm)', 'gamma-3-3', '171 - Delta 4 Patient', '%', 'simple', 1), ('Median Dose Deviation (%)', 'median-dose-deviation', '171 - Delta 4 Patient', '%', 'simple', 1)`).run();

    const s1 = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (1, 1, 'TrueBeam 1', 'Patient Specific QA', '2026-01-01 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;
    const s2 = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (2, 2, 'LA10', '171 - Delta 4 Patient', '2026-01-02 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;

    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Gamma Pass Rate (3%/3mm)', 'gamma-3-3', '98.5', 98.5, '%', 'OK')`).run(s1);
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Gamma Pass Rate (3%/3mm)', 'gamma-3-3', '99.1', 99.1, '%', 'OK')`).run(s2);
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Median Dose Deviation (%)', 'median-dose-deviation', '0.5', 0.5, '%', 'OK')`).run(s2);
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Site', 'site', 'Prostate', NULL, '', 'OK')`).run(s2);

    console.log('Testing /api/status...');
    const statusRes = await axios.get(`${base}/status`);
    console.log('Status OK:', statusRes.data.db);

    console.log('Testing /api/schema/tests...');
    const testsRes = await axios.get(`${base}/schema/tests`);
    console.log(`Discovered ${testsRes.data.length} test definitions:`, testsRes.data.map(t => t.name));

    console.log('Testing /api/schema/units...');
    const unitsRes = await axios.get(`${base}/schema/units`);
    console.log('Units:', unitsRes.data);

    // Verify active vs deactivated unit behavior
    db.prepare(`INSERT OR REPLACE INTO units (id, name, unit_class, unit_type, serial_number, location, active) VALUES (999, 'Test Deactivated Linac', 'Linac', '', '', '', 0)`).run();
    db.prepare(`INSERT OR REPLACE INTO units (id, name, unit_class, unit_type, serial_number, location, active) VALUES (998, 'Test Newly Added Linac', 'Linac', '', '', '', 1)`).run();

    const unitsAfterRes = await axios.get(`${base}/schema/units`);
    const unitNames = unitsAfterRes.data.map(u => u.name);
    if (!unitNames.includes('Test Newly Added Linac')) {
      throw new Error('New active unit did not appear in /api/schema/units');
    }
    if (unitNames.includes('Test Deactivated Linac')) {
      throw new Error('Deactivated unit incorrectly appeared in /api/schema/units');
    }
    // Clean up test units
    db.prepare(`DELETE FROM units WHERE id IN (998, 999)`).run();
    console.log('Verified: newly added linac appears and deactivated linac is excluded!');

    console.log('Testing /api/schema/unit-classes...');
    const unitClassesRes = await axios.get(`${base}/schema/unit-classes`);
    console.log('Unit Classes:', unitClassesRes.data);

    console.log('Testing /api/sync/status...');
    const syncStatusRes = await axios.get(`${base}/sync/status`);
    console.log('Sync status:', syncStatusRes.data);
    if (typeof syncStatusRes.data.heapUsedMB !== 'number' || typeof syncStatusRes.data.rssMB !== 'number') {
      throw new Error('Sync status missing memory metrics');
    }

    console.log('Testing /api/schema/test-lists (excluding test lists with no data or inactive assignments)...');
    // Insert an empty test list with no data
    db.prepare(`INSERT OR REPLACE INTO test_lists (id, name, slug, description) VALUES (888, 'Empty Test List With No Data', 'empty-no-data', '')`).run();
    // Insert an inactive assignment
    db.prepare(`INSERT OR REPLACE INTO unit_test_collections (id, unit_id, unit_name, test_list_id, test_list_name, collection_name, active) VALUES (888, 1, 'TrueBeam 1', 888, 'Inactive Assignment List', '', 0)`).run();

    const testListsRes = await axios.get(`${base}/schema/test-lists`);
    console.log('Test lists returned:', testListsRes.data);
    if (testListsRes.data.includes('Empty Test List With No Data')) {
      throw new Error('Test list with no data was incorrectly included in /api/schema/test-lists');
    }
    if (testListsRes.data.includes('Inactive Assignment List')) {
      throw new Error('Inactive test list assignment was incorrectly included in /api/schema/test-lists');
    }

    // Clean up dummy rows
    db.prepare(`DELETE FROM test_lists WHERE id = 888`).run();
    db.prepare(`DELETE FROM unit_test_collections WHERE id = 888`).run();
    console.log('Verified: test lists with no data and inactive assignments are strictly excluded!');

    const sortedCopy = [...testListsRes.data].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    if (JSON.stringify(testListsRes.data) !== JSON.stringify(sortedCopy)) {
      throw new Error('Test lists are not sorted alphabetically!');
    }

    console.log('Testing /api/schema/test-values for Site...');
    const siteVals = await axios.get(`${base}/schema/test-values?test_name=Site`);
    console.log('Site values:', siteVals.data);

    console.log('Testing /api/query (includeAllInstances vs testLists scoping)...');
    const allInstancesRes = await axios.post(`${base}/query`, {
      yVariable: 'Gamma Pass Rate (3%/3mm)',
      includeAllInstances: true
    });
    const scopedRes = await axios.post(`${base}/query`, {
      yVariable: 'Gamma Pass Rate (3%/3mm)',
      includeAllInstances: false,
      testLists: ['171 - Delta 4 Patient']
    });
    if (allInstancesRes.data.dataPoints.length > scopedRes.data.dataPoints.length &&
        scopedRes.data.dataPoints.every(p => p.metadata.testList === '171 - Delta 4 Patient')) {
      console.log(`Test list scoping verified: ${allInstancesRes.data.dataPoints.length} all-instances vs ${scopedRes.data.dataPoints.length} scoped points.`);
    } else {
      throw new Error('Test list scoping verification failed.');
    }

    console.log('Testing /api/query with unit and conditional WHERE filter scoping...');
    const unitFilteredRes = await axios.post(`${base}/query`, {
      yVariable: 'Median Dose Deviation (%)',
      units: ['LA10'],
      filters: [{ testName: 'Site', operator: 'equals', value: 'Prostate' }]
    });
    if (unitFilteredRes.data.dataPoints.every(p => p.unit === 'LA10')) {
      console.log(`Unit and conditional filter verified: ${unitFilteredRes.data.dataPoints.length} points returned for LA10 + Prostate.`);
    } else {
      throw new Error('Unit and conditional filter scoping failed.');
    }

    console.log('Testing local query needsPull and caching indicators...');
    if (allInstancesRes.data.needsPull !== false) {
      throw new Error(`Expected needsPull to be false for existing local variable, got ${allInstancesRes.data.needsPull}`);
    }
    const nonExistentRes = await axios.post(`${base}/query`, {
      yVariable: 'Non Existent Test Variable 999',
      includeAllInstances: true
    });
    if (nonExistentRes.data.matchedPoints !== 0) {
      throw new Error('Expected 0 matchedPoints for non-existent variable');
    }
    console.log('Verified: local query correctly isolates local variables and returns 0 matched points when variable is not in dataset!');

    console.log('Testing /api/presets CRUD (create, overwrite/PUT, delete)...');
    const createRes = await axios.post(`${base}/presets`, {
      name: 'Test Preset Temp',
      description: 'Initial description',
      config: {
        xVariable: 'work_completed',
        yVariable: 'pressure',
        baselineConfig: { enabled: true, baseline: '100', upperTol: '3', lowerTol: '3', symmetric: true }
      }
    });
    const createdId = createRes.data.id;
    if (!createdId) throw new Error('Failed to create preset');

    // Test overwrite PUT
    await axios.put(`${base}/presets/${createdId}`, {
      name: 'Test Preset Updated',
      description: 'Updated description',
      config: {
        xVariable: 'work_completed',
        yVariable: 'pass_rate_pct',
        baselineConfig: { enabled: true, baseline: '98.5', upperTol: '2', lowerTol: '1.5', symmetric: false }
      }
    });

    const getRes = await axios.get(`${base}/presets`);
    const updated = getRes.data.find(p => p.id === createdId);
    if (!updated || updated.name !== 'Test Preset Updated' || updated.description !== 'Updated description') {
      throw new Error('Preset PUT overwrite failed');
    }
    const parsedConfig = JSON.parse(updated.config_json);
    if (!parsedConfig.baselineConfig || parsedConfig.baselineConfig.baseline !== '98.5' || parsedConfig.baselineConfig.upperTol !== '2') {
      throw new Error('Preset baselineConfig was not persisted correctly in preset config');
    }

    // Test DELETE
    const delRes = await axios.delete(`${base}/presets/${createdId}`);
    if (!delRes.data.success) throw new Error('Preset DELETE failed');

    const verifyDel = await axios.get(`${base}/presets`);
    if (verifyDel.data.some(p => p.id === createdId)) {
      throw new Error('Preset was not deleted');
    }
    console.log('Preset CRUD verified successfully!');

    console.log('Testing /api/presets/export and /api/presets/import...');
    // Create two test presets
    const p1 = db.prepare(`
      INSERT INTO presets (name, description, config_json)
      VALUES (?, ?, ?)
    `).run('Preset Alpha', 'First test preset', JSON.stringify({ yVariable: 'Gamma Pass Rate (3%/3mm)', datasets: [{ id: 'ds-1', name: 'DS 1' }] })).lastInsertRowid;
    const p2 = db.prepare(`
      INSERT INTO presets (name, description, config_json)
      VALUES (?, ?, ?)
    `).run('Preset Beta', 'Second test preset', JSON.stringify({ yVariable: 'Median Dose Deviation (%)', datasets: [{ id: 'ds-2', name: 'DS 2' }] })).lastInsertRowid;

    // Test export all
    const exportAllRes = await axios.get(`${base}/presets/export`);
    if (!exportAllRes.data || exportAllRes.data.app !== 'QAdence' || !Array.isArray(exportAllRes.data.presets) || exportAllRes.data.presets.length < 2) {
      throw new Error('Export all presets failed or returned invalid envelope');
    }

    // Test export single preset
    const exportSingleRes = await axios.get(`${base}/presets/export?id=${p1}`);
    if (!exportSingleRes.data || exportSingleRes.data.presets.length !== 1 || exportSingleRes.data.presets[0].name !== 'Preset Alpha') {
      throw new Error('Export single preset failed');
    }

    // Test import without overwrite (should generate (Imported))
    const importNoOverwriteRes = await axios.post(`${base}/presets/import`, {
      overwrite: false,
      presets: [
        {
          name: 'Preset Alpha',
          description: 'Imported duplicate',
          config: { yVariable: 'Gamma Pass Rate (3%/3mm)', datasets: [{ id: 'ds-imp', name: 'Imported DS' }] }
        }
      ]
    });
    if (!importNoOverwriteRes.data.success || importNoOverwriteRes.data.importedCount !== 1) {
      throw new Error('Import without overwrite failed');
    }
    const importedRow = db.prepare("SELECT * FROM presets WHERE name LIKE 'Preset Alpha (Imported%)'").get();
    if (!importedRow) {
      throw new Error('Import did not create duplicate with (Imported) suffix');
    }

    // Test import with overwrite (should update existing)
    const importOverwriteRes = await axios.post(`${base}/presets/import`, {
      overwrite: true,
      presets: [
        {
          name: 'Preset Beta',
          description: 'Beta description overwritten',
          config: { yVariable: 'Overwritten Variable', datasets: [] }
        }
      ]
    });
    if (!importOverwriteRes.data.success || importOverwriteRes.data.updatedCount !== 1) {
      throw new Error('Import with overwrite failed');
    }
    const overwrittenRow = db.prepare('SELECT * FROM presets WHERE id = ?').get(p2);
    if (!overwrittenRow || overwrittenRow.description !== 'Beta description overwritten') {
      throw new Error('Import did not overwrite existing preset');
    }

    // Test invalid import payload
    try {
      await axios.post(`${base}/presets/import`, { presets: [] });
      throw new Error('Expected empty presets array to be rejected');
    } catch (err) {
      if (err.response?.status !== 400) {
        throw new Error('Expected 400 status for empty import');
      }
    }

    // Clean up created presets
    db.prepare('DELETE FROM presets WHERE id IN (?, ?)').run(p1, p2);
    db.prepare('DELETE FROM presets WHERE id = ?').run(importedRow.id);
    console.log('Preset export and import verified successfully!');

    console.log('Testing /api/presets/reorder and metadata editing...');
    const r1 = db.prepare(`
      INSERT INTO presets (name, description, config_json, order_index)
      VALUES (?, ?, ?, ?)
    `).run('Order First', 'Desc 1', JSON.stringify({ yVariable: 'v1' }), 1).lastInsertRowid;
    const r2 = db.prepare(`
      INSERT INTO presets (name, description, config_json, order_index)
      VALUES (?, ?, ?, ?)
    `).run('Order Second', 'Desc 2', JSON.stringify({ yVariable: 'v2' }), 2).lastInsertRowid;
    const r3 = db.prepare(`
      INSERT INTO presets (name, description, config_json, order_index)
      VALUES (?, ?, ?, ?)
    `).run('Order Third', 'Desc 3', JSON.stringify({ yVariable: 'v3' }), 3).lastInsertRowid;

    // Test reverse reorder: [r3, r1, r2]
    const reorderRes = await axios.put(`${base}/presets/reorder`, {
      orderedIds: [r3, r1, r2]
    });
    if (!reorderRes.data.success || !Array.isArray(reorderRes.data.presets)) {
      throw new Error('Reorder presets endpoint failed');
    }
    const returnedPresets = reorderRes.data.presets;
    if (returnedPresets[0].id !== r3 || returnedPresets[1].id !== r1 || returnedPresets[2].id !== r2) {
      throw new Error(`Reorder failed: expected [${r3}, ${r1}, ${r2}], got [${returnedPresets.map(p => p.id).join(', ')}]`);
    }

    // Test editing name and description only
    await axios.put(`${base}/presets/${r1}`, {
      name: 'Renamed Order First',
      description: 'Edited description only'
    });
    const editedPreset = db.prepare('SELECT * FROM presets WHERE id = ?').get(r1);
    if (editedPreset.name !== 'Renamed Order First' || editedPreset.description !== 'Edited description only') {
      throw new Error('Editing name/description failed');
    }
    const editedConfig = JSON.parse(editedPreset.config_json);
    if (editedConfig.yVariable !== 'v1') {
      throw new Error('Config was corrupted during metadata edit');
    }

    // Clean up test rows
    db.prepare('DELETE FROM presets WHERE id IN (?, ?, ?)').run(r1, r2, r3);
    console.log('Preset reorder and metadata editing verified successfully!');

    console.log('Testing /api/analysis/correlation with Python backend...');
    const corrRes = await axios.post(`${base}/analysis/correlation`, {
      datasets: [
        {
          id: 'ds-test',
          name: 'TrueBeam 1',
          color: '#2563eb',
          points: [
            { x: 10, y: 100 },
            { x: 20, y: 200 },
            { x: 30, y: 300 },
            { x: 40, y: 400 }
          ]
        }
      ],
      xName: 'Nominal Dose',
      yName: 'Measured Charge'
    });

    if (!corrRes.data.success || !corrRes.data.datasets || corrRes.data.datasets.length === 0) {
      throw new Error('Correlation analysis failed to return datasets');
    }
    const dsCorr = corrRes.data.datasets[0];
    if (dsCorr.pearsonR !== 1.0) {
      throw new Error(`Expected Pearson r = 1.0, got ${dsCorr.pearsonR}`);
    }
    if (!dsCorr.suggestedType.includes('Linear')) {
      throw new Error(`Expected Linear suggested type, got ${dsCorr.suggestedType}`);
    }
    console.log('Correlation verified: Pearson r =', dsCorr.pearsonR, ', suggested =', dsCorr.suggestedType);

    console.log('Testing Session Deletion Reconciliation...');
    // Insert dummy session that will simulate being deleted in QATrack+
    const sDel = db.prepare(`
      INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status)
      VALUES (99999, 1, 'TrueBeam 1', 'Patient Specific QA', '2026-01-03 10:00:00', 'Physicist', 'Pass')
    `).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, value_numeric) VALUES (?, 'Gamma Pass Rate (3%/3mm)', 95.0)`).run(sDel);

    // Verify it exists in DB
    const beforeCheck = db.prepare('SELECT id FROM sessions WHERE qatrack_instance_id = 99999').get();
    if (!beforeCheck) throw new Error('Failed to insert test session for deletion test');

    // Simulate reconciliation: fetched IDs contains only [1], so 99999 must be deleted
    const fetchedIds = new Set([1]);
    const scopeSessions = db.prepare(`SELECT id, qatrack_instance_id FROM sessions WHERE qatrack_instance_id IS NOT NULL AND test_list_name = 'Patient Specific QA'`).all();
    const staleIds = scopeSessions.filter(s => !fetchedIds.has(s.qatrack_instance_id)).map(s => s.id);
    for (const id of staleIds) {
      db.prepare('DELETE FROM test_values WHERE session_id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    }

    const afterCheck = db.prepare('SELECT id FROM sessions WHERE qatrack_instance_id = 99999').get();
    const valuesCheck = db.prepare('SELECT id FROM test_values WHERE session_id = ?').get(sDel);
    if (afterCheck || valuesCheck) {
      throw new Error('Reconciliation failed to prune deleted session or its values');
    }
    console.log('Testing /api/config for includeUnapproved and includeRejected settings...');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_include_unapproved', 'false'), ('qatrack_include_rejected', 'false')").run();
    require('./qatrackClient').reloadConfig();
    const initialConfigRes = await axios.get(`${base}/config`);
    if (initialConfigRes.data.includeUnapproved !== false || initialConfigRes.data.includeRejected !== false) {
      throw new Error(`Expected default includeUnapproved=false and includeRejected=false, got unapproved=${initialConfigRes.data.includeUnapproved}, rejected=${initialConfigRes.data.includeRejected}`);
    }

    // Save with both enabled
    await axios.post(`${base}/config`, {
      baseUrl: 'http://localhost:8000',
      token: 'test-token-123',
      authType: 'Api-Key',
      includeUnapproved: true,
      includeRejected: true
    });

    const updatedConfigRes = await axios.get(`${base}/config`);
    if (updatedConfigRes.data.includeUnapproved !== true || updatedConfigRes.data.includeRejected !== true) {
      throw new Error('Failed to save and persist includeUnapproved=true and includeRejected=true');
    }

    // Revert back to off (default)
    await axios.post(`${base}/config`, {
      baseUrl: 'http://localhost:8000',
      token: 'test-token-123',
      authType: 'Api-Key',
      includeUnapproved: false,
      includeRejected: false
    });

    const revertedConfigRes = await axios.get(`${base}/config`);
    if (revertedConfigRes.data.includeUnapproved !== false || revertedConfigRes.data.includeRejected !== false) {
      throw new Error('Failed to revert includeUnapproved and includeRejected back to false');
    }
    console.log('Verified: Settings correctly persist and toggle includeUnapproved and includeRejected (off by default)!');

    const qatrackClient = require('./qatrackClient');
    qatrackClient.saveConfig('http://localhost:8000', 'test', 'Api-Key', {
      includeUnapproved: false,
      includeRejected: false
    });
    if (qatrackClient.includeUnapproved !== false || qatrackClient.includeRejected !== false) {
      throw new Error('QATrackClient failed to set includeUnapproved and includeRejected');
    }

    console.log('Testing Test Instance Status Resolution & Strict Rejection Filtering...');
    // Seed status 3 (Rejected), 1 (Unreviewed), 2 (Approved) in test_instance_statuses table
    db.prepare(`INSERT OR REPLACE INTO test_instance_statuses (id, name, slug, requires_review, valid, is_rejected) VALUES (1, 'Unreviewed', 'unreviewed', 1, 1, 0)`).run();
    db.prepare(`INSERT OR REPLACE INTO test_instance_statuses (id, name, slug, requires_review, valid, is_rejected) VALUES (2, 'Approved', 'Approved', 0, 1, 0)`).run();
    db.prepare(`INSERT OR REPLACE INTO test_instance_statuses (id, name, slug, requires_review, valid, is_rejected) VALUES (3, 'Rejected', 'rejected', 0, 0, 1)`).run();

    const statusMap = await qatrackClient.getOrLoadTestInstanceStatusMap();
    const resolvedRejectedUrl = qatrackClient.resolveTestInstanceStatus({ status: 'http://192.168.68.113:8000/api/qc/testinstancestatus/3/', pass_fail: 'no_tol' }, statusMap);
    if (!resolvedRejectedUrl.isRejected || resolvedRejectedUrl.valid) {
      throw new Error(`Expected isRejected=true and valid=false for status URL /3/, got ${JSON.stringify(resolvedRejectedUrl)}`);
    }

    const resolvedRejectedId = qatrackClient.resolveTestInstanceStatus({ status: 3, pass_fail: 'no_tol' }, statusMap);
    if (!resolvedRejectedId.isRejected) {
      throw new Error(`Expected isRejected=true for status ID 3, got ${JSON.stringify(resolvedRejectedId)}`);
    }

    const resolvedUnreviewed = qatrackClient.resolveTestInstanceStatus({ status: 'http://192.168.68.113:8000/api/qc/testinstancestatus/1/', pass_fail: 'no_tol' }, statusMap);
    if (!resolvedUnreviewed.requiresReview) {
      throw new Error(`Expected requiresReview=true for status URL /1/, got ${JSON.stringify(resolvedUnreviewed)}`);
    }

    const resolvedApproved = qatrackClient.resolveTestInstanceStatus({ status: 'http://192.168.68.113:8000/api/qc/testinstancestatus/2/', pass_fail: 'no_tol' }, statusMap);
    if (resolvedApproved.isRejected || resolvedApproved.requiresReview) {
      throw new Error(`Expected clean approved status for URL /2/, got ${JSON.stringify(resolvedApproved)}`);
    }
    console.log('Verified: resolveTestInstanceStatus correctly maps URLs and IDs to rejection & review flags!');

    // Test /api/query defense-in-depth: rejected session must be excluded when includeRejected is false
    const sRej = db.prepare(`
      INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status)
      VALUES (88888, 1, 'LA10', 'Patient Specific QA', '2026-01-04 10:00:00', 'Physicist', 'Rejected')
    `).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, value_numeric, status) VALUES (?, 'Gamma Pass Rate (3%/3mm)', 82.0, 'Rejected')`).run(sRej);

    const queryResFiltered = await axios.post(`${base}/query`, {
      units: ['LA10'],
      includeAllInstances: true,
      yVariable: 'Gamma Pass Rate (3%/3mm)'
    });
    const rejPoint = (queryResFiltered.data.dataPoints || []).find(p => p.sessionId === sRej);
    if (rejPoint) {
      throw new Error('Expected rejected session 88888 to be strictly excluded from /api/query when includeRejected is false');
    }
    console.log('Verified: /api/query strictly excludes rejected session when includeRejected is false!');

    // Test Composite & Sublist Variable Extraction and Classification
    console.log('Testing Composite & Sublist Variable Handling...');

    // 1. Verify isNumericType heuristic
    if (qatrackClient.isNumericType({ type: 'string', name: 'sag_max_mm', slug: 'sag_max_mm' }) !== 1) {
      throw new Error('Expected sag_max_mm to be classified as numeric');
    }
    if (qatrackClient.isNumericType({ type: 'string', calculation_procedure: 'result = 42' }) !== 1) {
      throw new Error('Expected test with calculation_procedure to be classified as numeric');
    }
    if (qatrackClient.isNumericType({ type: 'string', formatting: '%.2f' }) !== 1) {
      throw new Error('Expected test with float formatting to be classified as numeric');
    }
    if (qatrackClient.isNumericType({ type: 'string', name: 'Site', slug: 'site' }) !== 0) {
      throw new Error('Expected Site to be classified as categorical');
    }
    if (qatrackClient.isNumericType({ type: 'multchoice', name: 'Energy', slug: 'energy' }) !== 0) {
      throw new Error('Expected multiple choice to be classified as categorical');
    }

    // 2. Verify extractTestInstanceValue
    const v1 = qatrackClient.extractTestInstanceValue({ value: null, string_value: '0.473' });
    if (v1.numVal !== 0.473 || v1.strVal !== '0.473') {
      throw new Error(`Expected parsed 0.473, got ${JSON.stringify(v1)}`);
    }
    const v2 = qatrackClient.extractTestInstanceValue({ value: null, string_value: '98.5%' });
    if (v2.numVal !== 98.5) {
      throw new Error(`Expected parsed 98.5 from percentage string, got ${JSON.stringify(v2)}`);
    }
    const v3 = qatrackClient.extractTestInstanceValue({ value: null, string_value: '25.04 mm' });
    if (v3.numVal !== 25.04) {
      throw new Error(`Expected parsed 25.04 from string with units, got ${JSON.stringify(v3)}`);
    }
    const v4 = qatrackClient.extractTestInstanceValue({ value: null, string_value: '', json_value: { value: 12.34 } });
    if (v4.numVal !== 12.34) {
      throw new Error(`Expected parsed 12.34 from json_value object, got ${JSON.stringify(v4)}`);
    }
    const v5 = qatrackClient.extractTestInstanceValue({ value: null, string_value: 'PASS' });
    if (v5.numVal !== null || v5.strVal !== 'PASS') {
      throw new Error(`Expected null numVal and PASS strVal, got ${JSON.stringify(v5)}`);
    }

    // 3. Verify unit_test_infos table and resolveTestInstanceInfo fallback
    db.prepare(`
      INSERT OR REPLACE INTO unit_test_infos (id, unit_id, unit_url, test_id, test_name, test_slug, unit, data_type, is_numeric)
      VALUES (555, 1, 'http://localhost/units/1/', 777, 'Leaf Speed Deviation', 'leaf_speed_dev', 'mm/s', 'string', 1)
    `).run();

    // Verify resolveTestInstanceInfo without memory map falls back to SQLite unit_test_infos
    const resolvedFromDb = qatrackClient.resolveTestInstanceInfo({ unit_test_info: 555 }, new Map());
    if (resolvedFromDb.testName !== 'Leaf Speed Deviation' || resolvedFromDb.isNumeric !== true) {
      throw new Error(`Expected Leaf Speed Deviation from SQLite unit_test_infos, got ${JSON.stringify(resolvedFromDb)}`);
    }

    // Clean up dummy UTI
    db.prepare('DELETE FROM unit_test_infos WHERE id = 555').run();
    console.log('Verified: Composite calculations and UTI fallbacks handled correctly!');

    // 4. Test Multi-Frequency & Ad-Hoc Test Resolution & Querying
    console.log('Testing Multi-Frequency & Ad-Hoc Test Capture...');

    // Test resolveUnitName and resolveTestListName
    const testUnitMap = new Map([[1, 'TrueBeam 1'], ['2', 'LA10']]);
    if (qatrackClient.resolveUnitName(1, testUnitMap) !== 'TrueBeam 1' ||
        qatrackClient.resolveUnitName('2', testUnitMap) !== 'LA10' ||
        qatrackClient.resolveUnitName('http://localhost/api/units/1/', testUnitMap) !== 'TrueBeam 1') {
      throw new Error('resolveUnitName failed to resolve unit across ID/URL formats');
    }

    const testTlMap = new Map([[10, 'Monthly Linac QA'], ['20', 'Weekly Linac QA']]);
    if (qatrackClient.resolveTestListName(10, testTlMap) !== 'Monthly Linac QA' ||
        qatrackClient.resolveTestListName('20', testTlMap) !== 'Weekly Linac QA' ||
        qatrackClient.resolveTestListName('http://localhost/api/testlists/10/', testTlMap) !== 'Monthly Linac QA') {
      throw new Error('resolveTestListName failed to resolve test list across ID/URL formats');
    }

    // Test resolveTestInstanceInfo with testDefMap (no UTI, direct test reference)
    const testDefMapMock = new Map([
      [888, { name: 'Dose Output 6MV', slug: 'dose_output_6mv', unit: 'cGy', type: 'simple' }]
    ]);
    const resolvedDirectTest = qatrackClient.resolveTestInstanceInfo({ test: 888 }, new Map(), testDefMapMock);
    if (resolvedDirectTest.testName !== 'Dose Output 6MV' || resolvedDirectTest.unit !== 'cGy') {
      throw new Error(`Expected Dose Output 6MV from testDefMap, got ${JSON.stringify(resolvedDirectTest)}`);
    }

    // Add multi-frequency test lists and sessions: Monthly, Weekly, and Ad-Hoc
    db.prepare(`INSERT OR REPLACE INTO test_lists (id, name) VALUES (10, 'Monthly Linac QA'), (20, 'Weekly Linac QA'), (30, 'Ad-Hoc Linac QA')`).run();
    db.prepare(`INSERT OR REPLACE INTO test_definitions (name, slug, test_list_name, unit, data_type, is_numeric) VALUES 
      ('Output 6MV', 'output_6mv', 'Monthly Linac QA', '%', 'simple', 1),
      ('Output 6MV', 'output_6mv', 'Weekly Linac QA', '%', 'simple', 1),
      ('Output 6MV', 'output_6mv', 'Ad-Hoc Linac QA', '%', 'simple', 1)
    `).run();

    // Session 101: Monthly collection
    const sMonthly = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (101, 1, 'TrueBeam 1', 'Monthly Linac QA', '2026-02-01 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Output 6MV', 'output_6mv', '100.2', 100.2, '%', 'OK')`).run(sMonthly);

    // Session 102: Weekly collection
    const sWeekly = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (102, 1, 'TrueBeam 1', 'Weekly Linac QA', '2026-02-08 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Output 6MV', 'output_6mv', '100.4', 100.4, '%', 'OK')`).run(sWeekly);

    // Session 103: Ad-Hoc session (no scheduled collection)
    const sAdHoc = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (103, 1, 'TrueBeam 1', 'Ad-Hoc Linac QA', '2026-02-15 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Output 6MV', 'output_6mv', '100.1', 100.1, '%', 'OK')`).run(sAdHoc);

    // Query with includeAllInstances = true
    const multiFreqAllRes = await axios.post(`${base}/query`, {
      yVariable: 'Output 6MV',
      includeAllInstances: true
    });
    if (multiFreqAllRes.data.matchedPoints !== 3) {
      throw new Error(`Expected 3 matched points across Monthly, Weekly, and Ad-Hoc sessions, got ${multiFreqAllRes.data.matchedPoints}`);
    }
    const retrievedLists = multiFreqAllRes.data.dataPoints.map(p => p.metadata?.testList);
    if (!retrievedLists.includes('Monthly Linac QA') || !retrievedLists.includes('Weekly Linac QA') || !retrievedLists.includes('Ad-Hoc Linac QA')) {
      throw new Error(`Expected points from Monthly, Weekly, and Ad-Hoc lists, got: ${JSON.stringify(retrievedLists)}`);
    }

    // Query scoped to Weekly only (includeAllInstances = false)
    const weeklyScopedRes = await axios.post(`${base}/query`, {
      yVariable: 'Output 6MV',
      testLists: ['Weekly Linac QA'],
      includeAllInstances: false
    });
    if (weeklyScopedRes.data.matchedPoints !== 1 || weeklyScopedRes.data.dataPoints[0].metadata?.testList !== 'Weekly Linac QA') {
      throw new Error(`Expected 1 matched point for Weekly Linac QA, got ${weeklyScopedRes.data.matchedPoints}`);
    }

    // Add Session 104: Monthly Physics session with Unapproved status and Unreviewed test value
    const sMonthlyUnapproved = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (104, 1, 'TrueBeam 1', 'Monthly Linac QA', '2026-02-18 10:00:00', 'Physicist', 'Unapproved')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES (?, 'Output 6MV', 'output_6mv', '100.5', 100.5, '%', 'Unreviewed')`).run(sMonthlyUnapproved);

    // When includeUnapproved is false (default), sMonthlyUnapproved is excluded
    const queryWithoutUnapproved = await axios.post(`${base}/query`, {
      yVariable: 'Output 6MV',
      includeAllInstances: true,
      includeUnapproved: false
    });
    if (queryWithoutUnapproved.data.matchedPoints !== 3) {
      throw new Error(`Expected 3 matched points when includeUnapproved is false, got ${queryWithoutUnapproved.data.matchedPoints}`);
    }

    // When includeUnapproved is true, sMonthlyUnapproved is included
    const queryWithUnapproved = await axios.post(`${base}/query`, {
      yVariable: 'Output 6MV',
      includeAllInstances: true,
      includeUnapproved: true
    });
    if (queryWithUnapproved.data.matchedPoints !== 4) {
      throw new Error(`Expected 4 matched points when includeUnapproved is true, got ${queryWithUnapproved.data.matchedPoints}`);
    }
    const hasUnreviewedMonthly = queryWithUnapproved.data.dataPoints.some(p => p.y === 100.5);
    if (!hasUnreviewedMonthly) {
      throw new Error('Expected unreviewed monthly session point with y=100.5 to be included');
    }
    console.log('Verified: Unreviewed monthly physics tests properly included when includeUnapproved is true and excluded when false!');

    console.log('Verified: Multi-frequency and ad-hoc test lists captured and queryable correctly!');

    // 5. Test GET /api/session-details/:id, previous/following calculations, and clean comments
    console.log('Testing GET /api/session-details/:id endpoint...');
    // Seed test definition with formatting string
    db.prepare(`INSERT OR REPLACE INTO test_definitions (name, slug, test_list_name, unit, data_type, is_numeric, formatting) VALUES ('Output 6MV', 'output_6mv', 'Weekly Linac', '%', 'simple', 1, '%.2f')`).run();
    // Set a raw URL comment on sWeekly to test sanitization
    db.prepare(`UPDATE sessions SET comments = '["http://localhost:8000/api/qc/comments/101/"]' WHERE id = ?`).run(sWeekly);
    // Mark test on sWeekly as Action level
    db.prepare(`UPDATE test_values SET pass_fail = 'action' WHERE session_id = ? AND test_name = 'Output 6MV'`).run(sWeekly);

    const weeklyDetails = await axios.get(`${base}/session-details/${sWeekly}`);
    if (!weeklyDetails.data.success || !weeklyDetails.data.session) {
      throw new Error(`Expected success and session in session-details, got ${JSON.stringify(weeklyDetails.data)}`);
    }
    // Verify raw comments URL was sanitized and addresses are not shown
    if (weeklyDetails.data.session.comments.includes('http://') || weeklyDetails.data.session.comments.includes('api/qc')) {
      throw new Error(`Expected sanitized comments without raw URLs, got: ${weeklyDetails.data.session.comments}`);
    }

    const outputTest = weeklyDetails.data.testValues.find(tv => tv.test_name === 'Output 6MV');
    if (!outputTest) {
      throw new Error(`Expected 'Output 6MV' test in session details`);
    }
    // Verify Action level tolerance marking
    if (outputTest.toleranceLevel !== 'action') {
      throw new Error(`Expected toleranceLevel 'action', got: ${outputTest.toleranceLevel}`);
    }
    // Verify Previous reading
    if (!outputTest.previous || outputTest.previous.value_numeric !== 100.2) {
      throw new Error(`Expected previous value 100.2, got: ${JSON.stringify(outputTest.previous)}`);
    }
    if (outputTest.previous.arrow !== '↓') {
      throw new Error(`Expected previous arrow '↓', got: ${outputTest.previous.arrow}`);
    }
    // Verify Following reading
    if (!outputTest.following || outputTest.following.value_numeric !== 100.1) {
      throw new Error(`Expected following value 100.1, got: ${JSON.stringify(outputTest.following)}`);
    }
    if (outputTest.following.arrow !== '↓') {
      throw new Error(`Expected following arrow '↓', got: ${outputTest.following.arrow}`);
    }

    const detailsRes = await axios.get(`${base}/session-details/${sMonthly}`);
    if (!detailsRes.data.success || !detailsRes.data.session) {
      throw new Error(`Expected success and session in session-details, got ${JSON.stringify(detailsRes.data)}`);
    }
    if (detailsRes.data.session.unit_name !== 'TrueBeam 1' || detailsRes.data.testValues.length === 0) {
      throw new Error(`Unexpected session details: ${JSON.stringify(detailsRes.data)}`);
    }
    if (!detailsRes.data.qatrackWebUrl || !detailsRes.data.qatrackWebUrl.includes('/qa/session/details/101/')) {
      throw new Error(`Expected qatrackWebUrl with /qa/session/details/101/, got ${detailsRes.data.qatrackWebUrl}`);
    }
    console.log('Verified: /api/session-details/:id returns complete metadata, previous/following comparisons, tolerance levels, and QATrack direct link!');

    // 6. Test conditional filters combined with AND or OR
    console.log('Testing conditional filters with AND or OR combination...');
    // Create sessions with site 'Prostate' and 'Breast'
    const sProstate = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (201, 1, 'TrueBeam 1', 'Patient Specific QA', '2026-03-01 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES 
      (?, 'Gamma Pass Rate (3%/3mm)', 'gamma_pass', '98.5', 98.5, '%', 'OK'),
      (?, 'Site', 'site', 'Prostate', NULL, NULL, 'OK')
    `).run(sProstate, sProstate);

    const sBreast = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (202, 1, 'TrueBeam 1', 'Patient Specific QA', '2026-03-02 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES 
      (?, 'Gamma Pass Rate (3%/3mm)', 'gamma_pass', '99.1', 99.1, '%', 'OK'),
      (?, 'Site', 'site', 'Breast', NULL, NULL, 'OK')
    `).run(sBreast, sBreast);

    const sLung = db.prepare(`INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status) VALUES (203, 1, 'TrueBeam 1', 'Patient Specific QA', '2026-03-03 10:00:00', 'Physicist', 'Pass')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status) VALUES 
      (?, 'Gamma Pass Rate (3%/3mm)', 'gamma_pass', '95.0', 95.0, '%', 'OK'),
      (?, 'Site', 'site', 'Lung', NULL, NULL, 'OK')
    `).run(sLung, sLung);

    // Query with OR logic: Site = 'Prostate' OR Site = 'Breast' on TrueBeam 1
    const orQueryRes = await axios.post(`${base}/query`, {
      yVariable: 'Gamma Pass Rate (3%/3mm)',
      units: ['TrueBeam 1'],
      includeAllInstances: true,
      filters: [
        { testName: 'Site', operator: 'equals', value: 'Prostate' },
        { testName: 'Site', operator: 'equals', value: 'Breast', logic: 'or' }
      ]
    });
    if (orQueryRes.data.matchedPoints !== 2) {
      throw new Error(`Expected 2 matched points for OR condition (Prostate OR Breast), got ${orQueryRes.data.matchedPoints}`);
    }

    // Query with AND logic: Site = 'Prostate' AND Site = 'Breast' (should return 0)
    const andQueryRes = await axios.post(`${base}/query`, {
      yVariable: 'Gamma Pass Rate (3%/3mm)',
      units: ['TrueBeam 1'],
      includeAllInstances: true,
      filters: [
        { testName: 'Site', operator: 'equals', value: 'Prostate' },
        { testName: 'Site', operator: 'equals', value: 'Breast', logic: 'and' }
      ]
    });
    if (andQueryRes.data.matchedPoints !== 0) {
      throw new Error(`Expected 0 matched points for AND condition (Prostate AND Breast), got ${andQueryRes.data.matchedPoints}`);
    }
    console.log('Verified: Multiple conditional filters with AND and OR combination logic work properly!');

    console.log('Testing /api/settings/backup and /api/settings/restore...');
    // Seed some specific settings and presets
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_url', 'http://backup-source.local:8000')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_token', 'source-token-xyz')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_auth_type', 'Api-Key')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_include_unapproved', 'true')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_include_rejected', 'false')").run();

    db.prepare("DELETE FROM presets").run();
    db.prepare(`
      INSERT INTO presets (name, description, config_json, order_index)
      VALUES ('Source Preset 1', 'Preset from source', '{"yVariable":"Gamma Pass Rate (3%/3mm)"}', 1)
    `).run();

    // 1. Export backup
    const backupRes = await axios.get(`${base}/settings/backup`);
    if (!backupRes.data || backupRes.data.app !== 'QAdence' || !backupRes.data.settings || !Array.isArray(backupRes.data.presets)) {
      throw new Error('Backup export returned invalid structure');
    }
    if (backupRes.data.settings.qatrack_url !== 'http://backup-source.local:8000') {
      throw new Error(`Backup export has incorrect qatrack_url: ${backupRes.data.settings.qatrack_url}`);
    }
    if (backupRes.data.presets.length !== 1 || backupRes.data.presets[0].name !== 'Source Preset 1') {
      throw new Error('Backup export has incorrect presets');
    }

    // 2. Modify settings and presets to simulate a new/wiped environment
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_url', 'http://changed.local:9999')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('qatrack_token', 'changed-token')").run();
    db.prepare(`
      INSERT INTO presets (name, description, config_json, order_index)
      VALUES ('Temporary Preset', 'Will be wiped or merged', '{"yVariable":"Dummy"}', 2)
    `).run();

    // 3. Restore with replacePresets: true
    const restoreRes = await axios.post(`${base}/settings/restore`, {
      ...backupRes.data,
      replacePresets: true
    });
    if (!restoreRes.data.success) {
      throw new Error('Restore failed');
    }

    // Check restored settings in DB
    const restoredUrlRow = db.prepare("SELECT value FROM settings WHERE key = 'qatrack_url'").get();
    if (restoredUrlRow?.value !== 'http://backup-source.local:8000') {
      throw new Error(`Restored setting mismatch: expected http://backup-source.local:8000, got ${restoredUrlRow?.value}`);
    }

    // Check restored presets in DB
    const allPresets = db.prepare("SELECT name FROM presets").all();
    if (allPresets.length !== 1 || allPresets[0].name !== 'Source Preset 1') {
      throw new Error(`Restored presets mismatch with replacePresets=true: ${JSON.stringify(allPresets)}`);
    }

    console.log('Verified: /api/settings/backup and /api/settings/restore work perfectly!');

    console.log('ALL API TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('Test failed:', err.response?.data || err.message);
    process.exitCode = 1;
  } finally {
    const db = require('./db');
    db.exec(`
      DELETE FROM test_values;
      DELETE FROM sessions;
      DELETE FROM test_definitions;
      DELETE FROM test_lists;
      DELETE FROM units;
      DELETE FROM unit_test_collections;
      DELETE FROM presets;
      DELETE FROM settings;
    `);
    if (originalSettings && originalSettings.length > 0) {
      const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      for (const s of originalSettings) {
        insertSetting.run(s.key, s.value);
      }
    }
    server.close();
  }
});
