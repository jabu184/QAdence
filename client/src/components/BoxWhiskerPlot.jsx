import React, { useState, useMemo } from 'react';
import { Box, BarChart2, Info, Download } from 'lucide-react';
import { computeBoxPlotStats } from '../utils/math';

export default function BoxWhiskerPlot({
  datasets = [],
  datasetResults = {},
  ignoredSessionIds = [],
  yVariable,
  baselineConfig
}) {
  const [hoveredData, setHoveredData] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const ignoredSet = useMemo(() => new Set(ignoredSessionIds), [ignoredSessionIds]);

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

  // Compute boxplot statistics for each visible dataset
  const boxData = useMemo(() => {
    return datasets
      .filter(d => d.visible !== false)
      .map(ds => {
        const allPts = datasetResults[ds.id]?.dataPoints || [];
        const activeY = allPts.filter(p => !ignoredSet.has(p.sessionId)).map(p => p.y);
        const stats = computeBoxPlotStats(activeY);
        return {
          dataset: ds,
          stats
        };
      })
      .filter(item => item.stats !== null);
  }, [datasets, datasetResults, ignoredSet]);

  // Calculate global min and max across all datasets for common Y scale
  const { globalMin, globalMax } = useMemo(() => {
    if (boxData.length === 0) return { globalMin: 0, globalMax: 100 };
    let min = Infinity;
    let max = -Infinity;

    boxData.forEach(({ stats }) => {
      if (stats.min < min) min = stats.min;
      if (stats.max > max) max = stats.max;
      // Also account for any extreme outliers
      if (stats.outliers && stats.outliers.length > 0) {
        min = Math.min(min, ...stats.outliers);
        max = Math.max(max, ...stats.outliers);
      }
    });

    if (baselineInfo) {
      if (baselineInfo.baseline < min) min = baselineInfo.baseline;
      if (baselineInfo.baseline > max) max = baselineInfo.baseline;
      if (baselineInfo.upperLimit !== null && baselineInfo.upperLimit > max) {
        max = baselineInfo.upperLimit;
      }
      if (baselineInfo.lowerLimit !== null && baselineInfo.lowerLimit < min) {
        min = baselineInfo.lowerLimit;
      }
    }

    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08 || 1;
    return {
      globalMin: min - pad,
      globalMax: max + pad
    };
  }, [boxData, baselineInfo]);

  if (boxData.length === 0) return null;

  // SVG Dimensions & Margins
  const width = Math.max(500, boxData.length * 150 + 120);
  const height = 340;
  const margin = { top: 30, right: 30, bottom: 65, left: 75 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // Scale mapper
  const getY = (val) => {
    return margin.top + plotHeight - ((val - globalMin) / (globalMax - globalMin)) * plotHeight;
  };

  // Y-axis tick divisions
  const tickCount = 6;
  const yTicks = Array.from({ length: tickCount }, (_, i) => {
    return globalMin + (i / (tickCount - 1)) * (globalMax - globalMin);
  });

  const colWidth = plotWidth / boxData.length;
  const boxWidth = Math.min(56, colWidth * 0.5);

  return (
    <div className="card" style={{ padding: '1.25rem', marginTop: '1.25rem', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            background: '#eff6ff',
            color: '#2563eb',
            padding: '5px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <BarChart2 size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.02rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              Box & Whisker Distribution Comparison
            </h3>
            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
              Side-by-side distribution quartiles & outliers for {yVariable}
            </span>
          </div>
        </div>

        {/* Legend pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.76rem', color: '#64748b', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '10px', border: '1.5px solid #2563eb', background: '#eff6ff', display: 'inline-block' }} />
            IQR (Q1 - Q3)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '2px', background: '#0f172a', display: 'inline-block' }} />
            Median
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', background: '#ef4444', transform: 'rotate(45deg)', display: 'inline-block' }} />
            Mean
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} />
            Outlier (1.5×IQR)
          </span>
          {baselineInfo && (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#059669', fontWeight: '600' }}>
                <span style={{ width: '12px', height: '0px', borderTop: '2px dashed #10b981', display: 'inline-block' }} />
                Baseline ({baselineInfo.baseline})
              </span>
              {(baselineInfo.upperLimit !== null || baselineInfo.lowerLimit !== null) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#b45309', fontWeight: '600' }}>
                  <span style={{ width: '12px', height: '0px', borderTop: '2px dashed #f59e0b', display: 'inline-block' }} />
                  Tol ({baselineInfo.lowerLimit !== null ? baselineInfo.lowerLimit : '—'} to {baselineInfo.upperLimit !== null ? baselineInfo.upperLimit : '—'})
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* SVG Container */}
      <div style={{ overflowX: 'auto', background: '#ffffff', borderRadius: '8px', border: '1px solid #f1f5f9', padding: '0.5rem' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', minWidth: `${width}px`, height: `${height}px`, display: 'block' }}
        >
          {/* Background gridlines */}
          {yTicks.map((tick, i) => {
            const yPos = getY(tick);
            return (
              <g key={i}>
                <line
                  x1={margin.left}
                  y1={yPos}
                  x2={width - margin.right}
                  y2={yPos}
                  stroke="#f1f5f9"
                  strokeDasharray={i === 0 ? 'none' : '3,3'}
                />
                <text
                  x={margin.left - 10}
                  y={yPos + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="#64748b"
                  fontFamily="sans-serif"
                >
                  {tick.toFixed(tick < 10 && tick > -10 ? 2 : 1)}
                </text>
              </g>
            );
          })}

          {/* Y-Axis Label */}
          <text
            x={-height / 2}
            y={20}
            transform="rotate(-90)"
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            fill="#475569"
            fontFamily="sans-serif"
          >
            {yVariable}
          </text>

          {/* Left Axis Line */}
          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={height - margin.bottom}
            stroke="#cbd5e1"
            strokeWidth="1.5"
          />

          {/* Baseline & Tolerance Limit Overlays */}
          {baselineInfo && (
            <g>
              {/* Shaded tolerance band (green acceptable region) */}
              {(baselineInfo.upperLimit !== null || baselineInfo.lowerLimit !== null) && (
                <rect
                  x={margin.left}
                  y={Math.min(
                    getY(baselineInfo.upperLimit !== null ? baselineInfo.upperLimit : baselineInfo.baseline),
                    getY(baselineInfo.lowerLimit !== null ? baselineInfo.lowerLimit : baselineInfo.baseline)
                  )}
                  width={plotWidth}
                  height={Math.max(
                    1,
                    Math.abs(
                      getY(baselineInfo.lowerLimit !== null ? baselineInfo.lowerLimit : baselineInfo.baseline) -
                      getY(baselineInfo.upperLimit !== null ? baselineInfo.upperLimit : baselineInfo.baseline)
                    )
                  )}
                  fill="#10b981"
                  fillOpacity="0.10"
                />
              )}

              {/* Upper Tolerance Line */}
              {baselineInfo.upperLimit !== null && (
                <g>
                  <line
                    x1={margin.left}
                    y1={getY(baselineInfo.upperLimit)}
                    x2={width - margin.right}
                    y2={getY(baselineInfo.upperLimit)}
                    stroke="#f59e0b"
                    strokeWidth="1.5"
                    strokeDasharray="4,4"
                  />
                  <text
                    x={width - margin.right - 6}
                    y={getY(baselineInfo.upperLimit) - 4}
                    textAnchor="end"
                    fontSize="10"
                    fill="#b45309"
                    fontWeight="600"
                    fontFamily="sans-serif"
                  >
                    +Tol: {baselineInfo.upperLimit}
                  </text>
                </g>
              )}

              {/* Lower Tolerance Line */}
              {baselineInfo.lowerLimit !== null && (
                <g>
                  <line
                    x1={margin.left}
                    y1={getY(baselineInfo.lowerLimit)}
                    x2={width - margin.right}
                    y2={getY(baselineInfo.lowerLimit)}
                    stroke="#f59e0b"
                    strokeWidth="1.5"
                    strokeDasharray="4,4"
                  />
                  <text
                    x={width - margin.right - 6}
                    y={getY(baselineInfo.lowerLimit) + 11}
                    textAnchor="end"
                    fontSize="10"
                    fill="#b45309"
                    fontWeight="600"
                    fontFamily="sans-serif"
                  >
                    -Tol: {baselineInfo.lowerLimit}
                  </text>
                </g>
              )}

              {/* Baseline Reference Line */}
              <g>
                <line
                  x1={margin.left}
                  y1={getY(baselineInfo.baseline)}
                  x2={width - margin.right}
                  y2={getY(baselineInfo.baseline)}
                  stroke="#10b981"
                  strokeWidth="2"
                  strokeDasharray="6,4"
                />
                <text
                  x={margin.left + 8}
                  y={getY(baselineInfo.baseline) - 4}
                  textAnchor="start"
                  fontSize="10"
                  fill="#059669"
                  fontWeight="700"
                  fontFamily="sans-serif"
                >
                  Baseline: {baselineInfo.baseline}
                </text>
              </g>
            </g>
          )}

          {/* Render each dataset's Box and Whisker */}
          {boxData.map(({ dataset, stats }, idx) => {
            const cx = margin.left + idx * colWidth + colWidth / 2;
            const color = dataset.color || '#2563eb';

            const yQ1 = getY(stats.q1);
            const yQ3 = getY(stats.q3);
            const yMedian = getY(stats.median);
            const yMean = getY(stats.mean);
            const yLowerWhisker = getY(stats.lowerWhisker);
            const yUpperWhisker = getY(stats.upperWhisker);

            const boxHeight = Math.max(2, yQ1 - yQ3); // in SVG, higher value has smaller y

            return (
              <g
                key={dataset.id}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredData({ dataset, stats });
                  setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
                }}
                onMouseLeave={() => setHoveredData(null)}
              >
                {/* Whisker Line: Lower Whisker to Q1 */}
                <line
                  x1={cx}
                  y1={yLowerWhisker}
                  x2={cx}
                  y2={yQ1}
                  stroke={color}
                  strokeWidth="2"
                />
                {/* Lower Whisker Cap */}
                <line
                  x1={cx - boxWidth * 0.25}
                  y1={yLowerWhisker}
                  x2={cx + boxWidth * 0.25}
                  y2={yLowerWhisker}
                  stroke={color}
                  strokeWidth="2"
                />

                {/* Whisker Line: Upper Whisker to Q3 */}
                <line
                  x1={cx}
                  y1={yUpperWhisker}
                  x2={cx}
                  y2={yQ3}
                  stroke={color}
                  strokeWidth="2"
                />
                {/* Upper Whisker Cap */}
                <line
                  x1={cx - boxWidth * 0.25}
                  y1={yUpperWhisker}
                  x2={cx + boxWidth * 0.25}
                  y2={yUpperWhisker}
                  stroke={color}
                  strokeWidth="2"
                />

                {/* Box (IQR) */}
                <rect
                  x={cx - boxWidth / 2}
                  y={yQ3}
                  width={boxWidth}
                  height={boxHeight}
                  fill={color}
                  fillOpacity="0.18"
                  stroke={color}
                  strokeWidth="2"
                  rx="3"
                />

                {/* Median Line */}
                <line
                  x1={cx - boxWidth / 2}
                  y1={yMedian}
                  x2={cx + boxWidth / 2}
                  y2={yMedian}
                  stroke="#0f172a"
                  strokeWidth="2.5"
                />

                {/* Mean Diamond Indicator */}
                <polygon
                  points={`${cx},${yMean - 4} ${cx + 4},${yMean} ${cx},${yMean + 4} ${cx - 4},${yMean}`}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth="1"
                />

                {/* Outliers */}
                {stats.outliers && stats.outliers.map((outlierVal, oIdx) => {
                  const oY = getY(outlierVal);
                  return (
                    <circle
                      key={oIdx}
                      cx={cx}
                      cy={oY}
                      r="3.5"
                      fill="#dc2626"
                      stroke="#ffffff"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Dataset Column Label & Sample size */}
                <text
                  x={cx}
                  y={height - margin.bottom + 18}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight="600"
                  fill="#1e293b"
                  fontFamily="sans-serif"
                >
                  {dataset.name.length > 14 ? `${dataset.name.substring(0, 13)}…` : dataset.name}
                </text>
                <text
                  x={cx}
                  y={height - margin.bottom + 34}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#64748b"
                  fontFamily="sans-serif"
                >
                  n={stats.n}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Interactive Tooltip Card on Hover */}
      {hoveredData && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.65rem 1rem',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          fontSize: '0.82rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '3px',
                backgroundColor: hoveredData.dataset.color || '#2563eb'
              }}
            />
            <strong>{hoveredData.dataset.name}</strong>
            <span style={{ color: '#64748b' }}>(n = {hoveredData.stats.n} sessions)</span>
          </div>

          <div style={{ display: 'flex', gap: '1.25rem', color: '#334155' }}>
            <span><strong>Min:</strong> {hoveredData.stats.min}</span>
            <span><strong>Q1 (25%):</strong> {hoveredData.stats.q1}</span>
            <span><strong>Median:</strong> <span style={{ color: '#0f172a', fontWeight: '700' }}>{hoveredData.stats.median}</span></span>
            <span><strong>Mean (μ):</strong> <span style={{ color: '#ef4444', fontWeight: '700' }}>{hoveredData.stats.mean}</span></span>
            <span><strong>Q3 (75%):</strong> {hoveredData.stats.q3}</span>
            <span><strong>Max:</strong> {hoveredData.stats.max}</span>
            <span><strong>IQR:</strong> {hoveredData.stats.iqr}</span>
            {hoveredData.stats.outliers.length > 0 && (
              <span style={{ color: '#dc2626', fontWeight: '600' }}>
                Outliers: {hoveredData.stats.outliers.length}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
