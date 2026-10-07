/**
 * dsh-cost-meter-modeltip — 客户端半：在侧边栏页脚自有一行「今日按模型」。
 *
 * 手写单文件模块（与 DSH 客户端插件契约一致，无需构建步骤）：
 *  - window.__ModuleLoader__.load({ id, factory }) 注册；
 *  - factory($e) 用 $e('react') / $e('@deepseek-ai/dsh-client-ui-primitives') 取依赖；
 *  - 导出 { apply, inject }：inject 声明依赖的客户端服务，apply(ctx) 注册插槽。
 * 数据只来自本插件自己的只读路由，不碰 cost-meter 的服务、存储或 RPC。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter-modeltip',
  factory: $e => {
    const React = $e('react')
    const { Tooltip } = $e('@deepseek-ai/dsh-client-ui-primitives')
    const { createElement: h, useEffect, useState } = React

    const ROUTE = 'api/dsh-cost-meter-modeltip/today'
    // 数值新鲜度：主插件落盘有 2s 防抖（ledger.scheduleWrite），所以这里 1.5s 轮询 +
    // 悬停立即刷新 + 切回页面立即复查，把"显示落后"压到 ≈2s 落盘 + ≤1.5s 轮询。
    // 页面不可见时不轮询；载荷没变化不重渲染。全程只读，不写账本、不碰主插件状态。
    const POLL_MS = 1500
    const SLOT = 'sidebar.footer.action'
    const STYLE_ID = 'cm-tip-style'
    const CSS = [
      '.cm-tip-row{display:flex;align-items:center;justify-content:space-between;gap:10px;height:28px;padding:0 8px;border-radius:8px;font-size:11px;line-height:28px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden}',
      '.cm-tip-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.cm-tip-title{overflow:hidden;text-overflow:ellipsis}',
      '.cm-tip-amt{flex:none;font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.cm-tip-rail{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
    ].join('')

    const isZh = () => {
      try { return /^zh/i.test(String(document.documentElement.lang || navigator.language || '')) } catch (_) { return true }
    }
    const money = (value, data) => {
      const num = Number(value)
      if (!Number.isFinite(num)) return '—'
      const decimals = Number.isInteger(data?.decimals) ? data.decimals : 4
      const symbol = typeof data?.symbol === 'string' && data.symbol ? data.symbol : (data?.currency === 'CNY' ? '¥' : '$')
      return symbol + num.toFixed(decimals)
    }
    const share = ratio => Math.round((Number.isFinite(ratio) ? ratio : 0) * 100) + '%'

    function TodayModels(props) {
      const [data, setData] = useState(null)
      // 上一次载荷指纹：数字没变就不 setState，避免每轮轮询都触发一次重渲染。
      const signature = React.useRef('')
      const loadRef = React.useRef(null)
      useEffect(() => {
        let alive = true
        const load = async () => {
          // 页面不可见时跳过：切回来自动立即复查（visibilitychange）。
          if (document.visibilityState === 'hidden') return
          try {
            const res = await fetch(ROUTE, { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error('route unavailable')
            const body = await res.json()
            if (!alive) return
            // 路由消失 = 主插件被停用（宿主半边随 costMeter 服务一起卸载）：
            // 清空数据让整行隐藏，而不是继续展示上一份「孤儿」数字。
            if (!body || body.ok !== true) {
              signature.current = ''
              setData(null)
              return
            }
            const next = JSON.stringify([body.dayKey, body.currency, body.symbol, body.decimals, body.totalUsd, body.models])
            if (next === signature.current) return
            signature.current = next
            setData(body)
          } catch (_) {
            if (alive) { signature.current = ''; setData(null) }
          }
        }
        loadRef.current = load
        load()
        const timer = setInterval(load, POLL_MS)
        const onVisible = () => { if (document.visibilityState === 'visible') load() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          loadRef.current = null
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      const models = Array.isArray(data?.models) ? data.models : []
      // 单一模型没有歧义（原插件的今日合计也不会被误读），整行不渲染。
      if (models.length < 2) return null
      const top = models[0]
      const title = isZh() ? '今日按模型' : 'Today by model'
      const lines = [
        title + ' · ' + money(data.totalDisplay, data),
        ...models.slice(0, 6).map(row => row.key + ' ' + money(row.display, data) + ' · ' + share(row.share)),
      ].join('\n')
      const body = props?.wide === false
        ? h('span', { className: 'cm-tip-rail', onMouseEnter: () => loadRef.current?.() }, money(top.display, data))
        : h('div', { className: 'cm-tip-row', onMouseEnter: () => loadRef.current?.() },
          h('span', { className: 'cm-tip-title' }, title + ' · ' + top.key),
          h('span', { className: 'cm-tip-amt' }, money(top.display, data)))
      return h(Tooltip, { label: h('span', { style: { whiteSpace: 'pre-line' } }, lines), side: 'right', delayMs: 300 }, body)
    }

    function injectStyle() {
      try {
        const existing = document.getElementById(STYLE_ID)
        if (existing !== null) {
          // 客户端热更新后旧样式可能残留：内容不同就替换，避免规则悄悄丢失。
          if (existing.textContent !== CSS) existing.textContent = CSS
          return
        }
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
      } catch (_) {}
    }

    const inject = ['slots']

    async function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined || slots === null) return
      injectStyle()
      slots.inject(SLOT, () => slots.register(
        { name: SLOT, id: 'cost-meter-modeltip', order: 3, inject: () => ({}) },
        TodayModels,
      ))
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
