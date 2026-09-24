import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Bookmark,
  SlidersHorizontal,
  Search,
  Download,
  Upload,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Check,
  CheckCircle,
  AlertTriangle,
  FileText,
  Layers,
  ArrowRight,
  ExternalLink
} from 'lucide-react';

export default function PresetManagerModal({
  isOpen,
  onClose,
  presets = [],
  selectedPresetId = '',
  onSelectPreset,
  onPresetsUpdated
}) {
  const [localPresets, setLocalPresets] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Import panel state
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [parsedImportData, setParsedImportData] = useState(null);
  const [importError, setImportError] = useState(null);
  const [importOverwrite, setImportOverwrite] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Notification message
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    setLocalPresets(presets);
  }, [presets]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setEditingId(null);
      setIsImportOpen(false);
      setParsedImportData(null);
      setImportFile(null);
      setImportError(null);
      setNotification(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // 1. Move Preset Up / Down
  const handleMoveOrder = async (index, direction) => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= localPresets.length) return;

    const updated = [...localPresets];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);

    setLocalPresets(updated);

    try {
      const res = await fetch('/api/presets/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: updated.map(p => p.id) })
      });
      const data = await res.json();
      if (data.success) {
        if (onPresetsUpdated) onPresetsUpdated();
      } else {
        showNotification(data.error || 'Failed to update order', 'error');
        setLocalPresets(presets);
      }
    } catch (err) {
      showNotification(err.message, 'error');
      setLocalPresets(presets);
    }
  };

  // 2. Start Editing Name & Description
  const handleStartEdit = (preset) => {
    setEditingId(preset.id);
    setEditName(preset.name || '');
    setEditDescription(preset.description || '');
  };

  // 3. Save Edited Name & Description
  const handleSaveEdit = async (id) => {
    if (!editName.trim()) {
      alert('Preset name cannot be blank.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setLocalPresets(prev =>
          prev.map(p =>
            p.id === id
              ? { ...p, name: editName.trim(), description: editDescription.trim() }
              : p
          )
        );
        setEditingId(null);
        showNotification('Preset updated successfully.');
        if (onPresetsUpdated) onPresetsUpdated();
      } else {
        alert('Failed to update preset: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error updating preset: ' + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // 4. Delete Preset
  const handleDeletePreset = async (preset) => {
    if (!window.confirm(`Are you sure you want to delete preset "${preset.name}"?`)) return;

    try {
      const res = await fetch(`/api/presets/${preset.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setLocalPresets(prev => prev.filter(p => p.id !== preset.id));
        showNotification(`Preset "${preset.name}" deleted.`);
        if (onPresetsUpdated) onPresetsUpdated();
        if (String(selectedPresetId) === String(preset.id) && onSelectPreset) {
          onSelectPreset('');
        }
      } else {
        alert('Failed to delete preset: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error deleting preset: ' + err.message);
    }
  };

  // 5. Export All Presets
  const handleExportAll = () => {
    if (localPresets.length === 0) {
      alert('No presets available to export.');
      return;
    }
    const link = document.createElement('a');
    link.href = '/api/presets/export';
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 6. Export Single Preset
  const handleExportSingle = (preset) => {
    const link = document.createElement('a');
    link.href = `/api/presets/export?id=${encodeURIComponent(preset.id)}`;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 7. Import Parsing & Execution
  const processJsonText = (fileName, text) => {
    try {
      setImportError(null);
      const json = JSON.parse(text);

      let extracted = [];
      if (Array.isArray(json)) {
        extracted = json;
      } else if (json && typeof json === 'object') {
        if (Array.isArray(json.presets)) {
          extracted = json.presets;
        } else if (json.name && (json.config || json.config_json)) {
          extracted = [json];
        }
      }

      if (!extracted || extracted.length === 0) {
        setImportError('No valid presets found. Expected a JSON presets array or configuration.');
        setParsedImportData(null);
        return;
      }

      const validPresets = extracted.filter(p => p && typeof p === 'object' && p.name);
      if (validPresets.length === 0) {
        setImportError('Found preset entries, but none had a valid "name" property.');
        setParsedImportData(null);
        return;
      }

      setImportFile({ name: fileName, size: text.length });
      setParsedImportData({ presets: validPresets });
    } catch (err) {
      setImportError(`Failed to parse JSON file: ${err.message}`);
      setParsedImportData(null);
    }
  };

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      processJsonText(selected.name, event.target.result);
    };
    reader.onerror = () => setImportError('Failed to read file from disk.');
    reader.readAsText(selected);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;
    if (!droppedFile.name.endsWith('.json')) {
      setImportError('Please select a valid .json file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      processJsonText(droppedFile.name, event.target.result);
    };
    reader.onerror = () => setImportError('Failed to read dropped file.');
    reader.readAsText(droppedFile);
  };

  const handleExecuteImport = async () => {
    if (!parsedImportData || !parsedImportData.presets?.length) return;

    setIsImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/presets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presets: parsedImportData.presets,
          overwrite: importOverwrite
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to import presets.');
      }

      if (data.presets) {
        setLocalPresets(data.presets);
      }
      setIsImportOpen(false);
      setParsedImportData(null);
      setImportFile(null);
      showNotification(`Successfully imported ${data.importedCount + data.updatedCount} preset(s).`);

      if (onPresetsUpdated) onPresetsUpdated();
      if (data?.processed?.length > 0 && onSelectPreset) {
        onSelectPreset(data.processed[0].id);
      }
    } catch (err) {
      setImportError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 60 }}>
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '780px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5rem',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            color: '#64748b',
            background: 'none',
            border: 'none',
            cursor: 'pointer'
          }}
          title="Close Window"
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', paddingRight: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#eff6ff', color: '#2563eb', padding: '9px', borderRadius: '10px' }}>
              <Bookmark size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700', color: '#0f172a' }}>
                Preset Manager & Editor
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                Organize, rename, reorder, export, import, or delete your saved QA query presets.
              </p>
            </div>
          </div>

          {/* Header Action Buttons: Export All & Import Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleExportAll}
              title="Download all presets as a JSON file"
              disabled={localPresets.length === 0}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '0.4rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: localPresets.length === 0 ? 'not-allowed' : 'pointer',
                opacity: localPresets.length === 0 ? 0.5 : 1
              }}
            >
              <Download size={14} color="#0284c7" /> Export All
            </button>

            <button
              onClick={() => setIsImportOpen(prev => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '0.4rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid ' + (isImportOpen ? '#2563eb' : '#cbd5e1'),
                background: isImportOpen ? '#eff6ff' : '#ffffff',
                color: isImportOpen ? '#2563eb' : '#334155',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              <Upload size={14} /> {isImportOpen ? 'Hide Import' : 'Import'}
            </button>
          </div>
        </div>

        {/* Notification Alert */}
        {notification && (
          <div style={{
            background: notification.type === 'error' ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${notification.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
            color: notification.type === 'error' ? '#dc2626' : '#16a34a',
            padding: '0.6rem 0.9rem',
            borderRadius: '8px',
            marginBottom: '0.85rem',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {notification.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
            <span>{notification.msg}</span>
          </div>
        )}

        {/* Collapsible Import Panel */}
        {isImportOpen && (
          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '1rem',
            marginBottom: '1rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Upload size={15} color="#2563eb" /> Import Presets from JSON
              </div>
              <button
                type="button"
                onClick={() => setIsImportOpen(false)}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>

            {importError && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                marginBottom: '0.75rem',
                fontSize: '0.78rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <AlertTriangle size={15} />
                <span>{importError}</span>
              </div>
            )}

            {!parsedImportData ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed ' + (isDragging ? '#0284c7' : '#cbd5e1'),
                  background: isDragging ? '#f0f9ff' : '#ffffff',
                  borderRadius: '8px',
                  padding: '1.25rem',
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                />
                <Upload size={20} color="#64748b" style={{ margin: '0 auto 6px auto', display: 'block' }} />
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: '#1e293b' }}>
                  Click to select JSON file or drag it here
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                  Supports exported QAdence presets (.json)
                </div>
              </div>
            ) : (
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  marginBottom: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FileText size={16} color="#0284c7" />
                    <span style={{ fontSize: '0.82rem', fontWeight: '600', color: '#1e293b' }}>
                      {importFile?.name}
                    </span>
                    <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      ({parsedImportData.presets.length} preset{parsedImportData.presets.length > 1 ? 's' : ''} found)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setParsedImportData(null); setImportFile(null); }}
                    style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer' }}
                  >
                    Change File
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#334155', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={importOverwrite}
                      onChange={(e) => setImportOverwrite(e.target.checked)}
                      style={{ width: '14px', height: '14px' }}
                    />
                    <span>Overwrite existing presets with matching names</span>
                  </label>

                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isImporting}
                    onClick={handleExecuteImport}
                    style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}
                  >
                    <CheckCircle size={14} />
                    {isImporting ? 'Importing...' : `Import ${parsedImportData.presets.length} Preset(s)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preset List Container */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
          {localPresets.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '3rem 1.5rem',
              background: '#f8fafc',
              borderRadius: '12px',
              border: '1px dashed #cbd5e1'
            }}>
              <Bookmark size={32} color="#94a3b8" style={{ margin: '0 auto 0.75rem auto', display: 'block' }} />
              <div style={{ fontSize: '0.95rem', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                No Query Presets Saved
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', maxWidth: '380px', margin: '0 auto 1rem auto' }}>
                Save your current analysis views from the main dashboard, or import presets from another machine using JSON backup.
              </p>
              <button
                type="button"
                onClick={() => setIsImportOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0.45rem 0.9rem',
                  borderRadius: '8px',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <Upload size={14} /> Import Presets
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {/* Preset Search Bar */}
              <div style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                marginBottom: '0.35rem'
              }}>
                <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px' }} />
                <input
                  type="text"
                  placeholder="Search presets by name or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 30px 6px 30px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem',
                    background: '#f8fafc',
                    color: '#0f172a',
                    outline: 'none'
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {localPresets
                .filter(p => {
                  if (!searchQuery.trim()) return true;
                  const q = searchQuery.toLowerCase().trim();
                  return (p.name && p.name.toLowerCase().includes(q)) || (p.description && p.description.toLowerCase().includes(q));
                })
                .map((preset, index) => {
                const isEditing = editingId === preset.id;
                const isSelected = String(preset.id) === String(selectedPresetId);
                const dsCount = Array.isArray(preset.config?.datasets) ? preset.config.datasets.length : 1;
                const yVar = preset.config?.yVariable || 'N/A';
                const plotType = preset.config?.plotType || 'scatter';

                return (
                  <div
                    key={preset.id}
                    style={{
                      border: isSelected ? '1.5px solid #3b82f6' : '1px solid #e2e8f0',
                      background: isSelected ? '#f8faff' : '#ffffff',
                      borderRadius: '10px',
                      padding: '0.75rem 0.9rem',
                      display: 'flex',
                      alignItems: isEditing ? 'flex-start' : 'center',
                      gap: '12px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {/* Order Controls (Move Up / Down) */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => handleMoveOrder(index, 'up')}
                        title="Move Up"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: index === 0 ? '#cbd5e1' : '#475569',
                          cursor: index === 0 ? 'not-allowed' : 'pointer',
                          padding: '1px',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <ChevronUp size={16} />
                      </button>
                      <span style={{ fontSize: '0.68rem', fontWeight: '700', color: '#94a3b8' }}>
                        #{index + 1}
                      </span>
                      <button
                        type="button"
                        disabled={index === localPresets.length - 1}
                        onClick={() => handleMoveOrder(index, 'down')}
                        title="Move Down"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: index === localPresets.length - 1 ? '#cbd5e1' : '#475569',
                          cursor: index === localPresets.length - 1 ? 'not-allowed' : 'pointer',
                          padding: '1px',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>

                    {/* Main Content Area */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div>
                            <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569', display: 'block', marginBottom: '2px' }}>
                              Preset Name
                            </label>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Preset name..."
                              style={{
                                width: '100%',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.82rem',
                                fontWeight: '600'
                              }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.72rem', fontWeight: '600', color: '#475569', display: 'block', marginBottom: '2px' }}>
                              Description
                            </label>
                            <textarea
                              rows={2}
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Optional notes or clinical protocol description..."
                              style={{
                                width: '100%',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.8rem',
                                resize: 'none'
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                            <button
                              type="button"
                              disabled={isSavingEdit}
                              onClick={() => handleSaveEdit(preset.id)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: '#16a34a',
                                color: '#ffffff',
                                border: 'none',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              <Check size={13} /> Save Changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              style={{
                                padding: '3px 8px',
                                borderRadius: '6px',
                                background: '#ffffff',
                                color: '#475569',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.75rem',
                                cursor: 'pointer'
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span
                              onClick={() => {
                                if (onSelectPreset) {
                                  onSelectPreset(preset.id);
                                  onClose();
                                }
                              }}
                              title="Click to apply this preset"
                              style={{
                                fontSize: '0.9rem',
                                fontWeight: '700',
                                color: isSelected ? '#1d4ed8' : '#0f172a',
                                cursor: 'pointer',
                                textDecoration: 'none'
                              }}
                            >
                              {preset.name}
                            </span>
                            {isSelected && (
                              <span style={{
                                fontSize: '0.68rem',
                                background: '#dbeafe',
                                color: '#1d4ed8',
                                padding: '1px 6px',
                                borderRadius: '12px',
                                fontWeight: '700'
                              }}>
                                Active
                              </span>
                            )}
                          </div>

                          <div style={{ fontSize: '0.78rem', color: preset.description ? '#475569' : '#94a3b8', marginTop: '2px' }}>
                            {preset.description || <em>No description provided</em>}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <Layers size={11} /> {dsCount} Dataset{dsCount > 1 ? 's' : ''}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                              Y: <strong>{yVar}</strong>
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                              Plot: {plotType}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Row Action Buttons */}
                    {!isEditing && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {/* Apply Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelectPreset) {
                              onSelectPreset(preset.id);
                              onClose();
                            }
                          }}
                          title="Apply this preset to dashboard"
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            background: isSelected ? '#eff6ff' : '#ffffff',
                            border: '1px solid ' + (isSelected ? '#93c5fd' : '#cbd5e1'),
                            color: isSelected ? '#1d4ed8' : '#334155',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            cursor: 'pointer'
                          }}
                        >
                          <ArrowRight size={13} /> Apply
                        </button>

                        {/* Edit Button */}
                        <button
                          type="button"
                          onClick={() => handleStartEdit(preset)}
                          title="Edit name and description"
                          style={{
                            padding: '5px',
                            borderRadius: '6px',
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            color: '#475569',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Pencil size={13} />
                        </button>

                        {/* Export Single Preset */}
                        <button
                          type="button"
                          onClick={() => handleExportSingle(preset)}
                          title="Export preset as JSON"
                          style={{
                            padding: '5px',
                            borderRadius: '6px',
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            color: '#0284c7',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Download size={13} />
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => handleDeletePreset(preset)}
                          title="Delete preset"
                          style={{
                            padding: '5px',
                            borderRadius: '6px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            color: '#dc2626',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '1rem',
          paddingTop: '0.85rem',
          borderTop: '1px solid #e2e8f0'
        }}>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
            {localPresets.length} preset{localPresets.length === 1 ? '' : 's'} saved
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: '0.45rem 1.1rem', fontSize: '0.82rem' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
