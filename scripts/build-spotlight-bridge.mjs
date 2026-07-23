import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sourceDirectory = path.join(rootDirectory, 'native', 'SpotlightBridge')
const appDirectory = path.join(rootDirectory, 'native', 'build', 'SpotlightBridge.app')
const contentsDirectory = path.join(appDirectory, 'Contents')
const executableDirectory = path.join(contentsDirectory, 'MacOS')
const executablePath = path.join(executableDirectory, 'SpotlightBridge')

rmSync(appDirectory, { force: true, recursive: true })
mkdirSync(executableDirectory, { recursive: true })
cpSync(path.join(sourceDirectory, 'Info.plist'), path.join(contentsDirectory, 'Info.plist'))

execFileSync('xcrun', [
  'swiftc',
  path.join(sourceDirectory, 'main.swift'),
  '-target',
  'arm64-apple-macosx26.0',
  '-framework',
  'AppKit',
  '-framework',
  'CoreSpotlight',
  '-framework',
  'UniformTypeIdentifiers',
  '-o',
  executablePath,
], { stdio: 'inherit' })
execFileSync('plutil', ['-lint', path.join(contentsDirectory, 'Info.plist')], {
  stdio: 'inherit',
})
execFileSync('codesign', ['--force', '--sign', '-', appDirectory], { stdio: 'inherit' })

process.stdout.write(`SpotlightBridge built at ${appDirectory}\n`)
