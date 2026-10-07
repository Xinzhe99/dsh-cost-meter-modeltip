// 客户端半冒烟测试:在 VM 里加载 lib/client.js(假 window/document/ModuleLoader),
// 驱动 apply() 注册插槽,并用假 React 渲染行组件,断言悬停明细内容。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

function loadClient({ snapshot, fetchImpl, visibility = 'visible' } = {}) {
  let loaded = null
  let fetchCalls = 0
  const storage = new Map()
  const sandbox = {
    navigator: { language: 'zh-CN' },
    fetch: fetchImpl ?? (async () => { fetchCalls += 1; return { ok: true, json: async () => snapshot } }),
    setInterval: () => 0,
    clearInterval: () => {},
    document: {
      visibilityState: visibility,
      addEventListener() {}, removeEventListener() {},
      documentElement: { lang: 'zh-CN' },
      getElementById: () => null,
      createElement: () => ({ set textContent(value) { this._text = value }, get textContent() { return this._text ?? '' } }),
      head: { appendChild() {} },
    },
    window: {
      __ModuleLoader__: { load: mod => { loaded = mod } },
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      addEventListener() {}, removeEventListener() {},
    },
  }
  vm.createContext(sandbox)
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  vm.runInContext(source, sandbox, { filename: 'lib/client.js' })

  // 假 React:hooks 用模块级顺序槽;setState 直接写值(测试里手动重渲)。
  let hookIndex = 0
  const hooks = []
  const el = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const React = {
    createElement: el,
    Fragment: 'fragment',
    useRef: value => { const i = hookIndex++; return hooks[i] ??= { current: value } },
    useState: init => { const i = hookIndex++; if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init; return [hooks[i], value => { hooks[i] = value }] },
    useEffect(fn) { effect = fn },
  }
  let effect = null
  const module = loaded.factory(name => (name === 'react' ? React : { Tooltip: 'tooltip' }))

  const slotsLog = []
  const slots = {
    inject: (name, cb) => { const dispose = cb(); slotsLog.push({ name, dispose }) },
    register: (options, component) => { slotsLog.push({ registered: options, component }); return () => {} },
  }
  const effects = []
  const ctx = { get: name => (name === 'slots' ? slots : undefined), effect: (fn) => { effects.push(fn) } }
  module.apply(ctx)

  return {
    module, slotsLog, sandbox,
    fetchCalls: () => fetchCalls,
    effect: () => effect,
    // 渲染最近注册的插槽组件(hooks 不重置,模拟同一实例的后续渲染)
    render: props => { hookIndex = 0; effect = null; return module_lastComponent()(props) },
  }
  function module_lastComponent() {
    const registered = [...slotsLog].reverse().find(x => x.registered)
    return registered.component
  }
}

const snapshot = multiplier => ({
  ok: true, v: '1.0.0', src: 'service', mainActive: true,
  dayKey: '2026-10-08', currency: 'CNY', symbol: '¥', decimals: 4,
  totalUsd: 2 * multiplier, totalDisplay: 2 * multiplier * 7.2, calls: 7,
  models: [
    { key: 'zai:glm-5.3', usd: 1.5 * multiplier, display: 1.5 * multiplier * 7.2, calls: 3, share: 0.75 },
    { key: 'deepseek-account:deepseek-flash', usd: 0.5 * multiplier, display: 0.5 * multiplier * 7.2, calls: 4, share: 0.25 },
  ],
})

const flatten = n => Array.isArray(n) ? n.flatMap(flatten) : n && typeof n === 'object' ? [n, ...flatten(n.children)] : []
const textOf = node => (node?.children ?? []).map(c => typeof c === 'string' ? c : '').join('')

test('客户端注册到 sidebar.footer.action 且 id 正确', () => {
  const h = loadClient({ snapshot: snapshot(1) })
  assert.equal(h.module.inject.length > 0, true)
  const registered = h.slotsLog.filter(x => x.registered)
  assert.equal(registered.length, 1, '只注册一行')
  assert.equal(registered[0].registered.name, 'sidebar.footer.action')
  assert.equal(registered[0].registered.id, 'cost-meter-modeltip')
  console.log('[ok] 插槽注册:sidebar.footer.action / cost-meter-modeltip')
})

test('≥2 个模型时渲染行 + Tooltip 含全部模型与占比', async () => {
  const h = loadClient({ snapshot: snapshot(1) })
  let tree = h.render({ wide: true })          // 首渲:data 尚未到达 → null
  assert.equal(tree, null)
  const effect = h.effect()                    // 捕获组件 setup(useEffect 桩不自动执行)
  assert.equal(typeof effect, 'function', '副作用应返回清理函数')
  effect()                                     // 运行 setup:发起 load()
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  tree = h.render({ wide: true })              // 数据到达后的渲染
  const tooltip = flatten(tree).find(n => n.type === 'tooltip')
  assert.ok(tooltip, '必须包一层 Tooltip')
  const label = textOf(tooltip.props.label)
  const lines = label.split('\n')
  assert.ok(lines[0].includes('今日按模型'), '首行标题')
  assert.ok(lines[1].startsWith('zai:glm-5.3 '), '最高费用模型排第一')
  assert.ok(lines[1].includes('75%'), '占比标注')
  assert.ok(lines[2].includes('deepseek-account:deepseek-flash'))
  assert.ok(lines[2].includes('25%'))
  const row = flatten(tree).find(n => n.props?.className === 'cm-tip-row')
  assert.ok(row, '折叠态行元素存在')
  console.log(`[ok] 悬停明细:${lines[1]} / ${lines[2]}`)
})

test('单一模型(<2)时整行不渲染', async () => {
  const single = snapshot(1)
  single.models = [single.models[0]]
  const h = loadClient({ snapshot: single })
  let tree = h.render({ wide: true })
  h.effect()()
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  tree = h.render({ wide: true })
  const tooltip = flatten(tree).find(n => n.type === 'tooltip')
  assert.equal(tooltip, undefined, '单一模型不应渲染')
  console.log('[ok] 单一模型 → 整行隐藏')
})

test('路由不可用(ok:false)→ 清空数据、整行隐藏', async () => {
  let payload = { ok: true, json: async () => snapshot(1) }
  const h = loadClient({ fetchImpl: async () => payload })
  let tree = h.render({ wide: true })
  h.effect()()
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  tree = h.render({ wide: true })
  assert.ok(flatten(tree).find(n => n.type === 'tooltip'), '先有数据才有行')
  // 主插件停用:路由回 ok:false → 数据清空 → 整行隐藏
  payload = { ok: true, json: async () => ({ ok: false, error: 'main-plugin-off' }) }
  h.effect()()
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r))
  tree = h.render({ wide: true })
  assert.equal(tree, null, 'ok:false 后整行必须隐藏,不留孤儿数字')
  console.log('[ok] ok:false → 数据清空、整行隐藏')
})
