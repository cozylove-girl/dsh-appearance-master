/**
 * 写入安全测试：在 test/.tmp-profile 造一个假 profile，验证
 *   1) CRLF 换行风格被保留（不会整片重写成 LF）
 *   2) 内容没有变化时完全不落盘（noop，不产生备份垃圾）
 *   3) 受管区块之外的用户内容原样保留
 *   4) disabled 行能被自己的解析器读回来（写读闭环）
 *   5) 不是 DSH profile 的目录会拒绝写入
 * 全程只碰临时目录，不接触真实 profile。
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const base = fileURLToPath(new URL('./.tmp-profile', import.meta.url))
rmSync(base, { recursive: true, force: true })

function writeFile(relative, content) {
  const path = join(base, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

const CRLF = '\r\n'
const userLayer = [
  '# 用户自己的补丁层',
  '- id: ui-theme',
  '  name: "@deepseek-ai/dsh-client-ui-theme"',
  '  config:',
  '    preference: dark',
  '',
].join(CRLF)

writeFile(
  'package.json',
  JSON.stringify(
    {
      name: 'tmp-profile',
      private: true,
      dsh: { profile: { bundles: ['fake-skin-kit', 'fake-video-skin'] } },
      dependencies: { 'fake-skin-kit': '1.0.0', 'fake-video-skin': '1.0.0' },
    },
    null,
    2,
  ),
)

writeFile(
  'node_modules/fake-skin-kit/package.json',
  JSON.stringify({ name: 'fake-skin-kit', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2),
)
writeFile('node_modules/fake-skin-kit/skin.json', JSON.stringify({ name: 'fake-skin-kit' }))
writeFile('node_modules/fake-skin-kit/cordis.patch.yml', '- insert:\r\n    - id: ui-fake-skin\r\n      name: fake-skin-kit\r\n')

writeFile(
  'node_modules/fake-video-skin/package.json',
  JSON.stringify({ name: 'fake-video-skin', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2),
)
writeFile('node_modules/fake-video-skin/cordis.patch.yml', '- insert:\r\n    - id: ui-fake-video\r\n      name: fake-video-skin\r\n')

writeFile('cordis.patch.yml', userLayer)

process.env.DSH_PROFILE_DIR = base
process.env.DSH_HOME = join(base, 'home')  // 两层写入都落在临时目录里

const { applySelections, readModel, parseFlags, effectiveFlags } = await import('../lib/scan.js')

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` (${detail})` : ''}`)
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
}

// 1) 扫描
const model = readModel()
check('扫描到两个外观包', model.ok === true && model.layers.find((l) => l.id === 'skin')?.items.length === 1 && model.layers.find((l) => l.id === 'background')?.items.length === 1, JSON.stringify(model.stats))
check('皮肤层认出了 skin.json', model.layers.find((l) => l.id === 'skin')?.items[0]?.key === 'fake-skin-kit')

// 2) 第一次应用（应写入受管区块，保住 CRLF）
const first = applySelections({ skin: 'fake-skin-kit', background: 'fake-video-skin' })
// 两个包本来就没被停用过，所以「状态变化」为 0 —— 但区块要写进去，因此 not noop。
check('第一次应用写入了区块', first.ok === true && first.noop !== true, JSON.stringify({ ok: first.ok, noop: first.noop }))
const afterFirst = readFileSync(join(base, 'cordis.patch.yml'), 'utf8')
check('CRLF 被保留', afterFirst.includes('\r\n') && !/(?<!\r)\n/.test(afterFirst))
check('用户内容未丢失', afterFirst.includes('preference: dark') && afterFirst.includes('用户自己的补丁层'))
check('受管区块已写入', afterFirst.includes('appearance-master managed'))
check('备份文件已生成', existsSync(join(base, 'cordis.patch.yml.master-bak')))

// 3) 写读闭环：默认启用的行**不再**写冗余的 disabled: false（少写一行就少一处冲突），
//    但合并后的有效状态仍然是启用。
const flags = parseFlags(afterFirst)
check('默认启用的行不再写冗余行', flags.get('ui-fake-skin') === undefined && flags.get('ui-fake-video') === undefined, afterFirst)
check('有效状态仍然是启用', effectiveFlags().get('ui-fake-skin') !== true && effectiveFlags().get('ui-fake-video') !== true)

// 4) 无变化时 noop，且不重写文件
const mtimeBefore = readFileSync(join(base, 'cordis.patch.yml'))
const second = applySelections({ skin: 'fake-skin-kit', background: 'fake-video-skin' })
const mtimeAfter = readFileSync(join(base, 'cordis.patch.yml'))
check('第二次应用为 noop', second.ok === true && second.noop === true && second.changed.length === 0, JSON.stringify({ noop: second.noop, changed: second.changed.length }))
check('noop 不产生备份垃圾', Buffer.compare(Buffer.from(mtimeBefore), Buffer.from(mtimeAfter)) === 0)

// 5) 关掉皮肤 → 应写 disabled: true，并保留视频背景
const third = applySelections({ skin: '' })
const afterThird = readFileSync(join(base, 'cordis.patch.yml'), 'utf8')
const flags3 = parseFlags(afterThird)
check('关掉皮肤后 disabled=true', flags3.get('ui-fake-skin') === true)
check('未提到的层保持原状', flags3.get('ui-fake-video') !== true)
check('第三方应用报告 changed', third.changed.some((change) => change.row === 'ui-fake-skin' && change.disabled === true))
check('CRLF 仍被保留（多次写入后）', afterThird.includes('\r\n') && !/(?<!\r)\n/.test(afterThird))

// 6) 非 profile 目录必须拒绝
const notProfile = join(base, 'not-a-profile')
mkdirSync(notProfile, { recursive: true })
writeFileSync(join(notProfile, 'package.json'), JSON.stringify({ name: 'x', dependencies: {} }), 'utf8')
process.env.DSH_PROFILE_DIR = notProfile
const refused = applySelections({ skin: '' })
check('非 profile 目录被拒绝', refused.ok === false && /不像 DSH profile/.test(refused.error ?? ''), refused.error)
check('拒绝时没有写文件', !existsSync(join(notProfile, 'cordis.patch.yml')))

// 7) 回滚语义：stripManagedBlock 之后用户内容还在、受管行全部消失（回到默认启用）
const { stripManagedBlock, MARK_START } = await import('../lib/scan.js')
const rolledBack = stripManagedBlock(readFileSync(join(base, 'cordis.patch.yml'), 'utf8'))
check('回滚后受管区块消失', !rolledBack.includes(MARK_START) && !rolledBack.includes('appearance-master managed'))
check('回滚后用户内容仍在', rolledBack.includes('preference: dark'))
const flagsAfterRollback = parseFlags(rolledBack)
check('回滚后受管行不再覆盖默认值', flagsAfterRollback.get('ui-fake-skin') === undefined)

process.env.DSH_PROFILE_DIR = base
process.env.DSH_HOME = join(base, 'home')  // 两层写入都落在临时目录里
rmSync(base, { recursive: true, force: true })

if (failures.length > 0) {
  console.error('\nFAILED:', failures.join('; '))
  process.exit(1)
}
console.log('\nwrite-safety test OK')
