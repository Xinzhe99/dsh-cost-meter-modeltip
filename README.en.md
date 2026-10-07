# dsh-cost-meter-modeltip

[中文](./README.md) | **English**

A **read-only companion plugin** for [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter): adds its own row to the DSH sidebar — "Today by model" — hover it to see today's cost split per `provider:model`. No clicking, no page hopping, no sidebar space.

```
Today by model · zai:glm-5.3          ¥49.4691
   └─ hover:
      Today by model · ¥115.2362
      zai:glm-5.3                        ¥49.4691 · 43%
      deepseek-account:deepseek-flash    ¥34.5625 · 30%
      zai:glm-5.3-flash                  ¥29.6817 · 26%
```

## Why

The main plugin's "today" total is shown by default but does not distinguish models — with mixed vendors (DeepSeek official/account, GLM, Kimi, OpenRouter…) it reads as "all DeepSeek spend". The settings-page per-model statistics requires a page hop, and the v1.7.25 model-cost card is opt-in and takes sidebar space. This companion fixes the semantics of the number you already see.

## Features

- **Read-only**: never writes the main plugin's ledger or config; no locks, no double-counting, no service/RPC namespace — just one same-origin read-only GET route;
- **Exact numbers**: prefers the main plugin's in-memory statistics (`getBillingStatistics`, zero flush lag, identical basis); falls back to read-only ledger file (≤2s behind the main plugin's write debounce); force strict side-effect-free mode with `source: file`;
- **Follows the main plugin**: disabling dsh-cost-meter hides this row automatically; re-enabling restores it — no restart needed;
- **Zero dependencies, no build**: one plain ESM file per side, runs on Node 20+;
- Currency/symbol/decimals/exchange-rate and the with-subscription basis all follow the main plugin's config.

## Install

```sh
dsh plugin --profile <profile> add dsh-cost-meter-modeltip
# or from a local tarball
dsh plugin --profile <profile> add file:./dsh-cost-meter-modeltip-1.0.0.tgz
```

> First-time install does **not** require restarting DSH — the loader mounts it immediately.
> Updating an **already-loaded** plugin's code does require one DSH restart (the host caches imported module URLs).

### Requirements

- DSH ≥ 0.1.0-rc.5 with `dsh-cost-meter` installed and enabled (this is a companion, not a standalone meter);
- Node ≥ 20 (host side only).

## Configuration

```yaml
# <profile>/cordis.patch.yml (defaults are fine)
- id: cost-meter-modeltip
  config:
    source: 'auto'     # auto = in-memory stats first, fall back to file | service | file
    ledgerPath: ''     # empty = $DSH_HOME/storages/cost-meter/ledger.json
```

## Freshness

| Source | Lag | Notes |
|---|---|---|
| In-memory stats (default) | ≈ 0 | Same source and basis as the main plugin; its internal `refresh()` may flush the main plugin's own pending write slightly earlier |
| Ledger file (`source: file`) | ≈ 2s | The main plugin's `scheduleWrite` debounce — the floor for file-only reads |

The client polls every 1.5s: skips while the page is hidden, re-checks on return, refreshes immediately on hover, and skips re-render when nothing changed.

## Behavior

- Today only (host-local day key); models sorted by cost desc, top 6 with shares; cost basis follows the main plugin (API track by default, total when `showTotalWithPlan: true`);
- Hidden entirely when only **1 model** was used today;
- Hidden automatically while the main plugin is disabled (no orphan numbers);
- Collapsed rail (56px) shows the amount only.

## Uninstall

```sh
dsh plugin --profile <profile> remove dsh-cost-meter-modeltip
```

## Relation to the built-in model-cost card

The main plugin ships an opt-in collapsible model-cost card (Settings → Cost → 模型花费卡片, off by default since v1.7.25). They don't conflict: the card is for *actively inspecting*, this plugin is for *verifying the number you already see*. Once upstream ships a similar interaction, this plugin can simply be disabled.

## Development

```sh
npm test          # node --test — zero dependencies, Node 20+
npm pack          # the tarball is the installable plugin
```

Hot-reload trick: DSH caches imported plugin modules by URL. Rename the entry to a versioned filename (e.g. `lib/index-031.js`), update `main`/`exports`, then toggle the plugin off/on in the panel to load new code without a restart. The route response carries a `v` field so you can always tell which build the host loaded.

MIT © modeltip contributors
