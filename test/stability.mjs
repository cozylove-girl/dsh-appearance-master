import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applySelections, readModel, parseFlags, rowIdsOf, MARK_START, MARK_END } from '../lib/scan.js'
import { addPreset, removePreset, readPresets } from '../lib/presets.js'
import { writeFilesAtomically } from '../lib/files.js'
import { apply } from '../lib/index.js'

const base = fs.mkdtempSync(fileURLToPath(new URL('./.tmp-stability-', import.meta.url)))
const profile = join(base, 'home', 'profiles', 'desktop')
const home = join(base, 'home')
const profilePatch = join(profile, 'cordis.patch.yml')
const homePatch = join(home, 'cordis.patch.yml')
const presetFile = join(home, 'appearance-presets.json')
process.env.DSH_PROFILE_DIR = profile
process.env.DSH_HOME = home
process.env.DSH_APPEARANCE_PRESETS = presetFile
const write = (path, value) => {
  fs.mkdirSync(dirname(path), { recursive: true })
  fs.writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}
const read = (path) => fs.readFileSync(path, 'utf8')
const check = (label, run) => { run(); console.log(`ok   ${label}`) }
const names = ['fake-skin', 'fake-video', 'fake-manager']
const manifest = (bundles = names) => ({ dsh: { profile: { bundles } }, dependencies: Object.fromEntries(names.map((n) => [n, '1'])) })
function reset() {
  write(join(profile, 'package.json'), manifest())
  for (const name of names) {
    write(join(profile, 'node_modules', name, 'package.json'), { name, version: '1', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    write(join(profile, 'node_modules', name, 'cordis.patch.yml'), `- insert:\n    - id: ${name}\n      name: ${name}\n`)
  }
  write(join(profile, 'node_modules/fake-skin/skin.json'), { id: 'skin' })
  write(profilePatch, '# profile\n')
  write(homePatch, '# home\n')
}
function makeRoutes(hmr) {
  const routes = new Map()
  apply({ profileContext: { dir: profile }, effect: (fn) => fn(), get: (key) => {
    if (key === 'hmr') return hmr
    if (key === 'pluginManager') return { setPluginEnabled() { throw Error('must not nest HMR transactions') } }
  }, connection: { fetch: { register: (route) => routes.set(route.path, route) } } })
  return async (suffix, body, headers = {}) => {
    const response = await routes.get(`/api/dsh-appearance${suffix}`).fetch(new Request(`http://local/api/dsh-appearance${suffix}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
    return { status: response.status, payload: await response.json() }
  }
}

try {
  reset()
  check('nested configuration ids and block strings are not plugin rows', () => {
    const text = '- insert:\n    - id: fake-skin\n      config:\n        entries:\n          - id: fake-video\n            disabled: true\n      description: |\n        - id: fake-manager\n          disabled: true\n      disabled: false\n'
    assert.deepEqual(rowIdsOf(text), ['fake-skin'])
    assert.deepEqual([...parseFlags(text)], [['fake-skin', false]])
    assert.equal(parseFlags('- id: x\n  disabled: true-ish').has('x'), false)
    assert.deepEqual(rowIdsOf('- id: "row with space"\n'), ['row with space'])
  })
  check('bundle defaults and explicit overrides produce the same UI and write state', () => {
    write(join(profile, 'node_modules/fake-skin/cordis.patch.yml'), '- insert:\n    - id: fake-skin\n      name: fake-skin\n      disabled: true\n')
    assert.equal(readModel().layers[0].items[0].active, false)
    write(profilePatch, '- id: fake-skin\n  disabled: false\n')
    assert.equal(readModel().layers[0].items[0].active, true)
  })
  reset()
  check('installed but deselected bundles cannot appear loaded or be toggled', () => {
    write(join(profile, 'package.json'), manifest(['fake-video', 'fake-manager']))
    const item = readModel().layers[0].items[0]
    assert.equal(item.active, false)
    assert.equal(item.managed, false)
    assert.equal(applySelections({ skin: 'fake-skin' }).ok, false)
  })
  reset()
  check('applying a look preserves disabled managers and foreign simple rows', () => {
    applySelections({}, { managers: { 'fake-manager': false } })
    applySelections({ skin: '' })
    assert.equal(parseFlags(read(homePatch)).get('fake-manager'), true)
    write(homePatch, `${MARK_START}\r\n- id: unrelated-addon\r\n  disabled: true\r\n${MARK_END}\r\n`)
    applySelections({ skin: '' })
    assert.equal(parseFlags(read(homePatch)).get('unrelated-addon'), true)
    assert.equal(/(?<!\r)\n/.test(read(homePatch)), false)
    assert.equal(applySelections({ skin: '' }).noop, true)
  })
  check('corrupt, unknown-version and partially invalid presets remain untouched', () => {
    for (const source of ['{broken', '{"version":2,"presets":[]}', '{"version":1,"presets":[null]}']) {
      write(presetFile, source)
      assert.equal(addPreset('new', {}).ok, false)
      assert.equal(removePreset('missing').ok, false)
      assert.equal(read(presetFile), source)
    }
    write(presetFile, { version: 1, presets: [] })
    const first = addPreset('one', {})
    assert.equal(first.ok, true)
    assert.equal(JSON.parse(read(`${presetFile}.bak`)).presets.length, 0)
    assert.equal(removePreset(first.preset.id).ok, true)
    assert.equal(readPresets().presets.length, 0)
  })
  reset()
  check('a failed second replacement restores the first and keeps both backups', () => {
    const originals = [profilePatch, homePatch].map(read)
    const rename = fs.renameSync
    fs.renameSync = (from, to) => {
      if (to === homePatch && !from.endsWith('.rollback.tmp')) throw Error('simulated second write failure')
      return rename(from, to)
    }
    syncBuiltinESMExports()
    try { assert.throws(() => applySelections({ skin: '' }), /simulated second write failure/) }
    finally { fs.renameSync = rename; syncBuiltinESMExports() }
    assert.deepEqual([profilePatch, homePatch].map(read), originals)
    assert.deepEqual([profilePatch, homePatch].map((p) => read(`${p}.master-bak`)), originals)
    assert.equal(fs.readdirSync(home).some((n) => n.endsWith('.tmp')), false)
  })
  check('concurrent external changes are rejected without overwriting them', () => {
    write(profilePatch, '# external change\n')
    assert.throws(() => writeFilesAtomically([{ path: profilePatch, original: '# old\n', next: '# new\n' }]), /其他程序修改/)
    assert.equal(read(profilePatch), '# external change\n')
  })

  reset()
  let inside = false
  let reconciles = 0
  const hmr = {
    async runExclusive(fn) { assert.equal(inside, false); inside = true; try { return await fn() } finally { inside = false } },
    async reconcileProfile() {
      assert.equal(inside, true)
      reconciles++
      assert.equal(parseFlags(read(profilePatch)).get('fake-skin'), true)
      assert.equal(parseFlags(read(homePatch)).get('fake-skin'), true)
      assert.equal(parseFlags(read(homePatch)).get('fake-video'), true)
      return { warnings: [], pending: [] }
    },
  }
  let call = makeRoutes(hmr)
  let reply = await call('/apply', { confirm: true, selections: { skin: '', background: '' } })
  assert.equal(reply.status, 200)
  assert.equal(reply.payload.restartRequired, false)
  assert.equal(reconciles, 1)
  console.log('ok   skin and video change in one HMR transaction, reconciled only after both files commit')
  hmr.reconcileProfile = async () => { throw Error('activation failed') }
  reply = await call('/apply', { confirm: true, selections: { skin: 'fake-skin' } })
  assert.equal(reply.payload.ok, true)
  assert.equal(reply.payload.restartRequired, true)
  assert.match(reply.payload.restartReason, /activation failed/)
  assert.notEqual(parseFlags(read(homePatch)).get('fake-skin'), true)
  console.log('ok   failed hot reload preserves desired configuration and explicitly requires restart')
  hmr.reconcileProfile = async () => ({ warnings: [], pending: [{ reason: 'package-moved' }] })
  reply = await call('/apply', { confirm: true, selections: { skin: '' } })
  assert.equal(reply.payload.restartRequired, true)
  assert.equal(reply.payload.restartReason, 'package-moved')
  console.log('ok   host restart-required outcomes are retained')

  reset()
  let release
  let entered
  const enteredFirst = new Promise((resolve) => { entered = resolve })
  const blocked = new Promise((resolve) => { release = resolve })
  let generations = 0
  hmr.reconcileProfile = async () => {
    if (++generations === 1) { entered(); await blocked }
    return { warnings: [], pending: [] }
  }
  const first = call('/apply', { confirm: true, selections: { skin: '' } })
  await enteredFirst
  let secondDone = false
  const second = call('/apply', { confirm: true, selections: { skin: 'fake-skin' } }).then((result) => { secondDone = true; return result })
  let stateDone = false
  const state = call('/state').then((result) => { stateDone = true; return result })
  await Promise.resolve()
  assert.equal(secondDone, false)
  assert.equal(stateDone, false)
  release()
  assert.equal((await first).status, 200)
  assert.equal((await second).status, 200)
  assert.equal((await state).payload.layers[0].items[0].active, true)
  assert.equal(generations, 2)
  console.log('ok   overlapping switches are serialized; state responses wait for switching to finish')
  assert.equal((await call('/apply', { confirm: true }, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await call('/apply', { confirm: true }, { origin: 'https://elsewhere.invalid' })).status, 403)
  assert.equal((await call('/apply', { confirm: true }, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await call('/apply', { confirm: true, selections: [] })).status, 400)
  assert.equal((await call('/apply', { confirm: true, padding: 'x'.repeat(256 * 1024) })).status, 413)
  assert.equal((await call('/apply', null)).status, 400)
  console.log('ok   cross-origin, text/plain and malformed selections cannot change configuration')
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}
console.log('stability checks OK')
