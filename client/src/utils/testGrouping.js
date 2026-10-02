/**
 * Enriches an array of tests so that whenever multiple tests share the same display name,
 * their associated macro name (slug) is displayed in brackets.
 * 
 * @param {Array<any>} tests
 * @returns {Array<any>}
 */
export function enrichTestsWithDisplayNames(tests = []) {
  if (!Array.isArray(tests)) return [];
  const nameCounts = new Map();
  for (const t of tests) {
    if (!t || !t.name) continue;
    const nameKey = t.name.trim().toLowerCase();
    nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1);
  }

  return tests.map(t => {
    if (!t) return t;
    const nameKey = (t.name || '').trim().toLowerCase();
    const isDuplicate = (nameCounts.get(nameKey) || 0) > 1;
    let displayNameWithMacro = t.name;
    if (isDuplicate && t.slug) {
      displayNameWithMacro = `${t.name} (${t.slug})`;
    } else if (isDuplicate && t.testList) {
      displayNameWithMacro = `${t.name} (${t.testList})`;
    }
    return {
      ...t,
      displayNameWithMacro,
      displayLabel: displayNameWithMacro
    };
  });
}

/**
 * Returns a friendly display label for a test object.
 * @param {any} test
 * @returns {string}
 */
export function getTestLabel(test) {
  if (!test) return '';
  return test.displayNameWithMacro || test.displayName || test.name || test.slug || '';
}

/**
 * Groups an array of test objects by their originating test list.
 * Returns an object with test list names as keys and arrays of tests as values.
 * 
 * @param {Array<{ name: string, slug?: string, testList?: string, unit?: string, isNumeric?: boolean }>} tests
 * @returns {Record<string, Array<any>>}
 */
export function groupTestsByList(tests = []) {
  const enriched = enrichTestsWithDisplayNames(tests);
  const groups = {};
  for (const t of enriched) {
    const list = t.testList || 'General QA';
    if (!groups[list]) {
      groups[list] = [];
    }
    // Avoid duplicate tests within the same group (matching name AND slug)
    const alreadyExists = groups[list].some(
      existing => existing.name === t.name && (existing.slug || '') === (t.slug || '')
    );
    if (!alreadyExists) {
      groups[list].push(t);
    }
  }
  for (const list of Object.keys(groups)) {
    groups[list].sort((a, b) => (a.displayNameWithMacro || a.name).localeCompare(b.displayNameWithMacro || b.name, undefined, { sensitivity: 'base' }));
  }
  return groups;
}

/**
 * Returns test lists and their tests, with test lists sorted alphabetically
 * and tests within each list sorted alphabetically.
 * @returns {Array<[string, Array<any>]>}
 */
export function getSortedGroupedTests(tests = []) {
  const groups = groupTestsByList(tests);
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Returns a deduplicated list of tests across all test lists.
 * Tests with different slugs are preserved as distinct items.
 * If a test appears in multiple lists, marks it as isMultiList.
 */
export function getUniqueTests(tests = []) {
  const enriched = enrichTestsWithDisplayNames(tests);
  const map = new Map();
  for (const t of enriched) {
    const key = t.slug ? `slug::${t.slug}` : `name::${t.name}`;
    if (!map.has(key)) {
      map.set(key, {
        ...t,
        testLists: [t.testList || 'General QA'],
        isMultiList: false
      });
    } else {
      const existing = map.get(key);
      const listName = t.testList || 'General QA';
      if (!existing.testLists.includes(listName)) {
        existing.testLists.push(listName);
        existing.isMultiList = true;
      }
      existing.totalCount = (existing.totalCount || 0) + (t.totalCount || 0);
      existing.numericCount = (existing.numericCount || 0) + (t.numericCount || 0);
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.displayNameWithMacro || a.name).localeCompare(b.displayNameWithMacro || b.name, undefined, { sensitivity: 'base' }));
}
