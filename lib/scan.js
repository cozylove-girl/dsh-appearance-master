/**
 * dsh-appearance-master — 外观模型层。
 *
 * 职责只有三件事，全部是纯文件读写，不碰网络：
 *   1. 从 profile 的 package.json 里找出「外观类」插件，并按层归类；
 *   2. 读 profile / home 两层 cordis.patch.yml，判断每一行插件当前是启用还是停用；
 *   3. 把用户的选择写成 cordis.patch.yml 里的一段「受管区块」（- id + disabled），
 *      区块之外的内容原样保留 —— 皮肤管理器、主题设置等写的东西不会被我们吃掉。
 *
 * 写入策略：**只在确实需要时写行**。
 * 只写两种：我们要它停用（`disabled: true`）；或它被别人（bundle 默认 / 另一层 /
 * 另一个管理器）显式停用了、而我们希望它启用（必须写 `disabled: false`）。
 * 默认启用的行一律不写 —— 少写一行，就少一处和别的管理器抢的地方。
 *
 * ⚠ 编辑本仓库的 .js 时不要用 PowerShell 的 `Set-Content` / `>` 重定向：
 *   它会按控制台代码页写盘，把中文注释整片转成 GBK 乱码，还会吃掉行尾换行。
 *   用编辑器或写入工具保存成 UTF-8。
 */

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const MARK_START = '# --- appearance-master managed (do not edit) ---'
export const MARK_END = '# --- end appearance-master managed ---'
/**
 * 区块里那行说明**必须是纯 ASCII**。
 *
 * 原来写的是中文，结果整个文件被某个 GBK 工具来回转码之后，行尾换行被吃掉，
 * `- id:` 被粘到了注释行末尾 —— 那一批行对 YAML 就不存在了。纯 ASCII 的注释
 * 在任何代码页下都是同一串字节，不会被转坏。
 */
export const MARK_NOTE = '# written by dsh-appearance-master; rows below are owned by this panel'

/** 四个层，前后端共用同一份定义（前端通过 /state 拿到）。说明文字保持一句话。 */
export const LAYERS = [
  {
    id: 'skin',
    multi: false,
    label: { zh: '皮肤', en: 'Skin' },
    note: {
      zh: '只能有一套。和皮肤管理器同步，细调在那边。',
      en: 'One at a time. Synced with the skin manager; fine-tuning lives there.',
    },
  },
  {
    id: 'theme',
    multi: false,
    label: { zh: '主题', en: 'Theme' },
    note: { zh: '配色与质感，可与皮肤叠加', en: 'Colours and texture; stacks with a skin' },
  },
  {
    id: 'background',
    multi: false,
    label: { zh: '背景 / 动画', en: 'Background / Motion' },
    note: { zh: '视频、壁纸、开机动画', en: 'Video, wallpaper, boot animation' },
  },
  {
    id: 'decoration',
    multi: true,
    label: { zh: '装饰件', en: 'Decorations' },
    note: { zh: '挂件类，改完会刷新页面', en: 'Widgets. A change reloads the page once' },
  },
]

/**
 * 永远不出现在「外观」列表里的包。
 *
 * 管理器类（皮肤管理器、切换器、市场…）单独采集到 `managers` 里：
 * 它们本身不渲染外观，但**会和本面板抢同一批 disabled 行**，
 * 所以要在界面上显示出来，并允许用户在这里把它们关掉。
 */
const NOT_APPEARANCE = [
  /^@deepseek-ai\//,
  /(^|\/)dsh-im($|[-/])/,
  /(^|\/)dsh-reclaim($|[-/])/,
  /(^|\/)dsh-appearance-master($|[-/])/,
]

/** 会写外观配置、因而可能与总控冲突的「管理者」。 */
const MANAGER = /(manager|switcher|rotation|console|market|theme-center|skin-center|theme-hub|style-hub)/i

const BG = /video|wallpaper|background|gif|boot|splash|animation|particle|live2d|firefly|scener|nebula|backdrop|snow|rain/i
const THEME = /theme|palette|color|colour|appearance|glass|skin-?style|style/i
const DECOR = /widget|mascot|(^|[-/])pet($|[-/])|token|bubble|badge|sticker|decor|statusbar|whale/i
const APPEARANCE_WORD = /皮肤|主题|壁纸|背景|外观|配色|挂件|桌宠|skin|theme|wallpaper|background|appearance/i

/** 我方受管区块内允许出现的行（结束标记丢了时，用它判断「区块到哪为止」）。 */
const BLOCK_ROW = /^([ \t]*-[ \t]*id:|[ \t]+disabled:|[ \t]+enabled:)/

function homeDir() {
  const env = process.env.DSH_HOME
  return typeof env === 'string' && env.trim() !== '' ? env.trim() : join(homedir(), '.dsh')
}

/**
 * 当前 profile 目录。
 *
 * 优先级：宿主 ctx 里拿到的 `profileContext.dir` → `DSH_PROFILE_DIR` → `$DSH_HOME/profiles/<name>`。
 *
 * 为什么把「宿主给的」排第一：真机上桌面宿主进程里 `DSH_PROFILE_DIR` 是空的
 * （心跳里 `profileDir: null` 就是证据），只靠环境变量 + `DSH_PROFILE` 默认值会扫到
 * 一个名字凑巧叫 desktop 的目录。宿主自己手里的 profile 才是真的。
 */
export function resolveProfileDir(explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  const env = process.env.DSH_PROFILE_DIR
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  const name = process.env.DSH_PROFILE || 'desktop'
  return join(homeDir(), 'profiles', name)
}

/** 从 patch 文本里取出所有行 id（bundle 的 cordis.patch.yml 用）。 */
export function rowIdsOf(text) {
  const ids = []
  for (const match of text.matchAll(
    /^[ \t]*-[ \t]*id:[ \t]*('([^']*)'|"([^"]*)"|([A-Za-z0-9@._/-]+))[ \t]*(?:#.*)?$/gm,
  )) {
    ids.push(match[2] ?? match[3] ?? match[4])
  }
  return [...new Set(ids)]
}

/**
 * 解析一层 cordis.patch.yml，得到「行 id → 是否停用」。
 *
 * 只认**这一行自己的直接属性**：`- id: x`（缩进随意）后面、缩进比 `- ` 深的
 * 那个 `disabled:` / `enabled:`。`config:` 里的同名键一律不算 —— 以前
 * `- id: ui-settings / config: / enabled: true` 会被读成「这一行被停用」，
 * 于是面板显示的状态和真实状态对不上。
 *
 * 行结束时立刻清空 current：不会把下一个块的属性错记到上一行头上。
 */
export function parseFlags(text) {
  const flags = new Map()
  let current = null
  /** 该行属性的缩进（第一次遇到属性时确定）；null 表示还没遇到。 */
  let propertyIndent = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const lead = line.length - line.trimStart().length

    // `- id: x`：顶层行，或 bundle patch 里 `- insert:` 下面缩进的行
    const item = /^[ \t]*-[ \t]+(.*)$/.exec(line)
    if (item !== null && (/^id:/.test(item[1]) || lead === 0)) {
      const idMatch = /^id:[ \t]*('([^']*)'|"([^"]*)"|([^\s#]+))[ \t]*(?:#.*)?$/.exec(item[1])
      current = idMatch === null ? null : idMatch[2] ?? idMatch[3] ?? idMatch[4]
      propertyIndent = null
      continue
    }
    if (current === null) continue
    // 回到顶层：这一行结束了
    if (lead === 0) {
      current = null
      continue
    }
    if (propertyIndent === null) propertyIndent = lead
    // 比属性缩进更深 = 嵌套子树（config 之类），不是这一行的开关
    if (lead > propertyIndent) continue
    if (lead < propertyIndent) {
      current = null
      continue
    }
    const disabledMatch = /^disabled:[ \t]*(true|false)\b/i.exec(trimmed)
    if (disabledMatch !== null) {
      flags.set(current, disabledMatch[1].toLowerCase() === 'true')
      continue
    }
    // 官方插件管理器按它自己的「开关规则」写这一行，可能写成 `enabled:`。
    const enabledMatch = /^enabled:[ \t]*(true|false)\b/i.exec(trimmed)
    if (enabledMatch !== null) flags.set(current, enabledMatch[1].toLowerCase() !== 'true')
  }
  return flags
}

/** 把区块正文按顶层 `- ` 切成一条条记录（用来分辨「我们的行」和「别人的行」）。 */
function splitBlockRecords(body) {
  const records = []
  let current = []
  for (const line of body.split(/\r?\n/)) {
    if (/^-[ \t]/.test(line)) {
      if (current.length > 0) records.push(current)
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) records.push(current)
  return records
}

/** 我们写的行只有 id + disabled/enabled；多出任何键（name、config…）都不是我们的。 */
function isOursRecord(lines) {
  const [head, ...rest] = lines
  if (!/^-[ \t]+id:[ \t]*['"]?[^'"#\s]+['"]?[ \t]*(?:#.*)?$/.test(head)) return false
  for (const line of rest) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (/^(disabled|enabled):[ \t]*(true|false)\b/i.test(trimmed)) continue
    return false
  }
  return true
}

/**
 * 区块里**不是我们写的**那些内容。
 *
 * 为什么需要它：我们的受管区块在文件末尾，而别的写入方（官方插件管理器的
 * `document.add`、插件自己的设置项）也是往文件末尾追加行 —— 于是它们会物理上落进
 * 我们的区块里面。真机上就有一例：`- id: ui-skin-claude-style / config: sodium: on`
 * 落在区块中间。整段重写时如果直接删掉，用户在那个插件里做的设置就没了。
 *
 * 处理方式：把这类「带额外键」的行**挪到区块前面**保留下来（它们的写法和我们的意见
 * 可能不同，但那是别人的设置，轮不到我们删）。纯我们的行（只有 id + disabled）扔掉，
 * 由本次重写重新生成。
 */
export function foreignBlockRows(body) {
  return splitBlockRecords(body)
    .filter((record) => {
      const meaningful = record.filter((line) => line.trim() !== '')
      if (meaningful.length === 0) return false
      // 纯注释（我们自己的说明、历史遗留的乱码注释）不算内容
      if (meaningful.every((line) => line.trim().startsWith('#'))) return false
      return !isOursRecord(record)
    })
    .map((record) => record.join('\n').replace(/\s+$/, ''))
    .filter(Boolean)
}

/**
 * 去掉本面板写入的受管区块（可能不止一个），保留用户和别的插件写的所有内容。
 *
 * 两件必须守住的事：
 *   1. 区块里「别人的行」不能删（见 foreignBlockRows），挪到区块前面保留；
 *   2. 结束标记丢了的时候**绝不能把后半篇文件一起删掉** —— 那是用户自己的配置。
 */
export function stripManagedBlock(text) {
  let result = text
  for (;;) {
    const start = result.indexOf(MARK_START)
    if (start === -1) return result
    const end = result.indexOf(MARK_END, start)
    let body
    let tail
    if (end !== -1) {
      body = result.slice(start + MARK_START.length, end)
      tail = result.slice(end + MARK_END.length)
    } else {
      // 结束标记丢了：只吃到「我们的行形状」结束，剩下的都当文件正文
      const lines = result.slice(start).split(/\r?\n/)
      let taken = 1
      for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index]
        if (line === MARK_NOTE || BLOCK_ROW.test(line)) {
          taken = index + 1
          continue
        }
        break
      }
      body = lines.slice(0, taken).join('\n')
      tail = lines.slice(taken).join('\n')
    }
    const keep = foreignBlockRows(body).join('\n\n')
    // 只裁掉区块前面那一小段空白，不逐行动用户文件里的空格
    const head = result.slice(0, start).trimEnd()
    const rest = tail.replace(/^\s*\n/, '')
    result = [head, keep, rest].filter((part) => part !== '').join('\n\n')
    if (result === '') return ''
  }
}

/**
 * DSH 的两层用户补丁：profile 层与 home 层。
 *
 * **home 层优先级更高**（皮肤管理器的注释原话："Both live user layers must agree
 * because the home layer has higher priority"）。只写 profile 层会被 home 层里
 * 别人留下的同名行压回去 —— 这正是「点了没反应」的根因。
 *
 * home 层的位置从 profile 目录推出来（`<home>/profiles/<name>` 的上两级），
 * 这样即使进程里没有 `DSH_HOME`，也不会把行写到别的地方去。
 */
export function resolvePatchPaths(explicitProfileDir) {
  const profileDir = resolveProfileDir(explicitProfileDir)
  const parent = dirname(profileDir)
  const home = basename(parent) === 'profiles' ? dirname(parent) : homeDir()
  return [join(profileDir, 'cordis.patch.yml'), join(home, 'cordis.patch.yml')]
}

/** 按优先级合并两层：后读（home）覆盖先读（profile）。 */
export function effectiveFlags(paths = resolvePatchPaths()) {
  const merged = new Map()
  for (const path of paths) {
    if (!existsSync(path)) continue
    for (const [id, disabled] of parseFlags(readFileSync(path, 'utf8'))) merged.set(id, disabled)
  }
  return merged
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function inspectPackage(profileDir, pkgName) {
  const dir = join(profileDir, 'node_modules', pkgName)
  const meta = readJson(join(dir, 'package.json'))
  if (!meta) return null

  const patchCandidates = []
  const declared = meta?.dsh?.bundle?.patch
  if (typeof declared === 'string' && declared.trim() !== '') patchCandidates.push(join(dir, declared.trim()))
  patchCandidates.push(join(dir, 'cordis.patch.yml'))

  let rows = []
  /** bundle 自己声明的默认状态（绝大多数包不写 disabled，也就是默认启用）。 */
  const rowDefaults = {}
  for (const candidate of patchCandidates) {
    if (!existsSync(candidate)) continue
    const patchText = readFileSync(candidate, 'utf8')
    rows = rowIdsOf(patchText)
    for (const [row, disabled] of parseFlags(patchText)) {
      if (rows.includes(row)) rowDefaults[row] = disabled
    }
    break
  }

  // 皮肤清单：id / bodyAttr 是接入皮肤自定义协议的关键。
  let skinJson = null
  const skinJsonPath = join(dir, 'skin.json')
  if (existsSync(skinJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(skinJsonPath, 'utf8'))
      skinJson = {
        id: typeof parsed?.id === 'string' ? parsed.id : null,
        name: typeof parsed?.name === 'string' ? parsed.name : null,
        nameEn: typeof parsed?.nameEn === 'string' ? parsed.nameEn : null,
        bodyAttr: typeof parsed?.bodyAttr === 'string' ? parsed.bodyAttr : null,
        accent: typeof parsed?.accent === 'string' ? parsed.accent : null,
        compatibility: typeof parsed?.dshCompatibility === 'string' ? parsed.dshCompatibility : null,
      }
    } catch {
      skinJson = null
    }
  }

  return {
    version: typeof meta.version === 'string' ? meta.version : '',
    description: typeof meta.description === 'string' ? meta.description : '',
    hasSkinJson: skinJson !== null,
    skinJson,
    // 有没有客户端半区：没有就是「宿主注入型」，页面里的脚本由宿主塞进去，
    // 改完之后只有刷新页面才会消失。
    hasClient: Boolean(meta?.dsh?.client),
    rows,
    rowDefaults,
  }
}

/** 管理器判定：排除自家官方包后，看名字里有没有「管理器」的味道。 */
export function isManagerPackage(name) {
  if (NOT_APPEARANCE.some((pattern) => pattern.test(name))) return false
  return MANAGER.test(name)
}

function classify(name, info) {
  if (NOT_APPEARANCE.some((pattern) => pattern.test(name))) return null
  if (MANAGER.test(name)) return null
  if (info.hasSkinJson) return 'skin'
  if (BG.test(name)) return 'background'
  if (THEME.test(name)) return 'theme'
  if (DECOR.test(name)) return 'decoration'
  if (APPEARANCE_WORD.test(info.description)) return 'theme'
  return null
}

/**
 * 读取完整外观模型。
 * @param {{ profileDir?: string }} [options] 宿主给的 profile 目录（有就优先用它）
 * @returns {{
 *   ok: true,
 *   profileDir: string,
 *   configPath: string,
 *   configExists: boolean,
 *   layers: Array<{ id: string, multi: boolean, label: object, note: object, items: object[] }>,
 *   warnings: string[],
 *   stats: { total: number, active: number },
 * }}
 */
export function readModel(options = {}) {
  const profileDir = resolveProfileDir(options.profileDir)
  const pkg = readJson(join(profileDir, 'package.json'))
  const patchPaths = resolvePatchPaths(profileDir)
  const configPath = patchPaths[0]
  const configExists = existsSync(configPath)
  // 读的是**两层合并后**的生效状态：只看 profile 层会在 home 层覆盖时显示错的状态。
  const flags = effectiveFlags(patchPaths)

  const warnings = []
  if (!pkg) {
    return {
      ok: false,
      error: `读不到 profile 的 package.json：${join(profileDir, 'package.json')}`,
      profileDir,
      configPath,
      configExists,
      layers: LAYERS.map((layer) => ({ ...layer, items: [] })),
      managers: [],
      warnings,
      stats: { total: 0, active: 0 },
    }
  }

  // 宁可不写，也不能写错地方：没有 dsh.profile 的目录不是 DSH profile，
  // 往里写 cordis.patch.yml 只会制造一个谁都读不懂的文件。
  if (!pkg.dsh || typeof pkg.dsh !== 'object' || !pkg.dsh.profile || typeof pkg.dsh.profile !== 'object') {
    return {
      ok: false,
      error: `这个目录不像 DSH profile（package.json 里没有 dsh.profile）：${profileDir}`,
      profileDir,
      configPath,
      configExists,
      layers: LAYERS.map((layer) => ({ ...layer, items: [] })),
      managers: [],
      warnings,
      stats: { total: 0, active: 0 },
    }
  }

  const deps = Object.keys(pkg.dependencies ?? {})
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  const grouped = new Map(LAYERS.map((layer) => [layer.id, []]))
  const managers = []

  for (const name of deps) {
    const info = inspectPackage(profileDir, name)
    if (!info) continue

    // 管理器单独收：它们不渲染外观，但会抢同一批 disabled 行。
    if (isManagerPackage(name)) {
      const rows = info.rows
      if (rows.length > 0) {
        managers.push({
          key: name,
          version: info.version,
          description: info.description,
          rows,
          rowDefaults: info.rowDefaults,
          active: rows.every((row) => flags.get(row) !== true),
          hostOnly: info.hasClient !== true,
          managed: true,
        })
      }
      continue
    }

    const layerId = classify(name, info)
    if (!layerId) continue

    const rows = info.rows
    const active = rows.length === 0 ? true : rows.every((row) => flags.get(row) !== true)
    if (rows.length === 0) warnings.push(`${name} 没有可定位的 patch 行，无法开关`)
    if (!bundles.includes(name)) warnings.push(`${name} 已安装但不在 dsh.profile.bundles 里，当前不会被加载`)

    grouped.get(layerId).push({
      key: name,
      version: info.version,
      description: info.description,
      rows,
      rowDefaults: info.rowDefaults,
      active,
      managed: rows.length > 0,
      // 宿主注入型：页面里的脚本由宿主塞进来，改完之后必须刷新页面才会消失。
      hostOnly: info.hasClient !== true,
      skinId: info.skinJson?.id ?? null,
      bodyAttr: info.skinJson?.bodyAttr ?? null,
      displayName: info.skinJson?.name ?? null,
      displayNameEn: info.skinJson?.nameEn ?? null,
      accent: info.skinJson?.accent ?? null,
    })
  }

  /**
   * 皮肤层委托 —— 只作为**提示**，不再是只读闸门。
   *
   * 早先（0.6.0）的做法是：只要装了皮肤切换器，皮肤层就整层交给它，本面板只显示一行说明。
   * 用起来很别扭：想把皮肤全关掉（一个都不加载）都得跑去另一个页面；切换器被关掉时这一层
   * 又突然变回可操作，行为前后不一致。
   *
   * 现在这一层永远可操作：单选 + 「不使用（官方外观）」。「不使用」会把这一层的行全部
   * 写成 `disabled: true` —— 皮肤一个都不加载，但皮肤管理器自己那一行不动。
   * 皮肤切换器同时存在时，面板里会多一行说明：两边写的是同一批行，谁最后写谁生效，
   * 所以切完（任一边）刷新一下页面就能看到真实状态。
   *
   * 判据：名字里同时有 skin 和（manager|switcher|selector|…），且不是市场 / 商店类。
   * 以前是 `/skin/i`，于是 `dsh-skin-market`（市场）也被当成切换器。
   */
  const isSkinDelegate = (manager) =>
    /skin/i.test(manager.key) &&
    /(manager|switcher|selector|rotation|hub|center)/i.test(manager.key) &&
    !/market|store|shop/i.test(manager.key)
  const skinManager = managers.find((manager) => manager.active && isSkinDelegate(manager)) ?? null
  const delegated = skinManager ? { skin: skinManager.key } : {}

  /**
   * 冲突提示只在与我们**真的会写同一批行**时给出。
   *
   * 皮肤层不参与这条计算：那一层两边都能写，界面在皮肤那一栏直接写清楚了，
   * 再全局报一次警就是重复噪音（皮肤管理器几乎总在跑）。
   */
  const ourRows = new Set()
  for (const layer of LAYERS) {
    if (delegated[layer.id]) continue
    for (const item of grouped.get(layer.id)) for (const row of item.rows) ourRows.add(row)
  }
  const conflicting = managers.filter(
    (manager) => manager.active && manager.rows.some((row) => ourRows.has(row)),
  )
  if (conflicting.length > 0) {
    warnings.push(
      `这些管理器正在运行，并且会写本面板也管的行：${conflicting.map((manager) => manager.key).join('、')} —— 建议只留一个在用`,
    )
  }

  const layers = LAYERS.map((layer) => {
    const items = grouped.get(layer.id).sort((a, b) => a.key.localeCompare(b.key))
    return { ...layer, items, delegated: Boolean(delegated[layer.id]) }
  })

  const total = layers.reduce((sum, layer) => sum + layer.items.length, 0)
  const active = layers.reduce((sum, layer) => sum + layer.items.filter((item) => item.active).length, 0)

  managers.sort((a, b) => a.key.localeCompare(b.key))

  return { ok: true, profileDir, configPath, patchPaths, configExists, layers, managers, delegated, warnings, stats: { total, active } }
}

/** 某个 row 属于「宿主注入型」插件吗（改完之后页面里还会留着东西）。 */
export function hostOnlyRows(model) {
  const rows = new Set()
  for (const layer of model.layers ?? []) {
    for (const item of layer.items ?? []) {
      if (item.hostOnly !== true) continue
      for (const row of item.rows ?? []) rows.add(row)
    }
  }
  for (const manager of model.managers ?? []) {
    if (manager.hostOnly !== true) continue
    for (const row of manager.rows ?? []) rows.add(row)
  }
  return rows
}

/** 收集每个 row 的「bundle 默认状态」与「是否宿主注入型」。 */
function rowFacts(model) {
  const defaults = new Map()
  const hostOnly = new Set()
  const collect = (item) => {
    for (const row of item.rows ?? []) {
      defaults.set(row, item.rowDefaults?.[row] === true)
      if (item.hostOnly === true) hostOnly.add(row)
    }
  }
  for (const layer of model.layers ?? []) for (const item of layer.items ?? []) collect(item)
  for (const manager of model.managers ?? []) collect(manager)
  return { defaults, hostOnly }
}

/**
 * 应用选择。
 *
 * `selections[layerId]`：
 *   - 单选层：包名，或 `''` 表示「这一层全部关掉」；
 *   - 多选层（decoration）：包名数组；
 *   - 省略某个层 = 该层保持现状。
 *
 * @param {Record<string, string | string[]>} selections
 * @param {{ dryRun?: boolean, managers?: Record<string, boolean>, excludeRows?: string[], profileDir?: string }} [options]
 */
export function applySelections(selections = {}, options = {}) {
  const model = readModel({ profileDir: options.profileDir })
  if (!model.ok) return { ok: false, error: model.error }

  const patchPaths = model.patchPaths ?? [model.configPath]
  const { defaults, hostOnly } = rowFacts(model)
  /** 每一层自己的开关状态：写出 `disabled: false` 时要知道「谁在压着这一行」。 */
  const layerFlags = patchPaths.map((path) => (existsSync(path) ? parseFlags(readFileSync(path, 'utf8')) : new Map()))
  const currentFlags = new Map()
  for (const flags of layerFlags) for (const [row, disabled] of flags) currentFlags.set(row, disabled)
  const isDisabledNow = (row) => (currentFlags.has(row) ? currentFlags.get(row) === true : defaults.get(row) === true)

  const errors = []
  const desired = new Map()

  /**
   * 先把所有受管行的现状抄进来：本次没提到的层必须**原样保留**。
   *
   * 唯一的例外是「其它管理器」那一栏 —— 我们只在用户显式开关时才写它们，
   * 否则上一轮写下的 disabled 会被永久保留，等于偷偷关着别人的管理器。
   *
   * 皮肤层**照抄现状**：它现在由本面板管（包括「不使用」＝全部停用），
   * 即使皮肤切换器同时在跑也一样 —— 那是它自己的事，界面会给出提示。
   */
  for (const layer of model.layers) {
    for (const item of layer.items) {
      for (const row of item.rows) desired.set(row, isDisabledNow(row))
    }
  }

  for (const layer of model.layers) {
    if (!(layer.id in selections)) continue
    const value = selections[layer.id]

    if (layer.multi) {
      const chosen = Array.isArray(value) ? value : value === '' || value == null ? [] : [String(value)]
      for (const key of chosen) {
        const item = layer.items.find((entry) => entry.key === key)
        if (!item) errors.push(`${key} 不是「${layer.id}」层的插件`)
      }
      for (const item of layer.items) {
        const on = chosen.includes(item.key)
        for (const row of item.rows) desired.set(row, !on)
      }
      continue
    }

    const chosen = value == null ? '' : String(value)
    if (chosen !== '') {
      const item = layer.items.find((entry) => entry.key === chosen)
      if (!item) errors.push(`${chosen} 不是「${layer.id}」层的插件`)
    }
    for (const item of layer.items) {
      const on = item.key === chosen
      for (const row of item.rows) desired.set(row, !on)
    }
  }

  // 管理器开关（皮肤管理器之类）：它们不在任何外观层里，但共用同一批 disabled 行。
  const managerChoices = options.managers !== null && typeof options.managers === 'object' ? options.managers : {}
  for (const key of Object.keys(managerChoices)) {
    if (!(model.managers ?? []).some((manager) => manager.key === key)) {
      errors.push(`${key} 不是已安装的外观管理器`)
    }
  }
  for (const manager of model.managers ?? []) {
    if (!(manager.key in managerChoices)) continue
    const on = managerChoices[manager.key] !== false
    for (const row of manager.rows) desired.set(row, !on)
  }

  if (errors.length > 0) return { ok: false, errors }

  // 官方插件管理器已经热应用的行交给它独占：我们从受管区块里彻底移除这些行。
  const excluded = new Set(Array.isArray(options.excludeRows) ? options.excludeRows : [])
  for (const row of excluded) desired.delete(row)

  /** 语义上的变化：和目标状态不一致的行（不管最后由谁写）。 */
  const changed = []
  for (const [row, disabled] of desired) {
    if (isDisabledNow(row) !== disabled) changed.push({ row, disabled })
  }
  const rows = [...desired.entries()].map(([row, disabled]) => ({ row, disabled }))

  /**
   * 真正要落进区块的行：**我们的意见和「外面已经这么写了」不一样的那些**。
   *
   * 「外面」＝把两层文件里我们自己那块摘掉之后剩下的一切：bundle 默认值、
   * 别的管理器写的行、用户手写的行。于是：
   *   - 别人已经把这一行停用了、我们也要停用 → 不写（不重复、不抢）；
   *   - 别人停用了、我们要启用 → 必须写 `disabled: false`（否则我们的话没人听）；
   *   - 谁都没提、默认启用，我们要启用 → 不写；
   *   - 谁都没提、我们要停用 → 写 `disabled: true`。
   *
   * 这样区块里只剩「真正的意见」，而且**重复应用一定 noop**：算「外面」时摘掉的是
   * 我们自己的块，所以同一份选择每次算出来的行完全一样，不会写完又把自己抹掉。
   */
  const outsideFlags = new Map()
  for (const path of patchPaths) {
    if (!existsSync(path)) continue
    for (const [row, disabled] of parseFlags(stripManagedBlock(readFileSync(path, 'utf8')))) outsideFlags.set(row, disabled)
  }
  const outsideDisabled = (row) => (outsideFlags.has(row) ? outsideFlags.get(row) === true : defaults.get(row) === true)
  const blockRows = rows.filter((entry) => outsideDisabled(entry.row) !== entry.disabled)
  const blockLines = [MARK_START, MARK_NOTE]
  for (const entry of blockRows) blockLines.push(`- id: ${entry.row}`, `  disabled: ${entry.disabled}`)
  blockLines.push(MARK_END)

  /**
   * 算出每个补丁层要写成什么。
   *
   * 两层都要写：home 层优先级更高，只写 profile 会被 home 里别的管理器留下的同名行压回去。
   * home 层原本不存在时不主动创建 —— 不想替所有 profile 凭空造一个全局补丁层。
   */
  const plan = []
  for (const path of patchPaths) {
    const exists = existsSync(path)
    if (!exists && path !== model.configPath) continue
    const original = exists ? readFileSync(path, 'utf8') : ''
    const eol = original.includes('\r\n') ? '\r\n' : '\n'
    const head = stripManagedBlock(original).trimEnd()
    const block = blockLines.join(eol)
    const next = head === '' ? `${block}${eol}` : `${head}${eol}${eol}${block}${eol}`
    if (next === original) continue
    plan.push({ path, next, exists, backup: exists ? `${path}.master-bak` : null })
  }

  /**
   * 要不要刷新页面？
   *
   * **只要有一行变了，就要刷新。** 理由不是「宿主注入型」那一小撮插件，而是整个机制：
   * 外观插件是在页面启动时按配置树装进页面的 —— 卸载一个客户端插件，它注册过的
   * 主题、注入过的 CSS 和 DOM 不会自己撤掉（模块图里删掉它，副作用已经发生了）。
   * 于是「文件里已停用、画面上还在」这种状态，只有重新加载页面才能收拾干净。
   *
   * 以前这里只对「没有 dsh.client 的宿主注入型」返回 true，其余情况面板会宣布
   * 「已生效（页面无需刷新）」—— 那句话其实是在读文件，不是在看页面。
   */
  const pageReload = changed.length > 0
  /** 这些行所属的插件没有客户端半区：它们的脚本是宿主直接塞进页面的。 */
  const injectRows = changed.filter((entry) => hostOnly.has(entry.row)).map((entry) => entry.row)

  // 内容完全一致就不落盘：避免无意义的 mtime 变化惊动文件监听器，
  // 也让「点一下应用但什么都没改」不留备份垃圾。
  if (plan.length === 0) {
    return {
      ok: true,
      noop: true,
      changed,
      requested: changed,
      rows,
      blockRows,
      pageReload,
      injectRows,
      configPath: model.configPath,
    }
  }

  if (options.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      changed,
      requested: changed,
      rows,
      blockRows,
      pageReload,
      injectRows,
      configPath: model.configPath,
      willWrite: plan.map((entry) => entry.path),
    }
  }

  const written = []
  const backups = []
  for (const entry of plan) {
    if (entry.backup !== null) {
      copyFileSync(entry.path, entry.backup)
      backups.push(entry.backup)
    }
    // 原子写：先写临时文件再改名。HMR 在监听这个文件，
    // 半截内容会让它读到坏 YAML，重载失败后保持旧组合 —— 看起来就是「没反应」。
    const temporary = `${entry.path}.${process.pid}.tmp`
    writeFileSync(temporary, entry.next, 'utf8')
    renameSync(temporary, entry.path)
    written.push(entry.path)
  }

  return {
    ok: true,
    changed,
    requested: changed,
    rows,
    blockRows,
    pageReload,
    injectRows,
    configPath: model.configPath,
    written,
    backup: backups.length > 0 ? backups : null,
    reload: written.length > 0,
  }
}
