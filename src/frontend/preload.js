'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neurologue', {
  version: '0.1.0',

  // ── Library ──────────────────────────────────────────────────────────────
  list: (opts) => ipcRenderer.invoke('library:list', opts),
  searchText: (query, opts) => ipcRenderer.invoke('library:search-text', { query, ...opts }),
  searchSemantic: (query, opts) => ipcRenderer.invoke('library:search-semantic', { query, ...opts }),
  similarEntries: (id, opts) => ipcRenderer.invoke('library:similar-entries', { id, ...opts }),
  getEntry: (id) => ipcRenderer.invoke('library:get-entry', { id }),
  updateEntry: (id, content) => ipcRenderer.invoke('library:update-entry', { id, content }),
  getRevisions: (id) => ipcRenderer.invoke('library:get-revisions', { id }),
  setCategory: (id, category) => ipcRenderer.invoke('library:set-category', { id, category }),
  setTags: (id, tags) => ipcRenderer.invoke('library:set-tags', { id, tags }),
  suggestTags: (text) => ipcRenderer.invoke('library:suggest-tags', { text }),
  listTags: () => ipcRenderer.invoke('library:list-tags'),
  getActivity: () => ipcRenderer.invoke('library:activity'),
  listCategories: () => ipcRenderer.invoke('library:list-categories'),

  // ── Tag management ───────────────────────────────────────────────────────
  listTagsWithCounts: () => ipcRenderer.invoke('tags:list-with-counts'),
  renameTag: (id, newName) => ipcRenderer.invoke('tags:rename', { id, newName }),
  deleteTag: (id) => ipcRenderer.invoke('tags:delete', { id }),
  mergeTag: (removeId, keepId) => ipcRenderer.invoke('tags:merge', { removeId, keepId }),
  similarTags: () => ipcRenderer.invoke('tags:similar'),

  // ── Themes ───────────────────────────────────────────────────────────────
  listThemes: () => ipcRenderer.invoke('themes:list'),
  getTheme: (id) => ipcRenderer.invoke('themes:get', { id }),
  renameTheme:  (id, newName) => ipcRenderer.invoke('themes:rename', { id, newName }),
  deleteTheme:  (id)          => ipcRenderer.invoke('themes:delete', { id }),
  triggerClustering: () => ipcRenderer.invoke('themes:cluster'),
  getThemeWeeklyActivity: (id, weeks) => ipcRenderer.invoke('themes:weekly-activity', { id, weeks }),

  // ── Entry delete ─────────────────────────────────────────────────────────
  deleteEntry:      (id)  => ipcRenderer.invoke('library:delete-entry', { id }),
  bulkDeleteEntries: (ids) => ipcRenderer.invoke('library:bulk-delete-entries', { ids }),
  // ── Export ───────────────────────────────────────────────────────────────
  exportAll: (opts) => ipcRenderer.invoke('export:run', opts),
  exportCCF:  ()    => ipcRenderer.invoke('export:ccf'),
  importCCF:  ()    => ipcRenderer.invoke('import:ccf'),
  importDemo: ()    => ipcRenderer.invoke('demo:import'),
  resetDb:    ()    => ipcRenderer.invoke('db:reset'),

  // ── Adapter exports ───────────────────────────────────────────────────────
  listAdapters:  ()   => ipcRenderer.invoke('adapter:list'),
  exportAdapter: (id) => ipcRenderer.invoke('export:adapter', { id }),

  // ── Scheduled Export ──────────────────────────────────────────────────────
  schedulerStatus:     ()       => ipcRenderer.invoke('scheduler:status'),
  schedulerHistory:    (limit)  => ipcRenderer.invoke('scheduler:history', { limit }),
  schedulerRunNow:     ()       => ipcRenderer.invoke('scheduler:run-now'),
  schedulerSaveConfig:   (config) => ipcRenderer.invoke('scheduler:save-config', config),
  schedulerChooseFolder: ()       => ipcRenderer.invoke('scheduler:choose-folder'),

  // ── Help ─────────────────────────────────────────────────────────────────
  openHelp: () => ipcRenderer.invoke('help:open'),

  // ── Reindex ──────────────────────────────────────────────────────────────
  reindexAll:   ()   => ipcRenderer.invoke('worker:reindex-all'),
  reindexEntry: (id) => ipcRenderer.invoke('worker:reindex-entry', { id }),

  // ── Status ───────────────────────────────────────────────────────────────
  getStatus: () => ipcRenderer.invoke('status:get'),
  getWorkerLog: () => ipcRenderer.invoke('worker:get-log'),
  onWorkerStatus:         (cb) => { ipcRenderer.on('worker:status',           (_e, d) => cb(d)); },
  onEntriesUpdated:       (cb) => { ipcRenderer.on('worker:entries-updated',  (_e, d) => cb(d)); },
  onThemesUpdated:        (cb) => { ipcRenderer.on('worker:themes-updated',   (_e, d) => cb(d)); },
  onContradictionsUpdated:(cb) => { ipcRenderer.on('worker:contradictions-updated', (_e, d) => cb(d)); },
  onWorkerTaskStarted:    (cb) => { ipcRenderer.on('worker:task-started',     (_e, d) => cb(d)); },
  onWorkerTaskCompleted:  (cb) => { ipcRenderer.on('worker:task-completed',   (_e, d) => cb(d)); },

  // ── Dashboard ────────────────────────────────────────────────────────────
  getDashboardSummary: () => ipcRenderer.invoke('dashboard:summary'),

  // ── Graph ─────────────────────────────────────────────────────────────────
  getGraphData: () => ipcRenderer.invoke('graph:data'),

  // ── Agents ────────────────────────────────────────────────────────────────
  listAgents:    ()        => ipcRenderer.invoke('agents:list'),
  runAgent:      (agentId) => ipcRenderer.invoke('agents:run', { agentId }),
  abortAgent:    ()        => ipcRenderer.invoke('agents:abort'),
  onAgentToken:  (cb)      => { ipcRenderer.on('agent:token', (_e, d) => cb(d)); },
  onAgentDone:   (cb)      => { ipcRenderer.on('agent:done',  ()       => cb()); },

  // ── Memory Replay ─────────────────────────────────────────────────────────
  listActiveMonths:   ()                          => ipcRenderer.invoke('replay:active-months'),
  getMonthSnapshot:   (year, month)               => ipcRenderer.invoke('replay:month-snapshot',  { year, month }),
  comparePeriods:     (from1, to1, from2, to2)    => ipcRenderer.invoke('replay:compare-periods', { from1, to1, from2, to2 }),
  getAbandonedIdeas:  ()                          => ipcRenderer.invoke('replay:abandoned-ideas'),

  // ── Contradictions ───────────────────────────────────────────────────────
  listContradictions:         (opts) => ipcRenderer.invoke('contradictions:list', opts),
  resolveContradiction:       (id, notes) => ipcRenderer.invoke('contradictions:resolve', { id, notes }),
  dismissContradiction:       (id) => ipcRenderer.invoke('contradictions:dismiss', { id }),
  scanContradictions:         () => ipcRenderer.invoke('contradictions:scan'),
  cancelContradictionScan:    () => ipcRenderer.invoke('contradictions:scan-cancel'),
  onContradictionProgress:    (cb) => { ipcRenderer.on('worker:contradiction-progress', (_e, d) => cb(d)); },

  // ── Priorities ───────────────────────────────────────────────────────────
  listPriorityMetrics:     ()         => ipcRenderer.invoke('priorities:list-metrics'),
  getPriorityEntrySignals: (themeId)  => ipcRenderer.invoke('priorities:get-entry-signals', { themeId }),
  getPriorityHistory:      (themeId)  => ipcRenderer.invoke('priorities:get-history', { themeId }),
  recomputePriorities:     ()         => ipcRenderer.invoke('priorities:recompute'),

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings:  ()        => ipcRenderer.invoke('settings:get'),
  saveSettings: (updates) => ipcRenderer.invoke('settings:save', updates),
  setHotkey:    (accelerator) => ipcRenderer.invoke('hotkey:set', { accelerator }),
  pauseHotkey:  ()            => ipcRenderer.invoke('hotkey:pause'),
  resumeHotkey: ()            => ipcRenderer.invoke('hotkey:resume'),
  // ── Portfolio ─────────────────────────────────────────────────────────────
  getPortfolioManifest: ()              => ipcRenderer.invoke('portfolio:list'),
  createPortfolio:  (name, color)   => ipcRenderer.invoke('portfolio:create', { name, color }),
  renamePortfolio:  (id, name)      => ipcRenderer.invoke('portfolio:rename', { id, name }),
  recolorPortfolio: (id, color)     => ipcRenderer.invoke('portfolio:recolor', { id, color }),
  deletePortfolio:  (id)            => ipcRenderer.invoke('portfolio:delete', { id }),
  switchPortfolio:  (id)            => ipcRenderer.invoke('portfolio:switch', { id }),
  portfolioStats:   (id)            => ipcRenderer.invoke('portfolio:stats', { id }),
  onPortfolioSwitched: (cb) => { ipcRenderer.on('portfolio:switched', (_e, d) => cb(d)); },
  // ── Capture ───────────────────────────────────────────────────────────────
  openCapture: () => ipcRenderer.invoke('capture:open'),

  // ── Ollama setup ─────────────────────────────────────────────────────────
  openOllamaDownload:  ()     => ipcRenderer.invoke('ollama:open-download'),
  checkOllamaInstalled: ()    => ipcRenderer.invoke('ollama:check-installed'),
  pullModel:           (name) => ipcRenderer.invoke('ollama:pull-model', { name }),
  onPullProgress:      (cb)   => { ipcRenderer.on('ollama:pull-progress', (_e, d) => cb(d)); },
  onIpcError:          (cb)   => { ipcRenderer.on('app:ipc-error', (_e, d) => cb(d)); },
});

