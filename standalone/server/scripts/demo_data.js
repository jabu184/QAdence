/**
 * QAdence Demo Data Generator
 * 
 * Standalone, modular script to generate realistic longitudinal patient QA datasets
 * for medical physics testing, multi-dataset benchmarking, and correlation analysis.
 * 
 * Usage from CLI:
 *   node server/scripts/demo_data.js [--clear]
 * 
 * Usage from Node/Express:
 *   const { seedDemoData } = require('./scripts/demo_data');
 *   seedDemoData(db);
 */

const db = require('../db');

function seedDemoData(database = db, options = {}) {
  const { clearExisting = false } = options;

  if (clearExisting) {
    database.exec(`
      DELETE FROM test_values;
      DELETE FROM sessions;
      DELETE FROM test_definitions;
      DELETE FROM test_lists;
      DELETE FROM units;
      DELETE FROM unit_test_collections;
    `);
  }

  // 1. Linac Machine Units
  const unitsData = [
    { id: 101, name: 'TrueBeam 1', unit_class: 'Linac', unit_type: 'Varian TrueBeam', serial_number: 'TB-1842', location: 'Bunker 1' },
    { id: 102, name: 'TrueBeam 2', unit_class: 'Linac', unit_type: 'Varian TrueBeam', serial_number: 'TB-2105', location: 'Bunker 2' },
    { id: 103, name: 'LA10 (Versa HD)', unit_class: 'Linac', unit_type: 'Elekta Versa HD', serial_number: 'VHD-150241', location: 'Bunker 3' },
    { id: 104, name: 'ETHOS3', unit_class: 'Linac', unit_type: 'Varian Ethos', serial_number: 'ETH-304', location: 'Bunker 4' }
  ];

  const insertUnit = database.prepare(`
    INSERT OR REPLACE INTO units (id, name, unit_class, unit_type, serial_number, location, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  for (const u of unitsData) {
    insertUnit.run(u.id, u.name, u.unit_class, u.unit_type, u.serial_number, u.location);
  }

  // 2. Test Lists
  const testListsData = [
    { id: 201, name: '171 - Delta 4 Patient', slug: 'delta-4-patient', description: 'Delta4 bi-planar diode array patient specific verification' },
    { id: 202, name: 'Patient Specific QA', slug: 'patient-specific-qa', description: 'General volumetric and planar patient verification metrics' },
    { id: 203, name: 'Monthly Dosimetry & Beam Output', slug: 'monthly-dosimetry', description: 'Monthly ion chamber absolute output and beam profile stability' }
  ];

  const insertTestList = database.prepare(`
    INSERT OR REPLACE INTO test_lists (id, name, slug, description)
    VALUES (?, ?, ?, ?)
  `);

  for (const tl of testListsData) {
    insertTestList.run(tl.id, tl.name, tl.slug, tl.description);
  }

  // 3. Unit Test Collections (Active assignments)
  const insertUtc = database.prepare(`
    INSERT OR REPLACE INTO unit_test_collections (id, unit_id, unit_name, test_list_id, test_list_name, collection_name, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  let utcId = 301;
  for (const u of unitsData) {
    insertUtc.run(utcId++, u.id, u.name, 201, '171 - Delta 4 Patient', `${u.name} - Delta 4`);
    insertUtc.run(utcId++, u.id, u.name, 202, 'Patient Specific QA', `${u.name} - Patient QA`);
    insertUtc.run(utcId++, u.id, u.name, 203, 'Monthly Dosimetry & Beam Output', `${u.name} - Monthly Output`);
  }

  // 4. Test Definitions
  const testDefsData = [
    // Delta 4
    { name: 'Overall Gamma (%)', slug: 'overall-gamma', test_list_name: '171 - Delta 4 Patient', unit: '%', data_type: 'simple', is_numeric: 1 },
    { name: 'Median Dose Deviation (%)', slug: 'median-dose-dev', test_list_name: '171 - Delta 4 Patient', unit: '%', data_type: 'simple', is_numeric: 1 },
    { name: 'Gamma Pass Rate (3%/3mm)', slug: 'gamma-3-3', test_list_name: '171 - Delta 4 Patient', unit: '%', data_type: 'simple', is_numeric: 1 },
    { name: 'Temperature', slug: 'temperature', test_list_name: '171 - Delta 4 Patient', unit: '°C', data_type: 'simple', is_numeric: 1 },
    { name: 'Pressure', slug: 'pressure', test_list_name: '171 - Delta 4 Patient', unit: 'kPa', data_type: 'simple', is_numeric: 1 },
    { name: 'Output Factor', slug: 'output-factor', test_list_name: '171 - Delta 4 Patient', unit: 'cGy/MU', data_type: 'simple', is_numeric: 1 },
    { name: 'Site', slug: 'site', test_list_name: '171 - Delta 4 Patient', unit: '', data_type: 'string', is_numeric: 0 },
    { name: 'Beam Energy', slug: 'beam-energy', test_list_name: '171 - Delta 4 Patient', unit: '', data_type: 'string', is_numeric: 0 },
    { name: 'Delivery Technique', slug: 'delivery-technique', test_list_name: '171 - Delta 4 Patient', unit: '', data_type: 'string', is_numeric: 0 },

    // Patient Specific QA
    { name: 'Overall Gamma (%)', slug: 'overall-gamma', test_list_name: 'Patient Specific QA', unit: '%', data_type: 'simple', is_numeric: 1 },
    { name: 'Gamma Pass Rate (3%/3mm)', slug: 'gamma-3-3', test_list_name: 'Patient Specific QA', unit: '%', data_type: 'simple', is_numeric: 1 },
    { name: 'Median Dose Deviation (%)', slug: 'median-dose-dev', test_list_name: 'Patient Specific QA', unit: '%', data_type: 'simple', is_numeric: 1 },
    { name: 'Temperature', slug: 'temperature', test_list_name: 'Patient Specific QA', unit: '°C', data_type: 'simple', is_numeric: 1 },
    { name: 'Pressure', slug: 'pressure', test_list_name: 'Patient Specific QA', unit: 'kPa', data_type: 'simple', is_numeric: 1 },
    { name: 'Output Factor', slug: 'output-factor', test_list_name: 'Patient Specific QA', unit: 'cGy/MU', data_type: 'simple', is_numeric: 1 },
    { name: 'Site', slug: 'site', test_list_name: 'Patient Specific QA', unit: '', data_type: 'string', is_numeric: 0 },
    { name: 'Beam Energy', slug: 'beam-energy', test_list_name: 'Patient Specific QA', unit: '', data_type: 'string', is_numeric: 0 },
    { name: 'Delivery Technique', slug: 'delivery-technique', test_list_name: 'Patient Specific QA', unit: '', data_type: 'string', is_numeric: 0 },

    // Monthly Output
    { name: 'Output Factor', slug: 'output-factor', test_list_name: 'Monthly Dosimetry & Beam Output', unit: 'cGy/MU', data_type: 'simple', is_numeric: 1 },
    { name: 'Temperature', slug: 'temperature', test_list_name: 'Monthly Dosimetry & Beam Output', unit: '°C', data_type: 'simple', is_numeric: 1 },
    { name: 'Pressure', slug: 'pressure', test_list_name: 'Monthly Dosimetry & Beam Output', unit: 'kPa', data_type: 'simple', is_numeric: 1 }
  ];

  const insertTestDef = database.prepare(`
    INSERT OR REPLACE INTO test_definitions (name, slug, test_list_name, unit, data_type, is_numeric)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const td of testDefsData) {
    try {
      insertTestDef.run(td.name, td.slug, td.test_list_name, td.unit, td.data_type, td.is_numeric);
    } catch (_) {}
  }

  // 5. Realistic Longitudinal Patient QA Sessions
  const sites = ['Prostate', 'Head & Neck', 'Breast', 'Brain SRS', 'Lung SBRT', 'Pelvis'];
  const energies = ['6MV', '10MV', '6FFF', '10FFF'];
  const techniques = ['VMAT', 'IMRT', '3D-CRT'];
  const physicists = ['Dr. E. Thorne', 'Dr. S. Miller', 'A. Patel, MSc', 'J. Vance, DABR', 'C. Zhang, PhD'];

  const insertSession = database.prepare(`
    INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status, comments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertVal = database.prepare(`
    INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Pseudo-random helper with repeatable seed
  let seed = 42;
  function random() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }
  function gaussian(mean = 0, stdev = 1) {
    const u = 1 - random();
    const v = random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
  }

  let sessionCount = 0;
  let valCount = 0;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Span across past 240 days (~8 months)
  const totalDays = 240;

  const tx = database.transaction(() => {
    // Generate ~140 longitudinal QA sessions
    for (let day = totalDays; day >= 0; day -= 1.8) {
      const dateObj = new Date(now - day * DAY_MS);
      const dateStr = dateObj.toISOString().replace('T', ' ').substring(0, 19);

      // Select random machine unit
      const unit = unitsData[Math.floor(random() * unitsData.length)];
      const testList = random() > 0.35 ? '171 - Delta 4 Patient' : 'Patient Specific QA';
      const physicist = physicists[Math.floor(random() * physicists.length)];
      const site = sites[Math.floor(random() * sites.length)];
      const energy = energies[Math.floor(random() * energies.length)];
      const tech = techniques[Math.floor(random() * techniques.length)];

      const qatrackId = 900000 + Math.floor(day * 100) + Math.floor(random() * 90);

      // Temperature variation: seasonal / lab oscillation around 21.8 °C
      const seasonalTemp = 21.5 + 1.2 * Math.sin((day / 365) * 2 * Math.PI);
      const tempVal = Math.round((seasonalTemp + gaussian(0, 0.45)) * 10) / 10;

      // Pressure variation: normal atmospheric variation around 101.3 kPa
      const pressVal = Math.round((101.3 + gaussian(0, 0.6)) * 10) / 10;

      // Output Factor: exhibits realistic physical dependence on Temperature & Pressure
      // (TP correction factor approx: (273.2 + T) / (273.2 + 22.0) * (101.3 / P))
      const tpFactor = ((273.2 + tempVal) / 295.2) * (101.3 / pressVal);
      const baseOutput = unit.name.includes('TrueBeam') ? 1.002 : (unit.name.includes('ETHOS') ? 0.998 : 1.005);
      const outputVal = Math.round((baseOutput * (0.92 + 0.08 * tpFactor) + gaussian(0, 0.003)) * 1000) / 1000;

      // Gamma Pass Rate: baseline 98.4%, with slight longitudinal curve/drift
      // TrueBeam is very stable (98.6 ± 0.9%); Versa HD has slight drift over time
      const timeProgression = (totalDays - day) / totalDays; // 0 to 1
      let machineDrift = 0;
      if (unit.name.includes('LA10')) {
        machineDrift = -1.2 * timeProgression; // -1.2% over 8 months
      } else if (unit.name.includes('ETHOS')) {
        machineDrift = 0.8 * Math.sin(timeProgression * Math.PI); // Curvilinear trend
      }

      const rawGamma = 98.6 + machineDrift + gaussian(0, 0.95);
      const gammaVal = Math.round(Math.max(91.0, Math.min(100.0, rawGamma)) * 10) / 10;

      // Median Dose Deviation: centered around 0.2%, correlates moderately with Output Factor
      const rawDoseDev = (outputVal - 1.0) * 80.0 + gaussian(0, 0.4);
      const doseDevVal = Math.round(rawDoseDev * 10) / 10;

      const status = gammaVal >= 95.0 ? 'Pass' : (gammaVal >= 92.0 ? 'Warning' : 'Action Required');
      const comments = status === 'Pass' ? 'Within clinical acceptance tolerances.' : `Investigate: pass rate ${gammaVal}% below optimal 95% threshold.`;

      const sessRes = insertSession.run(
        qatrackId,
        unit.id,
        unit.name,
        testList,
        dateStr,
        physicist,
        status,
        comments
      );
      const sessId = sessRes.lastInsertRowid;
      sessionCount++;

      // Insert values for this session
      const valsToInsert = [
        { name: 'Overall Gamma (%)', slug: 'overall-gamma', str: String(gammaVal), num: gammaVal, unit: '%' },
        { name: 'Gamma Pass Rate (3%/3mm)', slug: 'gamma-3-3', str: String(gammaVal), num: gammaVal, unit: '%' },
        { name: 'Median Dose Deviation (%)', slug: 'median-dose-dev', str: String(doseDevVal), num: doseDevVal, unit: '%' },
        { name: 'Temperature', slug: 'temperature', str: String(tempVal), num: tempVal, unit: '°C' },
        { name: 'Pressure', slug: 'pressure', str: String(pressVal), num: pressVal, unit: 'kPa' },
        { name: 'Output Factor', slug: 'output-factor', str: String(outputVal), num: outputVal, unit: 'cGy/MU' },
        { name: 'Site', slug: 'site', str: site, num: null, unit: '' },
        { name: 'Beam Energy', slug: 'beam-energy', str: energy, num: null, unit: '' },
        { name: 'Delivery Technique', slug: 'delivery-technique', str: tech, num: null, unit: '' },
        { name: 'Patient ID', slug: 'patient-id', str: `QA-${1000 + Math.floor(random() * 899)}`, num: null, unit: '' }
      ];

      for (const v of valsToInsert) {
        insertVal.run(sessId, v.name, v.slug, v.str, v.num, v.unit, status === 'Pass' ? 'OK' : 'Review');
        valCount++;
      }
    }
  });

  tx();

  return {
    success: true,
    sessionsAdded: sessionCount,
    valuesAdded: valCount,
    unitsCount: unitsData.length,
    testListsCount: testListsData.length,
    message: `Seeded demo dataset: ${sessionCount} QA sessions, ${unitsData.length} Linacs, and ${testListsData.length} test collections.`
  };
}

// Allow direct execution: node server/scripts/demo_data.js
if (require.main === module) {
  const clear = process.argv.includes('--clear');
  console.log('Seeding QAdence demo dataset (clear = ' + clear + ')...');
  const res = seedDemoData(db, { clearExisting: clear });
  console.log(res.message);
}

module.exports = {
  seedDemoData
};
