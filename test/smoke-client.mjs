/**
 * 客户端模块冒烟测试：模拟 DSH 的 `window.__ModuleLoader__` 与 `require`，
 * 验证模块形状（apply / inject）和设置页注册参数，不真的渲染。
 */
const captured = []

globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured.push(definition)
    },
  },
}
globalThis.document = { documentElement: { lang: 'zh-CN' } }
try {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
} catch {
  /* Node 自带只读 navigator 时忽略：语言判定走 document.documentElement.lang */
}

await import(new URL('../lib/client.js', import.meta.url).href)

if (captured.length !== 1) throw new Error(`expected exactly one loader call, got ${captured.length}`)
const definition = captured[0]
console.log('loader id:', definition.id)
console.log('has factory:', typeof definition.factory === 'function')

const FakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
}

const exportsObject = definition.factory((specifier) => {
  if (specifier === 'react') return FakeReact
  throw new Error(`unexpected require(${specifier})`)
})

console.log('exports.apply:', typeof exportsObject.apply)
console.log('exports.inject:', JSON.stringify(exportsObject.inject))

const registrations = []
const fakeCtx = {
  slots: {
    inject(slotName, factory) {
      return factory()
    },
    register(descriptor, Component) {
      registrations.push({ descriptor, Component })
      return () => {}
    },
  },
}

exportsObject.apply(fakeCtx)

console.log('registrations:', registrations.length)
const { descriptor, Component } = registrations[0]
console.log('slot name:', descriptor.name)
console.log('slot id:', descriptor.id)
console.log('slot order:', descriptor.order)
console.log('label():', descriptor.label())
console.log('inject():', JSON.stringify(descriptor.inject()))
console.log('component is function:', typeof Component === 'function')

const tree = Component({})
console.log('root element type:', tree.type, 'props keys:', Object.keys(tree.props))

if (descriptor.name !== 'settings.section') throw new Error('wrong slot name')
if (descriptor.id !== 'appearance-master') throw new Error('wrong slot id')
if (typeof Component !== 'function') throw new Error('component missing')

// ── 面板的「选择」必须等于「现在真的加载着什么」 ─────────────────────
// 给「还没点应用就显示生效」立的规矩：面板拿到 /state 之后，四层的选择是从
// item.active 抄出来的，不是上一次意图留下的残影。
const { selectionFromState, activeKeyOf, managersFromState } = exportsObject.__internals
const sample = {
  layers: [
    { id: 'skin', multi: false, delegated: true, items: [{ key: 'skin-a', active: true }] },
    { id: 'theme', multi: false, items: [{ key: 'theme-a', active: false }, { key: 'theme-b', active: true }] },
    { id: 'background', multi: false, items: [{ key: 'bg-a', active: false }] },
    { id: 'decoration', multi: true, items: [{ key: 'w1', active: true }, { key: 'w2', active: false }, { key: 'w3', active: true }] },
  ],
  managers: [{ key: 'mgr', active: false }],
}
const selection = selectionFromState(sample)
console.log('selection:', JSON.stringify(selection))
if (selection.theme !== 'theme-b') throw new Error('single layer must follow the loaded item')
if (selection.background !== '') throw new Error('empty layer must select none')
if (JSON.stringify(selection.decoration) !== JSON.stringify(['w1', 'w3'])) throw new Error('multi layer must mirror actives')
// 皮肤层即使有切换器在管，也必须可操作、并且如实反映「现在加载的是哪一套」
if (selection.skin !== 'skin-a') throw new Error('skin layer must follow the loaded skin, even when delegated')
if (activeKeyOf(sample.layers[2]) !== '') throw new Error('activeKeyOf must report none')
if (managersFromState(sample).mgr !== false) throw new Error('manager state must mirror active')

console.log('\nclient smoke test OK')
