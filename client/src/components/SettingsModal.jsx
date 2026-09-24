import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, RefreshCw, Key, Globe, Shield, Download, Upload, Database } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, onConfigSaved }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [authType, setAuthType] = useState('Api-Key');
  const [includeUnapproved, setIncludeUnapproved] = useState(false);
  const [includeRejected, setIncludeRejected] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [replacePresets, setReplacePresets] = useState(false);
  const [backupRestoreStatus, setBackupRestoreStatus] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      fetch(`/api/config?_t=${Date.now()}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(data => {
          setBaseUrl(data.baseUrl || '');
          setToken(data.token || '');
          setAuthType(data.authType || 'Token');
          setIncludeUnapproved(data.includeUnapproved === true || data.includeUnapproved === 'true' || data.includeUnapproved === 1);
          setIncludeRejected(data.includeRejected === true || data.includeRejected === 'true' || data.includeRejected === 1);
          setTestResult(null);
        })
        .catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      // First save current values temporarily so test can run against them
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, token, authType, includeUnapproved, includeRejected })
      });

      const res = await fetch('/api/test-connection', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ success: false, message: e.message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          token,
          authType,
          includeUnapproved,
          includeRejected
        })
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || 'Failed to save settings');
      }
      if (onConfigSaved) onConfigSaved();
      onClose();
    } catch (e) {
      alert('Failed to save settings: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    setBackupRestoreStatus(null);
    try {
      const res = await fetch('/api/settings/backup');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json();

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `qadence_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupRestoreStatus({
        type: 'success',
        message: 'Backup downloaded successfully.'
      });
    } catch (err) {
      setBackupRestoreStatus({
        type: 'error',
        message: `Failed to export backup: ${err.message}`
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    setBackupRestoreStatus(null);

    try {
      const fileText = await file.text();
      let parsedJson;
      try {
        parsedJson = JSON.parse(fileText);
      } catch (parseErr) {
        throw new Error('Selected file is not valid JSON.');
      }

      const payload = {
        ...parsedJson,
        replacePresets
      };

      const res = await fetch('/api/settings/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || 'Failed to restore configuration');
      }

      // Update form state with new settings if present
      if (data.config) {
        setBaseUrl(data.config.baseUrl || '');
        setToken(data.config.token || '');
        setAuthType(data.config.authType || 'Token');
        setIncludeUnapproved(Boolean(data.config.includeUnapproved));
        setIncludeRejected(Boolean(data.config.includeRejected));
      }

      setBackupRestoreStatus({
        type: 'success',
        message: data.message || 'Configuration & presets restored successfully!'
      });

      // Notify parent to refresh presets, metadata, and status
      if (onConfigSaved) {
        onConfigSaved();
      }
    } catch (err) {
      setBackupRestoreStatus({
        type: 'error',
        message: `Restore failed: ${err.message}`
      });
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="modal-overlay">
      <div className="card" style={{ width: '100%', maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', position: 'relative' }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', color: '#64748b' }}
        >
          <X size={20} />
        </button>

        <h2 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#0f172a', marginBottom: '0.25rem' }}>
          QATrack+ Connection Settings
        </h2>
        <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '1.25rem' }}>
          Configure live REST API connection to your QATrack+ v3.1 instance.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Base URL */}
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.35rem' }}>
              <Globe size={15} color="#2563eb" /> QATrack+ Server Base URL
            </label>
            <input
              type="text"
              placeholder="e.g. http://qatrack.local:8000 or https://qatrack.hospital.org"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem'
              }}
            />
          </div>

          {/* Auth Header Type */}
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.35rem' }}>
              <Shield size={15} color="#2563eb" /> Authorization Header Prefix
            </label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem'
              }}
            >
              <option value="Api-Key">Api-Key (Default in QATrack+ REST API)</option>
              <option value="Token">Token (Django REST Framework TokenAuth)</option>
              <option value="Bearer">Bearer (OAuth2 / JWT)</option>
            </select>
          </div>

          {/* API Token */}
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: '600', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.35rem' }}>
              <Key size={15} color="#2563eb" /> API Token
            </label>
            <input
              type="password"
              placeholder="Paste your QATrack+ API token here..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                fontFamily: 'monospace'
              }}
            />
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
              In QATrack+, tokens can be generated under Account Profile / API Access.
            </div>
          </div>

          {/* Test Connection Button & Result */}
          <div style={{ marginTop: '0.5rem' }}>
            <button
              onClick={handleTestConnection}
              disabled={isTesting}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#1e293b',
                fontSize: '0.85rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isTesting ? <RefreshCw size={14} className="spin" /> : null}
              {isTesting ? 'Testing connection...' : 'Test Connection'}
            </button>

            {testResult && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                background: testResult.success ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${testResult.success ? '#a7f3d0' : '#fecaca'}`,
                color: testResult.success ? '#065f46' : '#991b1b'
              }}>
                {testResult.success ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                <div>
                  <div style={{ fontWeight: '600' }}>
                    {testResult.success ? 'Connection Successful!' : 'Connection Failed'}
                  </div>
                  <div>{testResult.message}</div>
                </div>
              </div>
            )}
          </div>

          {/* Data Retrieval & Ingestion Filters */}
          <div style={{
            marginTop: '0.65rem',
            paddingTop: '0.9rem',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b' }}>
              Data Retrieval & Ingestion Filters
            </label>

            {/* Include Unapproved Data */}
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '9px',
              cursor: 'pointer',
              background: '#f8fafc',
              padding: '0.55rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0'
            }}>
              <input
                type="checkbox"
                checked={includeUnapproved}
                onChange={(e) => setIncludeUnapproved(e.target.checked)}
                style={{ marginTop: '3px', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: '#1e293b' }}>
                  Include unapproved data (off by default)
                </div>
                <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '1px' }}>
                  When unchecked, QA sessions in progress or awaiting physicist review/approval are excluded.
                </div>
              </div>
            </label>

            {/* Include Rejected Data */}
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '9px',
              cursor: 'pointer',
              background: '#f8fafc',
              padding: '0.55rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #e2e8f0'
            }}>
              <input
                type="checkbox"
                checked={includeRejected}
                onChange={(e) => setIncludeRejected(e.target.checked)}
                style={{ marginTop: '3px', cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: '600', color: '#1e293b' }}>
                  Include rejected data (off by default)
                </div>
                <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: '1px' }}>
                  When unchecked, QA sessions or test results marked as rejected are excluded.
                </div>
              </div>
            </label>
          </div>

          {/* Backup & Restore Configuration & Presets */}
          <div style={{
            marginTop: '0.65rem',
            paddingTop: '0.9rem',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Database size={15} color="#2563eb" />
              <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#1e293b' }}>
                Backup & Restore Configuration & Presets
              </label>
            </div>
            <p style={{ fontSize: '0.73rem', color: '#64748b', margin: 0 }}>
              Export all system configuration and saved view presets to a single JSON file, or restore them from a previous backup.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Export Button */}
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={isExporting || isRestoring}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#1e293b',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: (isExporting || isRestoring) ? 'not-allowed' : 'pointer'
                }}
              >
                {isExporting ? <RefreshCw size={13} className="spin" /> : <Download size={13} />}
                {isExporting ? 'Exporting...' : 'Export Backup (JSON)'}
              </button>

              {/* Restore Button (triggers hidden file input) */}
              <input
                type="file"
                ref={fileInputRef}
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExporting || isRestoring}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#1e293b',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: (isExporting || isRestoring) ? 'not-allowed' : 'pointer'
                }}
              >
                {isRestoring ? <RefreshCw size={13} className="spin" /> : <Upload size={13} />}
                {isRestoring ? 'Restoring...' : 'Restore from JSON'}
              </button>
            </div>

            {/* Replace Presets Checkbox */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.75rem', color: '#475569', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={replacePresets}
                onChange={(e) => setReplacePresets(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Replace existing presets on restore (otherwise presets merge by name)</span>
            </label>

            {/* Status message */}
            {backupRestoreStatus && (
              <div style={{
                padding: '0.6rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.78rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                background: backupRestoreStatus.type === 'success' ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${backupRestoreStatus.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
                color: backupRestoreStatus.type === 'success' ? '#065f46' : '#991b1b'
              }}>
                {backupRestoreStatus.type === 'success' ? <CheckCircle size={15} style={{ marginTop: '2px', flexShrink: 0 }} /> : <AlertCircle size={15} style={{ marginTop: '2px', flexShrink: 0 }} />}
                <div>{backupRestoreStatus.message}</div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#475569',
              fontSize: '0.85rem'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '8px',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: '0.85rem',
              fontWeight: '600'
            }}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
