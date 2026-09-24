import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Calendar, Cpu, ListChecks, User, MessageSquare, Search, AlertCircle, CheckCircle, ShieldAlert } from 'lucide-react';

export default function SessionDetailsModal({
  sessionId,
  onClose,
  isIgnored = false,
  onToggleIgnore
}) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetch(`/api/session-details/${sessionId}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
      })
      .then(result => {
        if (!isMounted) return;
        if (result.success) {
          setData(result);
        } else {
          setError(result.error || 'Failed to load session details.');
        }
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err.message || 'Error fetching session details.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  if (!sessionId) return null;

  const session = data?.session;
  const testValues = data?.testValues || [];
  const qatrackWebUrl = data?.qatrackWebUrl;

  const filteredTests = testValues.filter(tv => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (tv.test_name && tv.test_name.toLowerCase().includes(q)) ||
      (tv.value_string && tv.value_string.toLowerCase().includes(q)) ||
      (tv.unit && tv.unit.toLowerCase().includes(q)) ||
      (tv.reviewStatus && tv.reviewStatus.toLowerCase().includes(q)) ||
      (tv.toleranceLevel && tv.toleranceLevel.toLowerCase().includes(q))
    );
  });

  const getStatusBadge = (statusStr) => {
    const s = (statusStr || '').toLowerCase();
    if (s.includes('reject')) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700' }}>
          <ShieldAlert size={12} /> {statusStr || 'Rejected'}
        </span>
      );
    }
    if (s.includes('unapproved') || s.includes('unreviewed') || s.includes('in progress') || s.includes('pending')) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700' }}>
          <AlertCircle size={12} /> {statusStr || 'Unreviewed'}
        </span>
      );
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700' }}>
        <CheckCircle size={12} /> {statusStr || 'Approved'}
      </span>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '1.25rem'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '920px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '1.1rem 1.4rem',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
              QA Session Details
            </h3>
            {session && getStatusBadge(session.status)}
            {session?.unit_name && (
              <span style={{
                background: '#eff6ff',
                color: '#1d4ed8',
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: '600'
              }}>
                {session.unit_name}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {qatrackWebUrl && (
              <a
                href={qatrackWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open this session entry in QATrack+ in a new tab"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 11px',
                  borderRadius: '7px',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  textDecoration: 'none',
                  boxShadow: '0 1px 3px rgba(37, 99, 235, 0.3)',
                  transition: 'background 0.15s ease'
                }}
              >
                <span>Open in QATrack+</span>
                <ExternalLink size={13} />
              </a>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '1.4rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {isLoading && (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <div className="spinner" style={{ margin: '0 auto 0.75rem', width: '28px', height: '28px', border: '3px solid #cbd5e1', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <p style={{ fontSize: '0.88rem' }}>Loading session data and test values...</p>
            </div>
          )}

          {error && (
            <div style={{ padding: '1.25rem', background: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.88rem' }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {!isLoading && !error && session && (
            <>
              {/* Session Metadata Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '0.75rem',
                background: '#f8fafc',
                padding: '1rem',
                borderRadius: '10px',
                border: '1px solid #e2e8f0'
              }}>
                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Cpu size={12} /> Unit / Machine
                  </span>
                  <span style={{ fontSize: '0.92rem', fontWeight: '700', color: '#0f172a' }}>
                    {session.unit_name}
                  </span>
                  {session.unit_class && (
                    <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block' }}>
                      {session.unit_class} {session.unit_type ? `(${session.unit_type})` : ''}
                    </span>
                  )}
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ListChecks size={12} /> Test List
                  </span>
                  <span style={{ fontSize: '0.92rem', fontWeight: '700', color: '#0f172a', display: 'block', wordBreak: 'break-word' }}>
                    {session.test_list_name}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ListChecks size={12} /> Test List Status
                  </span>
                  <div style={{ marginTop: '4px' }}>
                    {getStatusBadge(session.status)}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={12} /> Work Completed
                  </span>
                  <span style={{ fontSize: '0.92rem', fontWeight: '600', color: '#0f172a' }}>
                    {session.work_completed ? new Date(session.work_completed).toLocaleString() : '—'}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <User size={12} /> Performed By
                  </span>
                  <span style={{ fontSize: '0.92rem', fontWeight: '600', color: '#0f172a' }}>
                    {session.created_by || 'Unknown'}
                  </span>
                </div>
              </div>

              {session.comments && session.comments.trim() && (
                <div style={{
                  padding: '0.75rem 1rem',
                  background: '#f1f5f9',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px'
                }}>
                  <MessageSquare size={15} color="#64748b" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: '#0f172a' }}>Comments: </strong>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{session.comments}</span>
                  </div>
                </div>
              )}

              {/* Associated Test List Values */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <ListChecks size={16} color="#2563eb" />
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '700', color: '#0f172a' }}>
                      All Test Values ({testValues.length} recorded tests)
                    </h4>
                  </div>

                  <div style={{ position: 'relative', width: '220px' }}>
                    <Search size={13} color="#94a3b8" style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                      type="text"
                      placeholder="Search tests..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '4px 8px 4px 26px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.78rem',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                        <th style={{ padding: '9px 12px', fontWeight: '700', width: '30%' }}>Test Name</th>
                        <th style={{ padding: '9px 12px', fontWeight: '700', width: '20%' }}>Previous Reading</th>
                        <th style={{ padding: '9px 12px', fontWeight: '700', width: '20%' }}>Current Value</th>
                        <th style={{ padding: '9px 12px', fontWeight: '700', width: '20%' }}>Following Reading</th>
                        <th style={{ padding: '9px 12px', fontWeight: '700', width: '10%' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTests.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                            {searchQuery ? `No tests matching "${searchQuery}"` : 'No test values found for this session.'}
                          </td>
                        </tr>
                      ) : (
                        filteredTests.map((tv, idx) => {
                          const displayVal = tv.value_string !== null && tv.value_string !== undefined && tv.value_string !== ''
                            ? tv.value_string
                            : (tv.value_numeric !== null ? String(tv.value_numeric) : '—');

                          return (
                            <tr
                              key={tv.id || idx}
                              style={{
                                borderBottom: idx < filteredTests.length - 1 ? '1px solid #f1f5f9' : 'none',
                                background: idx % 2 === 0 ? '#ffffff' : '#fafafa'
                              }}
                            >
                              {/* Test Name & Unit */}
                              <td style={{ padding: '9px 12px', fontWeight: '600', color: '#0f172a' }}>
                                <div>{tv.test_name}</div>
                                {tv.unit && (
                                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: '500' }}>
                                    Unit: {tv.unit}
                                  </span>
                                )}
                              </td>

                              {/* Previous Reading */}
                              <td style={{ padding: '9px 12px', color: '#1e293b' }}>
                                {tv.previous ? (
                                  <div
                                    title={`Previous reading on ${new Date(tv.previous.date).toLocaleDateString()}: ${tv.previous.value_string}${tv.unit ? ' ' + tv.unit : ''} (${tv.previous.diffPercent !== null ? (tv.previous.diffPercent >= 0 ? '+' : '') + tv.previous.diffPercent.toFixed(2) + '% vs current' : 'comparison unavailable'})`}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
                                  >
                                    <span style={{ fontFamily: 'monospace', fontWeight: '700' }}>
                                      {tv.previous.value_string}
                                    </span>
                                    {tv.previous.diffPercent !== null && (
                                      <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '2px',
                                        fontSize: '0.72rem',
                                        fontWeight: '700',
                                        padding: '1px 5px',
                                        borderRadius: '4px',
                                        background: tv.previous.diffPercent === 0 ? '#f1f5f9' : (tv.previous.diffPercent > 0 ? '#eff6ff' : '#f8fafc'),
                                        color: tv.previous.diffPercent === 0 ? '#64748b' : (tv.previous.diffPercent > 0 ? '#2563eb' : '#475569')
                                      }}>
                                        <span>{tv.previous.diffPercent >= 0 ? '+' : ''}{tv.previous.diffPercent.toFixed(2)}%</span>
                                        <span style={{ fontSize: '0.82rem', lineHeight: 1 }}>{tv.previous.arrow}</span>
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: '#94a3b8' }}>—</span>
                                )}
                              </td>

                              {/* Current Value (Marked in Red if Action, Orange if Tolerance) */}
                              <td style={{ padding: '9px 12px' }}>
                                {tv.toleranceLevel === 'action' ? (
                                  <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '3px 8px',
                                    borderRadius: '6px',
                                    background: '#fef2f2',
                                    border: '1.5px solid #f87171',
                                    color: '#dc2626',
                                    fontWeight: '800'
                                  }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '0.88rem' }}>{displayVal}</span>
                                    <span style={{
                                      fontSize: '0.65rem',
                                      fontWeight: '800',
                                      textTransform: 'uppercase',
                                      background: '#dc2626',
                                      color: '#ffffff',
                                      padding: '1px 5px',
                                      borderRadius: '3px',
                                      letterSpacing: '0.03em'
                                    }}>
                                      Action
                                    </span>
                                  </div>
                                ) : tv.toleranceLevel === 'tolerance' ? (
                                  <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '3px 8px',
                                    borderRadius: '6px',
                                    background: '#fffbeb',
                                    border: '1.5px solid #fbbf24',
                                    color: '#d97706',
                                    fontWeight: '800'
                                  }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: '0.88rem' }}>{displayVal}</span>
                                    <span style={{
                                      fontSize: '0.65rem',
                                      fontWeight: '800',
                                      textTransform: 'uppercase',
                                      background: '#d97706',
                                      color: '#ffffff',
                                      padding: '1px 5px',
                                      borderRadius: '3px',
                                      letterSpacing: '0.03em'
                                    }}>
                                      Tolerance
                                    </span>
                                  </div>
                                ) : (
                                  <span style={{ fontFamily: 'monospace', fontWeight: '700', color: '#0f172a', fontSize: '0.88rem' }}>
                                    {displayVal}
                                  </span>
                                )}
                              </td>

                              {/* Following Reading */}
                              <td style={{ padding: '9px 12px', color: '#1e293b' }}>
                                {tv.following ? (
                                  <div
                                    title={`Following reading on ${new Date(tv.following.date).toLocaleDateString()}: ${tv.following.value_string}${tv.unit ? ' ' + tv.unit : ''} (${tv.following.diffPercent !== null ? (tv.following.diffPercent >= 0 ? '+' : '') + tv.following.diffPercent.toFixed(2) + '% vs current' : 'comparison unavailable'})`}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
                                  >
                                    <span style={{ fontFamily: 'monospace', fontWeight: '700' }}>
                                      {tv.following.value_string}
                                    </span>
                                    {tv.following.diffPercent !== null && (
                                      <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '2px',
                                        fontSize: '0.72rem',
                                        fontWeight: '700',
                                        padding: '1px 5px',
                                        borderRadius: '4px',
                                        background: tv.following.diffPercent === 0 ? '#f1f5f9' : (tv.following.diffPercent > 0 ? '#eff6ff' : '#f8fafc'),
                                        color: tv.following.diffPercent === 0 ? '#64748b' : (tv.following.diffPercent > 0 ? '#2563eb' : '#475569')
                                      }}>
                                        <span>{tv.following.diffPercent >= 0 ? '+' : ''}{tv.following.diffPercent.toFixed(2)}%</span>
                                        <span style={{ fontSize: '0.82rem', lineHeight: 1 }}>{tv.following.arrow}</span>
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: '#94a3b8' }}>—</span>
                                )}
                              </td>

                              {/* Test Review Status */}
                              <td style={{ padding: '9px 12px' }}>
                                {getStatusBadge(tv.reviewStatus || tv.status)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.85rem 1.4rem',
          borderTop: '1px solid #f1f5f9',
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            {onToggleIgnore && (
              <button
                type="button"
                onClick={() => {
                  onToggleIgnore(session?.id || sessionId);
                  onClose();
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: isIgnored ? '1px solid #10b981' : '1px solid #fca5a5',
                  background: isIgnored ? '#ecfdf5' : '#fef2f2',
                  color: isIgnored ? '#059669' : '#b91c1c',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                {isIgnored ? 'Restore this data point' : 'Exclude / Ignore this data point'}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              background: '#0f172a',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
