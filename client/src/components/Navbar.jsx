import React from 'react';
import { Activity, RefreshCw, Settings, Database, Bookmark, PlusCircle, Trash2, RotateCcw } from 'lucide-react';

export default function Navbar({
  status,
  presets,
  selectedPreset,
  onSelectPreset,
  onOpenSettings,
  onOpenSavePreset,
  onDeletePreset,
  onSync,
  onClearData,
  onNewAnalysis,
  isSyncing
}) {
  const activePreset = presets.find(p => String(p.id) === String(selectedPreset));

  return (
    <header style={{
      background: '#ffffff',
      borderBottom: '1px solid #e2e8f0',
      padding: '0.75rem 1.5rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 30
    }}>
      {/* Brand & Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src="/logo.jpg"
            alt="QAdence - Trends & Analysis"
            style={{
              height: '42px',
              width: 'auto',
              objectFit: 'contain',
              display: 'block'
            }}
          />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '2px' }}>
            <span style={{
              fontSize: '0.68rem',
              fontWeight: '700',
              letterSpacing: '0.04em',
              padding: '2px 7px',
              borderRadius: '4px',
              background: '#e0f2fe',
              color: '#0284c7',
              textTransform: 'uppercase'
            }}>
              QATrack+ v3.1 Integration
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.78rem', color: '#64748b' }}>
            <span>Sessions: <strong style={{ color: '#0f172a' }}>{status?.db?.sessionCount ?? 0}</strong></span>
            <span>•</span>
            <span>Machines: <strong style={{ color: '#0f172a' }}>{status?.db?.unitCount ?? 0}</strong></span>
            <span>•</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: status?.qatrack?.configured ? '#10b981' : '#f59e0b'
              }} />
              {status?.qatrack?.configured ? 'Live API Configured' : 'Offline / Standalone'}
            </span>
          </div>
        </div>
      </div>

      {/* Preset Selector & Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Preset Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Bookmark size={16} color="#64748b" />
          <select
            value={selectedPreset}
            onChange={(e) => onSelectPreset(e.target.value)}
            style={{
              padding: '0.45rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              backgroundColor: '#f8fafc',
              color: '#0f172a',
              outline: 'none',
              maxWidth: '220px'
            }}
          >
            <option value="">-- Load QA Preset --</option>
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {selectedPreset && (
            <button
              type="button"
              onClick={() => onDeletePreset && onDeletePreset(selectedPreset)}
              title="Delete this preset"
              style={{
                padding: '0.45rem',
                borderRadius: '8px',
                border: '1px solid #fecaca',
                background: '#fef2f2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer'
              }}
            >
              <Trash2 size={14} />
            </button>
          )}

          <button
            onClick={onOpenSavePreset}
            title={selectedPreset ? "Save or overwrite preset" : "Save current view as preset"}
            style={{
              padding: '0.45rem 0.65rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#475569',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer'
            }}
          >
            <PlusCircle size={14} /> Save
          </button>

          {activePreset?.description && (
            <div
              style={{
                fontSize: '0.74rem',
                color: '#475569',
                background: '#f8fafc',
                padding: '3px 8px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                maxWidth: '220px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={activePreset.description}
            >
              ℹ️ {activePreset.description}
            </div>
          )}
        </div>

        {/* New Analysis button */}
        <button
          onClick={onNewAnalysis}
          title="Start a fresh analysis (resets all configured datasets and filters)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            backgroundColor: '#ffffff',
            color: '#0f172a',
            fontSize: '0.85rem',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
          }}
        >
          <RotateCcw size={14} color="#0284c7" />
          New Analysis
        </button>

        {/* Fast Structure Sync (Units + Test Lists) */}
        <button
          onClick={() => onSync({ mode: 'metadata' })}
          disabled={isSyncing}
          title="Fast Sync: pulls all units, test lists, and measurement variables from QATrack+ without downloading historical records (completes in ~2s)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #0284c7, #0369a1)',
            color: '#ffffff',
            fontSize: '0.85rem',
            fontWeight: '600',
            opacity: isSyncing ? 0.7 : 1,
            cursor: isSyncing ? 'not-allowed' : 'pointer',
            boxShadow: '0 1px 3px rgba(2, 132, 199, 0.25)'
          }}
        >
          <RefreshCw size={14} className={isSyncing ? 'spin' : ''} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
          {isSyncing ? 'Syncing...' : 'Sync Structure'}
        </button>

        {/* Full Historical Records Sync */}
        <button
          onClick={() => onSync({ mode: 'full' })}
          disabled={isSyncing}
          title="Full Sync: pulls all historical QA sessions and measurements from QATrack+"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 0.75rem',
            borderRadius: '8px',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            color: '#334155',
            fontSize: '0.82rem',
            fontWeight: '500',
            opacity: isSyncing ? 0.7 : 1,
            cursor: isSyncing ? 'not-allowed' : 'pointer'
          }}
        >
          <Database size={14} color="#64748b" />
          Full Sync
        </button>

        {/* Clear Data Button */}
        <button
          onClick={onClearData}
          title="Delete all locally cached QA data"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 0.8rem',
            borderRadius: '8px',
            border: '1px solid #fee2e2',
            backgroundColor: '#fff5f5',
            color: '#dc2626',
            fontSize: '0.85rem',
            fontWeight: '500'
          }}
        >
          <Trash2 size={15} /> Clear Data
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          title="QATrack+ Connection Settings"
          style={{
            padding: '0.5rem',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
