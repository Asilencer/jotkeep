import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sourceDirectory = path.join(rootDirectory, 'native', 'ShareExtension')
const extensionDirectory = path.join(rootDirectory, 'native', 'build', 'NoteDownShare.appex')
const contentsDirectory = path.join(extensionDirectory, 'Contents')
const executableDirectory = path.join(contentsDirectory, 'MacOS')
const executablePath = path.join(executableDirectory, 'NoteDownShare')
const entitlementsPath = path.join(sourceDirectory, 'ShareExtension.entitlements')
const sdkPath = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
  encoding: 'utf8',
}).trim()

rmSync(extensionDirectory, { force: true, recursive: true })
mkdirSync(executableDirectory, { recursive: true })
cpSync(path.join(sourceDirectory, 'Info.plist'), path.join(contentsDirectory, 'Info.plist'))

execFileSync(
  'xcrun',
  [
    'swiftc',
    path.join(sourceDirectory, 'main.swift'),
    '-parse-as-library',
    '-application-extension',
    '-swift-version',
    '5',
    '-target',
    'arm64-apple-macos26.0',
    '-sdk',
    sdkPath,
    '-module-name',
    'NoteDownShare',
    '-Xlinker',
    '-e',
    '-Xlinker',
    '_NSExtensionMain',
    '-framework',
    'AppKit',
    '-framework',
    'UniformTypeIdentifiers',
    '-o',
    executablePath,
  ],
  { stdio: 'inherit' },
)
execFileSync('plutil', ['-lint', path.join(contentsDirectory, 'Info.plist')], {
  stdio: 'inherit',
})
execFileSync(
  'codesign',
  ['--force', '--sign', '-', '--entitlements', entitlementsPath, extensionDirectory],
  { stdio: 'inherit' },
)
execFileSync('codesign', ['--verify', '--strict', '--verbose=2', extensionDirectory], {
  stdio: 'inherit',
})
process.stdout.write(`Share extension built at ${extensionDirectory}\n`)
