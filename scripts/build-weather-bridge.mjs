import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = path.join(root, 'native', 'WeatherBridge')
const buildDirectory = path.join(root, 'native', 'build')
const appDirectory = path.join(buildDirectory, 'WeatherBridge.app')
const contentsDirectory = path.join(appDirectory, 'Contents')
const executableDirectory = path.join(contentsDirectory, 'MacOS')
const executablePath = path.join(executableDirectory, 'WeatherBridge')
const identity = process.env.NOTE_DOWN_CODESIGN_IDENTITY || '-'
const bundleIdentifier =
  process.env.NOTE_DOWN_WEATHER_BUNDLE_ID || 'com.notedown.weather-bridge'

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options }).trim()

const sdk = run('xcodebuild', ['-version', '-sdk', 'macosx', 'Path'])
const target = `${os.arch() === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`

rmSync(appDirectory, { force: true, recursive: true })
mkdirSync(executableDirectory, { recursive: true })

run('xcrun', [
  '--sdk',
  'macosx',
  'swiftc',
  '-parse-as-library',
  '-sdk',
  sdk,
  '-target',
  target,
  '-framework',
  'CoreLocation',
  path.join(sourceDirectory, 'main.swift'),
  '-o',
  executablePath,
])

const info = readFileSync(path.join(sourceDirectory, 'Info.plist'), 'utf8')
  .replaceAll('$(PRODUCT_BUNDLE_IDENTIFIER)', bundleIdentifier)
writeFileSync(path.join(contentsDirectory, 'Info.plist'), info)

run('codesign', ['--force', '--sign', identity, '--timestamp=none', appDirectory])

process.stdout.write(
  `WeatherBridge built at ${appDirectory}\n` +
    `Bundle ID: ${bundleIdentifier}\n` +
    'Data source: Open-Meteo\n' +
    `Signing identity: ${identity === '-' ? 'ad hoc' : identity}\n`,
)
