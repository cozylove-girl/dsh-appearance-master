/**
 * 运行时验收：DSH 重启后跑这个，一条命令看清「插件是否真的加载、改了没有」。
 *
 * 用法（在任意目录）：node verify-runtime.mjs
 * 退出码：0 = 全部通过；1 = 有项目没通过（便于脚本化）
 *
 * 只读，不改任何文件。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
  ? process.env.DSH_HOME.trim()
  : join(homedir(), '.dsh')
const profileDir = typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR.trim() !== ''
  ? process.env.DSH_PROFILE_DIR.trim()
  : join(home, 'profiles', 'desktop')

const heartbeatPath = join(home, 'appearance-master.heartbeat.json')
const configPath = join(profileDir, 'cordis.patch.yml')
const presetsPath = join(home, 'appearance-presets.json')
const pkgPath = join(profileDir, 'package.json')

const problems = []
const line = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) problems.push(label)
}

console.log('profile :', profileDir)
console.log('home    :', home)
console.log('')

// 1) 心跳：证明宿主侧 apply() 真的跑过
if (existsSync(heartbeatPath)) {
  const beat = JSON.parse(readFileSync(heartbeatPath, 'utf8'))
  const ageMinutes = (Date.now() - Date.parse(beat.loadedAt)) / 60000
  line(true, '宿主插件已加载', `v${beat.version} · ${beat.loadedAt} · node ${beat.node}`)
  line(ageMinutes >= 0, '心跳时间可解析', `${ageMinutes.toFixed(1)} 分钟前`)
  line(Array.isArray(beat.routes) && beat.routes.length === 3, '路由清单完整', (beat.routes ?? []).join(' | '))
  line(ageMinutes < 60 * 24, '心跳不是陈旧的', '若刚重启过，应为几分钟内')
} else {
  line(false, '宿主插件已加载', `缺 ${heartbeatPath} —— DSH 还没重启，或 bundle 被跳过`)
}

// 2) profile 依赖与 bundles
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const dep = pkg.dependencies?.['dsh-appearance-master']
  const bundled = Array.isArray(pkg.dsh?.profile?.bundles) && pkg.dsh.profile.bundles.includes('dsh-appearance-master')
  line(Boolean(dep), 'profile 依赖已登记', dep ?? '（缺）')
  line(bundled, '已在 dsh.profile.bundles 里', bundled ? '' : '不会被加载')
} else {
  line(false, 'profile package.json 可读', pkgPath)
}

// 3) 受管区块
if (existsSync(configPath)) {
  const text = readFileSync(configPath, 'utf8')
  const start = text.indexOf('# --- appearance-master managed')
  const hasBlock = start !== -1
  line(hasBlock, '受管区块存在', hasBlock ? '说明至少点过一次「应用」' : '还没点过应用，属正常')

  if (hasBlock) {
    const end = text.indexOf('# --- end appearance-master managed', start)
    const blockText = end === -1 ? '' : text.slice(start, end)
    const rows = [...blockText.matchAll(/^[ \t]*-[ \t]*id:[ \t]*(\S+)/gm)].map((match) => match[1])
    const disabled = [...blockText.matchAll(/disabled:[ \t]*(true|false)/g)].map((match) => match[1])
    const off = disabled.filter((value) => value === 'true').length
    // 0.8.0 起只写「有意见」的行，区块里可能一行都没有 —— 那是正常的，不是失败。
    if (rows.length === 0) console.log(`note 区块是空的（${off} 行停用）—— 说明所有层都在用各插件的默认状态，属正常`)
    else console.log(`ok   区块里有 ${rows.length} 行，其中 ${off} 行 disabled: true`)
    line(end !== -1, '区块闭合', end === -1 ? '缺结束标记，文件可能被别的工具改过' : '')
    // 0.8.0 把区块里的说明改成纯 ASCII：老区块里那行中文被 GBK 工具转过，行尾换行被吃掉，
    // `- id:` 粘在注释末尾。它会在下一次「应用」时被整段重写修好，这里只做个提示，不算失败。
    if (/[^\x00-\x7F]/.test(text.slice(start, start + 160))) {
      console.log('note 区块头里有非 ASCII 字节（老版本写下的中文注释，可能已被转坏）—— 下次点「应用」会整段重写修好')
    }
    const backup = `${configPath}.master-bak`
    line(existsSync(backup), '写入前备份存在', backup)
  }
} else {
  line(false, 'cordis.patch.yml 存在', configPath)
}

// 4) 方案文件
if (existsSync(presetsPath)) {
  const store = JSON.parse(readFileSync(presetsPath, 'utf8'))
  line(Array.isArray(store.presets), '方案文件可解析', `v${store.version} · ${store.presets.length} 套`)
} else {
  console.log('note 还没有方案文件（没存过方案，属正常）')
}

console.log('')
console.log('文件大小：')
for (const [label, path] of [['heartbeat', heartbeatPath], ['config', configPath], ['presets', presetsPath]]) {
  if (existsSync(path)) console.log(`  ${label.padEnd(10)} ${String(statSync(path).size).padStart(7)} B  ${path}`)
}

console.log('')
if (problems.length > 0) {
  console.log(`结论：${problems.length} 项未通过 → ${problems.join('、')}`)
  process.exit(1)
}
console.log('结论：全部通过')
