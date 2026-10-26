import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

/** Stage every replacement before touching live files, and restore completed writes on failure. */
export function writeFilesAtomically(plan) {
  const token = `${process.pid}.${randomUUID()}`
  const staged = []
  const written = []
  const matches = (entry, expected) => expected === null
    ? !existsSync(entry.path)
    : existsSync(entry.path) && readFileSync(entry.path, 'utf8') === expected
  const cleanup = (path) => { try { unlinkSync(path) } catch { /* absent or retained for diagnosis */ } }
  try {
    for (const entry of plan) {
      if (!matches(entry, entry.original)) throw new Error(`配置已被其他程序修改，请重新读取：${entry.path}`)
      const temporary = `${entry.path}.${token}.tmp`
      staged.push({ ...entry, temporary })
      writeFileSync(temporary, entry.next, 'utf8')
    }
    for (const entry of staged) {
      if (!matches(entry, entry.original)) throw new Error(`配置已被其他程序修改，请重新读取：${entry.path}`)
      if (entry.backup && entry.original !== null) copyFileSync(entry.path, entry.backup)
    }
    for (const entry of staged) {
      if (!matches(entry, entry.original)) throw new Error(`配置已被其他程序修改，请重新读取：${entry.path}`)
      renameSync(entry.temporary, entry.path)
      written.push(entry)
    }
  } catch (cause) {
    const failures = []
    for (const entry of [...written].reverse()) {
      const temporary = `${entry.path}.${token}.rollback.tmp`
      try {
        if (!matches(entry, entry.next)) throw new Error('文件在写入后又被其他程序修改，未覆盖该修改')
        if (entry.original === null) unlinkSync(entry.path)
        else {
          writeFileSync(temporary, entry.original, 'utf8')
          renameSync(temporary, entry.path)
        }
      } catch (error) {
        failures.push(`${entry.path}: ${error.message}`)
      } finally {
        cleanup(temporary)
      }
    }
    if (failures.length) throw new Error(`${cause.message}；部分文件恢复失败，请检查备份：${failures.join('; ')}`, { cause })
    throw cause
  } finally {
    for (const entry of staged) cleanup(entry.temporary)
  }
}
