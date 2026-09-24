import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Navbar from './components/Navbar';
import DatasetManager from './components/DatasetManager';
import ChartCanvas from './components/ChartCanvas';
import DatasetComparisonTable from './components/DatasetComparisonTable';
import DataTable from './components/DataTable';
import SettingsModal from './components/SettingsModal';
import SavePresetModal from './components/SavePresetModal';
import PresetManagerModal from './components/PresetManagerModal';
import SyncProgressModal from './components/SyncProgressModal';
import SessionDetailsModal from './components/SessionDetailsModal';
import { BarChart3, Table as TableIcon, RefreshCw } from 'lucide-react';
import { calculateStats, computeLinearRegression, identifyOutlierSessionIds } from './utils/math';

const DEFAULT_PALETTE = [
  '#2563eb', // Blue
  '#dc2626', // Red
  '#059669', // Emerald
  '#d97706', // Amber
  '#7c3aed', // Purple
  '#0891b2', // Cyan
  '#db2777', // Pink
  '#475569'  // Slate
];

export default function App() {
  const [status, setStatus] = useState(null);
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [units, setUnits] = useState([]);
  const [unitClasses, setUnitClasses] = useState([]);
  const [tests, setTests] = useState([]);
  const [years, setYears] = useState([]);

  // Multi-Dataset State
  const [datasets, setDatasets] = useState([
    {
      id: 'ds-1',
      name: 'Data Set 1',
      color: '#2563eb',
      visible: true,
      units: [],
      dateFrom: '',
      dateTo: '',
      filters: []
    }
  ]);
  const [activeDatasetId, setActiveDatasetId] = useState('ds-1');

  // Global Plot & Variable Controls
  const [xVariable, setXVariable] = useState('work_completed');
  const [yVariable, setYVariable] = useState('');
  const [selectedTestList, setSelectedTestList] = useState('');
  const [includeAllInstances, setIncludeAllInstances] = useState(true);
  const [displayMode, setDisplayMode] = useState('scatter'); // 'scatter', 'line', 'distribution'
  const [trendlineConfig, setTrendlineConfig] = useState({
    enabled: false,
    type: 'linear',
    windowSize: 5,
    order: 2,
    forecastEnabled: false,
    forecastValue: 30,
    forecastUnit: 'days'
  });

  // Reference baseline value and +/- tolerance limits state
  const [baselineConfig, setBaselineConfig] = useState({
    enabled: false,
    baseline: '',
    upperTol: '',
    lowerTol: '',
    symmetric: true
  });

  // Ignored / Excluded points state
  const [ignoredSessionIds, setIgnoredSessionIds] = useState([]);

  // Results state
  const [datasetResults, setDatasetResults] = useState({});
  const [testLists, setTestLists] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isConfigStale, setIsConfigStale] = useState(false);
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' or 'table'

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavePresetOpen, setIsSavePresetOpen] = useState(false);
  const [isPresetManagerOpen, setIsPresetManagerOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [inspectedSessionId, setInspectedSessionId] = useState(null);
  const [syncStatus, setSyncStatus] = useState({
    isRunning: false,
    isCancelled: false,
    stage: 'Ready',
    syncedSessions: 0,
    totalAvailable: null,
    heapUsedMB: 0,
    rssMB: 0,
    durationMs: 0
  });

  // Load Status & Schemas
  const loadMetadata = useCallback(async () => {
    try {
      const [statusRes, unitsRes, unitClassesRes, testsRes, presetsRes, yearsRes, testListsRes] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/schema/units').then(r => r.json()),
        fetch('/api/schema/unit-classes').then(r => r.json()),
        fetch('/api/schema/tests').then(r => r.json()),
        fetch('/api/presets').then(r => r.json()),
        fetch('/api/schema/years').then(r => r.json()),
        fetch('/api/schema/test-lists').then(r => r.json())
      ]);

      setStatus(statusRes);
      setUnits(unitsRes || []);
      setUnitClasses(unitClassesRes || []);
      setTests(testsRes || []);
      setPresets(presetsRes || []);
      setYears(yearsRes || []);
      setTestLists(testListsRes || []);

      const numerics = (testsRes || []).filter(t => t.isNumeric);
      if (numerics.length > 0) {
        setYVariable(prevY => {
          if (prevY && numerics.some(t => t.name === prevY)) return prevY;
          return numerics[0].name;
        });
        setXVariable(prevX => {
          if (prevX === 'work_completed') return 'work_completed';
          if (prevX && numerics.some(t => t.name === prevX)) return prevX;
          return 'work_completed';
        });
      }
    } catch (err) {
      console.error('Failed to load app metadata:', err);
    }
  }, []);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  // Dataset Management Handlers
  const handleAddDataset = () => {
    const newId = `ds-${Date.now()}`;
    const nextColor = DEFAULT_PALETTE[datasets.length % DEFAULT_PALETTE.length];
    const newDs = {
      id: newId,
      name: `Data Set ${datasets.length + 1}`,
      color: nextColor,
      visible: true,
      units: [],
      dateFrom: '',
      dateTo: '',
      filters: []
    };
    setDatasets(prev => [...prev, newDs]);
    setActiveDatasetId(newId);
  };

  const handleUpdateDataset = (id, updates) => {
    setDatasets(prev => prev.map(d => (d.id === id ? { ...d, ...updates } : d)));
  };

  const handleDeleteDataset = (id) => {
    if (datasets.length <= 1) return;
    setDatasets(prev => prev.filter(d => d.id !== id));
    if (activeDatasetId === id) {
      const remaining = datasets.filter(d => d.id !== id);
      if (remaining.length > 0) setActiveDatasetId(remaining[0].id);
    }
  };

  const handleDuplicateDataset = (id) => {
    const orig = datasets.find(d => d.id === id);
    if (!orig) return;
    const newId = `ds-${Date.now()}`;
    const nextColor = DEFAULT_PALETTE[(datasets.length + 1) % DEFAULT_PALETTE.length];
    const newDs = {
      ...orig,
      id: newId,
      name: `${orig.name} (Copy)`,
      color: nextColor
    };
    setDatasets(prev => [...prev, newDs]);
    setActiveDatasetId(newId);
  };

  const handleToggleDatasetVisibility = (id) => {
    setDatasets(prev => prev.map(d => (d.id === id ? { ...d, visible: !d.visible } : d)));
  };

  const handleSplitDatasetByFilter = (datasetId, testName, values) => {
    if (!values || values.length === 0) return;
    const orig = datasets.find(d => d.id === datasetId) || datasets[0];
    if (!orig) return;

    // Retain other filters not matching testName
    const otherFilters = (orig.filters || []).filter(f => f.testName !== testName);

    // Create a new dataset for each distinct value
    const generated = values.map((val, idx) => {
      const color = DEFAULT_PALETTE[(datasets.length + idx) % DEFAULT_PALETTE.length];
      const baseName = orig.name && !orig.name.startsWith('Data Set') ? `${orig.name} - ` : '';
      return {
        id: `ds-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
        name: baseName ? `${baseName}${val}` : `${testName}: ${val}`,
        color: color,
        visible: true,
        units: [...(orig.units || [])],
        dateFrom: orig.dateFrom || '',
        dateTo: orig.dateTo || '',
        filters: [
          ...otherFilters,
          { testName, operator: 'equals', value: String(val) }
        ]
      };
    });

    // Replace the original dataset with the new split datasets
    setDatasets(prev => {
      const targetIndex = prev.findIndex(d => d.id === datasetId);
      if (targetIndex === -1) return [...prev, ...generated];
      const next = [...prev];
      next.splice(targetIndex, 1, ...generated);
      return next;
    });

    if (generated.length > 0) {
      setActiveDatasetId(generated[0].id);
    }
  };

  const handleSplitDatasetByUnit = (datasetId, unitNames) => {
    const orig = datasets.find(d => d.id === datasetId) || datasets[0];
    if (!orig) return;

    // Determine target units to split:
    // If orig.units has 2+ units, split by those selected units;
    // Otherwise split by unitNames provided (or all active units from metadata)
    let targets = (orig.units && orig.units.length > 0) ? orig.units : (unitNames || []);
    if (!targets || targets.length === 0) {
      targets = units.filter(u => u.active !== 0).map(u => u.name);
    }

    if (targets.length <= 1) {
      alert('Cannot split: only 1 unit is available. Please select "All Units" or multiple units to split into separate datasets.');
      return;
    }

    // Create a new dataset for each unit based on the currently configured dataset settings
    const generated = targets.map((uName, idx) => {
      const color = DEFAULT_PALETTE[(datasets.length + idx) % DEFAULT_PALETTE.length];
      const baseName = orig.name && !orig.name.startsWith('Data Set') ? `${orig.name} (${uName})` : uName;
      return {
        id: `ds-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
        name: baseName,
        color: color,
        visible: true,
        units: [uName],
        testLists: [...(orig.testLists || [])],
        includeAllInstances: orig.includeAllInstances !== undefined ? orig.includeAllInstances : true,
        dateFrom: orig.dateFrom || '',
        dateTo: orig.dateTo || '',
        filters: [...(orig.filters || [])]
      };
    });

    let nextDatasets = [];
    setDatasets(prev => {
      const targetIndex = prev.findIndex(d => d.id === datasetId);
      const next = [...prev];
      if (targetIndex === -1) {
        nextDatasets = [...prev, ...generated];
      } else {
        next.splice(targetIndex, 1, ...generated);
        nextDatasets = next;
      }
      return nextDatasets;
    });

    if (generated.length > 0) {
      setActiveDatasetId(generated[0].id);
    }

    // If data has already been loaded, automatically run queries on the new datasets
    if (hasLoaded) {
      runAllQueries({ datasets: nextDatasets });
    }
  };

  const handleNewAnalysis = () => {
    if (!window.confirm('Start a new analysis? This will clear all configured datasets, custom filters, and excluded data points.')) return;
    const initialId = `ds-${Date.now()}`;
    setDatasets([
      {
        id: initialId,
        name: 'Data Set 1',
        color: DEFAULT_PALETTE[0],
        visible: true,
        units: [],
        testLists: [],
        includeAllInstances: true,
        dateFrom: '',
        dateTo: '',
        filters: []
      }
    ]);
    setActiveDatasetId(initialId);
    setIgnoredSessionIds([]);
    setSelectedPresetId('');
    setSelectedTestList('');
    setTrendlineConfig({
      enabled: false,
      type: 'linear',
      windowSize: 5,
      order: 2,
      forecastEnabled: false,
      forecastValue: 30,
      forecastUnit: 'days'
    });
    setBaselineConfig({ enabled: false, baseline: '', upperTol: '', lowerTol: '', symmetric: true });
    setIncludeAllInstances(true);
    setDisplayMode('scatter');
    setActiveTab('chart');
    loadedConfigRef.current = null;
    setHasLoaded(false);
    setIsConfigStale(false);
    setDatasetResults({});
  };

  const handleToggleIncludeAllInstances = useCallback((checked) => {
    setIncludeAllInstances(checked);
    if (!checked && !selectedTestList) {
      const match = tests.find(t => t.isNumeric && t.name === yVariable);
      if (match) {
        setSelectedTestList(match.testList || 'General QA');
      }
    }
  }, [selectedTestList, tests, yVariable]);

  // In-memory query cache for instantaneous preset toggling and repeated local queries
  const queryCacheRef = useRef(new Map());

  const getQueryCacheKey = (ds, effectiveX, effectiveY, effectiveSelectedTestList, effectiveIncludeAll) => {
    const effLists = !effectiveIncludeAll && effectiveSelectedTestList
      ? [effectiveSelectedTestList]
      : (ds.testLists || []);
    const uKey = (ds.units || []).slice().sort().join(',');
    const tlKey = effLists.slice().sort().join(',');
    const fKey = (ds.filters || []).map(f => `${f.testName}:${f.operator}:${f.value}`).join(';');
    return `${effectiveY}|${effectiveX || 'work_completed'}|${effectiveIncludeAll ? '1' : '0'}|${effectiveSelectedTestList || ''}|${status?.qatrack?.includeUnapproved ? '1' : '0'}|${uKey}|${tlKey}|${ds.dateFrom || ''}|${ds.dateTo || ''}|${fKey}`;
  };

  // Execute Queries for all Datasets (Local SQLite + In-Memory Cache)
  const runAllQueries = useCallback(async (options = {}) => {
    const {
      pullOnDemand = false,
      datasets: overrideDatasets,
      yVariable: overrideY,
      xVariable: overrideX,
      selectedTestList: overrideTestList,
      includeAllInstances: overrideIncludeAll
    } = options;

    const effDatasets = overrideDatasets || datasets;
    const effectiveY = overrideY !== undefined ? overrideY : yVariable;
    const effectiveX = overrideX !== undefined ? overrideX : xVariable;
    const effectiveSelectedTestList = overrideTestList !== undefined ? overrideTestList : selectedTestList;
    const effectiveIncludeAll = overrideIncludeAll !== undefined ? overrideIncludeAll : includeAllInstances;

    if (!effectiveY) return null;

    setIsLoading(true);
    try {
      const activeDatasets = effDatasets.filter(d => d.visible !== false);
      let anyNeedsPull = false;
      let totalPoints = 0;
      const nextResults = {};

      for (const ds of effDatasets) {
        if (ds.visible === false) continue;

      let allPts = [];
      let tableRows = [];
      let needsPull = false;

      const cacheKey = getQueryCacheKey(ds, effectiveX, effectiveY, effectiveSelectedTestList, effectiveIncludeAll);

      if (queryCacheRef.current.has(cacheKey)) {
        const cached = queryCacheRef.current.get(cacheKey);
        allPts = cached.dataPoints;
        tableRows = cached.tableRows;
        needsPull = cached.needsPull;
      } else {
        try {
          const effectiveTestLists = !effectiveIncludeAll && effectiveSelectedTestList
            ? [effectiveSelectedTestList]
            : (ds.testLists || []);

          const res = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              units: ds.units,
              testLists: effectiveTestLists,
              testList: !effectiveIncludeAll ? effectiveSelectedTestList : '',
              includeAllInstances: effectiveIncludeAll,
              includeUnapproved: status?.qatrack?.includeUnapproved ?? true,
              includeRejected: status?.qatrack?.includeRejected ?? false,
              dateFrom: ds.dateFrom,
              dateTo: ds.dateTo,
              filters: ds.filters,
              xVariable: effectiveX,
              yVariable: effectiveY,
              pullOnDemand
            })
          });
          const data = await res.json();
          allPts = data.dataPoints || [];
          tableRows = data.tableRows || [];
          needsPull = Boolean(data.needsPull);

          queryCacheRef.current.set(cacheKey, {
            dataPoints: allPts,
            tableRows,
            needsPull
          });
        } catch (err) {
          console.error('Query error:', err);
        }
      }

      if (needsPull) anyNeedsPull = true;
      totalPoints += allPts.length;

      const ignoredSet = new Set(ignoredSessionIds);
      const activePts = allPts.filter(p => !ignoredSet.has(p.sessionId));
      const yVals = activePts.map(p => p.y).filter(v => typeof v === 'number' && !isNaN(v));

      const stats = calculateStats(yVals);
      const isDateX = !effectiveX || effectiveX === 'work_completed';
      const regression = computeLinearRegression(activePts, isDateX);

      nextResults[ds.id] = {
        dataPoints: allPts,
        tableRows: tableRows.map(r => ({
          ...r,
          datasetName: ds.name,
          datasetColor: ds.color
        })),
        stats,
        regression,
        ignoredCount: allPts.length - activePts.length
      };
    }

    setDatasetResults(nextResults);
      loadedConfigRef.current = JSON.stringify({
        xVariable: effectiveX,
        yVariable: effectiveY,
        selectedTestList: effectiveSelectedTestList,
        includeAllInstances: effectiveIncludeAll,
        datasets: activeDatasets.map(d => ({
          id: d.id,
          units: [...(d.units || [])].sort(),
          dateFrom: d.dateFrom || '',
          dateTo: d.dateTo || '',
          filters: (d.filters || []).map(f => ({
            testName: f.testName,
            operator: f.operator,
            value: f.value
          }))
        }))
      });
      setIsConfigStale(false);
      setHasLoaded(true);
      return { totalPoints, needsPull: anyNeedsPull };
    } catch (err) {
      console.error('Multi-dataset query error:', err);
      return { totalPoints: 0, needsPull: false };
    } finally {
      setIsLoading(false);
    }
  }, [datasets, xVariable, yVariable, selectedTestList, ignoredSessionIds, includeAllInstances]);

  const handleToggleIncludeUnapproved = useCallback(async (checked) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: status?.qatrack?.baseUrl,
          token: status?.qatrack?.hasToken ? undefined : '',
          authType: status?.qatrack?.authType,
          includeUnapproved: checked,
          includeRejected: status?.qatrack?.includeRejected
        })
      });
      if (res.ok) {
        queryCacheRef.current.clear();
        await loadMetadata();
        runAllQueries();
      }
    } catch (err) {
      console.error('Failed to update includeUnapproved setting:', err);
    }
  }, [status, loadMetadata, runAllQueries]);

  const loadedConfigRef = useRef(null);

  const getConfigSnapshot = useCallback(() => {
    return JSON.stringify({
      xVariable,
      yVariable,
      selectedTestList,
      includeAllInstances,
      baselineConfig,
      datasets: datasets.map(d => ({
        id: d.id,
        units: [...(d.units || [])].sort(),
        dateFrom: d.dateFrom || '',
        dateTo: d.dateTo || '',
        filters: (d.filters || []).map(f => ({
          testName: f.testName,
          operator: f.operator,
          value: f.value
        }))
      }))
    });
  }, [xVariable, yVariable, selectedTestList, includeAllInstances, baselineConfig, datasets]);

  // Compute scoped tests based on selected Measurement Variable (Y-Axis)
  const scopedTests = useMemo(() => {
    if (!yVariable || !tests || tests.length === 0) return tests;
    let targetLists = [];
    if (!includeAllInstances && selectedTestList) {
      targetLists = [selectedTestList];
    } else {
      const matchingDefs = tests.filter(t => t.name === yVariable);
      targetLists = [...new Set(matchingDefs.map(t => t.testList).filter(Boolean))];
    }
    if (targetLists.length === 0) return tests;
    return tests.filter(t => targetLists.includes(t.testList));
  }, [yVariable, selectedTestList, includeAllInstances, tests]);

  const scopedNumericTests = useMemo(() => {
    return scopedTests.filter(t => t.isNumeric);
  }, [scopedTests]);

  // If X-variable is numeric and no longer exists in the scoped test list, reset to work_completed
  useEffect(() => {
    if (xVariable && xVariable !== 'work_completed' && scopedNumericTests.length > 0) {
      if (!scopedNumericTests.some(t => t.name === xVariable)) {
        setXVariable('work_completed');
      }
    }
  }, [scopedNumericTests, xVariable]);

  // Track configuration changes without false triggers by comparing against loaded snapshot
  useEffect(() => {
    if (hasLoaded && loadedConfigRef.current) {
      const current = getConfigSnapshot();
      if (current !== loadedConfigRef.current) {
        setIsConfigStale(true);
      } else {
        setIsConfigStale(false);
      }
    }
  }, [getConfigSnapshot, hasLoaded]);

  // Delete preset handler
  const handleDeletePreset = async (id) => {
    if (!id) return;
    const preset = presets.find(p => String(p.id) === String(id));
    const name = preset ? preset.name : 'this preset';
    if (!window.confirm(`Are you sure you want to delete preset "${name}"?`)) return;

    try {
      const res = await fetch(`/api/presets/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        if (String(selectedPresetId) === String(id)) {
          setSelectedPresetId('');
        }
        await loadMetadata();
      } else {
        alert('Failed to delete preset: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error deleting preset: ' + err.message);
    }
  };

  // Handle Presets (Instant Local Loading)
  const handleSelectPreset = (id, overridePresets) => {
    setSelectedPresetId(id);
    if (!id) return;
    const pool = overridePresets || presets;
    const preset = pool.find(p => String(p.id) === String(id));
    if (preset && preset.config) {
      const cfg = preset.config;
      const nextX = cfg.xVariable !== undefined ? cfg.xVariable : xVariable;
      const nextY = cfg.yVariable !== undefined ? cfg.yVariable : yVariable;
      const nextList = cfg.selectedTestList !== undefined ? cfg.selectedTestList : selectedTestList;
      const nextIncludeAll = cfg.includeAllInstances !== undefined ? cfg.includeAllInstances : includeAllInstances;

      let nextDatasets = datasets;
      if (cfg.datasets && Array.isArray(cfg.datasets)) {
        nextDatasets = cfg.datasets;
      } else if (cfg.filters || cfg.units) {
        // Fallback for single-dataset presets
        nextDatasets = [
          {
            id: 'ds-1',
            name: preset.name || 'Data Set 1',
            color: '#2563eb',
            visible: true,
            units: cfg.units || [],
            dateFrom: cfg.dateFrom || '',
            dateTo: cfg.dateTo || '',
            filters: cfg.filters || []
          }
        ];
      }

      if (cfg.xVariable !== undefined) setXVariable(cfg.xVariable);
      if (cfg.yVariable !== undefined) setYVariable(cfg.yVariable);
      if (cfg.selectedTestList !== undefined) setSelectedTestList(cfg.selectedTestList);
      if (cfg.includeAllInstances !== undefined) setIncludeAllInstances(cfg.includeAllInstances);
      if (cfg.displayMode) {
        setDisplayMode(cfg.displayMode);
      } else if (cfg.plotType) {
        setDisplayMode(cfg.plotType === 'trend' ? 'line' : cfg.plotType);
      }
      if (cfg.trendlineConfig) {
        setTrendlineConfig({
          enabled: Boolean(cfg.trendlineConfig.enabled),
          type: cfg.trendlineConfig.type || 'linear',
          windowSize: cfg.trendlineConfig.windowSize || 5,
          order: cfg.trendlineConfig.order || 2,
          forecastEnabled: Boolean(cfg.trendlineConfig.forecastEnabled),
          forecastValue: cfg.trendlineConfig.forecastValue ?? 30,
          forecastUnit: cfg.trendlineConfig.forecastUnit || 'days'
        });
      }
      if (cfg.baselineConfig) {
        setBaselineConfig({
          enabled: Boolean(cfg.baselineConfig.enabled),
          baseline: cfg.baselineConfig.baseline ?? '',
          upperTol: cfg.baselineConfig.upperTol ?? '',
          lowerTol: cfg.baselineConfig.lowerTol ?? '',
          symmetric: cfg.baselineConfig.symmetric !== undefined ? Boolean(cfg.baselineConfig.symmetric) : true
        });
      } else if (cfg.baseline !== undefined) {
        setBaselineConfig({
          enabled: true,
          baseline: cfg.baseline ?? '',
          upperTol: cfg.tolerancePlus ?? cfg.tolerance ?? '',
          lowerTol: cfg.toleranceMinus ?? cfg.tolerance ?? '',
          symmetric: true
        });
      } else {
        setBaselineConfig({
          enabled: false,
          baseline: '',
          upperTol: '',
          lowerTol: '',
          symmetric: true
        });
      }
      setDatasets(nextDatasets);
      if (nextDatasets[0]?.id) setActiveDatasetId(nextDatasets[0].id);

      // Immediately execute local query so preset loads and plots instantaneously!
      runAllQueries({
        datasets: nextDatasets,
        yVariable: nextY,
        xVariable: nextX,
        selectedTestList: nextList,
        includeAllInstances: nextIncludeAll
      }).then(res => {
        if (res?.needsPull && res?.totalPoints === 0 && status?.qatrack?.configured) {
          handleFetchFromQATrack({
            yVariable: nextY,
            selectedTestList: nextList,
            includeAllInstances: nextIncludeAll,
            datasets: nextDatasets
          });
        }
      });
    }
  };

  const handleExportPresets = () => {
    if (presets.length === 0) {
      alert('No presets saved to export.');
      return;
    }
    const url = selectedPresetId
      ? `/api/presets/export?id=${encodeURIComponent(selectedPresetId)}`
      : '/api/presets/export';
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportSuccess = async (data) => {
    await loadMetadata();
    const updatedPresets = data?.presets || [];
    if (updatedPresets.length > 0) {
      setPresets(updatedPresets);
    }
    if (data?.processed?.length > 0) {
      const firstId = data.processed[0].id;
      if (firstId) {
        handleSelectPreset(firstId, updatedPresets);
      }
    }
  };

  // Sync Live API with live modal tracking & cancel support
  const handleSync = async (options = {}) => {
    const mode = options.mode || 'metadata';
    setIsSyncing(true);
    setIsSyncModalOpen(true);
    setSyncStatus({
      isRunning: true,
      isCancelled: false,
      stage: mode === 'metadata'
        ? 'Syncing QA structure (units, test lists, variables)...'
        : (mode === 'ondemand'
            ? `Retrieving targeted records for ${options.testListNames?.length ? options.testListNames.join(', ') : (options.yVariable || 'configured filters')}...`
            : 'Connecting to QATrack+ for full sync...'),
      syncedSessions: 0,
      totalAvailable: null,
      heapUsedMB: 0,
      rssMB: 0,
      durationMs: 0
    });

    let metadataRefreshed = false;
    // Start polling sync status
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/sync/status');
        if (res.ok) {
          const data = await res.json();
          setSyncStatus(data);
          if (!metadataRefreshed && (data.syncedSessions > 0 || (data.stage && (data.stage.includes('Syncing QA') || data.stage.includes('Querying') || data.stage.includes('retrieved'))))) {
            metadataRefreshed = true;
            loadMetadata();
          }
          if (!data.isRunning) {
            clearInterval(pollInterval);
          }
        }
      } catch (e) {
        // Ignore transient poll failures
      }
    }, 400);

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...options,
          mode,
          clearExisting: options.clearExisting || false
        })
      });
      const data = await res.json();
      clearInterval(pollInterval);

      // Fetch final sync status snapshot
      try {
        const finalRes = await fetch('/api/sync/status');
        if (finalRes.ok) {
          const finalData = await finalRes.json();
          setSyncStatus(finalData);
        }
      } catch (_) {}

      if (data.success || data.cancelled) {
        queryCacheRef.current.clear();
        setIgnoredSessionIds([]);
        await loadMetadata();
        runAllQueries();
      } else {
        alert(`Sync Failed: ${data.message || 'Check QATrack+ configuration in Settings.'}`);
      }
    } catch (err) {
      clearInterval(pollInterval);
      alert(`Sync Error: ${err.message}`);
    } finally {
      setIsSyncing(false);
      await loadMetadata();
    }
  };

  const handleCancelSync = async () => {
    try {
      setSyncStatus(prev => ({ ...prev, isCancelled: true, stage: 'Cancelling import...' }));
      await fetch('/api/sync/cancel', { method: 'POST' });
    } catch (err) {
      console.error('Failed to cancel sync:', err);
    }
  };

  // Explicit QATrack Fetch / Sync for configured datasets
  const handleFetchFromQATrack = useCallback(async (options = {}) => {
    const effectiveY = options.yVariable || yVariable;
    if (!effectiveY) {
      alert('Please select a Measurement Variable (Y-Axis) before fetching data from QATrack+.');
      return;
    }

    if (!status?.qatrack?.configured) {
      alert('QATrack+ server is not configured. Configure your QATrack+ URL and API token in Settings.');
      return;
    }

    const effectiveTestList = options.selectedTestList !== undefined ? options.selectedTestList : selectedTestList;
    const effectiveIncludeAll = options.includeAllInstances !== undefined ? options.includeAllInstances : includeAllInstances;
    const activeDatasets = (options.datasets || datasets).filter(d => d.visible !== false);

    let targetLists = [];
    if (!effectiveIncludeAll && effectiveTestList) {
      targetLists = [effectiveTestList];
    } else {
      const matchingDefs = tests.filter(t => t.name === effectiveY);
      targetLists = [...new Set(matchingDefs.map(t => t.testList).filter(Boolean))];
    }

    // Filter out generic placeholder if specific lists exist
    if (targetLists.length > 1 && targetLists.includes('General QA')) {
      targetLists = targetLists.filter(l => l !== 'General QA');
    }

    // Collect specific units if specified in active datasets (preserve explicit selections)
    const specifiedUnits = [...new Set(activeDatasets.flatMap(d => d.units || []))];
    const allUnits = specifiedUnits.length > 0
      ? specifiedUnits
      : units.filter(u => u.active !== 0).map(u => u.name);

    // Collect date boundaries across active datasets if specified
    const dateFroms = activeDatasets.map(d => d.dateFrom).filter(Boolean);
    const dateTos = activeDatasets.map(d => d.dateTo).filter(Boolean);
    const minDateFrom = dateFroms.length > 0 ? dateFroms.sort()[0] : undefined;
    const maxDateTo = dateTos.length > 0 ? dateTos.sort().reverse()[0] : undefined;

    // Invalidate in-memory query cache so newly fetched records from QATrack are loaded
    queryCacheRef.current.clear();

    await handleSync({
      mode: 'ondemand',
      testListNames: targetLists,
      unitNames: allUnits,
      dateFrom: minDateFrom,
      dateTo: maxDateTo,
      yVariable: effectiveY,
      includeUnapproved: options.includeUnapproved !== undefined ? options.includeUnapproved : (status?.qatrack?.includeUnapproved ?? true),
      includeRejected: options.includeRejected !== undefined ? options.includeRejected : (status?.qatrack?.includeRejected ?? false),
      limit: null
    });
  }, [yVariable, status, includeAllInstances, selectedTestList, tests, datasets, units, handleSync]);

  // Query Local Database / In-Memory Cache (Instant Execution)
  const handleRunLocalQuery = useCallback(async (options = {}) => {
    if (!yVariable) {
      alert('Please select a Measurement Variable (Y-Axis) before loading data.');
      return;
    }

    const wasLoaded = hasLoaded;
    setIsConfigStale(false);
    setHasLoaded(true);

    const queryRes = await runAllQueries(options);

    // Only auto-retrieve from QATrack on initial load if the local database has 0 records for this variable.
    // If data was already loaded, changing filters or machines should never trigger an automatic network pull.
    if (!wasLoaded && queryRes && queryRes.totalPoints === 0 && queryRes.needsPull && status?.qatrack?.configured) {
      await handleFetchFromQATrack(options);
    }
  }, [yVariable, hasLoaded, runAllQueries, status, handleFetchFromQATrack]);

  // Alias for backward compatibility
  const handleRetrieveOnDemand = handleRunLocalQuery;

  // Clear All Data
  const handleClearData = async () => {
    if (confirm('Delete all cached QA measurements from the database? You can re-sync from QATrack+ at any time.')) {
      setIsLoading(true);
      try {
        const res = await fetch('/api/clear-data', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          queryCacheRef.current.clear();
          setIgnoredSessionIds([]);
          setDatasetResults({});
          setHasLoaded(false);
          setIsConfigStale(false);
          await loadMetadata();
        }
      } catch (err) {
        alert('Clear error: ' + err.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Load Demonstration QA Dataset
  const handleLoadDemoData = async () => {
    if (status?.db?.sessionCount > 0) {
      if (!window.confirm('Load sample demonstration QA dataset? This will add realistic longitudinal QA metrics and machine records to the database.')) {
        return;
      }
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/demo/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearExisting: false })
      });
      const data = await res.json();
      if (data.success) {
        queryCacheRef.current.clear();
        await loadMetadata();
        const demoDsId = `ds-${Date.now()}`;
        const demoDatasets = [
          {
            id: demoDsId,
            name: 'Demo Linacs (All)',
            color: DEFAULT_PALETTE[0],
            visible: true,
            units: [],
            testLists: [],
            includeAllInstances: true,
            dateFrom: '',
            dateTo: '',
            filters: []
          }
        ];
        setDatasets(demoDatasets);
        setActiveDatasetId(demoDsId);
        setIgnoredSessionIds([]);
        setYVariable('Overall Gamma (%)');
        setXVariable('work_completed');
        setIncludeAllInstances(true);
        setSelectedTestList('');
        setHasLoaded(true);
        setIsConfigStale(false);

        await runAllQueries({
          datasets: demoDatasets,
          yVariable: 'Overall Gamma (%)',
          xVariable: 'work_completed',
          includeAllInstances: true,
          selectedTestList: ''
        });
      } else {
        alert('Failed to load demo data: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error loading demo data: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Ignore Handlers
  const handleIgnorePoint = (sessionId) => {
    setIgnoredSessionIds(prev => (prev.includes(sessionId) ? prev : [...prev, sessionId]));
  };

  const handleToggleIgnore = (sessionId) => {
    setIgnoredSessionIds(prev =>
      prev.includes(sessionId) ? prev.filter(id => id !== sessionId) : [...prev, sessionId]
    );
  };

  const handleRestoreAllIgnored = () => {
    setIgnoredSessionIds([]);
  };

  const handleRemoveOutliers = () => {
    const outlierIds = identifyOutlierSessionIds(datasets, datasetResults, ignoredSessionIds);
    if (!outlierIds || outlierIds.length === 0) {
      alert('No statistical outliers (1.5 × IQR) detected in the current data sets.');
      return;
    }
    setIgnoredSessionIds(prev => {
      const set = new Set(prev);
      outlierIds.forEach(id => set.add(id));
      return Array.from(set);
    });
  };

  // Aggregated table rows for DataTable
  const combinedTableRows = useMemo(() => {
    const rows = [];
    for (const ds of datasets) {
      if (ds.visible !== false && datasetResults[ds.id]?.tableRows) {
        rows.push(...datasetResults[ds.id].tableRows);
      }
    }
    return rows;
  }, [datasets, datasetResults]);

  const currentConfig = {
    datasets,
    xVariable,
    yVariable,
    selectedTestList,
    includeAllInstances,
    displayMode,
    trendlineConfig,
    baselineConfig
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        status={status}
        presets={presets}
        selectedPreset={selectedPresetId}
        onSelectPreset={handleSelectPreset}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenSavePreset={() => setIsSavePresetOpen(true)}
        onOpenPresetManager={() => setIsPresetManagerOpen(true)}
        onSync={handleSync}
        onClearData={handleClearData}
        onNewAnalysis={handleNewAnalysis}
        onLoadDemoData={handleLoadDemoData}
        isSyncing={isSyncing}
      />

      <main style={{ flex: 1, padding: '1.25rem 1.75rem', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {/* Dataset Manager & Scope Controls */}
        <DatasetManager
          datasets={datasets}
          activeDatasetId={activeDatasetId}
          onSelectDataset={setActiveDatasetId}
          onAddDataset={handleAddDataset}
          onUpdateDataset={handleUpdateDataset}
          onDeleteDataset={handleDeleteDataset}
          onDuplicateDataset={handleDuplicateDataset}
          onToggleDatasetVisibility={handleToggleDatasetVisibility}
          onSplitDatasetByFilter={handleSplitDatasetByFilter}
          onSplitDatasetByUnit={handleSplitDatasetByUnit}
          units={units}
          unitClasses={unitClasses}
          tests={tests}
          scopedTests={scopedTests}
          scopedNumericTests={scopedNumericTests}
          years={years}
          testLists={testLists}
          xVariable={xVariable}
          onChangeXVariable={setXVariable}
          yVariable={yVariable}
          onChangeYVariable={setYVariable}
          selectedTestList={selectedTestList}
          onChangeSelectedTestList={setSelectedTestList}
          includeAllInstances={includeAllInstances}
          onChangeIncludeAllInstances={handleToggleIncludeAllInstances}
          includeUnapproved={status?.qatrack?.includeUnapproved ?? true}
          onChangeIncludeUnapproved={handleToggleIncludeUnapproved}
          displayMode={displayMode}
          onChangeDisplayMode={setDisplayMode}
          trendlineConfig={trendlineConfig}
          onChangeTrendlineConfig={setTrendlineConfig}
          onRetrieveData={handleRunLocalQuery}
          onRunLocalQuery={handleRunLocalQuery}
          onFetchFromQATrack={handleFetchFromQATrack}
          onLoadDemoData={handleLoadDemoData}
          isLoading={isLoading || isSyncing}
          totalLoadedRecords={combinedTableRows.length}
          hasLoaded={hasLoaded}
          isConfigStale={isConfigStale}
        />

        {/* View Switcher Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '1.25rem 0 1rem 0' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setActiveTab('chart')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0.45rem 1rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: '600',
                background: activeTab === 'chart' ? '#2563eb' : '#ffffff',
                color: activeTab === 'chart' ? '#ffffff' : '#64748b',
                border: '1px solid ' + (activeTab === 'chart' ? '#2563eb' : '#cbd5e1')
              }}
            >
              <BarChart3 size={16} /> Interactive Plot View
            </button>
            <button
              onClick={() => setActiveTab('table')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0.45rem 1rem',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: '600',
                background: activeTab === 'table' ? '#2563eb' : '#ffffff',
                color: activeTab === 'table' ? '#ffffff' : '#64748b',
                border: '1px solid ' + (activeTab === 'table' ? '#2563eb' : '#cbd5e1')
              }}
            >
              <TableIcon size={16} /> Data Matrix ({combinedTableRows.length})
            </button>
          </div>

          {(isLoading || isSyncing) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#2563eb' }}>
              <RefreshCw size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
              Updating analytics...
            </div>
          )}
        </div>

        {/* Tab Content */}
        {activeTab === 'chart' ? (
          <>
            <ChartCanvas
              datasets={datasets}
              datasetResults={datasetResults}
              xVariable={xVariable}
              yVariable={yVariable}
              displayMode={displayMode}
              trendlineConfig={trendlineConfig}
              baselineConfig={baselineConfig}
              onChangeBaselineConfig={setBaselineConfig}
              ignoredSessionIds={ignoredSessionIds}
              onIgnorePoint={handleIgnorePoint}
              onRestoreAllIgnored={handleRestoreAllIgnored}
              onRemoveOutliers={handleRemoveOutliers}
              onInspectSession={setInspectedSessionId}
              hasLoaded={hasLoaded}
              onRetrieveData={handleRunLocalQuery}
              onRunLocalQuery={handleRunLocalQuery}
              onFetchFromQATrack={handleFetchFromQATrack}
            />

            {/* Bottom Comparative Benchmarking Table */}
            <DatasetComparisonTable
              datasets={datasets}
              datasetResults={datasetResults}
              ignoredSessionIds={ignoredSessionIds}
              yVariable={yVariable}
              xVariable={xVariable}
              trendlineConfig={trendlineConfig}
              baselineConfig={baselineConfig}
              onInspectSession={setInspectedSessionId}
            />
          </>
        ) : (
          <DataTable
            tableRows={combinedTableRows}
            yVariable={yVariable}
            xVariable={xVariable}
            ignoredSessionIds={ignoredSessionIds}
            onToggleIgnore={handleToggleIgnore}
            onInspectSession={setInspectedSessionId}
          />
        )}
      </main>

      {/* Modals */}
      {inspectedSessionId && (
        <SessionDetailsModal
          sessionId={inspectedSessionId}
          onClose={() => setInspectedSessionId(null)}
          isIgnored={ignoredSessionIds.includes(inspectedSessionId)}
          onToggleIgnore={handleToggleIgnore}
        />
      )}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onConfigSaved={loadMetadata}
      />

      <SavePresetModal
        isOpen={isSavePresetOpen}
        onClose={() => setIsSavePresetOpen(false)}
        currentConfig={currentConfig}
        onSaved={loadMetadata}
        presets={presets}
        activePresetId={selectedPresetId}
      />

      <PresetManagerModal
        isOpen={isPresetManagerOpen}
        onClose={() => setIsPresetManagerOpen(false)}
        presets={presets}
        selectedPresetId={selectedPresetId}
        onSelectPreset={handleSelectPreset}
        onPresetsUpdated={loadMetadata}
      />

      <SyncProgressModal
        isOpen={isSyncModalOpen}
        status={syncStatus}
        onCancel={handleCancelSync}
        onClose={() => {
          setIsSyncModalOpen(false);
          loadMetadata();
          runAllQueries();
        }}
      />
    </div>
  );
}
