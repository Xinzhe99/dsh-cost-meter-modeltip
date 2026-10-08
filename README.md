# dsh-cost-meter-modeltip

**中文** | [English](./README.en.md)

[dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter) 的**只读伴生插件**：在 DSH 侧边栏自有一行「今日按模型」，鼠标悬停即可看到今日费用按 `provider:model` 的完整拆分——不用点、不跳页、不占侧栏空间。

```
今日按模型 · zai:glm-5.3            ¥49.4691
   └─ 悬停展开:
      今日按模型 · ¥115.2362
      zai:glm-5.3                        ¥49.4691 · 43%
      deepseek-account:deepseek-flash    ¥34.5625 · 30%
      zai:glm-5.3-flash                  ¥29.6817 · 26%
      deepseek-official:deepseek-flash   ¥ 1.3437 ·  1%
```

## 为什么需要它

主插件的「今日 ¥…」合计是默认显示的数字，但不区分模型——多厂商混用时（DeepSeek 官方 / DeepSeek 账号 / GLM / Kimi / OpenRouter…）很容易被读成“全是 DeepSeek 花的”。设置页的「按模型统计」要跳页，v1.7.25 的「模型花费卡片」默认关闭且占侧栏空间；这个伴生插件补的是**默认可见数字的语义**。

## 特性

- **只读**：从不写主插件的账本或配置，不持有锁、不产生重复入账、不占用任何服务/RPC 名字空间，只有一条同源只读 GET 路由；
- **与主插件数字完全一致**：优先读主插件内存统计 `getBillingStatistics`（零落盘延迟、同口径）；统计接口异常时自动回落为只读账本文件（最多落后 2 秒的落盘防抖）；可用 `source: file` 强制严格零副作用；
- **随主插件自动开关**：主插件停用 → 这一行自动隐藏；重新启用 → 自动恢复，无需重启；
- **零依赖、无构建**：宿主与客户端各一个纯 ESM 文件，Node 20+ 直接跑；
- 显示口径（币种/符号/小数位/汇率/是否含订阅）全部沿用主插件配置，金额一字不差。

## 安装

```sh
# 在 DSH 里安装(把 <profile> 换成你的 profile 名,桌面版通常是 desktop)
dsh plugin --profile <profile> add dsh-cost-meter-modeltip
# 或从本地 tgz
dsh plugin --profile <profile> add file:./dsh-cost-meter-modeltip-1.0.0.tgz
```

> 首次安装**不需要重启 DSH**：装载器会即时挂载新插件，侧边栏马上出现这一行。
> 但**更新已装载插件的代码**需要重启一次 DSH（宿主按模块 URL 缓存已 import 的代码）。

### 要求

- DSH ≥ 0.1.0-rc.5，且已安装并启用 `dsh-cost-meter`（本插件是它的伴生，不独立记账）；
- Node ≥ 20（仅宿主端运行需要，浏览器端无要求）。

## 配置

```yaml
# <profile>/cordis.patch.yml(通常无需改动,默认值即可)
- id: cost-meter-modeltip
  config:
    source: 'auto'     # auto(默认)=内存统计优先,异常回落文件 | service=总是内存 | file=严格零副作用
    ledgerPath: ''     # 留空 = $DSH_HOME/storages/cost-meter/ledger.json
```

## 新鲜度

| 数据路径 | 延迟 | 说明 |
|---|---|---|
| 内存统计(默认) | ≈ 0 | 与主插件同源同口径；其内部 `refresh()` 会把主插件本来就要落盘的数据提前落一次盘 |
| 账本文件(`source: file`) | ≈ 2s | 主插件 `scheduleWrite` 的落盘防抖，这是文件只读的地板 |

客户端 1.5s 轮询一次：页面不可见时不轮询、切回立即复查、悬停立即刷新、数据没变不重渲染。

## 行为细节

- 只统计**今日**（宿主机本地时区日键）；模型按费用降序，最多 6 条，附占比；费用口径跟随主插件（默认 API 轨，`showTotalWithPlan: true` 时为含订阅总额）；
- 只有 **1 个模型**时整行不渲染（没有歧义，不占版面）；
- 主插件停用（或账本读不到）→ 这一行自动隐藏，不留「孤儿」数字；
- 侧栏收起（rail，56px）时只显示金额。

## 卸载

```sh
dsh plugin --profile <profile> remove dsh-cost-meter-modeltip
```

## 与主插件自带「模型花费卡片」的关系

主插件 v1.7.25 起自带可折叠的模型花费卡片（设置 → 费用 → 模型花费卡片，默认关闭）：点击展开、占侧栏空间、可显示 Top-N 与 token。两者不冲突：卡片适合**主动查看**，本插件适合**默认数字的即时求证**。上游合并类似交互后，本插件即可在面板中停用。

## 开发

```sh
npm test          # node --test,零依赖,Node 20+ 直接跑
npm pack          # 产物即安装包
```

本地热更新技巧：DSH 宿主按模块 URL 缓存已装载的插件代码，改完文件不会自动生效。把入口复制/改名为带版本号的文件（如 `lib/index-031.js`）并同步 `package.json` 的 `main`/`exports`，再到插件面板里关一下再开，即可免重启加载新代码。路由响应带 `v` 字段，可直接确认宿主装载的是哪一版。

MIT © Xinzhe99
