import React, { useState, useEffect, useMemo } from 'react';
import { Filter, Plus, Trash2, Sliders, Layers, BarChart2, TrendingUp, ScatterChart as ScatterIcon, PieChart, Sparkles, Activity } from 'lucide-react';
import { groupTestsByList } from '../utils/testGrouping';
import SearchableVariableSelect from './SearchableVariableSelect';
import { normalizeFilterGroups } from '../utils/filterUtils';

export default function FilterControls({
  units = [],
  unitClasses = [],
  tests = [],
  years = [],
  selectedUnits,
  onChangeUnits,
  dateFrom,
  dateTo,
  onChangeDates,
  filters,
  onChangeFilters,
  xVariable,
  onChangeXVariable,
  yVariable,
  onChangeYVariable,
  groupBy,
  onChangeGroupBy,
  plotType,
  onChangePlotType,
  onRunQuery,
  isMultiDatasetMode = false,
  onSplitByFilter,
  onSplitByUnit,
  testLists = [],
  selectedTestLists = [],
  onChangeTestLists,
  onChangeIncludeAllInstances,
  isConfigStale = false
}) {
  const [testValuesCache, setTestValuesCache] = useState({});
  const [splittingTest, setSplittingTest] = useState(null);

  // Normalize units list to { name, unitClass, unitType }
  const normalizedUnits = useMemo(() => {
    return units.map(u => {
      if (typeof u === 'string') {
        return { name: u, unitClass: 'General', unitType: '' };
      }
      return {
        name: u.name,
        unitClass: u.unitClass || 'General',
        unitType: u.unitType || '',
        active: u.active !== undefined ? u.active : 1
      };
    });
  }, [units]);

  // Compute available unit classes
  const classList = useMemo(() => {
    const set = new Set();
    if (Array.isArray(unitClasses)) {
      unitClasses.forEach(c => { if (c) set.add(c); });
    }
    normalizedUnits.forEach(u => {
      if (u.unitClass) set.add(u.unitClass);
    });
    const classes = Array.from(set).sort();
    return ['All Classes', ...classes];
  }, [unitClasses, normalizedUnits]);

  const [selectedUnitClass, setSelectedUnitClass] = useState('All Classes');

  // Filter units according to selected unit class
  const displayedUnits = useMemo(() => {
    if (selectedUnitClass === 'All Classes') {
      return normalizedUnits;
    }
    return normalizedUnits.filter(u => u.unitClass === selectedUnitClass);
  }, [normalizedUnits, selectedUnitClass]);

  // Clear cached categorical test values whenever tests metadata updates (e.g. after sync)
  useEffect(() => {
    setTestValuesCache({});
  }, [tests]);

  // Helper to fetch distinct values for a test
  const fetchValuesForTest = async (testName) => {
    if (!testName || testValuesCache[testName]) return;
    try {
      const res = await fetch(`/api/schema/test-values?test_name=${encodeURIComponent(testName)}&_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      setTestValuesCache(prev => ({ ...prev, [testName]: data }));
    } catch (e) {
      console.error(e);
    }
  };

  const normFilters = useMemo(() => normalizeFilterGroups(filters), [filters]);

  const handleUpdateGroupLogic = (newLogic) => {
    onChangeFilters({
      ...normFilters,
      groupLogic: newLogic
    });
  };

  const handleAddGroup = () => {
    const defaultTest = tests.find(t => !t.isNumeric)?.name || tests[0]?.name || 'Site';
    fetchValuesForTest(defaultTest);
    const newGroup = {
      id: `grp-${Date.now()}`,
      logic: 'and',
      conditions: [
        { testName: defaultTest, operator: 'equals', value: '' }
      ]
    };
    onChangeFilters({
      groupLogic: normFilters.groupLogic || 'and',
      groups: [...normFilters.groups, newGroup]
    });
  };

  const handleRemoveGroup = (groupIdx) => {
    const updatedGroups = normFilters.groups.filter((_, i) => i !== groupIdx);
    onChangeFilters({
      groupLogic: normFilters.groupLogic || 'and',
      groups: updatedGroups
    });
  };

  const handleToggleGroupInnerLogic = (groupIdx, logic) => {
    const updatedGroups = normFilters.groups.map((g, i) => i === groupIdx ? { ...g, logic } : g);
    onChangeFilters({
      groupLogic: normFilters.groupLogic || 'and',
      groups: updatedGroups
    });
  };

  const handleAddCondition = (groupIdx = null) => {
    const defaultTest = tests.find(t => !t.isNumeric)?.name || tests[0]?.name || 'Site';
    fetchValuesForTest(defaultTest);
    let updatedGroups = [...normFilters.groups];
    if (updatedGroups.length === 0) {
      updatedGroups = [{
        id: `grp-${Date.now()}`,
        logic: 'and',
        conditions: [
          { testName: defaultTest, operator: 'equals', value: '' }
        ]
      }];
    } else {
      const targetIdx = groupIdx !== null ? groupIdx : updatedGroups.length - 1;
      updatedGroups = updatedGroups.map((g, i) => {
        if (i !== targetIdx) return g;
        return {
          ...g,
          conditions: [
            ...g.conditions,
            { testName: defaultTest, operator: 'equals', value: '' }
          ]
        };
      });
    }
    onChangeFilters({
      groupLogic: normFilters.groupLogic || 'and',
      groups: updatedGroups
    });
  };

  const handleUpdateCondition = (groupIdx, condIdx, field, val) => {
    const updatedGroups = normFilters.groups.map((g, gi) => {
      if (gi !== groupIdx) return g;
      const updatedConds = g.conditions.map((c, ci) => {
        if (ci !== condIdx) return c;
        const next = { ...c, [field]: val };
        if (field === 'testName') {
          fetchValuesForTest(val);
          next.value = '';
        }
        return next;
      });
      return { ...g, conditions: updatedConds };
    });
    onChangeFilters({
      groupLogic: normFilters.groupLogic || 'and',
      groups: updatedGroups
    });
  };

  const handleRemoveCondition = (groupIdx, condIdx) => {
    const updatedGroups = normFilters.groups.map((g, gi) => {
      if (gi !== groupIdx) return g;
      return {
        ...g,
        conditions: g.conditions.filter((_, ci) => ci !== condIdx)
      };
    }).filter(g => g.conditions.length > 0);

    onChangeFilters({
      groupLogic: normFilters.groupLogic || 'and',
      groups: updatedGroups
    });
  };

  const handleSplitFilter = async (testName) => {
    if (!onSplitByFilter) return;
    setSplittingTest(testName);
    try {
      let values = testValuesCache[testName];
      if (!values || values.length === 0) {
        const res = await fetch(`/api/schema/test-values?test_name=${encodeURIComponent(testName)}`);
        values = await res.json();
        if (values) {
          setTestValuesCache(prev => ({ ...prev, [testName]: values }));
        }
      }
      if (values && values.length > 0) {
        onSplitByFilter(testName, values);
      } else {
        alert(`No distinct values found in database for "${testName}".`);
      }
    } catch (err) {
      console.error('Failed to fetch distinct values for splitting:', err);
    } finally {
      setSplittingTest(null);
    }
  };

  const numericTests = tests.filter(t => t.isNumeric);
  const categoricalTests = tests.filter(t => !t.isNumeric);

  return (
    <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* 1. Machine Units & Date Ranges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Machine Unit Class & Units */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', flex: '1 1 500px' }}>
          {/* 1. Unit Class Selection */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <label style={{ fontSize: '0.76rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Layers size={13} color="#64748b" />
                Unit Class
              </label>
              {selectedUnits.length > 0 && (
                <span style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: '600' }}>
                  {selectedUnits.length} selected
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
              {classList.map(cls => {
                const count = cls === 'All Classes'
                  ? normalizedUnits.length
                  : normalizedUnits.filter(u => u.unitClass === cls).length;
                const isSelected = selectedUnitClass === cls;
                return (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setSelectedUnitClass(cls)}
                    style={{
                      padding: '3px 9px',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: isSelected ? '600' : '500',
                      background: isSelected ? '#1e293b' : '#f1f5f9',
                      color: isSelected ? '#ffffff' : '#475569',
                      border: '1px solid ' + (isSelected ? '#1e293b' : '#e2e8f0'),
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{cls}</span>
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '1px 5px',
                      borderRadius: '10px',
                      background: isSelected ? '#334155' : '#e2e8f0',
                      color: isSelected ? '#f8fafc' : '#64748b'
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Units in Selected Class */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>
                  Units {selectedUnitClass !== 'All Classes' ? `(${selectedUnitClass})` : ''}
                </label>
                {selectedUnits.length > 0 && (
                  <span style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: '600' }}>
                    ({selectedUnits.length} selected)
                  </span>
                )}
              </div>

              {isMultiDatasetMode && onSplitByUnit && (
                <button
                  type="button"
                  onClick={() => {
                    const targetUnitsToSplit = selectedUnits.length > 0
                      ? selectedUnits
                      : displayedUnits.map(u => u.name);
                    onSplitByUnit(targetUnitsToSplit);
                  }}
                  title="Create an individual dataset for each machine unit based on currently configured settings"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: '700',
                    background: '#16a34a',
                    color: '#ffffff',
                    border: '1px solid #15803d',
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(22, 163, 74, 0.25)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Layers size={13} />
                  Split by Unit
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => onChangeUnits([])}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: '500',
                  background: selectedUnits.length === 0 ? '#2563eb' : '#f1f5f9',
                  color: selectedUnits.length === 0 ? '#ffffff' : '#475569',
                  border: '1px solid ' + (selectedUnits.length === 0 ? '#2563eb' : '#e2e8f0'),
                  cursor: 'pointer'
                }}
              >
                All Units
              </button>
              {displayedUnits.map(unit => {
                const uName = unit.name;
                const active = selectedUnits.some(s => {
                  if (s === uName) return true;
                  const a = String(s).toLowerCase().trim();
                  const b = String(uName).toLowerCase().trim();
                  return a === b || a.replace(/[\s-_]/g, '') === b.replace(/[\s-_]/g, '');
                });
                return (
                  <button
                    key={uName}
                    type="button"
                    onClick={() => {
                      if (active) {
                        onChangeUnits(selectedUnits.filter(x => {
                          const a = String(x).toLowerCase().trim();
                          const b = String(uName).toLowerCase().trim();
                          return a !== b && a.replace(/[\s-_]/g, '') !== b.replace(/[\s-_]/g, '');
                        }));
                      } else {
                        onChangeUnits([...selectedUnits, uName]);
                      }
                    }}
                    title={unit.unitType ? `${uName} (${unit.unitType}) - Class: ${unit.unitClass}` : `${uName} - Class: ${unit.unitClass}`}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: '500',
                      background: active ? '#2563eb' : '#f1f5f9',
                      color: active ? '#ffffff' : '#475569',
                      border: '1px solid ' + (active ? '#2563eb' : '#e2e8f0'),
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <span>{uName}</span>
                    {unit.unitType && (
                      <span style={{
                        fontSize: '0.68rem',
                        opacity: active ? 0.9 : 0.65,
                        fontStyle: 'italic'
                      }}>
                        ({unit.unitType})
                      </span>
                    )}
                    {unit.active === 0 && (
                      <span style={{
                        fontSize: '0.65rem',
                        opacity: active ? 0.9 : 0.6,
                        color: active ? '#ffffff' : '#64748b',
                        fontStyle: 'italic'
                      }}>
                        (inactive)
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9' }} />

      {/* 2. Dynamic Conditional Filters with Condition Groups (Bracketed Boolean Logic) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={16} color="#2563eb" />
            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#1e293b' }}>
              Conditional Filters
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              (e.g. (Site = Lung OR Site = Bladder) AND Gated = true)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {normFilters.groups.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', background: '#f1f5f9', padding: '2px 6px', borderRadius: '6px' }}>
                <span style={{ color: '#64748b', fontWeight: '600' }}>Between Groups:</span>
                <button
                  type="button"
                  onClick={() => handleUpdateGroupLogic('and')}
                  title="Require ALL condition groups to match (AND)"
                  style={{
                    padding: '2px 7px',
                    borderRadius: '4px',
                    border: 'none',
                    background: normFilters.groupLogic !== 'or' ? '#2563eb' : 'transparent',
                    color: normFilters.groupLogic !== 'or' ? '#ffffff' : '#475569',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  ALL (AND)
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateGroupLogic('or')}
                  title="Require ANY condition group to match (OR)"
                  style={{
                    padding: '2px 7px',
                    borderRadius: '4px',
                    border: 'none',
                    background: normFilters.groupLogic === 'or' ? '#7c3aed' : 'transparent',
                    color: normFilters.groupLogic === 'or' ? '#ffffff' : '#475569',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  ANY (OR)
                </button>
              </div>
            )}

            {onRunQuery && isConfigStale && (
              <button
                type="button"
                onClick={onRunQuery}
                title="Apply filters immediately using local database (no QATrack call)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: '#ea580c',
                  color: '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: '700',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                }}
              >
                ● Apply Filters
              </button>
            )}

            <button
              type="button"
              onClick={() => handleAddCondition()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: '#eff6ff',
                color: '#2563eb',
                fontSize: '0.8rem',
                fontWeight: '600',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <Plus size={14} /> Add Condition
            </button>

            <button
              type="button"
              onClick={handleAddGroup}
              title="Add a separate bracketed group of conditions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: '#f5f3ff',
                color: '#7c3aed',
                fontSize: '0.8rem',
                fontWeight: '600',
                border: '1px solid #ddd6fe',
                cursor: 'pointer'
              }}
            >
              <Plus size={14} /> Add Group (Bracket)
            </button>
          </div>
        </div>

        {normFilters.groups.length === 0 ? (
          <div style={{
            padding: '0.85rem',
            background: '#f8fafc',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
            fontSize: '0.8rem',
            color: '#64748b',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <div>
              No condition filters active. Showing all measurement sessions.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => handleAddCondition()}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  border: '1px solid #bfdbfe',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                + Add Condition Filter
              </button>
              <button
                type="button"
                onClick={handleAddGroup}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: '#f5f3ff',
                  color: '#7c3aed',
                  border: '1px solid #ddd6fe',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                + Add Bracket Group
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {normFilters.groups.map((group, groupIdx) => {
              const isGroupOr = group.logic.toLowerCase() === 'or';
              const isTopOr = (normFilters.groupLogic || 'and').toLowerCase() === 'or';

              return (
                <React.Fragment key={group.id || groupIdx}>
                  {groupIdx > 0 && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      margin: '0.1rem 0'
                    }}>
                      <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
                      <button
                        type="button"
                        onClick={() => handleUpdateGroupLogic(isTopOr ? 'and' : 'or')}
                        title="Click to toggle group conjunction between AND and OR"
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: '800',
                          color: isTopOr ? '#7c3aed' : '#2563eb',
                          background: isTopOr ? '#f5f3ff' : '#eff6ff',
                          border: `1px solid ${isTopOr ? '#ddd6fe' : '#bfdbfe'}`,
                          padding: '2px 10px',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          letterSpacing: '0.5px'
                        }}
                      >
                        {isTopOr ? 'OR (ANY GROUP) ⇅' : 'AND (ALL GROUPS) ⇅'}
                      </button>
                      <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
                    </div>
                  )}

                  <div
                    style={{
                      background: '#ffffff',
                      borderRadius: '8px',
                      border: normFilters.groups.length > 1 ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                      padding: '0.75rem 0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem'
                    }}
                  >
                    {/* Group Header (if multiple groups or multiple conditions in group) */}
                    {(normFilters.groups.length > 1 || group.conditions.length > 1) && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingBottom: '0.35rem',
                        borderBottom: '1px dashed #f1f5f9'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            fontSize: '0.74rem',
                            fontWeight: '800',
                            color: '#334155',
                            background: '#f1f5f9',
                            padding: '1px 7px',
                            borderRadius: '4px',
                            fontFamily: 'monospace'
                          }}>
                            ( Group {groupIdx + 1} )
                          </span>
                          {normFilters.groups.length > 1 && (
                            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                              Bracketed {group.conditions.length > 1 ? `(${group.logic.toUpperCase()})` : ''}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {group.conditions.length > 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', background: '#f8fafc', padding: '1px 5px', borderRadius: '5px', border: '1px solid #e2e8f0' }}>
                              <span style={{ color: '#64748b', fontWeight: '600' }}>Match:</span>
                              <button
                                type="button"
                                onClick={() => handleToggleGroupInnerLogic(groupIdx, 'and')}
                                title="Require ALL conditions inside this bracket to match (AND)"
                                style={{
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  border: 'none',
                                  background: !isGroupOr ? '#2563eb' : 'transparent',
                                  color: !isGroupOr ? '#ffffff' : '#64748b',
                                  fontSize: '0.7rem',
                                  fontWeight: '700',
                                  cursor: 'pointer'
                                }}
                              >
                                ALL (AND)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleGroupInnerLogic(groupIdx, 'or')}
                                title="Require ANY condition inside this bracket to match (OR)"
                                style={{
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  border: 'none',
                                  background: isGroupOr ? '#7c3aed' : 'transparent',
                                  color: isGroupOr ? '#ffffff' : '#64748b',
                                  fontSize: '0.7rem',
                                  fontWeight: '700',
                                  cursor: 'pointer'
                                }}
                              >
                                ANY (OR)
                              </button>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRemoveGroup(groupIdx)}
                            title="Remove entire group"
                            style={{
                              padding: '2px 6px',
                              color: '#ef4444',
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: '600',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <Trash2 size={12} /> Delete Group
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Conditions in Group */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {group.conditions.map((f, condIdx) => {
                        const knownValues = testValuesCache[f.testName] || [];

                        return (
                          <div
                            key={condIdx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              background: '#f8fafc',
                              padding: '6px 10px',
                              borderRadius: '8px',
                              border: '1px solid #e2e8f0',
                              position: 'relative',
                              zIndex: (normFilters.groups.length - groupIdx) * 10 + (group.conditions.length - condIdx)
                            }}
                          >
                            {condIdx === 0 ? (
                              <span style={{
                                fontSize: '0.75rem',
                                fontWeight: '700',
                                color: '#64748b',
                                padding: '3px 8px',
                                background: '#f1f5f9',
                                borderRadius: '5px',
                                minWidth: '50px',
                                textAlign: 'center'
                              }}>
                                WHERE
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleToggleGroupInnerLogic(groupIdx, isGroupOr ? 'and' : 'or')}
                                title="Click to toggle group match between AND and OR"
                                style={{
                                  fontSize: '0.75rem',
                                  fontWeight: '700',
                                  color: isGroupOr ? '#7c3aed' : '#2563eb',
                                  background: isGroupOr ? '#f5f3ff' : '#eff6ff',
                                  border: isGroupOr ? '1px solid #ddd6fe' : '1px solid #bfdbfe',
                                  padding: '3px 8px',
                                  borderRadius: '5px',
                                  minWidth: '50px',
                                  textAlign: 'center',
                                  cursor: 'pointer',
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {isGroupOr ? 'OR ⇅' : 'AND ⇅'}
                              </button>
                            )}

                            {/* Test selector with test list filter and instant search */}
                            <div style={{ minWidth: '220px', maxWidth: '320px', flex: '1 1 220px' }}>
                              <SearchableVariableSelect
                                value={f.testName}
                                onChange={(name) => handleUpdateCondition(groupIdx, condIdx, 'testName', name)}
                                tests={tests}
                                onlyNumeric={false}
                                returnStringOnly={true}
                                compact={true}
                                includeAllInstances={true}
                                placeholder="Select test to filter..."
                              />
                            </div>

                            {/* Operator */}
                            <select
                              value={f.operator}
                              onChange={(e) => handleUpdateCondition(groupIdx, condIdx, 'operator', e.target.value)}
                              style={{
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.82rem',
                                background: '#ffffff'
                              }}
                            >
                              <option value="equals">equals (=)</option>
                              <option value="not_equals">not equals (≠)</option>
                              <option value="contains">contains</option>
                              <option value="gt">greater than (&gt;)</option>
                              <option value="lt">less than (&lt;)</option>
                            </select>

                            {/* Value field with suggestions */}
                            {knownValues.length > 0 ? (
                              <select
                                value={f.value}
                                onChange={(e) => handleUpdateCondition(groupIdx, condIdx, 'value', e.target.value)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.82rem',
                                  background: '#ffffff',
                                  minWidth: '140px'
                                }}
                              >
                                <option value="">-- Choose Value --</option>
                                {knownValues.map(v => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                placeholder="Filter value..."
                                value={f.value}
                                onChange={(e) => handleUpdateCondition(groupIdx, condIdx, 'value', e.target.value)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.82rem',
                                  background: '#ffffff',
                                  width: '160px'
                                }}
                              />
                            )}

                            {/* Split into one dataset per value button */}
                            {onSplitByFilter && (
                              <button
                                type="button"
                                onClick={() => handleSplitFilter(f.testName)}
                                disabled={splittingTest === f.testName}
                                title={`Create one dataset for each distinct value of ${f.testName}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  background: '#ecfdf5',
                                  color: '#059669',
                                  border: '1px solid #a7f3d0',
                                  fontSize: '0.76rem',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                <Sparkles size={13} />
                                {splittingTest === f.testName ? 'Splitting...' : 'Split by Value'}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleRemoveCondition(groupIdx, condIdx)}
                              title="Remove condition"
                              style={{
                                padding: '4px',
                                color: '#ef4444',
                                borderRadius: '4px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer'
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Group Footer: Add Condition inside this Group */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0.2rem' }}>
                      <button
                        type="button"
                        onClick={() => handleAddCondition(groupIdx)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          background: '#f1f5f9',
                          color: '#2563eb',
                          fontSize: '0.74rem',
                          fontWeight: '600',
                          border: '1px dashed #cbd5e1',
                          cursor: 'pointer'
                        }}
                      >
                        <Plus size={12} /> Add Condition in Group
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            {/* Bottom Add Group Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={handleAddGroup}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  background: '#f5f3ff',
                  color: '#7c3aed',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  border: '1px dashed #c4b5fd',
                  cursor: 'pointer'
                }}
              >
                <Plus size={14} /> Add Condition Group (Bracket)
              </button>
            </div>
          </div>
        )}
      </div>

      {!isMultiDatasetMode && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9' }} />

          {/* 3. Variables & Plotting Axis Setup */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end' }}>
        {/* Y-Axis Variable (Primary Measurement) */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
            Measurement Variable (Y-Axis) *
          </label>
          <SearchableVariableSelect
            value={yVariable}
            onChange={(name) => onChangeYVariable(name)}
            tests={numericTests}
            allowDateOption={false}
            returnStringOnly={true}
            includeAllInstances={true}
            placeholder="Select variable (Y-Axis)..."
          />
        </div>

        {/* X-Axis Variable */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
            Comparison Variable (X-Axis)
          </label>
          <SearchableVariableSelect
            value={xVariable}
            onChange={(name) => {
              onChangeXVariable(name);
              if (name === 'work_completed' && plotType === 'scatter') {
                onChangePlotType('trend');
              }
            }}
            tests={numericTests}
            allowDateOption={true}
            returnStringOnly={true}
            includeAllInstances={true}
            placeholder="Select comparison variable (X-Axis)..."
          />
        </div>

        {/* Group By / Category */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
            Group / Color By
          </label>
          <select
            value={groupBy}
            onChange={(e) => onChangeGroupBy(e.target.value)}
            style={{
              width: '100%',
              padding: '0.55rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              background: '#ffffff',
              fontWeight: '500'
            }}
          >
            <option value="unit_name">Treatment Unit / Machine</option>
            {Object.entries(groupTestsByList(categoricalTests)).map(([listName, items]) => (
              <optgroup key={listName} label={`Test List: ${listName}`}>
                {items.map(t => (
                  <option key={t.name} value={t.name}>
                    {t.name} (e.g. Site, Energy)
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="">None (Unified Series)</option>
          </select>
        </div>

        {/* Plot Type Mode */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
            Plot View
          </label>
          <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
            {[
              { id: 'scatter', label: 'Scatter (X vs Y)', icon: ScatterIcon },
              { id: 'trend', label: 'Trend', icon: TrendingUp },
              { id: 'distribution', label: 'Distribution', icon: BarChart2 },
              { id: 'normal', label: 'Normal Curve', icon: Activity }
            ].map(pt => {
              const Icon = pt.icon;
              const isActive = plotType === pt.id;
              return (
                <button
                  key={pt.id}
                  onClick={() => onChangePlotType(pt.id)}
                  title={pt.label}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.4rem',
                    background: isActive ? '#2563eb' : '#ffffff',
                    color: isActive ? '#ffffff' : '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    fontSize: '0.75rem',
                    fontWeight: '600'
                  }}
                >
                  <Icon size={14} />
                  <span>{pt.label.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
