import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  ArchiveBox,
  ArrowLeft5,
  Bookmark,
  Calendar,
  Check,
  CheckCircle,
  Checklist,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloseCircle,
  CloudRemove,
  Copy,
  DocumentText,
  Download,
  Edit,
  Folder,
  FolderOpen,
  Globe,
  History,
  Link,
  Notes,
  Pen,
  Refresh,
  Search,
  Send,
  Setting2,
  SidebarLeft,
  Sliders,
  Task,
  Tag,
  Trash,
  UserCircle,
  UserEdit,
  type IconComponent,
} from 'reicon-react'
import { BrandMark, type BrandName } from './BrandMark'
import { updateDocumentTaskBlock } from './documentTasks'
import FloatingSelect from './FloatingSelect'
import { getCurrentLocale, translate as t, useI18n } from './i18n'
import type {
  DocumentTaskSnapshot,
  PublishParagraphPayload,
} from './MarkdownDocumentEditor'
import ScrollPage from './ScrollPage'
import WeatherAtmosphere, { type WeatherSceneKind } from './WeatherAtmosphere'
import jotkeepMark from '../assets/brand/jotkeep-mark.svg'
import zodiacDog from './assets/zodiac/dog.png'
import zodiacDragon from './assets/zodiac/dragon.png'
import zodiacGoat from './assets/zodiac/goat.png'
import zodiacHorse from './assets/zodiac/horse.png'
import zodiacMonkey from './assets/zodiac/monkey.png'
import zodiacOx from './assets/zodiac/ox.png'
import zodiacPig from './assets/zodiac/pig.png'
import zodiacRabbit from './assets/zodiac/rabbit.png'
import zodiacRat from './assets/zodiac/rat.png'
import zodiacRooster from './assets/zodiac/rooster.png'
import zodiacSnake from './assets/zodiac/snake.png'
import zodiacTiger from './assets/zodiac/tiger.png'
import {
  articles,
  clips,
  notes,
  projects,
  tasks,
  type Clip,
  type DocumentKind,
  type LibraryKind,
  type Project,
  type PublishDraft,
  type PublishDraftStatus,
  type PublishSourceKind,
  type PublishTarget,
  type Route,
  type TaskItem,
} from './model'
import { loadSettings } from './settings'

const MarkdownDocumentEditor = lazy(() => import('./MarkdownDocumentEditor'))

const libraryLabels: Record<LibraryKind, string> = {
  notes: '笔记',
  articles: '文章',
  clips: '收藏',
  tasks: '任务',
}

const libraryIcons: Record<LibraryKind, IconComponent> = {
  notes: Notes,
  articles: DocumentText,
  clips: Bookmark,
  tasks: Checklist,
}

const libraryCreateIcons: Record<LibraryKind, IconComponent> = {
  notes: Edit,
  articles: Pen,
  clips: Link,
  tasks: Task,
}

const libraryCreateLabels: Record<LibraryKind, string> = {
  notes: '新建笔记',
  articles: '新建文章',
  clips: '新建收藏',
  tasks: '新建任务',
}

const documentKindLabels: Record<DocumentKind, string> = {
  notes: '笔记',
  articles: '文章',
  clips: '收藏',
}

const publishSourceLabels: Record<PublishSourceKind, string> = {
  daily: 'Today',
  notes: '笔记',
  articles: '文章',
}

const publishSourceIcons: Record<PublishSourceKind, IconComponent> = {
  daily: Calendar,
  notes: Notes,
  articles: DocumentText,
}

const publishSourceRoute = (sourceKind: PublishSourceKind, sourceId: string): Route =>
  sourceKind === 'daily'
    ? { page: 'today' }
    : { page: 'library', kind: sourceKind, itemId: sourceId }

const publishStatusLabels: Record<PublishDraftStatus, string> = {
  Preparing: '待处理',
  Queued: '队列',
  Published: '已发布',
  Failed: '失败',
}

const publishStatusIcons: Record<PublishDraftStatus, IconComponent> = {
  Preparing: Pen,
  Queued: Clock,
  Published: CheckCircle,
  Failed: CloseCircle,
}

const publishTargetLabels: Record<PublishTarget, string> = {
  x: 'X',
}

const publishStatusOrder: PublishDraftStatus[] = ['Preparing', 'Queued', 'Published', 'Failed']

const publishBody = (markdown: string) =>
  markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()

const xPublishText = (markdown: string) => publishBody(markdown)
  .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[(?:bookmark|button):([^\]]*)\]\(([^)]+)\)/gi, '$1 $2')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
  .replace(/^\s*:::[^\n]*$/gm, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^\s*(?:#{1,9}|>|[-+*]\s+\[[ xX]\]|[-+*]|\d+\.)\s*/gm, '')
  .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, '')
  .replace(/\s*\|\s*/g, ' · ')
  .replace(/[*_~`$]/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n[ \t]+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const publishOutput = (draft: PublishDraft, target: PublishTarget) => {
  const content = target === 'x' ? xPublishText(draft.sourceSnapshot) : ''
  return {
    content,
    count: Array.from(content).length,
    format: '纯文本',
  }
}

type DocumentSummary = {
  id: string
  kind: DocumentKind
  title: string
  tags?: string[]
  projectId?: string
  updatedAt: string
  archivedAt?: string
}

type CreatableDocumentKind = DocumentKind

const defaultUserProfile: NoteDownUserProfile = {
  username: 'Jotkeeper',
  links: [],
}

const emptyUserProfile: NoteDownUserProfile = {
  username: '本地用户',
  links: [],
}

const profileStorageKey = 'note-down.profile.v1'
const publishStorageKey = 'note-down.publish.v1'

const loadPreviewProfile = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(profileStorageKey) || 'null')
    return stored?.username ? { ...defaultUserProfile, ...stored } : defaultUserProfile
  } catch {
    return defaultUserProfile
  }
}

const loadStoredProfile = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(profileStorageKey) || 'null')
    return stored?.username ? stored as NoteDownUserProfile : emptyUserProfile
  } catch {
    return emptyUserProfile
  }
}

const loadPreviewPublishDrafts = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(publishStorageKey) || '[]')
    return Array.isArray(stored)
      ? stored.map((draft) => ({ ...draft, targets: ['x'] as PublishTarget[] })) as PublishDraft[]
      : []
  } catch {
    return []
  }
}

const fixtureDocuments: DocumentSummary[] = [
  ...notes.map((note) => ({
    id: note.id,
    kind: 'notes' as const,
    title: note.title,
    projectId: note.projectId,
    updatedAt: note.updatedAt,
  })),
  ...articles.map((article) => ({
    id: article.id,
    kind: 'articles' as const,
    title: article.title,
    projectId: article.projectId,
    updatedAt: article.updatedAt,
  })),
  ...clips.map((clip) => ({
    id: clip.id,
    kind: 'clips' as const,
    title: clip.title,
    projectId: clip.projectId,
    updatedAt: clip.savedAt,
  })),
]

const documentIndexStorageKey = 'note-down.document-index.v1'

const documentKey = (document: Pick<DocumentSummary, 'id' | 'kind'>) =>
  `${document.kind}:${document.id}`

function loadDocumentItems() {
  const saved = window.localStorage.getItem(documentIndexStorageKey)
  if (!saved) return fixtureDocuments
  try {
    const stored = JSON.parse(saved) as DocumentSummary[]
    const validKinds = new Set<DocumentKind>(['notes', 'articles', 'clips'])
    const valid = stored.filter(
      (document) =>
        document &&
        typeof document.id === 'string' &&
        typeof document.title === 'string' &&
        typeof document.updatedAt === 'string' &&
        (document.tags === undefined ||
          (Array.isArray(document.tags) && document.tags.every((tag) => typeof tag === 'string'))) &&
        (document.archivedAt === undefined || typeof document.archivedAt === 'string') &&
        validKinds.has(document.kind),
    )
    const storedKeys = new Set(valid.map(documentKey))
    return [
      ...valid,
      ...fixtureDocuments.filter((document) => !storedKeys.has(documentKey(document))),
    ]
  } catch {
    return fixtureDocuments
  }
}

const formatDocumentTime = (value: string) => {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  const date = new Date(timestamp)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000)
  if (dayDifference === 0) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
    return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : '今天'
  }
  if (dayDifference === 1) return '昨天'
  if (dayDifference > 1 && dayDifference < 7) {
    return `周${'日一二三四五六'[date.getDay()]}`
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

const getProjectName = (projectItems: Project[], projectId?: string) =>
  projectItems.find((project) => project.id === projectId)?.name ?? '未归项目'

const routeKey = (route: Route) => {
  if (route.page === 'library') return `${route.page}:${route.kind}:${route.itemId ?? ''}`
  if (route.page === 'project') {
    return `${route.page}:${route.projectId}:${route.itemKind ?? ''}:${route.itemId ?? ''}`
  }
  return route.page
}

type IconButtonProps = {
  label: string
  children: ReactNode
  className?: string
  active?: boolean
  expanded?: boolean
  disabled?: boolean
  onClick: () => void
}

function IconButton({
  label,
  children,
  className,
  active,
  expanded,
  disabled,
  onClick,
}: IconButtonProps) {
  return (
    <button
      className={`icon-button${className ? ` ${className}` : ''}${active ? ' is-active' : ''}`}
      type="button"
      aria-label={t(label)}
      aria-pressed={active}
      aria-expanded={expanded}
      title={t(label)}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

type SidebarProps = {
  route: Route
  projectItems: Project[]
  userProfile: NoteDownUserProfile
  collapsed: boolean
  onNavigate: (route: Route) => void
  onEditProject: (project: Project) => void
  onToggle: () => void
  onOpenCommand: () => void
  commandDisabled?: boolean
  updateState: NoteDownUpdateState | null
  onDownloadUpdate: () => void
  onOpenSettings: () => void
  onCreateDocument: (kind: CreatableDocumentKind) => void
  onCreateTask: () => void
  onCreateProject: () => void
}

function Sidebar({
  route,
  projectItems,
  userProfile,
  collapsed,
  onNavigate,
  onEditProject,
  onToggle,
  onOpenCommand,
  commandDisabled,
  updateState,
  onDownloadUpdate,
  onOpenSettings,
  onCreateDocument,
  onCreateTask,
  onCreateProject,
}: SidebarProps) {
  const libraryActive = route.page === 'library' ? route.kind : undefined
  const projectActive = route.page === 'project' ? route.projectId : undefined
  const updateVisible = Boolean(
    updateState?.latestVersion
    && ['available', 'downloading', 'ready', 'error'].includes(updateState.status),
  )
  const updateLabel = updateState?.status === 'downloading'
    ? t('正在下载 Jotkeep {version}（{progress}%）', {
        version: updateState.latestVersion ?? '',
        progress: updateState.progress ?? 0,
      })
    : updateState?.status === 'ready'
      ? t('打开 Jotkeep {version} 安装包', { version: updateState.latestVersion ?? '' })
      : t('更新到 Jotkeep {version}', { version: updateState?.latestVersion ?? '' })

  return (
    <aside className="sidebar" aria-label={t('主导航')}>
      <div className="sidebar-titlebar">
        <IconButton label={collapsed ? '展开导航' : '收起导航'} onClick={onToggle}>
          <SidebarLeft size={17} />
        </IconButton>
      </div>

      <div className="sidebar-brand-row">
        <button className="brand" type="button" onClick={() => onNavigate({ page: 'today' })}>
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Jotkeep</span>
        </button>
        <IconButton label="搜索或前往" disabled={commandDisabled} onClick={onOpenCommand}>
          <Search size={16} strokeWidth={1.8} />
        </IconButton>
      </div>

      <nav className="sidebar-scroll">
        <NavItem
          icon={Calendar}
          label="今天"
          active={route.page === 'today'}
          onClick={() => onNavigate({ page: 'today' })}
        />

        <NavSection label="资料库">
          {(Object.keys(libraryLabels) as LibraryKind[]).map((kind) => (
            <NavItem
              key={kind}
              icon={libraryIcons[kind]}
              label={libraryLabels[kind]}
              active={libraryActive === kind}
              onClick={() => onNavigate({ page: 'library', kind })}
              action={{
                icon: libraryCreateIcons[kind],
                label: libraryCreateLabels[kind],
                onClick: () => {
                  if (kind === 'tasks') {
                    onCreateTask()
                    return
                  }
                  onCreateDocument(kind)
                },
              }}
            />
          ))}
        </NavSection>

        <NavSection
          label="项目"
          action={
            <button
              className="section-action"
              type="button"
              aria-label={t('新建项目')}
              title={t('新建项目')}
              onClick={onCreateProject}
            >
              <Folder size={16} strokeWidth={1.8} />
            </button>
          }
        >
          {projectItems.filter((project) => !project.archivedAt).map((project) => (
            <ProjectNavItem
              key={project.id}
              project={project}
              active={projectActive === project.id}
              onClick={() => onNavigate({ page: 'project', projectId: project.id })}
              onEdit={() => onEditProject(project)}
            />
          ))}
        </NavSection>

        <div className="nav-spacer" />
        <NavItem
          icon={ArchiveBox}
          label="归档"
          active={route.page === 'archive'}
          onClick={() => onNavigate({ page: 'archive' })}
        />
        <NavItem
          icon={Send}
          label="发布"
          active={route.page === 'publish'}
          onClick={() => onNavigate({ page: 'publish' })}
        />
      </nav>

      <div className={`profile-footer${updateVisible ? ' has-update' : ''}`}>
        <button
          className={`profile-identity${route.page === 'profile' ? ' is-active' : ''}`}
          type="button"
          aria-label={userProfile.username}
          onClick={() => onNavigate({ page: 'profile' })}
        >
          <span className={`avatar${userProfile.avatarURL ? '' : ' is-default'}`}>
            {userProfile.avatarURL ? (
              <img src={userProfile.avatarURL} alt="" />
            ) : (
              <img className="profile-default-avatar-mark" src={jotkeepMark} alt="" />
            )}
          </span>
          <strong>{userProfile.username}</strong>
        </button>
        {updateVisible && (
          <IconButton
            className={`update-button is-${updateState?.status}`}
            label={updateLabel}
            onClick={onDownloadUpdate}
          >
            <Download size={16} />
          </IconButton>
        )}
        <IconButton label="设置" onClick={onOpenSettings}>
          <Setting2 size={16} />
        </IconButton>
      </div>
    </aside>
  )
}

type NavItemProps = {
  icon: IconComponent
  label: string
  active: boolean
  color?: string
  onClick: () => void
  action?: {
    icon: IconComponent
    label: string
    onClick: () => void
  }
}

function NavItem({ icon: Icon, label, active, color, onClick, action }: NavItemProps) {
  const ActionIcon = action?.icon
  return (
    <div className={`nav-item-row${action ? ' has-action' : ''}`}>
      <button
        className={`nav-item${active ? ' is-active' : ''}`}
        type="button"
        aria-current={active ? 'page' : undefined}
        title={t(label)}
        onClick={onClick}
      >
        {color ? <span className="project-dot" style={{ background: color }} /> : <Icon size={17} />}
        <span>{t(label)}</span>
      </button>
      {action && ActionIcon && (
        <button
          className="nav-item-action"
          type="button"
          aria-label={t(action.label)}
          title={t(action.label)}
          onClick={action.onClick}
        >
          <ActionIcon size={16} strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}

function ProjectNavItem({
  project,
  active,
  onClick,
  onEdit,
}: {
  project: Project
  active: boolean
  onClick: () => void
  onEdit: () => void
}) {
  const ProjectIcon = active ? FolderOpen : Folder

  return (
    <div className="project-nav-row">
      <button
        className={`nav-item${active ? ' is-active' : ''}`}
        type="button"
        aria-current={active ? 'page' : undefined}
        title={project.name}
        onClick={onClick}
      >
        <ProjectIcon size={17} style={{ color: project.color }} />
        <span className="project-nav-name">{project.name}</span>
      </button>
      <div className="project-row-actions">
        <button
          className="project-edit-action"
          type="button"
          aria-label={`${t('编辑项目')}：${project.name}`}
          title={t('编辑项目')}
          onClick={onEdit}
        >
          <Edit size={16} strokeWidth={1.8} />
        </button>
        <span className="project-action-rail" aria-hidden />
      </div>
    </div>
  )
}

function NavSection({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="nav-section">
      <div className="nav-section-heading">
        <span>{t(label)}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

type PageHeaderProps = {
  route: Route
  projectItems: Project[]
  documentItems: DocumentSummary[]
  saveState: DocumentSaveState
  onBack: () => void
  onArchive: () => void
  onPublish: () => void
  onVersions: () => void
}

function PageHeader({
  route,
  projectItems,
  documentItems,
  saveState,
  onBack,
  onArchive,
  onPublish,
  onVersions,
}: PageHeaderProps) {
  const meta = getHeaderMeta(route, projectItems, documentItems)
  const HeadingIcon =
    route.page === 'today'
      ? Calendar
      : route.page === 'archive'
        ? ArchiveBox
      : route.page === 'library' && !route.itemId
        ? libraryIcons[route.kind]
        : route.page === 'project' && !route.itemId
          ? Folder
          : undefined
  const iconOnly =
    route.page === 'today' ||
    route.page === 'archive' ||
    (route.page === 'library' && !route.itemId)
  const archiveable =
    (route.page === 'library' && route.kind !== 'tasks' && Boolean(route.itemId)) ||
    (route.page === 'project' && Boolean(route.itemId) && Boolean(route.itemKind))
  const publishable =
    (route.page === 'library' &&
      (route.kind === 'notes' || route.kind === 'articles') &&
      Boolean(route.itemId)) ||
    (route.page === 'project' &&
      (route.itemKind === 'notes' || route.itemKind === 'articles') &&
      Boolean(route.itemId))
  const versionable = Boolean(routeDocumentId(route))

  return (
    <header className="page-header">
      <div className="page-heading">
        {meta.back && (
          <IconButton label="返回列表" onClick={onBack}>
            <ArrowLeft5 size={17} strokeWidth={1.8} />
          </IconButton>
        )}
        {HeadingIcon && (
          <span
            className="heading-icon"
            role={iconOnly ? 'img' : undefined}
            aria-label={iconOnly ? t(meta.title) : undefined}
            aria-hidden={iconOnly ? undefined : true}
            title={iconOnly ? t(meta.title) : t('项目')}
          >
            <HeadingIcon size={17} aria-hidden />
          </span>
        )}
        {!iconOnly && (
          <div className="heading-copy">
            {meta.eyebrow && <span>{t(meta.eyebrow)}</span>}
            <strong>{t(meta.title)}</strong>
          </div>
        )}
      </div>

      <div className="header-actions">
        {meta.saved && <SaveStatus state={saveState} />}
        {versionable && (
          <IconButton label="历史版本" onClick={onVersions}>
            <History size={16} strokeWidth={1.8} />
          </IconButton>
        )}
        {publishable && (
          <IconButton label="发起发布" onClick={onPublish}>
            <Send size={16} strokeWidth={1.8} />
          </IconButton>
        )}
        {archiveable && (
          <IconButton label="归档文档" onClick={onArchive}>
            <ArchiveBox size={16} strokeWidth={1.8} />
          </IconButton>
        )}
      </div>
    </header>
  )
}

type DocumentSaveState = 'saved' | 'saving' | 'conflict' | 'error'

function SaveStatus({ state }: { state: DocumentSaveState }) {
  const label =
    state === 'saving'
      ? '正在保存'
      : state === 'conflict'
        ? '存在外部修改'
        : state === 'error'
          ? '保存失败'
          : '已保存'
  const SaveIcon =
    state === 'saving'
      ? Clock
      : state === 'conflict'
        ? Refresh
        : state === 'error'
          ? CloseCircle
          : Check
  return (
    <span className={`save-status is-${state}`} aria-label={t(label)} title={t(label)}>
      <SaveIcon size={14} />
    </span>
  )
}

function routeDocumentId(route: Route) {
  if (route.page === 'library' && route.kind !== 'tasks' && route.itemId) {
    return `${route.kind}/${route.itemId}`
  }
  if (route.page === 'project' && route.itemKind && route.itemId) {
    return `${route.itemKind}/${route.itemId}`
  }
  return null
}

function routeFromDocumentId(documentId: string): Route | null {
  const [kind, ...segments] = documentId.split('/')
  const itemId = segments.join('/')
  if (!itemId || (kind !== 'notes' && kind !== 'articles' && kind !== 'clips')) return null
  return { page: 'library', kind, itemId }
}

function getHeaderMeta(
  route: Route,
  projectItems: Project[],
  documentItems: DocumentSummary[],
) {
  if (route.page === 'today') {
    return { title: '今天', saved: true, back: false }
  }
  if (route.page === 'archive') {
    return { title: '归档', back: false }
  }
  if (route.page === 'project') {
    const project = projectItems.find((item) => item.id === route.projectId)
    if (route.itemId && route.itemKind) {
      return {
        title: findItemTitle(route.itemKind, route.itemId, documentItems),
        eyebrow: project?.name ?? '项目',
        saved: true,
        back: true,
      }
    }
    return { title: project?.name ?? '项目', back: false }
  }
  if (route.page === 'publish') {
    return { title: '发布', eyebrow: '创作流程', back: Boolean(route.draftId) }
  }
  if (route.page === 'profile') {
    return { title: '个人空间', back: false }
  }

  const label = libraryLabels[route.kind]
  if (route.itemId) {
    return {
      title: findItemTitle(route.kind, route.itemId, documentItems),
      eyebrow: label,
      saved: true,
      back: true,
    }
  }

  return {
    title: label,
    back: false,
  }
}

function findItemTitle(
  kind: LibraryKind | DocumentKind,
  itemId: string,
  documentItems: DocumentSummary[],
) {
  if (kind !== 'tasks') {
    const summary = documentItems.find((item) => item.kind === kind && item.id === itemId)
    if (summary) return summary.title
  }
  if (kind === 'notes') return notes.find((item) => item.id === itemId)?.title ?? '无标题笔记'
  if (kind === 'articles') return articles.find((item) => item.id === itemId)?.title ?? '无标题文章'
  if (kind === 'clips') return clips.find((item) => item.id === itemId)?.title ?? '收藏'
  return tasks.find((item) => item.id === itemId)?.title ?? '任务'
}

type PageProps = {
  route: Route
  projectItems: Project[]
  documentItems: DocumentSummary[]
  taskItems: TaskItem[]
  publishItems: PublishDraft[]
  userProfile: NoteDownUserProfile
  projectFilters: Record<string, DocumentKind | 'all'>
  onProjectFilterChange: (projectId: string, kind: DocumentKind | 'all') => void
  onNavigate: (route: Route) => void
  onNotice: (message: string) => void
  onRestoreDocument: (document: DocumentSummary) => void
  onTrashDocument: (document: DocumentSummary) => void
  onRestoreProject: (project: Project) => void
  onRequestProjectAction: (
    project: Project,
    action: ProjectDangerAction,
    anchor: HTMLElement,
  ) => void
  onEditProfile: () => void
  onChooseProfileAvatar: () => void
  onUpdatePublishDraft: (
    draftId: string,
    update: { status?: PublishDraftStatus; targets?: PublishTarget[]; refreshSource?: boolean },
  ) => Promise<PublishDraft | null>
  onDeletePublishDraft: (draft: PublishDraft) => Promise<boolean>
  onPublishParagraph: (
    sourceKind: PublishSourceKind,
    sourceId: string,
    paragraph: PublishParagraphPayload,
  ) => void
  onDocumentProjectChange: (document: DocumentSummary, projectId?: string) => void
  onDocumentTasksChange: (
    documentId: string,
    projectId: string | undefined,
    source: string,
    tasks: DocumentTaskSnapshot[],
  ) => void
  onToggleTask: (task: TaskItem) => void
  onEditTask: (task: TaskItem) => void
  onDeleteTask: (task: TaskItem, anchor: HTMLElement) => void
}

function Page({
  route,
  projectItems,
  documentItems,
  taskItems,
  publishItems,
  userProfile,
  projectFilters,
  onProjectFilterChange,
  onNavigate,
  onNotice,
  onRestoreDocument,
  onTrashDocument,
  onRestoreProject,
  onRequestProjectAction,
  onEditProfile,
  onChooseProfileAvatar,
  onUpdatePublishDraft,
  onDeletePublishDraft,
  onPublishParagraph,
  onDocumentProjectChange,
  onDocumentTasksChange,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: PageProps) {
  if (route.page === 'today') {
    return (
      <TodayPage
        onPublishParagraph={onPublishParagraph}
        onDocumentTasksChange={onDocumentTasksChange}
      />
    )
  }
  if (route.page === 'archive') {
    return (
      <ArchivePage
        documentItems={documentItems}
        projectItems={projectItems}
        onRestore={onRestoreDocument}
        onTrash={onTrashDocument}
        onRestoreProject={onRestoreProject}
        onDeleteProject={(project, anchor) => onRequestProjectAction(project, 'delete', anchor)}
      />
    )
  }
  if (route.page === 'project') {
    if (route.itemId && route.itemKind) {
      return (
        <DocumentPage
          kind={route.itemKind}
          itemId={route.itemId}
          projectItems={projectItems}
          documentItems={documentItems}
          onProjectChange={onDocumentProjectChange}
          onPublishParagraph={onPublishParagraph}
          onDocumentTasksChange={onDocumentTasksChange}
        />
      )
    }
    return (
      <DocumentCollectionPage
        projectId={route.projectId}
        projectItems={projectItems}
        documentItems={documentItems}
        activeKind={projectFilters[route.projectId] ?? 'all'}
        onActiveKindChange={(kind) => onProjectFilterChange(route.projectId, kind)}
        onArchiveProject={(project, anchor) =>
          onRequestProjectAction(project, 'archive', anchor)}
        onDeleteProject={(project, anchor) =>
          onRequestProjectAction(project, 'delete', anchor)}
        onOpen={(kind, itemId) =>
          onNavigate({ page: 'project', projectId: route.projectId, itemKind: kind, itemId })
        }
      />
    )
  }
  if (route.page === 'publish') {
    return (
      <PublishPage
        draftId={route.draftId}
        publishItems={publishItems}
        documentItems={documentItems}
        onNavigate={onNavigate}
        onNotice={onNotice}
        onUpdate={onUpdatePublishDraft}
        onDelete={onDeletePublishDraft}
      />
    )
  }
  if (route.page === 'profile') {
    return (
      <ProfilePage
        documentItems={documentItems}
        userProfile={userProfile}
        onNavigate={onNavigate}
        onNotice={onNotice}
        onEditProfile={onEditProfile}
        onChooseAvatar={onChooseProfileAvatar}
      />
    )
  }
  if (route.itemId && route.kind !== 'tasks') {
    return (
      <DocumentPage
        kind={route.kind}
        itemId={route.itemId}
        projectItems={projectItems}
        documentItems={documentItems}
        onProjectChange={onDocumentProjectChange}
        onPublishParagraph={onPublishParagraph}
        onDocumentTasksChange={onDocumentTasksChange}
      />
    )
  }
  if (route.kind === 'tasks') {
    return (
      <TasksPage
        projectItems={projectItems}
        taskItems={taskItems}
        onToggleTask={onToggleTask}
        onEditTask={onEditTask}
        onDeleteTask={onDeleteTask}
      />
    )
  }
  return (
    <DocumentCollectionPage
      kind={route.kind}
      projectItems={projectItems}
      documentItems={documentItems}
      onOpen={(kind, itemId) => onNavigate({ page: 'library', kind, itemId })}
    />
  )
}

type WeatherAttribution = {
  serviceName: string
  legalPageURL: string
}

type WeatherSnapshot = {
  source: 'open-meteo' | 'preview' | 'fallback'
  condition: string
  symbolName: string
  location: string
  temperature: number | null
  high: number | null
  low: number | null
  feelsLike: number | null
  cloudCover: number
  precipitationIntensity: number
  humidity: number
  windSpeed: number
  isDaylight: boolean
  fetchedAt?: string
  expiresAt?: string
  attribution?: WeatherAttribution
}

type WeatherDisplayState = {
  status: 'loading' | 'ready' | 'stale' | 'unavailable' | 'preview'
  weather: WeatherSnapshot
  error?: { code: string; message: string }
}

const previewWeatherBase: WeatherSnapshot = {
  source: 'preview',
  condition: 'rain',
  symbolName: 'cloud.rain.fill',
  location: '视觉预览',
  temperature: 24,
  high: 27,
  low: 22,
  feelsLike: 25,
  cloudCover: 0.84,
  precipitationIntensity: 3.4,
  humidity: 0.82,
  windSpeed: 14,
  isDaylight: true,
}

const weatherPreviewOverrides: Partial<Record<WeatherSceneKind, Partial<WeatherSnapshot>>> = {
  'clear-day': { condition: 'clear', cloudCover: 0.06, precipitationIntensity: 0 },
  'clear-night': {
    condition: 'clear',
    cloudCover: 0.04,
    precipitationIntensity: 0,
    isDaylight: false,
  },
  'partly-cloudy': { condition: 'partlyCloudy', cloudCover: 0.42, precipitationIntensity: 0 },
  cloudy: { condition: 'cloudy', cloudCover: 0.68, precipitationIntensity: 0 },
  overcast: { condition: 'overcast', cloudCover: 0.94, precipitationIntensity: 0 },
  rain: { condition: 'rain', cloudCover: 0.84, precipitationIntensity: 3.4 },
  storm: { condition: 'thunderstorms', cloudCover: 0.96, precipitationIntensity: 6.8 },
  snow: { condition: 'snow', cloudCover: 0.86, precipitationIntensity: 2.6 },
  fog: { condition: 'foggy', cloudCover: 0.74, precipitationIntensity: 0 },
}

const requestedWeatherPreview = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('weather') as WeatherSceneKind | null
  : null
const previewWeather: WeatherSnapshot = {
  ...previewWeatherBase,
  ...(requestedWeatherPreview ? weatherPreviewOverrides[requestedWeatherPreview] : undefined),
}

type WeatherBridgeResponse = {
  ok: boolean
  snapshot?: WeatherSnapshot
  error?: { code: string; message: string }
}

const loadDevelopmentWeather = async () => {
  const response = await fetch('/api/weather', { cache: 'no-store' })
  const payload = await response.json() as WeatherBridgeResponse
  if (!response.ok || !payload.ok || !payload.snapshot) {
    const error = new Error(payload.error?.message || '天气服务暂不可用。')
    error.name = payload.error?.code || 'weather-unavailable'
    throw error
  }
  return payload.snapshot
}

const fallbackWeather: WeatherSnapshot = {
  source: 'fallback',
  condition: 'mostlyCloudy',
  symbolName: 'cloud.fill',
  location: '正在定位',
  temperature: null,
  high: null,
  low: null,
  feelsLike: null,
  cloudCover: 0.64,
  precipitationIntensity: 0,
  humidity: 0,
  windSpeed: 4,
  isDaylight: new Date().getHours() >= 6 && new Date().getHours() < 18,
}

const weatherLabels: Record<string, string> = {
  blizzard: '暴风雪',
  blowingDust: '扬尘',
  blowingSnow: '风吹雪',
  breezy: '微风',
  clear: '晴',
  cloudy: '多云',
  drizzle: '毛毛雨',
  flurries: '阵雪',
  foggy: '雾',
  freezingDrizzle: '冻毛毛雨',
  freezingRain: '冻雨',
  frigid: '严寒',
  hail: '冰雹',
  haze: '霾',
  heavyRain: '大雨',
  heavySnow: '大雪',
  hot: '炎热',
  hurricane: '飓风',
  isolatedThunderstorms: '局地雷暴',
  mostlyClear: '大致晴朗',
  mostlyCloudy: '大致多云',
  overcast: '阴',
  partlyCloudy: '局部多云',
  rain: '雨',
  scatteredThunderstorms: '零星雷暴',
  sleet: '雨夹雪',
  smoky: '烟雾',
  snow: '雪',
  strongStorms: '强风暴',
  sunFlurries: '太阳雪',
  sunShowers: '太阳雨',
  thunderstorms: '雷暴',
  tropicalStorm: '热带风暴',
  windy: '大风',
  wintryMix: '混合降雪',
}

const weatherScene = (weather: WeatherSnapshot): WeatherSceneKind => {
  const condition = weather.condition
  if (/thunder|storm|hurricane|tropical/i.test(condition)) return 'storm'
  if (/snow|flurr|sleet|wintry|hail/i.test(condition)) return 'snow'
  if (/rain|drizzle|shower/i.test(condition)) return 'rain'
  if (/fog|haze|smok|dust/i.test(condition)) return 'fog'
  if (weather.cloudCover >= 0.86) return 'overcast'
  if (condition === 'cloudy' || condition === 'mostlyCloudy' || weather.cloudCover >= 0.58) {
    return 'cloudy'
  }
  if (condition === 'partlyCloudy' || condition === 'mostlyClear' || weather.cloudCover >= 0.24) {
    return 'partly-cloudy'
  }
  return weather.isDaylight ? 'clear-day' : 'clear-night'
}

const formatTemperature = (value: number | null) =>
  value === null ? '—' : String(Math.round(value))

function useWeatherSnapshot() {
  const nativeWeather = Boolean(window.noteDown?.getWeather)
  const developmentWeather = import.meta.env.DEV && !requestedWeatherPreview
  const [state, setState] = useState<WeatherDisplayState>(() =>
    nativeWeather || developmentWeather
      ? { status: 'loading', weather: fallbackWeather }
      : { status: 'preview', weather: previewWeather },
  )

  const refresh = useCallback(async (force = false) => {
    if (!window.noteDown?.getWeather && !developmentWeather) return
    if (force) setState((current) => ({ ...current, status: 'loading' }))
    try {
      if (window.noteDown?.getWeather) {
        const result = await window.noteDown.getWeather({ force })
        if (!result.snapshot) {
          setState({
            status: 'unavailable',
            weather: { ...fallbackWeather, location: '天气暂不可用' },
            error: result.error,
          })
          return
        }
        setState({
          status: result.status === 'stale' ? 'stale' : 'ready',
          weather: result.snapshot,
          error: result.error,
        })
        return
      }
      const weather = await loadDevelopmentWeather()
      setState({
        status: 'ready',
        weather,
      })
    } catch (error) {
      setState({
        status: 'unavailable',
        weather: { ...fallbackWeather, location: '天气暂不可用' },
        error: {
          code: 'weather-bridge-error',
          message: error instanceof Error ? error.message : '天气服务暂不可用。',
        },
      })
    }
  }, [developmentWeather])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { ...state, refresh }
}

const calendarWeekdays: Record<'zh-CN' | 'en-US', string[]> = {
  'zh-CN': ['一', '二', '三', '四', '五', '六', '日'],
  'en-US': ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
}
const lunarDayLabels = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
]
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const lunarZodiacs = [
  { label: '鼠', image: zodiacRat },
  { label: '牛', image: zodiacOx },
  { label: '虎', image: zodiacTiger },
  { label: '兔', image: zodiacRabbit },
  { label: '龙', image: zodiacDragon },
  { label: '蛇', image: zodiacSnake },
  { label: '马', image: zodiacHorse },
  { label: '羊', image: zodiacGoat },
  { label: '猴', image: zodiacMonkey },
  { label: '鸡', image: zodiacRooster },
  { label: '狗', image: zodiacDog },
  { label: '猪', image: zodiacPig },
] as const

const isSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()

const formatDateKey = (date: Date) =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')

const formatLunarDate = (date: Date) => {
  const parts = lunarFormatter.formatToParts(date) as Array<{ type: string; value: string }>
  const findPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const day = Number(findPart('day'))
  const relatedYear = Number(findPart('relatedYear')) || date.getFullYear()
  const zodiacIndex = ((relatedYear - 4) % lunarZodiacs.length + lunarZodiacs.length) %
    lunarZodiacs.length
  return {
    year: findPart('yearName'),
    month: findPart('month'),
    day: lunarDayLabels[day - 1] ?? findPart('day'),
    zodiac: lunarZodiacs[zodiacIndex],
  }
}

function WeatherScene() {
  const { status, weather, error, refresh } = useWeatherSnapshot()
  const [paused, setPaused] = useState(() => document.hidden || !document.hasFocus())
  const scene = weatherScene(weather)
  const label = t(
    weatherLabels[weather.condition] ?? (status === 'loading' ? '读取天气' : '天气'),
  )

  useEffect(() => {
    const syncPlayback = () => setPaused(document.hidden || !document.hasFocus())
    document.addEventListener('visibilitychange', syncPlayback)
    window.addEventListener('focus', syncPlayback)
    window.addEventListener('blur', syncPlayback)
    return () => {
      document.removeEventListener('visibilitychange', syncPlayback)
      window.removeEventListener('focus', syncPlayback)
      window.removeEventListener('blur', syncPlayback)
    }
  }, [])

  return (
    <section
      className={`weather-scene is-${scene}${paused ? ' is-paused' : ''}`}
      aria-label={`${weather.location}，${label}，${formatTemperature(weather.temperature)} 度`}
      title={error?.message}
    >
      <WeatherAtmosphere
        scene={scene}
        cloudCover={weather.cloudCover}
        precipitationIntensity={weather.precipitationIntensity}
        windSpeed={weather.windSpeed}
        isDaylight={weather.isDaylight}
        paused={paused}
      />
      <div className="weather-copy">
        <button
          className="weather-location"
          type="button"
          title={t(status === 'preview' ? '浏览器中的天气动画预览' : '刷新天气')}
          onClick={() => void refresh(true)}
        >
          {weather.location}
          {status === 'stale' && <i aria-label={t('缓存')}>{t('缓存')}</i>}
        </button>
        <strong>{formatTemperature(weather.temperature)}°</strong>
        <div className="weather-condition-row">
          <span>{label}</span>
          <span>
            {formatTemperature(weather.high)}° / {formatTemperature(weather.low)}°
          </span>
        </div>
        <small>{t('体感')} {formatTemperature(weather.feelsLike)}°</small>
      </div>
      {weather.source === 'open-meteo' && weather.attribution && (
        <button
          className="weather-attribution"
          type="button"
          title={t('{service} 天气数据来源', {
            service: weather.attribution.serviceName,
          })}
          aria-label={t('{service} 天气数据来源', {
            service: weather.attribution.serviceName,
          })}
          onClick={() => void window.noteDown?.openExternal(weather.attribution!.legalPageURL)}
        >
          <span>{t('@数据来源 {service}', { service: weather.attribution.serviceName })}</span>
        </button>
      )}
      {status === 'unavailable' && (
        <button
          className="weather-status-action"
          type="button"
          title={error?.message || t('天气服务暂不可用')}
          aria-label={t('重新连接天气')}
          onClick={() => void refresh(true)}
        >
          <CloudRemove size={15} strokeWidth={1.9} />
        </button>
      )}
    </section>
  )
}

function TodayCalendar({
  today,
  selectedDate,
  onSelectDate,
}: {
  today: Date
  selectedDate: Date
  onSelectDate: (date: Date) => void
}) {
  const { locale } = useI18n()
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  )
  const year = visibleMonth.getFullYear()
  const month = visibleMonth.getMonth()
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const activeDays =
    year === today.getFullYear() && month === today.getMonth()
      ? new Set([1, 2, 4, 7, 8, 10, 13, 14, 15, 17, 18, 20, 21, today.getDate()])
      : new Set<number>()

  const shiftMonth = (offset: number) => {
    setVisibleMonth(new Date(year, month + offset, 1))
  }

  return (
    <section className="today-calendar" aria-label={t('日历')}>
      <header className="today-calendar-header">
        <button type="button" aria-label={t('上个月')} onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={15} />
        </button>
        <strong>
          {new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: 'long',
          }).format(visibleMonth)}
        </strong>
        <button type="button" aria-label={t('下个月')} onClick={() => shiftMonth(1)}>
          <ChevronRight size={15} />
        </button>
      </header>
      <div className="today-calendar-grid is-weekdays" aria-hidden>
        {calendarWeekdays[locale].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="today-calendar-grid is-days">
        {Array.from({ length: leadingDays }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const date = new Date(year, month, day)
          const isToday = isSameDay(date, today)
          const isSelected = isSameDay(date, selectedDate)
          return (
            <button
              className={`${isToday ? 'is-today' : ''}${isSelected ? ' is-selected' : ''}`}
              type="button"
              key={day}
              aria-label={new Intl.DateTimeFormat(locale, {
                month: 'long',
                day: 'numeric',
              }).format(date)}
              aria-pressed={isSelected}
              onClick={() => onSelectDate(date)}
            >
              {day}
              {activeDays.has(day) && <i />}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function TodayLunarDate({ selectedDate }: { selectedDate: Date }) {
  const lunar = formatLunarDate(selectedDate)
  const label = `${lunar.year}年 ${lunar.month}${lunar.day}`

  return (
    <section className="today-lunar" aria-label={`农历 ${label}`}>
      <div className="today-lunar-year">
        <img src={lunar.zodiac.image} alt={`${lunar.zodiac.label}生肖`} />
        <span>{`${lunar.year}年`}</span>
      </div>
      <strong>{`${lunar.month}${lunar.day}`}</strong>
    </section>
  )
}

function TodayContextCard({
  today,
  selectedDate,
  onSelectDate,
}: {
  today: Date
  selectedDate: Date
  onSelectDate: (date: Date) => void
}) {
  return (
    <div
      className="today-context-card"
      data-minimap-anchor="today-context"
      data-minimap-label="天气与日历"
    >
      <WeatherScene />
      <TodayLunarDate selectedDate={selectedDate} />
      <TodayCalendar today={today} selectedDate={selectedDate} onSelectDate={onSelectDate} />
    </div>
  )
}

function TodayPage({
  onPublishParagraph,
  onDocumentTasksChange,
}: {
  onPublishParagraph: PageProps['onPublishParagraph']
  onDocumentTasksChange: PageProps['onDocumentTasksChange']
}) {
  const libraryPath = loadSettings().libraryPath
  const [today] = useState(() => {
    const date = new Date()
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  })
  const [selectedDate, setSelectedDate] = useState(today)
  const selectedToday = isSameDay(selectedDate, today)
  const documentId = `daily/${formatDateKey(selectedDate)}`

  return (
    <ScrollPage className="editor-surface">
      <article className="document daily-document">
        <TodayContextCard
          today={today}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
        <Suspense fallback={<div className="markdown-document" aria-busy="true" />}>
          <MarkdownDocumentEditor
            key={documentId}
            documentId={documentId}
            libraryPath={libraryPath}
            initialTitle={t(selectedToday ? '把重要的事情写清楚' : '记录这一天')}
            initialMarkdown={
              !window.noteDown && selectedToday
                ? [
                    '## 今天的重点',
                    '- [ ] 完成 Jotkeep 新工作台的第一轮走查',
                    '- [ ] 检查窄窗口与深色模式下的阅读焦点',
                    '今天不需要先整理。直接记录，之后再决定哪些想法值得继续发展。',
                    '## 工作',
                    '天气和日历只负责建立今天的氛围与时间上下文，正文仍然保持安静。',
                    [
                      '项目不是文件夹。笔记、文章、收藏和任务仍然保留自己的类型，',
                      '只通过项目建立工作上下文。',
                    ].join(''),
                    '## 随手记',
                    '',
                  ].join('\n\n')
                : ''
            }
            ariaLabel={t('Daily Markdown 编辑器')}
            onPublishParagraph={(paragraph) =>
              onPublishParagraph('daily', formatDateKey(selectedDate), paragraph)}
            onTasksChange={(documentTasks) =>
              onDocumentTasksChange(
                documentId,
                undefined,
                formatDateKey(selectedDate),
                documentTasks,
              )}
          />
        </Suspense>
      </article>
    </ScrollPage>
  )
}

function ProjectLabel({ projectItems, projectId }: { projectItems: Project[]; projectId?: string }) {
  const project = projectItems.find((item) => item.id === projectId)
  const label = project?.name ?? '未归项目'

  return (
    <span className={`context-label${project ? '' : ' is-unassigned'}`} title={label}>
      {project ? (
        <span className="context-label-dot" style={{ background: project.color }} aria-hidden />
      ) : (
        <Folder size={11} aria-hidden />
      )}
      <span>{project ? label : t(label)}</span>
    </span>
  )
}

function DocumentTypeIcon({ kind }: { kind: DocumentKind }) {
  const TypeIcon = libraryIcons[kind]
  const label = documentKindLabels[kind]

  return (
    <span className="metadata-icon" role="img" aria-label={t(label)} title={t(label)}>
      <TypeIcon size={13} aria-hidden />
    </span>
  )
}

type DocumentGroupMode = 'date' | 'project'

type DocumentGroup = {
  id: string
  label: string
  color?: string
  items: DocumentSummary[]
}

const documentGroupLabels: Record<DocumentGroupMode, string> = {
  date: '时间线',
  project: '项目',
}

const documentGroupIcons: Record<DocumentGroupMode, IconComponent> = {
  date: Calendar,
  project: Folder,
}

const documentTimelineBuckets = [
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: 'week', label: '本周' },
  { id: 'earlier', label: '更早' },
] as const

function getDocumentTimelineBucket(updatedAt: string) {
  if (updatedAt === '今天' || updatedAt === '刚刚' || updatedAt.endsWith('分钟前')) return 'today'
  if (updatedAt === '昨天') return 'yesterday'
  if (updatedAt.startsWith('周')) return 'week'
  return 'earlier'
}

function DocumentCollectionPage({
  kind,
  projectId,
  projectItems,
  documentItems,
  activeKind = 'all',
  onActiveKindChange,
  onArchiveProject,
  onDeleteProject,
  onOpen,
}: {
  kind?: DocumentKind
  projectId?: string
  projectItems: Project[]
  documentItems: DocumentSummary[]
  activeKind?: DocumentKind | 'all'
  onActiveKindChange?: (kind: DocumentKind | 'all') => void
  onArchiveProject?: (project: Project, anchor: HTMLElement) => void
  onDeleteProject?: (project: Project, anchor: HTMLElement) => void
  onOpen: (kind: DocumentKind, itemId: string) => void
}) {
  const [groupMode, setGroupMode] = useState<DocumentGroupMode>('date')
  const activeGroupMode = projectId ? 'date' : groupMode
  const project = projectItems.find((item) => item.id === projectId)
  const scope = documentItems.filter(
    (document) =>
      !document.archivedAt &&
      (projectId ? document.projectId === projectId : document.kind === kind),
  )
  const visibleDocuments =
    activeKind === 'all' || !projectId
      ? scope
      : scope.filter((document) => document.kind === activeKind)
  const groups: DocumentGroup[] =
    activeGroupMode === 'project'
      ? [
          ...projectItems.map((projectItem) => ({
            id: projectItem.id,
            label: projectItem.name,
            color: projectItem.color,
            items: visibleDocuments.filter((document) => document.projectId === projectItem.id),
          })),
          {
            id: 'unassigned',
            label: '未归项目',
            items: visibleDocuments.filter((document) => !document.projectId),
          },
        ].filter((group) => group.items.length > 0)
      : documentTimelineBuckets
          .map((bucket) => ({
            ...bucket,
            items: visibleDocuments.filter(
              (document) => getDocumentTimelineBucket(document.updatedAt) === bucket.id,
            ),
          }))
          .filter((group) => group.items.length > 0)

  return (
    <ScrollPage className="content-index-page collection-page">
      <section
        className="content-list-card has-header"
        aria-label={
          project
            ? `${project.name} · ${t('文档')}`
            : `${t(kind ? libraryLabels[kind] : '文档')} · ${t('列表')}`
        }
      >
        <header className="content-list-header">
          <div className="content-list-controls">
            {!projectId && (
              <div className="view-tabs" aria-label={t('文档组织方式')}>
                {(['date', 'project'] as DocumentGroupMode[]).map((mode) => {
                  const GroupIcon = documentGroupIcons[mode]
                  const label = documentGroupLabels[mode]
                  return (
                    <button
                      className={groupMode === mode ? 'is-active' : ''}
                      type="button"
                      key={mode}
                      aria-label={t(label)}
                      title={t(label)}
                      onClick={() => setGroupMode(mode)}
                    >
                      <GroupIcon size={16} strokeWidth={1.8} aria-hidden />
                    </button>
                  )
                })}
              </div>
            )}
            {projectId && (
              <div className="view-tabs" aria-label={t('文档类型筛选')}>
                {(['all', 'notes', 'articles', 'clips'] as const).map((filterKind) => {
                  const FilterIcon = filterKind === 'all' ? Sliders : libraryIcons[filterKind]
                  const label = filterKind === 'all' ? '全部' : documentKindLabels[filterKind]
                  return (
                    <button
                      className={activeKind === filterKind ? 'is-active' : ''}
                      type="button"
                      key={filterKind}
                      aria-label={t(label)}
                      title={t(label)}
                      onClick={() => onActiveKindChange?.(filterKind)}
                    >
                      <FilterIcon size={16} strokeWidth={1.8} aria-hidden />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {project && (
            <div className="content-list-actions" aria-label={t('项目操作')}>
              <button
                type="button"
                aria-label={`归档项目：${project.name}`}
                title={t('归档项目')}
                onClick={(event) => onArchiveProject?.(project, event.currentTarget)}
              >
                <ArchiveBox size={16} strokeWidth={1.8} aria-hidden />
              </button>
              <button
                className="is-danger"
                type="button"
                aria-label={`删除项目：${project.name}`}
                title={t('删除项目')}
                onClick={(event) => onDeleteProject?.(project, event.currentTarget)}
              >
                <Trash size={16} strokeWidth={1.8} aria-hidden />
              </button>
            </div>
          )}
        </header>

        {groups.length > 0 ? (
          <div className={`content-groups${activeGroupMode === 'date' ? ' is-timeline' : ''}`}>
            {groups.map((group) => (
              <section
                className="content-group"
                key={group.id}
                data-minimap-anchor={`documents-${group.id}`}
                data-minimap-label={t(group.label)}
              >
                <header className="content-group-header">
                  <span className="content-group-marker" aria-hidden>
                    {group.color ? (
                      <span className="project-dot" style={{ background: group.color }} />
                    ) : activeGroupMode === 'date' ? (
                      <Calendar size={13} />
                    ) : (
                      <Folder size={13} />
                    )}
                  </span>
                  <strong>{t(group.label)}</strong>
                </header>
                <div className="document-card-list">
                  {group.items.map((document) => (
                    <button
                      className="content-item-card document-card"
                      type="button"
                      key={`${document.kind}-${document.id}`}
                      onClick={() => onOpen(document.kind, document.id)}
                    >
                      <span className="document-card-main">
                        <strong>{document.title}</strong>
                        {projectId ? (
                          <DocumentTypeIcon kind={document.kind} />
                        ) : activeGroupMode !== 'project' ? (
                          <ProjectLabel
                            projectItems={projectItems}
                            projectId={document.projectId}
                          />
                        ) : null}
                      </span>
                      <time>{document.updatedAt}</time>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <DocumentText size={27} />
            <strong>{t('暂无文档')}</strong>
          </div>
        )}
      </section>
    </ScrollPage>
  )
}

function ArchivePage({
  documentItems,
  projectItems,
  onRestore,
  onTrash,
  onRestoreProject,
  onDeleteProject,
}: {
  documentItems: DocumentSummary[]
  projectItems: Project[]
  onRestore: (document: DocumentSummary) => void
  onTrash: (document: DocumentSummary) => void
  onRestoreProject: (project: Project) => void
  onDeleteProject: (project: Project, anchor: HTMLElement) => void
}) {
  const archivedDocuments = documentItems
    .filter((document) => document.archivedAt)
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const archivedProjects = projectItems
    .filter((project) => project.archivedAt)
    .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
  const archiveEmpty = archivedDocuments.length === 0 && archivedProjects.length === 0

  return (
    <ScrollPage className="content-index-page archive-page">
      <section className="content-list-card" aria-label={t('归档内容')}>
        {archiveEmpty ? (
          <div className="empty-state">
            <ArchiveBox size={27} />
            <strong>{t('归档为空')}</strong>
          </div>
        ) : (
          <div className="archive-groups">
            {archivedProjects.length > 0 && (
              <section data-minimap-anchor="archive-projects" data-minimap-label="项目">
                <header className="archive-group-heading">
                  <Folder size={15} strokeWidth={1.8} />
                  <strong>{t('项目')}</strong>
                </header>
                <div className="document-card-list">
                  {archivedProjects.map((project) => (
                    <div className="content-item-card archive-document-card" key={project.id}>
                      <span className="document-card-main">
                        <Folder size={15} strokeWidth={1.8} style={{ color: project.color }} />
                        <strong>{project.name}</strong>
                        <span className="archive-project-status">
                          {projectStatusLabels[project.status]}
                        </span>
                      </span>
                      <time>{formatDocumentTime(project.archivedAt ?? '')}</time>
                      <span className="archive-card-actions">
                        <button
                          type="button"
                          aria-label={`恢复项目：${project.name}`}
                          title="恢复"
                          onClick={() => onRestoreProject(project)}
                        >
                          <Refresh size={16} strokeWidth={1.8} />
                        </button>
                        <button
                          className="is-danger"
                          type="button"
                          aria-label={`删除项目：${project.name}`}
                          title="删除项目"
                          onClick={(event) => onDeleteProject(project, event.currentTarget)}
                        >
                          <Trash size={16} strokeWidth={1.8} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {archivedDocuments.length > 0 && (
              <section data-minimap-anchor="archive-documents" data-minimap-label="文档">
                <header className="archive-group-heading">
                  <DocumentText size={15} strokeWidth={1.8} />
                  <strong>{t('文档')}</strong>
                </header>
                <div className="document-card-list">
                  {archivedDocuments.map((document) => (
                    <div
                      className="content-item-card archive-document-card"
                      key={documentKey(document)}
                    >
                      <span className="document-card-main">
                        <strong>{document.title}</strong>
                        <DocumentTypeIcon kind={document.kind} />
                        <ProjectLabel projectItems={projectItems} projectId={document.projectId} />
                      </span>
                      <time>{formatDocumentTime(document.archivedAt ?? '')}</time>
                      <span className="archive-card-actions">
                        <button
                          type="button"
                          aria-label={`恢复：${document.title}`}
                          title="恢复"
                          onClick={() => onRestore(document)}
                        >
                          <Refresh size={16} strokeWidth={1.8} />
                        </button>
                        <button
                          className="is-danger"
                          type="button"
                          aria-label={`移到废纸篓：${document.title}`}
                          title="移到废纸篓"
                          onClick={() => onTrash(document)}
                        >
                          <Trash size={16} strokeWidth={1.8} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </section>
    </ScrollPage>
  )
}

type TaskGroupMode = 'date' | 'project' | 'status'

const taskStatusLabels: Record<TaskItem['status'], string> = {
  Todo: '待办',
  Doing: '进行中',
  Done: '已完成',
  Cancelled: '已取消',
}

const projectStatusLabels: Record<Project['status'], string> = {
  Active: '进行中',
  Planned: '计划中',
}

const projectColors = ['#6f8268', '#6f7f9b', '#a57a61', '#81709a', '#9a6f69', '#668b8c']

const taskStatusIcons: Record<TaskItem['status'], IconComponent> = {
  Todo: Checklist,
  Doing: Activity,
  Done: CheckCircle,
  Cancelled: CloseCircle,
}

const taskGroupLabels: Record<TaskGroupMode, string> = {
  date: '日期',
  project: '项目',
  status: '状态',
}

const taskGroupIcons: Record<TaskGroupMode, IconComponent> = {
  date: Calendar,
  project: Folder,
  status: Checklist,
}

const taskDateGroup = (value: string) => {
  const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!isoDate) return { id: value, label: value }
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const todayKey = today.toLocaleDateString('sv-SE')
  const tomorrowKey = tomorrow.toLocaleDateString('sv-SE')
  if (isoDate === todayKey) return { id: isoDate, label: '今天' }
  if (isoDate === tomorrowKey) return { id: isoDate, label: '明天' }
  return {
    id: isoDate,
    label: new Intl.DateTimeFormat(getCurrentLocale(), {
      month: 'numeric',
      day: 'numeric',
    }).format(
      new Date(`${isoDate}T00:00:00`),
    ),
  }
}

function TaskStatusIcon({ status }: { status: TaskItem['status'] }) {
  const StatusIcon = taskStatusIcons[status]
  const label = taskStatusLabels[status]

  return (
    <span className="metadata-icon" role="img" aria-label={t(label)} title={t(label)}>
      <StatusIcon size={13} aria-hidden />
    </span>
  )
}

function TaskCard({
  task,
  groupMode,
  projectItems,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: TaskItem
  groupMode: TaskGroupMode
  projectItems: Project[]
  onToggle: (task: TaskItem) => void
  onEdit: (task: TaskItem) => void
  onDelete: (task: TaskItem, anchor: HTMLElement) => void
}) {
  const complete = task.status === 'Done'

  return (
    <div className={`content-item-card task-card${complete ? ' is-complete' : ''}`}>
      <button
        className="task-check"
        type="button"
        aria-label={`${complete ? '恢复' : '完成'}任务：${task.title}`}
        aria-pressed={complete}
        onClick={() => onToggle(task)}
      >
        {complete && <Check size={13} />}
      </button>
      <button className="task-card-main task-card-edit" type="button" onClick={() => onEdit(task)}>
        <span className="task-card-copy">
          <strong>{task.title}</strong>
          {task.description && <span>{task.description}</span>}
        </span>
        <span className="task-card-metadata">
          {groupMode !== 'project' && (
            <ProjectLabel projectItems={projectItems} projectId={task.projectId} />
          )}
          {groupMode !== 'status' && <TaskStatusIcon status={task.status} />}
          {groupMode !== 'date' && <time>{task.date}</time>}
        </span>
      </button>
      <button
        className="task-card-delete"
        type="button"
        aria-label={t('移除任务：{title}', { title: task.title })}
        title={t('移除')}
        onClick={(event) => onDelete(task, event.currentTarget)}
      >
        <Trash size={14} strokeWidth={1.8} />
      </button>
    </div>
  )
}

function TasksPage({
  projectItems,
  taskItems,
  onToggleTask,
  onEditTask,
  onDeleteTask,
}: {
  projectItems: Project[]
  taskItems: TaskItem[]
  onToggleTask: (task: TaskItem) => void
  onEditTask: (task: TaskItem) => void
  onDeleteTask: (task: TaskItem, anchor: HTMLElement) => void
}) {
  const [groupMode, setGroupMode] = useState<TaskGroupMode>('date')
  const groups =
    groupMode === 'project'
      ? projectItems
          .map((project) => ({
            id: project.id,
            label: project.name,
            color: project.color,
            items: taskItems.filter((task) => task.projectId === project.id),
          }))
          .filter((group) => group.items.length > 0)
      : groupMode === 'status'
        ? (['Doing', 'Todo', 'Done', 'Cancelled'] as TaskItem['status'][])
            .map((status) => ({
              id: status,
              label: taskStatusLabels[status],
              items: taskItems.filter((task) => task.status === status),
            }))
            .filter((group) => group.items.length > 0)
        : [...new Map(taskItems.map((task) => {
            const group = taskDateGroup(task.date)
            return [group.id, group]
          })).values()].map((group) => ({
            ...group,
            items: taskItems.filter((task) => taskDateGroup(task.date).id === group.id),
          }))

  return (
    <ScrollPage className="content-index-page tasks-page">
      <section className="content-list-card has-header" aria-label={t('任务清单')}>
        <header className="content-list-header">
          <div className="content-list-controls">
            <div className="view-tabs" aria-label={t('任务分组方式')}>
              {(['date', 'project', 'status'] as TaskGroupMode[]).map((mode) => {
                const GroupIcon = taskGroupIcons[mode]
                const label = taskGroupLabels[mode]
                return (
                  <button
                    className={groupMode === mode ? 'is-active' : ''}
                    type="button"
                    key={mode}
                    aria-label={t(label)}
                    title={t(label)}
                    onClick={() => setGroupMode(mode)}
                  >
                    <GroupIcon size={16} strokeWidth={1.8} aria-hidden />
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        <div className={`content-groups${groupMode === 'date' ? ' is-timeline' : ''}`}>
          {groups.map((group) => (
            <section
              className="content-group"
              key={group.id}
              data-minimap-anchor={`tasks-${group.id}`}
              data-minimap-label={t(group.label)}
            >
              <header className="content-group-header">
                <span className="content-group-marker" aria-hidden>
                  {'color' in group && typeof group.color === 'string' ? (
                    <span className="project-dot" style={{ background: group.color }} />
                  ) : groupMode === 'date' ? (
                    <Calendar size={13} />
                  ) : (
                    <Checklist size={13} />
                  )}
                </span>
                <strong>{t(group.label)}</strong>
              </header>
              <div className="task-card-list">
                {group.items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    groupMode={groupMode}
                    projectItems={projectItems}
                    onToggle={onToggleTask}
                    onEdit={onEditTask}
                    onDelete={onDeleteTask}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </ScrollPage>
  )
}

function TaskEditorDialog({
  task,
  isNew,
  projectItems,
  onSave,
  onClose,
}: {
  task: TaskItem
  isNew: boolean
  projectItems: Project[]
  onSave: (task: TaskItem) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(task)

  useEffect(() => setDraft(task), [task])

  return (
    <div
      className="palette-backdrop task-editor-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <form
        className="task-editor-dialog task-form-dialog"
        aria-label={t(isNew ? '新建任务' : '编辑任务')}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          const title = draft.title.trim()
          if (!title) return
          onSave({
            ...draft,
            title,
            description: draft.description?.trim() ?? '',
            date: draft.date.trim() || '无日期',
          })
        }}
      >
        <label className="task-editor-title">
          <span>{t('任务')}</span>
          <input
            autoFocus
            value={draft.title}
            placeholder={t('需要完成什么？')}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <div className="task-editor-fields task-form-fields">
          <label className="task-editor-description">
            <span>{t('描述')}</span>
            <textarea
              value={draft.description ?? ''}
              placeholder={t('补充任务描述')}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label>
            <span>{t('日期')}</span>
            <input
              value={draft.date}
              placeholder="2026-07-22 18:00"
              onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
          <label>
            <span>{t('项目')}</span>
            <FloatingSelect
              label={t('所属项目')}
              value={draft.projectId ?? ''}
              options={[
                { value: '', label: t('未归项目') },
                ...projectItems
                  .filter((project) => !project.archivedAt || project.id === draft.projectId)
                  .map((project) => ({
                    value: project.id,
                    label: project.name,
                    leading: <span className="project-dot" style={{ background: project.color }} />,
                  })),
              ]}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  projectId: value || undefined,
                }))
              }
            />
          </label>
        </div>
        <footer className="dialog-actions task-editor-actions">
          <button className="dialog-secondary-button" type="button" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="dialog-primary-button" type="submit" disabled={!draft.title.trim()}>
            {t('保存')}
          </button>
        </footer>
      </form>
    </div>
  )
}

function ProjectEditorDialog({
  project,
  isNew,
  onSave,
  onClose,
}: {
  project: Project
  isNew: boolean
  onSave: (project: Project) => void
  onClose: () => void
}) {
  const [name, setName] = useState(project.name)

  useEffect(() => setName(project.name), [project])

  return (
    <div className="palette-backdrop project-name-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="task-editor-dialog project-name-dialog"
        aria-label={t(isNew ? '新建项目' : '编辑项目')}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          const nextName = name.trim()
          if (!nextName) return
          onSave({ ...project, name: nextName })
        }}
      >
        <label className="project-name-field">
          <span className="visually-hidden">{t('项目名称')}</span>
          <input
            autoFocus
            value={name}
            placeholder={t('项目名称')}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <footer className="dialog-actions project-name-actions">
          <button
            className="dialog-secondary-button"
            type="button"
            onClick={onClose}
          >
            {t('取消')}
          </button>
          <button
            className="dialog-primary-button"
            type="submit"
            disabled={!name.trim()}
          >
            {t('保存')}
          </button>
        </footer>
      </form>
    </div>
  )
}

type ProjectDangerAction = 'archive' | 'delete'

function AnchoredActionPopover({
  anchor,
  title,
  detail,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  anchor: HTMLElement
  title: string
  detail?: string
  confirmLabel: string
  danger: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [position, setPosition] = useState({ left: 0, top: 0, above: false, arrowX: 0 })
  const panelRef = useRef<HTMLElement>(null)

  const updatePosition = useCallback(() => {
    const rect = anchor.getBoundingClientRect()
    const width = 296
    const height = panelRef.current?.offsetHeight ?? 190
    const left = Math.min(
      Math.max(8, rect.right - width),
      window.innerWidth - width - 8,
    )
    const above = rect.bottom + height + 8 > window.innerHeight
    const top = above ? Math.max(8, rect.top - height - 7) : rect.bottom + 7
    const arrowX = Math.min(Math.max(rect.left + rect.width / 2 - left, 14), width - 14)
    setPosition({ left, top, above, arrowX })
  }, [anchor])

  useLayoutEffect(() => {
    updatePosition()
  }, [detail, title, updatePosition])

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchor, onClose, updatePosition])

  return createPortal(
    <section
      ref={panelRef}
      className={`project-danger-popover${danger ? ' is-delete' : ''}${position.above ? ' is-above' : ''}`}
      role="alertdialog"
      aria-label={title}
      style={{
        left: position.left,
        top: position.top,
        '--project-popover-arrow-x': `${position.arrowX}px`,
      } as CSSProperties}
    >
      <div className="project-danger-copy">
        <div className="project-danger-message">
          <strong>{title}</strong>
          {detail && <small title={detail}>{detail}</small>}
        </div>
      </div>
      <footer className="dialog-actions">
        <button className="dialog-secondary-button" type="button" onClick={onClose}>
          {t('取消')}
        </button>
        <button
          className={danger ? 'dialog-danger-button' : 'dialog-primary-button'}
          type="button"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </footer>
    </section>,
    document.body,
  )
}

function ProjectDangerPopover({
  action,
  anchor,
  documentCount,
  onConfirm,
  onClose,
}: {
  action: ProjectDangerAction
  anchor: HTMLElement
  documentCount: number
  onConfirm: () => void
  onClose: () => void
}) {
  const archive = action === 'archive'
  const actionLabel = t(archive ? '归档' : '删除')
  const title = documentCount > 0
    ? t('{action}项目以及项目下的文档', { action: actionLabel })
    : t('{action}项目', { action: actionLabel })

  return (
    <AnchoredActionPopover
      anchor={anchor}
      title={title}
      detail={documentCount > 0 ? t('{count} 篇', { count: documentCount }) : undefined}
      confirmLabel={actionLabel}
      danger={!archive}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}

function ProfileEditorDialog({
  profile,
  onSave,
  onClose,
}: {
  profile: NoteDownUserProfile
  onSave: (profile: NoteDownUserProfile) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => ({
    ...profile,
    links: profileWorks.map(({ id }) => ({
      id,
      url: profile.links.find((link) => link.id === id)?.url ?? '',
    })),
  }))

  return (
    <div
      className="palette-backdrop profile-editor-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <form
        className="task-editor-dialog profile-editor-dialog"
        aria-label={t('编辑个人资料')}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          const username = draft.username.trim()
          if (!username) return
          onSave({ ...draft, username })
        }}
      >
        <label className="task-editor-title">
          <span>{t('用户名')}</span>
          <input
            autoFocus
            value={draft.username}
            placeholder={t('用户名')}
            onChange={(event) =>
              setDraft((current) => ({ ...current, username: event.target.value }))}
          />
        </label>
        <div className="task-editor-fields profile-editor-fields">
          {profileWorks.map((work) => {
            const link = draft.links.find((item) => item.id === work.id)
            return (
              <label className="profile-link-field" key={work.id}>
                <span
                  className={`profile-link-icon is-${work.tone}`}
                  title={work.label}
                  aria-hidden
                >
                  {work.brand
                    ? <BrandMark name={work.brand} size={17} />
                    : work.logo && <work.logo size={17} strokeWidth={1.9} />}
                </span>
                <input
                  type="url"
                  aria-label={work.label}
                  value={link?.url ?? ''}
                  placeholder="https://"
                  onChange={(event) => {
                    const url = event.target.value
                    setDraft((current) => ({
                      ...current,
                      links: [
                        ...current.links.filter((item) => item.id !== work.id),
                        { id: work.id, url },
                      ],
                    }))
                  }}
                />
              </label>
            )
          })}
        </div>
        <footer className="dialog-actions profile-editor-actions">
          <button className="dialog-secondary-button" type="button" onClick={onClose}>
            {t('取消')}
          </button>
          <button
            className="dialog-primary-button"
            type="submit"
            disabled={!draft.username.trim()}
          >
            {t('保存')}
          </button>
        </footer>
      </form>
    </div>
  )
}

function ClipCaptureDialog({
  projectItems,
  defaultProjectId,
  onCapture,
  onClose,
}: {
  projectItems: Project[]
  defaultProjectId?: string
  onCapture: (url: string, projectId?: string) => Promise<boolean>
  onClose: () => void
}) {
  const [url, setURL] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="task-editor-dialog clip-capture-dialog"
        aria-label={t('添加收藏')}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (!url.trim() || submitting) return
          setSubmitting(true)
          void onCapture(url.trim(), projectId || undefined).then((captured) => {
            setSubmitting(false)
            if (captured) onClose()
          })
        }}
      >
        <header>
          <Link size={17} strokeWidth={1.8} />
          <IconButton label="关闭" onClick={onClose}>
            <CloseCircle size={16} />
          </IconButton>
        </header>
        <label className="task-editor-title">
          <span>{t('网址')}</span>
          <input
            autoFocus
            type="url"
            value={url}
            placeholder="https://"
            onChange={(event) => setURL(event.target.value)}
          />
        </label>
        <div className="task-editor-fields">
          <label>
            <span>{t('项目')}</span>
            <FloatingSelect
              label="所属项目"
              value={projectId}
              options={[
                { value: '', label: t('未归项目') },
                ...projectItems.filter((project) => !project.archivedAt).map((project) => ({
                  value: project.id,
                  label: project.name,
                  leading: <span className="project-dot" style={{ background: project.color }} />,
                })),
              ]}
              onChange={setProjectId}
            />
          </label>
        </div>
        <footer>
          <button className="task-save-button" type="submit" disabled={!url.trim() || submitting}>
            <Bookmark size={15} strokeWidth={1.8} />
            {t(submitting ? '正在读取' : '收藏')}
          </button>
        </footer>
      </form>
    </div>
  )
}

function VersionHistoryDialog({
  document,
  onClose,
  onNotice,
}: {
  document: { id: string; title: string }
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const { locale } = useI18n()
  const [versions, setVersions] = useState<NoteDownDocumentVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringId, setRestoringId] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!window.noteDown) {
        setLoading(false)
        return
      }
      try {
        const items = await window.noteDown.listDocumentVersions({
          documentId: document.id,
          libraryPath: loadSettings().libraryPath,
        })
        if (!cancelled) setVersions(items)
      } catch {
        if (!cancelled) onNotice(t('历史版本读取失败。'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [document.id, onNotice])

  const restore = async (version: NoteDownDocumentVersion) => {
    if (!window.noteDown || restoringId) return
    setRestoringId(version.id)
    try {
      await window.noteDown.restoreDocumentVersion({
        documentId: document.id,
        libraryPath: loadSettings().libraryPath,
        versionId: version.id,
      })
      window.dispatchEvent(
        new CustomEvent('note-down:document-restored', {
          detail: { documentId: document.id },
        }),
      )
      onNotice(t('历史版本已恢复，恢复前内容也已保留。'))
      onClose()
    } catch {
      setRestoringId('')
      onNotice(t('历史版本恢复失败。'))
    }
  }

  return (
    <div
      className="palette-backdrop version-history-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="task-editor-dialog version-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('{title}的历史版本', { title: document.title })}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <History size={17} strokeWidth={1.8} />
          <IconButton label="关闭弹窗" onClick={onClose}>
            <CloseCircle size={16} />
          </IconButton>
        </header>
        <div className="version-history-list">
          {loading && <p className="version-history-empty">{t('正在读取')}</p>}
          {!loading && versions.length === 0 && (
            <p className="version-history-empty">
              {t('编辑一段时间后，历史版本会出现在这里。')}
            </p>
          )}
          {versions.map((version) => (
            <article className="version-history-item" key={version.id}>
              <div>
                <strong>{version.title}</strong>
                <p>{version.preview || t('空白文档')}</p>
                <time dateTime={version.createdAt}>
                  {new Intl.DateTimeFormat(locale, {
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(version.createdAt))}
                </time>
              </div>
              <button
                type="button"
                disabled={Boolean(restoringId)}
                onClick={() => void restore(version)}
              >
                <Refresh size={14} strokeWidth={1.8} />
                {t(restoringId === version.id ? '恢复中' : '恢复')}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function DocumentPage({
  kind,
  itemId,
  projectItems,
  documentItems,
  onProjectChange,
  onPublishParagraph,
  onDocumentTasksChange,
}: {
  kind: DocumentKind
  itemId: string
  projectItems: Project[]
  documentItems: DocumentSummary[]
  onProjectChange: (document: DocumentSummary, projectId?: string) => void
  onPublishParagraph: PageProps['onPublishParagraph']
  onDocumentTasksChange: PageProps['onDocumentTasksChange']
}) {
  const summary = documentItems.find((item) => item.kind === kind && item.id === itemId)
  const article = !window.noteDown && kind === 'articles'
    ? articles.find((item) => item.id === itemId)
    : undefined
  const note = !window.noteDown && kind === 'notes'
    ? notes.find((item) => item.id === itemId)
    : undefined
  const clip = !window.noteDown && kind === 'clips'
    ? clips.find((item) => item.id === itemId)
    : undefined
  const item = article ?? note ?? clip
  if (!summary && !item) return null

  const libraryPath = loadSettings().libraryPath
  const initialMarkdown = article
    ? [article.excerpt, ...article.body, '## 继续写作', ''].join('\n\n')
    : note
      ? [note.excerpt, ...note.body, '## 补充', ''].join('\n\n')
      : clip
        ? [clip.note, '', `来源：${clip.source}`].join('\n\n')
        : ''
  const projectId = summary?.projectId ?? item?.projectId
  return (
    <ScrollPage className="editor-surface">
      <article className="document document-detail">
        <Suspense fallback={<div className="markdown-document" aria-busy="true" />}>
          <MarkdownDocumentEditor
            key={`${kind}-${itemId}`}
            documentId={`${kind}/${itemId}`}
            libraryPath={libraryPath}
            initialTitle={summary?.title ?? item?.title ?? '未命名文档'}
            initialMarkdown={initialMarkdown}
            ariaLabel="Markdown 编辑器"
            onPublishParagraph={
              kind === 'notes' || kind === 'articles'
                ? (paragraph) => onPublishParagraph(kind, itemId, paragraph)
                : undefined
            }
            onTasksChange={(documentTasks) =>
              onDocumentTasksChange(
                `${kind}/${itemId}`,
                projectId,
                summary?.title ?? item?.title ?? '未命名文档',
                documentTasks,
              )}
            metadata={({ tags: editorTags, setTags }) => (
              <DocumentInfoPopover
                summary={summary}
                projectItems={projectItems}
                projectId={projectId}
                tags={editorTags}
                onTagsChange={setTags}
                onProjectChange={(nextProjectId) => {
                  if (summary) onProjectChange(summary, nextProjectId)
                }}
              />
            )}
          />
        </Suspense>
      </article>
    </ScrollPage>
  )
}

function DocumentInfoPopover({
  summary,
  projectItems,
  projectId,
  tags,
  onTagsChange,
  onProjectChange,
}: {
  summary?: DocumentSummary
  projectItems: Project[]
  projectId?: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  onProjectChange: (projectId?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = 264
    const height = panelRef.current?.offsetHeight ?? 150
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
    const top = rect.bottom + height + 8 <= window.innerHeight
      ? rect.bottom + 6
      : Math.max(8, rect.top - height - 6)
    setPosition({ left, top })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, tags.length, updatePosition])

  const commitTag = () => {
    const tag = tagDraft.trim().replace(/^#/, '')
    if (tag && !tags.includes(tag)) onTagsChange([...tags, tag])
    setTagDraft('')
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        className={`document-info-trigger${open ? ' is-active' : ''}`}
        type="button"
        aria-label="文档信息"
        aria-expanded={open}
        title="文档信息"
        onClick={() => setOpen((current) => !current)}
      >
        <DocumentInfoMark />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="document-info-popover"
          role="dialog"
          aria-label="文档信息"
          style={{ left: position.left, top: position.top }}
        >
          <div className="document-info-row">
            <Folder size={15} strokeWidth={1.8} aria-hidden />
            {summary ? (
              <FloatingSelect
                label="所属项目"
                value={projectId ?? ''}
                minMenuWidth={228}
                options={[
                  { value: '', label: '未归项目' },
                  ...projectItems
                    .filter((project) => !project.archivedAt || project.id === projectId)
                    .map((project) => ({
                      value: project.id,
                      label: project.name,
                    })),
                ]}
                onChange={(value) => onProjectChange(value || undefined)}
              />
            ) : (
              <span>{getProjectName(projectItems, projectId)}</span>
            )}
          </div>
          <div className="document-info-row">
            <Tag size={15} strokeWidth={1.8} aria-hidden />
            <div className="document-tag-editor">
              <input
                value={tagDraft}
                aria-label="添加标签"
                placeholder="添加标签"
                onBlur={commitTag}
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    commitTag()
                  }
                  if (event.key === 'Backspace' && !tagDraft && tags.length > 0) {
                    onTagsChange(tags.slice(0, -1))
                  }
                }}
              />
              {tags.length > 0 && (
                <div className="document-tag-list">
                  {tags.map((tagName) => (
                    <button
                      type="button"
                      aria-label={`移除标签：${tagName}`}
                      title="移除标签"
                      key={tagName}
                      onClick={() => onTagsChange(tags.filter((tag) => tag !== tagName))}
                    >
                      {tagName}
                      <CloseCircle size={12} strokeWidth={1.8} aria-hidden />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function DocumentInfoMark() {
  return (
    <svg width="17" height="22" viewBox="4.75 2.2 14.5 19.2" fill="none" aria-hidden>
      <path
        d="M7.5 3.25h9c.97 0 1.75.78 1.75 1.75v15.3L12 17.1 5.75 20.3V5c0-.97.78-1.75 1.75-1.75Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 10.3v4.15"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7.55" r="0.85" fill="currentColor" />
    </svg>
  )
}

function PublishPage({
  draftId,
  publishItems,
  documentItems,
  onNavigate,
  onNotice,
  onUpdate,
  onDelete,
}: Pick<PageProps, 'publishItems' | 'documentItems' | 'onNavigate' | 'onNotice'> & {
  draftId?: string
  onUpdate: PageProps['onUpdatePublishDraft']
  onDelete: PageProps['onDeletePublishDraft']
}) {
  const [activeStatus, setActiveStatus] = useState<PublishDraftStatus>('Preparing')
  const statusTabs = publishStatusOrder.filter(
    (status) => status !== 'Failed' || publishItems.some((draft) => draft.status === 'Failed'),
  )
  const visibleDrafts = publishItems.filter((draft) => draft.status === activeStatus)
  const selectedDraft = publishItems.find((draft) => draft.id === draftId)

  const copyDraft = async (draft: PublishDraft, target: PublishTarget) => {
    const output = publishOutput(draft, target)
    try {
      if (window.noteDown?.copyText) await window.noteDown.copyText(output.content)
      else await navigator.clipboard.writeText(output.content)
      onNotice(`${publishTargetLabels[target]}排版已复制。`)
    } catch {
      onNotice('复制失败，请检查剪贴板权限。')
    }
  }

  const openXComposer = async (draft: PublishDraft) => {
    const output = publishOutput(draft, 'x')
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(output.content)}`
    try {
      if (window.noteDown?.openExternal) await window.noteDown.openExternal(url)
      else window.open(url, '_blank', 'noopener,noreferrer')
      if (draft.status === 'Preparing' || draft.status === 'Failed') {
        await onUpdate(draft.id, { status: 'Queued' })
      }
      onNotice('已打开 X，请确认内容后发布。')
    } catch {
      onNotice('无法打开 X，请检查系统浏览器设置。')
    }
  }

  if (draftId) {
    if (!selectedDraft) {
      return (
        <ScrollPage className="content-index-page publish-page">
          <div className="empty-state publish-empty">
            <CloseCircle size={27} />
            <strong>发布草稿不存在</strong>
            <button type="button" onClick={() => onNavigate({ page: 'publish' })}>返回发布</button>
          </div>
        </ScrollPage>
      )
    }
    const SourceIcon = publishSourceIcons[selectedDraft.sourceKind]
    const preview = publishOutput(selectedDraft, 'x')
    return (
      <ScrollPage className="publish-workspace-page">
        <article className="publish-workspace">
          <header className="publish-workspace-header">
            <span className="publish-source-icon" aria-hidden>
              <SourceIcon size={16} strokeWidth={1.8} />
            </span>
            <div>
              <strong>{selectedDraft.sourceBlockPreview || selectedDraft.sourceTitle}</strong>
              <span>
                {selectedDraft.sourceBlockId
                  ? `段落 · ${publishStatusLabels[selectedDraft.status]}`
                  : publishStatusLabels[selectedDraft.status]}
              </span>
            </div>
            {!selectedDraft.sourceMissing && (
              <IconButton
                label="打开来源文档"
                onClick={() =>
                  onNavigate(
                    publishSourceRoute(selectedDraft.sourceKind, selectedDraft.sourceId),
                  )}
              >
                <DocumentText size={16} strokeWidth={1.8} />
              </IconButton>
            )}
            <IconButton
              label="移除发布草稿"
              onClick={() => void onDelete(selectedDraft)}
            >
              <Trash size={16} strokeWidth={1.8} />
            </IconButton>
          </header>

          {(selectedDraft.sourceChanged || selectedDraft.sourceMissing) && (
            <div className="publish-source-notice" role="status">
              <Refresh size={15} strokeWidth={1.8} />
              <span>
                {selectedDraft.sourceMissing
                  ? '来源文档已不存在，当前固定版本仍可复制。'
                  : selectedDraft.sourceBlockId
                    ? '来源文档已有更新，当前固定内容保持不变。'
                    : '来源文档已有更新，当前发布版本不会自动覆盖。'}
              </span>
              {!selectedDraft.sourceMissing && !selectedDraft.sourceBlockId && (
                <button
                  type="button"
                  onClick={() => void onUpdate(selectedDraft.id, { refreshSource: true })}
                >
                  更新版本
                </button>
              )}
            </div>
          )}

          <section className="publish-snapshot" aria-label="排版预览">
            <header>
              <span className="publish-x-mark" role="img" aria-label="X">
                <BrandMark name="x" size={14} />
              </span>
              <span>{`${preview.format} · ${preview.count} 字符`}</span>
            </header>
            <pre>{preview.content}</pre>
          </section>

          <footer className="publish-workspace-actions">
            {selectedDraft.status === 'Queued' && (
              <button
                type="button"
                onClick={() => void onUpdate(selectedDraft.id, { status: 'Published' })}
              >
                <Check size={15} strokeWidth={1.8} />
                标记已发布
              </button>
            )}
            <button type="button" onClick={() => void copyDraft(selectedDraft, 'x')}>
              <Copy size={15} strokeWidth={1.8} />
              复制排版
            </button>
            <button
              className="publish-primary-action"
              type="button"
              onClick={() => void openXComposer(selectedDraft)}
            >
              <BrandMark name="x" size={13} />
              {selectedDraft.status === 'Queued' ? '重新前往 X' : '前往 X 发布'}
            </button>
          </footer>
        </article>
      </ScrollPage>
    )
  }

  return (
    <ScrollPage className="content-index-page publish-page">
      <section className="content-list-card has-header" aria-label="发布草稿">
        <header className="content-list-header">
          <div className="content-list-controls">
            <div className="view-tabs" role="tablist" aria-label="发布状态">
              {statusTabs.map((status) => {
                const StatusIcon = publishStatusIcons[status]
                const label = publishStatusLabels[status]
                return (
                  <button
                    className={activeStatus === status ? 'is-active' : ''}
                    type="button"
                    role="tab"
                    key={status}
                    aria-label={label}
                    aria-selected={activeStatus === status}
                    title={label}
                    onClick={() => setActiveStatus(status)}
                  >
                    <StatusIcon size={16} strokeWidth={1.8} aria-hidden />
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        {visibleDrafts.length > 0 ? (
          <div className="publish-list">
            {visibleDrafts.map((draft) => {
              const SourceIcon = publishSourceIcons[draft.sourceKind]
              const sourceLabel = publishSourceLabels[draft.sourceKind]
              const title = draft.sourceTitle ||
                (draft.sourceKind === 'daily'
                  ? draft.sourceId
                  : findItemTitle(draft.sourceKind, draft.sourceId, documentItems))
              const displayTitle = draft.sourceBlockPreview || title
              return (
                <button
                  className="content-item-card publish-card"
                  type="button"
                  key={draft.id}
                  data-minimap-anchor={`publish-${draft.id}`}
                  data-minimap-label={displayTitle}
                  onClick={() => onNavigate({ page: 'publish', draftId: draft.id })}
                >
                  <span
                    className="publish-source-icon"
                    role="img"
                    aria-label={sourceLabel}
                    title={sourceLabel}
                  >
                    <SourceIcon size={14} aria-hidden />
                  </span>
                  <strong title={draft.sourceBlockId ? title : undefined}>{displayTitle}</strong>
                  <span className="publish-targets">
                    <span
                      className="publish-target-icon"
                      role="img"
                      aria-label="X"
                      title="X"
                    >
                      <BrandMark name="x" size={13} />
                    </span>
                  </span>
                  <time>{formatDocumentTime(draft.updatedAt)}</time>
                  <ChevronRight size={15} aria-hidden />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="empty-state publish-empty">
            <Send size={27} />
            <strong>暂无{publishStatusLabels[activeStatus]}内容</strong>
            <span>从笔记、文章或文章段落中发起</span>
          </div>
        )}
      </section>
    </ScrollPage>
  )
}

type ProfileWork = {
  id: NoteDownUserProfile['links'][number]['id']
  label: string
  tone: string
  brand?: BrandName
  logo?: IconComponent
}

const profileWorks: ProfileWork[] = [
  { id: 'github', brand: 'github', label: 'GitHub', tone: 'github' },
  { id: 'website', logo: Globe, label: '个人网站', tone: 'website' },
  { id: 'figma', brand: 'figma', label: 'Figma', tone: 'figma' },
  { id: 'twitter', brand: 'twitter', label: 'Twitter', tone: 'twitter' },
]

const profileAddress = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
const formatActivityDate = (date: Date) =>
  new Intl.DateTimeFormat(getCurrentLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)

const formatActivityTime = (date: Date) =>
  new Intl.DateTimeFormat(getCurrentLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)

const profileDateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

function getDayDifference(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((endUtc - startUtc) / 86_400_000)
}

function buildProfileActivityTimeline(events: NoteDownActivityEvent[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const timelineStart = new Date(today)
  timelineStart.setDate(today.getDate() - 364)
  const firstDay = new Date(timelineStart)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - mondayOffset)
  const todayOffset = (today.getDay() + 6) % 7
  const gridEnd = new Date(today)
  gridEnd.setDate(today.getDate() + 6 - todayOffset)
  const weekCount = Math.ceil((getDayDifference(gridStart, gridEnd) + 1) / 7)
  const eventsByDay = new Map<string, NoteDownActivityEvent[]>()
  events.forEach((event) => {
    const date = new Date(event.occurredAt)
    if (!Number.isFinite(date.getTime())) return
    const key = profileDateKey(date)
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event])
  })
  const cells = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const inRange = date >= timelineStart && date <= today
    const dayEvents = eventsByDay.get(profileDateKey(date)) ?? []
    const level = inRange ? Math.min(4, dayEvents.length) : 0
    const count = (type: NoteDownActivityEvent['type']) =>
      dayEvents.filter((event) => event.type === type).length
    const details = [
      count('document') > 0 ? t('编辑 {count}', { count: count('document') }) : undefined,
      count('task') > 0 ? t('完成任务 {count}', { count: count('task') }) : undefined,
      count('clip') > 0 ? t('保存收藏 {count}', { count: count('clip') }) : undefined,
      count('publish') > 0 ? t('发布 {count}', { count: count('publish') }) : undefined,
    ].filter(Boolean)

    return {
      dateId: profileDateKey(date),
      dateLabel: formatActivityDate(date),
      detail: details.join(' · '),
      inRange,
      level,
    }
  })
  const months = []
  const firstMonth = new Date(timelineStart.getFullYear(), timelineStart.getMonth(), 1)
  if (firstMonth < gridStart) firstMonth.setMonth(firstMonth.getMonth() + 1)
  for (
    let cursor = firstMonth;
    cursor <= today;
    cursor.setMonth(cursor.getMonth() + 1)
  ) {
    months.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth() + 1}`,
      label: new Intl.DateTimeFormat(getCurrentLocale(), { month: 'short' }).format(cursor),
    })
  }
  const weekYears = Array.from({ length: weekCount }, (_, weekIndex) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + weekIndex * 7 + 3)
    return date.getFullYear()
  })

  return {
    cells,
    months,
    today,
    timelineStart,
    weekCount,
    weekYears,
  }
}

const profileEventMeta = (event: NoteDownActivityEvent) => {
  if (event.type === 'task') {
    return {
      icon: CheckCircle,
      title: t('完成了「{title}」', { title: event.title }),
      route: { page: 'library', kind: 'tasks' } as Route,
    }
  }
  if (event.type === 'clip') {
    const itemId = event.entityId.split('/').slice(1).join('/')
    return {
      icon: Bookmark,
      title: t('收藏了「{title}」', { title: event.title }),
      route: itemId
        ? { page: 'library', kind: 'clips', itemId } as Route
        : { page: 'library', kind: 'clips' } as Route,
    }
  }
  if (event.type === 'publish') {
    return {
      icon: Send,
      title: t('发布了「{title}」', { title: event.title }),
      route: { page: 'publish' } as Route,
    }
  }
  if (event.documentKind === 'daily') {
    return {
      icon: Calendar,
      title: t('更新了「{title}」', { title: event.title }),
      route: { page: 'today' } as Route,
    }
  }
  const itemId = event.entityId.split('/').slice(1).join('/')
  const kind = event.documentKind === 'articles' ? 'articles' : 'notes'
  return {
    icon: Edit,
    title: t('更新了「{title}」', { title: event.title }),
    route: itemId
      ? { page: 'library', kind, itemId } as Route
      : { page: 'library', kind } as Route,
  }
}

const profileActivityGroups = (events: NoteDownActivityEvent[]) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const groups = new Map<string, { label: string; events: NoteDownActivityEvent[] }>()
  events.slice(0, 30).forEach((event) => {
    const date = new Date(event.occurredAt)
    if (!Number.isFinite(date.getTime())) return
    const key = profileDateKey(date)
    const label = key === profileDateKey(today)
      ? t('今天')
      : key === profileDateKey(yesterday)
        ? t('昨天')
        : new Intl.DateTimeFormat(getCurrentLocale(), {
            month: 'long',
            day: 'numeric',
          }).format(date)
    const group = groups.get(key) ?? { label, events: [] }
    group.events.push(event)
    groups.set(key, group)
  })
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }))
}

type ProfileActivityCell = ReturnType<typeof buildProfileActivityTimeline>['cells'][number]

const getHeatmapPopoverPosition = (anchor: HTMLElement) => {
  const rect = anchor.getBoundingClientRect()
  const width = 208
  const left = Math.min(
    window.innerWidth - width - 12,
    Math.max(12, rect.left + rect.width / 2 - width / 2),
  )
  const below = rect.top < 86
  return {
    left,
    top: below ? rect.bottom + 9 : rect.top - 9,
    arrowX: rect.left + rect.width / 2 - left,
    below,
  }
}

function HeatmapActivityPopover({
  anchor,
  cell,
  onClose,
}: {
  anchor: HTMLElement
  cell: ProfileActivityCell
  onClose: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() => getHeatmapPopoverPosition(anchor))

  useLayoutEffect(() => {
    const updatePosition = () => setPosition(getHeatmapPopoverPosition(anchor))
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node
      if (!popoverRef.current?.contains(target) && !anchor.contains(target)) onClose()
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={popoverRef}
      className={`heatmap-cell-popover${position.below ? ' is-below' : ''}`}
      role="status"
      style={{
        '--heatmap-arrow-x': `${position.arrowX}px`,
        left: position.left,
        top: position.top,
      } as CSSProperties}
    >
      <strong>{cell.dateLabel}</strong>
      <span>{cell.detail || t('无记录')}</span>
    </div>,
    document.body,
  )
}

function ProfilePage({
  onNavigate,
  onNotice,
  documentItems,
  userProfile,
  onEditProfile,
  onChooseAvatar,
}: Pick<PageProps, 'onNavigate' | 'onNotice' | 'documentItems' | 'userProfile'> & {
  onEditProfile: () => void
  onChooseAvatar: () => void
}) {
  const { locale } = useI18n()
  const fallbackEvents = useMemo<NoteDownActivityEvent[]>(
    () => documentItems.flatMap((document) => {
      if (!Number.isFinite(Date.parse(document.updatedAt))) return []
      return [{
        id: `document:${document.kind}/${document.id}:${document.updatedAt.slice(0, 10)}`,
        type: document.kind === 'clips' ? 'clip' : 'document',
        entityId: `${document.kind}/${document.id}`,
        documentKind: document.kind,
        title: document.title,
        occurredAt: document.updatedAt,
      }]
    }),
    [documentItems],
  )
  const [activityEvents, setActivityEvents] = useState(fallbackEvents)
  const activity = useMemo(
    () => buildProfileActivityTimeline(activityEvents),
    [activityEvents, locale],
  )
  const timelineGroups = useMemo(
    () => profileActivityGroups(activityEvents),
    [activityEvents, locale],
  )
  const heatmapScrollRef = useRef<HTMLDivElement>(null)
  const heatmapDragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
  })
  const heatmapYearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heatmapReadyRef = useRef(false)
  const [draggingHeatmap, setDraggingHeatmap] = useState(false)
  const [heatmapEdges, setHeatmapEdges] = useState({ left: true, right: false })
  const [heatmapYear, setHeatmapYear] = useState(activity.today.getFullYear())
  const [heatmapYearVisible, setHeatmapYearVisible] = useState(false)
  const [heatmapPopover, setHeatmapPopover] = useState<{
    anchor: HTMLElement
    cell: ProfileActivityCell
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!window.noteDown?.listActivity) {
      setActivityEvents(fallbackEvents)
      return
    }
    void window.noteDown
      .listActivity({ libraryPath: loadSettings().libraryPath })
      .then((events) => {
        if (!cancelled) setActivityEvents(events)
      })
      .catch(() => {
        if (!cancelled) setActivityEvents(fallbackEvents)
      })
    return () => {
      cancelled = true
    }
  }, [fallbackEvents])

  const updateHeatmapEdges = () => {
    const scroller = heatmapScrollRef.current
    if (!scroller) return
    const next = {
      left: scroller.scrollLeft > 2,
      right: scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 2,
    }
    setHeatmapEdges((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    )
  }

  const revealHeatmapYear = () => {
    const scroller = heatmapScrollRef.current
    const frame = scroller?.querySelector<HTMLElement>('.profile-heatmap-frame')
    if (!scroller || !frame) return
    const relativeCenter = scroller.scrollLeft + scroller.clientWidth / 2 - frame.offsetLeft
    const weekIndex = Math.min(
      activity.weekCount - 1,
      Math.max(0, Math.floor(relativeCenter / frame.clientWidth * activity.weekCount)),
    )
    setHeatmapYear(activity.weekYears[weekIndex] ?? activity.today.getFullYear())
    setHeatmapYearVisible(true)
    if (heatmapYearTimerRef.current) clearTimeout(heatmapYearTimerRef.current)
    heatmapYearTimerRef.current = setTimeout(() => setHeatmapYearVisible(false), 720)
  }

  const handleHeatmapScroll = () => {
    setHeatmapPopover(null)
    updateHeatmapEdges()
    if (heatmapReadyRef.current) revealHeatmapYear()
  }

  useEffect(() => {
    heatmapReadyRef.current = false
    let readyFrame = 0
    const frame = requestAnimationFrame(() => {
      const scroller = heatmapScrollRef.current
      if (!scroller) return
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth
      updateHeatmapEdges()
      readyFrame = requestAnimationFrame(() => {
        heatmapReadyRef.current = true
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(readyFrame)
      heatmapReadyRef.current = false
      if (heatmapYearTimerRef.current) clearTimeout(heatmapYearTimerRef.current)
    }
  }, [activity.weekCount])

  const slideHeatmap = (direction: -1 | 1) => {
    const scroller = heatmapScrollRef.current
    if (!scroller) return
    scroller.scrollBy({
      left: direction * Math.max(280, scroller.clientWidth * 0.72),
      behavior: 'smooth',
    })
  }

  const finishHeatmapDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!heatmapDragRef.current.active || event.pointerId !== heatmapDragRef.current.pointerId) return
    heatmapDragRef.current.active = false
    setDraggingHeatmap(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="page-scroll profile-page">
      <section className="profile-summary">
        <button
          className="profile-avatar-button"
          type="button"
          aria-label={t('更换头像')}
          title={t('更换头像')}
          onClick={onChooseAvatar}
        >
          <span className={`large-avatar${userProfile.avatarURL ? '' : ' is-default'}`}>
            {userProfile.avatarURL ? (
              <img src={userProfile.avatarURL} alt="" />
            ) : (
              <img className="profile-default-avatar-mark" src={jotkeepMark} alt="" />
            )}
          </span>
          <span className="profile-avatar-edit" aria-hidden>
            <UserEdit size={18} strokeWidth={2} />
          </span>
        </button>
        <div className="profile-name-row">
          <h1>{`@${userProfile.username}`}</h1>
          <IconButton label="编辑个人资料" onClick={onEditProfile}>
            <Edit size={16} strokeWidth={1.8} />
          </IconButton>
        </div>
        <div className="profile-account-dock" role="region" aria-label={t('个人账号')}>
          {profileWorks.map(({ id, brand, logo: AccountLogo, label, tone }) => {
            const url = userProfile.links.find((link) => link.id === id)?.url ?? ''
            if (!url) return null
            const address = profileAddress(url)
            return (
              <button
              className={`profile-account-button is-${tone}`}
              type="button"
              key={id}
              aria-label={`${label}，${address}`}
              title={`${label} · ${address}`}
              onClick={() => {
                if (!window.noteDown) {
                  window.open(url, '_blank', 'noopener,noreferrer')
                  return
                }
                void window.noteDown.openExternal(url).catch(() => {
                  onNotice(t('无法打开该网址。'))
                })
              }}
            >
              <span className="profile-account-logo" aria-hidden>
                {brand
                  ? <BrandMark name={brand} size={16} />
                  : AccountLogo && <AccountLogo size={17} strokeWidth={2.1} />}
              </span>
              <span className="profile-account-address">{address}</span>
            </button>
            )
          })}
        </div>
      </section>

      <section className="activity-card" aria-label={t('内容活动热力图')}>
        <div
          className={[
            'profile-heatmap-stage',
            heatmapEdges.left && 'can-scroll-left',
            heatmapEdges.right && 'can-scroll-right',
          ].filter(Boolean).join(' ')}
        >
          <button
            className="heatmap-scroll-button is-left"
            type="button"
            aria-label={t('向前查看活动')}
            disabled={!heatmapEdges.left}
            onClick={() => slideHeatmap(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <div
            ref={heatmapScrollRef}
            className={`profile-heatmap-scroll${draggingHeatmap ? ' is-dragging' : ''}`}
            onScroll={handleHeatmapScroll}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              heatmapDragRef.current = {
                active: true,
                moved: false,
                pointerId: event.pointerId,
                startX: event.clientX,
                scrollLeft: event.currentTarget.scrollLeft,
              }
            }}
            onPointerMove={(event) => {
              if (
                !heatmapDragRef.current.active
                || event.pointerId !== heatmapDragRef.current.pointerId
              ) return
              if (Math.abs(event.clientX - heatmapDragRef.current.startX) > 3) {
                heatmapDragRef.current.moved = true
                setHeatmapPopover(null)
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.setPointerCapture(event.pointerId)
                }
                setDraggingHeatmap(true)
              }
              if (!heatmapDragRef.current.moved) return
              event.currentTarget.scrollLeft = heatmapDragRef.current.scrollLeft
                - (event.clientX - heatmapDragRef.current.startX)
            }}
            onPointerUp={finishHeatmapDrag}
            onPointerCancel={finishHeatmapDrag}
          >
            <div
              className="profile-heatmap-frame"
              style={{ minWidth: `${activity.weekCount * 18 - 4}px` }}
            >
              <div
                className="heatmap"
                style={{ gridTemplateColumns: `repeat(${activity.weekCount}, minmax(0, 1fr))` }}
                role="grid"
                aria-label={`${activity.timelineStart.getFullYear()} · ${t('内容活动热力图')}`}
              >
                {activity.cells.map((cell) => (
                  <button
                    type="button"
                    className={[
                      `profile-activity-cell level-${cell.level}`,
                      !cell.inRange && 'is-outside',
                    ].filter(Boolean).join(' ')}
                    key={cell.dateId}
                    aria-label={`${cell.dateLabel}，${cell.detail || t('无记录')}`}
                    disabled={!cell.inRange}
                    onPointerEnter={(event) => {
                      setHeatmapPopover({
                        anchor: event.currentTarget,
                        cell,
                      })
                    }}
                    onPointerLeave={(event) => {
                      setHeatmapPopover((current) =>
                        current?.anchor === event.currentTarget ? null : current,
                      )
                    }}
                    onFocus={(event) => {
                      setHeatmapPopover({
                        anchor: event.currentTarget,
                        cell,
                      })
                    }}
                    onBlur={(event) => {
                      setHeatmapPopover((current) =>
                        current?.anchor === event.currentTarget ? null : current,
                      )
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return
                      setHeatmapPopover({
                        anchor: event.currentTarget,
                        cell,
                      })
                    }}
                    onClick={(event) => {
                      if (event.detail !== 0 || heatmapDragRef.current.moved) return
                      setHeatmapPopover({
                        anchor: event.currentTarget,
                        cell,
                      })
                    }}
                  />
                ))}
              </div>
              <div
                className="profile-heatmap-months"
                style={{
                  gridTemplateColumns: `repeat(${activity.months.length}, minmax(0, 1fr))`,
                }}
                aria-hidden
              >
                {activity.months.map((month) => (
                  <span key={month.key}>{month.label}</span>
                ))}
              </div>
            </div>
          </div>
          <span
            className={`heatmap-year-overlay${heatmapYearVisible ? ' is-visible' : ''}`}
            aria-hidden
          >
            {heatmapYear}
          </span>
          <button
            className="heatmap-scroll-button is-right"
            type="button"
            aria-label={t('向后查看活动')}
            disabled={!heatmapEdges.right}
            onClick={() => slideHeatmap(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
      {heatmapPopover && (
        <HeatmapActivityPopover
          anchor={heatmapPopover.anchor}
          cell={heatmapPopover.cell}
          onClose={() => setHeatmapPopover(null)}
        />
      )}

      <section className="timeline-card">
        <header>
          <h2>{t('最近活动')}</h2>
        </header>
        <div className="timeline-scroll">
          {timelineGroups.length > 0 ? timelineGroups.map((group) => (
            <section className="timeline-group" aria-label={group.label} key={group.key}>
              <h3>{group.label}</h3>
              <div className="timeline-events">
                {group.events.map((event) => {
                  const meta = profileEventMeta(event)
                  return (
                    <TimelineItem
                      icon={meta.icon}
                      title={meta.title}
                      time={formatActivityTime(new Date(event.occurredAt))}
                      key={event.id}
                      onClick={() => onNavigate(meta.route)}
                    />
                  )
                })}
              </div>
            </section>
          )) : (
            <div className="empty-state profile-activity-empty">
              <Activity size={24} />
              <strong>{t('还没有活动')}</strong>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function TimelineItem({
  icon: Icon,
  title,
  time,
  onClick,
}: {
  icon: IconComponent
  title: string
  time: string
  onClick: () => void
}) {
  return (
    <button className="timeline-item" type="button" onClick={onClick}>
      <span>
        <Icon size={15} />
      </span>
      <strong>{title}</strong>
      <time>{time}</time>
    </button>
  )
}

type CommandIconTone = 'neutral' | 'blue' | 'green' | 'orange' | 'purple' | 'cyan'

type CommandItem = {
  id: string
  label: string
  hint: string
  icon: IconComponent
  tone: CommandIconTone
  route?: Route
  create?: {
    kind: CreatableDocumentKind
    projectId?: string
  }
  createClip?: true
  createTask?: true
}

type DocumentSearchResult = DocumentSummary & { excerpt: string }

const documentCommandIconTones: Record<DocumentKind, CommandIconTone> = {
  notes: 'blue',
  articles: 'purple',
  clips: 'orange',
}

function CommandPalette({
  open,
  route,
  projectItems,
  documentItems,
  taskItems,
  onClose,
  onNavigate,
  onCreateDocument,
  onCreateClip,
  onCreateTask,
}: {
  open: boolean
  route: Route
  projectItems: Project[]
  documentItems: DocumentSummary[]
  taskItems: TaskItem[]
  onClose: () => void
  onNavigate: (route: Route) => void
  onCreateDocument: (kind: CreatableDocumentKind, projectId?: string) => void
  onCreateClip: () => void
  onCreateTask: () => void
}) {
  const { locale } = useI18n()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [fullTextResults, setFullTextResults] = useState<DocumentSearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const currentProjectId = route.page === 'project' ? route.projectId : undefined
  const currentProject = projectItems.find((project) => project.id === currentProjectId)
  const normalized = query.trim().toLocaleLowerCase()
  const fullTextByKey = useMemo(
    () => new Map(fullTextResults.map((document) => [documentKey(document), document])),
    [fullTextResults],
  )
  const documentsForCommands = useMemo(() => {
    if (!normalized || fullTextResults.length === 0) return documentItems
    const existing = new Map(documentItems.map((document) => [documentKey(document), document]))
    const matched = fullTextResults.map((document) => ({
      ...existing.get(documentKey(document)),
      ...document,
      updatedAt: formatDocumentTime(document.updatedAt),
    }))
    const matchedKeys = new Set(matched.map(documentKey))
    return [...matched, ...documentItems.filter((document) => !matchedKeys.has(documentKey(document)))]
  }, [documentItems, fullTextResults, normalized])
  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: 'create-note',
        label: '新建笔记',
        hint: currentProject?.name ?? 'Markdown',
        icon: Edit,
        tone: 'blue',
        create: { kind: 'notes', projectId: currentProjectId },
      },
      {
        id: 'create-article',
        label: '新建文章',
        hint: currentProject?.name ?? 'Markdown',
        icon: Pen,
        tone: 'purple',
        create: { kind: 'articles', projectId: currentProjectId },
      },
      {
        id: 'create-clip',
        label: '新建收藏',
        hint: currentProject?.name ?? 'Markdown',
        icon: Bookmark,
        tone: 'orange',
        create: { kind: 'clips', projectId: currentProjectId },
      },
      {
        id: 'capture-link',
        label: '收藏网址',
        hint: currentProject?.name ?? '网页卡片',
        icon: Link,
        tone: 'orange',
        createClip: true,
      },
      {
        id: 'create-task',
        label: '新建任务',
        hint: currentProject?.name ?? '任务',
        icon: Task,
        tone: 'green',
        createTask: true,
      },
      {
        id: 'today',
        label: '今天',
        hint: 'Daily Note',
        icon: Calendar,
        tone: 'blue',
        route: { page: 'today' },
      },
      {
        id: 'notes',
        label: '笔记',
        hint: t('{count} 篇', {
          count: documentItems.filter((item) => item.kind === 'notes' && !item.archivedAt).length,
        }),
        icon: Notes,
        tone: 'blue',
        route: { page: 'library', kind: 'notes' },
      },
      {
        id: 'articles',
        label: '文章',
        hint: t('{count} 篇', {
          count: documentItems.filter(
            (item) => item.kind === 'articles' && !item.archivedAt,
          ).length,
        }),
        icon: DocumentText,
        tone: 'purple',
        route: { page: 'library', kind: 'articles' },
      },
      {
        id: 'clips',
        label: '收藏',
        hint: t('{count} 条', {
          count: documentItems.filter((item) => item.kind === 'clips' && !item.archivedAt).length,
        }),
        icon: Bookmark,
        tone: 'orange',
        route: { page: 'library', kind: 'clips' },
      },
      {
        id: 'tasks',
        label: '任务',
        hint: t('{count} 项', { count: taskItems.length }),
        icon: Checklist,
        tone: 'green',
        route: { page: 'library', kind: 'tasks' },
      },
      ...projectItems.filter((project) => !project.archivedAt).map((project) => ({
        id: `project:${project.id}`,
        label: project.name,
        hint: '项目',
        icon: Folder,
        tone: 'cyan' as const,
        route: { page: 'project', projectId: project.id } as Route,
      })),
      ...documentsForCommands.filter((document) => !document.archivedAt).map((document) => ({
        id: `document:${documentKey(document)}`,
        label: document.title,
        hint: [
          documentKindLabels[document.kind],
          getProjectName(projectItems, document.projectId),
          fullTextByKey.get(documentKey(document))?.excerpt,
        ].filter(Boolean).join(' · '),
        icon: libraryIcons[document.kind],
        tone: documentCommandIconTones[document.kind],
        route: { page: 'library', kind: document.kind, itemId: document.id } as Route,
      })),
      {
        id: 'archive',
        label: '归档',
        hint: '已归档文档',
        icon: ArchiveBox,
        tone: 'neutral',
        route: { page: 'archive' },
      },
      {
        id: 'publish',
        label: '发布',
        hint: '创作流程',
        icon: Send,
        tone: 'purple',
        route: { page: 'publish' },
      },
      {
        id: 'profile',
        label: '个人空间',
        hint: '资料与设置',
        icon: UserCircle,
        tone: 'green',
        route: { page: 'profile' },
      },
    ],
    [
      currentProject?.name,
      currentProjectId,
      documentItems,
      documentsForCommands,
      fullTextByKey,
      locale,
      projectItems,
      taskItems,
    ],
  )
  const filtered = commands.filter((command) =>
    `${command.label} ${t(command.label)} ${command.hint}`
      .toLocaleLowerCase()
      .includes(normalized),
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => setActiveIndex(0), [query])

  useEffect(() => {
    if (!open) return
    resultsRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, normalized, open])

  useEffect(() => {
    if (!open || !normalized || !window.noteDown) {
      setFullTextResults([])
      return
    }
    setFullTextResults([])
    let cancelled = false
    const timeout = window.setTimeout(() => {
      window.noteDown
        ?.searchDocuments({
          libraryPath: loadSettings().libraryPath,
          query: normalized,
          limit: 20,
        })
        .then((results) => {
          if (!cancelled) {
            setFullTextResults(results)
            setActiveIndex(0)
          }
        })
        .catch(() => {
          if (!cancelled) setFullTextResults([])
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [normalized, open])

  const choose = (item?: CommandItem) => {
    if (!item) return
    if (item.create) {
      onCreateDocument(item.create.kind, item.create.projectId)
    } else if (item.createClip) {
      onCreateClip()
    } else if (item.createTask) {
      onCreateTask()
    } else if (item.route) {
      onNavigate(item.route)
    }
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % filtered.length)
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length)
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(filtered[activeIndex])
    }
  }

  if (!open) return null

  return (
    <div
      className="palette-backdrop command-palette-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('搜索或前往')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label>
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            placeholder={t('搜索笔记、项目或命令')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
        <div className="command-results" ref={resultsRef}>
          <span className="command-group-label">{t('结果')}</span>
          {filtered.map((item, index) => {
            const Icon = item.icon
            return (
              <button
                className={activeIndex === index ? 'is-active' : ''}
                data-command-index={index}
                type="button"
                key={item.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(item)}
              >
                <span className={`command-result-icon is-${item.tone}`}>
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <strong>{t(item.label)}</strong>
                <span>{t(item.hint)}</span>
                <span className="command-enter">↵</span>
              </button>
            )
          })}
          {filtered.length === 0 && <p className="no-results">{t('没有匹配结果')}</p>}
        </div>
      </section>
    </div>
  )
}

const projectNamesStorageKey = 'note-down.project-names'
const projectItemsStorageKey = 'note-down.projects.v1'
const taskItemsStorageKey = 'note-down.tasks.v1'

type DocumentTasksUpdate = {
  documentId: string
  projectId?: string
  source: string
  tasks: DocumentTaskSnapshot[]
}

const reconcileDocumentTasks = (
  current: TaskItem[],
  update: DocumentTasksUpdate,
) => {
  const incoming = new Map(update.tasks.map((task) => [task.id, task]))
  const retainedBlockIds = new Set<string>()
  let changed = false
  const next = current.flatMap((task) => {
    if (task.sourceDocumentId !== update.documentId) return [task]
    const documentTask = task.sourceBlockId
      ? incoming.get(task.sourceBlockId)
      : undefined
    if (!documentTask) {
      changed = true
      return []
    }
    retainedBlockIds.add(documentTask.id)
    const merged: TaskItem = {
      ...task,
      title: documentTask.title || '未命名任务',
      date: documentTask.due && documentTask.due !== '-' ? documentTask.due : '无日期',
      status: documentTask.checked ? 'Done' : 'Todo',
      source: update.source,
    }
    if (
      merged.title !== task.title
      || merged.date !== task.date
      || merged.status !== task.status
      || merged.source !== task.source
    ) {
      changed = true
      return [merged]
    }
    return [task]
  })

  const additions = update.tasks
    .filter((task) => !retainedBlockIds.has(task.id))
    .map<TaskItem>((task) => ({
      id: `document-task:${update.documentId}:${task.id}`,
      title: task.title || '未命名任务',
      projectId: update.projectId,
      date: task.due && task.due !== '-' ? task.due : '无日期',
      status: task.checked ? 'Done' : 'Todo',
      source: update.source,
      sourceDocumentId: update.documentId,
      sourceBlockId: task.id,
    }))
  if (additions.length > 0) changed = true
  return changed ? [...additions, ...next] : current
}

const trackPendingStorageWrite = <Value,>(pending: Promise<Value>) => {
  window.dispatchEvent(
    new CustomEvent('note-down:save-pending', { detail: { pending } }),
  )
  return pending
}

function loadProjectItems() {
  const savedProjects = window.localStorage.getItem(projectItemsStorageKey)
  if (savedProjects) {
    try {
      const stored = JSON.parse(savedProjects) as Project[]
      if (Array.isArray(stored)) return stored
    } catch {
      // Continue with the legacy name-only store.
    }
  }
  const savedNames = window.localStorage.getItem(projectNamesStorageKey)
  if (!savedNames) return projects
  try {
    const names = JSON.parse(savedNames) as Record<string, string>
    return projects.map((project) => ({ ...project, name: names[project.id] || project.name }))
  } catch {
    return projects
  }
}

function loadTaskItems() {
  const saved = window.localStorage.getItem(taskItemsStorageKey)
  if (!saved) return tasks
  try {
    const stored = JSON.parse(saved) as TaskItem[]
    const validStatuses = new Set<TaskItem['status']>(['Todo', 'Doing', 'Done', 'Cancelled'])
    return stored.filter(
      (task) =>
        task &&
        typeof task.id === 'string' &&
        typeof task.title === 'string' &&
        typeof task.date === 'string' &&
        validStatuses.has(task.status),
    )
  } catch {
    return tasks
  }
}

export default function App() {
  useI18n()
  const [route, setRoute] = useState<Route>({ page: 'today' })
  const [projectItems, setProjectItems] = useState(() =>
    window.noteDown ? [] : loadProjectItems(),
  )
  const [documentItems, setDocumentItems] = useState(() =>
    window.noteDown ? [] : loadDocumentItems(),
  )
  const [taskItems, setTaskItems] = useState(() =>
    window.noteDown ? [] : loadTaskItems(),
  )
  const [projectFilters, setProjectFilters] = useState<Record<string, DocumentKind | 'all'>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [updateState, setUpdateState] = useState<NoteDownUpdateState | null>(null)
  const [saveState, setSaveState] = useState<DocumentSaveState>('saved')
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [editingTaskIsNew, setEditingTaskIsNew] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editingProjectIsNew, setEditingProjectIsNew] = useState(false)
  const [projectDanger, setProjectDanger] = useState<{
    project: Project
    action: ProjectDangerAction
    anchor: HTMLElement
  } | null>(null)
  const [taskDanger, setTaskDanger] = useState<{
    task: TaskItem
    anchor: HTMLElement
  } | null>(null)
  const [userProfile, setUserProfile] = useState(() =>
    window.noteDown ? loadStoredProfile() : loadPreviewProfile(),
  )
  const [publishItems, setPublishItems] = useState(() =>
    window.noteDown ? [] : loadPreviewPublishDrafts(),
  )
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [clipCaptureOpen, setClipCaptureOpen] = useState(false)
  const [versionDocument, setVersionDocument] = useState<{
    id: string
    title: string
  } | null>(null)
  const [projectStoreReady, setProjectStoreReady] = useState(!window.noteDown)
  const [taskStoreReady, setTaskStoreReady] = useState(!window.noteDown)
  const modalOpen = Boolean(
    editingTask
      || editingProject
      || projectDanger
      || taskDanger
      || profileEditorOpen
      || clipCaptureOpen
      || versionDocument,
  )
  const documentTasksRef = useRef(new Map<string, DocumentTasksUpdate>())
  const syncDocumentTasks = useCallback(
    (
      documentId: string,
      projectId: string | undefined,
      source: string,
      documentTasks: DocumentTaskSnapshot[],
    ) => {
      const update = { documentId, projectId, source, tasks: documentTasks }
      documentTasksRef.current.set(documentId, update)
      if (!taskStoreReady) return
      setTaskItems((current) => reconcileDocumentTasks(current, update))
    },
    [taskStoreReady],
  )

  useEffect(() => {
    if (!taskStoreReady || documentTasksRef.current.size === 0) return
    setTaskItems((current) =>
      [...documentTasksRef.current.values()].reduce(reconcileDocumentTasks, current),
    )
  }, [taskStoreReady])

  const dismissProjectEditor = () => {
    if (editingProjectIsNew && editingProject) {
      setProjectItems((current) =>
        current.filter((project) => project.id !== editingProject.id),
      )
    }
    setEditingProject(null)
    setEditingProjectIsNew(false)
  }

  useEffect(() => {
    if (!window.noteDown) return
    const pendingSaves = new Set<Promise<unknown>>()
    const trackSave = (event: Event) => {
      const pending = (
        event as CustomEvent<{ pending?: Promise<unknown> }>
      ).detail?.pending
      if (!pending) return
      pendingSaves.add(pending)
      void pending.finally(() => pendingSaves.delete(pending)).catch(() => {})
    }
    const stopClosing = window.noteDown.onBeforeClose(() => {
      const pending = [...pendingSaves]
      window.dispatchEvent(
        new CustomEvent('note-down:flush-request', { detail: { pending } }),
      )
      void Promise.allSettled([...new Set(pending)]).then((results) => {
        window.noteDown?.completeClose(
          results.every((result) => result.status === 'fulfilled'),
        )
      })
    })
    const stopRecovery = window.noteDown.onStorageRecovery(({ filename }) => {
      setNotice(`${filename} 无法读取，原内容已保留为恢复副本。`)
    })
    window.addEventListener('note-down:save-pending', trackSave)
    return () => {
      stopClosing()
      stopRecovery()
      window.removeEventListener('note-down:save-pending', trackSave)
    }
  }, [])

  useEffect(() => {
    const bridge = window.noteDown
    if (!bridge?.checkForUpdates) return
    const stopListening = bridge.onUpdateState(setUpdateState)
    void bridge.checkForUpdates().then(setUpdateState).catch(() => {})
    return stopListening
  }, [])

  useEffect(() => {
    if (!window.noteDown) return
    let cancelled = false
    const openDocument = async (documentId: string) => {
      const targetRoute = routeFromDocumentId(documentId)
      if (!targetRoute) return
      try {
        const documents = await window.noteDown?.listDocuments({
          libraryPath: loadSettings().libraryPath,
        })
        if (cancelled || !documents) return
        setDocumentItems(
          documents.map((document) => ({
            ...document,
            updatedAt: formatDocumentTime(document.updatedAt),
          })),
        )
        setRoute(targetRoute)
        window.noteDown?.acknowledgeDocumentOpen(documentId)
      } catch {
        if (!cancelled) setNotice('无法打开 Spotlight 搜索结果。')
      }
    }
    const stopListening = window.noteDown.onOpenDocument((documentId) => {
      void openDocument(documentId)
    })
    void window.noteDown.consumePendingDocumentOpen().then((documentId) => {
      if (documentId) void openDocument(documentId)
    })
    return () => {
      cancelled = true
      stopListening()
    }
  }, [])

  useEffect(() => {
    if (!window.noteDown) return
    let cancelled = false
    const libraryPath = loadSettings().libraryPath
    const settings = loadSettings()
    void window.noteDown
      .configureTaskNotifications({ enabled: settings.taskNotifications })
      .catch(() => {
        if (!cancelled) setNotice('任务提醒配置失败。')
      })
    void window.noteDown
      .configureBackup({
        enabled: settings.backupEnabled,
        libraryPath,
        attachmentsPath: settings.attachmentsPath,
        frequency: settings.backupFrequency,
        retention: settings.backupRetention,
      })
      .catch(() => {
        if (!cancelled) setNotice('自动备份配置失败。')
      })
    const refreshDocuments = async () => {
      try {
        const documents = await window.noteDown?.listDocuments({ libraryPath })
        if (!cancelled && documents) {
          setDocumentItems(
            documents.map((document) => ({
              ...document,
              updatedAt: formatDocumentTime(document.updatedAt),
            })),
          )
        }
      } catch {
        if (!cancelled) setNotice('资料库扫描失败，请检查目录权限。')
      }
    }
    const stopWatching = window.noteDown.onDocumentsChanged(() => void refreshDocuments())
    void window.noteDown.watchDocuments({ libraryPath }).catch(() => {
      if (!cancelled) setNotice('无法监听资料库的外部变化。')
    })
    void refreshDocuments()
    return () => {
      cancelled = true
      stopWatching()
    }
  }, [])

  useEffect(() => {
    if (!window.noteDown) return
    let cancelled = false
    const libraryPath = loadSettings().libraryPath
    Promise.allSettled([
      window.noteDown.listTasks({ libraryPath }),
      window.noteDown.listProjects({ libraryPath }),
      window.noteDown.loadProfile({ libraryPath }),
      window.noteDown.listPublishDrafts({ libraryPath }),
    ])
      .then(([tasksResult, projectsResult, profileResult, publishResult]) => {
        if (cancelled) return
        const failed: string[] = []
        if (tasksResult.status === 'fulfilled') {
          setTaskItems(tasksResult.value ?? [])
          setTaskStoreReady(true)
        } else {
          failed.push('任务')
        }
        if (projectsResult.status === 'fulfilled') {
          setProjectItems(projectsResult.value ?? [])
          setProjectStoreReady(true)
        } else {
          failed.push('项目')
        }
        if (profileResult.status === 'fulfilled') {
          setUserProfile(profileResult.value ?? loadStoredProfile())
        } else {
          failed.push('个人资料')
        }
        if (publishResult.status === 'fulfilled') {
          setPublishItems(publishResult.value)
        } else {
          failed.push('发布草稿')
        }
        if (failed.length > 0) setNotice(`${failed.join('、')}读取失败。`)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const openSettings = () => {
    dismissProjectEditor()
    window.location.hash = 'settings'
  }

  const downloadUpdate = async () => {
    if (!window.noteDown?.downloadUpdate) return
    try {
      const nextState = await window.noteDown.downloadUpdate()
      setUpdateState(nextState)
      if (nextState.status === 'ready') {
        setNotice(`Jotkeep ${nextState.latestVersion} 安装包已打开。`)
      }
    } catch {
      setNotice('新版下载或校验失败，请稍后重试。')
    }
  }

  const createDocument = useCallback(
    async (kind: CreatableDocumentKind, projectId?: string) => {
      const prefix = kind === 'notes' ? 'note' : kind === 'articles' ? 'article' : 'clip'
      const title = kind === 'notes'
        ? '未命名笔记'
        : kind === 'articles'
          ? '未命名文章'
          : '未命名收藏'
      const id = `${prefix}-${crypto.randomUUID()}`
      const documentId = `${kind}/${id}`
      const content = kind === 'clips'
        ? ['---', 'type: clip', 'tags: [收藏]', '---', '', `# ${title}`, '', ''].join('\n')
        : `# ${title}\n\n`

      try {
        const libraryPath = loadSettings().libraryPath
        if (window.noteDown) {
          await window.noteDown.saveDocument({ documentId, libraryPath, content, projectId })
        } else {
          window.localStorage.setItem(`note-down.preview-document.${documentId}`, content)
        }
        setDocumentItems((current) => [
          {
            id,
            kind,
            title,
            tags: kind === 'clips' ? ['收藏'] : [],
            projectId,
            updatedAt: '刚刚',
          },
          ...current.filter((document) => documentKey(document) !== `${kind}:${id}`),
        ])
        setRoute(
          projectId
            ? { page: 'project', projectId, itemKind: kind, itemId: id }
            : { page: 'library', kind, itemId: id },
        )
        setNotice(`${documentKindLabels[kind]}已创建。`)
      } catch {
        setNotice('创建失败，请检查资料库位置。')
      }
    },
    [],
  )

  const captureClip = async (url: string, projectId?: string) => {
    try {
      const libraryPath = loadSettings().libraryPath
      let captured: DocumentSummary
      if (window.noteDown) {
        captured = await window.noteDown.captureClip({
          url,
          libraryPath,
          projectId,
          attachmentsPath: loadSettings().attachmentsPath,
        })
      } else {
        const target = new URL(url)
        const id = `clip-${crypto.randomUUID()}`
        const title = target.hostname.replace(/^www\./, '')
        const documentId = `clips/${id}`
        const content = [
          '---',
          'type: clip',
          `source: ${JSON.stringify(target.toString())}`,
          'tags: [收藏]',
          '---',
          '',
          `# ${title}`,
          '',
          `[bookmark:${title}](${target.toString()})`,
          '',
        ].join('\n')
        window.localStorage.setItem(`note-down.preview-document.${documentId}`, content)
        captured = {
          id,
          kind: 'clips',
          title,
          tags: ['收藏'],
          projectId,
          updatedAt: new Date().toISOString(),
        }
      }
      const summary = { ...captured, updatedAt: '刚刚' }
      setDocumentItems((current) => [
        summary,
        ...current.filter((document) => documentKey(document) !== documentKey(summary)),
      ])
      setRoute(
        projectId
          ? { page: 'project', projectId, itemKind: 'clips', itemId: captured.id }
          : { page: 'library', kind: 'clips', itemId: captured.id },
      )
      setNotice('网页已收藏到本地。')
      return true
    } catch {
      setNotice('无法读取该网址，请检查链接或网络。')
      return false
    }
  }

  const captureSharedText = async (text: string) => {
    const body = text.trim()
    if (!body) return false
    const titleSource = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '共享摘录'
    const title = titleSource.replace(/\s+/g, ' ').slice(0, 42)
    const id = `clip-${crypto.randomUUID()}`
    const documentId = `clips/${id}`
    const capturedAt = new Date().toISOString()
    const quote = body.split(/\r?\n/).map((line) => `> ${line}`).join('\n')
    const content = [
      '---',
      'type: clip',
      'source: shared-text',
      `captured_at: ${capturedAt}`,
      'tags: [收藏]',
      '---',
      '',
      `# ${title}`,
      '',
      quote,
      '',
    ].join('\n')

    try {
      const libraryPath = loadSettings().libraryPath
      if (window.noteDown) {
        await window.noteDown.saveDocument({ documentId, libraryPath, content })
      } else {
        window.localStorage.setItem(`note-down.preview-document.${documentId}`, content)
      }
      const summary: DocumentSummary = {
        id,
        kind: 'clips',
        title,
        tags: ['收藏'],
        updatedAt: '刚刚',
      }
      setDocumentItems((current) => [
        summary,
        ...current.filter((document) => documentKey(document) !== documentKey(summary)),
      ])
      setRoute({ page: 'library', kind: 'clips', itemId: id })
      setNotice('摘录已收藏到本地。')
      return true
    } catch {
      setNotice('摘录保存失败，请检查资料库位置。')
      return false
    }
  }

  const captureSharedFile = async (token: string) => {
    if (!window.noteDown) return false
    try {
      const settings = loadSettings()
      const captured = await window.noteDown.importSharedFile({
        token,
        libraryPath: settings.libraryPath,
        attachmentsPath: settings.attachmentsPath,
      })
      const summary: DocumentSummary = { ...captured, updatedAt: '刚刚' }
      setDocumentItems((current) => [
        summary,
        ...current.filter((document) => documentKey(document) !== documentKey(summary)),
      ])
      setRoute({ page: 'library', kind: 'clips', itemId: captured.id })
      setNotice('共享文件已收藏到本地。')
      return true
    } catch {
      setNotice('共享文件导入失败，暂存内容已保留，可再次尝试。')
      return false
    }
  }

  useEffect(() => {
    if (!window.noteDown) return
    let cancelled = false
    const captureSharedRequest = (request: NoteDownCaptureRequest) => {
      if (cancelled) return
      if (request.kind === 'url') void captureClip(request.value)
      else if (request.kind === 'text') void captureSharedText(request.value)
      else void captureSharedFile(request.value)
    }
    const stopListening = window.noteDown.onCapture(captureSharedRequest)
    void window.noteDown.consumePendingCapture().then((request) => {
      if (request) captureSharedRequest(request)
    })
    return () => {
      cancelled = true
      stopListening()
    }
  }, [])

  useEffect(() => {
    const syncTrafficLights = () => {
      if (window.location.hash !== '#settings') {
        window.noteDown?.setTrafficLightsVisible(!sidebarCollapsed)
      }
    }
    syncTrafficLights()
    window.addEventListener('hashchange', syncTrafficLights)
    return () => window.removeEventListener('hashchange', syncTrafficLights)
  }, [sidebarCollapsed])

  useEffect(() => {
    const names = Object.fromEntries(projectItems.map((project) => [project.id, project.name]))
    window.localStorage.setItem(projectNamesStorageKey, JSON.stringify(names))
    window.localStorage.setItem(projectItemsStorageKey, JSON.stringify(projectItems))
    if (projectStoreReady && window.noteDown) {
      void trackPendingStorageWrite(
        window.noteDown.saveProjects({
          libraryPath: loadSettings().libraryPath,
          projects: projectItems,
        }),
      )
        .catch(() => setNotice('项目保存失败。'))
    }
  }, [projectItems, projectStoreReady])

  useEffect(() => {
    window.localStorage.setItem(taskItemsStorageKey, JSON.stringify(taskItems))
    if (taskStoreReady && window.noteDown) {
      void trackPendingStorageWrite(
        window.noteDown.saveTasks({
          libraryPath: loadSettings().libraryPath,
          tasks: taskItems,
        }),
      )
        .catch(() => setNotice('任务保存失败。'))
    }
  }, [taskItems, taskStoreReady])

  useEffect(() => {
    window.localStorage.setItem(documentIndexStorageKey, JSON.stringify(documentItems))
  }, [documentItems])

  useEffect(() => {
    window.localStorage.setItem(publishStorageKey, JSON.stringify(publishItems))
  }, [publishItems])

  useEffect(() => {
    const handleSaveState = (event: Event) => {
      setSaveState((event as CustomEvent<DocumentSaveState>).detail)
    }
    window.addEventListener('note-down:save-state', handleSaveState)
    return () => window.removeEventListener('note-down:save-state', handleSaveState)
  }, [])

  useEffect(() => {
    const handleDocumentSaved = (event: Event) => {
      const detail = (
        event as CustomEvent<{ documentId: string; title: string; tags?: string[] }>
      ).detail
      const [kind, ...idSegments] = detail.documentId.split('/')
      const id = idSegments.join('/')
      if (!id || (kind !== 'notes' && kind !== 'articles' && kind !== 'clips')) return
      setDocumentItems((current) =>
        current.map((document) =>
          document.kind === kind && document.id === id
            ? { ...document, title: detail.title, tags: detail.tags, updatedAt: '刚刚' }
            : document,
        ),
      )
    }
    window.addEventListener('note-down:document-saved', handleDocumentSaved)
    return () => window.removeEventListener('note-down:document-saved', handleDocumentSaved)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (modalOpen) setCommandOpen(false)
  }, [modalOpen])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (window.location.hash === '#settings') return
      if (event.metaKey && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        if (modalOpen) return
        setCommandOpen((open) => !open)
      }
      if (event.metaKey && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault()
        const defaultKind = loadSettings().defaultDocumentKind
        const kind =
          route.page === 'library' && route.kind === 'articles'
            ? 'articles'
            : route.page === 'project' && route.itemKind === 'articles'
              ? 'articles'
              : defaultKind
        void createDocument(kind, route.page === 'project' ? route.projectId : undefined)
      }
      if (event.metaKey && event.key === ',') {
        event.preventDefault()
        openSettings()
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [createDocument, modalOpen, route])

  const navigate = (nextRoute: Route) => {
    dismissProjectEditor()
    setProjectDanger(null)
    setTaskDanger(null)
    setRoute(nextRoute)
  }
  const setDocumentProject = async (document: DocumentSummary, projectId?: string) => {
    try {
      if (window.noteDown) {
        await window.noteDown.setDocumentProject({
          documentId: `${document.kind}/${document.id}`,
          libraryPath: loadSettings().libraryPath,
          projectId,
        })
      }
      setDocumentItems((current) =>
        current.map((item) =>
          documentKey(item) === documentKey(document) ? { ...item, projectId } : item,
        ),
      )
      setNotice(projectId ? '已更新所属项目。' : '已移出项目。')
    } catch {
      setNotice('项目归属保存失败。')
    }
  }
  const setDocumentArchived = async (document: DocumentSummary, archived: boolean) => {
    const archivedAt = archived ? new Date().toISOString() : undefined
    const documentId = `${document.kind}/${document.id}`
    try {
      if (window.noteDown) {
        await window.noteDown.setDocumentArchived({
          documentId,
          libraryPath: loadSettings().libraryPath,
          archived,
        })
      }
      setDocumentItems((current) =>
        current.map((item) =>
          documentKey(item) === documentKey(document) ? { ...item, archivedAt } : item,
        ),
      )
      setNotice(archived ? '文档已归档。' : '文档已恢复。')
      return true
    } catch {
      setNotice(archived ? '归档失败，请检查资料库权限。' : '恢复失败，请重试。')
      return false
    }
  }
  const archiveCurrentDocument = () => {
    const kind =
      route.page === 'library'
        ? route.kind
        : route.page === 'project'
          ? route.itemKind
          : undefined
    const itemId =
      route.page === 'library'
        ? route.itemId
        : route.page === 'project'
          ? route.itemId
          : undefined
    if (!itemId || !kind || kind === 'tasks') return
    const document = documentItems.find((item) => item.kind === kind && item.id === itemId)
    if (!document) return
    void setDocumentArchived(document, true).then((archived) => {
      if (!archived) return
      if (route.page === 'project') setRoute({ page: 'project', projectId: route.projectId })
      else setRoute({ page: 'library', kind })
    })
  }
  const trashDocument = async (document: DocumentSummary) => {
    if (
      loadSettings().confirmDelete &&
      !window.confirm(`将“${document.title}”移到 macOS 废纸篓？`)
    ) {
      return
    }
    const documentId = `${document.kind}/${document.id}`
    try {
      if (window.noteDown) {
        await window.noteDown.trashDocument({
          documentId,
          libraryPath: loadSettings().libraryPath,
        })
      } else {
        window.localStorage.removeItem(`note-down.preview-document.${documentId}`)
      }
      setDocumentItems((current) =>
        current.filter((item) => documentKey(item) !== documentKey(document)),
      )
      setNotice('文档已移到废纸篓。')
    } catch {
      setNotice('无法移动到废纸篓，请检查文件权限。')
    }
  }
  const saveProject = (project: Project) => {
    setProjectItems((current) =>
      current.map((item) => (item.id === project.id ? project : item)),
    )
    setEditingProject(null)
    setEditingProjectIsNew(false)
    setNotice('项目已保存。')
  }
  const createProject = () => {
    const id = `project-${crypto.randomUUID()}`
    const project: Project = {
      id,
      name: '新项目',
      description: '',
      color: projectColors[Math.floor(Math.random() * projectColors.length)],
      status: 'Active',
    }
    setProjectItems((current) => [...current, project])
    setEditingProject(project)
    setEditingProjectIsNew(true)
    setRoute({ page: 'project', projectId: id })
  }
  const closeProjectEditor = () => {
    const newProjectId = editingProjectIsNew ? editingProject?.id : undefined
    dismissProjectEditor()
    if (newProjectId && route.page === 'project' && route.projectId === newProjectId) {
      setRoute({ page: 'today' })
    }
  }
  const restoreProject = async (project: Project) => {
    const assignedDocuments = documentItems.filter(
      (document) => document.projectId === project.id && document.archivedAt,
    )
    try {
      if (window.noteDown) {
        const libraryPath = loadSettings().libraryPath
        await Promise.all(
          assignedDocuments.map((document) =>
            window.noteDown!.setDocumentArchived({
              documentId: `${document.kind}/${document.id}`,
              libraryPath,
              archived: false,
            }),
          ),
        )
      }
      setDocumentItems((current) =>
        current.map((document) =>
          document.projectId === project.id
            ? { ...document, archivedAt: undefined }
            : document,
        ),
      )
      setProjectItems((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, archivedAt: undefined } : item,
        ),
      )
      setNotice(assignedDocuments.length > 0 ? '项目与文档已恢复。' : '项目已恢复。')
    } catch {
      setNotice('项目恢复失败。')
    }
  }
  const requestProjectAction = (
    project: Project,
    action: ProjectDangerAction,
    anchor: HTMLElement,
  ) => {
    setProjectDanger((current) =>
      current?.project.id === project.id && current.action === action
        ? null
        : { project, action, anchor },
    )
  }
  const applyProjectAction = async () => {
    if (!projectDanger) return
    const { project, action } = projectDanger
    const assignedDocuments = documentItems.filter((document) => document.projectId === project.id)
    const assignedTasks = taskItems.filter((task) => task.projectId === project.id)
    try {
      const libraryPath = loadSettings().libraryPath
      if (action === 'archive') {
        const archivedAt = new Date().toISOString()
        if (window.noteDown) {
          await Promise.all(
            assignedDocuments.map((document) =>
              window.noteDown!.setDocumentArchived({
                documentId: `${document.kind}/${document.id}`,
                libraryPath,
                archived: true,
              }),
            ),
          )
        }
        setDocumentItems((current) =>
          current.map((document) =>
            document.projectId === project.id ? { ...document, archivedAt } : document,
          ),
        )
        setProjectItems((current) =>
          current.map((item) => item.id === project.id ? { ...item, archivedAt } : item),
        )
        setRoute({ page: 'archive' })
        setNotice(assignedDocuments.length > 0 ? '项目与文档已归档。' : '项目已归档。')
      } else {
        if (window.noteDown) {
          await Promise.all(
            assignedDocuments.map((document) =>
              window.noteDown!.trashDocument({
                documentId: `${document.kind}/${document.id}`,
                libraryPath,
              }),
            ),
          )
        } else {
          assignedDocuments.forEach((document) => {
            window.localStorage.removeItem(
              `note-down.preview-document.${document.kind}/${document.id}`,
            )
          })
        }
        const deleted = new Set(assignedDocuments.map(documentKey))
        setDocumentItems((current) =>
          current.filter((document) => !deleted.has(documentKey(document))),
        )
        setTaskItems((current) =>
          current.map((task) =>
            task.projectId === project.id ? { ...task, projectId: undefined } : task,
          ),
        )
        setProjectItems((current) => current.filter((item) => item.id !== project.id))
        if (route.page === 'project' && route.projectId === project.id) setRoute({ page: 'today' })
        setNotice(
          assignedDocuments.length > 0
            ? '项目已删除，文档已移到废纸篓。'
            : '项目已删除。',
        )
      }
      setEditingProject(null)
      setEditingProjectIsNew(false)
      setProjectDanger(null)
    } catch {
      setNotice(action === 'archive' ? '项目归档失败。' : '项目删除失败。')
    }
  }
  const saveUserProfile = async (profile: NoteDownUserProfile) => {
    const value = {
      username: profile.username,
      avatarPath: profile.avatarPath,
      links: profile.links,
    }
    try {
      const saved = window.noteDown
        ? await window.noteDown.saveProfile({
            libraryPath: loadSettings().libraryPath,
            profile: value,
          })
        : { ...profile, ...value }
      window.localStorage.setItem(profileStorageKey, JSON.stringify(saved))
      setUserProfile(saved)
      setProfileEditorOpen(false)
      setNotice('个人资料已保存。')
    } catch {
      setNotice('个人资料保存失败，请检查网址或资料库权限。')
    }
  }
  const chooseProfileAvatar = async () => {
    if (!window.noteDown) {
      setNotice('头像选择需要在 Mac App 中使用。')
      return
    }
    try {
      const avatar = await window.noteDown.chooseProfileAvatar({
        libraryPath: loadSettings().libraryPath,
      })
      if (!avatar) return
      await saveUserProfile({ ...userProfile, ...avatar })
    } catch {
      setNotice('头像保存失败，请选择 20 MB 以内的图片。')
    }
  }
  const initiateCurrentPublish = async () => {
    const sourceKind =
      route.page === 'library'
        ? route.kind
        : route.page === 'project'
          ? route.itemKind
          : undefined
    const sourceId =
      route.page === 'library'
        ? route.itemId
        : route.page === 'project'
          ? route.itemId
          : undefined
    if (
      !sourceId ||
      (sourceKind !== 'notes' && sourceKind !== 'articles')
    ) {
      return
    }
    if (saveState !== 'saved') {
      setNotice(saveState === 'saving' ? '内容保存完成后再发起发布。' : '请先解决保存错误。')
      return
    }
    try {
      const libraryPath = loadSettings().libraryPath
      let draft: PublishDraft
      if (window.noteDown) {
        draft = await window.noteDown.initiatePublishDraft({
          libraryPath,
          sourceKind,
          sourceId,
        })
      } else {
        const existing = publishItems.find(
          (item) =>
            item.sourceKind === sourceKind &&
            item.sourceId === sourceId &&
            item.status !== 'Published',
        )
        if (existing) {
          draft = existing
        } else {
          const sourceSnapshot = window.localStorage.getItem(
            `note-down.preview-document.${sourceKind}/${sourceId}`,
          ) ?? ''
          draft = {
            id: `publish-${crypto.randomUUID()}`,
            sourceKind,
            sourceId,
            sourceRevision: `${sourceSnapshot.length}-${Date.now()}`,
            sourceTitle: findItemTitle(sourceKind, sourceId, documentItems),
            sourceSnapshot,
            status: 'Preparing',
            targets: ['x'],
            updatedAt: new Date().toISOString(),
          }
        }
      }
      setPublishItems((current) => [draft, ...current.filter((item) => item.id !== draft.id)])
      setRoute({ page: 'publish', draftId: draft.id })
      setNotice(
        draft.sourceChanged ? '已打开 X 发布草稿，来源文档有新修改。' : 'X 发布草稿已准备。',
      )
    } catch {
      setNotice('无法固定当前发布版本，请检查来源文档。')
    }
  }
  const initiateParagraphPublish = async (
    sourceKind: PublishSourceKind,
    sourceId: string,
    paragraph: PublishParagraphPayload,
  ) => {
    if (saveState !== 'saved') {
      setNotice(saveState === 'saving' ? '内容保存完成后再发布此段。' : '请先解决保存错误。')
      return
    }
    try {
      const libraryPath = loadSettings().libraryPath
      let draft: PublishDraft
      if (window.noteDown) {
        draft = await window.noteDown.initiatePublishDraft({
          libraryPath,
          sourceKind,
          sourceId,
          sourceBlock: paragraph,
        })
      } else {
        const existing = publishItems.find(
          (item) =>
            item.sourceKind === sourceKind &&
            item.sourceId === sourceId &&
            item.sourceBlockId === paragraph.id &&
            item.status !== 'Published',
        )
        if (existing) {
          draft = existing
        } else {
          const documentSnapshot = window.localStorage.getItem(
            `note-down.preview-document.${sourceKind}/${sourceId}`,
          ) ?? ''
          draft = {
            id: `publish-${crypto.randomUUID()}`,
            sourceKind,
            sourceId,
            sourceRevision: `${documentSnapshot.length}-${Date.now()}`,
            sourceTitle:
              sourceKind === 'daily'
                ? sourceId
                : findItemTitle(sourceKind, sourceId, documentItems),
            sourceSnapshot: paragraph.markdown,
            sourceBlockId: paragraph.id,
            sourceBlockPreview: paragraph.preview.slice(0, 160),
            status: 'Preparing',
            targets: ['x'],
            updatedAt: new Date().toISOString(),
          }
        }
      }
      setPublishItems((current) => [draft, ...current.filter((item) => item.id !== draft.id)])
      setRoute({ page: 'publish', draftId: draft.id })
      setNotice('此段已加入 X 发布草稿。')
    } catch {
      setNotice('无法创建发布草稿，请先确认文档已保存。')
    }
  }
  const updatePublishDraft = async (
    draftId: string,
    update: { status?: PublishDraftStatus; targets?: PublishTarget[]; refreshSource?: boolean },
  ) => {
    try {
      const current = publishItems.find((draft) => draft.id === draftId)
      if (!current) return null
      let saved: PublishDraft
      if (window.noteDown) {
        saved = await window.noteDown.updatePublishDraft({
          libraryPath: loadSettings().libraryPath,
          draftId,
          ...update,
        })
      } else {
        const now = new Date().toISOString()
        const sourceSnapshot = update.refreshSource
          ? window.localStorage.getItem(
              `note-down.preview-document.${current.sourceKind}/${current.sourceId}`,
            ) ?? current.sourceSnapshot
          : current.sourceSnapshot
        saved = {
          ...current,
          ...update,
          sourceSnapshot,
          sourceRevision: update.refreshSource
            ? `${sourceSnapshot.length}-${Date.now()}`
            : current.sourceRevision,
          sourceChanged: false,
          updatedAt: now,
          publishedAt: update.status === 'Published' ? now : current.publishedAt,
        }
      }
      setPublishItems((items) => [saved, ...items.filter((draft) => draft.id !== draftId)])
      setNotice(
        update.refreshSource
          ? '发布版本已更新。'
          : update.status === 'Published'
            ? '已记录发布结果。'
            : '发布草稿已更新。',
      )
      return saved
    } catch {
      setNotice('发布草稿更新失败。')
      return null
    }
  }
  const deletePublishDraft = async (draft: PublishDraft) => {
    if (
      loadSettings().confirmDelete &&
      !window.confirm(`移除“${draft.sourceTitle}”的发布草稿？来源文档不会删除。`)
    ) {
      return false
    }
    try {
      if (window.noteDown) {
        await window.noteDown.deletePublishDraft({
          libraryPath: loadSettings().libraryPath,
          draftId: draft.id,
        })
      }
      setPublishItems((items) => items.filter((item) => item.id !== draft.id))
      setRoute({ page: 'publish' })
      setNotice('发布草稿已移除。')
      return true
    } catch {
      setNotice('发布草稿移除失败。')
      return false
    }
  }
  const createTask = () => {
    const projectId = route.page === 'project' ? route.projectId : undefined
    setEditingTask({
      id: `task-${crypto.randomUUID()}`,
      title: '',
      projectId,
      date: new Date().toLocaleDateString('sv-SE'),
      status: 'Todo',
      description: '',
    })
    setEditingTaskIsNew(true)
    setRoute({ page: 'library', kind: 'tasks' })
  }
  const persistDocumentTask = async (
    task: TaskItem,
    value: TaskItem | null,
  ) => {
    if (!task.sourceDocumentId || !task.sourceBlockId) return
    const libraryPath = loadSettings().libraryPath
    const previewStorageKey = `note-down.preview-document.${task.sourceDocumentId}`
    const state = window.noteDown
      ? await window.noteDown.loadDocumentState({
          documentId: task.sourceDocumentId,
          libraryPath,
        })
      : {
          content: window.localStorage.getItem(previewStorageKey),
          revision: null,
        }
    if (!state.content) throw new Error('Source document is missing')
    const content = updateDocumentTaskBlock(
      state.content,
      task.sourceBlockId,
      value
        ? {
            title: value.title,
            checked: value.status === 'Done',
            due: value.date === '无日期' ? '-' : value.date,
          }
        : null,
    )
    if (content === state.content) throw new Error('Source task is missing')
    if (window.noteDown) {
      const result = await window.noteDown.saveDocument({
        documentId: task.sourceDocumentId,
        libraryPath,
        content,
        baseRevision: state.revision,
      })
      if (result.status === 'conflict') throw new Error('Source document changed')
    } else {
      window.localStorage.setItem(previewStorageKey, content)
    }
  }
  const saveTask = async (task: TaskItem) => {
    const created = editingTaskIsNew
    try {
      await persistDocumentTask(task, task)
      setTaskItems((current) => [
        task,
        ...current.filter((item) => item.id !== task.id),
      ])
      setEditingTask(null)
      setEditingTaskIsNew(false)
      setNotice(created ? '任务已创建。' : '任务已更新。')
    } catch {
      setNotice('任务来源文档更新失败。')
    }
  }
  const deleteTask = async (task: TaskItem) => {
    try {
      await persistDocumentTask(task, null)
      setTaskItems((current) => current.filter((item) => item.id !== task.id))
      setEditingTask(null)
      setEditingTaskIsNew(false)
      setTaskDanger(null)
      setNotice('任务已移除。')
    } catch {
      setTaskDanger(null)
      setNotice('任务来源文档更新失败。')
    }
  }
  const requestTaskDelete = (task: TaskItem, anchor: HTMLElement) => {
    if (!loadSettings().confirmDelete) {
      void deleteTask(task)
      return
    }
    setTaskDanger((current) =>
      current?.task.id === task.id ? null : { task, anchor },
    )
  }
  const toggleTask = async (task: TaskItem) => {
    const nextTask: TaskItem = {
      ...task,
      status: task.status === 'Done' ? 'Todo' : 'Done',
    }
    try {
      await persistDocumentTask(task, nextTask)
      setTaskItems((current) =>
        current.map((item) => item.id === task.id ? nextTask : item),
      )
    } catch {
      setNotice('任务来源文档更新失败。')
    }
  }
  const goBack = () => {
    if (route.page === 'library') setRoute({ page: 'library', kind: route.kind })
    if (route.page === 'project') setRoute({ page: 'project', projectId: route.projectId })
    if (route.page === 'publish') setRoute({ page: 'publish' })
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`} data-route={routeKey(route)}>
      <Sidebar
        route={route}
        projectItems={projectItems}
        userProfile={userProfile}
        collapsed={sidebarCollapsed}
        onNavigate={navigate}
        onEditProject={(project) => {
          setEditingProject(project)
          setEditingProjectIsNew(false)
        }}
        onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
        commandDisabled={modalOpen}
        updateState={updateState}
        onDownloadUpdate={() => void downloadUpdate()}
        onOpenCommand={() => {
          if (!modalOpen) setCommandOpen(true)
        }}
        onOpenSettings={openSettings}
        onCreateDocument={(kind) =>
          void createDocument(kind, route.page === 'project' ? route.projectId : undefined)}
        onCreateTask={createTask}
        onCreateProject={createProject}
      />
      <main className="workspace">
        {route.page !== 'profile' && (
          <PageHeader
            route={route}
            projectItems={projectItems}
            documentItems={documentItems}
            saveState={saveState}
            onBack={goBack}
            onArchive={archiveCurrentDocument}
            onPublish={() => void initiateCurrentPublish()}
            onVersions={() => {
              const id = routeDocumentId(route)
              if (!id) return
              setVersionDocument({
                id,
                title: getHeaderMeta(route, projectItems, documentItems).title,
              })
            }}
          />
        )}
        <Page
          route={route}
          projectItems={projectItems}
          documentItems={documentItems}
          taskItems={taskItems}
          publishItems={publishItems}
          userProfile={userProfile}
          projectFilters={projectFilters}
          onProjectFilterChange={(projectId, kind) =>
            setProjectFilters((current) => ({ ...current, [projectId]: kind }))
          }
          onNavigate={navigate}
          onNotice={setNotice}
          onRestoreDocument={(document) => void setDocumentArchived(document, false)}
          onTrashDocument={(document) => void trashDocument(document)}
          onRestoreProject={restoreProject}
          onRequestProjectAction={requestProjectAction}
          onEditProfile={() => setProfileEditorOpen(true)}
          onChooseProfileAvatar={() => void chooseProfileAvatar()}
          onUpdatePublishDraft={updatePublishDraft}
          onDeletePublishDraft={deletePublishDraft}
          onPublishParagraph={(sourceKind, sourceId, paragraph) =>
            void initiateParagraphPublish(sourceKind, sourceId, paragraph)}
          onDocumentProjectChange={(document, projectId) =>
            void setDocumentProject(document, projectId)}
          onDocumentTasksChange={syncDocumentTasks}
          onToggleTask={toggleTask}
          onDeleteTask={requestTaskDelete}
          onEditTask={(task) => {
            setEditingTask(task)
            setEditingTaskIsNew(false)
          }}
        />
      </main>
      <CommandPalette
        open={commandOpen && !modalOpen}
        route={route}
        projectItems={projectItems}
        documentItems={documentItems}
        taskItems={taskItems}
        onClose={() => setCommandOpen(false)}
        onNavigate={navigate}
        onCreateDocument={(kind, projectId) => void createDocument(kind, projectId)}
        onCreateClip={() => setClipCaptureOpen(true)}
        onCreateTask={createTask}
      />
      {clipCaptureOpen && (
        <ClipCaptureDialog
          projectItems={projectItems}
          defaultProjectId={route.page === 'project' ? route.projectId : undefined}
          onCapture={captureClip}
          onClose={() => setClipCaptureOpen(false)}
        />
      )}
      {editingTask && (
        <TaskEditorDialog
          task={editingTask}
          isNew={editingTaskIsNew}
          projectItems={projectItems}
          onSave={saveTask}
          onClose={() => {
            setEditingTask(null)
            setEditingTaskIsNew(false)
          }}
        />
      )}
      {editingProject && (
        <ProjectEditorDialog
          project={editingProject}
          isNew={editingProjectIsNew}
          onSave={saveProject}
          onClose={closeProjectEditor}
        />
      )}
      {projectDanger && (
        <ProjectDangerPopover
          action={projectDanger.action}
          anchor={projectDanger.anchor}
          documentCount={documentItems.filter(
            (document) => document.projectId === projectDanger.project.id,
          ).length}
          onConfirm={() => void applyProjectAction()}
          onClose={() => setProjectDanger(null)}
        />
      )}
      {taskDanger && (
        <AnchoredActionPopover
          anchor={taskDanger.anchor}
          title={t('移除任务')}
          detail={taskDanger.task.title || t('任务')}
          confirmLabel={t('移除')}
          danger
          onConfirm={() => void deleteTask(taskDanger.task)}
          onClose={() => setTaskDanger(null)}
        />
      )}
      {profileEditorOpen && (
        <ProfileEditorDialog
          profile={userProfile}
          onSave={(profile) => void saveUserProfile(profile)}
          onClose={() => setProfileEditorOpen(false)}
        />
      )}
      {versionDocument && (
        <VersionHistoryDialog
          document={versionDocument}
          onClose={() => setVersionDocument(null)}
          onNotice={setNotice}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle size={16} />
          {t(notice)}
        </div>
      )}
    </div>
  )
}
