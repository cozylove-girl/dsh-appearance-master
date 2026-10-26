/**
 * 只读预演：不动任何文件，把「现在的状态」和「下一次应用会写什么」摊开给你看。
 *
 * 用法（在插件目录里）：
 *   node scripts/preview.mjs
 *   node scripts/preview.mjs --selections '{"theme":"dsh-cyrene-theme","decoration":[]}'
 *
 * 不带 --selections 时，按「当前生效状态」预演一次 —— 也就是你以为什么都没改、
 * 面板会怎么整理受管区块。区块里如果只剩很少几行（甚至只有头尾标记），那是正常的：
 * 0.8.0 起默认启用的行不再写冗余的 disabled: false。
 */
import { applySelections, readModel, resolvePatchPaths, MARK_START, stripManagedBlock } from '../lib/scan.js'
import { existsSync, readFileSync } from 'node:fs'

const model = readModel()
console.log('profile :', model.profileDir)
console.log('layers  :', resolvePatchPaths().map((path) => `${existsSync(path) ? '存在' : '不存在'} ${path}`).join('\n          '))
console.log('ok      :', model.ok, model.ok ? '' : `— ${model.error}`)
if (!model.ok) process.exit(1)

for (const layer of model.layers) {
  console.log(`\n[${layer.id}]${layer.delegated ? ' （已委托给皮肤管理器）' : ''}`)
  for (const item of layer.items) {
    console.log(`  ${item.active ? '●' : '○'} ${item.key} v${item.version}  rows=${item.rows.join(',') || '-'}${item.hostOnly ? '  (宿主注入型)' : ''}`)
  }
}
console.log('\n[managers]')
for (const manager of model.managers) {
  console.log(`  ${manager.active ? '●' : '○'} ${manager.key} v${manager.version}  rows=${manager.rows.join(',')}`)
}

/** 默认选择 = 当前生效状态，和面板刚打开时一样。 */
function currentSelections() {
  const selections = {}
  for (const layer of model.layers) {
    if (layer.delegated) continue
    if (layer.multi) {
      selections[layer.id] = layer.items.filter((item) => item.active).map((item) => item.key)
    } else {
      const found = layer.items.find((item) => item.active)
      selections[layer.id] = found ? found.key : ''
    }
  }
  return selections
}

const arg = process.argv.indexOf('--selections')
let selections = currentSelections()
if (arg !== -1 && process.argv[arg + 1]) {
  try {
    selections = JSON.parse(process.argv[arg + 1])
  } catch (cause) {
    console.error('--selections 不是合法 JSON：', String(cause?.message ?? cause))
    process.exit(1)
  }
}

console.log('\n预演选择：', JSON.stringify(selections))
const plan = applySelections(selections, { dryRun: true })
if (plan.ok === false) {
  console.error('预演失败：', plan.error ?? plan.errors)
  process.exit(1)
}

console.log('\n将会写入的受管行（只有真正有意见的行）：')
if ((plan.blockRows ?? []).length === 0) console.log('  （空 —— 区块只有头尾标记，这是正常的）')
for (const entry of plan.blockRows ?? []) console.log(`  ${entry.disabled ? 'off' : 'on '}  ${entry.row}`)

console.log('\n语义变化：', (plan.changed ?? []).length, (plan.changed ?? []).map((c) => `${c.row}→${c.disabled ? 'off' : 'on'}`).join(', '))
console.log(
  '需要刷新页面：',
  plan.pageReload === true
    ? `是（只要有一行变了就要刷新；其中宿主注入型：${(plan.injectRows ?? []).join(', ') || '无'}）`
    : '否',
)
console.log('会写入的文件：', (plan.willWrite ?? []).join(', ') || '（无变化，不会落盘）')

for (const path of plan.willWrite ?? []) {
  const original = readFileSync(path, 'utf8')
  const head = stripManagedBlock(original)
  console.log(`\n--- ${path} 去掉受管区块后的样子（前 12 行）---`)
  console.log(head.trimEnd().split(/\r?\n/).slice(0, 12).join('\n') || '（空）')
  if (original.includes(MARK_START) && /[^\x00-\x7F]/.test(original.slice(original.indexOf(MARK_START), original.indexOf(MARK_START) + 200))) {
    console.log('注意：现有区块头里有非 ASCII 字节（老版本写下的中文注释，可能已被 GBK 工具转坏），这次应用会整段重写。')
  }
}
