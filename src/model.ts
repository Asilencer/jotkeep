export type LibraryKind = 'notes' | 'articles' | 'clips' | 'tasks'

export type DocumentKind = Exclude<LibraryKind, 'tasks'>

export type Route =
  | { page: 'today' }
  | { page: 'library'; kind: LibraryKind; itemId?: string }
  | { page: 'project'; projectId: string; itemKind?: DocumentKind; itemId?: string }
  | { page: 'archive' }
  | { page: 'publish'; draftId?: string }
  | { page: 'profile' }

export type Project = {
  id: string
  name: string
  description: string
  color: string
  status: 'Active' | 'Planned'
  archivedAt?: string
}

export type Note = {
  id: string
  title: string
  excerpt: string
  projectId?: string
  updatedAt: string
  tags: string[]
  body: string[]
}

export type Article = {
  id: string
  title: string
  excerpt: string
  projectId?: string
  updatedAt: string
  status: 'Idea' | 'Draft' | 'Ready' | 'Published'
  words: number
  body: string[]
}

export type Clip = {
  id: string
  title: string
  source: string
  type: '文章' | '图片' | '视频' | '帖子'
  projectId?: string
  savedAt: string
  note: string
  tone: 'sage' | 'blue' | 'sand' | 'plum' | 'coral' | 'slate'
}

export type TaskItem = {
  id: string
  title: string
  description?: string
  projectId?: string
  date: string
  status: 'Todo' | 'Doing' | 'Done' | 'Cancelled'
  source?: string
  sourceDocumentId?: string
  sourceBlockId?: string
}

export type PublishSourceKind = Extract<DocumentKind, 'notes' | 'articles'> | 'daily'

export type PublishDraftStatus = 'Preparing' | 'Queued' | 'Published' | 'Failed'

export type PublishTarget = 'x'

export type PublishDeliveryMode = 'standard' | 'long' | 'thread'

export type PublishDraft = {
  id: string
  sourceKind: PublishSourceKind
  sourceId: string
  sourceRevision: string
  sourceTitle: string
  sourceSnapshot: string
  sourceBlockId?: string
  sourceBlockPreview?: string
  status: PublishDraftStatus
  targets: PublishTarget[]
  targetText?: string
  deliveryMode?: PublishDeliveryMode
  updatedAt: string
  publishedAt?: string
  sourceChanged?: boolean
  sourceMissing?: boolean
}

export const projects: Project[] = [
  {
    id: 'note-down',
    name: 'Jotkeep',
    description: '构建一个安静、直接、可长期拥有的个人 Markdown 工作台。',
    color: '#6f8268',
    status: 'Active',
  },
  {
    id: 'personal-site',
    name: '个人网站',
    description: '整理个人作品、写作与公开表达。',
    color: '#6f7f9b',
    status: 'Active',
  },
  {
    id: 'home-plan',
    name: '家庭计划',
    description: '集中记录家庭安排与长期计划。',
    color: '#a57a61',
    status: 'Planned',
  },
]

export const notes: Note[] = [
  {
    id: 'navigation-principles',
    title: '产品导航的三个原则',
    excerpt: '入口表达内容类型，项目表达上下文，时间只负责回到今天。',
    projectId: 'note-down',
    updatedAt: '刚刚',
    tags: ['产品', '信息架构'],
    body: [
      '导航不应该复述数据库结构，而要帮助我快速回到正在做的事。',
      '内容类型回答“这是什么”，项目回答“为什么要做”，时间回答“现在先做什么”。',
      '任何临时面板都不能成为完成核心任务的前提。',
    ],
  },
  {
    id: 'editor-boundary',
    title: '编辑器插件的边界',
    excerpt: '`/` 菜单只负责在当前文档中插入内容，不承担全局导航。',
    projectId: 'note-down',
    updatedAt: '18 分钟前',
    tags: ['编辑器', '插件'],
    body: [
      '插件需要稳定的命令 ID、能力声明和可恢复的 Markdown 序列化结果。',
      '首版只开放内置插件。第三方代码不能直接进入应用主上下文。',
    ],
  },
  {
    id: 'daily-capture',
    title: 'Daily 应该保持低摩擦',
    excerpt: '打开 Today 就能写，不弹类型选择，也不要求先选项目。',
    updatedAt: '昨天',
    tags: ['Daily'],
    body: [
      '今天的记录直接写入当天 Markdown。需要继续发展时，再把选中内容转成笔记、文章或任务。',
      '未归项目只是筛选条件，不是一条等待清理的队列。',
    ],
  },
  {
    id: 'release-notes',
    title: '首个可用版本的范围',
    excerpt: '先让记录、组织和查找形成闭环，再接入发布与账号。',
    projectId: 'note-down',
    updatedAt: '周日',
    tags: ['版本'],
    body: ['Daily、Note 和 Project 是第一条纵向链路。', '文章、收藏和任务随后复用相同的项目模型。'],
  },
  {
    id: 'about-page',
    title: 'About 页面素材',
    excerpt: '个人网站需要一段更具体、少形容词的自我介绍。',
    projectId: 'personal-site',
    updatedAt: '7 月 18 日',
    tags: ['写作'],
    body: ['先回答我在做什么，再说明做这些事情的方法。', '把作品作为证据，不列大段能力关键词。'],
  },
]

export const articles: Article[] = [
  {
    id: 'local-first-writing',
    title: '本地优先写作不是离线模式',
    excerpt: '本地优先首先是一种所有权和失败边界的设计。',
    projectId: 'note-down',
    updatedAt: '今天',
    status: 'Draft',
    words: 1840,
    body: [
      '离线可用只是结果之一。更重要的是，用户可以直接读取、备份和迁移自己的原始内容。',
      '索引可以重建，界面状态可以丢失，但 Markdown 真源不能依赖某个应用才能解释。',
    ],
  },
  {
    id: 'calm-tools',
    title: '安静的工具如何帮助思考',
    excerpt: '减少界面中的持续提醒，让内容重新成为视觉焦点。',
    projectId: 'personal-site',
    updatedAt: '昨天',
    status: 'Idea',
    words: 420,
    body: ['工具的存在感应该来自可靠，而不是不断展示功能。'],
  },
  {
    id: 'markdown-ownership',
    title: '为什么继续选择 Markdown',
    excerpt: '一种有限的格式，反而能为长期内容提供稳定边界。',
    projectId: 'note-down',
    updatedAt: '7 月 18 日',
    status: 'Ready',
    words: 2360,
    body: ['Markdown 不是完整的文档模型，但它是清晰、可读、可转换的交换边界。'],
  },
  {
    id: 'design-log',
    title: '从 Daily 到产品方案',
    excerpt: '一条随手记录如何在几天内逐步长成可发布的设计说明。',
    projectId: 'personal-site',
    updatedAt: '7 月 12 日',
    status: 'Published',
    words: 3120,
    body: ['好的工具不要求用户预先知道一条想法最终会变成什么。'],
  },
]

export const clips: Clip[] = [
  {
    id: 'reflect-daily',
    title: 'Reflect 的 Daily Notes 与日历导航',
    source: 'reflect.app',
    type: '文章',
    projectId: 'note-down',
    savedAt: '12 分钟前',
    note: '日历应该是辅助导航，不要抢占编辑器首屏。',
    tone: 'sage',
  },
  {
    id: 'editor-motion',
    title: '一段克制的编辑器转场',
    source: 'x.com',
    type: '视频',
    projectId: 'note-down',
    savedAt: '今天',
    note: '只在表达来源与去向时使用位移动效。',
    tone: 'slate',
  },
  {
    id: 'book-layout',
    title: '瑞士书籍版式中的文字层级',
    source: 'are.na',
    type: '图片',
    savedAt: '昨天',
    note: '正文宽度与边注之间的比例值得参考。',
    tone: 'sand',
  },
  {
    id: 'local-software',
    title: 'Local-first software: you own your data',
    source: 'inkandswitch.com',
    type: '文章',
    projectId: 'note-down',
    savedAt: '7 月 19 日',
    note: '区分内容真源、可重建索引和同步层。',
    tone: 'blue',
  },
  {
    id: 'profile-grid',
    title: '贡献热力图不等于生产力评分',
    source: 'github.com',
    type: '帖子',
    projectId: 'personal-site',
    savedAt: '7 月 16 日',
    note: '个人主页只呈现可解释的活动，不制造分数。',
    tone: 'plum',
  },
  {
    id: 'writing-room',
    title: '一个没有多余家具的写作房间',
    source: 'cosmos.so',
    type: '图片',
    savedAt: '7 月 14 日',
    note: '空间感来自比例，不是来自空白越多越好。',
    tone: 'coral',
  },
]

export const tasks: TaskItem[] = [
  {
    id: 'build-shell',
    title: '完成 Electron 静态工作台',
    projectId: 'note-down',
    date: '今天',
    status: 'Doing',
    source: '首个可用版本的范围',
  },
  {
    id: 'review-layout',
    title: '走查 Today、笔记与项目页面',
    projectId: 'note-down',
    date: '今天',
    status: 'Todo',
    source: '产品导航的三个原则',
  },
  {
    id: 'rewrite-about',
    title: '重写 About 页面开头',
    projectId: 'personal-site',
    date: '今天',
    status: 'Todo',
    source: 'About 页面素材',
  },
  {
    id: 'keyboard-pass',
    title: '验证键盘导航与 Reduce Motion',
    projectId: 'note-down',
    date: '明天',
    status: 'Todo',
  },
  {
    id: 'publish-draft',
    title: '排版本地优先写作文章',
    projectId: 'personal-site',
    date: '周五',
    status: 'Todo',
  },
  {
    id: 'organize-photos',
    title: '整理家庭照片备份方案',
    projectId: 'home-plan',
    date: '无日期',
    status: 'Todo',
  },
  {
    id: 'research-editor',
    title: '完成编辑器技术验证',
    projectId: 'note-down',
    date: '7 月 20 日',
    status: 'Done',
  },
]
