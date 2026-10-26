/**
 * 官方重组通道测试：确认 apply 之后会去“敲” pluginManager.setPluginEnabled，
 * 并把它的回答作为诊断带回；服务不存在时安静降级。
 *
 * 全程在临时 profile/home 里跑，不碰真实环境。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const base = fileURLToPath(new URL('./.tmp-nudge', import.meta.url))
rmSync(base, { recursive: true, force: true })
const profileDir = join(base, 'profile')
const homeDir = join(base, 'home')
mkdirSync(join(profileDir, 'node_modules/fake-web-widget'), { recursive: true })
mkdirSync(homeDir, { recursive: true })

const write = (path, content) => writeFileSync(path, content, 'utf8')

write(
  join(profileDir, 'package.json'),
  JSON.stringify(
    {
      name: 'tmp',
      private: true,
      dsh: { profile: { bundles: ['fake-web-widget'] } },
      dependencies: { 'fake-web-widget': '1.0.0' },
    },
    null,
    2,
  ),
)
write(
  join(profileDir, 'node_modules/fake-web-widget/package.json'),
  JSON.stringify({ name: 'fake-web-widget', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
)
write(join(profileDir, 'node_modules/fake-web-widget/cordis.patch.yml'), '- insert:\n    - id: fake-web-widget\n      name: fake-web-widget\n')
write(join(profileDir, 'cordis.patch.yml'), '# profile\n[]\n')

process.env.DSH_PROFILE_DIR = profileDir
process.env.DSH_HOME = homeDir
process.env.DSH_APPEARANCE_PRESETS = join(base, 'presets.json')

const calls = []
const homePatch = join(homeDir, 'cordis.patch.yml')
// 复刻真机上的 overridden：home 层留着我上一轮写的同名行（更高优先级）。
// 官方写入会被它盖住 —— 除非我们在请官方写之前就把它从自己的区块里摘掉。
writeFileSync(
  homePatch,
  ['# --- appearance-master managed (do not edit) ---', '- id: fake-web-widget', '  disabled: true', '# --- end appearance-master managed ---', ''].join('\n'),
  'utf8',
)
// 这个假管理器像真的一样**自己写补丁**：只有它真的写了，下一次读取才看得到状态变化，
// 也才能验证「官方写过的行，我们不再重复写」。
const fakePluginManager = {
  // 故意让 entryId 和补丁行 id 不同（真机上就是 include: 前缀那种形式）：
  // 官方要的是 entryId，我们必须先用 listPlugins() 解析，不能直接拿行 id 去调。
  async listPlugins() {
    return [{ entryId: 'include:fake-web-widget', moduleName: 'fake-web-widget', enabled: true, fiberPhase: 'active' }]
  },
  async setPluginEnabled(id, enabled) {
    // 记录“调用那一刻 home 层是否还压着这一行”——这正是 overridden 的成因
    const homeStillHasRow = readFileSync(homePatch, 'utf8').includes('- id: fake-web-widget')
    calls.push({ id, enabled, homeStillHasRow })
    const path = join(profileDir, 'cordis.patch.yml')
    const current = readFileSync(path, 'utf8')
    const marker = '# manager-managed'
    const kept = current.includes(marker) ? current.slice(0, current.indexOf(marker)).trimEnd() : current.trimEnd()
    const row = String(id).replace(/^include:/, '')
    writeFileSync(path, `${kept}\n\n${marker}\n- id: ${row}\n  disabled: ${enabled ? 'false' : 'true'}\n`, 'utf8')
    return { application: 'applied' }
  },
}

const routes = []
function makeCtx(pluginManager) {
  return {
    effect: (fn) => {
      fn()
      return () => {}
    },
    get: (name) => (name === 'pluginManager' ? pluginManager : undefined),
    connection: { fetch: { register: (entry) => (routes.push(entry), () => {}) } },
  }
}

const { apply } = await import('../lib/index.js')
apply(makeCtx(fakePluginManager))

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

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` (${detail})` : ''}`)
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
}

// home 层先把它压成停用，所以第一次应用是「启用」方向
const on = await call('/apply', 'POST', { confirm: true, selections: { decoration: ['fake-web-widget'] } })
check('启用的调用发生了', calls.length >= 1, JSON.stringify(calls))
check('用的是解析后的 entryId', calls[0]?.id === 'include:fake-web-widget' && calls[0]?.enabled === true, JSON.stringify(calls[0]))
// 这一条是 0.6.3 的核心：请官方写之前必须先把我们 home 层的同名行摘掉，否则它只能回 overridden
check('调用官方前 home 层已不再压着这一行', calls[0]?.homeStillHasRow === false, JSON.stringify(calls[0]))
check('诊断里带 entryId', on.payload.nudges.outcomes?.[0]?.entryId === 'include:fake-web-widget', JSON.stringify(on.payload.nudges.outcomes?.[0]))
check('官方判定 applied', on.payload.nudges?.available === true && on.payload.nudges.outcomes?.[0]?.application === 'applied', JSON.stringify(on.payload.nudges))

// 官方已 applied 的行必须从我们的受管区块里移除：留着它就会把官方写入覆盖成 overridden
const afterOn = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
const managed = afterOn.slice(afterOn.indexOf('# --- appearance-master managed'))
check('受管区块不再写这一行', !managed.includes('fake-web-widget'), managed)

// 再关掉：应该发 enabled=false，同样不能在我们这边留下覆盖行
calls.length = 0
const off = await call('/apply', 'POST', { confirm: true, selections: { decoration: [] } })
check('关闭时发 enabled=false', calls[0]?.id === 'include:fake-web-widget' && calls[0]?.enabled === false, JSON.stringify(calls[0]))
check('关闭同样成功', off.status === 200 && off.payload.ok === true)

// 没有 pluginManager 服务时要安静降级
routes.length = 0
apply(makeCtx(undefined))
const degraded = await call('/apply', 'POST', { confirm: true, selections: { decoration: [] } })
check('服务缺失时降级', degraded.status === 200 && degraded.payload.nudges?.available === false, JSON.stringify(degraded.payload.nudges))

rmSync(base, { recursive: true, force: true })

if (failures.length > 0) {
  console.error('\nFAILED:', failures.join('; '))
  process.exit(1)
}
console.log('\nnudge test OK')
