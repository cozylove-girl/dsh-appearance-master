window.__ModuleLoader__.load({
  id: 'dsh-appearance-master',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const ROUTE = '/api/dsh-appearance'

    const COPY = {
      zh: {
        navLabel: '外观总控',
        title: '外观总控',
        intro: '皮肤、主题、背景、装饰件分层管理。每层选一个，应用后写回配置并刷新页面。',
        apply: '应用并刷新',
        applying: '正在应用…',
        reloading: '已写入，正在刷新页面…',
        saved: '没有需要改动的地方',
        none: '不使用（官方外观）',
        noneSkin: '关闭所有皮肤（官方外观）',
        active: '已加载',
        idle: '已停用',
        pending: '待应用',
        unsupported: '找不到对应的插件行',
        empty: '这一层还没有可管理的插件',
        failed: '读取失败',
        retry: '重试',
        refresh: '重新读取',
        refreshing: '正在读取…',
        warnings: '提示',
        count: (n, total) => `${total} 个外观插件，${n} 个已加载`,
        layerPick: '选一个',
        layerMany: '可多选',
        conflict: (n) => `${n} 个同时加载，应用后只留一个`,
        presetsTitle: '整套方案',
        presetsNote: '存一套，随时切回。',
        presetName: '给这套外观起个名字',
        presetSave: '保存当前选择',
        presetApplying: '正在应用…',
        presetApply: '应用',
        presetDelete: '删除',
        presetConfirmDelete: '确认删除',
        presetEmpty: '还没存过方案。',
        presetSaved: (name) => `已保存「${name}」`,
        presetDeleted: '已删除',
        presetApplied: (name) => `已应用「${name}」`,
        presetFull: '方案数量已达上限',
        managersTitle: '其它外观管理器',
        managersNote: '它们也写同一批行，建议只留一个。',
        delegatedInline: (name) => `与皮肤管理器「${name}」同步；细调在「设置 → 皮肤管理」。`,
        tuningTitle: '当前皮肤的细调',
        tuningNote: '由皮肤自己声明。',
        tuningEmpty: '这套皮肤没有可调项。',
        on: '开',
        off: '关',
        outsideVisible: '时段外：显示',
        outsideHidden: '时段外：隐藏',
        addRange: '+ 时间段',
        managerOn: '已启用',
        managerOff: '已停用',
        managerEmpty: '没有检测到其它外观管理器',
        byPanel: (n) => `其中 ${n} 行由本面板直接写入`,
      },
      en: {
        navLabel: 'Appearance',
        title: 'Appearance master',
        intro: 'Skins, themes, backgrounds and decorations in layers. Pick one per layer, apply, and the page reloads once.',
        apply: 'Apply and reload',
        applying: 'Applying…',
        reloading: 'Written — reloading…',
        saved: 'Nothing needed changing',
        none: 'None (official look)',
        noneSkin: 'No skin at all (official look)',
        active: 'Loaded',
        idle: 'Off',
        pending: 'Pending',
        unsupported: 'No plugin row found',
        empty: 'Nothing to manage in this layer yet',
        failed: 'Failed to load',
        retry: 'Retry',
        refresh: 'Read again',
        refreshing: 'Reading…',
        warnings: 'Notes',
        count: (n, total) => `${total} appearance plugins, ${n} loaded`,
        layerPick: 'Pick one',
        layerMany: 'Multiple',
        conflict: (n) => `${n} loaded at once; applying keeps one`,
        presetsTitle: 'Saved looks',
        presetsNote: 'Save one, switch back any time.',
        presetName: 'Name this look',
        presetSave: 'Save current choice',
        presetApplying: 'Applying…',
        presetApply: 'Apply',
        presetDelete: 'Delete',
        presetConfirmDelete: 'Confirm delete',
        presetEmpty: 'No saved looks yet.',
        presetSaved: (name) => `Saved “${name}”`,
        presetDeleted: 'Deleted',
        presetApplied: (name) => `Applying “${name}”`,
        presetFull: 'Preset limit reached',
        managersTitle: 'Other appearance managers',
        managersNote: 'They write the same rows — keep one.',
        delegatedInline: (name) => `Synced with the skin manager “${name}”; fine-tuning lives under Settings → Skins.`,
        tuningTitle: 'Fine-tuning this skin',
        tuningNote: 'Declared by the skin itself.',
        tuningEmpty: 'This skin declares no settings.',
        on: 'On',
        off: 'Off',
        outsideVisible: 'Outside: show',
        outsideHidden: 'Outside: hide',
        addRange: '+ Range',
        managerOn: 'On',
        managerOff: 'Off',
        managerEmpty: 'No other appearance manager detected',
        byPanel: (n) => `${n} of those rows were written by this panel`,
      },
    }

    function isZh() {
      const lang = (document.documentElement.lang || navigator.language || '').toLowerCase()
      return lang.startsWith('zh')
    }

    function copy() {
      return isZh() ? COPY.zh : COPY.en
    }

    function labelOf(field) {
      if (!field || typeof field !== 'object') return ''
      return isZh() ? field.zh ?? field.en ?? '' : field.en ?? field.zh ?? ''
    }

    // ── 皮肤自定义协议（与皮肤管理器共用同一套事件与存储）────────────────────
    //
    // 皮肤通过 window 事件声明自己的细调项：
    //   dsh:skin-customization-register-v2  detail = { token, definition }
    //   definition = { protocol: 2, skinId, settings: Setting[], apply(payload) }
    // 生效方式是调 definition.apply({ values, visibility })；
    // 取值持久化在 localStorage["dsh.skin-manager.preferences.v2"] = { [skinId]: { [key]: value } }。
    //
    // 这里刻意**不**依赖皮肤管理器：它被停用、或根本不在时，本面板照样能渲染和生效。
    const TUNING_EVENTS = {
      1: {
        register: 'dsh:skin-customization-register-v1',
        unregister: 'dsh:skin-customization-unregister-v1',
        ready: 'dsh:skin-customization-ready-v1',
      },
      2: {
        register: 'dsh:skin-customization-register-v2',
        unregister: 'dsh:skin-customization-unregister-v2',
        ready: 'dsh:skin-customization-ready-v2',
      },
    }
    const PREFERENCES_KEY = 'dsh.skin-manager.preferences.v2'
    const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
    const DEFAULT_SCHEDULE = { enabled: false, outside: 'visible', ranges: [] }

    function asObject(value) {
      return typeof value === 'object' && value !== null ? value : {}
    }

    function readPrefs() {
      try {
        const raw = window.localStorage.getItem(PREFERENCES_KEY)
        return raw === null ? {} : asObject(JSON.parse(raw))
      } catch {
        return {}
      }
    }

    /** 合并写入某个皮肤的一个键；失败（配额等）时回退到内存值，不抛给界面。 */
    function writePrefs(skinId, values) {
      const all = readPrefs()
      const block = { ...asObject(all[skinId]), ...values }
      const next = { ...all }
      Object.defineProperty(next, skinId, { value: block, writable: true, enumerable: true, configurable: true })
      try {
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next))
        return true
      } catch {
        return false
      }
    }

    function normalizeSchedule(value) {
      const source = asObject(value)
      const ranges = []
      if (Array.isArray(source.ranges)) {
        for (const entry of source.ranges) {
          const item = asObject(entry)
          if (typeof item.start !== 'string' || typeof item.end !== 'string') continue
          if (!TIME_PATTERN.test(item.start) || !TIME_PATTERN.test(item.end) || item.start === item.end) continue
          ranges.push({ start: item.start, end: item.end })
          if (ranges.length === 24) break
        }
      }
      return {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SCHEDULE.enabled,
        outside: source.outside === 'hidden' ? 'hidden' : 'visible',
        ranges,
      }
    }

    /** 把任意输入规整成该控件声明的合法值（类型不符就用默认值）。 */
    function normalizeSetting(setting, value) {
      if (setting.type === 'boolean') return typeof value === 'boolean' ? value : setting.defaultValue
      if (setting.type === 'select') {
        const options = Array.isArray(setting.options) ? setting.options : []
        return typeof value === 'string' && options.some((option) => option.value === value) ? value : setting.defaultValue
      }
      if (setting.type === 'range') {
        const numeric = typeof value === 'number' && Number.isFinite(value) ? value : setting.defaultValue
        return Math.min(setting.max, Math.max(setting.min, numeric))
      }
      if (setting.type === 'color') {
        return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : setting.defaultValue
      }
      if (setting.type === 'checkbox-group') {
        const options = Array.isArray(setting.options) ? setting.options : []
        const picked = new Set(Array.isArray(value) ? value : setting.defaultValue)
        return options.map((option) => option.value).filter((entry) => picked.has(entry))
      }
      return normalizeSchedule(value ?? setting.defaultValue)
    }

    function normalizeValues(definition, raw) {
      const source = asObject(raw)
      const result = {}
      for (const setting of definition.settings) result[setting.key] = normalizeSetting(setting, source[setting.key])
      return result
    }

    function minutesOf(time) {
      const [hour = 0, minute = 0] = time.split(':').map(Number)
      return hour * 60 + minute
    }

    /** 与皮肤管理器同一套语义：启用了时段时，范围内外按 outside 取反。 */
    function scheduleVisible(schedule, now = new Date()) {
      if (!schedule.enabled) return true
      const minuteOfDay = now.getHours() * 60 + now.getMinutes()
      const inside = schedule.ranges.some(({ start, end }) => {
        const from = minutesOf(start)
        const to = minutesOf(end)
        return from < to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to
      })
      const outsideVisible = schedule.outside === 'visible'
      return inside ? !outsideVisible : outsideVisible
    }

    function settingVisible(setting, values) {
      const when = setting.visibleWhen
      if (when === undefined || when === null) return true
      const holds = (condition) => Array.isArray(condition?.values) && condition.values.includes(values[condition.key])
      if (Array.isArray(when.anyOf)) return when.anyOf.some(holds)
      return holds(when)
    }

    /** 调皮肤自己的 apply：进度/显隐都在它手里，我们只负责把取值送过去。 */
    function applyDefinition(definition, values) {
      try {
        const now = new Date()
        const visibility = {}
        for (const setting of definition.settings) {
          if (setting.type === 'visibility-schedule') visibility[setting.key] = scheduleVisible(values[setting.key], now)
        }
        definition.apply({ values, visibility })
      } catch (error) {
        // 皮肤自己的副作用失败不该带崩整个设置页
        console.error('[appearance-master] skin customization failed', error)
      }
    }

    /** 订阅皮肤注册表：收集 definition，并在挂载时向已加载的皮肤要一次声明。 */
    function useSkinDefinitions() {
      const [definitions, setDefinitions] = useState([])
      useEffect(() => {
        const registry = new Map()
        const publish = () => setDefinitions([...new Set(registry.values())])
        const onRegister = (event) => {
          const detail = event?.detail
          const definition = detail?.definition
          if (!definition || typeof definition.apply !== 'function' || !Array.isArray(definition.settings)) return
          registry.set(detail.token, definition)
          publish()
        }
        const onUnregister = (event) => {
          const detail = event?.detail
          if (!detail?.token || !registry.has(detail.token)) return
          registry.delete(detail.token)
          publish()
        }
        for (const proto of [1, 2]) {
          window.addEventListener(TUNING_EVENTS[proto].register, onRegister)
          window.addEventListener(TUNING_EVENTS[proto].unregister, onUnregister)
        }
        // 握手：让已经在页面里的皮肤重新播报一次（加载顺序因此无关）
        for (const proto of [1, 2]) {
          try {
            window.dispatchEvent(new CustomEvent(TUNING_EVENTS[proto].ready))
          } catch {
            /* 老浏览器没有 CustomEvent 时跳过 */
          }
        }
        return () => {
          for (const proto of [1, 2]) {
            window.removeEventListener(TUNING_EVENTS[proto].register, onRegister)
            window.removeEventListener(TUNING_EVENTS[proto].unregister, onUnregister)
          }
        }
      }, [])
      return definitions
    }

    function settingLabel(setting) {
      const zh = isZh()
      const text = zh ? setting.label ?? setting.title ?? setting.name : setting.labelEn ?? setting.label ?? setting.title ?? setting.name
      return typeof text === 'string' && text !== '' ? text : setting.key
    }

    /** 一个皮肤的细调控件。数值改动立刻写回 localStorage 并调它的 apply。 */
    function SkinTuningCard({ skin, definition }) {
      const c = copy()
      const [values, setValues] = useState(() => normalizeValues(definition, readPrefs()[definition.skinId]))

      useEffect(() => {
        setValues(normalizeValues(definition, readPrefs()[definition.skinId]))
      }, [definition])

      const commit = (key, value) => {
        const setting = definition.settings.find((entry) => entry.key === key)
        const next = { ...values, [key]: setting ? normalizeSetting(setting, value) : value }
        setValues(next)
        writePrefs(definition.skinId, next)
        applyDefinition(definition, next)
      }

      const visible = definition.settings.filter((setting) => settingVisible(setting, values))

      return h(
        'section',
        { className: 'amr-layer', 'data-layer': 'tuning' },
        h(
          'div',
          { className: 'amr-layerHead' },
          h('strong', null, `${c.tuningTitle} · ${skin.displayName ?? definition.skinId}`),
          h('span', null, `${visible.length}`),
        ),
        h('p', { className: 'amr-note' }, c.tuningNote),
        h(
          'div',
          { className: 'amr-list' },
          visible.map((setting) => {
            const value = values[setting.key]
            const label = settingLabel(setting)
            if (setting.type === 'boolean') {
              return h(
                'div',
                { className: 'amr-row', key: setting.key, 'data-multi': 'true' },
                h('span', { className: 'amr-body' }, h('span', { className: 'amr-name' }, label)),
                h(
                  'button',
                  {
                    className: 'amr-switch',
                    type: 'button',
                    'data-on': String(value === true),
                    onClick: () => commit(setting.key, !value),
                  },
                  value ? c.on : c.off,
                ),
              )
            }
            if (setting.type === 'select') {
              return h(
                'div',
                { className: 'amr-row', key: setting.key, 'data-multi': 'true' },
                h('span', { className: 'amr-body' }, h('span', { className: 'amr-name' }, label)),
                h(
                  'select',
                  {
                    className: 'amr-input',
                    style: { maxWidth: '200px' },
                    value,
                    onChange: (event) => commit(setting.key, event.target.value),
                  },
                  (setting.options ?? []).map((option) =>
                    h('option', { key: option.value, value: option.value }, isZh() ? option.label ?? option.value : option.labelEn ?? option.label ?? option.value),
                  ),
                ),
              )
            }
            if (setting.type === 'range') {
              return h(
                'div',
                { className: 'amr-row', key: setting.key, 'data-multi': 'true' },
                h(
                  'span',
                  { className: 'amr-body' },
                  h('span', { className: 'amr-name' }, label),
                  h('span', { className: 'amr-desc' }, String(value)),
                ),
                h('input', {
                  type: 'range',
                  style: { width: '160px' },
                  min: setting.min,
                  max: setting.max,
                  step: setting.step ?? 1,
                  value,
                  onChange: (event) => commit(setting.key, Number(event.target.value)),
                }),
              )
            }
            if (setting.type === 'color') {
              return h(
                'div',
                { className: 'amr-row', key: setting.key, 'data-multi': 'true' },
                h('span', { className: 'amr-body' }, h('span', { className: 'amr-name' }, label), h('span', { className: 'amr-desc' }, value)),
                h('input', {
                  type: 'color',
                  value,
                  onChange: (event) => commit(setting.key, event.target.value),
                }),
              )
            }
            if (setting.type === 'checkbox-group') {
              const picked = Array.isArray(value) ? value : []
              return h(
                'div',
                { className: 'amr-row', key: setting.key, 'data-multi': 'true' },
                h('span', { className: 'amr-body' }, h('span', { className: 'amr-name' }, label)),
                h(
                  'div',
                  { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                  (setting.options ?? []).map((option) =>
                    h(
                      'button',
                      {
                        key: option.value,
                        className: 'amr-btnGhost',
                        type: 'button',
                        'data-danger': String(picked.includes(option.value)),
                        style: picked.includes(option.value) ? { borderColor: 'currentColor' } : undefined,
                        onClick: () =>
                          commit(
                            setting.key,
                            picked.includes(option.value) ? picked.filter((entry) => entry !== option.value) : [...picked, option.value],
                          ),
                      },
                      isZh() ? option.label ?? option.value : option.labelEn ?? option.label ?? option.value,
                    ),
                  ),
                ),
              )
            }
            // visibility-schedule：启用开关 + 时段外策略 + 时间段编辑
            const schedule = value ?? DEFAULT_SCHEDULE
            return h(
              'div',
              { className: 'amr-layer', key: setting.key, style: { background: 'transparent', borderStyle: 'dashed' } },
              h(
                'div',
                { className: 'amr-layerHead' },
                h('strong', null, label),
                h(
                  'button',
                  {
                    className: 'amr-switch',
                    type: 'button',
                    'data-on': String(schedule.enabled === true),
                    onClick: () => commit(setting.key, { ...schedule, enabled: !schedule.enabled }),
                  },
                  schedule.enabled ? c.on : c.off,
                ),
              ),
              schedule.enabled
                ? h(
                    'div',
                    { className: 'amr-saveRow' },
                    h(
                      'select',
                      {
                        className: 'amr-input',
                        style: { maxWidth: '160px' },
                        value: schedule.outside,
                        onChange: (event) => commit(setting.key, { ...schedule, outside: event.target.value }),
                      },
                      h('option', { value: 'visible' }, c.outsideVisible),
                      h('option', { value: 'hidden' }, c.outsideHidden),
                    ),
                    ...(schedule.ranges ?? []).map((range, index) =>
                      h(
                        'span',
                        { key: `${range.start}-${range.end}-${index}`, style: { display: 'flex', gap: '4px', alignItems: 'center' } },
                        h('input', {
                          className: 'amr-input',
                          style: { width: '86px' },
                          value: range.start,
                          onChange: (event) =>
                            commit(setting.key, {
                              ...schedule,
                              ranges: schedule.ranges.map((entry, i) => (i === index ? { ...entry, start: event.target.value } : entry)),
                            }),
                        }),
                        h('span', null, '–'),
                        h('input', {
                          className: 'amr-input',
                          style: { width: '86px' },
                          value: range.end,
                          onChange: (event) =>
                            commit(setting.key, {
                              ...schedule,
                              ranges: schedule.ranges.map((entry, i) => (i === index ? { ...entry, end: event.target.value } : entry)),
                            }),
                        }),
                        h(
                          'button',
                          {
                            className: 'amr-btnGhost',
                            type: 'button',
                            'data-danger': 'true',
                            onClick: () =>
                              commit(setting.key, { ...schedule, ranges: schedule.ranges.filter((_, i) => i !== index) }),
                          },
                          '×',
                        ),
                      ),
                    ),
                    h(
                      'button',
                      {
                        className: 'amr-btnGhost',
                        type: 'button',
                        onClick: () =>
                          commit(setting.key, { ...schedule, ranges: [...(schedule.ranges ?? []), { start: '09:00', end: '18:00' }] }),
                      },
                      c.addRange,
                    ),
                  )
                : null,
            )
          }),
        ),
      )
    }

    /**
     * 只给「当前真正生效」的那套皮肤渲染细调项。
     *
     * 判定不依赖宿主数据：被启用的皮肤会加载其客户端模块并自己注册 definition，
     * 被停用的皮肤根本不加载。所以“注册表里有的”，基本就是“正在生效的”。
     * 宿主给的 displayName 只用来美化标题，缺了也不影响功能。
     */
    function TuningSection({ state }) {
      const c = copy()
      const definitions = useSkinDefinitions()
      if (definitions.length === 0) return null

      const skins = (state.layers ?? []).find((layer) => layer.id === 'skin')?.items ?? []
      const knownSkinId = skins.find((item) => item.bodyAttr && document.body.hasAttribute(item.bodyAttr))?.skinId

      return h(
        'div',
        { style: { display: 'grid', gap: '14px' } },
        definitions.map((definition) => {
          const skin =
            skins.find((item) => item.skinId === definition.skinId) ??
            skins.find((item) => item.skinId === knownSkinId) ?? { skinId: definition.skinId }
          return h(SkinTuningCard, { key: definition.skinId, skin, definition })
        }),
      )
    }

    const CSS = `
.amr-root{display:grid;gap:14px;color:var(--dsw-alias-label-primary);font-size:13px}
.amr-head{display:grid;gap:6px}
.amr-head h2{margin:0;font-size:15px;font-weight:600}
.amr-head p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.65}
.amr-layer{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:grid;gap:10px}
.amr-layerHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.amr-layerHead strong{font-size:13px;font-weight:600}
.amr-layerHead span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.amr-note{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.amr-conflict{margin:0;font-size:11.5px;color:var(--dsw-alias-brand-primary)}
.amr-list{display:grid;gap:6px}
.amr-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;border:1px solid transparent;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.amr-row:hover{border-color:var(--dsw-alias-border-l2)}
.amr-row[data-on="true"]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 3px 0 var(--dsw-alias-brand-primary)}
.amr-row[data-dead="true"]{opacity:.55;cursor:not-allowed}
.amr-mark{width:14px;height:14px;flex:none;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:grid;place-items:center}
.amr-row[data-on="true"] .amr-mark{border-color:var(--dsw-alias-brand-primary)}
.amr-row[data-on="true"] .amr-mark::after{content:"";width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.amr-row[data-multi="true"] .amr-mark{border-radius:4px}
.amr-body{display:grid;gap:2px;min-width:0;flex:1}
.amr-name{font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.amr-desc{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.amr-tag{flex:none;font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.amr-tag[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.amr-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:2px}
.amr-btn{appearance:none;border:1px solid transparent;background:var(--dsw-alias-label-primary,#1f2328);color:var(--dsw-alias-bg-layer-1,#fff);font-size:12.5px;font-weight:600;padding:8px 16px;border-radius:9px;cursor:pointer}
.amr-btn:disabled{opacity:.55;cursor:default}
.amr-btn:hover:not(:disabled){filter:brightness(1.08)}
.amr-btnGhost{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:11.5px;padding:4px 10px;border-radius:8px;cursor:pointer}
.amr-btnGhost:hover:not(:disabled){border-color:var(--dsw-alias-label-primary,#1f2328)}
.amr-btnGhost[data-danger="true"]:hover:not(:disabled){border-color:#e5484d;color:#e5484d}
.amr-switch{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#666);font-size:11.5px;padding:4px 12px;border-radius:999px;cursor:pointer;min-width:56px}
.amr-switch[data-on="true"]{background:var(--dsw-alias-label-primary,#1f2328);color:var(--dsw-alias-bg-layer-1,#fff);border-color:transparent}
.amr-status{font-size:12px;color:var(--dsw-alias-label-secondary)}
.amr-status[data-error="true"]{color:#e5484d}
.amr-warn{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:9px 12px;display:grid;gap:4px}
.amr-warn strong{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.amr-warn ul{margin:0;padding-left:16px}
.amr-warn li{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.6}
.amr-skeleton{height:52px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);animation:amr-pulse 1.2s ease-in-out infinite}
@keyframes amr-pulse{0%,100%{opacity:.55}50%{opacity:.85}}
.amr-presets{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:grid;gap:10px}
.amr-presetList{display:grid;gap:6px}
.amr-preset{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid transparent;flex-wrap:wrap}
.amr-preset:hover{border-color:var(--dsw-alias-border-l2)}
.amr-presetName{font-size:12.5px;font-weight:500;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.amr-presetMeta{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.amr-saveRow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.amr-input{flex:1;min-width:160px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-primary);font-size:12.5px;padding:7px 10px;outline:none}
.amr-input:focus{border-color:var(--dsw-alias-brand-primary)}
.amr-row:focus-visible,.amr-btn:focus-visible,.amr-btnGhost:focus-visible,.amr-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
/* 「待应用」只改标签这一处文字的颜色，不再给行加第二层框 —— 一个框就够了 */
.amr-tag[data-pending="true"]{color:var(--dsw-alias-state-warn-primary)}
.amr-btn:disabled{opacity:.5}
`

    function Style() {
      return h('style', { 'data-appearance-master': 'true' }, CSS)
    }

    /**
     * 一个标签位：正常显示「已加载 / 已停用」，有没应用的改动时就把**这一个**换成「待应用」。
     * 位置、大小、边框都不变 —— 不额外加框。
     */
    function Tag({ on, dead, pending, children }) {
      return h(
        'span',
        { className: 'amr-tag', 'data-on': String(on === true), 'data-pending': String(pending === true) },
        dead ? '—' : children,
      )
    }

    function rowHandlers(dead, onPick, extra) {
      if (dead) return {}
      return {
        role: extra?.role ?? 'button',
        'aria-checked': extra?.checked,
        tabIndex: 0,
        onClick: onPick,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onPick()
          }
        },
      }
    }

    /**
     * 一行插件。
     *
     * 两个状态必须分开说：
     *   - `loaded`：配置文件里这一行现在到底是不是开着的（真实状态，来自 /state）；
     *   - `on`    ：你**选**了它，但还没点「应用」。
     * 以前这两件事都用 `on` 表达，于是鼠标刚点上去、什么都没写，标签就变成了「生效中」。
     */
    function Row({ item, layer, on, onPick }) {
      const c = copy()
      const dead = item.managed !== true
      const loaded = item.active === true
      const pending = !dead && on !== loaded
      const detail = [item.version ? `v${item.version}` : '', item.description].filter(Boolean).join(' · ')
      return h(
        'div',
        {
          className: 'amr-row',
          'data-on': String(on === true),
          'data-loaded': String(loaded),
          'data-pending': String(pending),
          'data-dead': String(dead),
          'data-multi': String(layer.multi === true),
          ...rowHandlers(dead, onPick, { role: layer.multi ? 'checkbox' : 'radio', checked: on === true }),
        },
        h('span', { className: 'amr-mark' }),
        h(
          'span',
          { className: 'amr-body' },
          h('span', { className: 'amr-name' }, item.key),
          h('span', { className: 'amr-desc' }, dead ? c.unsupported : detail),
        ),
        h(Tag, { on: loaded && !pending, dead, pending }, pending ? c.pending : loaded ? c.active : c.idle),
      )
    }

    function toggle(list, key) {
      const current = Array.isArray(list) ? list : []
      return current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    }

    /**
     * 一层。单选层（皮肤 / 主题 / 背景）都带一条「不使用」，多选层（装饰件）没有。
     *
     * 皮肤层的定位是**快捷入口**：点一套就是换上去，点「关闭所有皮肤」就是一个都不加载。
     * 它和皮肤管理器写的是同一批 `ui-skin-*` 行，所以两边天然同步；每套皮肤自己的
     * 细调仍归皮肤管理器（那套控件由皮肤自己声明，只有它知道有哪些）。
     * 皮肤管理器正在跑时，这一栏下面多一行说明，把「这层是快捷入口」讲清楚。
     */
    function LayerCard({ layer, selection, onPick, delegatedTo }) {
      const c = copy()
      const picked = selection[layer.id]
      const items = layer.items ?? []
      const isOn = (key) => (layer.multi ? Array.isArray(picked) && picked.includes(key) : picked === key)
      const activeCount = items.filter((item) => item.active).length
      // 「不使用」这一行：真实状态 = 这一层一个都没加载；选择状态 = picked 是空
      const noneLoaded = activeCount === 0
      const nonePicked = layer.multi ? !Array.isArray(picked) || picked.length === 0 : !picked
      const nonePending = nonePicked !== noneLoaded

      return h(
        'section',
        { className: 'amr-layer', 'data-layer': layer.id },
        h(
          'div',
          { className: 'amr-layerHead' },
          h('strong', null, labelOf(layer.label) || layer.id),
          h('span', null, layer.multi ? c.layerMany : c.layerPick),
        ),
        layer.note ? h('p', { className: 'amr-note' }, labelOf(layer.note)) : null,
        delegatedTo ? h('p', { className: 'amr-note' }, c.delegatedInline(delegatedTo)) : null,
        !layer.multi && activeCount > 1 ? h('p', { className: 'amr-conflict' }, c.conflict(activeCount)) : null,
        items.length === 0
          ? h('p', { className: 'amr-note' }, c.empty)
          : h(
              'div',
              { className: 'amr-list', role: layer.multi ? 'group' : 'radiogroup' },
              layer.multi
                ? null
                : h(
                    'div',
                    {
                      className: 'amr-row',
                      'data-on': String(nonePicked),
                      'data-loaded': String(noneLoaded),
                      'data-pending': String(nonePending),
                      ...rowHandlers(false, () => onPick(''), { role: 'radio', checked: nonePicked }),
                    },
                    h('span', { className: 'amr-mark' }),
                    h('span', { className: 'amr-body' }, h('span', { className: 'amr-name' }, layer.id === 'skin' ? c.noneSkin : c.none)),
                    h(Tag, { on: noneLoaded && !nonePending, pending: nonePending }, nonePending ? c.pending : noneLoaded ? c.active : c.idle),
                  ),
              items.map((item) =>
                h(Row, {
                  key: item.key,
                  item,
                  layer,
                  on: isOn(item.key),
                  onPick: () => onPick(layer.multi ? toggle(picked, item.key) : item.key),
                }),
              ),
            ),
      )
    }

    function PresetCard({ presets, busy, onSave, onApply, onDelete, status }) {
      const c = copy()
      const [name, setName] = useState('')
      const [armed, setArmed] = useState(null)

      const submitSave = () => {
        if (busy) return
        onSave(name).then((ok) => {
          if (ok) setName('')
        })
      }

      return h(
        'section',
        { className: 'amr-presets' },
        h(
          'div',
          { className: 'amr-layerHead' },
          h('strong', null, c.presetsTitle),
          h('span', null, `${presets.length}`),
        ),
        h('p', { className: 'amr-note' }, c.presetsNote),
        presets.length === 0
          ? h('p', { className: 'amr-note' }, c.presetEmpty)
          : h(
              'div',
              { className: 'amr-presetList' },
              presets.map((preset) =>
                h(
                  'div',
                  { className: 'amr-preset', key: preset.id },
                  h('span', { className: 'amr-presetName' }, preset.name),
                  preset.createdAt ? h('span', { className: 'amr-presetMeta' }, preset.createdAt.slice(0, 10)) : null,
                  h(
                    'button',
                    {
                      className: 'amr-btnGhost',
                      type: 'button',
                      disabled: busy,
                      onClick: () => onApply(preset),
                    },
                    c.presetApply,
                  ),
                  h(
                    'button',
                    {
                      className: 'amr-btnGhost',
                      type: 'button',
                      'data-danger': 'true',
                      disabled: busy,
                      onClick: () => {
                        if (armed === preset.id) {
                          setArmed(null)
                          onDelete(preset)
                        } else {
                          setArmed(preset.id)
                          window.setTimeout(() => setArmed((current) => (current === preset.id ? null : current)), 4000)
                        }
                      },
                    },
                    armed === preset.id ? c.presetConfirmDelete : c.presetDelete,
                  ),
                ),
              ),
            ),
        h(
          'div',
          { className: 'amr-saveRow' },
          h('input', {
            className: 'amr-input',
            value: name,
            placeholder: c.presetName,
            maxLength: 40,
            onChange: (event) => setName(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') submitSave()
            },
          }),
          h('button', { className: 'amr-btn', type: 'button', disabled: busy, onClick: submitSave }, c.presetSave),
        ),
        status ? h('span', { className: 'amr-status', 'aria-live': 'polite' }, status) : null,
      )
    }

    /** 一次 /state 里，某一层「当前加载着的是哪个包」。 */
    function activeKeyOf(layer) {
      if (layer.multi) return (layer.items ?? []).filter((item) => item.active).map((item) => item.key)
      return (layer.items ?? []).find((item) => item.active)?.key ?? ''
    }

    /** 面板刚拿到 /state 时，四层各自选中什么 —— 就是「现在真的加载着」的那一个。 */
    function selectionFromState(payload) {
      const initial = {}
      for (const layer of payload?.layers ?? []) initial[layer.id] = activeKeyOf(layer)
      return initial
    }

    function managersFromState(payload) {
      const initial = {}
      for (const manager of payload?.managers ?? []) initial[manager.key] = manager.active === true
      return initial
    }

    /** 其它外观管理器：单独一栏，可以在这里关掉，避免两套东西抢同一批 disabled 行。 */
    function ManagersCard({ managers, busy, onToggle }) {
      const c = copy()
      const list = managers ?? []
      return h(
        'section',
        { className: 'amr-layer', 'data-layer': 'managers' },
        h(
          'div',
          { className: 'amr-layerHead' },
          h('strong', null, c.managersTitle),
          h('span', null, `${list.filter((manager) => manager.active).length}/${list.length}`),
        ),
        h('p', { className: 'amr-note' }, c.managersNote),
        list.length === 0
          ? h('p', { className: 'amr-note' }, c.managerEmpty)
          : h(
              'div',
              { className: 'amr-list' },
              list.map((manager) =>
                h(
                  'div',
                  { className: 'amr-preset', key: manager.key },
                  h('span', { className: 'amr-presetName' }, manager.key),
                  h('span', { className: 'amr-presetMeta' }, manager.version ? `v${manager.version}` : ''),
                  h(
                    'button',
                    {
                      className: 'amr-switch',
                      type: 'button',
                      'data-on': String(manager.active === true),
                      disabled: busy,
                      onClick: () => onToggle(manager.key, manager.active !== true),
                    },
                    manager.active ? c.managerOn : c.managerOff,
                  ),
                ),
              ),
            ),
      )
    }

    function Panel() {
      const c = copy()
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [refreshing, setRefreshing] = useState(false)
      const [status, setStatus] = useState(null)
      const [presetStatus, setPresetStatus] = useState(null)
      const [selection, setSelection] = useState({})
      const [managerState, setManagerState] = useState({})

      /**
       * 把一次 /state 吃进面板：模型、四层选择、管理器开关一起换成「现在的真相」。
       *
       * 这一步以前只在挂载时做一次。于是你在别处（皮肤管理器、面板自己刷新前）改了东西，
       * 面板里的旧选择还留着；下一次点「应用」会把这些**陈旧的意图**当成本次选择整片写回去，
       * 表现就是「明明关了，过一会儿自己又开了」「选项和画面对不上」。
       */
      const ingest = useCallback((payload) => {
        setState(payload)
        setSelection(selectionFromState(payload))
        setManagerState(managersFromState(payload))
        setError(null)
      }, [])

      const fetchState = useCallback(async () => {
        const response = await fetch(`${ROUTE}/state`, { credentials: 'same-origin' })
        const payload = await response.json()
        if (!response.ok || payload.ok === false) throw new Error(payload.error ?? `HTTP ${response.status}`)
        return payload
      }, [])

      const refresh = useCallback(async () => {
        setRefreshing(true)
        setStatus(null)
        try {
          ingest(await fetchState())
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setRefreshing(false)
        }
      }, [fetchState, ingest])

      useEffect(() => {
        let active = true
        ;(async () => {
          try {
            const payload = await fetchState()
            if (!active) return
            ingest(payload)
          } catch (cause) {
            if (active) setError(String(cause?.message ?? cause))
          }
        })()
        return () => {
          active = false
        }
      }, [fetchState, ingest])

      const activeCount = useMemo(
        () => (state?.layers ?? []).reduce((sum, layer) => sum + (layer.items ?? []).filter((item) => item.active).length, 0),
        [state],
      )

      /** 有没有「选了但还没应用」的层 —— 底部按钮据此变亮。 */
      const dirty = useMemo(() => {
        if (!state) return false
        for (const layer of state.layers ?? []) {
          const wanted = selection[layer.id]
          const actual = activeKeyOf(layer)
          if (JSON.stringify(wanted ?? '') !== JSON.stringify(actual)) return true
        }
        return false
      }, [selection, state])

      const pick = useCallback((layerId, value) => {
        setSelection((previous) => ({ ...previous, [layerId]: value }))
        setStatus(null)
      }, [])

      const post = useCallback(async (path, body) => {
        const response = await fetch(`${ROUTE}${path}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true, ...body }),
        })
        const payload = await response.json()
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.errors?.join('; ') ?? payload.error ?? `HTTP ${response.status}`)
        }
        return payload
      }, [])

      /**
       * 一次写入之后统一收尾。
       *
       * 0.8.1 起只有一个结论：**写进配置了，刷新页面才算数**。
       * 以前这里会轮询 /state，只要文件里对上了就宣布「已生效（页面无需刷新）」——
       * 那是在读文件，不是在看页面。外观插件是在页面启动时装进页面的，卸载一个客户端插件
       * 不会把它注册过的主题和 CSS 撤掉，所以那句话经常是假的。
       *
       * 也没有「失败就不刷新」的分支了：官方插件管理器拒绝接手的行由本面板两层写入，
       * 写完之后文件就是对的，刷新页面才看得到 —— 这是唯一诚实的收尾。
       */
      const finish = useCallback(
        async (payload, setLine) => {
          const requested = payload.requested ?? payload.changed ?? []
          if (requested.length === 0) {
            setLine(c.saved)
            setBusy(false)
            return
          }
          /**
           * 官方插件管理器的判定只用来**说明**，不再当作失败。
           *
           * 8.0 起归属判据是「只有它真的落下（applied / restart-required）才算它的」；
           * 其余（readonly / home-layer / failed / overridden）的行都由我们两层直接写，
           * 而我们的块在同层里是最靠后的那一块 —— 生效值就是我们写的那份。
           * 所以这里唯一的正确动作是：刷新页面，让界面读到真实状态。
           */
          const direct = (payload?.ownership?.loadedByUs ?? []).length
          setLine(direct > 0 ? `${c.reloading}（${c.byPanel(direct)}）` : c.reloading)
          setBusy(false)
          window.setTimeout(() => window.location.reload(), 420)
        },
        [c],
      )

      const submit = useCallback(async () => {
        setError(null)
        setBusy(true)
        setStatus(c.applying)
        try {
          const payload = await post('/apply', { selections: selection, managers: managerState })
          await finish(payload, setStatus)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
          setStatus(null)
          setBusy(false)
        }
      }, [c, finish, managerState, post, selection])

      /** 单独开关一个外观管理器：和管理器本身一样，改完也要刷新页面。 */
      const toggleManager = useCallback(
        async (key, enable) => {
          setError(null)
          const next = { ...managerState, [key]: enable }
          setBusy(true)
          setStatus(c.applying)
          try {
            const payload = await post('/apply', { selections: selection, managers: next })
            setManagerState(next)
            await finish(payload, setStatus)
          } catch (cause) {
            setError(String(cause?.message ?? cause))
            setStatus(null)
            setBusy(false)
          }
        },
        [c, finish, managerState, post, selection],
      )

      const savePreset = useCallback(
        async (name) => {
          if (!state) return false
          setPresetStatus(null)
          try {
            const payload = await post('/presets', { action: 'save', name, selections: selection })
            setState((previous) => (previous ? { ...previous, presets: payload.presets ?? previous.presets } : previous))
            setPresetStatus(c.presetSaved(payload.preset?.name ?? name))
            return true
          } catch (cause) {
            setPresetStatus(`${c.failed}: ${String(cause?.message ?? cause)}`)
            return false
          }
        },
        [c, post, selection, state],
      )

      const applyPreset = useCallback(
        async (preset) => {
          setError(null)
          setBusy(true)
          setPresetStatus(c.presetApplying)
          try {
            const payload = await post('/presets', { action: 'apply', id: preset.id })
            if ((payload.requested ?? []).length > 0) setPresetStatus(c.presetApplied(preset.name))
            await finish(payload, setPresetStatus)
          } catch (cause) {
            setPresetStatus(`${c.failed}: ${String(cause?.message ?? cause)}`)
            setBusy(false)
          }
        },
        [c, finish, post],
      )

      const deletePreset = useCallback(
        async (preset) => {
          try {
            const payload = await post('/presets', { action: 'delete', id: preset.id })
            setState((previous) => (previous ? { ...previous, presets: payload.presets ?? [] } : previous))
            setPresetStatus(c.presetDeleted)
          } catch (cause) {
            setPresetStatus(`${c.failed}: ${String(cause?.message ?? cause)}`)
          }
        },
        [c, post],
      )

      // 出错时不再是一块只能重开页面的死界面：给一个「重试」，重新读 /state。
      if (error) {
        return h(
          'div',
          { className: 'amr-root' },
          h(Style),
          h('div', { className: 'amr-head' }, h('h2', null, c.title)),
          h('p', { className: 'amr-status', 'data-error': 'true' }, `${c.failed}: ${error}`),
          h(
            'div',
            { className: 'amr-foot' },
            h('button', { className: 'amr-btn', type: 'button', disabled: refreshing, onClick: refresh }, refreshing ? c.refreshing : c.retry),
          ),
        )
      }

      if (!state) {
        return h(
          'div',
          { className: 'amr-root' },
          h(Style),
          h('div', { className: 'amr-head' }, h('h2', null, c.title)),
          h('div', { className: 'amr-skeleton' }),
          h('div', { className: 'amr-skeleton' }),
        )
      }

      return h(
        'div',
        { className: 'amr-root', 'data-appearance-master': 'panel' },
        h(Style),
        h(
          'div',
          { className: 'amr-head' },
          h('h2', null, c.title),
          h('p', null, c.intro),
          h('p', { className: 'amr-note' }, c.count(activeCount, state.stats?.total ?? 0)),
        ),
        (state.layers ?? []).map((layer) =>
          h(LayerCard, {
            key: layer.id,
            layer,
            selection,
            onPick: (value) => pick(layer.id, value),
            delegatedTo: state.delegated?.[layer.id] ?? '',
          }),
        ),
        h(ManagersCard, {
          managers: state.managers ?? [],
          busy,
          onToggle: toggleManager,
        }),
        h(
          'div',
          { className: 'amr-foot' },
          h(
            'button',
            { className: 'amr-btn', type: 'button', disabled: busy || !dirty, onClick: submit },
            busy ? c.applying : c.apply,
          ),
          h(
            'button',
            { className: 'amr-btnGhost', type: 'button', disabled: busy || refreshing, onClick: refresh },
            refreshing ? c.refreshing : c.refresh,
          ),
          status ? h('span', { className: 'amr-status', 'aria-live': 'polite' }, status) : null,
        ),
        h(PresetCard, {
          presets: state.presets ?? [],
          busy,
          onSave: savePreset,
          onApply: applyPreset,
          onDelete: deletePreset,
          status: presetStatus,
        }),
        (state.warnings ?? []).length > 0
          ? h(
              'div',
              { className: 'amr-warn' },
              h('strong', null, c.warnings),
              h(
                'ul',
                null,
                state.warnings.map((warning, index) => h('li', { key: index }, warning)),
              ),
            )
          : null,
      )
    }

    /** 挂到设置页的 section 插槽，排在皮肤管理（order 115）之后。 */
    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'appearance-master',
            order: 116,
            label: () => copy().navLabel,
            inject: () => ({}),
          },
          Panel,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    // 给离线测试用的内部函数（生产环境没人读它，纯附加）
    exports.__internals = {
      normalizeSetting,
      normalizeValues,
      scheduleVisible,
      settingVisible,
      readPrefs,
      writePrefs,
      activeKeyOf,
      selectionFromState,
      managersFromState,
      TUNING_EVENTS,
      PREFERENCES_KEY,
    }
    return module.exports
  },
})
