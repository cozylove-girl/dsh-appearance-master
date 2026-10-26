/**
 * 宿主侧冒烟测试：不启动 DSH，用假 ctx 验证路由、确认门控、预演与方案增删。
 *
 * 全部在 test/.tmp-host 里自建一个最小 profile —— 不读你机器上的真实 profile，
 * 所以换台机器、换个人 clone 下来也能直接跑。
 * 外观写入一律走 dryRun，不碰任何真实文件（除了临时目录）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const base = fileURLToPath(new URL('./.tmp-host', import.meta.url))
rmSync(base, { recursive: true, force: true })
const profileDir = join(base, 'profile')
const tmpHome = join(base, 'home')
mkdirSync(profileDir, { recursive: true })
mkdirSync(tmpHome, { recursive: true })

const write = (path, content) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}
const row = (id, name) => `- insert:\n    - id: ${id}\n      name: ${name}\n`
const pkg = (name, extra = {}) => JSON.stringify({ name, version: '1.0.0', ...extra })

write(
  join(profileDir, 'package.json'),
  JSON.stringify(
    {
      name: 'smoke-profile',
      private: true,
      dsh: { profile: { bundles: ['fake-theme', 'fake-manager'] } },
      dependencies: { 'fake-theme': '1.0.0', 'fake-manager': '1.0.0' },
    },
    null,
    2,
  ),
)
write(
  join(profileDir, 'node_modules/fake-theme/package.json'),
  pkg('fake-theme', { dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }),
)
write(join(profileDir, 'node_modules/fake-theme/cordis.patch.yml'), row('ui-fake-theme', 'fake-theme'))
write(
  join(profileDir, 'node_modules/fake-manager/package.json'),
  pkg('fake-manager', { dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } }),
)
write(join(profileDir, 'node_modules/fake-manager/cordis.patch.yml'), row('fake-manager', 'fake-manager'))
write(join(profileDir, 'cordis.patch.yml'), '# fixture patch\n[]\n')

const presetsFile = join(base, 'presets.json')
process.env.DSH_APPEARANCE_PRESETS = presetsFile
process.env.DSH_HOME = tmpHome
process.env.DSH_PROFILE_DIR = profileDir

const { apply, inject, name } = await import('../lib/index.js')

const routes = []
const ctx = {
  effect(fn) {
    fn()
    return () => {}
  },
  connection: {
    fetch: { register(entry) { routes.push(entry); return () => {} } },
  },
}

apply(ctx)

console.log('name:', name, 'inject:', inject)
console.log('routes:', routes.map((route) => `${route.methods.join('/')} ${route.path}`).join(' | '))

const routeFor = (suffix, method) =>
  routes.find((route) => route.path.endsWith(suffix) && route.methods.includes(method))

const call = async (suffix, method, body) => {
  const route = routeFor(suffix, method)
  if (!route) throw new Error(`route not found: ${method} ${suffix}`)
  const response = await route.fetch(
    new Request(`http://local${route.path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: response.status, payload: await response.json() }
}

const state = await call('/state', 'GET')
console.log('\n[1] state:', state.status, 'ok:', state.payload.ok)
console.log('    layers:', state.payload.layers?.map((layer) => `${layer.id}:${layer.items.length}`).join(' '))
console.log('    managers:', state.payload.managers?.map((manager) => manager.key).join(' ') || '-')
console.log('    presets:', state.payload.presets?.length ?? 'missing')
console.log('    presetsPath:', state.payload.presetsPath)

const noConfirm = await call('/apply', 'POST', { selections: {} })
console.log('\n[2] apply without confirm:', noConfirm.status, '(expect 400)')

const dry = await call('/apply', 'POST', { confirm: true, dryRun: true, selections: { theme: '' } })
console.log('[3] dryRun apply:', dry.status, 'rows:', dry.payload.rows?.length, 'changed:', dry.payload.changed?.length)

const bad = await call('/apply', 'POST', { confirm: true, dryRun: true, selections: { background: 'not-installed' } })
console.log('[4] bad selection:', bad.status, '(expect 400)', JSON.stringify(bad.payload).slice(0, 90))

// 管理器开关：只 dryRun，绝不写文件
const manager = (state.payload.managers ?? [])[0]
let managerOff = null
if (manager) {
  managerOff = await call('/apply', 'POST', {
    confirm: true,
    dryRun: true,
    selections: {},
    managers: { [manager.key]: false },
  })
  const row = managerOff.payload.rows?.find((entry) => entry.row === manager.rows[0])
  console.log('[4b] manager off (dryRun):', managerOff.status, 'row:', row?.row, 'disabled:', row?.disabled)
} else {
  console.log('[4b] 没有外观管理器，跳过')
}

const badManager = await call('/apply', 'POST', { confirm: true, dryRun: true, selections: {}, managers: { 'nope-manager': false } })
console.log('[4c] unknown manager:', badManager.status, '(expect 400)')

const saved = await call('/presets', 'POST', {
  confirm: true,
  action: 'save',
  name: '测试方案',
  selections: { skin: '', theme: 'fake-theme', background: '', decoration: [] },
})
console.log('\n[5] save preset:', saved.status, 'name:', saved.payload.preset?.name, 'count:', saved.payload.presets?.length)

const blank = await call('/presets', 'POST', { confirm: true, action: 'save', name: '   ', selections: {} })
console.log('[6] blank name:', blank.status, '(expect 400)', blank.payload.error)

const afterSave = await call('/state', 'GET')
console.log('[7] state after save → presets:', afterSave.payload.presets?.length, 'first:', afterSave.payload.presets?.[0]?.name)

const presetId = afterSave.payload.presets?.[0]?.id
const applied = await call('/presets', 'POST', { confirm: true, action: 'apply', id: presetId, dryRun: true })
console.log('[8] apply preset (dryRun):', applied.status, 'rows:', applied.payload.rows?.length, 'changed:', applied.payload.changed?.length)

const ghost = await call('/presets', 'POST', { confirm: true, action: 'apply', id: 'nope', dryRun: true })
console.log('[9] apply unknown preset:', ghost.status, '(expect 404)')

const removed = await call('/presets', 'POST', { confirm: true, action: 'delete', id: presetId })
console.log('[10] delete preset:', removed.status, 'left:', removed.payload.presets?.length)

const badAction = await call('/presets', 'POST', { confirm: true, action: 'explode' })
console.log('[11] bad action:', badAction.status, '(expect 400)')

const stored = existsSync(presetsFile) ? JSON.parse(readFileSync(presetsFile, 'utf8')) : null
console.log('\n[12] presets file written:', stored !== null, 'version:', stored?.version, 'presets:', stored?.presets?.length)

const heartbeatPath = join(tmpHome, 'appearance-master.heartbeat.json')
const heartbeat = existsSync(heartbeatPath) ? JSON.parse(readFileSync(heartbeatPath, 'utf8')) : null
console.log('[13] heartbeat written:', heartbeat !== null, 'version:', heartbeat?.version, 'routes:', heartbeat?.routes?.length)

rmSync(base, { recursive: true, force: true })

const failures = []
if (state.payload.ok !== true) failures.push('state not ok')
if (noConfirm.status !== 400) failures.push('confirm gate missing')
if (bad.status !== 400) failures.push('bad selection not rejected')
if (saved.status !== 200) failures.push('preset save failed')
if (blank.status !== 400) failures.push('blank name accepted')
if (afterSave.payload.presets?.length !== 1) failures.push('preset not listed')
if (applied.status !== 200) failures.push('preset apply failed')
if (ghost.status !== 404) failures.push('unknown preset not 404')
if (removed.payload.presets?.length !== 0) failures.push('preset delete failed')
if (badAction.status !== 400) failures.push('bad action accepted')
if (manager && managerOff?.status !== 200) failures.push('manager toggle failed')
if (manager && managerOff?.payload?.rows?.find((entry) => entry.row === manager.rows[0])?.disabled !== true) {
  failures.push('manager row not disabled')
}
if (badManager.status !== 400) failures.push('unknown manager accepted')
if (heartbeat === null) failures.push('heartbeat not written')
if (heartbeat !== null && !Array.isArray(heartbeat.routes)) failures.push('heartbeat routes missing')

if (failures.length > 0) {
  console.error('\nFAILED:', failures.join('; '))
  process.exit(1)
}
console.log('\nhost smoke test OK')
