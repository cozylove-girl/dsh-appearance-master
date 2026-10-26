/**
 * 两层补丁测试：验证「home 层优先级更高」这件事被正确处理。
 *
 * 场景复刻用户机器上的真实冲突：
 *   profile 层：我们的选择（maid 停用）
 *   home   层：另一个管理器留下的同名行（maid 启用）← 优先级更高
 * 以前只写 profile 层，结果被 home 层压回去，看起来就是「点了没反应」。
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const base = fileURLToPath(new URL('./.tmp-layers', import.meta.url))
rmSync(base, { recursive: true, force: true })

const profileDir = join(base, 'profile')
const homeDir = join(base, 'home')
mkdirSync(profileDir, { recursive: true })
mkdirSync(homeDir, { recursive: true })

function writeFile(path, content) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

// 假 profile：一个皮肤（skin.json → skin 层）
writeFile(
  join(profileDir, 'package.json'),
  JSON.stringify(
    {
      name: 'tmp-profile',
      private: true,
      dsh: { profile: { bundles: ['fake-skin-kit'] } },
      dependencies: { 'fake-skin-kit': '1.0.0' },
    },
    null,
    2,
  ),
)
writeFile(
  join(profileDir, 'node_modules/fake-skin-kit/package.json'),
  JSON.stringify({ name: 'fake-skin-kit', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
)
writeFile(join(profileDir, 'node_modules/fake-skin-kit/skin.json'), JSON.stringify({ name: 'fake-skin-kit' }))
writeFile(join(profileDir, 'node_modules/fake-skin-kit/cordis.patch.yml'), '- insert:\n    - id: ui-fake-skin\n      name: fake-skin-kit\n')

// profile 层：本来没有我们的块
writeFile(join(profileDir, 'cordis.patch.yml'), '# profile 层\n[]\n')

// home 层：另一个管理器留下的同名行（启用）
writeFile(
  join(homeDir, 'cordis.patch.yml'),
  ['# --- dsh-skin managed ---', '- id: ui-fake-skin', '  disabled: false', '# --- end dsh-skin managed', ''].join('\n'),
)

process.env.DSH_PROFILE_DIR = profileDir
process.env.DSH_HOME = homeDir
process.env.DSH_APPEARANCE_PRESETS = join(base, 'presets.json')

const { readModel, applySelections, effectiveFlags, resolvePatchPaths } = await import('../lib/scan.js')

const failures = []
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}${detail ? ` (${detail})` : ''}`)
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
}

const paths = resolvePatchPaths()
check('补丁路径包含两层', paths.length === 2 && paths[1] === join(homeDir, 'cordis.patch.yml'), paths.join(' | '))

const model = readModel()
const skinItem = model.layers.find((layer) => layer.id === 'skin')?.items?.[0]
check('读模型时采用 home 层的值（启用）', skinItem?.active === true, JSON.stringify(skinItem))

// 关掉这个皮肤：应该把 home 层也写一遍，覆盖掉那边的 false
const applied = applySelections({ skin: '' })
check('应用成功且写了两层', applied.ok === true && applied.written?.length === 2, JSON.stringify(applied.written))
check('生效值变为停用', effectiveFlags(paths).get('ui-fake-skin') === true)

const homeText = readFileSync(join(homeDir, 'cordis.patch.yml'), 'utf8')
const homeBlockIndex = homeText.indexOf('# --- appearance-master managed')
const homeSkinIndex = homeText.indexOf('# --- end dsh-skin managed')
check('home 层追加了我们的块', homeBlockIndex !== -1)
check('我们的块排在别的管理块之后（后写者优先）', homeBlockIndex > homeSkinIndex)
check('home 层原有内容仍在', homeText.includes('# --- dsh-skin managed'))

const profileText = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
check('profile 层也有我们的块', profileText.includes('# --- appearance-master managed'))
check('两层都留了备份', existsSync(join(homeDir, 'cordis.patch.yml.master-bak')) && existsSync(join(profileDir, 'cordis.patch.yml.master-bak')))

// 第二次应用应当 noop
const again = applySelections({ skin: '' })
check('重复应用为 noop', again.ok === true && again.noop === true, JSON.stringify({ noop: again.noop }))

// 再打开：home 层同样要跟着改
const reenabled = applySelections({ skin: 'fake-skin-kit' })
check('重新启用也写了两层', reenabled.ok === true && reenabled.written?.length >= 1)
check('home 层生效值变为启用', effectiveFlags(paths).get('ui-fake-skin') === false)

rmSync(base, { recursive: true, force: true })

if (failures.length > 0) {
  console.error('\nFAILED:', failures.join('; '))
  process.exit(1)
}
console.log('\ntwo-layers test OK')
