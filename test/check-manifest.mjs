/**
 * 校验 package.json：工作区里的这份必须字段齐全（能被 loader 认出来）。
 * 如果本机 profile 里正好链接了这个插件，再顺手对比一下两份版本是否一致 ——
 * 没装、或者换台机器跑的时候，这一步自动跳过，不算失败。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = join(fileURLToPath(new URL('..', import.meta.url)), 'package.json')
const root = dirname(workspace)

const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
  ? process.env.DSH_HOME.trim()
  : join(homedir(), '.dsh')
const profileDir = typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR.trim() !== ''
  ? process.env.DSH_PROFILE_DIR.trim()
  : join(home, 'profiles', process.env.DSH_PROFILE || 'desktop')
const linkPath = join(profileDir, 'node_modules', 'dsh-appearance-master', 'package.json')

const describe = (label, json) =>
  console.log(
    [
      label.padEnd(12),
      `v${json.version}`.padEnd(7),
      `manifestVersion=${json.dsh?.manifestVersion}`,
      `bundle=${Boolean(json.dsh?.bundle?.patch)}`,
      `client=${Boolean(json.dsh?.client)}`,
      `platform=${json.dsh?.client?.platform ?? '-'}`,
      `exports.client=${Boolean(json.exports?.['./client'])}`,
      `main=${json.main ?? '-'}`,
    ].join(' | '),
  )

const works = JSON.parse(readFileSync(workspace, 'utf8'))
describe('workspace', works)

const problems = []
if (works.dsh?.manifestVersion !== 1) problems.push('dsh.manifestVersion 应为 1')
if (typeof works.dsh?.bundle?.patch !== 'string') problems.push('缺 dsh.bundle.patch')
if (works.dsh?.client?.platform !== 'web') problems.push('dsh.client.platform 应为 web')
if (typeof works.main !== 'string' || !existsSync(join(root, works.main))) problems.push('main 指向的文件不存在')
if (typeof works.exports?.['./client'] !== 'string' || !existsSync(join(root, works.exports['./client']))) {
  problems.push('exports["./client"] 指向的文件不存在')
}
if (!Array.isArray(works.files) || !works.files.includes('lib')) problems.push('files 里应当包含 lib')

if (existsSync(linkPath)) {
  const linked = JSON.parse(readFileSync(linkPath, 'utf8'))
  describe('profile-link', linked)
  if (linked.version !== works.version) {
    problems.push(`profile 里链接的版本（${linked.version}）和工作区（${works.version}）不一致`)
  }
} else {
  console.log(`profile-link  （本机 profile 里没有链接这个插件，跳过对比）`)
}

if (problems.length > 0) {
  console.error('\nFAILED:', problems.join('; '))
  process.exit(1)
}
console.log('\nmanifest check OK')
