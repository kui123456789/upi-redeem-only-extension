# Chrome Extension Development Docs

本目录是 Chrome 插件开发文档的本地离线参考，来源为官方 Chrome for Developers 文档。

Downloaded: 2026-06-26T05:25:33.621Z

## 使用方式

- 优先看 `pages/service-workers.md`、`pages/content-scripts.md`、`pages/messaging.md`、`pages/storage-and-cookies.md`，这些和当前扩展项目最相关。
- 需要查 API 时看 `pages/runtime-api.md`、`pages/storage-api.md`、`pages/tabs-api.md`、`pages/scripting-api.md`、`pages/cookies-api.md`。
- 文档可能随 Chrome 更新而变化，最准确版本仍以 `sources.json` 中的官方链接为准。
- 需要刷新本地副本时运行：`node scripts/download-chrome-extension-docs.mjs`。

## 已下载页面

- [Chrome Extensions](pages/chrome-extensions-overview.md) - https://developer.chrome.com/docs/extensions
- [Extensions / Get started](pages/get-started.md) - https://developer.chrome.com/docs/extensions/get-started
- [Hello World extension](pages/hello-world.md) - https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
- [Extensions / Develop](pages/develop-overview.md) - https://developer.chrome.com/docs/extensions/develop
- [Extensions / How to](pages/how-to.md) - https://developer.chrome.com/docs/extensions/how-to
- [Extensions / Reference](pages/api-reference.md) - https://developer.chrome.com/docs/extensions/reference
- [Manifest file format](pages/manifest-reference.md) - https://developer.chrome.com/docs/extensions/reference/manifest
- [Extensions / Manifest V3](pages/manifest-v3.md) - https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- [About extension service workers](pages/service-workers.md) - https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
- [Content scripts](pages/content-scripts.md) - https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- [Message passing](pages/messaging.md) - https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- [Storage and cookies](pages/storage-and-cookies.md) - https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- [Declare permissions](pages/declare-permissions.md) - https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- [Match patterns](pages/match-patterns.md) - https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
- [Create a side panel](pages/side-panel-ui.md) - https://developer.chrome.com/docs/extensions/develop/ui/create-a-side-panel
- [Give users options](pages/options-page-ui.md) - https://developer.chrome.com/docs/extensions/develop/ui/options-page
- [Implement an action](pages/toolbar-ui.md) - https://developer.chrome.com/docs/extensions/develop/ui/implement-action
- [chrome.runtime](pages/runtime-api.md) - https://developer.chrome.com/docs/extensions/reference/api/runtime
- [chrome.storage](pages/storage-api.md) - https://developer.chrome.com/docs/extensions/reference/api/storage
- [chrome.tabs](pages/tabs-api.md) - https://developer.chrome.com/docs/extensions/reference/api/tabs
- [chrome.scripting](pages/scripting-api.md) - https://developer.chrome.com/docs/extensions/reference/api/scripting
- [chrome.cookies](pages/cookies-api.md) - https://developer.chrome.com/docs/extensions/reference/api/cookies
- [chrome.sidePanel](pages/side-panel-api.md) - https://developer.chrome.com/docs/extensions/reference/api/sidePanel

## License

Chrome for Developers 文档通常以 CC BY 4.0 授权，代码示例通常以 Apache 2.0 授权。具体以各官方页面页脚声明为准。
