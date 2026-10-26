/**
 * 皮肤细调协议的离线测试：
 *   - 取值规整（六种控件）
 *   - 可见时段语义（与皮肤管理器一致）
 *   - visibleWhen / anyOf 的显示条件
 *   - 与皮肤管理器共用的 localStorage 键：读写与按皮肤合并
 *   - 事件名与协议常量
 *
 * 用假 window / document / React 载入客户端模块，不启动 DSH。
 */
class FakeWindow extends EventTarget {
  constructor() {
    super()
    this.store = new Map()
    this.localStorage = {
      getItem: (key) => (this.store.has(key) ? this.store.get(key) : null),
      setItem: (key, value) => this.store.set(key, String(value)),
      removeItem: (key) => this.store.delete(key),
    }
  }
}

globalThis.window = new FakeWindow()
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  body: { hasAttribute: () => false },
}
try {
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
} catch {
  /* Node 自带只读 navigator 时忽略 */
}

const captured = []
globalThis.window.__ModuleLoader__ = { load: (definition) => captured.push(definition) }

await import(new URL('../lib/client.js', import.meta.url).href)
const definition = captured[0]

const FakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
}
const moduleExports = definition.factory((specifier) => {
  if (specifier === 'react') return FakeReact
  throw new Error(`unexpected require(${specifier})`)
})

const internals = moduleExports.__internals
const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` (${detail})` : ''}`)
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
}

check('暴露了内部函数', typeof internals?.normalizeSetting === 'function' && typeof internals?.scheduleVisible === 'function')

const { normalizeSetting, normalizeValues, scheduleVisible, settingVisible, readPrefs, writePrefs, TUNING_EVENTS, PREFERENCES_KEY } = internals
check('事件名与皮肤管理器一致', TUNING_EVENTS[2].register === 'dsh:skin-customization-register-v2' && TUNING_EVENTS[1].ready === 'dsh:skin-customization-ready-v1')
check('存储键与皮肤管理器一致', PREFERENCES_KEY === 'dsh.skin-manager.preferences.v2')

// ── 取值规整 ───────────────────────────────────────────────
const boolSetting = { key: 'artwork', type: 'boolean', defaultValue: true }
check('boolean 非布尔回退默认', normalizeSetting(boolSetting, 'yes') === true && normalizeSetting(boolSetting, false) === false)

const selectSetting = { key: 'font', type: 'select', defaultValue: 'b', options: [{ value: 'a' }, { value: 'b' }] }
check('select 只接受声明过的值', normalizeSetting(selectSetting, 'a') === 'a' && normalizeSetting(selectSetting, 'zzz') === 'b')

const rangeSetting = { key: 'blur', type: 'range', min: 0, max: 10, defaultValue: 4 }
check('range 夹在区间内', normalizeSetting(rangeSetting, 99) === 10 && normalizeSetting(rangeSetting, -3) === 0 && normalizeSetting(rangeSetting, 'x') === 4)

const colorSetting = { key: 'accent', type: 'color', defaultValue: '#112233' }
check('color 校验十六进制', normalizeSetting(colorSetting, '#AABBCC') === '#aabbcc' && normalizeSetting(colorSetting, 'red') === '#112233')

const groupSetting = { key: 'parts', type: 'checkbox-group', defaultValue: ['a'], options: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] }
check(
  'checkbox-group 过滤未知项并保序',
  JSON.stringify(normalizeSetting(groupSetting, ['c', 'zzz', 'a'])) === JSON.stringify(['a', 'c']),
  JSON.stringify(normalizeSetting(groupSetting, ['c', 'zzz', 'a'])),
)

const scheduleSetting = { key: 'hide', type: 'visibility-schedule', defaultValue: { enabled: false, outside: 'visible', ranges: [] } }
const normalized = normalizeSetting(scheduleSetting, { enabled: true, outside: 'hidden', ranges: [{ start: '09:00', end: '18:00' }, { start: '18:00', end: '18:00' }, { start: '25:00', end: '26:00' }] })
check('visibility-schedule 丢掉非法时段', normalized.ranges.length === 1 && normalized.enabled === true && normalized.outside === 'hidden', JSON.stringify(normalized))

const def = { skinId: 'demo', settings: [boolSetting, selectSetting, rangeSetting, colorSetting, groupSetting, scheduleSetting] }
const values = normalizeValues(def, { artwork: false, font: 'a', blur: 7, accent: '#00FF00' })
check(
  'normalizeValues 覆盖所有声明项',
  Object.keys(values).length === 6 && values.artwork === false && values.blur === 7 && values.accent === '#00ff00',
  JSON.stringify(values),
)

// ── 可见时段 ───────────────────────────────────────────────
const dayRange = { enabled: true, outside: 'visible', ranges: [{ start: '09:00', end: '18:00' }] }
const at = (hour) => new Date(2026, 0, 1, hour, 30)
check('范围内 + outside=visible → 隐藏', scheduleVisible(dayRange, at(10)) === false)
check('范围外 + outside=visible → 显示', scheduleVisible(dayRange, at(20)) === true)
check('范围内 + outside=hidden → 显示', scheduleVisible({ ...dayRange, outside: 'hidden' }, at(10)) === true)
check('未启用时恒显示', scheduleVisible({ ...dayRange, enabled: false }, at(10)) === true)
check('跨午夜区间生效', scheduleVisible({ enabled: true, outside: 'hidden', ranges: [{ start: '22:00', end: '06:00' }] }, at(23)) === true)

// ── 显示条件 ───────────────────────────────────────────────
check('visibleWhen 单键', settingVisible({ visibleWhen: { key: 'artwork', values: [true] } }, { artwork: true }) === true)
check('visibleWhen 不满足时隐藏', settingVisible({ visibleWhen: { key: 'artwork', values: [true] } }, { artwork: false }) === false)
check('anyOf 家族开关', settingVisible({ visibleWhen: { anyOf: [{ key: 'a', values: [1] }, { key: 'b', values: [2] }] } }, { a: 0, b: 2 }) === true)
check('没有条件时恒显示', settingVisible({}, {}) === true)

// ── 偏好存储 ───────────────────────────────────────────────
check('初始读为空对象', Object.keys(readPrefs()).length === 0)
writePrefs('skin-a', { artwork: false, font: 'a' })
writePrefs('skin-b', { blur: 3 })
writePrefs('skin-a', { font: 'b' })
const prefs = readPrefs()
check('按皮肤分块并存', prefs['skin-a'].font === 'b' && prefs['skin-a'].artwork === false && prefs['skin-b'].blur === 3, JSON.stringify(prefs))
check('写的是皮肤管理器认得的 JSON', JSON.stringify(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY))) === JSON.stringify(prefs))

if (failures.length > 0) {
  console.error('\nFAILED:', failures.join('; '))
  process.exit(1)
}
console.log('\ntuning-protocol test OK')
