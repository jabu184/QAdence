const express = require('express');
const cors = require('cors');
const apiRouter = require('./routes/api');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

const server = app.listen(5099, async () => {
  try {
    const axios = require('axios');
    const base = 'http://localhost:5099/api';
    const db = require('./db');
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
    `);
    server.close();
  }
});
