/**
 * dsh-cost-meter-modeltip — 「今日」费用按模型拆开的只读伴生插件。
 *
 * 数据源(按新鲜度优先,可用 config.source 固定):
 *  1. service —— dsh-cost-meter 在内存里的账本:调用它的只读统计接口
 *     getBillingStatistics({from,to})。这条路与主插件同源同口径,零落盘延迟,
 *     数字与主插件侧边栏完全一致;不写账本、不改配置(它内部会 refresh(),
 *     即把主插件本来就要落盘的数据提前落一次盘)。
 *  2. file —— 直接只读 $DSH_HOME/storages/cost-meter/ledger.json(默认路径,
 *     可被 config.ledgerPath 覆盖)。严格零副作用,代价是最多落后主插件
 *     2 秒(ledger.scheduleWrite 的落盘防抖)。
 *
 * 无论走哪条路,本插件都不写任何数据、不注册服务、不占用 RPC 名字空间;
 * 主插件停用时(get('costMeter') 为空)整条路由直接回 ok:false,前端隐藏该行。
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// inject 必须声明:cordis 只把注入清单里的服务挂到 ctx 上,漏声明会让
// ctx.webServer 抛「cannot get property ... without inject」,插件无法激活。
export const name = 'cost-meter-modeltip'
export const inject = ['webServer']

const require = createRequire(import.meta.url)
/** 与 package.json 版本保持一致(有测试锁死),用于确认宿主装载的是哪一份代码。 */
const VERSION = require('../package.json').version

const ROUTE = '/api/dsh-cost-meter-modeltip/today'
const LEDGER_TTL_MS = 1500

function homeDir() {
  const env = process.env.DSH_HOME
  return typeof env === 'string' && env.length > 0 ? env : join(homedir(), '.dsh')
}

function ledgerPathOf(config) {
  const custom = config?.ledgerPath
  return typeof custom === 'string' && custom.length > 0
    ? custom
    : join(homeDir(), 'storages', 'cost-meter', 'ledger.json')
}

/** 账本日键按宿主机本地时区(与主插件的日键口径一致)。 */
export function localDayKey(nowMs) {
  const date = new Date(nowMs)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function positive(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : fallback
}

let ledgerCache = { key: '', at: 0, value: null }

function readLedger(path) {
  const stat = statSync(path)
  const key = `${stat.mtimeMs}:${stat.size}`
  if (ledgerCache.key === key && Date.now() - ledgerCache.at < LEDGER_TTL_MS) return ledgerCache.value
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  ledgerCache = { key, at: Date.now(), value: parsed }
  return parsed
}

/**
 * 显示口径(币种/符号/小数位/汇率/含订阅总额)取自账本 config。按文件版本
 * (mtime+size)缓存:文件变了立刻重读,没变就不重复解析。
 */
const configCache = new Map()
function displayConfig(path) {
  const stat = statSync(path)
  const key = `${stat.mtimeMs}:${stat.size}`
  const hit = configCache.get(path)
  if (hit !== undefined && hit.key === key) return hit.value
  const config = readLedger(path)?.config ?? {}
  const currency = config.currency === 'CNY' ? 'CNY' : 'USD'
  const value = {
    currency,
    rate: positive(config.exchangeRate, 1),
    decimals: Number.isInteger(config.decimals) ? config.decimals : 4,
    symbol: typeof config.symbol === 'string' && config.symbol.length > 0 ? config.symbol : (currency === 'CNY' ? '¥' : '$'),
    totalWithPlan: config.showTotalWithPlan === true,
  }
  if (configCache.size > 8) configCache.clear()
  configCache.set(path, { key, value })
  return value
}

function assemble(rows, calls, display, nowMs, source) {
  // 主插件侧栏「今日」的口径:默认 API 轨(apiCost),showTotalWithPlan 时为总额(cost)。
  const basis = display.totalWithPlan ? 'total' : 'api'
  const picked = rows
    .map(row => ({
      key: row.key,
      usd: positive(basis === 'total' ? row.cost : (row.apiCost ?? row.cost), 0),
      calls: positive(row.calls, 0),
    }))
    .filter(row => row.usd > 0)
    .sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key))
  const totalUsd = picked.reduce((sum, row) => sum + row.usd, 0)
  const toDisplay = usd => (display.currency === 'CNY' ? usd * display.rate : usd)
  return {
    ok: true,
    v: VERSION,
    src: source,
    mainActive: true,
    dayKey: localDayKey(nowMs),
    at: nowMs,
    currency: display.currency,
    symbol: display.symbol,
    decimals: display.decimals,
    totalUsd,
    totalDisplay: toDisplay(totalUsd),
    calls: positive(calls, 0),
    models: picked.map(row => ({
      ...row,
      display: toDisplay(row.usd),
      share: totalUsd > 0 ? row.usd / totalUsd : 0,
    })),
  }
}

/** 路径 1:主插件内存统计(零延迟,同口径)。 */
async function fromService(service, display, nowMs) {
  const dayKey = localDayKey(nowMs)
  const stats = await service.getBillingStatistics({ from: dayKey, to: dayKey, basis: 'total' })
  const rows = (Array.isArray(stats?.models) ? stats.models : []).map(row => ({
    key: String(row.key ?? ''),
    cost: row.cost,
    apiCost: row.apiCost,
    calls: row.calls,
  })).filter(row => row.key.length > 0)
  return assemble(rows, stats?.totals?.calls, display, nowMs, 'service')
}

/** 路径 2:只读账本文件(顺手拿到 config;严格零副作用,最多落后落盘防抖 2 秒)。 */
function fromFile(path, display, nowMs) {
  const ledger = readLedger(path)
  const dayKey = localDayKey(nowMs)
  const day = ledger?.days?.[dayKey]
  const byModel = day?.byProviderModel
  const rows = (byModel !== null && typeof byModel === 'object' ? Object.entries(byModel) : []).map(([key, bucket]) => ({
    key,
    cost: bucket?.cost,
    apiCost: bucket?.apiCost,
    calls: bucket?.calls,
  }))
  return assemble(rows, day?.calls, display, nowMs, 'file')
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

/** 无 Origin(同源导航/直连)放行;有 Origin 时必须与 Host 同源。 */
function sameOrigin(req) {
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin.length === 0) return true
  const host = req.headers?.host
  return typeof host === 'string' && host.length > 0 && origin.endsWith('//' + host)
}

export function apply(ctx, config = {}) {
  const path = ledgerPathOf(config)
  const prefer = config?.source === 'file' ? 'file' : config?.source === 'service' ? 'service' : 'auto'
  // 主插件探活:每次请求现查,主插件停用后无需重启/重载即刻生效。
  const mainService = () => {
    try {
      const service = ctx.get('costMeter')
      return service !== undefined && service !== null ? service : null
    } catch { return null }
  }
  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, v: VERSION, error: 'method not allowed' })
        return
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, v: VERSION, error: 'forbidden' })
        return
      }
      const service = mainService()
      if (service === null) {
        // 主插件已停用:前端据此隐藏整行,不留孤儿数字。
        sendJson(res, 200, { ok: false, v: VERSION, error: 'main-plugin-off' })
        return
      }
      const nowMs = Date.now()
      let display
      try {
        display = displayConfig(path)
      } catch (error) {
        sendJson(res, 200, { ok: false, v: VERSION, error: 'ledger-unreadable', message: String(error?.message ?? error) })
        return
      }
      // 内存统计优先(零延迟);它不可用或抛错时回落文件读取,不影响这一行继续显示。
      if (prefer !== 'file' && typeof service.getBillingStatistics === 'function') {
        try {
          sendJson(res, 200, await fromService(service, display, nowMs))
          return
        } catch { /* 落回文件路径 */ }
      }
      try {
        sendJson(res, 200, fromFile(path, display, nowMs))
      } catch (error) {
        sendJson(res, 200, { ok: false, v: VERSION, error: 'ledger-unreadable', message: String(error?.message ?? error) })
      }
    },
  })
  ctx.effect(() => () => { try { dispose() } catch { /* route fiber may be down already */ } }, 'cost-meter-modeltip: route')
}
