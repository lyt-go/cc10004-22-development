import { listMappings } from '@/data/mapping-store'

// 供对标/留存列表页展示映射联动状态，避免页面直接依赖完整映射服务。
export function mappingsByBenchmark(benchmarkNo: string) {
  try {
    return listMappings().filter((row) => row.benchmarkNo === benchmarkNo)
  } catch {
    return []
  }
}

export function mappingsByRetention(retentionNo: string) {
  try {
    return listMappings().filter((row) => row.retentionNo === retentionNo)
  } catch {
    return []
  }
}
