/**
 * dsh-appearance-master — 宿主侧入口。
 *
 * 三个路由，逻辑都在 scan.js / presets.js 里：
 *   GET  /api/dsh-appearance/state     → 分层模型 + 已存方案
 *   POST /api/dsh-appearance/apply     → 写 cordis.patch.yml 的受管区块（需要 {"confirm": true}）
 *   POST /api/dsh-appearance/presets   → 方案增删与应用（action: save | apply | delete）
 *
 * 写操作一律要求 confirm：它们决定下次启动加载哪些外观插件，必须由用户的一次明确点击触发，
 * 不能来自模型或误触的 GET。
 *
 * 0.8.0 的两个关键修正：
 *   1. 交给官方 pluginManager 的行，**只有它真的落下（applied / restart-required）才算它的**。
 *      它拒绝（unaddressable / management-required）或失败时，必须回落到我们自己的两层写入 ——
 *      以前「它拒绝了但我又不写」，开关看起来就是彻底死的。
 *   2. 方案应用也走同一条通道。以前方案直接写文件，写的是官方也在管的行，
 *      于是回到 overridden 的拉扯里。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { applySelections, parseFlags, readModel, resolvePatchPaths, stripManagedBlock } from './scan.js'
import { addPreset, getPreset, readPresets, removePreset } from './presets.js'

export const name = 'appearance-master'
/** 只注入 connection：路由登记走 ctx.connection.fetch.register。 */
export const inject = ['connection']

const BASE = '/api/dsh-appearance'

/**
 * 宿主手里的 profile 目录 —— 比环境变量可靠。
 *
 * 真机上桌面宿主进程里 `DSH_PROFILE_DIR` / `DSH_HOME` 都可能是空的（心跳里
 * `profileDir: null`），只靠它们会扫到「名字凑巧叫 desktop」的目录。
 * `ctx.profileContext.dir` 是宿主自己正在跑的 profile，唯一没有歧义的答案。
 */
function profileDirOf(ctx) {
  try {
    const profile = ctx?.profileContext ?? ctx?.get?.('profileContext')
    if (typeof profile?.dir === 'string' && profile.dir !== '') return profile.dir
  } catch {
    /* 拿不到就走环境变量 */
  }
  return undefined
}

/**
 * 启动心跳：把「我这一轮真的被加载了」写成一个文件。
 *
 * 存在的理由很实际：DSH 的 HTTP 接口都要登录态，外部脚本没法直接探测路由是否注册；
 * 而这个文件让「插件到底有没有起来」变成一个可以离线检查的事实。
 * 写失败绝不影响插件加载 —— 整段包在 try 里。
 */
function writeHeartbeat(ctx) {
  try {
    const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
      ? process.env.DSH_HOME.trim()
      : join(homedir(), '.dsh')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    writeFileSync(
      join(home, 'appearance-master.heartbeat.json'),
      JSON.stringify(
        {
          version: pkg.version,
          loadedAt: new Date().toISOString(),
          node: process.version,
          profileDir: profileDirOf(ctx) ?? process.env.DSH_PROFILE_DIR ?? null,
          routes: [`GET ${BASE}/state`, `POST ${BASE}/apply`, `POST ${BASE}/presets`],
        },
        null,
        2,
      ),
      'utf8',
    )
  } catch {
    /* 心跳只是诊断，失败就失败 */
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 请求体读取：优先用 web Request 的 json()，失败再退回 text()。 */
async function readJsonBody(request) {
  try {
    if (typeof request?.json === 'function') return await request.json()
  } catch {
    /* fall through */
  }
  try {
    const text = typeof request?.text === 'function' ? await request.text() : ''
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

function registerRoute(ctx, path, methods, handler, label) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path,
        methods,
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            return await handler(request)
          } catch (cause) {
            return json(
              {
                ok: false,
                error: `${cause?.name ?? 'Error'}: ${cause?.message ?? String(cause)}`,
              },
              500,
            )
          }
        },
      }),
    `dsh-appearance-master: ${label}`,
  )
}

/** 模型 + 方案，一起给前端。 */
function statePayload(profileDir) {
  const model = readModel({ profileDir })
  const store = readPresets()
  const warnings = [...(model.warnings ?? [])]
  if (store.error) warnings.push(`方案文件读取失败，已按空列表处理：${store.error}`)
  return {
    ...model,
    presets: store.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      createdAt: preset.createdAt ?? null,
      selections: preset.selections,
    })),
    presetsPath: store.path,
    warnings,
  }
}

/**
 * 取官方插件管理器；取不到就返回 undefined（不是错误）。
 *
 * 注意 `ctx.get` 是动态查服务，不要求本插件注入它 —— 部署里没有插件管理面板时
 * 这里就是 undefined，后面全程安静降级。
 */
function safePluginManager(ctx) {
  try {
    const service = ctx.get?.('pluginManager')
    return service && typeof service.setPluginEnabled === 'function' ? service : undefined
  } catch {
    return undefined
  }
}

const stripInclude = (value) => String(value ?? '').replace(/^include:/, '')
const lastSegment = (value) => stripInclude(value).split(':').pop()

/**
 * 行 id → 官方条目。
 *
 * `patchId` 是官方**自己认的**补丁行 id，最可靠，优先用它；
 * `entryId` 的形态在不同版本里可能是 `include:ui-skin-x`、`include:组:ui-skin-x`，
 * 所以除了精确匹配，还要退到「末段相同」。
 */
function resolveEntryFactory(entries) {
  return (row) => {
    const list = Array.isArray(entries) ? entries : []
    return (
      list.find((entry) => entry.patchId === row) ??
      list.find((entry) => entry.entryId === row) ??
      list.find((entry) => stripInclude(entry.entryId) === row) ??
      list.find((entry) => lastSegment(entry.entryId) === row) ??
      list.find((entry) => entry.moduleName === row) ??
      null
    )
  }
}

/** 官方判定里，哪些算「它已经把文件写对了」。 */
const OWNED_APPLICATIONS = new Set(['applied', 'restart-required'])

/**
 * home 层里有哪些行（**不含我们自己那块**）。
 *
 * 这不是诊断信息，是决定「能不能交给官方插件管理器」的判据：
 * 官方的 `setPluginEnabled` 只写 **profile 层**（`writePluginEnabled(this.profile, …)`，
 * 它算 implied 时也明说不看 home 层）。所以只要 home 层里还有同一行的另一份值，
 * 它写完之后生效值仍然被 home 压着，于是只能回一个 `overridden` —— 白白来回一次。
 *
 * 皮肤管理器正好属于这种：它把 `ui-skin-*` 同时写进两层。以前每一行皮肤第一次改
 * 都会先撞出一个 `overridden`，就是这个原因。
 */
function rowsInHomeLayer(profileDir) {
  const rows = new Set()
  const paths = resolvePatchPaths(profileDir)
  for (const path of paths.slice(1)) {
    try {
      const text = readFileSync(path, 'utf8')
      for (const row of parseFlags(stripManagedBlock(text)).keys()) rows.add(row)
    } catch {
      /* 这一层不存在就算了 */
    }
  }
  return rows
}

/**
 * 把「本次变化的行」交给官方插件管理器处理。
 *
 * 顺序（0.6.3 起就没再变）：先把它两层的同名行摘掉让出优先级，再请它写。
 * 0.8.0 改的是**归属判据**：只有 `applied` / `restart-required` 才算它的；
 * `readOnlyReason`（management-required / unaddressable）、抛出、失败的行全部回落给我们。
 * 0.8.3 加了一条：**home 层里已经有同一行的，不交给它** —— 它写不到 home 层，
 * 交过去只会换回一个必然的 `overridden`。这种行由我们两层直接写。
 */
async function handOffToPluginManager(ctx, changes, options = {}) {
  const outcomes = []
  const owned = []
  const service = safePluginManager(ctx)
  if (!service) return { available: false, reason: 'pluginManager 服务不可用', outcomes, owned }
  const homeRows = options.homeRows instanceof Set ? options.homeRows : new Set()

  let entries = []
  if (typeof service.listPlugins === 'function') {
    try {
      const listed = await service.listPlugins()
      entries = Array.isArray(listed) ? listed : (listed?.entries ?? [])
    } catch {
      entries = []
    }
  }
  const resolveEntry = resolveEntryFactory(entries)

  for (const change of changes) {
    // home 层也有一份：官方写不到那里，交给它注定换回 overridden —— 直接自己写两层。
    if (homeRows.has(change.row)) {
      outcomes.push({
        row: change.row,
        entryId: null,
        application: 'home-layer',
        reason: '这一行在 home 层里还有一份，官方插件管理器只写 profile 层，改不动它，由本面板两层写入',
      })
      continue
    }
    const entry = resolveEntry(change.row)
    if (!entry) {
      outcomes.push({ row: change.row, entryId: null, application: 'unknown-plugin' })
      continue
    }
    // 官方明说「这一行不归我管（或归插件管理器自身管）」：别再敲它，
    // 也别把这一行算成它的 —— 否则我们让出位置，它又写不了，开关就永远是死的。
    if (entry.readOnlyReason !== undefined && entry.readOnlyReason !== null) {
      outcomes.push({
        row: change.row,
        entryId: entry.entryId,
        application: 'readonly',
        reason: String(entry.readOnlyReason),
      })
      continue
    }
    try {
      const answer = await service.setPluginEnabled(entry.entryId, change.disabled !== true)
      const application = answer?.application ?? answer?.state ?? 'unknown'
      outcomes.push({ row: change.row, entryId: entry.entryId, application })
      if (OWNED_APPLICATIONS.has(application)) owned.push(change.row)
    } catch (cause) {
      outcomes.push({
        row: change.row,
        entryId: entry.entryId,
        application: 'failed',
        error: String(cause?.message ?? cause),
      })
    }
  }
  return { available: true, outcomes, owned }
}

/** 这两层里有没有**提到**这些行？只有提到才需要「先让出优先级」，省掉一次无意义写入。 */
function rowsMentionedInLayers(rows, profileDir) {
  const wanted = new Set(rows)
  for (const path of resolvePatchPaths(profileDir)) {
    let text = ''
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const row of parseFlags(text).keys()) if (wanted.has(row)) return true
  }
  return false
}

/**
 * 一次完整的应用：预演 → 让出官方管的行 → 交官方 → 剩下自己写两层。
 *
 * /apply 和「应用整套方案」共用它 —— 以前方案那条路是直接写文件的，
 * 于是方案一应用就回到 overridden 的拉扯里。
 */
async function applyAndHandOff(ctx, selections, options) {
  const profileDir = profileDirOf(ctx)
  const scope = { ...options, profileDir }
  const preview = applySelections(selections, { ...scope, dryRun: true })
  if (preview.ok === false) return { status: 400, payload: preview }
  if (options?.dryRun === true) return { status: 200, payload: preview }

  const changes = preview.changed ?? []
  const service = safePluginManager(ctx)
  let handOff = { available: false, reason: '没有需要交给插件管理器的行', outcomes: [], owned: [] }
  let result

  /**
   * home 层里有同一行的，一律不交给官方：它只写 profile 层，交过去必然换回
   * `overridden`（真机上 `ui-skin-*` 就是这么来的 —— 皮肤管理器把同一行写进两层）。
   * 这种行由下面那一次两层写入直接定下来。
   */
  const homeRows = rowsInHomeLayer(profileDir)
  const blockedByHome = new Set(changes.filter((change) => homeRows.has(change.row)).map((change) => change.row))
  const handOffRows = changes.filter((change) => !blockedByHome.has(change.row))

  if (service !== undefined && changes.length > 0) {
    const giveUp = handOffRows.map((change) => change.row)
    if (giveUp.length > 0 && rowsMentionedInLayers(giveUp, profileDir)) {
      applySelections(selections, { ...scope, excludeRows: giveUp })
    }
    handOff = await handOffToPluginManager(ctx, changes, { homeRows })
    result = applySelections(selections, { ...scope, excludeRows: handOff.owned })
  } else {
    result = applySelections(selections, scope)
  }

  if (result.ok === false) return { status: 400, payload: result }

  return {
    status: 200,
    payload: {
      ...result,
      // 语义上的变化以预演为准：官方接手的那几行不会出现在最后一次写入的 changed 里，
      // 但界面和「要不要刷新页面」都得看它们。
      requested: preview.changed ?? [],
      changed: preview.changed ?? [],
      pageReload: preview.pageReload === true,
      nudges: { available: handOff.available, reason: handOff.reason, outcomes: handOff.outcomes },
      ownership: { pluginManager: handOff.owned, loadedByUs: (preview.changed ?? []).map((c) => c.row).filter((row) => !handOff.owned.includes(row)) },
    },
  }
}

export function apply(ctx) {
  writeHeartbeat(ctx)
  registerRoute(ctx, `${BASE}/state`, ['GET'], async () => json(statePayload(profileDirOf(ctx))), 'state')

  registerRoute(
    ctx,
    `${BASE}/apply`,
    ['POST'],
    async (request) => {
      const body = await readJsonBody(request)
      if (body?.confirm !== true) {
        return json(
          { ok: false, error: 'applying an appearance requires {"confirm": true}; send {"dryRun": true} to preview' },
          400,
        )
      }
      const outcome = await applyAndHandOff(
        ctx,
        body.selections ?? {},
        { managers: body.managers, dryRun: body.dryRun === true },
      )
      return json(outcome.payload, outcome.status)
    },
    'apply',
  )

  registerRoute(
    ctx,
    `${BASE}/presets`,
    ['POST'],
    async (request) => {
      const body = await readJsonBody(request)
      if (body?.confirm !== true) {
        return json({ ok: false, error: 'preset changes require {"confirm": true}' }, 400)
      }

      const action = typeof body.action === 'string' ? body.action : ''

      if (action === 'save') {
        const saved = addPreset(body.name, body.selections)
        if (saved.ok === false) return json(saved, 400)
        return json({ ok: true, preset: saved.preset, presets: saved.presets })
      }

      if (action === 'delete') {
        const removed = removePreset(body.id)
        if (removed.ok === false) return json(removed, 400)
        return json({ ok: true, presets: removed.presets })
      }

      if (action === 'apply') {
        const preset = getPreset(body.id)
        if (!preset) return json({ ok: false, error: '找不到这个方案' }, 404)
        const outcome = await applyAndHandOff(ctx, preset.selections, { dryRun: body.dryRun === true })
        return json(
          { ...outcome.payload, preset: { id: preset.id, name: preset.name } },
          outcome.status,
        )
      }

      return json({ ok: false, error: 'action 必须是 save | apply | delete' }, 400)
    },
    'presets',
  )
}
