import { listRows, saveRows } from '@/data/local-store'
import {
  DEFAULT_THRESHOLD_BUFFER_PP,
  GAP_TOLERANCE_PP,
  type MappingDraftInput,
  type MappingRecord,
  type MappingResult,
  type RecoveryTask,
} from '@/data/mapping-types'
import {
  listMappings,
  listRecoveryTasks,
  resetMappings,
  saveMappings,
  saveRecoveryTasks,
} from '@/data/mapping-store'
import type { EntryRow } from '@/data/types'

const PRODUCT_FIELD = '关联产品'

// 解析「42%」「42」这类基准/阈值文本为数值；无法解析即视为映射失败。
export function parsePercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const text = String(value ?? '').trim().replace('％', '%')
  const matched = text.match(/-?\d+(\.\d+)?/)
  if (!matched) {
    return null
  }
  const parsed = Number(matched[0])
  return Number.isFinite(parsed) ? parsed : null
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

function nowText(): string {
  const date = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

function nextMappingNo(rows: MappingRecord[]): string {
  return `BMAP-${String(nextId(rows)).padStart(4, '0')}`
}

function benchmarkRows(): EntryRow[] {
  return listRows('benchmark')
}

function retentionRows(): EntryRow[] {
  return listRows('retention')
}

export function findBenchmark(benchmarkNo: string): EntryRow | undefined {
  return benchmarkRows().find((row) => String(row['方案编号']) === benchmarkNo)
}

export function findRetention(retentionNo: string): EntryRow | undefined {
  return retentionRows().find((row) => String(row['方案编号']) === retentionNo)
}

// 人群覆盖判定：留存方案的「关联产品」与对标方案对标对象的产品线重叠即视为同一人群。
// 这里以留存方案关联产品为人群键，两个对标方案落到同一产品上即触发主对标仲裁。
function audienceKeyOfRetention(row: EntryRow): string {
  return String(row[PRODUCT_FIELD] ?? '').trim()
}

function audienceKeyOfBenchmark(row: EntryRow): string {
  // 对标对象形如「行业平均·会员订阅版」，取「·」后的产品线。
  const text = String(row['对标对象'] ?? '')
  const parts = text.split('·')
  return (parts.length > 1 ? parts.slice(1).join('·') : text).trim()
}

export function overlappingMappings(retentionNo: string, excludeId = 0): MappingRecord[] {
  return listMappings().filter(
    (item) => item.retentionNo === retentionNo && item.id !== excludeId && item.status !== '映射失败',
  )
}

function buildConclusion(record: MappingRecord): string {
  return `对标结论：引用 ${record.benchmarkNo}「${record.metric}」基准值 ${record.baselineText}（来源 ${record.sourceRef}，周期 ${record.collectCycle}），映射生成留存阈值 ${record.candidateThresholdText}，实际留存结果按该阈值核查，预计留存差距 ${record.estimatedGap} 个百分点（容限 ${record.gapTolerance} 个百分点）。`
}

/**
 * 生成基准映射：对比指标 + 基准值 + 初始事件三要素必须全部可核查，
 * 任一缺失或不可解析即映射失败，对标方案与留存方案都不进入启用状态。
 */
export function generateMapping(input: MappingDraftInput): MappingResult {
  const benchmark = findBenchmark(input.benchmarkNo)
  if (!benchmark) {
    return failBoth(input, `对标方案 ${input.benchmarkNo} 不存在，无法取得基准值`)
  }
  const retention = findRetention(input.retentionNo)
  if (!retention) {
    return failBoth(input, `留存方案 ${input.retentionNo} 不存在，无法承接候选阈值`)
  }

  const metric = input.metric.trim()
  const initialEvent = input.initialEvent.trim()
  if (!metric) {
    return failBoth(input, '未选择对比指标，指标无法转换为可核查的留存阈值')
  }
  if (!initialEvent) {
    return failBoth(input, '未选择适用的初始事件，留存群组无法界定')
  }
  const baseline = parsePercent(benchmark['基准值'])
  if (baseline === null) {
    return failBoth(input, `对标方案基准值「${String(benchmark['基准值'])}」不是可核查的百分比数值`)
  }
  if (!String(benchmark['对比指标'] ?? '').includes(metric.replace('率', '')) &&
      !metric.includes(String(benchmark['对比指标'] ?? '').replace('率', ''))) {
    return failBoth(input, `所选对比指标「${metric}」与对标方案登记指标「${String(benchmark['对比指标'])}」不一致`)
  }
  if (!String(retention['初始事件'] ?? '').includes(initialEvent)) {
    return failBoth(input, `初始事件「${initialEvent}」不属于留存方案 ${input.retentionNo} 的登记初始事件`)
  }

  const buffer = input.bufferPp ?? DEFAULT_THRESHOLD_BUFFER_PP
  const candidate = baseline - buffer
  if (candidate <= 0) {
    return failBoth(input, `基准值 ${formatPercent(baseline)} 下调 ${buffer} 个百分点后候选阈值非正，无法作为留存阈值`)
  }

  const rows = listMappings()
  const duplicate = rows.find(
    (item) => item.benchmarkNo === input.benchmarkNo && item.retentionNo === input.retentionNo && item.status !== '映射失败',
  )
  if (duplicate) {
    return { ok: false, message: `该对标与留存组合已存在映射 ${duplicate.mappingNo}，请勿重复生成` }
  }

  const record: MappingRecord = {
    id: nextId(rows),
    mappingNo: nextMappingNo(rows),
    status: '待确认',
    benchmarkNo: input.benchmarkNo,
    retentionNo: input.retentionNo,
    metric,
    initialEvent,
    baselineValue: baseline,
    baselineText: formatPercent(baseline),
    collectCycle: String(benchmark['采集周期'] ?? ''),
    sourceRef: String(benchmark['数据来源'] ?? ''),
    candidateThreshold: candidate,
    candidateThresholdText: formatPercent(candidate),
    estimatedGap: baseline - candidate,
    gapTolerance: GAP_TOLERANCE_PP,
    primaryConfirmed: false,
    lockedBenchmarkVersion: '',
    lockedBaselineValue: null,
    lockedAt: '',
    reviewReason: '',
    currentBaselineValue: null,
    drift: null,
    conclusion: '',
    failReason: '',
    createdAt: nowText(),
    updatedAt: nowText(),
    version: 1,
  }
  record.conclusion = buildConclusion(record)
  saveMappings([...rows, record])
  return { ok: true, message: `映射 ${record.mappingNo} 已生成：候选阈值 ${record.candidateThresholdText}，预计留存差距 ${record.estimatedGap} 个百分点，待确认主对标后启用`, record }
}

// 映射失败：落一条失败记录，同时确保对标、留存两边都不处于已启用状态。
function failBoth(input: MappingDraftInput, reason: string): MappingResult {
  const benchmark = findBenchmark(input.benchmarkNo)
  const retention = findRetention(input.retentionNo)
  if (benchmark && String(benchmark.status) === '已启用') {
    flipStatus('benchmark', Number(benchmark.id), '方案评审中')
  }
  if (retention && String(retention.status) === '已启用') {
    flipStatus('retention', Number(retention.id), '方案评审中')
  }
  const rows = listMappings()
  const baseline = benchmark ? parsePercent(benchmark['基准值']) : null
  const failed: MappingRecord = {
    id: nextId(rows),
    mappingNo: nextMappingNo(rows),
    status: '映射失败',
    benchmarkNo: input.benchmarkNo,
    retentionNo: input.retentionNo,
    metric: input.metric,
    initialEvent: input.initialEvent,
    baselineValue: baseline ?? 0,
    baselineText: benchmark ? String(benchmark['基准值'] ?? '') : '',
    collectCycle: benchmark ? String(benchmark['采集周期'] ?? '') : '',
    sourceRef: benchmark ? String(benchmark['数据来源'] ?? '') : '',
    candidateThreshold: 0,
    candidateThresholdText: '—',
    estimatedGap: 0,
    gapTolerance: GAP_TOLERANCE_PP,
    primaryConfirmed: false,
    lockedBenchmarkVersion: '',
    lockedBaselineValue: null,
    lockedAt: '',
    reviewReason: '',
    currentBaselineValue: null,
    drift: null,
    conclusion: '',
    failReason: reason,
    createdAt: nowText(),
    updatedAt: nowText(),
    version: 1,
  }
  saveMappings([...rows, failed])
  return { ok: false, message: `映射失败：${reason}。对标方案与留存方案均未进入启用状态` }
}

function flipStatus(key: 'benchmark' | 'retention', id: number, status: string): void {
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return
  }
  const next = [...rows]
  next[index] = { ...next[index], status, pending: status !== '已启用', abnormal: status !== '已启用' }
  saveRows(key, next)
}

/**
 * 确认主对标：同一人群（同一留存方案）存在多个对标映射时，
 * 只有明确指定的主对标可以被确认，其余映射作为副对标不能启用。
 * 主对标发生变化时，已启用的旧主对标只转入「待复核」，不会被直接改写。
 */
export function confirmPrimary(mappingId: number): MappingResult {
  const rows = listMappings()
  const target = rows.find((row) => row.id === mappingId)
  if (!target) {
    return { ok: false, message: '没有找到对应的基准映射' }
  }
  if (target.status === '映射失败') {
    return { ok: false, message: '映射失败的记录不能确认为主对标，请重新生成映射' }
  }
  const next = rows.map((row) => {
    if (row.retentionNo !== target.retentionNo || row.status === '映射失败') {
      return row
    }
    if (row.id === mappingId) {
      return { ...row, primaryConfirmed: true, updatedAt: nowText() }
    }
    // 主对标关系切换：旧主对标若已启用/待复核，只触发待复核，不直接停用或改写阈值。
    const replaced = row.primaryConfirmed
    const demoted: MappingRecord = {
      ...row,
      primaryConfirmed: false,
      status: replaced && (row.status === '已启用' || row.status === '待复核') ? '待复核' : row.status,
      reviewReason: replaced
        ? `同一人群主对标已变更为 ${target.benchmarkNo}（映射 ${target.mappingNo}），本方案由主对标降为副对标，待人工复核；已锁定的对标版本与留存阈值保持不变`
        : `同一人群主对标已指定为 ${target.benchmarkNo}，本映射作为副对标`,
      updatedAt: nowText(),
    }
    return demoted
  })
  saveMappings(next)
  return { ok: true, message: `已确认 ${target.benchmarkNo} 为 ${target.retentionNo} 人群的主对标` }
}

/**
 * 启用映射：主对标必须已确认；启用瞬间固定对标版本快照，
 * 并同步把留存方案置为已启用。映射失败或主对标未确认一律拒绝。
 */
export function enableMapping(mappingId: number): MappingResult {
  const rows = listMappings()
  const target = rows.find((row) => row.id === mappingId)
  if (!target) {
    return { ok: false, message: '没有找到对应的基准映射' }
  }
  if (target.status === '映射失败') {
    return { ok: false, message: `映射失败（${target.failReason}），不能启用，请修正后重新生成` }
  }
  if (!target.primaryConfirmed) {
    return { ok: false, message: '主对标尚未确认：同一人群存在多个对标方案时，必须先明确指定主对标才能启用' }
  }

  // 主对标仲裁：同一人群若已有处于启用链路中的映射（含待复核的旧主对标），拒绝重复启用。
  const conflict = rows.find(
    (row) =>
      row.id !== target.id &&
      row.retentionNo === target.retentionNo &&
      (row.status === '已启用' || row.status === '待复核'),
  )
  if (conflict) {
    return { ok: false, message: `同一人群已有 ${conflict.benchmarkNo} 的映射处于「${conflict.status}」（${conflict.mappingNo}），请先完成复核或归档后再启用新主对标` }
  }

  const benchmark = findBenchmark(target.benchmarkNo)
  const retention = findRetention(target.retentionNo)
  if (!benchmark || !retention) {
    return { ok: false, message: '映射引用的对标方案或留存方案已被删除，无法启用' }
  }
  const liveBaseline = parsePercent(benchmark['基准值'])
  if (liveBaseline === null) {
    return { ok: false, message: '对标基准值已损坏为不可核查数值，启用被拦截' }
  }

  const version = `V${target.version}-${benchmark['方案编号']}-${liveBaseline}pct-${target.sourceRef}`
  const next = rows.map((row) => {
    if (row.id !== mappingId) {
      return row
    }
    const updated: MappingRecord = {
      ...row,
      status: '已启用',
      lockedBenchmarkVersion: version,
      lockedBaselineValue: liveBaseline,
      lockedAt: nowText(),
      currentBaselineValue: liveBaseline,
      drift: 0,
      reviewReason: '',
      conclusion: buildConclusion({ ...row, baselineValue: liveBaseline }),
      updatedAt: nowText(),
      version: row.version + 1,
    }
    return updated
  })
  saveMappings(next)

  // 把候选阈值回写留存方案并同步启用，阈值自此可核查。
  const allRetentionRows = retentionRows()
  const rIndex = allRetentionRows.findIndex((row) => String(row['方案编号']) === target.retentionNo)
  const updatedRetention: EntryRow = {
    ...allRetentionRows[rIndex],
    status: '已启用',
    pending: false,
    abnormal: false,
    留存阈值: target.candidateThresholdText,
  }
  const nextRetention = [...allRetentionRows]
  nextRetention[rIndex] = updatedRetention
  saveRows('retention', nextRetention)

  const enabled = next.find((row) => row.id === mappingId)
  return {
    ok: true,
    message: `映射 ${target.mappingNo} 已启用并固定对标版本 ${version}，留存方案 ${target.retentionNo} 阈值锁定为 ${target.candidateThresholdText}`,
    record: enabled,
  }
}

/**
 * 模拟竞品基准更新：已启用映射不会被直接改写，
 * 漂移超过容限（默认 4 个百分点）即转为「待复核」；未启用映射仅刷新待确认数据。
 */
export function applyBenchmarkDrift(benchmarkNo: string, newBaselineText: string): MappingResult {
  const benchmark = findBenchmark(benchmarkNo)
  if (!benchmark) {
    return { ok: false, message: `对标方案 ${benchmarkNo} 不存在` }
  }
  const newBaseline = parsePercent(newBaselineText)
  if (newBaseline === null) {
    return { ok: false, message: `新基准值「${newBaselineText}」不是可核查的百分比数值，更新被拒绝` }
  }

  // 更新对标方案自身的基准值。
  const bRows = benchmarkRows()
  const bIndex = bRows.findIndex((row) => String(row['方案编号']) === benchmarkNo)
  const nextBenchmark = [...bRows]
  nextBenchmark[bIndex] = { ...nextBenchmark[bIndex], 基准值: formatPercent(newBaseline) }
  saveRows('benchmark', nextBenchmark)

  const rows = listMappings()
  let touched = 0
  const next = rows.map((row) => {
    if (row.benchmarkNo !== benchmarkNo) {
      return row
    }
    touched += 1
    if (row.status === '已启用' || row.status === '待复核') {
      const locked = row.lockedBaselineValue ?? row.baselineValue
      const drift = Number((newBaseline - locked).toFixed(2))
      const overTolerance = Math.abs(drift) > row.gapTolerance
      const updated: MappingRecord = {
        ...row,
        status: overTolerance ? '待复核' : row.status,
        currentBaselineValue: newBaseline,
        drift,
        reviewReason: overTolerance
          ? `竞品基准由 ${formatPercent(locked)} 变为 ${formatPercent(newBaseline)}，漂移 ${drift > 0 ? '+' : ''}${drift} 个百分点，超出容限 ${row.gapTolerance} 个百分点；已启用方案保持锁定版本不变，待人工复核`
          : `竞品基准微调 ${drift > 0 ? '+' : ''}${drift} 个百分点，未超容限，固定版本继续生效`,
        updatedAt: nowText(),
      }
      return updated
    }
    // 待确认/失败映射：同步最新基准，仍保持原状态，不自动启用。
    return {
      ...row,
      baselineValue: newBaseline,
      baselineText: formatPercent(newBaseline),
      currentBaselineValue: newBaseline,
      updatedAt: nowText(),
    }
  })
  saveMappings(next)
  const reviewCount = next.filter((row) => row.benchmarkNo === benchmarkNo && row.status === '待复核').length
  return {
    ok: true,
    message:
      touched === 0
        ? `对标方案 ${benchmarkNo} 基准已更新为 ${formatPercent(newBaseline)}，当前没有映射引用它`
        : `基准已更新为 ${formatPercent(newBaseline)}：${reviewCount} 条已启用映射转入待复核，其余映射保持原状态，已启用方案的锁定阈值未被改写`,
  }
}

/** 复核确认：接受最新基准并重新固定版本，映射回到已启用（阈值可重新生成后再锁定）。 */
export function resolveReview(mappingId: number, adoptLatest: boolean): MappingResult {
  const rows = listMappings()
  const target = rows.find((row) => row.id === mappingId)
  if (!target) {
    return { ok: false, message: '没有找到对应的基准映射' }
  }
  if (target.status !== '待复核') {
    return { ok: false, message: '只有待复核状态的映射需要复核处理' }
  }
  const benchmark = findBenchmark(target.benchmarkNo)
  if (!benchmark) {
    return { ok: false, message: '引用的对标方案已不存在，无法复核' }
  }
  const liveBaseline = parsePercent(benchmark['基准值']) ?? target.currentBaselineValue ?? target.baselineValue
  const baseline = adoptLatest ? liveBaseline : target.lockedBaselineValue ?? target.baselineValue
  const candidate = baseline - DEFAULT_THRESHOLD_BUFFER_PP
  const next = rows.map((row) => {
    if (row.id !== mappingId) {
      return row
    }
    const updated: MappingRecord = {
      ...row,
      status: '已启用',
      baselineValue: baseline,
      baselineText: formatPercent(baseline),
      candidateThreshold: candidate,
      candidateThresholdText: formatPercent(candidate),
      estimatedGap: baseline - candidate,
      lockedBaselineValue: baseline,
      lockedBenchmarkVersion: `V${row.version + 1}-${row.benchmarkNo}-${baseline}pct-${row.sourceRef}`,
      lockedAt: nowText(),
      currentBaselineValue: liveBaseline,
      drift: Number((liveBaseline - baseline).toFixed(2)),
      reviewReason: '',
      updatedAt: nowText(),
      version: row.version + 1,
    }
    updated.conclusion = buildConclusion(updated)
    return updated
  })
  saveMappings(next)

  const rRows = retentionRows()
  const rIndex = rRows.findIndex((row) => String(row['方案编号']) === target.retentionNo)
  if (rIndex >= 0) {
    const updatedRetention: EntryRow[] = [...rRows]
    updatedRetention[rIndex] = {
      ...updatedRetention[rIndex],
      status: '已启用',
      pending: false,
      abnormal: false,
      留存阈值: formatPercent(baseline - DEFAULT_THRESHOLD_BUFFER_PP),
    }
    saveRows('retention', updatedRetention)
  }
  return { ok: true, message: adoptLatest ? '已采纳最新基准并重新固定对标版本，映射恢复已启用' : '已维持原锁定基准，复核关闭，映射恢复已启用' }
}

// ---- 中断恢复：生成过程中出现异常时落任务快照，页面可凭快照重试 ----

export function saveRecoveryTask(task: Omit<RecoveryTask, 'id' | 'createdAt'>): RecoveryTask {
  const tasks = listRecoveryTasks()
  const taskRecord: RecoveryTask = { ...task, id: nextId(tasks), createdAt: nowText() }
  saveRecoveryTasks([...tasks, taskRecord])
  return taskRecord
}

export function clearRecoveryTask(id: number): void {
  saveRecoveryTasks(listRecoveryTasks().filter((task) => task.id !== id))
}

export { listMappings, listRecoveryTasks, resetMappings }

export function mappingOptions() {
  return {
    benchmarks: benchmarkRows().map((row) => ({
      no: String(row['方案编号']),
      name: String(row['对标对象']),
      metric: String(row['对比指标']),
      baseline: String(row['基准值']),
      cycle: String(row['采集周期']),
      source: String(row['数据来源']),
      audience: audienceKeyOfBenchmark(row),
      status: String(row.status),
    })),
    retentions: retentionRows().map((row) => ({
      no: String(row['方案编号']),
      name: String(row['方案名称']),
      initialEvent: String(row['初始事件']),
      product: audienceKeyOfRetention(row),
      status: String(row.status),
    })),
  }
}
