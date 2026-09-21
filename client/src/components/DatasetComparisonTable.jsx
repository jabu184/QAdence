import React, { useState, useMemo } from 'react';
import { Download, Table, CheckCircle2, TrendingUp } from 'lucide-react';
import BoxWhiskerPlot from './BoxWhiskerPlot';
import CorrelationAnalysisPanel from './CorrelationAnalysisPanel';
import { computeLinearRegression, computeMovingAverage, computePolynomialRegression } from '../utils/math';

export default function DatasetComparisonTable({
  datasets = [],
  datasetResults = {},
  ignoredSessionIds = [],
  yVariable,
  xVariable,
  trendlineConfig,
  baselineConfig
}) {
  const ignoredSet = useMemo(() => new Set(ignoredSessionIds), [ignoredSessionIds]);
  const isDateX = !xVariable || xVariable === 'work_completed';
  const [sortKey, setSortKey] = useState(null);
  const [sortOrder, setSortOrder] = useState('asc');

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const sortedDatasets = useMemo(() => {
    if (!sortKey) return datasets;
    return [...datasets].sort((a, b) => {
      const resA = datasetResults[a.id];
      const resB = datasetResults[b.id];
      const statsA = resA?.stats || {};
      const statsB = resB?.stats || {};
      const regA = resA?.regression;
      const regB = resB?.regression;

      let valA, valB;
      switch (sortKey) {
        case 'name':
          valA = (a.name || '').toLowerCase();
          valB = (b.name || '').toLowerCase();
          return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'count':
          valA = statsA.count ?? -1;
          valB = statsB.count ?? -1;
          break;
        case 'mean':
          valA = statsA.mean ?? -Infinity;
          valB = statsB.mean ?? -Infinity;
          break;
        case 'stdDev':
          valA = statsA.stdDev ?? -Infinity;
          valB = statsB.stdDev ?? -Infinity;
          break;
        case 'median':
          valA = statsA.median ?? -Infinity;
          valB = statsB.median ?? -Infinity;
          break;
        case 'min':
          valA = statsA.min ?? -Infinity;
          valB = statsB.min ?? -Infinity;
          break;
        case 'range':
          valA = statsA.range ?? -Infinity;
          valB = statsB.range ?? -Infinity;
          break;
        case 'drift':
          valA = regA?.slope ?? -Infinity;
          valB = regB?.slope ?? -Infinity;
          break;
        case 'r2':
          valA = regA?.r2 ?? -Infinity;
          valB = regB?.r2 ?? -Infinity;
          break;
        default:
          return 0;
      }
      return sortOrder === 'asc' ? (valA > valB ? 1 : valA < valB ? -1 : 0) : (valA < valB ? 1 : valA > valB ? -1 : 0);
    });
  }, [datasets, datasetResults, sortKey, sortOrder]);

  const handleExportComparisonCsv = () => {
    if (datasets.length === 0) return;

    const headers = [
      'Dataset Name',
      'Units',
      'Time Window',
      'Filters',
      'Active Points (N)',
      'Excluded Points',
      `Mean (${yVariable})`,
      'Std Dev (sigma)',
      'Median',
      'Min',
      'Max',
      'Range (Delta)',
      'Trend Slope',
      'R-squared Fit'
    ];

    const rows = datasets.map(ds => {
      const res = datasetResults[ds.id];
      const stats = res?.stats || {};
      const reg = res?.regression || {};

      const unitText = ds.units?.length > 0 ? ds.units.join('; ') : 'All Units';
      const dateText = ds.dateFrom || ds.dateTo ? `${ds.dateFrom || 'Start'} to ${ds.dateTo || 'Present'}` : 'All Time';
      const filterText = ds.filters?.length > 0
        ? ds.filters.map(f => `${f.testName} ${f.operator} ${f.value}`).join(' & ')
        : 'None';

      return [
        `"${ds.name}"`,
        `"${unitText}"`,
        `"${dateText}"`,
        `"${filterText}"`,
        stats.count || 0,
        res?.ignoredCount || 0,
        stats.mean !== undefined ? stats.mean : '',
        stats.stdDev !== undefined ? stats.stdDev : '',
        stats.median !== undefined ? stats.median : '',
        stats.min !== undefined ? stats.min : '',
        stats.max !== undefined ? stats.max : '',
        stats.range !== undefined ? stats.range : '',
        `"${reg.formattedRate || 'N/A'}"`,
        reg.r2 !== undefined ? reg.r2 : 'N/A'
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dataset_comparison_${yVariable.replace(/\s+/g, '_')}_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderHeader = (key, label, align = 'left') => {
    const isSorted = sortKey === key;
    const arrow = isSorted ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ' ↕';
    return (
      <th
        onClick={() => handleSort(key)}
        style={{
          padding: '10px 12px',
          textAlign: align,
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          background: isSorted ? '#edf2f7' : undefined,
          color: isSorted ? '#0f172a' : '#475569'
        }}
        title={`Click to sort by ${label}`}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
          <span>{label}</span>
          <span style={{ fontSize: '0.72rem', color: isSorted ? '#2563eb' : '#94a3b8' }}>{arrow}</span>
        </div>
      </th>
    );
  };

  if (datasets.length === 0) return null;

  return (
    <div className="card" style={{ padding: '1.25rem', marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Table size={18} color="#2563eb" />
          <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
            Multi-Dataset Statistical Benchmarking & Comparison
          </h3>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            ({yVariable})
          </span>
        </div>

        <button
          onClick={handleExportComparisonCsv}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '0.45rem 0.85rem',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            color: '#1e293b',
            fontSize: '0.82rem',
            fontWeight: '600'
          }}
        >
          <Download size={14} /> Export Benchmark CSV
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc', color: '#475569' }}>
              {renderHeader('name', 'Dataset', 'left')}
              <th style={{ padding: '10px 12px' }}>Scope / Filters</th>
              {renderHeader('count', 'Active N', 'right')}
              {renderHeader('mean', 'Mean (μ)', 'right')}
              {renderHeader('stdDev', 'Std Dev (σ)', 'right')}
              {renderHeader('median', 'Median', 'right')}
              {renderHeader('min', '[Min, Max]', 'right')}
              {renderHeader('range', 'Range (Δ)', 'right')}
              {trendlineConfig?.enabled && (
                <>
                  {renderHeader(
                    'drift',
                    trendlineConfig.type === 'polynomial'
                      ? `Poly Fit (d=${trendlineConfig.order || 2})`
                      : (trendlineConfig.type === 'moving_average' ? `Moving Avg (k=${trendlineConfig.windowSize || 5})` : 'Trend Drift Rate'),
                    'right'
                  )}
                  {renderHeader('r2', 'R² Fit', 'right')}
                  {trendlineConfig.forecastEnabled && Number(trendlineConfig.forecastValue) > 0 && (
                    renderHeader('forecast', `Forecast (+${trendlineConfig.forecastValue} ${trendlineConfig.forecastUnit || 'days'})`, 'right')
                  )}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedDatasets.map((ds, idx) => {
              const res = datasetResults[ds.id];
              const stats = res?.stats || {};
              const reg = res?.regression;
              const hasData = stats.count > 0;

              const unitSummary = ds.units?.length > 0 ? ds.units.join(', ') : 'All Units';
              const dateSummary = ds.dateFrom || ds.dateTo
                ? `${ds.dateFrom || 'Start'} to ${ds.dateTo || 'Present'}`
                : 'All Time';
              const filterSummary = ds.filters?.length > 0
                ? ds.filters.map(f => `${f.testName} = ${f.value}`).join('; ')
                : '';

              return (
                <tr
                  key={ds.id}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: idx % 2 === 0 ? '#ffffff' : '#fcfcfd'
                  }}
                >
                  {/* Dataset Name with color dot */}
                  <td style={{ padding: '10px 12px', fontWeight: '600', color: '#0f172a' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '3px',
                          backgroundColor: ds.color || '#2563eb',
                          display: 'inline-block'
                        }}
                      />
                      <span>{ds.name}</span>
                      {!ds.visible && (
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>
                          (hidden)
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Scope summary */}
                  <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '0.78rem' }}>
                    <div><strong>Unit:</strong> {unitSummary}</div>
                    <div><strong>Dates:</strong> {dateSummary}</div>
                    {filterSummary && <div><strong>Filter:</strong> {filterSummary}</div>}
                  </td>

                  {/* Active Points */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600' }}>
                    {stats.count || 0}
                    {res?.ignoredCount > 0 && (
                      <span style={{ fontSize: '0.74rem', color: '#dc2626', display: 'block' }}>
                        (-{res.ignoredCount})
                      </span>
                    )}
                  </td>

                  {/* Mean */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: '#2563eb' }}>
                    {hasData ? stats.mean : '-'}
                  </td>

                  {/* Std Dev */}
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {hasData ? `±${stats.stdDev}` : '-'}
                  </td>

                  {/* Median */}
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {hasData ? stats.median : '-'}
                  </td>

                  {/* Min, Max */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {hasData ? `[${stats.min}, ${stats.max}]` : '-'}
                  </td>

                  {/* Range */}
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {hasData ? stats.range : '-'}
                  </td>

                  {/* Trendline columns */}
                  {trendlineConfig?.enabled && (() => {
                    let driftText = 'N/A';
                    let r2Text = 'N/A';

                    if (trendlineConfig.type === 'polynomial') {
                      const activePts = (res?.dataPoints || []).filter(p => !ignoredSet.has(p.sessionId));
                      const poly = computePolynomialRegression(activePts, trendlineConfig.order || 2, isDateX);
                      if (poly) {
                        driftText = `d=${poly.order}`;
                        r2Text = poly.r2 !== undefined ? poly.r2 : 'N/A';
                      }
                    } else if (trendlineConfig.type === 'moving_average') {
                      driftText = `k=${trendlineConfig.windowSize || 5}`;
                      r2Text = '-';
                    } else {
                      if (reg) {
                        driftText = reg.formattedRate;
                        r2Text = reg.r2 !== undefined ? reg.r2 : 'N/A';
                      }
                    }

                    let forecastText = '-';
                    if (trendlineConfig.forecastEnabled && Number(trendlineConfig.forecastValue) > 0) {
                      const activePts = (res?.dataPoints || []).filter(p => !ignoredSet.has(p.sessionId)).sort((a, b) => a.x - b.x);
                      if (activePts.length >= 2) {
                        const fVal = Number(trendlineConfig.forecastValue);
                        const fUnit = trendlineConfig.forecastUnit || 'days';
                        const delta = isDateX
                          ? (fUnit === 'months' ? fVal * 30.4375 * 86400000 : fVal * 86400000)
                          : fVal;
                        const targetX = activePts[activePts.length - 1].x + delta;

                        if (trendlineConfig.type === 'polynomial') {
                          const poly = computePolynomialRegression(activePts, trendlineConfig.order || 2, isDateX);
                          if (poly && typeof poly.predict === 'function') {
                            forecastText = (Math.round(poly.predict(targetX) * 100) / 100).toFixed(2);
                          }
                        } else if (trendlineConfig.type === 'moving_average') {
                          const k = trendlineConfig.windowSize || 5;
                          const ma = computeMovingAverage(activePts, k);
                          if (ma.length > 0) {
                            forecastText = (Math.round(ma[ma.length - 1].y * 100) / 100).toFixed(2);
                          }
                        } else {
                          const regObj = computeLinearRegression(activePts, isDateX);
                          if (regObj && typeof regObj.predict === 'function') {
                            forecastText = (Math.round(regObj.predict(targetX) * 100) / 100).toFixed(2);
                          }
                        }
                      }
                    }

                    return (
                      <>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '600', color: driftText !== 'N/A' ? '#d97706' : '#94a3b8' }}>
                          {driftText}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: r2Text !== 'N/A' && r2Text !== '-' ? '#334155' : '#94a3b8' }}>
                          {r2Text}
                        </td>
                        {trendlineConfig.forecastEnabled && Number(trendlineConfig.forecastValue) > 0 && (
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: forecastText !== '-' ? '#2563eb' : '#94a3b8' }}>
                            {forecastText}
                          </td>
                        )}
                      </>
                    );
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Box & Whisker Distribution Plot covering each dataset */}
      <BoxWhiskerPlot
        datasets={datasets}
        datasetResults={datasetResults}
        ignoredSessionIds={ignoredSessionIds}
        yVariable={yVariable}
        baselineConfig={baselineConfig}
      />

      {/* Dual-Variable Statistical Correlation & Dependence Analysis */}
      <CorrelationAnalysisPanel
        datasets={datasets}
        datasetResults={datasetResults}
        ignoredSessionIds={ignoredSessionIds}
        xVariable={xVariable}
        yVariable={yVariable}
      />
    </div>
  );
}
