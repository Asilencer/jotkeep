# 本地 macOS 应用包

```bash
npm install
npm run package:mac
```

输出：

```text
release/Jotkeep-darwin-arm64/Jotkeep.app
```

打包过程会构建 Renderer、Open-Meteo 定位辅助应用、Spotlight 辅助应用和 `.icns` 图标，再生成
Apple Silicon Electron 应用并进行 ad-hoc 签名。它只面向当前用户的本机安装，不具备 Developer ID
信任链，也没有经过 Apple Notarization。

为避免个人资料泄漏，应用源码复制阶段明确排除 `.notedown/`、`daily/`、`notes/`、`docs/` 和
`release/`。天气与 Spotlight 辅助应用通过 `extraResource` 单独进入 `Contents/Resources`。
