import React, { useState, useRef } from 'react';
import { X, Upload, FileText, CheckCircle, AlertTriangle, Layers } from 'lucide-react';

export default function PresetImportModal({
  isOpen,
  onClose,
  onImportSuccess
}) {
  const [file, setFile] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [error, setError] = useState(null);
  const [overwrite, setOverwrite] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleReset = () => {
    setFile(null);
    setParsedData(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processJsonText = (fileName, text) => {
    try {
      setError(null);
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
        setError('No valid QA presets found in this file. Expected a presets array or preset configuration.');
        setParsedData(null);
        return;
      }

      // Validate presets
      const validPresets = extracted.filter(p => p && typeof p === 'object' && p.name);
      if (validPresets.length === 0) {
        setError('Found preset entries, but none had a valid "name" property.');
        setParsedData(null);
        return;
      }

      setFile({ name: fileName, size: text.length });
      setParsedData({
        raw: json,
        presets: validPresets
      });
    } catch (err) {
      setError(`Failed to parse JSON file: ${err.message}`);
      setParsedData(null);
    }
  };

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      processJsonText(selected.name, event.target.result);
    };
    reader.onerror = () => {
      setError('Failed to read file from disk.');
    };
    reader.readAsText(selected);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;
    if (!droppedFile.name.endsWith('.json')) {
      setError('Please select a valid .json file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      processJsonText(droppedFile.name, event.target.result);
    };
    reader.onerror = () => {
      setError('Failed to read dropped file.');
    };
    reader.readAsText(droppedFile);
  };

  const handleExecuteImport = async () => {
    if (!parsedData || !parsedData.presets || parsedData.presets.length === 0) return;

    setIsImporting(true);
    setError(null);
    try {
      const res = await fetch('/api/presets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presets: parsedData.presets,
          overwrite
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to import presets.');
      }

      if (onImportSuccess) {
        onImportSuccess(data);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 60 }}>
      <div className="card" style={{ width: '100%', maxWidth: '520px', padding: '1.5rem', position: 'relative' }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
          <div style={{ background: '#e0f2fe', color: '#0284c7', padding: '8px', borderRadius: '8px' }}>
            <Upload size={20} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Import QA Presets</h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
              Load preset configurations from a downloadable JSON backup
            </p>
          </div>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            padding: '0.75rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.82rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Drop zone or file selector */}
        {!parsedData ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed ' + (isDragging ? '#0284c7' : '#cbd5e1'),
              background: isDragging ? '#f0f9ff' : '#f8fafc',
              borderRadius: '12px',
              padding: '2.25rem 1.5rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginBottom: '1.25rem'
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json,application/json"
              style={{ display: 'none' }}
            />
            <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '50%', background: '#e2e8f0', color: '#475569', marginBottom: '0.75rem' }}>
              <Upload size={24} />
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#1e293b', marginBottom: '4px' }}>
              Choose a Preset JSON file or drag it here
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Supports QAdence presets exported from this or another instance (.json)
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f1f5f9',
              padding: '8px 12px',
              borderRadius: '8px',
              marginBottom: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={18} color="#0284c7" />
                <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#1e293b' }}>
                  {file?.name}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  ({parsedData.presets.length} preset{parsedData.presets.length > 1 ? 's' : ''} found)
                </span>
              </div>
              <button
                type="button"
                onClick={handleReset}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#dc2626',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Change File
              </button>
            </div>

            {/* List of presets in file */}
            <div style={{
              maxHeight: '180px',
              overflowY: 'auto',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '6px'
            }}>
              {parsedData.presets.map((p, idx) => {
                const dsCount = Array.isArray(p.config?.datasets) ? p.config.datasets.length : 1;
                return (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: idx < parsedData.presets.length - 1 ? '1px solid #f1f5f9' : 'none'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#0f172a' }}>
                        {p.name}
                      </div>
                      {p.description && (
                        <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                          {p.description}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#475569', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>
                      <Layers size={11} />
                      {dsCount} dataset{dsCount > 1 ? 's' : ''}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Overwrite option */}
            <div style={{ marginTop: '0.85rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  style={{ width: '15px', height: '15px' }}
                />
                <span>Overwrite existing presets with matching names</span>
              </label>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: '23px', marginTop: '2px' }}>
                {overwrite
                  ? 'Existing presets with the same name will be updated with the imported configuration.'
                  : 'Existing presets will be preserved; imported presets will be appended with "(Imported)".'}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!parsedData || isImporting}
            onClick={handleExecuteImport}
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: (!parsedData || isImporting) ? 0.6 : 1,
              cursor: (!parsedData || isImporting) ? 'not-allowed' : 'pointer'
            }}
          >
            <CheckCircle size={15} />
            {isImporting
              ? 'Importing...'
              : `Import ${parsedData?.presets?.length ? `${parsedData.presets.length} ` : ''}Preset${parsedData?.presets?.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
