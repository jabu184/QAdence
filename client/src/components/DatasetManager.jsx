import React, { useMemo } from 'react';
import { Plus, Trash2, Copy, Eye, EyeOff, Layers, Sliders, TrendingUp, Globe, RefreshCw } from 'lucide-react';
import FilterControls from './FilterControls';
import SearchableVariableSelect from './SearchableVariableSelect';
import { groupTestsByList, getSortedGroupedTests, getUniqueTests } from '../utils/testGrouping';

const PRESET_COLORS = [
  '#2563eb', // Blue
  '#dc2626', // Red
  '#059669', // Emerald
  '#d97706', // Amber
  '#7c3aed', // Purple
  '#0891b2', // Cyan
  '#db2777', // Pink
  '#475569'  // Slate
];

export default function DatasetManager({
  datasets,
  activeDatasetId,
  onSelectDataset,
  onAddDataset,
  onUpdateDataset,
  onDeleteDataset,
  onDuplicateDataset,
  onToggleDatasetVisibility,
  onSplitDatasetByFilter,
  units,
  unitClasses = [],
  tests,
  scopedTests,
  scopedNumericTests,
  years,
  // Global axis, test list scope and trendline settings
  xVariable,
  onChangeXVariable,
  yVariable,
  onChangeYVariable,
  selectedTestList = '',
  onChangeSelectedTestList,
  includeAllInstances = true,
  onChangeIncludeAllInstances,
  displayMode,
  onChangeDisplayMode,
  trendlineConfig,
  onChangeTrendlineConfig,
  // On-demand data retrieval actions
  onRetrieveData,
  isLoading = false,
  totalLoadedRecords = 0,
  hasLoaded = false,
  isConfigStale = false
}) {
  const activeDataset = datasets.find(d => d.id === activeDatasetId) || datasets[0];
  const numericTests = tests.filter(t => t.isNumeric);
  const effectiveScopedNumeric = scopedNumericTests || numericTests;
  const effectiveScopedTests = scopedTests || tests;
  const uniqueNumerics = getUniqueTests(numericTests);

  const selectValue = useMemo(() => {
    if (includeAllInstances) {
      return JSON.stringify({ list: '', name: yVariable });
    }
    const validForY = numericTests.filter(t => t.name === yVariable);
    if (selectedTestList && validForY.some(t => (t.testList || 'General QA') === selectedTestList)) {
      return JSON.stringify({ list: selectedTestList, name: yVariable });
    }
    if (validForY.length > 0) {
      return JSON.stringify({ list: validForY[0].testList || 'General QA', name: yVariable });
    }
    return JSON.stringify({ list: '', name: yVariable });
  }, [includeAllInstances, selectedTestList, yVariable, numericTests]);

  const handleYSelectChange = (e) => {
    try {
      const { list, name } = JSON.parse(e.target.value);
      onChangeYVariable(name);
      if (list === '') {
        if (onChangeSelectedTestList) onChangeSelectedTestList('');
        if (onChangeIncludeAllInstances) onChangeIncludeAllInstances(true);
      } else {
        if (onChangeSelectedTestList) onChangeSelectedTestList(list);
        if (onChangeIncludeAllInstances) onChangeIncludeAllInstances(false);
      }
    } catch {
      onChangeYVariable(e.target.value);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 1. Global Variables & Display Options Bar */}
      <div className="card" style={{ padding: '1rem 1.25rem', background: '#ffffff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end' }}>
          {/* Y-Axis Variable with Search & Filter */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b' }}>
                Measurement Variable (Y-Axis) *
              </label>
            </div>
            <SearchableVariableSelect
              value={{ list: selectedTestList, name: yVariable }}
              onChange={({ list, name }) => {
                onChangeYVariable(name);
                if (list === '') {
                  if (onChangeSelectedTestList) onChangeSelectedTestList('');
                  if (onChangeIncludeAllInstances) onChangeIncludeAllInstances(true);
                } else {
                  if (onChangeSelectedTestList) onChangeSelectedTestList(list);
                  if (onChangeIncludeAllInstances) onChangeIncludeAllInstances(false);
                }
              }}
              tests={numericTests}
              includeAllInstances={includeAllInstances}
              onToggleIncludeAllInstances={onChangeIncludeAllInstances}
              placeholder="Search or select variable..."
            />
          </div>

          {/* X-Axis Variable */}
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
              Comparison Variable (X-Axis)
            </label>
            <SearchableVariableSelect
              value={xVariable}
              onChange={(name) => onChangeXVariable(name)}
              tests={effectiveScopedNumeric}
              allowDateOption={true}
              returnStringOnly={true}
              includeAllInstances={true}
              placeholder="Select comparison variable (X-Axis)..."
            />
          </div>

          {/* Display Mode (Scatter vs Connected Line vs Histogram) */}
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
              Plot Display Style
            </label>
            <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
              {[
                { id: 'scatter', label: 'Scatter (Points)' },
                { id: 'line', label: 'Line (Connected)' },
                { id: 'distribution', label: 'Distribution' }
              ].map(mode => {
                const isActive = displayMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => onChangeDisplayMode(mode.id)}
                    style={{
                      flex: 1,
                      padding: '0.55rem 0.4rem',
                      background: isActive ? '#2563eb' : '#ffffff',
                      color: isActive ? '#ffffff' : '#64748b',
                      fontSize: '0.78rem',
                      fontWeight: '600',
                      textAlign: 'center'
                    }}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trendline Modeling Controls */}
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
              Trendline Overlay
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.82rem',
                fontWeight: '600',
                color: trendlineConfig.enabled ? '#2563eb' : '#64748b',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={trendlineConfig.enabled}
                  onChange={(e) => onChangeTrendlineConfig({ ...trendlineConfig, enabled: e.target.checked })}
                />
                Show Trend
              </label>

              {trendlineConfig.enabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                  <select
                    value={trendlineConfig.type}
                    onChange={(e) => onChangeTrendlineConfig({ ...trendlineConfig, type: e.target.value })}
                    style={{
                      padding: '0.45rem 0.5rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.78rem',
                      background: '#ffffff'
                    }}
                  >
                    <option value="linear">Linear Regression (y = mx + c)</option>
                    <option value="moving_average">Moving Average (Rolling)</option>
                  </select>

                  {trendlineConfig.type === 'moving_average' && (
                    <input
                      type="number"
                      min={2}
                      max={50}
                      title="Moving Average Window Size"
                      value={trendlineConfig.windowSize || 5}
                      onChange={(e) => onChangeTrendlineConfig({ ...trendlineConfig, windowSize: parseInt(e.target.value) || 5 })}
                      style={{
                        width: '50px',
                        padding: '0.45rem 0.35rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.78rem',
                        textAlign: 'center'
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* On-Demand Data Retrieval Action & Status */}
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
              QATrack+ Data
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onRetrieveData && onRetrieveData()}
                disabled={isLoading}
                title="Fetch measurements and analyze data for the configured datasets and variables"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0.52rem 1rem',
                  borderRadius: '8px',
                  background: isLoading ? '#93c5fd' : (isConfigStale ? '#ea580c' : '#2563eb'),
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  border: 'none',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  boxShadow: isConfigStale ? '0 0 0 2px rgba(234, 88, 12, 0.25)' : '0 1px 2px rgba(0,0,0,0.05)',
                  transition: 'all 0.15s ease'
                }}
              >
                <RefreshCw size={14} className={isLoading ? 'spin' : ''} />
                {isLoading
                  ? 'Loading Data...'
                  : (!hasLoaded
                      ? 'Retrieve & Load Data'
                      : (isConfigStale ? '● Update / Load Data' : 'Reload / Retrieve Data')
                    )
                }
              </button>

              {totalLoadedRecords > 0 ? (
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  color: '#059669',
                  background: '#ecfdf5',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid #a7f3d0'
                }}>
                  ✓ {totalLoadedRecords} pts
                </span>
              ) : (
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: '500',
                  color: '#64748b',
                  background: '#f1f5f9',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0'
                }}>
                  {hasLoaded ? '0 pts found' : 'Ready to load'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 1b. Configuration & Loading Status Banners */}
      {!hasLoaded ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '0.65rem 1.25rem',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '10px',
          fontSize: '0.82rem',
          color: '#166534'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>⚙️</span>
            <span>
              Configure all your datasets, machines, and variables above. When finished, click <strong>Retrieve & Load Data</strong> to fetch and plot data.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onRetrieveData && onRetrieveData()}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0.35rem 0.85rem',
              borderRadius: '6px',
              background: '#16a34a',
              color: '#ffffff',
              fontSize: '0.78rem',
              fontWeight: '700',
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
            Retrieve & Load Data
          </button>
        </div>
      ) : isConfigStale ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '0.65rem 1.25rem',
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '10px',
          fontSize: '0.82rem',
          color: '#92400e'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>⚠️</span>
            <span>
              Dataset configuration has changed. Click <strong>Update / Load Data</strong> to re-run analysis with your changes.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onRetrieveData && onRetrieveData()}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0.35rem 0.85rem',
              borderRadius: '6px',
              background: '#ea580c',
              color: '#ffffff',
              fontSize: '0.78rem',
              fontWeight: '700',
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
            Update / Load Data
          </button>
        </div>
      ) : (totalLoadedRecords === 0 && yVariable) ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '0.65rem 1.25rem',
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '10px',
          fontSize: '0.82rem',
          color: '#1e40af'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>ℹ️</span>
            <span>
              No data points found for <strong>{yVariable}</strong> with the current machine/filter scope.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onRetrieveData && onRetrieveData()}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0.35rem 0.85rem',
              borderRadius: '6px',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: '0.78rem',
              fontWeight: '600',
              border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
            Retry Retrieve
          </button>
        </div>
      ) : null}

      {/* 2. Datasets Tab Bar */}
      <div className="card" style={{ padding: '0.75rem 1.25rem', background: '#ffffff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Layers size={17} color="#2563eb" />
            <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#0f172a' }}>
              Data Sets ({datasets.length})
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              — Define individual scopes, machines, and filters to overlay and compare
            </span>
          </div>

          <button
            onClick={onAddDataset}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '0.4rem 0.85rem',
              borderRadius: '6px',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: '0.8rem',
              fontWeight: '600'
            }}
          >
            <Plus size={15} /> Add Data Set
          </button>
        </div>

        {/* Dataset Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {datasets.map(ds => {
            const isSelected = ds.id === activeDatasetId;
            return (
              <div
                key={ds.id}
                onClick={() => onSelectDataset(ds.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: isSelected ? `2px solid ${ds.color || '#2563eb'}` : '1px solid #e2e8f0',
                  background: isSelected ? '#f8fafc' : '#ffffff',
                  boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}
              >
                {/* Color Dot */}
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: ds.color || '#2563eb'
                  }}
                />

                <span style={{ fontSize: '0.82rem', fontWeight: isSelected ? '700' : '500', color: '#0f172a' }}>
                  {ds.name}
                </span>

                {/* Visibility Eye */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDatasetVisibility(ds.id);
                  }}
                  title={ds.visible ? 'Hide from plot' : 'Show on plot'}
                  style={{ color: ds.visible ? '#2563eb' : '#94a3b8', padding: '2px' }}
                >
                  {ds.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>

                {/* Duplicate */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicateDataset(ds.id);
                  }}
                  title="Duplicate this data set"
                  style={{ color: '#64748b', padding: '2px' }}
                >
                  <Copy size={13} />
                </button>

                {/* Delete (if more than 1) */}
                {datasets.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteDataset(ds.id);
                    }}
                    title="Delete data set"
                    style={{ color: '#ef4444', padding: '2px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Active Dataset Editor (Controls for the selected dataset) */}
      {activeDataset && (
        <div className="card" style={{ padding: '1.25rem', borderLeft: `4px solid ${activeDataset.color || '#2563eb'}` }}>
          {/* Dataset Name and Color Picker */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '240px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#475569' }}>
                Dataset Name:
              </label>
              <input
                type="text"
                value={activeDataset.name}
                onChange={(e) => onUpdateDataset(activeDataset.id, { name: e.target.value })}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  color: '#0f172a',
                  width: '260px'
                }}
              />
            </div>

            {/* Color Swatches */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: '600' }}>Color:</span>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onUpdateDataset(activeDataset.id, { color: c })}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '4px',
                    backgroundColor: c,
                    border: activeDataset.color === c ? '2px solid #0f172a' : '1px solid #cbd5e1',
                    transform: activeDataset.color === c ? 'scale(1.15)' : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          {/* Dataset Filters Controls */}
          <FilterControls
            units={units}
            unitClasses={unitClasses}
            tests={effectiveScopedTests}
            years={years}
            selectedUnits={activeDataset.units || []}
            onChangeUnits={(u) => onUpdateDataset(activeDataset.id, { units: u })}
            dateFrom={activeDataset.dateFrom || ''}
            dateTo={activeDataset.dateTo || ''}
            onChangeDates={(from, to) => onUpdateDataset(activeDataset.id, { dateFrom: from, dateTo: to })}
            filters={activeDataset.filters || []}
            onChangeFilters={(f) => onUpdateDataset(activeDataset.id, { filters: f })}
            xVariable={xVariable}
            onChangeXVariable={onChangeXVariable}
            yVariable={yVariable}
            onChangeYVariable={onChangeYVariable}
            plotType={displayMode}
            onChangePlotType={onChangeDisplayMode}
            isMultiDatasetMode={true}
            onSplitByFilter={(testName, values) => onSplitDatasetByFilter && onSplitDatasetByFilter(activeDataset.id, testName, values)}
          />
        </div>
      )}
    </div>
  );
}
