import assert from 'node:assert/strict'

let definition
globalThis.window = { __ModuleLoader__: { load: (value) => { definition = value } } }
globalThis.document = { documentElement: { lang: 'zh-CN' } }
await import('../lib/client.js')
const originalFetch = globalThis.fetch
const model = (active = true) => ({
  ok: true,
  layers: [
    { id: 'skin', multi: false, items: [{ key: 'skin-a', active, managed: true }] },
    { id: 'background', multi: false, items: [{ key: 'video-a', active: true, managed: true }] },
  ],
  managers: [{ key: 'skin-manager', active: false, managed: true }],
  presets: [],
})
function harness(response) {
  const hooks = []
  const effects = []
  const timers = []
  const posts = []
  const listeners = new Map()
  let cursor = 0
  let liveModel = model()
  let reads = 0
  let readGate = null
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const memo = (fn, deps) => {
    const i = cursor++
    if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { value: fn(), deps }
    return hooks[i].value
  }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const i = cursor++
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[i].value, (value) => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value }]
    },
    useRef: (initial) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect(fn, deps) {
      const i = cursor++
      if (!hooks[i] || !same(hooks[i].deps, deps)) {
        const previous = hooks[i]
        effects.push(() => { previous?.cleanup?.(); hooks[i] = { deps, cleanup: fn() } })
      }
    },
  }
  window.setTimeout = (fn) => { timers.push(fn) }
  window.addEventListener = (name, fn) => listeners.set(name, fn)
  window.removeEventListener = (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) }
  window.location = { reload: () => {} }
  globalThis.fetch = async (path, init) => {
    if (init?.method !== 'POST') {
      reads++
      const snapshot = liveModel
      const gate = readGate
      readGate = null
      if (gate) await gate
      return Response.json(snapshot)
    }
    posts.push({ path, body: JSON.parse(init.body) })
    return Response.json(response)
  }
  const exports = definition.factory((name) => { assert.equal(name, 'react'); return react })
  let Panel
  exports.apply({ slots: { inject: (_, fn) => fn(), register: (_, component) => { Panel = component } } })
  return {
    render() { cursor = 0; const tree = Panel(); while (effects.length) effects.shift()(); return tree },
    async ready() { await new Promise(setImmediate) },
    setModel: (value) => { liveModel = value },
    focus: () => listeners.get('focus')?.(),
    deferRead() { let release; readGate = new Promise((resolve) => { release = resolve }); return release },
    timers, posts,
    get reads() { return reads },
    dispose() { for (const hook of hooks) hook?.cleanup?.() },
  }
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.children)]
}
const component = (tree, name) => nodes(tree).find((node) => node.type?.name === name)
const layer = (tree, id) => nodes(tree).find((node) => node.type?.name === 'LayerCard' && node.props.layer.id === id)
const applyButton = (tree) => nodes(tree).find((node) => node.type === 'button' && node.props.className === 'amr-btn')
const text = (tree) => nodes(tree).flatMap((node) => node.children).filter((value) => typeof value === 'string').join(' ')

try {
  let h = harness({ ok: true, requested: [], changed: [] })
  h.render(); await h.ready()
  let tree = h.render()
  layer(tree, 'skin').props.onPick('')
  tree = h.render()
  h.setModel(model(false))
  await applyButton(tree).props.onClick()
  tree = h.render()
  assert.deepEqual(h.posts[0].body.selections, { skin: '' })
  assert.equal('managers' in h.posts[0].body, false)
  assert.equal(layer(tree, 'skin').props.layer.items[0].active, false)
  assert.equal(applyButton(tree).props.disabled, true)
  assert.equal(h.reads, 2)
  console.log('ok   an already-completed switch rereads state instead of keeping stale loaded labels')
  h.dispose()

  h = harness({ ok: true, requested: [{ row: 'skin', disabled: true }] })
  h.render(); await h.ready(); tree = h.render()
  layer(tree, 'skin').props.onPick(''); tree = h.render()
  await applyButton(tree).props.onClick(); tree = h.render()
  assert.equal(h.timers.length, 1)
  assert.equal(layer(tree, 'skin').props.busy, true)
  assert.equal(component(tree, 'ManagersCard').props.busy, true)
  console.log('ok   controls remain locked between successful switching and page reload')
  h.dispose()

  h = harness({ ok: true, requested: [{ row: 'skin', disabled: true }], restartRequired: true })
  h.render(); await h.ready(); tree = h.render()
  await component(tree, 'PresetCard').props.onApply({ id: 'preset', name: 'look' })
  tree = h.render()
  assert.equal(h.timers.length, 0)
  assert.equal(component(tree, 'PresetCard').props.busy, false)
  assert.match(component(tree, 'PresetCard').props.status, /重启 DSH/)
  console.log('ok   restart-required results are shown without falsely claiming a successful reload')
  h.dispose()

  h = harness({ ok: true, requested: [], changed: [] })
  h.render(); await h.ready(); tree = h.render()
  layer(tree, 'skin').props.onPick(''); tree = h.render()
  await component(tree, 'ManagersCard').props.onToggle('skin-manager', true)
  assert.deepEqual(h.posts[0].body.selections, {})
  assert.deepEqual(h.posts[0].body.managers, { 'skin-manager': true })
  console.log('ok   toggling a manager does not apply pending skin or video selections')
  h.dispose()

  h = harness({ ok: true, requested: [], changed: [] })
  h.render(); await h.ready(); tree = h.render()
  h.setModel(model(false))
  h.focus(); await h.ready(); tree = h.render()
  assert.equal(layer(tree, 'skin').props.layer.items[0].active, false)
  const before = h.reads
  layer(tree, 'skin').props.onPick('skin-a'); tree = h.render()
  h.focus(); await h.ready(); tree = h.render()
  assert.equal(h.reads, before)
  assert.equal(layer(tree, 'skin').props.selection.skin, 'skin-a')
  console.log('ok   returning to the panel refreshes external changes without discarding unsaved selections')
  h.dispose()

  h = harness({ ok: true, requested: [], changed: [] })
  h.render(); await h.ready(); tree = h.render()
  h.setModel(model(false))
  const releaseRead = h.deferRead()
  h.focus(); tree = h.render()
  layer(tree, 'skin').props.onPick('skin-a')
  releaseRead(); await h.ready(); tree = h.render()
  assert.equal(layer(tree, 'skin').props.selection.skin, 'skin-a')
  assert.equal(layer(tree, 'skin').props.layer.items[0].active, true)
  console.log('ok   a late background response cannot replace a more recent user selection')
  h.dispose()
} finally {
  globalThis.fetch = originalFetch
}
console.log('client behavior checks OK')
