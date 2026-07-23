export type SettingsPane =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'files'
  | 'accounts'
  | 'advanced'

export type AppSettings = {
  language: 'system' | 'zh-CN' | 'en-US'
  defaultDocumentKind: 'notes' | 'articles'
  confirmDelete: boolean
  taskNotifications: boolean
  theme: 'system' | 'light' | 'dark'
  sidebarTransparency: number
  customColors: boolean
  accentColor: string
  backgroundColor: string
  foregroundColor: string
  uiFont: string
  writingFont: string
  codeFont: string
  uiFontSize: number
  fontSize: number
  codeFontSize: number
  lineHeight: number
  contrast: number
  fontSmoothing: boolean
  reduceMotion: 'system' | 'on' | 'off'
  editorMode: 'preview' | 'source'
  spellcheck: boolean
  pasteMode: 'markdown' | 'plain'
  attachmentMode: 'copy' | 'reference'
  libraryPath: string
  attachmentsPath: string
  backupEnabled: boolean
  backupFrequency: 'daily' | 'weekly'
  backupRetention: number
}

export const settingsStorageKey = 'note-down.settings.v1'
export const settingsPaneStorageKey = 'note-down.settings-pane'

export const defaultSettings: AppSettings = {
  language: 'system',
  defaultDocumentKind: 'notes',
  confirmDelete: true,
  taskNotifications: true,
  theme: 'light',
  sidebarTransparency: 100,
  customColors: true,
  accentColor: '#CC7D5E',
  backgroundColor: '#FFFCF0',
  foregroundColor: '#2D2D2B',
  uiFont: '"ComicShannsMono Nerd Font", "Hannotate SC", sans-serif',
  writingFont: '"ComicShannsMono Nerd Font", "Hannotate SC", sans-serif',
  codeFont: '"ComicShannsMono Nerd Font", "Hannotate SC", sans-serif',
  uiFontSize: 15,
  fontSize: 15,
  codeFontSize: 14,
  lineHeight: 1.2,
  contrast: 50,
  fontSmoothing: true,
  reduceMotion: 'system',
  editorMode: 'preview',
  spellcheck: true,
  pasteMode: 'markdown',
  attachmentMode: 'copy',
  libraryPath: '~/.jotkeep',
  attachmentsPath: 'assets',
  backupEnabled: true,
  backupFrequency: 'daily',
  backupRetention: 14,
}

const legacyWritingFonts: Record<string, string> = {
  serif: 'SF Pro Text',
  system: 'SF Pro Text',
  mono: 'SFMono-Regular',
  '"New York", ui-serif, Georgia, serif': 'SF Pro Text',
}

const legacyUiFont = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif'
const legacyCodeFont = 'ui-monospace, "SFMono-Regular", Menlo, monospace'

const oneOf = <Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  fallback: Value,
) => allowed.includes(value as Value) ? value as Value : fallback

const boundedNumber = (value: unknown, minimum: number, maximum: number, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

const settingText = (value: unknown, fallback: string, maximum = 240) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximum)
    : fallback

const settingBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback

export function sanitizeSettings(value: unknown): AppSettings {
  const parsed = value && typeof value === 'object'
    ? value as Partial<AppSettings>
    : {}
  const writingFont = legacyWritingFonts[String(parsed.writingFont)] ?? parsed.writingFont
  return {
    language: oneOf(parsed.language, ['system', 'zh-CN', 'en-US'], defaultSettings.language),
    defaultDocumentKind: oneOf(
      parsed.defaultDocumentKind,
      ['notes', 'articles'],
      defaultSettings.defaultDocumentKind,
    ),
    confirmDelete: settingBoolean(parsed.confirmDelete, defaultSettings.confirmDelete),
    taskNotifications: settingBoolean(
      parsed.taskNotifications,
      defaultSettings.taskNotifications,
    ),
    theme: oneOf(parsed.theme, ['system', 'light', 'dark'], defaultSettings.theme),
    sidebarTransparency: boundedNumber(
      parsed.sidebarTransparency,
      0,
      100,
      defaultSettings.sidebarTransparency,
    ),
    customColors: settingBoolean(parsed.customColors, defaultSettings.customColors),
    accentColor: isHexColor(String(parsed.accentColor))
      ? String(parsed.accentColor)
      : defaultSettings.accentColor,
    backgroundColor: isHexColor(String(parsed.backgroundColor))
      ? String(parsed.backgroundColor)
      : defaultSettings.backgroundColor,
    foregroundColor: isHexColor(String(parsed.foregroundColor))
      ? String(parsed.foregroundColor)
      : defaultSettings.foregroundColor,
    uiFont: settingText(
      parsed.uiFont === legacyUiFont ? 'SF Pro Text' : parsed.uiFont,
      defaultSettings.uiFont,
    ),
    writingFont: settingText(writingFont, defaultSettings.writingFont),
    codeFont: settingText(
      parsed.codeFont === legacyCodeFont ? 'SFMono-Regular' : parsed.codeFont,
      defaultSettings.codeFont,
    ),
    uiFontSize: boundedNumber(parsed.uiFontSize, 11, 20, defaultSettings.uiFontSize),
    fontSize: boundedNumber(parsed.fontSize, 12, 28, defaultSettings.fontSize),
    codeFontSize: boundedNumber(parsed.codeFontSize, 10, 24, defaultSettings.codeFontSize),
    lineHeight: boundedNumber(parsed.lineHeight, 1.2, 2.4, defaultSettings.lineHeight),
    contrast: boundedNumber(parsed.contrast, 0, 100, defaultSettings.contrast),
    fontSmoothing: settingBoolean(parsed.fontSmoothing, defaultSettings.fontSmoothing),
    reduceMotion: oneOf(
      parsed.reduceMotion,
      ['system', 'on', 'off'],
      defaultSettings.reduceMotion,
    ),
    editorMode: oneOf(
      parsed.editorMode,
      ['preview', 'source'],
      defaultSettings.editorMode,
    ),
    spellcheck: settingBoolean(parsed.spellcheck, defaultSettings.spellcheck),
    pasteMode: oneOf(parsed.pasteMode, ['markdown', 'plain'], defaultSettings.pasteMode),
    attachmentMode: oneOf(
      parsed.attachmentMode,
      ['copy', 'reference'],
      defaultSettings.attachmentMode,
    ),
    libraryPath: settingText(parsed.libraryPath, defaultSettings.libraryPath, 2048),
    attachmentsPath: settingText(
      parsed.attachmentsPath,
      defaultSettings.attachmentsPath,
      240,
    ),
    backupEnabled: settingBoolean(parsed.backupEnabled, defaultSettings.backupEnabled),
    backupFrequency: oneOf(
      parsed.backupFrequency,
      ['daily', 'weekly'],
      defaultSettings.backupFrequency,
    ),
    backupRetention: Math.round(
      boundedNumber(parsed.backupRetention, 3, 60, defaultSettings.backupRetention),
    ),
  }
}

export function loadSettings(): AppSettings {
  const saved = window.localStorage.getItem(settingsStorageKey)
  if (!saved) return defaultSettings
  try {
    const parsed = JSON.parse(saved) as Partial<AppSettings> & {
      plugins?: unknown
    }
    const { plugins: _legacyPlugins, ...savedSettings } = parsed
    return sanitizeSettings(savedSettings)
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings) {
  window.localStorage.setItem(settingsStorageKey, JSON.stringify(sanitizeSettings(settings)))
  window.dispatchEvent(new CustomEvent('note-down:settings-changed'))
}

const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value)

export function applyAppearance(settings: AppSettings) {
  const root = document.documentElement
  if (settings.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = settings.theme

  if (settings.reduceMotion === 'system') delete root.dataset.reduceMotion
  else root.dataset.reduceMotion = settings.reduceMotion

  root.dataset.fontSmoothing = settings.fontSmoothing ? 'on' : 'off'
  root.style.setProperty('--ui-font-family', settings.uiFont)
  root.style.setProperty('--writing-font-family', settings.writingFont)
  root.style.setProperty('--code-font-family', settings.codeFont)
  root.style.setProperty('--ui-font-size', `${settings.uiFontSize}px`)
  root.style.setProperty('--ui-font-size-sm', `${Math.max(11, settings.uiFontSize - 2)}px`)
  root.style.setProperty('--ui-font-size-caption', `${Math.max(10, settings.uiFontSize - 3)}px`)
  root.style.setProperty('--ui-font-size-xs', `${Math.max(9, settings.uiFontSize - 4)}px`)
  root.style.setProperty('--editor-font-size', `${settings.fontSize}px`)
  root.style.setProperty('--code-font-size', `${settings.codeFontSize}px`)
  root.style.setProperty('--editor-line-height', String(settings.lineHeight))
  root.style.setProperty(
    '--sidebar-background-opacity',
    `${100 - settings.sidebarTransparency}%`,
  )

  const contrast = Math.min(100, Math.max(0, settings.contrast))
  root.style.setProperty(
    '--text-soft',
    `color-mix(in srgb, var(--text) ${58 + contrast * 0.28}%, var(--bg))`,
  )
  root.style.setProperty(
    '--muted',
    `color-mix(in srgb, var(--text) ${38 + contrast * 0.28}%, var(--bg))`,
  )
  root.style.setProperty(
    '--faint',
    `color-mix(in srgb, var(--text) ${25 + contrast * 0.22}%, var(--bg))`,
  )
  root.style.setProperty(
    '--line',
    `color-mix(in srgb, var(--text) ${5 + contrast * 0.08}%, transparent)`,
  )
  root.style.setProperty(
    '--line-strong',
    `color-mix(in srgb, var(--text) ${9 + contrast * 0.12}%, transparent)`,
  )

  const customColors = {
    '--accent': settings.accentColor,
    '--bg': settings.backgroundColor,
    '--text': settings.foregroundColor,
  }
  Object.entries(customColors).forEach(([property, value]) => {
    if (settings.customColors && isHexColor(value)) root.style.setProperty(property, value)
    else root.style.removeProperty(property)
  })

  if (settings.customColors) {
    root.style.setProperty('--sidebar', 'color-mix(in srgb, var(--bg) 94%, var(--text))')
    root.style.setProperty('--surface', 'color-mix(in srgb, var(--bg) 97%, var(--text))')
    root.style.setProperty('--surface-raised', 'color-mix(in srgb, var(--bg) 94%, white)')
    root.style.setProperty('--surface-hover', 'color-mix(in srgb, var(--bg) 92%, var(--text))')
    root.style.setProperty('--surface-active', 'color-mix(in srgb, var(--bg) 86%, var(--text))')
    root.style.setProperty('--accent-soft', 'color-mix(in srgb, var(--accent) 16%, var(--bg))')
    root.style.setProperty('--accent-strong', 'color-mix(in srgb, var(--accent) 78%, var(--text))')
    root.style.removeProperty('--selection')
  } else {
    [
      '--sidebar',
      '--surface',
      '--surface-raised',
      '--surface-hover',
      '--surface-active',
      '--accent-soft',
      '--accent-strong',
      '--selection',
    ].forEach((property) => root.style.removeProperty(property))
  }
}
