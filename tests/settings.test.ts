import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSettings, sanitizeSettings } from '../src/settings'

test('设置输入在进入运行时前完成校验与边界收敛', () => {
  const settings = sanitizeSettings({
    language: 'unsupported',
    theme: 'dark',
    uiFontSize: 100,
    fontSize: 1,
    lineHeight: Number.NaN,
    accentColor: 'red',
    libraryPath: '  ~/Documents/Jotkeep  ',
    backupRetention: 2.6,
  })

  assert.equal(settings.language, defaultSettings.language)
  assert.equal(settings.theme, 'dark')
  assert.equal(settings.uiFontSize, 20)
  assert.equal(settings.fontSize, 12)
  assert.equal(settings.lineHeight, defaultSettings.lineHeight)
  assert.equal(settings.accentColor, defaultSettings.accentColor)
  assert.equal(settings.libraryPath, '~/Documents/Jotkeep')
  assert.equal(settings.backupRetention, 3)
})
