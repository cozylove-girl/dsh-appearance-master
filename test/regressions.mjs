/**
 * 回归测试：把这次修掉的几个「真 bug」钉住。
 *
 *   1. parseFlags 不再把 config 里的 enabled/disabled 当成行开关
 *   2. 受管区块丢了结束标记时，不吃掉用户后面的配置
 *   3. 官方插件管理器「拒绝」的行必须回落到本面板自己的两层写入（以前是彻底不写）
 *   4. 官方接手的行不再重复写我们自己的行（不抢同一行）
 *   5. pageReload 按「请求过的行」算：官方接手的宿主注入型行也要触发刷新
 *   6. 方案应用也走官方通道
 *
 * 全程在临时 profile/home 里跑，不碰真实环境。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = fileURLToPath(new URL('./.tmp-regressions', import.meta.url))
rmSync(base, { recursive: true, force: true })
const profileDir = join(base, 'profile')
const homeDir = join(base, 'home')
mkdirSync(profileDir, { recursive: true })
mkdirSync(homeDir, { recursive: true })

const write = (path, content) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

// 两个包：一个客户端插件（能热重载），一个宿主注入型装饰件（必须刷新页面）
write(
  join(profileDir, 'package.json'),
  JSON.stringify(
    {
      name: 'tmp-profile',
      private: true,
      dsh: { profile: { bundles: ['fake-theme', 'fake-widget'] } },
      dependencies: { 'fake-theme': '1.0.0', 'fake-widget': '1.0.0' },
    },
    null,
    2,
  ),
)
write(
  join(profileDir, 'node_modules/fake-theme/package.json'),
  JSON.stringify({
    name: 'fake-theme',
    version: '1.0.0',
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
  }),
)
write(join(profileDir, 'node_modules/fake-theme/cordis.patch.yml'), '- insert:\n    - id: ui-fake-theme\n      name: fake-theme\n')
write(
  join(profileDir, 'node_modules/fake-widget/package.json'),
  JSON.stringify({ name: 'fake-widget', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
)
write(join(profileDir, 'node_modules/fake-widget/cordis.patch.yml'), '- insert:\n    - id: fake-widget\n      name: fake-widget\n')

// 用户自己的配置 + 一段被 config 嵌套误导的历史行；
// 并且两个外观包一开始都被别的层停用着 —— 这样「打开它们」才是一次真实的变化。
write(
  join(profileDir, 'cordis.patch.yml'),
  [
    '# user patch layer',
    '- id: ui-settings',
    '  name: "@deepseek-ai/dsh-client-ui-settings"',
    '  config:',
    '    enabled: true',
    '- id: ui-fake-theme',
    '  disabled: true',
    '- id: fake-widget',
    '  disabled: true',
    '',
  ].join('\n'),
)

// home 层：优先级更高，而且另一个管理器在这里也压着同名行 —— 真机上的冲突形态
write(
  join(homeDir, 'cordis.patch.yml'),
  ['# --- dsh-skin managed (auto-generated; do not edit) ---', '- id: fake-widget', '  disabled: true', '# --- end dsh-skin managed ---', ''].join('\n'),
)

process.env.DSH_PROFILE_DIR = profileDir
process.env.DSH_HOME = homeDir
process.env.DSH_APPEARANCE_PRESETS = join(base, 'presets.json')

const { applySelections, effectiveFlags, parseFlags, readModel, resolvePatchPaths, stripManagedBlock, foreignBlockRows, MARK_START, MARK_END } =
  await import('../lib/scan.js')

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` (${detail})` : ''}`)
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
}

// ── 1. parseFlags：嵌套 config 不算开关 ───────────────────────────
const nested = ['- id: ui-settings', '  name: x', '  config:', '    enabled: true', '- id: ui-video', '  disabled: true'].join('\n')
const nestedFlags = parseFlags(nested)
check('config 里的 enabled 不再被当成行开关', nestedFlags.get('ui-settings') === undefined, JSON.stringify([...nestedFlags]))
check('真正的行级 disabled 仍然读得到', nestedFlags.get('ui-video') === true, JSON.stringify([...nestedFlags]))

// ── 2. 结束标记丢失时不能吃掉用户配置 ─────────────────────────────
const broken = [
  '# --- appearance-master managed (do not edit) ---',
  '# written by dsh-appearance-master; rows below are owned by this panel',
  '- id: ui-fake-theme',
  '  disabled: true',
  '',
  '# 用户自己的设置',
  '- id: ui-theme',
  '  name: "@deepseek-ai/dsh-client-ui-theme"',
  '  config:',
  '    preference: dark',
].join('\n')
const healed = stripManagedBlock(broken, { ownedRows: new Set(['ui-fake-theme']) })
check('区块头与我们的行被摘掉', !healed.includes('appearance-master managed') && !healed.includes('ui-fake-theme'), healed)
check('后面的用户配置完整保留', healed.includes('ui-theme') && healed.includes('preference: dark'), healed)

// ── 2b. 落进我们区块里的「别人的行」不能被删掉 ─────────────────────
// 真机上的实例：官方插件管理器 / 插件自己的设置项都往文件末尾追加，
// 于是会物理上落进我们区块的中间。整段重写时把它删了就等于吃掉用户设置。
const foreignInBlock = [
  MARK_START,
  '# written by dsh-appearance-master; rows below are owned by this panel',
  '- id: ui-skin-maid-atelier',
  '  disabled: true',
  '- id: ui-skin-claude-style',
  '  disabled: false',
  '  config:',
  '    sodium: on',
  MARK_END,
].join('\n')
const legacyOwnership = { ownedRows: new Set(['ui-skin-maid-atelier', 'ui-skin-claude-style']) }
const kept = foreignBlockRows(foreignInBlock.slice(MARK_START.length, foreignInBlock.length - MARK_END.length), legacyOwnership)
check('带额外键的外来行被识别为「别人的」', kept.length === 1 && kept[0].includes('sodium: on'), JSON.stringify(kept))
const strippedForeign = stripManagedBlock(foreignInBlock, legacyOwnership)
check('重写区块时外来行被保留', strippedForeign.includes('sodium: on') && strippedForeign.includes('ui-skin-claude-style'), strippedForeign)
check('我们自己的行仍然被摘掉', !strippedForeign.includes('ui-skin-maid-atelier'), strippedForeign)
check('保留的外来行排在区块前面（我们的块仍是最后一段）', strippedForeign.trimEnd().endsWith('sodium: on'), strippedForeign)

// ── 3/4/5. 官方通道的归属判据 ─────────────────────────────────────
const calls = []
const fakePluginManager = {
  async listPlugins() {
    return [
      // 官方能寻址的行：带 patchId
      { entryId: 'include:ui-fake-theme', moduleName: 'fake-theme', enabled: false, fiberPhase: 'active', patchId: 'ui-fake-theme' },
      // 官方明说管不了的行
      { entryId: 'include:fake-widget', moduleName: 'fake-widget', enabled: true, fiberPhase: 'active', readOnlyReason: 'unaddressable' },
    ]
  },
  async setPluginEnabled(id, enabled) {
    calls.push({ id, enabled })
    if (id === 'include:ui-fake-theme') return { application: 'applied' }
    return { application: 'failed' }
  },
}

const routes = []
const ctx = {
  effect: (fn) => {
    fn()
    return () => {}
  },
  get: (name) => (name === 'pluginManager' ? fakePluginManager : undefined),
  connection: { fetch: { register: (entry) => (routes.push(entry), () => {}) } },
}
const { apply } = await import('../lib/index.js')
apply(ctx)

const routeFor = (suffix, method) => routes.find((route) => route.path.endsWith(suffix) && route.methods.includes(method))
const call = async (suffix, method, body) => {
  const route = routeFor(suffix, method)
  const response = await route.fetch(
    new Request(`http://local${route.path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: response.status, payload: await response.json() }
}

const on = await call('/apply', 'POST', { confirm: true, selections: { theme: 'fake-theme', decoration: ['fake-widget'] } })
check('应用成功', on.status === 200 && on.payload.ok === true, JSON.stringify(on.payload).slice(0, 200))

// 官方接手的行：不再写我们的行
const profileText = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
const managed = profileText.slice(profileText.indexOf('# --- appearance-master managed'))
check('官方 applied 的行没有重复写进我们的区块', !managed.includes('ui-fake-theme'), managed)
check('官方接手的行算它的', JSON.stringify(on.payload.ownership.pluginManager) === JSON.stringify(['ui-fake-theme']), JSON.stringify(on.payload.ownership))

// 官方管不了的行：必须回落到我们自己的两层写入，否则开关是死的。
// 这里 fake-widget 在 home 层还有一份（另一个管理器写的），官方只写 profile 层，
// 交过去必然换回 overridden —— 0.8.3 起直接跳过它，由我们两层写。
check(
  'home 层也有同一行时，不交给官方（避免必然的 overridden）',
  on.payload.nudges.outcomes.some((entry) => entry.row === 'fake-widget' && entry.application === 'home-layer'),
  JSON.stringify(on.payload.nudges),
)
check('回落的行确实写进了区块（disabled: false）', /- id: fake-widget\s+disabled: false/.test(managed), managed)
check('回落的行写了两层', existsSync(join(homeDir, 'cordis.patch.yml')) && readFileSync(join(homeDir, 'cordis.patch.yml'), 'utf8').includes('fake-widget'))

// 把 home 层里那一行拿掉之后，同一条行会走「官方明说管不了」的 readonly 回落
write(
  join(homeDir, 'cordis.patch.yml'),
  ['# --- dsh-skin managed (auto-generated; do not edit) ---', '# --- end dsh-skin managed ---', ''].join('\n'),
)
const readonly = await call('/apply', 'POST', { confirm: true, selections: { theme: 'fake-theme', decoration: [] } })
check(
  '官方拒绝（unaddressable）的行回落到本面板',
  readonly.payload.nudges.outcomes.some((entry) => entry.row === 'fake-widget' && entry.application === 'readonly'),
  JSON.stringify(readonly.payload.nudges),
)
check('回落之后两层都写着停用', effectiveFlags(resolvePatchPaths()).get('fake-widget') === true, JSON.stringify([...effectiveFlags(resolvePatchPaths())]))

// 2c. 端到端：往我们区块中间塞一条「别人的行」，应用一次之后它必须还在
{
  const configPath = join(profileDir, 'cordis.patch.yml')
  const before = readFileSync(configPath, 'utf8')
  const endIndex = before.indexOf(MARK_END)
  check('区块结束标记存在（下一步的注入点）', endIndex !== -1)
  if (endIndex !== -1) {
    write(configPath, `${before.slice(0, endIndex)}- id: ui-fake-theme\n  config:\n    sodium: on\n${before.slice(endIndex)}`)
    const forced = await call('/apply', 'POST', { confirm: true, selections: { decoration: ['fake-widget'] } })
    check('这次应用确实写了文件', (forced.payload.requested ?? []).length > 0, JSON.stringify(forced.payload.requested))
    const after = readFileSync(configPath, 'utf8')
    check('端到端：应用之后外来行还在', after.includes('sodium: on'), after.slice(-320))
    check('端到端：我们自己的行照常被重写', /appearance-master managed/.test(after))
  }
}

// pageReload：宿主注入型（fake-widget 没有 dsh.client）
check('宿主注入型变化要求刷新页面', on.payload.pageReload === true, String(on.payload.pageReload))

// 关掉它
const off = await call('/apply', 'POST', { confirm: true, selections: { theme: 'fake-theme', decoration: [] } })
check('关闭宿主注入型也要求刷新', off.payload.pageReload === true, String(off.payload.pageReload))
check('关闭后两层都写着 disabled: true', effectiveFlags(resolvePatchPaths()).get('fake-widget') === true, JSON.stringify([...effectiveFlags(resolvePatchPaths())]))

// ── 6. 方案应用也走官方通道 ────────────────────────────────────────
const saved = await call('/presets', 'POST', { confirm: true, action: 'save', name: '回归', selections: { theme: 'fake-theme', decoration: ['fake-widget'] } })
check('方案保存成功', saved.status === 200 && saved.payload.preset?.id, JSON.stringify(saved.payload).slice(0, 120))
calls.length = 0
const applied = await call('/presets', 'POST', { confirm: true, action: 'apply', id: saved.payload.preset.id })
check('应用方案时官方通道被调用', applied.status === 200 && applied.payload.nudges?.available === true, JSON.stringify(applied.payload.nudges))
check('应用方案的结果带 pageReload', typeof applied.payload.pageReload === 'boolean', JSON.stringify(applied.payload.pageReload))

// ── 直写模式（没有官方管理器）：仍然写两层 ────────────────────────
routes.length = 0
apply({ ...ctx, get: () => undefined })
const direct = await call('/apply', 'POST', { confirm: true, selections: { theme: '', decoration: ['fake-widget'] } })
check('没有官方服务时照样写两层', direct.status === 200 && direct.payload.nudges?.available === false, JSON.stringify(direct.payload.nudges))
check('直写模式下开关真的生效', effectiveFlags(resolvePatchPaths()).get('ui-fake-theme') === true, JSON.stringify([...effectiveFlags(resolvePatchPaths())]))

// ── 7. 任何一行变了都要刷新页面（不只是宿主注入型） ────────────────
// 以前只对「没有 dsh.client」的插件返回 pageReload，于是改主题、改背景时面板
// 宣布「已生效（页面无需刷新）」—— 那句话读的是文件，不是页面。
routes.length = 0
apply({ ...ctx, get: () => undefined })
const themeOnly = await call('/apply', 'POST', { confirm: true, selections: { theme: 'fake-theme', decoration: [] } })
check(
  '只改客户端插件（fake-theme 有 dsh.client）也要求刷新',
  themeOnly.payload.pageReload === true && themeOnly.payload.requested.some((c) => c.row === 'ui-fake-theme'),
  JSON.stringify({ pageReload: themeOnly.payload.pageReload, requested: themeOnly.payload.requested }),
)
const steady = await call('/apply', 'POST', { confirm: true, selections: { theme: 'fake-theme', decoration: [] } })
check('没有任何变化时不要求刷新', steady.payload.pageReload === false && (steady.payload.requested ?? []).length === 0, JSON.stringify(steady.payload))

// ── 8. 皮肤层只委托给「真正的切换器」，不是市场 ────────────────────
// 真机上的事故：dsh-skin-market（市场）被 /skin/i 当成了皮肤管理器，
// 于是皮肤层永远是只读的一行，用户把真正的管理器关掉也改不回来。
{
  const profile2 = join(base, 'profile2')
  const manifest = (deps, bundles) =>
    JSON.stringify({ name: 'tmp2', private: true, dsh: { profile: { bundles } }, dependencies: deps }, null, 2)
  const pkg = (name, extra = {}) => JSON.stringify({ name, version: '1.0.0', ...extra })
  const row = (id, name) => `- insert:\n    - id: ${id}\n      name: ${name}\n`
  const put = (rel, content) => write(join(profile2, rel), content)

  put('package.json', manifest(
    { 'dsh-skin-market': '1.0.0', 'fake-skin': '1.0.0' },
    ['dsh-skin-market', 'fake-skin'],
  ))
  put('node_modules/dsh-skin-market/package.json', pkg('dsh-skin-market', { dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }))
  put('node_modules/dsh-skin-market/cordis.patch.yml', row('dsh-skin-market', 'dsh-skin-market'))
  put('node_modules/fake-skin/package.json', pkg('fake-skin', { dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }))
  put('node_modules/fake-skin/cordis.patch.yml', row('ui-fake-skin', 'fake-skin'))
  put('node_modules/fake-skin/skin.json', JSON.stringify({ id: 'fake-skin', name: 'Fake Skin', bodyAttr: 'data-fake-skin' }))
  put('cordis.patch.yml', '[]\n')

  process.env.DSH_PROFILE_DIR = profile2
  const marketOnly = readModel()
  check(
    '只有市场在跑时，皮肤层不委托（面板可以自己管）',
    marketOnly.ok === true && marketOnly.delegated?.skin === undefined && marketOnly.layers.find((l) => l.id === 'skin')?.delegated !== true,
    JSON.stringify(marketOnly.delegated),
  )

  // 换成真正的皮肤切换器：名字里有 skin + manager
  put('package.json', manifest(
    {
      'dsh-skin-market': '1.0.0',
      'fake-skin': '1.0.0',
      '@someone/fake-skin-manager': '1.0.0',
    },
    ['dsh-skin-market', 'fake-skin', '@someone/fake-skin-manager'],
  ))
  put('node_modules/@someone/fake-skin-manager/package.json', pkg('@someone/fake-skin-manager', { dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }))
  put('node_modules/@someone/fake-skin-manager/cordis.patch.yml', row('ui-fake-skin-manager', '@someone/fake-skin-manager'))

  const withManager = readModel()
  check(
    '真正的皮肤管理器在跑时，皮肤层才委托给它',
    withManager.delegated?.skin === '@someone/fake-skin-manager',
    JSON.stringify(withManager.delegated),
  )

  // 9. 即使切换器在跑，本面板也必须能管皮肤 —— 特别是「一个都不加载」
  const offAll = applySelections({ skin: '' }, { profileDir: profile2 })
  check(
    '有切换器时也能把皮肤全部关掉',
    offAll.ok === true && offAll.changed.some((change) => change.row === 'ui-fake-skin' && change.disabled === true),
    JSON.stringify(offAll.changed),
  )
  check('全部关掉后那一行确实是 disabled: true', effectiveFlags(resolvePatchPaths(profile2)).get('ui-fake-skin') === true, JSON.stringify([...effectiveFlags(resolvePatchPaths(profile2))]))
  check('关皮肤不会顺手关掉皮肤管理器', effectiveFlags(resolvePatchPaths(profile2)).get('ui-fake-skin-manager') !== true)

  const onOne = applySelections({ skin: 'fake-skin' }, { profileDir: profile2 })
  // 注意：这时我们自己的行会被摘掉（外面本来就没停用它），所以查询结果是 undefined
  // —— 对解析器来说 undefined 就是「没有被停用」，也就是启用。
  check('再打开某一套皮肤', onOne.ok === true && effectiveFlags(resolvePatchPaths(profile2)).get('ui-fake-skin') !== true, JSON.stringify(onOne.changed))
  check('切皮肤也要求刷新页面', onOne.pageReload === true)
  check('我们不再重复写皮肤行（让区块只留真正的意见）', (onOne.blockRows ?? []).length === 0, JSON.stringify(onOne.blockRows))

  process.env.DSH_PROFILE_DIR = profileDir
}

rmSync(base, { recursive: true, force: true })

if (failures.length > 0) {
  console.error('\nFAILED:', failures.join('; '))
  process.exit(1)
}
console.log('\nregressions test OK')
