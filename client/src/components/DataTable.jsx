import React, { useState, useMemo } from 'react';
import { Download, Search, EyeOff, RotateCcw, ListChecks } from 'lucide-react';

export default function DataTable({
  tableRows = [],
  yVariable,
  xVariable,
  ignoredSessionIds = [],
  onToggleIgnore,
  onInspectSession
}) {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [hideIgnored, setHideIgnored] = useState(false);

  const ignoredSet = useMemo(() => new Set(ignoredSessionIds), [ignoredSessionIds]);

  const filteredRows = useMemo(() => {
    let result = [...tableRows];

    if (hideIgnored) {
      result = result.filter(r => !ignoredSet.has(r.sessionId));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.testList && r.testList.toLowerCase().includes(q)) ||
        (r['Patient ID'] && String(r['Patient ID']).toLowerCase().includes(q)) ||
        (r['Patient QA Patient ID'] && String(r['Patient QA Patient ID']).toLowerCase().includes(q)) ||
        (r['Plan ID'] && String(r['Plan ID']).toLowerCase().includes(q)) ||
        (r['Plan Name'] && String(r['Plan Name']).toLowerCase().includes(q)) ||
        (r.unit && r.unit.toLowerCase().includes(q)) ||
        (r['Site'] && String(r['Site']).toLowerCase().includes(q)) ||
        (r['Patient QA Site'] && String(r['Patient QA Site']).toLowerCase().includes(q))
      );
    }

    result.sort((a, b) => {
      let va = sortField === 'Plan ID' ? (a['Plan ID'] || a['Plan Name']) : a[sortField];
      let vb = sortField === 'Plan ID' ? (b['Plan ID'] || b['Plan Name']) : b[sortField];
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
  }, [tableRows, search, sortField, sortAsc, hideIgnored, ignoredSet]);

  const handleExportCsv = () => {
    // Only export active rows unless user unchecked hideIgnored
    const rowsToExport = hideIgnored ? filteredRows : filteredRows.filter(r => !ignoredSet.has(r.sessionId));
    if (rowsToExport.length === 0) return;

    const headers = [
      'Session ID',
      'Date',
      'Unit',
      'Test List',
      'Patient ID',
      'Plan ID',
      'Site',
      'Beam Energy',
      yVariable,
      ...(xVariable && xVariable !== 'work_completed' ? [xVariable] : []),
      'Status'
    ];

    const csvLines = [headers.join(',')];
    for (const r of rowsToExport) {
      const patId = r['Patient ID'] || r['Patient QA Patient ID'] || '';
      const planIdVal = r['Plan ID'] || r['Plan Name'] || '';
      const site = r['Site'] || r['Patient QA Site'] || '';
      const energy = r['Beam Energy'] || r['Energy'] || '';
      const line = [
        r.sessionId,
        `"${r.date}"`,
        `"${r.unit || ''}"`,
        `"${r.testList || ''}"`,
        `"${patId}"`,
        `"${planIdVal}"`,
        `"${site}"`,
        `"${energy}"`,
        r[yVariable] !== undefined ? r[yVariable] : '',
        ...(xVariable && xVariable !== 'work_completed' ? [r[xVariable] !== undefined ? r[xVariable] : ''] : []),
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
              <th onClick={() => toggleSort(yVariable)} style={{ padding: '8px 12px', cursor: 'pointer', color: '#2563eb' }}>
                {yVariable} {sortField === yVariable && (sortAsc ? '↑' : '↓')}
              </th>
              {xVariable && xVariable !== 'work_completed' && (
                <th onClick={() => toggleSort(xVariable)} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                  {xVariable}
                </th>
              )}
              <th style={{ padding: '8px 12px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, i) => {
              const isIgnored = ignoredSet.has(r.sessionId);
              const patId = r['Patient ID'] || r['Patient QA Patient ID'] || '-';
              const planId = r['Plan ID'] || r['Plan Name'] || '-';
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
                    {r[yVariable] !== undefined ? r[yVariable] : '-'}
                  </td>
                  {xVariable && xVariable !== 'work_completed' && (
                    <td style={{ padding: '8px 12px' }}>
                      {r[xVariable] !== undefined ? r[xVariable] : '-'}
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
