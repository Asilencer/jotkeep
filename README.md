<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img
    src="./assets/brand/jotkeep-lockup.svg"
    width="560"
    alt="Jotkeep"
  />
</p>

<p align="center">
  <strong>一个安静、本地优先的 Markdown 写作空间。</strong><br />
  内容留在你的 Mac，也始终归你。
</p>

<p align="center">
  <img
    src="https://img.shields.io/badge/macOS-26%2B-252622?style=flat-square&logo=apple&logoColor=white"
    alt="macOS 26+"
  />
  <img
    src="https://img.shields.io/badge/Apple%20Silicon-arm64-252622?style=flat-square"
    alt="Apple Silicon"
  />
  <img
    src="https://img.shields.io/badge/local--first-Markdown-CC7D5E?style=flat-square"
    alt="Local-first Markdown"
  />
  <a href="./LICENSE">
    <img
      src="https://img.shields.io/badge/license-MIT-CC7D5E?style=flat-square"
      alt="MIT License"
    />
  </a>
  <a href="https://github.com/Asilencer/jotkeep/actions/workflows/check.yml">
    <img
      src="https://github.com/Asilencer/jotkeep/actions/workflows/check.yml/badge.svg"
      alt="Check"
    />
  </a>
</p>

<p align="center">
  <a href="#为什么是-jotkeep">产品理念</a> ·
  <a href="#功能亮点">功能亮点</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="#数据与边界">数据边界</a>
</p>

<p align="center">
  <img
    src="./docs/images/jotkeep-workspace.png"
    width="100%"
    alt="Jotkeep 的 Today、月历、天气和 Markdown 编辑界面"
  />
</p>

## 为什么是 Jotkeep

Jotkeep 不试图把写作变成另一套复杂的信息管理系统。它只把几件重要的事做好：

- **写得直接**：打开就能写，Markdown、快捷命令和结构化文档组件共存。
- **保存在本地**：文档是普通 Markdown，默认资料库位于 `~/.jotkeep`。
- **长期可拥有**：原子保存、历史版本、自动备份与完整导出共同保护内容。
- **保持安静**：没有收件箱、积分、连续打卡或生产力评分。

账号不是使用 Jotkeep 的前提，云端也不是内容的默认归宿。

## 功能亮点

### 写作

- Slate 块编辑器与 Markdown 源码模式
- `/`、`、` 命令菜单，表格、分栏、代码、公式、媒体和书签
- 稳定的撤销、重做、拖拽、选区与 Markdown round trip
- 正文左侧 Minimap、`⌘K` 搜索和 `⌘N` 快速新建

### 组织

- Today、笔记、文章、收藏、任务、项目、发布与个人空间
- 项目内按内容类型组织文档，任务支持日期、状态和本地提醒
- URL 正文提取、附件去重、失效文件重选与资料库迁移
- 个人活动热力图与最近活动，数据来自真实本地操作

### 保护

- 文档串行写入、临时文件同步与原子替换
- 外部修改冲突检测，损坏 JSON 自动保留恢复副本
- 单篇最近 50 个历史版本
- 日/周自动备份、安全恢复、资料库与配置导出

### macOS

- Core Spotlight 系统检索与 `notedown://` 深链
- Share Extension 接收网页、文字、图片、视频与文件
- Core Location + Open-Meteo 天气和程序化天气场景
- 本地通知、原生文件选择器和 macOS 废纸篓

### 个性化

- 浅色、深色与系统主题
- 前景色、背景色、强调色、字体、字号、对比度与侧边栏透明度
- 简体中文、英文及跟随系统语言
- Reduce Motion 与基础键盘语义

完整实现范围与尚需终验的边界见
[实现状态](./docs/implementation-status.md)。

## 本地开发

### 环境

- Apple Silicon Mac
- macOS 26+
- Node.js 22+
- Xcode 26 Command Line Tools

### 启动

```bash
git clone https://github.com/Asilencer/jotkeep.git
cd jotkeep
npm ci
npm run dev
```

`npm run dev` 会先构建天气、Spotlight 和 Share Extension 原生组件，再启动
Vite 与 Electron。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | TypeScript、回归测试与 Electron 主进程语法检查 |
| `npm run build` | 构建原生组件和 Renderer |
| `npm start` | 运行已构建的本地应用 |
| `npm run package:mac` | 生成 Apple Silicon `Jotkeep.app` |

本地应用产物位于：

```text
release/Jotkeep-darwin-arm64/Jotkeep.app
```

当前打包使用 ad-hoc 签名，只适合个人 Mac 本地安装。面向公众分发仍需要
Developer ID 签名与 Apple Notarization。

## 架构

```text
src/        React UI、Slate 编辑器、主题与国际化
electron/   主进程、IPC、文件存储、索引、备份与系统集成
native/     Weather、Spotlight 和 Share Extension 的 Swift 实现
scripts/    原生构建、图标生成与 macOS 打包
tests/      存储、Markdown、设置与 IPC 回归测试
docs/       产品边界、实现状态与工程说明
```

Renderer 启用 Context Isolation 和 Sandbox，并关闭 Node Integration。文件系统和
macOS 能力均通过受约束的 preload / IPC 接口进入 Renderer。

## 数据与边界

- 默认资料库是 `~/.jotkeep`，不会写入源码目录。
- 文档以 Markdown 保存；任务、项目、活动、发布草稿和个人资料等应用元数据
  也只保存在本地资料库。
- 天气功能请求 Open-Meteo；网页收藏只访问用户明确提交的 URL。
- X 发布使用 Web Intent，Jotkeep 不接入 X OAuth/API，也不会伪装读取最终发布结果。
- 当前没有云同步、多人协作、插件系统或自动更新。
- `.notedown` 与 `notedown://` 是兼容标识，品牌更名不会迁移或破坏既有资料库。

更多工程细节：

- [产品信息架构](./docs/product-information-architecture-and-layout.md)
- [编辑器运行时行为](./docs/editor-runtime-behavior.md)
- [Open-Meteo 天气接入](./docs/open-meteo-weather.md)
- [本地 macOS 打包](./docs/local-mac-package.md)

## 许可证

Jotkeep 基于 [MIT License](./LICENSE) 开源。你可以自由使用、修改、分发和用于
商业项目，但须保留原始版权与许可声明。
