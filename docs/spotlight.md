# macOS Spotlight

Jotkeep 使用 Core Spotlight 将当前资料库中的活跃文档投影到设备端系统索引。索引内容包括标题、
正文、标签、文件更新时间和原文件 URL；归档文档不会进入系统索引。

系统结果使用 `notedown://open?document=<kind>/<id>` 回到应用。开发模式和正式应用都会注册该协议，
Renderer 只有在成功定位文档后才确认消费深链，因此 React Strict Mode 不会提前丢失启动参数。

```bash
npm run build:spotlight
```

原生辅助应用位于 `native/build/SpotlightBridge.app`。`npm run dev` 与 `npm run build` 都会先重新
构建它。索引只保存在本机，不上传内容；删除、归档、外部文件变更与索引重建都会触发同步。

开发环境可直接验证索引：

```bash
native/build/SpotlightBridge.app/Contents/MacOS/SpotlightBridge query "文档标题"
```
