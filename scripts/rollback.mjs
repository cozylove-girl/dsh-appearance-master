/**
 * 回滚：把「外观总控」写进 profile 的那段受管区块删掉，其它内容一律不动。
 *
 * 用法：
 *   node rollback.mjs --dry      只看会做什么
 *   node rollback.mjs            执行（先备份成 cordis.patch.yml.master-bak-before-rollback）
 *
 * 删除逻辑复用 lib/scan.js 的 stripManagedBlock —— 写入与回滚用同一个函数解析边界，
 * 不会出现「写的和删的认的不是同一个区块」这种最难查的偏移错误。
 *
 * 注意：本脚本不卸载插件。要彻底移除，还要把 dsh-appearance-master 从
 * profile 的 dsh.profile.bundles 与 dependencies 里删掉，再 pnpm install。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { MARK_START, stripManagedBlock } from '../lib/scan.js'

const dryRun = process.argv.includes('--dry')

const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
  ? process.env.DSH_HOME.trim()
  : join(homedir(), '.dsh')
const profileDir = typeof process.env.DSH_PROFILE_DIR === 'string' && process.env.DSH_PROFILE_DIR.trim() !== ''
  ? process.env.DSH_PROFILE_DIR.trim()
  : join(home, 'profiles', 'desktop')
const configPath = join(profileDir, 'cordis.patch.yml')

if (!existsSync(configPath)) {
  console.error('找不到配置文件：', configPath)
  process.exit(1)
}

const original = readFileSync(configPath, 'utf8')
if (!original.includes(MARK_START)) {
  console.log('没有受管区块，什么都不用做。')
  process.exit(0)
}

const stripped = stripManagedBlock(original)
const removedBytes = original.length - stripped.length
const cleaned = `${stripped.trimEnd()}\n`

console.log('配置文件：', configPath)
console.log('将移除字节：', removedBytes)
console.log('剩余字节：', cleaned.length, '/ 原', original.length)

if (dryRun) {
  console.log('\n--dry：没有写任何文件。')
  process.exit(0)
}

const backup = `${configPath}.master-bak-before-rollback`
copyFileSync(configPath, backup)
writeFileSync(configPath, cleaned, 'utf8')
console.log('\n已写入，备份：', backup)
console.log('提示：要彻底移除插件，还需从 dsh.profile.bundles 与 dependencies 删掉 dsh-appearance-master，再 pnpm install。')
