/** 基准映射（竞品对标 → 留存方案）领域类型。 */

// 映射生命周期状态：
// 待确认：候选阈值已生成，等待业务确认主对标后才能启用
// 已启用：对标版本已固定，留存方案同步启用
// 待复核：已启用映射所引用的对标基准发生变化，只能复核不能被直接改写
// 映射失败：对比指标/基准值/初始事件无法转换为可核查阈值，两边都不进入启用状态
export type MappingStatus = '待确认' | '已启用' | '待复核' | '映射失败'

// 差值容限单位统一为「个百分点」，由平台固定，业务不可逐单修改。
export const GAP_TOLERANCE_PP = 4

// 候选阈值相对基准值默认下调的安全垫（个百分点）：基准 42% → 候选 38%。
export const DEFAULT_THRESHOLD_BUFFER_PP = 4

export type MappingRecord = {
  id: number
  mappingNo: string
  status: MappingStatus
  benchmarkNo: string
  retentionNo: string
  // 业务为每个对标方案选择的对比指标、基准值与适用的初始事件
  metric: string
  initialEvent: string
  baselineValue: number
  baselineText: string
  collectCycle: string
  sourceRef: string
  // 生成的留存方案候选阈值与预计留存差距（同时出现、可核查）
  candidateThreshold: number
  candidateThresholdText: string
  estimatedGap: number
  gapTolerance: number
  // 覆盖同一人群时的主对标标记：未确认主对标的映射一律不能启用
  primaryConfirmed: boolean
  // 启用时固定的对标版本快照，之后竞品基准变化不再回写
  lockedBenchmarkVersion: string
  lockedBaselineValue: number | null
  lockedAt: string
  // 复核信息
  reviewReason: string
  currentBaselineValue: number | null
  drift: number | null
  conclusion: string
  failReason: string
  createdAt: string
  updatedAt: string
  version: number
}

export type MappingDraftInput = {
  benchmarkNo: string
  retentionNo: string
  metric: string
  initialEvent: string
  bufferPp?: number
}

export type MappingResult = {
  ok: boolean
  message: string
  record?: MappingRecord
}

// 中断恢复用的任务快照：生成过程被打断后可凭它重试。
export type RecoveryTask = {
  id: number
  benchmarkNo: string
  retentionNo: string
  stage: string
  reason: string
  createdAt: string
}
