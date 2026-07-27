import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { packager } from '@electron/packager'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outputDirectory = path.join(rootDirectory, 'release')
const excludedRoots = new Set([
  '.git',
  '.notedown',
  'artifacts',
  'assets',
  'clips',
  'daily',
  'docs',
  'native',
  'notes',
  'release',
  'scripts',
  'src',
  'tests',
])
const excludedFiles = new Set([
  'README.en.md',
  'README.md',
  'index.html',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
])
const retainedElectronLocales = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj'])

const removeUnusedElectronLocales = ({ buildPath, platform }) => {
  if (platform !== 'darwin') return
  const resourcesDirectory = path.join(
    buildPath,
    'Electron.app',
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources',
  )
  for (const entry of readdirSync(resourcesDirectory, { withFileTypes: true })) {
    if (
      entry.isDirectory()
      && entry.name.endsWith('.lproj')
      && !retainedElectronLocales.has(entry.name)
    ) {
      rmSync(path.join(resourcesDirectory, entry.name), { recursive: true, force: true })
    }
  }
}

const outputPaths = await packager({
  dir: rootDirectory,
  out: outputDirectory,
  name: 'Jotkeep',
  executableName: 'Jotkeep',
  platform: 'darwin',
  arch: 'arm64',
  appBundleId: 'com.notedown.app',
  helperBundleId: 'com.notedown.app.helper',
  appCategoryType: 'public.app-category.productivity',
  appCopyright: 'Copyright © 2026 Jotkeep',
  appVersion: '0.2.9',
  buildVersion: '10',
  asar: true,
  afterExtract: [removeUnusedElectronLocales],
  prune: true,
  overwrite: true,
  icon: path.join(rootDirectory, 'assets', 'app-icon.icns'),
  protocols: [{ name: 'Jotkeep Document', schemes: ['notedown'] }],
  extendInfo: {
    CFBundleDisplayName: 'Jotkeep',
    LSMinimumSystemVersion: '26.0',
    NSHighResolutionCapable: true,
  },
  extraResource: [
    path.join(rootDirectory, 'native', 'build', 'WeatherBridge.app'),
    path.join(rootDirectory, 'native', 'build', 'SpotlightBridge.app'),
  ],
  ignore: (filePath) => {
    const relativePath = filePath.startsWith(`${rootDirectory}${path.sep}`)
      ? path.relative(rootDirectory, filePath)
      : filePath.replace(/^[/\\]+/, '')
    if (!relativePath) return false
    if (
      relativePath === 'node_modules/.bin'
      || relativePath.startsWith(`node_modules/.bin${path.sep}`)
      || relativePath === 'node_modules/.vite'
      || relativePath.startsWith(`node_modules/.vite${path.sep}`)
    ) {
      return true
    }
    const [rootName] = relativePath.split(path.sep)
    return excludedRoots.has(rootName) || excludedFiles.has(relativePath)
  },
})

const appPath = path.join(outputPaths[0], 'Jotkeep.app')
const plugInsDirectory = path.join(appPath, 'Contents', 'PlugIns')
mkdirSync(plugInsDirectory, { recursive: true })
cpSync(
  path.join(rootDirectory, 'native', 'build', 'NoteDownShare.appex'),
  path.join(plugInsDirectory, 'NoteDownShare.appex'),
  { recursive: true },
)
execFileSync('codesign', [
  '--force',
  '--deep',
  '--sign',
  '-',
  '--preserve-metadata=entitlements',
  appPath,
], {
  stdio: 'inherit',
})
execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
  stdio: 'inherit',
})
process.stdout.write(`Packaged app at ${appPath}\n`)
