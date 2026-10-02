import React, { useState, useMemo } from 'react';
import { Download, Search, EyeOff, RotateCcw, ListChecks } from 'lucide-react';

export default function DataTable({
  tableRows = [],
  yVariable,
  xVariable,
  yVariableLabel,
  xVariableLabel,
  ignoredSessionIds = [],
  onToggleIgnore,
  onInspectSession
}) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [hideIgnored, setHideIgnored] = useState(false);

  const distinctDatasets = useMemo(() => {
    const set = new Set();
    for (const r of tableRows) {
      if (r.datasetName) set.add(r.datasetName);
    }
    return Array.from(set);
  }, [tableRows]);

  const distinctYLabels = useMemo(() => {
    const labels = new Set();
    for (const r of tableRows) {
      const lbl = r.yVariableLabel || r.yVariable;
      if (lbl) labels.add(lbl);
    }
    return Array.from(labels);
  }, [tableRows]);

  const displayYName = useMemo(() => {
    if (distinctYLabels.length === 0) return yVariableLabel || yVariable || 'Value';
    if (distinctYLabels.length === 1) return distinctYLabels[0];
    if (distinctYLabels.length <= 3) return distinctYLabels.join(' / ');
    return 'Measurement Value';
  }, [distinctYLabels, yVariableLabel, yVariable]);

  const displayXName = xVariableLabel || (xVariable === 'work_completed' ? 'Date' : xVariable);

  const ignoredSet = useMemo(() => new Set(ignoredSessionIds), [ignoredSessionIds]);

  const filteredRows = useMemo(() => {
    let result = [...tableRows];

    if (hideIgnored) {
      result = result.filter(r => !ignoredSet.has(r.sessionId));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.datasetName && r.datasetName.toLowerCase().includes(q)) ||
        (r.testList && r.testList.toLowerCase().includes(q)) ||
        (r['Patient ID'] && String(r['Patient ID']).toLowerCase().includes(q)) ||
        (r['Patient QA Patient ID'] && String(r['Patient QA Patient ID']).toLowerCase().includes(q)) ||
        (r['Plan ID'] && String(r['Plan ID']).toLowerCase().includes(q)) ||
        (r['Patient QA Plan'] && String(r['Patient QA Plan']).toLowerCase().includes(q)) ||
        (r['patient_qa_plan_id'] && String(r['patient_qa_plan_id']).toLowerCase().includes(q)) ||
        (r['Plan Name'] && String(r['Plan Name']).toLowerCase().includes(q)) ||
        (r.unit && r.unit.toLowerCase().includes(q)) ||
        (r['Site'] && String(r['Site']).toLowerCase().includes(q)) ||
        (r['Patient QA Site'] && String(r['Patient QA Site']).toLowerCase().includes(q))
      );
    }

    result.sort((a, b) => {
      let va, vb;
      if (sortField === 'Plan ID') {
        va = a['Plan ID'] || a['Patient QA Plan'] || a['patient_qa_plan_id'] || a['Plan Name'];
        vb = b['Plan ID'] || b['Patient QA Plan'] || b['patient_qa_plan_id'] || b['Plan Name'];
      } else if (sortField === 'yValue' || sortField === yVariable) {
        va = a.y !== undefined ? a.y : (a[a.yVariable] ?? a[yVariable] ?? a[displayYName]);
        vb = b.y !== undefined ? b.y : (b[b.yVariable] ?? b[yVariable] ?? b[displayYName]);
      } else if (sortField === 'datasetName') {
        va = a.datasetName || '';
        vb = b.datasetName || '';
      } else {
        va = a[sortField];
        vb = b[sortField];
      }
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortAsc ? va - vb : vb - va;
      }
      return sortAsc
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });

    return result;
  }, [tableRows, search, sortField, sortAsc, hideIgnored, ignoredSet, yVariable, displayYName]);

  const handleExportCsv = () => {
    // Only export active rows unless user unchecked hideIgnored
    const rowsToExport = hideIgnored ? filteredRows : filteredRows.filter(r => !ignoredSet.has(r.sessionId));
    if (rowsToExport.length === 0) return;

    const headers = [
      'Session ID',
      ...(distinctDatasets.length > 1 ? ['Dataset'] : []),
      ...(distinctYLabels.length > 1 ? ['Variable'] : []),
      'Date',
      'Unit',
      'Test List',
      'Patient ID',
      'Plan ID',
      'Site',
      'Beam Energy',
      displayYName,
      ...(xVariable && xVariable !== 'work_completed' ? [displayXName] : []),
      'Status'
    ];

    const csvLines = [headers.join(',')];
    for (const r of rowsToExport) {
      const patId = r['Patient ID'] || r['Patient QA Patient ID'] || '';
      const planIdVal = r['Plan ID'] || r['Patient QA Plan'] || r['patient_qa_plan_id'] || r['Plan Name'] || '';
      const site = r['Site'] || r['Patient QA Site'] || '';
      const energy = r['Beam Energy'] || r['Energy'] || '';
      const yVal = r.y !== undefined ? r.y : (r[r.yVariable] !== undefined ? r[r.yVariable] : (r[yVariable] !== undefined ? r[yVariable] : (r[displayYName] !== undefined ? r[displayYName] : '')));
      const xVal = xVariable && xVariable !== 'work_completed' ? (r[xVariable] !== undefined ? r[xVariable] : (r[displayXName] !== undefined ? r[displayXName] : '')) : '';
      const line = [
        r.sessionId,
        ...(distinctDatasets.length > 1 ? [`"${r.datasetName || ''}"`] : []),
        ...(distinctYLabels.length > 1 ? [`"${r.yVariableLabel || r.yVariable || ''}"`] : []),
        `"${r.date}"`,
        `"${r.unit || ''}"`,
        `"${r.testList || ''}"`,
        `"${patId}"`,
        `"${planIdVal}"`,
        `"${site}"`,
        `"${energy}"`,
        yVal,
        ...(xVariable && xVariable !== 'work_completed' ? [xVal] : []),
        `"${r.status || ''}"`
      ];
      csvLines.push(line.join(','));
    }

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patient_qa_export_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '260px' }}>
            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search Patient ID, Plan, Unit..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '0.45rem 0.65rem 0.45rem 2rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem'
              }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#475569', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hideIgnored}
              onChange={(e) => setHideIgnored(e.target.checked)}
            />
            Hide Excluded Points ({ignoredSessionIds.length})
          </label>

          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Showing <strong>{filteredRows.length}</strong> records
          </span>
        </div>

        <button
          onClick={handleExportCsv}
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
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '520px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 10 }}>
            <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
              <th style={{ padding: '8px 12px', width: '90px' }}>Action</th>
              {distinctDatasets.length > 1 && (
                <th onClick={() => toggleSort('datasetName')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                  Dataset {sortField === 'datasetName' && (sortAsc ? '↑' : '↓')}
                </th>
              )}
              <th onClick={() => toggleSort('date')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Date {sortField === 'date' && (sortAsc ? '↑' : '↓')}
              </th>
              <th onClick={() => toggleSort('unit')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Machine {sortField === 'unit' && (sortAsc ? '↑' : '↓')}
              </th>
              <th onClick={() => toggleSort('testList')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Test List {sortField === 'testList' && (sortAsc ? '↑' : '↓')}
              </th>
              <th onClick={() => toggleSort('Patient ID')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Patient ID
              </th>
              <th onClick={() => toggleSort('Plan ID')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Plan ID {sortField === 'Plan ID' && (sortAsc ? '↑' : '↓')}
              </th>
              <th onClick={() => toggleSort('Site')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Site
              </th>
              <th onClick={() => toggleSort('Beam Energy')} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Energy
              </th>
              <th onClick={() => toggleSort('yValue')} style={{ padding: '8px 12px', cursor: 'pointer', color: '#2563eb' }}>
                {displayYName} {(sortField === 'yValue' || sortField === yVariable) && (sortAsc ? '↑' : '↓')}
              </th>
              {xVariable && xVariable !== 'work_completed' && (
                <th onClick={() => toggleSort(xVariable)} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                  {displayXName} {sortField === xVariable && (sortAsc ? '↑' : '↓')}
                </th>
              )}
              <th style={{ padding: '8px 12px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, i) => {
              const isIgnored = ignoredSet.has(r.sessionId);
              const patId = r['Patient ID'] || r['Patient QA Patient ID'] || '-';
              const planId = r['Plan ID'] || r['Patient QA Plan'] || r['patient_qa_plan_id'] || r['Plan Name'] || '-';
              const site = r['Site'] || r['Patient QA Site'] || '-';
              const energy = r['Beam Energy'] || r['Energy'] || '-';

              return (
                <tr
                  key={i}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: isIgnored ? '#fef2f2' : (i % 2 === 0 ? '#ffffff' : '#fcfcfd'),
                    opacity: isIgnored ? 0.65 : 1,
                    textDecoration: isIgnored ? 'line-through' : 'none'
                  }}
                >
                  <td style={{ padding: '8px 12px', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {onInspectSession && (
                        <button
                          type="button"
                          onClick={() => onInspectSession(r.sessionId)}
                          title="View complete session details and test list values"
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#eff6ff',
                            color: '#2563eb',
                            border: '1px solid #bfdbfe',
                            cursor: 'pointer'
                          }}
                        >
                          <ListChecks size={12} /> View
                        </button>
                      )}
                      <button
                        onClick={() => onToggleIgnore && onToggleIgnore(r.sessionId)}
                        title={isIgnored ? 'Restore point' : 'Ignore / Exclude from plot'}
                        style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: isIgnored ? '#ecfdf5' : '#fff1f2',
                          color: isIgnored ? '#059669' : '#e11d48',
                          border: `1px solid ${isIgnored ? '#a7f3d0' : '#fecdd3'}`,
                          cursor: 'pointer'
                        }}
                      >
                        {isIgnored ? (
                          <>
                            <RotateCcw size={12} /> Restore
                          </>
                        ) : (
                          <>
                            <EyeOff size={12} /> Ignore
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                  {distinctDatasets.length > 1 && (
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.78rem',
                        fontWeight: '600',
                        color: '#1e293b'
                      }}>
                        <span style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '2px',
                          backgroundColor: r.datasetColor || '#2563eb',
                          flexShrink: 0
                        }} />
                        {r.datasetName}
                      </span>
                    </td>
                  )}
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.date?.substring(0, 10)}</td>
                  <td style={{ padding: '8px 12px', fontWeight: '500' }}>{r.unit}</td>
                  <td style={{ padding: '8px 12px', color: '#475569', fontSize: '0.78rem' }}>{r.testList || '-'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: '600' }}>{patId}</td>
                  <td style={{ padding: '8px 12px' }}>{planId}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ padding: '2px 6px', background: '#f1f5f9', borderRadius: '4px', fontSize: '0.75rem' }}>
                      {site}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{energy}</td>
                  <td style={{ padding: '8px 12px', fontWeight: '700', color: isIgnored ? '#94a3b8' : '#2563eb' }}>
                    {(() => {
                      const val = r.y !== undefined ? r.y : (r[r.yVariable] ?? r[yVariable] ?? r[displayYName]);
                      if (val === undefined || val === null || val === '') return '-';
                      return (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span>{val}</span>
                          {distinctYLabels.length > 1 && (r.yVariableLabel || r.yVariable) && (
                            <span style={{
                              fontSize: '0.70rem',
                              fontWeight: '500',
                              color: '#64748b',
                              background: '#f1f5f9',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              border: '1px solid #e2e8f0',
                              whiteSpace: 'nowrap'
                            }}>
                              {r.yVariableLabel || r.yVariable}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  {xVariable && xVariable !== 'work_completed' && (
                    <td style={{ padding: '8px 12px' }}>
                      {r[xVariable] !== undefined ? r[xVariable] : (r[displayXName] !== undefined ? r[displayXName] : '-')}
                    </td>
                  )}
                  <td style={{ padding: '8px 12px' }}>
                    <span className={`badge ${r.status === 'Pass' ? 'badge-pass' : (r.status === 'Acceptable' ? 'badge-warning' : 'badge-fail')}`}>
                      {r.status || 'OK'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
