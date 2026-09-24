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
import { Download, EyeOff, RotateCcw, AlertCircle, Activity, RefreshCw, Target, FilterX, ListChecks } from 'lucide-react';
import {
  computeLinearRegression,
  computeMovingAverage,
  computePolynomialRegression,
  computeNormalDistribution,
  generateForecastPoints
} from '../utils/math';

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
  displayMode = 'scatter', // 'scatter', 'line', 'distribution', 'normal'
  trendlineConfig = { enabled: false, type: 'linear', windowSize: 5 },
  baselineConfig = { enabled: false, baseline: '', upperTol: '', lowerTol: '', symmetric: true },
  onChangeBaselineConfig,
  ignoredSessionIds = [],
  onIgnorePoint,
  onRestoreAllIgnored,
  onRemoveOutliers,
  onInspectSession,
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

  // Baseline & Tolerance parsed configuration
  const baselineInfo = useMemo(() => {
    if (!baselineConfig || !baselineConfig.enabled) return null;
    const bVal = baselineConfig.baseline !== '' && baselineConfig.baseline !== undefined && !isNaN(Number(baselineConfig.baseline))
      ? parseFloat(baselineConfig.baseline)
      : null;
    if (bVal === null) return null;

    const uTol = baselineConfig.upperTol !== '' && baselineConfig.upperTol !== undefined && !isNaN(Number(baselineConfig.upperTol))
      ? Math.abs(parseFloat(baselineConfig.upperTol))
      : null;

    const lTol = baselineConfig.symmetric !== false
      ? uTol
      : (baselineConfig.lowerTol !== '' && baselineConfig.lowerTol !== undefined && !isNaN(Number(baselineConfig.lowerTol))
          ? Math.abs(parseFloat(baselineConfig.lowerTol))
          : null);

    const upperLimit = uTol !== null ? bVal + uTol : null;
    const lowerLimit = lTol !== null ? bVal - lTol : null;

    return {
      baseline: bVal,
      upperTol: uTol,
      lowerTol: lTol,
      upperLimit,
      lowerLimit
    };
  }, [baselineConfig]);

  // Chart.js Canvas plugin for horizontal shaded tolerance band (Scatter/Line)
  const horizontalToleranceBandPlugin = useMemo(() => {
    if (!baselineInfo || (baselineInfo.upperLimit === null && baselineInfo.lowerLimit === null)) {
      return null;
    }
    const topVal = baselineInfo.upperLimit !== null ? baselineInfo.upperLimit : baselineInfo.baseline;
    const bottomVal = baselineInfo.lowerLimit !== null ? baselineInfo.lowerLimit : baselineInfo.baseline;

    return {
      id: 'horizontalToleranceBand',
      beforeDatasetsDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        const yScale = scales?.y;
        if (!ctx || !chartArea || !yScale) return;

        const topPixel = yScale.getPixelForValue(topVal);
        const bottomPixel = yScale.getPixelForValue(bottomVal);
        if (isNaN(topPixel) || isNaN(bottomPixel)) return;

        const y = Math.min(topPixel, bottomPixel);
        const height = Math.abs(bottomPixel - topPixel);
        const width = chartArea.width || (chartArea.right - chartArea.left);

        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, width, chartArea.height || (chartArea.bottom - chartArea.top));
        ctx.clip();
        ctx.fillStyle = 'rgba(34, 197, 94, 0.18)'; // Vivid green shaded area matching box & whisker
        ctx.fillRect(chartArea.left, y, width, height);
        ctx.restore();
      }
    };
  }, [baselineInfo]);

  // Chart.js Canvas plugin for vertical shaded tolerance band (Normal Distribution)
  const verticalToleranceBandPlugin = useMemo(() => {
    if (!baselineInfo || (baselineInfo.upperLimit === null && baselineInfo.lowerLimit === null)) {
      return null;
    }
    const leftVal = baselineInfo.lowerLimit !== null ? baselineInfo.lowerLimit : baselineInfo.baseline;
    const rightVal = baselineInfo.upperLimit !== null ? baselineInfo.upperLimit : baselineInfo.baseline;

    return {
      id: 'verticalToleranceBand',
      beforeDatasetsDraw: (chart) => {
        const { ctx, chartArea, scales } = chart;
        const xScale = scales?.x;
        if (!ctx || !chartArea || !xScale) return;

        const leftPixel = xScale.getPixelForValue(leftVal);
        const rightPixel = xScale.getPixelForValue(rightVal);
        if (isNaN(leftPixel) || isNaN(rightPixel)) return;

        const x = Math.min(leftPixel, rightPixel);
        const width = Math.abs(rightPixel - leftPixel);
        const height = chartArea.height || (chartArea.bottom - chartArea.top);

        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width || (chartArea.right - chartArea.left), height);
        ctx.clip();
        ctx.fillStyle = 'rgba(34, 197, 94, 0.18)'; // Vivid green shaded area
        ctx.fillRect(x, chartArea.top, width, height);
        ctx.restore();
      }
    };
  }, [baselineInfo]);

  const handleChartClick = (e) => {
    if (e.button !== 0) return;
    const chart = chartRef.current;
    if (!chart) return;
    const nativeEvent = e.nativeEvent || e;
    const elements = chart.getElementsAtEventForMode(nativeEvent, 'nearest', { intersect: true }, false);
    if (elements && elements.length > 0) {
      const { datasetIndex, index } = elements[0];
      const dataset = chart.data?.datasets?.[datasetIndex];
      const pt = dataset?.data?.[index];
      if (pt && pt.pointMeta?.sessionId) {
        onInspectSession && onInspectSession(pt.pointMeta.sessionId);
      }
    }
  };

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
  } else if (displayMode === 'normal') {
    // Multi-Dataset Normal Distribution (Gaussian Bell Curve)
    const normalDatasets = [];
    let minNormX = Infinity;
    let maxNormX = -Infinity;
    let maxDensity = 0;

    const computedDistributions = visibleDatasets.map(ds => {
      const pts = activeDatasetData[ds.id] || [];
      const yVals = pts.map(p => p.y);
      const norm = computeNormalDistribution(yVals);
      if (norm) {
        const dsMin = norm.mean - 3.5 * norm.stdDev;
        const dsMax = norm.mean + 3.5 * norm.stdDev;
        if (dsMin < minNormX) minNormX = dsMin;
        if (dsMax > maxNormX) maxNormX = dsMax;
        const peak = norm.pdf(norm.mean);
        if (peak > maxDensity) maxDensity = peak;
      }
      return { ds, norm };
    });

    if (baselineInfo) {
      if (baselineInfo.baseline < minNormX) minNormX = baselineInfo.baseline;
      if (baselineInfo.baseline > maxNormX) maxNormX = baselineInfo.baseline;
      if (baselineInfo.lowerLimit !== null && baselineInfo.lowerLimit < minNormX) minNormX = baselineInfo.lowerLimit;
      if (baselineInfo.upperLimit !== null && baselineInfo.upperLimit > maxNormX) maxNormX = baselineInfo.upperLimit;
    }

    if (minNormX === Infinity || maxNormX === -Infinity || minNormX === maxNormX) {
      minNormX = 0;
      maxNormX = 1;
    }

    const span = maxNormX - minNormX || 1;
    const domainMin = minNormX - span * 0.05;
    const domainMax = maxNormX + span * 0.05;

    computedDistributions.forEach(({ ds, norm }) => {
      if (!norm) return;
      const curvePoints = [];
      const steps = 100;
      const step = (domainMax - domainMin) / (steps - 1);
      for (let i = 0; i < steps; i++) {
        const x = domainMin + i * step;
        curvePoints.push({
          x: Math.round(x * 1000) / 1000,
          y: norm.pdf(x)
        });
      }

      normalDatasets.push({
        label: `${ds.name} (μ=${norm.mean}, σ=${norm.stdDev})`,
        data: curvePoints,
        borderColor: ds.color || '#2563eb',
        backgroundColor: ds.color ? `${ds.color}20` : 'rgba(37, 99, 235, 0.12)',
        fill: true,
        showLine: true,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3
      });
    });

    if (baselineInfo) {
      const maxY = (maxDensity || 1) * 1.15;
      normalDatasets.push({
        label: `Baseline (${baselineInfo.baseline})`,
        data: [{ x: baselineInfo.baseline, y: 0 }, { x: baselineInfo.baseline, y: maxY }],
        borderColor: '#10b981',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        showLine: true,
        fill: false
      });

      if (baselineInfo.upperLimit !== null) {
        normalDatasets.push({
          label: `+Tol (${baselineInfo.upperLimit})`,
          data: [{ x: baselineInfo.upperLimit, y: 0 }, { x: baselineInfo.upperLimit, y: maxY }],
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          showLine: true,
          fill: false
        });
      }

      if (baselineInfo.lowerLimit !== null) {
        normalDatasets.push({
          label: `-Tol (${baselineInfo.lowerLimit})`,
          data: [{ x: baselineInfo.lowerLimit, y: 0 }, { x: baselineInfo.lowerLimit, y: maxY }],
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          showLine: true,
          fill: false
        });
      }
    }

    const normalOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            title: (items) => `${yVariable}: ${items[0].raw?.x}`,
            label: (item) => `${item.dataset.label}: density ${Number(item.raw?.y).toFixed(4)}`
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: `${yVariable} Value` }
        },
        y: {
          type: 'linear',
          beginAtZero: true,
          title: { display: true, text: 'Probability Density' }
        }
      }
    };

    chartComponent = (
      <Line
        ref={chartRef}
        data={{ datasets: normalDatasets }}
        options={normalOptions}
        plugins={verticalToleranceBandPlugin ? [verticalToleranceBandPlugin] : []}
      />
    );
  } else {
    // Scatter or Line Plot
    const isLineMode = displayMode === 'line';
    const chartDatasets = [];
    const allXValues = [];

    visibleDatasets.forEach(ds => {
      const pts = activeDatasetData[ds.id] || [];
      const sortedPts = [...pts].sort((a, b) => a.x - b.x);
      sortedPts.forEach(p => allXValues.push(p.x));

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

            // Linear Trend Forecast
            if (trendlineConfig.forecastEnabled && Number(trendlineConfig.forecastValue) > 0) {
              const fVal = Number(trendlineConfig.forecastValue);
              const fUnit = trendlineConfig.forecastUnit || 'days';
              const msPerDay = 24 * 60 * 60 * 1000;
              const forecastDelta = isDateX ? (fUnit === 'months' ? fVal * 30.4375 : fVal) * msPerDay : fVal;
              const forecastPts = generateForecastPoints(reg, lastPt.x, forecastDelta, 20);
              if (forecastPts.length > 0) {
                chartDatasets.push({
                  label: `${ds.name} Forecast (+${fVal} ${fUnit})`,
                  data: forecastPts,
                  borderColor: ds.color || '#2563eb',
                  borderDash: [2, 4],
                  borderWidth: 2,
                  pointRadius: 0,
                  pointHoverRadius: 0,
                  showLine: true,
                  fill: false
                });
                allXValues.push(forecastPts[forecastPts.length - 1].x);
              }
            }
          }
        } else if (trendlineConfig.type === 'polynomial') {
          const order = trendlineConfig.order || 2;
          const poly = computePolynomialRegression(sortedPts, order, isDateX);
          if (poly && poly.trendPoints?.length > 0) {
            chartDatasets.push({
              label: `${ds.name} Poly (Order ${order}, R²=${poly.r2})`,
              data: poly.trendPoints,
              borderColor: ds.color || '#2563eb',
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 0,
              showLine: true,
              tension: 0.15,
              fill: false
            });

            // Polynomial Trend Forecast
            if (trendlineConfig.forecastEnabled && Number(trendlineConfig.forecastValue) > 0) {
              const fVal = Number(trendlineConfig.forecastValue);
              const fUnit = trendlineConfig.forecastUnit || 'days';
              const msPerDay = 24 * 60 * 60 * 1000;
              const forecastDelta = isDateX ? (fUnit === 'months' ? fVal * 30.4375 : fVal) * msPerDay : fVal;
              const lastPt = sortedPts[sortedPts.length - 1];
              const forecastPts = generateForecastPoints(poly, lastPt.x, forecastDelta, 25);
              if (forecastPts.length > 0) {
                chartDatasets.push({
                  label: `${ds.name} Poly Forecast (+${fVal} ${fUnit})`,
                  data: forecastPts,
                  borderColor: ds.color || '#2563eb',
                  borderDash: [2, 4],
                  borderWidth: 2,
                  pointRadius: 0,
                  pointHoverRadius: 0,
                  showLine: true,
                  fill: false
                });
                allXValues.push(forecastPts[forecastPts.length - 1].x);
              }
            }
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

    // 3. Baseline & Tolerance Limit Overlays (if enabled)
    if (baselineInfo && allXValues.length > 0) {
      const minX = Math.min(...allXValues);
      const maxX = Math.max(...allXValues);

      chartDatasets.push({
        label: `Baseline (${baselineInfo.baseline})`,
        data: [{ x: minX, y: baselineInfo.baseline }, { x: maxX, y: baselineInfo.baseline }],
        borderColor: '#10b981',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        showLine: true,
        fill: false
      });

      if (baselineInfo.upperLimit !== null) {
        chartDatasets.push({
          label: `+Tol (${baselineInfo.upperLimit})`,
          data: [{ x: minX, y: baselineInfo.upperLimit }, { x: maxX, y: baselineInfo.upperLimit }],
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          showLine: true,
          fill: false
        });
      }

      if (baselineInfo.lowerLimit !== null) {
        chartDatasets.push({
          label: `-Tol (${baselineInfo.lowerLimit})`,
          data: [{ x: minX, y: baselineInfo.lowerLimit }, { x: maxX, y: baselineInfo.lowerLimit }],
          borderColor: '#f59e0b',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          showLine: true,
          fill: false
        });
      }
    }

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements) => {
        if (elements && elements.length > 0) {
          const { datasetIndex, index } = elements[0];
          const dataset = chartDatasets[datasetIndex];
          const pt = dataset?.data?.[index];
          if (pt?.pointMeta?.sessionId) {
            onInspectSession && onInspectSession(pt.pointMeta.sessionId);
          }
        }
      },
      plugins: {
        horizontalToleranceBand: { display: true },
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
            afterLabel: () => [
              '💡 Click to view session details & test list',
              '💡 Right-click to ignore this point'
            ]
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

    chartComponent = (
      <Line
        ref={chartRef}
        data={{ datasets: chartDatasets }}
        options={options}
        plugins={horizontalToleranceBandPlugin ? [horizontalToleranceBandPlugin] : []}
      />
    );
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onRemoveOutliers && (
              <button
                type="button"
                onClick={onRemoveOutliers}
                title="Automatically identify and exclude statistical outliers (1.5 × IQR) from current datasets"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid #fed7aa',
                  background: '#fff7ed',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  color: '#c2410c',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
              >
                <FilterX size={14} /> Remove Outliers
              </button>
            )}

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
                color: '#334155',
                cursor: 'pointer'
              }}
            >
              <Download size={14} /> Export PNG
            </button>
          </div>
        </div>

        <div
          onContextMenu={handleContextMenu}
          onClick={handleChartClick}
          style={{ height: '440px', width: '100%', position: 'relative', cursor: 'pointer' }}
          title="Click any point to view session details; Right-click to ignore"
        >
          {chartComponent}
        </div>
      </div>

      {/* Baseline & Tolerance Reference Limits Card */}
      <div className="card" style={{ padding: '1rem 1.25rem', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: baselineConfig?.enabled ? '0.85rem' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: baselineConfig?.enabled ? '#ecfdf5' : '#f1f5f9',
              color: baselineConfig?.enabled ? '#059669' : '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Target size={16} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a' }}>
                  Baseline & Tolerance Reference Limits
                </span>
                {baselineInfo && (
                  <span style={{
                    fontSize: '0.74rem',
                    fontWeight: '600',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: '#ecfdf5',
                    color: '#047857',
                    border: '1px solid #a7f3d0'
                  }}>
                    Acceptable Zone: {baselineInfo.lowerLimit !== null ? baselineInfo.lowerLimit : '—'} to {baselineInfo.upperLimit !== null ? baselineInfo.upperLimit : '—'} (shaded green)
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                Set nominal target baseline and acceptable tolerance limits for {yVariable || 'measurement'}. Visible across time-series, normal curves, and box plots.
              </p>
            </div>
          </div>

          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.82rem',
            fontWeight: '700',
            color: baselineConfig?.enabled ? '#059669' : '#475569',
            cursor: 'pointer',
            padding: '0.35rem 0.65rem',
            background: baselineConfig?.enabled ? '#ecfdf5' : '#f8fafc',
            borderRadius: '6px',
            border: baselineConfig?.enabled ? '1px solid #a7f3d0' : '1px solid #cbd5e1'
          }}>
            <input
              type="checkbox"
              checked={Boolean(baselineConfig?.enabled)}
              onChange={(e) => {
                if (onChangeBaselineConfig) {
                  onChangeBaselineConfig({
                    ...baselineConfig,
                    enabled: e.target.checked
                  });
                }
              }}
            />
            Enable Limits
          </label>
        </div>

        {baselineConfig?.enabled && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
            paddingTop: '0.75rem',
            borderTop: '1px solid #f1f5f9'
          }}>
            {/* Baseline Value */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#334155', whiteSpace: 'nowrap' }}>
                Baseline Value:
              </label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 0.0"
                value={baselineConfig.baseline ?? ''}
                onChange={(e) => {
                  if (onChangeBaselineConfig) {
                    onChangeBaselineConfig({
                      ...baselineConfig,
                      baseline: e.target.value
                    });
                  }
                }}
                style={{
                  width: '90px',
                  padding: '0.35rem 0.5rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  background: '#ffffff'
                }}
              />
            </div>

            {/* Symmetric checkbox */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.78rem',
              fontWeight: '600',
              color: '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}>
              <input
                type="checkbox"
                checked={baselineConfig.symmetric !== false}
                onChange={(e) => {
                  if (onChangeBaselineConfig) {
                    onChangeBaselineConfig({
                      ...baselineConfig,
                      symmetric: e.target.checked,
                      lowerTol: e.target.checked ? baselineConfig.upperTol : baselineConfig.lowerTol
                    });
                  }
                }}
              />
              Symmetric (±)
            </label>

            {/* Tolerances */}
            {baselineConfig.symmetric !== false ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#334155', whiteSpace: 'nowrap' }}>
                  ± Tolerance:
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 2.0"
                  value={baselineConfig.upperTol ?? ''}
                  onChange={(e) => {
                    if (onChangeBaselineConfig) {
                      onChangeBaselineConfig({
                        ...baselineConfig,
                        upperTol: e.target.value,
                        lowerTol: e.target.value
                      });
                    }
                  }}
                  style={{
                    width: '80px',
                    padding: '0.35rem 0.5rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    background: '#ffffff'
                  }}
                />
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#334155', whiteSpace: 'nowrap' }}>
                    + Upper Tol:
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 2.0"
                    value={baselineConfig.upperTol ?? ''}
                    onChange={(e) => {
                      if (onChangeBaselineConfig) {
                        onChangeBaselineConfig({
                          ...baselineConfig,
                          upperTol: e.target.value
                        });
                      }
                    }}
                    style={{
                      width: '80px',
                      padding: '0.35rem 0.5rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      background: '#ffffff'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: '600', color: '#334155', whiteSpace: 'nowrap' }}>
                    - Lower Tol:
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 2.0"
                    value={baselineConfig.lowerTol ?? ''}
                    onChange={(e) => {
                      if (onChangeBaselineConfig) {
                        onChangeBaselineConfig({
                          ...baselineConfig,
                          lowerTol: e.target.value
                        });
                      }
                    }}
                    style={{
                      width: '80px',
                      padding: '0.35rem 0.5rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      background: '#ffffff'
                    }}
                  />
                </div>
              </>
            )}

            {/* Clear / Reset button */}
            <button
              type="button"
              onClick={() => {
                if (onChangeBaselineConfig) {
                  onChangeBaselineConfig({
                    enabled: false,
                    baseline: '',
                    upperTol: '',
                    lowerTol: '',
                    symmetric: true
                  });
                }
              }}
              style={{
                marginLeft: 'auto',
                padding: '0.3rem 0.65rem',
                borderRadius: '6px',
                background: 'transparent',
                border: '1px solid #cbd5e1',
                fontSize: '0.74rem',
                color: '#64748b',
                cursor: 'pointer'
              }}
            >
              Clear Limits
            </button>
          </div>
        )}
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
              if (onInspectSession) onInspectSession(contextMenu.point.sessionId);
              setContextMenu({ visible: false, x: 0, y: 0, point: null });
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              fontSize: '0.82rem',
              fontWeight: '600',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '4px',
              marginTop: '2px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#eff6ff'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <ListChecks size={14} /> View Session Details & Tests
          </button>
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
