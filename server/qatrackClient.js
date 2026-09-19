const http = require('http');
const https = require('https');
const axios = require('axios');
const db = require('./db');

class QATrackClient {
  constructor() {
    this.httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 30000, timeout: 120000 });
    this.httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, timeout: 120000 });
    this.cachedMetadata = null;
    this.reloadConfig();
    this.syncStatus = {
      isRunning: false,
      isCancelled: false,
      stage: 'Idle',
      syncedSessions: 0,
      totalMatchingInDb: null,
      totalAvailable: null,
      heapUsedMB: 0,
      rssMB: 0,
      durationMs: 0,
      startTime: null,
      error: null
    };
  }

  updateMemoryStats() {
    const mem = process.memoryUsage();
    this.syncStatus.heapUsedMB = Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10;
    this.syncStatus.rssMB = Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
    if (this.syncStatus.startTime) {
      this.syncStatus.durationMs = Date.now() - this.syncStatus.startTime;
    }
  }

  getSyncStatus() {
    this.updateMemoryStats();
    return { ...this.syncStatus };
  }

  cancelSync() {
    if (this.syncStatus.isRunning) {
      this.syncStatus.isCancelled = true;
      this.syncStatus.stage = 'Cancelling import (saving processed records)...';
      return { success: true, message: 'Sync cancellation requested.' };
    }
    return { success: false, message: 'No sync in progress.' };
  }

  reloadConfig() {
    const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
    const urlRow = getSetting.get('qatrack_url');
    const tokenRow = getSetting.get('qatrack_token');
    const authTypeRow = getSetting.get('qatrack_auth_type');

    this.baseUrl = (urlRow ? urlRow.value : process.env.QATRACK_URL || 'http://localhost:8000').replace(/\/+$/, '');
    this.token = tokenRow ? tokenRow.value : process.env.QATRACK_TOKEN || '';
    this.authType = authTypeRow ? authTypeRow.value : process.env.QATRACK_AUTH_TYPE || 'Api-Key';
  }

  saveConfig(url, token, authType = 'Api-Key') {
    const upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    upsert.run('qatrack_url', url.replace(/\/+$/, ''));
    upsert.run('qatrack_token', token);
    upsert.run('qatrack_auth_type', authType);
    this.reloadConfig();
    return { success: true };
  }

  getConfig() {
    this.reloadConfig();
    return {
      baseUrl: this.baseUrl,
      token: this.token,
      hasToken: !!this.token,
      authType: this.authType
    };
  }

  getHeaders() {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.token) {
      if (this.authType === 'Api-Key') {
        headers['Authorization'] = `Api-Key ${this.token}`;
      } else if (this.authType === 'Token') {
        headers['Authorization'] = `Token ${this.token}`;
      } else if (this.authType === 'Bearer') {
        headers['Authorization'] = `Bearer ${this.token}`;
      } else {
        headers['Authorization'] = `${this.authType} ${this.token}`;
      }
    }
    return headers;
  }

  async testConnection() {
    this.reloadConfig();
    if (!this.baseUrl) {
      return { success: false, message: 'QATrack+ Base URL is not configured.' };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/api/`, {
        headers: this.getHeaders(),
        timeout: 8000
      });

      return {
        success: true,
        message: 'Successfully connected to QATrack+ API!',
        status: response.status,
        data: response.data
      };
    } catch (err) {
      return {
        success: false,
        message: err.response
          ? `QATrack+ API returned HTTP ${err.response.status}: ${err.response.statusText}`
          : `Network error connecting to ${this.baseUrl}: ${err.message}`,
        details: err.response?.data || err.message
      };
    }
  }

  async fetchAllPages(endpointUrl, params = {}, onPage = null) {
    let url = endpointUrl.startsWith('http') ? endpointUrl : `${this.baseUrl}${endpointUrl.startsWith('/') ? '' : '/'}${endpointUrl}`;
    let allResults = [];
    let page = 1;
    let hasNext = true;

    // Safety ceiling increased to 10,000 pages (~100,000 records) to prevent infinite loops
    while (hasNext && page <= 10000) {
      if (this.syncStatus.isCancelled) {
        break;
      }

      let resp = null;
      let retries = 3;
      let lastError = null;

      while (retries > 0) {
        if (this.syncStatus.isCancelled) break;
        try {
          resp = await axios.get(url, {
            headers: this.getHeaders(),
            params: url.includes('?') ? undefined : { ...params, page },
            timeout: 120000,
            httpAgent: this.httpAgent,
            httpsAgent: this.httpsAgent
          });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          retries--;
          const isSocketOrTimeout = err.code === 'ECONNABORTED' ||
                                    err.code === 'ETIMEDOUT' ||
                                    err.code === 'ECONNRESET' ||
                                    err.code === 'EAI_AGAIN' ||
                                    (err.message && err.message.toLowerCase().includes('timeout')) ||
                                    (err.message && err.message.toLowerCase().includes('socket')) ||
                                    (err.response && [502, 503, 504].includes(err.response.status));

          if (retries > 0 && isSocketOrTimeout && !this.syncStatus.isCancelled) {
            const delaySec = (4 - retries) * 2;
            this.syncStatus.stage = `Network/socket timeout on page ${page}. Retrying in ${delaySec}s (attempt ${4 - retries}/3)...`;
            this.updateMemoryStats();
            await new Promise(r => setTimeout(r, delaySec * 1000));
          } else {
            throw lastError;
          }
        }
      }

      if (!resp) {
        if (this.syncStatus.isCancelled) break;
        if (lastError) throw lastError;
        break;
      }

      const data = resp.data;
      let pageItems = [];

      if (Array.isArray(data)) {
        pageItems = data;
        hasNext = false;
      } else if (data && data.results && Array.isArray(data.results)) {
        pageItems = data.results;
        if (data.count !== undefined && this.syncStatus.totalAvailable === null) {
          this.syncStatus.totalAvailable = data.count;
        }
        if (data.next) {
          url = data.next;
          page++;
        } else {
          hasNext = false;
        }
      } else if (data) {
        pageItems = [data];
        hasNext = false;
      } else {
        hasNext = false;
      }

      if (onPage) {
        await onPage(pageItems, data);
      } else {
        allResults = allResults.concat(pageItems);
      }

      this.updateMemoryStats();
    }

    return allResults;
  }

  extractIdFromUrl(url) {
    if (!url) return null;
    const match = String(url).match(/\/(\d+)\/?$/);
    return match ? parseInt(match[1], 10) : null;
  }

  async discoverEndpoints() {
    let rootData = {};
    try {
      const rootRes = await axios.get(`${this.baseUrl}/api/`, { headers: this.getHeaders(), timeout: 8000 });
      rootData = rootRes.data || {};
    } catch (e) {
      console.warn('Failed to fetch /api/ root:', e.message);
    }

    // Determine QC / QA root
    let qcRootUrl = rootData.qc || rootData.qa || `${this.baseUrl}/api/qc`;
    let qcEndpoints = {};
    try {
      const qcRes = await axios.get(qcRootUrl, { headers: this.getHeaders(), timeout: 8000 });
      qcEndpoints = qcRes.data || {};
    } catch (e) {
      qcEndpoints = {};
    }

    // Determine Units root
    let unitsRootUrl = rootData.units || `${this.baseUrl}/api/units`;
    let unitsEndpoints = {};
    try {
      const unitsRes = await axios.get(unitsRootUrl, { headers: this.getHeaders(), timeout: 8000 });
      unitsEndpoints = unitsRes.data || {};
    } catch (e) {
      unitsEndpoints = {};
    }

    let resolvedUnitsUrl = `${this.baseUrl}/api/units/units/`;
    if (Array.isArray(unitsEndpoints) || (unitsEndpoints && Array.isArray(unitsEndpoints.results))) {
      resolvedUnitsUrl = unitsRootUrl;
    } else if (unitsEndpoints && unitsEndpoints.units) {
      resolvedUnitsUrl = unitsEndpoints.units;
    }

    return {
      unitsUrl: resolvedUnitsUrl,
      unitClassesUrl: unitsEndpoints.unitclasses || `${this.baseUrl}/api/units/unitclasses/`,
      unitTypesUrl: unitsEndpoints.unittypes || `${this.baseUrl}/api/units/unittypes/`,
      testListsUrl: qcEndpoints.testlists || qcEndpoints['test-lists'] || `${this.baseUrl}/api/qc/testlists/`,
      testsUrl: qcEndpoints.tests || `${this.baseUrl}/api/qc/tests/`,
      unitTestInfosUrl: qcEndpoints.unittestinfos || qcEndpoints['unit-test-infos'] || `${this.baseUrl}/api/qc/unittestinfos/`,
      unitTestCollectionsUrl: qcEndpoints.unittestcollections || qcEndpoints['unit-test-collections'] || `${this.baseUrl}/api/qc/unittestcollections/`,
      testListInstancesUrl: qcEndpoints.testlistinstances || qcEndpoints['test-list-instances'] || `${this.baseUrl}/api/qc/testlistinstances/`
    };
  }

  async fetchMetadata(endpoints, clearExisting = false) {
    if (clearExisting) {
      this.syncStatus.stage = 'Clearing existing database records...';
      db.exec(`
        DELETE FROM test_values;
        DELETE FROM sessions;
        DELETE FROM test_definitions;
        DELETE FROM test_lists;
        DELETE FROM units;
        DELETE FROM unit_test_collections;
      `);
    } else {
      // Clear stale metadata discovery tables so mock/unused definitions never linger
      db.exec(`
        DELETE FROM test_definitions;
        DELETE FROM unit_test_collections;
      `);
    }

    // 1. Fetch Unit Classes & Unit Types
    this.syncStatus.stage = 'Fetching Unit Classes & Types...';
    this.updateMemoryStats();

    let unitClasses = [];
    try {
      unitClasses = await this.fetchAllPages(endpoints.unitClassesUrl);
    } catch (e) {
      console.warn('Could not fetch unit classes:', e.message);
    }
    const unitClassMap = new Map();
    for (const uc of unitClasses) {
      const id = uc.id || this.extractIdFromUrl(uc.url);
      if (id) unitClassMap.set(id, uc.name);
      if (uc.url) unitClassMap.set(uc.url, uc.name);
    }

    let unitTypes = [];
    try {
      unitTypes = await this.fetchAllPages(endpoints.unitTypesUrl);
    } catch (e) {
      console.warn('Could not fetch unit types:', e.message);
    }
    const unitTypeMap = new Map();
    for (const ut of unitTypes) {
      const id = ut.id || this.extractIdFromUrl(ut.url);
      const className = unitClassMap.get(ut.unit_class) || (ut.unit_class && unitClassMap.get(this.extractIdFromUrl(ut.unit_class))) || 'General QA';
      const typeInfo = { name: ut.name, className };
      if (id) unitTypeMap.set(id, typeInfo);
      if (ut.url) unitTypeMap.set(ut.url, typeInfo);
    }

    // 2. Fetch Units with class & type mappings
    this.syncStatus.stage = 'Fetching Machine Units...';
    this.updateMemoryStats();

    let units = [];
    try {
      units = await this.fetchAllPages(endpoints.unitsUrl);
    } catch (e) {
      console.warn('Warning: Could not fetch units from primary URL:', e.message);
      try {
        const altUrl = endpoints.unitsUrl.endsWith('/units/')
          ? endpoints.unitsUrl.replace(/\/units\/$/, '/')
          : `${endpoints.unitsUrl.replace(/\/$/, '')}/units/`;
        units = await this.fetchAllPages(altUrl);
      } catch (altErr) {
        console.warn('Warning: Could not fetch units from alternate URL:', altErr.message);
      }
    }

    const unitMap = new Map();
    const activeUnitIds = new Set();
    const activeUnitNames = new Set();
    const insertUnit = db.prepare(`
      INSERT OR REPLACE INTO units (id, name, unit_class, unit_type, serial_number, location, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const u of units) {
      const id = u.id || this.extractIdFromUrl(u.url);
      const name = u.name || u.unit_name || u.display_name;
      if (!name) continue;

      const typeInfo = unitTypeMap.get(u.type) || (u.type && unitTypeMap.get(this.extractIdFromUrl(u.type)));
      const rawClass = u.unit_class || u.class || (typeInfo?.className);
      const unitClass = rawClass || 'Linac';
      const unitType = typeInfo?.name || u.type_name || '';

      const isActive = (u.is_active !== undefined)
        ? (u.is_active ? 1 : 0)
        : (u.active !== undefined ? (u.active ? 1 : 0) : 1);

      insertUnit.run(
        id,
        name,
        unitClass,
        unitType,
        u.serial_number || '',
        u.location || '',
        isActive
      );

      // Only track ACTIVE units in memory maps for active session querying
      if (isActive) {
        if (id) {
          activeUnitIds.add(id);
          activeUnitIds.add(String(id));
          unitMap.set(id, name);
          unitMap.set(String(id), name);
        }
        if (u.url) {
          activeUnitIds.add(u.url);
          unitMap.set(u.url, name);
        }
        activeUnitNames.add(name.toLowerCase().trim());
      }
    }

    // 3. Test Definitions
    this.syncStatus.stage = 'Fetching QA Test Definitions...';
    this.updateMemoryStats();

    let tests = [];
    try {
      tests = await this.fetchAllPages(endpoints.testsUrl);
    } catch (e) {
      console.warn('Warning: Could not fetch tests definition:', e.message);
    }

    const testDefMap = new Map();
    for (const t of tests) {
      const id = t.id || this.extractIdFromUrl(t.url);
      const testName = t.display_name || t.name;
      const testInfo = {
        name: testName,
        slug: t.slug || '',
        type: t.type || 'simple',
        unit: t.unit || ''
      };
      if (id) testDefMap.set(id, testInfo);
      if (t.url) testDefMap.set(t.url, testInfo);
    }

    // 4. Unit Test Infos (filter out non-active units & non-active mappings)
    this.syncStatus.stage = 'Fetching Unit Test Mappings...';
    this.updateMemoryStats();

    let unitTestInfos = [];
    try {
      unitTestInfos = await this.fetchAllPages(endpoints.unitTestInfosUrl);
    } catch (e) {
      console.warn('Warning: Could not fetch unit test infos:', e.message);
    }

    const utiMap = new Map();
    for (const uti of unitTestInfos) {
      const isUtiActive = (uti.is_active !== undefined) ? Boolean(uti.is_active) : ((uti.active !== undefined) ? Boolean(uti.active) : true);
      const utiUnitId = uti.unit ? (typeof uti.unit === 'number' ? uti.unit : this.extractIdFromUrl(uti.unit)) : null;
      if (!isUtiActive || (utiUnitId && !activeUnitIds.has(utiUnitId))) {
        continue; // Skip non-active unit test infos
      }

      const id = uti.id || this.extractIdFromUrl(uti.url);
      const testDef = testDefMap.get(uti.test) || (uti.test && testDefMap.get(this.extractIdFromUrl(uti.test)));
      const utiInfo = {
        unitUrl: uti.unit,
        testName: testDef?.name || 'Unknown Test',
        testSlug: testDef?.slug || '',
        unit: testDef?.unit || '',
        type: testDef?.type || 'simple'
      };
      if (id) utiMap.set(id, utiInfo);
      if (uti.url) utiMap.set(uti.url, utiInfo);
    }

    // 5. Unit Test Collections (filter out non-active assignments)
    this.syncStatus.stage = 'Fetching Unit Test Collections...';
    this.updateMemoryStats();

    let collections = [];
    try {
      collections = await this.fetchAllPages(endpoints.unitTestCollectionsUrl);
    } catch (e) {
      console.warn('Warning: Could not fetch unit test collections:', e.message);
    }

    const utcMap = new Map();
    const insertUtc = db.prepare(`
      INSERT OR REPLACE INTO unit_test_collections (id, unit_id, unit_name, test_list_id, test_list_name, collection_name, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const activeAssignedTestListIds = new Set();
    const activeAssignedTestListNames = new Set();

    for (const c of collections) {
      const id = c.id || this.extractIdFromUrl(c.url);
      const rawUnit = c.unit;
      const uId = typeof rawUnit === 'number' ? rawUnit : (this.extractIdFromUrl(rawUnit) || (typeof rawUnit === 'string' && /^\d+$/.test(rawUnit) ? parseInt(rawUnit, 10) : null));
      const unitName = (uId && (unitMap.get(uId) || unitMap.get(String(uId)))) ||
                       (rawUnit && unitMap.get(rawUnit)) ||
                       c.unit_name || '';

      const rawTl = c.tests_object || c.test_list || c.testlist || c.tests;
      const tlId = typeof rawTl === 'number' ? rawTl : (this.extractIdFromUrl(rawTl) || (typeof rawTl === 'string' && /^\d+$/.test(rawTl) ? parseInt(rawTl, 10) : null));
      const testListName = (tlId && (typeof tlId === 'number' ? String(tlId) : '')) ||
                           c.name || 'Unknown Test List';

      // Check whether assignment is active AND assigned unit is active
      const isUtcActive = (c.active !== undefined) ? Boolean(c.active) : ((c.is_active !== undefined) ? Boolean(c.is_active) : true);
      const isUnitActive = (uId && activeUnitIds.has(uId)) || (rawUnit && activeUnitIds.has(rawUnit)) || (unitName && activeUnitNames.has(unitName.toLowerCase().trim()));
      const isAssignmentActive = (isUtcActive && isUnitActive) ? 1 : 0;

      if (id) {
        try {
          insertUtc.run(id, uId, unitName, tlId, testListName, c.name || '', isAssignmentActive);
        } catch (_) {}
      }

      // If assignment is non-active, strictly do NOT retrieve it into memory active map
      if (!isAssignmentActive) {
        continue;
      }

      if (tlId) activeAssignedTestListIds.add(tlId);
      if (testListName) activeAssignedTestListNames.add(testListName.toLowerCase().trim());

      const colInfo = { unitName, testListName, unitId: uId, testListId: tlId, active: true };
      if (id) {
        utcMap.set(id, colInfo);
        utcMap.set(String(id), colInfo);
      }
      if (c.url) utcMap.set(c.url, colInfo);
    }

    // 6. Test Lists (filter out test lists with no data and no active assignments)
    this.syncStatus.stage = 'Fetching QA Test Lists...';
    this.updateMemoryStats();

    let testLists = [];
    try {
      testLists = await this.fetchAllPages(endpoints.testListsUrl);
    } catch (e) {
      console.warn('Warning: Could not fetch test lists:', e.message);
    }

    const testListMap = new Map();
    const insertTestList = db.prepare(`
      INSERT OR REPLACE INTO test_lists (id, name, slug, description)
      VALUES (?, ?, ?, ?)
    `);

    // Check what test lists have data in existing sessions
    const existingSessionLists = new Set(
      db.prepare("SELECT DISTINCT test_list_name FROM sessions WHERE test_list_name IS NOT NULL AND test_list_name != ''").all()
        .map(r => r.test_list_name.toLowerCase().trim())
    );

    for (const tl of testLists) {
      const id = tl.id || this.extractIdFromUrl(tl.url);
      const name = tl.name;
      const nameLower = (name || '').toLowerCase().trim();
      const hasActiveAssignment = (id && activeAssignedTestListIds.has(id)) || activeAssignedTestListNames.has(nameLower);
      const hasDataInSessions = existingSessionLists.has(nameLower);

      // Do NOT retrieve test lists with no data / no active assignments!
      if (!hasActiveAssignment && !hasDataInSessions) {
        continue;
      }

      insertTestList.run(id, name, tl.slug || '', tl.description || '');
      if (id) {
        testListMap.set(id, name);
        testListMap.set(String(id), name);
      }
      if (tl.url) testListMap.set(tl.url, name);
    }

    // Update test_list_name in utcMap and insertUtc where resolved from testListMap
    for (const [colId, colInfo] of utcMap.entries()) {
      if (colInfo.testListId && testListMap.has(colInfo.testListId)) {
        colInfo.testListName = testListMap.get(colInfo.testListId);
        try {
          db.prepare('UPDATE unit_test_collections SET test_list_name = ? WHERE id = ?').run(colInfo.testListName, colId);
        } catch (_) {}
      }
    }

    // Populate test_definitions in database ONLY from active collections
    const insertTestDef = db.prepare(`
      INSERT OR REPLACE INTO test_definitions (name, slug, test_list_name, unit, data_type, is_numeric)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const isNumericType = (tType) => {
      const t = (tType || 'simple').toLowerCase();
      return (t === 'simple' || t === 'numerical' || t === 'composite' || t === 'calculation') ? 1 : 0;
    };

    // Populate only from ACTIVE unit test collections
    for (const c of collections) {
      const id = c.id || this.extractIdFromUrl(c.url);
      const colInfo = utcMap.get(id) || (id && utcMap.get(String(id)));
      if (!colInfo) continue; // Skip non-active assignments!

      const testListName = colInfo.testListName || testListMap.get(c.tests_object) || c.name;
      if (!testListName) continue;

      if (Array.isArray(c.tests)) {
        for (const utiRef of c.tests) {
          const uti = utiMap.get(utiRef) || (typeof utiRef === 'string' && utiMap.get(this.extractIdFromUrl(utiRef)));
          if (uti && uti.testName) {
            insertTestDef.run(uti.testName, uti.testSlug, testListName, uti.unit || '', uti.type, isNumericType(uti.type));
          }
        }
      }
    }

    // Also populate from test lists directly IF they have active assignments or data
    for (const tl of testLists) {
      const id = tl.id || this.extractIdFromUrl(tl.url);
      if (!testListMap.has(id)) continue; // Skip test lists with no data!

      if (Array.isArray(tl.tests)) {
        for (const tRef of tl.tests) {
          const t = testDefMap.get(tRef) || (typeof tRef === 'string' && testDefMap.get(this.extractIdFromUrl(tRef)));
          if (t && t.name) {
            insertTestDef.run(t.name, t.slug, tl.name, t.unit || '', t.type, isNumericType(t.type));
          }
        }
      }
    }

    return { unitClassMap, unitTypeMap, unitMap, testListMap, testDefMap, utiMap, utcMap };
  }

  async syncMetadata(options = {}) {
    this.reloadConfig();
    const startTime = Date.now();
    this.syncStatus = {
      isRunning: true,
      isCancelled: false,
      stage: 'Connecting to QATrack+ for metadata discovery...',
      syncedSessions: 0,
      totalAvailable: null,
      heapUsedMB: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10,
      rssMB: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
      durationMs: 0,
      startTime: startTime,
      error: null
    };

    try {
      const endpoints = await this.discoverEndpoints();
      const meta = await this.fetchMetadata(endpoints, options.clearExisting);
      this.cachedMetadata = meta;
      this.syncStatus.stage = 'Metadata sync completed successfully.';

      return {
        success: true,
        mode: 'metadata',
        unitsCount: meta.unitMap.size,
        testListsCount: meta.testListMap.size,
        testsCount: meta.testDefMap.size,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      this.syncStatus.error = err.message;
      this.syncStatus.stage = `Metadata sync failed: ${err.message}`;
      throw err;
    } finally {
      this.syncStatus.isRunning = false;
      this.updateMemoryStats();
    }
  }

  async syncOnDemand(options = {}) {
    this.reloadConfig();
    const startTime = Date.now();
    const { testListName, testListNames, unitName, unitNames, dateFrom, dateTo, limit = 5000 } = options;
    const targetLists = (Array.isArray(testListNames) ? testListNames : (testListName ? [testListName] : [])).filter(Boolean);
    const targetUnits = (Array.isArray(unitNames) ? unitNames : (unitName ? [unitName] : [])).filter(Boolean);

    const listLabel = targetLists.length > 0 ? targetLists.join(', ') : (targetUnits.length > 0 ? targetUnits.join(', ') : 'requested parameters');

    this.syncStatus = {
      isRunning: true,
      isCancelled: false,
      stage: `On-demand import for: ${listLabel}...`,
      syncedSessions: 0,
      totalAvailable: null,
      heapUsedMB: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10,
      rssMB: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
      durationMs: 0,
      startTime: startTime,
      error: null
    };

    try {
      const endpoints = await this.discoverEndpoints();

      let unitMap = new Map();
      let testListMap = new Map();
      let utiMap = new Map();
      let utcMap = new Map();

      if (this.cachedMetadata) {
        unitMap = this.cachedMetadata.unitMap;
        testListMap = this.cachedMetadata.testListMap;
        utiMap = this.cachedMetadata.utiMap;
        utcMap = this.cachedMetadata.utcMap;
      } else {
        const dbUnits = db.prepare('SELECT id, name FROM units WHERE active = 1').all();
        const dbLists = db.prepare('SELECT id, name FROM test_lists').all();
        let dbUtcs = [];
        try {
          dbUtcs = db.prepare(`
            SELECT id, unit_name, test_list_name, unit_id, test_list_id
            FROM unit_test_collections
            WHERE active = 1 AND unit_name IN (SELECT name FROM units WHERE active = 1)
          `).all();
        } catch (_) {}

        for (const u of dbUnits) {
          unitMap.set(u.id, u.name);
          unitMap.set(String(u.id), u.name);
        }
        for (const l of dbLists) {
          testListMap.set(l.id, l.name);
          testListMap.set(String(l.id), l.name);
        }
        for (const c of dbUtcs) {
          const colInfo = { unitName: c.unit_name, testListName: c.test_list_name, unitId: c.unit_id, testListId: c.test_list_id };
          utcMap.set(c.id, colInfo);
          utcMap.set(String(c.id), colInfo);
        }

        // If local metadata is missing units, test lists, or collections, do a metadata fetch once
        if (dbUnits.length === 0 || dbLists.length === 0 || dbUtcs.length === 0) {
          const meta = await this.fetchMetadata(endpoints, false);
          this.cachedMetadata = meta;
          unitMap = meta.unitMap;
          testListMap = meta.testListMap;
          utiMap = meta.utiMap;
          utcMap = meta.utcMap;
        } else {
          this.cachedMetadata = { unitMap, testListMap, utiMap, utcMap };
        }
      }

      const activeUnitRows = db.prepare('SELECT id, name FROM units WHERE active = 1').all();
      const activeUnitNames = new Set(activeUnitRows.map(u => u.name.toLowerCase().trim()));

      // Ingestion helpers
      const insertSession = db.prepare(`
        INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(qatrack_instance_id) DO UPDATE SET
          unit_name = excluded.unit_name,
          test_list_name = excluded.test_list_name,
          work_completed = excluded.work_completed,
          created_by = excluded.created_by,
          status = excluded.status,
          comments = excluded.comments
      `);
      const getSessionByQATrackId = db.prepare('SELECT id FROM sessions WHERE qatrack_instance_id = ?');
      const deleteOldValues = db.prepare('DELETE FROM test_values WHERE session_id = ?');
      const insertTestVal = db.prepare(`
        INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, tolerance_min, tolerance_max, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let syncedCount = 0;

      const processBatch = db.transaction((instBatch, directColInfo = null) => {
        for (const inst of instBatch) {
          const qatrackId = inst.id || this.extractIdFromUrl(inst.url);
          if (!qatrackId) continue;

          let uName = directColInfo?.unitName || 'Unknown Machine';
          let tListName = directColInfo?.testListName || 'Patient Specific QA';

          if (!directColInfo) {
            const utcId = inst.unit_test_collection !== undefined && inst.unit_test_collection !== null
              ? (typeof inst.unit_test_collection === 'number' ? inst.unit_test_collection : (this.extractIdFromUrl(inst.unit_test_collection) || inst.unit_test_collection))
              : null;
            const colInfo = utcMap.get(utcId) || (typeof utcId === 'number' && utcMap.get(String(utcId)));
            if (colInfo?.unitName) {
              uName = colInfo.unitName;
            } else if (unitMap.has(inst.unit)) {
              uName = unitMap.get(inst.unit);
            } else if (typeof inst.unit_name === 'string') {
              uName = inst.unit_name;
            }

            if (colInfo?.testListName) {
              tListName = colInfo.testListName;
            } else if (testListMap.get(inst.test_list)) {
              tListName = testListMap.get(inst.test_list);
            }

            // Filter by testListNames if specified
            if (targetLists.length > 0) {
              const matches = targetLists.some(tl => tl.toLowerCase().trim() === tListName.toLowerCase().trim()) ||
                (inst.test_list_name && targetLists.some(tl => tl.toLowerCase().trim() === inst.test_list_name.toLowerCase().trim()));
              if (!matches) continue;
            }

            // Filter by unitNames if specified
            if (targetUnits.length > 0) {
              const uMatch = targetUnits.some(un => un.toLowerCase().trim() === uName.toLowerCase().trim());
              if (!uMatch) continue;
            }
          }

          // Do NOT retrieve or ingest sessions for non-active units!
          if (!activeUnitNames.has(uName.toLowerCase().trim())) {
            continue;
          }

          const dateStr = (inst.work_completed || inst.work_started || inst.created || new Date().toISOString())
            .replace('T', ' ')
            .substring(0, 19);

          // Filter by date range if specified
          if (dateFrom && dateStr.substring(0, 10) < dateFrom) continue;
          if (dateTo && dateStr.substring(0, 10) > dateTo) continue;

          const createdBy = (typeof inst.created_by === 'string' && inst.created_by.includes('/'))
            ? 'Physicist'
            : (inst.created_by_name || (typeof inst.created_by === 'object' ? inst.created_by.username : inst.created_by) || 'User');

          insertSession.run(
            qatrackId,
            null,
            uName,
            tListName,
            dateStr,
            createdBy,
            inst.all_reviewed ? 'Reviewed' : (inst.in_progress ? 'In Progress' : 'Completed'),
            inst.comments && inst.comments.length > 0 ? JSON.stringify(inst.comments) : ''
          );

          const sess = getSessionByQATrackId.get(qatrackId);
          if (sess && Array.isArray(inst.test_instances)) {
            deleteOldValues.run(sess.id);

            for (const ti of inst.test_instances) {
              const utiInfo = utiMap.get(ti.unit_test_info) || (ti.unit_test_info && utiMap.get(this.extractIdFromUrl(ti.unit_test_info)));
              const testName = utiInfo?.testName || ti.name || ti.test_name || 'Test';
              const testSlug = utiInfo?.testSlug || ti.slug || ti.test_slug || '';

              let numVal = null;
              let strVal = '';

              if (typeof ti.value === 'number') {
                numVal = ti.value;
                strVal = String(ti.value);
              } else if (ti.value !== null && ti.value !== undefined && ti.value !== '') {
                const parsed = parseFloat(ti.value);
                if (!isNaN(parsed)) numVal = parsed;
                strVal = String(ti.value);
              }

              if (ti.string_value) {
                strVal = ti.string_value;
                if (numVal === null) {
                  const parsed = parseFloat(ti.string_value);
                  if (!isNaN(parsed)) numVal = parsed;
                }
              } else if (ti.date_value) {
                strVal = ti.date_value;
              }

              insertTestVal.run(
                sess.id,
                testName,
                testSlug,
                strVal,
                numVal,
                utiInfo?.unit || ti.unit || '',
                null,
                null,
                ti.pass_fail || 'OK'
              );
            }
          }
          syncedCount++;
        }
      });

      // Resolve targetLists from yVariable if targetLists was not provided
      if (targetLists.length === 0 && options.yVariable) {
        try {
          const defRows = db.prepare('SELECT DISTINCT test_list_name FROM test_definitions WHERE name = ?').all(options.yVariable);
          const resolvedLists = defRows.map(r => r.test_list_name).filter(l => l && l !== 'General QA');
          if (resolvedLists.length > 0) {
            targetLists.push(...resolvedLists);
          }
        } catch (_) {}
      }

      // Filter targetUnits so it strictly targets active machines (never inactive units!)
      let effectiveTargetUnits = targetUnits.filter(u => activeUnitNames.has(u.toLowerCase().trim()));
      if (effectiveTargetUnits.length === 0 && targetUnits.length === 0) {
        effectiveTargetUnits = activeUnitRows.map(u => u.name);
      }
      const targetUnitsLower = effectiveTargetUnits.map(u => u.toLowerCase().trim());

      // Filter targetLists: exclude test lists that have no data and no active assignments
      const availableLists = db.prepare(`
        SELECT DISTINCT test_list_name FROM unit_test_collections WHERE active = 1 AND unit_name IN (SELECT name FROM units WHERE active = 1)
        UNION
        SELECT DISTINCT test_list_name FROM sessions WHERE test_list_name IS NOT NULL
      `).all().map(r => r.test_list_name.toLowerCase().trim());

      const effectiveTargetLists = targetLists.filter(l => availableLists.includes(l.toLowerCase().trim()));
      const targetListsLower = effectiveTargetLists.map(l => l.toLowerCase().trim());

      // Find matching collection IDs from utcMap if targetLists or targetUnits specified
      const matchingCollectionIds = [];
      const seenColIds = new Set();
      for (const [key, col] of utcMap.entries()) {
        const numId = typeof key === 'number' ? key : (typeof key === 'string' && !key.startsWith('http') && /^\d+$/.test(key) ? parseInt(key, 10) : null);
        if (numId !== null && !seenColIds.has(numId) && col) {
          const colListNameLower = (col.testListName || '').toLowerCase().trim();
          const colUnitNameLower = (col.unitName || '').toLowerCase().trim();
          const listMatch = targetListsLower.length === 0 || targetListsLower.includes(colListNameLower);
          const unitMatch = targetUnitsLower.length === 0 || targetUnitsLower.includes(colUnitNameLower);
          if (listMatch && unitMatch) {
            seenColIds.add(numId);
            matchingCollectionIds.push(numId);
          }
        }
      }

      if (matchingCollectionIds.length > 0) {
        this.syncStatus.totalCollections = matchingCollectionIds.length;
        let colIdx = 0;
        for (const colId of matchingCollectionIds) {
          if (this.syncStatus.isCancelled) break;
          colIdx++;
          const colInfo = utcMap.get(colId);
          const colLabel = colInfo ? `${colInfo.unitName} (${colInfo.testListName})` : `Collection #${colId}`;
          this.syncStatus.currentCollection = colLabel;
          this.syncStatus.currentCollectionIdx = colIdx;
          this.syncStatus.currentCollectionSynced = 0;
          this.syncStatus.currentCollectionTotal = null;
          this.syncStatus.stage = `[${colIdx}/${matchingCollectionIds.length}] Querying ${colLabel}...`;
          this.updateMemoryStats();

          const queryParams = {
            unit_test_collection: colId,
            ordering: '-work_completed'
          };
          if (dateFrom) queryParams.work_completed__gte = dateFrom;
          if (dateTo) queryParams.work_completed__lte = dateTo;

          let colSynced = 0;
          try {
            await this.fetchAllPages(endpoints.testListInstancesUrl, queryParams, async (pageBatch, rawData) => {
              if (pageBatch && pageBatch.length > 0) {
                processBatch(pageBatch, colInfo);
                colSynced += pageBatch.length;
                this.syncStatus.syncedSessions = syncedCount;
                this.syncStatus.currentCollectionSynced = colSynced;
                this.syncStatus.currentCollectionTotal = rawData?.count || colSynced;
                this.syncStatus.stage = `[${colIdx}/${matchingCollectionIds.length}] ${colLabel}: retrieved ${colSynced} of ${rawData?.count || colSynced} records (${syncedCount} total)...`;
                this.updateMemoryStats();
                if (limit && syncedCount >= limit) {
                  this.syncStatus.isCancelled = true;
                }
              }
            });
          } catch (colErr) {
            console.warn(`Could not query collection ${colId}:`, colErr.message);
          }

          if (limit && syncedCount >= limit) break;
        }
      } else {
        // Fallback when no collections matched directly in utcMap
        // Attempt to find test list IDs or unit IDs directly
        let targetTestListIds = [];
        if (targetListsLower.length > 0) {
          for (const [tlId, tlName] of testListMap.entries()) {
            const numTlId = typeof tlId === 'number' ? tlId : (typeof tlId === 'string' && /^\d+$/.test(tlId) ? parseInt(tlId, 10) : null);
            if (numTlId !== null && targetListsLower.includes((tlName || '').toLowerCase().trim())) {
              if (!targetTestListIds.includes(numTlId)) targetTestListIds.push(numTlId);
            }
          }
        }

        let targetUnitIds = [];
        if (targetUnitsLower.length > 0) {
          for (const [uId, uName] of unitMap.entries()) {
            const numUId = typeof uId === 'number' ? uId : (typeof uId === 'string' && /^\d+$/.test(uId) ? parseInt(uId, 10) : null);
            if (numUId !== null && targetUnitsLower.includes((uName || '').toLowerCase().trim())) {
              if (!targetUnitIds.includes(numUId)) targetUnitIds.push(numUId);
            }
          }
        }

        const queryTargets = [];
        if (targetTestListIds.length > 0 && targetUnitIds.length > 0) {
          for (const tlId of targetTestListIds) {
            for (const uId of targetUnitIds) {
              queryTargets.push({ test_list: tlId, unit: uId });
            }
          }
        } else if (targetTestListIds.length > 0) {
          for (const tlId of targetTestListIds) {
            queryTargets.push({ test_list: tlId });
          }
        } else if (targetUnitIds.length > 0) {
          for (const uId of targetUnitIds) {
            queryTargets.push({ unit: uId });
          }
        } else {
          queryTargets.push({});
        }

        this.syncStatus.totalCollections = queryTargets.length;
        let qIdx = 0;
        for (const qt of queryTargets) {
          if (this.syncStatus.isCancelled) break;
          qIdx++;
          const queryParams = {
            ...qt,
            ordering: '-work_completed'
          };
          if (dateFrom) queryParams.work_completed__gte = dateFrom;
          if (dateTo) queryParams.work_completed__lte = dateTo;

          const targetLabel = qt.test_list
            ? `${testListMap.get(qt.test_list) || 'List #' + qt.test_list}${qt.unit ? ' on ' + (unitMap.get(qt.unit) || 'Unit #' + qt.unit) : ''}`
            : listLabel;

          this.syncStatus.currentCollection = targetLabel;
          this.syncStatus.currentCollectionIdx = qIdx;
          this.syncStatus.currentCollectionSynced = 0;
          this.syncStatus.currentCollectionTotal = null;
          this.syncStatus.stage = `[${qIdx}/${queryTargets.length}] Querying QATrack+ for ${targetLabel}...`;
          this.updateMemoryStats();

          let targetSynced = 0;
          try {
            await this.fetchAllPages(endpoints.testListInstancesUrl, queryParams, async (pageBatch, rawData) => {
              if (pageBatch && pageBatch.length > 0) {
                const fallbackInfo = {
                  unitName: (qt.unit ? unitMap.get(qt.unit) : null) || (targetUnits[0] || 'Unknown Machine'),
                  testListName: (qt.test_list ? testListMap.get(qt.test_list) : null) || (targetLists[0] || 'Patient Specific QA')
                };
                processBatch(pageBatch, fallbackInfo);
                targetSynced += pageBatch.length;
                this.syncStatus.syncedSessions = syncedCount;
                this.syncStatus.currentCollectionSynced = targetSynced;
                this.syncStatus.currentCollectionTotal = rawData?.count || targetSynced;
                this.syncStatus.stage = `[${qIdx}/${queryTargets.length}] ${targetLabel}: retrieved ${targetSynced} of ${rawData?.count || targetSynced} records (${syncedCount} total)...`;
                this.updateMemoryStats();
                if (limit && syncedCount >= limit) {
                  this.syncStatus.isCancelled = true;
                }
              }
            });
          } catch (qErr) {
            console.warn('Could not query target:', qt, qErr.message);
          }

          if (limit && syncedCount >= limit) break;
        }
      }

      let totalMatchingInDb = 0;
      try {
        let countSql = 'SELECT COUNT(*) as count FROM sessions WHERE 1=1';
        const countParams = [];
        if (targetListsLower.length > 0) {
          countSql += ` AND LOWER(test_list_name) IN (${targetListsLower.map(() => '?').join(',')})`;
          countParams.push(...targetListsLower);
        }
        if (targetUnitsLower.length > 0) {
          countSql += ` AND LOWER(unit_name) IN (${targetUnitsLower.map(() => '?').join(',')})`;
          countParams.push(...targetUnitsLower);
        }
        if (dateFrom) {
          countSql += ' AND work_completed >= ?';
          countParams.push(dateFrom);
        }
        if (dateTo) {
          countSql += ' AND work_completed <= ?';
          countParams.push(dateTo);
        }
        const countRow = db.prepare(countSql).get(...countParams);
        totalMatchingInDb = countRow ? countRow.count : 0;
      } catch (_) {}

      this.syncStatus.syncedSessions = syncedCount;
      this.syncStatus.totalMatchingInDb = totalMatchingInDb;

      if (syncedCount > 0) {
        this.syncStatus.stage = `Import complete: ${syncedCount} records retrieved from QATrack+ (${totalMatchingInDb} total in database).`;
      } else if (totalMatchingInDb > 0) {
        this.syncStatus.stage = `Data is up to date (${totalMatchingInDb} matching records available in database).`;
      } else {
        this.syncStatus.stage = `Import complete: 0 records found matching selected criteria.`;
      }

      return {
        success: true,
        mode: 'ondemand',
        testListNames: targetLists,
        syncedSessions: syncedCount,
        totalMatchingInDb: totalMatchingInDb,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      this.syncStatus.error = err.message;
      this.syncStatus.stage = `On-demand sync failed: ${err.message}`;
      throw err;
    } finally {
      this.syncStatus.isRunning = false;
      this.updateMemoryStats();
    }
  }

  async syncFromQATrack(options = {}) {
    if (options.mode === 'metadata' || options.metadataOnly) {
      return this.syncMetadata(options);
    }
    if (options.mode === 'ondemand') {
      return this.syncOnDemand(options);
    }

    this.reloadConfig();
    const startTime = Date.now();

    this.syncStatus = {
      isRunning: true,
      isCancelled: false,
      stage: 'Connecting to QATrack+ and discovering endpoints...',
      syncedSessions: 0,
      totalAvailable: null,
      heapUsedMB: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10,
      rssMB: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
      durationMs: 0,
      startTime: startTime,
      error: null
    };

    try {
      const endpoints = await this.discoverEndpoints();
      const meta = await this.fetchMetadata(endpoints, options.clearExisting);
      const { unitMap, testListMap, utiMap, utcMap } = meta;

      // 7. Test List Instances (Sessions) - Streaming page-by-page database insert
      const insertSession = db.prepare(`
        INSERT INTO sessions (qatrack_instance_id, unit_id, unit_name, test_list_name, work_completed, created_by, status, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(qatrack_instance_id) DO UPDATE SET
          unit_name = excluded.unit_name,
          test_list_name = excluded.test_list_name,
          work_completed = excluded.work_completed,
          created_by = excluded.created_by,
          status = excluded.status,
          comments = excluded.comments
      `);

      const getSessionByQATrackId = db.prepare('SELECT id FROM sessions WHERE qatrack_instance_id = ?');
      const deleteOldValues = db.prepare('DELETE FROM test_values WHERE session_id = ?');
      const insertTestVal = db.prepare(`
        INSERT INTO test_values (session_id, test_name, test_slug, value_string, value_numeric, unit, tolerance_min, tolerance_max, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let syncedCount = 0;
      const activeUnitsRows = db.prepare('SELECT id, name FROM units WHERE active = 1').all();
      const activeUnitNames = new Set(activeUnitsRows.map(u => u.name.toLowerCase().trim()));

      const processBatch = db.transaction((instBatch) => {
        for (const inst of instBatch) {
          const qatrackId = inst.id || this.extractIdFromUrl(inst.url);
          if (!qatrackId) continue;

          let unitName = 'Unknown Machine';
          const utcKey = inst.unit_test_collection !== undefined && inst.unit_test_collection !== null
            ? (typeof inst.unit_test_collection === 'number' ? inst.unit_test_collection : (this.extractIdFromUrl(inst.unit_test_collection) || inst.unit_test_collection))
            : null;
          const colInfo = utcKey ? (utcMap.get(utcKey) || (typeof utcKey === 'number' && utcMap.get(String(utcKey)))) : null;
          if (colInfo?.unitName) {
            unitName = colInfo.unitName;
          } else if (unitMap.has(inst.unit)) {
            unitName = unitMap.get(inst.unit);
          } else if (typeof inst.unit_name === 'string') {
            unitName = inst.unit_name;
          }

          // Do NOT retrieve or ingest non-active units!
          if (!activeUnitNames.has(unitName.toLowerCase().trim())) {
            continue;
          }

          // Do NOT retrieve or ingest non-active test list assignments!
          if (utcKey && !colInfo) {
            continue;
          }

          let testListName = colInfo?.testListName || testListMap.get(inst.test_list) || 'Patient Specific QA';
          const dateStr = (inst.work_completed || inst.work_started || inst.created || new Date().toISOString())
            .replace('T', ' ')
            .substring(0, 19);

          const createdBy = (typeof inst.created_by === 'string' && inst.created_by.includes('/'))
            ? 'Physicist'
            : (inst.created_by_name || (typeof inst.created_by === 'object' ? inst.created_by.username : inst.created_by) || 'User');

          insertSession.run(
            qatrackId,
            null,
            unitName,
            testListName,
            dateStr,
            createdBy,
            inst.all_reviewed ? 'Reviewed' : (inst.in_progress ? 'In Progress' : 'Completed'),
            inst.comments && inst.comments.length > 0 ? JSON.stringify(inst.comments) : ''
          );

          const sess = getSessionByQATrackId.get(qatrackId);
          if (sess && Array.isArray(inst.test_instances)) {
            deleteOldValues.run(sess.id);

            for (const ti of inst.test_instances) {
              const utiInfo = utiMap.get(ti.unit_test_info) || (ti.unit_test_info && utiMap.get(this.extractIdFromUrl(ti.unit_test_info)));
              const testName = utiInfo?.testName || ti.name || ti.test_name || 'Test';
              const testSlug = utiInfo?.testSlug || ti.slug || ti.test_slug || '';

              let numVal = null;
              let strVal = '';

              if (typeof ti.value === 'number') {
                numVal = ti.value;
                strVal = String(ti.value);
              } else if (ti.value !== null && ti.value !== undefined && ti.value !== '') {
                const parsed = parseFloat(ti.value);
                if (!isNaN(parsed)) numVal = parsed;
                strVal = String(ti.value);
              }

              if (ti.string_value) {
                strVal = ti.string_value;
                if (numVal === null) {
                  const parsed = parseFloat(ti.string_value);
                  if (!isNaN(parsed)) numVal = parsed;
                }
              } else if (ti.date_value) {
                strVal = ti.date_value;
              }

              insertTestVal.run(
                sess.id,
                testName,
                testSlug,
                strVal,
                numVal,
                utiInfo?.unit || ti.unit || '',
                null,
                null,
                ti.pass_fail || 'OK'
              );
            }
          }
          syncedCount++;
        }
      });

      this.syncStatus.stage = 'Syncing QA Sessions...';
      await this.fetchAllPages(endpoints.testListInstancesUrl, {}, async (pageBatch) => {
        if (pageBatch && pageBatch.length > 0) {
          processBatch(pageBatch);
          this.syncStatus.syncedSessions = syncedCount;
          const totalStr = this.syncStatus.totalAvailable ? ` of ${this.syncStatus.totalAvailable}` : '';
          this.syncStatus.stage = `Syncing QA sessions (${syncedCount}${totalStr} entries processed)...`;
          this.updateMemoryStats();
        }
      });

      const isCancelled = this.syncStatus.isCancelled;
      this.syncStatus.stage = isCancelled ? 'Sync cancelled by user.' : 'Sync completed successfully.';

      return {
        success: true,
        cancelled: isCancelled,
        syncedSessions: syncedCount,
        totalAvailable: this.syncStatus.totalAvailable,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      this.syncStatus.error = err.message;
      this.syncStatus.stage = `Sync failed: ${err.message}`;
      throw err;
    } finally {
      this.syncStatus.isRunning = false;
      this.updateMemoryStats();
    }
  }
}

module.exports = new QATrackClient();
