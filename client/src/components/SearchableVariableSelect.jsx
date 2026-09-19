import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X, Filter, Globe, Layers } from 'lucide-react';
import { getSortedGroupedTests, getUniqueTests } from '../utils/testGrouping';

export default function SearchableVariableSelect({
  value,
  onChange,
  tests = [],
  onlyNumeric = true,
  allowDateOption = false,
  returnStringOnly = false,
  includeAllInstances = true,
  onToggleIncludeAllInstances,
  placeholder = 'Select variable...',
  compact = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterList, setFilterList] = useState('ALL');
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  const usableTests = useMemo(() => {
    return onlyNumeric ? tests.filter(t => t.isNumeric) : tests;
  }, [tests, onlyNumeric]);

  const uniqueTests = useMemo(() => getUniqueTests(usableTests), [usableTests]);
  const sortedGroupedTests = useMemo(() => getSortedGroupedTests(usableTests), [usableTests]);

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

  const valName = typeof value === 'object' ? value?.name : value;
  const valList = typeof value === 'object' ? value?.list : '';
  const isDateSelected = allowDateOption && (valName === 'work_completed');

  const currentTest = useMemo(() => {
    if (!valName || valName === 'work_completed') return null;
    return usableTests.find(t => t.name === valName) || { name: valName, unit: '' };
  }, [valName, usableTests]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return sortedGroupedTests.filter(([listName]) => {
      if (filterList !== 'ALL' && listName !== filterList) return false;
      return true;
    }).map(([listName, items]) => {
      const matchingItems = items.filter(t => {
        if (!q) return true;
        return t.name.toLowerCase().includes(q) || listName.toLowerCase().includes(q);
      });
      return [listName, matchingItems];
    }).filter(([_, items]) => items.length > 0);
  }, [sortedGroupedTests, searchQuery, filterList]);

  const filteredAllInstances = useMemo(() => {
    if (filterList !== 'ALL') return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return uniqueTests;
    return uniqueTests.filter(t => t.name.toLowerCase().includes(q));
  }, [uniqueTests, searchQuery, filterList]);

  const handleSelect = (list, name) => {
    if (returnStringOnly) {
      onChange(name);
    } else {
      onChange({ list, name });
    }
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: compact ? '0.42rem 0.65rem' : '0.55rem 0.75rem',
          borderRadius: '8px',
          border: '1px solid ' + (isOpen ? '#2563eb' : '#cbd5e1'),
          background: '#ffffff',
          cursor: 'pointer',
          textAlign: 'left',
          boxShadow: isOpen ? '0 0 0 2px rgba(37, 99, 235, 0.15)' : 'none',
          transition: 'all 0.15s ease'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden' }}>
          {isDateSelected ? (
            <span style={{ fontWeight: '700', fontSize: compact ? '0.82rem' : '0.88rem', color: '#0f172a', whiteSpace: 'nowrap' }}>
              📅 Date (Time-Series Trend)
            </span>
          ) : (
            <>
              <span style={{ fontWeight: '700', fontSize: compact ? '0.82rem' : '0.88rem', color: currentTest ? '#0f172a' : '#94a3b8', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {currentTest ? currentTest.name : placeholder}
              </span>
              {currentTest?.unit && (
                <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#475569', padding: '1px 5px', borderRadius: '4px', fontWeight: '500' }}>
                  {currentTest.unit}
                </span>
              )}
              {!onlyNumeric && currentTest && (
                <span style={{ fontSize: '0.68rem', background: currentTest.isNumeric ? '#ecfdf5' : '#f8fafc', color: currentTest.isNumeric ? '#059669' : '#64748b', padding: '1px 5px', borderRadius: '4px', fontWeight: '600' }}>
                  {currentTest.isNumeric ? 'Numeric' : 'Text'}
                </span>
              )}
              {includeAllInstances && onToggleIncludeAllInstances ? (
                <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#2563eb', padding: '1px 6px', borderRadius: '4px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Globe size={11} /> All Lists
                </span>
              ) : valList ? (
                <span style={{ fontSize: '0.7rem', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', padding: '1px 6px', borderRadius: '4px', fontWeight: '500', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {valList}
                </span>
              ) : null}
            </>
          )}
        </div>
        <ChevronDown size={15} color="#64748b" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          background: '#ffffff',
          borderRadius: '10px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #cbd5e1',
          zIndex: 1050,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ padding: '0.65rem 0.75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={14} color="#64748b" style={{ position: 'absolute', left: '10px' }} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search variables or protocols (e.g. dose, gamma, temp)..."
                style={{
                  width: '100%',
                  padding: '0.45rem 1.75rem 0.45rem 2rem',
                  fontSize: '0.82rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  outline: 'none'
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 1 }}>
                <Filter size={13} color="#64748b" />
                <select
                  value={filterList}
                  onChange={(e) => setFilterList(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '3px 6px',
                    borderRadius: '5px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.78rem',
                    background: '#ffffff',
                    color: '#334155',
                    fontWeight: '500'
                  }}
                >
                  <option value="ALL">All Test Lists ({sortedGroupedTests.length})</option>
                  {sortedGroupedTests.map(([name, items]) => (
                    <option key={name} value={name}>
                      {name} ({items.length})
                    </option>
                  ))}
                </select>
              </div>

              {onToggleIncludeAllInstances && (
                <label style={{ fontSize: '0.73rem', fontWeight: '600', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={includeAllInstances}
                    onChange={(e) => onToggleIncludeAllInstances(e.target.checked)}
                  />
                  All Instances
                </label>
              )}
            </div>
          </div>

          <div style={{ maxHeight: '320px', overflowY: 'auto', padding: '0.35rem' }}>
            {allowDateOption && (!searchQuery || 'date time-series trend work_completed'.includes(searchQuery.toLowerCase())) && (
              <div
                onClick={() => handleSelect('', 'work_completed')}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  background: isDateSelected ? '#eff6ff' : 'transparent',
                  color: isDateSelected ? '#1d4ed8' : '#0f172a',
                  fontWeight: isDateSelected ? '700' : '600',
                  marginBottom: '0.35rem',
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: '8px'
                }}
                onMouseEnter={(e) => { if (!isDateSelected) e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={(e) => { if (!isDateSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📅 Date (Time-Series Trend)</span>
                </div>
                {isDateSelected && <Check size={14} color="#2563eb" />}
              </div>
            )}

            {includeAllInstances && filteredAllInstances.length > 0 && (
              <div style={{ marginBottom: '0.5rem' }}>
                <div style={{
                  fontSize: '0.72rem',
                  fontWeight: '700',
                  color: '#2563eb',
                  textTransform: 'uppercase',
                  padding: '4px 8px',
                  background: '#eff6ff',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}>
                  <Globe size={12} />
                  Across All Test Lists ({filteredAllInstances.length})
                </div>
                {filteredAllInstances.map(t => {
                  const isSelected = valName === t.name;
                  return (
                    <div
                      key={'global-' + t.name}
                      onClick={() => handleSelect('', t.name)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        background: isSelected ? '#eff6ff' : 'transparent',
                        color: isSelected ? '#1d4ed8' : '#1e293b',
                        fontWeight: isSelected ? '600' : '400',
                        transition: 'background 0.1s'
                      }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{t.name}</span>
                        {t.unit && <span style={{ fontSize: '0.7rem', color: '#64748b' }}>({t.unit})</span>}
                        {!onlyNumeric && (
                          <span style={{ fontSize: '0.68rem', background: t.isNumeric ? '#ecfdf5' : '#f8fafc', color: t.isNumeric ? '#059669' : '#64748b', padding: '1px 5px', borderRadius: '4px', fontWeight: '600' }}>
                            {t.isNumeric ? 'Numeric' : 'Text'}
                          </span>
                        )}
                        {t.isMultiList && (
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontStyle: 'italic' }}>
                            ({t.testLists.length} lists)
                          </span>
                        )}
                      </div>
                      {isSelected && <Check size={14} color="#2563eb" />}
                    </div>
                  );
                })}
              </div>
            )}

            {filteredGroups.length === 0 && (!includeAllInstances || filteredAllInstances.length === 0) ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>
                No measurement variables found matching "{searchQuery}".
              </div>
            ) : (
              filteredGroups.map(([listName, items]) => (
                <div key={listName} style={{ marginBottom: '0.5rem' }}>
                  <div style={{
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    color: '#475569',
                    textTransform: 'uppercase',
                    padding: '4px 8px',
                    background: '#f1f5f9',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Layers size={12} color="#64748b" />
                      {listName}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: '500' }}>
                      {items.length} {items.length === 1 ? 'variable' : 'variables'}
                    </span>
                  </div>

                  {items.map(t => {
                    const isSelected = (!includeAllInstances && valList === listName && valName === t.name) ||
                                       (includeAllInstances && valName === t.name && !valList);
                    return (
                      <div
                        key={listName + '-' + t.name}
                        onClick={() => handleSelect(listName, t.name)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                          background: isSelected ? '#eff6ff' : 'transparent',
                          color: isSelected ? '#1d4ed8' : '#1e293b',
                          fontWeight: isSelected ? '600' : '400',
                          transition: 'background 0.1s'
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{t.name}</span>
                          {t.unit && <span style={{ fontSize: '0.7rem', color: '#64748b' }}>({t.unit})</span>}
                          {!onlyNumeric && (
                            <span style={{ fontSize: '0.68rem', background: t.isNumeric ? '#ecfdf5' : '#f8fafc', color: t.isNumeric ? '#059669' : '#64748b', padding: '1px 5px', borderRadius: '4px', fontWeight: '600' }}>
                              {t.isNumeric ? 'Numeric' : 'Text'}
                            </span>
                          )}
                        </div>
                        {isSelected && <Check size={14} color="#2563eb" />}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
