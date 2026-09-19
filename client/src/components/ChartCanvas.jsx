import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  CategoryScale,
  Filler
} from 'chart.js';
import { Scatter, Line, Bar } from 'react-chartjs-2';
import { Download, EyeOff, RotateCcw, AlertCircle, TrendingUp, Activity, RefreshCw } from 'lucide-react';
import { computeLinearRegression, computeMovingAverage } from '../utils/math';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  Filler
);

export default function ChartCanvas({
  datasets = [],
  datasetResults = {},
  xVariable,
  yVariable,
  displayMode = 'scatter', // 'scatter', 'line', 'distribution'
  trendlineConfig = { enabled: false, type: 'linear', windowSize: 5 },
  ignoredSessionIds = [],
  onIgnorePoint,
  onRestoreAllIgnored,
  hasLoaded = true,
  onRetrieveData
}) {
  const chartRef = useRef(null);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, point: null });

  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(prev => (prev.visible ? { ...prev, visible: false } : prev));
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  const ignoredSet = useMemo(() => new Set(ignoredSessionIds), [ignoredSessionIds]);

  // Collect active points per visible dataset
  const visibleDatasets = useMemo(() => {
    return datasets.filter(d => d.visible !== false);
  }, [datasets]);

  // Aggregate active points across all visible datasets
  const activeDatasetData = useMemo(() => {
    const res = {};
    for (const ds of visibleDatasets) {
      const allPts = datasetResults[ds.id]?.dataPoints || [];
      const activePts = allPts.filter(p => !ignoredSet.has(p.sessionId));
      res[ds.id] = activePts;
    }
    return res;
  }, [visibleDatasets, datasetResults, ignoredSet]);

  const totalActivePoints = useMemo(() => {
    return Object.values(activeDatasetData).reduce((sum, pts) => sum + pts.length, 0);
  }, [activeDatasetData]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    const chart = chartRef.current;
    if (!chart) return;

    const nativeEvent = e.nativeEvent || e;
    const elements = chart.getElementsAtEventForMode(nativeEvent, 'nearest', { intersect: true }, false);

    if (elements && elements.length > 0) {
      const { datasetIndex, index } = elements[0];
      const dataset = chart.data.datasets[datasetIndex];
      const pt = dataset?.data[index];
      if (pt && pt.pointMeta) {
        setContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          point: pt.pointMeta
        });
        return;
      }
    }
    setContextMenu({ visible: false, x: 0, y: 0, point: null });
  };

  const handleDownloadPng = () => {
    if (chartRef.current) {
      const url = chartRef.current.toBase64Image();
      const a = document.createElement('a');
      a.href = url;
      a.download = `patient_qa_${yVariable.replace(/\s+/g, '_')}_vs_${xVariable.replace(/\s+/g, '_')}.png`;
      a.click();
    }
  };

  if (visibleDatasets.length === 0 || totalActivePoints === 0) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: '600', color: '#1e293b', marginBottom: '0.5rem' }}>
          No Matching Patient QA Data Points in Selected Datasets
        </div>
        <p style={{ fontSize: '0.85rem' }}>
          Check your active dataset scopes, units, time windows, or conditional filters.
        </p>
      </div>
    );
  }

  const isDateX = !xVariable || xVariable === 'work_completed';

  let chartComponent = null;

  if (displayMode === 'distribution') {
    // Multi-Dataset Histogram / Distribution Comparison
    const allYValues = Object.values(activeDatasetData).flat().map(p => p.y);
    const min = allYValues.length > 0 ? Math.min(...allYValues) : 0;
    const max = allYValues.length > 0 ? Math.max(...allYValues) : 1;
    const binCount = Math.min(10, Math.max(5, Math.floor(Math.sqrt(allYValues.length || 1))));
    const binWidth = (max - min) / binCount || 1;

    const binLabels = Array.from({ length: binCount }, (_, i) => {
      return `${(min + i * binWidth).toFixed(1)} - ${(min + (i + 1) * binWidth).toFixed(1)}`;
    });

    const chartDatasets = visibleDatasets.map(ds => {
      const pts = activeDatasetData[ds.id] || [];
      const counts = new Array(binCount).fill(0);

      pts.forEach(p => {
        let idx = Math.floor((p.y - min) / binWidth);
        if (idx >= binCount) idx = binCount - 1;
        if (idx < 0) idx = 0;
        counts[idx]++;
      });

      return {
        label: `${ds.name} (n=${pts.length})`,
        data: counts,
        backgroundColor: ds.color || '#2563eb',
        borderRadius: 4
      };
    });

    const barData = {
      labels: binLabels,
      datasets: chartDatasets
    };

    const barOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            title: (items) => `Range: ${items[0].label}`,
            label: (item) => `${item.dataset.label}: ${item.raw} sessions`
          }
        }
      },
      scales: {
        x: { title: { display: true, text: `${yVariable} Range` } },
        y: { title: { display: true, text: 'Number of Sessions' }, beginAtZero: true, ticks: { precision: 0 } }
      }
    };

    chartComponent = <Bar ref={chartRef} data={barData} options={barOptions} />;
  } else {
    // Scatter or Line Plot
    const isLineMode = displayMode === 'line';
    const chartDatasets = [];

    visibleDatasets.forEach(ds => {
      const pts = activeDatasetData[ds.id] || [];
      const sortedPts = [...pts].sort((a, b) => a.x - b.x);

      // 1. Primary Data Series
      chartDatasets.push({
        label: `${ds.name} (${pts.length})`,
        data: sortedPts.map(p => ({
          x: p.x,
          y: p.y,
          pointMeta: p
        })),
        borderColor: ds.color || '#2563eb',
        backgroundColor: ds.color || '#2563eb',
        showLine: isLineMode,
        borderWidth: isLineMode ? 2 : 0,
        pointRadius: isLineMode ? 4 : 6,
        pointHoverRadius: 8,
        tension: isLineMode ? 0.1 : 0,
        fill: false
      });

      // 2. Trendline Overlay (if enabled)
      if (trendlineConfig?.enabled && sortedPts.length >= 2) {
        if (trendlineConfig.type === 'linear') {
          const reg = computeLinearRegression(sortedPts, isDateX);
          if (reg) {
            const firstPt = sortedPts[0];
            const lastPt = sortedPts[sortedPts.length - 1];
            const trendPts = [
              {
                x: firstPt.x,
                y: Math.round(reg.trendPoints[0].y * 1000) / 1000
              },
              {
                x: lastPt.x,
                y: Math.round(reg.trendPoints[1].y * 1000) / 1000
              }
            ];

            chartDatasets.push({
              label: `${ds.name} Trend (${reg.formattedRate}, R²=${reg.r2})`,
              data: trendPts,
              borderColor: ds.color || '#2563eb',
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 0,
              showLine: true,
              fill: false
            });
          }
        } else if (trendlineConfig.type === 'moving_average') {
          const k = trendlineConfig.windowSize || 5;
          const ma = computeMovingAverage(sortedPts, k);
          if (ma.length > 0) {
            chartDatasets.push({
              label: `${ds.name} Moving Avg (k=${k})`,
              data: ma.map((m, idx) => ({
                x: sortedPts[idx + k - 1]?.x,
                y: m.y
              })),
              borderColor: ds.color || '#2563eb',
              borderDash: [4, 4],
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 0,
              showLine: true,
              fill: false
            });
          }
        }
      }
    });

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            title: (items) => `${items[0].dataset.label}`,
            afterTitle: (items) => {
              const meta = items[0].raw?.pointMeta?.metadata || {};
              if (!meta.sessionId) return '';
              const lines = [];
              if (meta.testList) lines.push(`Test List: ${meta.testList}`);
              if (meta['Patient ID'] || meta['Patient QA Patient ID']) lines.push(`Patient ID: ${meta['Patient ID'] || meta['Patient QA Patient ID']}`);
              if (meta['Plan Name']) lines.push(`Plan: ${meta['Plan Name']}`);
              if (meta.date) lines.push(`Date: ${meta.date.substring(0, 10)}`);
              if (meta.unit) lines.push(`Unit: ${meta.unit}`);
              if (meta['Site'] || meta['Patient QA Site']) lines.push(`Site: ${meta['Site'] || meta['Patient QA Site']}`);
              if (meta['Beam Energy'] || meta['Energy']) lines.push(`Energy: ${meta['Beam Energy'] || meta['Energy']}`);
              return lines.join('\n');
            },
            label: (item) => {
              const xVal = isDateX
                ? (item.raw?.pointMeta?.date ? item.raw.pointMeta.date.substring(0, 10) : new Date(item.raw.x).toLocaleDateString())
                : item.raw.x;
              const yVal = item.raw.y;
              return `${isDateX ? 'Date' : xVariable}: ${xVal} | ${yVariable}: ${yVal}`;
            },
            afterLabel: () => '💡 Right-click to ignore this point'
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: isDateX ? 'Work Completed Date' : xVariable
          },
          ticks: isDateX ? {
            callback: (val) => {
              const d = new Date(val);
              if (isNaN(d.getTime())) return '';
              return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            }
          } : undefined
        },
        y: {
          type: 'linear',
          title: {
            display: true,
            text: yVariable
          }
        }
      }
    };

    chartComponent = <Line ref={chartRef} data={{ datasets: chartDatasets }} options={options} />;
  }

  const ignoredCount = ignoredSessionIds.length;

  if (!hasLoaded && totalActivePoints === 0) {
    return (
      <div className="card" style={{ padding: '3.5rem 1.5rem', textAlign: 'center', background: '#ffffff', borderRadius: '12px' }}>
        <div style={{
          width: '52px',
          height: '52px',
          borderRadius: '14px',
          background: '#eff6ff',
          color: '#2563eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.25rem'
        }}>
          <Activity size={26} />
        </div>
        <h3 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.5rem' }}>
          Ready to Analyze Data
        </h3>
        <p style={{ color: '#64748b', fontSize: '0.88rem', maxWidth: '460px', margin: '0 auto 1.5rem', lineHeight: '1.5' }}>
          Configure your datasets, machine scopes, and measurement fields above. Click below whenever you want to retrieve records and plot the analytics.
        </p>
        <button
          type="button"
          onClick={() => onRetrieveData && onRetrieveData()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0.65rem 1.35rem',
            borderRadius: '8px',
            background: '#2563eb',
            color: '#ffffff',
            fontSize: '0.88rem',
            fontWeight: '700',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)'
          }}
        >
          <RefreshCw size={16} /> Retrieve & Load Data
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Excluded Points Notice */}
      {ignoredCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          padding: '8px 14px',
          fontSize: '0.84rem',
          color: '#92400e'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} color="#d97706" />
            <span>
              <strong>{ignoredCount} data point{ignoredCount > 1 ? 's' : ''}</strong> excluded across datasets.
            </span>
          </div>
          <button
            onClick={onRestoreAllIgnored}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 10px',
              borderRadius: '6px',
              background: '#ffffff',
              border: '1px solid #d97706',
              color: '#b45309',
              fontWeight: '600',
              fontSize: '0.78rem'
            }}
          >
            <RotateCcw size={13} /> Restore All
          </button>
        </div>
      )}

      {/* Main Chart Card */}
      <div className="card" style={{ padding: '1.25rem', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#0f172a' }}>
              {yVariable} {isDateX ? 'Over Time (Time-Series)' : `vs. ${xVariable}`}
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Comparing <strong>{visibleDatasets.length}</strong> data set{visibleDatasets.length > 1 ? 's' : ''} ({totalActivePoints} active points) • Style: <strong style={{ textTransform: 'capitalize' }}>{displayMode}</strong>
              <span style={{ marginLeft: '8px', color: '#0284c7' }}>
                (💡 Right-click any point on the chart to ignore it)
              </span>
            </p>
          </div>

          <button
            onClick={handleDownloadPng}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              fontSize: '0.8rem',
              fontWeight: '500',
              color: '#334155'
            }}
          >
            <Download size={14} /> Export PNG
          </button>
        </div>

        <div
          onContextMenu={handleContextMenu}
          style={{ height: '440px', width: '100%', position: 'relative' }}
        >
          {chartComponent}
        </div>
      </div>

      {/* Right-Click Context Menu Popup */}
      {contextMenu.visible && contextMenu.point && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000,
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
            minWidth: '220px',
            padding: '4px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '8px 10px', fontSize: '0.75rem', color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontWeight: '700', color: '#0f172a' }}>
              {contextMenu.point.metadata?.['Patient ID'] || contextMenu.point.metadata?.['Patient QA Patient ID'] || `Session #${contextMenu.point.sessionId}`}
            </div>
            <div>{contextMenu.point.unit} • {contextMenu.point.date?.substring(0, 10)}</div>
            <div style={{ color: '#2563eb', marginTop: '2px' }}>
              {yVariable}: <strong>{contextMenu.point.y}</strong>
            </div>
          </div>
          <button
            onClick={() => {
              if (onIgnorePoint) onIgnorePoint(contextMenu.point.sessionId);
              setContextMenu({ visible: false, x: 0, y: 0, point: null });
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              fontSize: '0.82rem',
              fontWeight: '600',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '4px',
              marginTop: '2px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <EyeOff size={14} /> Ignore / Exclude Point
          </button>
        </div>
      )}
    </div>
  );
}
