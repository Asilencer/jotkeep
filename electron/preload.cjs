const { contextBridge, ipcRenderer, webUtils } = require('electron')

ipcRenderer.on('settings:show', () => {
  window.location.hash = 'settings'
})

contextBridge.exposeInMainWorld('noteDown', {
  consumePendingDocumentOpen: () => ipcRenderer.invoke('navigation:consume-document'),
  acknowledgeDocumentOpen: (documentId) =>
    ipcRenderer.send('navigation:document-opened', documentId),
  onOpenDocument: (callback) => {
    const listener = (_event, documentId) => callback(documentId)
    ipcRenderer.on('navigation:open-document', listener)
    return () => ipcRenderer.removeListener('navigation:open-document', listener)
  },
  consumePendingCapture: () => ipcRenderer.invoke('capture:consume'),
  onCapture: (callback) => {
    const listener = (_event, request) => callback(request)
    ipcRenderer.on('capture:open', listener)
    return () => ipcRenderer.removeListener('capture:open', listener)
  },
  onBeforeClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('window:before-close', listener)
    return () => ipcRenderer.removeListener('window:before-close', listener)
  },
  completeClose: (success) => ipcRenderer.send('window:flush-complete', success === true),
  onStorageRecovery: (callback) => {
    const listener = (_event, recovery) => callback(recovery)
    ipcRenderer.on('storage:recovery-created', listener)
    return () => ipcRenderer.removeListener('storage:recovery-created', listener)
  },
  chooseDirectory: () => ipcRenderer.invoke('settings:choose-directory'),
  openConfigDirectory: () => ipcRenderer.invoke('settings:open-config-directory'),
  exportSettings: (options) => ipcRenderer.invoke('settings:export', options),
  exportLibrary: (options) => ipcRenderer.invoke('library:export', options),
  migrateSourceOverlappingLibrary: (options) =>
    ipcRenderer.invoke('library:migrate-source-overlap', options),
  configureBackup: (options) => ipcRenderer.invoke('backup:configure', options),
  runBackup: (options) => ipcRenderer.invoke('backup:run', options),
  listBackups: (options) => ipcRenderer.invoke('backup:list', options),
  restoreBackup: (options) => ipcRenderer.invoke('backup:restore', options),
  openBackupDirectory: (options) => ipcRenderer.invoke('backup:open-directory', options),
  rebuildSearchIndex: (options) => ipcRenderer.invoke('search:rebuild', options),
  configureTaskNotifications: (options) => ipcRenderer.invoke('notifications:configure', options),
  listDocuments: (options) => ipcRenderer.invoke('document:list', options),
  importDocuments: (options) => ipcRenderer.invoke('document:import', options),
  listActivity: (options) => ipcRenderer.invoke('activity:list', options),
  searchDocuments: (options) => ipcRenderer.invoke('document:search', options),
  watchDocuments: (options) => ipcRenderer.invoke('vault:watch', options),
  onDocumentsChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('vault:documents-changed', listener)
    return () => ipcRenderer.removeListener('vault:documents-changed', listener)
  },
  loadDocument: (options) => ipcRenderer.invoke('document:load', options),
  loadDocumentState: (options) => ipcRenderer.invoke('document:load-state', options),
  saveDocument: (options) => ipcRenderer.invoke('document:save', options),
  listDocumentVersions: (options) => ipcRenderer.invoke('document:versions', options),
  restoreDocumentVersion: (options) => ipcRenderer.invoke('document:restore-version', options),
  setDocumentProject: (options) => ipcRenderer.invoke('document:set-project', options),
  setDocumentArchived: (options) => ipcRenderer.invoke('document:set-archived', options),
  trashDocument: (options) => ipcRenderer.invoke('document:trash', options),
  listTasks: (options) => ipcRenderer.invoke('tasks:list', options),
  saveTasks: (options) => ipcRenderer.invoke('tasks:save', options),
  listProjects: (options) => ipcRenderer.invoke('projects:list', options),
  saveProjects: (options) => ipcRenderer.invoke('projects:save', options),
  loadProfile: (options) => ipcRenderer.invoke('profile:load', options),
  saveProfile: (options) => ipcRenderer.invoke('profile:save', options),
  chooseProfileAvatar: (options) => ipcRenderer.invoke('profile:choose-avatar', options),
  listPublishDrafts: (options) => ipcRenderer.invoke('publish:list', options),
  initiatePublishDraft: (options) => ipcRenderer.invoke('publish:initiate', options),
  updatePublishDraft: (options) => ipcRenderer.invoke('publish:update', options),
  copyPublishDraft: (options) => ipcRenderer.invoke('publish:copy', options),
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  deletePublishDraft: (options) => ipcRenderer.invoke('publish:delete', options),
  openExternal: (url) => ipcRenderer.invoke('link:open', url),
  fetchLinkMetadata: (url) => ipcRenderer.invoke('link:metadata', url),
  captureClip: (options) => ipcRenderer.invoke('clip:capture', options),
  importSharedFile: (options) => ipcRenderer.invoke('capture:import-file', options),
  getWeather: (options) => ipcRenderer.invoke('weather:get', options),
  storeAsset: async ({ file, ...options }) => {
    let sourcePath = ''
    try {
      sourcePath = webUtils.getPathForFile(file)
    } catch {
      sourcePath = ''
    }
    const bytes = sourcePath ? undefined : new Uint8Array(await file.arrayBuffer())
    return ipcRenderer.invoke('asset:save', {
      ...options,
      sourcePath,
      bytes,
      name: file.name,
      mimeType: file.type,
    })
  },
  cleanupUnusedAttachments: (options) => ipcRenderer.invoke('asset:cleanup-unused', options),
  migrateAttachmentDirectory: (options) => ipcRenderer.invoke('asset:migrate-directory', options),
  resolveAsset: (options) => ipcRenderer.invoke('asset:resolve', options),
  openAsset: (options) => ipcRenderer.invoke('asset:open', options),
  setLocale: (locale) => ipcRenderer.send('settings:locale', locale),
  setTrafficLightsVisible: (visible) => ipcRenderer.send('window:traffic-lights', visible),
})
