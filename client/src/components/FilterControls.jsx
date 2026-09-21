import React, { useState, useEffect, useMemo } from 'react';
import { Filter, Plus, Trash2, Sliders, Layers, BarChart2, TrendingUp, ScatterChart as ScatterIcon, PieChart, Sparkles, Activity } from 'lucide-react';
import { groupTestsByList } from '../utils/testGrouping';
import SearchableVariableSelect from './SearchableVariableSelect';

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
        unitType: u.unitType || ''
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

  // Helper to fetch distinct values for a test
  const fetchValuesForTest = async (testName) => {
    if (!testName || testValuesCache[testName]) return;
    try {
      const res = await fetch(`/api/schema/test-values?test_name=${encodeURIComponent(testName)}`);
      const data = await res.json();
      setTestValuesCache(prev => ({ ...prev, [testName]: data }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddFilter = () => {
    // Default to the first categorical test if available, or first test
    const defaultTest = tests.find(t => !t.isNumeric)?.name || tests[0]?.name || 'Site';
    fetchValuesForTest(defaultTest);
    onChangeFilters([
      ...filters,
      { testName: defaultTest, operator: 'equals', value: '' }
    ]);
  };

  const handleUpdateFilter = (index, field, val) => {
    const updated = [...filters];
    updated[index] = { ...updated[index], [field]: val };
    if (field === 'testName') {
      fetchValuesForTest(val);
      updated[index].value = ''; // reset value when test name changes
    }
    onChangeFilters(updated);
  };

  const handleRemoveFilter = (index) => {
    onChangeFilters(filters.filter((_, i) => i !== index));
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
                const active = selectedUnits.includes(uName);
                return (
                  <button
                    key={uName}
                    type="button"
                    onClick={() => {
                      if (active) {
                        onChangeUnits(selectedUnits.filter(x => x !== uName));
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
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Date Presets & Year Filter */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: '0.4rem' }}>
            Time Window & Year
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            <button
              onClick={() => onChangeDates('', '')}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                background: (!dateFrom && !dateTo) ? '#eff6ff' : '#f8fafc',
                color: (!dateFrom && !dateTo) ? '#2563eb' : '#64748b',
                border: '1px solid ' + ((!dateFrom && !dateTo) ? '#2563eb' : '#e2e8f0'),
                fontWeight: (!dateFrom && !dateTo) ? '600' : 'normal'
              }}
            >
              All Time
            </button>

            {/* Current Year */}
            <button
              onClick={() => {
                const cy = new Date().getFullYear();
                onChangeDates(`${cy}-01-01`, `${cy}-12-31`);
              }}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                background: (dateFrom === `${new Date().getFullYear()}-01-01` && dateTo === `${new Date().getFullYear()}-12-31`) ? '#eff6ff' : '#f8fafc',
                color: (dateFrom === `${new Date().getFullYear()}-01-01` && dateTo === `${new Date().getFullYear()}-12-31`) ? '#2563eb' : '#64748b',
                border: '1px solid ' + ((dateFrom === `${new Date().getFullYear()}-01-01` && dateTo === `${new Date().getFullYear()}-12-31`) ? '#2563eb' : '#e2e8f0'),
                fontWeight: (dateFrom === `${new Date().getFullYear()}-01-01`) ? '600' : 'normal'
              }}
            >
              Current Year ({new Date().getFullYear()})
            </button>

            {/* Specific Year Selector */}
            <select
              value={
                (dateFrom && dateTo && dateFrom.startsWith(dateFrom.substring(0, 4)) && dateTo.startsWith(dateFrom.substring(0, 4)) && dateFrom.endsWith('-01-01') && dateTo.endsWith('-12-31'))
                  ? dateFrom.substring(0, 4)
                  : ''
              }
              onChange={(e) => {
                const yr = e.target.value;
                if (!yr) {
                  onChangeDates('', '');
                } else {
                  onChangeDates(`${yr}-01-01`, `${yr}-12-31`);
                }
              }}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                color: '#334155'
              }}
            >
              <option value="">-- Select Year --</option>
              {years.map(yr => (
                <option key={yr} value={yr}>Year {yr}</option>
              ))}
            </select>

            {/* 30 & 90 Days */}
            {[
              { label: '30 Days', days: 30 },
              { label: '90 Days', days: 90 }
            ].map(p => (
              <button
                key={p.label}
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - p.days);
                  onChangeDates(d.toISOString().split('T')[0], '');
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  background: '#f8fafc',
                  color: '#64748b',
                  border: '1px solid #e2e8f0'
                }}
              >
                {p.label}
              </button>
            ))}

            {/* Custom Dates Inputs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: '0.2rem' }}>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => onChangeDates(e.target.value, dateTo)}
                title="Start Date (From)"
                style={{
                  padding: '3px 6px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.78rem'
                }}
              />
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>-</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => onChangeDates(dateFrom, e.target.value)}
                title="End Date (To)"
                style={{
                  padding: '3px 6px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.78rem'
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9' }} />

      {/* 2. Dynamic Conditional Filters ("Measurements of a particular type") */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={16} color="#2563eb" />
            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#1e293b' }}>
              Conditional Filters
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              (e.g. Extract measurements where Site = 'Prostate' or Energy = '6MV')
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              onClick={handleAddFilter}
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
              <Plus size={14} /> Add Condition Filter
            </button>
          </div>
        </div>

        {filters.length === 0 ? (
          <div style={{
            padding: '0.75rem',
            background: '#f8fafc',
            borderRadius: '8px',
            border: '1px dashed #cbd5e1',
            fontSize: '0.8rem',
            color: '#64748b',
            textAlign: 'center'
          }}>
            No condition filters active. Showing all measurement sessions. Click <strong>"+ Add Condition Filter"</strong> to filter by Site, Delivery Technique, Beam Energy, etc.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {filters.map((f, idx) => {
              const knownValues = testValuesCache[f.testName] || [];
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: '#f8fafc',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    position: 'relative',
                    zIndex: filters.length - idx + 10
                  }}
                >
                  <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#64748b' }}>WHERE</span>

                  {/* Test selector with test list filter and instant search */}
                  <div style={{ minWidth: '220px', maxWidth: '320px', flex: '1 1 220px' }}>
                    <SearchableVariableSelect
                      value={f.testName}
                      onChange={(name) => handleUpdateFilter(idx, 'testName', name)}
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
                    onChange={(e) => handleUpdateFilter(idx, 'operator', e.target.value)}
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
                      onChange={(e) => handleUpdateFilter(idx, 'value', e.target.value)}
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
                      onChange={(e) => handleUpdateFilter(idx, 'value', e.target.value)}
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
                    onClick={() => handleRemoveFilter(idx)}
                    title="Remove Filter"
                    style={{
                      padding: '4px',
                      color: '#ef4444',
                      borderRadius: '4px'
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
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
