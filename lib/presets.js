/**
 * dsh-appearance-master — 外观方案（预设）存储。
 *
 * 一个方案 = 一份「四层各选什么」的快照，落在 `$DSH_HOME/appearance-presets.json`。
 * 文件格式带版本号，写入走「临时文件 + 原子改名」，最坏情况留下旧文件而不是半截 JSON。
 * 测试可用 `DSH_APPEARANCE_PRESETS` 指到临时路径，避免污染真实 home。
 */

import { mkdirSync, readFileSync, renameSync, existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const PRESETS_VERSION = 1
export const MAX_PRESETS = 30
export const MAX_NAME_LENGTH = 40

const LAYER_IDS = ['skin', 'theme', 'background', 'decoration']

export function presetsPath() {
  const override = process.env.DSH_APPEARANCE_PRESETS
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'appearance-presets.json')
}

function emptyStore() {
  return { version: PRESETS_VERSION, presets: [] }
}

/** 读取方案文件；坏 JSON 不抛错，返回空集合并带上错误说明。 */
export function readPresets() {
  const path = presetsPath()
  if (!existsSync(path)) return { ...emptyStore(), path, error: null }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const presets = Array.isArray(parsed?.presets) ? parsed.presets.filter(isUsablePreset) : []
    return { version: PRESETS_VERSION, presets, path, error: null }
  } catch (cause) {
    return { ...emptyStore(), path, error: `${cause?.name ?? 'Error'}: ${cause?.message ?? String(cause)}` }
  }
}

function isUsablePreset(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    entry.selections !== null &&
    typeof entry.selections === 'object'
  )
}

function writePresets(presets) {
  const path = presetsPath()
  mkdirSync(dirname(path), { recursive: true })
  const payload = JSON.stringify({ version: PRESETS_VERSION, presets }, null, 2)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, payload, 'utf8')
  renameSync(temporary, path)
  return path
}

/** 把任意输入规整成只含已知层、单一类型的 selections。 */
export function normalizeSelections(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const result = {}
  for (const layerId of LAYER_IDS) {
    const value = source[layerId]
    if (layerId === 'decoration') {
      result[layerId] = Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
    } else {
      result[layerId] = typeof value === 'string' ? value : ''
    }
  }
  return result
}

/**
 * 保存一份新方案。
 * @param {string} name
 * @param {Record<string, string | string[]>} selections
 */
export function addPreset(name, selections) {
  const cleanName = typeof name === 'string' ? name.trim() : ''
  if (cleanName === '') return { ok: false, error: '方案需要一个名字' }
  if (cleanName.length > MAX_NAME_LENGTH) return { ok: false, error: `名字最长 ${MAX_NAME_LENGTH} 个字符` }

  const store = readPresets()
  if (store.presets.length >= MAX_PRESETS) return { ok: false, error: `最多保存 ${MAX_PRESETS} 个方案` }

  const preset = {
    id: randomUUID(),
    name: cleanName,
    createdAt: new Date().toISOString(),
    selections: normalizeSelections(selections),
  }
  const presets = [...store.presets, preset]
  const path = writePresets(presets)
  return { ok: true, preset, presets, path }
}

export function removePreset(id) {
  const store = readPresets()
  const presets = store.presets.filter((preset) => preset.id !== id)
  if (presets.length === store.presets.length) return { ok: false, error: '找不到这个方案' }
  const path = writePresets(presets)
  return { ok: true, presets, path }
}

export function getPreset(id) {
  return readPresets().presets.find((preset) => preset.id === id) ?? null
}
