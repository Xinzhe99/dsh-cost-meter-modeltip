// 数据源与生命周期联动测试:用假 ctx 直接驱动 apply() 注册的路由处理器。
// 覆盖:auto/service/file 三种数据源、内存变化即时反映、统计接口抛错回落文件、
// 主插件停用 → ok:false、同源 403、非 GET 405、版本标记与 package.json 一致。
// 全程只用 Node 内置模块与临时目录夹具,零外部依赖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const { apply, localDayKey } = await import(new URL('../lib/index.js', import.meta.url))

const today = localDayKey(Date.now())

// 账本夹具:与内存统计接口的数据刻意不同,以证明 service 路径被优先使用。
function writeLedger(dir) {
  const ledger = {
    version: 99,
    config: { currency: 'CNY', symbol: '¥', decimals: 4, exchangeRate: 7.2, showTotalWithPlan: false },
    days: {
      [today]: {
        date: today, calls: 5, cost: 3, apiCost: 2.5,
        byProviderModel: {
          'deepseek-account:deepseek-flash': { cost: 1, apiCost: 0.7, calls: 3 },
          'zai:glm-5.3': { cost: 2, apiCost: 1.8, calls: 2 },
        },
      },
    },
  }
  const path = join(dir, 'ledger.json')
  writeFileSync(path, JSON.stringify(ledger))
  return path
}

const serviceStats = multiplier => ({
  async getBillingStatistics(query) {
    this.lastQuery = query
    return {
      totals: { calls: 7, cost: 2 * multiplier, apiCost: 2 * multiplier },
      models: [
        { key: 'zai:glm-5.3', cost: 1.5 * multiplier, apiCost: 1.5 * multiplier, calls: 3 },
        { key: 'deepseek-account:deepseek-flash', cost: 0.5 * multiplier, apiCost: 0.5 * multiplier, calls: 4 },
      ],
    }
  },
})

function harness({ costMeter, config } = {}) {
  let route = null
  const ctx = {
    get: name => (name === 'costMeter' ? costMeter : undefined),
    webServer: { register: r => { route = r; return () => { route = null } } },
    effect: () => {},
  }
  apply(ctx, config)
  assert.ok(route, 'route must register')
  return async (init = {}) => {
    const req = { method: 'GET', headers: { host: '127.0.0.1:19387' }, ...init }
    const chunks = []
    const res = { writeHead() {}, end(body) { chunks.push(body) } }
    await route.handler(req, res)
    return { status: res.status, body: JSON.parse(chunks.join('')) }
  }
}

test('auto 模式优先走主插件内存统计,口径与侧边栏一致(默认 API 轨)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeltip-'))
  try {
    const costMeter = serviceStats(1)
    const call = harness({ costMeter, config: { ledgerPath: writeLedger(dir) } })
    const { body } = await call()
    assert.equal(body.ok, true)
    assert.equal(body.src, 'service', 'auto 必须优先内存统计')
    assert.equal(costMeter.lastQuery.from, today)
    assert.equal(costMeter.lastQuery.basis, 'total', '统计接口本身取总额,口径折算在插件侧完成')
    // 默认 showTotalWithPlan=false → 显示 API 轨(apiCost):1.5 + 0.5 = 2.0
    assert.equal(body.totalUsd, 2)
    assert.equal(body.models[0].key, 'zai:glm-5.3')
    assert.equal(body.models[0].usd, 1.5)
    assert.equal(body.models.length, 2)
    // 显示换算:CNY,汇率 7.2 → 2.0 * 7.2 = 14.4
    assert.equal(body.currency, 'CNY')
    assert.ok(Math.abs(body.totalDisplay - 14.4) < 1e-9)
    assert.equal(body.dayKey, today)
    console.log(`[ok] auto → src=service,total=$${body.totalUsd} → ¥${body.totalDisplay}(API 轨)`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('showTotalWithPlan=true 时切换为总额口径(cost)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeltip-plan-'))
  try {
    const path = writeLedger(dir)
    const ledger = JSON.parse(readFileSync(path, 'utf8'))
    ledger.config.showTotalWithPlan = true
    writeFileSync(path, JSON.stringify(ledger))
    const call = harness({ costMeter: serviceStats(1), config: { ledgerPath: path } })
    const { body } = await call()
    assert.equal(body.totalUsd, 2, 'cost 与 apiCost 相同的夹具下总额一致')
    // 把统计改成 api=0/total>0 的订阅型用量,验证口径切换真正生效
    const planOnly = { async getBillingStatistics() { return { totals: { calls: 1, cost: 9, apiCost: 0 }, models: [{ key: 'zai-coding-cn:glm-5.3', cost: 9, apiCost: 0, calls: 1 }] } } }
    const call2 = harness({ costMeter: planOnly, config: { ledgerPath: path } })
    const withPlan = await call2()
    assert.equal(withPlan.body.totalUsd, 9, `showTotalWithPlan=true 时计入订阅用量; body=${JSON.stringify(withPlan.body)}`)
    console.log('[ok] 口径切换:showTotalWithPlan → total 轨(订阅用量计入)')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('内存里刚记一笔 → 下一轮请求立即反映(零落盘延迟)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeltip-live-'))
  try {
    let multiplier = 1
    const stub = { async getBillingStatistics() {
      return {
        totals: { calls: 7, cost: 2 * multiplier, apiCost: 2 * multiplier },
        models: [{ key: 'zai:glm-5.3', cost: 1.5 * multiplier, apiCost: 1.5 * multiplier, calls: 3 }],
      }
    } }
    const call = harness({ costMeter: stub, config: { ledgerPath: writeLedger(dir) } })
    const first = await call()
    assert.equal(first.body.totalUsd, 1.5, '单模型初始值(单模型桩只有一条)')
    multiplier = 2.5
    const second = await call()
    assert.equal(second.body.totalUsd, 3.75, '同一请求路径,内存变化必须立即反映')
    console.log('[ok] 内存变化即时反映:$1.5 → $3.75(无需等落盘)')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('source=file 强制只读账本(严格零副作用),模型键与账本一致', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeltip-file-'))
  try {
    const call = harness({ costMeter: serviceStats(1), config: { source: 'file', ledgerPath: writeLedger(dir) } })
    const { body } = await call()
    assert.equal(body.src, 'file')
    assert.equal(body.ok, true)
    // API 轨:0.7 + 1.8 = 2.5
    assert.ok(Math.abs(body.totalUsd - 2.5) < 1e-9, `文件路径合计应为 2.5,实际 ${body.totalUsd}`)
    for (const row of body.models) {
      assert.ok(['deepseek-account:deepseek-flash', 'zai:glm-5.3'].includes(row.key))
    }
    console.log(`[ok] source=file → src=file,total=$${body.totalUsd}(API 轨)`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('内存统计抛错 → 自动回落文件读取,整行不消失', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeltip-fallback-'))
  try {
    const broken = { async getBillingStatistics() { throw new Error('boom') } }
    const call = harness({ costMeter: broken, config: { ledgerPath: writeLedger(dir) } })
    const { body } = await call()
    assert.equal(body.ok, true)
    assert.equal(body.src, 'file')
    console.log('[ok] 统计接口抛错 → 回落文件读取(ok:true)')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('主插件停用(undefined/null)→ ok:false 且无残留数据', async () => {
  for (const absent of [undefined, null]) {
    const dir = mkdtempSync(join(tmpdir(), 'modeltip-off-'))
    try {
      const call = harness({ costMeter: absent, config: { ledgerPath: writeLedger(dir) } })
      const { body } = await call()
      assert.equal(body.ok, false)
      assert.equal(body.error, 'main-plugin-off')
      assert.equal(body.models, undefined, '不给残留数据')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  console.log('[ok] 主插件停用 → ok:false(main-plugin-off)')
})

test('护栏:跨源 403、非 GET 405', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeltip-guard-'))
  try {
    const call = harness({ costMeter: serviceStats(1), config: { ledgerPath: writeLedger(dir) } })
    assert.equal((await call({ headers: { host: '127.0.0.1:19387', origin: 'http://evil.example' } })).body.error, 'forbidden')
    assert.equal((await call({ method: 'POST' })).body.error, 'method not allowed')
    console.log('[ok] 跨源 403 / 非 GET 405')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('版本标记与 package.json 一致(确认宿主装载的是哪份代码)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'modeltip-ver-'))
  try {
    const call = harness({ costMeter: serviceStats(1), config: { ledgerPath: writeLedger(dir) } })
    const { body } = await call()
    assert.equal(body.v, packageJson.version)
    console.log(`[ok] v=${body.v} 与 package.json 一致`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
