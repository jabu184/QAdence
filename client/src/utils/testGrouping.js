/**
 * Groups an array of test objects by their originating test list.
 * Returns an object with test list names as keys and arrays of tests as values.
 * 
 * @param {Array<{ name: string, testList?: string, unit?: string, isNumeric?: boolean }>} tests
 * @returns {Record<string, Array<any>>}
 */
export function groupTestsByList(tests = []) {
  const groups = {};
  for (const t of tests) {
    const list = t.testList || 'General QA';
    if (!groups[list]) {
      groups[list] = [];
    }
    // Avoid duplicate test names within the same group
    if (!groups[list].some(existing => existing.name === t.name)) {
      groups[list].push(t);
    }
  }
  for (const list of Object.keys(groups)) {
    groups[list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
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
 * If a test appears in multiple lists, marks it as isMultiList.
 */
export function getUniqueTests(tests = []) {
  const map = new Map();
  for (const t of tests) {
    if (!map.has(t.name)) {
      map.set(t.name, {
        ...t,
        testLists: [t.testList || 'General QA'],
        isMultiList: false
      });
    } else {
      const existing = map.get(t.name);
      if (!existing.testLists.includes(t.testList)) {
        existing.testLists.push(t.testList);
        existing.isMultiList = true;
      }
      existing.totalCount = (existing.totalCount || 0) + (t.totalCount || 0);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
