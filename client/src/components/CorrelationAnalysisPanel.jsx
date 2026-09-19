import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { GitCompare, HelpCircle, Activity, CheckCircle, AlertTriangle, RefreshCw, BarChart2 } from 'lucide-react';

export default function CorrelationAnalysisPanel({
  datasets = [],
  datasetResults = {},
  ignoredSessionIds = [],
  xVariable,
  yVariable
}) {
  const isDualNumeric = Boolean(xVariable && xVariable !== 'work_completed' && yVariable);
  const [measureMode, setMeasureMode] = useState('all'); // 'all', 'pearson', 'nonparametric'
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const ignoredSet = useMemo(() => new Set(ignoredSessionIds), [ignoredSessionIds]);

  // Extract paired valid (x, y) points per dataset
  const datasetPayloads = useMemo(() => {
    if (!isDualNumeric) return [];
    return datasets
      .filter(ds => ds.visible !== false)
      .map(ds => {
        const res = datasetResults[ds.id];
        const rawPts = res?.dataPoints || [];
        const activePts = rawPts.filter(p => !ignoredSet.has(p.sessionId));
        const points = activePts
          .filter(p => typeof p.x === 'number' && !isNaN(p.x) && typeof p.y === 'number' && !isNaN(p.y))
          .map(p => ({ x: p.x, y: p.y }));

        return {
          id: ds.id,
          name: ds.name,
          color: ds.color || '#2563eb',
          points
        };
      });
  }, [datasets, datasetResults, ignoredSet, isDualNumeric]);

  const runAnalysis = useCallback(async () => {
    if (!isDualNumeric || datasetPayloads.length === 0) {
      setAnalysisResult(null);
      return;
    }

    const totalPts = datasetPayloads.reduce((acc, d) => acc + d.points.length, 0);
    if (totalPts < 3) {
      setAnalysisResult({
        success: true,
        xName: xVariable,
        yName: yVariable,
        datasets: datasetPayloads.map(d => ({
          id: d.id,
          name: d.name,
          color: d.color,
          n: d.points.length,
          hasEnoughData: false,
          message: `Insufficient paired points (n=${d.points.length}, minimum 3 required)`
        }))
      });
      return;
    }

    setIsLoading(true);
    setFetchError(null);

    try {
      const res = await fetch('/api/analysis/correlation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasets: datasetPayloads,
          xName: xVariable,
          yName: yVariable,
          measure: measureMode
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with ${res.status}`);
      }

      const data = await res.json();
      setAnalysisResult(data);
    } catch (err) {
      console.warn('Correlation fetch warning:', err);
      setFetchError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [isDualNumeric, datasetPayloads, xVariable, yVariable, measureMode]);

  // Run automatically when inputs change
  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  if (!isDualNumeric) {
    return (
      <div style={{
        marginTop: '1.25rem',
        padding: '0.85rem 1.25rem',
        background: '#f8fafc',
        borderRadius: '10px',
        border: '1px dashed #cbd5e1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.8rem',
        color: '#64748b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <GitCompare size={16} style={{ color: '#0284c7' }} />
          <span>
            <strong>Dual-Variable Correlation Analysis</strong>: Select a numeric comparison variable for the <strong>X-Axis</strong> above (e.g. Temperature, Pressure, Output) to analyze linear (Pearson) & non-parametric rank dependence.
          </span>
        </div>
      </div>
    );
  }

  const renderBadge = (badgeLabel, badgeColor) => {
    let bg = '#f1f5f9';
    let text = '#475569';
    let border = '#cbd5e1';

    if (badgeColor === 'blue') {
      bg = '#eff6ff';
      text = '#1d4ed8';
      border = '#bfdbfe';
    } else if (badgeColor === 'purple') {
      bg = '#faf5ff';
      text = '#7e22ce';
      border = '#e9d5ff';
    } else if (badgeColor === 'emerald') {
      bg = '#ecfdf5';
      text = '#047857';
      border = '#a7f3d0';
    }

    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.2rem 0.55rem',
        borderRadius: '6px',
        fontSize: '0.74rem',
        fontWeight: '700',
        background: bg,
        color: text,
        border: `1px solid ${border}`
      }}>
        {badgeLabel}
      </span>
    );
  };

  const allResults = analysisResult?.datasets || [];
  const combined = analysisResult?.combined;

  return (
    <div style={{
      marginTop: '1.5rem',
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
      padding: '1.25rem',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
    }}>
      {/* Header & Controls Bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        marginBottom: '1rem',
        paddingBottom: '0.85rem',
        borderBottom: '1px solid #f1f5f9'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            background: '#e0f2fe',
            color: '#0369a1',
            padding: '6px',
            borderRadius: '8px'
          }}>
            <GitCompare size={18} />
          </div>
          <div>
            <h4 style={{ fontSize: '0.92rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
              Statistical Correlation & Dependence Analysis
            </h4>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Comparing <strong>{xVariable}</strong> (X-Axis) vs. <strong>{yVariable}</strong> (Y-Axis)
            </div>
          </div>
        </div>

        {/* Measure Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <label style={{ fontSize: '0.76rem', fontWeight: '600', color: '#475569' }}>
            Analysis Measure:
          </label>
          <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #cbd5e1' }}>
            {[
              { id: 'all', label: 'Comprehensive (Both)' },
              { id: 'pearson', label: 'Linear (Pearson r)' },
              { id: 'nonparametric', label: 'Non-Parametric (Spearman/Kendall)' }
            ].map(m => {
              const isActive = measureMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMeasureMode(m.id)}
                  style={{
                    padding: '0.4rem 0.65rem',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    background: isActive ? '#0284c7' : '#ffffff',
                    color: isActive ? '#ffffff' : '#64748b'
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={runAnalysis}
            disabled={isLoading}
            title="Recalculate statistical correlation"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              fontSize: '0.75rem',
              fontWeight: '600',
              color: '#334155'
            }}
          >
            <RefreshCw size={12} className={isLoading ? 'spin' : ''} />
            Recalculate
          </button>
        </div>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', color: '#0284c7', gap: '8px', fontSize: '0.85rem' }}>
          <RefreshCw size={16} className="spin" />
          Running scipy.stats correlation analysis...
        </div>
      )}

      {fetchError && (
        <div style={{ padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.8rem', marginBottom: '1rem' }}>
          Analysis Error: {fetchError}
        </div>
      )}

      {!isLoading && allResults.length > 0 && (
        <>
          {/* Correlation Metrics Table */}
          <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px' }}>Dataset</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Paired N</th>

                  {(measureMode === 'all' || measureMode === 'pearson') && (
                    <>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Pearson r</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Linear R²</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>p-value (Linear)</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Confidence Prob.</th>
                    </>
                  )}

                  {(measureMode === 'all' || measureMode === 'nonparametric') && (
                    <>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Spearman ρ</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>p-value (Rank)</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Kendall τ</th>
                    </>
                  )}

                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Suggested Relationship</th>
                </tr>
              </thead>
              <tbody>
                {allResults.map((r, i) => {
                  return (
                    <tr key={r.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px', fontWeight: '600' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: r.color }} />
                          {r.name}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                        {r.n}
                      </td>

                      {!r.hasEnoughData ? (
                        <td colSpan={measureMode === 'all' ? 8 : 5} style={{ padding: '8px 12px', color: '#94a3b8', fontStyle: 'italic' }}>
                          {r.message}
                        </td>
                      ) : (
                        <>
                          {(measureMode === 'all' || measureMode === 'pearson') && (
                            <>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: '700', color: '#0f172a' }}>
                                {r.pearsonR >= 0 ? `+${r.pearsonR.toFixed(3)}` : r.pearsonR.toFixed(3)}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                {r.rSquared.toFixed(3)}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: r.pearsonP <= 0.05 ? '#15803d' : '#64748b', fontWeight: r.pearsonP <= 0.05 ? '700' : '400' }}>
                                {r.pearsonPFormatted}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: r.probLinear >= 95 ? '#059669' : '#64748b' }}>
                                {r.probLinear}%
                              </td>
                            </>
                          )}

                          {(measureMode === 'all' || measureMode === 'nonparametric') && (
                            <>
                              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: '700', color: '#7e22ce' }}>
                                {r.spearmanRho >= 0 ? `+${r.spearmanRho.toFixed(3)}` : r.spearmanRho.toFixed(3)}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right', color: r.spearmanP <= 0.05 ? '#7e22ce' : '#64748b', fontWeight: r.spearmanP <= 0.05 ? '700' : '400' }}>
                                {r.spearmanPFormatted}
                              </td>
                              <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                {r.kendallTau >= 0 ? `+${r.kendallTau.toFixed(3)}` : r.kendallTau.toFixed(3)}
                              </td>
                            </>
                          )}

                          <td style={{ padding: '8px 12px' }}>
                            {renderBadge(r.badgeLabel, r.badgeColor)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}

                {combined && combined.hasEnoughData && (
                  <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0', fontWeight: '700' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: combined.color }} />
                        {combined.name}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                      {combined.n}
                    </td>
                    {(measureMode === 'all' || measureMode === 'pearson') && (
                      <>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {combined.pearsonR >= 0 ? `+${combined.pearsonR.toFixed(3)}` : combined.pearsonR.toFixed(3)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {combined.rSquared.toFixed(3)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: combined.pearsonP <= 0.05 ? '#15803d' : '#64748b' }}>
                          {combined.pearsonPFormatted}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: combined.probLinear >= 95 ? '#059669' : '#64748b' }}>
                          {combined.probLinear}%
                        </td>
                      </>
                    )}
                    {(measureMode === 'all' || measureMode === 'nonparametric') && (
                      <>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#7e22ce' }}>
                          {combined.spearmanRho >= 0 ? `+${combined.spearmanRho.toFixed(3)}` : combined.spearmanRho.toFixed(3)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: combined.spearmanP <= 0.05 ? '#7e22ce' : '#64748b' }}>
                          {combined.spearmanPFormatted}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {combined.kendallTau >= 0 ? `+${combined.kendallTau.toFixed(3)}` : combined.kendallTau.toFixed(3)}
                        </td>
                      </>
                    )}
                    <td style={{ padding: '8px 12px' }}>
                      {renderBadge(combined.badgeLabel, combined.badgeColor)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Clinical QA Diagnostic Insights Card */}
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem'
          }}>
            <div style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <BarChart2 size={16} style={{ color: '#0284c7' }} />
              Statistical Interpretation & Suggested Relationship:
            </div>
            {allResults.filter(r => r.hasEnoughData).map((r, i) => (
              <div key={r.id || i} style={{ fontSize: '0.78rem', color: '#334155', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span style={{ fontWeight: '700', color: r.color, minWidth: '90px' }}>{r.name}:</span>
                <span>{r.interpretation}</span>
              </div>
            ))}
            {combined && combined.hasEnoughData && (
              <div style={{ fontSize: '0.78rem', color: '#1e293b', fontWeight: '600', borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <span style={{ minWidth: '90px', color: '#475569' }}>Pooled Total:</span>
                <span>{combined.interpretation}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
