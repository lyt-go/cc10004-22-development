import type { MappingRecord, RecoveryTask } from './mapping-types'

// 映射数据独立存放，不和通用 EntryRow 混在同一个 key 里。
const MAPPING_STORAGE_KEY = 'data-product-ops:benchmark-mappings'
const RECOVERY_STORAGE_KEY = 'data-product-ops:mapping-recovery'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 验收样例：BENC-0002 次月留存 42%（monthly / R-2026-11）
// → RETE-0002（初始事件：付费下单）候选阈值 38%，预计差距 4 个百分点。
// 主对标尚未确认，因此保持「待确认」，不能启用。
export const SEED_MAPPINGS: MappingRecord[] = [
  {
    id: 1,
    mappingNo: 'BMAP-0001',
    status: '待确认',
    benchmarkNo: 'BENC-0002',
    retentionNo: 'RETE-0002',
    metric: '次月留存率',
    initialEvent: '付费下单',
    baselineValue: 42,
    baselineText: '42%',
    collectCycle: 'monthly',
    sourceRef: 'R-2026-11',
    candidateThreshold: 38,
    candidateThresholdText: '38%',
    estimatedGap: 4,
    gapTolerance: 4,
    primaryConfirmed: false,
    lockedBenchmarkVersion: '',
    lockedBaselineValue: null,
    lockedAt: '',
    reviewReason: '',
    currentBaselineValue: null,
    drift: null,
    conclusion: '对标结论：引用 BENC-0002「次月留存率」基准值 42%（来源 R-2026-11，周期 monthly），映射生成留存阈值 38%，实际留存结果按该阈值核查，预计留存差距 4 个百分点（容限 4 个百分点）。',
    failReason: '',
    createdAt: '2026-11-10 09:20',
    updatedAt: '2026-11-10 09:20',
    version: 1,
  },
]

export const SEED_RECOVERY_TASKS: RecoveryTask[] = []

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    // 存储内容损坏：回到种子数据，并把异常原因抛给上层展示。
    window.localStorage.setItem(key, JSON.stringify(fallback))
    throw new Error(`本地映射数据解析失败，已恢复为初始样例：${error instanceof Error ? error.message : '未知存储异常'}`)
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    throw new Error(`本地存储写入失败（可能是浏览器空间不足或被禁用）：${error instanceof Error ? error.message : '未知写入异常'}`)
  }
}

let mappingCache: MappingRecord[] | null = null
let recoveryCache: RecoveryTask[] | null = null

export function listMappings(): MappingRecord[] {
  if (mappingCache === null) {
    mappingCache = readJson(MAPPING_STORAGE_KEY, SEED_MAPPINGS)
  }
  return mappingCache
}

export function saveMappings(rows: MappingRecord[]): void {
  writeJson(MAPPING_STORAGE_KEY, rows)
  mappingCache = clone(rows)
}

export function listRecoveryTasks(): RecoveryTask[] {
  if (recoveryCache === null) {
    recoveryCache = readJson(RECOVERY_STORAGE_KEY, SEED_RECOVERY_TASKS)
  }
  return recoveryCache
}

export function saveRecoveryTasks(rows: RecoveryTask[]): void {
  writeJson(RECOVERY_STORAGE_KEY, rows)
  recoveryCache = clone(rows)
}

export function resetMappings(): MappingRecord[] {
  saveMappings(clone(SEED_MAPPINGS))
  saveRecoveryTasks(clone(SEED_RECOVERY_TASKS))
  return listMappings()
}

export function mappingStorageKey(): string {
  return MAPPING_STORAGE_KEY
}
