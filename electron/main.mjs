import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  Notification,
  protocol,
  shell,
} from 'electron'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import {
  flushStorageOperations,
  runStorageOperation,
  serializePersistentWrite,
  withStorageMaintenance,
  writeTextAtomically,
} from './storage-coordinator.mjs'
import { createFileSnapshotCache } from './file-snapshot-cache.mjs'
import {
  downloadGithubUpdate,
  fetchLatestGithubUpdate,
} from './github-updater.mjs'
import { assertIPCArguments } from './ipc-contract.mjs'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const rendererURL = process.env.VITE_DEV_SERVER_URL
const productionEntry = path.join(currentDirectory, '..', 'dist', 'index.html')
const preloadPath = path.join(currentDirectory, 'preload.cjs')
const allowedURL = rendererURL ? new URL(rendererURL).toString() : pathToFileURL(productionEntry).toString()
const metadataResponseLimit = 1024 * 1024
const previewImageLimit = 768 * 1024
const articleImageLimit = 8 * 1024 * 1024
const articleImageCountLimit = 12
const storedAssetLimit = 256 * 1024 * 1024
const sharedCaptureTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const backupManifestName = '.note-down-backup.json'
const documentHistoryLimit = 50
const documentVersionInterval = 5 * 60 * 1000
const weatherCacheLifetime = 20 * 60 * 1000
const weatherHelperTimeout = 45 * 1000
const trafficLightPosition = { x: 16, y: 24 }

let mainWindow = null
let pendingWeatherRequest = null
let backupTimer = null
let backupConfiguration = null
let pendingBackup = null
let taskReminderRefreshTimer = null
let spotlightSyncTimer = null
let spotlightSyncLibraryPath = ''
let closeFlushTimer = null
let allowMainWindowClose = false
let pendingDocumentOpen = ''
let pendingCaptureRequest = null
let spotlightSyncQueue = Promise.resolve()
let taskNotificationsEnabled = true
let latestTaskItems = []
let activityWriteQueue = Promise.resolve()
let interfaceLocale = 'zh-CN'
let githubUpdate = null
let downloadedUpdatePath = ''
let pendingUpdateCheck = null
let pendingUpdateDownload = null
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
}
const taskReminderTimers = new Map()
const assetPathsByToken = new Map()
const assetTokensByPath = new Map()

const publishUpdateState = (nextState) => {
  updateState = nextState
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:state', updateState)
  }
  return updateState
}

const checkForGithubUpdate = async () => {
  if (pendingUpdateCheck) return pendingUpdateCheck
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return publishUpdateState({
      status: 'unsupported',
      currentVersion: app.getVersion(),
    })
  }

  pendingUpdateCheck = (async () => {
    const currentVersion = app.getVersion()
    publishUpdateState({ status: 'checking', currentVersion })
    try {
      const result = await fetchLatestGithubUpdate({
        fetcher: net.fetch,
        currentVersion,
        architecture: process.arch,
      })
      if (!result.available) {
        githubUpdate = null
        downloadedUpdatePath = ''
        return publishUpdateState({
          status: 'up-to-date',
          currentVersion,
          latestVersion: result.latestVersion,
        })
      }

      githubUpdate = result
      downloadedUpdatePath = ''
      return publishUpdateState({
        status: 'available',
        currentVersion,
        latestVersion: result.latestVersion,
      })
    } catch (error) {
      console.error('GitHub update check failed', error)
      return publishUpdateState({
        status: 'error',
        currentVersion,
        message: '无法检查 GitHub 更新。',
      })
    }
  })()

  try {
    return await pendingUpdateCheck
  } finally {
    pendingUpdateCheck = null
  }
}

const downloadLatestGithubUpdate = async () => {
  if (pendingUpdateDownload) return pendingUpdateDownload
  pendingUpdateDownload = (async () => {
    if (!githubUpdate) {
      const checked = await checkForGithubUpdate()
      if (checked.status !== 'available' || !githubUpdate) return checked
    }

    const currentVersion = app.getVersion()
    const latestVersion = githubUpdate.latestVersion
    try {
      if (!downloadedUpdatePath) {
        publishUpdateState({
          status: 'downloading',
          currentVersion,
          latestVersion,
          progress: 0,
          transferredBytes: 0,
          totalBytes: githubUpdate.asset.bytes,
        })
        downloadedUpdatePath = await downloadGithubUpdate({
          fetcher: net.fetch,
          update: githubUpdate,
          targetDirectory: path.join(app.getPath('temp'), 'jotkeep-updates'),
          onProgress: ({ progress, transferred, total }) => {
            publishUpdateState({
              status: 'downloading',
              currentVersion,
              latestVersion,
              progress,
              transferredBytes: transferred,
              totalBytes: total,
            })
          },
        })
      }

      const error = await shell.openPath(downloadedUpdatePath)
      if (error) throw new Error(error)
      return publishUpdateState({
        status: 'ready',
        currentVersion,
        latestVersion,
      })
    } catch (error) {
      console.error('GitHub update download failed', error)
      downloadedUpdatePath = ''
      publishUpdateState({
        status: 'error',
        currentVersion,
        latestVersion,
        message: '新版下载或校验失败。',
      })
      throw error
    }
  })()

  try {
    return await pendingUpdateDownload
  } finally {
    pendingUpdateDownload = null
  }
}
const documentVersionState = new Map()
const libraryRedirects = new Map()
const libraryMigrationResults = new Map()
const libraryMigrationTasks = new Map()

const nativeText = (chinese, english) =>
  interfaceLocale === 'en-US' ? english : chinese

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'notedown-asset',
    privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true },
  },
])

const weatherHelperPath = () => {
  const appDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'WeatherBridge.app')
    : path.join(currentDirectory, '..', 'native', 'build', 'WeatherBridge.app')
  return path.join(appDirectory, 'Contents', 'MacOS', 'WeatherBridge')
}

const spotlightHelperPath = () => {
  const appDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'SpotlightBridge.app')
    : path.join(currentDirectory, '..', 'native', 'build', 'SpotlightBridge.app')
  return path.join(appDirectory, 'Contents', 'MacOS', 'SpotlightBridge')
}

const weatherCachePath = () => path.join(app.getPath('userData'), 'weather-cache.v1.json')

const readWeatherCache = async () => {
  try {
    const cache = JSON.parse(await readFile(weatherCachePath(), 'utf8'))
    return cache?.snapshot?.source === 'open-meteo' ? cache : null
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

const writeWeatherCache = async (snapshot) => {
  const cachePath = weatherCachePath()
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`
  await mkdir(path.dirname(cachePath), { recursive: true })
  try {
    await writeFile(
      temporaryPath,
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), snapshot }),
      'utf8',
    )
    await rename(temporaryPath, cachePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

const parseWeatherBridgeResponse = (stdout) => {
  const output = String(stdout || '').trim().split('\n').at(-1)
  if (!output) throw new Error('Weather bridge returned no data.')
  const response = JSON.parse(output)
  if (!response.ok || !response.snapshot) {
    const error = new Error(response.error?.message || 'Weather request failed.')
    error.code = response.error?.code || 'weather-request-failed'
    throw error
  }
  return response.snapshot
}

const runWeatherBridge = () =>
  new Promise((resolve, reject) => {
    execFile(
      weatherHelperPath(),
      [],
      { maxBuffer: 1024 * 1024, timeout: weatherHelperTimeout },
      (processError, stdout) => {
        if (processError && !String(stdout || '').trim()) {
          if (processError.code === 'ENOENT') processError.code = 'weather-helper-missing'
          reject(processError)
          return
        }
        try {
          resolve(parseWeatherBridgeResponse(stdout))
        } catch (responseError) {
          reject(responseError)
        }
      },
    )
  })

const weatherCacheIsFresh = (cache) => {
  if (!cache?.snapshot) return false
  const fetchedAt = Date.parse(cache.snapshot.fetchedAt)
  const serviceExpiration = Date.parse(cache.snapshot.expiresAt)
  const localExpiration = fetchedAt + weatherCacheLifetime
  return Number.isFinite(fetchedAt) && Math.min(serviceExpiration, localExpiration) > Date.now()
}

const weatherErrorPayload = (error) => ({
  code: String(error?.code || 'weather-unavailable'),
  message: String(error?.message || 'Weather is unavailable.'),
})

const resolveWeather = async ({ force = false } = {}) => {
  const cache = await readWeatherCache()
  if (!force && weatherCacheIsFresh(cache)) {
    return { status: 'ready', cached: true, snapshot: cache.snapshot }
  }

  try {
    const snapshot = await runWeatherBridge()
    await writeWeatherCache(snapshot)
    return { status: 'ready', cached: false, snapshot }
  } catch (error) {
    if (cache?.snapshot) {
      return {
        status: 'stale',
        cached: true,
        snapshot: cache.snapshot,
        error: weatherErrorPayload(error),
      }
    }
    return { status: 'unavailable', cached: false, error: weatherErrorPayload(error) }
  }
}

const getWeather = (options = {}) => {
  if (pendingWeatherRequest) return pendingWeatherRequest
  pendingWeatherRequest = resolveWeather(options).finally(() => {
    pendingWeatherRequest = null
  })
  return pendingWeatherRequest
}

const runSpotlightBridge = (arguments_) =>
  new Promise((resolve, reject) => {
    execFile(
      spotlightHelperPath(),
      arguments_,
      { maxBuffer: 1024 * 1024, timeout: 30 * 1000 },
      (processError, stdout) => {
        const output = String(stdout || '').trim().split('\n').at(-1)
        if (processError && !output) {
          if (processError.code === 'ENOENT') processError.code = 'spotlight-helper-missing'
          reject(processError)
          return
        }
        try {
          const response = JSON.parse(output)
          if (!response.ok) throw new Error(response.error || 'Spotlight indexing failed')
          resolve(response)
        } catch (error) {
          reject(error)
        }
      },
    )
  })

const expandLibraryDirectory = (libraryPath) => {
  if (typeof libraryPath !== 'string' || !libraryPath.trim()) {
    return path.join(app.getPath('home'), '.jotkeep')
  }
  if (libraryPath === '~') return app.getPath('home')
  if (libraryPath.startsWith('~/')) return path.join(app.getPath('home'), libraryPath.slice(2))
  return path.isAbsolute(libraryPath)
    ? path.normalize(libraryPath)
    : path.join(app.getPath('documents'), libraryPath)
}

const resolveLibraryDirectory = (libraryPath) => {
  const expanded = expandLibraryDirectory(libraryPath)
  return libraryRedirects.get(expanded) ?? expanded
}

const resolveDocumentPath = ({ documentId, libraryPath }) => {
  if (typeof documentId !== 'string') {
    throw new Error('Invalid document id')
  }
  const segments = documentId.split('/')
  if (
    segments.length < 2 ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'),
    )
  ) {
    throw new Error('Invalid document id')
  }
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const documentPath = `${path.resolve(libraryDirectory, ...segments)}.md`
  const relativePath = path.relative(libraryDirectory, documentPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid document id')
  }
  return documentPath
}

const contentRevision = (content) =>
  content === null ? null : createHash('sha256').update(content).digest('hex')

const documentHistoryDirectory = (libraryPath, documentId) => {
  const identifier = createHash('sha256').update(documentId).digest('hex').slice(0, 24)
  return path.join(resolveLibraryDirectory(libraryPath), '.notedown', 'history', identifier)
}

const documentVersionKey = (libraryPath, documentId) =>
  `${resolveLibraryDirectory(libraryPath)}:${documentId}`

const pathIsInside = (directory, targetPath) => {
  const relativePath = path.relative(directory, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

const decodeAssetURL = (value) => {
  const pathname = String(value).split(/[?#]/, 1)[0]
  try {
    return decodeURIComponent(pathname)
  } catch {
    throw new Error('Invalid asset URL')
  }
}

const resolveStoredAssetPath = ({ documentId, libraryPath, url }) => {
  if (typeof url !== 'string' || !url || /^(?:https?:|data:|blob:|file:)/i.test(url)) {
    throw new Error('Invalid stored asset URL')
  }
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const documentPath = resolveDocumentPath({ documentId, libraryPath })
  const assetPath = path.resolve(path.dirname(documentPath), decodeAssetURL(url))
  if (!pathIsInside(libraryDirectory, assetPath)) throw new Error('Asset is outside the library')
  return assetPath
}

const resolveVerifiedAssetPath = async (options) => {
  const libraryDirectory = resolveLibraryDirectory(options?.libraryPath)
  const assetPath = resolveStoredAssetPath(options ?? {})
  const [verifiedLibrary, verifiedAsset] = await Promise.all([
    realpath(libraryDirectory),
    realpath(assetPath),
  ])
  if (!pathIsInside(verifiedLibrary, verifiedAsset)) throw new Error('Asset is outside the library')
  return verifiedAsset
}

const resolveAttachmentDirectory = (libraryPath, attachmentsPath) => {
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const relativePath = String(attachmentsPath || 'assets').trim()
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error('Invalid attachment directory')
  }
  const attachmentDirectory = path.resolve(libraryDirectory, relativePath)
  if (!pathIsInside(libraryDirectory, attachmentDirectory)) {
    throw new Error('Attachment directory is outside the library')
  }
  return attachmentDirectory
}

const safeAssetName = (value) =>
  String(value || 'attachment')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'attachment'

const referenceAssetURL = (token) => `notedown-ref://local/${token}`

const referenceToken = (value) => {
  const match = String(value || '').match(
    /^notedown-ref:\/\/local\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  return match?.[1]
}

const storeAssetReference = async (options, sourcePath, sourceStats) => {
  const absolutePath = path.resolve(sourcePath)
  return mutateLibraryJSON(
    options?.libraryPath,
    'references.json',
    { version: 1, entries: {} },
    (stored) => {
      const entries = stored?.version === 1 && stored.entries ? { ...stored.entries } : {}
      const existing = Object.entries(entries).find(([, entry]) => entry?.path === absolutePath)
      const token = existing?.[0] ?? randomUUID()
      entries[token] = {
        path: absolutePath,
        name: safeAssetName(options?.name || path.basename(absolutePath)),
        updatedAt: new Date().toISOString(),
      }
      return {
        value: { version: 1, entries },
        result: {
          url: referenceAssetURL(token),
          name: entries[token].name,
          size: sourceStats.size,
          referenced: true,
        },
      }
    },
  )
}

const relativeAssetURL = (documentPath, assetPath) =>
  path
    .relative(path.dirname(documentPath), assetPath)
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

const storeAsset = async (options) => {
  const documentPath = resolveDocumentPath(options ?? {})
  const attachmentDirectory = resolveAttachmentDirectory(
    options?.libraryPath,
    options?.attachmentsPath,
  )
  let bytes
  if (typeof options?.sourcePath === 'string' && options.sourcePath) {
    const sourceStat = await stat(options.sourcePath)
    if (!sourceStat.isFile()) throw new Error('Asset source is not a file')
    if (sourceStat.size > storedAssetLimit) throw new Error('Asset is too large')
    if (options?.mode === 'reference') {
      return storeAssetReference(options, options.sourcePath, sourceStat)
    }
    bytes = await readFile(options.sourcePath)
  } else if (options?.bytes) {
    bytes = Buffer.from(options.bytes)
  } else {
    throw new Error('Asset has no file data')
  }
  if (bytes.byteLength === 0) throw new Error('Asset is empty')
  if (bytes.byteLength > storedAssetLimit) throw new Error('Asset is too large')

  const originalName = safeAssetName(options?.name)
  const extension = path.extname(originalName).slice(0, 20)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const filename = `${digest.slice(0, 24)}${extension.toLowerCase()}`
  const assetPath = path.join(attachmentDirectory, filename)
  await mkdir(attachmentDirectory, { recursive: true })
  const [verifiedLibrary, verifiedAttachmentDirectory] = await Promise.all([
    realpath(resolveLibraryDirectory(options?.libraryPath)),
    realpath(attachmentDirectory),
  ])
  if (!pathIsInside(verifiedLibrary, verifiedAttachmentDirectory)) {
    throw new Error('Attachment directory is outside the library')
  }
  try {
    await stat(assetPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    const temporaryPath = `${assetPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, bytes)
      await rename(temporaryPath, assetPath)
    } catch (writeError) {
      await rm(temporaryPath, { force: true })
      throw writeError
    }
  }
  return {
    url: relativeAssetURL(documentPath, assetPath),
    name: originalName,
    size: bytes.byteLength,
    referenced: false,
  }
}

const resolveReferencedAssetPath = async ({ libraryPath, url }) => {
  const token = referenceToken(url)
  if (!token) throw new Error('Invalid asset reference')
  const stored = await readLibraryJSON(libraryPath, 'references.json', {
    version: 1,
    entries: {},
  })
  const externalPath = stored?.version === 1 ? stored.entries?.[token]?.path : undefined
  if (typeof externalPath !== 'string' || !path.isAbsolute(externalPath)) {
    throw new Error('Unknown asset reference')
  }
  return realpath(externalPath)
}

const resolveAnyAssetPath = (options) =>
  referenceToken(options?.url)
    ? resolveReferencedAssetPath(options)
    : resolveVerifiedAssetPath(options)

const assetProtocolURL = (assetPath) => {
  let token = assetTokensByPath.get(assetPath)
  if (!token) {
    token = randomUUID()
    assetTokensByPath.set(assetPath, token)
    assetPathsByToken.set(token, assetPath)
  }
  return `notedown-asset://local/${token}`
}

const backupDirectory = (libraryPath) => {
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const identifier = createHash('sha256').update(libraryDirectory).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'backups', identifier)
}

const timestampedDirectoryName = (prefix) =>
  `${prefix} ${new Date().toISOString().replace(/[:.]/g, '-').replace('T', ' ').replace('Z', '')}`

const vaultDataDirectories = (libraryPath, attachmentsPath) => {
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const attachmentDirectory = resolveAttachmentDirectory(libraryPath, attachmentsPath)
  const attachmentRelativePath = path.relative(libraryDirectory, attachmentDirectory)
  const candidates = [
    ...new Set([...documentKinds, 'daily', 'templates', '.notedown', attachmentRelativePath]),
  ]
    .filter((relativePath) => relativePath && relativePath !== '.')
    .sort((left, right) => left.length - right.length)
  return candidates.filter(
    (candidate, index) =>
      !candidates.slice(0, index).some((parent) => pathIsInside(parent, candidate)),
  )
}

const copyLibrary = async (libraryPath, targetDirectory, attachmentsPath) => {
  const sourceDirectory = resolveLibraryDirectory(libraryPath)
  await mkdir(sourceDirectory, { recursive: true })
  if (pathIsInside(sourceDirectory, targetDirectory)) {
    throw new Error('目标位置不能位于资料库内部')
  }
  await mkdir(targetDirectory, { recursive: false })
  await Promise.all(
    vaultDataDirectories(libraryPath, attachmentsPath).map(async (relativePath) => {
      const sourcePath = path.join(sourceDirectory, relativePath)
      try {
        await stat(sourcePath)
      } catch (error) {
        if (error?.code === 'ENOENT') return
        throw error
      }
      await cp(sourcePath, path.join(targetDirectory, relativePath), {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: (candidate) => !/\.[0-9a-f-]{36}\.tmp$/i.test(candidate),
      })
    }),
  )
}

const listBackupNames = async (directory) => {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const createBackupSnapshot = async (
  { libraryPath, attachmentsPath = 'assets' },
  suffix = '',
) => {
  const root = backupDirectory(libraryPath)
  const name = `${timestampedDirectoryName('Jotkeep')}${suffix ? ` ${suffix}` : ''}`
  const target = path.join(root, name)
  await mkdir(root, { recursive: true })
  try {
    await copyLibrary(libraryPath, target, attachmentsPath)
    const summary = await inspectBackup(target, name)
    const manifest = {
      id: summary.id,
      createdAt: summary.createdAt,
      bytes: summary.bytes,
      files: summary.files,
      documents: summary.documents,
    }
    await writeFile(
      path.join(target, backupManifestName),
      JSON.stringify({ version: 1, ...manifest }, null, 2),
      'utf8',
    )
  } catch (error) {
    await rm(target, { force: true, recursive: true })
    throw error
  }
  return { path: target, createdAt: new Date().toISOString() }
}

const createBackup = async ({ libraryPath, attachmentsPath = 'assets', retention = 14 }) => {
  if (pendingBackup) return pendingBackup
  pendingBackup = withStorageMaintenance(async () => {
    const backup = await createBackupSnapshot({ libraryPath, attachmentsPath })
    const root = backupDirectory(libraryPath)
    const names = await listBackupNames(root)
    const keep = Math.min(60, Math.max(3, Number(retention) || 14))
    await Promise.all(
      names.slice(keep).map((name) => rm(path.join(root, name), { recursive: true })),
    )
    return backup
  }).finally(() => {
    pendingBackup = null
  })
  return pendingBackup
}

const inspectBackup = async (directory, id) => {
  const stack = [directory]
  let bytes = 0
  let files = 0
  let documents = 0
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('Backup contains a symbolic link')
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
        continue
      }
      if (!entry.isFile()) throw new Error('Backup contains an unsupported entry')
      const relativePath = path.relative(directory, entryPath).split(path.sep).join('/')
      if (relativePath === backupManifestName) continue
      const fileStats = await stat(entryPath)
      files += 1
      bytes += fileStats.size
      if (/^(?:notes|articles|clips|daily)\/.+\.md$/i.test(relativePath)) documents += 1
    }
  }
  const directoryStats = await stat(directory)
  return {
    id,
    createdAt: directoryStats.mtime.toISOString(),
    bytes,
    files,
    documents,
    valid: true,
  }
}

const listBackups = async (libraryPath) => {
  const root = backupDirectory(libraryPath)
  const names = await listBackupNames(root)
  return Promise.all(
    names.map(async (name) => {
      try {
        const stored = JSON.parse(
          await readFile(path.join(root, name, backupManifestName), 'utf8'),
        )
        if (
          stored?.version === 1 &&
          stored.id === name &&
          typeof stored.createdAt === 'string' &&
          ['bytes', 'files', 'documents'].every(
            (key) => Number.isFinite(stored[key]) && stored[key] >= 0,
          )
        ) {
          return {
            id: stored.id,
            createdAt: stored.createdAt,
            bytes: stored.bytes,
            files: stored.files,
            documents: stored.documents,
            valid: true,
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
          return { id: name, createdAt: '', bytes: 0, files: 0, documents: 0, valid: false }
        }
      }
      try {
        return await inspectBackup(path.join(root, name), name)
      } catch {
        return { id: name, createdAt: '', bytes: 0, files: 0, documents: 0, valid: false }
      }
    }),
  )
}

const verifiedBackupPath = async (libraryPath, backupId) => {
  if (typeof backupId !== 'string' || path.basename(backupId) !== backupId || !backupId) {
    throw new Error('Invalid backup')
  }
  const root = backupDirectory(libraryPath)
  const [verifiedRoot, verifiedBackup] = await Promise.all([
    realpath(root),
    realpath(path.join(root, backupId)),
  ])
  if (verifiedBackup === verifiedRoot || !pathIsInside(verifiedRoot, verifiedBackup)) {
    throw new Error('Backup is outside the backup directory')
  }
  await inspectBackup(verifiedBackup, backupId)
  return verifiedBackup
}

const copyBackupToStaging = async (backupPath, stagingPath, relativePaths) => {
  await mkdir(stagingPath, { recursive: true })
  await Promise.all(
    relativePaths.map(async (relativePath) => {
      const source = path.join(backupPath, relativePath)
      try {
        await stat(source)
      } catch (error) {
        if (error?.code === 'ENOENT') return
        throw error
      }
      const target = path.join(stagingPath, relativePath)
      await mkdir(path.dirname(target), { recursive: true })
      await cp(source, target, { recursive: true, force: false, errorOnExist: true })
    }),
  )
}

const restoreBackupWithoutLock = async ({
  libraryPath,
  attachmentsPath = 'assets',
  backupId,
}) => {
  if (pendingBackup) await pendingBackup
  const backupPath = await verifiedBackupPath(libraryPath, backupId)
  const safetyBackup = await createBackupSnapshot(
    { libraryPath, attachmentsPath },
    '恢复前',
  )
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const relativePaths = vaultDataDirectories(libraryPath, attachmentsPath)
  const transactionRoot = path.join(libraryDirectory, `.note-down-restore-${randomUUID()}`)
  const stagingPath = path.join(transactionRoot, 'staging')
  const rollbackPath = path.join(transactionRoot, 'rollback')
  const applied = []

  try {
    await copyBackupToStaging(backupPath, stagingPath, relativePaths)
    await mkdir(rollbackPath, { recursive: true })
    for (const relativePath of relativePaths) {
      const current = path.join(libraryDirectory, relativePath)
      const staged = path.join(stagingPath, relativePath)
      const rollback = path.join(rollbackPath, relativePath)
      const [currentExists, stagedExists] = await Promise.all([
        pathExists(current),
        pathExists(staged),
      ])
      const record = { current, rollback, currentExists, installed: false }
      applied.push(record)
      if (currentExists) {
        await mkdir(path.dirname(rollback), { recursive: true })
        await rename(current, rollback)
      }
      if (stagedExists) {
        await mkdir(path.dirname(current), { recursive: true })
        await rename(staged, current)
        record.installed = true
      }
    }
  } catch (error) {
    let rollbackFailed = false
    for (const record of applied.reverse()) {
      try {
        if (record.installed) await rm(record.current, { force: true, recursive: true })
        if (record.currentExists) {
          await mkdir(path.dirname(record.current), { recursive: true })
          await rename(record.rollback, record.current)
        }
      } catch {
        rollbackFailed = true
      }
    }
    if (!rollbackFailed) await rm(transactionRoot, { force: true, recursive: true })
    throw new Error(
      rollbackFailed
        ? `恢复失败，回滚文件保留在 ${transactionRoot}`
        : `恢复失败：${error instanceof Error ? error.message : '未知错误'}`,
    )
  }

  await rm(transactionRoot, { force: true, recursive: true })
  clearDocumentIndex(libraryPath)
  documentVersionState.clear()
  scheduleSpotlightSync(libraryPath)
  return {
    restoredAt: new Date().toISOString(),
    safetyBackupPath: safetyBackup.path,
  }
}

const restoreBackup = (options) =>
  withStorageMaintenance(
    () => restoreBackupWithoutLock(options),
    { discardQueuedWrites: true },
  )

const backupInterval = (frequency) =>
  frequency === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000

const latestBackupTime = async (libraryPath) => {
  const root = backupDirectory(libraryPath)
  const [latest] = await listBackupNames(root)
  if (!latest) return 0
  try {
    return (await stat(path.join(root, latest))).mtimeMs
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}

const scheduleBackup = async (options) => {
  backupConfiguration = {
    enabled: Boolean(options?.enabled),
    libraryPath: options?.libraryPath,
    attachmentsPath: options?.attachmentsPath || 'assets',
    frequency: options?.frequency === 'weekly' ? 'weekly' : 'daily',
    retention: Math.min(60, Math.max(3, Number(options?.retention) || 14)),
  }
  clearTimeout(backupTimer)
  backupTimer = null
  if (!backupConfiguration.enabled) return { enabled: false }

  const interval = backupInterval(backupConfiguration.frequency)
  const lastBackup = await latestBackupTime(backupConfiguration.libraryPath)
  const wait = Math.max(0, lastBackup + interval - Date.now())
  if (wait === 0) await createBackup(backupConfiguration)
  backupTimer = setTimeout(() => {
    if (backupConfiguration?.enabled) void scheduleBackup(backupConfiguration)
  }, wait === 0 ? interval : wait)
  return { enabled: true, nextAt: new Date(Date.now() + (wait === 0 ? interval : wait)).toISOString() }
}

const parseTaskReminderTime = (value) => {
  const match = String(value || '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/,
  )
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null
  }
  return date.getTime()
}

const clearTaskReminderTimers = () => {
  clearTimeout(taskReminderRefreshTimer)
  taskReminderRefreshTimer = null
  taskReminderTimers.forEach((timer) => clearTimeout(timer))
  taskReminderTimers.clear()
}

const showTaskReminder = (task) => {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: task.title,
    body: task.projectId
      ? nativeText('任务时间已到 · 已归属项目', 'Task is due · Assigned to a project')
      : nativeText('任务时间已到', 'Task is due'),
    timeoutType: 'default',
  })
  notification.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  notification.show()
}

const scheduleTaskReminders = (tasks = latestTaskItems) => {
  latestTaskItems = Array.isArray(tasks) ? tasks : []
  clearTaskReminderTimers()
  if (!taskNotificationsEnabled) return 0

  const now = Date.now()
  const horizon = 24 * 60 * 60 * 1000
  let hasDistantReminder = false
  latestTaskItems.forEach((task) => {
    if (!task || !['Todo', 'Doing'].includes(task.status)) return
    const reminderTime = parseTaskReminderTime(task.date)
    if (!reminderTime || reminderTime <= now) return
    const delay = reminderTime - now
    if (delay > horizon) {
      hasDistantReminder = true
      return
    }
    const timer = setTimeout(() => {
      taskReminderTimers.delete(task.id)
      showTaskReminder(task)
    }, delay)
    taskReminderTimers.set(task.id, timer)
  })
  if (hasDistantReminder) {
    taskReminderRefreshTimer = setTimeout(() => scheduleTaskReminders(), horizon)
  }
  return taskReminderTimers.size
}

const documentKinds = ['notes', 'articles', 'clips']
const documentIndexCache = new Map()
const documentContentCache = createFileSnapshotCache()
const vaultWatchers = new Map()
const reportedRecoveryFiles = new Set()

const invalidateDocumentIndex = (libraryPath) => {
  documentIndexCache.delete(resolveLibraryDirectory(libraryPath))
}

const clearDocumentIndex = (libraryPath) => {
  const key = resolveLibraryDirectory(libraryPath)
  documentIndexCache.delete(key)
  documentContentCache.clear(key)
}

const catalogPath = (libraryPath) =>
  path.join(resolveLibraryDirectory(libraryPath), '.notedown', 'catalog.json')

const preserveCorruptJSON = async (targetPath, source) => {
  const fingerprint = createHash('sha256').update(source).digest('hex').slice(0, 12)
  const recoveryPath = `${targetPath}.corrupt-${fingerprint}.bak`
  await writeTextAtomically(recoveryPath, source)
  if (!reportedRecoveryFiles.has(recoveryPath)) {
    reportedRecoveryFiles.add(recoveryPath)
    mainWindow?.webContents.send('storage:recovery-created', {
      filename: path.basename(targetPath),
      recoveryPath,
    })
  }
}

const readCatalog = async (libraryPath) => {
  const targetPath = catalogPath(libraryPath)
  try {
    const source = await readFile(targetPath, 'utf8')
    try {
      const catalog = JSON.parse(source)
      if (catalog?.version === 1 && catalog.documents && typeof catalog.documents === 'object') {
        return catalog
      }
    } catch {
      // Invalid local JSON is preserved below before the application starts a clean store.
    }
    await preserveCorruptJSON(targetPath, source)
    return { version: 1, documents: {} }
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, documents: {} }
    throw error
  }
}

const writeCatalog = async (libraryPath, catalog) => {
  const targetPath = catalogPath(libraryPath)
  await writeTextAtomically(targetPath, JSON.stringify(catalog, null, 2))
}

const readLibraryJSON = async (libraryPath, filename, fallback) => {
  const targetPath = path.join(resolveLibraryDirectory(libraryPath), '.notedown', filename)
  try {
    const source = await readFile(targetPath, 'utf8')
    try {
      return JSON.parse(source)
    } catch {
      await preserveCorruptJSON(targetPath, source)
      return fallback
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

const writeLibraryJSON = async (libraryPath, filename, value) => {
  const targetPath = path.join(resolveLibraryDirectory(libraryPath), '.notedown', filename)
  return serializePersistentWrite(targetPath, () =>
    writeTextAtomically(targetPath, JSON.stringify(value, null, 2)),
  )
}

const mutateLibraryJSON = async (libraryPath, filename, fallback, update) => {
  const targetPath = path.join(resolveLibraryDirectory(libraryPath), '.notedown', filename)
  return serializePersistentWrite(targetPath, async () => {
    const current = await readLibraryJSON(libraryPath, filename, fallback)
    const { value, result } = await update(current)
    await writeTextAtomically(targetPath, JSON.stringify(value, null, 2))
    return result
  })
}

const activityEventId = (event) =>
  `${event.type}:${event.entityId}:${event.occurredAt.slice(0, 10)}`

const recordActivity = (libraryPath, event) => {
  const normalized = { ...event, id: activityEventId(event) }
  const write = activityWriteQueue.then(async () => {
    const stored = await readLibraryJSON(libraryPath, 'activity.json', [])
    const events = Array.isArray(stored) ? stored : []
    const cutoff = Date.now() - 730 * 86_400_000
    const next = [normalized, ...events.filter((item) => item?.id !== normalized.id)]
      .filter((item) => Date.parse(item?.occurredAt) >= cutoff)
      .slice(0, 2000)
    await writeLibraryJSON(libraryPath, 'activity.json', next)
  })
  activityWriteQueue = write.catch(() => {})
  return write
}

const recordActivitySafely = async (libraryPath, event) => {
  try {
    await recordActivity(libraryPath, event)
  } catch {
    // Activity history must never prevent the source content from being saved.
  }
}

const profileLinkIds = new Set(['github', 'website', 'figma', 'twitter'])
const profileAvatarPattern = /^\.notedown\/profile\/avatar\.(?:png|jpe?g|webp|gif)$/i

const sanitizeProfile = (value) => {
  if (!value || typeof value !== 'object') throw new Error('Invalid profile data')
  const username = String(value.username || '').trim().slice(0, 80)
  if (!username) throw new Error('Profile name is required')
  const links = Array.isArray(value.links)
    ? value.links.flatMap((link) => {
        if (!profileLinkIds.has(link?.id) || typeof link?.url !== 'string') return []
        const url = link.url.trim()
        if (!url) return [{ id: link.id, url: '' }]
        const target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
        if (!['http:', 'https:'].includes(target.protocol)) return []
        return [{ id: link.id, url: target.toString() }]
      })
    : []
  const avatarPath = typeof value.avatarPath === 'string' && profileAvatarPattern.test(value.avatarPath)
    ? value.avatarPath
    : undefined
  return { username, links, avatarPath }
}

const loadProfile = async (libraryPath) => {
  const stored = await readLibraryJSON(libraryPath, 'profile.json', null)
  if (!stored) return null
  const profile = sanitizeProfile(stored)
  if (!profile.avatarPath) return profile
  try {
    const libraryDirectory = await realpath(resolveLibraryDirectory(libraryPath))
    const avatarPath = await realpath(path.join(libraryDirectory, profile.avatarPath))
    if (!pathIsInside(libraryDirectory, avatarPath)) return profile
    return { ...profile, avatarURL: assetProtocolURL(avatarPath) }
  } catch (error) {
    if (error?.code === 'ENOENT') return profile
    throw error
  }
}

const chooseProfileAvatar = async (libraryPath) => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{
      name: nativeText('图片', 'Images'),
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    }],
  })
  const sourcePath = selection.canceled ? undefined : selection.filePaths[0]
  if (!sourcePath) return null
  const fileStats = await stat(sourcePath)
  if (!fileStats.isFile() || fileStats.size > 20 * 1024 * 1024) {
    throw new Error('头像文件无效或超过 20 MB')
  }
  const extension = path.extname(sourcePath).toLocaleLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) {
    throw new Error('不支持该头像格式')
  }
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const profileDirectory = path.join(libraryDirectory, '.notedown', 'profile')
  const destination = path.join(profileDirectory, `avatar${extension}`)
  const temporaryPath = `${destination}.${randomUUID()}.tmp`
  await mkdir(profileDirectory, { recursive: true })
  try {
    await copyFile(sourcePath, temporaryPath)
    await rename(temporaryPath, destination)
    const files = await readdir(profileDirectory)
    await Promise.all(
      files
        .filter((filename) => /^avatar\.(?:png|jpe?g|webp|gif)$/i.test(filename))
        .filter((filename) => path.join(profileDirectory, filename) !== destination)
        .map((filename) => rm(path.join(profileDirectory, filename), { force: true })),
    )
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
  const avatarPath = path.relative(libraryDirectory, destination).split(path.sep).join('/')
  return { avatarPath, avatarURL: assetProtocolURL(await realpath(destination)) }
}

const updateDocumentCatalog = async (libraryPath, documentId, update) => {
  resolveDocumentPath({ documentId, libraryPath })
  return serializePersistentWrite(catalogPath(libraryPath), async () => {
    const catalog = await readCatalog(libraryPath)
    const current = catalog.documents[documentId] ?? {}
    const next = Object.fromEntries(
      Object.entries(update(current) ?? {}).filter(([, value]) => value !== undefined),
    )
    if (next && Object.keys(next).length > 0) catalog.documents[documentId] = next
    else delete catalog.documents[documentId]
    await writeCatalog(libraryPath, catalog)
    invalidateDocumentIndex(libraryPath)
    return next
  })
}

const unquoteFrontMatterValue = (value = '') => {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}

const splitFrontMatter = (content) => {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!match) return { body: normalized, title: '', tags: [] }

  const lines = match[1].split('\n')
  const title = unquoteFrontMatterValue(
    lines.find((line) => /^title\s*:/i.test(line))?.replace(/^title\s*:/i, '') ?? '',
  )
  const tags = []
  const tagIndex = lines.findIndex((line) => /^tags?\s*:/i.test(line))
  if (tagIndex >= 0) {
    const inline = lines[tagIndex].replace(/^tags?\s*:/i, '').trim()
    if (inline) {
      const values = inline.startsWith('[') && inline.endsWith(']')
        ? inline.slice(1, -1).split(',')
        : inline.split(',')
      tags.push(...values.map(unquoteFrontMatterValue).filter(Boolean))
    } else {
      for (const line of lines.slice(tagIndex + 1)) {
        const item = line.match(/^\s+-\s+(.+)$/)
        if (!item) break
        const tag = unquoteFrontMatterValue(item[1])
        if (tag) tags.push(tag)
      }
    }
  }

  return {
    body: normalized.slice(match[0].length).replace(/^\n+/, ''),
    title,
    tags: [...new Set(tags)],
  }
}

const markdownPlainText = (content) => {
  const { body } = splitFrontMatter(content)
  return body
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[bookmark:([^\]]*)\]\([^)]*\)/gi, '$1')
    .replace(/\[button:([^\]]*)\]\([^)]*\)/gi, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,9}|>|[-+*]|\d+\.)\s*/gm, '')
    .replace(/[*_~`$|:[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const normalizeSearchText = (value) =>
  String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()

const documentTitleAndTags = (content, fallback) => {
  const frontMatter = splitFrontMatter(content)
  const heading = frontMatter.body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return {
    title: heading || frontMatter.title || fallback,
    tags: frontMatter.tags,
  }
}

const saveDocumentVersion = async (libraryPath, documentId, content, force = false) => {
  if (typeof content !== 'string') return false
  const revision = contentRevision(content)
  const stateKey = documentVersionKey(libraryPath, documentId)
  const previousState = documentVersionState.get(stateKey)
  const now = Date.now()
  if (previousState?.revision === revision) return false
  if (!force && previousState && now - previousState.savedAt < documentVersionInterval) {
    return false
  }

  const directory = documentHistoryDirectory(libraryPath, documentId)
  await mkdir(directory, { recursive: true })
  const suffix = `-${revision.slice(0, 12)}.md`
  const existing = (await readdir(directory)).find((filename) => filename.endsWith(suffix))
  if (!existing) {
    const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-')
    await writeTextAtomically(path.join(directory, `${timestamp}${suffix}`), content)
  }
  const versions = (await readdir(directory))
    .filter((filename) => filename.endsWith('.md'))
    .sort()
    .reverse()
  await Promise.all(
    versions.slice(documentHistoryLimit).map((filename) =>
      rm(path.join(directory, filename), { force: true }),
    ),
  )
  documentVersionState.set(stateKey, { revision, savedAt: now })
  return true
}

const listDocumentVersions = async (libraryPath, documentId) => {
  const directory = documentHistoryDirectory(libraryPath, documentId)
  let filenames
  try {
    filenames = (await readdir(directory))
      .filter((filename) => filename.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, documentHistoryLimit)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return Promise.all(
    filenames.map(async (filename) => {
      const versionPath = path.join(directory, filename)
      const [content, versionStats] = await Promise.all([
        readFile(versionPath, 'utf8'),
        stat(versionPath),
      ])
      const plainText = markdownPlainText(content)
      return {
        id: filename,
        createdAt: versionStats.mtime.toISOString(),
        title: documentTitleAndTags(content, '历史版本').title,
        preview: plainText.slice(0, 120),
      }
    }),
  )
}

const restoreDocumentVersion = async (options) => {
  const versionId = String(options?.versionId || '')
  if (path.basename(versionId) !== versionId || !versionId.endsWith('.md')) {
    throw new Error('无效的历史版本')
  }
  const documentPath = resolveDocumentPath(options ?? {})
  return serializePersistentWrite(documentPath, async () => {
    const versionPath = path.join(
      documentHistoryDirectory(options?.libraryPath, options?.documentId),
      versionId,
    )
    const restoredContent = await readFile(versionPath, 'utf8')
    let currentContent = null
    try {
      currentContent = await readFile(documentPath, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (currentContent !== restoredContent) {
      await saveDocumentVersion(
        options?.libraryPath,
        options?.documentId,
        currentContent,
        true,
      )
      await writeDocumentContent({ ...options, content: restoredContent })
    }
    return { content: restoredContent, revision: contentRevision(restoredContent) }
  })
}

const publishKinds = new Set(['daily', 'notes', 'articles'])
const publishStatuses = new Set(['Preparing', 'Queued', 'Published', 'Failed'])

const sourceRevision = (content) =>
  createHash('sha256').update(content).digest('hex').slice(0, 20)

const sanitizePublishDraft = (value) => {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.id !== 'string' ||
    !publishKinds.has(value.sourceKind) ||
    typeof value.sourceId !== 'string' ||
    typeof value.sourceRevision !== 'string' ||
    typeof value.sourceTitle !== 'string' ||
    typeof value.sourceSnapshot !== 'string' ||
    !publishStatuses.has(value.status) ||
    typeof value.updatedAt !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    sourceKind: value.sourceKind,
    sourceId: value.sourceId,
    sourceRevision: value.sourceRevision,
    sourceTitle: value.sourceTitle.slice(0, 300),
    sourceSnapshot: value.sourceSnapshot,
    sourceBlockId:
      typeof value.sourceBlockId === 'string' ? value.sourceBlockId.slice(0, 200) : undefined,
    sourceBlockPreview:
      typeof value.sourceBlockPreview === 'string'
        ? value.sourceBlockPreview.trim().slice(0, 160)
        : undefined,
    status: value.status,
    targets: ['x'],
    updatedAt: value.updatedAt,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
  }
}

const readPublishSource = async (libraryPath, sourceKind, sourceId) => {
  if (!publishKinds.has(sourceKind) || typeof sourceId !== 'string' || !sourceId) {
    throw new Error('Invalid publish source')
  }
  const documentId = `${sourceKind}/${sourceId}`
  const content = await readFile(resolveDocumentPath({ documentId, libraryPath }), 'utf8')
  return {
    sourceRevision: sourceRevision(content),
    sourceTitle: documentTitleAndTags(content, path.basename(sourceId)).title,
    sourceSnapshot: content,
  }
}

const normalizePublishDrafts = (stored) =>
  (Array.isArray(stored) ? stored : [])
    .flatMap((draft) => sanitizePublishDraft(draft) ?? [])
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

const readPublishDrafts = async (libraryPath) =>
  normalizePublishDrafts(await readLibraryJSON(libraryPath, 'publish.json', []))

const mutatePublishDrafts = (libraryPath, update) =>
  mutateLibraryJSON(libraryPath, 'publish.json', [], async (stored) => {
    const { drafts, result } = await update(normalizePublishDrafts(stored))
    return { value: drafts, result }
  })

const publishDraftWithSourceState = async (libraryPath, draft) => {
  try {
    const source = await readPublishSource(libraryPath, draft.sourceKind, draft.sourceId)
    return { ...draft, sourceChanged: source.sourceRevision !== draft.sourceRevision }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...draft, sourceChanged: true, sourceMissing: true }
    throw error
  }
}

const listPublishDrafts = async (libraryPath) =>
  Promise.all((await readPublishDrafts(libraryPath)).map((draft) =>
    publishDraftWithSourceState(libraryPath, draft),
  ))

const initiatePublishDraft = async (options) => {
  const source = await readPublishSource(options?.libraryPath, options?.sourceKind, options?.sourceId)
  const sourceBlock = options?.sourceBlock
  const hasSourceBlock = sourceBlock !== undefined
  if (
    hasSourceBlock &&
    !(
      sourceBlock &&
      typeof sourceBlock.id === 'string' &&
      typeof sourceBlock.markdown === 'string' &&
      typeof sourceBlock.preview === 'string' &&
      sourceBlock.markdown.trim().length > 0 &&
      sourceBlock.markdown.length <= 100_000
    )
  ) {
    throw new Error('Invalid publish paragraph')
  }
  const sourceBlockId = hasSourceBlock
    ? sourceBlock.id.slice(0, 200)
    : undefined
  const sourceBlockSnapshot = hasSourceBlock ? sourceBlock.markdown.trim() : undefined
  const draft = await mutatePublishDrafts(options.libraryPath, (drafts) => {
    const existing = drafts.find(
      (item) =>
        item.sourceKind === options.sourceKind &&
        item.sourceId === options.sourceId &&
        (
          item.sourceBlockId === sourceBlockId ||
          (sourceBlockSnapshot && item.sourceSnapshot === sourceBlockSnapshot)
        ) &&
        item.status !== 'Published',
    )
    if (existing) return { drafts, result: existing }
    const created = {
      id: `publish-${randomUUID()}`,
      sourceKind: options.sourceKind,
      sourceId: options.sourceId,
      ...source,
      sourceSnapshot: sourceBlockSnapshot ?? source.sourceSnapshot,
      sourceBlockId,
      sourceBlockPreview: hasSourceBlock ? sourceBlock.preview.trim().slice(0, 160) : undefined,
      status: 'Preparing',
      targets: ['x'],
      updatedAt: new Date().toISOString(),
    }
    return { drafts: [created, ...drafts], result: created }
  })
  return { ...draft, sourceChanged: false }
}

const updatePublishDraft = async (options) => {
  const now = new Date().toISOString()
  const { next, previous } = await mutatePublishDrafts(
    options?.libraryPath,
    async (drafts) => {
      const index = drafts.findIndex((draft) => draft.id === options?.draftId)
      if (index < 0) throw new Error('Publish draft not found')
      const previous = drafts[index]
      const status = publishStatuses.has(options?.status) ? options.status : previous.status
      const source = options?.refreshSource && !previous.sourceBlockId
        ? await readPublishSource(options.libraryPath, previous.sourceKind, previous.sourceId)
        : {}
      const next = {
        ...previous,
        ...source,
        status,
        targets: ['x'],
        updatedAt: now,
        publishedAt: status === 'Published' ? previous.publishedAt ?? now : undefined,
      }
      const updated = [...drafts]
      updated[index] = next
      return { drafts: updated, result: { next, previous } }
    },
  )
  if (next.status === 'Published' && previous.status !== 'Published') {
    await recordActivitySafely(options.libraryPath, {
      type: 'publish',
      entityId: next.id,
      documentKind: next.sourceKind,
      title: next.sourceTitle,
      occurredAt: now,
    })
  }
  return publishDraftWithSourceState(options.libraryPath, next)
}

const listMarkdownFiles = async (directory, relativeDirectory = '') => {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(relativeDirectory, entry.name)
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) return listMarkdownFiles(absolutePath, relativePath)
      return entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md')
        ? [{ absolutePath, relativePath }]
        : []
    }),
  )
  return files.flat()
}

const listFiles = async (directory) => {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) return listFiles(absolutePath)
      return entry.isFile() ? [absolutePath] : []
    }),
  )
  return files.flat()
}

const markdownAssetPaths = (content, documentPath, attachmentDirectory) => {
  const candidates = [
    ...(content.matchAll(/\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)),
    ...(content.matchAll(/<(?:img|video|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)),
  ].map((match) => match[1])
  return candidates.flatMap((value) => {
    if (!value || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('#')) return []
    try {
      const assetPath = path.resolve(path.dirname(documentPath), decodeAssetURL(value))
      return pathIsInside(attachmentDirectory, assetPath) ? [assetPath] : []
    } catch {
      return []
    }
  })
}

const referencedAttachmentFiles = async (libraryPath, attachmentsPath) => {
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const attachmentDirectory = resolveAttachmentDirectory(libraryPath, attachmentsPath)
  const documentFiles = (
    await Promise.all(
      [...documentKinds, 'daily'].map((kind) =>
        listMarkdownFiles(path.join(libraryDirectory, kind)),
      ),
    )
  ).flat()
  return new Set(
    (
      await Promise.all(
        documentFiles.map(async ({ absolutePath }) =>
          markdownAssetPaths(await readFile(absolutePath, 'utf8'), absolutePath, attachmentDirectory),
        ),
      )
    ).flat(),
  )
}

const attachmentUsage = async (libraryPath, attachmentsPath) => {
  const attachmentDirectory = resolveAttachmentDirectory(libraryPath, attachmentsPath)
  const references = await referencedAttachmentFiles(libraryPath, attachmentsPath)
  const files = await listFiles(attachmentDirectory)
  const unused = files.filter((filePath) => !references.has(filePath))
  const stats = await Promise.all(unused.map((filePath) => stat(filePath)))
  return {
    files: unused,
    count: unused.length,
    bytes: stats.reduce((total, fileStats) => total + fileStats.size, 0),
  }
}

const cleanupUnusedAttachments = async (options) => {
  const usage = await attachmentUsage(options?.libraryPath, options?.attachmentsPath)
  if (!options?.dryRun) await Promise.all(usage.files.map((filePath) => shell.trashItem(filePath)))
  return { count: usage.count, bytes: usage.bytes }
}

const pathExists = async (targetPath) => {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

const filesMatch = async (leftPath, rightPath) => {
  const [leftStats, rightStats] = await Promise.all([stat(leftPath), stat(rightPath)])
  if (leftStats.size !== rightStats.size) return false
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)])
  return left.equals(right)
}

const sourceOverlapMigrationPairs = async (libraryPath, attachmentsPath) => {
  const sourceDirectory = expandLibraryDirectory(libraryPath)
  const attachmentDirectory = resolveAttachmentDirectory(libraryPath, attachmentsPath)
  const attachmentRelativePath = path.relative(sourceDirectory, attachmentDirectory)
  const coreRoots = vaultDataDirectories(libraryPath, attachmentsPath)
    .filter((relativePath) => relativePath !== attachmentRelativePath)
  const coreFiles = (
    await Promise.all(coreRoots.map((relativePath) =>
      listFiles(path.join(sourceDirectory, relativePath)),
    ))
  ).flat()
  const referencedAssets = coreRoots.some((relativePath) =>
    pathIsInside(path.join(sourceDirectory, relativePath), attachmentDirectory),
  )
    ? []
    : [...await referencedAttachmentFiles(libraryPath, attachmentsPath)]
  const pairs = new Map()
  for (const sourcePath of [...coreFiles, ...referencedAssets]) {
    const relativePath = path.relative(sourceDirectory, sourcePath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue
    pairs.set(relativePath, { sourcePath, relativePath })
  }
  return [...pairs.values()]
}

const migrationTargetMatches = async (targetDirectory, pairs) => {
  const targetFiles = await listFiles(targetDirectory)
  const expected = new Map(pairs.map((pair) => [pair.relativePath, pair]))
  const actual = new Set(
    targetFiles.map((targetPath) => path.relative(targetDirectory, targetPath)),
  )
  const missing = [...expected.keys()].filter((relativePath) => !actual.has(relativePath))
  const extra = [...actual].filter((relativePath) => !expected.has(relativePath))
  const mismatched = []
  for (const [relativePath, { sourcePath }] of expected) {
    if (
      actual.has(relativePath) &&
      !(await filesMatch(sourcePath, path.join(targetDirectory, relativePath)))
    ) {
      mismatched.push(relativePath)
    }
  }
  return {
    matches: missing.length === 0 && extra.length === 0 && mismatched.length === 0,
    missing,
    extra,
    mismatched,
  }
}

const migrateSourceOverlappingLibrary = async (options) => {
  const sourceDirectory = expandLibraryDirectory(options?.libraryPath)
  const completedMigration = libraryMigrationResults.get(sourceDirectory)
  if (completedMigration) return completedMigration
  const applicationDirectory = path.resolve(currentDirectory, '..')
  let verifiedSource
  let verifiedApplication
  try {
    const verifiedPaths = await Promise.all([
      realpath(sourceDirectory),
      realpath(applicationDirectory),
    ])
    verifiedSource = verifiedPaths[0]
    verifiedApplication = verifiedPaths[1]
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (verifiedSource !== verifiedApplication) return null

  const runningMigration = libraryMigrationTasks.get(sourceDirectory)
  if (runningMigration) return runningMigration
  const targetDirectory = path.join(app.getPath('home'), '.jotkeep')
  const temporaryDirectory = `${targetDirectory}.migration-${randomUUID()}`
  const migration = withStorageMaintenance(async () => {
    const pairs = await sourceOverlapMigrationPairs(
      options.libraryPath,
      options.attachmentsPath || 'assets',
    )
    if (await pathExists(targetDirectory)) {
      const verification = await migrationTargetMatches(targetDirectory, pairs)
      if (!verification.matches) {
        const details = [
          verification.missing.length ? `缺少 ${verification.missing.join(', ')}` : '',
          verification.extra.length ? `多出 ${verification.extra.join(', ')}` : '',
          verification.mismatched.length ? `内容不同 ${verification.mismatched.join(', ')}` : '',
        ].filter(Boolean).join('；')
        throw new Error(`Jotkeep 资料库已存在且内容不同，未自动合并：${details}`)
      }
    } else {
      await mkdir(temporaryDirectory, { recursive: false })
      try {
        for (const { sourcePath, relativePath } of pairs) {
          const targetPath = path.join(temporaryDirectory, relativePath)
          await mkdir(path.dirname(targetPath), { recursive: true })
          await copyFile(sourcePath, targetPath)
        }
        if (!(await migrationTargetMatches(temporaryDirectory, pairs)).matches) {
          throw new Error('资料库迁移校验失败')
        }
        await rename(temporaryDirectory, targetDirectory)
      } catch (error) {
        await rm(temporaryDirectory, { force: true, recursive: true })
        throw error
      }
    }
    documentIndexCache.delete(sourceDirectory)
    documentContentCache.clear(sourceDirectory)
    const result = {
      libraryPath: '~/.jotkeep',
      files: pairs.length,
      sourceRetained: true,
    }
    libraryRedirects.set(sourceDirectory, targetDirectory)
    libraryMigrationResults.set(sourceDirectory, result)
    return result
  }, { discardQueuedWrites: true })
  libraryMigrationTasks.set(sourceDirectory, migration)
  try {
    return await migration
  } finally {
    if (libraryMigrationTasks.get(sourceDirectory) === migration) {
      libraryMigrationTasks.delete(sourceDirectory)
    }
  }
}

const rewriteAssetReferences = (
  content,
  documentPath,
  sourceDirectory,
  targetDirectory,
  sourceFiles,
) => {
  const replaceReference = (match, value) => {
    if (!value || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('#')) return match
    try {
      const sourcePath = path.resolve(path.dirname(documentPath), decodeAssetURL(value))
      if (!sourceFiles.has(sourcePath)) return match
      const targetPath = path.join(targetDirectory, path.relative(sourceDirectory, sourcePath))
      return match.replace(value, relativeAssetURL(documentPath, targetPath))
    } catch {
      return match
    }
  }
  return content
    .replace(
      /\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
      replaceReference,
    )
    .replace(
      /<(?:img|video|source)\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
      replaceReference,
    )
}

const migrateAttachmentDirectory = async (options) => {
  const libraryDirectory = resolveLibraryDirectory(options?.libraryPath)
  const sourceDirectory = resolveAttachmentDirectory(
    options?.libraryPath,
    options?.fromPath,
  )
  const targetDirectory = resolveAttachmentDirectory(options?.libraryPath, options?.toPath)
  if (sourceDirectory === targetDirectory) return { files: 0, documents: 0, sourceRetained: false }
  if (pathIsInside(sourceDirectory, targetDirectory) || pathIsInside(targetDirectory, sourceDirectory)) {
    throw new Error('新旧附件目录不能互相嵌套')
  }

  const sourcePaths = await listFiles(sourceDirectory)
  const sourceFiles = new Set(sourcePaths)
  const targetPairs = sourcePaths.map((sourcePath) => ({
    sourcePath,
    targetPath: path.join(targetDirectory, path.relative(sourceDirectory, sourcePath)),
  }))
  for (const { sourcePath, targetPath } of targetPairs) {
    if ((await pathExists(targetPath)) && !(await filesMatch(sourcePath, targetPath))) {
      throw new Error(`目标目录存在同名但内容不同的附件：${path.basename(targetPath)}`)
    }
  }

  const documentFiles = (
    await Promise.all(
      [...documentKinds, 'daily'].map((kind) =>
        listMarkdownFiles(path.join(libraryDirectory, kind)),
      ),
    )
  ).flat()
  const rewrites = (
    await Promise.all(
      documentFiles.map(async ({ absolutePath }) => {
        const previous = await readFile(absolutePath, 'utf8')
        const next = rewriteAssetReferences(
          previous,
          absolutePath,
          sourceDirectory,
          targetDirectory,
          sourceFiles,
        )
        return previous === next ? null : { absolutePath, previous, next }
      }),
    )
  ).filter(Boolean)

  const createdTargets = []
  const writtenDocuments = []
  try {
    for (const { sourcePath, targetPath } of targetPairs) {
      if (await pathExists(targetPath)) continue
      await mkdir(path.dirname(targetPath), { recursive: true })
      const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
      try {
        await copyFile(sourcePath, temporaryPath)
        await rename(temporaryPath, targetPath)
        createdTargets.push(targetPath)
      } catch (error) {
        await rm(temporaryPath, { force: true })
        throw error
      }
    }
    await mkdir(targetDirectory, { recursive: true })
    for (const rewrite of rewrites) {
      await writeTextAtomically(rewrite.absolutePath, rewrite.next)
      writtenDocuments.push(rewrite)
    }
  } catch (error) {
    await Promise.allSettled([
      ...writtenDocuments.map((rewrite) =>
        writeTextAtomically(rewrite.absolutePath, rewrite.previous),
      ),
      ...createdTargets.map((targetPath) => rm(targetPath, { force: true })),
    ])
    throw error
  }

  let sourceRetained = false
  if (await pathExists(sourceDirectory)) {
    try {
      await shell.trashItem(sourceDirectory)
    } catch {
      sourceRetained = true
    }
  }
  return { files: sourcePaths.length, documents: rewrites.length, sourceRetained }
}

const importMarkdownDocuments = async (options) => {
  const kind = options?.kind
  if (!['notes', 'articles'].includes(kind)) throw new Error('不支持的导入类型')
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, {
        title: kind === 'notes'
          ? nativeText('导入笔记', 'Import notes')
          : nativeText('导入文章', 'Import articles'),
        buttonLabel: nativeText('导入', 'Import'),
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        properties: ['openFile', 'multiSelections'],
      })
    : await dialog.showOpenDialog({
        title: kind === 'notes'
          ? nativeText('导入笔记', 'Import notes')
          : nativeText('导入文章', 'Import articles'),
        buttonLabel: nativeText('导入', 'Import'),
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        properties: ['openFile', 'multiSelections'],
      })
  if (result.canceled) return []

  const targetDirectory = path.join(resolveLibraryDirectory(options?.libraryPath), kind)
  await mkdir(targetDirectory, { recursive: true })
  const imported = []
  for (const sourcePath of result.filePaths) {
    const sourceStats = await stat(sourcePath)
    if (!sourceStats.isFile() || sourceStats.size > 32 * 1024 * 1024) continue
    const extension = path.extname(sourcePath).toLocaleLowerCase()
    if (!['.md', '.markdown'].includes(extension)) continue
    const sourceName = path.basename(sourcePath, extension)
    const baseName = safeAssetName(sourceName).replace(/^\.+/, '') || '导入文档'
    let suffix = 1
    let targetPath = path.join(targetDirectory, `${baseName}.md`)
    while (await pathExists(targetPath)) {
      suffix += 1
      targetPath = path.join(targetDirectory, `${baseName} ${suffix}.md`)
    }
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
    try {
      await copyFile(sourcePath, temporaryPath)
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
    imported.push({
      id: path.basename(targetPath, '.md'),
      kind,
      title: documentTitleAndTags(
        await readFile(targetPath, 'utf8'),
        path.basename(targetPath, '.md'),
      ).title,
    })
  }
  invalidateDocumentIndex(options?.libraryPath)
  return imported
}

const scanDocuments = async (libraryPath) => {
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const catalog = await readCatalog(libraryPath)
  const seenPaths = new Set()
  const collections = await Promise.all(
    documentKinds.map(async (kind) => {
      const files = await listMarkdownFiles(path.join(libraryDirectory, kind))
      return Promise.all(
        files.map(async ({ absolutePath, relativePath }) => {
          const id = relativePath.slice(0, -3).split(path.sep).join('/')
          const documentId = `${kind}/${id}`
          const fileStats = await stat(absolutePath)
          const fingerprint = [
            fileStats.dev,
            fileStats.ino,
            fileStats.size,
            fileStats.mtimeMs,
            fileStats.ctimeMs,
          ].join(':')
          seenPaths.add(absolutePath)
          const parsed = await documentContentCache.read(
            libraryDirectory,
            absolutePath,
            fingerprint,
            async () => {
              const content = await readFile(absolutePath, 'utf8')
              const { title, tags } = documentTitleAndTags(content, path.basename(id))
              const plainText = markdownPlainText(content)
              return {
                title,
                tags,
                plainText,
                searchText: normalizeSearchText(`${title}\n${tags.join(' ')}\n${plainText}`),
              }
            },
          )
          const metadata = catalog.documents[documentId] ?? {}
          return {
            id,
            kind,
            title: parsed.title,
            tags: parsed.tags,
            projectId: typeof metadata.projectId === 'string' ? metadata.projectId : undefined,
            updatedAt: fileStats.mtime.toISOString(),
            archivedAt:
              typeof metadata.archivedAt === 'string' ? metadata.archivedAt : undefined,
            plainText: parsed.plainText,
            searchText: parsed.searchText,
          }
        }),
      )
    }),
  )
  documentContentCache.prune(libraryDirectory, seenPaths)
  return collections.flat().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

const indexedDocuments = async (libraryPath) => {
  const key = resolveLibraryDirectory(libraryPath)
  if (!documentIndexCache.has(key)) {
    documentIndexCache.set(key, scanDocuments(libraryPath))
  }
  try {
    return await documentIndexCache.get(key)
  } catch (error) {
    documentIndexCache.delete(key)
    throw error
  }
}

const syncSpotlightIndex = async (libraryPath) => {
  const documents = (await indexedDocuments(libraryPath))
    .filter((document) => !document.archivedAt)
    .map((document) => ({
      id: `${document.kind}/${document.id}`,
      title: document.title,
      text: document.plainText.slice(0, 200_000),
      tags: document.tags,
      path: resolveDocumentPath({
        documentId: `${document.kind}/${document.id}`,
        libraryPath,
      }),
      modifiedAt: document.updatedAt,
    }))
  const directory = path.join(app.getPath('temp'), 'note-down-spotlight')
  const payloadPath = path.join(directory, `${randomUUID()}.json`)
  await mkdir(directory, { recursive: true })
  await writeFile(payloadPath, JSON.stringify({ documents }), 'utf8')
  try {
    await runSpotlightBridge(['index', payloadPath])
    return { count: documents.length }
  } finally {
    await rm(payloadPath, { force: true })
  }
}

const queueSpotlightSync = (libraryPath) => {
  const synchronize = () => syncSpotlightIndex(libraryPath)
  spotlightSyncQueue = spotlightSyncQueue.then(synchronize, synchronize)
  return spotlightSyncQueue
}

const scheduleSpotlightSync = (libraryPath) => {
  spotlightSyncLibraryPath = libraryPath
  clearTimeout(spotlightSyncTimer)
  spotlightSyncTimer = setTimeout(() => {
    const requestedLibraryPath = spotlightSyncLibraryPath
    void queueSpotlightSync(requestedLibraryPath).catch(() => {})
  }, 500)
}

const documentSummary = ({ plainText: _plainText, searchText: _searchText, ...summary }) => summary

const listDocuments = async (libraryPath) =>
  (await indexedDocuments(libraryPath)).map(documentSummary)

const listActivity = async (libraryPath) => {
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const [stored, documents, dailyFiles] = await Promise.all([
    readLibraryJSON(libraryPath, 'activity.json', []),
    indexedDocuments(libraryPath),
    listMarkdownFiles(path.join(libraryDirectory, 'daily')),
  ])
  const documentEvents = documents.map((document) => {
    const event = {
      type: document.kind === 'clips' ? 'clip' : 'document',
      entityId: `${document.kind}/${document.id}`,
      documentKind: document.kind,
      title: document.title,
      occurredAt: document.updatedAt,
    }
    return { ...event, id: activityEventId(event) }
  })
  const dailyEvents = await Promise.all(
    dailyFiles.map(async ({ absolutePath, relativePath }) => {
      const [content, fileStats] = await Promise.all([
        readFile(absolutePath, 'utf8'),
        stat(absolutePath),
      ])
      const id = relativePath.slice(0, -3).split(path.sep).join('/')
      const event = {
        type: 'document',
        entityId: `daily/${id}`,
        documentKind: 'daily',
        title: documentTitleAndTags(content, id).title,
        occurredAt: fileStats.mtime.toISOString(),
      }
      return { ...event, id: activityEventId(event) }
    }),
  )
  const events = Array.isArray(stored) ? stored : []
  const merged = new Map(
    [...documentEvents, ...dailyEvents, ...events].map((event) => [event.id, event]),
  )
  return [...merged.values()]
    .filter((event) => Number.isFinite(Date.parse(event?.occurredAt)))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 2000)
}

const searchDocuments = async (libraryPath, query, requestedLimit) => {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []
  const terms = normalizedQuery.split(' ').filter(Boolean)
  const limit = Math.min(50, Math.max(1, Number(requestedLimit) || 20))
  const records = await indexedDocuments(libraryPath)

  return records
    .filter((record) => !record.archivedAt && terms.every((term) => record.searchText.includes(term)))
    .map((record) => {
      const normalizedTitle = normalizeSearchText(record.title)
      const normalizedTags = normalizeSearchText(record.tags.join(' '))
      const score = terms.reduce((total, term) => {
        if (normalizedTitle === term) return total + 120
        if (normalizedTitle.startsWith(term)) return total + 90
        if (normalizedTitle.includes(term)) return total + 60
        if (normalizedTags.includes(term)) return total + 40
        return total + 20
      }, 0)
      const firstTerm = terms[0]
      const plainNormalized = normalizeSearchText(record.plainText)
      const matchIndex = Math.max(0, plainNormalized.indexOf(firstTerm))
      const excerptStart = Math.max(0, matchIndex - 34)
      const excerpt = record.plainText.slice(excerptStart, excerptStart + 96).trim()
      return { ...documentSummary(record), excerpt, score }
    })
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(({ score: _score, ...result }) => result)
}

const startVaultWatcher = async (webContents, libraryPath) => {
  const watcherKey = webContents.id
  const libraryDirectory = resolveLibraryDirectory(libraryPath)
  const current = vaultWatchers.get(watcherKey)
  if (current?.libraryDirectory === libraryDirectory) return
  current?.close()
  await mkdir(libraryDirectory, { recursive: true })

  let notificationTimer
  const fileWatcher = watch(libraryDirectory, { recursive: true }, (_eventType, filename) => {
    const relativePath = String(filename || '').split(path.sep).join('/')
    const isDocument = /^(notes|articles|clips)(\/|$)/i.test(relativePath)
    const isCatalog = relativePath.startsWith('.notedown/catalog')
    if (!isDocument && !isCatalog) return
    clearTimeout(notificationTimer)
    notificationTimer = setTimeout(() => {
      invalidateDocumentIndex(libraryPath)
      scheduleSpotlightSync(libraryPath)
      if (!webContents.isDestroyed()) webContents.send('vault:documents-changed')
    }, 180)
  })

  const close = () => {
    clearTimeout(notificationTimer)
    fileWatcher.close()
    vaultWatchers.delete(watcherKey)
  }
  vaultWatchers.set(watcherKey, { close, libraryDirectory })
  webContents.once('destroyed', close)
}

const normalizeExternalURL = (value) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid external URL')
  const normalized = /^[a-z][a-z\d+.-]*:/i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`
  const target = new URL(normalized)
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Unsupported external URL')
  return target
}

const readResponseBytes = async (response, limit) => {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > limit) throw new Error('Response is too large')
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('Response is too large')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const decodeHTML = (value = '') =>
  value
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
      const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
      return entities[entity.toLowerCase()] ?? match
    })

const cleanHTMLText = (value = '') =>
  decodeHTML(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())

const parseTagAttributes = (tag) => {
  const attributes = Object.create(null)
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHTML(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

const resolvePageURL = (value, base) => {
  try {
    return new URL(value, base).toString()
  } catch {
    return ''
  }
}

const fetchImageDataURL = async (value) => {
  if (!value) return ''
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(value, {
      headers: { Accept: 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) return ''
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
    if (!contentType?.startsWith('image/')) return ''
    const bytes = await readResponseBytes(response, previewImageLimit)
    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`
  } catch {
    return ''
  } finally {
    clearTimeout(timeout)
  }
}

const fetchLinkMetadata = async (value) => {
  const target = normalizeExternalURL(value)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(target, {
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
        'User-Agent': 'NoteDown/0.2 (+local bookmark preview)',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`)
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('URL does not return an HTML page')
    }

    const html = new TextDecoder().decode(await readResponseBytes(response, metadataResponseLimit))
    const pageURL = response.url || target.toString()
    const metadata = new Map()
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const attributes = parseTagAttributes(tag)
      const key = (attributes.property || attributes.name || attributes.itemprop || '').toLowerCase()
      if (key && attributes.content && !metadata.has(key)) metadata.set(key, attributes.content)
    }

    const links = (html.match(/<link\b[^>]*>/gi) ?? []).map(parseTagAttributes)
    const iconLink = links.find((attributes) =>
      String(attributes.rel || '')
        .toLowerCase()
        .split(/\s+/)
        .some((value) => value.includes('icon')),
    )
    const canonicalLink = links.find((attributes) =>
      String(attributes.rel || '').toLowerCase().split(/\s+/).includes('canonical'),
    )
    const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
    const title = cleanHTMLText(
      metadata.get('og:title') || metadata.get('twitter:title') || metadata.get('title') || titleTag,
    )
    const description = cleanHTMLText(
      metadata.get('og:description') ||
        metadata.get('twitter:description') ||
        metadata.get('description') ||
        '',
    )
    const siteName = cleanHTMLText(metadata.get('og:site_name') || '')
    const iconURL = resolvePageURL(iconLink?.href || '/favicon.ico', pageURL)
    const imageURL = resolvePageURL(
      metadata.get('og:image') || metadata.get('twitter:image') || '',
      pageURL,
    )
    const [icon, image] = await Promise.all([
      fetchImageDataURL(iconURL),
      fetchImageDataURL(imageURL),
    ])

    return {
      url: resolvePageURL(canonicalLink?.href || pageURL, pageURL),
      title,
      description,
      siteName,
      icon,
      image,
    }
  } finally {
    clearTimeout(timeout)
  }
}

const articleImageExtension = (contentType) => {
  const extensions = {
    'image/avif': '.avif',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/svg+xml': '.svg',
    'image/webp': '.webp',
  }
  return extensions[contentType] ?? ''
}

const downloadArticleImage = async (value) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(value, {
      headers: {
        Accept: 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'NoteDown/0.2 (+offline reader)',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!contentType?.startsWith('image/')) return null
    const bytes = await readResponseBytes(response, articleImageLimit)
    const urlName = decodeURIComponent(new URL(response.url || value).pathname.split('/').at(-1) || '')
    const extension = path.extname(urlName) || articleImageExtension(contentType)
    return {
      bytes,
      name: safeAssetName(urlName || `article-image${extension}`),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const fetchReadableArticle = async ({
  url,
  libraryPath,
  documentId,
  attachmentsPath,
}) => {
  const target = normalizeExternalURL(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  let pageDOM
  let articleDOM
  try {
    const response = await fetch(target, {
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
        'User-Agent': 'NoteDown/0.2 (+offline reader)',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return null
    }
    const html = new TextDecoder().decode(await readResponseBytes(response, metadataResponseLimit))
    const pageURL = response.url || target.toString()
    pageDOM = new JSDOM(html, { url: pageURL })
    const article = new Readability(pageDOM.window.document, {
      charThreshold: 140,
      maxElemsToParse: 80_000,
    }).parse()
    if (!article?.content || !article.textContent?.trim()) return null

    articleDOM = new JSDOM(`<body>${article.content}</body>`, { url: pageURL })
    const leadingHeading = articleDOM.window.document.querySelector('h1, h2')
    if (
      leadingHeading &&
      cleanHTMLText(leadingHeading.textContent || '') === cleanHTMLText(article.title || '')
    ) {
      leadingHeading.remove()
    }
    const images = [...articleDOM.window.document.querySelectorAll('img')]
      .slice(0, articleImageCountLimit)
    await Promise.all(
      images.map(async (image) => {
        const imageURL = resolvePageURL(
          image.getAttribute('src') || image.getAttribute('data-src') || '',
          pageURL,
        )
        if (!imageURL) return
        const downloaded = await downloadArticleImage(imageURL)
        if (!downloaded) {
          image.setAttribute('src', imageURL)
          return
        }
        const stored = await storeAsset({
          libraryPath,
          documentId,
          attachmentsPath,
          bytes: downloaded.bytes,
          name: downloaded.name,
        })
        image.setAttribute('src', stored.url)
        image.removeAttribute('srcset')
      }),
    )

    const turndown = new TurndownService({
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      headingStyle: 'atx',
    })
    turndown.addRule('strikethrough', {
      filter: ['del', 's', 'strike'],
      replacement: (content) => `~~${content}~~`,
    })
    const markdown = turndown
      .turndown(articleDOM.window.document.body.innerHTML)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (markdown.length < 80) return null
    return {
      title: cleanHTMLText(article.title || ''),
      byline: cleanHTMLText(article.byline || ''),
      excerpt: cleanHTMLText(article.excerpt || ''),
      publishedTime: String(article.publishedTime || '').trim(),
      markdown,
      imageCount: images.filter((image) => !/^https?:/i.test(image.getAttribute('src') || '')).length,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    articleDOM?.window.close()
    pageDOM?.window.close()
  }
}

const writeDocumentContent = async ({ documentId, libraryPath, content }) => {
  const documentPath = resolveDocumentPath({ documentId, libraryPath })
  await writeTextAtomically(documentPath, content)
  invalidateDocumentIndex(libraryPath)
  return documentPath
}

const readDocumentState = async (options) => {
  const documentPath = resolveDocumentPath(options ?? {})
  try {
    const content = await readFile(documentPath, 'utf8')
    return { content, revision: contentRevision(content) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { content: null, revision: null }
    throw error
  }
}

const saveDocumentWithRevision = async (options) =>
  serializePersistentWrite(resolveDocumentPath(options ?? {}), async () => {
    const current = await readDocumentState(options)
    const hasBaseRevision = Object.hasOwn(options, 'baseRevision')
    if (
      !options?.force &&
      hasBaseRevision &&
      current.revision !== options.baseRevision &&
      current.content !== options.content
    ) {
      return {
        status: 'conflict',
        content: current.content,
        revision: current.revision,
      }
    }
    if (current.content !== options.content) {
      await saveDocumentVersion(
        options.libraryPath,
        options.documentId,
        current.content,
        Boolean(options.force),
      )
      await writeDocumentContent(options)
    }
    return { status: 'saved', revision: contentRevision(options.content) }
  })

const captureClip = async ({ url, libraryPath, projectId, attachmentsPath = 'assets' }) => {
  const requestedURL = normalizeExternalURL(url).toString()
  let metadata
  try {
    metadata = await fetchLinkMetadata(requestedURL)
  } catch {
    const target = new URL(requestedURL)
    metadata = {
      url: requestedURL,
      title: target.hostname.replace(/^www\./, ''),
      description: '',
      siteName: target.hostname.replace(/^www\./, ''),
    }
  }

  const createdAt = new Date().toISOString()
  const id = `clip-${Date.now()}-${randomUUID().slice(0, 8)}`
  const documentId = `clips/${id}`
  const canonicalURL = metadata.url || requestedURL
  const readable = await fetchReadableArticle({
    url: canonicalURL,
    libraryPath,
    documentId,
    attachmentsPath,
  })
  const title = metadata.title || readable?.title || new URL(canonicalURL).hostname.replace(/^www\./, '')
  const siteName = metadata.siteName || new URL(canonicalURL).hostname.replace(/^www\./, '')
  const bookmarkTitle = title.replace(/[\]\r\n]/g, ' ').trim()
  const bookmarkDescription = String(metadata.description || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim()
  const frontMatter = [
    '---',
    'type: clip',
    `source: ${JSON.stringify(canonicalURL)}`,
    `site: ${JSON.stringify(siteName)}`,
    `saved_at: ${JSON.stringify(createdAt)}`,
    ...(readable
      ? [
          'offline_snapshot: true',
          `snapshot_at: ${JSON.stringify(createdAt)}`,
          ...(readable.byline ? [`author: ${JSON.stringify(readable.byline)}`] : []),
          ...(readable.publishedTime
            ? [`published_at: ${JSON.stringify(readable.publishedTime)}`]
            : []),
        ]
      : []),
    `tags: [收藏${readable ? ', 离线' : ''}]`,
    '---',
  ].join('\n')
  const bookmark = `[bookmark:${bookmarkTitle}](${canonicalURL}${
    bookmarkDescription ? ` "${bookmarkDescription}"` : ''
  })`
  const content = [
    frontMatter,
    `# ${title}`,
    bookmark,
    ...(readable
      ? [
          '## 离线正文',
          readable.markdown,
        ]
      : []),
    '',
  ].join('\n\n')

  const documentPath = await writeDocumentContent({ documentId, libraryPath, content })
  if (typeof projectId === 'string' && projectId) {
    await updateDocumentCatalog(libraryPath, documentId, (current) => ({
      ...current,
      projectId,
    }))
  }
  const fileStats = await stat(documentPath)
  await recordActivitySafely(libraryPath, {
    type: 'clip',
    entityId: documentId,
    documentKind: 'clips',
    title,
    occurredAt: createdAt,
  })
  return {
    id,
    kind: 'clips',
    title,
    tags: readable ? ['收藏', '离线'] : ['收藏'],
    projectId: typeof projectId === 'string' && projectId ? projectId : undefined,
    updatedAt: fileStats.mtime.toISOString(),
  }
}

const sharedCaptureStagingDirectory = () =>
  path.join(
    app.getPath('home'),
    'Library',
    'Containers',
    'com.notedown.app.share',
    'Data',
    'Library',
    'Caches',
    'NoteDownShare',
  )

const sharedCaptureKind = (name, mimeType) => {
  const extension = path.extname(name).toLocaleLowerCase()
  const imageExtensions = ['.avif', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.webp']
  if (mimeType.startsWith('image/') || imageExtensions.includes(extension)) {
    return 'image'
  }
  if (mimeType.startsWith('video/') || ['.m4v', '.mov', '.mp4', '.webm'].includes(extension)) {
    return 'video'
  }
  return 'file'
}

const captureSharedFile = async ({ token, libraryPath, attachmentsPath = 'assets' }) => {
  if (!sharedCaptureTokenPattern.test(String(token || ''))) {
    throw new Error('Invalid shared file token')
  }
  const stagingDirectory = sharedCaptureStagingDirectory()
  const manifestPath = path.join(stagingDirectory, `${token}.json`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const stagedName = String(manifest?.file || '')
  if (
    manifest?.version !== 1 ||
    manifest?.token !== token ||
    !stagedName ||
    path.basename(stagedName) !== stagedName
  ) {
    throw new Error('Invalid shared file manifest')
  }

  const stagedPath = path.join(stagingDirectory, stagedName)
  const [verifiedStagingDirectory, verifiedStagedPath] = await Promise.all([
    realpath(stagingDirectory),
    realpath(stagedPath),
  ])
  if (!pathIsInside(verifiedStagingDirectory, verifiedStagedPath)) {
    throw new Error('Shared file is outside the staging directory')
  }
  const stagedStat = await stat(verifiedStagedPath)
  if (!stagedStat.isFile() || stagedStat.size === 0 || stagedStat.size > storedAssetLimit) {
    throw new Error('Shared file is invalid or too large')
  }

  const originalName = safeAssetName(manifest?.name || path.basename(stagedName))
  const mimeType = String(manifest?.mimeType || '').slice(0, 160).toLocaleLowerCase()
  const mediaKind = sharedCaptureKind(originalName, mimeType)
  const id = `clip-${Date.now()}-${randomUUID().slice(0, 8)}`
  const documentId = `clips/${id}`
  const createdAt = new Date().toISOString()
  const asset = await storeAsset({
    documentId,
    libraryPath,
    attachmentsPath,
    sourcePath: verifiedStagedPath,
    name: originalName,
    mode: 'copy',
  })
  const title = path.basename(originalName, path.extname(originalName)).trim() || '共享文件'
  const tag = mediaKind === 'image' ? '图片' : mediaKind === 'video' ? '视频' : '文件'
  const embedded = mediaKind === 'image'
    ? `![${title}](${asset.url})`
    : `[${mediaKind}:${originalName}](${asset.url})`
  const content = [
    '---',
    'type: clip',
    'source: shared-file',
    `original_name: ${JSON.stringify(originalName)}`,
    ...(mimeType ? [`media_type: ${JSON.stringify(mimeType)}`] : []),
    `captured_at: ${JSON.stringify(createdAt)}`,
    `tags: [收藏, ${tag}]`,
    '---',
    '',
    `# ${title}`,
    '',
    embedded,
    '',
  ].join('\n')
  const documentPath = await writeDocumentContent({ documentId, libraryPath, content })
  const fileStats = await stat(documentPath)
  await recordActivitySafely(libraryPath, {
    type: 'clip',
    entityId: documentId,
    documentKind: 'clips',
    title,
    occurredAt: createdAt,
  })
  await Promise.all([
    rm(manifestPath, { force: true }),
    rm(verifiedStagedPath, { force: true }),
  ])
  return {
    id,
    kind: 'clips',
    title,
    tags: ['收藏', tag],
    updatedAt: fileStats.mtime.toISOString(),
  }
}

const deepLinkDocumentId = (value) => {
  try {
    const target = new URL(value)
    const documentId = target.protocol === 'notedown:' && target.host === 'open'
      ? target.searchParams.get('document')
      : null
    if (
      !documentId ||
      !/^(notes|articles|clips)\/[a-z0-9][a-z0-9._/-]*$/i.test(documentId) ||
      documentId.includes('..') ||
      documentId.includes('\\')
    ) {
      return null
    }
    return documentId
  } catch {
    return null
  }
}

const deepLinkCaptureRequest = (value) => {
  try {
    const target = new URL(value)
    if (target.protocol !== 'notedown:' || target.host !== 'capture') return null
    const sharedFileToken = target.searchParams.get('file')
    if (sharedFileToken && sharedCaptureTokenPattern.test(sharedFileToken)) {
      return { kind: 'file', value: sharedFileToken.toLocaleLowerCase() }
    }
    const sharedText = target.searchParams.get('text')?.trim()
    if (sharedText) {
      return sharedText.length <= 20_000 ? { kind: 'text', value: sharedText } : null
    }
    const sharedURL = new URL(target.searchParams.get('url') ?? '')
    if (!['http:', 'https:'].includes(sharedURL.protocol)) return null
    const normalized = sharedURL.toString()
    return normalized.length <= 8192 ? { kind: 'url', value: normalized } : null
  } catch {
    return null
  }
}

const presentDocumentFromSystem = async (documentId) => {
  pendingDocumentOpen = documentId
  if (!app.isReady()) return
  if (!mainWindow || mainWindow.isDestroyed()) await createMainWindow()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('navigation:open-document', documentId)
}

const presentCaptureFromSystem = async (request) => {
  pendingCaptureRequest = request
  if (!app.isReady()) return
  if (!mainWindow || mainWindow.isDestroyed()) await createMainWindow()
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  pendingCaptureRequest = null
  mainWindow.webContents.send('capture:open', request)
}

if (process.platform === 'darwin') {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient('notedown', process.execPath, [fileURLToPath(import.meta.url)])
  } else {
    app.setAsDefaultProtocolClient('notedown')
  }
}

pendingDocumentOpen = process.argv.map(deepLinkDocumentId).find(Boolean) ?? ''
pendingCaptureRequest = process.argv.map(deepLinkCaptureRequest).find(Boolean) ?? null

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const documentId = commandLine.map(deepLinkDocumentId).find(Boolean)
    const captureRequest = commandLine.map(deepLinkCaptureRequest).find(Boolean)
    if (documentId) void presentDocumentFromSystem(documentId)
    else if (captureRequest) void presentCaptureFromSystem(captureRequest)
    else mainWindow?.focus()
  })
}

app.on('open-url', (event, value) => {
  event.preventDefault()
  const documentId = deepLinkDocumentId(value)
  const captureRequest = deepLinkCaptureRequest(value)
  if (documentId) void presentDocumentFromSystem(documentId)
  else if (captureRequest) void presentCaptureFromSystem(captureRequest)
})

app.on('continue-activity', (event, type, userInfo) => {
  if (type !== 'com.apple.corespotlightitem') return
  const documentId = userInfo?.kCSSearchableItemActivityIdentifier
  if (typeof documentId !== 'string' || !deepLinkDocumentId(`notedown://open?document=${
    encodeURIComponent(documentId)
  }`)) return
  event.preventDefault()
  void presentDocumentFromSystem(documentId)
})

app.enableSandbox()

const secureWindow = (window) => {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, targetURL) => {
    const target = new URL(targetURL)
    const allowed = new URL(allowedURL)
    const sameDocument =
      target.protocol === allowed.protocol &&
      target.host === allowed.host &&
      target.pathname === allowed.pathname
    if (!sameDocument) event.preventDefault()
  })
}

const loadRenderer = async (window) => {
  if (rendererURL) {
    await window.loadURL(new URL(rendererURL).toString())
    return
  }
  await window.loadFile(productionEntry)
}

const createMainWindow = async () => {
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 920,
    minHeight: 680,
    title: 'Jotkeep',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition,
    backgroundColor: '#fffcf0',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow = window
  allowMainWindowClose = false
  secureWindow(window)
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (allowMainWindowClose) return
    event.preventDefault()
    if (closeFlushTimer) return
    window.webContents.send('window:before-close')
    closeFlushTimer = setTimeout(() => {
      closeFlushTimer = null
      void dialog.showMessageBox(window, {
        type: 'warning',
        message: nativeText('内容尚未完成保存', 'Content has not finished saving'),
        detail: nativeText(
          '窗口保持打开。请确认保存状态后再关闭。',
          'The window will stay open. Confirm the save state before closing.',
        ),
        buttons: [nativeText('知道了', 'OK')],
      })
    }, 10_000)
  })
  window.on('closed', () => {
    clearTimeout(closeFlushTimer)
    closeFlushTimer = null
    if (mainWindow === window) mainWindow = null
  })
  await loadRenderer(window)
}

const showSettings = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('settings:show')
}

const createApplicationMenu = () => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Jotkeep',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: nativeText('设置…', 'Settings…'),
          accelerator: 'CommandOrControl+,',
          click: showSettings,
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])
  Menu.setApplicationMenu(menu)
}

const assertTrustedIPCEvent = (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window !== mainWindow) throw new Error('Untrusted IPC sender')
}

const handleIPC = (channel, handler) =>
  ipcMain.handle(channel, (event, ...arguments_) => {
    assertTrustedIPCEvent(event)
    assertIPCArguments(channel, arguments_)
    return handler(event, ...arguments_)
  })

handleIPC('settings:choose-directory', async () => {
  const options = {
    title: nativeText('选择本地资料库', 'Choose local library'),
    buttonLabel: nativeText('选择', 'Choose'),
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0]
})

handleIPC('navigation:consume-document', async () => {
  return pendingDocumentOpen || null
})

ipcMain.on('navigation:document-opened', (event, documentId) => {
  assertTrustedIPCEvent(event)
  if (pendingDocumentOpen === documentId) pendingDocumentOpen = ''
})

handleIPC('capture:consume', async () => {
  const request = pendingCaptureRequest
  pendingCaptureRequest = null
  return request
})

handleIPC('updates:check', async () => checkForGithubUpdate())

handleIPC('updates:download', async () => downloadLatestGithubUpdate())

handleIPC('settings:open-config-directory', async () => {
  const directory = app.getPath('userData')
  await mkdir(directory, { recursive: true })
  const error = await shell.openPath(directory)
  if (error) throw new Error(error)
})

handleIPC('settings:export', async (_event, options) => {
  if (!options?.settings || typeof options.settings !== 'object') throw new Error('Invalid settings')
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: nativeText('导出 Jotkeep 配置', 'Export Jotkeep settings'),
        defaultPath: `Jotkeep Settings ${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
    : await dialog.showSaveDialog({
        title: nativeText('导出 Jotkeep 配置', 'Export Jotkeep settings'),
        defaultPath: `Jotkeep Settings ${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
  if (result.canceled || !result.filePath) return null
  await writeFile(
    result.filePath,
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings: options.settings }, null, 2),
    'utf8',
  )
  return result.filePath
})

handleIPC('library:export', async (_event, options) => {
  const dialogOptions = {
    title: nativeText('选择导出位置', 'Choose export location'),
    buttonLabel: nativeText('导出', 'Export'),
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)
  if (result.canceled || !result.filePaths[0]) return null
  const target = path.join(result.filePaths[0], timestampedDirectoryName('Jotkeep Export'))
  await copyLibrary(options?.libraryPath, target, options?.attachmentsPath)
  return target
})

handleIPC('library:migrate-source-overlap', async (_event, options) =>
  migrateSourceOverlappingLibrary(options),
)

handleIPC('backup:configure', async (_event, options) => scheduleBackup(options))

handleIPC('backup:run', async (_event, options) => createBackup(options))

handleIPC('backup:list', async (_event, options) => listBackups(options?.libraryPath))

handleIPC('backup:restore', async (_event, options) => restoreBackup(options))

handleIPC('backup:open-directory', async (_event, options) => {
  const directory = backupDirectory(options?.libraryPath)
  await mkdir(directory, { recursive: true })
  const error = await shell.openPath(directory)
  if (error) throw new Error(error)
})

handleIPC('notifications:configure', async (_event, options) => {
  taskNotificationsEnabled = options?.enabled !== false
  const scheduled = scheduleTaskReminders()
  return { enabled: taskNotificationsEnabled, supported: Notification.isSupported(), scheduled }
})

handleIPC('search:rebuild', async (_event, options) => {
  clearDocumentIndex(options?.libraryPath)
  const documents = await indexedDocuments(options?.libraryPath)
  await queueSpotlightSync(options?.libraryPath)
  return { count: documents.length }
})

handleIPC('document:load', async (_event, options) => {
  const state = await readDocumentState(options)
  return state.content
})

handleIPC('document:load-state', async (_event, options) =>
  readDocumentState(options),
)

handleIPC('document:versions', async (_event, options) =>
  listDocumentVersions(options?.libraryPath, options?.documentId),
)

handleIPC('document:restore-version', async (_event, options) =>
  restoreDocumentVersion(options),
)

handleIPC('document:list', async (_event, options) => {
  const documents = await listDocuments(options?.libraryPath)
  scheduleSpotlightSync(options?.libraryPath)
  return documents
})

handleIPC('document:import', async (_event, options) =>
  runStorageOperation(() => importMarkdownDocuments(options)),
)

handleIPC('document:search', async (_event, options) =>
  searchDocuments(options?.libraryPath, options?.query, options?.limit),
)

handleIPC('vault:watch', async (event, options) =>
  startVaultWatcher(event.sender, options?.libraryPath),
)

handleIPC('document:save', async (_event, options) => {
  if (typeof options?.content !== 'string') throw new Error('Invalid document content')
  const result = await saveDocumentWithRevision(options)
  if (result.status === 'conflict') return result
  if (Object.hasOwn(options, 'projectId')) {
    await updateDocumentCatalog(options.libraryPath, options.documentId, (current) => ({
      ...current,
      projectId: typeof options.projectId === 'string' ? options.projectId : undefined,
    }))
  }
  const [documentKind, ...idSegments] = options.documentId.split('/')
  const title = documentTitleAndTags(options.content, idSegments.at(-1) || '无标题').title
  await recordActivitySafely(options.libraryPath, {
    type: documentKind === 'clips' ? 'clip' : 'document',
    entityId: options.documentId,
    documentKind,
    title,
    occurredAt: new Date().toISOString(),
  })
  scheduleSpotlightSync(options.libraryPath)
  return result
})

handleIPC('document:set-project', async (_event, options) => {
  const projectId = typeof options?.projectId === 'string' && options.projectId
    ? options.projectId
    : undefined
  await updateDocumentCatalog(options?.libraryPath, options?.documentId, (current) => ({
    ...current,
    projectId,
  }))
})

handleIPC('document:set-archived', async (_event, options) => {
  if (typeof options?.archived !== 'boolean') throw new Error('Invalid archive state')
  const archivedAt = options.archived ? new Date().toISOString() : undefined
  await updateDocumentCatalog(options.libraryPath, options.documentId, (current) => ({
    ...current,
    archivedAt,
  }))
  scheduleSpotlightSync(options.libraryPath)
  return archivedAt
})

handleIPC('document:trash', async (_event, options) => {
  await runStorageOperation(async () => {
    const documentPath = resolveDocumentPath(options ?? {})
    try {
      await shell.trashItem(documentPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await updateDocumentCatalog(options.libraryPath, options.documentId, () => undefined)
    scheduleSpotlightSync(options.libraryPath)
  })
})

handleIPC('tasks:list', async (_event, options) => {
  const value = await readLibraryJSON(options?.libraryPath, 'tasks.json', null)
  const storedTasks = value === null ? null : Array.isArray(value) ? value : []
  scheduleTaskReminders(storedTasks ?? [])
  return storedTasks
})

handleIPC('tasks:save', async (_event, options) => {
  if (!Array.isArray(options?.tasks)) throw new Error('Invalid task data')
  const previous = await mutateLibraryJSON(
    options.libraryPath,
    'tasks.json',
    [],
    (stored) => ({
      value: options.tasks,
      result: Array.isArray(stored) ? stored : [],
    }),
  )
  const previousById = new Map(
    previous.map((task) => [task?.id, task]),
  )
  scheduleTaskReminders(options.tasks)
  await Promise.all(
    options.tasks
      .filter((task) => task?.status === 'Done' && previousById.get(task.id)?.status !== 'Done')
      .map((task) =>
        recordActivitySafely(options.libraryPath, {
          type: 'task',
          entityId: task.id,
          title: task.title,
          occurredAt: new Date().toISOString(),
        }),
      ),
  )
})

handleIPC('activity:list', async (_event, options) => listActivity(options?.libraryPath))

handleIPC('projects:list', async (_event, options) => {
  const value = await readLibraryJSON(options?.libraryPath, 'projects.json', null)
  return value === null ? null : Array.isArray(value) ? value : []
})

handleIPC('projects:save', async (_event, options) => {
  if (!Array.isArray(options?.projects)) throw new Error('Invalid project data')
  await writeLibraryJSON(options.libraryPath, 'projects.json', options.projects)
})

handleIPC('profile:load', async (_event, options) => loadProfile(options?.libraryPath))

handleIPC('profile:save', async (_event, options) => {
  const profile = sanitizeProfile(options?.profile)
  await writeLibraryJSON(options?.libraryPath, 'profile.json', profile)
  return loadProfile(options?.libraryPath)
})

handleIPC('profile:choose-avatar', async (_event, options) =>
  runStorageOperation(() => chooseProfileAvatar(options?.libraryPath)),
)

handleIPC('publish:list', async (_event, options) =>
  listPublishDrafts(options?.libraryPath),
)

handleIPC('publish:initiate', async (_event, options) => initiatePublishDraft(options))

handleIPC('publish:update', async (_event, options) => updatePublishDraft(options))

handleIPC('publish:copy', async (_event, options) => {
  const draft = (await readPublishDrafts(options?.libraryPath))
    .find((item) => item.id === options?.draftId)
  if (!draft) throw new Error('Publish draft not found')
  clipboard.writeText(draft.sourceSnapshot)
})

handleIPC('clipboard:write-text', async (_event, value) => {
  if (typeof value !== 'string' || value.length > 5_000_000) {
    throw new Error('Invalid clipboard text')
  }
  clipboard.writeText(value)
})

handleIPC('publish:delete', async (_event, options) => {
  await mutatePublishDrafts(
    options?.libraryPath,
    (drafts) => ({
      drafts: drafts.filter((draft) => draft.id !== options?.draftId),
      result: undefined,
    }),
  )
})

handleIPC('link:open', async (_event, value) => {
  if (typeof value !== 'string') throw new Error('Invalid external URL')
  const target = new URL(value)
  if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) {
    throw new Error('Unsupported external URL')
  }
  await shell.openExternal(target.toString())
})

handleIPC('link:metadata', async (_event, value) => fetchLinkMetadata(value))

handleIPC('clip:capture', async (_event, options) => {
  if (typeof options?.url !== 'string') throw new Error('Invalid clip URL')
  return runStorageOperation(() => captureClip(options))
})

handleIPC('capture:import-file', async (_event, options) =>
  runStorageOperation(() => captureSharedFile(options)),
)

handleIPC('weather:get', async (_event, options) => getWeather(options))

handleIPC('asset:save', async (_event, options) =>
  runStorageOperation(() => storeAsset(options)),
)

handleIPC('asset:cleanup-unused', async (_event, options) =>
  runStorageOperation(() => cleanupUnusedAttachments(options)),
)

handleIPC('asset:migrate-directory', async (_event, options) =>
  runStorageOperation(() => migrateAttachmentDirectory(options)),
)

handleIPC('asset:resolve', async (_event, options) => {
  let assetPath
  try {
    assetPath = await resolveAnyAssetPath(options)
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
  const assetStat = await stat(assetPath)
  if (!assetStat.isFile()) throw new Error('Asset is not a file')
  return assetProtocolURL(assetPath)
})

handleIPC('asset:open', async (_event, options) => {
  if (typeof options?.url !== 'string') throw new Error('Invalid asset URL')
  if (/^https?:/i.test(options.url)) {
    const target = normalizeExternalURL(options.url)
    await shell.openExternal(target.toString())
    return
  }

  if (!options.url.startsWith('data:')) {
    const assetPath = await resolveAnyAssetPath(options)
    const error = await shell.openPath(assetPath)
    if (error) throw new Error(error)
    return
  }

  const match = options.url.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([\s\S]+)$/)
  if (!match) throw new Error('Unsupported local asset')
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('Asset is too large')
  const safeName = String(options.name || 'attachment')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .slice(0, 120)
  const assetDirectory = path.join(app.getPath('temp'), 'note-down-assets')
  const assetPath = path.join(assetDirectory, `${randomUUID()}-${safeName || 'attachment'}`)
  await mkdir(assetDirectory, { recursive: true })
  await writeFile(assetPath, bytes)
  const error = await shell.openPath(assetPath)
  if (error) throw new Error(error)
})

ipcMain.on('window:traffic-lights', (event, visible) => {
  assertTrustedIPCEvent(event)
  if (process.platform !== 'darwin' || typeof visible !== 'boolean') return
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return
  window.setWindowButtonVisibility(visible)
  if (visible) window.setWindowButtonPosition(trafficLightPosition)
})

ipcMain.on('settings:locale', (event, locale) => {
  assertTrustedIPCEvent(event)
  if (!['zh-CN', 'en-US'].includes(locale) || interfaceLocale === locale) return
  interfaceLocale = locale
  createApplicationMenu()
})

ipcMain.on('window:flush-complete', async (event, success) => {
  assertTrustedIPCEvent(event)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window !== mainWindow) return
  if (success !== true) {
    clearTimeout(closeFlushTimer)
    closeFlushTimer = null
    void dialog.showMessageBox(window, {
      type: 'warning',
      message: nativeText('无法保存当前内容', 'Could not save current content'),
      detail: nativeText(
        '窗口保持打开。请检查资料库权限或磁盘空间后重试。',
        'The window will stay open. Check library permissions or disk space and try again.',
      ),
      buttons: [nativeText('知道了', 'OK')],
    })
    return
  }
  try {
    await flushStorageOperations()
  } catch {
    clearTimeout(closeFlushTimer)
    closeFlushTimer = null
    void dialog.showMessageBox(window, {
      type: 'warning',
      message: nativeText('无法保存当前内容', 'Could not save current content'),
      detail: nativeText(
        '窗口保持打开。请检查资料库权限或磁盘空间后重试。',
        'The window will stay open. Check library permissions or disk space and try again.',
      ),
      buttons: [nativeText('知道了', 'OK')],
    })
    return
  }
  clearTimeout(closeFlushTimer)
  closeFlushTimer = null
  allowMainWindowClose = true
  window.close()
})

app.whenReady().then(async () => {
  interfaceLocale = app.getLocale().toLocaleLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
  protocol.handle('notedown-asset', async (request) => {
    const target = new URL(request.url)
    const token = target.pathname.replace(/^\/+/, '')
    const assetPath = assetPathsByToken.get(token)
    if (!assetPath) return new Response('Not found', { status: 404 })
    try {
      return await net.fetch(pathToFileURL(assetPath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  createApplicationMenu()
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  clearTaskReminderTimers()
  clearTimeout(backupTimer)
  clearTimeout(closeFlushTimer)
})
