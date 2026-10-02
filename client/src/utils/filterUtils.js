/**
 * Normalizes filter definitions into Condition Groups with bracketed boolean logic support.
 * Ensures 100% backwards compatibility with legacy flat arrays of filters.
 * 
 * @param {any} filters 
 * @returns {{ groupLogic: 'and' | 'or', groups: Array<{ id: string, logic: 'and' | 'or', conditions: Array<{ testName: string, operator: string, value: any }> }> }}
 */
export function normalizeFilterGroups(filters) {
  if (!filters) return { groupLogic: 'and', groups: [] };

  // Case 1: Filter config object { groupLogic, groups }
  if (!Array.isArray(filters) && filters.groups) {
    return {
      groupLogic: (filters.groupLogic || 'and').toLowerCase(),
      groups: filters.groups.map((g, gIdx) => ({
        id: g.id || `grp-${gIdx}-${Math.random().toString(36).substr(2, 7)}`,
        logic: (g.logic || 'and').toLowerCase(),
        conditions: (g.conditions || []).filter(c => c && c.testName)
      })).filter(g => g.conditions.length > 0)
    };
  }

  // Case 2: Array of groups (where elements have .conditions array)
  if (Array.isArray(filters) && filters.length > 0 && filters[0].conditions) {
    return {
      groupLogic: 'and',
      groups: filters.map((g, gIdx) => ({
        id: g.id || `grp-${gIdx}-${Math.random().toString(36).substr(2, 7)}`,
        logic: (g.logic || 'and').toLowerCase(),
        conditions: (g.conditions || []).filter(c => c && c.testName)
      })).filter(g => g.conditions.length > 0)
    };
  }

  // Case 3: Legacy flat array of condition objects [{ testName, operator, value, logic }]
  if (Array.isArray(filters)) {
    const validConditions = filters.filter(c => c && c.testName);
    if (validConditions.length === 0) return { groupLogic: 'and', groups: [] };
    const hasOr = validConditions.some(c => (c.logic || '').toLowerCase() === 'or');
    return {
      groupLogic: 'and',
      groups: [
        {
          id: 'grp-legacy',
          logic: hasOr ? 'or' : 'and',
          conditions: validConditions
        }
      ]
    };
  }

  return { groupLogic: 'and', groups: [] };
}
