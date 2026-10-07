# Changelog

## [1.0.0] - 2026-10-08

首次发布。

- 侧边栏自有行「今日按模型」：悬停显示今日费用按 `provider:model` 的完整拆分（费用降序前 6 条 + 占比），单一模型时整行隐藏；
- 数据源 `source=auto`（默认）：优先读主插件 `dsh-cost-meter` 的内存统计 `getBillingStatistics`（零落盘延迟、同口径），异常自动回落为只读账本文件；`service`/`file` 可强制指定；
- 随主插件自动开关：主插件停用 → 路由回 `ok:false` → 整行隐藏；重新启用 → 自动恢复；
- 显示口径（币种/符号/小数位/汇率/`showTotalWithPlan`）沿用主插件配置；
- 客户端 1.5s 轮询：页面不可见不轮询、切回立即复查、悬停立即刷新、载荷未变不重渲染；
- 安全：仅同源 GET、跨源 403、非 GET 405；不写账本、不改配置、无外部网络访问；
- 测试：`node --test`（零依赖），覆盖三种数据源、口径切换、异常回落、主插件联动、护栏与客户端渲染。

[1.0.0]: https://github.com/your-name/dsh-cost-meter-modeltip/releases/tag/v1.0.0
