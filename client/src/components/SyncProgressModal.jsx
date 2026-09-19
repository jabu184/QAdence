import React from 'react';
import { RefreshCw, StopCircle, CheckCircle2, AlertTriangle, HardDrive, Cpu, Clock, Database } from 'lucide-react';

export default function SyncProgressModal({ isOpen, status, onCancel, onClose }) {
  if (!isOpen) return null;

  const {
    isRunning = false,
    isCancelled = false,
    stage = 'Initializing...',
    syncedSessions = 0,
    totalMatchingInDb = null,
    totalAvailable = null,
    currentCollection = null,
    currentCollectionIdx = 0,
    totalCollections = 0,
    currentCollectionSynced = 0,
    currentCollectionTotal = null,
    heapUsedMB = 0,
    rssMB = 0,
    durationMs = 0
  } = status || {};

  const formatTime = (ms) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  let percent = null;
  if (totalCollections > 0 && currentCollectionIdx > 0) {
    const colFraction = (currentCollectionTotal && currentCollectionTotal > 0)
      ? Math.min(1, currentCollectionSynced / currentCollectionTotal)
      : (currentCollectionSynced > 0 ? 0.7 : 0.2);
    percent = Math.min(100, Math.round(((currentCollectionIdx - 1 + colFraction) / totalCollections) * 100));
  } else if (totalAvailable && totalAvailable > 0) {
    percent = Math.min(100, Math.round((syncedSessions / totalAvailable) * 100));
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        width: '100%',
        maxWidth: '520px',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fafc'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: isRunning ? '#eff6ff' : (isCancelled ? '#fff7ed' : '#ecfdf5'),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isRunning ? '#2563eb' : (isCancelled ? '#ea580c' : '#16a34a')
            }}>
              {isRunning ? (
                <RefreshCw size={20} style={{ animation: 'spin 2s linear infinite' }} />
              ) : isCancelled ? (
                <AlertTriangle size={20} />
              ) : (
                <CheckCircle2 size={20} />
              )}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#0f172a' }}>
                QATrack+ Data Sync
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                {isRunning ? (isCancelled ? 'Cancelling sync...' : 'Importing QA records...') : (isCancelled ? 'Sync stopped by user' : 'Sync completed')}
              </p>
            </div>
          </div>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: '9999px',
            background: isRunning ? '#dbeafe' : (isCancelled ? '#ffedd5' : '#dcfce7'),
            color: isRunning ? '#1d4ed8' : (isCancelled ? '#c2410c' : '#15803d')
          }}>
            {isRunning ? (isCancelled ? 'Cancelling' : 'Active') : (isCancelled ? 'Stopped' : 'Complete')}
          </span>
        </div>

        {/* Body Content */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Target Collection Info (if on-demand) */}
          {totalCollections > 0 && currentCollection && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.78rem',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              padding: '6px 12px',
              color: '#1d4ed8',
              fontWeight: 600
            }}>
              <span>Target Collection {currentCollectionIdx} of {totalCollections}</span>
              <span style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentCollection}
              </span>
            </div>
          )}

          {/* Stage Status */}
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '0.85rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }}>
            <Database size={18} color="#64748b" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
                Current Status
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1e293b', wordBreak: 'break-word' }}>
                {stage}
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b', marginBottom: '0.35rem' }}>
              <span>{isRunning ? 'Sync Progress' : 'Result'}</span>
              <span style={{ fontWeight: 600, color: '#1e293b' }}>
                {isRunning ? (
                  percent !== null
                    ? `${percent}% (${syncedSessions.toLocaleString()} records)`
                    : `${syncedSessions.toLocaleString()} records retrieved`
                ) : (
                  syncedSessions > 0
                    ? `${syncedSessions.toLocaleString()} records retrieved from QATrack+`
                    : (totalMatchingInDb && totalMatchingInDb > 0
                        ? `All ${totalMatchingInDb.toLocaleString()} records are up to date`
                        : `${syncedSessions.toLocaleString()} records retrieved`
                      )
                )}
              </span>
            </div>
            <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
              {percent !== null ? (
                <div style={{
                  width: `${percent}%`,
                  height: '100%',
                  background: isCancelled ? '#ea580c' : '#2563eb',
                  transition: 'width 0.3s ease'
                }} />
              ) : isRunning ? (
                <div style={{
                  width: '40%',
                  height: '100%',
                  background: '#2563eb',
                  borderRadius: '4px',
                  animation: 'pulse 1.5s ease-in-out infinite'
                }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: isCancelled ? '#ea580c' : '#16a34a' }} />
              )}
            </div>
          </div>

          {/* Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                <Database size={14} />
                <span>{isRunning ? 'Entries Retrieved' : 'Retrieved / In DB'}</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                {isRunning ? (
                  <>
                    {syncedSessions.toLocaleString()}
                    {totalAvailable ? (
                      <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#64748b' }}> / {totalAvailable.toLocaleString()}</span>
                    ) : null}
                  </>
                ) : (
                  syncedSessions > 0 ? (
                    <>
                      {syncedSessions.toLocaleString()}
                      {totalMatchingInDb ? (
                        <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b', display: 'block' }}>
                          {totalMatchingInDb.toLocaleString()} total in DB
                        </span>
                      ) : null}
                    </>
                  ) : (
                    totalMatchingInDb && totalMatchingInDb > 0 ? (
                      <>
                        <span style={{ color: '#16a34a' }}>{totalMatchingInDb.toLocaleString()}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#16a34a', display: 'block' }}>
                          Up to date in DB
                        </span>
                      </>
                    ) : (
                      '0'
                    )
                  )
                )}
              </div>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                <Clock size={14} />
                <span>Elapsed Time</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                {formatTime(durationMs)}
              </div>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                <Cpu size={14} />
                <span>Heap Memory</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                {heapUsedMB} <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#64748b' }}>MB</span>
              </div>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748b', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                <HardDrive size={14} />
                <span>Total Process RAM</span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                {rssMB} <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#64748b' }}>MB</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '0.75rem',
          background: '#f8fafc'
        }}>
          {isRunning ? (
            <button
              onClick={onCancel}
              disabled={isCancelled}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: '1px solid #fca5a5',
                background: isCancelled ? '#fef2f2' : '#dc2626',
                color: isCancelled ? '#ef4444' : '#ffffff',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: isCancelled ? 'not-allowed' : 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'all 0.15s ease'
              }}
            >
              <StopCircle size={16} />
              {isCancelled ? 'Stopping...' : 'Cancel Import'}
            </button>
          ) : (
            <button
              onClick={onClose}
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
