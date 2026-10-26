/**
 * 发布前的守门人：`npm publish` 会先跑这个（prepublishOnly）。
 *
 * 它只做一件事 —— 把「发布出去才发现清单不对」这种事故挡在本地：
 *   1. 清单字段齐不齐（bundle patch / client / main / files / engines.dsh）；
 *   2. repository 是不是真的指回这个仓库（插件目录会校验 npm 包名回指仓库）；
 *   3. 版本号有没有在 CHANGELOG 里留一条；
 *   4. 八个离线测试全部通过。
 *
 * 任何一项不过就非零退出，npm 会中止发布。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const problems = []

// 1. 清单
if (pkg.dsh?.manifestVersion !== 1) problems.push('dsh.manifestVersion 应为 1')
if (typeof pkg.dsh?.bundle?.patch !== 'string') problems.push('缺 dsh.bundle.patch')
if (pkg.dsh?.client?.platform !== 'web') problems.push('dsh.client.platform 应为 web')
if (typeof pkg.main !== 'string' || !existsSync(join(root, pkg.main))) problems.push('main 指向的文件不存在')
if (typeof pkg.exports?.['./client'] !== 'string' || !existsSync(join(root, pkg.exports['./client']))) {
  problems.push('exports["./client"] 指向的文件不存在')
}
if (!Array.isArray(pkg.files) || !pkg.files.includes('lib')) problems.push('files 里应包含 lib')
if (typeof pkg.engines?.dsh !== 'string' || pkg.engines.dsh.trim() === '') {
  problems.push('缺 engines.dsh（插件市场用它判断版本兼容性）')
}

// 2. repository 必须指回这个仓库
const expectedRepo = 'github.com/cozylove-girl/dsh-appearance-master'
const repoUrl = pkg.repository?.url ?? ''
if (!repoUrl.includes(expectedRepo)) {
  problems.push(`repository.url 应指向 ${expectedRepo}，当前是 ${repoUrl || '（空）'}`)
}
if (typeof pkg.homepage !== 'string' || !pkg.homepage.includes(expectedRepo)) {
  problems.push('homepage 也应指向这个仓库')
}

// 3. CHANGELOG 里要有当前版本
const changelog = existsSync(join(root, 'CHANGELOG.md')) ? readFileSync(join(root, 'CHANGELOG.md'), 'utf8') : ''
if (!changelog.includes(`## ${pkg.version}`)) {
  problems.push(`CHANGELOG.md 里没有 ${pkg.version} 这一条（发布前先补一行）`)
}

// 4. 离线测试
// 用 stdio: 'inherit' 直接把输出打出来：既省事，也避免在受限终端里
// 「子进程输出管道」被沙箱拒绝（Windows 上 stdio: 'pipe' 可能 EPERM）。
if (problems.length === 0) {
  const suite = [
    'test/regressions.mjs',
    'test/smoke-host.mjs',
    'test/smoke-client.mjs',
    'test/write-safety.mjs',
    'test/two-layers.mjs',
    'test/nudge.mjs',
    'test/tuning-protocol.mjs',
    'test/check-manifest.mjs',
  ]
  for (const script of suite) {
    console.log(`\n--- ${script}`)
    const run = spawnSync(process.execPath, [join(root, script)], { cwd: root, stdio: 'inherit' })
    if (run.status !== 0) {
      problems.push(`${script} 失败（退出码 ${run.status ?? '被中断'}${run.error ? `，${run.error.code}` : ''}）—— 看上面这一次的输出`)
      break
    }
  }
}

if (problems.length > 0) {
  console.error('\n发布前检查未通过：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`\n发布前检查全部通过：${pkg.name}@${pkg.version}`)
console.log('接下来：npm publish --access public')
