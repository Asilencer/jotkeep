/// <reference types="vite/client" />

type NoteDownCaptureRequest = { kind: 'url' | 'text' | 'file'; value: string }
type NoteDownStorageRecovery = { filename: string; recoveryPath: string }
type NoteDownUpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'error'
    | 'unsupported'
  currentVersion: string
  latestVersion?: string
  progress?: number
  transferredBytes?: number
  totalBytes?: number
  message?: string
}
type NoteDownBackupSummary = {
  id: string
  createdAt: string
  bytes: number
  files: number
  documents: number
  valid: boolean
}

interface Window {
  noteDown?: {
    consumePendingDocumentOpen: () => Promise<string | null>
    acknowledgeDocumentOpen: (documentId: string) => void
    onOpenDocument: (callback: (documentId: string) => void) => () => void
    consumePendingCapture: () => Promise<NoteDownCaptureRequest | null>
    onCapture: (callback: (request: NoteDownCaptureRequest) => void) => () => void
    onBeforeClose: (callback: () => void) => () => void
    completeClose: (success: boolean) => void
    onStorageRecovery: (callback: (recovery: NoteDownStorageRecovery) => void) => () => void
    checkForUpdates: () => Promise<NoteDownUpdateState>
    downloadUpdate: () => Promise<NoteDownUpdateState>
    onUpdateState: (callback: (state: NoteDownUpdateState) => void) => () => void
    chooseDirectory: () => Promise<string | null>
    openConfigDirectory: () => Promise<void>
    exportSettings: (options: { settings: object }) => Promise<string | null>
    exportLibrary: (options: {
      libraryPath: string
      attachmentsPath: string
    }) => Promise<string | null>
    migrateSourceOverlappingLibrary: (options: {
      libraryPath: string
      attachmentsPath: string
    }) => Promise<{
      libraryPath: string
      files: number
      sourceRetained: boolean
    } | null>
    configureBackup: (options: {
      enabled: boolean
      libraryPath: string
      attachmentsPath: string
      frequency: 'daily' | 'weekly'
      retention: number
    }) => Promise<{ enabled: boolean; nextAt?: string }>
    runBackup: (options: {
      libraryPath: string
      attachmentsPath: string
      retention: number
    }) => Promise<{
      path: string
      createdAt: string
    }>
    listBackups: (options: { libraryPath: string }) => Promise<NoteDownBackupSummary[]>
    restoreBackup: (options: {
      libraryPath: string
      attachmentsPath: string
      backupId: string
    }) => Promise<{ restoredAt: string; safetyBackupPath: string }>
    openBackupDirectory: (options: { libraryPath: string }) => Promise<void>
    rebuildSearchIndex: (options: { libraryPath: string }) => Promise<{ count: number }>
    configureTaskNotifications: (options: { enabled: boolean }) => Promise<{
      enabled: boolean
      supported: boolean
      scheduled: number
    }>
    listDocuments: (options: { libraryPath: string }) => Promise<NoteDownDocumentSummary[]>
    importDocuments: (options: {
      libraryPath: string
      kind: 'notes' | 'articles'
    }) => Promise<Array<{ id: string; kind: 'notes' | 'articles'; title: string }>>
    listActivity: (options: { libraryPath: string }) => Promise<NoteDownActivityEvent[]>
    searchDocuments: (options: {
      libraryPath: string
      query: string
      limit?: number
    }) => Promise<Array<NoteDownDocumentSummary & { excerpt: string }>>
    watchDocuments: (options: { libraryPath: string }) => Promise<void>
    onDocumentsChanged: (callback: () => void) => () => void
    loadDocument: (options: { documentId: string; libraryPath: string }) => Promise<string | null>
    loadDocumentState: (options: {
      documentId: string
      libraryPath: string
    }) => Promise<{ content: string | null; revision: string | null }>
    saveDocument: (options: {
      documentId: string
      libraryPath: string
      content: string
      projectId?: string
      baseRevision?: string | null
      force?: boolean
    }) => Promise<
      | { status: 'saved'; revision: string }
      | { status: 'conflict'; revision: string | null; content: string | null }
    >
    listDocumentVersions: (options: {
      documentId: string
      libraryPath: string
    }) => Promise<NoteDownDocumentVersion[]>
    restoreDocumentVersion: (options: {
      documentId: string
      libraryPath: string
      versionId: string
    }) => Promise<{ content: string; revision: string }>
    setDocumentProject: (options: {
      documentId: string
      libraryPath: string
      projectId?: string
    }) => Promise<void>
    setDocumentArchived: (options: {
      documentId: string
      libraryPath: string
      archived: boolean
    }) => Promise<string | undefined>
    trashDocument: (options: { documentId: string; libraryPath: string }) => Promise<void>
    listTasks: (options: { libraryPath: string }) => Promise<
      | Array<{
        id: string
        title: string
        description?: string
        projectId?: string
        date: string
        status: 'Todo' | 'Doing' | 'Done' | 'Cancelled'
        source?: string
        sourceDocumentId?: string
        sourceBlockId?: string
        }>
      | null
    >
    saveTasks: (options: {
      libraryPath: string
      tasks: Array<{
        id: string
        title: string
        description?: string
        projectId?: string
        date: string
        status: 'Todo' | 'Doing' | 'Done' | 'Cancelled'
        source?: string
        sourceDocumentId?: string
        sourceBlockId?: string
      }>
    }) => Promise<void>
    listProjects: (options: { libraryPath: string }) => Promise<
      | Array<{
        id: string
        name: string
        description: string
        color: string
        status: 'Active' | 'Planned'
        archivedAt?: string
        }>
      | null
    >
    saveProjects: (options: {
      libraryPath: string
      projects: Array<{
        id: string
        name: string
        description: string
        color: string
        status: 'Active' | 'Planned'
        archivedAt?: string
      }>
    }) => Promise<void>
    loadProfile: (options: { libraryPath: string }) => Promise<NoteDownUserProfile | null>
    saveProfile: (options: {
      libraryPath: string
      profile: Omit<NoteDownUserProfile, 'avatarURL'>
    }) => Promise<NoteDownUserProfile>
    chooseProfileAvatar: (options: { libraryPath: string }) => Promise<
      { avatarPath: string; avatarURL: string } | null
    >
    listPublishDrafts: (options: { libraryPath: string }) => Promise<NoteDownPublishDraft[]>
    initiatePublishDraft: (options: {
      libraryPath: string
      sourceKind: 'daily' | 'notes' | 'articles'
      sourceId: string
      sourceBlock?: {
        id: string
        markdown: string
        preview: string
      }
    }) => Promise<NoteDownPublishDraft>
    updatePublishDraft: (options: {
      libraryPath: string
      draftId: string
      status?: NoteDownPublishDraft['status']
      targets?: NoteDownPublishDraft['targets']
      targetText?: string
      deliveryMode?: NoteDownPublishDraft['deliveryMode']
      refreshSource?: boolean
    }) => Promise<NoteDownPublishDraft>
    copyPublishDraft: (options: { libraryPath: string; draftId: string }) => Promise<void>
    copyText: (text: string) => Promise<void>
    deletePublishDraft: (options: { libraryPath: string; draftId: string }) => Promise<void>
    openExternal: (url: string) => Promise<void>
    fetchLinkMetadata: (url: string) => Promise<{
      url: string
      title: string
      description: string
      siteName: string
      icon: string
      image: string
    }>
    captureClip: (options: {
      url: string
      libraryPath: string
      projectId?: string
      attachmentsPath: string
    }) => Promise<NoteDownDocumentSummary>
    importSharedFile: (options: {
      token: string
      libraryPath: string
      attachmentsPath: string
    }) => Promise<NoteDownDocumentSummary>
    getWeather: (options?: { force?: boolean }) => Promise<{
      status: 'ready' | 'stale' | 'unavailable'
      cached: boolean
      snapshot?: {
        source: 'open-meteo'
        condition: string
        symbolName: string
        location: string
        temperature: number
        high: number
        low: number
        feelsLike: number
        cloudCover: number
        precipitationIntensity: number
        humidity: number
        windSpeed: number
        isDaylight: boolean
        fetchedAt: string
        expiresAt: string
        latitude: number
        longitude: number
        attribution: {
          serviceName: string
          legalPageURL: string
        }
      }
      error?: { code: string; message: string }
    }>
    storeAsset: (options: {
      file: File
      libraryPath: string
      documentId: string
      attachmentsPath: string
      mode: 'copy' | 'reference'
    }) => Promise<{ url: string; name: string; size: number; referenced: boolean }>
    cleanupUnusedAttachments: (options: {
      libraryPath: string
      attachmentsPath: string
      dryRun: boolean
    }) => Promise<{ count: number; bytes: number }>
    migrateAttachmentDirectory: (options: {
      libraryPath: string
      fromPath: string
      toPath: string
    }) => Promise<{ files: number; documents: number; sourceRetained: boolean }>
    resolveAsset: (options: {
      url: string
      libraryPath: string
      documentId: string
    }) => Promise<string>
    openAsset: (options: {
      url: string
      name: string
      libraryPath?: string
      documentId?: string
    }) => Promise<void>
    setLocale: (locale: 'zh-CN' | 'en-US') => void
    setTrafficLightsVisible: (visible: boolean) => void
  }
}

type NoteDownDocumentSummary = {
  id: string
  kind: 'notes' | 'articles' | 'clips'
  title: string
  tags?: string[]
  projectId?: string
  updatedAt: string
  archivedAt?: string
}

type NoteDownDocumentVersion = {
  id: string
  createdAt: string
  title: string
  preview: string
}

type NoteDownActivityEvent = {
  id: string
  type: 'document' | 'clip' | 'task' | 'publish'
  entityId: string
  documentKind?: 'notes' | 'articles' | 'clips' | 'daily'
  title: string
  occurredAt: string
}

type NoteDownUserProfile = {
  username: string
  avatarPath?: string
  avatarURL?: string
  links: Array<{
    id: 'github' | 'website' | 'figma' | 'twitter'
    url: string
  }>
}

type NoteDownPublishDraft = {
  id: string
  sourceKind: 'daily' | 'notes' | 'articles'
  sourceId: string
  sourceRevision: string
  sourceTitle: string
  sourceSnapshot: string
  sourceBlockId?: string
  sourceBlockPreview?: string
  status: 'Preparing' | 'Queued' | 'Published' | 'Failed'
  targets: Array<'x'>
  targetText?: string
  deliveryMode?: 'standard' | 'long' | 'thread'
  updatedAt: string
  publishedAt?: string
  sourceChanged?: boolean
  sourceMissing?: boolean
}
