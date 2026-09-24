import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Bookmark, Search, ChevronDown, Check, X, Layers, Sliders } from 'lucide-react';

export default function SearchablePresetSelect({
  presets = [],
  selectedPresetId = '',
  onSelectPreset,
  placeholder = '-- Load QA Preset --'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const activePreset = useMemo(() => {
    return presets.find(p => String(p.id) === String(selectedPresetId));
  }, [presets, selectedPresetId]);

  const filteredPresets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return presets;
    return presets.filter(p => {
      const nameMatch = p.name && p.name.toLowerCase().includes(q);
      const descMatch = p.description && p.description.toLowerCase().includes(q);
      return nameMatch || descMatch;
    });
  }, [presets, searchQuery]);

  const handleSelect = (id) => {
    onSelectPreset(id);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          padding: '0.42rem 0.75rem',
          borderRadius: '8px',
          border: '1px solid ' + (isOpen ? '#2563eb' : '#cbd5e1'),
          backgroundColor: '#f8fafc',
          color: activePreset ? '#0f172a' : '#64748b',
          fontSize: '0.85rem',
          fontWeight: activePreset ? '600' : '400',
          cursor: 'pointer',
          maxWidth: '240px',
          minWidth: '180px',
          outline: 'none',
          boxShadow: isOpen ? '0 0 0 2px rgba(37, 99, 235, 0.15)' : 'none',
          transition: 'all 0.15s ease'
        }}
        title={activePreset ? `${activePreset.name}: ${activePreset.description || 'No description'}` : 'Select a saved QA Preset'}
      >
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'left'
        }}>
          {activePreset ? activePreset.name : placeholder}
        </span>
        <ChevronDown
          size={14}
          color="#64748b"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
            flexShrink: 0
          }}
        />
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 5px)',
          left: 0,
          width: '320px',
          background: '#ffffff',
          borderRadius: '10px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #cbd5e1',
          zIndex: 1050,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Top Search Input */}
          <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid #f1f5f9',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Search size={14} color="#94a3b8" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search presets by name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: '0.82rem',
                width: '100%',
                color: '#0f172a'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Preset Options List */}
          <div style={{ maxHeight: '280px', overflowY: 'auto', padding: '4px 0' }}>
            {/* Clear / Reset Option */}
            <div
              onClick={() => handleSelect('')}
              style={{
                padding: '7px 12px',
                fontSize: '0.8rem',
                color: '#64748b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #f8fafc',
                background: !selectedPresetId ? '#f1f5f9' : 'transparent'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = !selectedPresetId ? '#f1f5f9' : 'transparent'; }}
            >
              <span>-- None (Unload Preset) --</span>
              {!selectedPresetId && <Check size={13} color="#2563eb" />}
            </div>

            {filteredPresets.length === 0 ? (
              <div style={{ padding: '1.25rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>
                {searchQuery ? `No presets match "${searchQuery}"` : 'No presets available.'}
              </div>
            ) : (
              filteredPresets.map(p => {
                const isSelected = String(p.id) === String(selectedPresetId);
                const dsCount = p.config?.datasets?.length || 1;
                const yVar = p.config?.yVariable;

                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelect(p.id)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '8px',
                      background: isSelected ? '#eff6ff' : 'transparent',
                      borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
                      transition: 'background 0.1s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.84rem',
                        fontWeight: isSelected ? '700' : '600',
                        color: isSelected ? '#1d4ed8' : '#0f172a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {p.name}
                      </div>

                      {p.description && (
                        <div style={{
                          fontSize: '0.74rem',
                          color: '#64748b',
                          marginTop: '2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {p.description}
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                        {yVar && (
                          <span style={{ fontSize: '0.68rem', color: '#0369a1', background: '#e0f2fe', padding: '1px 5px', borderRadius: '4px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {yVar}
                          </span>
                        )}
                        <span style={{ fontSize: '0.68rem', color: '#475569', background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>
                          {dsCount} dataset{dsCount > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <Check size={14} color="#2563eb" style={{ marginTop: '3px', flexShrink: 0 }} />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
