/**
 * 离线校验：用真实 profile 数据跑 readModel / applySelections(dryRun)。
 * 只读，不写入任何文件。
 */
import { readModel, applySelections, LAYERS } from '../lib/scan.js'

const model = readModel()
console.log('== profile ==')
console.log('dir:', model.profileDir)
console.log('config:', model.configPath, 'exists:', model.configExists)
console.log('ok:', model.ok, model.ok ? '' : model.error)

if (model.ok) {
  console.log('\n== layers ==')
  for (const layer of model.layers) {
    console.log(`[${layer.id}] multi=${layer.multi} items=${layer.items.length}`)
    for (const item of layer.items) {
      console.log(`   - ${item.key} v${item.version} active=${item.active} rows=[${item.rows.join(', ')}]`)
    }
  }

  console.log('\n== stats ==', JSON.stringify(model.stats))
  console.log('\n== managers ==')
  for (const manager of model.managers ?? []) {
    console.log(`   - ${manager.key} v${manager.version} active=${manager.active} rows=[${manager.rows.join(', ')}]`)
  }
  console.log('\n== warnings ==')
  for (const warning of model.warnings) console.log('  *', warning)

  // 预演：只留 maid-atelier（皮肤）、cyrene（主题）、video-skin（背景）
  const selections = {}
  const skin = model.layers.find((l) => l.id === 'skin')
  const theme = model.layers.find((l) => l.id === 'theme')
  const bg = model.layers.find((l) => l.id === 'background')
  const deco = model.layers.find((l) => l.id === 'decoration')

  if (skin?.items.some((i) => i.key === '@smalltailqwq/dsh-client-ui-skin-maid-atelier')) {
    selections.skin = '@smalltailqwq/dsh-client-ui-skin-maid-atelier'
  }
  if (theme?.items.some((i) => i.key === 'dsh-cyrene-theme')) selections.theme = 'dsh-cyrene-theme'
  if (bg?.items.some((i) => i.key === 'dsh-video-skin')) selections.background = 'dsh-video-skin'
  if (deco) selections.decoration = deco.items.filter((i) => i.active).map((i) => i.key)

  console.log('\n== dry run selections ==', JSON.stringify(selections))
  const plan = applySelections(selections, { dryRun: true })
  if (plan.ok === false) {
    console.log('FAILED:', plan.error ?? plan.errors)
  } else {
    console.log('rows to write:')
    for (const row of plan.rows) console.log(`   ${row.disabled ? 'off' : 'on '}  ${row.row}`)
    console.log('changed:', plan.changed.length)
    for (const change of plan.changed) console.log(`   ${change.row} -> disabled=${change.disabled}`)
  }
}

console.log('\nlayers declared:', LAYERS.map((l) => l.id).join(', '))
