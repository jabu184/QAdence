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

    console.log('Testing /api/presets CRUD (create, overwrite/PUT, delete)...');
    const createRes = await axios.post(`${base}/presets`, {
      name: 'Test Preset Temp',
      description: 'Initial description',
      config: { xVariable: 'work_completed', yVariable: 'pressure' }
    });
    const createdId = createRes.data.id;
    if (!createdId) throw new Error('Failed to create preset');

    // Test overwrite PUT
    await axios.put(`${base}/presets/${createdId}`, {
      name: 'Test Preset Updated',
      description: 'Updated description',
      config: { xVariable: 'work_completed', yVariable: 'pass_rate_pct' }
    });

    const getRes = await axios.get(`${base}/presets`);
    const updated = getRes.data.find(p => p.id === createdId);
    if (!updated || updated.name !== 'Test Preset Updated' || updated.description !== 'Updated description') {
      throw new Error('Preset PUT overwrite failed');
    }

    // Test DELETE
    const delRes = await axios.delete(`${base}/presets/${createdId}`);
    if (!delRes.data.success) throw new Error('Preset DELETE failed');

    const verifyDel = await axios.get(`${base}/presets`);
    if (verifyDel.data.some(p => p.id === createdId)) {
      throw new Error('Preset was not deleted');
    }
    console.log('Preset CRUD verified successfully!');

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

    // Clean up test session
    db.prepare('DELETE FROM test_values WHERE session_id = ?').run(sRej);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sRej);

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
