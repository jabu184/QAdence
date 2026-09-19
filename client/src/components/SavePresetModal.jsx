import React, { useState, useEffect } from 'react';
import { X, Bookmark, Download } from 'lucide-react';

export default function SavePresetModal({
  isOpen,
  onClose,
  currentConfig,
  onSaved,
  presets = [],
  activePresetId = ''
}) {
  const [mode, setMode] = useState('new'); // 'new' or 'overwrite'
  const [targetPresetId, setTargetPresetId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (activePresetId && presets.some(p => String(p.id) === String(activePresetId))) {
        setMode('overwrite');
        setTargetPresetId(String(activePresetId));
        const active = presets.find(p => String(p.id) === String(activePresetId));
        setName(active?.name || '');
        setDescription(active?.description || '');
      } else {
        setMode('new');
        setTargetPresetId(presets[0]?.id ? String(presets[0].id) : '');
        setName('');
        setDescription('');
      }
    }
  }, [isOpen, activePresetId, presets]);

  if (!isOpen) return null;

  const handleSelectPresetToOverwrite = (id) => {
    setTargetPresetId(id);
    const p = presets.find(x => String(x.id) === String(id));
    if (p) {
      setName(p.name);
      setDescription(p.description || '');
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      if (mode === 'overwrite' && targetPresetId) {
        const res = await fetch(`/api/presets/${targetPresetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            config: currentConfig
          })
        });
        const data = await res.json();
        if (data.success) {
          if (onSaved) onSaved(targetPresetId);
          onClose();
        } else {
          alert('Error overwriting preset: ' + (data.error || 'Unknown error'));
        }
      } else {
        const res = await fetch('/api/presets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            config: currentConfig
          })
        });
        const data = await res.json();
        if (data.success) {
          if (onSaved) onSaved(data.id);
          onClose();
        } else {
          alert('Error saving preset: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (err) {
      alert('Error saving preset: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadJson = () => {
    const presetName = name.trim() || 'QA_Preset';
    const exportEnvelope = {
      app: 'QAdence',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      presets: [
        {
          name: presetName,
          description: description.trim(),
          config: currentConfig
        }
      ]
    };
    const jsonStr = JSON.stringify(exportEnvelope, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = presetName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    link.href = url;
    link.download = `qadence_preset_${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay">
      <div className="card" style={{ width: '100%', maxWidth: '460px', padding: '1.5rem', position: 'relative' }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', color: '#64748b' }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.25rem' }}>
          <Bookmark size={20} color="#2563eb" />
          <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: '#0f172a' }}>
            {mode === 'overwrite' ? 'Overwrite Query Preset' : 'Save New Query Preset'}
          </h2>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem' }}>
          Store your dataset configurations, variable selections, and filters for instant recall.
        </p>

        {/* Mode Selector (New vs Overwrite) */}
        {presets.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
            <button
              type="button"
              onClick={() => {
                setMode('new');
                setName('');
                setDescription('');
              }}
              style={{
                flex: 1,
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: '600',
                border: 'none',
                background: mode === 'new' ? '#ffffff' : 'transparent',
                color: mode === 'new' ? '#0f172a' : '#64748b',
                boxShadow: mode === 'new' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                cursor: 'pointer'
              }}
            >
              Save as New
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('overwrite');
                const p = presets.find(x => String(x.id) === String(targetPresetId)) || presets[0];
                if (p) {
                  setTargetPresetId(String(p.id));
                  setName(p.name);
                  setDescription(p.description || '');
                }
              }}
              style={{
                flex: 1,
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: '600',
                border: 'none',
                background: mode === 'overwrite' ? '#ffffff' : 'transparent',
                color: mode === 'overwrite' ? '#0f172a' : '#64748b',
                boxShadow: mode === 'overwrite' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                cursor: 'pointer'
              }}
            >
              Overwrite Existing
            </button>
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {mode === 'overwrite' && (
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
                Select Preset to Overwrite *
              </label>
              <select
                value={targetPresetId}
                onChange={(e) => handleSelectPresetToOverwrite(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  background: '#ffffff'
                }}
              >
                {presets.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.description ? `— ${p.description.substring(0, 40)}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
              Preset Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Prostate VMAT Dose vs Gamma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#334155', display: 'block', marginBottom: '0.25rem' }}>
              Description
            </label>
            <textarea
              rows={2}
              placeholder="Notes on protocols, machines, or analysis purpose..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                resize: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={handleDownloadJson}
              title="Download current preset configuration as a JSON file without saving to server"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '0.45rem 0.8rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#334155',
                fontSize: '0.82rem',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              <Download size={14} color="#0284c7" /> Download JSON
            </button>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                style={{
                  padding: '0.45rem 1.15rem',
                  borderRadius: '8px',
                  background: mode === 'overwrite' ? '#ea580c' : '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  border: 'none',
                  cursor: isSaving ? 'not-allowed' : 'pointer'
                }}
              >
                {isSaving ? 'Saving...' : (mode === 'overwrite' ? 'Overwrite Preset' : 'Save New Preset')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
