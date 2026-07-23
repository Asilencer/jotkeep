import {
  Add,
  ArrowLeft5,
  CheckCircle,
  ChevronRight,
  CircleInfo,
  CodeCircle,
  Download,
  Edit,
  Export,
  Folder,
  FolderOpen,
  Link,
  Minus,
  Palette,
  Refresh,
  Setting2,
  Shield,
  SidebarLeft,
  Trash,
  type IconComponent,
} from 'reicon-react'
import { useEffect, useState, type ReactNode } from 'react'
import { BrandMark, type BrandName } from './BrandMark'
import { getCurrentLocale, translate as t, useI18n } from './i18n'
import {
  applyAppearance,
  defaultSettings,
  loadSettings,
  saveSettings,
  settingsPaneStorageKey,
  type AppSettings,
  type SettingsPane,
} from './settings'
import FloatingSelect from './FloatingSelect'
import './settings.css'

type SettingsCategory = {
  id: SettingsPane
  label: string
  icon: IconComponent
}

const settingsCategories: SettingsCategory[] = [
  { id: 'general', label: '常规', icon: Setting2 },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'editor', label: '编辑器', icon: Edit },
  { id: 'files', label: '文件与备份', icon: Folder },
  { id: 'accounts', label: '账号与发布', icon: Link },
  { id: 'advanced', label: '高级', icon: CodeCircle },
]

function loadActivePane(): SettingsPane {
  const saved = window.localStorage.getItem(settingsPaneStorageKey) as SettingsPane | null
  return settingsCategories.some((category) => category.id === saved) ? saved! : 'general'
}

export default function SettingsApp() {
  useI18n()
  const [activePane, setActivePane] = useState(loadActivePane)
  const [settings, setSettings] = useState(loadSettings)
  const [notice, setNotice] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showDescriptions, setShowDescriptions] = useState(false)
  const activeCategory = settingsCategories.find((category) => category.id === activePane)!

  useEffect(() => {
    saveSettings(settings)
    applyAppearance(settings)
  }, [settings])

  useEffect(() => {
    if (!window.noteDown) return
    void window.noteDown
      .configureBackup({
        enabled: settings.backupEnabled,
        libraryPath: settings.libraryPath,
        attachmentsPath: settings.attachmentsPath,
        frequency: settings.backupFrequency,
        retention: settings.backupRetention,
      })
      .catch(() => setNotice('自动备份配置失败。'))
  }, [
    settings.backupEnabled,
    settings.backupFrequency,
    settings.backupRetention,
    settings.attachmentsPath,
    settings.libraryPath,
  ])

  useEffect(() => {
    if (!window.noteDown) return
    void window.noteDown
      .configureTaskNotifications({ enabled: settings.taskNotifications })
      .then(({ supported }) => {
        if (!supported && settings.taskNotifications) setNotice('当前系统不支持本地通知。')
      })
      .catch(() => setNotice('任务提醒配置失败。'))
  }, [settings.taskNotifications])

  useEffect(() => {
    window.localStorage.setItem(settingsPaneStorageKey, activePane)
  }, [activePane])

  useEffect(() => {
    window.noteDown?.setTrafficLightsVisible(!sidebarCollapsed)
  }, [sidebarCollapsed])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const updateSetting = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const chooseLibraryDirectory = async () => {
    if (!window.noteDown?.chooseDirectory) {
      setNotice('请在桌面应用中选择本地资料库。')
      return
    }
    const path = await window.noteDown.chooseDirectory()
    if (path) updateSetting('libraryPath', path)
  }

  const resetSettings = () => {
    setSettings({ ...defaultSettings })
    setNotice('界面与编辑偏好已恢复默认值。')
  }

  const returnToWorkspace = () => {
    window.location.hash = ''
  }

  return (
    <div
      className={[
        'settings-shell',
        sidebarCollapsed && 'sidebar-collapsed',
        showDescriptions && 'show-descriptions',
      ].filter(Boolean).join(' ')}
    >
      <aside className="settings-sidebar" aria-label={t('设置分类')}>
        <div className="settings-titlebar">
          <button
            className="settings-titlebar-button"
            type="button"
            aria-label={t(sidebarCollapsed ? '展开侧栏' : '收起侧栏')}
            title={t(sidebarCollapsed ? '展开侧栏' : '收起侧栏')}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            <SidebarLeft size={17} strokeWidth={2} />
          </button>
        </div>
        <div className="settings-brand">
          <button
            className="settings-brand-back"
            type="button"
            aria-label={t('返回工作区')}
            title={t('返回工作区')}
            onClick={returnToWorkspace}
          >
            <ArrowLeft5 size={17} strokeWidth={1.8} />
          </button>
          <span className="settings-brand-lockup" role="img" aria-label="Jotkeep">
            <span className="settings-brand-mark" aria-hidden />
            <span className="settings-brand-name" aria-hidden>Jotkeep</span>
          </span>
        </div>
        <nav className="settings-navigation">
          {settingsCategories.map(({ id, label, icon: CategoryIcon }) => (
            <button
              className={`settings-nav-item${activePane === id ? ' is-active' : ''}`}
              type="button"
              key={id}
              aria-current={activePane === id ? 'page' : undefined}
              onClick={() => setActivePane(id)}
            >
              <CategoryIcon size={16} strokeWidth={1.9} />
              <span>{t(label)}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="settings-main">
        <header className="settings-pane-header">
          <span
            className="settings-heading-icon"
            role="img"
            aria-label={t(activeCategory.label)}
            title={t(activeCategory.label)}
          >
            <activeCategory.icon size={17} aria-hidden />
          </span>
          <button
            className={`settings-description-toggle${showDescriptions ? ' is-active' : ''}`}
            type="button"
            aria-label={t(showDescriptions ? '收起说明' : '显示说明')}
            title={t(showDescriptions ? '收起说明' : '显示说明')}
            aria-pressed={showDescriptions}
            onClick={() => setShowDescriptions((visible) => !visible)}
          >
            <CircleInfo size={16} strokeWidth={2} />
          </button>
        </header>
        <div className="settings-scroll">
          <div className="settings-content" key={activePane}>
            <SettingsPaneContent
              pane={activePane}
              settings={settings}
              updateSetting={updateSetting}
              chooseLibraryDirectory={chooseLibraryDirectory}
              resetSettings={resetSettings}
              showNotice={setNotice}
            />
          </div>
        </div>
      </main>

      {notice && (
        <div className="settings-toast" role="status">
          <CheckCircle size={15} />
          {t(notice)}
        </div>
      )}
    </div>
  )
}

type SettingsPaneContentProps = {
  pane: SettingsPane
  settings: AppSettings
  updateSetting: <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) => void
  chooseLibraryDirectory: () => void
  resetSettings: () => void
  showNotice: (message: string) => void
}

function SettingsPaneContent(props: SettingsPaneContentProps) {
  switch (props.pane) {
    case 'general':
      return <GeneralSettings {...props} />
    case 'appearance':
      return <AppearanceSettings {...props} />
    case 'editor':
      return <EditorSettings {...props} />
    case 'files':
      return <FileSettings {...props} />
    case 'accounts':
      return <AccountSettings {...props} />
    case 'advanced':
      return <AdvancedSettings {...props} />
  }
}

function GeneralSettings({ settings, updateSetting }: SettingsPaneContentProps) {
  const replayOnboarding = () => {
    window.location.hash = '#onboarding'
  }

  return (
    <>
      <SettingsSection title="语言">
        <SettingsGroup>
          <SettingsRow title="应用语言">
            <SettingsSegmented
              label="应用语言"
              value={settings.language}
              options={[
                ['system', '跟随系统'],
                ['zh-CN', '简体中文'],
                ['en-US', '英文'],
              ]}
              onChange={(value) => {
                updateSetting('language', value as AppSettings['language'])
              }}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="创作">
        <SettingsGroup>
          <SettingsRow title="新建文档" description="从通用新建入口创建的默认类型。">
            <SettingsSegmented
              label="新建文档"
              value={settings.defaultDocumentKind}
              options={[
                ['notes', '笔记'],
                ['articles', '文章'],
              ]}
              onChange={(value) => {
                updateSetting('defaultDocumentKind', value as AppSettings['defaultDocumentKind'])
              }}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="行为">
        <SettingsGroup>
          <SettingsRow title="删除前确认">
            <SettingsSwitch
              label="删除前确认"
              checked={settings.confirmDelete}
              onChange={(checked) => updateSetting('confirmDelete', checked)}
            />
          </SettingsRow>
          <SettingsRow title="任务到时提醒" description="仅提醒包含具体时间的待办任务。">
            <SettingsSwitch
              label="任务到时提醒"
              checked={settings.taskNotifications}
              onChange={(checked) => updateSetting('taskNotifications', checked)}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="引导">
        <SettingsGroup>
          <SettingsRow
            title="欢迎动画与首次配置"
            description="重新播放品牌引导，并可再次检查语言、本地存储与个人资料。"
            leading={<Refresh size={17} />}
          >
            <SettingsAction label="播放" onClick={replayOnboarding} />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="快捷键">
        <SettingsGroup>
          <SettingsRow title="搜索与前往">
            <SettingsShortcut keys={['⌘', 'K']} />
          </SettingsRow>
          <SettingsRow title="打开设置">
            <SettingsShortcut keys={['⌘', ',']} />
          </SettingsRow>
          <SettingsRow title="关闭窗口">
            <SettingsShortcut keys={['⌘', 'W']} />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}

function AppearanceSettings({ settings, updateSetting }: SettingsPaneContentProps) {
  return (
    <>
      <SettingsSection title="主题">
        <SettingsGroup>
          <SettingsRow title="模式" description="系统模式会随 macOS 自动切换。">
            <SettingsSegmented
              label="模式"
              value={settings.theme}
              options={[
                ['system', '系统'],
                ['light', '浅色'],
                ['dark', '深色'],
              ]}
              onChange={(value) => updateSetting('theme', value as AppSettings['theme'])}
            />
          </SettingsRow>
          <SettingsRow
            title="侧边栏透明度"
            description="数值越高，背景越透明；文字和图标不受影响。"
          >
            <SettingsRange
              label="侧边栏透明度"
              value={settings.sidebarTransparency}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) => updateSetting('sidebarTransparency', value)}
            />
          </SettingsRow>
          <SettingsRow title="自定义颜色" description="关闭后使用内置浅色与深色配色。">
            <SettingsSwitch
              label="自定义颜色"
              checked={settings.customColors}
              onChange={(checked) => updateSetting('customColors', checked)}
            />
          </SettingsRow>
          <SettingsRow title="强调色">
            <SettingsColorField
              label="强调色"
              value={settings.accentColor}
              disabled={!settings.customColors}
              onChange={(value) => updateSetting('accentColor', value)}
            />
          </SettingsRow>
          <SettingsRow title="背景色">
            <SettingsColorField
              label="背景色"
              value={settings.backgroundColor}
              disabled={!settings.customColors}
              onChange={(value) => updateSetting('backgroundColor', value)}
            />
          </SettingsRow>
          <SettingsRow title="前景色">
            <SettingsColorField
              label="前景色"
              value={settings.foregroundColor}
              disabled={!settings.customColors}
              onChange={(value) => updateSetting('foregroundColor', value)}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="字体">
        <SettingsGroup>
          <SettingsRow title="界面字体">
            <SettingsTextInput
              label="界面字体"
              value={settings.uiFont}
              onChange={(value) => updateSetting('uiFont', value)}
            />
          </SettingsRow>
          <SettingsRow title="正文字体">
            <SettingsTextInput
              label="正文字体"
              value={settings.writingFont}
              onChange={(value) => updateSetting('writingFont', value)}
            />
          </SettingsRow>
          <SettingsRow title="代码字体">
            <SettingsTextInput
              label="代码字体"
              value={settings.codeFont}
              onChange={(value) => updateSetting('codeFont', value)}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="排版">
        <SettingsGroup>
          <SettingsRow title="界面字号">
            <SettingsNumberInput
              label="界面字号"
              value={settings.uiFontSize}
              min={11}
              max={20}
              suffix="px"
              onChange={(value) => updateSetting('uiFontSize', value)}
            />
          </SettingsRow>
          <SettingsRow title="正文字号">
            <SettingsNumberInput
              label="正文字号"
              value={settings.fontSize}
              min={12}
              max={28}
              suffix="px"
              onChange={(value) => updateSetting('fontSize', value)}
            />
          </SettingsRow>
          <SettingsRow title="代码字号">
            <SettingsNumberInput
              label="代码字号"
              value={settings.codeFontSize}
              min={10}
              max={24}
              suffix="px"
              onChange={(value) => updateSetting('codeFontSize', value)}
            />
          </SettingsRow>
          <SettingsRow title="行高">
            <SettingsNumberInput
              label="行高"
              value={settings.lineHeight}
              min={1.2}
              max={2.4}
              step={0.1}
              onChange={(value) => updateSetting('lineHeight', value)}
            />
          </SettingsRow>
          <SettingsRow title="对比度">
            <SettingsRange
              label="对比度"
              value={settings.contrast}
              min={0}
              max={100}
              onChange={(value) => updateSetting('contrast', value)}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="动效与显示">
        <SettingsGroup>
          <SettingsRow title="减少动态效果">
            <SettingsSegmented
              label="减少动态效果"
              value={settings.reduceMotion}
              options={[
                ['system', '系统'],
                ['on', '开启'],
                ['off', '关闭'],
              ]}
              onChange={(value) => {
                updateSetting('reduceMotion', value as AppSettings['reduceMotion'])
              }}
            />
          </SettingsRow>
          <SettingsRow title="字体平滑" description="使用 macOS 原生抗锯齿。">
            <SettingsSwitch
              label="字体平滑"
              checked={settings.fontSmoothing}
              onChange={(checked) => updateSetting('fontSmoothing', checked)}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}

function EditorSettings({ settings, updateSetting }: SettingsPaneContentProps) {
  return (
    <>
      <SettingsSection title="Markdown">
        <SettingsGroup>
          <SettingsRow title="默认编辑模式">
            <SettingsSegmented
              label="默认编辑模式"
              value={settings.editorMode}
              options={[
                ['preview', '实时预览'],
                ['source', '源码'],
              ]}
              onChange={(value) => updateSetting('editorMode', value as AppSettings['editorMode'])}
            />
          </SettingsRow>
          <SettingsRow title="系统拼写检查">
            <SettingsSwitch
              label="系统拼写检查"
              checked={settings.spellcheck}
              onChange={(checked) => updateSetting('spellcheck', checked)}
            />
          </SettingsRow>
          <SettingsRow title="粘贴富文本" description="从网页或文档粘贴时如何处理格式。">
            <SettingsSelect
              label="粘贴富文本"
              value={settings.pasteMode}
              options={[
                ['markdown', '转换为 Markdown'],
                ['plain', '仅保留文本'],
              ]}
              onChange={(value) => updateSetting('pasteMode', value as AppSettings['pasteMode'])}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsFootnote>自动保存始终开启，Markdown 文件仍是内容真源。</SettingsFootnote>
    </>
  )
}

function FileSettings({
  settings,
  updateSetting,
  chooseLibraryDirectory,
  showNotice,
}: SettingsPaneContentProps) {
  const [backups, setBackups] = useState<NoteDownBackupSummary[] | null>(null)
  const [selectedBackupId, setSelectedBackupId] = useState('')
  const [confirmingRestore, setConfirmingRestore] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)

  const loadBackups = async () => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中查看备份。')
      return
    }
    setBackupBusy(true)
    try {
      const stored = await window.noteDown.listBackups({ libraryPath: settings.libraryPath })
      setBackups(stored)
      setSelectedBackupId((current) =>
        stored.some((backup) => backup.id === current && backup.valid)
          ? current
          : stored.find((backup) => backup.valid)?.id ?? '',
      )
      setConfirmingRestore(false)
    } catch {
      showNotice('无法读取备份。')
    } finally {
      setBackupBusy(false)
    }
  }

  const runBackup = async () => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中创建备份。')
      return
    }
    setBackupBusy(true)
    try {
      await window.noteDown.runBackup({
        libraryPath: settings.libraryPath,
        attachmentsPath: settings.attachmentsPath,
        retention: settings.backupRetention,
      })
      showNotice('本地备份已完成。')
      if (backups) await loadBackups()
    } catch {
      showNotice('备份失败，请检查资料库权限。')
    } finally {
      setBackupBusy(false)
    }
  }

  const restoreSelectedBackup = async () => {
    if (!window.noteDown || !selectedBackupId) return
    setBackupBusy(true)
    try {
      await window.noteDown.restoreBackup({
        libraryPath: settings.libraryPath,
        attachmentsPath: settings.attachmentsPath,
        backupId: selectedBackupId,
      })
      showNotice('资料库已恢复，正在重新载入。')
      window.setTimeout(() => {
        window.location.hash = ''
        window.location.reload()
      }, 700)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '恢复失败，当前资料库未被替换。')
      setBackupBusy(false)
      setConfirmingRestore(false)
    }
  }

  const openBackups = () => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中打开备份目录。')
      return
    }
    void window.noteDown
      .openBackupDirectory({ libraryPath: settings.libraryPath })
      .catch(() => showNotice('无法打开备份目录。'))
  }

  const exportLibrary = () => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中导出资料库。')
      return
    }
    void window.noteDown
      .exportLibrary({
        libraryPath: settings.libraryPath,
        attachmentsPath: settings.attachmentsPath,
      })
      .then((target) => {
        if (target) showNotice('资料库已完整导出。')
      })
      .catch(() => showNotice('导出失败，请更换目标位置。'))
  }

  const importDocuments = (kind: 'notes' | 'articles') => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中导入 Markdown。')
      return
    }
    void window.noteDown
      .importDocuments({ libraryPath: settings.libraryPath, kind })
      .then((documents) => {
        if (documents.length > 0) {
          showNotice(t('已导入 {count} 篇文档。', { count: documents.length }))
        }
      })
      .catch(() => showNotice('导入失败，请检查文件权限。'))
  }

  return (
    <>
      <SettingsSection title="本地资料库">
        <SettingsGroup>
          <SettingsRow title="资料库位置" description="笔记、文章与项目的本地目录。">
            <SettingsPath value={settings.libraryPath} label="选择资料库" onClick={chooseLibraryDirectory} />
          </SettingsRow>
          <SettingsRow
            title="添加附件"
            description="引用模式不复制原文件；文件移动后需要重新选择。"
          >
            <SettingsSegmented
              label="添加附件"
              value={settings.attachmentMode}
              options={[
                ['copy', '复制到资料库'],
                ['reference', '引用原文件'],
              ]}
              onChange={(value) => {
                updateSetting('attachmentMode', value as AppSettings['attachmentMode'])
              }}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="自动备份">
        <SettingsGroup>
          <SettingsRow title="启用本地备份" description="备份不替代原始 Markdown 文件。">
            <SettingsSwitch
              label="启用本地备份"
              checked={settings.backupEnabled}
              onChange={(checked) => updateSetting('backupEnabled', checked)}
            />
          </SettingsRow>
          <SettingsRow title="备份频率" disabled={!settings.backupEnabled}>
            <SettingsSelect
              label="备份频率"
              value={settings.backupFrequency}
              disabled={!settings.backupEnabled}
              options={[
                ['daily', '每天'],
                ['weekly', '每周'],
              ]}
              onChange={(value) => updateSetting('backupFrequency', value as AppSettings['backupFrequency'])}
            />
          </SettingsRow>
          <SettingsRow title="保留备份" disabled={!settings.backupEnabled}>
            <SettingsStepper
              label="保留备份"
              value={settings.backupRetention}
              min={3}
              max={60}
              suffix={t('份')}
              disabled={!settings.backupEnabled}
              onChange={(value) => updateSetting('backupRetention', value)}
            />
          </SettingsRow>
          <SettingsRow title="立即备份" leading={<Refresh size={17} />}>
            <SettingsAction label="创建" disabled={backupBusy} onClick={() => void runBackup()} />
          </SettingsRow>
          <SettingsRow title="恢复备份" leading={<Download size={17} />}>
            <SettingsAction
              label={backups ? '收起' : '查看'}
              disabled={backupBusy}
              onClick={() => {
                if (backups) {
                  setBackups(null)
                  setConfirmingRestore(false)
                } else {
                  void loadBackups()
                }
              }}
            />
          </SettingsRow>
          <SettingsRow title="备份位置" leading={<FolderOpen size={17} />}>
            <SettingsAction label="打开" onClick={openBackups} />
          </SettingsRow>
        </SettingsGroup>
        {backups && (
          <BackupRestorePanel
            backups={backups}
            selectedId={selectedBackupId}
            confirming={confirmingRestore}
            busy={backupBusy}
            onSelect={(id) => {
              setSelectedBackupId(id)
              setConfirmingRestore(false)
            }}
            onCancel={() => setConfirmingRestore(false)}
            onRestore={() => {
              if (confirmingRestore) void restoreSelectedBackup()
              else setConfirmingRestore(true)
            }}
          />
        )}
      </SettingsSection>

      <SettingsSection title="导入与导出">
        <SettingsGroup>
          <SettingsRow
            title="导入 Markdown"
            description="保留原文件；同名文档会生成安全副本。"
            leading={<Download size={17} />}
          >
            <div className="settings-inline-control">
              <SettingsAction label="笔记" onClick={() => importDocuments('notes')} />
              <SettingsAction label="文章" onClick={() => importDocuments('articles')} />
            </div>
          </SettingsRow>
          <SettingsRow
            title="完整导出"
            description="复制附件会导出；外部引用仅保留索引。"
            leading={<Download size={17} />}
          >
            <SettingsAction
              label="导出"
              onClick={exportLibrary}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}

const formatBackupDate = (date: Date) =>
  new Intl.DateTimeFormat(getCurrentLocale(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)

const formatBackupSize = (bytes: number) => {
  if (bytes === 0) return '0 KB'
  const divisor = bytes >= 1024 * 1024 ? 1024 * 1024 : 1024
  const unit = bytes >= 1024 * 1024 ? 'MB' : 'KB'
  return `${Math.max(bytes / divisor, 0.1).toFixed(1)} ${unit}`
}

function BackupRestorePanel({
  backups,
  selectedId,
  confirming,
  busy,
  onSelect,
  onCancel,
  onRestore,
}: {
  backups: NoteDownBackupSummary[]
  selectedId: string
  confirming: boolean
  busy: boolean
  onSelect: (id: string) => void
  onCancel: () => void
  onRestore: () => void
}) {
  const selected = backups.find((backup) => backup.id === selectedId && backup.valid)
  return (
    <div className="settings-backup-panel" aria-label={t('恢复备份')}>
      {backups.length === 0 ? (
        <div className="settings-backup-empty">{t('还没有本地备份')}</div>
      ) : (
        <div className="settings-backup-list" role="listbox" aria-label={t('本地备份')}>
          {backups.map((backup) => (
            <button
              className={`settings-backup-item${selectedId === backup.id ? ' is-active' : ''}`}
              type="button"
              role="option"
              aria-selected={selectedId === backup.id}
              disabled={!backup.valid || busy}
              key={backup.id}
              onClick={() => onSelect(backup.id)}
            >
              <strong>
                {backup.valid && backup.createdAt
                  ? `${formatBackupDate(new Date(backup.createdAt))}${
                      backup.id.endsWith(' 恢复前') ? ` · ${t('恢复前')}` : ''
                    }`
                  : t('备份不可用')}
              </strong>
              <small>
                {backup.valid
                  ? t('{documents} 篇 · {files} 个文件 · {size}', {
                      documents: backup.documents,
                      files: backup.files,
                      size: formatBackupSize(backup.bytes),
                    })
                  : t('内容校验失败')}
              </small>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className={`settings-restore-confirmation${confirming ? ' is-confirming' : ''}`}>
          {confirming && <p>{t('恢复前会先备份当前资料库，再替换应用管理的内容。')}</p>}
          <div>
            {confirming && (
              <button type="button" disabled={busy} onClick={onCancel}>
                {t('取消')}
              </button>
            )}
            <button className="is-primary" type="button" disabled={busy} onClick={onRestore}>
              {t(busy ? '处理中' : confirming ? '确认恢复' : '恢复所选备份')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AccountSettings({ showNotice }: SettingsPaneContentProps) {
  return (
    <>
      <SettingsSection title="发布平台">
        <SettingsGroup>
          <AccountRow
            brand="x"
            label="X"
            description="在发布界面中确认后发送"
            status="可用"
            onClick={() => showNotice('发布草稿会在 X Web Intent 中打开，无需保存账号凭据。')}
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsFootnote icon={Shield}>
        X Web Intent 不读取账号凭据，最终发送由你在 X 中确认。
      </SettingsFootnote>
    </>
  )
}

function AdvancedSettings({ settings, resetSettings, showNotice }: SettingsPaneContentProps) {
  const openConfigDirectory = () => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中打开配置目录。')
      return
    }
    void window.noteDown.openConfigDirectory().catch(() => showNotice('无法打开配置目录。'))
  }

  const exportSettings = () => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中导出配置。')
      return
    }
    void window.noteDown
      .exportSettings({ settings })
      .then((target) => {
        if (target) showNotice('配置已导出。')
      })
      .catch(() => showNotice('配置导出失败。'))
  }

  const rebuildSearchIndex = () => {
    if (!window.noteDown) {
      showNotice('请在桌面应用中重建索引。')
      return
    }
    void window.noteDown
      .rebuildSearchIndex({ libraryPath: settings.libraryPath })
      .then(({ count }) => showNotice(t('已索引 {count} 篇文档。', { count })))
      .catch(() => showNotice('索引重建失败。'))
  }

  return (
    <>
      <SettingsSection title="诊断">
        <SettingsGroup>
          <SettingsRow
            title="配置目录"
            description="查看本机配置与诊断文件。"
            leading={<FolderOpen size={17} />}
          >
            <SettingsAction
              label="打开"
              onClick={openConfigDirectory}
            />
          </SettingsRow>
          <SettingsRow
            title="导出配置"
            description="仅导出应用偏好，不包含笔记内容。"
            leading={<Export size={17} />}
          >
            <SettingsAction label="导出" onClick={exportSettings} />
          </SettingsRow>
          <SettingsRow
            title="重建搜索索引"
            description="不会修改任何 Markdown 文件。"
            leading={<Refresh size={17} />}
          >
            <SettingsAction label="重建" onClick={rebuildSearchIndex} />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="重置">
        <SettingsGroup>
          <SettingsRow
            title="恢复默认设置"
            description="保留本地资料库、附件与个人资料。"
            leading={<Trash size={17} />}
          >
            <SettingsAction label="重置" tone="danger" onClick={resetSettings} />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsFootnote>设置页不提供删除本地 Markdown 内容的入口。</SettingsFootnote>
    </>
  )
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{t(title)}</h2>
      {children}
    </section>
  )
}

function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group">{children}</div>
}

function SettingsRow({
  title,
  description,
  leading,
  disabled,
  children,
}: {
  title: string
  description?: string
  leading?: ReactNode
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className={`settings-row${disabled ? ' is-disabled' : ''}`}>
      <div className="settings-row-copy">
        {leading && <span className="settings-row-icon">{leading}</span>}
        <span>
          <strong>{t(title)}</strong>
          {description && <small>{t(description)}</small>}
        </span>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function SettingsSwitch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="settings-switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={t(label)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden />
    </label>
  )
}

function SettingsSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <FloatingSelect
      className="settings-select"
      value={value}
      label={t(label)}
      disabled={disabled}
      options={options.map(([optionValue, optionLabel]) => ({
        value: optionValue,
        label: t(optionLabel),
      }))}
      onChange={onChange}
    />
  )
}

function SettingsSegmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  return (
    <div className="settings-segmented" role="group" aria-label={t(label)}>
      {options.map(([optionValue, optionLabel]) => (
        <button
          className={value === optionValue ? 'is-active' : ''}
          type="button"
          key={optionValue}
          aria-pressed={value === optionValue}
          onClick={() => onChange(optionValue)}
        >
          {t(optionLabel)}
        </button>
      ))}
    </div>
  )
}

function SettingsTextInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <input
      className="settings-text-input"
      type="text"
      value={value}
      aria-label={t(label)}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function SettingsColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const colorValue = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
  return (
    <div className="settings-color-field">
      <label className="settings-color-picker">
        <span
          className="settings-color-swatch"
          style={{ backgroundColor: colorValue }}
          aria-hidden="true"
        />
        <input
          type="color"
          value={colorValue}
          disabled={disabled}
          aria-label={`${t(label)} color picker`}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </label>
      <input
        type="text"
        value={value}
        maxLength={7}
        disabled={disabled}
        aria-label={`${t(label)} value`}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
    </div>
  )
}

function SettingsNumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const next = Math.min(max, Math.max(min, parsed))
    setDraft(String(next))
    onChange(next)
  }

  return (
    <label className="settings-number-input">
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-label={t(label)}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  )
}

function SettingsRange({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="settings-range">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        aria-label={t(label)}
        aria-valuetext={suffix ? `${value}${suffix}` : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value}{suffix}</output>
    </div>
  )
}

function SettingsShortcut({ keys }: { keys: string[] }) {
  return (
    <span className="settings-shortcut" aria-label={keys.join(' ')}>
      {keys.map((key) => <kbd key={key}>{key}</kbd>)}
    </span>
  )
}

function SettingsStepper({
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="settings-stepper" aria-label={t(label)}>
      <button
        type="button"
        aria-label={`${t('减少')} ${t(label)}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={13} />
      </button>
      <span>{value}{suffix}</span>
      <button
        type="button"
        aria-label={`${t('增加')} ${t(label)}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Add size={13} />
      </button>
    </div>
  )
}

function SettingsAction({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string
  tone?: 'danger'
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`settings-action${tone ? ` is-${tone}` : ''}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span>{t(label)}</span>
      {tone ? <Trash size={13} /> : <ChevronRight size={13} />}
    </button>
  )
}

function SettingsPath({ value, label, onClick }: { value: string; label: string; onClick: () => void }) {
  return (
    <div className="settings-path">
      <span title={value}>{value}</span>
      <button type="button" aria-label={t(label)} title={t(label)} onClick={onClick}>
        <FolderOpen size={15} />
      </button>
    </div>
  )
}

function AccountRow({
  icon: Icon,
  brand,
  label,
  description,
  status,
  onClick,
}: {
  icon?: IconComponent
  brand?: BrandName
  label: string
  description: string
  status?: string
  onClick: () => void
}) {
  return (
    <button
      className="settings-list-row"
      type="button"
      aria-label={t(label)}
      title={t(label)}
      onClick={onClick}
    >
      <span className="settings-list-icon">
        {brand ? <BrandMark name={brand} size={20} /> : Icon ? <Icon size={20} /> : null}
      </span>
      <span className="settings-list-copy">
        <strong>{t(description)}</strong>
      </span>
      {status && <span className="settings-status">{t(status)}</span>}
      <ChevronRight size={14} />
    </button>
  )
}

function SettingsFootnote({
  icon: Icon,
  children,
}: {
  icon?: IconComponent
  children: ReactNode
}) {
  return (
    <p className="settings-footnote">
      {Icon && <Icon size={13} />}
      <span>{typeof children === 'string' ? t(children) : children}</span>
    </p>
  )
}
