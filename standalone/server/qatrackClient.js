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
    const unapprovedRow = getSetting.get('qatrack_include_unapproved');
    const rejectedRow = getSetting.get('qatrack_include_rejected');

    this.baseUrl = (urlRow ? urlRow.value : process.env.QATRACK_URL || 'http://localhost:8000').replace(/\/+$/, '');
    this.token = tokenRow ? tokenRow.value : process.env.QATRACK_TOKEN || '';
    this.authType = authTypeRow ? authTypeRow.value : process.env.QATRACK_AUTH_TYPE || 'Api-Key';
    this.includeUnapproved = unapprovedRow ? (unapprovedRow.value === 'true' || unapprovedRow.value === '1') : false;
    this.includeRejected = rejectedRow ? (rejectedRow.value === 'true' || rejectedRow.value === '1') : false;
  }

  saveConfig(url, token, authType = 'Api-Key', options = {}) {
    const upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    upsert.run('qatrack_url', url.replace(/\/+$/, ''));
    upsert.run('qatrack_token', token);
    upsert.run('qatrack_auth_type', authType);
    if (options.includeUnapproved !== undefined) {
      upsert.run('qatrack_include_unapproved', options.includeUnapproved ? 'true' : 'false');
    }
    if (options.includeRejected !== undefined) {
      upsert.run('qatrack_include_rejected', options.includeRejected ? 'true' : 'false');
    }
    this.reloadConfig();

    if (!this.includeRejected) {
      try {
        db.exec(`
          DELETE FROM test_values WHERE LOWER(status) LIKE '%reject%';
          DELETE FROM sessions WHERE LOWER(status) LIKE '%reject%';
          DELETE FROM sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM test_values);
        `);
      } catch (_) {}
    }
    if (!this.includeUnapproved) {
      try {
        db.exec(`
          DELETE FROM sessions WHERE LOWER(status) IN ('unapproved', 'unreviewed', 'in progress', 'pending');
          DELETE FROM sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM test_values);
        `);
      } catch (_) {}
    }

    return { success: true };
  }

  getConfig() {
    this.reloadConfig();
    return {
      baseUrl: this.baseUrl,
      token: this.token,
      hasToken: !!this.token,
      authType: this.authType,
      includeUnapproved: this.includeUnapproved,
      includeRejected: this.includeRejected
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

  resolveUnitName(uRef, unitMap) {
    if (!uRef || !unitMap) return null;
    if (unitMap.has(uRef)) return unitMap.get(uRef);
    if (typeof uRef === 'number' && unitMap.has(String(uRef))) return unitMap.get(String(uRef));
    if (typeof uRef === 'string') {
      if (/^\d+$/.test(uRef) && unitMap.has(parseInt(uRef, 10))) return unitMap.get(parseInt(uRef, 10));
      const extractedId = this.extractIdFromUrl(uRef);
      if (extractedId && unitMap.has(extractedId)) return unitMap.get(extractedId);
      if (extractedId && unitMap.has(String(extractedId))) return unitMap.get(String(extractedId));
      const trimmed = uRef.replace(/\/$/, '');
      if (unitMap.has(trimmed)) return unitMap.get(trimmed);
    }
    return null;
  }

  resolveTestListName(tlRef, testListMap) {
    if (!tlRef || !testListMap) return null;
    if (testListMap.has(tlRef)) return testListMap.get(tlRef);
    if (typeof tlRef === 'number' && testListMap.has(String(tlRef))) return testListMap.get(String(tlRef));
    if (typeof tlRef === 'string') {
      if (/^\d+$/.test(tlRef) && testListMap.has(parseInt(tlRef, 10))) return testListMap.get(parseInt(tlRef, 10));
      const extractedId = this.extractIdFromUrl(tlRef);
      if (extractedId && testListMap.has(extractedId)) return testListMap.get(extractedId);
      if (extractedId && testListMap.has(String(extractedId))) return testListMap.get(String(extractedId));
      const trimmed = tlRef.replace(/\/$/, '');
      if (testListMap.has(trimmed)) return testListMap.get(trimmed);
    }
    return null;
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
      testListCyclesUrl: qcEndpoints.testlistcycles || qcEndpoints['test-list-cycles'] || `${this.baseUrl}/api/qc/testlistcycles/`,
      testsUrl: qcEndpoints.tests || `${this.baseUrl}/api/qc/tests/`,
      unitTestInfosUrl: qcEndpoints.unittestinfos || qcEndpoints['unit-test-infos'] || `${this.baseUrl}/api/qc/unittestinfos/`,
      unitTestCollectionsUrl: qcEndpoints.unittestcollections || qcEndpoints['unit-test-collections'] || `${this.baseUrl}/api/qc/unittestcollections/`,
      testListInstancesUrl: qcEndpoints.testlistinstances || qcEndpoints['test-list-instances'] || `${this.baseUrl}/api/qc/testlistinstances/`,
      testInstanceStatusesUrl: qcEndpoints.testinstancestatus || qcEndpoints['test-instance-status'] || qcEndpoints.statuses || `${this.baseUrl}/api/qc/testinstancestatus/`
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
        DELETE FROM test_instance_statuses;
        DELETE FROM unit_test_infos;
      `);
    } else {
      // Clear stale metadata discovery tables so mock/unused definitions never linger
      db.exec(`
        DELETE FROM test_definitions;
        DELETE FROM unit_test_collections;
        DELETE FROM unit_test_infos;
      `);
    }

    // 0. Fetch Test Instance Statuses
    this.syncStatus.stage = 'Fetching QA Test Instance Statuses...';
    this.updateMemoryStats();

    let statuses = [];
    try {
      if (endpoints.testInstanceStatusesUrl) {
        statuses = await this.fetchAllPages(endpoints.testInstanceStatusesUrl);
      }
    } catch (e) {
      console.warn('Could not fetch test instance statuses:', e.message);
    }

    const testInstanceStatusMap = new Map();
    const insertStatusStmt = db.prepare(`
      INSERT OR REPLACE INTO test_instance_statuses (id, name, slug, requires_review, valid, is_rejected)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const s of statuses) {
      const id = s.id || this.extractIdFromUrl(s.url);
      const name = s.name || '';
      const slug = s.slug || '';
      const valid = (s.valid !== undefined) ? (s.valid ? 1 : 0) : 1;
      const isRejected = (s.valid === false || name.toLowerCase().includes('reject') || slug.toLowerCase().includes('reject')) ? 1 : 0;
      const requiresReview = (s.requires_review !== undefined)
        ? (s.requires_review ? 1 : 0)
        : (name.toLowerCase().includes('unreviewed') || name.toLowerCase().includes('unapproved') || slug.toLowerCase().includes('unreviewed') ? 1 : 0);

      if (id) {
        try {
          insertStatusStmt.run(id, name, slug, requiresReview, valid, isRejected);
        } catch (_) {}
      }

      const statusObj = {
        id,
        name,
        slug,
        valid: Boolean(valid),
        isRejected: Boolean(isRejected),
        requiresReview: Boolean(requiresReview)
      };

      if (id) {
        testInstanceStatusMap.set(id, statusObj);
        testInstanceStatusMap.set(String(id), statusObj);
      }
      if (s.url) {
        testInstanceStatusMap.set(s.url, statusObj);
        testInstanceStatusMap.set(s.url.replace(/\/$/, ''), statusObj);
        const relUrl = s.url.replace(/^https?:\/\/[^\/]+/, '');
        testInstanceStatusMap.set(relUrl, statusObj);
        testInstanceStatusMap.set(relUrl.replace(/\/$/, ''), statusObj);
      }
      if (name) testInstanceStatusMap.set(name.toLowerCase().trim(), statusObj);
      if (slug) testInstanceStatusMap.set(slug.toLowerCase().trim(), statusObj);
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
        id,
        name: testName,
        slug: t.slug || '',
        type: t.type || 'simple',
        unit: t.unit || '',
        calculation_procedure: t.calculation_procedure || '',
        formatting: t.formatting || ''
      };
      if (id) {
        testDefMap.set(id, testInfo);
        testDefMap.set(String(id), testInfo);
      }
      if (t.url) {
        testDefMap.set(t.url, testInfo);
        testDefMap.set(t.url.replace(/\/$/, ''), testInfo);
        const relUrl = t.url.replace(/^https?:\/\/[^\/]+/, '');
        testDefMap.set(relUrl, testInfo);
        testDefMap.set(relUrl.replace(/\/$/, ''), testInfo);
      }
      if (t.slug) {
        testDefMap.set(t.slug, testInfo);
      }
      if (testName) {
        testDefMap.set(testName, testInfo);
      }
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
    const insertUtiStmt = db.prepare(`
      INSERT OR REPLACE INTO unit_test_infos (id, unit_id, unit_url, test_id, test_name, test_slug, unit, data_type, is_numeric)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const uti of unitTestInfos) {
      const isUtiActive = (uti.is_active !== undefined) ? Boolean(uti.is_active) : ((uti.active !== undefined) ? Boolean(uti.active) : true);
      const utiUnitId = uti.unit ? (typeof uti.unit === 'number' ? uti.unit : this.extractIdFromUrl(uti.unit)) : null;
      if (!isUtiActive || (utiUnitId && !activeUnitIds.has(utiUnitId))) {
        continue; // Skip non-active unit test infos
      }

      const id = uti.id || this.extractIdFromUrl(uti.url);
      const testDef = testDefMap.get(uti.test) || (uti.test && testDefMap.get(this.extractIdFromUrl(uti.test)));
      const isNum = this.isNumericType(testDef || uti.type);
      const testName = testDef?.name || 'Unknown Test';
      const testSlug = testDef?.slug || '';
      const unit = testDef?.unit || '';
      const type = testDef?.type || 'simple';
      const testId = typeof uti.test === 'number' ? uti.test : this.extractIdFromUrl(uti.test);

      if (id) {
        try {
          insertUtiStmt.run(id, utiUnitId, typeof uti.unit === 'string' ? uti.unit : '', testId, testName, testSlug, unit, type, isNum);
        } catch (_) {}
      }

      const utiInfo = {
        id,
        unitUrl: uti.unit,
        unitId: utiUnitId,
        testId,
        testName,
        testSlug,
        unit,
        type,
        isNumeric: isNum === 1
      };
      if (id) {
        utiMap.set(id, utiInfo);
        utiMap.set(String(id), utiInfo);
      }
      if (uti.url) {
        utiMap.set(uti.url, utiInfo);
        utiMap.set(uti.url.replace(/\/$/, ''), utiInfo);
        const relUrl = uti.url.replace(/^https?:\/\/[^\/]+/, '');
        utiMap.set(relUrl, utiInfo);
        utiMap.set(relUrl.replace(/\/$/, ''), utiInfo);
      }
    }

    // 5. Test Lists & Test List Cycles
    this.syncStatus.stage = 'Fetching QA Test Lists & Cycles...';
    this.updateMemoryStats();

    let testLists = [];
    try {
      testLists = await this.fetchAllPages(endpoints.testListsUrl);
    } catch (e) {
      console.warn('Warning: Could not fetch test lists:', e.message);
    }

    let testListCycles = [];
    if (endpoints.testListCyclesUrl) {
      try {
        testListCycles = await this.fetchAllPages(endpoints.testListCyclesUrl);
      } catch (e) {
        console.warn('Warning: Could not fetch test list cycles:', e.message);
      }
    }

    const testListMap = new Map();
    const insertTestList = db.prepare(`
      INSERT OR REPLACE INTO test_lists (id, name, slug, description)
      VALUES (?, ?, ?, ?)
    `);

    for (const tl of testLists) {
      const id = tl.id || this.extractIdFromUrl(tl.url);
      const name = tl.name;
      if (!name) continue;

      try {
        insertTestList.run(id, name, tl.slug || '', tl.description || '');
      } catch (_) {}

      if (id) {
        testListMap.set(id, name);
        testListMap.set(String(id), name);
      }
      if (tl.url) {
        testListMap.set(tl.url, name);
        testListMap.set(tl.url.replace(/\/$/, ''), name);
        const relUrl = tl.url.replace(/^https?:\/\/[^\/]+/, '');
        testListMap.set(relUrl, name);
        testListMap.set(relUrl.replace(/\/$/, ''), name);
      }
    }

    // Register cycles in testListMap
    for (const cyc of testListCycles) {
      const id = cyc.id || this.extractIdFromUrl(cyc.url);
      const name = cyc.name;
      if (!name) continue;

      try {
        insertTestList.run(id ? 100000 + Number(id) : null, name, cyc.slug || '', cyc.description || '');
      } catch (_) {}

      if (id) {
        testListMap.set(id, name);
        testListMap.set(String(id), name);
        testListMap.set(`cycle-${id}`, name);
      }
      if (cyc.url) {
        testListMap.set(cyc.url, name);
        testListMap.set(cyc.url.replace(/\/$/, ''), name);
        const relUrl = cyc.url.replace(/^https?:\/\/[^\/]+/, '');
        testListMap.set(relUrl, name);
        testListMap.set(relUrl.replace(/\/$/, ''), name);
      }
    }

    // 6. Unit Test Collections (filter out non-active assignments)
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

      let testListName = '';
      if (tlId && testListMap.has(tlId)) {
        testListName = testListMap.get(tlId);
      } else if (rawTl && testListMap.has(rawTl)) {
        testListName = testListMap.get(rawTl);
      } else if (c.name && typeof c.name === 'string') {
        testListName = c.name;
      } else if (tlId) {
        testListName = typeof tlId === 'number' ? `List #${tlId}` : String(tlId);
      } else {
        testListName = 'Unknown Test List';
      }

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

      const colInfo = {
        unitName,
        testListName,
        unitId: uId,
        testListId: tlId,
        active: true,
        frequency: typeof c.frequency === 'number' ? c.frequency : (this.extractIdFromUrl(c.frequency) || null),
        assignedTo: typeof c.assigned_to === 'number' ? c.assigned_to : (this.extractIdFromUrl(c.assigned_to) || null)
      };
      if (id) {
        utcMap.set(id, colInfo);
        utcMap.set(String(id), colInfo);
      }
      if (c.url) utcMap.set(c.url, colInfo);
    }

    // Map test lists by ID and URL for recursive sublist traversal
    const testListsById = new Map();
    for (const tl of testLists) {
      const id = tl.id || this.extractIdFromUrl(tl.url);
      if (id) {
        testListsById.set(id, tl);
        testListsById.set(String(id), tl);
      }
      if (tl.url) testListsById.set(tl.url, tl);
    }

    const getAllTestsForTestList = (tlOrId, visited = new Set()) => {
      const allTestRefs = [];
      const tl = (typeof tlOrId === 'object' && tlOrId !== null)
        ? tlOrId
        : testListsById.get(tlOrId) || testListsById.get(this.extractIdFromUrl(tlOrId));
      if (!tl) return allTestRefs;

      const tlId = tl.id || this.extractIdFromUrl(tl.url);
      if (tlId) {
        if (visited.has(tlId)) return allTestRefs;
        visited.add(tlId);
      }

      if (Array.isArray(tl.tests)) {
        for (const tRef of tl.tests) {
          allTestRefs.push(tRef);
        }
      }

      if (Array.isArray(tl.test_lists)) {
        for (const subRef of tl.test_lists) {
          const subTests = getAllTestsForTestList(subRef, visited);
          allTestRefs.push(...subTests);
        }
      }

      return allTestRefs;
    };

    // Populate test_definitions in database ONLY from active collections
    const insertTestDef = db.prepare(`
      INSERT OR REPLACE INTO test_definitions (name, slug, test_list_name, unit, data_type, is_numeric)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // Populate only from ACTIVE unit test collections
    for (const c of collections) {
      const id = c.id || this.extractIdFromUrl(c.url);
      const colInfo = utcMap.get(id) || (id && utcMap.get(String(id)));
      if (!colInfo) continue; // Skip non-active assignments!

      const testListName = colInfo.testListName || testListMap.get(c.tests_object) || c.name;
      if (!testListName) continue;

      const rawTl = c.tests_object || c.test_list || c.testlist || c.tests;
      if (rawTl) {
        const allTests = getAllTestsForTestList(rawTl);
        for (const tRef of allTests) {
          const t = testDefMap.get(tRef) || (typeof tRef === 'string' && testDefMap.get(this.extractIdFromUrl(tRef)));
          if (t && t.name) {
            insertTestDef.run(t.name, t.slug, testListName, t.unit || '', t.type, this.isNumericType(t));
          }
        }
      }

      if (Array.isArray(c.tests)) {
        for (const utiRef of c.tests) {
          const uti = utiMap.get(utiRef) || (typeof utiRef === 'string' && utiMap.get(this.extractIdFromUrl(utiRef)));
          if (uti && uti.testName) {
            const tDef = testDefMap.get(uti.testId) || { type: uti.type, unit: uti.unit, name: uti.testName, slug: uti.testSlug };
            insertTestDef.run(uti.testName, uti.testSlug, testListName, uti.unit || '', uti.type, this.isNumericType(tDef));
          }
        }
      }
    }

    // Also populate from all test lists directly (including sublists!) across all frequencies and ad-hoc lists
    for (const tl of testLists) {
      if (!tl || !tl.name) continue;

      const allTests = getAllTestsForTestList(tl);
      for (const tRef of allTests) {
        const t = testDefMap.get(tRef) ||
          (typeof tRef === 'string' && (testDefMap.get(this.extractIdFromUrl(tRef)) || testDefMap.get(tRef.replace(/\/$/, ''))));
        if (t && t.name) {
          try {
            insertTestDef.run(t.name, t.slug, tl.name, t.unit || '', t.type, this.isNumericType(t));
          } catch (_) {}
        }
      }
    }

    return { unitClassMap, unitTypeMap, unitMap, testListMap, testDefMap, utiMap, utcMap, testInstanceStatusMap };
  }

  async getOrLoadTestInstanceStatusMap(endpoints = null) {
    if (this.cachedMetadata?.testInstanceStatusMap && this.cachedMetadata.testInstanceStatusMap.size > 0) {
      return this.cachedMetadata.testInstanceStatusMap;
    }

    const testInstanceStatusMap = new Map();

    // 1. Try loading from SQLite
    try {
      const dbStatuses = db.prepare('SELECT id, name, slug, requires_review, valid, is_rejected FROM test_instance_statuses').all();
      for (const s of dbStatuses) {
        const statusObj = {
          id: s.id,
          name: s.name,
          slug: s.slug,
          valid: Boolean(s.valid),
          isRejected: Boolean(s.is_rejected),
          requiresReview: Boolean(s.requires_review)
        };
        testInstanceStatusMap.set(s.id, statusObj);
        testInstanceStatusMap.set(String(s.id), statusObj);
        testInstanceStatusMap.set(`${this.baseUrl}/api/qc/testinstancestatus/${s.id}/`, statusObj);
        testInstanceStatusMap.set(`${this.baseUrl}/api/qc/testinstancestatus/${s.id}`, statusObj);
        testInstanceStatusMap.set(`/api/qc/testinstancestatus/${s.id}/`, statusObj);
        testInstanceStatusMap.set(`/api/qc/testinstancestatus/${s.id}`, statusObj);
        if (s.name) testInstanceStatusMap.set(s.name.toLowerCase().trim(), statusObj);
        if (s.slug) testInstanceStatusMap.set(s.slug.toLowerCase().trim(), statusObj);
      }
    } catch (_) {}

    // 2. If empty and endpoints provided, fetch from QATrack+ API
    if (testInstanceStatusMap.size === 0 && (endpoints?.testInstanceStatusesUrl || this.baseUrl)) {
      try {
        const statusesUrl = endpoints?.testInstanceStatusesUrl || `${this.baseUrl}/api/qc/testinstancestatus/`;
        const statuses = await this.fetchAllPages(statusesUrl);
        const insertStatusStmt = db.prepare(`
          INSERT OR REPLACE INTO test_instance_statuses (id, name, slug, requires_review, valid, is_rejected)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const s of statuses) {
          const id = s.id || this.extractIdFromUrl(s.url);
          const name = s.name || '';
          const slug = s.slug || '';
          const valid = (s.valid !== undefined) ? (s.valid ? 1 : 0) : 1;
          const isRejected = (s.valid === false || name.toLowerCase().includes('reject') || slug.toLowerCase().includes('reject')) ? 1 : 0;
          const requiresReview = (s.requires_review !== undefined)
            ? (s.requires_review ? 1 : 0)
            : (name.toLowerCase().includes('unreviewed') || name.toLowerCase().includes('unapproved') || slug.toLowerCase().includes('unreviewed') ? 1 : 0);

          if (id) {
            try {
              insertStatusStmt.run(id, name, slug, requiresReview, valid, isRejected);
            } catch (_) {}
          }

          const statusObj = {
            id,
            name,
            slug,
            valid: Boolean(valid),
            isRejected: Boolean(isRejected),
            requiresReview: Boolean(requiresReview)
          };

          if (id) {
            testInstanceStatusMap.set(id, statusObj);
            testInstanceStatusMap.set(String(id), statusObj);
          }
          if (s.url) {
            testInstanceStatusMap.set(s.url, statusObj);
            testInstanceStatusMap.set(s.url.replace(/\/$/, ''), statusObj);
            const relUrl = s.url.replace(/^https?:\/\/[^\/]+/, '');
            testInstanceStatusMap.set(relUrl, statusObj);
            testInstanceStatusMap.set(relUrl.replace(/\/$/, ''), statusObj);
          }
          if (name) testInstanceStatusMap.set(name.toLowerCase().trim(), statusObj);
          if (slug) testInstanceStatusMap.set(slug.toLowerCase().trim(), statusObj);
        }
      } catch (err) {
        console.warn('Could not fetch test instance statuses from API:', err.message);
      }
    }

    return testInstanceStatusMap;
  }

  resolveTestInstanceStatus(ti, statusMap) {
    if (!ti) return { name: 'Approved', slug: 'approved', valid: true, isRejected: false, requiresReview: false };

    let statusObj = null;
    if (ti.status && typeof ti.status === 'object') {
      statusObj = ti.status;
    } else if (ti.status && statusMap) {
      statusObj = statusMap.get(ti.status) ||
                  statusMap.get(this.extractIdFromUrl(ti.status)) ||
                  statusMap.get(String(ti.status));
      if (!statusObj && typeof ti.status === 'string') {
        const norm = ti.status.replace(/\/$/, '');
        statusObj = statusMap.get(norm);
      }
    } else if (ti.status_name && statusMap) {
      statusObj = statusMap.get(ti.status_name.toLowerCase().trim()) || statusMap.get(ti.status_name);
    }

    const name = statusObj?.name || ti.status_name || (typeof ti.status === 'string' && !ti.status.startsWith('http') ? ti.status : '');
    const slug = statusObj?.slug || '';
    const passFail = (ti.pass_fail || '').toLowerCase();

    const isRejected = Boolean(
      (statusObj && statusObj.isRejected) ||
      (statusObj && statusObj.valid === false) ||
      name.toLowerCase().includes('reject') ||
      slug.toLowerCase().includes('reject') ||
      (typeof ti.status === 'string' && ti.status.toLowerCase().includes('reject')) ||
      passFail.includes('reject')
    );

    const requiresReview = Boolean(
      (statusObj && statusObj.requiresReview) ||
      name.toLowerCase().includes('unreviewed') ||
      name.toLowerCase().includes('unapproved') ||
      slug.toLowerCase().includes('unreviewed') ||
      slug.toLowerCase().includes('unapproved')
    );

    return {
      name: name || (isRejected ? 'Rejected' : (requiresReview ? 'Unreviewed' : 'Approved')),
      slug,
      valid: statusObj ? Boolean(statusObj.valid) : !isRejected,
      isRejected,
      requiresReview
    };
  }

  isNumericType(testDefOrType) {
    if (!testDefOrType) return 1;
    if (typeof testDefOrType === 'string') {
      const t = testDefOrType.toLowerCase();
      if (t === 'simple' || t === 'numerical' || t === 'composite' || t === 'calculation' || t === 'string_composite' || t === 'line') {
        return 1;
      }
      if (t === 'multchoice' || t === 'upload' || t === 'date' || t === 'datetime' || t === 'time') {
        return 0;
      }
      return 0;
    }
    const t = (testDefOrType.type || 'simple').toLowerCase();
    if (t === 'simple' || t === 'numerical' || t === 'composite' || t === 'calculation' || t === 'string_composite' || t === 'line') {
      return 1;
    }
    if (testDefOrType.calculation_procedure && String(testDefOrType.calculation_procedure).trim()) {
      return 1;
    }
    if (testDefOrType.formatting && /%[.\d]*[fdeEgG]/.test(testDefOrType.formatting)) {
      return 1;
    }
    const name = (testDefOrType.name || testDefOrType.display_name || '').toLowerCase();
    const slug = (testDefOrType.slug || '').toLowerCase();
    if (
      name.includes('(%)') || name.includes('(mm)') || name.includes('(cgy') ||
      name.includes('(kpa)') || name.includes('(°c)') || name.includes('(deg)') ||
      slug.endsWith('_pct') || slug.endsWith('_mm') || slug.endsWith('_deg') ||
      slug.endsWith('_cgy') || slug.endsWith('_mu') || slug.endsWith('_diff') ||
      slug.endsWith('_dev') || slug.endsWith('_rate') || slug.endsWith('_val')
    ) {
      return 1;
    }
    if (t === 'multchoice' || t === 'upload' || t === 'date' || t === 'datetime' || t === 'time') {
      return 0;
    }
    return 0;
  }

  async getOrLoadUtiMap(endpoints = null) {
    if (this.cachedMetadata?.utiMap && this.cachedMetadata.utiMap.size > 0) {
      return this.cachedMetadata.utiMap;
    }

    const utiMap = new Map();

    // 1. Try loading from SQLite
    try {
      const dbUtis = db.prepare('SELECT id, unit_id, unit_url, test_id, test_name, test_slug, unit, data_type, is_numeric FROM unit_test_infos').all();
      for (const u of dbUtis) {
        const utiInfo = {
          id: u.id,
          unitId: u.unit_id,
          unitUrl: u.unit_url,
          testId: u.test_id,
          testName: u.test_name,
          testSlug: u.test_slug,
          unit: u.unit || '',
          type: u.data_type || 'simple',
          isNumeric: u.is_numeric === 1
        };
        utiMap.set(u.id, utiInfo);
        utiMap.set(String(u.id), utiInfo);
        if (this.baseUrl) {
          utiMap.set(`${this.baseUrl}/api/qc/unittestinfos/${u.id}/`, utiInfo);
          utiMap.set(`${this.baseUrl}/api/qc/unittestinfos/${u.id}`, utiInfo);
        }
        utiMap.set(`/api/qc/unittestinfos/${u.id}/`, utiInfo);
        utiMap.set(`/api/qc/unittestinfos/${u.id}`, utiInfo);
      }
    } catch (_) {}

    // 2. If empty and endpoints provided, fetch metadata
    if (utiMap.size === 0 && (endpoints || this.baseUrl)) {
      try {
        const ep = endpoints || await this.discoverEndpoints();
        const meta = await this.fetchMetadata(ep, false);
        this.cachedMetadata = meta;
        return meta.utiMap;
      } catch (err) {
        console.warn('Could not load UTIs from API:', err.message);
      }
    }

    return utiMap;
  }

  resolveTestInstanceInfo(ti, utiMap, testDefMap = null) {
    if (!ti) return { testName: 'Test', testSlug: '', unit: '', isNumeric: false };

    let utiInfo = null;
    if (ti.unit_test_info) {
      utiInfo = utiMap?.get(ti.unit_test_info) ||
                utiMap?.get(this.extractIdFromUrl(ti.unit_test_info)) ||
                utiMap?.get(String(ti.unit_test_info));
      if (!utiInfo && typeof ti.unit_test_info === 'string') {
        utiInfo = utiMap?.get(ti.unit_test_info.replace(/\/$/, ''));
      }
    }

    let testName = utiInfo?.testName || ti.name || ti.test_name;
    let testSlug = utiInfo?.testSlug || ti.slug || ti.test_slug || '';
    let unit = utiInfo?.unit || ti.unit || '';
    let isNumeric = utiInfo?.isNumeric ?? false;

    // 1. Try unit_test_infos table in SQLite if ti.unit_test_info exists
    if (!testName && ti.unit_test_info) {
      const utiId = typeof ti.unit_test_info === 'number' ? ti.unit_test_info : this.extractIdFromUrl(ti.unit_test_info);
      if (utiId) {
        try {
          const dbUti = db.prepare('SELECT test_name, test_slug, unit, is_numeric FROM unit_test_infos WHERE id = ?').get(utiId);
          if (dbUti) {
            testName = dbUti.test_name;
            testSlug = dbUti.test_slug || testSlug;
            unit = dbUti.unit || unit;
            isNumeric = dbUti.is_numeric === 1;
          }
        } catch (_) {}
      }
    }

    // 2. Try testDefMap in memory if ti.test or ti.test_id exists
    if ((!testName || testName === 'Test') && testDefMap) {
      const tRef = ti.test || ti.test_id;
      if (tRef) {
        const tDef = testDefMap.get(tRef) ||
          (typeof tRef === 'number' && testDefMap.get(String(tRef))) ||
          (typeof tRef === 'string' && (testDefMap.get(this.extractIdFromUrl(tRef)) || testDefMap.get(tRef.replace(/\/$/, ''))));
        if (tDef) {
          testName = tDef.name || testName;
          testSlug = tDef.slug || testSlug;
          unit = tDef.unit || unit;
          isNumeric = this.isNumericType(tDef);
        }
      }
    }

    // 3. Try test_definitions or unit_test_infos in SQLite
    if (!testName || testName === 'Test') {
      const tRef = ti.test || ti.test_id;
      const tId = typeof tRef === 'number' ? tRef : (tRef ? this.extractIdFromUrl(tRef) : null);
      if (tId) {
        try {
          const dbDef = db.prepare('SELECT name, slug, unit, is_numeric FROM test_definitions WHERE slug = ? OR name = ? OR id = ?').get(String(tId), String(tId), tId);
          if (dbDef) {
            testName = dbDef.name;
            testSlug = dbDef.slug || testSlug;
            unit = dbDef.unit || unit;
            isNumeric = dbDef.is_numeric === 1;
          }
        } catch (_) {}

        if (!testName || testName === 'Test') {
          try {
            const dbUtiTest = db.prepare('SELECT test_name, test_slug, unit, is_numeric FROM unit_test_infos WHERE test_id = ?').get(tId);
            if (dbUtiTest) {
              testName = dbUtiTest.test_name;
              testSlug = dbUtiTest.test_slug || testSlug;
              unit = dbUtiTest.unit || unit;
              isNumeric = dbUtiTest.is_numeric === 1;
            }
          } catch (_) {}
        }
      }
    }

    if (!testName) {
      testName = 'Test';
    }

    return { testName, testSlug, unit, isNumeric };
  }

  extractTestInstanceValue(ti) {
    let numVal = null;
    let strVal = '';

    // 1. Direct number on ti.value
    if (typeof ti.value === 'number') {
      numVal = ti.value;
      strVal = String(ti.value);
    } else if (ti.value !== null && ti.value !== undefined && ti.value !== '') {
      const clean = String(ti.value).trim().replace(/%/g, '').replace(/,/g, '');
      const parsed = parseFloat(clean);
      if (!isNaN(parsed)) numVal = parsed;
      strVal = String(ti.value);
    }

    // 2. String value (very common for QATrack+ calculation & composite tests)
    if (ti.string_value !== undefined && ti.string_value !== null && String(ti.string_value).trim() !== '') {
      strVal = String(ti.string_value).trim();
      if (numVal === null) {
        // Handle percentages (e.g. "98.5%"), units attached (e.g. "0.473 mm", "25.04 cGy"), comma decimals
        const cleanStr = strVal.replace(/%/g, '').replace(/,/g, '').trim();
        const numMatch = cleanStr.match(/^[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/);
        if (numMatch) {
          const parsed = parseFloat(numMatch[0]);
          if (!isNaN(parsed)) numVal = parsed;
        }
      }
    } else if (ti.date_value) {
      strVal = ti.date_value;
    }

    // 3. JSON value (calculation tests that return JSON objects or numbers)
    if (ti.json_value !== undefined && ti.json_value !== null && ti.json_value !== '') {
      let jVal = ti.json_value;
      if (typeof jVal === 'string') {
        try { jVal = JSON.parse(jVal); } catch (_) {}
      }
      if (typeof jVal === 'number') {
        if (numVal === null) numVal = jVal;
        if (!strVal) strVal = String(jVal);
      } else if (typeof jVal === 'object' && jVal !== null) {
        const candidate = jVal.value ?? jVal.val ?? jVal.result ?? jVal.reading ?? (Array.isArray(jVal) ? jVal[0] : null);
        if (typeof candidate === 'number') {
          if (numVal === null) numVal = candidate;
          if (!strVal) strVal = String(candidate);
        } else if (typeof candidate === 'string') {
          if (!strVal) strVal = candidate;
          if (numVal === null) {
            const parsed = parseFloat(candidate.replace(/%/g, '').replace(/,/g, '').trim());
            if (!isNaN(parsed)) numVal = parsed;
          }
        }
      }
    }

    return { numVal, strVal };
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
    const effectiveIncludeUnapproved = options.includeUnapproved !== undefined ? Boolean(options.includeUnapproved) : this.includeUnapproved;
    const effectiveIncludeRejected = options.includeRejected !== undefined ? Boolean(options.includeRejected) : this.includeRejected;
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
      let testDefMap = this.cachedMetadata?.testDefMap || null;

      if (this.cachedMetadata) {
        unitMap = this.cachedMetadata.unitMap;
        testListMap = this.cachedMetadata.testListMap;
        utiMap = this.cachedMetadata.utiMap;
        utcMap = this.cachedMetadata.utcMap;
        testDefMap = this.cachedMetadata.testDefMap;
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
          const colInfo = {
            unitName: c.unit_name,
            testListName: c.test_list_name,
            unitId: c.unit_id,
            testListId: c.test_list_id,
            active: Boolean(c.active !== 0)
          };
          utcMap.set(c.id, colInfo);
          utcMap.set(String(c.id), colInfo);
        }

        utiMap = await this.getOrLoadUtiMap(endpoints);

        // If local metadata is missing units, test lists, collections, or UTIs, do a metadata fetch once
        const dbUtiCount = db.prepare('SELECT COUNT(*) as count FROM unit_test_infos').get()?.count || 0;
        if (dbUnits.length === 0 || dbLists.length === 0 || dbUtcs.length === 0 || dbUtiCount === 0 || utiMap.size === 0) {
          const meta = await this.fetchMetadata(endpoints, false);
          this.cachedMetadata = meta;
          unitMap = meta.unitMap;
          testListMap = meta.testListMap;
          utiMap = meta.utiMap;
          utcMap = meta.utcMap;
          testDefMap = meta.testDefMap;
        } else {
          testDefMap = new Map();
          try {
            const dbDefs = db.prepare('SELECT id, name, slug, unit, data_type, is_numeric FROM test_definitions').all();
            for (const d of dbDefs) {
              const info = { id: d.id, name: d.name, slug: d.slug, unit: d.unit, type: d.data_type, is_numeric: d.is_numeric === 1 };
              if (d.id) {
                testDefMap.set(d.id, info);
                testDefMap.set(String(d.id), info);
              }
              if (d.slug) testDefMap.set(d.slug, info);
              if (d.name) testDefMap.set(d.name, info);
            }
          } catch (_) {}
          this.cachedMetadata = { unitMap, testListMap, utiMap, utcMap, testDefMap };
        }
      }

      const testInstanceStatusMap = await this.getOrLoadTestInstanceStatusMap(endpoints);
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

      const fetchedQATrackIds = new Set();
      let syncedCount = 0;

      const processBatch = db.transaction((instBatch, directColInfo = null) => {
        for (const inst of instBatch) {
          const qatrackId = inst.id || this.extractIdFromUrl(inst.url);
          if (!qatrackId) continue;

          // Inspect all test instances within this session
          const rawTestInstances = Array.isArray(inst.test_instances) ? inst.test_instances : [];
          let hasRejectedTi = false;
          let allRejectedTi = false;
          let hasUnreviewedTi = false;
          let allUnreviewedTi = false;

          if (rawTestInstances.length > 0) {
            let rejCount = 0;
            let unrevCount = 0;
            for (const ti of rawTestInstances) {
              const tiStatusInfo = this.resolveTestInstanceStatus(ti, testInstanceStatusMap);
              if (tiStatusInfo.isRejected) rejCount++;
              if (tiStatusInfo.requiresReview) unrevCount++;
            }
            if (rejCount === rawTestInstances.length) allRejectedTi = true;
            if (rejCount > 0) hasRejectedTi = true;
            if (unrevCount === rawTestInstances.length) allUnreviewedTi = true;
            if (unrevCount > 0) hasUnreviewedTi = true;
          }

          // Determine session status
          let sessionStatus = 'Completed';
          if (inst.status_name) {
            sessionStatus = inst.status_name;
          } else if (typeof inst.status === 'string' && inst.status.trim() && !inst.status.startsWith('http')) {
            sessionStatus = inst.status.trim();
          } else if (allRejectedTi || hasRejectedTi) {
            sessionStatus = 'Rejected';
          } else if (inst.in_progress) {
            sessionStatus = 'In Progress';
          } else if (inst.all_reviewed === false || hasUnreviewedTi) {
            sessionStatus = 'Unapproved';
          } else if (inst.all_reviewed) {
            sessionStatus = 'Approved';
          } else {
            sessionStatus = 'Unapproved';
          }

          const statusLower = sessionStatus.toLowerCase();

          // Filter unapproved data if setting is OFF (off by default)
          if (!effectiveIncludeUnapproved) {
            if (inst.in_progress || inst.all_reviewed === false || hasUnreviewedTi) {
              continue;
            }
            if (statusLower.includes('unapproved') || statusLower.includes('unreviewed') || statusLower.includes('in progress') || statusLower.includes('pending')) {
              continue;
            }
          }

          // Filter rejected data if setting is OFF (off by default)
          if (!effectiveIncludeRejected) {
            if (statusLower.includes('reject') || hasRejectedTi || allRejectedTi) {
              continue;
            }
          }

          fetchedQATrackIds.add(qatrackId);
          fetchedQATrackIds.add(Number(qatrackId));

          let uName = directColInfo?.unitName;
          let tListName = directColInfo?.testListName;

          if (!uName || !tListName) {
            const utcId = inst.unit_test_collection !== undefined && inst.unit_test_collection !== null
              ? (typeof inst.unit_test_collection === 'number' ? inst.unit_test_collection : (this.extractIdFromUrl(inst.unit_test_collection) || inst.unit_test_collection))
              : null;
            const colInfo = utcId ? (utcMap.get(utcId) || (typeof utcId === 'number' && utcMap.get(String(utcId)))) : null;
            if (!uName) {
              if (colInfo?.unitName) {
                uName = colInfo.unitName;
              } else {
                const resolvedUnit = this.resolveUnitName(inst.unit, unitMap);
                if (resolvedUnit) {
                  uName = resolvedUnit;
                } else if (typeof inst.unit_name === 'string') {
                  uName = inst.unit_name;
                }
              }
            }

            if (!tListName) {
              if (colInfo?.testListName) {
                tListName = colInfo.testListName;
              } else {
                const resolvedList = this.resolveTestListName(inst.test_list, testListMap);
                if (resolvedList) {
                  tListName = resolvedList;
                } else if (typeof inst.test_list_name === 'string' && inst.test_list_name) {
                  tListName = inst.test_list_name;
                }
              }
            }
          }

          if (!uName) uName = 'Unknown Machine';
          if (!tListName) tListName = 'Patient Specific QA';

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
            sessionStatus,
            inst.comments && inst.comments.length > 0 ? JSON.stringify(inst.comments) : ''
          );

          const sess = getSessionByQATrackId.get(qatrackId);
          if (sess && rawTestInstances.length > 0) {
            deleteOldValues.run(sess.id);
            let validTiCount = 0;

            for (const ti of rawTestInstances) {
              const tiStatusInfo = this.resolveTestInstanceStatus(ti, testInstanceStatusMap);

              if (!effectiveIncludeRejected && tiStatusInfo.isRejected) {
                continue;
              }
              if (!effectiveIncludeUnapproved && tiStatusInfo.requiresReview) {
                continue;
              }

              const tiInfo = this.resolveTestInstanceInfo(ti, utiMap, testDefMap);
              const { numVal, strVal } = this.extractTestInstanceValue(ti);

              insertTestVal.run(
                sess.id,
                tiInfo.testName,
                tiInfo.testSlug,
                strVal,
                numVal,
                tiInfo.unit,
                null,
                null,
                tiStatusInfo.isRejected ? 'Rejected' : (tiStatusInfo.requiresReview ? 'Unreviewed' : (ti.pass_fail || 'OK'))
              );
              validTiCount++;
            }

            if (validTiCount === 0) {
              deleteOldValues.run(sess.id);
              db.prepare('DELETE FROM sessions WHERE id = ?').run(sess.id);
              continue;
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
          for (const l of resolvedLists) {
            if (!targetLists.includes(l)) targetLists.push(l);
          }
          const sessRows = db.prepare(`
            SELECT DISTINCT s.test_list_name 
            FROM sessions s 
            JOIN test_values tv ON s.id = tv.session_id 
            WHERE tv.test_name = ?
          `).all(options.yVariable);
          for (const sr of sessRows) {
            if (sr.test_list_name && sr.test_list_name !== 'General QA' && !targetLists.includes(sr.test_list_name)) {
              targetLists.push(sr.test_list_name);
            }
          }
        } catch (_) {}
      }

      // Filter targetUnits so it strictly targets active machines (never inactive units!)
      let effectiveTargetUnits = targetUnits.filter(u => activeUnitNames.has(u.toLowerCase().trim()));
      if (effectiveTargetUnits.length === 0 && targetUnits.length === 0) {
        effectiveTargetUnits = activeUnitRows.map(u => u.name);
      }
      const targetUnitsLower = effectiveTargetUnits.map(u => u.toLowerCase().trim());

      // Target test lists: include all specified targetLists (do not filter against local sessions table)
      const effectiveTargetLists = [...targetLists];
      const targetListsLower = effectiveTargetLists.map(l => l.toLowerCase().trim());

      // Resolve test list IDs
      const targetTestListIds = [];
      const testListIdToName = new Map();
      if (targetListsLower.length > 0) {
        for (const [tlId, tlName] of testListMap.entries()) {
          const numTlId = typeof tlId === 'number' ? tlId : (typeof tlId === 'string' && /^\d+$/.test(tlId) ? parseInt(tlId, 10) : null);
          if (numTlId !== null && targetListsLower.includes((tlName || '').toLowerCase().trim())) {
            if (!targetTestListIds.includes(numTlId)) {
              targetTestListIds.push(numTlId);
              testListIdToName.set(numTlId, tlName);
            }
          }
        }
        try {
          const dbLists = db.prepare('SELECT id, name FROM test_lists').all();
          for (const l of dbLists) {
            if (l.id && targetListsLower.includes((l.name || '').toLowerCase().trim())) {
              if (!targetTestListIds.includes(l.id)) {
                targetTestListIds.push(l.id);
                testListIdToName.set(l.id, l.name);
              }
            }
          }
        } catch (_) {}
      }

      // Resolve unit IDs
      const targetUnitIds = [];
      const unitIdToName = new Map();
      if (targetUnitsLower.length > 0) {
        for (const [uId, uName] of unitMap.entries()) {
          const numUId = typeof uId === 'number' ? uId : (typeof uId === 'string' && /^\d+$/.test(uId) ? parseInt(uId, 10) : null);
          if (numUId !== null && targetUnitsLower.includes((uName || '').toLowerCase().trim())) {
            if (!targetUnitIds.includes(numUId)) {
              targetUnitIds.push(numUId);
              unitIdToName.set(numUId, uName);
            }
          }
        }
        try {
          const dbUnits = db.prepare('SELECT id, name FROM units WHERE active = 1').all();
          for (const u of dbUnits) {
            if (u.id && targetUnitsLower.includes((u.name || '').toLowerCase().trim())) {
              if (!targetUnitIds.includes(u.id)) {
                targetUnitIds.push(u.id);
                unitIdToName.set(u.id, u.name);
              }
            }
          }
        } catch (_) {}
      }

      // Build query targets
      // 1. Target all matching active unit_test_collections for the requested units & test lists.
      // In QATrack+, scheduled QA across different frequencies (weekly, monthly, etc.) and groups
      // has distinct unit_test_collection IDs. Querying by unit_test_collection ensures every
      // frequency/group is explicitly retrieved from the server.
      const queryTargets = [];
      const matchedUtcIds = new Set();

      for (const [colKey, colInfo] of utcMap.entries()) {
        const numColId = typeof colKey === 'number' ? colKey : (typeof colKey === 'string' && /^\d+$/.test(colKey) ? parseInt(colKey, 10) : null);
        if (!numColId || matchedUtcIds.has(numColId)) continue;
        if (colInfo.active === false) continue;

        const uMatch = targetUnitsLower.length === 0 ||
          (colInfo.unitName && targetUnitsLower.includes(colInfo.unitName.toLowerCase().trim())) ||
          (colInfo.unitId && targetUnitIds.includes(colInfo.unitId));

        const tlMatch = targetListsLower.length === 0 ||
          (colInfo.testListName && targetListsLower.includes(colInfo.testListName.toLowerCase().trim())) ||
          (colInfo.testListId && targetTestListIds.includes(colInfo.testListId));

        if (uMatch && tlMatch) {
          matchedUtcIds.add(numColId);
          queryTargets.push({
            params: { unit_test_collection: numColId },
            label: `${colInfo.testListName || 'Collection'} on ${colInfo.unitName || 'Unit'} (UTC #${numColId})`,
            colInfo
          });
        }
      }

      // 2. Also query by test_list ID (without the unsupported unit parameter) to capture
      // any ad-hoc QA sessions or instances across all frequencies.
      if (targetTestListIds.length > 0) {
        for (const tlId of targetTestListIds) {
          queryTargets.push({
            params: { test_list: tlId },
            label: `${testListIdToName.get(tlId) || 'List #' + tlId} (All instances)`
          });
        }
      } else if (targetUnitIds.length > 0 && queryTargets.length === 0) {
        for (const uId of targetUnitIds) {
          queryTargets.push({
            params: { unit: uId },
            label: `${unitIdToName.get(uId) || 'Unit #' + uId}`
          });
        }
      }

      if (queryTargets.length === 0) {
        queryTargets.push({
          params: {},
          label: listLabel || 'All Active QA Records'
        });
      }

      this.syncStatus.totalCollections = queryTargets.length;
      let qIdx = 0;
      for (const qt of queryTargets) {
        if (this.syncStatus.isCancelled) break;
        qIdx++;
        const queryParams = {
          ...qt.params,
          ordering: '-work_completed'
        };
        if (dateFrom) queryParams.work_completed__gte = dateFrom;
        if (dateTo) queryParams.work_completed__lte = dateTo;

        const targetLabel = qt.label;
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
              processBatch(pageBatch, qt.colInfo);
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

      // Reconcile deleted sessions: remove any local sessions in the queried scope that were deleted in QATrack+
      let deletedSessionsCount = 0;
      if (!this.syncStatus.isCancelled) {
        try {
          let selectSql = 'SELECT id, qatrack_instance_id FROM sessions WHERE qatrack_instance_id IS NOT NULL';
          const selectParams = [];
          if (targetListsLower.length > 0) {
            selectSql += ` AND LOWER(test_list_name) IN (${targetListsLower.map(() => '?').join(',')})`;
            selectParams.push(...targetListsLower);
          }
          if (targetUnitsLower.length > 0) {
            selectSql += ` AND LOWER(unit_name) IN (${targetUnitsLower.map(() => '?').join(',')})`;
            selectParams.push(...targetUnitsLower);
          }
          if (!effectiveIncludeUnapproved) {
            selectSql += " AND LOWER(status) NOT IN ('unapproved', 'unreviewed', 'in progress', 'pending')";
          }
          if (!effectiveIncludeRejected) {
            selectSql += " AND LOWER(status) NOT LIKE '%reject%'";
          }
          if (dateFrom) {
            selectSql += ' AND work_completed >= ?';
            selectParams.push(dateFrom);
          }
          if (dateTo) {
            selectSql += ' AND work_completed <= ?';
            selectParams.push(dateTo);
          }
          const existingSessions = db.prepare(selectSql).all(...selectParams);
          const toDeleteIds = existingSessions
            .filter(s => !fetchedQATrackIds.has(s.qatrack_instance_id) && !fetchedQATrackIds.has(Number(s.qatrack_instance_id)))
            .map(s => s.id);

          if (toDeleteIds.length > 0) {
            const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
            const deleteValuesStmt = db.prepare('DELETE FROM test_values WHERE session_id = ?');
            const deleteTx = db.transaction((ids) => {
              for (const id of ids) {
                deleteValuesStmt.run(id);
                deleteSessionStmt.run(id);
              }
            });
            deleteTx(toDeleteIds);
            deletedSessionsCount = toDeleteIds.length;
          }
        } catch (recErr) {
          console.warn('Warning: Session reconciliation error:', recErr.message);
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
    const effectiveIncludeUnapproved = options.includeUnapproved !== undefined ? Boolean(options.includeUnapproved) : this.includeUnapproved;
    const effectiveIncludeRejected = options.includeRejected !== undefined ? Boolean(options.includeRejected) : this.includeRejected;

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
      const { unitMap, testListMap, utiMap, utcMap, testInstanceStatusMap, testDefMap } = meta;

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

      const fetchedQATrackIds = new Set();
      let syncedCount = 0;
      const activeUnitsRows = db.prepare('SELECT id, name FROM units WHERE active = 1').all();
      const activeUnitNames = new Set(activeUnitsRows.map(u => u.name.toLowerCase().trim()));

      const processBatch = db.transaction((instBatch) => {
        for (const inst of instBatch) {
          const qatrackId = inst.id || this.extractIdFromUrl(inst.url);
          if (!qatrackId) continue;

          // Inspect all test instances within this session
          const rawTestInstances = Array.isArray(inst.test_instances) ? inst.test_instances : [];
          let hasRejectedTi = false;
          let allRejectedTi = false;
          let hasUnreviewedTi = false;
          let allUnreviewedTi = false;

          if (rawTestInstances.length > 0) {
            let rejCount = 0;
            let unrevCount = 0;
            for (const ti of rawTestInstances) {
              const tiStatusInfo = this.resolveTestInstanceStatus(ti, testInstanceStatusMap);
              if (tiStatusInfo.isRejected) rejCount++;
              if (tiStatusInfo.requiresReview) unrevCount++;
            }
            if (rejCount === rawTestInstances.length) allRejectedTi = true;
            if (rejCount > 0) hasRejectedTi = true;
            if (unrevCount === rawTestInstances.length) allUnreviewedTi = true;
            if (unrevCount > 0) hasUnreviewedTi = true;
          }

          // Determine session status
          let sessionStatus = 'Completed';
          if (inst.status_name) {
            sessionStatus = inst.status_name;
          } else if (typeof inst.status === 'string' && inst.status.trim() && !inst.status.startsWith('http')) {
            sessionStatus = inst.status.trim();
          } else if (allRejectedTi || hasRejectedTi) {
            sessionStatus = 'Rejected';
          } else if (inst.in_progress) {
            sessionStatus = 'In Progress';
          } else if (inst.all_reviewed === false || hasUnreviewedTi) {
            sessionStatus = 'Unapproved';
          } else if (inst.all_reviewed) {
            sessionStatus = 'Approved';
          } else {
            sessionStatus = 'Unapproved';
          }

          const statusLower = sessionStatus.toLowerCase();

          // Filter unapproved data if setting is OFF (off by default)
          if (!effectiveIncludeUnapproved) {
            if (inst.in_progress || inst.all_reviewed === false || hasUnreviewedTi) {
              continue;
            }
            if (statusLower.includes('unapproved') || statusLower.includes('unreviewed') || statusLower.includes('in progress') || statusLower.includes('pending')) {
              continue;
            }
          }

          // Filter rejected data if setting is OFF (off by default)
          if (!effectiveIncludeRejected) {
            if (statusLower.includes('reject') || hasRejectedTi || allRejectedTi) {
              continue;
            }
          }

          fetchedQATrackIds.add(qatrackId);
          fetchedQATrackIds.add(Number(qatrackId));

          let unitName = 'Unknown Machine';
          const utcKey = inst.unit_test_collection !== undefined && inst.unit_test_collection !== null
            ? (typeof inst.unit_test_collection === 'number' ? inst.unit_test_collection : (this.extractIdFromUrl(inst.unit_test_collection) || inst.unit_test_collection))
            : null;
          const colInfo = utcKey ? (utcMap.get(utcKey) || (typeof utcKey === 'number' && utcMap.get(String(utcKey)))) : null;
          if (colInfo?.unitName) {
            unitName = colInfo.unitName;
          } else {
            const resolvedUnit = this.resolveUnitName(inst.unit, unitMap);
            if (resolvedUnit) {
              unitName = resolvedUnit;
            } else if (typeof inst.unit_name === 'string') {
              unitName = inst.unit_name;
            }
          }

          // Do NOT retrieve or ingest non-active units!
          if (!activeUnitNames.has(unitName.toLowerCase().trim())) {
            continue;
          }

          let testListName = colInfo?.testListName ||
            this.resolveTestListName(inst.test_list, testListMap) ||
            (typeof inst.test_list_name === 'string' && inst.test_list_name ? inst.test_list_name : null) ||
            'Patient Specific QA';
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
            sessionStatus,
            inst.comments && inst.comments.length > 0 ? JSON.stringify(inst.comments) : ''
          );

          const sess = getSessionByQATrackId.get(qatrackId);
          if (sess && rawTestInstances.length > 0) {
            deleteOldValues.run(sess.id);
            let validTiCount = 0;

            for (const ti of rawTestInstances) {
              const tiStatusInfo = this.resolveTestInstanceStatus(ti, testInstanceStatusMap);

              if (!effectiveIncludeRejected && tiStatusInfo.isRejected) {
                continue;
              }
              if (!effectiveIncludeUnapproved && tiStatusInfo.requiresReview) {
                continue;
              }

              const tiInfo = this.resolveTestInstanceInfo(ti, utiMap, testDefMap);
              const { numVal, strVal } = this.extractTestInstanceValue(ti);

              insertTestVal.run(
                sess.id,
                tiInfo.testName,
                tiInfo.testSlug,
                strVal,
                numVal,
                tiInfo.unit,
                null,
                null,
                tiStatusInfo.isRejected ? 'Rejected' : (tiStatusInfo.requiresReview ? 'Unreviewed' : (ti.pass_fail || 'OK'))
              );
              validTiCount++;
            }

            if (validTiCount === 0) {
              deleteOldValues.run(sess.id);
              db.prepare('DELETE FROM sessions WHERE id = ?').run(sess.id);
              continue;
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

      // Reconcile deleted sessions on full sync: remove any local sessions that are no longer returned by QATrack+
      let deletedSessionsCount = 0;
      if (!this.syncStatus.isCancelled) {
        try {
          let selectSql = 'SELECT id, qatrack_instance_id FROM sessions WHERE qatrack_instance_id IS NOT NULL';
          if (!effectiveIncludeUnapproved) {
            selectSql += " AND LOWER(status) NOT IN ('unapproved', 'unreviewed', 'in progress', 'pending')";
          }
          if (!effectiveIncludeRejected) {
            selectSql += " AND LOWER(status) NOT LIKE '%reject%'";
          }
          const allDbSessions = db.prepare(selectSql).all();
          const toDeleteIds = allDbSessions
            .filter(s => !fetchedQATrackIds.has(s.qatrack_instance_id) && !fetchedQATrackIds.has(Number(s.qatrack_instance_id)))
            .map(s => s.id);

          if (toDeleteIds.length > 0) {
            const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
            const deleteValuesStmt = db.prepare('DELETE FROM test_values WHERE session_id = ?');
            const deleteTx = db.transaction((ids) => {
              for (const id of ids) {
                deleteValuesStmt.run(id);
                deleteSessionStmt.run(id);
              }
            });
            deleteTx(toDeleteIds);
            deletedSessionsCount = toDeleteIds.length;
          }
        } catch (recErr) {
          console.warn('Warning: Full sync session reconciliation error:', recErr.message);
        }
      }

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
